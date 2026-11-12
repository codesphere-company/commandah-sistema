# Primeiro acesso do estabelecimento novo — plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** conta nova nasce limpa, passa por uma tela obrigatória "Como você atende?" e vê um cartão "Primeiros passos" até a primeira venda de teste.

**Architecture:** regras puras (sem DOM) num arquivo novo, testadas no Node como `scripts/test-peso.js`; a tela e o cartão num segundo arquivo de UI que só chama essas regras. `core/dados.js` para de semear o que é do clube. O gancho é `afterLogin()` (`core/login.js`) e `renderAll()` (`core/navegacao.js`).

**Tech Stack:** JS puro em scripts clássicos (escopo global), sem build; Node 20 só para os testes; Supabase pelo `save()` existente.

**Spec:** `docs/superpowers/specs/2026-11-11-primeiro-acesso-design.md`

## Global Constraints

- Scripts clássicos, sem `type="module"`; arquivo novo entra no `index.html` na ordem certa, com o mesmo `?v=`.
- Depois de mexer em `assets/js`/`assets/css`: `node scripts/bump-version.js`, `node scripts/check-app.js`, `node scripts/check-load-order.js` (precisa `npm i --no-save acorn@8.14.0 acorn-walk@8.3.4`).
- Escape com `h()`/`jsArg()`; visual com tokens e componentes existentes (`assets/css`), sem cor nova solta.
- Texto de UI em português do Brasil, frases curtas. Comentários citam "auditoria 11/11, item 1" e o porquê.
- Nada muda para conta que já tem produto ou venda (clube `clube-olimpico-maringa-y8mt`, demo `clube-demo-mdqz`).
- Padrão de `operationMode` vazio continua `'clube'` no front; a tela grava o valor explícito.
- Entrada nova no topo de `NOVIDADES` (`assets/js/sistema/novidades.js`), `perms:['config-sistema']`.
- Merge e publicação só com o "sim" do dono; nada arriscado antes do teste de 13/11.

## Review Focus

1. Clube ou demo abrindo depois do merge: nunca veem a tela nem o cartão (têm produtos) — teste `precisaPrimeiroAcesso` com produtos/vendas.
2. Leitura que falhou (`readFailed`) ou operador sem permissão: a tela não pode gravar por cima de dado real — a tela só abre para `role==='admin'` e só grava locais/estações quando as listas vieram vazias e sem `readFailed`.
3. Dono marca "Mesas" com 0, vazio, 500 ou texto — `montarAtendimento` recusa fora de 1–200 com mensagem.
4. Dono abre a tela de novo depois (recarregou no meio): não duplica "Mesa 1…N" nem estações — `montarAtendimento` recebe as listas atuais e só acrescenta o que falta.
5. Conta sem estação "cozinha" (só Bar): produto novo não pode cair numa estação inexistente — `estacaoPadraoProduto`.

---

### Task 1: Regras puras do primeiro acesso (com testes)

**Files:**
- Create: `assets/js/sistema/primeiro-acesso-regras.js`
- Create: `scripts/test-primeiro-acesso.js`
- Modify: `.github/workflows/check-index-syntax.yml` (passo novo depois de "Testar núcleo da venda por peso")
- Modify: `index.html` (tag do arquivo novo logo antes de `sistema/ajuda.js`)

