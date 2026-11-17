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
--   a chamam dentro da mesma transação que mexe na gaveta.
-- * Datas dos lançamentos por clock_timestamp(): dentro de uma transação now() é
--   o mesmo para tudo, e a ordem "depois da última contagem" depende da hora real.
-- * Toda RPC que mexe no saldo trava o cofre do estabelecimento (advisory lock),
--   para uma contagem não calcular o esperado no meio de uma confirmação.
--
-- A SOLUCAO (segunda parte: fim da noite e saídas do turno)
-- ---------------------------------------------------------
-- * Fechamento: p_closed.fimDaNoite = true (booleano) é o fim da noite; ausente
--   ou qualquer outra coisa é passagem de caixa (aparelho antigo não move
--   dinheiro). No fim da noite, cash_turno_concluir_fechamento lê o troco do
--   caixa (settings.caixas[].troco, nunca do aparelho) e, se contado > troco em
--   centavos, grava na mesma transação a entrada a recolher (contado − troco) e
--   põe ultima_contagem = troco; senão ultima_contagem = contado. troco,
--   paraCofre e fimDaNoite ficam no fechamento do histórico, e cash_turno_fechar
--   devolve cofre: {troco, paraCofre} quando conclui. Fechamento travado só vai
--   ao cofre quando a liberação/recontagem concluir (usa o valor contado).
--   A assinatura de cash_turno_concluir_fechamento continua returns void (está
--   em produção e tem três chamadores).
-- * cash_turno_saida: sangria, pagamento de funcionário e outro pagamento (só
--   admin/dono) no turno aberto. Sangria em dinheiro grava a saída da gaveta
--   (cantina2:cashMovements, origin 'cofre' + cofreId) e a entrada a recolher no
--   cofre juntas. Pix/cartão e pagamentos não vão ao cofre.
-- * cash_movements_apply (caminho do site para os lançamentos), com o modo
--   ligado: lançamento do cofre não se altera nem se apaga; sangria nova só se
--   for automática (troco, fiado-estorno, parcial-estorno, reabertura, sem
--   categoria), o resto passa por cash_turno_saida; operador não lança "outro
--   pagamento" nem altera uma saída já gravada.
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
  p_valor := round(p_valor, 2); -- cofre (16/11): centavos exatos
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
  p_contado := round(p_contado, 2); -- cofre (16/11): centavos exatos
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
  -- cofre (16/11): centavos exatos, como o front (arredondaCentavos).
  p_valor := round(p_valor, 2);
  if p_valor <= 0 then
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
  -- cofre (16/11): centavos exatos, como o front (arredondaCentavos).
  p_valor := round(p_valor, 2);
  if p_valor <= 0 then
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
  p_contado := round(p_contado, 2); -- cofre (16/11): centavos exatos
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
  -- cofre (16/11): centavos exatos, como o front (arredondaCentavos).
  p_valor := round(p_valor, 2);
  if p_valor <= 0 then
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

-- ---------------------------------------------------------------------
-- Fim da noite (fechamento do turno)
-- ---------------------------------------------------------------------
-- cofre (16/11): troco fixo do caixa, de cantina2:settings → caixas[] → troco. Número ou texto
-- numérico ("150.5"); ausente, inválido ou negativo vale 0 (tudo vai ao cofre). Em centavos.
create or replace function public.cash_caixa_troco(p_tenant text, p_caixa text)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select round(greatest(case
             when jsonb_typeof(c->'troco') = 'number' then (c->>'troco')::numeric
             when jsonb_typeof(c->'troco') = 'string' and btrim(c->>'troco') ~ '^[0-9]{1,9}([.,][0-9]{1,6})?$'
               then replace(btrim(c->>'troco'), ',', '.')::numeric
             else 0 end, 0), 2)
      from public.app_data a,
           jsonb_array_elements(case when jsonb_typeof(a.value) = 'object' and jsonb_typeof(a.value->'caixas') = 'array'
                                     then a.value->'caixas' else '[]'::jsonb end) c
     where a.tenant_id = p_tenant and a.key = 'cantina2:settings'
       and jsonb_typeof(c) = 'object' and c->>'id' = p_caixa
     limit 1), 0);
