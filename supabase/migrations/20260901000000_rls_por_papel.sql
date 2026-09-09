-- =====================================================================
-- COMMANDAH — RLS POR PAPEL (admin / caixa / cozinha)
-- Projeto Supabase: ezfoymdesmarpunmixbs
-- Data: 2026-09-01  |  Fase 2 do roadmap de seguranca
-- =====================================================================
--
-- ORDEM DE APLICACAO (obrigatoria)
-- --------------------------------
-- As mudancas de index.html da secao 0 JA FORAM APLICADAS e precisam estar
-- NO AR ANTES desta migration. Subir a migration com o frontend antigo
-- quebra a operacao: o caixa continuaria vendo botao de tela de admin e
-- levaria erro de permissao do banco no meio do expediente.
--   1. publicar o index.html novo;
--   2. conferir login de admin e de caixa no ar;
--   3. so entao rodar esta migration, em horario de baixo movimento —
--      nunca sexta a noite;
--   4. reteste imediato do fluxo de venda (secao 9).
--
-- O PROBLEMA
-- ----------
-- Nao existe camada de API: o navegador fala direto com o PostgREST com a
-- chave anon. A RLS de hoje so pergunta "esse dado e do meu tenant?" —
-- nunca "esse usuario tem papel pra isso?". Resultado: um operador de
-- caixa (ou de cozinha) autenticado pode abrir o devtools e ler/escrever
-- QUALQUER chave de app_data e QUALQUER linha de members. O filtro
-- ROLE_PERMS do index.html so esconde botao de menu — e nem isso ele faz
-- direito (ver secao 0, item 1).
--
-- A SOLUCAO
-- ---------
-- Descobrir o papel do usuario no servidor (current_staff_role()) e usar
-- esse papel como predicado de RLS. Como o valor de app_data e um blob
-- JSON, a granularidade possivel e a LINHA — ou seja, a coluna `key`.
-- Nao da pra esconder um campo dentro do JSON; ou o papel le a chave
-- inteira ou nao le nada dela.
--
-- INVARIANTE QUE ESTE ARQUIVO RESPEITA (nao quebrar!)
-- ---------------------------------------------------
-- Para todo par (papel, chave): se o papel pode ESCREVER, ele TEM que
-- poder LER. O motivo e brutal: storageApi.get() no index.html nao
-- distingue "linha nao existe" de "RLS filtrou a linha" — os dois casos
-- viram `data = null` -> state[key] = [] . Se um papel escrevesse sem
-- ler, o proximo save() gravaria o array VAZIO por cima do dado real.
-- Isso apagaria produtos/vendas/socios em producao.
--
-- ROLLBACK
-- --------
-- Ver secao 10 no fim do arquivo (volta as policies `for all` do baseline).
-- =====================================================================


