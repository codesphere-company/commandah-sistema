-- =====================================================================
-- 20261010000000_print_agent_heartbeat.sql — OP-19 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- Com o agente de impressão fechado, o pedido entra na fila (print_jobs) e o
-- papel nunca sai. O único sinal era o aviso de "fila travada", que só aparece
-- depois de 3 minutos e só se já houver pedido parado. Decisão do dono: com o
-- agente fora do ar, aviso vermelho fixo "Agente de impressão desconectado".
--
-- A SOLUCAO
-- ---------
-- O agente já chama print_agent_fetch_pending para buscar a fila. Essa chamada
-- passa a carimbar print_agent_tokens.last_seen_at (no máximo uma escrita a cada
-- 30 s, para não gravar a cada consulta). claim_job e mark_status também carimbam.
-- O app lê o carimbo por print_agent_status() (qualquer operador logado; devolve
-- só se existe agente configurado e quando ele foi visto, nunca o token).
-- O código do agente NÃO muda (ele nem está neste repositório, OPS-12).
--
-- RETESTE: com o agente aberto, select last_seen_at from print_agent_tokens
-- deve ficar a menos de 1 min de now(). Fechar o agente: em ~3 min o app mostra
-- "Agente de impressão desconectado"; abrir de novo: o aviso some sozinho.
-- =====================================================================

alter table public.print_agent_tokens add column if not exists last_seen_at timestamptz;

create or replace function public.print_agent_touch(p_tenant_id text)
returns void
language sql
security definer
set search_path to ''
as $function$
  update public.print_agent_tokens
     set last_seen_at = now()
   where tenant_id = p_tenant_id
     and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
$function$;
revoke all on function public.print_agent_touch(text) from public, anon, authenticated;

create or replace function public.print_agent_fetch_pending(p_token text)
returns setof public.print_jobs
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id text;
begin
  if p_token is null or length(p_token) = 0 then
    return;
  end if;
  select tenant_id into v_tenant_id from public.print_agent_tokens
    where token_hash = extensions.digest(p_token, 'sha256');
  if v_tenant_id is null then
    return;
  end if;
  perform public.print_agent_touch(v_tenant_id);
  return query
    select * from public.print_jobs
    where tenant_id = v_tenant_id and status = 'pendente'
    order by created_at asc;
end;
$function$;

create or replace function public.print_agent_mark_status(p_token text, p_job_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id text;
  v_updated int;
begin
  if p_status not in ('impresso', 'erro') then
    raise exception 'status inválido';
  end if;

  select tenant_id into v_tenant_id from public.print_agent_tokens
    where token_hash = extensions.digest(p_token, 'sha256');
  if v_tenant_id is null then
    return false;
  end if;
  perform public.print_agent_touch(v_tenant_id);

  update public.print_jobs
    set status = p_status, printed_at = now()
    where id = p_job_id and tenant_id = v_tenant_id
      and status in ('pendente', 'processando');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

create or replace function public.print_agent_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_row record;
begin
  if v_tenant is null or not (public.is_admin_like() or public.current_staff_role() is not null) then
    return null;
  end if;
  select last_seen_at into v_row from public.print_agent_tokens where tenant_id = v_tenant;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object('configured', true, 'last_seen_at', v_row.last_seen_at, 'now', now());
end;
$function$;
revoke all on function public.print_agent_status() from public, anon;
grant execute on function public.print_agent_status() to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Recriar print_agent_fetch_pending sem a linha "perform public.print_agent_touch",
-- print_agent_mark_status como em 20261009000000_print_mark_status_so_abertos.sql, e:
-- drop function if exists public.print_agent_status();
-- drop function if exists public.print_agent_touch(text);
-- alter table public.print_agent_tokens drop column if exists last_seen_at;
