# LGPD dos sócios: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o garçom recebe só os campos que usa do cadastro do sócio. A anonimização passa a rodar no banco e a limpar o nome em todos os lugares, menos na NFC-e. Toda madrugada o banco anonimiza quem passou do prazo. O admin vê quem vai sair com 7 dias de antecedência.

**Architecture:** a migration A cria as funções de leitura por papel, a anonimização, o expurgo diário e o agendamento no pg_cron. Ela não tira nada do garçom, então o front antigo continua funcionando. O front novo lê o cadastro sempre pelas funções e chama a anonimização no servidor. A migration B, aplicada depois da recarga dos aparelhos, tira o garçom das policies de leitura de `members` e `member_dependents`.

**Tech Stack:** Postgres/plpgsql (Supabase, pg_cron 1.6.4 disponível em produção e ainda não instalado), JS clássico sem build. Testes na bancada `../auditoria-2026-11-03`: `db/*.js` com `pg` (Postgres 18 local, sem pg_cron) e `e2e/*.js` com Playwright e `e2e/fakesupa.js`.

**Spec:** `docs/superpowers/specs/2026-11-15-lgpd-socios-design.md`

## Global Constraints

- Migration A: `supabase/migrations/20261119000000_lgpd_socios_banco.sql`. Migration B: `supabase/migrations/20261119010000_lgpd_garcom_sem_cadastro.sql`. Nunca editar migration já aplicada. Começar com `set lock_timeout = '5s';` e terminar com o bloco `-- ROLLBACK` comentado, como nas últimas migrations.
- Funções novas: `SECURITY DEFINER` (exceto as puras), `SET search_path TO ''`, nomes qualificados com `public.`. Rodar `revoke all ... from public, anon`. Dar `grant execute ... to authenticated` só a `members_list`, `member_dependents_list` e `member_anonymize`.
- Nome novo: `'Sócio anonimizado ' || upper(right(id, 4))`, igual ao front de hoje.
- Prazo: `cantina2:settings` → `privacy.anos`, inteiro limitado a 1–20 (padrão 2), em anos de calendário (`interval '1 year' * anos`). O front passa a usar a mesma conta.
- Ajuste do automático, por estabelecimento: `privacy.automatico` (boolean, ausente = `false`) e `privacy.automaticoDesde` (ISO, gravado ao ligar). Texto da tela: **"Anonimizar automaticamente quem passou do prazo"**.
- Data efetiva: `maior(archived_at + prazo, automaticoDesde) + 7 dias`. O expurgo anonimiza quando `agora >= data efetiva`.
- Colaborador (`kind='colaborador'`) nunca entra no automático nem nas listas de aviso. O botão manual continua valendo para ele.
- Tolerância de saldo: `abs(debt) > 0.005` recusa.
- Mensagens de recusa (aparecem na tela e no `audit_log`): `ja anonimizado`, `saldo diferente de zero`, `comanda aberta`, `sem permissao para anonimizar`, `socio nao encontrado`.
- Código, comentários, UI e commits em português. Comentários citam "item 6 (auditoria 11/11)".
- Depois de mudar `assets/js` ou `assets/css`, rodar `node scripts/bump-version.js`. Antes de cada commit de front, rodar `node scripts/check-app.js` e `node scripts/check-load-order.js`.
- Os testes `db/` e `e2e/` ficam na bancada, que não é versionada. Os commits levam só o repo.
- Nada é publicado neste plano. As migrations em produção, o merge, a recarga dos aparelhos e ligar o automático ficam para o dono dar "sim".

## Review Focus

1. **Nome com acento ou nome curto:** "José" precisa ser trocado em "Pago por José." e "Ana" não pode ser trocado dentro de "Banana" nem de "Anabela". O `\m` do Postgres com locale C não trata "é" como letra. Teste no Task 1 (`acento e palavra inteira`).
2. **Nome com aspas ou barra dentro de jsonb:** trocar no `::text` de um jsonb não pode quebrar o JSON (`O'Neil`, `Ana "Nina"`). Teste no Task 1 (`jsonb continua valido`).
3. **Sócio com nome igual a outra pessoa:** os textos livres ficam como estão; as linhas ligadas por id são trocadas. Teste no Task 3 (`nome repetido mantem texto livre`).
4. **Garçom marcado "Pode operar caixa" com o caixa por operador ligado:** ele cobra e cadastra no caixa, então lê o cadastro inteiro. Teste no Task 2 (`garcom operando caixa le tudo`).
5. **Expurgo com um sócio recusado no meio:** os outros são anonimizados, e a recusa entra no `audit_log` uma vez por dia. Teste no Task 4 (`recusa nao trava os demais`).

