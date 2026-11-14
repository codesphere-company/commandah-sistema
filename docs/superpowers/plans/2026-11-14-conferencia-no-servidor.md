# Conferência da venda e das permissões no servidor: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fazer o banco conferir cada venda fechada (pisos e coerência) e as permissões "cancelar comanda" e "receber fiado". Primeiro ele só registra as divergências; um ajuste do admin passa a recusar.

**Architecture:** uma migration nova cria `tem_permissao`, `venda_conferir` e `venda_conferencia_aplicar` e regrava `close_sale` e `sales_apply` a partir do corpo atual. Um gatilho em `member_debt_entries` cobre o "receber fiado". No front: mensagens de recusa, o ajuste em Configurações e o relatório "Vendas com divergência".

**Tech Stack:** Postgres/plpgsql (Supabase), JS clássico sem build. Testes na bancada `../auditoria-2026-11-03`: `db/*.js` com `pg` e `e2e/*.js` com Playwright, fora do repo.

**Spec:** `docs/superpowers/specs/2026-11-14-conferencia-no-servidor-design.md`

## Global Constraints

- Migration nova: `supabase/migrations/20261117000000_conferencia_no_servidor.sql`. Nunca editar migration já aplicada. `set lock_timeout = '5s';` no topo, como nas últimas migrations.
- Funções novas: `SECURITY DEFINER` (exceto as puras), `SET search_path TO ''`, nomes qualificados `public.`; `revoke all ... from public, anon` e `grant execute ... to authenticated` só nas que o app chama.
- `close_sale(text, boolean, jsonb, jsonb)` e `sales_apply(jsonb, jsonb, jsonb)`: partir do corpo de `supabase/migrations/20261108000000_perfil_garcom.sql` (o mais novo; nenhuma migration posterior os redefine) e manter tudo o que já fazem.
- Tolerância de dinheiro: R$ 0,01 nas comparações do servidor.
- Ajuste: `cantina2:settings.conferenciaBarrar` (boolean, ausente = `false`). Texto da tela: **"Recusar venda que não bate com o cadastro"**.
- Erros: `venda_divergente` e `sem permissao para cancelar` / `sem permissao para receber fiado`, todos com `errcode = '42501'`.
- Código, comentários, UI e commits em português; comentários citam "item 4 (auditoria 11/11)".
- Depois de mudar `assets/js` ou `assets/css`: `node scripts/bump-version.js`. Antes de cada commit de front: `node scripts/check-app.js` e `node scripts/check-load-order.js`.
- Nada é publicado neste plano: merge, migration em produção e recarga dos aparelhos ficam para o dono dar "sim".

## Review Focus

1. Preço do produto aumentado com a comanda aberta: o item antigo fica abaixo do cadastro. Com `conferenciaBarrar` desligado, a venda grava e só registra `preco_abaixo`. Teste no Task 2 (`preco_abaixo registra sem barrar`).
2. Venda antiga ou offline sem os campos de meta (`subtotal`, `discount`...): nenhuma divergência de `subtotal` nem de `cupom` por campo ausente. Teste no Task 2 (`venda sem meta nao acusa`).
3. Aparelho mandando `conferencia` falsa ou `null` no JSON da venda: o servidor sempre descarta e recalcula. Teste no Task 3 (`conferencia do aparelho e descartada`).
4. Comanda com parcial já pago e serviço tirado pelo caixa: não acusa `pagamento_abaixo`. Teste no Task 2 (`parcial e sem servico nao acusa`).
5. `sales_apply` em lote com uma venda recusada: as outras gravam, e a recusada volta como conflito (a fila offline não trava). Teste no Task 3 (`lote com uma recusada grava as outras`).

---

### Task 1: `tem_permissao` no banco

**Files:**
- Create: `supabase/migrations/20261117000000_conferencia_no_servidor.sql` (primeira parte)
- Test: `../auditoria-2026-11-03/db/t-conferencia.js` (novo, no molde de `db/t-caixa-turnos.js`: transação desfeita por caso, `como(ator)`, `erro(sql)`)

**Interfaces:**
- Produces: `public.tem_permissao(p_token text) returns boolean`, stable, security definer.

