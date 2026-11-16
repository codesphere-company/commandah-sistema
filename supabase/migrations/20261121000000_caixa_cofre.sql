-- =====================================================================
-- 20261121000000_caixa_cofre.sql — cofre (16/11), caixa por operador etapa 2
-- =====================================================================
-- O PROBLEMA
-- ----------
-- A etapa 1 (20261116000000_caixa_por_operador.sql) separou as gavetas e travou
-- as contagens, mas o dinheiro que sai da gaveta (fim da noite, sangria) não tem
-- para onde ir no sistema. O dono quer que ele nunca "suma no meio do caminho"
-- entre a gaveta e o cofre, e que operador nenhum veja o cofre (nem pela API).
--
-- A SOLUCAO (esta parte: tabela e administração do cofre)
-- -------------------------------------------------------
-- * Tabela cash_cofre: uma linha por lançamento (entrada a recolher, saída,
--   contagem), por estabelecimento. Leitura direta só admin/dono; sem policy de
--   escrita: só as RPCs abaixo gravam.
-- * Saldo esperado = última contagem (0 se nunca contou) + entradas confirmadas
--   depois dela (pelo valor contado na confirmação) − saídas depois dela.
--   "A recolher" fica fora do saldo até alguém confirmar. Saldo negativo aparece
--   como está (indica contagem pendente). Não existe saldo inicial: a primeira
--   contagem faz esse papel.
-- * Diferença em centavos inteiros (cash_turno_dif). Diferença nunca trava nada.
-- * cash_cofre_entrada é interna: o fechamento no fim da noite e a sangria
--   (próximas tarefas) a chamam dentro da mesma transação que mexe na gaveta.
-- * Datas dos lançamentos por clock_timestamp(): dentro de uma transação now() é
--   o mesmo para tudo, e a ordem "depois da última contagem" depende da hora real.
-- * Toda RPC que mexe no saldo trava o cofre do estabelecimento (advisory lock),
--   para uma contagem não calcular o esperado no meio de uma confirmação.
--
-- RETESTE (bancada): node db/t-cofre.js
-- =====================================================================

-- Falha em 5s em vez de enfileirar as gravações do app atrás de uma transação longa.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Tabela do cofre
-- ---------------------------------------------------------------------
create table if not exists public.cash_cofre (
  id                   text        not null default gen_random_uuid()::text,
  tenant_id            text        not null,
  tipo                 text        not null,
  origem               text        not null,
  caixa_id             text,
  turno_id             text,
  valor                numeric     not null,
  status               text,
  lancado_por          text,
  lancado_por_nome     text,
  lancado_em           timestamptz not null default now(),
  confirmado_por       text,
  confirmado_por_nome  text,
  confirmado_em        timestamptz,
  valor_contado        numeric,
  diferenca            numeric,
  esperado             numeric,
  motivo               text,
  constraint cash_cofre_pkey primary key (id),
  constraint cash_cofre_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade,
  constraint cash_cofre_tipo_check check (tipo in ('entrada', 'saida', 'contagem')),
  constraint cash_cofre_origem_check check (origem in ('fim_da_noite', 'sangria', 'recolher_fechado', 'abastecer', 'outra', 'contagem')),
  constraint cash_cofre_valor_check check (valor >= 0),
  constraint cash_cofre_status_check check (status in ('a_recolher', 'confirmado'))
);
create index if not exists cash_cofre_tenant_lancado_idx on public.cash_cofre (tenant_id, lancado_em desc);
alter table public.cash_cofre enable row level security;

-- cofre (16/11): leitura direta só admin/dono do próprio estabelecimento (operador, inclusive
-- garçom que opera caixa, não vê saldo nem extrato pela API). Sem policy de escrita.
drop policy if exists cash_cofre_select on public.cash_cofre;
create policy cash_cofre_select on public.cash_cofre
  as permissive for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_admin_like()));

