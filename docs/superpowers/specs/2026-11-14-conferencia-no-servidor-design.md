# Conferência da venda e das permissões no servidor (item 4 da auditoria)

Data: 14/11/2026. Item 4 da auditoria de lançamento de 11/11. O dono mandou seguir "com o que você acha melhor": as escolhas abaixo são do Claude e podem mudar.

## Por quê

Hoje o aparelho calcula o total da venda (itens, adicionais, peso, cupom, desconto do colaborador, crédito do sócio, serviço, parcial) em `assets/js/core/calculos.js` e `vendas/pagamento.js`. `close_sale` e `sales_apply` gravam o que chega. Quem mexer no que o aparelho envia fecha uma comanda de R$ 100 como R$ 10. As permissões próprias do operador de caixa (07/11) e a matriz de perfis só valem na tela.

Para o Olímpico é risco de fraude interna. Para vender a outros bares, o servidor precisa conferir.

## Objetivos

- O banco percebe uma venda fechada que não bate com o cadastro e com a própria venda.
- O dono vê essas vendas num relatório, com o motivo de cada uma.
- Depois de um período só registrando, um ajuste faz o banco recusar.
- As permissões de dinheiro que o dono personaliza ("cancelar comanda", "receber fiado") passam a valer no banco.

## Fora do escopo

- Refazer no servidor a conta inteira do aparelho (segunda cópia de todas as regras).
- Mexer no app do garçom ou no fluxo de pagamento além do necessário para mostrar a recusa.
- Permissões de cadastro e de tela que não envolvem dinheiro.

## O que não pode acontecer

- Venda legítima recusada numa sexta à noite por diferença de arredondamento ou por preço alterado no meio da comanda.
- Venda perdida: a conferência nunca impede a gravação enquanto o ajuste de barrar estiver desligado.

## Caminhos considerados

1. **Refazer a conta no servidor.** Exato, mas duplica `comandaTotals`, grade, adicionais, peso, cupom, crédito e serviço em SQL. Toda regra nova teria de ser escrita duas vezes, e qualquer diferença trava a venda. Grande e arriscado perto da virada.
2. **Conferir pisos e coerência (escolhido).** O banco não refaz o total: confere o que dá para provar barato. Nenhum item abaixo do preço de cadastro, a soma dos itens bate com o subtotal, desconto com cupom real, crédito até o que o sócio tem, pagamentos cobrindo o piso. Pega a fraude de "mandar valor menor" sem duplicar as regras.
3. **Só registrar quem mexeu (log).** Barato, mas não pega quem fala direto com a API.

O caminho 2 começa em modo só registro (sem barrar), para medir alarme falso antes de recusar.

## Desenho

### Conferência da venda (migration nova)

Uma função `public.venda_conferir(p_tenant text, p_sale jsonb) returns jsonb` devolve a lista de divergências (`[]` quando está tudo certo). Cada divergência tem `codigo`, `item` (quando houver) e os valores esperado e recebido.

Ela roda em `close_sale` e em `sales_apply` sempre que a venda gravada fica `status = 'closed'`, sem `canceled` (comanda inteira cancelada tem regra própria abaixo). Verificações:

1. **Preço abaixo do cadastro.** Para cada item não cancelado com `productId`, o produto é lido de `app_data` (`cantina2:products`). Sem peso: `item.price < product.price` (o `product.price` é o menor tamanho, e adicionais só somam). Com peso (`item.weight`): `weight.pricePerKg` menor que o preço por kg do cadastro, salvo `weight.override` com liberação registrada. Item sem `productId` ou com produto que não existe mais vira divergência `produto_desconhecido`.
2. **Subtotal.** A soma de `price × qty` dos itens não cancelados difere de `meta.subtotal` em mais de R$ 0,01.
3. **Cupom.** `meta.discount > 0` sem `meta.couponCode` que exista em `cantina2:coupons`, ou desconto maior do que o cupom permite.
4. **Desconto de colaborador.** `meta.staffDiscount > 0` com cliente que não é do tipo Colaborador, ou acima do percentual configurado.
5. **Crédito.** `meta.creditApplied` maior que o crédito disponível do sócio em `members` antes da venda.
6. **Pagamento abaixo do piso.** Soma de `payments[].amount` menor que `subtotal − staffDiscount − discount − creditApplied − partialPaid` menos R$ 0,01. O serviço fica fora do piso, porque o caixa pode tirá-lo.

### Modo só registro, depois barrar

- Com divergência, a venda é gravada normalmente e ganha `data.conferencia = { em, divergencias: [...] }`. Uma linha vai para `audit_log` com o colaborador e o aparelho.
- Ajuste novo em Configurações, só para admin/dono: **"Recusar venda que não bate com o cadastro"**, desligado por padrão. Ligado, `close_sale` e `sales_apply` recusam com erro próprio (`venda_divergente`, código `42501`) e o aparelho mostra o motivo em português.
- Plano: deixar desligado por uma semana de movimento real, olhar o relatório e só então ligar.

### Relatório

Em Relatórios (permissão `relatorios-gerencia`): **"Vendas com divergência"**, com período, pedido, colaborador, motivo legível e link para a comanda. Entrada em NOVIDADES.

### Permissões no servidor

Função `public.tem_permissao(p_token text) returns boolean`, espelho de `userPermissions` em `core/config.js`:

- dono e admin: sempre `true`;
- operador de caixa com lista própria (`user.permissions` no blob `cantina2:users`): vale a lista;
- os outros: a matriz salva em `cantina2:settings.rolePermissions`, com os tokens novos por versão (`ROLE_PERMS_NOVAS`), ou o padrão do perfil;
- garçom marcado "Pode operar caixa" com o caixa por operador ligado soma o perfil Caixa, como na tela.

Onde passa a valer:

- **`cancelar-comanda`.** Em `sales_apply` e `close_sale`, uma gravação que marca como `canceled` um item que estava ativo na versão gravada, ou que cancela a comanda inteira, exige o token. Quem não tem recebe `sem permissao para cancelar`.
- **`receber-fiado`.** Lançamento `type = 'payment'` sem `sale_id` (recebimento na Conta Corrente) exige o token ou `contas`. Pendência paga no fechamento e crédito de troco têm `sale_id` e continuam liberados, porque a tela de pagamento também não pede essa permissão.

Essa parte barra desde o primeiro dia: a tela já esconde esses botões de quem não tem a permissão, então quem é recusado está fora da tela.

## Publicação

Cada passo com o "sim" do dono: (1) migration; (2) merge do front com o relatório, o ajuste e a mensagem de erro, mais recarregar os aparelhos. Nenhuma função Edge muda.

## Fica com quem constrói

- Nome exato dos campos de preço por kg no cadastro e como `weight.override` registra a liberação.
- Formato do texto de cada motivo no relatório.
- Onde guardar o ajuste (provavelmente `cantina2:settings`, lido pela função).
- Testes na bancada `../auditoria-2026-11-03` (db e e2e), como nos itens anteriores.
