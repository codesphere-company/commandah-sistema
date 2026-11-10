# Relatórios detalhados — plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar conta do cliente, vendas, garçons, Mais Vendidos corrigido e cupons fiscais com pacote para a contabilidade, todos contando vendas pela data de pagamento.

**Architecture:** Cada relatório novo é um script clássico em `assets/js/gestao/`, com uma função pura que calcula os dados e uma que desenha a tela. Um arquivo comum guarda o cartão de venda com itens e a exportação `.xlsx`. O XML do cancelamento fica na última tarefa de código, separada, porque depende de banco e Edge Function em produção.

**Tech Stack:** HTML/CSS/JS puro sem build, Supabase, SheetJS 0.18.5 (já usada), JSZip 3.10.1 por CDN com SRI.

**Spec:** `docs/superpowers/specs/2026-11-10-relatorios-design.md`

## Global Constraints

- Trabalhar no worktree `../commandah-relatorios`, branch `feat/relatorios`, criado a partir da `main`.
- Sem build, sem `type="module"`. Arquivo novo: tag em `index.html` logo depois de `gestao/relatorios.js`, com o mesmo `?v=`.
- Escape com `h` e `jsArg`. Interface, comentários e commits em português.
- Depois de mudar `assets/js` ou `assets/css`: `node scripts/bump-version.js`.
- Checagens de toda tarefa: `node scripts/check-app.js` e `node scripts/check-load-order.js`.
- Vendas contam por `saleCountsAsRevenue` e pelo dia de `saleRevenueDay`.
- Nada de texto fixo do clube: "Cliente", e formas lidas de `colunasDeFormas`.
- Todo controle na tela precisa filtrar de verdade.
- Relatórios novos no menu com `perm:'relatorios-gerencia'`.
- Merge publica na hora. Migration e deploy de Edge Function só com o "sim" do dono no chat.

**Como testar.** O repositório não tem testes próprios. Os testes ficam na bancada `../auditoria-2026-11-03/e2e`, no formato de `t39-formas-relatorios.js` (`H.up`, `seed`, `H.ownerLogin`, `H.pinLogin`, `page.evaluate`, `check`). Banco local no ar: `bash db/up.sh > db/up.log 2>&1 </dev/null`. Rodar de dentro de `../auditoria-2026-11-03`:

`REPO=C:/Users/fabri/Documents/commandah/commandah-relatorios node e2e/<arquivo>`

Passou quando a última linha mostra `0 falha(s).`

## Review Focus

1. Comanda aberta às 23:50 e paga às 00:10: aparece no dia seguinte em todos os relatórios (Tarefa 1).
2. Venda com duas formas: a tabela por forma soma só a parte de cada forma, e o filtro encontra a venda pelas duas (Tarefa 4).
3. Dados antigos ou incompletos (venda sem `items`, sem `payments`, item sem `addedBy`, cliente só com saldo inicial): mostram "—", nunca "undefined" nem "Invalid Date" (Tarefas 2 e 3).
4. Nota autorizada sem XML gravado: o pacote sai, a planilha lista a nota e o aviso diz quantas ficaram sem arquivo (Tarefa 7).
5. Nome de cliente ou produto com HTML: aparece como texto em todas as telas novas (Tarefas 2 e 5).

---

### Tarefa 1: Vendas pela data de pagamento

**Files:**
- Modify: `assets/js/core/calculos.js:10-12`
- Modify: `assets/js/gestao/relatorios.js` (comentários das linhas 2-4 e 102, textos da linha 18 e da aba Resumo da planilha)
- Test: `../auditoria-2026-11-03/e2e/t43-relatorios-data.js`

**Interfaces:**
- Produces: `saleRevenueDay(s) -> 'AAAA-MM-DD'`, agora `localDay(s.closedAt||s.openedAt)`.

