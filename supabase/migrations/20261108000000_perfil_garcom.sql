-- =====================================================================
-- Perfil garçom — 08/11/2026 (pedido do dono)
--
-- Por quê: o garçom precisa lançar pedido e fechar comanda pelo celular sem ganhar o resto
-- do caixa. Antes só existiam admin, caixa e cozinha; dar "caixa"
-- ao garçom liberava abrir/fechar caixa, sangria, fiado e cadastro de sócio.
--
-- O que o garçom pode:
--   app_data            lê e grava igual ao caixa (as chaves do caixa e do estoque continuam
--                       proibidas na gravação direta: orderCounter, insumos, cashSession,
--                       cashHistory, cashMovements).
--   orders              lê, cria e move pedido.
--   sales               lê; grava por sales_apply e close_sale. sales_apply também recusa do
--                       garçom venda com pagamento 'fiado' (senão fecharia em fiado por ali).
--   close_sale          sim, mas recusa fiado → erro 'garcom nao fecha fiado': pagamento com
--                       method 'fiado' (o mesmo que methodBucket trata como fiado em
--                       assets/js/core/config.js) ou qualquer lançamento em p_debt_entries que
--                       não seja o uso de crédito desta venda ('<venda>-credito', até o crédito
--                       que o sócio da venda tem). Pendência antiga do sócio fica com o caixa.
--   consume_insumos, restore_insumos, next_order_number: sim.
--   members             só lê (não cria, não edita); fiado e dependentes: não.
--   print_jobs          lê e cria ficha; print_job_resolve: sim.
--   nfce_notas          lê.
--   cash_session_open/close, cash_movements_apply, insumos_apply: não (cash_can_write()
--                       continua só admin/caixa; o app do garçom não faz pagamento parcial).
--   member_debt_entries: não (nem receber pendência).
--
-- pode_vender() = admin/dono, caixa ou garçom. Substitui cash_can_write()/= 'caixa' só nas
-- funções de venda; as do caixa continuam com cash_can_write().
-- Corpo das funções: copiado do banco atual (pg_get_functiondef), mudando só a checagem de papel
-- (e, em sales_apply e close_sale, as regras do garçom acima).
--
-- Desfazer:
--   update public.tenant_staff set role = 'caixa' where role = 'garcom';  -- ou desativar
--   recriar tenant_staff_role_check com ('admin','caixa','cozinha');
--   recriar as policies e funções abaixo das migrations 20261103000000 / 20261103010000 e
--   anteriores (checagem = 'caixa' / cash_can_write());
--   drop function if exists public.pode_vender();
-- =====================================================================

-- ---------------------------------------------------------------------
-- Papel aceito em tenant_staff
-- ---------------------------------------------------------------------
alter table public.tenant_staff drop constraint if exists tenant_staff_role_check;
alter table public.tenant_staff
  add constraint tenant_staff_role_check check (role in ('admin', 'caixa', 'garcom', 'cozinha'));

-- ---------------------------------------------------------------------
-- pode_vender(): quem grava venda (dono/admin, caixa, garçom)
-- ---------------------------------------------------------------------
create or replace function public.pode_vender()
returns boolean
language sql
stable
set search_path to ''
as $function$
  select public.is_admin_like() or public.current_staff_role() in ('caixa', 'garcom');
$function$;

revoke all on function public.pode_vender() from public, anon;
grant execute on function public.pode_vender() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- app_data: garçom igual ao caixa
-- ---------------------------------------------------------------------
drop policy if exists app_data_select_por_papel on public.app_data;
create policy app_data_select_por_papel
  on public.app_data
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) in ('caixa', 'garcom')
        and public.app_data_key_class(key) in ('catalogo','pedidos','operacional')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) in ('catalogo','pedidos')
      )
    )
  );

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
        (select public.current_staff_role()) in ('caixa', 'garcom')
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
        (select public.current_staff_role()) in ('caixa', 'garcom')
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
        (select public.current_staff_role()) in ('caixa', 'garcom')
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
-- members: garçom só lê (insert/update continuam owner/admin/caixa)
-- ---------------------------------------------------------------------
drop policy if exists members_select_por_papel on public.members;
create policy members_select_por_papel
  on public.members
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','garcom')
  );

