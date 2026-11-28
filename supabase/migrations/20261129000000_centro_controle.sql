-- Centro de controle da plataforma, etapa 1 (27/11/2026). Pedido do dono: acompanhar vários clientes ao mesmo tempo e
-- saber na hora de problema crítico ("pedido que não chegou à cozinha, venda que não subiu ao servidor"), com aviso no
-- WhatsApp que repete até resolver. Desenho: docs/superpowers/specs/2026-11-27-centro-de-controle-design.md.
--
-- Peças: aparelhos mandam aparelho_sinal() a cada 60 s; pg_cron roda controle_avaliar() a cada minuto, que abre e fecha
-- controle_incidentes e põe mensagens em controle_avisos; o mesmo agendamento chama a Edge Function whatsapp
-- (action alertas_enviar, cabeçalho x-segredo = vault 'controle_segredo') só quando há aviso esperando.
-- Nenhuma tabela daqui é lida por cliente: RLS ligada e sem policy (service_role passa por cima; as funções são definer).

-- ---------- Tabelas ----------
create table if not exists public.plataforma_operadores (
  auth_uid uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  whatsapp text not null default '',  -- só dígitos com DDI (5544...); preenchido por SQL, nunca no repositório
  ativo boolean not null default true
);

create table if not exists public.aparelhos_sinal (
  tenant_id text not null references public.tenant_owners(tenant_id) on delete cascade,
  aparelho_id text not null,
  nome text, papel text, usuario text, versao text, tela text,
  caixa_id text, caixa_aberto boolean not null default false,
  pend_vendas integer not null default 0, pend_caixa integer not null default 0, pend_desde timestamptz,
  fichas_falhas integer not null default 0, fichas_desde timestamptz,
  ultimo_erro text,
  visto_em timestamptz not null default now(),
  primary key (tenant_id, aparelho_id)
);

create table if not exists public.quedas_conexao (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenant_owners(tenant_id) on delete cascade,
  aparelho_id text not null,
  inicio timestamptz not null,
  fim timestamptz,
  pendencias_ao_voltar integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists quedas_conexao_tenant_idx on public.quedas_conexao (tenant_id, inicio desc);

create table if not exists public.controle_incidentes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenant_owners(tenant_id) on delete cascade,
  codigo text not null,
  chave text not null default '',
  gravidade text not null check (gravidade in ('critico', 'atencao')),
  detalhe jsonb not null default '{}'::jsonb,
  aberto_em timestamptz not null default now(),
  ultimo_aviso_em timestamptz,
  fechado_em timestamptz,
  avisos integer not null default 0
);
-- Um aberto por (cliente, código, chave): duas avaliações ao mesmo tempo não duplicam.
create unique index if not exists controle_incidentes_aberto_uq on public.controle_incidentes (tenant_id, codigo, chave) where fechado_em is null;
create index if not exists controle_incidentes_tenant_idx on public.controle_incidentes (tenant_id, aberto_em desc);

create table if not exists public.controle_avisos (
  id uuid primary key default gen_random_uuid(),
  incidente_id uuid references public.controle_incidentes(id) on delete set null,
  para text not null,
  texto text not null,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  tentativas integer not null default 0,
  erro text
);
create index if not exists controle_avisos_pendentes_idx on public.controle_avisos (criado_em) where enviado_em is null;

alter table public.plataforma_operadores enable row level security;
alter table public.aparelhos_sinal enable row level security;
alter table public.quedas_conexao enable row level security;
alter table public.controle_incidentes enable row level security;
alter table public.controle_avisos enable row level security;
revoke all on public.plataforma_operadores, public.aparelhos_sinal, public.quedas_conexao, public.controle_incidentes, public.controle_avisos from anon, authenticated;

-- ---------- Operador da plataforma ----------
create or replace function public.eh_operador_plataforma()
returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.plataforma_operadores where auth_uid = auth.uid() and ativo);
$function$;
revoke all on function public.eh_operador_plataforma() from public, anon;
grant execute on function public.eh_operador_plataforma() to authenticated;