**Interfaces:**
- Produces (globais):
  - `precisaPrimeiroAcesso(st) -> boolean` — `st = {settings, products, sales}`. `true` só se `!st.settings.atendimento && st.products.length===0 && st.sales.length===0`.
  - `montarAtendimento(escolhas, atuais, uidFn) -> {error:string} | {settings, locais, estacoes}`
    - `escolhas = {nome, socios, mesas, qtdMesas, balcao, preparo:{cozinha, bar, churrasqueira}, em}` (`em` = ISO string, passado de fora para o teste ser determinístico).
    - `atuais = {locais:[{id,nome}], estacoes:[{id,chave,nome,saida}]}`.
    - `settings` = só o patch: `{clubName, operationMode:'clube'|'bar', atendimento:{socios,mesas,qtdMesas,balcao,preparo,em}}` e `tableCount` quando `mesas`.
    - `locais`/`estacoes` = listas **completas** (atuais + acrescentadas), sem duplicar por `nome` (locais) ou `chave` (estações).
    - Estações criadas: `cozinha` → `{chave:'cozinha', nome:'Cozinha', saida:'ambos'}`, `bar` → `{chave:'bar', nome:'Bar', saida:'imprime'}`, `churrasqueira` → `{chave:'churrasqueira', nome:'Churrasqueira', saida:'imprime'}`, nessa ordem.
    - Erros (texto exato): nome vazio → `'Informe o nome do estabelecimento.'`; nome > 60 → `'O nome pode ter até 60 letras.'`; mesas fora de 1–200 inteiro → `'Informe quantas mesas (de 1 a 200).'`; nenhum preparo → `'Marque pelo menos um lugar onde os pedidos são preparados.'`.
  - `estacaoPadraoProduto(estacoes) -> string` — `chave` da primeira estação; `'nenhuma'` se lista vazia.
  - `telaInicialDoAdmin(settings) -> 'balcao'|'comandas'` — `'balcao'` se `settings.atendimento && settings.atendimento.balcao`.
  - `passosPrimeirosPassos(st, extras) -> [{id, titulo, detalhe, feito}]` — ids nesta ordem: `'dados','colaboradores','produtos','nfce','impressoras','venda'`. `extras = {emissorConfigurado:boolean}`. Regras de `feito` (OU marcação manual em `st.settings.primeirosPassos.feitos[id]`):
    - `dados`: `clubName` e `address` e `city` preenchidos.
    - `colaboradores`: mais de 1 usuário com `active!==false`.
    - `produtos`: `products.length>0`.
    - `nfce`: `extras.emissorConfigurado===true`.
    - `impressoras`: `impressoras.length>0`.
    - `venda`: alguma venda `status==='closed' && !canceled`.
    - Títulos e detalhes: copiar da spec ("Dados do estabelecimento" / "nome, logo, endereço"; "Colaboradores" / "caixa, garçom, cozinha, com PIN"; "Produtos" / "cadastre ou importe a planilha"; "Nota fiscal" / "token da Brasil NFe e série"; "Impressoras" / "instalar o agente e parear"; "Primeira venda de teste" / "abra uma comanda, lance e feche").

- [ ] **Step 1: Escrever `scripts/test-primeiro-acesso.js`** no mesmo formato de `scripts/test-peso.js` (carrega o arquivo com `vm.runInNewContext`, função `t(nome, fn)`, `console.log` com o total no fim). Testes e asserções:
  - `precisaPrimeiroAcesso`: conta vazia → `true`; com 1 produto → `false`; com 1 venda → `false`; com `settings.atendimento` → `false`.
  - `montarAtendimento` só bar com mesas: `{nome:'Bar do Zé', socios:false, mesas:true, qtdMesas:3, balcao:false, preparo:{bar:true}}` → `settings.operationMode==='bar'`, `settings.tableCount===3`, `locais.map(l=>l.nome)` igual a `['Mesa 1','Mesa 2','Mesa 3']`, `estacoes.map(e=>e.chave)` igual a `['bar']`, `estacoes[0].saida==='imprime'`.
  - Sócios marcado → `operationMode==='clube'`; sem mesas → sem `tableCount` e `locais` igual a `atuais.locais`.
  - Não duplica: `atuais = {locais:[{id:'a',nome:'Mesa 1'}], estacoes:[{id:'b',chave:'bar',nome:'Bar',saida:'imprime'}]}` com 2 mesas e bar → `locais.length===2`, `estacoes.length===1`.
  - Erros: os quatro textos exatos acima (`qtdMesas` 0, 201, `'abc'`, `2.5`; nome `'   '`; nome com 61 letras; preparo todo `false`).
  - `estacaoPadraoProduto([])==='nenhuma'`; `estacaoPadraoProduto([{chave:'bar'}])==='bar'`.
  - `telaInicialDoAdmin({atendimento:{balcao:true}})==='balcao'`; `telaInicialDoAdmin({})==='comandas'`.
  - `passosPrimeirosPassos`: conta vazia → 6 itens, ids na ordem, todos `feito:false`; com produto, 2 usuários ativos, venda `closed`, impressora, `emissorConfigurado:true` e dados preenchidos → todos `true`; venda `closed` mas `canceled:true` não conta; `settings.primeirosPassos.feitos.nfce=true` marca `nfce` sem `extras`.

