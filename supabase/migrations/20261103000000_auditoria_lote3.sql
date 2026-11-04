-- =====================================================================
-- Auditoria de 03/11/2026 — Lote 3 (relatório: https://claude.ai/artifact/F32qXRyzqgBX9YCAAkV9Bj)
--
-- Por quê: os testes do banco mostraram caminhos em que um operador de caixa, pelo console do
-- navegador, mexe em dinheiro sem passar pelas regras do app. Nenhum fluxo do app usa esses
-- caminhos (conferido no código em 03/11), então fechar não muda a operação.
--
-- O que muda:
--   A4  sales_apply: venda FECHADA só muda ou sai por dono/admin. Para o caixa ela volta em
--       "conflicts" com reason 'fechada' e a venda como está (o site novo fica com a do servidor).
--       close_sale: venda já fechada (sem recibo) só é regravada por dono/admin.
--   B2  sai a versão antiga sales_apply(jsonb, jsonb), que gravava sem conferir a versão.
--   M4  cantina2:quemLevou vira 'catalogo' (todos leem, admin grava). Antes caía em "só admin"
--       e a lista "Quem levou?" ficava vazia no aparelho do caixa.
--   M6  members.debt só muda pelo extrato (gatilho recalc_member_debt); lançamento de fiado
--       com valor <= 0 é recusado (CHECK). Antes o caixa zerava a dívida direto.
--   M7  o caixa não grava mais direto cantina2:cashSession, cashHistory e cashMovements: o app
--       já usa só as RPCs com trava (cash_session_open/close, cash_movements_apply), como já era
--       com orderCounter e insumos.
--   B3  sale_close_receipts sem INSERT/UPDATE/DELETE pelo navegador: só close_sale e
--       sale_reopen (SECURITY DEFINER) gravam. Antes um recibo falso fazia close_sale não fechar.
--
-- Conferido em produção antes (03/11, só leitura): nenhum lançamento de fiado com valor <= 0 e
-- nenhuma dívida diferente do extrato. Testado no Postgres 18 local com todas as migrations.
--
-- Desfazer (na ordem):
--   grant insert, update, delete on public.sale_close_receipts to authenticated;
--   recriar app_data_insert_por_papel / app_data_update_por_papel da migration
--     20260908000000 (lista "key not in" só com orderCounter e insumos);
--   alter table public.member_debt_entries drop constraint if exists member_debt_entries_value_positivo;
--   drop trigger if exists trg_members_guard_debt on public.members;
--   drop function if exists public.members_guard_debt();
--   recriar app_data_key_class da migration 20260908010000 (sem cantina2:quemLevou);
--   recriar sales_apply(jsonb,jsonb,jsonb) da 20261011020000, sales_apply(jsonb,jsonb) da
--     20261010030000 e close_sale da 20261002000000.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A4 + B2: vendas
-- ---------------------------------------------------------------------
drop function if exists public.sales_apply(jsonb, jsonb);

create or replace function public.sales_apply(p_upserts jsonb, p_delete_ids jsonb, p_bases jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_admin boolean := public.is_admin_like();
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_del jsonb := coalesce(p_delete_ids, '[]'::jsonb);
  v_bases jsonb := coalesce(p_bases, '{}'::jsonb);
  v_conf jsonb := '[]'::jsonb;
  v_written jsonb := '[]'::jsonb;
  v_rows jsonb;
  e jsonb;
  v_id text;
  v_cur jsonb;
  v_live boolean;
  v_found boolean;
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para gravar vendas';
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_del) <> 'array' or jsonb_typeof(v_bases) <> 'object'
     or jsonb_array_length(v_up) > 500 or jsonb_array_length(v_del) > 500 then
    raise exception 'vendas invalidas';
  end if;
  if exists (select 1 from jsonb_array_elements(v_up) x
              where jsonb_typeof(x) <> 'object' or coalesce(x->>'id', '') = '') then
    raise exception 'venda sem id';
  end if;

  for e in select x from jsonb_array_elements(v_up) as t(x) loop
    v_id := e->>'id';
    v_cur := null; v_live := null;
    select s.data, (s.deleted_at is null) into v_cur, v_live
      from public.sales s
     where s.tenant_id = v_tenant and s.id = v_id
       for update;
    v_found := found;
    -- A4: venda fechada (mesmo apagada) só muda por dono/admin.
    if v_found and not v_admin and coalesce(v_cur->>'status', '') = 'closed' then
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', v_id, 'data', case when v_live then v_cur end, 'reason', 'fechada'));
      continue;
    end if;
    -- Trava de versão (20261011020000): a base que o aparelho leu tem que ser a atual.
    if v_bases ? v_id then
      if not (v_found and v_live) or v_cur is distinct from (v_bases->v_id) then
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', v_id, 'data', case when v_live then v_cur end));
        continue;
      end if;
    end if;
    insert into public.sales as s (tenant_id, id, data)
    values (v_tenant, v_id, e)
    on conflict (tenant_id, id) do update
      set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;
    v_written := v_written || to_jsonb(v_id);
  end loop;

  -- A4: venda fechada só sai por dono/admin; para os outros volta como conflito.
  if not v_admin then
    v_conf := v_conf || coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data, 'reason', 'fechada'))
        from public.sales s
       where s.tenant_id = v_tenant and s.deleted_at is null
         and s.id in (select jsonb_array_elements_text(v_del))
         and coalesce(s.data->>'status', '') = 'closed'), '[]'::jsonb);
  end if;

  update public.sales
     set deleted_at = now(), updated_at = now(), version = version + 1
   where tenant_id = v_tenant
     and deleted_at is null
     and id in (select jsonb_array_elements_text(v_del))
     and (v_admin or coalesce(data->>'status', '') <> 'closed');

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'version', version, 'updated_at', updated_at)), '[]'::jsonb)
    into v_rows
    from public.sales
   where tenant_id = v_tenant
     and id in (select jsonb_array_elements_text(v_written) union select jsonb_array_elements_text(v_del));

  return jsonb_build_object('rows', v_rows, 'conflicts', v_conf, 'server_time', now());
