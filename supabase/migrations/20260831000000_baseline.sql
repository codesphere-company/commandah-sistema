-- =====================================================================
-- COMMANDAH — BASELINE DO SCHEMA DE PRODUCAO
-- Projeto Supabase: ezfoymdesmarpunmixbs
-- Data do retrato: 2026-08-31
-- =====================================================================
--
-- O QUE E ESTE ARQUIVO
-- --------------------
-- Este NAO e um `pg_dump` literal. E uma reconstrucao do DDL feita por
-- INTROSPECCAO do catalogo do Postgres de producao (pg_class, pg_attribute,
-- pg_constraint, pg_indexes, pg_policies, pg_proc/pg_get_functiondef,
-- pg_trigger/pg_get_triggerdef, pg_publication_tables) em 2026-08-31.
--
-- Ate esta data o repositorio nao tinha `supabase/migrations/` versionado:
-- todo o schema so existia dentro do banco, sem historico, sem rollback e
-- sem forma de recriar o ambiente do zero. Este arquivo e o marco zero
-- retroativo — por isso o timestamp e anterior a "agora", para deixar claro
-- que ele descreve o que JA ESTAVA no ar, e nao uma mudanca nova.
--
-- REGRA DAQUI PARA A FRENTE (obrigatoria)
-- ---------------------------------------
-- Toda mudanca de schema (tabela, coluna, constraint, indice, funcao,
-- trigger, policy de RLS, grant) DEVE nascer como um NOVO arquivo em
-- `supabase/migrations/<YYYYMMDDHHmmss>_<descricao>.sql`, ser commitada
-- ANTES de ser executada no Supabase, e trazer no proprio arquivo o plano
-- de reversao. Nunca o contrario ("rodei no SQL Editor e depois eu
-- documento"). Um schema que so existe no banco e um schema que ninguem
-- consegue auditar, revisar nem restaurar.
--
-- SEGURANCA / PRIVACIDADE
-- -----------------------
-- Este arquivo contem APENAS estrutura (DDL). Nenhuma linha de dado,
-- nenhum PIN, token, hash, segredo ou dado pessoal de socio.
--
-- IDEMPOTENCIA
-- ------------
-- Escrito com CREATE ... IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS, de forma que rodar este arquivo contra o banco
-- de producao atual seja um no-op seguro, e rodar contra um banco vazio
-- (ambiente novo, restore, staging) reproduza o schema inteiro.
--
-- ROLLBACK
-- --------
-- Baseline nao tem rollback: ele descreve o estado ja existente. Reverter
-- este arquivo significaria derrubar o banco inteiro. O plano de reversao
-- passa a valer a partir da PROXIMA migration.
-- =====================================================================


-- =====================================================================
-- SECAO 0 — EXTENSOES
-- =====================================================================
-- Instaladas em producao (schema `extensions`, padrao do Supabase).
-- pgcrypto e usada de verdade pelas funcoes de token do agente de
-- impressao (extensions.digest / extensions.gen_random_bytes).

create extension if not exists pgcrypto      with schema extensions;
create extension if not exists "uuid-ossp"   with schema extensions;
-- pg_stat_statements e supabase_vault sao providos/gerenciados pela
-- plataforma Supabase; nao sao recriados aqui.


-- =====================================================================
-- SECAO 1 — TENANT_OWNERS
-- =====================================================================
-- Raiz do modelo multi-tenant: mapeia um usuario do Supabase Auth
-- (auth.users) para o tenant_id do estabelecimento. `tenant_id` e UNIQUE,
-- o que faz dele alvo valido de FK — e por isso todas as tabelas de
-- dominio referenciam esta tabela por tenant_id, nao por user_id.

create table if not exists public.tenant_owners (
  user_id        uuid        not null,
  tenant_id      text        not null,
  business_name  text,
  created_at     timestamptz default now(),
  constraint tenant_owners_pkey        primary key (user_id),
  constraint tenant_owners_tenant_id_key unique (tenant_id),
  constraint tenant_owners_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade
);

alter table public.tenant_owners enable row level security;


-- =====================================================================
-- SECAO 2 — APP_DATA  (blob JSON por (tenant_id, key))
-- =====================================================================
-- Store chave/valor generico usado pelo frontend para praticamente todo
-- o estado do sistema (`cantina2:products`, `cantina2:orders`,
-- `cantina2:sales`, `cantina2:settings`, `cantina2:logs`, ...).
--
-- DIVIDA CONHECIDA (nao corrigida neste baseline, so registrada):
--   - `sales` / `orders` / `cashSession` / `orderCounter` sao reescritos
--     inteiros a cada save -> last-write-wins entre dois dispositivos
--     simultaneos. Migracao para tabelas relacionais e a Fase 3 do backlog.
--   - `tenant_id` nao tem FK para tenant_owners (por isso e possivel
--     existir linha orfa de tenant sem dono, como as limpas em 2026-08-31).
--   - Existe UNIQUE (tenant_id, key) E um indice btree (tenant_id, key)
--     separado: o segundo e redundante com o indice da constraint unica.
--     Mantido no baseline por fidelidade ao estado de producao.

create table if not exists public.app_data (
  id          uuid        not null default gen_random_uuid(),
  tenant_id   text        not null,
  key         text        not null,
  value       jsonb       not null,
  updated_at  timestamptz default now(),
  constraint app_data_pkey primary key (id),
  constraint app_data_tenant_id_key_key unique (tenant_id, key)
);

create index if not exists idx_app_data_tenant_key
  on public.app_data using btree (tenant_id, key);

alter table public.app_data enable row level security;


-- =====================================================================
-- SECAO 3 — PRINT_JOBS  (fila de impressao ESC/POS)
-- =====================================================================
-- Consumida por polling do agente desktop Electron instalado no PC do
-- estabelecimento. Fluxo de status: 'pendente' -> 'processando' ->
-- 'impresso' | 'erro' (ver funcoes print_agent_* na secao 8).
--
-- DIVIDA CONHECIDA: `status` nao tem CHECK constraint — os valores validos
-- so existem no codigo das funcoes e do agente. `tenant_id` tambem nao tem
-- FK para tenant_owners.

create table if not exists public.print_jobs (
  id            uuid        not null default gen_random_uuid(),
  tenant_id     text        not null,
  printer_name  text        not null,
  content       text        not null,
  status        text        not null default 'pendente'::text,
  created_at    timestamptz default now(),
  printed_at    timestamptz,
  printer_ip    text,
  constraint print_jobs_pkey primary key (id)
);

-- Indice que serve o poll do agente:
--   select * from print_jobs where tenant_id = ? and printer_name = ?
--     and status = 'pendente' order by created_at
-- Custo de escrita: 1 indice adicional por INSERT de job (fila de baixo
-- volume, custo irrelevante frente ao ganho no poll de 6 em 6 segundos).
create index if not exists idx_print_jobs_pending
  on public.print_jobs using btree (tenant_id, printer_name, status);

alter table public.print_jobs enable row level security;


-- =====================================================================
-- SECAO 4 — PRINT_AGENT_TOKENS  (autenticacao do agente de impressao)
-- =====================================================================
-- Substituiu o modelo antigo em que o proprio tenant_id era tratado como
-- segredo. Guarda somente o HASH sha256 do token (bytea) — o token em
-- claro so existe no momento em que regenerate_print_agent_token() o
-- devolve para o dono, e nunca e persistido.
-- 1 token ativo por tenant (PK em tenant_id); rotacao sobrescreve o hash.

create table if not exists public.print_agent_tokens (
  tenant_id   text        not null,
  token_hash  bytea       not null,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz not null default now(),
  constraint print_agent_tokens_pkey primary key (tenant_id),
  constraint print_agent_tokens_token_hash_key unique (token_hash),
  constraint print_agent_tokens_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade
);

alter table public.print_agent_tokens enable row level security;


-- =====================================================================
-- SECAO 5 — TENANT_STAFF  (login por operador — Fase 2)
-- =====================================================================
-- Colaboradores com login real. O PIN e guardado como hash bcrypt
-- (`pin_hash`), verificado exclusivamente pela Edge Function `staff-auth`
-- rodando com service_role — o cliente nunca le esta tabela (ver RLS
-- na secao 9: a tabela tem RLS ligada e ZERO policies = nega tudo para
-- anon/authenticated, de proposito).
-- Bloqueio antifraude: 5 tentativas erradas -> locked_until = now() + 15min.

create table if not exists public.tenant_staff (
  id               text        not null,
  tenant_id        text        not null,
  auth_user_id     uuid,
  role             text        not null,
  pin_hash         text        not null,
  active           boolean     not null default true,
  failed_attempts  integer     not null default 0,
  locked_until     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint tenant_staff_pkey primary key (id),
  constraint tenant_staff_auth_user_id_key unique (auth_user_id),
  constraint tenant_staff_role_check
    check (role = any (array['admin'::text, 'caixa'::text, 'cozinha'::text])),
  constraint tenant_staff_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade
);

alter table public.tenant_staff enable row level security;


-- =====================================================================
-- SECAO 6 — MEMBERS  (socios — Fase 1, saiu do blob cantina2:members)
-- =====================================================================
-- `id` e text porque veio dos ids gerados pelo frontend na migracao do
-- blob JSON (nao foi trocado por uuid para nao quebrar as referencias que
-- ja existiam dentro de vendas/pedidos ainda em JSON).
--
-- `debt` e NUMERIC (dinheiro nunca em float) e NAO e escrito pelo cliente:
-- e sempre recalculado pelo trigger trg_recalc_member_debt a partir do
-- ledger member_debt_entries. `credit_limit` e o teto de fiado; o bloqueio
-- de consumo compara debt > credit_limit.

create table if not exists public.members (
  id                  text        not null,
  tenant_id           text        not null,
  name                text        not null,
  code                text,
  phone               text,
  email               text,
  gender              text,
  document            text,
  registry            text,
  birth_date          date,
  zip                 text,
  address             text,
  address_number      text,
  address_complement  text,
  district            text,
  city                text,
  uf                  text,
  reference           text,
  ibge                text,
  tags                text[]      not null default '{}'::text[],
  notes               text,
  points              numeric     not null default 0,
  points_history      jsonb       not null default '[]'::jsonb,
  debt                numeric     not null default 0,
  credit_limit        numeric     not null default 0,
  active              boolean     not null default true,
  archived            boolean     not null default false,
  archived_at         timestamptz,
  archived_by         text,
  latitude            double precision,
  longitude           double precision,
  geo_status          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint members_pkey primary key (id),
  constraint members_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id)
);

