-- =====================================================================
-- COMMANDAH — restore_insumos: RPC pro estorno de estoque quando um item
-- já lançado (e já enviado pra cozinha) é cancelado por engano de digitação.
-- Data: 2026-09-20
-- =====================================================================
--
-- CONTEXTO
-- --------
-- O índice permite cancelar um item já enviado direto na comanda
-- (renderComandaAuditHistory / openCancelComandaItem / confirmCancelComandaItem
-- em index.html) quando o lançamento foi feito errado. O usuário confirmou
-- que o cancelamento deve devolver o insumo consumido ao estoque, pode
-- acontecer a qualquer momento (não trava por status do pedido na cozinha —
-- não há integração com o monitor de cozinha) e o motivo é opcional.
--
-- Esta RPC espelha consume_insumos (Fase 2b, mesma trava SECURITY DEFINER +
-- checagem de papel + lock de linha), só que soma em vez de subtrair. Não
-- existe checagem de "estoque insuficiente" porque devolver insumo nunca
-- fica negativo.
-- =====================================================================

create or replace function public.restore_insumos(p_consumptions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_insumos jsonb;
  v_key text;
  v_qty numeric;
  v_idx int;
  v_stock numeric;
  v_movements jsonb := '[]'::jsonb;
begin
  if not (public.is_admin_like() or public.current_staff_role() = 'caixa') then
    raise exception 'sem permissao para devolver estoque';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_consumptions is null or p_consumptions = '{}'::jsonb then
    return '[]'::jsonb;
  end if;

  perform 1 from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos'
   for update;

  select coalesce(value, '[]'::jsonb) into v_insumos
    from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  for v_key, v_qty in
    select e.key, e.value::numeric from jsonb_each_text(p_consumptions) as e(key, value)
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

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:insumos', v_insumos)
  on conflict (tenant_id, key) do update
    set value = excluded.value, updated_at = now();

  return v_movements;
end;
$$;

revoke all on function public.restore_insumos(jsonb) from public;
grant execute on function public.restore_insumos(jsonb) to authenticated;