- [ ] **Passo 1: Escrever o teste.** Criar venda aberta ontem às 23:50 e fechada hoje às 00:10, total 50, e comanda aberta ontem sem `closedAt`, total 20. Conferir:
  - `saleRevenueDay(venda) === todayStr()`.
  - `accountantSheets(hoje,hoje)` traz faturamento 50, e `accountantSheets(ontem,ontem)` traz 0.
  - `#sbVendidoHoje` inclui os 50.
  - Resumo do Dia de ontem mostra a comanda aberta em "a receber" e não mostra os 50 no faturamento.
- [ ] **Passo 2: Rodar.** Esperado: FALHA em `saleRevenueDay`.
- [ ] **Passo 3: Trocar `saleRevenueDay` e reescrever os textos** que dizem "dia em que a venda abriu" para "dia do pagamento (quando a venda fechou)". Trocar também "pelo dia de abertura" na aba Resumo.
- [ ] **Passo 4: Rodar o teste, `t39-formas-relatorios.js` e as checagens.** Esperado: `0 falha(s).`
- [ ] **Passo 5: `bump-version` e commit** `feat(relatórios): vendas contam pela data de pagamento`.

### Tarefa 2: Peças comuns e lista de devedores

**Files:**
- Create: `assets/js/gestao/relatorios-comum.js`
- Create: `assets/js/gestao/relatorio-conta-cliente.js`
- Modify: `index.html`, `assets/js/core/config.js:144` (item "Conta do Cliente" no grupo Financeiro), `assets/js/gestao/relatorios.js` (`renderRelatoriosInner`)
- Test: `../auditoria-2026-11-03/e2e/t44-conta-cliente.js`

**Interfaces:**
- Produces:
  - `saleCardHtml(sale, {showCustomer:boolean}) -> string`
  - `exportAoaXlsx(fileName:string, sheets:[[nome, linhas, larguras]]) -> Promise<void>`
  - `customerAccountRows({search, onlyDebtors, includeArchived, days}) -> {rows:[{m, debt, lastPurchase, lastPayment, oldest, overdue}], debtors, total, overdueCount}`
  - `renderCustomerAccountReport()` e `exportCustomerAccountReport()`

- [ ] **Passo 1: Escrever o teste.** Três clientes: A deve 100 há 10 dias e comprou ontem; B deve 50 há 2 dias; C arquivado deve 30. Conferir com `days:7`:
  - `debtors===2`, `total===150`, `overdueCount===1`.
  - Com `includeArchived:true`, `debtors===3`.
  - `lastPurchase` de A conta venda paga na hora, não só fiado.
  - Com `days:1`, `overdueCount===2`.
  - `saleCardHtml` mostra item por peso em kg, item cancelado com a classe `canceled` e `canceledBy`, desconto e serviço.
  - Venda sem `items` e sem `payments` não contém `undefined`.
  - Cliente chamado `<img src=x onerror=alert(1)>` não cria `img` na lista.
- [ ] **Passo 2: Rodar.** Esperado: FALHA, função não definida.
- [ ] **Passo 3: Implementar.** `oldest` vem de `fiadoOpenDebts`. Item usa `customizationLines` quando `customization.v===2`. `exportAoaXlsx` usa `loadXlsx`. Campo "Dias" começa em 7, sem gravar a escolha.
- [ ] **Passo 4: Rodar teste e checagens.** Esperado: `0 falha(s).`
- [ ] **Passo 5: `bump-version` e commit** `feat(relatórios): lista de devedores com última compra`.

### Tarefa 3: Conta aberta do cliente

**Files:**
- Modify: `assets/js/gestao/relatorio-conta-cliente.js`
- Test: `../auditoria-2026-11-03/e2e/t44-conta-cliente.js`

**Interfaces:**
- Consumes: `saleCardHtml`, `exportAoaXlsx`.
- Produces:
  - `customerTimeline(member, {from, to, fiado, paid, payments}) -> {entries:[{kind:'sale'|'payment'|'entry', at, sale?, e?, balance?}], bought, paidTotal, purchases}`
  - `customerTopProducts(member, from, to) -> [{name, qty, kg, value, last}]`
  - `openCustomerAccount(memberId)`

