# Clientes: cota no topo, ordenar e pesquisa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cota como primeiro campo do cadastro do cliente; lista de Clientes com ordenação por coluna e barra de pesquisa iguais às de Produtos.

**Architecture:** Tudo em `assets/js/cadastros/associados.js` (scripts clássicos, escopo global, sem build). Ordenação copia o padrão de `assets/js/cadastros/produtos.js` (`COLUNAS_PRODUTOS`, `produtosOrdem`, `ordenarProdutosPor`, cabeçalho `th-ordena`). Teste e2e na bancada `../auditoria-2026-11-03` (harness Playwright + fakesupa).

**Tech Stack:** JS puro; bancada Node (`e2e/harness.js`, `e2e/seed.js`).

**Spec:** `docs/superpowers/specs/2026-11-24-clientes-cota-ordenar-design.md`

## Global Constraints

- Só `assets/js/cadastros/associados.js`, `assets/js/sistema/novidades.js` e o `?v=` (via `node scripts/bump-version.js`); sem banco.
- id `mCode` do campo de cota não muda.
- Seletor `memberSearchType` fica com as opções `Busca Padrão`, `Cota`, `Nome`, `Telefone`, `Endereço`; Cota continua exata.
- Ciclo do clique no título: ▲ → ▼ → ordem normal (ordem atual de `state.members`).
- UI e comentários em português; escape com `h`/`jsArg`.

## Review Focus

- Cotas mistas ("18", "180", "2", "A3", vazia): números em ordem numérica, texto depois, vazias sempre no fim.
- Pesquisar com a lista ordenada: ordem mantida, só esconde linhas.
- "Mais Colunas" ligado: Saldo Devedor ordena e a pesquisa por Endereço não pega a célula errada.
- Editar cliente existente: a cota aparece preenchida no topo e salva igual.
- Re-render (clicar numa linha, abrir Opções) não perde a ordem escolhida.

---

### Task 1: Cota no topo, ordenação e barra de pesquisa

**Files:**
- Modify: `assets/js/cadastros/associados.js` (`filterMemberRows` l.16; `renderAssociados` l.226-231; `openMemberModalBase` l.239)
- Modify: `assets/js/sistema/novidades.js` (entrada nova no topo)
- Test: `../auditoria-2026-11-03/e2e/t67-clientes-ordenar.js`

**Interfaces:**
- Produces: `COLUNAS_CLIENTES: Array<[rótulo:string, valor:(m, vendas)=>string|number]>`, `clientesOrdem = {col:null|number, dir:1|-1}`, `ordenarClientesPor(i:number):void` (re-render), `compararClientes(a, b):number`.

- [ ] **Step 1: Escrever o teste** `e2e/t67-clientes-ordenar.js`, no molde de `e2e/t57-cota-clientes.js` (mesmo login, `state.members` semeado com cotas `'18'`, `'2'`, `'180'`, `'A3'`, `''`, nomes fora de ordem, um com `phone`). Checagens:
  - modal Novo Cliente: primeiro `.field` de `[data-pane=principal]` contém `#mCode`; `[data-pane=secundarios]` não contém `#mCode`;
  - Editar um cliente com cota `'18'`: `#mCode.value === '18'`;
  - cabeçalho `th.th-ordena` em todas as colunas; clique em "Cota" → ordem dos ids por cota `2,18,180,A3,(vazio)`; segundo clique → `A3,180,18,2,(vazio)`; terceiro → ordem original; `aria-sort` coerente;
  - clique em "Nome" → ordem alfabética `localeCompare('pt-BR')`;
  - com "Cota ▲" ativo, pesquisa Nome `'a'` → linhas visíveis na mesma ordem relativa;
  - `selectMemberRow` depois de ordenar mantém a ordem;
  - "Mais Colunas" ligado: Saldo Devedor ordena por número; pesquisa Endereço acha pelo endereço;
  - barra tem `.op-search` com `⌕`; não existe botão com texto "Buscar" na toolbar; digitar em `#memberSearch` filtra sem clicar;
  - casos do t57 (Cota exata 18 ≠ 180) seguem passando; sem erro no console.

- [ ] **Step 2: Rodar e ver falhar** — `node e2e/t67-clientes-ordenar.js ../commandah-sistema` → FALHA nas checagens de modal, ordenação e barra.

- [ ] **Step 3: Implementar em `associados.js`**
  - Modal: mover o `<div class="field">` de `mCode` para uma linha própria no topo de `data-pane="principal"`, antes de Nome/Tipo; placeholder igual.
  - `COLUNAS_CLIENTES` na ordem dos `<th>` (Cota, Nome, Telefone Principal, Endereço, Núm., Bairro, E-mail, Qtd. Pedidos, Últ. Pedido, Saldo Devedor). Cota: `/^\d+$/` → número, senão texto; comparar número antes de texto; vazio/`—` sempre no fim nas duas direções. Qtd./Últ. Pedido por número/timestamp (calcular as vendas uma vez por cliente, como já faz a linha).
  - `renderAssociados`: ordenar `activeMembers` com `compararClientes` quando `clientesOrdem.col!==null`; `<th>` com `th-ordena`/`ativa`/`aria-sort`/`seta` iguais a Produtos.
  - Barra: `<div class="op-search"><span>⌕</span><input id="memberSearch" placeholder="Pesquisar cliente..."></div>`, seletor ao lado, sem botão Buscar.
  - `filterMemberRows`: Nome/Telefone/Endereço leem `data-name`, `data-phone`, `data-address` da linha (minúsculos, escapados com `h`), não `cells[n]`.
  - Novidade `2026-11-24-clientes-cota-ordenar` em `novidades.js`: "Clientes: a cota é o primeiro campo do cadastro, e a lista ordena clicando no título da coluna."

- [ ] **Step 4: Rodar e ver passar** — `node e2e/t67-clientes-ordenar.js ../commandah-sistema` e `node e2e/t57-cota-clientes.js ../commandah-sistema` → todos `ok`. Ver as capturas 1366 e 390.

- [ ] **Step 5: Checagens e commit** (no repo)

```bash
node scripts/bump-version.js && node scripts/check-app.js && node scripts/check-load-order.js
git add assets/js/cadastros/associados.js assets/js/sistema/novidades.js index.html sw.js docs/superpowers
git commit -m "feat(clientes): cota no topo do cadastro, ordenar pela coluna e barra de pesquisa"
```