---

### Task 1: funções puras de texto e de data

**Files:**
- Create: `supabase/migrations/20261119000000_lgpd_socios_banco.sql` (primeira parte)
- Test: `../auditoria-2026-11-03/db/t-lgpd.js` (novo, no molde de `db/t-conferencia.js`: `como(ator)`, `um`, `erro`, `caso` com transação desfeita)

**Interfaces:**
- Produces:
  - `public.lgpd_trocar_texto(p_texto text, p_nomes text[], p_novo text) returns text`, immutable. Troca cada nome por `p_novo`, por palavra inteira e sem diferenciar maiúsculas. Nome vazio é ignorado. `p_texto` nulo devolve nulo.
  - `public.lgpd_trocar_jsonb(p_valor jsonb, p_nomes text[], p_novo text) returns jsonb`, immutable. Faz a mesma troca sobre `p_valor::text`, procurando a forma do nome escapada para JSON (`substr(to_json(nome)::text, 2, len-2)`), e devolve `::jsonb`.
  - `public.lgpd_data_efetiva(p_archived_at timestamptz, p_anos int, p_desde timestamptz) returns timestamptz`, immutable. Devolve `greatest(p_archived_at + interval '1 year' * p_anos, coalesce(p_desde, '-infinity')) + interval '7 days'`. Com `p_archived_at` nulo, devolve nulo.

Regra de palavra inteira (call do Claude): o locale do banco local é C, onde `\m`/`\M` e `[:alnum:]` não pegam letra acentuada. Usar lookaround com classe explícita: `(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ_])` + nome escapado + `(?![0-9A-Za-zÀ-ÖØ-öø-ÿ_])`, flag `'gi'`. O nome é escapado para regex (`regexp_replace(nome, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')`). Trocar os nomes do mais longo para o mais curto ("Ana Paula" antes de "Ana").

- [ ] **Step 1: Escrever os testes que falham** em `db/t-lgpd.js`, seção `funcoes puras` (como `postgres`):
  - `acento e palavra inteira`: `lgpd_trocar_texto('Pago por José. Banana e Anabela. ANA pediu', array['José','Ana'], 'X')` = `'Pago por X. Banana e Anabela. X pediu'`.
  - `mais longo primeiro`: `lgpd_trocar_texto('Ana Paula e Ana', array['Ana','Ana Paula'], 'X')` = `'X e X'`.
  - `regex escapado`: `lgpd_trocar_texto('Sr. (Zé)+ veio', array['(Zé)+'], 'X')` = `'Sr. X veio'`.
  - `jsonb continua valido`: `lgpd_trocar_jsonb('{"a":"O''Neil pagou","b":["Ana \"Nina\" ok"]}', array['O''Neil','Ana "Nina"'], 'X')` = `'{"a":"X pagou","b":["X ok"]}'::jsonb`.
  - `nulos`: texto nulo devolve nulo; `array['']` não muda o texto.
  - `data efetiva`: `lgpd_data_efetiva('2024-01-10', 2, null)` = `'2026-01-17'`; com `p_desde = '2026-11-20'` = `'2026-11-27'`; `archived_at` nulo devolve nulo.
- [ ] **Step 2: Rodar e ver falhar.** Na pasta da bancada: `REPO=../commandah-lgpd bash db/up.sh > db/up.log 2>&1 </dev/null && node db/t-lgpd.js`. Esperado: `function public.lgpd_trocar_texto(...) does not exist`.
- [ ] **Step 3: Implementar as três funções** na migration A, pela regra acima.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando. Esperado: todos os casos `ok`.
- [ ] **Step 5: Commit:** `feat(banco): troca de nome por palavra inteira e data do expurgo (item 6)`.

### Task 2: leitura do cadastro por papel

