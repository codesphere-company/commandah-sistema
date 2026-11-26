-- Caixa por operador: passagem de caixa sem contagem (26/11/2026, pedido do dono).
-- "No clube, é inviável contar na troca de pessoa para a janta." Escolha do dono: só na troca.
-- Com Configurações › Caixa por operador › "Contar o dinheiro na passagem de caixa" desligado
-- (settings.contarNaTroca = false):
--   * Passar o caixa não pede contagem: o servidor fecha o turno com contado = esperado e marca
--     cash_turnos.sem_contagem.
--   * A abertura seguinte desse caixa não pede contagem: o turno abre com o valor que ficou
--     (ultima_contagem) e marca aberturaSemContagem.
--   * Fim da noite continua contado (cofre), e a abertura depois dele também.
-- Ligado (padrão) ou ausente: tudo como antes. As funções abaixo são cópias das versões em produção
-- (20261116000000_caixa_por_operador.sql e 20261121000000_caixa_cofre.sql) só com esses trechos novos.

alter table public.cash_turnos add column if not exists sem_contagem boolean not null default false;

-- Lê a opção nas configurações do estabelecimento. Ausente ou diferente de false = contar.
create or replace function public.cash_contar_na_troca(p_tenant text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((select not (a.value->'contarNaTroca' = 'false'::jsonb)
                     from public.app_data a
                    where a.tenant_id = p_tenant and a.key = 'cantina2:settings' and jsonb_typeof(a.value) = 'object'), true);
$function$;
revoke all on function public.cash_contar_na_troca(text) from public, anon, authenticated;

create or replace function public.cash_turno_concluir_fechamento(p_tenant text, p_caixa text, p_turno jsonb, p_closed jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_history jsonb;
  v_closed jsonb;
  v_ultima numeric;
  v_troco numeric;
  v_para numeric := 0;
  v_fim boolean := jsonb_typeof(p_closed->'fimDaNoite') = 'boolean' and (p_closed->>'fimDaNoite')::boolean;
begin
  v_closed := (p_closed - 'pendencia' - 'fimDaNoite' - 'troco' - 'paraCofre') || jsonb_build_object(
    'status', 'closed',
    'caixaId', p_caixa,
    'liberacoes', coalesce(p_turno->'liberacoes', '[]'::jsonb));
  v_ultima := (v_closed->>'countedAmount')::numeric;

  if v_fim and v_ultima is not null then
    v_troco := public.cash_caixa_troco(p_tenant, p_caixa);
    if round(v_ultima * 100) > round(v_troco * 100) then
      v_para := public.cash_turno_dif(v_ultima, v_troco);
      if not exists (select 1 from public.cash_cofre
                      where tenant_id = p_tenant and turno_id = v_closed->>'id' and origem = 'fim_da_noite') then
        perform public.cash_cofre_entrada(p_tenant, p_caixa, v_closed->>'id', v_para, 'fim_da_noite', p_turno->>'operatorId');
      end if;
      v_ultima := v_troco;
    end if;
    v_closed := v_closed || jsonb_build_object('fimDaNoite', true, 'troco', v_troco, 'paraCofre', v_para);
  end if;

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
     set turno = null, ultima_contagem = v_ultima, updated_at = now(),
         sem_contagem = (jsonb_typeof(p_closed->'semContagem') = 'boolean' and (p_closed->>'semContagem')::boolean and not v_fim)
   where tenant_id = p_tenant and caixa_id = p_caixa;
end;
$function$;
revoke all on function public.cash_turno_concluir_fechamento(text, text, jsonb, jsonb) from public, anon, authenticated;

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

  -- 26/11 (troca sem contagem): passagem de caixa sem contar, só com a opção desligada e nunca no fim da noite.
  if jsonb_typeof(p_closed->'semContagem') = 'boolean' and (p_closed->>'semContagem')::boolean then
    if public.cash_contar_na_troca(v_tenant)
       or (jsonb_typeof(p_closed->'fimDaNoite') = 'boolean' and (p_closed->>'fimDaNoite')::boolean) then
      return public.cash_turno_resp(false, v_turno, 'contagem_obrigatoria');
    end if;
    v_closed := v_closed || jsonb_build_object('countedAmount', p_closed->'expectedAmount', 'diff', null, 'semContagem', true);
    perform public.cash_turno_concluir_fechamento(v_tenant, p_caixa, v_turno, v_closed);
    return public.cash_turno_resp(true, null, null) || jsonb_build_object('cofre', null);
  end if;
  v_closed := v_closed - 'semContagem';

  v_dif := public.cash_turno_dif((p_closed->>'countedAmount')::numeric, (p_closed->>'expectedAmount')::numeric);
  if v_dif = 0 then
    perform public.cash_turno_concluir_fechamento(v_tenant, p_caixa, v_turno, v_closed);
    return public.cash_turno_resp(true, null, null)
        || jsonb_build_object('cofre', public.cash_turno_cofre_resumo(v_tenant, p_turno_id));
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
  if p_contado is not null and p_contado < 0 then
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
  v_turno := (p_turno - 'pendencia' - 'primeiraAbertura' - 'liberacoes' - 'fechadoNoLugarDe' - 'aberturaSemContagem')
          || jsonb_build_object(
               'caixaId', p_caixa,
               'operatorId', v_me,
               'operatorName', v_nome,
               'openedAt', public.cash_turno_agora(),
               'openingNote', left(coalesce(p_nota, ''), 500),
               'displayId', (case when jsonb_typeof(v_history) = 'array' then jsonb_array_length(v_history) else 0 end) + v_abertos + 1,
               'liberacoes', '[]'::jsonb);

  if p_contado is null then
    -- 26/11 (troca sem contagem): só quando o caixa foi passado sem contagem e a opção continua desligada.
    if not (v_row.sem_contagem and not public.cash_contar_na_troca(v_tenant)) then
      raise exception 'contagem invalida';
    end if;
    v_turno := v_turno || jsonb_build_object('status', 'open', 'openingAmount', coalesce(v_row.ultima_contagem, 0), 'aberturaSemContagem', true);
  elsif v_row.ultima_contagem is null then
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
             jsonb_build_object('caixa_id', t.caixa_id, 'turno', public.cash_turno_visivel(t.turno),
                                'abrir_sem_contagem', t.sem_contagem and t.turno is null and not public.cash_contar_na_troca(v_tenant))
             || case when v_admin then jsonb_build_object('ultima_contagem', t.ultima_contagem) else '{}'::jsonb end
             order by t.caixa_id)
      from public.cash_turnos t
     where t.tenant_id = v_tenant), '[]'::jsonb);
end;
$function$;
revoke all on function public.cash_turnos_ler() from public, anon;
grant execute on function public.cash_turnos_ler() to authenticated;

-- ROLLBACK (manual): reaplicar as quatro funções de 20261116000000/20261121000000 e
--   alter table public.cash_turnos drop column if exists sem_contagem;
--   drop function if exists public.cash_contar_na_troca(text);
