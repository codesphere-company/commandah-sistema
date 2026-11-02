# Tamanhos e grupos de opções — desenho

Data: 02/11/2026. Conversa de origem: dono do Commandah (Clube Olímpico, Maringá) com o Claude.
Referência visual: telas do Consumer em `downloads/WhatsApp Image 2026-11-02 at 1.31.41 PM.jpeg` (açaí, aba Tamanhos) e `... 1.46.52 PM.jpeg` (talharim, aba Principal); planilha `downloads/Produto por Tamanho (34).xlsx` (grades usadas no Consumer).

## Por que

O dono não conseguiu cadastrar o açaí no copo (300ml com até 2 acompanhamentos, 500ml com até 3), nem os produtos por tamanho que vieram do Consumer (talharim, parmegiana, porções, mini pastéis, refrigerantes, sucos). Hoje o sistema tem três cadastros que se sobrepõem e não resolvem o caso:

- **Tipos e Tamanhos** (`state.complementos`, `recordKind` `type`/`size`): o tamanho tem só "preço adicional" sobre o preço do produto, e não tem limite de opções. O Clube cadastrou dois "tipos" (Açai 300ML, Açai 500 ML) sem nenhum tamanho dentro: o modelo confundiu.
- **Complementos**: lista única e global, sem limite de quantidade, sempre cobrada.
- **Perguntas**: múltipla escolha com máximo, mas presas ao produto, não ao tamanho.

Resultado: 30 produtos do Clube estão inativos com preço R$ 0 (`kind: 'tamanho'`, sem tamanho nenhum), e o açaí não tem como ser vendido.

O que o dono quer, nas palavras dele: "deixa configurável e que seja simples para cadastro, nada muito complexo para cadastrar e usar", e "precisamos pensar para qualquer estabelecimento, então não podemos limitar".

## Como o dono descreveu os casos reais

- **Açaí no copo**: 300ml R$ 18 e 500ml R$ 28. Acompanhamentos (confete, creme de avelã, granola, Kit Kat, leite condensado, leite em pó, paçoca, sonho de valsa…) inclusos no preço: até 2 no 300ml, até 3 no 500ml. Pode repetir o mesmo (2× granola). Pode pedir só o açaí. Não existe pegar mais do que o limite, nem pagando.
- **Talharim** (bacon e brócolis, bolonhesa) e **parmegiana** (carne, frango, tilápia): tamanhos Individual e Família.
- **Porções**: tamanhos em gramas, variando por produto: 200/400/800 (batata frita), 400/800 (batata rústica, iscas, mandioca, polenta), 300/600 (calabresa).
- Em outros estabelecimentos pode acontecer "2 inclusos e o terceiro custa R$ 3", e adicional pago (bacon extra).

## Objetivos

1. Cadastrar produto com tamanhos, cada tamanho com **preço cheio próprio** (não adicional).
2. Grade de tamanhos **reaproveitável** entre produtos (como o Consumer): Talharim e Parmegiana usam Individual/Família; as porções usam 400g/800g etc. O preço é de cada produto em cada tamanho.
3. **Grupos de opções** configuráveis, simples, cobrindo: inclusos com limite, inclusos + extras pagos, adicionais pagos, escolha obrigatória de 1 (ex.: molho, ponto da carne).
4. Funcionar em **todos os lugares onde se lança item** usados no dia a dia: PDV/balcão, comandas no caixa, app do garçom.
5. Ficha da cozinha/bar, monitor (KDS), estoque, relatórios e NFC-e corretos com tamanho e opções.

## Não-objetivos (agora)

- Pizza meio a meio / preço pela metade mais cara.
- Opção que abre outra opção (sub-grupos encadeados).
- Cardápio digital (QR) e totem com tamanhos e opções: fase 2 (ver "Canais" abaixo).
- Recadastrar os 30 produtos do Consumer: é tarefa de dados separada, depois da funcionalidade, com os preços passados pelo dono (a planilha só tem a faixa, ex.: batata frita "15,00 - 40,00").

## Anti-objetivos (seria fracasso mesmo funcionando)

- Cadastro que exige entender "tipo", "tamanho", "complemento", "pergunta" e "adicional" como coisas diferentes. Tem que ser: **grade → tamanhos → preço; grupo → opções → limites**.
- Operador precisar de mais de um toque por acompanhamento, ou conseguir passar do limite.
- Garçom lançar um item com tamanho sem escolher o tamanho, ou com preço R$ 0.
- Venda antiga (já registrada) aparecer quebrada em relatório, reimpressão ou comanda depois da mudança.

## Conceitos (o que o usuário vê)