- [ ] **Passo 1: Acrescentar os testes.** Cliente com venda fiado 62 (lançamento `saleId` ligado), venda Pix 18, pagamento 100, pagamento estornado 40 e "Saldo inicial" 200 sem venda. Conferir:
  - A venda fiado aparece uma vez, não duas.
  - `bought===80`.
  - `paidTotal===118` (100 de fiado + 18 na hora, sem o estornado).
  - Saldo inicial vira `kind:'entry'`, sem itens.
  - Pagamento estornado aparece marcado e fora dos totais.
  - Com `paid:false`, a venda Pix some. Com `payments:false`, os pagamentos somem.
  - Venda parte fiado e parte Pix continua com `fiado:false` e com `paid:false`, e aparece uma vez.
  - `customerTopProducts` ignora item cancelado e ordena por quantidade.
  - Cliente só com saldo inicial abre sem "Invalid Date".
- [ ] **Passo 2: Rodar.** Esperado: FALHA.
- [ ] **Passo 3: Implementar.** Lançamentos com `saleId` são absorvidos pelo cartão da venda. Saldo depois do pagamento vem de `fiadoStatementData`. "Quem recebeu" é `e.user`. Abrir em tela cheia dentro de `#view-relatorios`, com Voltar para a lista.
- [ ] **Passo 4: Rodar teste e checagens.** Esperado: `0 falha(s).`
- [ ] **Passo 5: `bump-version` e commit** `feat(relatórios): conta completa do cliente`.

### Tarefa 4: Relatório de Vendas

**Files:**
- Create: `assets/js/gestao/relatorio-vendas.js`
- Modify: `index.html`, `assets/js/core/config.js:141` (item "Relatório de Vendas"), `assets/js/gestao/relatorios.js` (`renderRelatoriosInner`)
- Test: `../auditoria-2026-11-03/e2e/t45-relatorio-vendas.js`

**Interfaces:**
- Consumes: `saleCardHtml`, `exportAoaXlsx`.
- Produces: `salesReportData({from, to, method, type, product, customer, showCanceled}) -> {sales, total, count, ticket, items, kg, byMethod}`; `renderSalesDetailReport()`; `exportSalesDetailReport()`.

- [ ] **Passo 1: Escrever o teste.** Vendas: crédito 40, débito 20, dinheiro 30 + Pix 10 na mesma venda, e uma cancelada 99. Conferir:
  - Sem filtro: `total===100`, `byMethod.credito===40`, `byMethod.debito===20`.
  - `method:'pix'` encontra a venda mista, `total===40` e `byMethod.pix===10`.
  - Tela mostra Crédito e Débito em linhas separadas.
  - `showCanceled:true` traz a cancelada, sem somar no faturamento.
  - Filtros de produto, cliente e tipo reduzem a lista.
  - Planilha tem uma linha por item, com pedido, data, cliente, forma, quantidade e valor.
- [ ] **Passo 2: Rodar.** Esperado: FALHA.
- [ ] **Passo 3: Implementar.** Com filtro de forma, mostrar o aviso "O faturamento é o total das vendas encontradas. A tabela por forma soma só a parte paga em cada uma." Tela limitada a 3000 linhas; exportação completa, depois de `fetchFreshSales`.
- [ ] **Passo 4: Rodar teste e checagens.** Esperado: `0 falha(s).`
- [ ] **Passo 5: `bump-version` e commit** `feat(relatórios): vendas com forma de pagamento e itens`.

### Tarefa 5: Vendas dos Garçons

**Files:**
- Create: `assets/js/gestao/relatorio-garcons.js`
- Modify: `index.html`, `assets/js/core/config.js:141` (item "Vendas dos Garçons"), `assets/js/gestao/relatorios.js` (`renderRelatoriosInner`)
- Test: `../auditoria-2026-11-03/e2e/t46-relatorio-garcons.js`

**Interfaces:**
- Consumes: `exportAoaXlsx`.
- Produces: `waiterReportData({from, to, waiter}) -> {summary:[{name, sales, items, kg, value}], rows:[{at, sale, customer, item, qty, value}]}`; `renderWaiterReport()`; `exportWaiterReport()`.