-- ---------------------------------------------------------------------
-- orders: garçom lê, cria e move pedido
-- ---------------------------------------------------------------------
drop policy if exists orders_select_por_papel on public.orders;
create policy orders_select_por_papel
  on public.orders
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','garcom','cozinha')
  );

drop policy if exists orders_insert_por_papel on public.orders;
create policy orders_insert_por_papel
  on public.orders
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','garcom','cozinha')
  );

drop policy if exists orders_update_por_papel on public.orders;
create policy orders_update_por_papel
  on public.orders
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','garcom','cozinha')
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','garcom','cozinha')
  );

-- ---------------------------------------------------------------------
-- print_jobs: garçom lê e cria ficha
-- ---------------------------------------------------------------------
drop policy if exists print_jobs_select_por_papel on public.print_jobs;
create policy print_jobs_select_por_papel
  on public.print_jobs
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','garcom')
  );

drop policy if exists print_jobs_insert_por_papel on public.print_jobs;
create policy print_jobs_insert_por_papel
  on public.print_jobs
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','garcom')
  );

-- ---------------------------------------------------------------------
-- sales e nfce_notas: garçom lê
-- ---------------------------------------------------------------------
drop policy if exists sales_select_por_papel on public.sales;
create policy sales_select_por_papel
  on public.sales
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.pode_vender())
  );

drop policy if exists nfce_notas_select_por_papel on public.nfce_notas;
create policy nfce_notas_select_por_papel
  on public.nfce_notas
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.pode_vender())
  );

