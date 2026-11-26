-- Cardápio digital (26/11/2026): o pedido do celular passa a valer 5 minutos (antes 3) para o caixa pegar.
-- Com a aba do sistema escondida no computador Caixa do app, o Chrome só deixa a fila ser olhada uma vez por
-- minuto; no primeiro pedido real ele levou 151 s. Mesma função de 20261127020000, só o prazo muda.
create or replace function public.cardapio_pedido_pegar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_row public.cardapio_pedidos%rowtype;
begin
  if v_tenant is null or public.current_staff_role() not in ('owner', 'admin', 'caixa') then
    raise exception 'sem permissao para pegar pedido do cardapio';
  end if;
  update public.cardapio_pedidos
     set status = 'processando', pego_em = now(), pego_por = coalesce(public.current_staff_id(), 'dono')
   where id = p_id and tenant_id = v_tenant and status = 'novo' and criado_em > now() - interval '5 minutes'
  returning * into v_row;
  if v_row.id is null then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$function$;
revoke all on function public.cardapio_pedido_pegar(uuid) from public, anon;
grant execute on function public.cardapio_pedido_pegar(uuid) to authenticated;

-- ROLLBACK: reaplicar cardapio_pedido_pegar de 20261127020000_cardapio_pedidos.sql (interval '3 minutes').