- [ ] **Passo 1: Escrever o teste.** Comanda aberta por Ana, com 2 itens de João (24 e 38), 1 de Renata (7), 1 de João cancelado e 1 sem `addedBy` (conta para `operatorName`). Conferir:
  - João: `sales===1`, `items===3`, `value===62`.
  - Renata: `value===7`. Ana recebe só o item sem `addedBy`.
  - Item cancelado não conta.
  - Item por peso soma em `kg`, não em `items`.
  - `waiter:'João'` limita `rows`.
  - A tela mostra o aviso de que o valor não inclui desconto nem serviço.
  - Item chamado com HTML aparece como texto.
- [ ] **Passo 2: Rodar.** Esperado: FALHA.
- [ ] **Passo 3: Implementar.** Valor é `qty*price`. Data da linha é `addedAt` ou `openedAt`; o período filtra por `saleRevenueDay`.
- [ ] **Passo 4: Rodar teste e checagens.** Esperado: `0 falha(s).`
- [ ] **Passo 5: `bump-version` e commit** `feat(relatórios): vendas dos garçons por item`.

### Tarefa 6: Mais Vendidos pelo período

**Files:**
- Modify: `assets/js/gestao/relatorios.js:245-249`
- Test: `../auditoria-2026-11-03/e2e/t47-mais-vendidos.js`

**Interfaces:**
- Produces: `bestSellerData(sales, {from, to, category}) -> {products, combos, complements, inputs}`; `bestSellerFilter` (estado da tela, como `rankingFilter`).

- [ ] **Passo 1: Escrever o teste.** Produto X vendido 5 hoje e 10 no mês passado. Conferir:
  - Período de hoje: quantidade 5 e valor só de hoje.
  - Mês passado: quantidade 10.
  - Filtro de categoria reduz a lista.
  - Coluna "Quem mais compra" mostra o cliente cadastrado com maior quantidade; venda avulsa não entra.
  - Produto por peso em kg.
- [ ] **Passo 2: Rodar.** Esperado: FALHA em 5 ≠ 15.
- [ ] **Passo 3: Extrair o cálculo de `renderBestSellersReport`** para `bestSellerData`, filtrando as vendas antes de somar, por `saleRevenueDay`. "Pesquisar" e os botões de período gravam em `bestSellerFilter` e chamam `renderRelatorios`. Remover `filterBestSellerReport`. Trocar o rótulo "Período de abertura do pedido" por "Período de pagamento".
- [ ] **Passo 4: Rodar teste, `npm run telas` e checagens.** Esperado: sem falha nova.
- [ ] **Passo 5: `bump-version` e commit** `fix(relatórios): Mais Vendidos recalcula pelo período`.

### Tarefa 7: Cupons fiscais e pacote da contabilidade

**Files:**
- Create: `assets/js/gestao/relatorio-cupons.js`
- Modify: `index.html`, `assets/js/core/config.js:144` (item "Cupons Fiscais"), `assets/js/gestao/relatorios.js` (`renderRelatoriosInner`)
- Test: `../auditoria-2026-11-03/e2e/t48-cupons-fiscais.js`

**Interfaces:**
- Consumes: `printNfceDanfe(notaId)`, `fetchAllRows`, `loadXlsx`.
- Produces: `loadFiscalNotes()`; `renderFiscalNotesReport()`; `fiscalPackageFiles(notas, planilha) -> {files:[{path, content}], semXml:number}`; `exportFiscalPackage()`; `loadJsZip() -> Promise<JSZip>`.

JSZip: `https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js`, SRI `sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG`.

