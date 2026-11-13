-- =====================================================================
-- 20261116000000_caixa_por_operador.sql — caixa por operador (13/11), etapa 1
-- =====================================================================
-- O PROBLEMA
-- ----------
-- Hoje o estabelecimento tem UM caixa (cantina2:cashSession). No clube, dois
-- computadores operam gavetas separadas e o dinheiro troca de mão no meio da
-- noite. O dono quer cada gaveta com o seu turno, contagem às cegas na abertura
-- e no fechamento e trava quando a contagem não bate, até um administrador
-- (outro, não quem contou) ou o dono liberar.
--
-- A SOLUCAO
-- ---------
-- * Ajuste settings.caixaPorOperador (padrão false). Desligado = tudo como hoje.
-- * tenant_staff.opera_caixa ("Pode operar caixa"): marcação por colaborador.
--   Perfil caixa sempre tem (trigger); admin/dono sempre podem (cash_can_write).
-- * Tabela cash_turnos: uma linha por (estabelecimento, caixa) com o turno
--   aberto/travado (jsonb) e a última contagem de fechamento daquele caixa (o
--   esperado da próxima abertura). Leitura direta só admin/dono; os demais leem
--   por cash_turnos_ler() (redigido). Escrita só pelas RPCs abaixo, que travam
--   a linha (select ... for update).
-- * Diferença em centavos inteiros: round(contado*100) - round(esperado*100).
--   Sem margem: qualquer diferença trava. Nunca compara em ponto flutuante.
-- * Para quem não é admin/dono, as RPCs devolvem a pendência sem esperado e
--   diferença (conferência às cegas, PROD-05).
-- * cash_session_open/close (caminho antigo, um caixa só) recusam com o ajuste
--   ligado, para um aparelho com a versão velha não abrir o caixa "único".
--
-- RETESTE (bancada): node db/t-caixa-turnos.js
-- =====================================================================

-- Falha em 5s em vez de enfileirar as gravações do app atrás de uma transação longa.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Marcação "Pode operar caixa"
-- ---------------------------------------------------------------------
alter table public.tenant_staff add column if not exists opera_caixa boolean not null default false;
update public.tenant_staff set opera_caixa = true where role = 'caixa';

-- caixa por operador (13/11): perfil caixa sempre opera caixa. Sem isso, um caixa
-- cadastrado depois desta migration nasceria com opera_caixa = false e perderia o
-- caixa mesmo com o ajuste desligado (cash_can_write abaixo olha só a marcação).
create or replace function public.tenant_staff_caixa_opera_caixa()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.role = 'caixa' then
    new.opera_caixa := true;
  end if;
  return new;
end;
$function$;
revoke all on function public.tenant_staff_caixa_opera_caixa() from public, anon, authenticated;

drop trigger if exists tenant_staff_caixa_opera_caixa on public.tenant_staff;
create trigger tenant_staff_caixa_opera_caixa
  before insert or update of role, opera_caixa on public.tenant_staff
  for each row execute function public.tenant_staff_caixa_opera_caixa();

-- ---------------------------------------------------------------------
-- Quem é a sessão: id do colaborador, 'owner' para o dono, senão null
-- ---------------------------------------------------------------------
create or replace function public.current_staff_id()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when public.current_staff_role() = 'owner' then 'owner'
    else (select id from public.tenant_staff where auth_user_id = auth.uid() and active = true)
  end;
$function$;
revoke all on function public.current_staff_id() from public, anon;
grant execute on function public.current_staff_id() to authenticated, service_role;

-- caixa por operador (13/11): antes decidia só pelo perfil (= 'caixa'); agora pela
-- marcação opera_caixa (vale para qualquer perfil, inclusive garçom).
create or replace function public.cash_can_write()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select public.is_admin_like()
      or exists (select 1 from public.tenant_staff
                  where auth_user_id = auth.uid() and active = true and opera_caixa);
$function$;
revoke all on function public.cash_can_write() from public, anon;
grant execute on function public.cash_can_write() to authenticated;