**Files:**
- Modify: `supabase/migrations/20261119000000_lgpd_socios_banco.sql`
- Test: `../auditoria-2026-11-03/db/t-lgpd.js` (seção `leitura`)

**Interfaces:**
- Consumes: `public.current_tenant_id()`, `public.current_staff_role()`, `public.cash_can_write()` e `public.caixa_por_operador_ligado()`, que já existem.
- Produces:
  - `public.lgpd_le_cadastro_inteiro() returns boolean`, stable. Devolve true para os papéis `owner`, `admin` e `caixa`. Para o garçom, devolve true só se `cash_can_write()` e `caixa_por_operador_ligado()`.
  - `public.members_list(p_id text default null, p_so_com_saldo boolean default false) returns setof public.members`. Devolve só linhas do `current_tenant_id()`, filtradas por `id = p_id` quando vier. Com `p_so_com_saldo`, devolve só `debt <> 0 or debt_release is not null`. Ordena por `id`. Quem lê o cadastro inteiro recebe a linha inteira. O garçom recebe a linha com tudo nulo ou vazio, menos `id, tenant_id, name, code, kind, debt, credit_limit, active, archived, debt_release, anonymized_at, created_at, updated_at`. `tags` vira `'{}'`, `points_history` vira `'[]'`, `points` vira 0 e `marketing_opt_in` vira false. Qualquer outro papel, ou sessão sem papel, recebe erro `sem permissao` (`42501`).
  - `public.member_dependents_list(p_member_id text default null) returns setof public.member_dependents`. Segue a mesma regra de papel. Para o garçom, `document` vem nulo.

- [ ] **Step 1: Escrever os testes que falham** (seção `leitura`; semear 2 sócios no `t-a` com CPF, telefone e 1 dependente com documento, e 1 sócio no `t-b`):
  - `garcom nao recebe cpf`: como `garcom`, `members_list()` devolve 2 linhas, com `document`, `phone`, `email`, `notes` e `address` nulos e `name`, `code`, `debt` e `kind` preenchidos.
  - `garcom dependente sem documento`: `member_dependents_list()` devolve o dependente com `name` e `can_order` e `document` nulo.
  - `caixa le tudo`: como `caixa`, `document` vem preenchido.
  - `garcom operando caixa le tudo`: `opera_caixa = true` e `cantina2:settings.caixaPorOperador = true` dá `document` preenchido. Com o ajuste desligado, vem nulo.
  - `outro estabelecimento nao aparece`: como `admin` do `t-a`, o sócio do `t-b` não vem.
  - `cozinha recusada`: como `cozinha`, `erro()` contém `sem permissao`.
  - `filtros`: `members_list('m1')` devolve só `m1`. `members_list(null, true)` devolve só quem tem `debt <> 0`.
- [ ] **Step 2: Rodar e ver falhar.** Mesmo comando do Task 1. Esperado: `function public.members_list does not exist`.
- [ ] **Step 3: Implementar** as três funções. Dar grant para `authenticated` só a `members_list` e `member_dependents_list`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit:** `feat(banco): garçom lê só os campos que usa do sócio (item 6)`.

### Task 3: anonimização no banco

**Files:**
- Modify: `supabase/migrations/20261119000000_lgpd_socios_banco.sql`
- Test: `../auditoria-2026-11-03/db/t-lgpd.js` (seção `anonimizar`)

**Interfaces:**
- Consumes: `lgpd_trocar_texto` e `lgpd_trocar_jsonb` (Task 1).
- Produces:
  - `public.member_anonymize_interno(p_tenant text, p_member_id text, p_origem text) returns jsonb`. Sem grant para `authenticated`. Devolve `{"ok":true,"nome_novo":"Sócio anonimizado XXXX"}` ou `{"erro":"<mensagem>"}`, com as mensagens das Global Constraints. `p_origem` é `'manual'` ou `'automatico'`.
  - `public.member_anonymize(p_member_id text) returns jsonb`, com grant para `authenticated`. Exige `current_staff_role()` em `('owner','admin')` e o sócio no `current_tenant_id()`. Senão devolve `{"erro":"sem permissao para anonimizar"}` (e `socio nao encontrado` quando o id não existe no tenant). Depois chama o interno com `'manual'`.
  - `public.audit_log_stamp()` regravada. Se `current_user` não for `authenticated` nem `anon`, `public.current_tenant_id()` for nulo e `current_setting('commandah.lgpd_tenant', true)` não for vazio, usa esse tenant e `actor_role := 'sistema'`. O resto continua igual.
  - `public.app_data_sales_somente_leitura()` regravada. Deixa passar quando `current_setting('commandah.lgpd_anonimizando', true) = 'on'`.

