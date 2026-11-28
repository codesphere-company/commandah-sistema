# Caixa: todos os caixas numa lista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin/dono, com caixa por operador ligado, abre Caixa e vê todos os caixas (situação de cada um) e o Cofre no fim; o Cofre sai do menu da esquerda.

**Architecture:** Só front (scripts clássicos, escopo global). A lista lê `state.cashTurnos`/`state.cashAbrirSemContagem`, já atualizados pelo polling `refreshCashState`. Estado novo `caixaNaLista` decide entre a lista e a tela do caixa deste computador.

**Tech Stack:** HTML/CSS/JS puro; bancada Puppeteer em `../auditoria-2026-11-03/e2e` (banco local + `fakesupa.js`).

**Spec:** `docs/superpowers/specs/2026-11-27-caixa-todos-os-caixas-design.md`

## Global Constraints
- UI, comentários e commit em português; comentários citam "caixa-lista (27/11)".
- Escape com `h()` / `jsArg()`; nada de dado cru no HTML.
- Sem valores em dinheiro nos cartões da lista.
- Rodar `node scripts/bump-version.js`, `node scripts/check-app.js` e `node scripts/check-load-order.js` antes do commit.
- Novidade nova em `assets/js/sistema/novidades.js` (perms `['cofre']`).
- Merge só com "pode" do dono.

## Review Focus
- Caixa sem turno mas com `cashAbrirSemContagem[cx]`: cartão diz "Passado sem contagem", não "Fechado".
- `state.cashTurnosFalhou` com `cashTurnos` nulo: lista mostra "Não foi possível ler o caixa. Tentando de novo…", sem quebrar.
- Operador comum (perfil caixa) com o modo ligado: tela igual à de antes, sem lista e sem Cofre.
- Polling redesenha a lista com o cartão de outro caixa mudando (aberto → travado) sem perder o caminho do usuário (se ele estiver na tela do próprio caixa, continua nela).
- Nome de caixa ou operador com `<b>`: aparece como texto.

---

### Task 1: Lista de caixas, Cofre no fim e fora do menu

**Files:**
- Modify: `assets/js/operacao/caixa.js` (renderCaixaPorOperador, cascaDoCaixa, novas funções)
- Modify: `assets/js/core/navegacao.js:73` (itemEscondido), `:141-143` (switchView reseta `caixaNaLista = true`)
- Modify: `assets/js/core/config.js:126` (item Cofre ganha `foraDoMenu:true`)
- Modify: `assets/js/operacao/cofre.js` (`cofreCasca`: botão "‹ Caixa" → `switchView('caixa')`)
- Modify: `assets/css/ajustes.css` (selo "Este computador", cartão só-leitura)
- Modify: `assets/js/sistema/novidades.js`
- Test: `../auditoria-2026-11-03/e2e/t100-caixa-lista.js`

**Interfaces:**
- Produces: `let caixaNaLista = true;` `function caixaVerTodos(): boolean` (modo ligado && `podeVerTotaisDoCaixa()`), `function caixaSituacao(cx: string): {pill:'on'|'alerta'|'off', texto:string}`, `function renderListaDeCaixas(el): void`, `function caixaEntrarNoMeu(): void`, `function caixaVoltarParaLista(): void`.

- [ ] **Step 1: Teste da bancada** `t100-caixa-lista.js` (padrão do t82): liga `caixaPorOperador`, caixas cx1/cx2, este aparelho = cx1, turno aberto em cx1 (operador "Ana") e travado em cx2. Confere:
  - admin: `.cx-lista .cx-cartao` = 2 + item Cofre último; cx1 tem "Este computador" e "Aberto · Ana"; cx2 "Travado"; cx2 não é `button`; nenhum `R$` dentro de `.cx-lista`.
  - sidebar sem item "Cofre"; tocar Cofre abre `#view-cofre` e "‹ Caixa" volta para a lista.
  - tocar cx1 mostra `.cash-title-aberto` e botão "‹ Todos os caixas"; voltar mostra a lista.
  - turno cx2 vira nulo com `cashAbrirSemContagem.cx2=true` → "Passado sem contagem".
  - operador do perfil caixa: sem `.cx-lista`, tela de antes.
  - nome de caixa `<b>x</b>` aparece como texto.
- [ ] **Step 2:** rodar `node e2e/t100-caixa-lista.js <pasta>` na bancada → falha (sem `.cx-lista`).
- [ ] **Step 3:** implementar. Em `renderCaixaPorOperador`, logo depois do aviso de nuvem: `if(caixaVerTodos() && (caixaNaLista || !cx)) return renderListaDeCaixas(el);`. A lista usa `cascaDoCaixa('Caixa', …)`, cartão por `listaDeCaixas()`; o deste computador é `button` com `onclick="caixaEntrarNoMeu()"`; os outros são `div.cx-cartao.so-ler`. Sem `cx`, a escolha `escolherCaixaAqui` vai embaixo. Item Cofre (`userPermissions(currentUser).includes('cofre')`) com `caixaItem('', 'lock', 'Cofre', 'Saldo, recolher, abastecer e extrato.', '', "switchView('cofre')")`. Na tela do próprio caixa com `caixaVerTodos()`, `cc-head` ganha `<button class="cc-voltar" onclick="caixaVoltarParaLista()">‹ Todos os caixas</button>`. `itemEscondido` devolve true para `it.foraDoMenu`.
- [ ] **Step 4:** rodar t100 → passa; rodar t82, t55, t62, t79 → continuam verdes (ajustar t79/t62 que procuram o Cofre no menu, guardando `.antes-caixa-lista`).
- [ ] **Step 5:** bump + checks; commit `feat(caixa): admin vê todos os caixas e o Cofre no fim da lista`.
