# Perfis novos e conta do colaborador — plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** perfis Administrador, Caixa, Garçom e Cozinha valendo na tela e no banco; caixa e cozinha
pausam produto; diária de freelancer na gaveta; colaborador cadastrado como cliente, com 20% e conta
descontada do salário.

**Architecture:** papel novo `garcom` em `tenant_staff.role`, na `staff-auth` e nas policies/RPCs
(migration nova, nunca editar migration aplicada). Pausar produto por RPC `security definer` que só
troca `active`. Colaborador = `members.kind = 'colaborador'`, fiado reaproveitado com lançamento de
baixa sem dinheiro. Front em scripts clássicos (ver `CLAUDE.md`).

**Tech Stack:** HTML/CSS/JS puro (sem build), Supabase (Postgres 18 local para teste, RLS, RPCs),
Edge Function `staff-auth` (Deno), bancada `../auditoria-2026-11-03` (Playwright + fakesupa + Postgres
local).

**Spec:** `docs/superpowers/specs/2026-11-08-perfis-e-conta-do-colaborador-design.md`

## Global Constraints

- Cada parte (A, B, C, D) é um branch e um PR próprio, publicável sozinho, nesta ordem.
- Migration em produção, `migration repair` e deploy de `staff-auth`: só depois do "sim" do dono no
  chat, com cópia antes (`app_data` chave `backup:...` para blobs) e teste no Postgres 18 local.
- Deploy de função: `npx supabase functions deploy staff-auth --project-ref ezfoymdesmarpunmixbs --use-api --yes`
  **antes** do merge do front que depende dela.
- Migration: `npx supabase db query --linked -f supabase/migrations/<arquivo>.sql < /dev/null` e
  `npx supabase migration repair --status applied <versão> --linked`.
- Toda mudança em `assets/js`/`assets/css`: `node scripts/bump-version.js <versão>` acima da última
  usada no dia (último usado: `20261108b`), `node scripts/check-app.js`, `node scripts/check-load-order.js`.
- Textos de tela, comentários e commits em português; comentário cita "08/11 (pedido do dono)" e o porquê.
- Escape com `h`/`jsArg`; ações que gravam venda passam por `singleFlight`.
- Rótulos exatos: perfis "Administrador", "Caixa", "Garçom", "Cozinha"; tipo de cliente "Sócio" /
  "Colaborador"; motivo de retirada "Diária de freelancer"; baixa "Descontado do salário".
- Desconto de colaborador: `state.settings.staffDiscountPct`, padrão **20**, só admin altera
  (Configurações).

## Review Focus

1. **Garçom de hoje depois da troca:** `gabi` (role `caixa`, origem `app`) entra com o mesmo PIN e cai
   no app do garçom, agora com role `garcom` no banco e no blob. Teste na Task A3.
2. **Garçom tenta fiado pelo console:** `close_sale` com `p_debt_entries` não vazio, ou pagamento com
   método fiado, é recusado para `garcom`. Teste na Task A1.
3. **Caixa pausa produto enquanto o admin edita outro produto:** a RPC troca só `active` do item, sem
   apagar a edição do admin (versão do blob). Teste na Task B1.
4. **Comanda de colaborador aberta pelo garçom:** o app deixa lançar, mas não fecha; mostra "Comanda de
   colaborador: feche no caixa." Teste na Task D3.
5. **Baixa "Descontado do salário" no meio do expediente:** não aparece no caixa nem muda o esperado do
   fechamento. Teste na Task D4.

---

## Parte A — perfil Garçom

### Task A1: papel `garcom` no banco

**Files:**
- Create: `supabase/migrations/20261108000000_perfil_garcom.sql`
- Test: `../auditoria-2026-11-03/db/sqltest.js` (casos novos, grupo `garcom`)

**Interfaces:**
- Produces: `public.pode_vender()` → `boolean` (`is_admin_like() or current_staff_role() in ('caixa','garcom')`);
  `tenant_staff.role` aceita `'garcom'`.

