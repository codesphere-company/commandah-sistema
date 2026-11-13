# Caixa por operador — etapa 1 (caixas, turnos, contagem e trava) — plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** com o ajuste "Caixa por operador" ligado, cada computador marcado (Caixa 1, Caixa 2) tem o seu turno, aberto e fechado com contagem às cegas; qualquer diferença trava o caixa até um administrador diferente de quem contou (PIN) ou o dono (de longe) liberar.

**Architecture:** tabela nova `public.cash_turnos` (uma linha por caixa, escrita só por RPC `security definer` com `for update`, como BD-03). No front, `state.cashSession` continua sendo "o caixa que vale neste aparelho": `refreshCashState()` passa a resolvê-lo a partir da linha do caixa do aparelho (ou do caixa escolhido para o app). Assim as ~48 leituras de `state.cashSession` espalhadas pelo código não mudam, e um turno com status diferente de `'open'` já bloqueia pagamento onde hoje se testa `status!=='open'`. Liberação por PIN passa pela `staff-auth`; a do dono, por RPC com a sessão de dono. Com o ajuste desligado, tudo funciona como hoje.

**Tech Stack:** JS puro (scripts clássicos), Postgres/RLS, Edge Function Deno (`staff-auth`), bancada local `../auditoria-2026-11-03` (Postgres 18 + `e2e/fakesupa.js` + Chrome sem janela).

**Spec:** `docs/superpowers/specs/2026-11-13-caixa-por-operador-design.md` (seções da etapa 1: objetivos 1–6 e 9; cofre e Caixa Campo ficam para as etapas 2 e 3).

## Global Constraints

- Ajuste `settings.caixaPorOperador` (boolean, padrão `false`). Desligado = comportamento de hoje, sem contagem obrigatória. Ligado = este plano.
- Lista de caixas em `settings.caixas` = `[{id:'cx1',nome:'Caixa 1'},{id:'cx2',nome:'Caixa 2'}]` (padrão quando ausente). Caixa dos pagamentos do app: `settings.caixaDoApp` (padrão `'cx1'`).
- Marcação do aparelho: `localStorage['commandah:caixaDoAparelho']` = id do caixa. Ler e gravar com try/catch.
- **Sem margem:** diferença = `round(contado*100) - round(esperado*100)`; qualquer valor ≠ 0 trava. Nunca comparar em ponto flutuante.
- Contagem só de dinheiro. Campo da contagem sempre vazio; esperado e diferença só aparecem para quem passa em `podeVerTotaisDoCaixa()`. As RPCs devolvem a pendência **sem** `esperado`/`diferenca` para quem não é admin/dono.
- Liberação: admin com `staff_id` ≠ quem contou, ou dono (sessão de dono; pode liberar a própria contagem). Autoliberação de admin é recusada no servidor.
- Turno travado não recebe pagamento (status ≠ `'open'`).
- Uma pessoa tem no máximo um turno aberto/travado por vez. Admin/dono podem fechar o turno de outro (registra `fechadoNoLugarDe`).
- Primeira abertura de um caixa (sem contagem anterior): não há esperado, abre sem trava e registra `primeiraAbertura:true` (decisão do Claude no plano).
- Migration nova `supabase/migrations/20261116000000_caixa_por_operador.sql` (não editar migration aplicada; rollback comentado no fim). Aplicar em produção e publicar `staff-auth` **só com o "sim" do dono no chat**.
- Scripts clássicos; arquivo novo vai no `index.html` na ordem; depois de mexer em `assets/`: `node scripts/bump-version.js`, `node scripts/check-app.js`, `node scripts/check-load-order.js`. Escape com `h`/`jsArg`. Ações que gravam passam por `singleFlight`. Código, comentários e UI em português, citando "caixa por operador (13/11)".
- Entrada em NOVIDADES (`assets/js/sistema/novidades.js`) com `perms:['caixa']`.
- Trabalhar num worktree/branch `feat/caixa-por-operador` a partir da `main`.

## Review Focus

