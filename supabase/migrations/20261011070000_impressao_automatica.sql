-- =====================================================================
-- 20261011070000_impressao_automatica.sql — configuração automática da impressão
-- =====================================================================
-- O PROBLEMA (dono, 11/10)
-- ------------------------
-- Configurar a impressão era difícil: copiar um token de 48 letras para cada
-- computador, digitar o "nome exato no Windows" e o IP de cada impressora e
-- cruzar estação com origem. O clube tem 5 impressoras: 3 ligadas em
-- computadores (USB) e 2 de rede, sem computador.
--
-- A SOLUCAO
-- ---------
-- 1. Conectar o computador por CÓDIGO: o agente pede um código de 6 dígitos
--    (print_agent_pair_start, sem login), o administrador digita no Commandah
--    (print_agent_pair_confirm) e o agente recebe o seu token próprio
--    (print_agent_pair_poll, só com o segredo que ele mesmo guardou). Cada
--    computador tem seu token em print_agents: dá para ver quais estão ligados
--    e remover um sem derrubar os outros.
-- 2. O agente CONTA o que encontrou (print_agent_report): impressoras do Windows
--    daquele computador e impressoras de rede (porta 9100) da rede local. A tela
--    do Commandah lista tudo (print_setup_state); o administrador só escolhe o que
--    cada impressora imprime e testa.
-- 3. A ficha pode ir para um computador certo (print_jobs.agent_id): duas
--    impressoras com o mesmo nome no Windows em computadores diferentes não se
--    confundem. Ficha de rede sem computador definido vai para qualquer
--    computador que tenha encontrado aquele IP.
-- 4. O erro da impressão volta para o Commandah (print_jobs.error e a saúde de
--    cada impressora em print_agent_printers).
--
-- COMPATIBILIDADE: o token único do estabelecimento (print_agent_tokens) continua
-- valendo, com o comportamento de antes (agente 2.0 e fichas sem computador
-- definido). Nenhuma assinatura usada pelo agente 2.0 muda de forma incompatível.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas (sem acesso direto pela API: tudo passa pelas funções abaixo)
-- ---------------------------------------------------------------------
create table if not exists public.print_agents (
  id                  uuid        not null default gen_random_uuid(),
  tenant_id           text        not null,
  name                text        not null,
  machine             text,
  version             text,
  token_hash          bytea       not null,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz,
  rescan_requested_at timestamptz,
  last_scan_at        timestamptz,
  constraint print_agents_pkey primary key (id),
  constraint print_agents_token_hash_key unique (token_hash),
  constraint print_agents_tenant_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade
);
create index if not exists idx_print_agents_tenant on public.print_agents (tenant_id);

create table if not exists public.print_agent_pairings (
  code         text        not null,
  secret_hash  bytea       not null,
  machine      text,
  version      text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  tenant_id    text,
  agent_name   text,
  confirmed_by text,
  confirmed_at timestamptz,
  constraint print_agent_pairings_pkey primary key (code)
);

create table if not exists public.print_agent_printers (
  id            uuid        not null default gen_random_uuid(),
  tenant_id     text        not null,
  agent_id      uuid        not null,
  kind          text        not null,
  name          text        not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  last_ok_at    timestamptz,
  last_error_at timestamptz,
  last_error    text,
  constraint print_agent_printers_pkey primary key (id),
  constraint print_agent_printers_kind_check check (kind in ('windows', 'rede')),
  constraint print_agent_printers_unique unique (agent_id, kind, name),
  constraint print_agent_printers_agent_fkey foreign key (agent_id)
    references public.print_agents (id) on delete cascade
);
create index if not exists idx_print_agent_printers_tenant on public.print_agent_printers (tenant_id, kind, name);

alter table public.print_agents         enable row level security;
alter table public.print_agent_pairings enable row level security;
alter table public.print_agent_printers enable row level security;
revoke all on table public.print_agents         from public, anon, authenticated;
revoke all on table public.print_agent_pairings from public, anon, authenticated;
revoke all on table public.print_agent_printers from public, anon, authenticated;
grant all on table public.print_agents, public.print_agent_pairings, public.print_agent_printers to service_role;

