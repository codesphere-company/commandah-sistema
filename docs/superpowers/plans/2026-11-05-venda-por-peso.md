# Venda por peso — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIO: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans, tarefa por tarefa. Passos com checkbox (`- [ ]`).

**Objetivo:** vender as carnes por kg digitando o peso de cada peça na Ficha e na comanda, com o preço do quilo travado (troca só com PIN de admin), baixa de estoque em kg, NFC-e em KG e relatórios em kg.

**Arquitetura:** núcleo puro em `assets/js/core/peso.js` (testável no Node, como `opcoes.js`); janela própria `assets/js/vendas/escolha-peso.js` na mesma camada da escolha de tamanho; cada peça vira uma linha `qty:1`, `price` = valor da peça, `weight:{kg,pricePerKg,override?}`; quem precisa do peso lê `weight`. Troca de preço por admin não logado passa pela ação nova `price_override` da Edge Function `staff-auth`.

**Stack:** JS clássico sem build (escopo global, `onclick` chamando funções globais), Supabase (RPCs + Edge Function Deno), bancada de testes em `C:/Users/fabri/Documents/commandah/auditoria-2026-11-03` (Postgres 18 local + Chrome sem janela; `REPO=<cópia do site>`).

**Spec:** `docs/superpowers/specs/2026-11-05-venda-por-peso-design.md`

## Restrições globais

- Produto por peso: `String(p.measure).toLowerCase() === 'kg'`. Sem campo novo.
- Peso: 3 casas; recusa `<= 0` e `> 10` kg.
- Valor da peça: `arredondaCentavos(kg * pricePerKg)` (`core/config.js:5`), igual ao `cents(unit*qtd)` da NFC-e.
- Textos de UI em português; código no padrão existente (camelCase, comentários citando "venda por peso, 05/11").
- Escape com `h()` / `jsArg()`; ações que gravam passam por `singleFlight` como já fazem.
- Arquivo JS novo: tag em `index.html` na ordem certa com o mesmo `?v=`; depois de qualquer mudança em `assets/`: `node scripts/bump-version.js`, `node scripts/check-app.js`, `NODE_PATH=../auditoria-2026-11-03/node_modules node scripts/check-load-order.js`.
- Ordem de publicação: deploy da `staff-auth` (com "sim" do dono) **antes** do merge do site. Cadastro de insumos/fichas das 6 carnes (com "sim" e cópia de segurança) **depois** do merge.
- Fora: cardápio digital, totem, delivery, combos, app do garçom.

## Pontos de atenção da revisão

1. **Digitação ambígua** ("1.500", "1,5", "2", "480", "0,48 kg", vazio): `"."` e `","` são separador decimal; inteiro `>= 10` sem separador = gramas; inteiro `< 10` = kg; sufixo "kg"/"g" respeitado. Teste em Task 1.
2. **"Repetir" item de peso na comanda** (`openReorderComandaItem`): não pode repetir o mesmo peso; avisa "Carne por peso: lance a peça nova pelo peso." Teste em Task 5.
3. **Cancelar peça já enviada** devolve ao estoque o kg dela (`restoreInsumosForItems` usa a mesma conta). Teste em Task 2.
4. **PIN errado ou admin bloqueado** na troca de preço: mensagem na janela, preço continua o do cadastro, peças digitadas não se perdem. Teste em Task 4.
5. **Fechar a janela (Esc/Voltar) com peças digitadas**: nada entra no pedido. Teste em Task 4.

---

### Task 1: Núcleo do peso (`core/peso.js`)

**Arquivos:**
- Criar: `assets/js/core/peso.js`
- Modificar: `index.html` (tag logo depois de `core/calculos.js`), `.github/workflows/check-index-syntax.yml` (passo `node scripts/test-peso.js` ao lado do `test-opcoes`)
- Teste: criar `scripts/test-peso.js` (mesmo molde do `scripts/test-opcoes.js`: `vm.runInNewContext` com `arredondaCentavos` injetado no contexto)