-- Serve o listar/buscar socios da tela Clientes e do PDV, que sempre
-- filtra por tenant_id primeiro (e o predicado da propria RLS).
create index if not exists idx_members_tenant
  on public.members using btree (tenant_id);

alter table public.members enable row level security;


-- =====================================================================
-- SECAO 7 — MEMBER_DEPENDENTS  (dependentes do socio)
-- =====================================================================
-- `can_order` define se o dependente pode consumir no fiado do titular.

create table if not exists public.member_dependents (
  id            text        not null,
  tenant_id     text        not null,
  member_id     text        not null,
  name          text        not null,
  relationship  text,
  document      text,
  can_order     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint member_dependents_pkey primary key (id),
  constraint member_dependents_member_id_fkey foreign key (member_id)
    references public.members (id) on delete cascade,
  constraint member_dependents_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id)
);

create index if not exists idx_member_dependents_member
  on public.member_dependents using btree (member_id);
create index if not exists idx_member_dependents_tenant
  on public.member_dependents using btree (tenant_id);

alter table public.member_dependents enable row level security;


-- =====================================================================
-- SECAO 8 — MEMBER_DEBT_ENTRIES  (ledger de fiado)
-- =====================================================================
-- Substituiu o array `debtHistory` solto dentro do blob de socios.
-- Regras de negocio materializadas aqui:
--   - `type` so aceita 'debt' (consumo) ou 'payment' (pagamento).
--   - `value` e NUMERIC e sempre POSITIVO; o sinal vem do `type`.
--   - Estorno NAO apaga linha: marca `reversed = true` (+ reversed_at /
--     reversed_by). Historico financeiro nunca sofre hard delete.
--   - O saldo do socio nunca e escrito direto: sai da soma das linhas
--     nao estornadas, via trigger (abaixo).

