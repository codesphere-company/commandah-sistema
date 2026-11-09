# Formas de Pagamento configuráveis e Conferência de pagamentos

Data: 09/11/2026. Pedido do dono. Sem prazo fixo: a data de virada é interna, e o critério é ficar certo para bar, lanchonete, restaurante e clube de associados.

## Por quê

Hoje a tela Formas de Pagamento quase não tem efeito:

- A janela de pagamento usa uma lista fixa no código (`methodConfig`, `vendas/pagamento.js`): Dinheiro, Pix, Crédito, Débito, Vale Refeição, Fiado e Outros.
- O app do garçom tem outra lista fixa (`GC_PAY_METHODS`, `operacao/garcom.js`).
- O recebimento de fiado tem uma terceira (`openFiadoEntry`, `gestao/financeiro.js`): Dinheiro, Cartão e Pix.
- A própria tela mostra uma quarta lista (Canal Online, Crédito, Débito, Cheque), que não bate com nenhuma das outras.
- Bandeiras, credenciadora e o vínculo entre eles são gravados, mas nada os lê.
- O fechamento soma Crédito e Débito em "Cartão" e põe Vale em "Outros" (`FORMAS_PAGAMENTO`, `core/config.js`).

O dono quer cadastrar as formas e poder usá-las, com o fechamento mostrando cada uma separada. Também quer prevenir o caso de um pagamento lançado no sistema sem ter sido pago. Isso nunca aconteceu; hoje quem descobriria é o escritório de contabilidade, olhando o banco.

## Objetivos

1. Uma lista só de formas de pagamento por estabelecimento, que decide o que aparece em todos os pontos de pagamento.
2. Fechamento de caixa e relatórios com uma linha por forma.
3. Conferência de pagamentos pelo administrador, com exportação para o escritório.
4. Servir bar, lanchonete, restaurante e clube de associados só por configuração.

## Fora do escopo

- Integração com banco, adquirente, TEF ou maquininha. A conferência é manual.
- Contas a pagar e receber (`gestao/contas.js`) mantêm a lista própria.
- Crédito do sócio (`creditApplied`) continua como está.

## O que não pode acontecer

- Venda, caixa ou nota parar de funcionar porque a configuração está vazia ou incompleta.
- Mudar total de venda já fechada ou o saldo de fiado.
- Renomear uma forma e o histórico se partir em duas.
- O operador de caixa ver o valor esperado (caixa às cegas, decisão de 06/11).
- A conferência travar venda ou caixa.

## Decidido pelo dono

- Cadastro em **botões de ligar e desligar** (modelo B), mostrando como aparece para o operador, em dois grupos: "Na hora de pagar" e "Ao receber fiado".
- O fechamento mostra separados: Dinheiro, Crédito, Débito, Pix, Pix fiado, Vale e Fiado.
- "Pix fiado" é o sócio pagando conta de fiado por Pix.
- O administrador confere no banco e marca como confirmado dentro do sistema.
- Funciona para qualquer tipo de estabelecimento, sem cortar escopo por causa da data.

## Como funciona

### 1. Tela Formas de Pagamento (Financeiro › Organização de Contas)

Só o administrador altera. Um botão por forma: verde quando ligada, cinza quando desligada. Clicar liga ou desliga naquele grupo. Um lápis em cada botão abre a edição. "+ Nova forma" abre a mesma janela vazia.

Janela de edição:

| Campo | Valores |
| --- | --- |
| Nome | Texto livre, único no estabelecimento |
| Tipo | Lista da tabela abaixo. Define o código da nota fiscal |
| Aparece | Na hora de pagar; ao receber fiado (os dois podem estar marcados) |
| Quem confere | Operador conta no fechamento; administrador confere no banco; ninguém confere |

Tipos e código fiscal (`tPag`):

| Tipo | tPag |
| --- | --- |
| Dinheiro | 01 |
| Cartão de crédito | 03 |
| Cartão de débito | 04 |
| Fiado / crédito da loja | 05 |
| Vale-alimentação | 10 |
| Vale-refeição | 11 |
| Vale-presente | 12 |
| Depósito bancário | 16 |
| Pix | 17 |
| Transferência ou carteira digital | 18 |
| Programa de fidelidade ou cashback | 19 |
| Outros | 99 |

Regras:

- Forma já usada em venda ou recebimento não pode ser apagada, só desligada.
- O tipo Fiado aparece só em "Na hora de pagar".
- O tipo Dinheiro e o tipo Fiado têm no máximo uma forma cada. Dinheiro é o que calcula troco, e Fiado é o que lança na conta do cliente.
- Pelo menos uma forma precisa ficar ligada em "Na hora de pagar".
- Bandeiras e credenciadora saem da tela. Os dados guardados não são apagados.

### 2. Formas iniciais

Todo estabelecimento começa com:

| Forma | Tipo | Na hora de pagar | Ao receber fiado | Quem confere |
| --- | --- | --- | --- | --- |
| Dinheiro | Dinheiro | Ligada | Ligada | Operador |
| Crédito | Cartão de crédito | Ligada | Ligada | Administrador |
| Débito | Cartão de débito | Ligada | Ligada | Administrador |
| Pix | Pix | Ligada | Ligada | Administrador |
| Vale | Vale-refeição | Ligada | Desligada | Administrador |
| Fiado | Fiado | Ligada | Não se aplica | Ninguém |