-- ---------------------------------------------------------------------
-- Ajuste ligado?
-- ---------------------------------------------------------------------
-- Versão por estabelecimento: usada pela liberação da staff-auth (service_role, sem sessão).
create or replace function public.caixa_por_operador_ligado_em(p_tenant text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select case when jsonb_typeof(value) = 'object' and jsonb_typeof(value->'caixaPorOperador') = 'boolean'
                then (value->>'caixaPorOperador')::boolean else false end
      from public.app_data
     where tenant_id = p_tenant and key = 'cantina2:settings'), false);
$function$;
revoke all on function public.caixa_por_operador_ligado_em(text) from public, anon, authenticated;
grant execute on function public.caixa_por_operador_ligado_em(text) to service_role;

create or replace function public.caixa_por_operador_ligado()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select public.caixa_por_operador_ligado_em(public.current_tenant_id());
$function$;
revoke all on function public.caixa_por_operador_ligado() from public, anon;
grant execute on function public.caixa_por_operador_ligado() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tabela dos turnos
-- ---------------------------------------------------------------------
create table if not exists public.cash_turnos (
  tenant_id        text        not null,
  caixa_id         text        not null,
  turno            jsonb,
  ultima_contagem  numeric,
  updated_at       timestamptz default now(),
  constraint cash_turnos_pkey primary key (tenant_id, caixa_id),
  constraint cash_turnos_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade
);
alter table public.cash_turnos enable row level security;

-- Leitura direta só para admin/dono do próprio estabelecimento: a linha guarda o esperado
-- (ultima_contagem, pendencia.esperado) e a conferência às cegas tem de valer também contra
-- leitura direta pela API. Os demais leem por cash_turnos_ler(), já redigido.
-- Sem policy de escrita: só as RPCs gravam.
drop policy if exists cash_turnos_select on public.cash_turnos;
create policy cash_turnos_select on public.cash_turnos
  as permissive for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_admin_like()));

revoke all on table public.cash_turnos from public, anon, authenticated;
grant select on table public.cash_turnos to authenticated;
grant all on table public.cash_turnos to service_role;
-- Realtime: não entra na publicação (decisão do plano, Ruling 1: o front consulta a cada 5/30 s).

-- ---------------------------------------------------------------------
-- Ajudantes internos (não expostos ao navegador)
-- ---------------------------------------------------------------------
-- Nome de quem é a sessão/colaborador, pelo cadastro cantina2:users (id = tenant_staff.id).
create or replace function public.cash_turno_nome(p_tenant text, p_staff_id text)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select nullif(u->>'name', '')
       from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) u
      where a.tenant_id = p_tenant and a.key = 'cantina2:users' and u->>'id' = p_staff_id
      limit 1),
    case when p_staff_id = 'owner' then 'Dono' end);
$function$;
revoke all on function public.cash_turno_nome(text, text) from public, anon, authenticated;

-- Diferença em reais a partir de centavos inteiros (sem ponto flutuante).
create or replace function public.cash_turno_dif(p_contado numeric, p_esperado numeric)
returns numeric
language sql
immutable
set search_path to ''
as $function$
  select round(((round(p_contado * 100) - round(p_esperado * 100)) / 100.0)::numeric, 2);
$function$;
revoke all on function public.cash_turno_dif(numeric, numeric) from public, anon, authenticated;