**Interfaces (produz):**
- `isWeighedProduct(p) -> boolean`
- `parsePesoKg(texto) -> { kg:number } | { error:string }`
- `pesoValor(kg, pricePerKg) -> number` (centavos arredondados)
- `fmtKg(kg) -> string` ("0,480 kg")
- `weighedLine(product, kg, pricePerKg, override) -> { productId, name, price, qty:1, weight:{kg,pricePerKg,override?}, notes, estacao:'nenhuma', customizationSignature }` — `notes` = `"0,480 kg × R$ 119,90"`; `customizationSignature` = `'peso:'+<id único>` (nunca soma com outra linha)
- `itemStockQty(it) -> number` (`it.weight ? it.weight.kg : Number(it.qty)||0`)
- `itemQtyLabel(it) -> string` (`"0,480 kg"` ou `"2x"`)

- [ ] **Passo 1: testes que falham** em `scripts/test-peso.js`:
  - `parsePesoKg('0,480').kg === 0.48`; `'0.480'` → 0.48; `'480'` → 0.48; `'1.500'` → 1.5; `'1,5'` → 1.5; `'2'` → 2; `'480 g'` → 0.48; `'0,48 kg'` → 0.48
  - `parsePesoKg('')`, `'0'`, `'abc'`, `'10,001'`, `'-1'` → `error` (texto em português)
  - `pesoValor(0.48, 119.9) === 57.55`; `pesoValor(0.515, 119.9) === 61.75`; `pesoValor(0.333, 74.9) === 24.94`
  - `fmtKg(0.48) === '0,480 kg'`
  - `isWeighedProduct({measure:'KG'}) === true`; `{measure:'un'}` e `{}` → false
  - `weighedLine({id:'p',name:'PICANHA GRILL KG'}, 0.48, 119.9)` → `qty 1`, `price 57.55`, `weight.kg 0.48`, `notes === '0,480 kg × R$ 119,90'` (formatação própria, sem depender de `fmt`); duas chamadas → `customizationSignature` diferentes
  - `itemStockQty({qty:1,weight:{kg:0.48}}) === 0.48`; `itemStockQty({qty:3}) === 3`
- [ ] **Passo 2:** `node scripts/test-peso.js` → falha (arquivo não existe).
- [ ] **Passo 3:** implementar `assets/js/core/peso.js`; tag no `index.html`; passo no workflow.
- [ ] **Passo 4:** `node scripts/test-peso.js` → `ok`; `node scripts/test-opcoes.js` → `ok 16 testes`; checagens do app.
- [ ] **Passo 5:** commit `feat(peso): núcleo da venda por peso`.

### Task 2: Estoque e canais

**Arquivos:**
- Modificar: `assets/js/operacao/cozinha.js:19` (`requiredInsumosForItems` multiplica por `itemStockQty(it)`), `assets/js/cadastros/produtos.js:12` (`productAvailable`: produto por peso devolve `weighedAvailableKg(p)`), `assets/js/core/opcoes.js:58` (`opcoesHasRequiredChoice` devolve true para `measure` kg — some do cardápio/totem e bloqueia combo; checagem inline, sem depender de `peso.js`, para o `test-opcoes` continuar rodando sozinho), `assets/js/operacao/garcom.js:191,225,247` (filtros sem produto por peso)
- Teste: `scripts/test-opcoes.js` (caso novo), e2e na Task 6

**Interfaces (produz):** `weighedAvailableKg(p) -> number` em `cadastros/produtos.js` — `Infinity` sem ficha técnica; senão `min(insumo.stock / r.qty)` sem `Math.floor`.

- [ ] **Passo 1:** em `test-opcoes.js`: `hiddenInSelfService({measure:'kg'}, [])` e `blockedInCombo({measure:'kg'}, [])` → true. Rodar → falha.
- [ ] **Passo 2:** implementar as quatro mudanças.
- [ ] **Passo 3:** `node scripts/test-opcoes.js` → ok; checagens do app.
- [ ] **Passo 4:** commit `feat(peso): estoque em kg e canais`.

### Task 3: `staff-auth` — ação `price_override`

**Arquivos:**
- Modificar: `supabase/functions/staff-auth/index.ts` (junto do bloco `verify`/`release_debt`, ~linha 218)
- Teste: `auditoria-2026-11-03/e2e/t7-staff-auth.js` (casos novos; a bancada roda a função real do `REPO`)