O que o interno faz, numa transação, nesta ordem:
1. Liga `set_config('commandah.lgpd_anonimizando','on',true)` e `set_config('commandah.lgpd_tenant',p_tenant,true)`.
2. Aplica as recusas, nesta ordem: `socio nao encontrado`, `ja anonimizado`, `saldo diferente de zero` (`abs(debt) > 0.005`) e `comanda aberta` (`sales` do tenant com `data->>'memberId' = id`, `status = 'open'`, `deleted_at is null` e `coalesce((data->>'canceled')::boolean, false) = false`). O construtor confere os nomes das colunas de `sales` antes de escrever o SQL.
3. Junta os nomes antigos: o nome do sócio mais os nomes dos dependentes, sem vazios. Calcula se algum deles é **repetido**: igual (sem diferenciar maiúsculas, sem espaços nas pontas) ao nome de outro sócio ainda não anonimizado do tenant, de um dependente de outro sócio ou de um `name` do blob `cantina2:users`.
4. Por id (sempre): em `members`, zera as colunas que o front zera hoje (`blank` em `assets/js/fiscal/nfce-config.js:157-160`), mais `latitude`, `longitude` e `geo_status`. Grava `archived=true`, `archived_at=coalesce(archived_at, now())`, `anonymized_at=now()` e `updated_at=now()`, e troca os nomes em `points_history` com `lgpd_trocar_jsonb`. Não toca em `kind`, `debt` nem `points`. Apaga de `member_dependents` as linhas do sócio. Em `sales` com `data->>'memberId' = id`: `customerName` vira o nome novo. Nos itens, `requesterName` vira o nome novo quando está entre os nomes antigos ou quando `requesterId = id`. Gravar com `updated_at = now()` e `version = version + 1`, para os aparelhos pegarem a mudança. Em `orders` dessas vendas, `who` vira o nome novo. Em `member_debt_entries` do sócio, `reason` e `info` passam por `lgpd_trocar_texto`. No `audit_log` com `entity='member'` e `entity_id = id`, `action` e `meta` passam pela troca.
5. Texto livre, só se não for repetido. Passam por `lgpd_trocar_texto`/`lgpd_trocar_jsonb`: o resto do `audit_log` do tenant (`action`, `meta`), `print_jobs.content`, `sale_close_receipts.result`, `cash_turnos.turno` e `client_errors.message`. No `app_data` do tenant, passam as chaves `like 'backup:%'`, `cantina2:logs`, `cantina2:requests`, `cantina2:scheduled`, `cantina2:cashHistory` e `cantina2:sales`. Atualizar só as linhas que mudam (`where valor_novo is distinct from valor`). Antes de escrever, o construtor roda no banco local `select table_name, column_name from information_schema.columns where table_schema='public' and data_type in ('text','jsonb')` e soma à lista qualquer outra coluna que guarde nome de pessoa. Fica de fora tudo o que começa com `nfce_`.
6. Grava no `audit_log` a ação `'LGPD: cadastro anonimizado (' || nome_novo || ') — ' || p_origem`, com `entity='member'`, `entity_id=id` e `meta = {"origem": p_origem, "nome_repetido": bool}`. Se repetiu, soma ` — nome repetido: textos livres mantidos` à ação.