$function$;
revoke all on function public.cash_caixa_troco(text, text) from public, anon, authenticated;

-- Conclui o fechamento: copiado de 20261116000000_caixa_por_operador.sql; muda o fim da noite
-- (cofre, 16/11). Mesma assinatura e returns void (três chamadores em produção). troco/paraCofre/
-- fimDaNoite mandados pelo aparelho são descartados: só o servidor calcula. A entrada no cofre não
-- se repete para o mesmo turno (tentativa repetida).
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
     set turno = null, ultima_contagem = v_ultima, updated_at = now()
   where tenant_id = p_tenant and caixa_id = p_caixa;
end;
$function$;
revoke all on function public.cash_turno_concluir_fechamento(text, text, jsonb, jsonb) from public, anon, authenticated;

-- cofre (16/11): {troco, paraCofre} do fechamento já concluído (lido do histórico, onde
-- cash_turno_concluir_fechamento gravou); null se foi passagem de caixa.
create or replace function public.cash_turno_cofre_resumo(p_tenant text, p_turno_id text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select (select case when e->'fimDaNoite' = 'true'::jsonb
                      then jsonb_build_object('troco', e->'troco', 'paraCofre', e->'paraCofre') end
            from public.app_data a,
                 jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) e
           where a.tenant_id = p_tenant and a.key = 'cantina2:cashHistory' and e->>'id' = p_turno_id
           limit 1);
$function$;
revoke all on function public.cash_turno_cofre_resumo(text, text) from public, anon, authenticated;

-- Copiado de 20261116000000_caixa_por_operador.sql; muda só a resposta quando conclui
-- (cofre, 16/11): acrescenta cofre {troco, paraCofre} (null na passagem de caixa).
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

