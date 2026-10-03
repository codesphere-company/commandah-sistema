-- =====================================================================
-- 20261002000000 — Hardening de GRANTs de tabela (defesa em profundidade)
-- =====================================================================
-- Auditoria de segurança de 2026-10-02. NÃO APLICADA — rodar pelo SQL Editor
-- depois de revisada. Idempotente (pode rodar duas vezes).
--
-- Motivo: o baseline faz `grant all ... to anon, authenticated` em todas as
-- tabelas, e as tabelas criadas depois (orders, sale_close_receipts,
-- audit_log) herdaram o default do Supabase, que também é ALL. A RLS
-- segura SELECT/INSERT/UPDATE/DELETE, mas:
--   * TRUNCATE não passa pela RLS. Hoje não é alcançável pela API REST
--     (PostgREST não expõe TRUNCATE), mas basta uma RPC/função futura com
--     SQL dinâmico ou um bug de configuração para virar "apagar a tabela
--     inteira de todos os tenants".
--   * REFERENCES/TRIGGER não têm uso nenhum para os papéis da API.
--   * tenant_staff (pin_hash, bloqueio) só é lida pela Edge Function
--     staff-auth (service_role) e pelas funções SECURITY DEFINER
--     current_tenant_id()/current_staff_role(), que rodam como dono.
--     Hoje ela depende só de "RLS sem policy"; aqui tira o GRANT também.
--   * print_agent_tokens só é usada pelo dono logado (authenticated) e pelas
--     funções print_agent_* (SECURITY DEFINER). anon não precisa de nada.
--
-- O que NÃO muda: nenhum SELECT/INSERT/UPDATE/DELETE de authenticated nas
-- tabelas que o index.html usa (app_data, members, member_dependents,
-- member_debt_entries, orders, print_jobs, audit_log, tenant_owners,
-- print_agent_tokens, sale_close_receipts). As policies continuam iguais.
--
-- Reteste pós-aplicação: login do dono, login de operador (staff-auth),
-- abrir/fechar venda no caixa, cadastrar sócio, gerar token do agente de
-- impressão (tela de Impressoras) e o agente buscando um job.
-- Rollback no fim do arquivo.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenant_owners','app_data','print_jobs','print_agent_tokens','tenant_staff',
    'members','member_dependents','member_debt_entries','sale_close_receipts',
    'audit_log','orders'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke truncate, references, trigger on table public.%I from public, anon, authenticated', t);
    end if;
  end loop;
end $$;

-- tenant_staff: nenhum papel da API acessa direto.
revoke all on table public.tenant_staff from public, anon, authenticated;
grant all on table public.tenant_staff to service_role;

-- print_agent_tokens: só o dono logado (a policy já é `to authenticated`).
revoke all on table public.print_agent_tokens from public, anon;

-- ---------------------------------------------------------------------
-- Conferência (rodar depois):
--   select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon','authenticated')
--   group by 1,2 order by 2,1;
-- Esperado: nenhuma linha com TRUNCATE/REFERENCES/TRIGGER; tenant_staff
-- sem anon/authenticated; print_agent_tokens sem anon.
--
-- ROLLBACK (volta ao estado do baseline):
--   grant all on table public.tenant_staff       to anon, authenticated;
--   grant all on table public.print_agent_tokens to anon;
--   -- e, para cada tabela da lista acima:
--   -- grant truncate, references, trigger on table public.<t> to anon, authenticated;
-- ---------------------------------------------------------------------