Regras (o que o `garcom` pode no banco):

| Recurso | Garçom |
| --- | --- |
| `app_data` select | igual ao caixa (`catalogo`, `pedidos`, `operacional`) |
| `app_data` insert/update | igual ao caixa, mais as chaves `cantina2:cashSession`, `cashHistory`, `cashMovements`, `insumos`, `orderCounter` continuam proibidas |
| `orders` select/insert/update | sim (como caixa) |
| `sales` select | sim |
| `sales_apply`, `next_order_number`, `consume_insumos`, `restore_insumos` | sim (trocar `cash_can_write()`/`= 'caixa'` por `pode_vender()` só nessas) |
| `close_sale` | sim, mas **recusa** se `p_debt_entries` não vazio ou se algum pagamento em `p_sale_patch->'payments'` tem `method` de fiado (mesma lista que `methodBucket` trata como fiado no front: conferir `core/config.js`) — erro `'garcom nao fecha fiado'` |
| `cash_session_open/close`, `insumos_apply` | não (`cash_can_write()` continua só admin/caixa) |
| `cash_movements_apply` | só movimentos com `origin` `'parcial'`/`'parcial-estorno'` (pagamento parcial de comanda); qualquer outro → recusa |
| `members` select | sim; insert/update: não |
| `member_debt_entries`, `member_dependents` | não |
| `print_jobs` select/insert, `print_job_resolve` | sim |
| `nfce_notas` select | sim |

- [ ] **Step 1: casos de teste no `db/sqltest.js`** (padrão do arquivo: claims com `role` do staff)
  - `garcom: le produtos e vendas` → select em `app_data` `cantina2:products` e `sales` retorna linhas.
  - `garcom: sales_apply e close_sale sem fiado` → ok.
  - `garcom: close_sale com p_debt_entries` → erro contendo `garcom nao fecha fiado`.
  - `garcom: close_sale com pagamento fiado sem lancamento` → mesmo erro.
  - `garcom: cash_session_open` → recusa; `cash_movements_apply` com sangria → recusa; com `origin:'parcial'` → ok.
  - `garcom: insert em members` → recusa; `insert em member_debt_entries` → recusa.
  - `caixa e admin continuam iguais` → rodar a suíte inteira: os 146 de hoje passam.
- [ ] **Step 2:** `bash db/up.sh > db/up.log 2>&1 </dev/null` e `node db/sqltest.js` → os casos novos falham (papel não existe).
- [ ] **Step 3: escrever a migration** (redefine o `check`, cria `pode_vender()`, recria as policies e funções da tabela com o mesmo corpo de hoje mudando só a checagem de papel; pegar o corpo atual de cada função com `pg_get_functiondef` no banco local, não das migrations antigas).
- [ ] **Step 4:** subir o banco de novo e `node db/sqltest.js` → todos passam (146 + novos).
- [ ] **Step 5: commit** `feat(banco): perfil garçom nas regras do banco`.

### Task A2: `staff-auth` aceita `garcom`

**Files:**
- Modify: `supabase/functions/staff-auth/index.ts:25` (`ROLES`)
- Test: `../auditoria-2026-11-03/e2e/t7-staff-auth.js` (cópia em `e2e/staff-auth-copia.mts`: atualizar a cópia)

**Interfaces:** Produces: criar/atualizar colaborador com `role:'garcom'` (PIN 4 dígitos, como caixa).

- [ ] **Step 1:** caso novo no t7: `create` com `role:'garcom'` → ok, `tenant_staff.role = 'garcom'`; `update` caixa→garcom → ok; `verify` devolve `role:'garcom'`.
- [ ] **Step 2:** `node e2e/t7-staff-auth.js` → caso novo falha ("Perfil inválido").
- [ ] **Step 3:** `const ROLES = ["admin", "caixa", "garcom", "cozinha"];`
- [ ] **Step 4:** t7 passa inteiro.
- [ ] **Step 5: commit** `feat(staff-auth): perfil garçom`.