1. **Aparelho com a versão antiga aberta** chamando `cash_session_open`/`cash_session_close` com o ajuste ligado: o servidor recusa com "caixa por operador ligado: recarregue a página" (teste SQL `antigo-recusado`, Task 1).
2. **Dois computadores marcados com o mesmo caixa**: o segundo a abrir recebe o turno já aberto e passa a usá-lo, sem criar outro (teste SQL `mesmo-caixa-dois-aparelhos`, Task 1).
3. **Pagamento pelo app indo para um caixa travado ou fechado**: o app mostra "O Caixa 1 está fechado ou travado. Peça para abrirem o caixa." e não cobra (etapa `app-caixa-travado`, Task 6).
4. **Operador sai do sistema com o turno travado**: o turno continua travado; quem logar naquele computador vê a tela de trava e a liberação ainda funciona (etapa `trava-sobrevive-logout`, Task 4).
5. **Centavos em ponto flutuante** (contado `10.30` contra esperado `10.1+0.2`): não trava; contado `10.29` trava (teste SQL `centavos`, Task 1).

---

### Task 1: Banco — tabela de turnos, marcação "opera caixa" e RPCs

**Files:**
- Create: `supabase/migrations/20261116000000_caixa_por_operador.sql`
- Create (bancada): `../auditoria-2026-11-03/db/t-caixa-turnos.js` (mesmo jeito de `db/sqltest.js`: transação desfeita, `set_config('request.jwt.claims', ...)`)

**Interfaces:**
- Produces:
  - `alter table tenant_staff add column opera_caixa boolean not null default false`; backfill `update tenant_staff set opera_caixa = true where role = 'caixa'`.
  - `public.current_staff_id() returns text`: `tenant_staff.id` de `auth.uid()` ativo, `'owner'` para o dono, senão `null`. Se já existir uma função equivalente no banco, reusar.
  - `public.cash_can_write()` recriada: `is_admin_like() or exists(tenant_staff ativo de auth.uid() com opera_caixa)`.
  - `public.caixa_por_operador_ligado() returns boolean`: `coalesce((settings->>'caixaPorOperador')::boolean,false)` de `app_data` `cantina2:settings` do tenant atual.
  - Tabela `public.cash_turnos(tenant_id text, caixa_id text, turno jsonb, ultima_contagem numeric, updated_at timestamptz default now(), primary key(tenant_id, caixa_id))`, RLS ligada, policy só de `select` para `current_tenant_id() = tenant_id`. Sem policy de escrita. Na publicação, entra no realtime se o projeto já usa realtime para `app_data` (conferir; senão, o front faz polling).
  - Formato de `turno` (jsonb): `{id, caixaId, displayId, status:'open'|'travado_abertura'|'travado_fechamento', operatorId, operatorName, openedAt, openingAmount, openingNote, primeiraAbertura?, pendencia?:{id, tipo:'abertura'|'fechamento', contouId, contouNome, esperado, contado, diferenca, pedidoDono:boolean, at, closed?:jsonb}, liberacoes:[{tipo, por, porNome, como:'pin'|'dono', esperado, contado, diferenca, at}]}`.
  - RPCs (`security definer`, `search_path=''`, `grant execute` a `authenticated`), todas recusam se `not caixa_por_operador_ligado()` ou `not cash_can_write()`. Todas devolvem `{ok:boolean, turno:jsonb|null, motivo?:text}`, com `esperado`/`diferenca` da pendência removidos para quem não é `is_admin_like()`:
    - `cash_turno_abrir(p_caixa text, p_contado numeric, p_nota text, p_turno jsonb)`: trava a linha (cria se faltar). Se já houver turno com status ≠ fechado, devolve `ok:false, motivo:'ja_aberto'` com o turno. Se `current_staff_id()` já tem turno em outro caixa, `motivo:'outro_turno'`. Esperado = `ultima_contagem`; se `null`, abre com `primeiraAbertura`. Bate → `status:'open'`, `openingAmount = p_contado`. Não bate → `status:'travado_abertura'` com a pendência.
    - `cash_turno_recontar(p_caixa text, p_turno_id text, p_contado numeric)`: só para turno travado. Atualiza a pendência; se bater, aplica como abertura ou fechamento normal (e limpa `pedidoDono`).
    - `cash_turno_fechar(p_caixa text, p_turno_id text, p_closed jsonb)`: `p_closed` é o fechamento montado pelo front, como hoje (`finalizeCashSession`), com `countedAmount` e `expectedAmount`. Diferença 0 → põe `p_closed + {caixaId, liberacoes}` no topo de `cantina2:cashHistory` (sem duplicar o id), grava `ultima_contagem = countedAmount` e deixa `turno = null`. Diferença ≠ 0 → `status:'travado_fechamento'`, pendência com `closed = p_closed`. Admin/dono fechando turno de outro: grava `fechadoNoLugarDe` no fechamento.
    - `cash_turno_pedir_dono(p_caixa text, p_turno_id text)`: marca `pendencia.pedidoDono = true`.
    - `cash_turno_liberar_dono(p_caixa text, p_turno_id text, p_pendencia_id text, p_aprovar boolean)`: só `current_staff_role() = 'owner'` (respeita a trava de 2FA da migration `20261115000000`). Aprovar → aplica a pendência (abertura: `status:'open'`, `openingAmount = contado`; fechamento: conclui como no `cash_turno_fechar`) e acrescenta em `liberacoes` com `como:'dono'`. Recusar → `pendencia.pedidoDono = false`, `pendencia.recusada = true`, turno continua travado.
    - `cash_turno_liberar_admin(p_tenant text, p_caixa text, p_turno_id text, p_pendencia_id text, p_admin_id text, p_admin_nome text)`: `grant execute` **só a `service_role`** (chamada pela `staff-auth`). Recusa se `p_admin_id = pendencia.contouId`. Aplica como o dono, com `como:'pin'`.
  - `cash_session_open` e `cash_session_close` recriados com a mesma lógica + `raise exception 'caixa por operador ligado: recarregue a página'` quando `caixa_por_operador_ligado()`.