-- =====================================================================
-- SECAO 0 — PRE-REQUISITOS NO index.html (JA IMPLEMENTADOS)
-- =====================================================================
-- Sem estes itens a migration QUEBRA a operacao. Todos ja estao no
-- index.html deste commit; ficam registrados aqui porque sao parte
-- inseparavel desta mudanca — quem der rollback na migration precisa
-- saber o que o frontend passou a esperar.
--
-- 1. renderRibbonToolbar() liberava TODO item de ribbon que tem `action:`
--    em vez de `view:` (`permitted = hasView ? allowed.includes(it.view)
--    : true`). Eram 39 itens abertos pra qualquer papel — o caixa via e
--    clicava em Configuracoes do Sistema, Bot WhatsApp (grava token),
--    Contas a Pagar, Logs, Cupons, Alterar em Lote, sem precisar de
--    devtools. FEITO: todo item de acao declara `perm:`, e item de acao
--    SEM `perm` passou a ser NEGADO (fail-closed), pra que item novo
--    adicionado no futuro sem permissao apareca bloqueado, nao aberto.
--
-- 2. loadAll() SEMEAVA dados quando um array vinha vazio (users, locais,
--    impressoras, estacoes, origens). storageApi.get() usa .maybeSingle():
--    linha filtrada pela RLS volta `null` SEM erro, igual a "nao existe" —
--    o cliente nao tem como distinguir. O seed entao gravaria o padrao por
--    cima do dado real (2 usuarios fake apagando os colaboradores, 10
--    locais genericos apagando as churrasqueiras). FEITO: so semeia quando
--    da pra PROVAR que a escrita e permitida — fora da nuvem (sem RLS) ou
--    com sessao de DONO. Operador nunca semeia. Chave cuja leitura estourou
--    tambem nunca e semeada.
--
-- 3. resolveTenantId() so consultava tenant_owners, entao uma sessao de
--    STAFF nao resolvia tenant no boot e caia na tela de login do dono —
--    o aparelho vivia logado como DONO, que nao tem papel e passa por
--    todas as policies deste arquivo. FEITO: resolveTenantSession() tenta
--    tenant_owners e, se nao for dono, resolve pela RPC current_tenant_id()
--    (SECURITY DEFINER — tenant_staff tem RLS com zero policies e o
--    navegador nao consegue le-la). Devolve tambem `isOwner`, usado no
--    item 2.
--
-- 4. btnLogout zerava currentUser mas NAO fazia auth.signOut(): a sessao
--    do operador que saiu continuava viva e o proximo herdava os
--    privilegios dela. Com RLS por papel isso seria escalada de
--    privilegio silenciosa (sair como admin, entrar como cozinha,
--    continuar com acesso de admin no banco). FEITO em btnLogout e em
--    gcLogout (app do garcom).
--    EFEITO COLATERAL TRATADO: sem sessao herdada, um usuario NAO migrado
--    entraria como `anon` e tomaria recusa em tudo. attemptPinLogin agora
--    barra esse login na nuvem com mensagem explicando o que fazer, em vez
--    de deixar entrar e falhar no meio da venda.
--
-- 5. Os 5 fluxos que o caixa usava pra gravar cantina2:settings (que passa
--    a ser escrita exclusiva de admin/dono) agora exigem 'config-sistema':
--      - Fila de Atendimento -> saveServiceQueueSettings
--      - Painel de Senhas    -> saveScoreboardSettings
--      - Impressoras         -> saveTicketConfig (bloco nem e renderizado)
--      - Clientes            -> addMemberTag / deleteMemberTag
--      - Cardapio Digital    -> openDigitalChannelConfig / saveDigitalChannel
--    Regra adotada, uniforme: TODO botao que grava settings exige
--    'config-sistema'. Alternativa (Fase 3): separar um blob
--    settings-operacional gravavel pelo caixa.
--
-- 6. logAction()/logPinFail() gravam em public.audit_log (secao 6) em vez
--    do blob; a tela de Logs virou exclusiva de admin e hidrata da tabela.
--    Modo Local segue usando o blob, igual antes.


-- =====================================================================
-- SECAO 1 — QUEM SOU EU: current_staff_role()
-- =====================================================================
-- Devolve 'owner' | 'admin' | 'caixa' | 'cozinha' | NULL.
-- O dono (tenant_owners) vem PRIMEIRO e nunca tem papel de staff: ele e
-- sempre 'owner' e passa por tudo. Isso preserva o acesso total do dono
-- exigido no baseline.
-- SECURITY DEFINER + search_path vazio pelo mesmo motivo de
-- current_tenant_id(): precisa ler tenant_owners/tenant_staff ignorando a
-- RLS dessas tabelas, sem abrir search_path hijacking.

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when exists (select 1 from public.tenant_owners where user_id = auth.uid())
      then 'owner'
    else (select role from public.tenant_staff
           where auth_user_id = auth.uid() and active = true)
  end;
$function$;

-- Atalho pro predicado mais repetido do arquivo. Deixa a policy legivel e
-- garante que "dono" e "admin" nunca divirjam por engano de digitacao.
create or replace function public.is_admin_like()
returns boolean
language sql
stable
set search_path to ''
as $function$
  select public.current_staff_role() in ('owner','admin');
$function$;

revoke all on function public.current_staff_role() from public;
revoke all on function public.is_admin_like()      from public;
grant execute on function public.current_staff_role() to anon, authenticated, service_role;
grant execute on function public.is_admin_like()      to anon, authenticated, service_role;