Regra, espelho de `userPermissions` e `rolePermissions` em `assets/js/core/config.js:183-221`:
- `current_staff_role()` em `('owner','admin')` dá `true`; papel nulo dá `false`.
- O colaborador é a linha de `tenant_staff` com `auth_user_id = auth.uid()` e `active`.
- Caixa com `permissions` (array) no seu registro do blob `cantina2:users` (casado por `id`): vale só essa lista.
- Os outros usam `cantina2:settings.rolePermissions.<papel>` quando for array. Se `rolePermissionsVersion < 2`, soma `receber-fiado`; se `< 3`, soma `pausar-produto`; em ambos os casos só se o padrão do papel tiver o token. Sem matriz salva, vale o padrão de `ROLE_PERMS` para `caixa`, `garcom` e `cozinha`, copiado como array literal com comentário apontando para `config.js`.
- Garçom com `tenant_staff.opera_caixa = true` e `cantina2:settings.caixaPorOperador = true` soma as permissões do papel `caixa`, resolvidas pela mesma regra.

- [ ] **Step 1: Escrever os testes que falham** em `db/t-conferencia.js`, seção `tem_permissao`:
  - `admin tem tudo`: como `admin`, `tem_permissao('cancelar-comanda')` = true.
  - `caixa padrao`: sem matriz, como `caixa`: `cancelar-comanda` = true, `config-sistema` = false.
  - `caixa com lista propria`: `cantina2:users` com `{id:'s-cx', permissions:['caixa']}` dá `cancelar-comanda` = false.
  - `matriz do perfil`: `rolePermissions.caixa = ['caixa']` com `rolePermissionsVersion: 3` dá `receber-fiado` = false; com versão 1 dá true.
  - `garcom opera caixa`: `opera_caixa = true` e `caixaPorOperador: true` dá `cancelar-comanda` = true; com `caixaPorOperador: false` dá false.
  - `sem sessao`: ator `anon`/sem papel dá false.
- [ ] **Step 2: Rodar e ver falhar.** `REPO=../commandah-conferencia bash db/up.sh > db/up.log 2>&1 </dev/null && node db/t-conferencia.js` (na pasta da bancada). Esperado: erro "function public.tem_permissao(unknown) does not exist".
- [ ] **Step 3: Implementar `public.tem_permissao(p_token text) returns boolean`** na migration, pela regra acima.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando. Esperado: todos os casos `ok`.
- [ ] **Step 5: Commit** (só a migration; a bancada não é versionada): `feat(banco): tem_permissao espelha as permissões da tela (item 4)`.

### Task 2: `venda_conferir`, as seis verificações

**Files:**
- Modify: `supabase/migrations/20261117000000_conferencia_no_servidor.sql`
- Test: `../auditoria-2026-11-03/db/t-conferencia.js` (seção `venda_conferir`)

**Interfaces:**
- Consumes: nada do Task 1.
- Produces: `public.venda_conferir(p_tenant text, p_sale jsonb, p_credito_antes numeric) returns jsonb`. Devolve um array (vazio se estiver certo) de objetos `{ "codigo": text, "item": text|null, "esperado": numeric|null, "recebido": numeric|null }`. `item` é o `lineId` ou, sem ele, o `name`. Stable e security definer (lê `app_data`, `members`, `audit_log`, `tenant_staff`); não é exposta ao app (`revoke` de `authenticated`).

Códigos e regras (itens = `p_sale->'items'` sem `canceled`; meta no nível da venda):
- `produto_desconhecido`: item sem `productId`, ou id ausente de `cantina2:products`.
- `preco_abaixo`: item sem `weight` com `price < product.price − 0,01`. Item com `weight`: `weight.pricePerKg < product.price − 0,01`, a menos que haja liberação. Conta como liberação: (a) uma linha de `audit_log` do tenant com `entity = 'product'`, `entity_id = productId`, `meta->>'price'` igual a `pricePerKg` (±0,01) e `at` nas últimas 24 h; ou (b) `weight.override` presente e `item.addedById` sendo um `tenant_staff` ativo do tenant com papel `admin`.
- `subtotal`: só quando a venda traz `subtotal`. A soma de `price × qty` difere dele em mais de 0,01.
- `cupom`: só quando `discount > 0,01`. Acusa se `couponCode` não está em `cantina2:coupons` (`active`, `startDate <= hoje <= endDate` no fuso `America/Sao_Paulo`, datas vazias liberadas), ou se `discount` passa do limite mais 0,01. Limite: percentual `round(subtotal × value) / 100`; valor fixo `min(subtotal, value)`.
- `desconto_colaborador`: só quando `staffDiscount > 0,01`. Acusa se o `members.kind` de `memberId` não é `'colaborador'`, ou se `staffDiscount > round(subtotal × pct / 100, 2) + 0,01`, com `pct` = `cantina2:settings.staffDiscountPct` limitado a 0–100 (padrão 20).
- `credito`: `creditApplied > p_credito_antes + 0,01`.
- `pagamento_abaixo`: soma de `payments[].amount` < `base − staffDiscount − discount − creditApplied − 0,01`. A base é o `subtotal` da venda ou, sem ele, a soma dos itens. Os parciais já estão em `payments`, então `partialPaid` não entra; o serviço também fica fora do piso.

