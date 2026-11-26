# Cardápio digital — etapa 1 (só para olhar)

Data: 26/11/2026. Aprovado pelo dono no chat ("pode seguir").
Proposta completa (5 etapas, telas, custos): https://claude.ai/artifact/VrseQnYg9FFVRc9TBGjr8K

## Por quê
O dono quer o cardápio na mesa do clube: o cliente lê o QR, vê fotos e preços e, nas próximas etapas, pede pelo celular (sócio na cota; visitante paga Pix/crédito/débito pelo caminho A, Itaú + e.Rede). A etapa 1 coloca o cardápio no ar só para olhar, sem pedido nem pagamento, para testar com os sócios e preparar a base.

## Objetivos
- Página pública `cardapio.html`, sem login, para celular: boas-vindas com a mesa e o horário da cozinha ("Peça ao garçom"), categorias em blocos com foto, produtos com foto, preço e tamanhos.
- Configurações › Cardápio digital: ligar/desligar, abrir como cliente, imprimir QR das mesas (um por local cadastrado).
- Só aparece produto ativo, liberado para o canal QR (`channels.qr !== false`) e que não seja "só no balcão" (`hiddenInSelfService`). Pausado some ao recarregar.

## Não objetivos (etapas seguintes)
Pedido, cota do sócio, código no WhatsApp, Pix/cartão, acompanhamento.

## Anti-objetivos
- Expor dado interno (custo, estoque, fiscal, tenant_id, nome de sócio).
- Voltar a subir o egress: o catálogo vai sem fotos; cada foto é baixada sozinha, com cache.

## Approaches
1. **Edge Function `cardapio` sem JWT (escolhido):** GET do catálogo filtrado e GET de cada foto (binário, `Cache-Control`). Base para pedidos e webhooks de pagamento nas próximas etapas.
2. RPC anônima no banco: abriria o banco para anon e devolveria foto em base64 sem cache.
3. Cópia publicada periodicamente: pausa não aparece na hora.

## Desenho
- `settings.cardapio = { ligado: bool, codigo: string }`. `codigo` é público e aleatório (gerado ao ligar; "Trocar código" invalida os QRs antigos). A função acha o estabelecimento pelo código em `app_data` (`cantina2:settings`), com service role.
- Função `cardapio` (GET, `--no-verify-jwt`, CORS do `_shared/cors.ts`):
  - `?c=<codigo>&m=<local>` → `{ ok, nome, logo, mesa, cozinha:{aberta, texto}, categorias:[{nome, foto}], produtos:[{id, nome, descricao, categoria, preco, foto:bool, tamanhos:[{nome, preco}]}] }`. Desligado/código errado → `{ ok:false, motivo:'indisponivel' }`.
  - `?c=<codigo>&foto=<produtoId>` → imagem binária (`Cache-Control: public, max-age=86400`); sem foto → 404.
  - Logo vai como foto especial (`foto=logo`).
- Página `cardapio.html` + `assets/js/cardapio-publico.js` + CSS próprio inline/arquivo; sem os scripts do app. CSP própria (só o endereço do Supabase).
- Admin: a área "Cardápio Digital" vira a tela de configuração (substitui os cartões "em breve"). QR com a qrcodejs que o app já carrega; impressão com `window.print()` numa folha só de QRs.

## Decisões do Claude
- Endereço: `commandah.com.br/cardapio.html?c=<codigo>&m=<id do local>`; mesa desconhecida mostra só o nome do clube.
- Horário da cozinha: usa `settings.kitchenHours` (mesma regra da cozinha).
- Tamanhos: mostra nome e preço de cada tamanho da grade do produto; adicionais ficam para a etapa 2.
- Ordem: categorias na ordem do cadastro de categorias; produtos por `sortOrder`.