- [ ] **Step 1: Escrever os testes SQL** em `db/t-caixa-turnos.js`. A preparação de cada caso liga `caixaPorOperador` em `cantina2:settings` de `t-a`, cria um segundo admin `s-adm2` e põe `opera_caixa = true` num garçom. Casos (nome — esperado):
  - `desligado-recusa` — com o ajuste desligado, `cash_turno_abrir` dá exceção.
  - `antigo-recusado` — com o ajuste ligado, `cash_session_open` dá exceção com 'recarregue a página'.
  - `primeira-abertura` — caixa sem `ultima_contagem`: `ok:true`, `status:'open'`, `primeiraAbertura:true`.
  - `abre-bate` — `ultima_contagem = 200`, contado `200`: `status:'open'`, `openingAmount = 200`.
  - `abre-diverge` — contado `199.99`: `status:'travado_abertura'`; como caixa, a pendência vem sem `esperado`; como admin, com `esperado = 200` e `diferenca = -0.01`.
  - `centavos` — `ultima_contagem = 10.3`, contado `10.30`: abre; contado `10.29`: trava.
  - `mesmo-caixa-dois-aparelhos` — duas chamadas `cash_turno_abrir` para `cx1`: a segunda devolve `ok:false, motivo:'ja_aberto'` e o turno da primeira.
  - `outro-turno` — o mesmo operador abre `cx1` e tenta `cx2`: `motivo:'outro_turno'`.
  - `recontar-libera` — travado, recontagem com o valor certo: `status:'open'`.
  - `fechar-bate` — fechamento com `countedAmount = expectedAmount = 350`: entra em `cashHistory` com `caixaId:'cx1'`, `ultima_contagem = 350`, `turno` nulo.
  - `fechar-diverge` — `countedAmount 340`, `expectedAmount 350`: `status:'travado_fechamento'`, nada em `cashHistory`.
  - `admin-autoliberacao` — como `service_role`, `cash_turno_liberar_admin` com `p_admin_id` = quem contou: exceção.
  - `admin-libera` — com `s-adm2`: abertura vira `open`, `liberacoes[0].como = 'pin'`.
  - `dono-libera-fechamento` — dono aprova: fechamento vai para `cashHistory` com a liberação, `ultima_contagem = 340`.
  - `dono-recusa` — continua travado, `pendencia.recusada = true`.
  - `garcom-sem-marcacao` — garçom sem `opera_caixa`: `cash_turno_abrir` dá exceção; com a marcação, abre.
  - `escrita-direta` — `insert`/`update` em `cash_turnos` como admin: recusado pela RLS.
  - `outro-tenant` — dono de `t-b` não lê as linhas de `t-a`.