-- Ficha direcionada a um computador + erro devolvido pelo agente.
alter table public.print_jobs add column if not exists agent_id uuid;
alter table public.print_jobs add column if not exists error text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'print_jobs_agent_fkey') then
    alter table public.print_jobs add constraint print_jobs_agent_fkey
      foreign key (agent_id) references public.print_agents (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Quem é o agente: token próprio do computador (print_agents) ou o token
-- único do estabelecimento (print_agent_tokens, agent_id nulo = modo antigo).
-- ---------------------------------------------------------------------
create or replace function public.print_agent_auth(p_token text)
returns table (tenant_id text, agent_id uuid)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_hash bytea;
begin
  if p_token is null or length(p_token) = 0 then
    return;
  end if;
  v_hash := extensions.digest(p_token, 'sha256');
  return query select a.tenant_id, a.id from public.print_agents a where a.token_hash = v_hash;
  if found then
    return;
  end if;
  return query select t.tenant_id, null::uuid from public.print_agent_tokens t where t.token_hash = v_hash;
end;
$function$;
revoke all on function public.print_agent_auth(text) from public, anon, authenticated;

-- Sinal de vida (no máximo uma escrita a cada 30 s).
create or replace function public.print_agent_touch2(p_tenant_id text, p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_agent_id is null then
    perform public.print_agent_touch(p_tenant_id);
  else
    update public.print_agents
       set last_seen_at = now()
     where id = p_agent_id
       and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
  end if;
end;
$function$;
revoke all on function public.print_agent_touch2(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Conectar o computador por código
-- ---------------------------------------------------------------------
create or replace function public.print_agent_pair_start(p_machine text default null, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_code text;
  v_secret text;
  v_expires timestamptz := now() + interval '30 minutes';
  v_try int := 0;
begin
  delete from public.print_agent_pairings where expires_at < now() - interval '1 hour';
  -- Freio contra abuso (a função não exige login).
  if (select count(*) from public.print_agent_pairings where created_at > now() - interval '10 minutes') > 300 then
    raise exception 'Muitos pedidos de código agora. Tente de novo em alguns minutos.';
  end if;
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  loop
    v_try := v_try + 1;
    -- 4 bytes aleatórios num bigint de 64 bits (sempre positivo) → 000000 a 999999.
    v_code := lpad(((('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint) % 1000000)::text, 6, '0');
    begin
      delete from public.print_agent_pairings where code = v_code and expires_at < now();
      insert into public.print_agent_pairings (code, secret_hash, machine, version, expires_at)
      values (v_code, extensions.digest(v_secret, 'sha256'), left(p_machine, 100), left(p_version, 30), v_expires);
      exit;
    exception when unique_violation then
      if v_try >= 20 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'secret', v_secret, 'expires_at', v_expires);
end;
$function$;
revoke all on function public.print_agent_pair_start(text, text) from public;
grant execute on function public.print_agent_pair_start(text, text) to anon, authenticated, service_role;

create or replace function public.print_agent_pair_confirm(p_code text, p_name text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_row public.print_agent_pairings%rowtype;
  v_name text;
begin
  if v_tenant is null or not public.is_admin_like() then
    raise exception 'Só o administrador conecta computadores de impressão.' using errcode = '42501';
  end if;
  select * into v_row from public.print_agent_pairings
   where code = v_code and expires_at > now() and tenant_id is null
   for update;
  if not found then
    raise exception 'Código não encontrado ou vencido. Confira o número na janela do agente (ele troca a cada 30 minutos).' using errcode = 'P0002';
  end if;
  v_name := coalesce(nullif(left(trim(coalesce(p_name, '')), 60), ''), nullif(v_row.machine, ''), 'Computador');
  update public.print_agent_pairings
     set tenant_id = v_tenant, agent_name = v_name, confirmed_by = left(p_by, 120), confirmed_at = now()
   where code = v_code;
  insert into public.audit_log (actor_name, action, entity, entity_id, meta)
  values (nullif(left(coalesce(p_by, ''), 120), ''), 'Computador de impressão conectado: ' || v_name,
          'print_agent', v_code, jsonb_build_object('machine', v_row.machine));
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$function$;
revoke all on function public.print_agent_pair_confirm(text, text, text) from public, anon;
grant execute on function public.print_agent_pair_confirm(text, text, text) to authenticated, service_role;

create or replace function public.print_agent_pair_poll(p_code text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.print_agent_pairings%rowtype;
  v_token text;
  v_id uuid;
begin
  select * into v_row from public.print_agent_pairings
   where code = p_code and secret_hash = extensions.digest(coalesce(p_secret, ''), 'sha256')
   for update;
  if not found then
    return jsonb_build_object('status', 'expired');
  end if;
  if v_row.tenant_id is null then
    if v_row.expires_at < now() then
      return jsonb_build_object('status', 'expired');
    end if;
    return jsonb_build_object('status', 'waiting', 'expires_at', v_row.expires_at);
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.print_agents (tenant_id, name, machine, version, token_hash, last_seen_at)
  values (v_row.tenant_id, v_row.agent_name, v_row.machine, v_row.version, extensions.digest(v_token, 'sha256'), now())
  returning id into v_id;
  delete from public.print_agent_pairings where code = p_code;
  return jsonb_build_object('status', 'ok', 'token', v_token, 'agent_id', v_id, 'name', v_row.agent_name);
end;
$function$;
revoke all on function public.print_agent_pair_poll(text, text) from public;
grant execute on function public.print_agent_pair_poll(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- O agente conta o que encontrou
-- p_windows: ["POS-80C", ...] · p_network: ["192.168.0.50", ...] ou null (sem varredura agora)
-- ---------------------------------------------------------------------
create or replace function public.print_agent_report(p_token text, p_machine text, p_version text, p_windows jsonb, p_network jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text;
  v_agent uuid;
  v_name text;
begin
  select a.tenant_id, a.agent_id into v_tenant, v_agent from public.print_agent_auth(p_token) a;
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;
  if v_agent is null then
    return jsonb_build_object('ok', false, 'reason', 'legacy');
  end if;
  update public.print_agents
     set machine = coalesce(left(p_machine, 100), machine), version = coalesce(left(p_version, 30), version),
         last_seen_at = now(), last_scan_at = case when p_network is not null then now() else last_scan_at end
   where id = v_agent;

  if jsonb_typeof(p_windows) = 'array' then
    for v_name in select distinct left(trim(x), 200) from jsonb_array_elements_text(p_windows) x where length(trim(x)) > 0 limit 60 loop
      insert into public.print_agent_printers (tenant_id, agent_id, kind, name)
      values (v_tenant, v_agent, 'windows', v_name)
      on conflict (agent_id, kind, name) do update set last_seen_at = now();
    end loop;
  end if;
  if jsonb_typeof(p_network) = 'array' then
    for v_name in select distinct trim(x) from jsonb_array_elements_text(p_network) x
                   where trim(x) ~ '^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$' limit 60 loop
      insert into public.print_agent_printers (tenant_id, agent_id, kind, name)
      values (v_tenant, v_agent, 'rede', v_name)
      on conflict (agent_id, kind, name) do update set last_seen_at = now();
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.print_agent_report(text, text, text, jsonb, jsonb) from public;
grant execute on function public.print_agent_report(text, text, text, jsonb, jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Funções que o agente já usava, agora sabendo qual computador chamou
-- ---------------------------------------------------------------------
create or replace function public.print_agent_ping(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text;
  v_agent uuid;
  v_row record;
begin
  select a.tenant_id, a.agent_id into v_tenant, v_agent from public.print_agent_auth(p_token) a;
  if v_tenant is null then
    return jsonb_build_object('ok', false);
  end if;
  perform public.print_agent_touch2(v_tenant, v_agent);
  if v_agent is null then
    return jsonb_build_object('ok', true, 'server_time', now());
  end if;
  select name, rescan_requested_at, last_scan_at into v_row from public.print_agents where id = v_agent;
  return jsonb_build_object('ok', true, 'server_time', now(), 'agent_id', v_agent, 'name', v_row.name,
    'rescan', v_row.rescan_requested_at is not null and v_row.rescan_requested_at > coalesce(v_row.last_scan_at, '-infinity'::timestamptz));
end;
$function$;

create or replace function public.print_agent_fetch_pending(p_token text)
returns setof public.print_jobs
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text;
  v_agent uuid;
begin
  select a.tenant_id, a.agent_id into v_tenant, v_agent from public.print_agent_auth(p_token) a;
  if v_tenant is null then
    return;
  end if;
  perform public.print_agent_touch2(v_tenant, v_agent);
  if v_agent is null then
    -- Token único do estabelecimento (modo antigo): só fichas sem computador definido.
    return query
      select * from public.print_jobs j
       where j.tenant_id = v_tenant and j.status = 'pendente' and j.agent_id is null
       order by j.created_at asc;
    return;
  end if;
  return query
    select * from public.print_jobs j
     where j.tenant_id = v_tenant and j.status = 'pendente'
       and (
         j.agent_id = v_agent
         or (j.agent_id is null and (
               coalesce(j.printer_ip, '') = ''
               -- impressora de rede: vai para quem encontrou esse IP; se ninguém encontrou, para qualquer um
               or exists (select 1 from public.print_agent_printers p
                           where p.agent_id = v_agent and p.kind = 'rede' and p.name = j.printer_ip)
               or not exists (select 1 from public.print_agent_printers p
                               where p.tenant_id = v_tenant and p.kind = 'rede' and p.name = j.printer_ip)
             ))
       )
     order by j.created_at asc;
end;
$function$;

create or replace function public.print_agent_claim_job(p_token text, p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text;
  v_agent uuid;
  v_updated int;
begin
  select a.tenant_id, a.agent_id into v_tenant, v_agent from public.print_agent_auth(p_token) a;
  if v_tenant is null then
    return false;
  end if;
  update public.print_jobs
     set status = 'processando'
   where id = p_job_id and tenant_id = v_tenant and status = 'pendente'
     and (agent_id is null or agent_id = v_agent);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

-- p_error novo (opcional): o motivo da falha volta para o Commandah.
drop function if exists public.print_agent_mark_status(text, uuid, text);
create or replace function public.print_agent_mark_status(p_token text, p_job_id uuid, p_status text, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text;
  v_agent uuid;
  v_job public.print_jobs%rowtype;
begin
  if p_status not in ('impresso', 'erro') then
    raise exception 'status inválido';
  end if;
  select a.tenant_id, a.agent_id into v_tenant, v_agent from public.print_agent_auth(p_token) a;
  if v_tenant is null then
    return false;
  end if;
  perform public.print_agent_touch2(v_tenant, v_agent);

  update public.print_jobs
     set status = p_status, printed_at = now(),
         error = case when p_status = 'erro' then left(coalesce(p_error, 'Falha na impressão'), 300) else null end
   where id = p_job_id and tenant_id = v_tenant
     and status in ('pendente', 'processando')
  returning * into v_job;
  if not found then
    return false;
  end if;

  if v_agent is not null then
    update public.print_agent_printers
       set last_ok_at    = case when p_status = 'impresso' then now() else last_ok_at end,
           last_error_at = case when p_status = 'erro' then now() else last_error_at end,
           last_error    = case when p_status = 'erro' then left(coalesce(p_error, 'Falha na impressão'), 300) else last_error end
     where agent_id = v_agent
       and ((kind = 'rede' and name = v_job.printer_ip)
         or (kind = 'windows' and coalesce(v_job.printer_ip, '') = '' and lower(name) = lower(v_job.printer_name)));
  end if;
  return true;
end;
$function$;
revoke all on function public.print_agent_mark_status(text, uuid, text, text) from public;
grant execute on function public.print_agent_mark_status(text, uuid, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Para o Commandah
-- ---------------------------------------------------------------------
-- Aviso "agente desconectado": agora também lista os computadores conectados.
create or replace function public.print_agent_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_has_token boolean;
  v_token_seen timestamptz;
  v_agents jsonb;
begin
  if v_tenant is null or public.current_staff_role() is null then
    return null;
  end if;
  select true, last_seen_at into v_has_token, v_token_seen from public.print_agent_tokens where tenant_id = v_tenant;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'last_seen_at', last_seen_at) order by name), '[]'::jsonb)
    into v_agents from public.print_agents where tenant_id = v_tenant;
  return jsonb_build_object(
    'configured', coalesce(v_has_token, false) or jsonb_array_length(v_agents) > 0,
    'last_seen_at', v_token_seen,
    'agents', v_agents,
    'now', now());
end;
$function$;

-- Tela de configuração (só administrador).
create or replace function public.print_setup_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
begin
  if v_tenant is null or not public.is_admin_like() then
    raise exception 'Só o administrador configura a impressão.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'now', now(),
    'agents', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', id, 'name', name, 'machine', machine, 'version', version, 'created_at', created_at,
                 'last_seen_at', last_seen_at, 'last_scan_at', last_scan_at) order by created_at), '[]'::jsonb)
               from public.print_agents where tenant_id = v_tenant),
    'printers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', id, 'agent_id', agent_id, 'kind', kind, 'name', name, 'first_seen_at', first_seen_at,
                 'last_seen_at', last_seen_at, 'last_ok_at', last_ok_at, 'last_error_at', last_error_at,
                 'last_error', last_error) order by kind desc, name), '[]'::jsonb)
               from public.print_agent_printers where tenant_id = v_tenant),
    'legacy_token', (select jsonb_build_object('last_seen_at', last_seen_at, 'rotated_at', rotated_at)
                     from public.print_agent_tokens where tenant_id = v_tenant));
end;
$function$;
revoke all on function public.print_setup_state() from public, anon;
grant execute on function public.print_setup_state() to authenticated, service_role;

create or replace function public.print_agent_manage(p_action text, p_agent_id uuid default null, p_name text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_name text;
begin
  if v_tenant is null or not public.is_admin_like() then
    raise exception 'Só o administrador configura a impressão.' using errcode = '42501';
  end if;
  if p_action = 'rescan' then
    update public.print_agents set rescan_requested_at = now() where tenant_id = v_tenant;
    return jsonb_build_object('ok', true);
  end if;
  select name into v_name from public.print_agents where id = p_agent_id and tenant_id = v_tenant;
  if v_name is null then
    raise exception 'Computador não encontrado.';
  end if;
  if p_action = 'rename' then
    if length(trim(coalesce(p_name, ''))) = 0 then
      raise exception 'Informe o nome.';
    end if;
    update public.print_agents set name = left(trim(p_name), 60) where id = p_agent_id;
    return jsonb_build_object('ok', true);
  elsif p_action = 'remove' then
    delete from public.print_agents where id = p_agent_id;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (nullif(left(coalesce(p_by, ''), 120), ''), 'Computador de impressão removido: ' || v_name,
            'print_agent', p_agent_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'ação inválida';
end;
$function$;
revoke all on function public.print_agent_manage(text, uuid, text, text) from public, anon;
grant execute on function public.print_agent_manage(text, uuid, text, text) to authenticated, service_role;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- 1. Recriar print_agent_ping (20261011030000), print_agent_fetch_pending e
--    print_agent_status (20261010000000), print_agent_claim_job (baseline) e:
--    drop function if exists public.print_agent_mark_status(text, uuid, text, text);
--    e recriar print_agent_mark_status(text, uuid, text) como em 20261010000000.
-- 2. drop function if exists public.print_agent_manage(text, uuid, text, text);
--    drop function if exists public.print_setup_state();
--    drop function if exists public.print_agent_report(text, text, text, jsonb, jsonb);
--    drop function if exists public.print_agent_pair_poll(text, text);
--    drop function if exists public.print_agent_pair_confirm(text, text, text);
--    drop function if exists public.print_agent_pair_start(text, text);
--    drop function if exists public.print_agent_touch2(text, uuid);
--    drop function if exists public.print_agent_auth(text);
-- 3. alter table public.print_jobs drop constraint if exists print_jobs_agent_fkey;
--    alter table public.print_jobs drop column if exists agent_id, drop column if exists error;
--    drop table if exists public.print_agent_printers, public.print_agent_pairings, public.print_agents;