- [ ] **Step 2: Rodar e ver falhar**
  Run: `node scripts/test-primeiro-acesso.js`
  Expected: erro de arquivo não encontrado (`primeiro-acesso-regras.js`).

- [ ] **Step 3: Implementar as cinco funções** em `assets/js/sistema/primeiro-acesso-regras.js` (cabeçalho `/* ============ PRIMEIRO ACESSO: REGRAS ============ */`, sem tocar em DOM nem em `state` no carregamento). Acrescentar a tag no `index.html` antes de `sistema/ajuda.js` e o passo no workflow (`name: Testar regras do primeiro acesso`, `run: node scripts/test-primeiro-acesso.js`).

- [ ] **Step 4: Rodar e ver passar**
  Run: `node scripts/test-primeiro-acesso.js && node scripts/check-app.js && node scripts/check-load-order.js`
  Expected: total de testes impresso, sem `FALHOU`; as duas checagens com `OK`.

- [ ] **Step 5: Commit** — `feat(primeiro-acesso): regras puras e testes (auditoria 11/11, item 1)`.

### Task 2: Conta nova sem nada do clube

**Files:**
- Modify: `assets/js/core/dados.js:88-104` (semeadura de locais, impressoras, estações)
- Modify: `assets/js/cadastros/fiscal-produto.js:144` (estação padrão do produto novo)

**Interfaces:**
- Consumes: `estacaoPadraoProduto(estacoes)` (Task 1).

- [ ] **Step 1: Remover os três blocos `seedable('locais'|'impressoras'|'estacoes')`** de `dados.js`, nos dois modos (nuvem e local). O bloco de `origens` fica. Comentário curto no lugar explicando que o clube nascia com Churrasqueira/Piscina e que agora a tela "Como você atende?" cria só o que o dono marca.

- [ ] **Step 2: Trocar `(!p&&e.chave==='cozinha')`** em `fiscal-produto.js:144` por `(!p&&e.chave===estacaoPadraoProduto(state.estacoes))`. Conferir no mesmo arquivo e em `impressao/impressoras.js`, `impressao/impressao-automatica.js` se algo quebra com `state.estacoes` vazio (lista vazia deve só mostrar a opção "Não exige preparo"); corrigir o que quebrar.

- [ ] **Step 3: Conferir** — Run: `node scripts/check-app.js && node scripts/check-load-order.js && node scripts/test-primeiro-acesso.js`. Expected: `OK` e testes passando. Na bancada local (`../auditoria-2026-11-03`), no modo local com dados limpos: Áreas do Clube › Locais, Estações e Impressoras vazios; Produtos › Novo abre sem erro no console.

- [ ] **Step 4: Commit** — `feat(primeiro-acesso): conta nova não herda locais, estações e impressoras do clube`.

### Task 3: Tela "Como você atende?"

**Files:**
- Create: `assets/js/sistema/primeiro-acesso.js` (tag logo depois de `primeiro-acesso-regras.js`)
- Modify: `assets/js/core/login.js` (`afterLogin`, depois de `renderAll()`)
- Modify: `assets/css/ajustes.css` (estilos da tela, com tokens)