- [ ] **Step 2: Ver falhar:** `bash db/up.sh > db/up.log 2>&1 </dev/null && node db/t-caixa-turnos.js` → falha (funções não existem).
- [ ] **Step 3: Escrever a migration.** Copiar as definições atuais (`cash_can_write`, `cash_session_open`, `cash_session_close`) da última migration que as define e mudar só o que está acima.
- [ ] **Step 4: Ver passar:** `node db/t-caixa-turnos.js` → todos `ok`; `node db/sqltest.js` sem falha nova.
- [ ] **Step 5: Commit** — `feat(caixa): turnos por caixa com contagem e trava no banco (caixa por operador, 13/11)`.

### Task 2: staff-auth — liberação por PIN e marcação "opera caixa"

**Files:**
- Modify: `supabase/functions/staff-auth/index.ts` (ramo `verify`/`price_override`, perto da linha 270; ações de admin perto de `set_role`, linha 388)
- Create (bancada): `../auditoria-2026-11-03/e2e/t54-caixa-liberacao.js` (mesmo jeito de `e2e/t53-pin-obvio.js`: `fn(body, token)` contra a staff-auth real)

**Interfaces:**
- Consumes: `cash_turno_liberar_admin` (Task 1), coluna `tenant_staff.opera_caixa`.
- Produces:
  - action `cash_release` `{staff_id, pin, caixa_id, turno_id, pendencia_id}`: confere o PIN (`checkStaffPin`, com bloqueio progressivo), exige `staff.role === 'admin'` (senão 403 "Só administrador libera o caixa.") e chama `admin.rpc('cash_turno_liberar_admin', {...})` com o tenant do staff. Autoliberação → 403 "Quem contou não pode liberar a própria contagem. Chame outro administrador ou peça ao dono." Grava `audit_log` "Divergência do caixa liberada: <caixa> <tipo> R$ <dif> (contou: X, liberou: Y)". Devolve `{ok:true, turno}`.
  - action `set_opera_caixa` `{staff_id, opera_caixa:boolean, by}`: mesmas checagens de dono/admin de `set_role`. Atualiza a coluna e grava `audit_log`. Devolve `{ok:true, opera_caixa}`.
  - `login` e `verify` passam a devolver `opera_caixa`.

- [ ] **Step 1: Testes** em `t54-caixa-liberacao.js` (nome — esperado):
  - `pin-errado` → 401;
  - `nao-admin` (Caio) → 403;
  - `autoliberacao` (Ana contou, Ana libera) → 403 com a mensagem acima;
  - `libera` (Ana contou, segundo admin libera) → 200, turno `open`, linha no `audit_log`;
  - `set-opera-caixa` (dono liga para Gabi) → coluna `true` e `login` da Gabi devolve `opera_caixa:true`;
  - `set-opera-caixa-sem-permissao` (Caio tenta) → 403.
- [ ] **Step 2: Ver falhar:** `node e2e/t54-caixa-liberacao.js` → actions desconhecidas.
- [ ] **Step 3: Implementar** as duas actions e o campo novo do `login`/`verify`.
- [ ] **Step 4: Ver passar:** `node e2e/t54-caixa-liberacao.js` e `node e2e/t7-staff-auth.js` → tudo `ok`.
- [ ] **Step 5: Commit** — `feat(staff-auth): liberar divergência do caixa por PIN e marcação opera caixa`.

### Task 3: Front — ajuste, caixas, marcação do aparelho e resolução do turno

**Files:**
- Modify: `assets/js/core/caixa-multiaparelho.js` (`refreshCashState`, linha 193)
- Modify: `assets/js/sistema/configuracoes.js` (ajuste, lista de caixas, caixa do app, "Este computador é o…")
- Modify: `assets/js/core/dados.js` (carga inicial: no modo ligado, lê `cash_turnos` em vez de `cantina2:cashSession`)
- Create (bancada): `../auditoria-2026-11-03/e2e/t55-caixa-por-operador.js` (usado também nas Tasks 4–8)

