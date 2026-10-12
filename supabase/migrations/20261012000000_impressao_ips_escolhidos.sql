-- =====================================================================
-- t108 (12/10/2026): impressoras de rede escolhidas pelo IP + busca na rede desligável
--
-- Por quê: no clube as impressoras ficam na rede 192.168.110.x junto com as do
-- Saipos. O agente 2.1 varre a faixa inteira a cada 30 min (abre e fecha a porta
-- 9100 de cada endereço). O dono quer poder desligar isso e imprimir só nos IPs
-- escolhidos, inclusive IPs fora da faixa do computador.
--
-- O que muda:
--   * print_agents.scan_network (padrão true = como hoje). Desligado: o agente 2.2
--     não varre a rede; confere só os IPs adicionados à mão. Ao desligar, as
--     impressoras de rede que ele tinha encontrado sozinho saem da lista (o
--     Commandah antes transforma em "adicionadas à mão" as que já imprimem algo).
--   * print_agent_printers.manual: impressora de rede adicionada pelo IP.
--   * print_agent_ping devolve 'scan' e 'check_ips' (agente 2.1 ignora os dois).
--   * print_agent_report: com a busca desligada, não cria impressora nova a partir
--     do que o agente contar (protege contra agente 2.1 que continua varrendo).
--   * print_setup_state devolve scan_network e manual.
--   * print_agent_manage ganha 'scan_on', 'scan_off', 'add_ip' e 'remove_ip'
--     (remove_ip sem computador = tira o IP de todos). Tudo vai para o audit_log.
-- Nenhuma assinatura muda: agente 2.0/2.1 e o site antigo continuam funcionando.
-- =====================================================================

alter table public.print_agents         add column if not exists scan_network boolean not null default true;
alter table public.print_agent_printers add column if not exists manual       boolean not null default false;

-- ---------------------------------------------------------------------
-- Endereço de impressora de rede válido: 4 números de 0 a 255 e porta opcional.
-- ---------------------------------------------------------------------
create or replace function public.print_ip_valid(p_ip text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  -- O case garante que só converte para número depois de conferir o formato.
  select case
    when p_ip is null or p_ip !~ '^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$' then false
    else (select bool_and(x::int <= 255) from unnest(string_to_array(split_part(p_ip, ':', 1), '.')) x)
         and (position(':' in p_ip) = 0 or split_part(p_ip, ':', 2)::int between 1 and 65535)
  end;
$function$;
revoke all on function public.print_ip_valid(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- O agente conta o que encontrou (mesma assinatura da 20261011070000)
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
  v_scan boolean;
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
   where id = v_agent
  returning scan_network into v_scan;

  if jsonb_typeof(p_windows) = 'array' then
    for v_name in select distinct left(trim(x), 200) from jsonb_array_elements_text(p_windows) x where length(trim(x)) > 0 limit 60 loop
      insert into public.print_agent_printers (tenant_id, agent_id, kind, name)
      values (v_tenant, v_agent, 'windows', v_name)
      on conflict (agent_id, kind, name) do update set last_seen_at = now();
    end loop;
  end if;
  if jsonb_typeof(p_network) = 'array' then
    for v_name in select distinct trim(x) from jsonb_array_elements_text(p_network) x
                   where public.print_ip_valid(trim(x)) limit 60 loop
      if v_scan then
        insert into public.print_agent_printers (tenant_id, agent_id, kind, name)
        values (v_tenant, v_agent, 'rede', v_name)
        on conflict (agent_id, kind, name) do update set last_seen_at = now();
      else
        -- Busca desligada: só confirma as que já estão na lista (as escolhidas).
        update public.print_agent_printers set last_seen_at = now()
         where agent_id = v_agent and kind = 'rede' and name = v_name;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.print_agent_report(text, text, text, jsonb, jsonb) from public;
grant execute on function public.print_agent_report(text, text, text, jsonb, jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Ping: + 'scan' e 'check_ips'
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
  select name, rescan_requested_at, last_scan_at, scan_network into v_row from public.print_agents where id = v_agent;
  return jsonb_build_object('ok', true, 'server_time', now(), 'agent_id', v_agent, 'name', v_row.name,
    'rescan', v_row.rescan_requested_at is not null and v_row.rescan_requested_at > coalesce(v_row.last_scan_at, '-infinity'::timestamptz),
    'scan', v_row.scan_network,
    'check_ips', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
                    from public.print_agent_printers p
                   where p.agent_id = v_agent and p.kind = 'rede' and p.manual));
end;
$function$;
revoke all on function public.print_agent_ping(text) from public;
grant execute on function public.print_agent_ping(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tela de configuração: + scan_network e manual
-- ---------------------------------------------------------------------
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
                 'last_seen_at', last_seen_at, 'last_scan_at', last_scan_at, 'scan_network', scan_network) order by created_at), '[]'::jsonb)
               from public.print_agents where tenant_id = v_tenant),
    'printers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', id, 'agent_id', agent_id, 'kind', kind, 'name', name, 'manual', manual, 'first_seen_at', first_seen_at,
                 'last_seen_at', last_seen_at, 'last_ok_at', last_ok_at, 'last_error_at', last_error_at,
                 'last_error', last_error) order by kind desc, name), '[]'::jsonb)
               from public.print_agent_printers where tenant_id = v_tenant),
    'legacy_token', (select jsonb_build_object('last_seen_at', last_seen_at, 'rotated_at', rotated_at)
                     from public.print_agent_tokens where tenant_id = v_tenant));