create table if not exists public.member_debt_entries (
  id           text        not null,
  tenant_id    text        not null,
  member_id    text        not null,
  type         text        not null,
  value        numeric     not null,
  reason       text,
  info         text,
  method       text,
  sale_id      text,
  created_by   text,
  at           timestamptz not null default now(),
  reversed     boolean     not null default false,
  reversed_at  timestamptz,
  reversed_by  text,
  created_at   timestamptz not null default now(),
  constraint member_debt_entries_pkey primary key (id),
  constraint member_debt_entries_type_check
    check (type = any (array['debt'::text, 'payment'::text])),
  constraint member_debt_entries_member_id_fkey foreign key (member_id)
    references public.members (id) on delete cascade,
  constraint member_debt_entries_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id)
);

-- idx_member_debt_entries_member serve o extrato do socio (tela Financeiro
-- -> Fiado) e o proprio recalculo do trigger, que filtra por member_id.
create index if not exists idx_member_debt_entries_member
  on public.member_debt_entries using btree (member_id);
create index if not exists idx_member_debt_entries_tenant
  on public.member_debt_entries using btree (tenant_id);

alter table public.member_debt_entries enable row level security;


-- =====================================================================
-- SECAO 9 — FUNCOES
-- =====================================================================

-- ---------------------------------------------------------------------
-- current_tenant_id() — resolve o tenant do usuario logado.
-- Reconhece TANTO o dono (tenant_owners) QUANTO o operador migrado para
-- o login seguro (tenant_staff ativo). E o predicado usado por
-- praticamente toda policy de RLS do sistema.
-- SECURITY DEFINER + search_path vazio: precisa ler tenant_owners /
-- tenant_staff ignorando a RLS dessas tabelas, sem abrir caminho para
-- search_path hijacking.
-- ---------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select tenant_id from public.tenant_owners where user_id = auth.uid()),
    (select tenant_id from public.tenant_staff where auth_user_id = auth.uid() and active = true)
  );
