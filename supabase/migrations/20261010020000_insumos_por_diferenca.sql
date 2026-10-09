-- =====================================================================
-- 20261010020000_insumos_por_diferenca.sql — BD-10 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- O cadastro de insumos (cantina2:insumos) é um blob regravado inteiro pelo site.
-- A venda baixa o estoque pelo servidor (consume_insumos), mas qualquer gravação
-- do cadastro feita por um aparelho com a lista velha (editar nome/custo, entrada
-- de estoque, NFe, ajuste de produto, cancelar delivery) regravava o estoque
-- antigo por cima e DESFAZIA as baixas feitas nesse meio-tempo.
--
-- A SOLUCAO
-- ---------
-- insumos_apply(p_upserts, p_deltas, p_delete_ids), com trava na linha:
--   - p_upserts: insumos novos (inteiros) e, dos existentes, só os campos que
--     ESTE aparelho mudou (dois aparelhos editando campos diferentes não se desfazem);
--   - p_deltas: {id: quanto o estoque mudou neste aparelho} (mais X, menos Y);
--   - p_delete_ids: insumos apagados.
-- Para insumo que já existe, o estoque final = estoque ATUAL do servidor + delta:
-- a baixa feita por outro aparelho é preservada. Insumo novo entra como veio.
-- Campo que o aparelho não mexeu fica como está no servidor. Item parcial (sem
-- "name") de insumo que já não existe no servidor é ignorado.
-- Devolve a lista completa. Mesmo grupo que já grava o blob: dono/admin e caixa.
--
-- RETESTE: abrir Insumos num aparelho; em outro, vender um item com ficha técnica;
-- voltar ao primeiro e editar o custo de um insumo dessa ficha -> o estoque fica
-- com a baixa da venda (antes voltava ao número antigo).
-- =====================================================================

create or replace function public.jsonb_num(p jsonb)
returns numeric
language sql
immutable
set search_path to ''
as $function$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric else 0 end;
$function$;
revoke all on function public.jsonb_num(jsonb) from public, anon;
grant execute on function public.jsonb_num(jsonb) to authenticated;

create or replace function public.insumos_apply(p_upserts jsonb, p_deltas jsonb, p_delete_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_list jsonb;
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_deltas jsonb := coalesce(p_deltas, '{}'::jsonb);
  v_del jsonb := coalesce(p_delete_ids, '[]'::jsonb);
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para gravar insumos';
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_del) <> 'array' or jsonb_typeof(v_deltas) <> 'object'
     or jsonb_array_length(v_up) > 1000 or jsonb_array_length(v_del) > 1000 then
    raise exception 'insumos invalidos';
  end if;
  if exists (select 1 from jsonb_array_elements(v_up) e
              where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') = '') then
    raise exception 'insumo sem id';
  end if;
  if exists (select 1 from jsonb_each(v_deltas) d where jsonb_typeof(d.value) <> 'number') then
    raise exception 'delta de estoque invalido';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:insumos', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_list from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos'
   for update;
  if jsonb_typeof(v_list) <> 'array' then
    v_list := '[]'::jsonb;
  end if;

  -- Existentes: apagado sai; editado recebe os campos novos e estoque = atual + delta.
  select coalesce(jsonb_agg(
           case when u.x is null then m.elem
                else m.elem || (u.x - 'stock') || jsonb_build_object('stock',
                       public.jsonb_num(m.elem->'stock') + public.jsonb_num(v_deltas->(m.elem->>'id')))
           end order by m.ord), '[]'::jsonb)
    into v_list
    from jsonb_array_elements(v_list) with ordinality as m(elem, ord)
    left join lateral (select x from jsonb_array_elements(v_up) x where x->>'id' = m.elem->>'id' limit 1) u on true
   where not coalesce(m.elem->>'id' = any(array(select jsonb_array_elements_text(v_del))), false);

  -- Novos: entram no fim, como o push do site.
  v_list := v_list || coalesce((select jsonb_agg(n.x order by n.ord)
                                  from jsonb_array_elements(v_up) with ordinality as n(x, ord)
                                 where n.x ? 'name'
                                   and not exists (select 1 from jsonb_array_elements(v_list) e where e->>'id' = n.x->>'id')), '[]'::jsonb);

  update public.app_data set value = v_list, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  return v_list;
end;
$function$;
revoke all on function public.insumos_apply(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.insumos_apply(jsonb, jsonb, jsonb) to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.insumos_apply(jsonb, jsonb, jsonb);
-- drop function if exists public.jsonb_num(jsonb);
