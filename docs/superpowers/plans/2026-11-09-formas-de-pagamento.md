# Formas de Pagamento configuráveis e Conferência: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma lista única de formas de pagamento por estabelecimento decide venda, garçom, fiado, fechamento, relatórios e nota, e o administrador confere os pagamentos em tela própria.

**Architecture:** O modelo fica em `assets/js/core/formas.js`, lido de `cantina2:paymentMethods`, com formas iniciais quando a lista está vazia. Cada pagamento novo guarda o método estável, o nome e o `tPag`. A conferência é uma tabela nova (`payment_checks`) gravada só por RPC.

**Tech Stack:** HTML/CSS/JS puro em scripts clássicos, Supabase (Postgres, RLS, Edge Functions Deno/TS), bancada Playwright em `../auditoria-2026-11-03`.

**Spec:** `docs/superpowers/specs/2026-11-09-formas-de-pagamento-design.md`

## Global Constraints

- Trabalhar no worktree `../commandah-formas`, branch `feat/formas-pagamento`, criado da `main`.
- Sem build e sem módulos. Arquivo novo entra em `index.html` na ordem certa, com o mesmo `?v=`.
- Código, comentários, UI e commits em português; comentários citam "09/11 (pedido do dono)".
- Dado do usuário em HTML sempre com `h` e `jsArg`. Ações que gravam passam por `singleFlight`.
- Só administrador altera formas e confere pagamentos.
- O operador às cegas nunca vê valor esperado (`podeVerTotaisDoCaixa()`).
- Migration, deploy e merge só com o "sim" do dono a cada passo.
- Bancada: rodar de `../auditoria-2026-11-03` com `REPO=<worktree>`. Subir o banco com `bash db/up.sh > db/up.log 2>&1 </dev/null` (com pipe o comando não termina).
- Testes novos ficam fora do repositório, em `../auditoria-2026-11-03/e2e/`, no molde de `t31-diaria-freelancer.js`. Depois de `pinLogin`, fechar a janela de Novidades: `await page.waitForTimeout(400); await H.closeModals(page);`.

## Review Focus

1. Forma renomeada depois de ter vendas: o histórico continua numa linha só, com o nome novo. Teste na Tarefa 4.
2. Forma desligada com movimento na sessão aberta: a linha continua no fechamento. Teste na Tarefa 4.
3. Lista vazia, ou antiga só com `nome` e `tipo`: o sistema usa as formas iniciais e mantém as antigas como extras. Teste na Tarefa 1.
4. Nenhuma forma ligada em "Ao receber fiado": a janela de recebimento avisa e não grava sem forma. Teste na Tarefa 3.
5. Comanda reaberta depois de ter pagamento confirmado: o pagamento refeito aparece como "A conferir" e a chave antiga não quebra a tela. Teste na Tarefa 7.

---

### Task 1: Modelo das formas

**Files:**
- Create: `assets/js/core/formas.js`
- Modify: `index.html` (tag logo depois de `core/config.js`), `assets/js/core/config.js:426-439`
- Test: `../auditoria-2026-11-03/e2e/t35-formas-modelo.js`

**Interfaces:**
- Produces, em `core/formas.js`:
  - `FORMAS_TIPOS`: `{dinheiro:{label,tPag:'01'}, credito:{'03'}, debito:{'04'}, fiado:{'05'}, vale_alimentacao:{'10'}, vale_refeicao:{'11'}, vale_presente:{'12'}, deposito:{'16'}, pix:{'17'}, transferencia:{'18'}, fidelidade:{'19'}, outros:{'99'}}`, com os rótulos da tabela da spec.
  - `FORMAS_INICIAIS`: as 6 linhas da spec, com `method` `dinheiro|credito|debito|pix|vale|fiado`.
  - Forma: `{method:string, nome:string, tipo:string, naVenda:boolean, noFiado:boolean, confere:'operador'|'admin'|'ninguem'}`.
  - `listaDeFormas(): Forma[]`, `formaPorMetodo(m): Forma|null`, `formasNaVenda(): Forma[]`, `formasNoFiado(): Forma[]`, `normalizarMetodo(m): string`, `tPagDoMetodo(m): string|null`.