revoke all on table public.cash_cofre from public, anon, authenticated;
grant select on table public.cash_cofre to authenticated;
grant all on table public.cash_cofre to service_role;
-- Realtime: não entra na publicação (a tela do cofre consulta pela RPC, como cash_turnos).

-- ---------------------------------------------------------------------
-- Ajudantes internos (não expostos ao navegador)
-- ---------------------------------------------------------------------
-- cofre (16/11): só admin/dono e só com o caixa por operador ligado (desligado, não existe cofre).
create or replace function public.cash_cofre_checar()
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
begin
  if v_tenant is null or not public.is_admin_like() then
    raise exception 'sem permissao para o cofre';
  end if;
  if not public.caixa_por_operador_ligado() then
    raise exception 'caixa por operador desligado';
  end if;
  return v_tenant;
end;
$function$;
revoke all on function public.cash_cofre_checar() from public, anon, authenticated;

-- Trava o cofre do estabelecimento até o fim da transação.
create or replace function public.cash_cofre_travar(p_tenant text)
returns void
language sql
set search_path to ''
as $function$
  select pg_advisory_xact_lock(hashtextextended('cash_cofre:' || p_tenant, 0));
$function$;
revoke all on function public.cash_cofre_travar(text) from public, anon, authenticated;

-- Saldo esperado (veja o cabeçalho). Desempate da última contagem pelo id.
create or replace function public.cash_cofre_saldo(p_tenant text)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  with base as (
    select valor, lancado_em from public.cash_cofre
     where tenant_id = p_tenant and tipo = 'contagem'
     order by lancado_em desc, id desc
     limit 1)
  select coalesce((select valor from base), 0)
       + coalesce((select sum(e.valor_contado) from public.cash_cofre e
                    where e.tenant_id = p_tenant and e.tipo = 'entrada' and e.status = 'confirmado'
                      and e.confirmado_em > coalesce((select lancado_em from base), '-infinity'::timestamptz)), 0)
       - coalesce((select sum(s.valor) from public.cash_cofre s
                    where s.tenant_id = p_tenant and s.tipo = 'saida'
                      and s.lancado_em > coalesce((select lancado_em from base), '-infinity'::timestamptz)), 0);
$function$;
revoke all on function public.cash_cofre_saldo(text) from public, anon, authenticated;

-- Linha do extrato em camelCase (sem tenant_id).
create or replace function public.cash_cofre_linha(p public.cash_cofre)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p.id, 'tipo', p.tipo, 'origem', p.origem, 'caixaId', p.caixa_id, 'turnoId', p.turno_id,
    'valor', p.valor, 'status', p.status,
    'lancadoPor', p.lancado_por, 'lancadoPorNome', p.lancado_por_nome, 'lancadoEm', p.lancado_em,
    'confirmadoPor', p.confirmado_por, 'confirmadoPorNome', p.confirmado_por_nome, 'confirmadoEm', p.confirmado_em,
    'valorContado', p.valor_contado, 'diferenca', p.diferenca, 'esperado', p.esperado, 'motivo', p.motivo);
$function$;
revoke all on function public.cash_cofre_linha(public.cash_cofre) from public, anon, authenticated;

