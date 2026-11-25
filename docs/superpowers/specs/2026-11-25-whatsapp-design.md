# WhatsApp no Commandah (25/11/2026)

Telas aprovadas pelo dono em 25/11: https://claude.ai/artifact/HnigvmnkXEXP9Wf5DEAta2 (8 telas).

## Por que

Os clientes falam com a lanchonete pelo WhatsApp, mas a conversa acontece fora do sistema. O caixa não vê quem é o cliente, nem a comanda dele, nem o fiado. Muitos sócios consomem, vão embora e pagam no outro dia. Hoje o fiado bloqueia o sócio, mas ninguém avisa o sócio do valor nem da hora em que a comanda fechou. O dono quer:

1. o chat do WhatsApp da lanchonete numa tela do Commandah, com aviso quando chega mensagem;
2. mandar a conta da comanda com Pix;
3. no fiado, mandar a conta sozinho na hora que a comanda fecha, com a hora, e avisar quando o pagamento libera a cota.

É recurso do plano Pro, não do plano básico.

## Decidido pelo dono

- Conexão pela **Evolution API** (WhatsApp Web, QR), não pela API oficial da Meta.
- **Número separado**, só da lanchonete (o risco de bloqueio do WhatsApp não pode derrubar o número que os clientes já usam).
- **Servidor alugado** (VPS) rodando a Evolution, um para todos os estabelecimentos.
- Só no **plano Pro**; no básico o item aparece com a marca "Pro" e uma tela explicando.
- Conta com itens, total, **Pix copia e cola e QR**. Sem botões (não funcionam de forma confiável no WhatsApp Web).
- **Fiado:** a conta vai sozinha ao fechar, com data e hora do fechamento, a pendência total e o aviso de cota bloqueada. Quando o pagamento zera a pendência, vai "cota liberada".

## Objetivos

- Tela WhatsApp: lista de conversas (todas, não lidas, conta enviada), chat, respostas prontas, painel do cliente ligado pelo telefone (cota, comanda aberta, saldo, "Mandar conta com Pix", "Vincular a um cliente" para número sem cadastro).
- Aviso em qualquer tela: toast com som, contador no menu.
- Configurações › WhatsApp: QR para conectar, situação, desconectar, opções de aviso e de conta, LGPD.
- Fechar comanda: "Mandar conta pelo WhatsApp" ao lado de "Receber agora"; a comanda fica "Conta enviada · aguardando Pix".
- Fiado: envio automático no fechamento; mensagem de liberação ao quitar.
- Fila "Não enviadas" com Reenviar quando falhar (sem telefone, desconectado, erro).

## Fora do escopo (agora)

- Pix dinâmico e confirmação automática de pagamento (exige intermediador; o caixa continua dando baixa).
- Robô que responde sozinho, IA, campanhas em massa (Disparador), API oficial da Meta.
- Enviar áudio/vídeo. Receber foto e PDF (comprovante) entra; mostrar áudio fica como "áudio recebido, ouça no celular".

## Não pode acontecer

- Mensagem de um estabelecimento aparecer em outro.
- Chave da Evolution no navegador ou nos aparelhos.
- Conta mandada para colaborador (o fiado dele é descontado do salário).
- Envio em massa ou para quem nunca teve relação com a lanchonete (é o que leva a bloqueio do número).
- Fechar o fiado travar porque o WhatsApp caiu: o fiado fecha sempre; a conta vai para "Não enviadas".

## Como funciona

### Servidor (VPS)

- Ubuntu, Docker Compose com: `evolution-api` fixada na **v2.3.8** (a 2.4 exige ativação no servidor de licenças deles e ainda está em teste), Postgres, Redis e Caddy (HTTPS automático).
- Endereço: subdomínio gratuito (DuckDNS) até haver domínio próprio.
- A chave global (`AUTHENTICATION_API_KEY`) fica só no servidor e nos segredos do Supabase (`EVOLUTION_URL`, `EVOLUTION_API_KEY`).
- Uma instância da Evolution por estabelecimento, com nome = `tenant_id`.
- Entrega: `infra/evolution/docker-compose.yml`, `.env.example`, `README.md` com o passo a passo para o dono rodar (ele cria a conta e paga o VPS).

### Função nova `whatsapp` (Supabase Edge Function)