- [ ] **Step 1: Escrever o teste que falha**

```js
check('lista vazia usa as 6 iniciais', nomes === 'Dinheiro,Crédito,Débito,Pix,Vale,Fiado');
check('Vale inicial tem tPag 11', tpagVale === '11');
check('antiga só com nome vira extra em Outros', antiga.method === 'outro:Ticket Clube' && antiga.tipo === 'outros' && lista.length === 7);
check('item gravado sem as iniciais não as apaga', listaParcial.some(f => f.method === 'dinheiro'));
check('normalizarMetodo: legado', [normalizarMetodo('Dinheiro'), normalizarMetodo('Pix'), normalizarMetodo('Cartão')].join() === 'dinheiro,pix,cartao');
check('methodBucket segue o tipo', methodBucket('forma:x') === 'cartao' /* forma:x com tipo credito */);
check('methodLabel usa o nome atual', methodLabel('forma:x') === 'Rede Crédito');
check("methodLabel('outro') é Outros", methodLabel('outro') === 'Outros');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `REPO=<worktree> node e2e/t35-formas-modelo.js`
Expected: FALHA, `listaDeFormas is not defined`.

- [ ] **Step 3: Implementar `core/formas.js` e ajustar `config.js`**

`listaDeFormas` junta as iniciais com `state.paymentMethods`: item com `method` igual ao de uma inicial substitui a inicial; item sem `method` vira `{method:'outro:'+nome, tipo:'outros', naVenda:true, noFiado:true, confere:'ninguem'}`. Em `config.js`, acrescentar `outro:{label:'Outros',grupo:'outros'}` a `FORMAS_PAGAMENTO`; `methodLabel` e `methodBucket` consultam `formaPorMetodo` antes do fallback. Grupo por tipo: credito e debito `cartao`; pix `pix`; dinheiro `dinheiro`; fiado `fiado`; os demais `outros`.

- [ ] **Step 4: Rodar e ver passar**

Run: `REPO=<worktree> node e2e/t35-formas-modelo.js && REPO=<worktree> node e2e/t2-fluxos.js`
Expected: todos passam; `t2` 29/29.

- [ ] **Step 5: Commit**

```bash
git add assets/js/core/formas.js assets/js/core/config.js index.html
git commit -m "feat(formas): modelo único das formas de pagamento"
```

### Task 2: Tela de cadastro (modelo B)

**Files:**
- Create: `assets/js/cadastros/formas-pagamento.js` (tag depois de `cadastros/usuarios.js`)
- Modify: `assets/js/core/crud.js:8,126,139,142,179-186,194`, `assets/js/gestao/financeiro.js:10-15`, `assets/css/ajustes.css`
- Test: `../auditoria-2026-11-03/e2e/t36-formas-tela.js`

**Interfaces:**
- Consumes: `listaDeFormas`, `FORMAS_TIPOS`.
- Produces: `renderPaymentMethods(el)`, `alternarForma(method, grupo: 'naVenda'|'noFiado')`, `abrirEdicaoForma(method|null)`, `formaFoiUsada(method): Promise<boolean>`.

- [ ] **Step 1: Escrever o teste que falha**

```js
check('dois grupos', titulos.join() === 'Na hora de pagar,Ao receber fiado');
check('sem Bandeira nem Credenciadora', !/Bandeira|Credenciadora/.test(textoTela + textoEdicao));
check('clicar desliga e grava', blobAposClique.find(f => f.method === 'vale').naVenda === false);
check('recarregar mantém desligada', depoisDeRecarregar === false);
check('não desliga a última de "Na hora de pagar"', ultimaContinuaLigada && toast.includes('Pelo menos uma'));
check('nome repetido é recusado', toastNome.includes('Já existe'));
check('sem opção de novo Dinheiro ou Fiado', !tiposDaNova.includes('dinheiro') && !tiposDaNova.includes('fiado'));
check('forma com venda não apaga', toastApagar.includes('desligue'));
check('forma nova e sem uso apaga', apagou);
check('Fiado sem botão em "Ao receber fiado"', !gruposDoFiado.includes('noFiado'));
check('caixa abre só para consulta', cliqueDoCaixaNaoGravou);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `REPO=<worktree> node e2e/t36-formas-tela.js`
Expected: FALHA, a tela ainda mostra "Nova Bandeira".