end;
$function$;
revoke all on function public.print_setup_state() from public, anon;
grant execute on function public.print_setup_state() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Ações da tela: + scan_on, scan_off, add_ip, remove_ip
-- ---------------------------------------------------------------------
create or replace function public.print_agent_manage(p_action text, p_agent_id uuid default null, p_name text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_name text;
  v_ip text := trim(coalesce(p_name, ''));
  v_by text := nullif(left(coalesce(p_by, ''), 120), '');
begin
  if v_tenant is null or not public.is_admin_like() then
    raise exception 'Só o administrador configura a impressão.' using errcode = '42501';
  end if;
  if p_action = 'rescan' then
    update public.print_agents set rescan_requested_at = now() where tenant_id = v_tenant;
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'remove_ip' and p_agent_id is null then
    delete from public.print_agent_printers where tenant_id = v_tenant and kind = 'rede' and name = v_ip;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, 'Impressora de rede removida: ' || v_ip, 'print_agent', null, '{}'::jsonb);
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
    values (v_by, 'Computador de impressão removido: ' || v_name, 'print_agent', p_agent_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
  elsif p_action in ('scan_on', 'scan_off') then
    update public.print_agents
       set scan_network = (p_action = 'scan_on'),
           rescan_requested_at = case when p_action = 'scan_on' then now() else rescan_requested_at end
     where id = p_agent_id;
    if p_action = 'scan_off' then
      delete from public.print_agent_printers where agent_id = p_agent_id and kind = 'rede' and not manual;
    end if;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, case when p_action = 'scan_on' then 'Busca de impressoras na rede ligada: ' else 'Busca de impressoras na rede desligada: ' end || v_name,
            'print_agent', p_agent_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
  elsif p_action = 'add_ip' then
    if not public.print_ip_valid(v_ip) then
      raise exception 'IP inválido. Use o formato 192.168.110.113 (a porta, se for diferente de 9100, vai depois de dois-pontos).';
    end if;
    insert into public.print_agent_printers (tenant_id, agent_id, kind, name, manual)
    values (v_tenant, p_agent_id, 'rede', v_ip, true)
    on conflict (agent_id, kind, name) do update set manual = true;
    -- O agente confere o IP novo no próximo ping (até 1 minuto).
    update public.print_agents set rescan_requested_at = now() where id = p_agent_id;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, 'Impressora de rede adicionada pelo IP: ' || v_ip || ' em ' || v_name, 'print_agent', p_agent_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
  elsif p_action = 'remove_ip' then
    delete from public.print_agent_printers where agent_id = p_agent_id and kind = 'rede' and name = v_ip;
    insert into public.audit_log (actor_name, action, entity, entity_id, meta)
    values (v_by, 'Impressora de rede removida: ' || v_ip || ' de ' || v_name, 'print_agent', p_agent_id::text, '{}'::jsonb);
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
-- 1. Recriar print_agent_report, print_agent_ping, print_setup_state e
--    print_agent_manage como em 20261011070000.
-- 2. drop function if exists public.print_ip_valid(text);
-- 3. alter table public.print_agent_printers drop column if exists manual;
--    alter table public.print_agents drop column if exists scan_network;