-- ---------------------------------------------------------------------
-- Saídas do turno (sangria, pagamento de funcionário, outro pagamento)
-- ---------------------------------------------------------------------
-- cofre (16/11): p_mov = {id, categoria: 'sangria'|'funcionario'|'outro', amount, method,
-- description, pessoa, note, at}. Grava no topo de cantina2:cashMovements com os mesmos campos do
-- lançamento do site (type 'sangria', cashSessionId = turno), para o esperado do fechamento contar.
-- Sangria em dinheiro: origin 'cofre' + cofreId e a entrada a recolher, na mesma transação.
-- Pagamento de funcionário: nome obrigatório. Outro pagamento: só admin/dono, motivo obrigatório.
-- id repetido (tentativa repetida): devolve a lista sem gravar de novo. Devolve {ok, motivo?,
-- turno, movements}.
create or replace function public.cash_turno_saida(p_caixa text, p_turno_id text, p_mov jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.cash_turno_checar();
  v_me text := public.current_staff_id();
  v_turno jsonb;
  v_list jsonb;
  v_id text;
  v_cat text;
  v_amount numeric;
  v_method text;
  v_desc text;
  v_pessoa text;
  v_at jsonb;
  v_mov jsonb;
begin
  if v_me is null then
    raise exception 'sem permissao para operar o caixa';
  end if;
  if p_mov is null or jsonb_typeof(p_mov) <> 'object' or coalesce(p_mov->>'id', '') = '' or length(p_mov->>'id') > 100 then
    raise exception 'lancamento invalido';
  end if;
  v_id := p_mov->>'id';
  v_cat := p_mov->>'categoria';
  if v_cat is null or v_cat not in ('sangria', 'funcionario', 'outro') then
    raise exception 'categoria invalida';
  end if;
  if jsonb_typeof(p_mov->'amount') is distinct from 'number' then
    raise exception 'valor invalido';
  end if;
  v_amount := round((p_mov->>'amount')::numeric, 2); -- cofre (16/11): centavos exatos
  if v_amount <= 0 then
    raise exception 'valor invalido';
  end if;
  v_method := coalesce(nullif(btrim(left(coalesce(p_mov->>'method', ''), 60)), ''), 'dinheiro');
  v_desc := nullif(btrim(left(coalesce(p_mov->>'description', ''), 500)), '');
  v_pessoa := nullif(btrim(left(coalesce(p_mov->>'pessoa', ''), 60)), '');

  if v_cat = 'funcionario' then
    if v_pessoa is null then
      raise exception 'nome de quem recebeu obrigatorio';
    end if;
    v_desc := 'Pagamento de funcionário: ' || v_pessoa;
  elsif v_cat = 'outro' then
    if not public.is_admin_like() then
      raise exception 'so administrador lanca outro pagamento';
    end if;
    if v_desc is null then
      raise exception 'motivo obrigatorio';
    end if;
  else
    v_desc := coalesce(v_desc, case when v_method = 'dinheiro' then 'Sangria para o cofre' else 'Sangria' end);
  end if;

  -- Hora escolhida na tela (como o lançamento do site); inválida ou ausente = agora.
  begin
    v_at := to_jsonb(to_char((p_mov->>'at')::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  exception when others then
    v_at := null;
  end;
  v_at := coalesce(v_at, public.cash_turno_agora());

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

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:cashMovements', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_list from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashMovements'
   for update;
  if jsonb_typeof(v_list) <> 'array' then
    v_list := '[]'::jsonb;
  end if;

  if exists (select 1 from jsonb_array_elements(v_list) m where m->>'id' = v_id) then
    return public.cash_turno_resp(true, v_turno, null) || jsonb_build_object('movements', v_list);
  end if;

  v_mov := jsonb_build_object(
    'id', v_id, 'cashSessionId', p_turno_id, 'type', 'sangria', 'amount', to_jsonb(v_amount),
    'method', v_method, 'reason', v_desc, 'description', v_desc,
    'note', left(coalesce(p_mov->>'note', ''), 500),
    'operatorId', v_me, 'operatorName', coalesce(public.cash_turno_nome(v_tenant, v_me), ''), 'at', v_at);
  if v_cat = 'funcionario' then
    v_mov := v_mov || jsonb_build_object('categoria', 'funcionario', 'pessoa', v_pessoa);
  elsif v_cat = 'outro' then
    v_mov := v_mov || jsonb_build_object('categoria', 'outro');
  elsif v_method = 'dinheiro' then
    v_mov := v_mov || jsonb_build_object('origin', 'cofre',
      'cofreId', public.cash_cofre_entrada(v_tenant, p_caixa, p_turno_id, v_amount, 'sangria', v_me));
  end if;

  v_list := jsonb_build_array(v_mov) || v_list;
  update public.app_data set value = v_list, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:cashMovements';
  return public.cash_turno_resp(true, v_turno, null) || jsonb_build_object('movements', v_list);
end;
$function$;
revoke all on function public.cash_turno_saida(text, text, jsonb) from public, anon;
grant execute on function public.cash_turno_saida(text, text, jsonb) to authenticated;

-- Copiado de 20261010010000_caixa_com_trava.sql; acrescenta a guarda do cofre (16/11), só com o
-- caixa por operador ligado: lançamento do cofre (origin 'cofre') não se altera nem se apaga por
-- aqui (reenviar igual passa: aparelho com a base atrasada), lançamento novo com origin 'cofre' é
-- recusado e sangria nova só entra se for automática (origin na lista branca, sem categoria); o
-- resto passa por cash_turno_saida. Quem não é admin/dono não lança "outro pagamento" nem altera
-- tipo/valor/forma/categoria/origem de uma saída já gravada. Desligado: sem mudança.
create or replace function public.cash_movements_apply(p_upserts jsonb, p_delete_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_list jsonb;
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_del jsonb := coalesce(p_delete_ids, '[]'::jsonb);
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para lancar no caixa';
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_del) <> 'array'
     or jsonb_array_length(v_up) > 200 or jsonb_array_length(v_del) > 200 then
    raise exception 'lancamentos invalidos';
  end if;
  if exists (select 1 from jsonb_array_elements(v_up) e
              where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') = '') then
    raise exception 'lancamento sem id';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:cashMovements', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_list from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:cashMovements'
   for update;
  if jsonb_typeof(v_list) <> 'array' then
    v_list := '[]'::jsonb;
  end if;

  if public.caixa_por_operador_ligado() then
    if exists (select 1 from jsonb_array_elements(v_list) m
                where m->>'origin' = 'cofre'
                  and m->>'id' = any(array(select jsonb_array_elements_text(v_del))))
       or exists (select 1 from jsonb_array_elements(v_up) u
                    left join lateral (select m as elem from jsonb_array_elements(v_list) m
                                        where m->>'id' = u->>'id' limit 1) s on true
                   where (u->>'origin' = 'cofre' or s.elem->>'origin' = 'cofre')
                     and s.elem is distinct from u) then
      raise exception 'lancamento do cofre: nao pode ser alterado nem excluido no caixa';
    end if;
    -- Revisão r1: "outro pagamento" é só de admin/dono, em lançamento novo ou editado.
    if not public.is_admin_like()
       and exists (select 1 from jsonb_array_elements(v_up) u where u->>'categoria' = 'outro') then
      raise exception 'so administrador lanca outro pagamento';
    end if;
    -- Sangria nova só se for um dos automáticos que o site gera (origin na lista: troco
    -- agendamento.js, fiado-estorno agendamento.js, parcial-estorno cozinha.js, reabertura
    -- comandas.js) e sem categoria (sangria, funcionário, outro e diária vão por cash_turno_saida).
    if exists (select 1 from jsonb_array_elements(v_up) u
                where u->>'type' = 'sangria'
                  and (coalesce(u->>'origin', '') not in ('troco', 'fiado-estorno', 'parcial-estorno', 'reabertura')
                       or u ? 'categoria')
                  and not exists (select 1 from jsonb_array_elements(v_list) m where m->>'id' = u->>'id')) then
      raise exception 'use a saida do turno para lancar sangria';
    end if;
    -- Revisão r1: quem não é admin/dono não muda tipo, valor, forma, categoria nem origem de uma
    -- saída já gravada (nem transforma um lançamento em saída). O site não edita lançamento de
    -- operador (OP-17); os automáticos só são criados ou apagados.
    if not public.is_admin_like()
       and exists (select 1 from jsonb_array_elements(v_up) u
                     join lateral (select m as elem from jsonb_array_elements(v_list) m
                                    where m->>'id' = u->>'id' limit 1) s on true
                    where (u->>'type' = 'sangria' or s.elem->>'type' = 'sangria')
                      and (u->'type' is distinct from s.elem->'type'
                           or u->'amount' is distinct from s.elem->'amount'
                           or u->'method' is distinct from s.elem->'method'
                           or u->'categoria' is distinct from s.elem->'categoria'
                           or u->'origin' is distinct from s.elem->'origin')) then
      raise exception 'so administrador altera saida do caixa';
    end if;
  end if;

  -- Editado continua na mesma posição; novo entra no topo (como o unshift do site).
  select coalesce(jsonb_agg(coalesce(
           (select u from jsonb_array_elements(v_up) u where u->>'id' = m.elem->>'id' limit 1),
           m.elem) order by m.ord), '[]'::jsonb)
    into v_list
    from jsonb_array_elements(v_list) with ordinality as m(elem, ord)
   where not coalesce(m.elem->>'id' = any(array(select jsonb_array_elements_text(v_del))), false);

  v_list := coalesce((select jsonb_agg(u order by n.ord)
                        from jsonb_array_elements(v_up) with ordinality as n(u, ord)
                       where not exists (select 1 from jsonb_array_elements(v_list) m where m->>'id' = u->>'id')), '[]'::jsonb)
            || v_list;

  update public.app_data set value = v_list, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:cashMovements';

  return v_list;
end;
$function$;
revoke all on function public.cash_movements_apply(jsonb, jsonb) from public, anon;
grant execute on function public.cash_movements_apply(jsonb, jsonb) to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- ATENÇÃO: reverter o FRONT ANTES desta migration (o front novo depende de cash_turno_saida e cash_cofre_*).
-- Recriar ANTES de dropar a tabela (as versões novas chamam cash_cofre_entrada):
--   cash_movements_apply de 20261010010000_caixa_com_trava.sql;
--   cash_turno_concluir_fechamento e cash_turno_fechar de 20261116000000_caixa_por_operador.sql.
-- drop function if exists public.cash_turno_saida(text, text, jsonb);
-- drop function if exists public.cash_turno_cofre_resumo(text, text);
-- drop function if exists public.cash_caixa_troco(text, text);
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
