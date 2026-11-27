# Cardápio: pedido avisado na hora ao caixa — desenho curto

27/11/2026, aprovado pelo dono.

**Por quê:** o pedido do celular fica em `cardapio_pedidos` e o caixa conferia a fila de 6 em 6 s; com a aba escondida o
Chrome segura essa conferência por até 1 min (um pedido levou 151 s; outro expirou). O dono confirmou que há sempre
pelo menos um caixa aberto no horário de funcionamento.

**Caminhos considerados:**
1. **Aviso em tempo real (Supabase Realtime) + reserva de 30 s — escolhido.** Pequeno; o lançamento continua igual.
2. Servidor processar sozinho — duplicaria a regra da comanda (tamanhos, opções, estoque, numeração, impressoras);
   desnecessário com caixa sempre aberto.
3. Encurtar a conferência para 1–2 s — muito mais tráfego e não resolve a aba escondida.

**Como:** migration `20261128020000_cardapio_aviso_na_hora.sql` põe `cardapio_pedidos` na publicação
`supabase_realtime` (a RLS `cardapio_pedidos_ler` — owner/admin/caixa do tenant — também filtra os avisos).
`operacao/cardapio-pedidos.js`: `cardapioAvisoAtualizar()` assina INSERT do tenant só no aparelho que processa
(`cardapioSouProcessador`) e desfaz quando deixa de processar; o aviso chama `cardapioTickPedidos()`; aviso com a
fila ocupada marca `cardapioPedidosDeNovo` e roda de novo ao terminar; reserva de 30 s (antes 6 s).
A trava `cardapio_pedido_pegar` continua garantindo que só um caixa pega cada pedido.

**Teste:** bancada `e2e/t98-cardapio-aviso.js` (aviso simulado; a bancada não tem Realtime) e `t90` ajustado. Prova
final: pedido real no clube com o caixa de aba escondida, medindo o tempo até a ficha sair.
