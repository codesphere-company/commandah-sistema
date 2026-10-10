-- =====================================================================
-- 20261011010000_reabrir_comanda.sql — reabrir comanda fechada
-- =====================================================================
-- A DECISAO (dono, 10/10)
-- -----------------------
-- Editar, transferir ou excluir comanda já fechada = REABRIR: só administrador,
-- digitando a própria senha, com motivo. A comanda volta a ficar aberta, os
-- pagamentos dela são desfeitos (o site estorna o fiado e lança a saída no
-- caixa) e ela é editada/transferida/cancelada como qualquer comanda aberta.
--
-- POR QUE PRECISA DO BANCO
-- ------------------------
-- close_sale é idempotente por venda (sale_close_receipts): fechar de novo a
-- mesma venda devolveria o resultado antigo guardado e não gravaria nada.
-- sale_reopen apaga esse recibo na mesma transação em que reabre a venda.
-- Também confere no servidor que quem reabre é admin/dono (o caixa grava
-- vendas por sales_apply, mas não reabre).
-- =====================================================================

create or replace function public.sale_reopen(p_sale_id text, p_total numeric, p_meta jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_data jsonb;
  v_entry jsonb;
  v_sale jsonb;
begin
  if v_tenant is null or not public.is_admin_like() then
    raise exception 'Só o administrador reabre comanda fechada.' using errcode = '42501';
  end if;
  if coalesce(p_sale_id, '') = '' or p_meta is null or jsonb_typeof(p_meta) <> 'object'
     or length(coalesce(p_meta->>'reason', '')) < 3 then
    raise exception 'reabertura inválida (informe o motivo)';
  end if;

  select data into v_data
    from public.sales
   where tenant_id = v_tenant and id = p_sale_id and deleted_at is null
   for update;
  if v_data is null then
    raise exception 'venda % não encontrada', p_sale_id;
  end if;
  if coalesce(v_data->>'status', '') <> 'closed' or coalesce((v_data->>'canceled')::boolean, false)
     or coalesce(v_data->>'type', '') <> 'comanda' then
    raise exception 'só comanda fechada (e não cancelada) pode ser reaberta';
  end if;

  v_entry := jsonb_build_object(
    'at', now(), 'by', p_meta->>'by', 'reason', p_meta->>'reason',
    'closedAt', v_data->'closedAt', 'payments', coalesce(v_data->'payments', '[]'::jsonb),
    'total', v_data->'total');

  -- Pagamentos parciais (OP-13) continuam valendo: ficam em partialPayments e
  -- voltam a entrar quando a comanda fechar de novo.
  v_sale := (v_data - 'closedAt' - 'creditApplied' - 'couponCode' - 'discount' - 'serviceCharge' - 'partialPaid')
    || jsonb_build_object(
         'status', 'open',
         'payments', '[]'::jsonb,
         'total', coalesce(p_total, (v_data->>'total')::numeric),
         'reopenHistory', coalesce(v_data->'reopenHistory', '[]'::jsonb) || jsonb_build_array(v_entry));

  update public.sales
     set data = v_sale, updated_at = now(), version = version + 1
   where tenant_id = v_tenant and id = p_sale_id;

  delete from public.sale_close_receipts where tenant_id = v_tenant and sale_id = p_sale_id;

  insert into public.audit_log (actor_name, action, entity, entity_id, meta)
  values (p_meta->>'by',
          'Comanda reaberta — pedido #' || coalesce(v_data->>'orderNumber', p_sale_id) || ' — motivo: ' || (p_meta->>'reason'),
          'sale', p_sale_id, v_entry);

  return v_sale;
end;
$function$;

revoke all on function public.sale_reopen(text, numeric, jsonb) from public, anon;
grant execute on function public.sale_reopen(text, numeric, jsonb) to authenticated;

-- ROLLBACK:
-- drop function if exists public.sale_reopen(text, numeric, jsonb);
