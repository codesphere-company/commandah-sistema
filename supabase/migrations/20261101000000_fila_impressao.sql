-- =====================================================================
-- t215 (01/11/2026): tela "Fila de impressão" (Configurações › Impressoras)
--
-- Por quê: no teste do caixa 2 o aviso dizia "1 pedido não saiu na impressora",
-- mas não havia onde ver qual ficha era nem o que fazer com ela. Ler a fila não
-- precisa de nada novo (print_jobs_select_por_papel já deixa owner/admin/caixa
-- ler). Mudar o status precisa: print_jobs não tem policy de UPDATE de propósito
-- (quem muda status é o agente, pelas RPCs print_agent_*).
--
-- O que muda:
--   * print_jobs.status aceita 'descartado' (ficha que alguém tirou da fila no
--     Commandah). O agente busca e pega só 'pendente', e print_agent_mark_status
--     só mexe em 'pendente'/'processando', então ficha descartada não imprime e
--     não é sobrescrita.
--   * print_job_resolve(p_job_id, p_action, p_by): owner/admin/caixa.
--       'reenviar'  — volta para 'pendente' (de 'erro', 'descartado' ou
--                     'processando' parado há mais de 2 min). created_at vira
--                     agora, para o aviso de fila travada contar do reenvio.
--       'descartar' — de 'pendente', 'erro' ou 'processando' parado há mais de
--                     2 min para 'descartado'.
--     'processando' recente fica de fora: o agente pode estar imprimindo agora,
--     e mexer nela imprimiria duas vezes. Tudo vai para o audit_log.
-- Nenhuma assinatura existente muda: agente 2.0 a 2.3 e o site antigo seguem iguais.
--
-- Desfazer:
--   drop function if exists public.print_job_resolve(uuid, text, text);
--   update public.print_jobs set status = 'erro' where status = 'descartado';
--   alter table public.print_jobs drop constraint if exists print_jobs_status_check;
--   alter table public.print_jobs add constraint print_jobs_status_check
--     check (status = any (array['pendente'::text, 'processando'::text, 'impresso'::text, 'erro'::text])) not valid;
-- =====================================================================

alter table public.print_jobs drop constraint if exists print_jobs_status_check;
alter table public.print_jobs
  add constraint print_jobs_status_check
  check (status = any (array['pendente'::text, 'processando'::text, 'impresso'::text, 'erro'::text, 'descartado'::text]))
  not valid;

create or replace function public.print_job_resolve(p_job_id uuid, p_action text, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_by text := nullif(left(coalesce(p_by, ''), 120), '');
  v_job public.print_jobs%rowtype;
  v_stale boolean;
begin
  if v_tenant is null or coalesce(public.current_staff_role(), '') not in ('owner', 'admin', 'caixa') then
    raise exception 'Só o caixa ou o administrador mexe na fila de impressão.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('reenviar', 'descartar') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  select * into v_job from public.print_jobs
   where id = p_job_id and tenant_id = v_tenant
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'nao_encontrada');
  end if;

  -- 'processando' parado: o agente pegou a ficha e não respondeu (fechado no meio).
  v_stale := v_job.status = 'processando' and v_job.created_at < now() - interval '2 minutes';

  if p_action = 'reenviar' then
    if not (v_job.status in ('erro', 'descartado') or v_stale) then
      return jsonb_build_object('ok', false, 'reason', 'status', 'status', v_job.status);
    end if;
    update public.print_jobs
       set status = 'pendente', error = null, printed_at = null, created_at = now()
     where id = v_job.id;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, 'Ficha reenviada para a impressora: ' || v_job.printer_name, 'print_job', v_job.id::text,
            jsonb_build_object('status_anterior', v_job.status, 'criada_em', v_job.created_at, 'ip', v_job.printer_ip));
  else
    if not (v_job.status in ('pendente', 'erro') or v_stale) then
      return jsonb_build_object('ok', false, 'reason', 'status', 'status', v_job.status);
    end if;
    update public.print_jobs
       set status = 'descartado', printed_at = now(),
           error = left('Descartada no Commandah' || coalesce(' por ' || v_by, ''), 300)
     where id = v_job.id;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, 'Ficha descartada da fila de impressão: ' || v_job.printer_name, 'print_job', v_job.id::text,
            jsonb_build_object('status_anterior', v_job.status, 'criada_em', v_job.created_at, 'ip', v_job.printer_ip));
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.print_job_resolve(uuid, text, text) from public, anon;
grant execute on function public.print_job_resolve(uuid, text, text) to authenticated, service_role;