-- O que a sessão pode ver do turno: sem esperado/diferença para quem não é admin/dono.
create or replace function public.cash_turno_visivel(p_turno jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v jsonb := p_turno;
begin
  if v is null or jsonb_typeof(v) <> 'object' or public.is_admin_like() then
    return v;
  end if;
  if jsonb_typeof(v->'pendencia') = 'object' then
    v := jsonb_set(v, '{pendencia}', (v->'pendencia') - 'esperado' - 'diferenca');
    if jsonb_typeof(v->'pendencia'->'closed') = 'object' then
      v := jsonb_set(v, '{pendencia,closed}', (v->'pendencia'->'closed') - 'expectedAmount' - 'diff' - 'expectedCard');
    end if;
  end if;
  if jsonb_typeof(v->'liberacoes') = 'array' then
    v := jsonb_set(v, '{liberacoes}', coalesce(
      (select jsonb_agg(l - 'esperado' - 'diferenca' order by o)
         from jsonb_array_elements(v->'liberacoes') with ordinality as x(l, o)), '[]'::jsonb));
  end if;
  return v;
end;
$function$;
revoke all on function public.cash_turno_visivel(jsonb) from public, anon, authenticated;

create or replace function public.cash_turno_agora()
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$function$;
revoke all on function public.cash_turno_agora() from public, anon, authenticated;

-- Resposta padrão {ok, turno, motivo?}.
create or replace function public.cash_turno_resp(p_ok boolean, p_turno jsonb, p_motivo text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object('ok', p_ok, 'turno', public.cash_turno_visivel(p_turno))
      || case when p_motivo is null then '{}'::jsonb else jsonb_build_object('motivo', p_motivo) end;
$function$;
revoke all on function public.cash_turno_resp(boolean, jsonb, text) from public, anon, authenticated;

-- Conclui o fechamento: põe no topo de cashHistory (sem duplicar o id), grava a última
-- contagem do caixa e limpa o turno. A linha de cash_turnos já está travada por quem chama.
create or replace function public.cash_turno_concluir_fechamento(p_tenant text, p_caixa text, p_turno jsonb, p_closed jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_history jsonb;
  v_closed jsonb;
begin
  v_closed := (p_closed - 'pendencia') || jsonb_build_object(
    'status', 'closed',
    'caixaId', p_caixa,
    'liberacoes', coalesce(p_turno->'liberacoes', '[]'::jsonb));

  insert into public.app_data (tenant_id, key, value)
  values (p_tenant, 'cantina2:cashHistory', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_history from public.app_data
   where tenant_id = p_tenant and key = 'cantina2:cashHistory'
   for update;
  if jsonb_typeof(v_history) <> 'array' then
    v_history := '[]'::jsonb;
  end if;

  if not exists (select 1 from jsonb_array_elements(v_history) e where e->>'id' = v_closed->>'id') then
    v_history := jsonb_build_array(v_closed) || v_history;
    update public.app_data set value = v_history, updated_at = now()
     where tenant_id = p_tenant and key = 'cantina2:cashHistory';
  end if;

  update public.cash_turnos
     set turno = null, ultima_contagem = (v_closed->>'countedAmount')::numeric, updated_at = now()
   where tenant_id = p_tenant and caixa_id = p_caixa;
end;
$function$;
revoke all on function public.cash_turno_concluir_fechamento(text, text, jsonb, jsonb) from public, anon, authenticated;

-- Aplica a pendência liberada (por PIN de admin ou pelo dono). Devolve o turno novo (null se fechou).
create or replace function public.cash_turno_aplicar_liberacao(p_tenant text, p_caixa text, p_turno jsonb,
                                                               p_por text, p_por_nome text, p_como text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_p jsonb := p_turno->'pendencia';
  v_turno jsonb;
  v_lib jsonb;
begin
  v_lib := jsonb_build_object(
    'tipo', v_p->'tipo', 'por', p_por, 'porNome', p_por_nome, 'como', p_como,
    'esperado', v_p->'esperado', 'contado', v_p->'contado', 'diferenca', v_p->'diferenca',
    'at', public.cash_turno_agora());
  v_turno := (p_turno - 'pendencia')
          || jsonb_build_object('liberacoes', coalesce(p_turno->'liberacoes', '[]'::jsonb) || jsonb_build_array(v_lib));

  if v_p->>'tipo' = 'abertura' then
    v_turno := v_turno || jsonb_build_object('status', 'open', 'openingAmount', v_p->'contado');
    update public.cash_turnos set turno = v_turno, updated_at = now()
     where tenant_id = p_tenant and caixa_id = p_caixa;
    return v_turno;
  end if;

  perform public.cash_turno_concluir_fechamento(p_tenant, p_caixa, v_turno, v_p->'closed');
  return null;
end;
$function$;
revoke all on function public.cash_turno_aplicar_liberacao(text, text, jsonb, text, text, text) from public, anon, authenticated;

-- Checagens comuns das RPCs do navegador.
create or replace function public.cash_turno_checar()
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para operar o caixa';
  end if;
  if not public.caixa_por_operador_ligado() then
    raise exception 'caixa por operador desligado';
  end if;
  return v_tenant;
end;
$function$;
revoke all on function public.cash_turno_checar() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
-- Leitura dos turnos do estabelecimento (caixa por operador, 13/11): para quem não é
-- admin/dono, sem esperado/diferença e sem ultima_contagem (conferência às cegas).
create or replace function public.cash_turnos_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_admin boolean := public.is_admin_like();
begin
  if v_tenant is null then
    raise exception 'sem permissao para ler o caixa';
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object('caixa_id', t.caixa_id, 'turno', public.cash_turno_visivel(t.turno))
             || case when v_admin then jsonb_build_object('ultima_contagem', t.ultima_contagem) else '{}'::jsonb end
             order by t.caixa_id)
      from public.cash_turnos t
     where t.tenant_id = v_tenant), '[]'::jsonb);
end;
$function$;
revoke all on function public.cash_turnos_ler() from public, anon;
grant execute on function public.cash_turnos_ler() to authenticated;

create or replace function public.cash_turno_abrir(p_caixa text, p_contado numeric, p_nota text, p_turno jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_turno_checar();
  v_me text := public.current_staff_id();
  v_row public.cash_turnos%rowtype;
  v_outro jsonb;
  v_history jsonb;
  v_abertos int;
  v_turno jsonb;
  v_dif numeric;
  v_nome text;
begin
  if coalesce(p_caixa, '') = '' or length(p_caixa) > 60 then
    raise exception 'caixa invalido';
  end if;
  if p_contado is null or p_contado < 0 then
    raise exception 'contagem invalida';
  end if;
  if p_turno is null or jsonb_typeof(p_turno) <> 'object' or coalesce(p_turno->>'id', '') = '' then
    raise exception 'turno invalido';
  end if;
  if v_me is null then
    raise exception 'sem permissao para operar o caixa';
  end if;

  -- Uma pessoa, um turno: trava por (estabelecimento, pessoa) antes da linha do caixa,
  -- para duas aberturas da mesma pessoa em caixas diferentes não passarem juntas.
  perform pg_advisory_xact_lock(hashtextextended('cash_turno:' || v_tenant || ':' || v_me, 0));

  insert into public.cash_turnos (tenant_id, caixa_id) values (v_tenant, p_caixa)
  on conflict (tenant_id, caixa_id) do nothing;

  select * into v_row from public.cash_turnos
   where tenant_id = v_tenant and caixa_id = p_caixa
   for update;

  if v_row.turno is not null and coalesce(v_row.turno->>'status', '') <> 'closed' then
    return public.cash_turno_resp(false, v_row.turno, 'ja_aberto');
  end if;

  select turno into v_outro from public.cash_turnos
   where tenant_id = v_tenant and caixa_id <> p_caixa and turno is not null
     and turno->>'operatorId' = v_me
   limit 1;
  if v_outro is not null then
    return public.cash_turno_resp(false, v_outro, 'outro_turno');
  end if;

  select value into v_history from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashHistory';
  select count(*) into v_abertos from public.cash_turnos
   where tenant_id = v_tenant and caixa_id <> p_caixa and turno is not null;

  v_nome := coalesce(public.cash_turno_nome(v_tenant, v_me), nullif(p_turno->>'operatorName', ''));
  v_turno := (p_turno - 'pendencia' - 'primeiraAbertura' - 'liberacoes' - 'fechadoNoLugarDe')
          || jsonb_build_object(
               'caixaId', p_caixa,
               'operatorId', v_me,
               'operatorName', v_nome,
               'openedAt', public.cash_turno_agora(),
               'openingNote', left(coalesce(p_nota, ''), 500),
               'displayId', (case when jsonb_typeof(v_history) = 'array' then jsonb_array_length(v_history) else 0 end) + v_abertos + 1,
               'liberacoes', '[]'::jsonb);

  if v_row.ultima_contagem is null then
    -- Primeira abertura deste caixa: não há contagem anterior para comparar.
    v_turno := v_turno || jsonb_build_object('status', 'open', 'openingAmount', p_contado, 'primeiraAbertura', true);
  else
    v_dif := public.cash_turno_dif(p_contado, v_row.ultima_contagem);
    if v_dif = 0 then
      v_turno := v_turno || jsonb_build_object('status', 'open', 'openingAmount', p_contado);
    else
      v_turno := v_turno || jsonb_build_object(
        'status', 'travado_abertura',
        'openingAmount', null,
        'pendencia', jsonb_build_object(
          'id', gen_random_uuid()::text, 'tipo', 'abertura',
          'contouId', v_me, 'contouNome', v_nome,
          'esperado', v_row.ultima_contagem, 'contado', p_contado, 'diferenca', v_dif,
          'pedidoDono', false, 'at', public.cash_turno_agora()));
    end if;
  end if;

  update public.cash_turnos set turno = v_turno, updated_at = now()
   where tenant_id = v_tenant and caixa_id = p_caixa;

  return public.cash_turno_resp(true, v_turno, null);
end;
$function$;
revoke all on function public.cash_turno_abrir(text, numeric, text, jsonb) from public, anon;
grant execute on function public.cash_turno_abrir(text, numeric, text, jsonb) to authenticated;

create or replace function public.cash_turno_recontar(p_caixa text, p_turno_id text, p_contado numeric)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_turno_checar();
  v_me text := public.current_staff_id();
  v_turno jsonb;
  v_p jsonb;
  v_dif numeric;
begin
  if p_contado is null or p_contado < 0 then
    raise exception 'contagem invalida';
  end if;

  select turno into v_turno from public.cash_turnos
   where tenant_id = v_tenant and caixa_id = p_caixa
   for update;

  if v_turno is null or v_turno->>'id' is distinct from p_turno_id then
    return public.cash_turno_resp(false, v_turno, 'turno_mudou');
  end if;
  if v_turno->>'status' not in ('travado_abertura', 'travado_fechamento') then
    return public.cash_turno_resp(false, v_turno, 'nao_travado');
  end if;
  if not public.is_admin_like() and v_turno->>'operatorId' is distinct from v_me then
    return public.cash_turno_resp(false, v_turno, 'outro_operador');
  end if;

  v_p := v_turno->'pendencia';
  v_dif := public.cash_turno_dif(p_contado, (v_p->>'esperado')::numeric);

  if v_dif = 0 then
    if v_p->>'tipo' = 'abertura' then
      v_turno := (v_turno - 'pendencia') || jsonb_build_object('status', 'open', 'openingAmount', p_contado);
      update public.cash_turnos set turno = v_turno, updated_at = now()
       where tenant_id = v_tenant and caixa_id = p_caixa;
      return public.cash_turno_resp(true, v_turno, null);
    end if;
    perform public.cash_turno_concluir_fechamento(v_tenant, p_caixa, v_turno,
      (v_p->'closed') || jsonb_build_object('countedAmount', p_contado, 'diff', 0));
    return public.cash_turno_resp(true, null, null);
  end if;

  -- Contagem nova = pendência nova (id novo): uma liberação aberta na tela de alguém
  -- para a contagem anterior não vale para esta.
  v_p := (v_p - 'recusada') || jsonb_build_object(
    'id', gen_random_uuid()::text,
    'contouId', v_me, 'contouNome', public.cash_turno_nome(v_tenant, v_me),
    'contado', p_contado, 'diferenca', v_dif, 'at', public.cash_turno_agora());
  if v_p->>'tipo' = 'fechamento' then
    v_p := jsonb_set(v_p, '{closed}', (v_p->'closed') || jsonb_build_object('countedAmount', p_contado, 'diff', v_dif));
  end if;
  v_turno := jsonb_set(v_turno, '{pendencia}', v_p);
  update public.cash_turnos set turno = v_turno, updated_at = now()
   where tenant_id = v_tenant and caixa_id = p_caixa;
  return public.cash_turno_resp(true, v_turno, null);
end;
$function$;
revoke all on function public.cash_turno_recontar(text, text, numeric) from public, anon;
grant execute on function public.cash_turno_recontar(text, text, numeric) to authenticated;

create or replace function public.cash_turno_fechar(p_caixa text, p_turno_id text, p_closed jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_turno_checar();
  v_me text := public.current_staff_id();
  v_turno jsonb;
  v_closed jsonb;
  v_dif numeric;
begin
  if p_closed is null or jsonb_typeof(p_closed) <> 'object' or p_closed->>'id' is distinct from p_turno_id
     or jsonb_typeof(p_closed->'countedAmount') <> 'number' or jsonb_typeof(p_closed->'expectedAmount') <> 'number'
     or (p_closed->>'countedAmount')::numeric < 0 then
    raise exception 'fechamento de caixa invalido';
  end if;

  select turno into v_turno from public.cash_turnos
   where tenant_id = v_tenant and caixa_id = p_caixa
   for update;

  if v_turno is null or v_turno->>'id' is distinct from p_turno_id then
    return public.cash_turno_resp(false, v_turno, 'turno_mudou');
  end if;
  if v_turno->>'status' is distinct from 'open' then
    return public.cash_turno_resp(false, v_turno, 'nao_aberto');
  end if;
  if not public.is_admin_like() and v_turno->>'operatorId' is distinct from v_me then
    return public.cash_turno_resp(false, v_turno, 'outro_operador');
  end if;

  v_closed := p_closed - 'pendencia' - 'fechadoNoLugarDe';
  if v_turno->>'operatorId' is distinct from v_me then
    -- Turno esquecido: admin/dono fecha no lugar de quem abriu.
    v_closed := v_closed || jsonb_build_object('fechadoNoLugarDe',
      jsonb_build_object('id', v_turno->'operatorId', 'nome', v_turno->'operatorName'));
  end if;

  v_dif := public.cash_turno_dif((p_closed->>'countedAmount')::numeric, (p_closed->>'expectedAmount')::numeric);
  if v_dif = 0 then
    perform public.cash_turno_concluir_fechamento(v_tenant, p_caixa, v_turno, v_closed);
    return public.cash_turno_resp(true, null, null);
  end if;

  v_turno := v_turno || jsonb_build_object(
    'status', 'travado_fechamento',
    'pendencia', jsonb_build_object(
      'id', gen_random_uuid()::text, 'tipo', 'fechamento',
      'contouId', v_me, 'contouNome', public.cash_turno_nome(v_tenant, v_me),
      'esperado', p_closed->'expectedAmount', 'contado', p_closed->'countedAmount', 'diferenca', v_dif,
      'pedidoDono', false, 'at', public.cash_turno_agora(),
      'closed', v_closed));
  update public.cash_turnos set turno = v_turno, updated_at = now()
   where tenant_id = v_tenant and caixa_id = p_caixa;
  return public.cash_turno_resp(true, v_turno, null);
end;
$function$;
revoke all on function public.cash_turno_fechar(text, text, jsonb) from public, anon;
grant execute on function public.cash_turno_fechar(text, text, jsonb) to authenticated;

create or replace function public.cash_turno_pedir_dono(p_caixa text, p_turno_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_turno_checar();
  v_me text := public.current_staff_id();
  v_turno jsonb;
begin
  select turno into v_turno from public.cash_turnos
   where tenant_id = v_tenant and caixa_id = p_caixa
   for update;

  if v_turno is null or v_turno->>'id' is distinct from p_turno_id then
    return public.cash_turno_resp(false, v_turno, 'turno_mudou');
  end if;
  if jsonb_typeof(v_turno->'pendencia') is distinct from 'object' then
    return public.cash_turno_resp(false, v_turno, 'nao_travado');
  end if;
  if not public.is_admin_like() and v_turno->>'operatorId' is distinct from v_me then
    return public.cash_turno_resp(false, v_turno, 'outro_operador');
  end if;

  v_turno := jsonb_set(v_turno, '{pendencia}',
    ((v_turno->'pendencia') - 'recusada') || jsonb_build_object('pedidoDono', true));
  update public.cash_turnos set turno = v_turno, updated_at = now()
   where tenant_id = v_tenant and caixa_id = p_caixa;
  return public.cash_turno_resp(true, v_turno, null);
end;
$function$;
revoke all on function public.cash_turno_pedir_dono(text, text) from public, anon;
grant execute on function public.cash_turno_pedir_dono(text, text) to authenticated;

-- Só o dono (current_staff_role() = 'owner' já respeita a trava de duas etapas, 20261115000000).
-- O dono pode liberar a própria contagem (o dinheiro é dele).
create or replace function public.cash_turno_liberar_dono(p_caixa text, p_turno_id text, p_pendencia_id text, p_aprovar boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_turno_checar();
  v_turno jsonb;
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'so o dono libera por aqui';
  end if;
  if p_aprovar is null then
    raise exception 'decisao invalida';
  end if;

  select turno into v_turno from public.cash_turnos
   where tenant_id = v_tenant and caixa_id = p_caixa
   for update;

  if v_turno is null or v_turno->>'id' is distinct from p_turno_id then
    return public.cash_turno_resp(false, v_turno, 'turno_mudou');
  end if;
  if jsonb_typeof(v_turno->'pendencia') is distinct from 'object' then
    return public.cash_turno_resp(false, v_turno, 'nao_travado');
  end if;
  if v_turno->'pendencia'->>'id' is distinct from p_pendencia_id then
    return public.cash_turno_resp(false, v_turno, 'pendencia_mudou');
  end if;

  if not p_aprovar then
    v_turno := jsonb_set(v_turno, '{pendencia}',
      (v_turno->'pendencia') || jsonb_build_object('pedidoDono', false, 'recusada', true));
    update public.cash_turnos set turno = v_turno, updated_at = now()
     where tenant_id = v_tenant and caixa_id = p_caixa;
    return public.cash_turno_resp(true, v_turno, null);
  end if;

  v_turno := public.cash_turno_aplicar_liberacao(v_tenant, p_caixa, v_turno, 'owner',
               public.cash_turno_nome(v_tenant, 'owner'), 'dono');
  return public.cash_turno_resp(true, v_turno, null);
end;
$function$;
revoke all on function public.cash_turno_liberar_dono(text, text, text, boolean) from public, anon;
grant execute on function public.cash_turno_liberar_dono(text, text, text, boolean) to authenticated;

-- Só a staff-auth (service_role), depois de conferir o PIN do admin. Confere de novo aqui
-- que é admin ativo do estabelecimento e que não foi ele quem contou.
create or replace function public.cash_turno_liberar_admin(p_tenant text, p_caixa text, p_turno_id text,
                                                           p_pendencia_id text, p_admin_id text, p_admin_nome text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_turno jsonb;
begin
  if coalesce(p_tenant, '') = '' or not public.caixa_por_operador_ligado_em(p_tenant) then
    raise exception 'caixa por operador desligado';
  end if;
  if not exists (select 1 from public.tenant_staff
                  where id = p_admin_id and tenant_id = p_tenant and role = 'admin' and active = true) then
    raise exception 'so administrador libera o caixa';
  end if;

  select turno into v_turno from public.cash_turnos
   where tenant_id = p_tenant and caixa_id = p_caixa
   for update;

  if v_turno is null or v_turno->>'id' is distinct from p_turno_id then
    return public.cash_turno_resp(false, v_turno, 'turno_mudou');
  end if;
  if jsonb_typeof(v_turno->'pendencia') is distinct from 'object' then
    return public.cash_turno_resp(false, v_turno, 'nao_travado');
  end if;
  if v_turno->'pendencia'->>'id' is distinct from p_pendencia_id then
    return public.cash_turno_resp(false, v_turno, 'pendencia_mudou');
  end if;
  if v_turno->'pendencia'->>'contouId' = p_admin_id then
    raise exception 'quem contou nao pode liberar a propria contagem';
  end if;

  v_turno := public.cash_turno_aplicar_liberacao(p_tenant, p_caixa, v_turno, p_admin_id,
               coalesce(nullif(p_admin_nome, ''), public.cash_turno_nome(p_tenant, p_admin_id)), 'pin');
  -- Sem sessão de usuário: devolve o turno sem esperado/diferença (vai para o aparelho do caixa).
  return public.cash_turno_resp(true, v_turno, null);
end;
$function$;
revoke all on function public.cash_turno_liberar_admin(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.cash_turno_liberar_admin(text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Caminho antigo (um caixa só): copiado de 20261010010000_caixa_com_trava.sql;
-- muda só a recusa com o ajuste ligado (caixa por operador, 13/11).
-- ---------------------------------------------------------------------
create or replace function public.cash_session_open(p_session jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_current jsonb;
  v_history jsonb;
  v_session jsonb;
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para abrir o caixa';
  end if;
  if public.caixa_por_operador_ligado() then
    raise exception 'caixa por operador ligado: recarregue a página';
  end if;
  if p_session is null or jsonb_typeof(p_session) <> 'object' or coalesce(p_session->>'id', '') = '' then
    raise exception 'sessao de caixa invalida';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:cashSession', '{"__commandahNull": true}'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_current from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashSession'
   for update;

  if not public.app_data_is_null(v_current) and coalesce(v_current->>'status', 'open') = 'open' then
    return jsonb_build_object('ok', false, 'session', v_current);
  end if;

  select value into v_history from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashHistory';

  v_session := p_session || jsonb_build_object(
    'status', 'open',
    'openedAt', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'displayId', case when jsonb_typeof(v_history) = 'array' then jsonb_array_length(v_history) + 1 else 1 end
  );

  update public.app_data set value = v_session, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:cashSession';

  return jsonb_build_object('ok', true, 'session', v_session);
end;
$function$;
revoke all on function public.cash_session_open(jsonb) from public, anon;
grant execute on function public.cash_session_open(jsonb) to authenticated;

create or replace function public.cash_session_close(p_session_id text, p_closed jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_current jsonb;
  v_history jsonb;
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para fechar o caixa';
  end if;
  if public.caixa_por_operador_ligado() then
    raise exception 'caixa por operador ligado: recarregue a página';
  end if;
  if p_closed is null or jsonb_typeof(p_closed) <> 'object' or p_closed->>'id' is distinct from p_session_id then
    raise exception 'fechamento de caixa invalido';
  end if;

  select value into v_current from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashSession'
   for update;

  if v_current is null or public.app_data_is_null(v_current) or v_current->>'id' is distinct from p_session_id then
    return jsonb_build_object('ok', false, 'session', case when public.app_data_is_null(v_current) then null else v_current end);
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:cashHistory', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_history from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashHistory'
   for update;
  if jsonb_typeof(v_history) <> 'array' then
    v_history := '[]'::jsonb;
  end if;

  -- Já está no histórico (tentativa repetida): não duplica.
  if not exists (select 1 from jsonb_array_elements(v_history) e where e->>'id' = p_session_id) then
    v_history := jsonb_build_array(p_closed) || v_history;
    update public.app_data set value = v_history, updated_at = now()
     where tenant_id = v_tenant and key = 'cantina2:cashHistory';
  end if;

  update public.app_data set value = '{"__commandahNull": true}'::jsonb, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:cashSession';

  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.cash_session_close(text, jsonb) from public, anon;
grant execute on function public.cash_session_close(text, jsonb) to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.cash_turno_liberar_admin(text, text, text, text, text, text);
-- drop function if exists public.cash_turno_liberar_dono(text, text, text, boolean);
-- drop function if exists public.cash_turno_pedir_dono(text, text);
-- drop function if exists public.cash_turno_fechar(text, text, jsonb);
-- drop function if exists public.cash_turno_recontar(text, text, numeric);
-- drop function if exists public.cash_turno_abrir(text, numeric, text, jsonb);
-- drop function if exists public.cash_turnos_ler();
-- drop function if exists public.cash_turno_checar();
-- drop function if exists public.cash_turno_aplicar_liberacao(text, text, jsonb, text, text, text);
-- drop function if exists public.cash_turno_concluir_fechamento(text, text, jsonb, jsonb);
-- drop function if exists public.cash_turno_resp(boolean, jsonb, text);
-- drop function if exists public.cash_turno_agora();
-- drop function if exists public.cash_turno_visivel(jsonb);
-- drop function if exists public.cash_turno_dif(numeric, numeric);
-- drop function if exists public.cash_turno_nome(text, text);
-- drop table if exists public.cash_turnos;
-- drop function if exists public.caixa_por_operador_ligado();
-- drop function if exists public.caixa_por_operador_ligado_em(text);
-- recriar cash_session_open/close e cash_can_write de 20261010010000_caixa_com_trava.sql
--   (cash_can_write: select public.is_admin_like() or public.current_staff_role() = 'caixa';
--    language sql stable, sem security definer)
-- drop function if exists public.current_staff_id();
-- drop trigger if exists tenant_staff_caixa_opera_caixa on public.tenant_staff;
-- drop function if exists public.tenant_staff_caixa_opera_caixa();
-- alter table public.tenant_staff drop column if exists opera_caixa;
-- =====================================================================