- [ ] **Step 3: Implementar a tela e remover o código antigo**

Remover `renderPaymentMethods`, `selectPaymentMethod`, `selectCardBrand`, `editSelectedPaymentMethod`, `editSelectedCardBrand` e `updatePaymentBrandLink` de `financeiro.js`; `openPaymentMethodModal`, `openCardBrandModal` e o picker de credenciadora de `crud.js`. Método de forma nova: `'forma:'+uid()`. Alterar exige `podeEditarCatalogo()`. Registrar cada alteração com `logAction`. Dados antigos de bandeiras não são apagados. `formaFoiUsada` olha `state.sales`, `state.cashMovements` e consulta `member_debt_entries` por `method`. Formas `dinheiro` e `fiado` nunca apagam e não mudam de tipo.

- [ ] **Step 4: Rodar e ver passar**

Run: `REPO=<worktree> node e2e/t36-formas-tela.js && node scripts/check-app.js && node scripts/check-load-order.js`
Expected: passam, sem função faltando em `onclick`.

- [ ] **Step 5: Commit**

```bash
git add -A assets/js index.html assets/css/ajustes.css
git commit -m "feat(formas): tela de botões no lugar de bandeiras e credenciadora"
```

### Task 3: Pontos de pagamento seguem a lista

**Files:**
- Modify: `assets/js/vendas/pagamento.js:2-20,304,~394`, `assets/js/operacao/garcom.js:317,~345`, `assets/js/gestao/financeiro.js:101-108`, `assets/js/vendas/agendamento.js:8`
- Test: `../auditoria-2026-11-03/e2e/t37-formas-pagar.js`

**Interfaces:**
- Consumes: `formasNaVenda`, `formasNoFiado`, `normalizarMetodo`, `tPagDoMetodo`.
- Produces: `comDadosDaForma(p): {…p, label:string, tPag:string|null}`. Pagamento gravado passa a ter `label` e `tPag`. Lançamento de fiado novo grava o método estável em `method`.

- [ ] **Step 1: Escrever o teste que falha**

```js
check('forma desligada some da janela', !botoes.includes('Vale'));
check('forma nova aparece', botoes.includes('Pago online'));
check('sem botão Outros', !botoes.includes('Outros'));
check('atalhos mantidos', teclas.A === 'dinheiro' && teclas.P === 'pix');
check('garçom segue a lista, sem Fiado', gc.includes('Pago online') && !gc.includes('Fiado'));
check('venda grava label e tPag', pag.label === 'Pago online' && pag.tPag === '99');
check('parcial também grava tPag', parcial.tPag === '17');
check('fiado lista as formas ligadas', opcoesFiado.join() === 'Dinheiro,Crédito,Débito,Pix');
check('recebimento grava método estável', entry.method === 'pix');
check('movimento do caixa também', mov.method === 'pix' && mov.origin === 'fiado');
check('dinheiro com caixa fechado continua barrado', toast.includes('Abra o caixa'));
check('Salário continua só para admin + colaborador', temSalarioAdmin && !temSalarioCaixa);
check('nenhuma forma no fiado avisa e não grava', toastSemForma.includes('Ligue uma forma') && !gravou);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `REPO=<worktree> node e2e/t37-formas-pagar.js`
Expected: FALHA em "forma desligada some da janela".

- [ ] **Step 3: Implementar**

`methodConfig` monta de `formasNaVenda()`, com ícone pelo tipo. `GC_PAY_METHODS` vira filtro `formasNaVenda().filter(f=>f.tipo!=='fiado')`. `openFiadoEntry` usa `formasNoFiado()`, com `value` igual ao método; a checagem de `'Dinheiro'` passa a `tipo==='dinheiro'`. `recordFiadoPaymentInCash` usa `normalizarMetodo`. `comDadosDaForma` é aplicado a `sale.payments` logo depois da junção dos parciais. `fiadoMethodLabel` usa `methodLabel(normalizarMetodo(m))`, preservando `salario`.

- [ ] **Step 4: Rodar e ver passar**

Run: `REPO=<worktree> node e2e/t37-formas-pagar.js && REPO=<worktree> node e2e/t2-fluxos.js && REPO=<worktree> node e2e/t29-perfil-garcom.js && REPO=<worktree> node e2e/t32-colaborador.js`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add assets/js
git commit -m "feat(formas): venda, garçom e fiado seguem a lista cadastrada"
```