$function$;

-- ---------------------------------------------------------------------
-- recalc_member_debt() — trigger que mantem members.debt como valor
-- derivado do ledger. NAO e SECURITY DEFINER de proposito: roda no
-- contexto de quem escreveu a linha, e o UPDATE em members ainda passa
-- pela RLS daquele usuario.
-- ---------------------------------------------------------------------
create or replace function public.recalc_member_debt()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  target_member_id text;
begin
  target_member_id := coalesce(new.member_id, old.member_id);
  update public.members
  set debt = (
        select coalesce(sum(case when type='debt' then value when type='payment' then -value else 0 end), 0)
        from public.member_debt_entries
        where member_id = target_member_id and not reversed
      ),
      updated_at = now()
  where id = target_member_id;
  return null;
end;
$function$;

-- ---------------------------------------------------------------------
-- regenerate_print_agent_token() — o dono (e so o dono) gera/rotaciona o
-- token do agente de impressao. Devolve o token em CLARO uma unica vez;
-- o banco guarda apenas o sha256.
-- ---------------------------------------------------------------------
create or replace function public.regenerate_print_agent_token()
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id text;
  v_token text;
begin
  select tenant_id into v_tenant_id from public.tenant_owners where user_id = auth.uid();
  if v_tenant_id is null then
    raise exception 'not a tenant owner';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.print_agent_tokens (tenant_id, token_hash, created_at, rotated_at)
  values (v_tenant_id, extensions.digest(v_token, 'sha256'), now(), now())
  on conflict (tenant_id) do update
    set token_hash = excluded.token_hash, rotated_at = now();

  return v_token;
end;
$function$;

-- ---------------------------------------------------------------------
-- print_agent_fetch_pending(p_token) — o agente desktop lista seus jobs
-- pendentes apresentando o token. Autentica pelo hash e devolve APENAS os
-- jobs do tenant dono daquele token.
-- ---------------------------------------------------------------------
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
  return query
    select * from public.print_jobs
    where tenant_id = v_tenant_id and status = 'pendente'
    order by created_at asc;
end;
$function$;