- **Chamadas do app** (sessão do staff, como a `nfce`): `conectar` (cria a instância, liga o webhook, devolve o QR), `situacao`, `desconectar`, `enviar_texto`, `enviar_conta` (texto + imagem do QR), `marcar_lida`, `vincular_cliente`.
- Cada chamada confere: plano Pro do estabelecimento (`assinaturas.plano`), permissão `whatsapp` do usuário, instância do próprio `tenant_id`.
- **Webhook da Evolution**: a mesma função recebe `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`. A Evolution não assina o webhook, então a URL leva um segredo aleatório por instância (`?k=`), guardado no banco e comparado em tempo constante.
- Sem a chave da Evolution no app: todo envio passa pela função.

### Banco (migration nova)

- `whatsapp_instancias` (tenant_id, situação, número conectado, segredo do webhook, atualizado_em).
- `whatsapp_conversas` (tenant_id, jid, telefone, nome do contato, member_id, não lidas, última mensagem, etiqueta de conta enviada/paga).
- `whatsapp_mensagens` (tenant_id, jid, id da Evolution único, direção entrada/saída, tipo, texto, mídia, quem enviou, situação, criada_em).
- `whatsapp_envios` (fila "Não enviadas": tenant_id, motivo, conteúdo, tentativas).
- RLS por `current_tenant_id()` e permissão; escrita do webhook só pela função (service role).
- Apagar mensagens com mais de 90 dias (pg_cron, como a LGPD dos sócios), configurável.

### App (front)

- `assets/js/operacao/whatsapp.js`: a tela; item "WhatsApp" no menu com permissão `whatsapp`; sai o modal antigo "Bot WhatsApp" e o selo "Pro · em breve" dele.
- Mensagens novas pelo Supabase Realtime na tabela `whatsapp_mensagens`; se o Realtime cair, consulta a cada 10 s.
- Aviso: toast, som curto e contador no menu, só para quem tem a permissão.
- `assets/js/core/pix-brcode.js`: gera o Pix copia e cola estático (BR Code EMV com valor e CRC16) a partir da chave Pix, nome e cidade das Configurações; o QR sai com a biblioteca `QRCode` que o app já carrega.
- Fechar comanda (pagamento): opção "Mandar conta pelo WhatsApp".
- Fiado: no fechamento como fiado, se ligado e o cliente for sócio com telefone, envia sozinho; dependente → telefone do titular. Ao quitar o fiado (recebimento em Financeiro › Fiado ou no caixa) e a pendência zerar, envia "cota liberada".
- O texto de cobrança que já existe (`config.js`, link `wa.me`) continua no plano básico.

### Plano Pro

- Lido de `assinaturas.plano`. Para ligar o Pro no clube: um `update` no banco de produção, só com o "sim" do dono.

## Abordagens consideradas

- **Função própria no Supabase + Evolution no VPS** (escolhida): a chave fica no servidor, cada estabelecimento isolado, o chat mora no Commandah.
- Chatwoot (integração pronta da Evolution) embutido numa tela: chat pronto, mas é outro sistema com login e banco próprios, e não liga com comanda, cota e fiado.
- App falando direto com a Evolution: mais simples, mas expõe a chave global no navegador. Descartada.

## Etapas (cada uma publicável sozinha)

1. Servidor, função `whatsapp`, migration, Configurações › WhatsApp (conectar pelo QR).
2. Tela WhatsApp: receber, aviso, responder texto, vincular cliente, ver foto/PDF recebidos.
3. Pix copia e cola e "Mandar conta" no fechamento da comanda.
4. Fiado automático, liberação, fila "Não enviadas".

## Testes

- Bancada: um servidor falso da Evolution (`fake-evolution`) que responde às rotas usadas e dispara webhooks; testes e2e para cada etapa; teste do BR Code contra exemplos válidos (CRC conferido).
- Produção: conectar o número separado no clube e trocar mensagens de teste antes de ligar o fiado automático.

## Decisões do Claude

Evolution fixada na 2.3.8; subdomínio DuckDNS; uma instância por `tenant_id`; segredo do webhook na URL; Realtime com consulta de reserva a cada 10 s; apagar conversas com mais de 90 dias; a pendência total vai no Pix do fiado; dependente → titular; colaborador não recebe; fiado nunca trava por causa do WhatsApp; permissão nova `whatsapp` (Administrador e Caixa têm por padrão); receber foto/PDF sim, áudio só como aviso.

## Fica para quem implementar

Nomes de funções internas, formato exato do toast, ordem das conversas, texto das respostas prontas iniciais.
