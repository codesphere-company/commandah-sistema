# Relatórios detalhados — desenho

Data: 10/11/2026. Pedido da Vanessa, repassado pelo dono. Rascunhos das telas aprovados pelo dono no navegador, com os ajustes registrados aqui.

## Por que existe

O sistema ainda não está em uso no clube. Antes da virada, a Vanessa pediu relatórios para acompanhar quem deve, o que foi vendido, o que cada garçom vendeu e quais cupons foram emitidos. O dono pediu o máximo de detalhe, com os itens de cada compra, e precisa mandar os cupons ao escritório de contabilidade.

Hoje parte disso existe, mas espalhada em telas diferentes, e o restante falta.

## Objetivos

1. Saber quantos clientes devem, quanto, desde quando e quando compraram pela última vez.
2. Abrir a conta de um cliente e ver tudo: cada compra item a item (fiado ou paga na hora), cada pagamento, saldo e o que a pessoa mais compra.
3. Consultar vendas por data e forma de pagamento (crédito e débito separados), com os itens de cada venda.
4. Ver o que cada garçom vendeu, com data, itens e valor.
5. Ver o que mais vende em um período, com números corretos para aquele período.
6. Listar os cupons fiscais e extrair um pacote para a contabilidade.

## Fora deste projeto

- Comissão de garçom.
- Corrigir a tela Recebimentos, cujos filtros Todos, Fiado, Pedidos e Avulsos não filtram e que não lista pagamentos de fiado. Fica como pendência separada.
- Mudar a conta do fechamento de caixa. A regra de comanda aberta que passa de um caixa para outro (OP-14) continua como está.

## O que seria um fracasso

- Número que diverge sem explicação entre relatórios. O que conta como venda segue `saleCountsAsRevenue`, e o dia da venda é o dia do pagamento (ver "Data das vendas").
- Filtro que parece filtrar e não filtra. Todo controle na tela precisa funcionar, ou não aparece.
- Nota de homologação no pacote da contabilidade.

## Data das vendas

Decisão do dono (10/11): as vendas contam pela data de pagamento, não pela de abertura. Na prática, é o dia em que a venda fechou (`closedAt`), que também é quando a NFC-e sai.

- Comanda aberta à noite e paga no dia seguinte conta no dia seguinte.
- Venda no fiado conta no dia em que foi fechada. O pagamento posterior da dívida aparece na conta do cliente e não vira venda de novo.
- Comanda com pagamentos parciais em dias diferentes conta inteira no dia em que fechou.

A mesma regra vale para o que já existe e hoje conta pela abertura (decisão do dono, 10/11): Resumo do Dia, "Vendido hoje" da barra lateral e planilha do contador. Todos usam `saleRevenueDay`, que passa a ser `localDay(s.closedAt||s.openedAt)`. Comanda ainda aberta não tem `closedAt`, então continua no dia em que abriu, como "a receber" no Resumo do Dia. Os textos dessas telas que falam em "dia em que a venda abriu" precisam ser reescritos.

## Os relatórios

Todos ficam na aba Relatórios, com Imprimir e Exportar Excel. "Exportar Excel" gera `.xlsx` de verdade com a SheetJS já usada (`loadXlsx`) e traz todas as linhas filtradas, mesmo que a tela limite o que mostra. Antes de calcular, chamar `fetchFreshSales` quando existir.

### 1. Conta do cliente (novo)

**Lista.** Indicadores: clientes devendo, total em aberto, devendo há mais de N dias. N começa em 7 e pode ser alterado na própria tela.

Colunas: cliente, cota, saldo devedor, última compra, último pagamento, devendo desde. Filtros: busca por nome ou cota, "Só quem deve" (ligado por padrão), "Incluir arquivados" (desligado por padrão, para o total bater com o Resumo do Dia).

- "Devendo desde" e os dias em aberto vêm de `fiadoOpenDebts`, que quita primeiro as dívidas mais antigas.
- "Última compra" é a venda fechada mais recente do cliente, paga ou no fiado, pelo `closedAt`.
- "Último pagamento" é o `payment` mais recente do `debtHistory` que não foi estornado.

**Conta aberta.** Período (De/Até) com resumo: saldo devedor, comprou, pagou, número de compras. Filtros que funcionam: compras no fiado, compras pagas na hora, pagamentos.

Linha do tempo, da mais recente para a mais antiga:

- Compra: data, tipo e número do pedido, forma de pagamento, total. Abaixo, cada item com quantidade (ou kg), nome, tamanho e opções (`customizationLines`), observação, quem lançou e a que horas (`addedBy`, `addedAt`), valor. Item cancelado aparece riscado, com `canceledBy` e horário quando existirem. Desconto, desconto do colaborador e serviço aparecem quando houver.
- Pagamento: data, forma (`fiadoMethodLabel`), valor, quem recebeu, saldo depois.
- Lançamento sem venda, como "Saldo inicial (importação de planilha)": aparece como linha simples, sem itens.
- Estornos aparecem marcados e não contam nos totais.

A ligação entre lançamento e venda é o `sale_id` do lançamento. Compra paga na hora vem de `state.sales` pelo `memberId`. Uma venda parte fiado e parte paga aparece uma vez só, com as duas formas.

"O que mais compra": produto, quantidade, valor, última vez, no período escolhido, sem itens cancelados.

Só clientes cadastrados têm conta. Venda avulsa, sem cadastro, não entra aqui.

### 2. Vendas (novo)

Filtros: De/Até, forma de pagamento, tipo de pedido, produto, cliente. Período pela data de pagamento (`closedAt`).