- [ ] **Step 1: Escrever os testes que falham** (seção `anonimizar`). Semear o sócio `m1` "José Lima", com dependente "Ana", CPF, 1 venda fechada com `customerName` e item `requesterName` "Ana", 1 `orders` com `who` "José Lima", 1 `member_debt_entries` com `reason` "Pagamento de fiado: José Lima" (valor fechado, saldo zerado), `audit_log` com "Fiado: José Lima — R$ 30", `app_data` `backup:x` contendo "José Lima", `cantina2:sales` contendo "José Lima" e `print_jobs.content` com "Ana". Semear também "Banana" num `audit_log`.
  - `limpa todos os lugares`: como `admin`, `member_anonymize('m1')` devolve `ok`. Depois disso, `select count(*)` de cada tabela/chave acima com `ilike '%José Lima%'` ou `~* '\mAna\M'` é 0, e o texto "Banana" continua igual. `members.document` é nulo, `anonymized_at` não é nulo e `member_dependents` do `m1` está vazio.
  - `valores iguais`: `debt`, `points`, `sales.data->'total'` e a soma de `member_debt_entries.value` são iguais antes e depois.
  - `venda muda a versao`: `sales.version` sobe 1 e `updated_at` muda.
  - `recusa com saldo`: com `debt = 30`, devolve `{"erro":"saldo diferente de zero"}` e nada muda.
  - `recusa com comanda aberta`: devolve `comanda aberta`.
  - `recusa repetida`: na segunda chamada, devolve `ja anonimizado`.
  - `so admin`: como `caixa`, devolve `sem permissao para anonimizar`. Como `admin` do `t-b` com o id do `t-a`, devolve `socio nao encontrado`.
  - `nome repetido mantem texto livre`: com outro sócio "José Lima" ativo, a venda e o `member_debt_entries` do `m1` são trocados, o `backup:x` continua com "José Lima" e o `audit_log` tem `nome repetido`.
  - `interno sem sessao`: como `postgres`, sem claims, `member_anonymize_interno('t-a','m1','automatico')` devolve `ok`, e a linha do `audit_log` tem `tenant_id='t-a'` e `actor_role='sistema'`.
  - `blob de vendas segue so leitura`: como `postgres`, `update app_data set value=value where key='cantina2:sales'` ainda dá erro fora da função.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** as quatro funções.
- [ ] **Step 4: Rodar e ver passar.** Rodar também `node db/sqltest.js`, `node db/t-conferencia.js` e `node db/t-caixa-turnos.js`. Esperado: todos `ok` (o `audit_log_stamp` mudou).
- [ ] **Step 5: Commit:** `feat(banco): anonimização completa no servidor (item 6)`.

### Task 4: expurgo diário e agendamento

**Files:**
- Modify: `supabase/migrations/20261119000000_lgpd_socios_banco.sql`
- Test: `../auditoria-2026-11-03/db/t-lgpd.js` (seção `expurgo`)

**Interfaces:**
- Consumes: `lgpd_data_efetiva` (Task 1) e `member_anonymize_interno` (Task 3).
- Produces: `public.lgpd_expurgo_diario(p_agora timestamptz default now()) returns jsonb`, sem grant para `authenticated`. Devolve `{"anonimizados": n, "recusados": n}`.

Regra: percorre só os tenants com `cantina2:settings.privacy.automatico = true`. Em cada um, usa `anos` pela regra das Global Constraints e `desde = privacy.automaticoDesde`. Pega os sócios com `kind='socio'`, `archived`, `anonymized_at is null`, `archived_at is not null` e `p_agora >= lgpd_data_efetiva(archived_at, anos, desde)`. Chama o interno com `'automatico'` para cada um. Uma recusa vira linha no `audit_log` (`'LGPD: não anonimizado — ' || erro`, `entity='member'`), só se ainda não houver linha igual desse sócio no mesmo dia (`at::date` no fuso `America/Sao_Paulo`), e não interrompe os demais. Cada sócio roda dentro de um bloco `begin ... exception when others` próprio. Assim, um erro inesperado desfaz só aquele sócio e é registrado como recusa.

Agendamento, no fim da migration A, num bloco `do $$` (call do Claude):
- Se `pg_available_extensions` tiver `pg_cron`, roda `create extension if not exists pg_cron with schema pg_catalog` e, via `execute`, `cron.schedule('lgpd-expurgo-diario', '0 7 * * *', 'select public.lgpd_expurgo_diario()')`. Se não tiver (banco local), roda `raise notice` e segue.
- O job roda todo dia, mas não faz nada enquanto nenhum estabelecimento ligar `privacy.automatico`. Ligar é o passo do dono na tela (Task 6).