end;
$function$;

create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text;
  v_result jsonb;
  v_current jsonb;
  v_sale jsonb;
begin
  if not (public.is_admin_like() or public.current_staff_role() = 'caixa') then
    raise exception 'sem permissao para fechar venda';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_sale_id is null or length(p_sale_id) = 0 then
    raise exception 'p_sale_id obrigatorio';
  end if;

  if p_sale_patch is null or jsonb_typeof(p_sale_patch) <> 'object' then
    raise exception 'p_sale_patch deve ser um objeto JSON';
  end if;

  insert into public.sale_close_receipts (tenant_id, sale_id)
  values (v_tenant, p_sale_id)
  on conflict (tenant_id, sale_id) do nothing;

  select result into v_result
    from public.sale_close_receipts
   where tenant_id = v_tenant and sale_id = p_sale_id
   for update;

  if v_result is not null then
    return v_result; -- retry idempotente: ja foi processado, nao repete
  end if;

  select data into v_current
    from public.sales
   where tenant_id = v_tenant and id = p_sale_id and deleted_at is null
   for update;

  -- A4 (auditoria 03/11): venda ja fechada sem recibo (fechada antes dos recibos ou por outro
  -- caminho) so e regravada por dono/admin.
  if v_current is not null and coalesce(v_current->>'status', '') = 'closed' and not public.is_admin_like() then
    raise exception 'esta venda ja esta fechada' using errcode = '42501';
  end if;

  if p_existing then
    if v_current is null then
      raise exception 'venda % nao encontrada para atualizar', p_sale_id;
    end if;
    v_sale := v_current || p_sale_patch || jsonb_build_object('id', p_sale_id);
  else
    v_sale := p_sale_patch || jsonb_build_object('id', p_sale_id);
  end if;

  insert into public.sales as s (tenant_id, id, data)
  values (v_tenant, p_sale_id, v_sale)
  on conflict (tenant_id, id) do update
    set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;

  update public.sale_close_receipts
     set result = v_sale
   where tenant_id = v_tenant and sale_id = p_sale_id;

  return v_sale;
end;
$function$;


-- ---------------------------------------------------------------------
-- B3: recibos de fechamento só pelas funções
-- ---------------------------------------------------------------------
revoke insert, update, delete on table public.sale_close_receipts from anon, authenticated;