Indicadores: faturamento, vendas, ticket médio, itens vendidos. Tabela por forma, uma linha para cada forma com valor (`colunasDeFormas`), então crédito e débito ficam separados e formas criadas pelo estabelecimento aparecem sozinhas. Abaixo, cada venda com seus itens, no mesmo formato da conta do cliente.

Venda com duas formas: o filtro mostra a venda se qualquer pagamento for daquela forma. A tabela por forma soma só a parte paga nela, e a tela avisa que o faturamento mostrado é o total das vendas encontradas.

Vendas canceladas ficam de fora, com a opção "Mostrar canceladas".

### 3. Vendas dos garçons (novo)

Filtros: De/Até (data de pagamento da venda) e garçom. Resumo por pessoa: comandas atendidas, itens lançados, valor vendido. Ao escolher uma pessoa: data e hora, comanda, cliente, item, quantidade, valor.

Cada item conta para quem o lançou (`addedBy`, com `operatorName` da venda como reserva), mesmo que outra pessoa tenha aberto ou fechado a comanda. O valor é quantidade × preço, sem desconto nem serviço, e a tela avisa que por isso não bate exatamente com o faturamento. Itens cancelados não contam. Entra quem lançou algo, seja garçom ou caixa.

### 4. Produtos: Mais Vendidos (corrigir o existente)

Hoje o filtro de data só esconde produtos sem venda no período, e quantidades e valores continuam sendo de todo o histórico. Passar a recalcular pelo período, pela data de pagamento, como já foi feito no Ranking (`applyRankingFilter`).

Acrescentar filtro de categoria na aba de produtos e a coluna "Quem mais compra": o cliente cadastrado com maior quantidade naquele produto e período. Produto por peso continua em kg.

### 5. Cupons fiscais (novo)

Lê `nfce_notas` sem a coluna `xml`, com `ambiente = 1` (produção). Filtros: De/Até (`created_at` no dia local) e situação (autorizada, cancelada, rejeitada, erro). Indicadores: autorizadas, valor autorizado, rejeitadas ou com erro.

Colunas: número, série, data e hora, pedido, valor, situação (com motivo, se houver), chave. Reimprimir usa `printNfceDanfe` nas autorizadas. O número do pedido vem de `state.sales` pelo `sale_id`.

Botão "Exportar para a contabilidade": gera `.zip` do período escolhido, nomeado `commandah-nfce-AAAA-MM-DD-a-AAAA-MM-DD.zip`:

- `notas.xlsx`: número, série, data e hora, pedido, valor, situação, motivo, chave, protocolo, cancelada em, protocolo do cancelamento, motivo do cancelamento, emitida por.
- `autorizadas/<chave>.xml`.
- `canceladas/<chave>.xml` e `canceladas/<chave>-evento-cancelamento.xml`.

Rejeitadas e erros entram só na planilha, pois não têm valor fiscal. O XML é buscado só ao exportar. Gravar no log com `logAction`.

Biblioteca do zip: JSZip em versão fixa pelo `cdn.jsdelivr.net`, com SRI, carregada só na hora, no mesmo modelo de `loadXlsx`. Esse endereço já está na meta CSP, que não precisa mudar.

**XML do cancelamento.** O dono informou que o XML é necessário para o cálculo de imposto. Sem o evento, o XML original de uma nota cancelada pode ser importado como venda válida, e o imposto sairia a mais. Por isso o evento entra no projeto.

Hoje o sistema guarda o XML original e o protocolo do cancelamento, mas não o XML do evento. É preciso:

1. Testar em homologação se a resposta de `CancelarNotaFiscal`, ou a consulta com `RetornarArquivos: true`, devolve o XML do evento. A documentação pública não confirmou isso.
2. Criar migration nova com a coluna `xml_cancelamento` em `nfce_notas`.
3. Gravar esse XML na Edge Function `nfce`, no momento do cancelamento.

Migration e deploy da Edge Function dependem do "sim" do dono. Se a Brasil NFe não entregar o arquivo pela API, a alternativa é baixar no portal dela. Nesse caso, a planilha marca a nota como cancelada, com protocolo, e a pasta `canceladas/` leva um aviso em texto.

## Restrições

- Sem build e sem módulos. Scripts clássicos, ordem definida em `index.html`.
- Escape com `h` e `jsArg`. Interface e comentários em português.
- Rodar `node scripts/bump-version.js` e as checagens do `CLAUDE.md`.
- Serve para bar, lanchonete e clube: textos com "Cliente" e formas lidas da configuração, nada fixo do clube.
- Permissões: os relatórios 1 a 4 exigem `relatorios-gerencia`. O 5 também, e a leitura no banco já é limitada a administrador e caixa.
- Ao publicar, acrescentar entrada em `NOVIDADES` (`sistema/novidades.js`).

## Escolhas de quem desenhou (não vieram do dono)

- "Última compra" considera qualquer compra, não só no fiado.
- Os 7 dias podem ser alterados na tela.
- Arquivados ficam fora por padrão.
- Garçom recebe o crédito por item lançado.
- Data de pagamento entendida como o dia do fechamento da venda, inclusive no fiado e nos pagamentos parciais.
- Rejeitadas e erros ficam só na planilha do pacote.

## A cargo de quem construir

- Dividir o código em arquivos novos em `assets/js/gestao/` (`relatorios.js` já está grande) e registrar os itens em `RIBBON_TABS`.
- Um único componente para desenhar venda com itens, usado na conta do cliente e em vendas.
- Limite de linhas na tela, seguindo o padrão de 3000 do Histórico de Itens Vendidos.
- Ordem de construção. Sugestão: componente de itens, conta do cliente, vendas, garçons, Mais Vendidos, cupons.
- Conferir no Chrome e na bancada local (`../auditoria-2026-11-03`) antes do merge.