- [ ] **Step 1: Escrever os testes que falham** (seção `expurgo`, como `postgres`, com `p_agora` fixo):
  - `respeita o prazo`: com `anos: 2` e `automaticoDesde: '2026-01-01'`, sócio arquivado em `2024-01-10` e outro em `2025-06-01`. Com `p_agora = '2026-01-18'`, só o primeiro sai. Com `p_agora = '2026-01-16'`, ninguém sai.
  - `carencia ao ligar`: sócio arquivado em `2020-01-01`, com `automaticoDesde = '2026-11-20'`. Não sai em `'2026-11-26'` e sai em `'2026-11-27T12:00'`.
  - `desligado nao faz nada`: sem `privacy.automatico` ou com `false`, devolve `{"anonimizados":0,"recusados":0}`.
  - `colaborador fora`: com `kind='colaborador'` vencido, não sai.
  - `sem data fora`: com `archived_at` nulo, não sai e não gera recusa.
  - `recusa nao trava os demais`: sócio vencido com `debt = 10` e outro vencido sem saldo. O segundo sai e o primeiro gera 1 recusa no `audit_log`. Rodando de novo no mesmo `p_agora`, continua 1 linha de recusa.
  - `outro estabelecimento`: com `t-a` ligado e `t-b` desligado, o sócio vencido do `t-b` fica.
  - `migration sem pg_cron`: o `db/up.sh` aplica a migration A sem erro no Postgres local (já coberto pelo Step 2 de todos os tasks).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `lgpd_expurgo_diario` e o bloco de agendamento.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit:** `feat(banco): expurgo diário da LGPD, ligado por estabelecimento (item 6)`.

### Task 5: front lê o cadastro pelas funções

**Files:**
- Modify: `assets/js/core/dados-socios.js:61-115` (`MembersStore.load`, `refreshOne`, `refreshDebts`)
- Modify: `assets/js/operacao/garcom.js:292` (tira o telefone do sócio da tela do garçom)
- Modify: `../auditoria-2026-11-03/e2e/fakesupa.js` (bancada: `rpc/members_list` e `rpc/member_dependents_list`, devolvendo as linhas do tenant e respeitando `p_id`, `p_so_com_saldo` e `p_member_id`)
- Test: `../auditoria-2026-11-03/e2e/t58-lgpd.js` (novo, no molde de `e2e/t57-cota-clientes.js`)

**Interfaces:**
- Consumes: `members_list(p_id, p_so_com_saldo)` e `member_dependents_list(p_member_id)` (Task 2), chamados com `supabaseClient.rpc(nome, args)`. `fetchAllRows` continua paginando com `.range()`.
- Produces: o mesmo formato de objeto de sócio (`memberFromRow`) de hoje. Para o garçom, os campos que não vêm chegam vazios.

Em modo nuvem, as três leituras de `members` e `member_dependents` passam a usar as funções. O extrato (`member_debt_entries`) continua no select de hoje, porque a policy já barra o garçom e ele recebe lista vazia. O modo local não muda.

Depois, procurar no front todo uso de campo sensível do sócio em tela que o garçom abre (`grep -n "\.phone\|\.document\|\.notes\|\.email\|\.address" assets/js/operacao/garcom.js assets/js/vendas/*.js`) e tirar ou proteger com `||''`. A tela não pode mostrar "undefined".

- [ ] **Step 1: Escrever o teste que falha** em `e2e/t58-lgpd.js`:
  - `garcom carrega pela funcao`: entrar como garçom, abrir uma comanda do sócio semeado e conferir que o nome e a cota aparecem, que o telefone semeado não aparece em nenhum lugar do `document.body.innerText`, e que o `fakesupa` registrou chamada a `rpc/members_list` e nenhum `GET members`.
  - `caixa ve cadastro inteiro`: entrar como caixa, abrir Cadastros › Clientes › editar e conferir que o CPF semeado aparece no campo.
- [ ] **Step 2: Rodar e ver falhar.** Na bancada: `node e2e/t58-lgpd.js`. Esperado: nenhuma chamada a `rpc/members_list`.
- [ ] **Step 3: Implementar** as mudanças em `dados-socios.js` e `garcom.js` e os handlers no `fakesupa.js`.
- [ ] **Step 4: Rodar** `node scripts/bump-version.js`, `node scripts/check-app.js`, `node scripts/check-load-order.js`, `node e2e/t58-lgpd.js`, `node e2e/t29-perfil-garcom.js` e `node e2e/t57-cota-clientes.js`. Esperado: tudo ok.
- [ ] **Step 5: Commit:** `feat(front): cadastro do sócio lido pelo servidor conforme o papel (item 6)`.