### Task A3: perfil Garçom no site e troca dos garçons de hoje

**Files:**
- Modify: `assets/js/core/config.js` (`ROLE_PERMS.garcom`), `assets/js/core/login.js` (`roleLabel`, entrada no app),
  `assets/js/cadastros/usuarios.js` (select de perfil, matriz com coluna Garçom),
  `assets/js/operacao/garcom.js` (se aparecer qualquer opção de transferir/cancelar, tirar)
- Create: `supabase/migrations/20261108000100_garcons_para_perfil_garcom.sql` (dados: `tenant_staff` com
  `role='caixa'` cujo usuário no blob `cantina2:users` tem `origem='app'` → `garcom`; o mesmo no blob)
- Test: `../auditoria-2026-11-03/e2e/t29-perfil-garcom.js`; atualizar `e2e/seed.js` (`gabi` com `role:'garcom'`)

**Interfaces:**
- Consumes: A1, A2.
- Produces: `roleLabel('garcom') === 'Garçom'`; `ROLE_PERMS.garcom = ['comandas','senha-propria','mobile-qr']`;
  entra no app do garçom quando `currentUser.role === 'garcom'` **ou** (compatibilidade) `origem==='app' && role!=='admin'`.

- [ ] **Step 1: t29** — (a) admin cria colaborador "Garçom" → PIN de 4 aceito, `tenant_staff.role='garcom'`;
  (b) `gabi` entra e cai no app (`#garcomApp.show`); (c) matriz de Perfis mostra 4 colunas; (d) no app,
  não existe botão de transferir nem cancelar item; (e) fechar comanda em dinheiro funciona; (f) pela
  console, `close_sale` com fiado é recusado; (g) a migration de dados troca `gabi` de `caixa` para
  `garcom` no banco e no blob sem mudar o PIN (logar com `2222` depois da migration).
- [ ] **Step 2:** rodar → falha.
- [ ] **Step 3:** implementar front + migration de dados (backup do blob `cantina2:users` antes, na própria migration: `insert into app_data (tenant_id,key,value) select tenant_id,'backup:cantina2:users:2026-11-08-garcom',value ...`).
- [ ] **Step 4:** t29 passa; t2 (fluxos), t7, t26 passam.
- [ ] **Step 5: commit** `feat: perfil Garçom no cadastro e no app`.
- [ ] **Step 6: publicar Parte A** — pedir "sim" ao dono para: migration A1, deploy da `staff-auth`, migration de dados A3. Ordem: A1 → deploy → PR do front (merge) → A3 dados. Conferir no banco depois.

## Parte B — Caixa e Cozinha pausam produto

### Task B1: RPC `product_set_active`

**Files:**
- Create: `supabase/migrations/20261109000000_pausar_produto.sql`
- Test: `../auditoria-2026-11-03/db/sqltest.js` (grupo `pausar`)

**Interfaces:**
- Produces: `public.product_set_active(p_product_id text, p_active boolean) returns jsonb`
  (`{ok:true, version:<nova versão do blob>}`), `security definer`, permitido a `owner/admin/caixa/cozinha`;
  troca só `active` do item de `cantina2:products` com o id; grava `audit_log` com ação
  `Produto pausado: <nome>` / `Produto ativado: <nome>`; `garcom` e sem papel → recusa.

- [ ] **Step 1: casos** — cozinha pausa `p2` → só `active` muda (comparar o resto do item antes/depois);
  caixa ativa de novo → ok; garçom → recusa; id inexistente → erro `produto nao encontrado`;
  caixa tentando `update` direto no blob → continua recusado (RLS de catálogo intacta).
- [ ] **Step 2:** falha. **Step 3:** migration. **Step 4:** passa (suíte inteira).
- [ ] **Step 5: commit** `feat(banco): pausar produto sem abrir o catálogo`.

