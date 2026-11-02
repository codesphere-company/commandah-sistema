# Tamanhos e grupos de opções — plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produto com grade de tamanhos (preço cheio por tamanho) e grupos de opções (mínimo, máximo, inclusos, repetir), vendável no PDV, delivery, comandas e garçom, com ficha, KDS, estoque, relatórios e NFC-e corretos.

**Architecture:** As regras ficam num arquivo puro novo (`assets/js/core/opcoes.js`), testado em Node com `vm`. Telas de cadastro e a tela de escolha na venda chamam essas funções. Dados continuam em `app_data`: grades e grupos dentro de `state.complementos` (`recordKind` `grade` e `optionGroup`); regras por tamanho dentro do produto. Sem migration.

**Tech Stack:** HTML/CSS/JS clássico global (sem build, sem módulos), Supabase `app_data`, Node 20 só para testes e checagens.

**Spec:** `docs/superpowers/specs/2026-11-02-tamanhos-e-opcoes-design.md` (rascunhos aprovados em `docs/superpowers/specs/2026-11-02-tamanhos-e-opcoes-mockups/`).

## Global Constraints

- Scripts clássicos globais; nada de `type="module"`. Arquivo novo: tag no `index.html` com o mesmo `?v=`, no lugar certo da ordem; rodar `node scripts/check-app.js` e `node scripts/check-load-order.js`.
- Depois de mudar `assets/js` ou `assets/css`: `node scripts/bump-version.js`.
- Código, comentários, UI e commits em português. Escapar com `h()` e `jsArg()`. Ações que gravam venda passam por `singleFlight`.
- Nome do item vendido com tamanho: `PRODUTO - TAMANHO` (ex.: `TALHARIM BOLONHESA - FAMÍLIA`).
- Linha de grupo na ficha/KDS: `Nome do grupo: 2x Granola, 1x Paçoca`; extra cobrado com valor (`+ R$ 3,00`).
- Regra de preço: opção só cobra o que passa dos inclusos; os inclusos cobrem as unidades **mais caras**.
- Chaves de canal: `pdv`, `mobile`, `qr`, `online` (iguais às do produto hoje).
- `kind:'tamanho'` sem `gradeId` = produto normal (preço único).
- Cardápio digital e totem: produto com `gradeId` ou com grupo de `min ≥ 1` não aparece (regra no código, não nas flags).
- Combo não aceita produto com `gradeId` nem com grupo de `min ≥ 1`.
- Venda antiga (formato atual de `customization`: `size`, `answers`, `complements`) continua aparecendo em ficha, KDS, relatório e reimpressão.
- Branch de trabalho a partir da `main` atualizada; PR com prévia do Netlify. **Merge na `main` só com o "sim" do dono** (publica na hora). Nenhuma escrita no banco de produção neste plano.

## Formato dos dados (decidido aqui; todas as tarefas usam)

```js
// state.complementos — registros novos (os antigos 'type'/'size'/'complement' ficam no banco, ignorados pelas telas novas)
{ id, recordKind:'grade', nome, active, sizes:[{ id, nome, sigla }] }            // ordem = ordem do array
{ id, recordKind:'optionGroup', nome, active, options:[{ id, nome, preco, active, recipe:[{insumoId,qty}] }] }

// produto
product.gradeId            // string | null
product.sizes              // { [sizeId]: { price, cost, active, channels:{pdv,mobile,qr,online}, recipe:[{insumoId,qty}], groups:[GroupRule] } }
product.groups             // [GroupRule] — só para produto sem grade
// GroupRule = { groupId, min, max, included, repeat }   (números inteiros ≥ 0; repeat booleano)

// item vendido (customization formato 2)
item.customization = { v:2, sizeId, size:{id,name,sigla,price}|null,
  groups:[{ groupId, name, choices:[{optionId,name,qty,price}], charged }],
  observationIds, observations, notes, extra, summary }
item.name = 'PRODUTO - TAMANHO' | 'PRODUTO'; item.basePrice = preço do tamanho (ou product.price); item.price = basePrice + extra
```

## Review Focus