- [ ] **Step 1: Escrever os testes que falham** (semente: `cantina2:products` com `{id:'p1',price:10}` e `{id:'pk',price:50,measure:'kg'}`; `cantina2:coupons` com `{code:'DEZ',type:'percent',value:10,active:true}`; sócio `m1` de kind `socio` e `m2` de kind `colaborador`). Cada caso chama `select public.venda_conferir('t-a', $1::jsonb, $2)` e confere os `codigo` devolvidos:
  - `venda certa`: 2× p1 a 10, `subtotal: 20`, pagamento de 20 dá `[]`.
  - `preco_abaixo registra sem barrar`: p1 a 1 dá `['preco_abaixo']`, `esperado: 10`, `recebido: 1`.
  - `peso com liberacao`: pk com `pricePerKg: 40` e linha em `audit_log` de `meta.price = 40` dá `[]`; sem a linha, dá `['preco_abaixo']`.
  - `produto desconhecido`: `productId: 'zz'` dá `['produto_desconhecido']`.
  - `venda sem meta nao acusa`: itens certos, sem `subtotal` nem `discount`, pagamento cobrindo dá `[]`.
  - `subtotal`: `subtotal: 5` com itens de 20 dá `subtotal` (e `pagamento_abaixo`, se o pagamento for 5).
  - `cupom inexistente`: `discount: 5`, `couponCode: 'XX'` dá `['cupom']`. `DEZ` com `discount: 2` sobre 20 dá `[]`; com `discount: 5` dá `['cupom']`.
  - `colaborador`: `staffDiscount: 4` com `m1` dá `['desconto_colaborador']`; com `m2` e 20% sobre 20 dá `[]`.
  - `credito`: `creditApplied: 30` com `p_credito_antes = 10` dá `['credito']`.
  - `parcial e sem servico nao acusa`: subtotal 20, `payments` = parcial 8 (`partial:true`) + 12, `serviceCharge: 0` dá `[]`.
  - `pagamento_abaixo`: subtotal 20 e pagamento de 10 dá `['pagamento_abaixo']`.
- [ ] **Step 2: Rodar e ver falhar.** Mesmo comando do Task 1. Esperado: "function public.venda_conferir ... does not exist".
- [ ] **Step 3: Implementar `public.venda_conferir(p_tenant text, p_sale jsonb, p_credito_antes numeric) returns jsonb`** pelas regras acima. Ler os blobs uma vez cada; pular os itens com `canceled`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit:** `feat(banco): venda_conferir confere pisos e coerência da venda fechada (item 4)`.

### Task 3: ligar a conferência e as permissões em `close_sale`, `sales_apply` e `member_debt_entries`

**Files:**
- Modify: `supabase/migrations/20261117000000_conferencia_no_servidor.sql`
- Test: `../auditoria-2026-11-03/db/t-conferencia.js` (seção `gravacao`)

**Interfaces:**
- Consumes: `tem_permissao` (Task 1), `venda_conferir` (Task 2).
- Produces:
  - `public.venda_conferencia_aplicar(p_tenant text, p_sale_id text, p_sale jsonb, p_credito_antes numeric) returns jsonb`. Devolve a venda pronta para gravar: sempre sem a chave `conferencia` vinda do aparelho. Com divergência e barrar desligado: acrescenta `conferencia = {em: now(), divergencias: [...]}` e grava uma linha em `audit_log` (`action = 'Venda com divergência'`, `entity = 'sale'`, `entity_id = p_sale_id`, `actor_auth_uid = auth.uid()`, `actor_role = current_staff_role()`, `meta = {divergencias}`). Com barrar ligado: `raise exception 'venda_divergente' using errcode = '42501', detail = <divergencias::text>`.
  - Conflito novo em `sales_apply`: `{id, data, reason}` com `reason` = `'venda_divergente'` (mais `divergencias`) ou `'sem_permissao_cancelar'`.