### Grade de tamanhos
Lista de nomes de tamanho com sigla e ordem. Ex.: "Talharim/Parmegiana: Individual (I), Família (F)"; "Porção 400/800: 400g, 800g"; "Açaí: 300ml (P), 500ml (G)". **Não tem preço.** Cadastro em Cadastros → Grades de tamanho (substitui "Tipos e Tamanhos").

### Produto com grade
Na aba Principal do produto, campo **Grade de tamanhos** (vazio = produto sem tamanho). Com grade, aparecem à direita os cartões dos tamanhos, cada um com **Configurar →** (igual à tela do talharim no Consumer). Configurar abre a aba **Tamanhos** já no tamanho escolhido.

Na aba Tamanhos (igual à tela do açaí no Consumer): lista de cartões à esquerda (sigla, nome, preço, liga/desliga) e, à direita, o painel do tamanho selecionado:
- Preço de venda, preço de custo.
- Canais (PDV, Comanda Mobile, Cardápio QR, Totem), como já existe no produto.
- Ficha técnica do tamanho (insumos por unidade vendida).
- Grupos de opções do tamanho.
- Botão **Copiar para…** (copia grupos e regras para outro tamanho do mesmo produto, ou para o mesmo tamanho de outros produtos da mesma grade).

Produto sem grade continua como hoje (preço único) e também pode ter grupos de opções, na aba **Opções** do produto.

### Grupo de opções
Cadastrado uma vez (Cadastros → Grupos de opções, e também criável direto de dentro do produto): **nome** + lista de **opções**, cada opção com nome, preço (pode ser 0), ativo/pausado e ficha técnica opcional (para baixar estoque, ex.: granola).

Quando o grupo é colocado num tamanho (ou num produto sem grade), quatro regras **daquele vínculo**:

| Regra | Açaí 300ml | Açaí 500ml | "2 grátis, 3º R$ 3" | Adicional de lanche | Molho do talharim |
|---|---|---|---|---|---|
| Mínimo | 0 | 0 | 0 | 0 | 1 |
| Máximo | 2 | 3 | 5 | 5 | 1 |
| Inclusos no preço | 2 | 3 | 2 | 0 | 1 |
| Pode repetir | sim | sim | sim | não | não |

O mesmo grupo "Acompanhamentos açaí" serve ao 300ml e ao 500ml; só as regras mudam.

**Regra de preço, uma só:** o preço de uma opção só é cobrado para o que passar da quantidade de inclusos. Com inclusos 0 tudo é cobrado; com inclusos = máximo nada é cobrado.

## Como fica na venda (PDV, comandas e garçom)

Ao tocar num produto que tem grade ou grupos, abre a tela de escolha (rascunho aprovado: `2026-11-02-tamanhos-e-opcoes-mockups/tamanhos-grupos.html`):

1. **Tamanho** (se tiver grade): botões com nome e preço; obrigatório; só aparecem tamanhos ativos e liberados no canal.
2. **Cada grupo do tamanho**: título, contador "2 de 2", e cada opção com − e + (quantidade). Se "pode repetir" estiver desligado, cada opção vai de 0 a 1. Ao chegar no máximo, os "+" travam. Mínimo não atingido: botão Adicionar fica bloqueado com o aviso do grupo que falta.
3. **Total do item** atualizado ao vivo (preço do tamanho + extras cobrados).
4. **Observação livre** e as **Observações rápidas** que já existem continuam.

Toque rápido: produto com grade de um tamanho só e sem grupos entra direto, sem abrir a tela.

## Ficha, monitor, estoque, relatórios, NFC-e

- **Nome do item** na comanda, ficha, KDS, relatório e cupom: `PRODUTO - TAMANHO` (ex.: `TALHARIM BOLONHESA - FAMÍLIA`).
- **Ficha/KDS**: abaixo do item, uma linha por grupo: `Acompanhamentos: 2x Granola`. Extras cobrados aparecem com o valor. Observação livre continua em linha destacada (UX-07).
- **Estoque**: ficha técnica do tamanho escolhido (ou a do produto, se não tem grade) + ficha técnica de cada opção × quantidade escolhida.
- **Relatórios**: mais vendidos por produto e por tamanho; opções contadas com a quantidade.
- **NFC-e**: dados fiscais continuam os do produto (iguais para todos os tamanhos); valor do item = preço do tamanho + extras; descrição com o tamanho.
- **Itens iguais se juntam** só quando produto, tamanho, opções e observação são idênticos (já existe `customizationSignature`; passa a incluir tamanho e opções no formato novo).

## Canais

