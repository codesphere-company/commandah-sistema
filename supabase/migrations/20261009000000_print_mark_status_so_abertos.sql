-- =====================================================================
-- 20261009000000_print_mark_status_so_abertos.sql — SEG-11 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- print_agent_mark_status aceitava marcar como 'impresso' ou 'erro' qualquer job
-- do estabelecimento, inclusive um já finalizado: com o token do agente dava para
-- "reabrir" ou trocar o resultado de impressões antigas (confusão na fila e no
-- alerta de fila travada).
--
-- A SOLUCAO
-- ---------
-- O status só muda se o job ainda estiver aberto ('pendente' ou 'processando').
-- De propósito NÃO exige 'processando': o código do agente de impressão não está
-- neste repositório (OPS-12) e não há como confirmar que toda versão em uso chama
-- print_agent_claim_job antes de marcar. Exigir só 'processando' poderia parar a
-- impressão no clube. Job já 'impresso' ou 'erro' não muda mais.
--
-- RETESTE: mandar um pedido para a cozinha e conferir que a ficha sai e o job
-- vira 'impresso'. Rodar de novo o mesmo mark_status (mesmo job) -> retorna false.
-- =====================================================================

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

  update public.print_jobs
    set status = p_status, printed_at = now()
    where id = p_job_id and tenant_id = v_tenant_id
      and status in ('pendente', 'processando');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

-- =====================================================================
-- ROLLBACK (volta a aceitar qualquer status atual)
-- =====================================================================
-- create or replace function public.print_agent_mark_status(p_token text, p_job_id uuid, p_status text)
-- returns boolean language plpgsql security definer set search_path to '' as $function$
-- declare v_tenant_id text; v_updated int;
-- begin
--   if p_status not in ('impresso', 'erro') then raise exception 'status inválido'; end if;
--   select tenant_id into v_tenant_id from public.print_agent_tokens where token_hash = extensions.digest(p_token, 'sha256');
--   if v_tenant_id is null then return false; end if;
--   update public.print_jobs set status = p_status, printed_at = now() where id = p_job_id and tenant_id = v_tenant_id;
--   get diagnostics v_updated = row_count;
--   return v_updated > 0;
-- end; $function$;