### Task B2: tela "Produtos em falta" (Caixa e Cozinha)

**Files:**
- Create: `assets/js/operacao/disponibilidade.js` (tag em `index.html` depois de `operacao/cozinha.js`)
- Modify: `assets/js/core/config.js` (token `pausar-produto` em `ROLE_PERMS.admin/caixa/cozinha`; item de
  menu "Produtos em falta" na área Principal e no Monitor da cozinha), `assets/js/cadastros/usuarios.js`
  (matriz: "Ativar e pausar produto" no grupo Atendimento)
- Test: `../auditoria-2026-11-03/e2e/t30-pausar-produto.js`

**Interfaces:**
- Consumes: B1.
- Produces: `abrirProdutosEmFalta()` — janela com pesquisa, lista de produtos (nome, categoria, chave
  "À venda"/"Pausado"); a chave chama `product_set_active` e atualiza `state.products` com a resposta.

- [ ] **Step 1: t30** — cozinha abre pelo Monitor, pesquisa "LANCHES 2", pausa → some da Ficha e do
  garçom; caixa ativa de novo; garçom não vê o item; admin continua editando preço normalmente; a edição
  do admin feita antes da pausa não se perde (Review Focus 3).
- [ ] **Step 2:** falha. **Step 3:** implementar. **Step 4:** t30, t1 (telas), t23 passam.
- [ ] **Step 5: commit** e **publicar Parte B** ("sim" para a migration B1 antes do merge).

## Parte C — Diária de freelancer

### Task C1: retirada "Diária de freelancer"

**Files:**
- Modify: `assets/js/operacao/caixa.js` (`openCashMovementModal`, `cashClosingSnapshot`, tela do caixa),
  `assets/js/gestao/relatorios.js` (Histórico do Caixa: coluna/linha "Diárias")
- Test: `../auditoria-2026-11-03/e2e/t31-diaria-freelancer.js`

**Interfaces:**
- Produces: movimento `{type:'sangria', categoria:'diaria', pessoa:'<nome>', method:'dinheiro', ...}`;
  `cashClosingSnapshot()` ganha `diarias` (soma) e as diárias continuam contando como saída de dinheiro
  no esperado.

- [ ] **Step 1: t31** — caixa lança "Diária de freelancer" R$ 120 para "João" (nome obrigatório); a
  linha aparece como "SAÍDA — Diária de freelancer: João"; no fechamento (admin) o resumo mostra
  "Diárias de freelancer R$ 120,00" separado de "Retiradas"; o esperado em dinheiro desconta os 120;
  Histórico do Caixa mostra a coluna; garçom não consegue lançar (sem acesso ao caixa).
- [ ] **Step 2:** falha. **Step 3:** implementar (sem migration: `cash_movements` é jsonb).
- [ ] **Step 4:** t31, t21, t22 passam. **Step 5: commit** e **publicar Parte C**.

## Parte D — Conta do colaborador

### Task D1: tipo de cliente no banco

**Files:**
- Create: `supabase/migrations/20261110000000_cliente_colaborador.sql`
- Test: `../auditoria-2026-11-03/db/sqltest.js` (grupo `colaborador`)

**Interfaces:**
- Produces: `members.kind text not null default 'socio' check (kind in ('socio','colaborador'))`;
  `member_debt_entries.method = 'salario'` aceito em lançamento de pagamento, só por `owner/admin`
  (trigger ou checagem na policy de insert: caixa inserindo `method='salario'` → recusa).

- [ ] **Step 1: casos** — admin cria membro `kind='colaborador'` sem `code`; caixa grava pagamento de
  fiado `method='Dinheiro'` → ok; caixa grava `method='salario'` → recusa; admin → ok e `members.debt`
  baixa.
- [ ] **Step 2–4:** falha, migration, passa. **Step 5: commit**.

