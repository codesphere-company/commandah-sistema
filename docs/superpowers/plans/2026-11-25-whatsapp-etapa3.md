# WhatsApp — Etapa 3 (Pix copia e cola e Mandar conta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** O caixa manda a conta da comanda pelo WhatsApp do estabelecimento: texto com os itens e o total, o Pix copia e cola numa mensagem sozinha, o QR do Pix e o pedido do comprovante. A comanda fica "Conta enviada · aguardando Pix" até o caixa dar baixa como hoje.

**Architecture:** O BR Code (Pix estático com valor, padrão EMV do Banco Central, CRC16) é montado no navegador por `core/pix-brcode.js` a partir de Configurações (chave Pix, nome e cidade de quem recebe); o QR sai da `QRCode` (qrcodejs) que o app já carrega, em PNG. A função `whatsapp` ganha a ação `enviar_conta`, que manda as 4 mensagens em ordem pela Evolution (`sendText` e `sendMedia`) e grava cada uma como saída. A marca "conta enviada" fica no JSON da venda (`sale.contaEnviada`), gravado pelo `save('sales')` de sempre: sem migration.

**Tech Stack:** igual às etapas 1 e 2.

**Spec:** `docs/superpowers/specs/2026-11-25-whatsapp-design.md` (etapa 3). Telas aprovadas: https://claude.ai/artifact/HnigvmnkXEXP9Wf5DEAta2#artboard-FecharComanda e `#artboard-Celular`.

## Global Constraints

- Conta nunca vai para colaborador (o fiado dele é descontado do salário). Só sócio/cliente com telefone ou com conversa ligada.
- Sem botões no WhatsApp; o Pix copia e cola vai numa mensagem só com o código (fácil de copiar).
- Pix estático: o caixa confere o comprovante e dá baixa como hoje (sem confirmação automática).
- Valor da conta = o total que a comanda mostra (`gcComandaTotals`: consumo + serviço − crédito do sócio − desconto do colaborador + pendência anterior − parcial).
- Destino: a conversa já ligada ao cliente (`whatsapp_conversas.member_id`, cobre `@lid`); sem ela, o telefone do cadastro com 55 na frente.
- Plano Pro e permissão `whatsapp` (dono, admin, caixa), como a etapa 2.
- Nada em produção sem o "sim" (deploy da função, merge).

## Review Focus

- Chave Pix com pontuação (CNPJ "12.345.678/0001-90"), e-mail, telefone (+55) e aleatória: código válido (CRC confere) em todos.
- Nome e cidade com acento ou longos: sem acento e cortados em 25/15 caracteres.
- Evolution cai no meio (texto foi, QR não): erro na tela, a comanda não fica marcada como enviada, mensagens já enviadas ficam no chat.
- Cliente sem telefone e sem conversa: o botão explica, não chama a função.
- Total com crédito, serviço e parcial: o valor do Pix é o mesmo "Total" da comanda.

---

### Task 1: Gerador do Pix copia e cola

**Files:** Create `assets/js/core/pix-brcode.js`; modify `assets/js/sistema/configuracoes.js` (campos "Nome de quem recebe" `cfgPixNome` e "Cidade" `cfgPixCidade` ao lado da chave Pix; `settings.pixNome`, `settings.pixCidade`), `index.html` (tag depois de `core/calculos.js`). Test: `../auditoria-2026-11-03/e2e/t74-pix-brcode.js` (Node, carrega o arquivo com `vm`).

**Interfaces:** `pixBrCode({ chave, nome, cidade, valor, txid='***' }) -> string` (lança `Error` em português se faltar chave, nome ou cidade, ou valor ≤ 0 quando informado); `pixCrc16(texto) -> 'XXXX'`; `pixNormalizarChave(chave) -> string` (CPF/CNPJ só dígitos, e-mail minúsculo, telefone `+55…`, aleatória como veio).

- [ ] Teste: exemplo oficial do manual do BR Code (chave aleatória `123e4567-e12b-12d1-a456-426655440000`, "Fulano de Tal", "BRASILIA", sem valor) dá exatamente `00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D`; com valor 34 aparece `540534.00`; CNPJ com pontuação vira só dígitos; acento sai e nome/cidade cortados em 25/15; CRC de cada código confere recalculado; sem chave lança erro.
- [ ] RED → implementar → GREEN. Commit `feat(pix): Pix copia e cola com valor (BR Code) (etapa 3)`.

### Task 2: Função manda a conta

**Files:** `supabase/functions/whatsapp/index.ts`; `../auditoria-2026-11-03/e2e/fake-evolution.js` (rota `POST /message/sendMedia/:nome`); test `e2e/t75-whatsapp-conta-funcao.js`.

**Interfaces:** `{ action:'enviar_conta', jid, texto, brcode, qr_png, rodape, valor }` → manda `texto`, `brcode`, a imagem (`mediatype:'image'`, `mimetype:'image/png'`, `media:qr_png` sem prefixo, legenda "QR do Pix · R$ X") e `rodape`, nessa ordem; grava cada saída com `enviada_por`; devolve `{ ok, enviadas: n }`. `brcode` precisa começar com `000201` e ter CRC válido; `qr_png` base64 até 200 KB; texto 1–4096. Falha no meio → 503 com `enviadas` e nada mais é mandado.

- [ ] Teste: caixa manda a conta → a fake recebe 3 textos e 1 imagem na ordem certa e o banco tem 4 saídas; brcode com CRC errado = 400; sem Pro = 402; Evolution falha na imagem = 503 com `enviadas: 2` e só 2 saídas.
- [ ] RED → implementar → GREEN; t72 e t69 continuam ok. Commit `feat(whatsapp): mandar a conta com Pix pela função (etapa 3)`.

### Task 3: Mandar conta na comanda e no WhatsApp

**Files:** Create `assets/js/vendas/conta-whatsapp.js`; modify `vendas/comandas.js` (botão "Mandar conta pelo WhatsApp" em `.cash-order-links`, só com permissão `whatsapp` e cliente que não é colaborador; selo "Conta enviada · aguardando Pix" no topo da comanda), `vendas/localizar-produto.js` (selo na lista de comandas), `operacao/whatsapp.js` (botão "Mandar conta com Pix" no painel do cliente com comanda aberta; filtro "Conta enviada"), `index.html`, `assets/css/componentes.css`, `sistema/novidades.js`. Test: `e2e/t76-whatsapp-mandar-conta.js`.

**Interfaces:** `abrirMandarConta(saleId)` abre a janela da tela aprovada (destino, "Junto: Pix copia e cola e QR de R$ X" — desligado com aviso se faltar chave/nome/cidade —, prévia do texto, Cancelar / Mandar conta pelo WhatsApp); `contaWhatsappTexto(sale) -> string`; ao mandar: `sale.contaEnviada = { em, por, valor, jid }` e `save('sales')`.

- [ ] Teste: botão aparece para sócio com telefone e não para colaborador; janela mostra o telefone e o total; mandar → fake recebe texto com os itens e "Total: R$ …", o brcode com o mesmo valor do total e a imagem; comanda mostra "Conta enviada"; lista de comandas também; sem chave Pix a opção de Pix fica desligada e vai só o texto; Evolution fora → erro e sem selo; WhatsApp › painel do cliente tem "Mandar conta com Pix"; filtro "Conta enviada"; sem erro no console.
- [ ] RED → implementar → GREEN; t73, t70 e t57 ok; bump e checagens. Commit `feat(whatsapp): mandar a conta da comanda com Pix (etapa 3)`.