**Interfaces:**
- Consumes: tabela `cash_turnos` (Task 1).
- Produces (globais, em `caixa-multiaparelho.js`):
  - `modoCaixaPorOperador(): boolean` (lê `state.settings.caixaPorOperador`)
  - `listaDeCaixas(): {id,nome}[]` (padrão Caixa 1/Caixa 2)
  - `caixaDoAparelho(): string|null` e `marcarCaixaDoAparelho(id: string|null): void` (localStorage)
  - `caixaQueVale(): string|null`: `caixaDoAparelho()` ou, sem marcação, `state.settings.caixaDoApp || 'cx1'`
  - `nomeDoCaixa(id): string`
  - `state.cashTurnos: {[caixaId]: turno|null}`. No modo ligado, `refreshCashState()` lê todas as linhas de `cash_turnos` do tenant, guarda em `state.cashTurnos` e faz `state.cashSession = state.cashTurnos[caixaQueVale()] || null`. No modo desligado, nada muda.
  - Polling: no modo ligado, `refreshCashState()` a cada 5 s enquanto o turno deste aparelho estiver travado ou houver pendência com `pedidoDono` e a sessão for de dono; senão, a cada 30 s.

- [ ] **Step 1: Teste** em `t55` (etapa `config`): o dono liga o ajuste e marca o aparelho como Caixa 1 → `caixaDoAparelho() === 'cx1'`; o título da tela Caixa mostra "Caixa 1"; com o ajuste desligado, a tela Caixa é a de hoje (campo "Saldo inicial" preenchido).
- [ ] **Step 2: Ver falhar:** `node e2e/t55-caixa-por-operador.js <pasta>` → etapa `config` falha.
- [ ] **Step 3: Implementar** as funções e as telas de configuração. A marcação do aparelho só aparece para admin/dono.
- [ ] **Step 4: Ver passar:** etapa `config` ok; `node e2e/t2-fluxos.js` (fluxos com o ajuste desligado) sem falha nova.
- [ ] **Step 5: Commit** — `feat(caixa): ajuste caixa por operador e marcação do computador`.

### Task 4: Tela do Caixa — abrir com contagem, trava, liberar e fechar

**Files:**
- Modify: `assets/js/operacao/caixa.js` (`renderCaixa` linhas 12–37; `openCloseCashModal` 155; `finalizeCashSession` 185; vendas da sessão linhas 47 e 149)

**Interfaces:**
- Consumes: RPCs `cash_turno_*` (Task 1), action `cash_release` (Task 2), funções da Task 3.
- Produces:
  - `renderCaixaPorOperador(el)`: chamada por `renderCaixa()` quando `modoCaixaPorOperador()`. Três estados:
    1. Aparelho sem marcação → "Este computador não é um caixa. Peça a um administrador para marcar em Configurações."
    2. Sem turno → "Conte o dinheiro da gaveta", campo vazio, observação e botão "Abrir caixa".
    3. Turno travado → título "Contagem não confere". Admin/dono veem esperado, contado e diferença; operador vê só o contado. Botões **Contar de novo**, **Liberar com PIN de administrador** (escolhe o admin numa lista sem quem contou e digita o PIN, como na troca de preço do quilo) e **Pedir liberação ao dono**. Depois do pedido, mostra "Aguardando o dono…" (e "O dono recusou. Conte de novo." quando `recusada`).
  - Turno aberto: a tela de hoje com o título "Caixa 1 — <operador>". O botão vira **"Fechar / passar o caixa"**.
  - Fechamento: o modal de hoje (contagem às cegas). `finalizeCashSession` chama `cash_turno_fechar` no modo ligado. Se travar, a tela vai para o estado 3.
  - Vendas do turno: no modo ligado, `sl.cashSessionId === s.id`; vendas sem `cashSessionId` seguem a regra da hora (`closedAt >= openedAt`). Vale para `caixa.js:47`, `:149` e `cashClosingSnapshot`.
  - OP-14 (comanda avulsa aberta bloqueia o fechamento): no modo ligado, só bloqueia se este for o último turno aberto entre todos os caixas (`state.cashTurnos`).

