-- =====================================================================
-- 20261011030000_print_agent_ping.sql — agente de impressão novo (OPS-12)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- print_agent_fetch_pending devolve lista vazia tanto para "fila vazia" quanto
-- para "token errado". O agente não tinha como avisar que o token está errado
-- (foi o que aconteceu de 29/08 a 10/10: token regenerado, agente antigo calado).
--
-- A SOLUCAO
-- ---------
-- print_agent_ping(p_token): diz se o token vale e carimba last_seen_at (o mesmo
-- sinal de vida que o app lê em print_agent_status). Não devolve nada do tenant.
-- =====================================================================

create or replace function public.print_agent_ping(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id text;
begin
  if p_token is null or length(p_token) = 0 then
    return jsonb_build_object('ok', false);
  end if;
  select tenant_id into v_tenant_id from public.print_agent_tokens
    where token_hash = extensions.digest(p_token, 'sha256');
  if v_tenant_id is null then
    return jsonb_build_object('ok', false);
  end if;
  perform public.print_agent_touch(v_tenant_id);
  return jsonb_build_object('ok', true, 'server_time', now());
end;
$function$;

revoke all on function public.print_agent_ping(text) from public;
grant execute on function public.print_agent_ping(text) to anon, authenticated, service_role;

-- ROLLBACK:
-- drop function if exists public.print_agent_ping(text);
