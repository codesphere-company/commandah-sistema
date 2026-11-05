-- =====================================================================
-- Auditoria de 03/11/2026 — Lote 4, parte do banco (relatório: https://claude.ai/artifact/F32qXRyzqgBX9YCAAkV9Bj)
--
-- M9  Fiado, uso de crédito e crédito de troco da venda entram na MESMA transação do fechamento.
--     Antes o site gravava esses lançamentos depois do close_sale; se a rede caísse no meio, a
--     venda ficava fechada sem o fiado (havia só um aviso para lançar à mão).
--     close_sale ganha uma versão com p_debt_entries (lista de lançamentos). A versão de 3
--     argumentos continua (site antigo) e chama a nova sem lançamentos. Os ids dos lançamentos
--     vêm do site e são fixos por venda: uma nova tentativa não duplica.
-- B9  Dependentes do sócio são gravados de uma vez (member_dependents_save). Antes o site apagava
--     e depois inseria; uma falha entre os dois apagava os dependentes.
--
-- Desfazer:
--   drop function if exists public.member_dependents_save(text, jsonb);
--   drop function if exists public.close_sale(text, boolean, jsonb, jsonb);
--   recriar close_sale(text, boolean, jsonb) da migration 20261103000000.
-- =====================================================================

create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb, p_debt_entries jsonb)
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
  v_debt jsonb := coalesce(p_debt_entries, '[]'::jsonb);
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
$function$;

revoke all on function public.close_sale(text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.close_sale(text, boolean, jsonb, jsonb) to authenticated, service_role;

-- Versão de 3 argumentos (site antigo): mesma regra, sem lançamentos.
create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.close_sale(p_sale_id, p_existing, p_sale_patch, null::jsonb);
$function$;


-- ---------------------------------------------------------------------
-- B9: dependentes do sócio de uma vez
-- ---------------------------------------------------------------------
create or replace function public.member_dependents_save(p_member_id text, p_dependents jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_deps jsonb := coalesce(p_dependents, '[]'::jsonb);
begin
  -- Mesmos papéis da policy member_dependents_por_papel.
  if v_tenant is null or coalesce(public.current_staff_role(), '') not in ('owner', 'admin', 'caixa') then
    raise exception 'sem permissao para gravar dependentes' using errcode = '42501';
  end if;
  if not exists (select 1 from public.members where id = p_member_id and tenant_id = v_tenant) then
    raise exception 'socio nao encontrado';
  end if;
  if jsonb_typeof(v_deps) <> 'array' or jsonb_array_length(v_deps) > 50 then
    raise exception 'dependentes invalidos';
  end if;
  if exists (select 1 from jsonb_array_elements(v_deps) d
              where jsonb_typeof(d) <> 'object' or coalesce(d->>'id', '') = '' or coalesce(trim(d->>'name'), '') = '') then
    raise exception 'dependente sem id ou sem nome';
  end if;

  delete from public.member_dependents where member_id = p_member_id and tenant_id = v_tenant;

  insert into public.member_dependents (id, tenant_id, member_id, name, relationship, document, can_order)
  select d->>'id', v_tenant, p_member_id, trim(d->>'name'), nullif(d->>'relationship', ''), nullif(d->>'document', ''),
         coalesce((d->>'can_order')::boolean, true)
    from jsonb_array_elements(v_deps) d;

  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id)
                     from public.member_dependents x where x.member_id = p_member_id and x.tenant_id = v_tenant), '[]'::jsonb);
end;
$function$;

revoke all on function public.member_dependents_save(text, jsonb) from public, anon;
grant execute on function public.member_dependents_save(text, jsonb) to authenticated, service_role;