- [ ] **Step 1: Testes** em `t55` (nome da etapa — esperado):
  - `abrir-bate` — Caio, no Caixa 1 com `ultima_contagem = 100`, conta 100 → turno aberto, título "Caixa 1 — Caio Caixa".
  - `abrir-cego` — antes de digitar, a tela não mostra 100 em lugar nenhum (`innerText` sem "100,00").
  - `abrir-diverge` — conta 90 → "Contagem não confere", sem "100,00" na tela do Caio; botões presentes; venda no balcão recusada.
  - `liberar-pin-autoliberacao` — Ana conta errado; a lista do "Liberar com PIN" não mostra Ana.
  - `liberar-pin` — segundo admin digita o PIN → turno aberto com saldo inicial 90.
  - `trava-sobrevive-logout` — travado, Caio sai, Ana entra no mesmo aparelho → tela de trava; liberação do dono destrava.
  - `fechar-diverge` — fechamento com diferença → tela de trava (tipo fechamento); o dono aprova → turno sai e o fechamento aparece no Histórico do Caixa com "Caixa 1".
  - `passagem` — Caio fecha certo, Gabi (com a marcação) abre no mesmo aparelho; o esperado dela é o contado do Caio.
  - `vendas-por-turno` — duas vendas, uma em cada caixa, ao mesmo tempo → cada fechamento soma só a sua.
- [ ] **Step 2: Ver falhar:** `node e2e/t55-caixa-por-operador.js <pasta>` → etapas novas falham.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver passar:** `t55` ok; `node e2e/t15-ux-lote1.js <pasta>` e `node e2e/t21-caixa-cego-movimentacao.js <pasta>` (caixa às cegas, ajuste desligado) sem falha nova.
- [ ] **Step 5: Commit** — `feat(caixa): abertura e fechamento com contagem e trava por caixa`.

### Task 5: Colaborador — marcação "Pode operar caixa"

**Files:**
- Modify: `assets/js/cadastros/usuarios.js` (cadastro e edição do colaborador)
- Modify: `assets/js/core/config.js` (`userPermissions`, linha 214)
- Modify: `assets/js/core/login.js` (destino depois do PIN)

**Interfaces:**
- Consumes: action `set_opera_caixa` e `opera_caixa` no `login` (Task 2).
- Produces: `user.operaCaixa: boolean` em `cantina2:users`, gravado junto com `set_opera_caixa`. Na tela, caixa = true e marcação travada; admin e dono não mostram (sempre podem); garçom/cozinha = caixa de seleção.
  - `userPermissions(user)`: garçom com `operaCaixa` recebe a união com `rolePermissions('caixa')`.
  - `login.js`: garçom com `operaCaixa` num aparelho com `caixaDoAparelho()` entra na tela de caixa (desktop), não no app do garçom.

- [ ] **Step 1: Testes** em `t55`:
  - `marcacao` — o dono marca "Pode operar caixa" na Gabi (garçom) → `tenant_staff.opera_caixa = true`; Gabi entra no Caixa 1 e vê a tela de caixa.
  - `garcom-sem-marcacao` — outro garçom no Caixa 1 → não vê "Abrir caixa" e a RPC recusaria.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver passar:** `t55` ok; `node e2e/t29-perfil-garcom.js <pasta>` e `node e2e/t26-permissoes-por-usuario.js <pasta>` sem falha nova.
- [ ] **Step 5: Commit** — `feat(colaboradores): marcação pode operar caixa`.

### Task 6: App do garçom e cozinha — só cartão e caixa escolhido

**Files:**
- Modify: `assets/js/operacao/garcom.js` (`gcPayMethods`; mensagens das linhas 384 e 422)
- Modify: `assets/js/operacao/cozinha.js` (pagamento parcial, linhas 121–165)