**Interfaces:**
- Consumes: `precisaPrimeiroAcesso`, `montarAtendimento`, `telaInicialDoAdmin` (Task 1); `save(key)`, `switchView(viewId)`, `logAction`, `toast`, `h`, `uid`.
- Produces: `abrirPrimeiroAcessoSeNecessario() -> boolean` (true se abriu); `salvarPrimeiroAcesso() -> Promise<void>`.

- [ ] **Step 1: Implementar `abrirPrimeiroAcessoSeNecessario()`**: só faz algo se `currentUser.role==='admin'`, `precisaPrimeiroAcesso(state)` **e nenhuma leitura falhou** no carregamento (leitura que falha deixa as listas vazias e imitaria conta nova). O carregamento em `core/dados.js` devolve `Object.keys(readFailed)`; ver quem recebe esse retorno (`grep -rn "readFailed\|= await loadData\|loadAll" assets/js/core`) e reaproveitar, ou guardar numa global `falhasDeLeitura` (array). Com falha, não abre. Mostra uma camada de tela inteira (elemento criado no `body`, sem botão de fechar, `role="dialog"` e `aria-modal="true"`) com o layout do esboço aprovado: campo nome (padrão `state.settings.clubName`), três itens marcáveis (Sócios com cota e dependentes; Mesas + campo quantas, só ativo se marcado; Balcão com ficha), o grupo "Onde os pedidos são preparados?" (Cozinha, Bar, Churrasqueira), a frase "Marque tudo o que você tem. Dá para mudar depois em Configurações." e o botão **Começar**.

- [ ] **Step 2: Implementar `salvarPrimeiroAcesso()`** com `singleFlight`: chama `montarAtendimento(escolhas, {locais:state.locais, estacoes:state.estacoes}, uid)`; erro vira `toast(erro)` e a tela fica. Sucesso: aplica `settings` (spread sobre `state.settings`), `state.locais`, `state.estacoes`; `await save('settings')`, `save('locais')`, `save('estacoes')` — se algum devolver falso, `toast('Não foi possível salvar agora. Confira a internet e tente de novo.')` e não fecha. Depois: fecha a camada, `logAction('Primeiro acesso: atendimento configurado')`, `buildNav()`, `switchView(telaInicialDoAdmin(state.settings))`.

- [ ] **Step 3: Gancho no `afterLogin`**: depois de `renderAll()`, `if(abrirPrimeiroAcessoSeNecessario()) return;` antes do aviso de PIN/Novidades (o PIN obrigatório não se aplica: o primeiro admin já criou PIN forte). Para os logins seguintes de admin, `switchView(telaInicialDoAdmin(state.settings))` quando for `'balcao'`.

- [ ] **Step 4: Conferir** na bancada local com um estabelecimento vazio: a tela abre ao entrar como admin; "Começar" sem preparo mostra o erro exato; com Bar + 3 mesas cria `Mesa 1..3` e a estação Bar; recarregar não abre de novo; Configurações › Geral mostra o modo "Bar/Restaurante/Lanchonete". Com os dados do clube (cópia local), a tela não abre. Checagens do app com `OK`.

- [ ] **Step 5: Commit** — `feat(primeiro-acesso): tela "Como você atende?" no primeiro acesso do administrador`.

### Task 4: Cartão "Primeiros passos"

**Files:**
- Modify: `assets/js/sistema/primeiro-acesso.js`
- Modify: `index.html` (um `<div id="primeirosPassosBox"></div>` no topo da área das telas do `#app`, antes do primeiro `.view`)
- Modify: `assets/js/core/navegacao.js:364` (`renderAll` chama `renderPrimeirosPassos()` no fim)
- Modify: `assets/js/sistema/ajuda.js` (botão "Primeiros passos" que reabre o cartão)
- Modify: `assets/css/ajustes.css`

