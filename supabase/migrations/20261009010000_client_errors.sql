-- =====================================================================
-- 20261009010000_client_errors.sql — OPS-10 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- Um erro de JavaScript no caixa ou no celular do garçom só aparecia no console
-- daquele navegador: o dono não ficava sabendo. Decisão do dono: tabela própria
-- no Supabase (sem serviço externo).
--
-- A SOLUCAO
-- ---------
-- public.client_errors: o index.html grava cada erro não tratado (mensagem,
-- arquivo/linha, pilha, tela, navegador, versão). Tenant, horário e quem estava
-- logado são carimbados pelo servidor (trigger), como no audit_log. Qualquer
-- operador logado grava; só admin/dono lê (tela Configurações > Erros do Sistema).
-- Tamanhos limitados por CHECK para ninguém encher a tabela com texto gigante.
--
-- RETESTE: logado no app, abrir o console e rodar
--   setTimeout(()=>{ throw new Error('teste OPS-10') })
-- e conferir a linha em Configurações > Erros do Sistema.
-- =====================================================================

create table if not exists public.client_errors (
  id              uuid        not null default gen_random_uuid(),
  tenant_id       text        not null,
  at              timestamptz not null default now(),
  actor_auth_uid  uuid,
  actor_name      text,
  message         text        not null,
  source          text,
  line            integer,
  col             integer,
  stack           text,
  page            text,
  user_agent      text,
  app_version     text,
  constraint client_errors_pkey primary key (id),
  constraint client_errors_tamanhos check (
    length(message) <= 2000
    and coalesce(length(stack), 0) <= 8000
    and coalesce(length(source), 0) <= 500
    and coalesce(length(page), 0) <= 500
    and coalesce(length(user_agent), 0) <= 500
    and coalesce(length(actor_name), 0) <= 120
    and coalesce(length(app_version), 0) <= 40
  )
);

create index if not exists idx_client_errors_tenant_at
  on public.client_errors using btree (tenant_id, at desc);

alter table public.client_errors enable row level security;

create or replace function public.client_errors_stamp()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.tenant_id      := public.current_tenant_id();
  new.at             := now();
  new.actor_auth_uid := auth.uid();
  if new.tenant_id is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_client_errors_stamp on public.client_errors;
create trigger trg_client_errors_stamp
  before insert on public.client_errors
  for each row execute function public.client_errors_stamp();

drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert
  on public.client_errors
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) is not null
  );

drop policy if exists client_errors_select_admin on public.client_errors;
create policy client_errors_select_admin
  on public.client_errors
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.is_admin_like())
  );

revoke all on table public.client_errors from public, anon;
grant select, insert on table public.client_errors to authenticated;
grant all on table public.client_errors to service_role;
revoke all on function public.client_errors_stamp() from public, anon;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop table if exists public.client_errors;
-- drop function if exists public.client_errors_stamp();