1. **Grade editada depois de usada** (tamanho removido da grade, opção pausada/apagada, grupo apagado): a escolha mostra só o que existe e está ativo; regra de grupo apagado é ignorada; venda antiga não muda. Teste em Task 1 (`buildCustomization` com tamanho/opção inexistente ou pausada).
2. **Repetir pedido** de item com tamanho e opções (comandas, "repetir pedido" e reordenar item): repete as mesmas escolhas com o preço atual; se tamanho ou opção sumiu, o item é pulado com aviso. Teste em Task 1 (`rebuildCustomization`).
3. **Mesmo produto com escolhas diferentes no carrinho** do garçom/comanda: viram linhas separadas; iguais se somam. Teste em Task 1 (`customizationSignature`).
4. **Estoque com quantidade**: item qty 3 com 2x granola baixa 6 porções de granola + a ficha do tamanho × 3. Teste em Task 1 (`itemRecipe`).
5. **Produto antigo `kind:'tamanho'` sem grade** e vendas antigas: continuam vendáveis/legíveis. Teste em Task 1 (`productNeedsChoice` e `customizationLines` com formato antigo).

---

### Task 1: Núcleo das regras (`opcoes.js`) com testes

**Files:**
- Create: `assets/js/core/opcoes.js` (tag no `index.html` logo depois de `core/calculos.js`)
- Create: `scripts/test-opcoes.js`
- Modify: `.github/workflows/check-index-syntax.yml` (novo passo `node scripts/test-opcoes.js` depois do check-app; **não** renomear job)

**Interfaces — Produces (globais, todas puras: recebem tudo por parâmetro, não leem `state`):**
- `gradeOf(product, complementos) -> grade|null` — só se `product.gradeId` aponta grade ativa.
- `productNeedsChoice(product, complementos) -> boolean` — tem grade válida, ou algum `GroupRule` com grupo existente.
- `sizesForChannel(product, grade, channel) -> [{ sizeId, name, sigla, price }]` — tamanhos da grade, na ordem da grade, com `product.sizes[id].active !== false` e `channels[channel] !== false` e preço numérico.
- `rulesFor(product, sizeId) -> GroupRule[]` — `product.sizes[sizeId].groups` ou `product.groups`.
- `chargedForGroup(choices, included) -> number` — `choices: [{price, qty}]`.
- `validateGroup(rule, groupName, choices) -> string` — `''` se ok; senão mensagem.
- `buildCustomization({ product, complementos, sizeId, picks, notes, observations }) -> { customization, name, basePrice, price } | { error }` — `picks: { [groupId]: { [optionId]: qty } }`.
- `customizationSignature(customization) -> string`
- `customizationLines(item) -> string[]` — formato 2 e formato antigo.
- `itemRecipe(product, item) -> [{ insumoId, qty }]` — por **1 unidade** do item.
- `rebuildCustomization({ product, complementos, oldCustomization }) -> resultado de buildCustomization | null`
- `hiddenInSelfService(product, complementos) -> boolean`
- `blockedInCombo(product, complementos) -> boolean`

- [ ] **Step 1: Escrever `scripts/test-opcoes.js`** — carrega `assets/js/core/opcoes.js` com `vm.runInNewContext` num contexto vazio, usa `assert` do Node, imprime `ok N testes` e sai com código 1 na primeira falha. Fixture: grade `gAcai` (`s300` "300ml" P, `s500` "500ml" G), grupo `gAc` "Acompanhamentos" com opções `gran` Granola 0, `pac` Paçoca 0, `kk` Kit Kat 3 (pausada `active:false` só no teste 1.6), produto `acai` com `gradeId:'gAcai'`, `sizes.s300={price:18, groups:[{groupId:'gAc',min:0,max:2,included:2,repeat:true}]}`, `sizes.s500={price:28, groups:[{groupId:'gAc',min:0,max:3,included:3,repeat:true}]}`. Casos:

```js
// 1.1 inclusos cobrem os mais caros
assert.strictEqual(chargedForGroup([{price:3,qty:1},{price:4,qty:1},{price:2,qty:1}], 2), 2);
assert.strictEqual(chargedForGroup([{price:3,qty:3}], 2), 3);
assert.strictEqual(chargedForGroup([{price:4,qty:2}], 0), 8);
// 1.2 açaí 300ml com 2x granola = R$ 18, nome com tamanho
const r = buildCustomization({product:acai, complementos, sizeId:'s300', picks:{gAc:{gran:2}}, notes:'', observations:[]});
assert.strictEqual(r.name, 'AÇAÍ NO COPO - 300ml'); assert.strictEqual(r.price, 18); assert.strictEqual(r.customization.v, 2);
// 1.3 passar do máximo
assert.match(buildCustomization({product:acai, complementos, sizeId:'s300', picks:{gAc:{gran:2,pac:1}}}).error, /no máximo 2/);
// 1.4 repetir desligado
//   mesma fixture com repeat:false -> picks {gran:2} -> error /uma vez/
// 1.5 mínimo
//   regra min:1 max:1 (molho) sem escolha -> error /Escolha .*Molho/
// 1.6 tamanho inexistente ou opção pausada -> error; sem tamanho quando há grade -> error /tamanho/
// 1.7 sinais: mesmas escolhas em outra ordem -> mesma assinatura; escolhas diferentes -> assinaturas diferentes
// 1.8 itemRecipe: sizes.s300.recipe=[{insumoId:'acai',qty:0.3}], gran.recipe=[{insumoId:'granola',qty:0.05}], picks {gran:2}
//   -> [{insumoId:'acai',qty:0.3},{insumoId:'granola',qty:0.1}]  (por unidade; quem chama multiplica pela qty)
// 1.9 customizationLines formato 2 -> ['Acompanhamentos: 2x Granola']; com Kit Kat cobrado -> 'Acompanhamentos: 1x Kit Kat (+ R$ 3,00)'
// 1.10 customizationLines formato antigo {size:{name:'G'}, answers:[{question:'Ponto',values:[{text:'Mal'}]}], complements:[{name:'Bacon'}]}
//   -> ['G','Ponto: Mal','Bacon']  (mesmo resultado do kitchenItemExtras atual)
// 1.11 productNeedsChoice({kind:'tamanho'}) === false; hiddenInSelfService(acai) === true; blockedInCombo(acai) === true
// 1.12 rebuildCustomization: escolhas antigas válidas -> mesmo preço atual; opção apagada do grupo -> null
```

- [ ] **Step 2: Rodar e ver falhar** — `node scripts/test-opcoes.js` → erro "Cannot find module"/`ENOENT` ou `chargedForGroup is not defined`.
- [ ] **Step 3: Implementar `assets/js/core/opcoes.js`** com as funções do bloco Interfaces. Cabeçalho `/* ============ TAMANHOS E OPÇÕES ============ */` explicando que só calcula. Formatar dinheiro sem depender de `fmt`: `'R$ ' + n.toFixed(2).replace('.', ',')`. Mensagens: `'Escolha no máximo N em NOME.'`, `'Escolha ao menos N em NOME.'`, `'Cada opção de NOME só pode ser escolhida uma vez.'`, `'Escolha o tamanho.'`, `'Opção indisponível: NOME.'`. `summary` = linhas de `customizationLines` + `'Obs.: '+notes` unidas por `' · '`.
- [ ] **Step 4: Rodar** — `node scripts/test-opcoes.js` → `ok 12 testes`; `node scripts/check-app.js` e `node scripts/check-load-order.js` → sem erro.
- [ ] **Step 5: Commit** — `git add assets/js/core/opcoes.js scripts/test-opcoes.js index.html .github/workflows/check-index-syntax.yml && git commit -m "feat(opcoes): regras de tamanho e grupos de opções, com testes"`

---

### Task 2: Cadastros → Grades de tamanho e Grupos de opções

**Files:**
- Create: `assets/js/cadastros/grades-opcoes.js` (tag depois de `cadastros/fiscal-produto.js`)
- Modify: `assets/js/core/config.js:121` (menu: trocar "Tipos e Tamanhos", "Complementos" e "Perguntas" por "Grades de tamanho" → `openGradesView`, "Grupos de opções" → `openOptionGroupsView`; mesma `perm:'complementos'`)
- Modify: `assets/js/core/crud.js:17-18` (`openComplementsView`/`openTypesSizesView` passam a abrir as telas novas, para atalhos antigos não quebrarem)