-- ---------- Sinal do aparelho ----------
-- Chamado a cada ~60 s por todo aparelho logado (core/sinal.js). Um registro por aparelho (upsert).
create or replace function public.aparelho_sinal(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_id text := p->>'aparelhoId';
  q jsonb;
  ts timestamptz;
begin
  if v_tenant is null then raise exception 'sem permissao'; end if;
  if v_id is null or v_id !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'aparelho invalido'; end if;
  insert into public.aparelhos_sinal as s (tenant_id, aparelho_id, nome, papel, usuario, versao, tela, caixa_id, caixa_aberto,
      pend_vendas, pend_caixa, pend_desde, fichas_falhas, fichas_desde, ultimo_erro, visto_em)
  values (v_tenant, v_id, left(p->>'nome', 60), left(p->>'papel', 20), left(p->>'usuario', 60), left(p->>'versao', 20),
      left(p->>'tela', 40), left(p->>'caixaId', 40), coalesce((p->>'caixaAberto')::boolean, false),
      greatest(0, least(coalesce((p->>'pendVendas')::int, 0), 100000)), greatest(0, least(coalesce((p->>'pendCaixa')::int, 0), 100000)),
      nullif(p->>'pendDesde', '')::timestamptz,
      greatest(0, least(coalesce((p->>'fichas')::int, 0), 100000)), nullif(p->>'fichasDesde', '')::timestamptz,
      left(p->>'ultimoErro', 300), now())
  on conflict (tenant_id, aparelho_id) do update set
      nome = excluded.nome, papel = excluded.papel, usuario = excluded.usuario, versao = excluded.versao, tela = excluded.tela,
      caixa_id = excluded.caixa_id, caixa_aberto = excluded.caixa_aberto, pend_vendas = excluded.pend_vendas,
      pend_caixa = excluded.pend_caixa, pend_desde = excluded.pend_desde, fichas_falhas = excluded.fichas_falhas,
      fichas_desde = excluded.fichas_desde, ultimo_erro = excluded.ultimo_erro, visto_em = now();
  -- Quedas de conexão anotadas pelo aparelho enquanto estava sem internet (no máximo 20 por sinal).
  if jsonb_typeof(p->'quedas') = 'array' then
    for q in select value from jsonb_array_elements(p->'quedas') with ordinality as e(value, i) where i <= 20 loop
      ts := nullif(q->>'inicio', '')::timestamptz;
      if ts is not null and ts > now() - interval '7 days' then
        insert into public.quedas_conexao (tenant_id, aparelho_id, inicio, fim, pendencias_ao_voltar)
        values (v_tenant, v_id, ts, nullif(q->>'fim', '')::timestamptz, greatest(0, least(coalesce((q->>'pendencias')::int, 0), 100000)));
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.aparelho_sinal(jsonb) from public, anon;
grant execute on function public.aparelho_sinal(jsonb) to authenticated;

-- ---------- Regras ----------
-- Clientes monitorados: assinatura isento/ativa/atrasada.
-- Funcionando: caixa aberto (modo antigo ou por operador) E (venda nos últimos 60 min OU incidente crítico já aberto —
-- sem internet nada chega, e o alerta não pode "resolver" sozinho por isso).
create or replace function public.controle_achados()
returns table (tenant_id text, codigo text, chave text, gravidade text, detalhe jsonb)
language sql stable security definer set search_path to '' as $function$
  with mon as (
    select a.tenant_id from public.assinaturas a where a.situacao in ('isento', 'ativa', 'atrasada')
  ), cx as (
    select m.tenant_id,
           (exists (select 1 from public.app_data d where d.tenant_id = m.tenant_id and d.key = 'cantina2:cashSession' and d.value->>'status' = 'open')
            or exists (select 1 from public.cash_turnos t where t.tenant_id = m.tenant_id and t.turno->>'status' in ('open', 'travado_abertura', 'travado_fechamento'))) as aberto
      from mon m
  ), func as (
    select cx.tenant_id from cx
     where cx.aberto
       and (exists (select 1 from public.sales s where s.tenant_id = cx.tenant_id and s.updated_at > now() - interval '60 minutes')
            or exists (select 1 from public.controle_incidentes i where i.tenant_id = cx.tenant_id and i.fechado_em is null and i.gravidade = 'critico'))
  ), sem_sinal as (
    -- Todos os aparelhos e agentes calados há > 3 min, tendo havido sinal na última hora.
    select f.tenant_id from func f
     where exists (select 1 from public.aparelhos_sinal s where s.tenant_id = f.tenant_id and s.visto_em > now() - interval '60 minutes')
       and not exists (select 1 from public.aparelhos_sinal s where s.tenant_id = f.tenant_id and s.visto_em > now() - interval '3 minutes')
       and not exists (select 1 from public.print_agents g where g.tenant_id = f.tenant_id and g.last_seen_at > now() - interval '3 minutes')
  ), achados as (
    select f.tenant_id, 'estabelecimento_sem_sinal'::text, ''::text, 'critico'::text,
           jsonb_build_object('desde', (select max(s.visto_em) from public.aparelhos_sinal s where s.tenant_id = f.tenant_id))
      from sem_sinal f
    union all
    select s.tenant_id, 'ficha_nao_enviada', s.aparelho_id, 'critico',
           jsonb_build_object('aparelho', s.nome, 'fichas', s.fichas_falhas, 'desde', s.fichas_desde)
      from public.aparelhos_sinal s join func f on f.tenant_id = s.tenant_id
     where s.fichas_falhas > 0 and s.fichas_desde < now() - interval '1 minute' and s.visto_em > now() - interval '5 minutes'
    union all
    -- Impressão parada: só impressoras que algum agente viu nos últimos 7 dias, e jobs de no máximo 6 h (piso de avisos.js).
    select j.tenant_id, 'impressao_parada', j.printer_name, 'critico',
           jsonb_build_object('impressora', j.printer_name, 'qtd', count(*), 'desde', min(j.created_at))
      from public.print_jobs j join func f on f.tenant_id = j.tenant_id
     where j.status = 'pendente' and j.created_at < now() - interval '2 minutes' and j.created_at > now() - interval '6 hours'
       and exists (select 1 from public.print_agent_printers p where p.tenant_id = j.tenant_id and p.name = j.printer_name and p.last_seen_at > now() - interval '7 days')
     group by j.tenant_id, j.printer_name
    union all
    select g.tenant_id, 'agente_sem_sinal', g.id::text, 'critico',
           jsonb_build_object('agente', g.name, 'desde', g.last_seen_at)
      from public.print_agents g join func f on f.tenant_id = g.tenant_id
     where g.last_seen_at < now() - interval '3 minutes' and g.last_seen_at > now() - interval '24 hours'
       and exists (select 1 from public.print_agent_printers p where p.agent_id = g.id and p.last_seen_at > now() - interval '7 days')
       and g.tenant_id not in (select tenant_id from sem_sinal)
    union all
    select s.tenant_id, 'venda_nao_subiu', s.aparelho_id, 'critico',
           jsonb_build_object('aparelho', s.nome, 'vendas', s.pend_vendas, 'caixa', s.pend_caixa, 'desde', s.pend_desde, 'erro', s.ultimo_erro)
      from public.aparelhos_sinal s join func f on f.tenant_id = s.tenant_id
     where s.pend_vendas + s.pend_caixa > 0 and s.pend_desde < now() - interval '2 minutes' and s.visto_em > now() - interval '5 minutes'
    union all
    select s.tenant_id, 'aparelho_sumiu', s.aparelho_id, 'critico',
           jsonb_build_object('aparelho', s.nome, 'usuario', s.usuario, 'desde', s.visto_em)
      from public.aparelhos_sinal s join func f on f.tenant_id = s.tenant_id
     where s.caixa_aberto and s.caixa_id is not null
       and s.visto_em < now() - interval '3 minutes' and s.visto_em > now() - interval '12 hours'
       and s.tenant_id not in (select tenant_id from sem_sinal)
    union all
    select s.tenant_id, 'aparelho_sumiu_com_pendencia', s.aparelho_id, 'atencao',
           jsonb_build_object('aparelho', s.nome, 'usuario', s.usuario, 'pendencias', s.pend_vendas + s.pend_caixa + s.fichas_falhas, 'desde', s.visto_em)
      from public.aparelhos_sinal s join func f on f.tenant_id = s.tenant_id
     where not (s.caixa_aberto and s.caixa_id is not null)
       and s.pend_vendas + s.pend_caixa + s.fichas_falhas > 0
       and s.visto_em < now() - interval '5 minutes' and s.visto_em > now() - interval '12 hours'
       and s.tenant_id not in (select tenant_id from sem_sinal)
    union all
    select t.tenant_id, 'caixa_travado', t.caixa_id, 'atencao',
           jsonb_build_object('caixa', t.caixa_id, 'operador', t.turno->>'operatorName', 'desde', t.turno->'pendencia'->>'at')
      from public.cash_turnos t join mon m on m.tenant_id = t.tenant_id
     where t.turno->>'status' like 'travado%'
       and coalesce(nullif(t.turno->'pendencia'->>'at', '')::timestamptz, now()) < now() - interval '10 minutes'
    union all
    select n.tenant_id, 'nfce_rejeitada', '', 'atencao',
           jsonb_build_object('qtd', count(*), 'motivo', (array_agg(n.motivo order by n.created_at desc))[1])
      from public.nfce_notas n join func f on f.tenant_id = n.tenant_id
     where n.ambiente = 1 and n.status in ('rejeitada', 'erro') and n.created_at > now() - interval '30 minutes'
     group by n.tenant_id
    union all
    select e.tenant_id, 'erros_tela', '', 'atencao', jsonb_build_object('qtd', count(*))
      from public.client_errors e join func f on f.tenant_id = e.tenant_id
     where e.at > now() - interval '10 minutes' and coalesce(e.source, '') <> 'aviso do topo'
     group by e.tenant_id having count(*) >= 5
  )
  select * from achados;
$function$;
revoke all on function public.controle_achados() from public, anon, authenticated;

-- Texto curto do WhatsApp (sem nome de cliente/sócio; colaborador e aparelho podem aparecer).
create or replace function public.controle_texto(p_codigo text, p_det jsonb, p_negocio text, p_resolvido boolean, p_aberto_em timestamptz)
returns text language sql immutable set search_path to '' as $function$
  select case when p_resolvido then '✅ ' else '🔴 ' end || coalesce(nullif(p_negocio, ''), 'Estabelecimento') || ' — '
    || case when p_resolvido then 'resolvido: ' else '' end
    || case p_codigo
         when 'estabelecimento_sem_sinal' then 'nenhum aparelho dá sinal (provável queda de internet ou energia)'
         when 'ficha_nao_enviada' then coalesce(p_det->>'fichas', '1') || ' ficha(s) de cozinha não chegaram ao servidor (' || coalesce(p_det->>'aparelho', 'aparelho') || ')'
         when 'impressao_parada' then 'impressora ' || coalesce(p_det->>'impressora', '') || ' parada (' || coalesce(p_det->>'qtd', '?') || ' ficha(s) esperando)'
         when 'agente_sem_sinal' then 'agente de impressão "' || coalesce(p_det->>'agente', '') || '" sem sinal'
         when 'venda_nao_subiu' then coalesce(p_det->>'aparelho', 'aparelho') || ' com venda que não subiu ao servidor'
         when 'aparelho_sumiu' then coalesce(p_det->>'aparelho', 'caixa') || ' parou de dar sinal com o caixa aberto'
         else p_codigo
       end
    || case when p_resolvido then ' (durou ' || greatest(1, round(extract(epoch from (now() - p_aberto_em)) / 60))::int || ' min)'
            else '. commandah.com.br/?controle' end;
$function$;
revoke all on function public.controle_texto(text, jsonb, text, boolean, timestamptz) from public, anon, authenticated;

create or replace function public.controle_avaliar()
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_abertos int := 0; v_fechados int := 0; v_avisos int := 0; n int;
begin
  -- Evita duas avaliações ao mesmo tempo (o índice único já impede duplicar; isto evita aviso em dobro).
  if not pg_try_advisory_xact_lock(hashtext('controle_avaliar')) then return jsonb_build_object('ocupado', true); end if;
  create temporary table if not exists _achados (tenant_id text, codigo text, chave text, gravidade text, detalhe jsonb) on commit drop;
  truncate _achados;
  insert into _achados select * from public.controle_achados();

  -- 1. Fecha o que sumiu (aviso de resolvido só para crítico que chegou a avisar).
  with fechados as (
    update public.controle_incidentes i set fechado_em = now()
     where i.fechado_em is null
       and not exists (select 1 from _achados a where a.tenant_id = i.tenant_id and a.codigo = i.codigo and a.chave = i.chave)
    returning i.*
  ), av as (
    insert into public.controle_avisos (incidente_id, para, texto)
    select f.id, o.whatsapp, public.controle_texto(f.codigo, f.detalhe, t.business_name, true, f.aberto_em)
      from fechados f join public.tenant_owners t on t.tenant_id = f.tenant_id
      cross join public.plataforma_operadores o
     where f.gravidade = 'critico' and f.avisos > 0 and o.ativo and o.whatsapp <> ''
    returning 1
  )
  select (select count(*) from fechados), (select count(*) from av) into v_fechados, n;
  v_avisos := v_avisos + n;

  -- 2. Atualiza o detalhe dos que continuam e abre os novos.
  update public.controle_incidentes i set detalhe = a.detalhe
    from _achados a where i.fechado_em is null and a.tenant_id = i.tenant_id and a.codigo = i.codigo and a.chave = i.chave;
  insert into public.controle_incidentes (tenant_id, codigo, chave, gravidade, detalhe)
  select a.tenant_id, a.codigo, a.chave, a.gravidade, a.detalhe from _achados a
  on conflict (tenant_id, codigo, chave) where fechado_em is null do nothing;
  get diagnostics v_abertos = row_count;

  -- 3. Avisa os críticos abertos que nunca avisaram ou cujo último aviso tem 15 min ou mais.
  with devidos as (
    update public.controle_incidentes i set ultimo_aviso_em = now(), avisos = i.avisos + 1
     where i.fechado_em is null and i.gravidade = 'critico'
       and (i.ultimo_aviso_em is null or i.ultimo_aviso_em <= now() - interval '15 minutes')
    returning i.*
  ), av as (
    insert into public.controle_avisos (incidente_id, para, texto)
    select d.id, o.whatsapp, public.controle_texto(d.codigo, d.detalhe, t.business_name, false, d.aberto_em)
      from devidos d join public.tenant_owners t on t.tenant_id = d.tenant_id
      cross join public.plataforma_operadores o
     where o.ativo and o.whatsapp <> ''
    returning 1
  )
  select count(*) into n from av;
  v_avisos := v_avisos + n;

  return jsonb_build_object('abertos', v_abertos, 'fechados', v_fechados, 'avisos', v_avisos);
end;
$function$;
revoke all on function public.controle_avaliar() from public, anon, authenticated;
grant execute on function public.controle_avaliar() to service_role;

create or replace function public.controle_limpar()
returns void language sql security definer set search_path to '' as $function$
  delete from public.controle_avisos where criado_em < now() - interval '30 days';
  delete from public.controle_incidentes where fechado_em < now() - interval '90 days';
  delete from public.aparelhos_sinal where visto_em < now() - interval '30 days';
  delete from public.quedas_conexao where inicio < now() - interval '90 days';
$function$;
revoke all on function public.controle_limpar() from public, anon, authenticated;

-- ---------- Agendamentos (só onde há pg_cron/pg_net; no banco local da bancada fica de fora) ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    execute $q$select cron.schedule('controle-avaliar', '* * * * *', $cmd$
      select public.controle_avaliar();
      select net.http_post(
        url := 'https://ezfoymdesmarpunmixbs.supabase.co/functions/v1/whatsapp',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-segredo', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'controle_segredo'), '')),
        body := '{"action":"alertas_enviar"}'::jsonb,
        timeout_milliseconds := 20000)
      where exists (select 1 from public.controle_avisos where enviado_em is null and tentativas < 5);
    $cmd$)$q$;
    execute $q$select cron.schedule('controle-limpar', '55 7 * * *', 'select public.controle_limpar()')$q$;
  else
    raise notice 'pg_cron/pg_net indisponivel: centro de controle nao agendado (banco local)';
  end if;
end
$$;
