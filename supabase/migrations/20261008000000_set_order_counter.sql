-- =====================================================================
-- 20261008000000_set_order_counter.sql — BD-04 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- O numero do pedido e gerado de forma atomica por next_order_number(), mas
-- as telas de Configuracoes do admin ainda gravavam cantina2:orderCounter
-- inteiro a partir do valor que o aparelho tinha na memoria (ate 6 s velho):
--   - "Outras configuracoes" regravava o contador TODA vez que salvava,
--     mesmo sem mexer no campo "Proximo numero";
--   - "Numeracao de Pedidos" subia o contador para o inicio configurado.
-- Com o salao funcionando, o caixa ja tinha avancado o contador no servidor e
-- o admin voltava o numero para tras: pedidos com numero repetido.
--
-- A SOLUCAO
-- ---------
-- set_order_counter(p_value, p_force): so owner/admin. Grava o contador numa
-- unica instrucao (atomica, igual next_order_number):
--   - p_force = false: so SOBE (greatest(atual, p_value)) — nunca volta.
--   - p_force = true : grava exatamente p_value — usado quando o admin edita o
--     campo de proposito ou clica em "Reiniciar numeracao".
-- p_value e o ULTIMO numero usado (o proximo pedido sera p_value + 1), o mesmo
-- significado de cantina2:orderCounter.
--
-- Nao muda RLS nem o next_order_number. O index.html continua funcionando com
-- ou sem esta migration ate o deploy do site novo; o site novo precisa dela
-- (sem a funcao, salvar a numeracao mostra erro e nao grava).
--
-- RETESTE (pelo app, logado como dono; a funcao depende de auth.uid(), entao
-- nao da para testar pelo SQL Editor): Configuracoes > Outras configuracoes > Salvar sem mexer no
-- "Proximo numero" -> o contador nao muda; editar para um numero maior ->
-- muda; "Reiniciar numeracao" -> volta para #1. Caixa/cozinha chamando a
-- funcao -> erro 'sem permissao'.
-- =====================================================================

create or replace function public.set_order_counter(p_value integer, p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_value integer;
begin
  if not public.is_admin_like() then
    raise exception 'sem permissao para alterar a numeracao de pedidos';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'numero invalido';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:orderCounter', to_jsonb(p_value))
  on conflict (tenant_id, key) do update
    set value = to_jsonb(
          case when p_force then p_value
               else greatest(coalesce((public.app_data.value)::text::integer, 0), p_value)
          end
        ),
        updated_at = now()
  returning (value)::text::integer into v_value;

  return v_value;
end;
$$;

revoke all on function public.set_order_counter(integer, boolean) from public, anon;
grant execute on function public.set_order_counter(integer, boolean) to authenticated, service_role;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.set_order_counter(integer, boolean);