### Task 4: Fechamento de caixa por forma

**Files:**
- Modify: `assets/js/core/config.js:443`, `assets/js/operacao/caixa.js:44,81-85,93,99-117,120`
- Test: `../auditoria-2026-11-03/e2e/t38-formas-fechamento.js`

**Interfaces:**
- Consumes: `listaDeFormas`, `formaPorMetodo`, `methodLabel`.
- Produces: `somaPorMetodo(vendas, {pularParcial}): {[method]:number}`; `recebimentosFiadoPorMetodo(movs): {[method]:number}` (sem dinheiro); `linhasPorForma(porMetodo): {method,label,valor}[]`, na ordem da lista, legados no fim. O registro fechado ganha `porForma`, `fiadoPorForma` e `contagens: {method,label,esperado,contado,diff}[]`. `totals`, `countedAmount` e `expectedAmount` continuam.

- [ ] **Step 1: Escrever o teste que falha**

```js
check('linhas separadas', linhas.join() === 'Dinheiro,Crédito,Débito,Pix,Pix fiado,Vale,Fiado');
check('operador só conta Dinheiro', campos.join() === 'cashCountedAmount');
check('operador às cegas sem esperado', !/R\$ ?\d/.test(textoPasso1Operador));
check('admin vê os valores', valores.Crédito === 30 && valores.Débito === 20);
check('fiado em dinheiro soma em Dinheiro', valores.Dinheiro === 150);
check('Pix fiado fora do total vendido', snap.totalVendido === 80 && snap.fiadoPorForma.pix === 10);
check('forma "operador" extra pede contagem', camposExtra.includes('cashCounted-1'));
check('Dinheiro sem conferência fecha sem contagem', fechouSemContar && fechado.countedAmount === null);
check('fechado guarda contagens', fechado.contagens[0].method === 'dinheiro');
check('renomear mantém uma linha', linhasRenomeada.filter(l => l === 'Pix Rede').length === 1 && !linhasRenomeada.includes('Pix'));
check('desligada com movimento continua', linhasDesligada.includes('Vale'));
check('sessão antiga sem porForma abre', historicoAbriu);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `REPO=<worktree> node e2e/t38-formas-fechamento.js`
Expected: FALHA em "linhas separadas".

- [ ] **Step 3: Implementar**

`cashClosingSnapshot` acrescenta `porForma` (vendas, sem parcial, mais movimentos parciais, como `cashSessionTotals`) e `fiadoPorForma`. `checkCashCount` monta a tabela com `linhasPorForma`. O campo do Dinheiro continua `cashCountedAmount`; os das outras formas "operador" são `cashCounted-<índice>`; `cashCountedCard` sai. O campo de contagem só é exigido se a forma for "operador". Recebimentos somam `suprimento` e subtraem `sangria` de `origin:'fiado'`. Impressão e Histórico do Caixa usam as mesmas linhas. A trava de `caixa.js:120` continua envolvendo a função.

- [ ] **Step 4: Rodar e ver passar**

Run: `REPO=<worktree> node e2e/t38-formas-fechamento.js && REPO=<worktree> node e2e/t15-ux-lote1.js && REPO=<worktree> node e2e/t21-caixa-cego-movimentacao.js && REPO=<worktree> node e2e/t31-diaria-freelancer.js`
Expected: todos passam. Se algum teste antigo procurar `cashCountedCard`, atualizar esse teste.

- [ ] **Step 5: Commit**

```bash
git add assets/js
git commit -m "feat(formas): fechamento de caixa com uma linha por forma"
```

### Task 5: Relatórios por forma

**Files:**
- Modify: `assets/js/gestao/relatorios.js:27-37,57,65-66,137,149,175,203`
- Test: `../auditoria-2026-11-03/e2e/t39-formas-relatorios.js`

**Interfaces:**
- Consumes: `somaPorMetodo`, `linhasPorForma`.
- Produces: `colunasDeFormas(listas: {[method]:number}[]): {method,label}[]`, com as formas que têm valor em alguma lista.

- [ ] **Step 1: Escrever o teste que falha**

```js
check('Resumo separa', linhasResumo.includes('Crédito') && linhasResumo.includes('Débito') && !linhasResumo.includes('Cartão'));
check('venda antiga separa crédito e débito', valorCreditoAntigo === 40);
check('"cartao" antigo aparece em Cartão', linhasComLegado.includes('Cartão'));
check('Export: coluna por forma', cabecalho.includes('Crédito') && cabecalho.includes('Vale') && !cabecalho.includes('Outros'));
check('Total das colunas bate com o faturamento', somaColunas === faturamento);
check('Fechamento antigo aparece no Export', linhaFechamentoAntigo.includes(25));
check('Salário continua à parte', linhasExport.includes('Descontado do salário'));
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `REPO=<worktree> node e2e/t39-formas-relatorios.js`
Expected: FALHA em "Resumo separa".

