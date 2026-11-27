-- Cardápio digital (26/11/2026): trava de versão do aparelho que lança o pedido.
-- Um caixa com o sistema antigo pegou pedidos com opções (Coca NORMAL/ZERO) e recusou, porque a versão dele não
-- sabia lançar opções. Agora cada pedido diz a versão mínima do processador (requer) e só é pego por quem tem.
-- cardapio_pedido_pegar ganha p_versao (padrão 1): o sistema antigo chama só com p_id, fica com versão 1 e não
-- pega pedido que requer 2; outro aparelho atualizado pega. A função antiga (uuid) sai para não haver duas.
alter table public.cardapio_pedidos add column if not exists requer int not null default 1;

drop function if exists public.cardapio_pedido_pegar(uuid);
create or replace function public.cardapio_pedido_pegar(p_id uuid, p_versao int default 1)
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
     and requer <= coalesce(p_versao, 1)
  returning * into v_row;
  if v_row.id is null then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$function$;
revoke all on function public.cardapio_pedido_pegar(uuid, int) from public, anon;
grant execute on function public.cardapio_pedido_pegar(uuid, int) to authenticated;

-- ROLLBACK: drop function public.cardapio_pedido_pegar(uuid, int); reaplicar a de 20261127030000; alter table ... drop column requer.