**Interfaces (produz):** `POST staff-auth { action:'price_override', staff_id, pin, product_id, original, price, operator_name }` → `{ ok:true, name }`; 401 PIN incorreto (conta tentativa, mesma trava); 403 `"Só administrador altera o preço."` se não admin; 400 se `price` não for número > 0. Grava `audit_log` `{ entity:'product', entity_id: product_id, actor_name: <admin>, action: 'Preço do quilo alterado na venda: <produto> R$ X → R$ Y (caixa: <operator_name>)', meta:{ original, price, operator_name } }`.

- [ ] **Passo 1:** testes em `t7`: admin com PIN certo → ok e uma linha nova no `audit_log`; caixa com PIN certo → 403; admin PIN errado → 401; `price` 0 → 400.
- [ ] **Passo 2:** `node e2e/t7-staff-auth.js` (com `REPO` apontando para a cópia) → falham os novos.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `t7` → todos passam (eram 14).
- [ ] **Passo 5:** commit `feat(staff-auth): price_override para o preço do quilo`. **Deploy só com o "sim" do dono**, antes do merge do site.

### Task 4: Janela de peso (`vendas/escolha-peso.js`)

**Arquivos:**
- Criar: `assets/js/vendas/escolha-peso.js` (tag logo depois de `vendas/escolha-item.js`)
- Modificar: `assets/css/ajustes.css` (estilos `.ws-*`, no padrão `.ic-*` da escolha de tamanho)
- Teste: `auditoria-2026-11-03/e2e/t13-venda-peso.js` (criado aqui, completado na Task 5)

**Interfaces:**
- Consome: Task 1 (`parsePesoKg`, `pesoValor`, `fmtKg`, `weighedLine`), Task 2 (`weighedAvailableKg`), Task 3 (`price_override`), `staffAuthCall` (`core/config.js`), `logAction` (`gestao/logs.js`).
- Produz: `openWeightChoice(productId, onDone)` — `onDone(lines)` com o array de `weighedLine`; `closeWeightChoice()`.

Comportamento (decidido no spec e no rascunho B): camada própria `#weightChoiceRoot` por cima do modal (não usar `openModal`: a comanda é modal). Cabeçalho com o nome; "Preço do quilo" travado com botão "Alterar (PIN do admin)"; admin logado edita direto. Lista de peças: um campo por peça, Enter valida e abre a próxima, ✕ tira; erro de digitação aparece na linha. Rodapé: "N peças · X kg" e total; botão "Adicionar N peças". Estoque: se a soma passar de `weighedAvailableKg`, aviso vermelho "Estoque de <produto>: <fmtKg> . Lance a entrada do fornecedor em Insumos." e botão bloqueado. PIN do admin: painel dentro da própria janela (escolher admin + PIN); nuvem → `staffAuthCall({action:'price_override',...})`; local → confere `admin.pin` e `logAction`. Admin logado alterando: `logAction` ao confirmar. `override = { original, by, operator, at }`. Esc/Voltar fecha sem adicionar.

- [ ] **Passo 1:** em `t13` (1366 px e 390 px, perfis caixa e admin): abrir `openWeightChoice('<carne>')` direto; digitar `480` Enter `0,515` → 2 peças, total `R$ 119,30`; ✕ na segunda → 1 peça; `abc` → erro na linha e botão bloqueado; preço travado para o caixa; caixa → PIN de admin errado → mensagem, preço igual; PIN certo → preço novo e `override.by` = admin; estoque 0,3 kg + peça 0,48 → aviso e bloqueio; Esc com peças → `onDone` não chamado.
- [ ] **Passo 2:** rodar → falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `t13` (parte da janela) passa; checagens do app.
- [ ] **Passo 5:** commit `feat(peso): janela de digitar o peso`.

### Task 5: Peças no pedido (Ficha e comanda)

**Arquivos:**
- Modificar: `assets/js/vendas/venda.js` (`addDraftItem` ~23: produto por peso → `openWeightChoice` e `commitWeighedLines`; delivery → toast "Venda por peso só no caixa."; `changeDraftQty` ~61: linha com `weight` não aumenta, −1 tira; `renderDraftItems` ~98: mostra `fmtKg` no lugar da quantidade e só o botão de tirar)
- Modificar: `assets/js/vendas/comandas.js` (`cartAddProduct` ~328: peso → `openWeightChoice` e um `cart.push` por peça, com `canFulfillItems`; `npCartChangeQty`, `quickCartChangeQty` e as linhas em `renderNpCart` ~388, linha da comanda ~577 e carrinho rápido ~962: mesma regra; `openReorderComandaItem`: linha com `weight` → toast "Carne por peso: lance a peça nova pelo peso.")
- Teste: completar `t13`