- Fase 1: PDV/balcão (`addDraftItem`), comandas no caixa (`npCart`, `comandaQuickCart`) e app do garçom (`gcAddToCart`). Hoje **só o PDV** abre personalização; comandas e garçom empurram o item direto com `p.price` — isso precisa mudar nos três.
- Delivery também entra na fase 1: passa por `addDraftItem`, então ganha a tela de escolha junto com o PDV (hoje há 1 venda delivery em 60 no banco).
- Fase 2: cardápio digital (QR) e totem. **Até a fase 2, produto com grade ou com grupo de mínimo ≥ 1 não aparece no cardápio digital nem no totem** (evita item sem tamanho ou com preço errado). Esse bloqueio é **regra no código** de `cardapio.js` e `totem.js` (olha `gradeId`/grupos), não pelas flags de canal — a flag `online` é a mesma do delivery e não pode ser usada para isso.
- Chaves de canal: as mesmas de hoje (`pdv`, `mobile`, `qr`, `online`), agora também por tamanho. `online` continua valendo para totem e delivery juntos, como já é; separar fica fora deste projeto (exigiria mudar dados em produção).

## Dados que existem hoje (levantado em 02/11/2026, produção)

- Perguntas: 0 cadastradas, 0 produtos usando. Complementos: 0 complementos; 2 "tipos" sem tamanho (Clube). Nenhum produto com `complementIds` ou `questionIds`.
- 31 produtos com `kind: 'tamanho'` (todos do Clube), todos sem `sizeIds` e **todos inativos**; 30 com preço 0. Nenhum combo cadastrado em nenhum estabelecimento.
- Ou seja: não há dado em uso para migrar. As telas antigas podem ser substituídas. Produto com `kind: 'tamanho'` e sem `gradeId` é tratado como produto normal (preço único), para nada quebrar no dia do merge.

## Decisões tomadas pelo Claude (o dono pode trocar)

1. **Substituir** as telas Tipos e Tamanhos, Complementos e Perguntas por Grades de tamanho e Grupos de opções. Observações rápidas ficam como estão. Os 2 "tipos" vazios do Clube são apagados na migração.
2. Quando há opções de preços diferentes e inclusos < escolhidos, os **inclusos cobrem as opções mais caras** (cobra-se as mais baratas). É o mais favorável ao cliente e não depende da ordem dos toques.
3. Estrutura dos dados fica em `app_data` como o resto do catálogo, **sem migration nova** se possível: grades e grupos dentro da chave `cantina2:complementos` (que já está na permissão "catálogo" do RLS), com `recordKind` novos (`grade`, `optionGroup`). Se o builder achar que uma chave nova é mais limpa, pode criar, mas aí entra migration (RLS por papel) e precisa do "sim" do dono para aplicar.
4. No produto: `gradeId`, e por tamanho `{ price, cost, active, channels, recipe, groups:[{ groupId, min, max, included, repeat }] }`; produto sem grade guarda `groups` no próprio produto. `kind: 'tamanho'` passa a significar "tem grade".
5. Item vendido guarda tudo copiado (nome e preço do tamanho e das opções no momento da venda), para venda antiga não mudar se o cadastro mudar. Leitura de vendas antigas no formato atual (`customization.size`, `answers`, `complements`) continua funcionando.
6. Cardápio digital e totem ficam para a fase 2, com o bloqueio descrito em "Canais".
7. **Combos**: na fase 1, o cadastro de combo não deixa escolher produto com grade nem produto com grupo de mínimo ≥ 1 (hoje não há combo nenhum). Combo com tamanho por componente fica fora.
8. Rascunhos de tela aprovados: `2026-11-02-tamanhos-e-opcoes-mockups/tamanhos-grupos.html` e `grade-tamanhos.html` (são fragmentos HTML; o servidor de rascunhos os envolvia num tema).

## Deixado para quem for construir

- Layout fino das telas, desde que siga os rascunhos e o padrão visual atual (janelas `op-window`, `record-modal`).
- Nome exato dos campos no JSON, desde que vendas antigas continuem legíveis.
- Como dividir em PRs (sugestão: 1. cadastro de grade e grupos; 2. produto com grade/tamanhos; 3. tela de venda no PDV; 4. comandas e garçom; 5. ficha/KDS/estoque/relatórios/NFC-e).
- Regras do projeto valem: JS clássico global, `h()`/`jsArg()` para escapar, `bump-version.js`, checagens do CI, conferir no Chrome e na prévia do Netlify, merge só com o dono.

## Depois da funcionalidade (tarefa de dados, separada)

Recadastrar no Clube, com os preços que o dono passar: grades Açaí (300ml/500ml), Individual/Família (talharim, parmegiana), Porção 200/400/800, 400/800, 300/600, Mini pastel 6/12, Refrigerantes, Sucos, Tábua de frios, Coxinha; e reativar os 30 produtos.