-- cofre (16/11): entrada a recolher (gaveta → cofre). Interna: chamada pelo fechamento no fim
-- da noite, pela sangria e pelo "recolher de caixa fechado", na mesma transação que mexe na
-- gaveta. Devolve o id do lançamento.
create or replace function public.cash_cofre_entrada(p_tenant text, p_caixa text, p_turno_id text,
                                                     p_valor numeric, p_origem text, p_staff text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id text := gen_random_uuid()::text;
begin
  if coalesce(p_tenant, '') = '' then
    raise exception 'estabelecimento invalido';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor invalido';
  end if;
  if p_origem is null or p_origem not in ('fim_da_noite', 'sangria', 'recolher_fechado') then
    raise exception 'origem invalida';
  end if;
  insert into public.cash_cofre (id, tenant_id, tipo, origem, caixa_id, turno_id, valor, status,
                                 lancado_por, lancado_por_nome, lancado_em)
  values (v_id, p_tenant, 'entrada', p_origem, p_caixa, p_turno_id, p_valor, 'a_recolher',
          p_staff, public.cash_turno_nome(p_tenant, p_staff), clock_timestamp());
  return v_id;
end;
$function$;
revoke all on function public.cash_cofre_entrada(text, text, text, numeric, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- RPCs (só admin/dono)
-- ---------------------------------------------------------------------
-- cofre (16/11): saldo, última contagem, lista "a recolher" (mais antiga primeiro) e extrato
-- (últimas 300, mais nova primeiro).
create or replace function public.cash_cofre_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_cofre_checar();
  v_ult public.cash_cofre%rowtype;
begin
  select * into v_ult from public.cash_cofre
   where tenant_id = v_tenant and tipo = 'contagem'
   order by lancado_em desc, id desc
   limit 1;

  return jsonb_build_object(
    'saldo', public.cash_cofre_saldo(v_tenant),
    'ultimaContagem', case when v_ult.id is null then null
                           else jsonb_build_object('valor', v_ult.valor, 'em', v_ult.lancado_em, 'por', v_ult.lancado_por_nome) end,
    'aRecolher', coalesce((
      select jsonb_agg(public.cash_cofre_linha(c) order by c.lancado_em, c.id)
        from public.cash_cofre c
       where c.tenant_id = v_tenant and c.tipo = 'entrada' and c.status = 'a_recolher'), '[]'::jsonb),
    'extrato', coalesce((
      select jsonb_agg(x.l order by x.em desc, x.id desc)
        from (select public.cash_cofre_linha(c) as l, c.lancado_em as em, c.id
                from public.cash_cofre c
               where c.tenant_id = v_tenant
               order by c.lancado_em desc, c.id desc
               limit 300) x), '[]'::jsonb));
end;
$function$;
revoke all on function public.cash_cofre_ler() from public, anon;
grant execute on function public.cash_cofre_ler() to authenticated;

-- cofre (16/11): confirma o recolhimento contando o dinheiro recebido. Não trava se não bater:
-- a diferença fica no extrato. O admin pode confirmar o próprio fechamento (decisão do dono).
-- Contado 0 vale (o dinheiro não chegou).
create or replace function public.cash_cofre_confirmar(p_id text, p_contado numeric)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_cofre_checar();
  v_me text := public.current_staff_id();
  v_row public.cash_cofre%rowtype;
  v_dif numeric;
begin
  if p_contado is null or p_contado < 0 then
    raise exception 'valor invalido';
  end if;
  perform public.cash_cofre_travar(v_tenant);

  select * into v_row from public.cash_cofre
   where tenant_id = v_tenant and id = p_id and tipo = 'entrada'
   for update;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if v_row.status = 'confirmado' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_confirmado');
  end if;

  v_dif := public.cash_turno_dif(p_contado, v_row.valor);
  update public.cash_cofre
     set status = 'confirmado', valor_contado = p_contado, diferenca = v_dif,
         confirmado_por = v_me, confirmado_por_nome = public.cash_turno_nome(v_tenant, v_me),
         confirmado_em = clock_timestamp()
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'diferenca', v_dif);
end;
$function$;
revoke all on function public.cash_cofre_confirmar(text, numeric) from public, anon;
grant execute on function public.cash_cofre_confirmar(text, numeric) to authenticated;

-- cofre (16/11): abastecer caixa (cofre → caixa). Sem turno aberto, soma em ultima_contagem (o
-- esperado da próxima abertura). Turno aberto: põe um suprimento em dinheiro no turno
-- (cantina2:cashMovements), para o esperado do fechamento já incluir. Turno travado: recusa.
create or replace function public.cash_cofre_abastecer(p_caixa text, p_valor numeric, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_cofre_checar();
  v_me text := public.current_staff_id();
  v_nome text;
  v_row public.cash_turnos%rowtype;
  v_id text := gen_random_uuid()::text;
  v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 500)), '');
  v_desc text;
  v_status text;
  v_turno_id text;
  v_mov jsonb;