-- ---------------------------------------------------------------------
-- print_agent_claim_job(p_token, p_job_id) — reivindica um job
-- ('pendente' -> 'processando'). O UPDATE condicionado a status =
-- 'pendente' e o que evita dois agentes imprimirem o mesmo ticket:
-- quem perder a corrida recebe row_count = 0 e retorna false.
-- ---------------------------------------------------------------------
create or replace function public.print_agent_claim_job(p_token text, p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id text;
  v_updated int;
begin
  select tenant_id into v_tenant_id from public.print_agent_tokens
    where token_hash = extensions.digest(p_token, 'sha256');
  if v_tenant_id is null then
    return false;
  end if;

  update public.print_jobs
    set status = 'processando'
    where id = p_job_id and tenant_id = v_tenant_id and status = 'pendente';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

-- ---------------------------------------------------------------------
-- print_agent_mark_status(p_token, p_job_id, p_status) — fecha o job como
-- 'impresso' ou 'erro'. Qualquer outro status levanta excecao.
-- ---------------------------------------------------------------------
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
    raise exception 'status invalido';
  end if;

  select tenant_id into v_tenant_id from public.print_agent_tokens
    where token_hash = extensions.digest(p_token, 'sha256');
  if v_tenant_id is null then
    return false;
  end if;

  update public.print_jobs
    set status = p_status, printed_at = now()
    where id = p_job_id and tenant_id = v_tenant_id;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;


-- =====================================================================
-- SECAO 10 — TRIGGERS
-- =====================================================================
-- Dispara em INSERT, DELETE e UPDATE OF reversed (estorno). Nao dispara
-- em update de outras colunas do lancamento, porque nenhuma delas altera
-- o saldo.

drop trigger if exists trg_recalc_member_debt on public.member_debt_entries;
create trigger trg_recalc_member_debt
  after insert or delete or update of reversed
  on public.member_debt_entries
  for each row execute function public.recalc_member_debt();


-- =====================================================================
-- SECAO 11 — POLICIES DE RLS
-- =====================================================================
-- RLS e a UNICA barreira de seguranca real deste sistema: nao existe
-- camada de API propria, o navegador fala direto com o PostgREST usando
-- a chave anon. Toda tabela abaixo tem RLS habilitada (secoes 1 a 8).

-- --- tenant_owners ---------------------------------------------------
-- O usuario so enxerga e so cria o proprio mapeamento. Nao ha policy de
-- UPDATE nem DELETE: trocar dono/tenant e operacao administrativa.
drop policy if exists own_tenant_mapping on public.tenant_owners;
create policy own_tenant_mapping
  on public.tenant_owners
  for select
  using (auth.uid() = user_id);

drop policy if exists insert_own_tenant_mapping on public.tenant_owners;
create policy insert_own_tenant_mapping
  on public.tenant_owners
  for insert
  with check (auth.uid() = user_id);

-- --- app_data --------------------------------------------------------
-- Isolamento por tenant, valendo para dono e operador migrado.
drop policy if exists tenant_isolated_access on public.app_data;
create policy tenant_isolated_access
  on public.app_data
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- --- print_jobs ------------------------------------------------------
-- Fechada em 2026 (antes vazava pedidos entre tenants). O agente desktop
-- NAO usa esta policy: ele passa pelas funcoes print_agent_* (secao 9).
drop policy if exists tenant_isolated_print_jobs on public.print_jobs;
create policy tenant_isolated_print_jobs
  on public.print_jobs
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- --- print_agent_tokens ----------------------------------------------
-- SO o dono (tenant_owners), e so no papel `authenticated` — operador
-- migrado NAO gerencia token de impressao. O sub-select em tenant_owners
-- e proposital (nao usa current_tenant_id(), que tambem casaria staff).
drop policy if exists owner_manage_print_token on public.print_agent_tokens;
create policy owner_manage_print_token
  on public.print_agent_tokens
  for all
  to authenticated
  using (
    tenant_id = (select tenant_owners.tenant_id
                 from public.tenant_owners
                 where tenant_owners.user_id = (select auth.uid()))
  )
  with check (
    tenant_id = (select tenant_owners.tenant_id
                 from public.tenant_owners
                 where tenant_owners.user_id = (select auth.uid()))
  );

-- --- tenant_staff ----------------------------------------------------
-- INTENCIONALMENTE SEM NENHUMA POLICY.
-- RLS habilitada + zero policies = nega tudo para anon e authenticated.
-- A tabela guarda pin_hash e estado de bloqueio; so a Edge Function
-- `staff-auth` (service_role, que faz bypass de RLS) a acessa.
-- NAO adicionar policy aqui sem revisao de seguranca: qualquer policy de
-- SELECT reexpoe o hash de PIN ao navegador.

-- --- members / member_dependents / member_debt_entries ----------------
-- Mesmo padrao de isolamento por tenant. Estas tabelas guardam PII de
-- pessoa real (nome, telefone, documento, endereco, divida) — o predicado
-- de tenant e a unica coisa que separa um clube de outro.
drop policy if exists tenant_isolated_members on public.members;
create policy tenant_isolated_members
  on public.members
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists tenant_isolated_member_dependents on public.member_dependents;
create policy tenant_isolated_member_dependents
  on public.member_dependents
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists tenant_isolated_member_debt_entries on public.member_debt_entries;
create policy tenant_isolated_member_debt_entries
  on public.member_debt_entries
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());