- [ ] **Step 3: Implementar**

Fechamento sem `porForma` usa `totals` com as chaves `dinheiro`, `cartao`, `pix`, `fiado` e `outro`. As colunas "Cartão esperado" e "Cartão informado" do export ficam só quando alguma sessão antiga as tiver.

- [ ] **Step 4: Rodar e ver passar**

Run: `REPO=<worktree> node e2e/t39-formas-relatorios.js && REPO=<worktree> node e2e/t22-caixa-cego-relatorios.js && REPO=<worktree> node e2e/t32-colaborador.js`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add assets/js/gestao/relatorios.js
git commit -m "feat(formas): relatórios com uma coluna por forma"
```

### Task 6: Banco da conferência

**Files:**
- Create: `supabase/migrations/20261111000000_conferencia_pagamentos.sql`
- Test: `../auditoria-2026-11-03/db/sqltest.js` (grupo novo `conferencia`)

**Interfaces:**
- Produces:
  - Tabela `public.payment_checks(tenant_id text, payment_key text, status text check (status in ('confirmado','nao_recebido')), note text, checked_by text, checked_at timestamptz not null default now(), primary key (tenant_id, payment_key))`.
  - RPC `public.payment_checks_apply(p_keys jsonb, p_status text, p_note text, p_by text) returns jsonb` → `{ok:true, n:int}`. `p_status` aceita também `a_conferir`, que apaga a marcação.

- [ ] **Step 1: Escrever os testes que falham**

```js
check('conferencia', 'admin confirma 2', r.ok && r.rows[0].n === 2);
check('conferencia', 'caixa não aplica', !r.ok && r.code === '42501');
check('conferencia', 'garçom e cozinha não leem', linhas === 0);
check('conferencia', 'cliente direto não grava', !inserir.ok);
check('conferencia', 'nao_recebido sem observação recusa', !r.ok && r.code === '23514');
check('conferencia', 'a_conferir apaga', linhas === 0);
check('conferencia', 'tenant B não vê as do A', linhas === 0);
check('conferencia', 'mais de 500 chaves recusa', !r.ok);
check('conferencia', 'grava audit_log', log.entity === 'payment_check');
check('conferencia', 'status inválido recusa', !r.ok);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash db/up.sh > db/up.log 2>&1 </dev/null; node db/sqltest.js > db/sqltest.log 2>&1 </dev/null; tail -3 db/sqltest.log`
Expected: falhas do grupo `conferencia`.

- [ ] **Step 3: Escrever a migration**

`set lock_timeout = '5s'`; RLS com policy de select `tenant_id = current_tenant_id() and is_admin_like()`; `revoke all` da tabela para `anon` e sem grant de escrita para `authenticated`. RPC `security definer`, `set search_path to ''`, `revoke all from public, anon`, `grant execute to authenticated`. Sem permissão: `using errcode='42501'`. Observação vazia em `nao_recebido`: `errcode='23514'`. Bloco de ROLLBACK comentado no fim.

- [ ] **Step 4: Rodar e ver passar**

Run: o mesmo do Step 2.
Expected: `0 falha(s)`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261111000000_conferencia_pagamentos.sql
git commit -m "feat(conferencia): tabela e RPC da conferência de pagamentos"
```