**Interfaces — Produces:**
- `openGradesView()`, `renderGrades(el)`, `openGradeModal(id?)` — lista (Grade, Tamanhos, Produtos usando) e modal com nome, ativo e linhas de tamanho (nome, sigla, subir/descer, remover). Salva em `state.complementos` com `recordKind:'grade'`, `save('complementos')`.
- `openOptionGroupsView()`, `renderOptionGroups(el)`, `openOptionGroupModal(id?, onSaved?)` — modal com nome, ativo e linhas de opção (nome, preço, ativo, botão ficha técnica reaproveitando o padrão de `renderComplementRecipe`). `onSaved(group)` é usado pela Task 3 para criar grupo de dentro do produto.
- `productsUsingGrade(gradeId) -> product[]`, `productsUsingGroup(groupId) -> product[]` (leem `state`).

Regras de tela: não deixa excluir grade ou grupo em uso (toast com quantos produtos); remover um tamanho de grade em uso pede confirmação (`askConfirm`) dizendo que os produtos perdem aquele tamanho. As telas antigas não aparecem mais no menu; os registros antigos ficam no banco, ignorados.

- [ ] **Step 1: Implementar** as funções acima seguindo o visual de `renderCategories` (janela `op-window`, busca, Novo/Editar) e o rascunho `grade-tamanhos.html` (esquerda).
- [ ] **Step 2: Checar** — `node scripts/check-app.js`, `node scripts/check-load-order.js`, `node scripts/test-opcoes.js` sem erro.
- [ ] **Step 3: Conferir no Chrome** (`npx serve .`, login local ou prévia): criar grade "Individual / Família" (I, F), grade "Açaí" (300ml P, 500ml G), grupo "Acompanhamentos açaí" com Confete, Granola, Paçoca a R$ 0 e Kit Kat a R$ 3. Esperado: aparecem nas listas; reabrir mostra o salvo; excluir grade em uso é bloqueado (testar depois da Task 3).
- [ ] **Step 4: Commit** — `git commit -m "feat(cadastros): grades de tamanho e grupos de opções"`

---

### Task 3: Produto — grade, aba Tamanhos e aba Opções

**Files:**
- Create: `assets/js/cadastros/produto-tamanhos.js` (tag depois de `cadastros/grades-opcoes.js`)
- Modify: `assets/js/cadastros/fiscal-produto.js:120-190` (abas: remover "Perguntas", "Complementos", "Tamanhos" antigas; incluir "Tamanhos" nova quando há grade e "Opções" quando não há; campo **Grade de tamanhos** na aba Principal com os cartões "Configurar →"; no salvar, gravar `gradeId`, `sizes`, `groups` e `kind:'tamanho'` quando há grade; manter `questionIds`/`complementIds`/`sizeIds` como estão no produto, sem apagar)
- Modify: aba "Composição do combo" em `fiscal-produto.js:155` — esconder produtos com `blockedInCombo(p, state.complementos)`

**Interfaces:**
- Consumes: `gradeOf`, `rulesFor`, `blockedInCombo` (Task 1); `openOptionGroupModal(id, onSaved)` (Task 2).
- Produces: `productSizesDraft` (rascunho em memória do modal, igual a `tempRecipe`), `renderProductSizesPane(product)`, `renderProductOptionsPane(product)`, `selectProductSize(sizeId)`, `addGroupRule(target)`, `copyGroupRules(fromSizeId, toSizeIds, toProductIds)`, `readProductSizesDraft() -> { gradeId, sizes, groups } | { error }`.

Tela (rascunho `tamanhos-grupos.html`, esquerda): cartões dos tamanhos (sigla, nome, preço, liga/desliga); painel do tamanho com preço de venda, custo, 4 canais, ficha técnica do tamanho e lista de regras de grupo (grupo, Mínimo, Máximo, Inclusos no preço, Pode repetir, remover). Botões "+ Grupo de opções" (cria via `openOptionGroupModal`), "Usar grupo já cadastrado" (select), "Copiar para…" (outros tamanhos deste produto e/ou o mesmo tamanho de outros produtos da mesma grade). Validação ao salvar: tamanho ativo sem preço → erro "Informe o preço de NOME."; `max < min`, `included > max` → erro na regra.