### Task 6: anonimizar pelo servidor e tela de privacidade

**Files:**
- Modify: `assets/js/fiscal/nfce-config.js:121-125` (`savePrivacySettings`) e `:156-180` (`doAnonymizeMember`)
- Modify: `assets/js/sistema/lgpd.js:6` (`privacySettings`), `:25-38` (`membersPastRetention`, `openPrivacySettings`)
- Modify: `assets/js/core/avisos.js` (aviso do topo, no padrão dos avisos que já existem ali)
- Modify: `assets/js/sistema/novidades.js` (entrada no topo)
- Modify: `../auditoria-2026-11-03/e2e/fakesupa.js` (`rpc/member_anonymize`: devolve `{ok, nome_novo}` e grava `anonymized_at` no sócio do fake)
- Test: `../auditoria-2026-11-03/e2e/t58-lgpd.js` (casos novos)

**Interfaces:**
- Consumes: `member_anonymize(p_member_id)` (Task 3).
- Produces, em `lgpd.js`:
  - `privacySettings()` passa a devolver também `automatico: boolean` e `automaticoDesde: string|null`.
  - `lgpdDataEfetiva(member, ps) -> Date|null`, espelho de `lgpd_data_efetiva` (anos de calendário, mais 7 dias).
  - `lgpdListas() -> { proximos: [{member, data}], recusados: [{member, motivo}] }`. Só entram sócios `kind!=='colaborador'`, arquivados e não anonimizados. `proximos` traz quem tem a data efetiva até hoje + 7 dias e pode ser anonimizado. `recusados` traz quem tem a data efetiva até hoje e tem saldo ou comanda aberta, e também quem está arquivado sem `archivedAt` (motivo "sem data de arquivamento"). Motivos na tela: "saldo diferente de zero", "comanda aberta", "sem data de arquivamento".

Em modo nuvem, `doAnonymizeMember` chama `supabaseClient.rpc('member_anonymize', { p_member_id })`. Com `erro`, devolve a mensagem para o modal de PIN. Com `ok`, roda `MembersStore.refreshOne(id)`, aplica o nome novo em `state.sales` e `state.orders` (só na memória, sem `save`) e segue com o `closeModal/renderAll/toast` de hoje. O `logAction` sai, porque o servidor já grava. O modo local continua com o código de hoje.

Tela Privacidade (só no modo nuvem para o ajuste):
- Caixa de seleção "Anonimizar automaticamente quem passou do prazo". Ao marcar, grava `automatico: true` e, se ainda não houver, `automaticoDesde: new Date().toISOString()`. Ao desmarcar, grava `automatico: false` e mantém `automaticoDesde`. Abaixo da caixa: "O sistema anonimiza de madrugada, 7 dias depois de o sócio entrar na lista abaixo. Colaboradores ficam de fora."
- A lista atual "Sócios arquivados há mais de N anos" é trocada por duas: **"Serão anonimizados nos próximos 7 dias"** (nome, cota, data, botão Anonimizar para admin) e **"Não puderam ser anonimizados"** (nome, motivo, botão "Abrir cadastro" que chama `editMember(id)`).
- `savePrivacySettings` preserva `automatico` e `automaticoDesde`, que hoje seriam apagados ao salvar.

Aviso do topo: quando o usuário é admin, `privacy.automatico` está ligado e `lgpdListas().proximos.length > 0`, mostra uma vez por dia "N sócio(s) serão anonimizados nos próximos 7 dias. Ver em Configurações › Privacidade". A marca do dia fica em `localStorage` (`cantina2:lgpdAvisoDia`), dentro de try/catch.

Novidade: `id:'2026-11-XX-lgpd'`, título "Privacidade dos sócios". Texto: o garçom não recebe mais CPF, telefone e endereço; anonimizar apaga o nome também no histórico; dá para ligar a anonimização automática em Configurações › Privacidade. `perms:['config-sistema']`. A data fica para quando publicar.