-- =====================================================================
-- SECAO 2 — CLASSIFICACAO DAS CHAVES DE app_data
-- =====================================================================
-- O valor e blob: a unica granularidade possivel e a linha (a `key`).
-- Em vez de repetir 30 nomes de chave em 4 policies, a decisao mora aqui,
-- num lugar so, auditavel.
--
--   catalogo    — cadastro/configuracao que o PDV LE o tempo todo pra
--                 montar tela e ticket. Todo mundo le, so admin escreve.
--   pedidos     — a fila da cozinha. Caixa cria, cozinha movimenta.
--   operacional — o dinheiro e o estoque do dia. Caixa le e escreve,
--                 cozinha nao encosta.
--   auditoria   — cantina2:logs. CONGELADA: ninguem escreve mais (o log
--                 vivo passa a ser a tabela public.audit_log, secao 6).
--   admin       — retaguarda (contas a pagar, fornecedores, fila de
--                 eventos). So admin/dono.
--
-- ATENCAO — O DEFAULT E 'admin' (fail-closed). Chave nova inventada por
-- um cliente comprometido cai em admin e nao vaza. O preco: TODA chave
-- nova legitima (feature futura) PRECISA ser adicionada aqui, senao o
-- caixa recebe erro de permissao e o fluxo quebra silenciosamente.
-- Isso vai na checklist de code review de qualquer PR que mexa em STORE.

create or replace function public.app_data_key_class(p_key text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_key
    -- catalogo: lido por todos os papeis, escrito so por admin/dono
    when 'cantina2:products'        then 'catalogo'
    when 'cantina2:categorias'      then 'catalogo'
    when 'cantina2:complementos'    then 'catalogo'
    when 'cantina2:observacoes'     then 'catalogo'
    when 'cantina2:perguntas'       then 'catalogo'
    when 'cantina2:paymentMethods'  then 'catalogo'
    when 'cantina2:cardBrands'      then 'catalogo'
    when 'cantina2:coupons'         then 'catalogo'
    when 'cantina2:locais'          then 'catalogo'
    when 'cantina2:impressoras'     then 'catalogo'
    when 'cantina2:estacoes'        then 'catalogo'
    when 'cantina2:origens'         then 'catalogo'
    when 'cantina2:settings'        then 'catalogo'
    when 'cantina2:users'           then 'catalogo'
    -- pedidos: unica chave que a cozinha escreve
    when 'cantina2:orders'          then 'pedidos'
    -- operacional: dinheiro e estoque do expediente
    when 'cantina2:sales'           then 'operacional'
    when 'cantina2:requests'        then 'operacional'
    when 'cantina2:scheduled'       then 'operacional'
    when 'cantina2:cashSession'     then 'operacional'
    when 'cantina2:cashHistory'     then 'operacional'
    when 'cantina2:cashMovements'   then 'operacional'
    when 'cantina2:orderCounter'    then 'operacional'
    when 'cantina2:insumos'         then 'operacional'
    when 'cantina2:stockMovements'  then 'operacional'
    -- auditoria: congelada
    when 'cantina2:logs'            then 'auditoria'
    -- retaguarda
    when 'cantina2:contas'          then 'admin'
    when 'cantina2:contaCategorias' then 'admin'
    when 'cantina2:fornecedores'    then 'admin'
    when 'cantina2:eventQueue'      then 'admin'
    else 'admin'  -- fail-closed
  end;
$function$;

revoke all on function public.app_data_key_class(text) from public;
grant execute on function public.app_data_key_class(text) to anon, authenticated, service_role;


-- =====================================================================
-- SECAO 3 — POLICIES DE app_data
-- =====================================================================
-- Sai a policy unica `for all` do baseline; entram policies POR COMANDO.
-- Uma policy por comando de proposito: duas policies permissivas no mesmo
-- comando se somam com OR e viram uma armadilha de revisao.

drop policy if exists tenant_isolated_access on public.app_data;

-- --- SELECT ----------------------------------------------------------
-- Quem le o que:
--   owner/admin -> tudo do tenant.
--   caixa       -> catalogo + pedidos + operacional. NAO le: retaguarda
--                  (contas a pagar, fornecedores) nem o log de auditoria.
--   cozinha     -> catalogo + pedidos. NAO le nada de dinheiro, estoque,
--                  socio, caixa ou log. O monitor de cozinha nao precisa.
-- Por que a cozinha le 'catalogo' inteiro e nao so orders: loadAll() le
-- todas as chaves no boot e SEMEIA users/locais/impressoras/estacoes/
-- origens quando vem vazio. Filtrar essas leituras faria o cliente tentar
-- gravar o seed por cima do dado real (ver invariante no cabecalho).
drop policy if exists app_data_select_por_papel on public.app_data;
create policy app_data_select_por_papel
  on public.app_data
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('catalogo','pedidos','operacional')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) in ('catalogo','pedidos')
      )
    )
  );