-- =====================================================================
-- SECAO 12 — GRANTS
-- =====================================================================
-- Reproduz o estado de producao. As tabelas tem GRANT amplo para anon /
-- authenticated (padrao do Supabase) — quem realmente barra o acesso e a
-- RLS da secao 11, nao o GRANT.

grant all on table public.tenant_owners       to anon, authenticated, service_role;
grant all on table public.app_data            to anon, authenticated, service_role;
grant all on table public.print_jobs          to anon, authenticated, service_role;
grant all on table public.print_agent_tokens  to anon, authenticated, service_role;
grant all on table public.tenant_staff        to anon, authenticated, service_role;
grant all on table public.members             to anon, authenticated, service_role;
grant all on table public.member_dependents   to anon, authenticated, service_role;
grant all on table public.member_debt_entries to anon, authenticated, service_role;

-- Funcoes: EXECUTE revogado de PUBLIC e concedido nominalmente.
revoke all on function public.current_tenant_id()                        from public;
revoke all on function public.regenerate_print_agent_token()             from public;
revoke all on function public.print_agent_fetch_pending(text)            from public;
revoke all on function public.print_agent_claim_job(text, uuid)          from public;
revoke all on function public.print_agent_mark_status(text, uuid, text)  from public;

grant execute on function public.current_tenant_id()                       to anon, authenticated, service_role;
-- As print_agent_* precisam de anon: o agente desktop chama a RPC com a
-- chave anon, autenticando-se pelo token (nao por sessao de usuario).
grant execute on function public.print_agent_fetch_pending(text)           to anon, authenticated, service_role;
grant execute on function public.print_agent_claim_job(text, uuid)         to anon, authenticated, service_role;
grant execute on function public.print_agent_mark_status(text, uuid, text) to anon, authenticated, service_role;
-- regenerate_print_agent_token NAO e concedida a anon de proposito:
-- exige sessao de dono autenticado.
grant execute on function public.regenerate_print_agent_token()            to authenticated, service_role;

-- recalc_member_debt() e funcao de trigger e mantem o EXECUTE de PUBLIC
-- (padrao do Postgres); chama-la diretamente fora de trigger falha.


-- =====================================================================
-- SECAO 13 — REALTIME
-- =====================================================================
-- Somente public.app_data esta na publicacao supabase_realtime.
-- REPLICA IDENTITY de todas as tabelas e a default (chave primaria).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_data'
  ) then
    alter publication supabase_realtime add table public.app_data;
  end if;
end
$$;


-- =====================================================================
-- SECAO 14 — OBSERVACOES / DIVIDA TECNICA CONHECIDA
-- =====================================================================
-- Registradas aqui de proposito, SEM correcao neste arquivo (baseline
-- descreve, nao muda). Cada item deve virar uma migration propria:
--
--  1. app_data.tenant_id e print_jobs.tenant_id nao tem FK para
--     tenant_owners(tenant_id). Foi exatamente isso que permitiu que os
--     tenants orfaos 'clube-olimpico-maringa' e 'lanchonete-olimpico-3bew'
--     acumulassem PII sem dono. Adicionar a FK exige limpar os orfaos
--     antes (feito em 2026-08-31) e decidir o ON DELETE.
--  2. print_jobs.status nao tem CHECK ('pendente','processando',
--     'impresso','erro').
--  3. idx_app_data_tenant_key e redundante com a constraint UNIQUE
--     app_data_tenant_id_key_key (mesmas colunas, mesma ordem).
--  4. members / member_dependents / member_debt_entries usam PK text
--     global (id vindo do frontend) em vez de PK composta com tenant_id.
--     Um id colidindo entre tenants seria rejeitado pela PK, nao isolado.
--  5. member_debt_entries.value nao tem CHECK (value > 0); o sinal e
--     responsabilidade do campo `type`, sem garantia no banco.
--  6. Nenhuma tabela transacional tem deleted_at/soft delete formal, exceto
--     o par archived/archived_at em members e o flag reversed no ledger.
--  7. sales / orders / cashSession / orderCounter continuam como blob JSON
--     em app_data (last-write-wins entre dispositivos) — Fase 3 do backlog.
-- =====================================================================