Regras:
- **Quando conferir:** a venda que vai ser gravada tem `status = 'closed'` e não tem `canceled`. Em `close_sale`, depois de montar `v_sale` e antes do `insert`. `p_credito_antes` = `greatest(0, -members.debt)` do `memberId`, lido `for update` antes de inserir os lançamentos (0 sem sócio). Em `sales_apply`, por venda do lote, antes do `insert`; com barrar ligado, a venda vira conflito e o lote continua.
- **Venda que não é conferida** (aberta ou cancelada inteira): mesmo assim, apagar a chave `conferencia` vinda do aparelho.
- **Cancelar:** existe a versão gravada (`v_cur`) e a nova marca `canceled` num item cujo `lineId` estava ativo nela, ou marca `canceled` na venda inteira que não estava. Nesse caso exige `tem_permissao('cancelar-comanda')`. Itens sem `lineId` ficam fora. Em `close_sale`: `raise exception 'sem permissao para cancelar' using errcode='42501'`. Em `sales_apply`: conflito `sem_permissao_cancelar`.
- **Receber fiado:** gatilho `before insert` em `member_debt_entries`, função `public.member_debt_entries_guard_receber()`. Quando `new.type = 'payment'`, `new.sale_id is null` e `auth.uid() is not null`, exige `tem_permissao('receber-fiado') or tem_permissao('contas')`; senão `raise exception 'sem permissao para receber fiado' using errcode='42501'`. Lançamento com `sale_id` (pendência paga no fechamento, crédito de troco) passa.

- [ ] **Step 1: Escrever os testes que falham:**
  - `registra sem barrar`: como `caixa`, `close_sale` de venda com p1 a 1. A venda grava, `data->'conferencia'->'divergencias'->0->>'codigo' = 'preco_abaixo'`, e existe 1 linha em `audit_log` com `action = 'Venda com divergência'`.
  - `venda certa sem marca`: venda certa grava sem a chave `conferencia`.
  - `conferencia do aparelho e descartada`: venda certa enviada com `conferencia: {divergencias: []}` falsa, e venda divergente enviada com `conferencia: null`. Na primeira a chave some; na segunda o servidor grava a dele.
  - `barrar ligado`: com `conferenciaBarrar: true`, `erro(close_sale ...)` contém `venda_divergente` e a venda não existe em `sales`.
  - `lote com uma recusada grava as outras`: barrar ligado, `sales_apply` com uma venda certa e uma divergente. `rows` tem a certa e `conflicts[0].reason = 'venda_divergente'`.
  - `cancelar sem permissao`: caixa com lista própria `['caixa']`, comanda aberta gravada com item `lineId: 'L1'`, `sales_apply` marcando `L1` como `canceled` dá conflito `sem_permissao_cancelar`. Com a permissão, grava.
  - `cancelar no close_sale`: mesmo cenário por `close_sale` dá erro `sem permissao para cancelar`.
  - `admin regrava fechada`: como `admin`, `sales_apply` de venda fechada com item cancelado grava.
  - `receber fiado`: caixa sem `receber-fiado` nem `contas`: `insert` de `payment` sem `sale_id` dá erro `sem permissao para receber fiado`; com `sale_id` passa. Admin passa sempre.
  - Rodar também `node db/t-caixa-turnos.js` e `node db/sqltest.js` (os testes atuais de `close_sale`/`sales_apply` precisam continuar passando).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `venda_conferencia_aplicar`, os novos `close_sale` e `sales_apply` (corpo de `20261108000000` mais as regras acima) e o gatilho. Repetir os `revoke`/`grant` das duas RPCs.
- [ ] **Step 4: Rodar os três arquivos de teste e ver passar.**
- [ ] **Step 5: Commit:** `feat(banco): conferência e permissões no fechamento e no fiado (item 4)`.

### Task 4: tela (recusas, ajuste, relatório, novidades)

**Files:**
- Create: `assets/js/gestao/divergencias.js` (tag em `index.html` junto dos outros de `gestao/`, mesmo `?v=`)
- Modify: `assets/js/vendas/pagamento.js:440-445` (erro do `close_sale`), `assets/js/core/caixa-multiaparelho.js` (tratamento dos conflitos do `sales_apply`, perto da linha 172), `assets/js/core/config.js:144` (item do menu Relatórios › Vendas), relatórios em `assets/js/gestao/` (onde `openReportView` resolve o rótulo), Configurações em `assets/js/sistema/` (ajuste), `assets/js/sistema/novidades.js` (entrada nova no topo), `index.html` (tag e `?v=`)
- Test: `../auditoria-2026-11-03/e2e/t56-conferencia.js` (no molde de `e2e/t55-caixa-por-operador.js`)