- [ ] **Step 1: Implementar** `produto-tamanhos.js` e as mudanças em `fiscal-produto.js`.
- [ ] **Step 2: Checar** — os três comandos de checagem sem erro.
- [ ] **Step 3: Conferir no Chrome**: cadastrar AÇAÍ NO COPO (grade Açaí, 300ml R$ 18 com Acompanhamentos 0/2/2/repetir; "Copiar para" 500ml e mudar para R$ 28, 0/3/3) e TALHARIM BOLONHESA (grade Individual/Família, R$ 25 e R$ 80, sem grupos). Esperado: reabrir mostra tudo igual; produto sem grade mostra aba Opções; combo não lista o açaí; salvar 300ml sem preço dá o erro.
- [ ] **Step 4: Commit** — `git commit -m "feat(produtos): grade de tamanhos, preço por tamanho e regras de opções"`

---

### Task 4: Tela de escolha na venda + PDV e delivery

**Files:**
- Create: `assets/js/vendas/escolha-item.js` (tag logo antes de `vendas/venda.js`)
- Modify: `assets/js/vendas/venda.js:18-41` (`addDraftItem` usa `productNeedsChoice`; `commitDraftItem` aceita o resultado de `buildCustomization` e grava `name`, `basePrice`, `price`, `customization`, `customizationSignature` via `customizationSignature`); remover `openProductCustomization`/`saveProductCustomization`/`updateCustomizationPrice` antigos (venda.js:43-80) depois que a nova tela cobrir observações rápidas
- Modify: `venda.js:14` e `venda.js:212` (botão do produto mostra "a partir de R$ X" quando tem grade: menor preço de `sizesForChannel`)

**Interfaces:**
- Consumes: `gradeOf`, `sizesForChannel`, `rulesFor`, `buildCustomization`, `customizationSignature` (Task 1).
- Produces: `openItemChoice(productId, channel, onDone)` — abre modal; `onDone({ name, basePrice, price, customization })`. `channel` é `'pdv'`, `'mobile'` ou `'online'` (delivery). Usada também pela Task 5.

Tela (rascunho `tamanhos-grupos.html`, direita): botões de tamanho com preço; por grupo, título + contador "N de MAX" + linhas com − / quantidade / +; "+" desabilita no máximo (ou em 1 sem repetir); observações rápidas do produto e campo de observação livre; total ao vivo com `buildCustomization`; "Adicionar" mostra `error` em toast e não fecha. Produto com grade de um tamanho só e sem grupos: `onDone` direto, sem abrir.

- [ ] **Step 1: Implementar** `openItemChoice` e as mudanças em `venda.js`.
- [ ] **Step 2: Checar** — os três comandos sem erro.
- [ ] **Step 3: Conferir no Chrome (PDV balcão e delivery)**: açaí 300ml + 2x granola → item `AÇAÍ NO COPO - 300ml` R$ 18 com linha "Acompanhamentos: 2x Granola"; terceiro "+" travado; açaí só (sem acompanhamento) passa; dois açaís iguais somam qty 2, um diferente vira outra linha; talharim família → R$ 80.
- [ ] **Step 4: Commit** — `git commit -m "feat(venda): escolha de tamanho e opções no PDV e delivery"`

---

### Task 5: Comandas no caixa e app do garçom

**Files:**
- Modify: `assets/js/vendas/comandas.js:285-290` (`npCartAdd`), `:865-875` (`quickCartAdd`), `:975-990` (repetir pedido), `:625-635` (reordenar item)
- Modify: `assets/js/operacao/garcom.js:258-264` (`gcAddToCart`) e a lista do carrinho `:445`
- Modify: `assets/css/` do garçom só se a tela de escolha precisar de ajuste no celular (arquivo de componentes onde está `.record-modal`)

**Interfaces:**
- Consumes: `productNeedsChoice`, `openItemChoice(productId, channel, onDone)` (Tasks 1 e 4), `rebuildCustomization`, `customizationSignature`.
- Produces: nada novo; os carrinhos passam a guardar `{ productId, name, price, basePrice, customization, customizationSignature, qty, estacao, copos }`.