**Interfaces:**
- Consumes: `modoCaixaPorOperador()`, `caixaQueVale()`, `nomeDoCaixa()` (Task 3).
- Produces: no modo ligado, `gcPayMethods()` remove as formas com `methodBucket(m) === 'dinheiro'`. Com o caixa que vale fechado ou travado, a mensagem é: "O <nome> está fechado ou travado. Peça para abrirem o caixa." Fora do modo, as mensagens de hoje.

- [ ] **Step 1: Testes** em `t55`:
  - `app-sem-dinheiro` — garçom no celular → as formas de pagamento não têm Dinheiro;
  - `app-caixa-travado` — `caixaDoApp = 'cx1'` travado → cobrar mostra a mensagem acima e não grava venda;
  - `app-entra-no-caixa` — pagamento no cartão pelo app com `cx1` aberto → a venda tem `cashSessionId` do turno do Caixa 1.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver passar:** `t55` ok.
- [ ] **Step 5: Commit** — `feat(garcom): app só com cartão e pagamentos no caixa escolhido`.

### Task 7: Dono de longe — aviso e liberação

**Files:**
- Modify: `assets/js/core/avisos.js` (faixa de aviso no topo)
- Modify: `assets/js/operacao/caixa.js` (modal de liberação do dono)

**Interfaces:**
- Consumes: `state.cashTurnos` + polling (Task 3), `cash_turno_liberar_dono` (Task 1).
- Produces: com sessão de dono (`sessionIsOwner`) e alguma pendência com `pedidoDono`, faixa "Liberação pendente: <caixa> — <contouNome>". Ao tocar, abre um modal com tipo (abertura/fechamento), esperado, contado, diferença e hora, e os botões **Liberar** e **Recusar** (via `singleFlight`).

- [ ] **Step 1: Testes** em `t55`:
  - `dono-ve-pendencia` — operador pede → a página do dono (outra aba) mostra a faixa em até 10 s;
  - `dono-libera` — Liberar → a tela do operador destrava em até 10 s;
  - `dono-recusa` — Recusar → o operador vê "O dono recusou. Conte de novo.";
  - `admin-nao-ve-faixa` — admin logado não vê a faixa do dono.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver passar:** `t55` ok.
- [ ] **Step 5: Commit** — `feat(caixa): dono libera divergência de longe`.

### Task 8: Histórico do Caixa, Novidades e fechamento da etapa

**Files:**
- Modify: `assets/js/operacao/caixa.js` (`renderCashHistoryPanel`) e `assets/js/gestao/relatorios.js` (tabela "Fechamento do caixa", linha 180)
- Modify: `assets/js/sistema/novidades.js`
- Modify: `index.html` (só `?v=` via `bump-version.js`)

**Interfaces:**
- Consumes: fechamentos com `caixaId`, `liberacoes`, `fechadoNoLugarDe` (Task 1).
- Produces: colunas **Caixa** (`nomeDoCaixa(caixaId)` ou "—" nos antigos) e **Liberação** ("PIN: Ana 21:10" / "Dono 21:12" / vazio). A coluna Liberação só aparece para quem passa em `podeVerTotaisDoCaixa()`. Entrada em NOVIDADES: "Caixa por operador: cada computador tem o seu caixa, com contagem na abertura e no fechamento. Diferença trava até um administrador ou o dono liberar."

- [ ] **Step 1: Teste** em `t55` (etapa `historico`): depois de `fechar-diverge`, o Histórico do Caixa (admin) mostra "Caixa 1" e "Dono". O operador não vê a coluna Liberação.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar**, rodar `node scripts/bump-version.js`.
- [ ] **Step 4: Verificar tudo:**
  - `node scripts/check-app.js && node scripts/check-load-order.js` → sem erro;
  - `node db/t-caixa-turnos.js`, `node db/sqltest.js`, `node e2e/t54-caixa-liberacao.js`, `node e2e/t55-caixa-por-operador.js <pasta>`, `node e2e/t2-fluxos.js` → tudo ok;
  - capturas da pasta conferidas no Chrome: 1366 px e 390 px da tela de trava.
- [ ] **Step 5: Commit** — `feat(caixa): histórico com caixa e liberação; novidades`. Abrir PR; **não** fazer merge, aplicar migration ou publicar `staff-auth` sem o "sim" do dono.
