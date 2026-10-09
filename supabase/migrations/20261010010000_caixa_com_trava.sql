-- =====================================================================
-- 20261010010000_caixa_com_trava.sql — BD-03 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- O caixa vive em três blobs de app_data (cantina2:cashSession, cashHistory e
-- cashMovements) e cada aparelho regrava o blob INTEIRO. O dono confirmou que
-- mais de um aparelho opera o caixa, então:
--   - dois aparelhos abrindo o caixa: o segundo apaga a sessão do primeiro;
--   - um aparelho fechando um caixa que outro já fechou: o histórico do outro
--     some (cashHistory regravado com a cópia velha);
--   - dois lançamentos ao mesmo tempo (sangria num, pagamento parcial no outro):
--     o último a gravar apaga o lançamento do primeiro e o fechamento não bate.
--
-- A SOLUCAO
-- ---------
-- Três funções que travam a linha (select ... for update) antes de mexer:
--   cash_session_open(p_session)            abre só se não houver caixa aberto;
--                                           se houver, devolve o que está aberto.
--   cash_session_close(p_session_id, p_closed)
--                                           fecha só se a sessão aberta ainda for
--                                           essa; põe o fechamento no histórico
--                                           sem regravar os fechamentos dos outros.
--   cash_movements_apply(p_upserts, p_delete_ids)
--                                           aplica só o que ESTE aparelho mudou
--                                           (novos/editados e apagados) sobre a
--                                           lista atual do servidor e devolve a
--                                           lista completa.
-- Quem pode: dono/admin e caixa (mesmo grupo que já grava esses blobs hoje).
-- O caminho antigo (upsert direto em app_data) continua aceito pela RLS: versões
-- antigas do site abertas em algum aparelho seguem funcionando até recarregar.
--
-- RETESTE: abrir o caixa no aparelho A e, sem recarregar o B, tentar abrir no B
-- -> o B mostra "o caixa já foi aberto em outro aparelho" e passa a usar o do A.
-- Lançar uma saída no A e uma entrada no B ao mesmo tempo -> as duas ficam.
-- =====================================================================

create or replace function public.cash_can_write()
returns boolean
language sql
stable
set search_path to ''
as $function$
  select public.is_admin_like() or public.current_staff_role() = 'caixa';
$function$;
revoke all on function public.cash_can_write() from public, anon;
grant execute on function public.cash_can_write() to authenticated;

-- Valor de app_data que representa "vazio": null de verdade ou o marcador
-- {"__commandahNull": true} que o site grava porque a coluna é NOT NULL.
create or replace function public.app_data_is_null(p_value jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_value is null or jsonb_typeof(p_value) = 'null'
      or (jsonb_typeof(p_value) = 'object' and coalesce((p_value ->> '__commandahNull')::boolean, false));
$function$;
revoke all on function public.app_data_is_null(jsonb) from public, anon;
grant execute on function public.app_data_is_null(jsonb) to authenticated;

create or replace function public.cash_session_open(p_session jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_current jsonb;
  v_history jsonb;
  v_session jsonb;
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para abrir o caixa';
  end if;
  if p_session is null or jsonb_typeof(p_session) <> 'object' or coalesce(p_session->>'id', '') = '' then
    raise exception 'sessao de caixa invalida';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:cashSession', '{"__commandahNull": true}'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_current from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashSession'
   for update;

  if not public.app_data_is_null(v_current) and coalesce(v_current->>'status', 'open') = 'open' then
    return jsonb_build_object('ok', false, 'session', v_current);
  end if;

  select value into v_history from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashHistory';

  v_session := p_session || jsonb_build_object(
    'status', 'open',
    'openedAt', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'displayId', case when jsonb_typeof(v_history) = 'array' then jsonb_array_length(v_history) + 1 else 1 end
  );

  update public.app_data set value = v_session, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:cashSession';

  return jsonb_build_object('ok', true, 'session', v_session);
end;
$function$;
revoke all on function public.cash_session_open(jsonb) from public, anon;
grant execute on function public.cash_session_open(jsonb) to authenticated;

create or replace function public.cash_session_close(p_session_id text, p_closed jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_current jsonb;
  v_history jsonb;
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para fechar o caixa';
  end if;
  if p_closed is null or jsonb_typeof(p_closed) <> 'object' or p_closed->>'id' is distinct from p_session_id then
    raise exception 'fechamento de caixa invalido';
  end if;

  select value into v_current from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashSession'
   for update;

  if v_current is null or public.app_data_is_null(v_current) or v_current->>'id' is distinct from p_session_id then
    return jsonb_build_object('ok', false, 'session', case when public.app_data_is_null(v_current) then null else v_current end);
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:cashHistory', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_history from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashHistory'
   for update;
  if jsonb_typeof(v_history) <> 'array' then
    v_history := '[]'::jsonb;
  end if;

  -- Já está no histórico (tentativa repetida): não duplica.
  if not exists (select 1 from jsonb_array_elements(v_history) e where e->>'id' = p_session_id) then
    v_history := jsonb_build_array(p_closed) || v_history;
    update public.app_data set value = v_history, updated_at = now()
     where tenant_id = v_tenant and key = 'cantina2:cashHistory';
  end if;

  update public.app_data set value = '{"__commandahNull": true}'::jsonb, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:cashSession';

  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.cash_session_close(text, jsonb) from public, anon;
grant execute on function public.cash_session_close(text, jsonb) to authenticated;

create or replace function public.cash_movements_apply(p_upserts jsonb, p_delete_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_list jsonb;
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_del jsonb := coalesce(p_delete_ids, '[]'::jsonb);
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para lancar no caixa';
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_del) <> 'array'
     or jsonb_array_length(v_up) > 200 or jsonb_array_length(v_del) > 200 then
    raise exception 'lancamentos invalidos';
  end if;
  if exists (select 1 from jsonb_array_elements(v_up) e
              where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') = '') then
    raise exception 'lancamento sem id';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:cashMovements', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_list from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashMovements'
   for update;
  if jsonb_typeof(v_list) <> 'array' then
    v_list := '[]'::jsonb;
  end if;

  -- Editado continua na mesma posição; novo entra no topo (como o unshift do site).
  select coalesce(jsonb_agg(coalesce(
           (select u from jsonb_array_elements(v_up) u where u->>'id' = m.elem->>'id' limit 1),
           m.elem) order by m.ord), '[]'::jsonb)
    into v_list
    from jsonb_array_elements(v_list) with ordinality as m(elem, ord)
   where not coalesce(m.elem->>'id' = any(array(select jsonb_array_elements_text(v_del))), false);

  v_list := coalesce((select jsonb_agg(u order by n.ord)
                        from jsonb_array_elements(v_up) with ordinality as n(u, ord)
                       where not exists (select 1 from jsonb_array_elements(v_list) m where m->>'id' = u->>'id')), '[]'::jsonb)
            || v_list;

  update public.app_data set value = v_list, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:cashMovements';

  return v_list;
end;
$function$;
revoke all on function public.cash_movements_apply(jsonb, jsonb) from public, anon;
grant execute on function public.cash_movements_apply(jsonb, jsonb) to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.cash_movements_apply(jsonb, jsonb);
-- drop function if exists public.cash_session_close(text, jsonb);
-- drop function if exists public.cash_session_open(jsonb);
-- drop function if exists public.app_data_is_null(jsonb);
-- drop function if exists public.cash_can_write();