-- --- INSERT ----------------------------------------------------------
-- Mesma regra do UPDATE. Existe separada porque o cliente usa upsert:
-- a PRIMEIRA gravacao de uma chave que ainda nao tem linha e um INSERT.
-- 'auditoria' fica de fora de todos: o blob de logs esta congelado.
drop policy if exists app_data_insert_por_papel on public.app_data;
create policy app_data_insert_por_papel
  on public.app_data
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  );

-- --- UPDATE ----------------------------------------------------------
-- USING (linha antiga) e WITH CHECK (linha nova) com o MESMO predicado:
-- impede tanto escrever numa chave proibida quanto renomear a `key` de
-- uma linha permitida pra uma proibida no mesmo UPDATE.
drop policy if exists app_data_update_por_papel on public.app_data;
create policy app_data_update_por_papel
  on public.app_data
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  );

-- --- DELETE ----------------------------------------------------------
-- NENHUMA POLICY DE DELETE, DE PROPOSITO.
-- RLS ligada + zero policy de delete = DELETE negado pra anon e
-- authenticated, independente do GRANT. O index.html nunca apaga linha de
-- app_data (storageApi so faz upsert), entao ninguem perde nada — e apagar
-- a linha 'cantina2:sales' deixaria de ser possivel pelo navegador.


-- =====================================================================
-- SECAO 4 — POLICIES DE members / member_dependents / member_debt_entries
-- =====================================================================
-- Estas tabelas guardam PII de pessoa real (nome, documento, endereco,
-- telefone) e o saldo de fiado. A cozinha nao tem NENHUM motivo pra ver
-- isso — hoje ve tudo.
--
-- O caixa continua com leitura e escrita porque o PDV depende:
--   - bloqueio de fiado compara members.debt > members.credit_limit
--     (memberBlockedByDebt / blockIfMemberInDebt);
--   - busca de socio por nome/cota no balcao, comanda e delivery;
--   - cadastro rapido de cliente no PDV (savePdvQuickClient);
--   - lancamento de fiado da venda (recordDebtEntry, type='debt');
--   - pontos de fidelidade (applyAutomaticLoyalty).
-- Tirar qualquer um desses trava a venda. Nao mexer.
--
-- O que o caixa PERDE: ESTORNAR lancamento de fiado (UPDATE reversed=true
-- em member_debt_entries). Estorno e decisao financeira, vira admin/dono.

-- --- members ---------------------------------------------------------
drop policy if exists tenant_isolated_members on public.members;

drop policy if exists members_select_por_papel on public.members;
create policy members_select_por_papel
  on public.members
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );

drop policy if exists members_insert_por_papel on public.members;
create policy members_insert_por_papel
  on public.members
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );

-- UPDATE cobre editar cadastro, arquivar/desarquivar, pontos e o recalculo
-- de `debt` feito pelo trigger trg_recalc_member_debt (que NAO e SECURITY
-- DEFINER: roda como o usuario que gravou o lancamento — se o caixa
-- perdesse UPDATE aqui, lancar fiado quebraria).
drop policy if exists members_update_por_papel on public.members;
create policy members_update_por_papel
  on public.members
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );

-- Sem policy de DELETE: o sistema ja usa archived/archived_at, nunca hard
-- delete. Fecha o caminho de sumir com um socio (e com o fiado dele).

-- --- member_dependents ------------------------------------------------
-- Escrita liberada pro caixa porque saveMemberDependents() faz
-- DELETE-por-member_id + INSERT em lote ao salvar o cadastro do socio,
-- que o caixa acessa pela tela Clientes.
drop policy if exists tenant_isolated_member_dependents on public.member_dependents;
create policy member_dependents_por_papel
  on public.member_dependents
  for all
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );

-- --- member_debt_entries (ledger de fiado) ----------------------------
drop policy if exists tenant_isolated_member_debt_entries on public.member_debt_entries;

drop policy if exists debt_entries_select_por_papel on public.member_debt_entries;
create policy debt_entries_select_por_papel
  on public.member_debt_entries
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );

-- INSERT: o caixa PRECISA lancar o fiado da venda e o pagamento no balcao.
drop policy if exists debt_entries_insert_por_papel on public.member_debt_entries;
create policy debt_entries_insert_por_papel
  on public.member_debt_entries
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );

-- UPDATE: so admin/dono. O unico UPDATE que o sistema faz aqui e o
-- estorno (reversed = true), que zera a divida do socio no trigger.
-- Deixar isso na mao de qualquer operador e deixar a divida sumir.
drop policy if exists debt_entries_update_admin on public.member_debt_entries;
create policy debt_entries_update_admin
  on public.member_debt_entries
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.is_admin_like())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.is_admin_like())
  );

-- Sem policy de DELETE: historico financeiro nunca sofre hard delete
-- (estorno marca reversed, nao apaga). Vale ate pro dono via navegador.


-- =====================================================================
-- SECAO 5 — POLICIES DE print_jobs
-- =====================================================================
-- Quem enfileira impressao e o caixa (ticket de producao e comprovante).
-- A cozinha nao imprime pelo navegador — ela LE a tela. O agente desktop
-- nao usa esta policy (entra pelas funcoes print_agent_*, que sao
-- SECURITY DEFINER e autenticam por token).
-- UPDATE/DELETE ficam sem policy: quem muda status e o agente, pela RPC.
drop policy if exists tenant_isolated_print_jobs on public.print_jobs;

drop policy if exists print_jobs_select_por_papel on public.print_jobs;
create policy print_jobs_select_por_papel
  on public.print_jobs
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );

drop policy if exists print_jobs_insert_por_papel on public.print_jobs;
create policy print_jobs_insert_por_papel
  on public.print_jobs
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa')
  );


-- =====================================================================
-- SECAO 6 — AUDITORIA APPEND-ONLY (public.audit_log)
-- =====================================================================
-- POR QUE NAO DA PRA FAZER APPEND-ONLY NO BLOB:
-- logAction() faz `state.logs.unshift(...)` + `state.logs.slice(0,300)` +
-- save('logs') — ou seja, toda escrita e um REWRITE da linha inteira que
-- de proposito DESCARTA as entradas mais antigas. Do ponto de vista do
-- Postgres, "acrescentar um log" e "apagar o log de ontem" sao o mesmo
-- UPDATE, com a mesma forma. Nao existe predicado de RLS que separe os
-- dois (WITH CHECK nao enxerga a linha antiga), e um trigger de
-- containment quebraria justamente por causa do corte em 300.
-- Log editavel por quem e auditado nao e auditoria — e rascunho.
--
-- Por isso: tabela relacional, uma linha por evento, INSERT-only.
-- Custo: 1 tabela, 1 trigger, 3 policies, e trocar logAction() no cliente.

create table if not exists public.audit_log (
  id              uuid        not null default gen_random_uuid(),
  tenant_id       text        not null,
  at              timestamptz not null default now(),
  actor_auth_uid  uuid,               -- carimbado pelo servidor, nao pelo cliente
  actor_role      text,               -- idem
  actor_name      text,               -- nome de exibicao vindo do cliente
  action          text        not null,
  entity          text,               -- 'sale' | 'member' | 'cash' | ...
  entity_id       text,
  meta            jsonb       not null default '{}'::jsonb,
  constraint audit_log_pkey primary key (id)
);

-- Serve a tela de Logs (admin), que sempre filtra por tenant e ordena por
-- data decrescente.
create index if not exists idx_audit_log_tenant_at
  on public.audit_log using btree (tenant_id, at desc);

alter table public.audit_log enable row level security;

-- Carimbo server-side: o cliente NAO escolhe quem foi, nem quando, nem de
-- que tenant. Sem isso, um caixa poderia registrar acao em nome do admin.
create or replace function public.audit_log_stamp()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.tenant_id      := public.current_tenant_id();
  new.at             := now();
  new.actor_auth_uid := auth.uid();
  new.actor_role     := public.current_staff_role();
  if new.tenant_id is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_audit_log_stamp on public.audit_log;
create trigger trg_audit_log_stamp
  before insert on public.audit_log
  for each row execute function public.audit_log_stamp();