-- ---------------------------------------------------------------------
-- M4: "Quem levou" é catálogo (todos leem, admin grava)
-- ---------------------------------------------------------------------
create or replace function public.app_data_key_class(p_key text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_key
    -- catalogo: lido por todos os papeis, escrito so por admin/dono
    when 'cantina2:products'        then 'catalogo'
    when 'cantina2:categorias'      then 'catalogo'
    when 'cantina2:complementos'    then 'catalogo'
    when 'cantina2:observacoes'     then 'catalogo'
    when 'cantina2:perguntas'       then 'catalogo'
    when 'cantina2:paymentMethods'  then 'catalogo'
    when 'cantina2:cardBrands'      then 'catalogo'
    when 'cantina2:coupons'         then 'catalogo'
    when 'cantina2:locais'          then 'catalogo'
    when 'cantina2:impressoras'     then 'catalogo'
    when 'cantina2:estacoes'        then 'catalogo'
    when 'cantina2:origens'         then 'catalogo'
    when 'cantina2:settings'        then 'catalogo'
    when 'cantina2:users'           then 'catalogo'
    when 'cantina2:quemLevou'       then 'catalogo'  -- auditoria 03/11 (M4)
    -- operacional: dinheiro e estoque do expediente
    when 'cantina2:sales'           then 'operacional'
    when 'cantina2:requests'        then 'operacional'
    when 'cantina2:scheduled'       then 'operacional'
    when 'cantina2:cashSession'     then 'operacional'
    when 'cantina2:cashHistory'     then 'operacional'
    when 'cantina2:cashMovements'   then 'operacional'
    when 'cantina2:orderCounter'    then 'operacional'
    when 'cantina2:insumos'         then 'operacional'
    when 'cantina2:stockMovements'  then 'operacional'
    -- auditoria: congelada
    when 'cantina2:logs'            then 'auditoria'
    -- retaguarda
    when 'cantina2:contas'          then 'admin'
    when 'cantina2:contaCategorias' then 'admin'
    when 'cantina2:fornecedores'    then 'admin'
    when 'cantina2:eventQueue'      then 'admin'
    else 'admin'  -- fail-closed (inclui 'cantina2:orders', migrado pra tabela)
  end;
$function$;


-- ---------------------------------------------------------------------
-- M7: caixa grava o caixa só pelas RPCs com trava
-- ---------------------------------------------------------------------
drop policy if exists app_data_insert_por_papel on public.app_data;
create policy app_data_insert_por_papel
  on public.app_data
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
        and key not in ('cantina2:orderCounter','cantina2:insumos','cantina2:cashSession','cantina2:cashHistory','cantina2:cashMovements')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  );

drop policy if exists app_data_update_por_papel on public.app_data;
create policy app_data_update_por_papel
  on public.app_data
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
        and key not in ('cantina2:orderCounter','cantina2:insumos','cantina2:cashSession','cantina2:cashHistory','cantina2:cashMovements')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
        and key not in ('cantina2:orderCounter','cantina2:insumos','cantina2:cashSession','cantina2:cashHistory','cantina2:cashMovements')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  );


-- ---------------------------------------------------------------------
-- M6: dívida do sócio só pelo extrato de fiado
-- ---------------------------------------------------------------------
create or replace function public.members_guard_debt()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- recalc_member_debt (gatilho do extrato) atualiza members de dentro de outro gatilho:
  -- profundidade 2. Gravação direta do navegador é profundidade 1.
  if current_user in ('authenticated', 'anon') and pg_trigger_depth() < 2
     and (tg_op = 'INSERT' and coalesce(new.debt, 0) <> 0
          or tg_op = 'UPDATE' and new.debt is distinct from old.debt) then
    raise exception 'A divida do socio sai do extrato de fiado: lance um debito ou um pagamento.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.members_guard_debt() from public, anon, authenticated;

drop trigger if exists trg_members_guard_debt on public.members;
create trigger trg_members_guard_debt
  before insert or update on public.members
  for each row execute function public.members_guard_debt();

alter table public.member_debt_entries drop constraint if exists member_debt_entries_value_positivo;
alter table public.member_debt_entries
  add constraint member_debt_entries_value_positivo check (value > 0) not valid;
alter table public.member_debt_entries validate constraint member_debt_entries_value_positivo;