**Interfaces:**
- Consumes: `passosPrimeirosPassos(st, extras)` (Task 1); `nfceCall('emissor')` (`fiscal/nfce-config.js`, devolve `{emissor:{configurado}}`).
- Produces: `renderPrimeirosPassos() -> void`; `esconderPrimeirosPassos() -> void`; `reabrirPrimeirosPassos() -> void`; `marcarPassoFeito(id) -> Promise<void>`.

- [ ] **Step 1: `renderPrimeirosPassos()`**: só para `currentUser.role==='admin'` e conta com `settings.atendimento` (contas antigas nunca veem). Some se todos `feito` (grava `settings.primeirosPassos.concluidoEm` uma vez) ou se escondido neste aparelho (`localStorage` chave `commandah:passos-escondidos:<tenantId>`, leitura/escrita em `try/catch`). Mostra título "Deixe o Commandah pronto para vender", "X de 6 feitos", os seis passos (feito = riscado e marcado; o primeiro não feito em destaque) com botão **Abrir**, e "Esconder por enquanto". O emissor é perguntado uma vez por sessão (`nfceCall('emissor')`, resultado guardado numa variável do arquivo); sem nuvem, conta como não feito.

- [ ] **Step 2: Botão Abrir de cada passo** leva à tela existente: dados → Configurações › Geral; colaboradores → cadastro de usuários; produtos → Produtos; nfce → `openNfceSettings()`; impressoras → tela de Impressoras; venda → `switchView(telaInicialDoAdmin(state.settings))`. Achar as chamadas com `grep -rn "function open\|openRibbonView(" assets/js`. Nota fiscal e impressoras ganham também "Já fiz" (`marcarPassoFeito(id)`, grava em `settings.primeirosPassos.feitos` e `save('settings')`), porque a conferência automática delas pode falhar sem internet.

- [ ] **Step 3: Ajuda** ganha "Primeiros passos" que chama `reabrirPrimeirosPassos()` (apaga a chave do `localStorage` e redesenha).

- [ ] **Step 4: Conferir** na bancada local: depois da tela da Task 3, o cartão aparece com 0–1 de 6; cadastrar um produto marca "Produtos" sem recarregar; "Esconder por enquanto" some e a Ajuda reabre; entrar como caixa não mostra o cartão; dados do clube não mostram o cartão. Tela estreita (celular, 375 px) sem rolagem lateral. Checagens com `OK`.

- [ ] **Step 5: Commit** — `feat(primeiro-acesso): cartão "Primeiros passos" para o administrador`.

### Task 5: Fechamento para publicar

**Files:**
- Modify: `assets/js/sistema/novidades.js` (entrada no topo)
- Modify: `index.html` (via `bump-version.js`)
- Modify: `docs/HANDOFF.md` (seção do dia: o que foi feito e os passos de publicação)

- [ ] **Step 1: Novidades**: `{ id:'2026-11-1X-primeiro-acesso', data:'dd/mm/2026', itens:[{ titulo:'Estabelecimento novo começa do zero', texto:'Quem cria um estabelecimento novo responde como atende (sócios, mesas, balcão e onde os pedidos são preparados) e segue uma lista de primeiros passos até a primeira venda. Nada muda para quem já usa o sistema.', onde:'Primeiro acesso do administrador', perms:['config-sistema'] }] }` com a data do dia do merge.

- [ ] **Step 2: Conferir tudo** — Run: `node scripts/bump-version.js && node scripts/check-app.js && node scripts/check-load-order.js && node scripts/test-primeiro-acesso.js && node scripts/test-peso.js && node scripts/test-opcoes.js`. Expected: todos `OK`/passando. Captura no Chrome da tela e do cartão (claro e escuro).

- [ ] **Step 3: Commit e PR em rascunho** — commit `docs: Novidades e HANDOFF do primeiro acesso`; push; `gh pr create --draft`. Merge só com o "sim" do dono, depois do teste de 13/11. Depois do merge: conferir no site oficial que o clube entra normal (sem tela, sem cartão).