Um bar sem fiado desliga o Fiado. Um restaurante acrescenta Vale-alimentação ou "Pago online". O Clube Olímpico usa as iniciais como estão.

Até o administrador mudar algo, o estabelecimento funciona com essas iniciais. Elas equivalem ao que existe hoje, exceto que "Outros" deixa de ser um botão fixo.

### 3. Pontos de pagamento que passam a seguir a lista

- Janela de pagamento (`methodConfig`), mantendo os atalhos de teclado.
- App do garçom (`GC_PAY_METHODS`). O Fiado continua fora dele, e a regra do banco que recusa fiado do garçom não muda.
- Recebimento de fiado (`openFiadoEntry`). "Descontado do salário" continua à parte, só para administrador e colaborador.

Uma forma desligada some dos botões, mas continua aparecendo certa em vendas antigas.

### 4. Fechamento de caixa

- Uma linha por forma ligada, ou por forma desligada que teve movimento na sessão.
- Só as formas "Operador conta" pedem valor contado. No clube, só Dinheiro.
- As formas "Administrador" e "Ninguém" aparecem como informação para quem pode ver totais. O operador às cegas não vê valor esperado de nenhuma.
- Recebimento de fiado em dinheiro soma na linha Dinheiro, porque entra na gaveta.
- Recebimento de fiado em outra forma tem linha própria: "Pix fiado", "Crédito fiado" e assim por diante. Fica fora do total vendido no dia.
- A impressão do fechamento e o Histórico do Caixa seguem as mesmas linhas.

### 5. Relatórios

Resumo do Dia, Vendas por dia, Fechamentos de caixa e o export do contador trocam os 5 grupos fixos por uma coluna por forma.

As vendas antigas já guardam `credito` e `debito` separados, então o histórico também separa. O valor antigo gravado como `cartao` (recebimento de fiado em cartão) aparece numa linha "Cartão", só quando houver.

### 6. Conferência de pagamentos (nova, em Financeiro)

Só administrador, com permissão nova `conferir-pagamentos`.

- Lista os pagamentos das formas "Administrador confere", de vendas e de recebimentos de fiado: data, hora, valor, forma, comanda ou cliente, quem lançou e situação.
- Filtros: período, forma e situação. Totais por forma no topo, para comparar com o extrato.
- Situações: A conferir, Confirmado, Não recebido (com observação obrigatória).
- Marcar um por um ou vários selecionados de uma vez.
- Exporta a lista filtrada em planilha, para o escritório.
- Cada marcação vai para o log.
- "Não recebido" é só um registro: não muda venda, caixa nem fiado.

## Dados

- A lista continua na chave `cantina2:paymentMethods`, que todos os perfis de venda já leem, com os campos novos: id estável, nome, tipo, `tPag`, onde aparece e quem confere.
- Cada pagamento novo guarda o id estável da forma, o nome e o `tPag` daquele momento. Renomear não muda o histórico e a nota não depende da lista atual.
- As formas iniciais usam os ids que já estão nas vendas (`dinheiro`, `credito`, `debito`, `pix`, `vale`, `fiado`). O `outro:Nome` antigo continua sendo lido.
- A conferência fica em tabela nova, fora de `sales`, por tenant, com RLS só para dono e administrador e gravação por RPC. Motivo: não reescrever venda fechada nem disputar a versão dela.
- A função `nfce` passa a usar o `tPag` gravado no pagamento e, se não houver, a tabela atual.

## Publicação

Na ordem, com o "sim" do dono a cada passo: migration da conferência; deploy da função `nfce`; merge do front, com entrada em `NOVIDADES` e `?v=` novo; recarregar os aparelhos.

## Testes

- Banco: RLS e RPC da conferência por perfil.
- Telas: configurar e ver o efeito na janela de pagamento, no garçom e no fiado; fechamento às cegas e com totais; relatórios com vendas antigas e novas; renomear sem partir o histórico; forma usada sem poder apagar.
- Três configurações de ponta a ponta: bar sem fiado, restaurante com vale-alimentação, clube.
- NFC-e: `tPag` certo para cada tipo.

## A confirmar com o contador

Não bloqueia o projeto, mas muda valores da tabela de tipos:

1. Hoje "Vale Refeição" sai na nota com `tPag` 10, que é vale-alimentação. O código certo deveria ser 11.
2. Pix por QR estático ou chave deve sair como 20 em vez de 17?
3. Com cartão não integrado (`TipoIntegracao` falso), a nota dispensa bandeira e credenciadora?

## Escolhas do Claude (o dono delegou o desenho)

- Campos "Tipo" e "Quem confere"; lista de tipos; formas iniciais; Vale conferido pelo administrador.
- Tipos Dinheiro e Fiado limitados a uma forma cada.
- Bandeiras e credenciadora fora da tela.
- Conferência em tabela própria e marcação em lote.
- Contas a pagar e receber fora do escopo.

## Fica para quem construir

Disposição exata dos botões dentro do padrão visual atual, formato da planilha exportada e o id estável das formas novas, respeitando as regras acima.