### Task 7: Tela Conferência de pagamentos

**Files:**
- Create: `assets/js/gestao/conferencia.js` (tag depois de `gestao/financeiro.js`)
- Modify: `index.html` (`<div class="view" id="view-conferencia">`), `assets/js/core/config.js:134,181`, `assets/js/core/navegacao.js:7,364`, `assets/js/cadastros/usuarios.js:14`, `assets/css/ajustes.css`
- Test: `../auditoria-2026-11-03/e2e/t40-conferencia.js`

**Interfaces:**
- Consumes: `payment_checks_apply`, `listaDeFormas`, `methodLabel`, `normalizarMetodo`.
- Produces: `renderConferencia(el)`, `chaveDoPagamento(sale, p, indiceEntreIguais): string`, com os formatos `venda:<id>:<method>:<n>`, `parcial:<partialId>` e `fiado:<entryId>`.

- [ ] **Step 1: Escrever o teste que falha**

```js
check('só admin vê no menu', menuAdmin && !menuCaixa);
check('lista só formas "admin"', metodos.every(m => m !== 'dinheiro' && m !== 'fiado'));
check('recebimento de fiado aparece', linhas.some(l => l.chave.startsWith('fiado:')));
check('pendência paga na venda não duplica', linhas.filter(l => l.valor === 12).length === 1);
check('Confirmar selecionados', situacoes.every(s => s === 'Confirmado'));
check('Não recebido exige observação', toast.includes('observação'));
check('marcar não muda a venda', totalAntes === totalDepois);
check('caixa continua fechando com "Não recebido"', fechou);
check('filtros', filtrada.length === 1);
check('totais por forma', totais.Pix === 50);
check('exporta com a situação', cabecalho.includes('Situação') && linhasXlsx.length === linhas.length);
check('comanda reaberta volta a "A conferir"', nova.situacao === 'A conferir' && semErroNoConsole);
check('sem erro com forma ligada a "ninguém"', semErroNoConsole);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `REPO=<worktree> node e2e/t40-conferencia.js`
Expected: FALHA, `renderConferencia is not defined`.

- [ ] **Step 3: Implementar**

Fonte: `state.sales` (só `saleCountsAsRevenue`, sem `p.reversed`) e `member_debt_entries` com `type='payment'`, `sale_id is null` e `method<>'salario'` no período (consulta direta, porque o extrato só carrega por cliente). Marcações lidas de `payment_checks`. Permissão nova `conferir-pagamentos` no `ROLE_PERMS.admin` e em `PERMISSION_GROUPS` (Financeiro e gestão). Menu em Financeiro, com `perm`. Exportar com `XLSX.writeFile`, arquivo `conferencia-<de>-a-<ate>.xlsx`. Gravar por `singleFlight`.

- [ ] **Step 4: Rodar e ver passar**

Run: `REPO=<worktree> node e2e/t40-conferencia.js && REPO=<worktree> node e2e/t26-permissoes-por-usuario.js`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add -A assets/js index.html assets/css/ajustes.css
git commit -m "feat(conferencia): tela de conferência de pagamentos"
```