**Interfaces:** produz `commitWeighedLines(lines) -> boolean` em `venda.js` (acrescenta cada linha com `lineId`, `sent:false`, `addedAt`, `addedById/addedBy`, solicitante da comanda como em `commitDraftItem`; confere `canFulfillItems` com todas juntas; nunca soma com linha existente).

- [ ] **Passo 1:** `t13`: Ficha — tocar na carne, 2 peças → 2 linhas, total do pedido = soma, cobrar em dinheiro, venda fechada com `items[*].weight` e estoque do insumo baixado em 0,995; comanda (Novo pedido) — 1 peça, confirmar, linha com `weight`; cancelar a peça enviada → estoque volta; "Repetir" a peça → aviso, nada entra; delivery → aviso.
- [ ] **Passo 2:** rodar → falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `t13` inteiro passa; regressão `t2-fluxos`, `t5-tamanhos`, `t11`, `t12`.
- [ ] **Passo 5:** commit `feat(peso): peças na Ficha e na comanda`.

### Task 6: Nota, impressão e relatórios

**Arquivos:**
- Modificar: `supabase/functions/nfce/payload.ts` (~51: item com `weight` → `Quantidade` = `weight.kg`, `ValorUnitario` = `weight.pricePerKg`, `UnidadeComercial` `"KG"`, `ValorTotal` = `cents(i.price)`; tipo `SaleItem` ganha `weight?`)
- Modificar: `assets/js/impressao/ficha.js:105` e o texto do comprovante (`buildTicketText`): quantidade via `itemQtyLabel(it)`
- Modificar: `assets/js/gestao/relatorios.js` (somas de quantidade nas linhas ~42, ~134, ~172, ~230, ~289 usam `itemStockQty`; produto por peso mostra `fmtKg`; custo ~179 `productCost(p)*itemStockQty(i)`)
- Teste: `auditoria-2026-11-03` — `npm run nfce` (caso novo com peça de 0,480 kg) e `t13` (relatório de produtos mostra "0,995 kg")

**NFC-e:** ela é Edge Function. Deploy só com o "sim" do dono, junto da `staff-auth`. Antes do deploy, o site novo emite nota de peça com `Quantidade` 1 e unidade KG. Por isso o deploy vem antes do merge.

- [ ] **Passo 1:** testes: payload de venda com peça `{qty:1, price:57.55, weight:{kg:0.48, pricePerKg:119.9}}` → `Quantidade 0.48`, `ValorUnitario 119.9`, `ValorTotal 57.55`, `UnidadeComercial 'KG'`; relatório com 2 peças mostra `0,995 kg`.
- [ ] **Passo 2:** rodar → falha.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passam; `npm run nfce` inteiro, `t1-telas`, `t3-xss`.
- [ ] **Passo 5:** commit `feat(peso): NFC-e, impressão e relatórios em kg`.

### Task 7: Publicação e cadastro

- [ ] **Passo 1:** versão (`bump-version`), checagens, regressão completa da bancada (`npm run banco` + t2, t3, t5–t13, telas).
- [ ] **Passo 2:** PR. Pedir o "sim" do dono e preparar o script de deploy da `staff-auth` e da `nfce`. O dono roda.
- [ ] **Passo 3:** com as funções no ar, merge do PR (depois do `syntax-check`).
- [ ] **Passo 4:** cadastro, com "sim" e cópia `backup:cantina2:...:2026-11-xx-peso`: 6 insumos em kg (estoque 0) e fichas técnicas 1 kg/kg nas 6 carnes; estação `nenhuma`. Script `.sql` + `.sh` no scratchpad, conferido antes em modo só leitura. O dono roda.
- [ ] **Passo 5:** atualizar `docs/HANDOFF.md` (B5 substituída; ordem de deploy; onde fica cada parte).