-- INSERT: todo papel loga (inclusive cozinha — mudanca de status de pedido
-- e evento auditavel). O trigger acima ja forcou tenant/ator.
drop policy if exists audit_log_insert_todos on public.audit_log;
create policy audit_log_insert_todos
  on public.audit_log
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) is not null
  );

-- SELECT: so admin/dono. Quem e auditado nao le a propria auditoria.
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin
  on public.audit_log
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.is_admin_like())
  );

-- SEM policy de UPDATE e SEM policy de DELETE — nem pro dono pelo
-- navegador. E isso que torna a tabela append-only de verdade. Expurgo por
-- retencao, se um dia precisar, e job de service_role (bypassa RLS).
grant select, insert on table public.audit_log to authenticated;
grant all            on table public.audit_log to service_role;
revoke update, delete on table public.audit_log from anon, authenticated;

revoke all on function public.audit_log_stamp() from public;


-- =====================================================================
-- SECAO 7 — CONGELAMENTO DO BLOB cantina2:logs
-- =====================================================================
-- A linha antiga NAO e apagada: ela guarda o historico que existe hoje
-- (143 entradas em 2026-08-31) e continua legivel por admin/dono pela
-- classificacao 'auditoria' da secao 2. O que muda e que nenhuma policy
-- de INSERT/UPDATE aceita mais essa chave — o blob vira somente-leitura,
-- pra sempre. O cliente para de chamar save('logs') na mesma entrega.
-- Nada a fazer em SQL aqui: ja esta coberto pelas policies da secao 3.


-- =====================================================================
-- SECAO 8 — O QUE ESTE ARQUIVO NAO RESOLVE (assumido, com data marcada)
-- =====================================================================
-- 1. next_order_number(), consume_insumos() e close_sale() sao SECURITY
--    INVOKER. Rodam com o privilegio de quem chama, entao o caixa PRECISA
--    de UPDATE direto em cantina2:orderCounter, cantina2:insumos e
--    cantina2:sales pra fechar venda — e foi por isso que essas 3 chaves
--    ficaram na classe 'operacional'. Efeito colateral: pelo devtools o
--    caixa ainda consegue reescrever esses blobs a mao (zerar estoque,
--    forjar venda). A correcao e a FASE 2b: transformar as 3 RPCs em
--    SECURITY DEFINER com checagem interna de papel, mover o append de
--    cantina2:stockMovements pra dentro de consume_insumos(), e entao
--    rebaixar sales/insumos/orderCounter/stockMovements pra somente
--    leitura do caixa. Nao foi feito aqui pra separar "policy nova"
--    (reversivel, sem tocar em codigo de venda) de "reescrever a RPC que
--    fecha a venda" (risco alto).
-- 2. cantina2:settings e um blob unico que mistura branding e SEGREDO de
--    integracao (settings.whatsappBot.token, settings.pixOnline.
--    clientSecret, settings.sms.token, settings.cloudBackup[*].token,
--    settings.digitalChannels[*].token). Como o PDV precisa LER settings
--    pra montar tela e ticket, TODO operador continua lendo esses tokens.
--    RLS por linha nao resolve isso — e nem deveria: segredo em blob que
--    chega no navegador ja esta exposto. Segredo de integracao tem que
--    sair de app_data e ir pra variavel de ambiente de Edge Function /
--    Vault. Fase 3.
-- 3. Nao existe operador 'cozinha' cadastrado em producao hoje
--    (tenant_staff tem 1 admin e 1 caixa, ambos migrados). As policies de
--    cozinha entram sem afetar ninguem — mas tambem entram SEM teste em
--    campo. Criar um operador cozinha de teste antes de confiar nelas.


