# Cardápio digital — etapa 2 (sócio pede e marca na cota)

Data: 26/11/2026. Aprovado pelo dono ("vai de A", "pode seguir"). Etapa 1: `2026-11-26-cardapio-etapa1-design.md`.

## Por quê
O sócio, na mesa do clube, pede pelo celular e o pedido cai na cozinha, sem esperar o garçom. Ele escolhe: marcar na cota (abre ou usa a comanda dele) ou pagar agora (Pix/crédito/débito, etapas 3 e 4, caminho A: Itaú + e.Rede).

## Approaches
- **A (escolhido):** a função grava o pedido numa fila; o computador "Caixa do app" pega e faz o mesmo que o app do garçom (comanda, cozinha, impressão). Reaproveita o código que já funciona; depende de um caixa aberto (sem caixa em 3 min o pedido expira e o cliente é orientado a chamar o garçom).
- B: o servidor faz tudo sozinho. Refaria no servidor a lógica de comanda/cozinha/impressão; mais demorado e arriscado antes da virada.

## Desenho
- Celular: carrinho (barra fixa), tamanho por botão, observação (140), "Levar na mesa" ou "Retirar no balcão" (QR sem mesa = só balcão). "Marcar na minha cota": cota → código de 4 números no WhatsApp do titular (tela mostra só o final do telefone) → "quem está pedindo" (titular ou dependente com "pode pedir") → mandar → acompanha até "na cozinha · comanda #N". Celular lembrado até as 4h (sessão assinada com CARDAPIO_SEGREDO). "Pagar agora" aparece como "em breve".
- Função `cardapio`: POST `codigo` / `confirmar` / `pedir`; GET `pedido` (situação). Preço sempre do cadastro (`conferirItens`); bloqueio por fiado com a regra do #369 (`bloqueadoPorFiado`); colaborador não pede; até 20 itens, R$ 500, um pedido a cada 30 s por cota; código: 10 min, 5 tentativas, 3 envios a cada 15 min. Dependente pedindo: titular avisado pelo WhatsApp.
- Banco: `cardapio_codigos` (só hash) e `cardapio_pedidos` (fila); `cardapio_pedido_pegar` (atômico, só pedido novo de até 3 min) e `cardapio_pedido_concluir`.
- App: `operacao/cardapio-pedidos.js` a cada 6 s no aparelho processador (caixa por operador: `caixaDoAparelho() === settings.caixaDoApp`; desligado: qualquer aparelho com o caixa), comanda como `gcSelectMember`, itens como `cartAddLine` + `buildCustomization` (tamanho), `sendItemsToKitchen(..., 'cardapio', local)`, `printNovoPedidoTickets` (origem 'app'). Apps › Cardápio Digital lista os pedidos de hoje.

## Decisões do Claude
- Produto com adicionais ou por quilo: "Peça ao garçom" nesta etapa.
- Observação vai no primeiro item (sai na ficha).
- Bancada: t90 (fluxo completo, 33 verificações).