### Task 8: Nota fiscal, três configurações de ponta a ponta e entrega

**Files:**
- Modify: `supabase/functions/nfce/payload.ts:92-95`, `assets/js/sistema/novidades.js`, `docs/HANDOFF.md`, `index.html` (`?v=`)
- Test: `../auditoria-2026-11-03/nfce/payload.test.mjs`, `../auditoria-2026-11-03/e2e/t41-formas-estabelecimentos.js`

**Interfaces:**
- Consumes: `p.tPag` e `p.label` gravados na Tarefa 3.

- [ ] **Step 1: Escrever os testes que falham**

```js
// payload
assert(pag({method:'forma:x', tPag:'11', amount:10}).FormaPagamento === '11');
assert(pag({method:'forma:y', tPag:'99', label:'Pago online', amount:10}).Descricao === 'Pago online');
assert(pag({method:'vale', amount:10}).FormaPagamento === '10'); // venda antiga
assert(pag({method:'forma:z', tPag:'03', amount:10}).TipoIntegracao === false);
// t41: para cada configuração (bar sem fiado, restaurante com vale-alimentação, clube)
check(`${nome}: vende, recebe, fecha e o relatório bate`, vendeu && fechou && somaColunas === faturamento);
check('bar: sem Fiado na janela', !botoesBar.includes('Fiado'));
check('restaurante: vale-alimentação com tPag 10', pagVale.tPag === '10');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `REPO=<worktree> node nfce/payload.test.mjs; REPO=<worktree> node e2e/t41-formas-estabelecimentos.js`
Expected: novos testes falham; as 2 falhas antigas do payload continuam.

- [ ] **Step 3: Implementar**

Em `payload.ts`: `const tPag = /^\d{2}$/.test(String(p.tPag||'')) ? String(p.tPag) : (TPAG[String(p.method||'').toLowerCase()] || '99')`, e `Descricao` usa `p.label || p.method`. Entrada com a data da publicação no topo de `NOVIDADES`, com `perms`: tela de formas (`pagamentos`), fechamento (`caixa`), conferência (`conferir-pagamentos`). Seção com a mesma data no `HANDOFF.md`, com a ordem de publicação. Rodar `node scripts/bump-version.js`.

- [ ] **Step 4: Rodar tudo**

Run: `bash db/up.sh > db/up.log 2>&1 </dev/null; node db/sqltest.js > db/sqltest.log 2>&1 </dev/null; tail -1 db/sqltest.log`, depois `t2`, `t15`, `t21`, `t22`, `t26`, `t29`, `t31`, `t32` e `t35`–`t41`, e no worktree `node scripts/check-app.js && node scripts/check-load-order.js`.
Expected: `0 falha(s)`; todos passam; só as 2 falhas antigas do payload e as 3 contagens antigas do `t33`.

- [ ] **Step 5: Commit e PR em rascunho**

```bash
git add -A supabase/functions/nfce assets/js index.html docs/HANDOFF.md
git commit -m "feat(formas): nota usa o tPag da forma; Novidades e HANDOFF"
git push -u origin feat/formas-pagamento
gh pr create --draft --base main --title "feat: formas de pagamento configuráveis e conferência"
```

- [ ] **Step 6: Publicar, cada passo com o "sim" do dono**

1. Migration `20261111000000`: `npx supabase db query --linked --yes -f <arquivo> </dev/null`, depois `npx supabase migration repair --status applied 20261111000000 --linked --yes` rodado do worktree.
2. `npx supabase functions deploy nfce --project-ref ezfoymdesmarpunmixbs --use-api --yes`.
3. Atualizar o branch com a `main`, conferir o `?v=`, marcar pronto, esperar `syntax-check`, `gh pr merge --merge`.
4. Dono recarrega os aparelhos e confere: uma venda em cada forma, um fechamento e uma conferência.