begin
  if coalesce(p_caixa, '') = '' or length(p_caixa) > 60 then
    raise exception 'caixa invalido';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor invalido';
  end if;
  perform public.cash_cofre_travar(v_tenant);
  v_nome := public.cash_turno_nome(v_tenant, v_me);

  insert into public.cash_turnos (tenant_id, caixa_id) values (v_tenant, p_caixa)
  on conflict (tenant_id, caixa_id) do nothing;

  select * into v_row from public.cash_turnos
   where tenant_id = v_tenant and caixa_id = p_caixa
   for update;

  v_status := case when v_row.turno is null then 'closed' else coalesce(v_row.turno->>'status', '') end;

  if v_status = 'closed' then
    update public.cash_turnos
       set ultima_contagem = coalesce(ultima_contagem, 0) + p_valor, updated_at = now()
     where tenant_id = v_tenant and caixa_id = p_caixa;
  elsif v_status = 'open' then
    v_turno_id := v_row.turno->>'id';
    v_desc := 'Abastecido pelo cofre' || coalesce(' — ' || v_motivo, '');
    insert into public.app_data (tenant_id, key, value)
    values (v_tenant, 'cantina2:cashMovements', '[]'::jsonb)
    on conflict (tenant_id, key) do nothing;

    select value into v_mov from public.app_data
     where tenant_id = v_tenant and key = 'cantina2:cashMovements'
     for update;
    if jsonb_typeof(v_mov) <> 'array' then
      v_mov := '[]'::jsonb;
    end if;
    v_mov := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'cashSessionId', v_turno_id, 'type', 'suprimento',
      'amount', p_valor, 'method', 'dinheiro', 'reason', v_desc, 'description', v_desc, 'note', '',
      'operatorId', v_me, 'operatorName', v_nome, 'at', public.cash_turno_agora(),
      'origin', 'cofre', 'cofreId', v_id)) || v_mov;
    update public.app_data set value = v_mov, updated_at = now()
     where tenant_id = v_tenant and key = 'cantina2:cashMovements';
  else
    return jsonb_build_object('ok', false, 'motivo', 'travado');
  end if;

  insert into public.cash_cofre (id, tenant_id, tipo, origem, caixa_id, turno_id, valor,
                                 lancado_por, lancado_por_nome, lancado_em, motivo)
  values (v_id, v_tenant, 'saida', 'abastecer', p_caixa, v_turno_id, p_valor,
          v_me, v_nome, clock_timestamp(), v_motivo);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;
revoke all on function public.cash_cofre_abastecer(text, numeric, text) from public, anon;
grant execute on function public.cash_cofre_abastecer(text, numeric, text) to authenticated;

-- cofre (16/11): outra saída do cofre (retirada do dono, depósito no banco), motivo obrigatório.
create or replace function public.cash_cofre_saida(p_valor numeric, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_cofre_checar();
  v_me text := public.current_staff_id();
  v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 500)), '');
  v_id text := gen_random_uuid()::text;
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor invalido';
  end if;
  if v_motivo is null then
    raise exception 'motivo obrigatorio';
  end if;
  perform public.cash_cofre_travar(v_tenant);
  insert into public.cash_cofre (id, tenant_id, tipo, origem, valor, lancado_por, lancado_por_nome, lancado_em, motivo)
  values (v_id, v_tenant, 'saida', 'outra', p_valor, v_me, public.cash_turno_nome(v_tenant, v_me), clock_timestamp(), v_motivo);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;
revoke all on function public.cash_cofre_saida(numeric, text) from public, anon;
grant execute on function public.cash_cofre_saida(numeric, text) to authenticated;