Regras: produto que precisa de escolha abre `openItemChoice` com canal `'mobile'` (garçom e comandas); soma só com linha de mesma `customizationSignature`; o badge de quantidade no botão do produto soma todas as linhas do produto. Repetir pedido e reordenar: `rebuildCustomization`; `null` → pula o item e avisa "N item(ns) mudaram no cadastro e foram ignorados".

- [ ] **Step 1: Implementar** nos quatro pontos de `comandas.js` e em `garcom.js`.
- [ ] **Step 2: Checar** — os três comandos sem erro.
- [ ] **Step 3: Conferir no Chrome** (garçom com a janela em 390 px de largura e comanda no caixa): lançar açaí 500ml 3 acompanhamentos e talharim individual; carrinho mostra nome com tamanho e linhas de opção; enviar; repetir o pedido traz as mesmas escolhas; repetir depois de pausar a Paçoca pula o item com aviso.
- [ ] **Step 4: Commit** — `git commit -m "feat(comandas,garcom): tamanho e opções nas comandas e no app do garçom"`

---

### Task 6: Ficha, KDS, estoque, relatórios, NFC-e, cardápio e totem

**Files:**
- Modify: `assets/js/operacao/cozinha.js:2-12` (`requiredInsumosForItems`: usar `itemRecipe(product, it)` × `it.qty`, mantendo o caminho antigo de `complementIds` para itens antigos — `itemRecipe` já cobre os dois)
- Modify: `assets/js/operacao/cozinha.js:291-298` (`kitchenItemExtras` passa a retornar `customizationLines(i)`)
- Modify: `assets/js/cadastros/produtos.js:12` (`productAvailable`: produto com grade conta como disponível se algum tamanho tem estoque — usar `itemRecipe` com cada tamanho)
- Modify: `assets/js/gestao/relatorios.js:230` (`renderBestSellersReport`: agrupar por `item.name` — que já carrega o tamanho — e contar opções do formato 2 com `qty`) e `:306` (`openSoldItemDetail`: usar `customizationLines`)
- Modify: `assets/js/operacao/cardapio.js:61` e `assets/js/operacao/totem.js:24` (filtrar `!hiddenInSelfService(p, state.complementos)`)
- Verificar: `assets/js/fiscal/*` usa `item.name` e `item.price` na NFC-e (sem mudança esperada; se usar `product.name`, trocar por `item.name`)

**Interfaces:**
- Consumes: `itemRecipe`, `customizationLines`, `hiddenInSelfService` (Task 1).

- [ ] **Step 1: Implementar** as trocas acima.
- [ ] **Step 2: Checar** — os três comandos sem erro.
- [ ] **Step 3: Conferir no Chrome**: ficha de teste da impressão (`ficha.js`, exemplo X-Bacon continua igual); ficha/KDS do açaí mostra "Acompanhamentos: 2x Granola"; com insumo "granola" a 0,1 de estoque, açaí com 2x granola (0,05 cada) passa e com 3x é barrado; relatório de mais vendidos mostra `AÇAÍ NO COPO - 300ml` e `TALHARIM BOLONHESA - FAMÍLIA` separados; açaí e talharim não aparecem no cardápio digital nem no totem; venda antiga com complemento continua com as linhas na reimpressão.
- [ ] **Step 4: Commit** — `git commit -m "feat: tamanho e opções na ficha, KDS, estoque, relatórios e autoatendimento"`

---

### Task 7: Versão, prévia e PR

- [ ] **Step 1:** `node scripts/bump-version.js`; rodar `node scripts/check-app.js`, `node scripts/check-load-order.js`, `node scripts/test-opcoes.js` → todos sem erro.
- [ ] **Step 2:** Atualizar `docs/HANDOFF.md` (seção do catálogo: grades e grupos de opções; telas antigas saíram do menu; registros antigos ignorados) e `graphify update .`.
- [ ] **Step 3:** Commit, push do branch e PR para `main` com o roteiro de conferência das Tasks 3–6 no corpo. Rodar o roteiro na prévia do Netlify (usa o banco de produção: **cadastrar só em produto de teste e apagar depois, ou no estabelecimento demo `clube-demo-mdqz`**).
- [ ] **Step 4:** Parar e pedir o "sim" do dono para o merge. Depois do merge, a tarefa de dados (recadastrar os 31 produtos do Consumer com os preços do dono) é um pedido separado.
