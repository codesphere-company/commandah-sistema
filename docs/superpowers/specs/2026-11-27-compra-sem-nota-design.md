# Compra sem nota, produto novo pela nota e DRE — desenho

27/11/2026. Pedido do dono depois de ver as telas das notas de compra (artifacts de 27/11). Memória: `notas-compra`.

## Por quê

1. **Compra sem nota.** Alguns fornecedores não emitem nota (feira, produtor, padaria do bairro). Hoje a dona cadastra à mão em
   duas telas (conta a pagar e contagem do insumo), e a entrada fica sem custo e sem fornecedor.
2. **Produto novo pela nota.** Revenda que ainda não existe no cardápio obrigava a sair da nota, cadastrar o produto e voltar.
3. **DRE em dobro.** O DRE somava o custo da mercadoria vendida (ficha técnica) e também toda conta paga: a nota de mercadoria
   paga contava duas vezes.

## Como funciona

### Compra sem nota (`gestao/notas-compra-sem-nota.js`)
- Botão **Compra sem nota** na tela Notas de compra (quem tem `contas` ou `insumos`). Formulário: fornecedor (da lista ou novo,
  CPF/CNPJ opcional), data, nº do recibo (opcional), itens (nome, quantidade, unidade, valor total), foto do recibo (reduzida no
  aparelho, até 650 mil caracteres). "Usar os itens da última compra" repete nome e unidade do mesmo fornecedor.
- Salvar chama `notas_entrada_sem_nota_salvar` (migration `20261128030000_compra_sem_nota.sql`): linha em `notas_entrada` com
  `origem='sem_nota'`, chave `SN` + 32 hex, `fornecedor_id`, `recibo`, `dados` no formato do NotaLida (código do item = nome
  normalizado). Nunca é "tratada fora" (a data de início não mexe nela).
- A compra abre na tela da nota: mesmas escolhas por item, Confirmar, escritório, desfazer. **Corrigir** e **Excluir** só antes
  de qualquer etapa (`notas_entrada_sem_nota_excluir`).
- Vínculo lembrado por fornecedor: CNPJ/CPF quando há; senão `F:` + id do fornecedor (`notas_entrada_chave_forn`, também em
  `notas_entrada_estoque`, recriada).
- Fornecedor: só o administrador grava o blob `cantina2:fornecedores`. Administrador cria na hora; colaborador com `insumos`
  digita o nome e o cadastro nasce no Pagamento com o mesmo id (`ncnPagamento`).
- Lista: etiqueta "Sem nota" e filtro "Sem nota". Arquivo do mês: coluna Origem na planilha (sem XML no ZIP).

### Produto novo no cardápio (`gestao/notas-compra-nota.js`)
- Quinta opção por item, só para quem edita o catálogo. Nome (sugerido pela nota), preço de venda, categoria, preparo e fator.
- No Confirmar: insumo novo (un) + produto com ficha 1:1, código PDV automático, canais PDV e garçom (cardápio do QR desligado).
- Fiscal pelo XML (o leitor passou a ler CEST, CST/CSOSN e origem): com ST (CST 10/30/60/70, CSOSN 201–203/500 ou vICMSST)
  5405 / CSOSN 500 com o CEST; sem ST 5102 / 102 sem CEST; origem 1→2 e 6→7; `status:'conferir'`. **Validar com o escritório.**
  Sem NCM (compra sem nota) fica sem fiscal ("Sem código" em Produtos).

### DRE (`core/crud.js`, `gestao/relatorios.js`)
- Grupo DRE novo **Compra de mercadorias (estoque)**. Conta paga de categoria desse grupo (ou subcategoria sem grupo próprio)
  sai das Despesas Pagas e aparece na linha "Compras de mercadoria pagas (fora do resultado)".
- A data da conta (AAAA-MM-DD) passa a ser lida como dia local (01/12 caía em novembro).
- Na nota, sem categoria lembrada, vem a do grupo mercadoria quando há uma só.

## Testes (bancada `../auditoria-2026-11-03`)
t93 (85), t98 banco da compra sem nota (40), ler-xml (CST/CEST/ST), t94 função (61), t95/t96/t97 (93), t99 telas (43).