-- =====================================================================
-- SECAO 9 — RETESTE OBRIGATORIO LOGO APOS APLICAR
-- =====================================================================
-- Rodar na ordem, com o bar fechado ou vazio. Qualquer item que falhar =
-- rollback imediato (secao 10), sem debugar em producao.
--
-- Como CAIXA (o que NAO pode quebrar):
--   [ ] abrir o caixa (cantina2:cashSession)
--   [ ] abrir comanda nova -> tira numero de pedido (next_order_number)
--   [ ] lancar item e enviar pra cozinha -> baixa estoque (consume_insumos)
--       e cria o pedido no monitor (cantina2:orders)
--   [ ] imprimir ticket (INSERT em print_jobs)
--   [ ] buscar socio por nome/cota; conferir que socio devedor acima do
--       limite continua BLOQUEADO (le members.debt / credit_limit)
--   [ ] cadastro rapido de cliente no PDV (INSERT em members)
--   [ ] fechar venda no dinheiro (close_sale)
--   [ ] fechar venda no fiado (INSERT em member_debt_entries + trigger
--       recalculando members.debt)
--   [ ] sangria e suprimento (cantina2:cashMovements)
--   [ ] fechar o caixa (cantina2:cashHistory)
--   [ ] conferir que NAO aparece banner de "falha ao salvar" em nenhum passo
--
-- Como CAIXA (o que TEM que estar bloqueado):
--   [ ] aba Configuracoes: itens de config aparecem desabilitados
--   [ ] aba Financeiro: Contas a Pagar/Receber/Fiado desabilitados
--   [ ] Logs e Fila de Eventos desabilitados
--   [ ] no devtools: select em app_data where key='cantina2:contas' -> 0 linhas
--   [ ] no devtools: update em app_data key='cantina2:products' -> recusado
--
-- Como COZINHA (criar um operador de teste — nao existe em producao):
--   [ ] entra direto no monitor, em Modo TV
--   [ ] move pedido pendente -> preparo -> pronto -> entregue
--   [ ] no devtools: select em members -> 0 linhas
--   [ ] no devtools: select em app_data where key='cantina2:sales' -> 0 linhas
--
-- Auditoria:
--   [ ] admin abre Logs e ve os eventos da sessao do caixa
--   [ ] caixa NAO consegue abrir Logs
--   [ ] no devtools como caixa: update/delete em audit_log -> recusado
--
-- =====================================================================
-- SECAO 10 — ROLLBACK
-- =====================================================================
-- Reverte para as policies `for all` do baseline. Cola e roda no SQL
-- Editor se algo travar a operacao (a intencao e voltar em <1 minuto,
-- sem deploy de frontend).
--
-- drop policy if exists app_data_select_por_papel      on public.app_data;
-- drop policy if exists app_data_insert_por_papel      on public.app_data;
-- drop policy if exists app_data_update_por_papel      on public.app_data;
-- create policy tenant_isolated_access on public.app_data for all
--   using (tenant_id = public.current_tenant_id())
--   with check (tenant_id = public.current_tenant_id());
--
-- drop policy if exists members_select_por_papel on public.members;
-- drop policy if exists members_insert_por_papel on public.members;
-- drop policy if exists members_update_por_papel on public.members;
-- create policy tenant_isolated_members on public.members for all
--   using (tenant_id = public.current_tenant_id())
--   with check (tenant_id = public.current_tenant_id());
--
-- drop policy if exists member_dependents_por_papel on public.member_dependents;
-- create policy tenant_isolated_member_dependents on public.member_dependents for all
--   using (tenant_id = public.current_tenant_id())
--   with check (tenant_id = public.current_tenant_id());
--
-- drop policy if exists debt_entries_select_por_papel on public.member_debt_entries;
-- drop policy if exists debt_entries_insert_por_papel on public.member_debt_entries;
-- drop policy if exists debt_entries_update_admin     on public.member_debt_entries;
-- create policy tenant_isolated_member_debt_entries on public.member_debt_entries for all
--   using (tenant_id = public.current_tenant_id())
--   with check (tenant_id = public.current_tenant_id());
--
-- drop policy if exists print_jobs_select_por_papel on public.print_jobs;
-- drop policy if exists print_jobs_insert_por_papel on public.print_jobs;
-- create policy tenant_isolated_print_jobs on public.print_jobs for all
--   using (tenant_id = public.current_tenant_id())
--   with check (tenant_id = public.current_tenant_id());
--
-- ATENCAO — public.audit_log DEVE FICAR no rollback.
-- O index.html ja publicado escreve nela (logAction/logPinFail) e le nela
-- (tela de Logs). Derrubar a tabela faria todo logAction falhar. Como o
-- insert e fire-and-forget, nao travaria venda — mas o sistema ficaria sem
-- nenhum registro de auditoria, que e o oposto do objetivo.
-- So faz sentido dropar junto com um rollback do frontend:
--   drop table if exists public.audit_log;
--   drop function if exists public.audit_log_stamp();
-- =====================================================================