- [ ] **Passo 1: Escrever o teste.** Inserir em `nfce_notas` local: 2 autorizadas de produção, 1 autorizada sem XML, 1 cancelada, 1 rejeitada, 1 de homologação. Conferir:
  - A tela não lista a homologação.
  - Filtro de situação funciona.
  - A consulta da tela não pede a coluna `xml`.
  - `fiscalPackageFiles` gera `notas.xlsx`, `autorizadas/<chave>.xml` e `canceladas/<chave>.xml`.
  - Rejeitada não gera XML e aparece na planilha.
  - `semXml===1`, e o aviso diz isso.
  - Nome do zip: `commandah-nfce-AAAA-MM-DD-a-AAAA-MM-DD.zip`.
- [ ] **Passo 2: Rodar.** Esperado: FALHA.
- [ ] **Passo 3: Implementar.** Colunas da planilha conforme o desenho, seção 5. Período por `created_at` no dia local, como em `loadUserActivity`. Buscar XML só em `exportFiscalPackage`. Registrar com `logAction`. A coluna `xml_cancelamento` só existe a partir da Tarefa 9: não pedir essa coluna aqui. Se houver nota cancelada, incluir `canceladas/LEIA-ME.txt` dizendo que o XML do evento deve ser baixado no portal da Brasil NFe.
- [ ] **Passo 4: Rodar teste e checagens.** Esperado: `0 falha(s).`
- [ ] **Passo 5: `bump-version` e commit** `feat(relatórios): cupons fiscais e pacote para a contabilidade`.

### Tarefa 8: Publicar os relatórios

**Files:**
- Modify: `assets/js/sistema/novidades.js` (entrada no topo, id `2026-11-10-relatorios`, `perms:['relatorios-gerencia']`)

- [ ] **Passo 1: Conferir no Chrome** cada tela em 1366 px e 390 px e imprimir uma, na bancada local.
- [ ] **Passo 2: Rodar `npm run lint`, `npm run telas`, `npm run xss` e `t43` a `t48`.** Esperado: sem falha nova.
- [ ] **Passo 3: Escrever a novidade, `bump-version`, commit e PR.**
- [ ] **Passo 4: Merge.** Depois, conferir no site oficial que os relatórios abrem.

### Tarefa 9: XML do evento de cancelamento (depende do "sim" do dono)

**Files:**
- Create: `supabase/migrations/20261110120000_nfce_xml_cancelamento.sql`
- Modify: `supabase/functions/nfce/index.ts:140-141`, `assets/js/gestao/relatorio-cupons.js`
- Test: `../auditoria-2026-11-03/e2e/t48-cupons-fiscais.js`

**Interfaces:**
- Produces: coluna `nfce_notas.xml_cancelamento text`. `exportFiscalPackage` passa a pedir essa coluna, e `fiscalPackageFiles` gera `canceladas/<chave>-evento-cancelamento.xml` quando houver. O `LEIA-ME.txt` só sai se alguma cancelada ficar sem evento.

- [ ] **Passo 1: Escrever a migration** com bloco de rollback e testar no Postgres local. O `select` do cliente em `index.ts:100` deve continuar sem devolver esse XML.
- [ ] **Passo 2: Acrescentar o teste** no fake da `nfce`: resposta de cancelamento com o arquivo grava `xml_cancelamento`, e o pacote inclui o evento. Resposta sem o arquivo mantém o cancelamento funcionando.
- [ ] **Passo 3: Na função, depois do cancelamento aceito,** ler o XML da resposta. Se não vier, chamar `ConsultarNotaFiscal` com `RetornarArquivos: true`. Registrar no `console.log` só os nomes dos campos recebidos, nunca o conteúdo. Falha nessa leitura não pode desfazer o cancelamento.
- [ ] **Passo 4: Pedir o "sim" do dono,** fazer cópia em `app_data`, aplicar a migration e publicar a função.
- [ ] **Passo 5: Com o dono, emitir e cancelar uma nota em homologação** e ler os campos no log.
  - Se o XML vier: ajustar o nome do campo, se preciso, e conferir o arquivo gravado.
  - Se não vier: registrar no `HANDOFF` que o evento sai pelo portal da Brasil NFe, e manter o `LEIA-ME.txt`.
- [ ] **Passo 6: Rodar `t48` e as checagens, `bump-version`, novidade se o arquivo vier, commit, PR e merge.**
