# Primeiro acesso do estabelecimento novo — design

Data: 11/11/2026. Item 1 da auditoria de lançamento (relatório: https://claude.ai/artifact/4rHCe8zRNhBKW5PBBw81Hr).
Esboço aprovado pelo dono: `.superpowers/brainstorm/487-1794440585/content/primeiro-acesso.html` (local, não versionado).

## Por quê

O dono quer vender o Commandah para outros bares, lanchonetes e clubes. Hoje, quando um estabelecimento
novo abre o sistema pela primeira vez, `core/dados.js` (linhas 88–104) cria sozinho o que é do Clube
Olímpico: 10 locais (Churrasqueira 1 a 5, Sinuca, Bolão, Quadra de Tênis, Salão de Festas, Piscina),
5 impressoras e 3 estações (Cozinha, Bar, Churrasqueira). A conta também nasce no modo "Clube com
associados" (`settings.operationMode` vazio vale `'clube'`). E não existe nenhum guia: o dono novo cai
na tela de Caixa sem saber por onde começar.

Nos primeiros minutos, o dono novo precisa cadastrar produtos, configurar a nota fiscal e sentir que o
sistema já é dele.

## Objetivos

1. Estabelecimento novo começa limpo: nada do clube.
2. Uma tela única, no primeiro acesso, pergunta **como ele atende** e ajusta o sistema a isso.
3. Uma lista de **Primeiros passos** leva o dono, em ordem, até a primeira venda de teste.

## Não objetivos

- Mudar qualquer coisa no Clube Olímpico (`clube-olimpico-maringa-y8mt`) ou no demo (`clube-demo-mdqz`).
  Eles nunca veem a tela nova nem perdem dado.
- Criar recurso novo de operação (mapa visual de mesas, modo lanchonete separado). Só ligar e configurar
  o que já existe.
- Esconder os 12 módulos "Em construção" (item 2 da auditoria, outro projeto).
- Importar produtos de outro sistema (a importação por planilha que já existe basta).
- Limpar os textos de clube ("sócio", "cota", "Associados") que ainda aparecem no modo bar em menus,
  fiado e relatórios (decisão do dono: fica para depois; levantar as telas e trazer como próximo item).
  O antiobjetivo abaixo vale para o que este projeto cria: locais, estações e a tela nova.

## Antiobjetivos (seria um fracasso mesmo funcionando)

- Gravar padrão por cima de dado real. A regra de semeadura atual existe por isso (comentário em
  `dados.js`: só semeia quem prova que pode escrever; `readFailed` bloqueia).
- O clube ou qualquer conta existente ver a tela "Como você atende?" ou o cartão de passos.
- Um bar só de mesa ver "cota", "sócio" ou "Piscina" por padrão.
- Obrigar o dono a terminar tudo antes de usar: a lista ajuda, não trava.

## O que o dono decidiu

### 1. Conta nova sem nada do clube

Parar de semear locais, impressoras e estações em `dados.js`. Continuam as origens "Caixa" e
"App do Garçom" (o sistema precisa delas). O modo local (sem nuvem) pode seguir o mesmo caminho.

### 2. Tela "Como você atende?" (uma vez só)

Aparece depois que o Administrador é criado e entra pela primeira vez. Campos:

- **Nome do estabelecimento** (grava em `settings.clubName`).
- Três itens de atendimento para marcar, **quantos quiser** (nenhum também vale) (casa mista é comum: o Olímpico é clube com bar e
  lanchonete). Texto: "Marque tudo o que você tem. Dá para mudar depois em Configurações."
  1. **Sócios com cota e dependentes** — modo clube (`operationMode: 'clube'`): cota, titular,
     dependentes, fiado do sócio, locais. Sem marcar: `operationMode: 'bar'`.
  2. **Mesas** — pergunta quantas. Cria os locais "Mesa 1" … "Mesa N" (a comanda já escolhe
     "Mesa / Local" da lista de locais, `vendas/comandas.js`) e grava `settings.tableCount`.
     **Só isso** (decisão do dono): abrir a comanda continua igual (texto livre no modo bar).
     Escolher a mesa numa lista ao abrir fica para um projeto futuro.
  3. **Balcão com ficha** — a tela Ficha (`balcao`) vira a entrada principal do caixa.
- Uma pergunta à parte, **"Onde os pedidos são preparados?"** (decisão do dono, no lugar do item
  "Cozinha"): Cozinha, Bar e Churrasqueira para marcar, **pelo menos um obrigatório**. O sistema cria
  só as estações marcadas (com as mesmas `chave`/`saida` da semeadura de hoje: cozinha `ambos`, bar e
  churrasqueira `imprime`). Assim todo pedido tem para onde imprimir e o passo Impressoras faz sentido.
  O padrão de estação do produto novo (hoje `'cozinha'`, `cadastros/fiscal-produto.js:144`) passa a
  ser a primeira estação existente.
- Botão **Começar**.

O que não for marcado fica fora e pode ser ligado depois em Configurações.

**Decisões do Claude (o dono pode rever):**
- A tela é **obrigatória** para o administrador, sem "pular": ela aparece antes de qualquer outra tela
  enquanto `settings.atendimento` não existir na conta nova. Como o primeiro administrador é sempre o
  primeiro a entrar (caixa e garçom só existem depois que ele cadastra), ninguém opera a conta nova antes
  das escolhas.
- "Começar" grava `operationMode` **explicitamente** (`'clube'` ou `'bar'`). O padrão do front para
  valor vazio continua `'clube'`, para não mudar nada no demo (que está vazio) nem no clube (gravado
  `'clube'`, conferido em 11/11).
- Em 11/11 só existem dois estabelecimentos (clube e demo, `tenant_owners`). Nenhuma conta criada por
  convite herdou os dados do clube; não há limpeza de produção a fazer.

### 3. Cartão "Primeiros passos"

Cartão no topo da primeira tela que o administrador vê ao entrar. Título "Deixe o Commandah pronto
para vender", contador "X de 6 feitos". Seis passos, nesta ordem, cada um com botão **Abrir** que leva
à tela certa:

1. Dados do estabelecimento (nome, logo, endereço)
2. Colaboradores (caixa, garçom, cozinha, com PIN)
3. Produtos (cadastrar ou importar a planilha)
4. Nota fiscal (token da Brasil NFe e série)
5. Impressoras (instalar o agente e parear)
6. Primeira venda de teste

Passo feito fica riscado e marcado. O cartão some sozinho quando os seis estiverem feitos. Tem
"Esconder por enquanto" e reabre pela Ajuda. Só administrador vê.

## Restrições

- Front em JS puro, scripts clássicos, sem build (ver `CLAUDE.md`). Arquivo novo entra na ordem certa
  do `index.html`; rodar `node scripts/check-app.js`, `node scripts/check-load-order.js` e
  `node scripts/bump-version.js`.
- Escape com `h`/`jsArg`. Visual com os tokens e componentes existentes (`assets/css`).
- Entrada nova em `NOVIDADES` (`sistema/novidades.js`) ao publicar.
- Publicação só com o "sim" do dono, fora de perto do teste prático de 13/11 se tiver risco.
- Deploy é merge na `main` (GitHub Pages). Sem migration prevista; se precisar, pedir.

## Para o construtor decidir

- Como reconhecer "conta nova" para mostrar a tela (sugestão: sem `settings.atendimento` **e** sem
  produtos e sem vendas; o clube e o demo têm produtos). Onde guardar as escolhas
  (sugestão: `settings.atendimento = { socios, mesas, qtdMesas, balcao, cozinha }` e a data).
- Como cada passo da lista sabe que está feito (ex.: produtos > 0; emissor configurado pela ação
  `emissor` da função `nfce`; impressora pareada; existe venda fechada). Passo que não dá para
  conferir com segurança pode ser marcado à mão pelo dono.
- Onde o cartão aparece exatamente (topo do Caixa ou da Ficha, conforme a escolha) e onde fica o
  "Esconder" (preferência do aparelho em `localStorage` está bom).
- O que "Balcão com ficha" muda na prática (abrir na Ficha depois do login, ordem do menu).
- O que fazer se outra parte do app espera a estação `cozinha`/`bar` existir (conferir antes de
  remover a semeadura; o produto já usa `estacao` e `kitchenItem`; `fiscal-produto.js:52` trata
  `'bar'` à parte; a impressora pede uma estação, `impressao-automatica.js:453`).
- Modo local: seguir igual ou manter como está.
- Testar na bancada local (`../auditoria-2026-11-03`) com um estabelecimento novo e conferir que o
  clube continua igual.