### Task D2: cadastro do colaborador e desconto

**Files:**
- Modify: `assets/js/cadastros/associados.js` (`openMemberModal`: campo Tipo; cota opcional para
  Colaborador; lista com etiqueta "Colaborador"), `assets/js/core/dados-socios.js` (ler/gravar `kind`),
  `assets/js/core/calculos.js` (`comandaTotals`: desconto do colaborador),
  `assets/js/core/config.js` (`memberBlockedByDebt` → `false` para colaborador; `descontoColaborador()`),
  `assets/js/sistema/configuracoes.js` (campo "Desconto do colaborador (%)", padrão 20)
- Test: `../auditoria-2026-11-03/e2e/t32-colaborador.js`

**Interfaces:**
- Consumes: D1.
- Produces: `memberIsColaborador(member) → boolean`; `descontoColaborador() → number` (0–100, padrão 20);
  `comandaTotals({..., member})` aplica `-arredondaCentavos(subtotal * pct/100)` quando o membro é
  colaborador e expõe `staffDiscount` no retorno.

- [ ] **Step 1: t32 (parte 1)** — cadastrar "Ana Colaboradora" tipo Colaborador sem cota; abrir comanda
  no nome dela; lançar R$ 50 → total R$ 40,00 com linha "Desconto colaborador (20%) − R$ 10,00"; com
  dívida de R$ 100 ela abre comanda normalmente (não bloqueia); admin muda para 15% → R$ 42,50.
- [ ] **Step 2–4:** falha, implementar, passa (t2, t10 também). **Step 5: commit**.

### Task D3: fechar comanda do colaborador

**Files:**
- Modify: `assets/js/vendas/pagamento.js` (comanda de colaborador: só a forma "Conta do colaborador",
  que grava como fiado no extrato com `reason:'Consumo (colaborador)'`), `assets/js/operacao/garcom.js`
  (`gcGoCloseComanda`: colaborador → aviso e não abre a cobrança)
- Test: `../auditoria-2026-11-03/e2e/t32-colaborador.js` (parte 2)

- [ ] **Step 1: t32 (parte 2)** — caixa fecha a comanda da Ana: só aparece "Conta do colaborador";
  extrato dela ganha R$ 40,00; o caixa não registra entrada de dinheiro; no garçom, "Fechar" mostra
  "Comanda de colaborador: feche no caixa." e não abre a cobrança (Review Focus 4); pela console, garçom
  chamando `close_sale` dessa comanda → recusado (fiado).
- [ ] **Step 2–4:** falha, implementar, passa. **Step 5: commit**.

### Task D4: baixa "Descontado do salário" (administrador)

**Files:**
- Modify: `assets/js/gestao/financeiro.js` (`renderFiado`: filtro "Colaboradores"; `openFiadoEntry('payment')`:
  forma "Descontado do salário" só para admin e só para colaborador, sem lançar no caixa;
  `openFiadoStatementModal`: período)
- Test: `../auditoria-2026-11-03/e2e/t32-colaborador.js` (parte 3)

- [ ] **Step 1: t32 (parte 3)** — admin filtra Colaboradores, abre o extrato da Ana de 01/11 a 30/11,
  dá baixa "Descontado do salário" de R$ 40 (padrão = saldo) → saldo 0; baixa parcial de R$ 10 numa
  dívida de 40 → saldo 30; o caixa aberto não muda (nenhum movimento, esperado igual; Review Focus 5);
  caixa não vê a forma "Descontado do salário".
- [ ] **Step 2–4:** falha, implementar, passa (t21, t22, t10). **Step 5: commit**.
- [ ] **Step 6: publicar Parte D** ("sim" para a migration D1 antes do merge); atualizar `docs/HANDOFF.md`
  (seção do dia) e o manual da equipe (Ajuda › Manual) com os 4 perfis, Produtos em falta, diária e conta
  do colaborador.