**Interfaces:**
- Consumes: erros e conflitos do Task 3.
- Produces (globais em `divergencias.js`):
  - `motivoDivergencia(d) -> string`
  - `textoRecusaVenda(err) -> string|null` (null quando o erro não é de conferência nem de permissão)
  - `renderVendasDivergentes(el)`

Textos fixos de `motivoDivergencia` por código:
- `preco_abaixo`: "Item abaixo do preço do cadastro"
- `produto_desconhecido`: "Item que não está no cadastro"
- `subtotal`: "Soma dos itens diferente do subtotal"
- `cupom`: "Desconto sem cupom válido"
- `desconto_colaborador`: "Desconto de colaborador indevido"
- `credito`: "Crédito maior que o do cliente"
- `pagamento_abaixo`: "Pagamento menor que o total"

Quando há `item`, o texto ganha " (nome do item)". Quando há `esperado` e `recebido`, ganha " — esperado R$ x, veio R$ y".

Recusas (`textoRecusaVenda`):
- `venda_divergente`: "Venda recusada: não bate com o cadastro. Confira os itens e o pagamento." Mais os motivos do `detail`, quando vierem.
- `sem permissao para cancelar`: "Você não tem permissão para cancelar item ou comanda."
- `sem permissao para receber fiado`: "Você não tem permissão para receber fiado."

- [ ] **Step 1: Escrever o e2e que falha** `t56-conferencia.js`:
  - `relatorio`: admin com uma venda gravada com `conferencia` (p1 a 1) abre Relatórios › Vendas › "Vendas com divergência" e vê uma linha com "Item abaixo do preço do cadastro".
  - `ajuste`: em Configurações aparece "Recusar venda que não bate com o cadastro", desligado. Ligar grava `conferenciaBarrar: true` em `cantina2:settings`. Caixa não vê o ajuste.
  - `recusa no pagamento`: com barrar ligado e um produto com preço trocado na bancada, fechar a venda mostra o toast "Venda recusada: não bate com o cadastro" e a janela de pagamento continua aberta.
  - `caixa sem relatorio`: caixa sem `relatorios-gerencia` não vê o item no menu.
- [ ] **Step 2: Rodar e ver falhar.** `node e2e/t56-conferencia.js` (na bancada, servidor e banco no ar como no t55). Esperado: o item do menu não existe.
- [ ] **Step 3: Implementar** `divergencias.js` e as mudanças listadas:
  - o relatório lista vendas de `state.sales` com `conferencia` no período (padrão: hoje), colunas Data/hora, Pedido, Colaborador (`operatorName`), Total, Motivos, com clique abrindo a comanda como no Histórico de Pedidos;
  - os dois pontos de erro chamam `textoRecusaVenda` antes do toast genérico;
  - o ajuste fica só para `config-sistema`, com a ajuda "Deixe desligado na primeira semana e confira o relatório Vendas com divergência antes de ligar.";
  - a entrada de NOVIDADES usa `perms:['relatorios-gerencia']`, onde 'Relatórios › Vendas com divergência'.
- [ ] **Step 4: Rodar** `node scripts/bump-version.js`, `node scripts/check-app.js`, `node scripts/check-load-order.js` e `node e2e/t56-conferencia.js`. Esperado: tudo ok. Também rodar `node e2e/t55-caixa-por-operador.js` e `node e2e/t26-permissoes-por-usuario.js` (sem regressão).
- [ ] **Step 5: Conferir no Chrome** (captura) o relatório em 1366×768 e em 390 px.
- [ ] **Step 6: Commit:** `feat(relatorios): vendas com divergência, ajuste de recusa e mensagens (item 4)`.

### Task 5: handoff e PR em rascunho

**Files:**
- Modify: `docs/HANDOFF.md` (seção nova "14/11: conferência no servidor")

- [ ] **Step 1: Escrever no HANDOFF** a ordem de publicação: (1) migration `20261117000000`; (2) merge e recarga dos aparelhos. Anotar que nenhuma função Edge muda, o ajuste nasce desligado, a revisão do relatório fica marcada para uma semana depois, e os limites conhecidos: item enviado removido da comanda sem a marca `canceled` não é pego; o `addedById` da liberação de peso vem do aparelho.
- [ ] **Step 2: Commit e PR em rascunho:** `docs: handoff da conferência no servidor (item 4)`, depois `gh pr create --draft` com o resumo e a ordem de publicação.
