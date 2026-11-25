# Clientes: cota no topo, ordenar pela coluna e barra de pesquisa (24/11/2026)

Pedido do dono: no cadastro do cliente a cota é o primeiro dado preenchido, mas fica na aba "Dados Secundários"; e a lista de Clientes deve ter a mesma ordenação por coluna e a mesma barra de pesquisa da tela de Produtos.

## O que muda (só `assets/js/cadastros/associados.js`, sem banco)

1. **Cota acima do Nome.** No modal Novo/Editar Cliente, a primeira linha de "Dados Principais" é o campo `mCode` (Cota / Código). Sai de "Dados Secundários" (ficam Tags, pontos, observações, LGPD). O id `mCode` não muda, então o salvar continua igual.
2. **Ordenar pela coluna.** Igual a Produtos (`COLUNAS_PRODUTOS`/`ordenarProdutosPor`): clique no título ordena ▲, o segundo ▼, o terceiro volta à ordem normal. Todas as colunas, inclusive Saldo Devedor quando visível. Cota compara como número quando os dois lados são números (2 < 18 < 180), senão como texto; Qtd. Pedidos e Últ. Pedido por número/data; vazios no fim. A ordem sobrevive à pesquisa (a pesquisa só esconde linhas).
3. **Barra de pesquisa.** Mesmo visual da de Produtos (`op-search` com ⌕, "Pesquisar cliente..."), filtrando ao digitar. Sai o botão "Buscar". Fica o seletor "Busca Padrão / Cota / Nome / Telefone / Endereço" (a busca por cota exata é pedido do dono de 15/11). O filtro por coluna deixa de depender da posição da célula (`cells[1]`…) e passa a usar `data-` próprios da linha, para não quebrar com colunas novas.

## Abordagens consideradas

- **Copiar o padrão de Produtos dentro de `associados.js`** (escolhida): mesmo comportamento que o dono já usa, sem mexer em Produtos.
- Extrair um ordenador genérico compartilhado pelas duas telas: mais limpo, mas mexe em Produtos sem pedido; fica para depois.
- Tirar o seletor de tipo e adivinhar pela digitação (só número = cota): perde a cota exata que o dono pediu.

## Fora do escopo

Busca de cliente dentro da comanda/pagamento; mudar Produtos.

## Decisões do Claude

Ordem normal = a atual (ordem de cadastro); vazios no fim nas duas direções; novidade `2026-11-24-clientes-cota-ordenar` em `sistema/novidades.js`.