-- cofre (16/11): contar o cofre. Não trava; grava esperado (saldo antes) e diferença, e passa a
-- ser a nova base do saldo. Contado 0 vale (cofre vazio).
create or replace function public.cash_cofre_contar(p_contado numeric, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_cofre_checar();
  v_me text := public.current_staff_id();
  v_esperado numeric;
  v_dif numeric;
begin
  if p_contado is null or p_contado < 0 then
    raise exception 'valor invalido';
  end if;
  perform public.cash_cofre_travar(v_tenant);
  v_esperado := public.cash_cofre_saldo(v_tenant);
  v_dif := public.cash_turno_dif(p_contado, v_esperado);
  insert into public.cash_cofre (tenant_id, tipo, origem, valor, lancado_por, lancado_por_nome, lancado_em,
                                 esperado, diferenca, motivo)
  values (v_tenant, 'contagem', 'contagem', p_contado, v_me, public.cash_turno_nome(v_tenant, v_me), clock_timestamp(),
          v_esperado, v_dif, nullif(btrim(left(coalesce(p_nota, ''), 500)), ''));
  return jsonb_build_object('ok', true, 'esperado', v_esperado, 'diferenca', v_dif);
end;
$function$;
revoke all on function public.cash_cofre_contar(numeric, text) from public, anon;
grant execute on function public.cash_cofre_contar(numeric, text) to authenticated;

-- cofre (16/11): recolher de caixa fechado (gaveta sem turno aberto → cofre, a recolher),
-- reduzindo ultima_contagem. Corrige quem escolheu "passar o caixa" no fim da noite.
create or replace function public.cash_cofre_recolher_fechado(p_caixa text, p_valor numeric)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_cofre_checar();
  v_me text := public.current_staff_id();
  v_row public.cash_turnos%rowtype;
  v_id text;
begin
  if coalesce(p_caixa, '') = '' or length(p_caixa) > 60 then
    raise exception 'caixa invalido';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor invalido';
  end if;
  perform public.cash_cofre_travar(v_tenant);

  select * into v_row from public.cash_turnos
   where tenant_id = v_tenant and caixa_id = p_caixa
   for update;

  if v_row.turno is not null and coalesce(v_row.turno->>'status', '') <> 'closed' then
    return jsonb_build_object('ok', false, 'motivo', 'turno_aberto');
  end if;
  -- Em centavos: não sai da gaveta mais do que a última contagem.
  if round(p_valor * 100) > round(coalesce(v_row.ultima_contagem, 0) * 100) then
    return jsonb_build_object('ok', false, 'motivo', 'valor_maior');
  end if;

  update public.cash_turnos
     set ultima_contagem = public.cash_turno_dif(ultima_contagem, p_valor), updated_at = now()
   where tenant_id = v_tenant and caixa_id = p_caixa;
  v_id := public.cash_cofre_entrada(v_tenant, p_caixa, null, p_valor, 'recolher_fechado', v_me);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;
revoke all on function public.cash_cofre_recolher_fechado(text, numeric) from public, anon;
grant execute on function public.cash_cofre_recolher_fechado(text, numeric) to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.cash_cofre_recolher_fechado(text, numeric);
-- drop function if exists public.cash_cofre_contar(numeric, text);
-- drop function if exists public.cash_cofre_saida(numeric, text);
-- drop function if exists public.cash_cofre_abastecer(text, numeric, text);
-- drop function if exists public.cash_cofre_confirmar(text, numeric);
-- drop function if exists public.cash_cofre_ler();
-- drop function if exists public.cash_cofre_entrada(text, text, text, numeric, text, text);
-- drop function if exists public.cash_cofre_linha(public.cash_cofre);
-- drop function if exists public.cash_cofre_saldo(text);
-- drop function if exists public.cash_cofre_travar(text);
-- drop function if exists public.cash_cofre_checar();
-- drop table if exists public.cash_cofre;
-- =====================================================================