-- ---------------------------------------------------------------------
-- Funções (corpo atual do banco; muda a checagem de papel)
-- ---------------------------------------------------------------------
create or replace function public.sales_apply(p_upserts jsonb, p_delete_ids jsonb, p_bases jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_tenant is null or not public.pode_vender() then
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
  -- 08/11 (pedido do dono): garçom não grava venda com pagamento 'fiado' (mesmo critério do
  -- close_sale e do methodBucket do site). Sem isso ele fecharia a comanda em fiado por aqui,
  -- sem lançamento no sócio. Venda fechada em dinheiro/cartão/pix continua passando.
  if public.current_staff_role() = 'garcom'
     and exists (select 1 from jsonb_array_elements(v_up) x,
                       jsonb_array_elements(case when jsonb_typeof(x->'payments') = 'array'
                                                 then x->'payments' else '[]'::jsonb end) p
                  where p->>'method' = 'fiado') then
    raise exception 'garcom nao fecha fiado' using errcode = '42501';
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
$function$
;

create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb, p_debt_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant text;
  v_result jsonb;
  v_current jsonb;
  v_sale jsonb;
  v_debt jsonb := coalesce(p_debt_entries, '[]'::jsonb);
  v_garcom boolean := public.current_staff_role() = 'garcom';
  v_credito numeric;
begin
  if not public.pode_vender() then
    raise exception 'sem permissao para fechar venda';
  end if;

  -- 08/11 (pedido do dono): garçom não fecha fiado nem recebe pendência do sócio. O único
  -- lançamento aceito dele é o uso de crédito desta venda, como o finalizeSale do site monta
  -- (vendas/pagamento.js): id '<venda>-credito', type 'debt', sale_id da própria venda.
  -- Valor e sócio são conferidos mais abaixo, depois do recibo (nova tentativa não é recusada).
  if v_garcom and (
       jsonb_typeof(v_debt) <> 'array'
       or jsonb_array_length(v_debt) > 1
       or exists (select 1 from jsonb_array_elements(v_debt) e
                   where jsonb_typeof(e) <> 'object'
                      or e->>'id' is distinct from p_sale_id || '-credito'
                      or e->>'type' is distinct from 'debt'
                      or coalesce(nullif(e->>'sale_id', ''), p_sale_id) is distinct from p_sale_id)) then
    raise exception 'garcom nao fecha fiado' using errcode = '42501';
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

  -- M9: lançamentos do sócio validados antes de gravar qualquer coisa.
  if jsonb_typeof(v_debt) <> 'array' or jsonb_array_length(v_debt) > 20 then
    raise exception 'lancamentos de fiado invalidos';
  end if;
  if exists (select 1 from jsonb_array_elements(v_debt) e
              where jsonb_typeof(e) <> 'object'
                 or coalesce(e->>'id', '') = '' or coalesce(e->>'member_id', '') = ''
                 or coalesce(e->>'type', '') not in ('debt', 'payment')
                 or jsonb_typeof(e->'value') <> 'number' or (e->>'value')::numeric <= 0) then
    raise exception 'lancamento de fiado invalido';
  end if;
  if exists (select 1 from jsonb_array_elements(v_debt) e
              where not exists (select 1 from public.members m where m.id = e->>'member_id' and m.tenant_id = v_tenant)) then
    raise exception 'socio do lancamento nao encontrado';
  end if;

  insert into public.sale_close_receipts (tenant_id, sale_id)
  values (v_tenant, p_sale_id)
  on conflict (tenant_id, sale_id) do nothing;

  select result into v_result
    from public.sale_close_receipts
   where tenant_id = v_tenant and sale_id = p_sale_id
   for update;

  if v_result is not null then
    return v_result; -- retry idempotente: ja foi processado (com os lancamentos), nao repete
  end if;

  select data into v_current
    from public.sales
   where tenant_id = v_tenant and id = p_sale_id and deleted_at is null
   for update;

  -- A4 (20261103000000): venda ja fechada sem recibo so e regravada por dono/admin.
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

  -- 08/11 (pedido do dono): nem pagamento 'fiado' sem lançamento. Mesmo critério do
  -- methodBucket do site (assets/js/core/config.js): só method = 'fiado' cai no grupo fiado.
  -- Confere a venda já juntada, para pegar também os pagamentos que vieram da venda gravada.
  if v_garcom
     and exists (select 1 from jsonb_array_elements(
                   case when jsonb_typeof(v_sale->'payments') = 'array' then v_sale->'payments' else '[]'::jsonb end) p
                  where p->>'method' = 'fiado') then
    raise exception 'garcom nao fecha fiado' using errcode = '42501';
  end if;

  -- 08/11 (pedido do dono): o uso de crédito do garçom só consome crédito que o sócio da venda
  -- já tem (members.debt negativo = crédito, como memberAvailableCredit no site). Nunca cria
  -- nem aumenta dívida.
  if v_garcom and jsonb_array_length(v_debt) = 1 then
    if (v_debt->0->>'member_id') is distinct from (v_sale->>'memberId') then
      raise exception 'garcom nao fecha fiado' using errcode = '42501';
    end if;
    select greatest(0, -coalesce(m.debt, 0)) into v_credito
      from public.members m
     where m.id = v_debt->0->>'member_id' and m.tenant_id = v_tenant
       for update;
    if coalesce(v_credito, 0) + 0.005 < (v_debt->0->>'value')::numeric then
      raise exception 'garcom nao fecha fiado' using errcode = '42501';
    end if;
  end if;

  insert into public.sales as s (tenant_id, id, data)
  values (v_tenant, p_sale_id, v_sale)
  on conflict (tenant_id, id) do update
    set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;

  -- M9: fiado/crédito da venda na mesma transação. O gatilho recalc_member_debt atualiza a dívida.
  insert into public.member_debt_entries (id, tenant_id, member_id, type, value, reason, info, method, sale_id, created_by, at)
  select e->>'id', v_tenant, e->>'member_id', e->>'type', (e->>'value')::numeric,
         nullif(e->>'reason', ''), nullif(e->>'info', ''), nullif(e->>'method', ''),
         coalesce(nullif(e->>'sale_id', ''), p_sale_id), nullif(e->>'created_by', ''),
         coalesce((e->>'at')::timestamptz, now())
    from jsonb_array_elements(v_debt) e
  on conflict (id) do nothing;

  update public.sale_close_receipts
     set result = v_sale
   where tenant_id = v_tenant and sale_id = p_sale_id;

  return v_sale;
end;
$function$
;

create or replace function public.next_order_number(p_start integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant text;
  v_next integer;
begin
  if not public.pode_vender() then
    raise exception 'sem permissao para gerar numero de pedido';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:orderCounter', to_jsonb(greatest(0, p_start - 1) + 1))
  on conflict (tenant_id, key) do update
    set value = to_jsonb(
          greatest(
            coalesce((public.app_data.value)::text::integer, 0),
            p_start - 1
          ) + 1
        ),
        updated_at = now()
  returning (value)::text::integer into v_next;

  return v_next;
end;
$function$
;

create or replace function public.consume_insumos(p_consumptions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant text;
  v_insumos jsonb;
  v_key text;
  v_qty numeric;
  v_idx int;
  v_stock numeric;
  v_missing text[] := '{}';
  v_movements jsonb := '[]'::jsonb;
begin
  if not public.pode_vender() then
    raise exception 'sem permissao para baixar estoque';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_consumptions is null or jsonb_typeof(p_consumptions) <> 'object' or p_consumptions = '{}'::jsonb then
    return '[]'::jsonb;
  end if;

  -- Quantidade tem que ser numero > 0. Negativo aqui somaria ao estoque.
  if exists (
    select 1 from jsonb_each(p_consumptions) as e(key, value)
     where jsonb_typeof(e.value) <> 'number' or (e.value)::text::numeric < 0
  ) then
    raise exception 'quantidade invalida em p_consumptions';
  end if;

  perform 1 from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos'
   for update;

  select coalesce(value, '[]'::jsonb) into v_insumos
    from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  -- 1a passada: confere se da pra atender TUDO antes de mexer em qualquer coisa.
  for v_key, v_qty in
    select e.key, e.value::numeric from jsonb_each_text(p_consumptions) as e(key, value)
     where e.value::numeric > 0
  loop
    select (t.ord - 1) into v_idx
      from jsonb_array_elements(v_insumos) with ordinality as t(elem, ord)
     where t.elem->>'id' = v_key;

    if v_idx is null or coalesce((v_insumos -> v_idx ->> 'stock')::numeric, 0) < v_qty - 1e-9 then
      v_missing := array_append(v_missing, v_key);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'estoque insuficiente para: %', array_to_string(v_missing, ', ');
  end if;

  -- 2a passada: desconta de verdade, ja sabendo que da pra atender tudo.
  for v_key, v_qty in
    select e.key, e.value::numeric from jsonb_each_text(p_consumptions) as e(key, value)
     where e.value::numeric > 0
  loop
    select (t.ord - 1) into v_idx
      from jsonb_array_elements(v_insumos) with ordinality as t(elem, ord)
     where t.elem->>'id' = v_key;

    v_stock := coalesce((v_insumos -> v_idx ->> 'stock')::numeric, 0);
    v_movements := v_movements || jsonb_build_object(
      'insumoId', v_key, 'before', v_stock, 'qty', v_qty, 'after', v_stock - v_qty
    );
    v_insumos := jsonb_set(v_insumos, array[v_idx::text, 'stock'], to_jsonb(v_stock - v_qty));
  end loop;

  if jsonb_array_length(v_movements) = 0 then
    return v_movements; -- so tinha qty 0: nada a gravar
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:insumos', v_insumos)
  on conflict (tenant_id, key) do update
    set value = excluded.value, updated_at = now();

  return v_movements;
end;
$function$
;

create or replace function public.restore_insumos(p_consumptions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant text;
  v_insumos jsonb;
  v_key text;
  v_qty numeric;
  v_idx int;
  v_stock numeric;
  v_movements jsonb := '[]'::jsonb;
begin
  if not public.pode_vender() then
    raise exception 'sem permissao para devolver estoque';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_consumptions is null or jsonb_typeof(p_consumptions) <> 'object' or p_consumptions = '{}'::jsonb then
    return '[]'::jsonb;
  end if;

  if exists (
    select 1 from jsonb_each(p_consumptions) as e(key, value)
     where jsonb_typeof(e.value) <> 'number' or (e.value)::text::numeric < 0
  ) then
    raise exception 'quantidade invalida em p_consumptions';
  end if;

  perform 1 from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos'
   for update;

  select value into v_insumos
    from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  if v_insumos is null or jsonb_typeof(v_insumos) <> 'array' then
    return '[]'::jsonb; -- tenant sem cadastro de insumos: nada a devolver
  end if;

  for v_key, v_qty in
    select e.key, e.value::numeric from jsonb_each_text(p_consumptions) as e(key, value)
     where e.value::numeric > 0
  loop
    select (t.ord - 1) into v_idx
      from jsonb_array_elements(v_insumos) with ordinality as t(elem, ord)
     where t.elem->>'id' = v_key;

    if v_idx is null then
      continue; -- insumo removido do cadastro depois do consumo original: nada a devolver aqui
    end if;

    v_stock := coalesce((v_insumos -> v_idx ->> 'stock')::numeric, 0);
    v_movements := v_movements || jsonb_build_object(
      'insumoId', v_key, 'before', v_stock, 'qty', v_qty, 'after', v_stock + v_qty
    );
    v_insumos := jsonb_set(v_insumos, array[v_idx::text, 'stock'], to_jsonb(v_stock + v_qty));
  end loop;

  if jsonb_array_length(v_movements) = 0 then
    return v_movements;
  end if;

  update public.app_data
     set value = v_insumos, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  return v_movements;
end;
$function$
;

create or replace function public.print_job_resolve(p_job_id uuid, p_action text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant text := public.current_tenant_id();
  v_by text := nullif(left(coalesce(p_by, ''), 120), '');
  v_job public.print_jobs%rowtype;
  v_stale boolean;
begin
  if v_tenant is null or coalesce(public.current_staff_role(), '') not in ('owner', 'admin', 'caixa', 'garcom') then
    raise exception 'Só o caixa, o garçom ou o administrador mexe na fila de impressão.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('reenviar', 'descartar') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  select * into v_job from public.print_jobs
   where id = p_job_id and tenant_id = v_tenant
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'nao_encontrada');
  end if;

  -- 'processando' parado: o agente pegou a ficha e não respondeu (fechado no meio).
  v_stale := v_job.status = 'processando' and v_job.created_at < now() - interval '2 minutes';

  if p_action = 'reenviar' then
    if not (v_job.status in ('erro', 'descartado') or v_stale) then
      return jsonb_build_object('ok', false, 'reason', 'status', 'status', v_job.status);
    end if;
    update public.print_jobs
       set status = 'pendente', error = null, printed_at = null, created_at = now()
     where id = v_job.id;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, 'Ficha reenviada para a impressora: ' || v_job.printer_name, 'print_job', v_job.id::text,
            jsonb_build_object('status_anterior', v_job.status, 'criada_em', v_job.created_at, 'ip', v_job.printer_ip));
  else
    if not (v_job.status in ('pendente', 'erro') or v_stale) then
      return jsonb_build_object('ok', false, 'reason', 'status', 'status', v_job.status);
    end if;
    update public.print_jobs
       set status = 'descartado', printed_at = now(),
           error = left('Descartada no Commandah' || coalesce(' por ' || v_by, ''), 300)
     where id = v_job.id;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, 'Ficha descartada da fila de impressão: ' || v_job.printer_name, 'print_job', v_job.id::text,
            jsonb_build_object('status_anterior', v_job.status, 'criada_em', v_job.created_at, 'ip', v_job.printer_ip));
  end if;
  return jsonb_build_object('ok', true);
end;
$function$
;