- [ ] **Step 1: Escrever os testes que falham** em `e2e/t58-lgpd.js`:
  - `anonimizar chama o servidor`: como admin, anonimizar um sócio sem saldo. O `fakesupa` registra `rpc/member_anonymize`, nenhum `PATCH members` e o nome na lista vira "Sócio anonimizado XXXX".
  - `erro do servidor aparece`: o `fakesupa` devolve `{erro:'comanda aberta'}` e o modal mostra "comanda aberta".
  - `listas de privacidade`: semear 1 sócio vencido sem saldo, 1 vencido com fiado, 1 colaborador vencido e 1 arquivado sem data. A primeira lista mostra só o primeiro; a segunda mostra o segundo ("saldo diferente de zero") e o quarto ("sem data de arquivamento"); o colaborador não aparece.
  - `ligar grava a data`: marcar a caixa e salvar. `cantina2:settings.privacy` no fake tem `automatico: true` e `automaticoDesde` preenchido. Salvar de novo mantém o mesmo `automaticoDesde`.
  - `aviso uma vez por dia`: com o automático ligado e 1 sócio na primeira lista, o aviso aparece ao entrar e não aparece no segundo login do mesmo dia.
- [ ] **Step 2: Rodar e ver falhar.** `node e2e/t58-lgpd.js`.
- [ ] **Step 3: Implementar** as mudanças.
- [ ] **Step 4: Rodar** `node scripts/bump-version.js`, `node scripts/check-app.js`, `node scripts/check-load-order.js`, `node e2e/t58-lgpd.js` e `node e2e/t33-novidades.js`. Esperado: tudo ok.
- [ ] **Step 5: Commit:** `feat(front): anonimização no servidor e listas de privacidade (item 6)`.

### Task 7: migration B, garçom fora das policies

**Files:**
- Create: `supabase/migrations/20261119010000_lgpd_garcom_sem_cadastro.sql`
- Test: `../auditoria-2026-11-03/db/t-lgpd.js` (seção `policies`)

**Interfaces:**
- Consumes: `members_list` e `member_dependents_list` (Task 2), que continuam funcionando para o garçom.
- Produces: `members_select_por_papel` com `current_staff_role() in ('owner','admin','caixa')`, mais o garçom só quando `public.lgpd_le_cadastro_inteiro()`. Sai `member_dependents_select_garcom`. O cabeçalho avisa: **"aplicar só depois do merge do front e da recarga de todos os aparelhos"**. O `-- ROLLBACK` recria as duas policies como estão em `20261108000000_perfil_garcom.sql:154-180`.

- [ ] **Step 1: Escrever os testes que falham** (seção `policies`):
  - `garcom sem select direto`: como `garcom`, `select count(*) from members` = 0 e `select count(*) from member_dependents` = 0.
  - `garcom pela funcao`: como `garcom`, `members_list()` continua devolvendo 2 linhas.
  - `caixa continua`: como `caixa`, `select count(*) from members` = 2.
  - `garcom operando caixa`: com `opera_caixa` e o ajuste ligado, `select count(*) from members` = 2.
  - `extrato sem garcom`: como `garcom`, `select count(*) from member_debt_entries` = 0. Isso confere o que o spec pediu.
- [ ] **Step 2: Rodar e ver falhar.** Esperado: `garcom sem select direto` falha com 2.
- [ ] **Step 3: Implementar** a migration B.
- [ ] **Step 4: Rodar e ver passar** `node db/t-lgpd.js`, `node db/sqltest.js` e `node e2e/t29-perfil-garcom.js` (o app do garçom inteiro continua funcionando com as duas migrations aplicadas).
- [ ] **Step 5: Commit:** `feat(banco): garçom sem leitura direta do cadastro do sócio (item 6)`.

---

## Publicação (fora do plano, cada passo com "sim" do dono)

1. Aplicar a migration A em produção. Ela instala o pg_cron e agenda o job, que não faz nada enquanto o automático estiver desligado. Conferir em `cron.job`.
2. Fazer o merge do front e conferir no site.
3. Recarregar todos os aparelhos (caixa, garçons, PCs).
4. Aplicar a migration B.
5. O dono marca "Anonimizar automaticamente" em Configurações › Privacidade, quando quiser.
