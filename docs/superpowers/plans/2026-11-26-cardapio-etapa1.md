# Cardápio digital — etapa 1 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (escolhido: Native, executado pelo Claude nesta sessão). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cardápio público só para olhar (QR por mesa) e a tela de configuração no admin.

**Architecture:** Edge Function `cardapio` (GET, sem JWT) lê `app_data` com service role, acha o estabelecimento pelo código público de `settings.cardapio.codigo` e devolve o catálogo filtrado (sem fotos) ou uma foto binária com cache. Página estática `cardapio.html` + `assets/js/cardapio-publico.js` consome a função. Admin: `operacao/cardapio.js` vira a configuração (ligar, código, abrir, imprimir QRs).

**Tech Stack:** Deno/TS (Edge Function, supabase-js 2.117.0 via `npm:`), HTML/CSS/JS puro sem build, qrcodejs (já carregado no app), bancada Playwright + fakesupa.

**Spec:** `docs/superpowers/specs/2026-11-26-cardapio-etapa1-design.md`

## Global Constraints
- Sem build, scripts clássicos globais; `node scripts/bump-version.js` depois de mexer em assets; `node scripts/check-app.js` e `check-load-order.js` passando.
- Texto de tela em português, sem jargão; escape com `h`/`jsArg` no admin; na página pública, só `textContent`/escape próprio.
- Nada interno na resposta pública: só nome, descrição, categoria, preço, tamanhos (nome e preço) e se tem foto.
- Foto: `Cache-Control: public, max-age=86400`; catálogo: `Cache-Control: public, max-age=60`.
- Endereço: `cardapio.html?c=<codigo>&m=<id do local>`.
- Deploy da função e merge só com o "sim" do dono.

## Review Focus
1. Código desligado/trocado: QR antigo mostra "Cardápio indisponível", nunca o catálogo (teste em T1).
2. Produto inativo, `channels.qr === false` ou categoria inativa não aparece; pausado some (teste em T1).
3. Produto com tamanhos mostra só tamanhos ativos com preço, canal qr (teste em T1).
4. Horário: cozinha fechada pelo `kitchenHours` no fuso de São Paulo aparece "Cozinha fechada agora" (teste em T1 com relógio fixo).
5. Celular 390 px: sem rolagem lateral; produto sem foto mostra nome e preço sem buraco (teste em T2).

---

### Task 1: Função `cardapio`

**Files:**
- Create: `supabase/functions/cardapio/montar.ts` (puro: filtro, tamanhos, horário)
- Create: `supabase/functions/cardapio/index.ts`
- Modify: bancada `e2e/fakesupa.js` (rota `/functions/v1/cardapio` devolvendo status, cabeçalhos e corpo binário)
- Test: bancada `e2e/t87-cardapio-funcao.js`

**Interfaces:**
- Produces: `montarCardapio(settings, products, categorias, complementos, locais, mesaId, agora: Date)` → `{ nome, mesa, cozinha:{aberta:boolean, texto:string}, categorias:[{nome, fotoId:string|null}], produtos:[{id, nome, descricao, categoria, preco, foto:boolean, unidade:'un'|'kg', tamanhos:[{nome, preco}]}] }`; `fotoDoProduto(products, id)` → `{ mime, bytes } | null`.
- HTTP: `GET ?c=&m=` → JSON acima com `ok:true`; desligado/código errado → `{ok:false, motivo:'indisponivel'}` (200). `GET ?c=&foto=<id|logo>` → imagem ou 404.

- [ ] Teste t87: liga `settings.cardapio={ligado:true,codigo:'abc123'}` no seed; GET com código certo → ok, produto inativo/`channels.qr:false` ausentes, tamanhos certos, sem campos internos (`cost`, `fiscal`, `stock`); código errado e desligado → `indisponivel`; foto de produto com imagem → 200 `image/*` com `max-age=86400`; sem foto → 404; `kitchenHours` fechado agora → `cozinha.aberta === false`.
- [ ] Rodar: `FAKE_STAFF_AUTH=1 node e2e/t87-cardapio-funcao.js <repo>` → falha (função não existe).
- [ ] Implementar `montar.ts` (regra de horário igual a `cozinhaAberta` de `operacao/cozinha.js`, com hora de São Paulo via `Intl.DateTimeFormat`) e `index.ts` com `comCors(..., "GET, OPTIONS")`, lendo `cantina2:settings|products|categorias|complementos|locais` do tenant cujo `settings.cardapio.codigo` bate.
- [ ] Rodar t87 → passa. Commit.

### Task 2: Página pública

**Files:**
- Create: `cardapio.html`, `assets/js/cardapio-publico.js`, `assets/css/cardapio-publico.css`
- Test: bancada `e2e/t88-cardapio-pagina.js`

**Interfaces:**
- Consumes: HTTP da Task 1 (URL base = a do Supabase usada no app, fixa no `cardapio-publico.js`).

- [ ] Teste t88: abre `cardapio.html?c=abc123&m=<local>` → boas-vindas com nome do clube, mesa e "Peça ao garçom"; tocar "Ver cardápio" → blocos de categoria; tocar categoria → produtos com preço; produto com foto carrega `<img loading="lazy">` da função; sem foto não tem `<img>`; código errado → "Cardápio indisponível"; 390 px sem rolagem lateral; sem erro no console.
- [ ] Rodar → falha. Implementar (telas 1–3 do desenho aprovado; busca por nome). Rodar → passa. Commit.

### Task 3: Configuração no admin + QR das mesas

**Files:**
- Modify: `assets/js/operacao/cardapio.js` (`renderCardapio` vira a configuração; o resto do arquivo — pedidos recebidos — fica para a etapa 2)
- Modify: `assets/js/sistema/novidades.js`, `docs/HANDOFF.md`, `index.html` (`?v=`)
- Test: bancada `e2e/t89-cardapio-admin.js`

**Interfaces:**
- Produces: `cardapioLigar(on:boolean)`, `cardapioTrocarCodigo()`, `cardapioImprimirQrs()`; `settings.cardapio = { ligado, codigo }` (código: 10 caracteres `[a-z0-9]`, gerado com `crypto.getRandomValues`).

- [ ] Teste t89: admin abre a área Cardápio → mostra desligado; ligar grava `settings.cardapio.ligado=true` e um código de 10 caracteres no servidor; "Abrir como cliente" aponta para `cardapio.html?c=<codigo>`; "Imprimir QR das mesas" monta uma folha com um QR por local (contagem = locais) com o nome embaixo; "Trocar código" muda o código; caixa sem `config-sistema` não liga.
- [ ] Rodar → falha. Implementar. Rodar t87, t88, t89 → passam. Bump, checks, Novidades, HANDOFF. Commit e PR.
