# WhatsApp — Etapa 2 (tela de conversas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mensagens que chegam no número da lanchonete aparecem numa tela WhatsApp no menu lateral, com aviso (toast, som, contador) em qualquer tela; admin e caixa respondem em texto, veem foto/PDF recebidos e ligam a conversa ao cadastro do cliente.

**Architecture:** O webhook da função `whatsapp` grava cada mensagem em `whatsapp_mensagens` e resume a conversa em `whatsapp_conversas` (RPC idempotente pelo id da Evolution). O app lê as duas tabelas pela RLS (admin/caixa do próprio estabelecimento) com consulta periódica — sem Realtime, como o caixa por operador — e envia pela função (`enviar_texto`). Foto/PDF não são copiados: a função busca na Evolution quando alguém abre (`midia`).

**Tech Stack:** igual à etapa 1 (Supabase, Deno, JS clássico, bancada Node + `fake-evolution.js`).

**Spec:** `docs/superpowers/specs/2026-11-25-whatsapp-design.md` (etapa 2). Telas: https://claude.ai/artifact/HnigvmnkXEXP9Wf5DEAta2#artboard-Main e `#artboard-Notificacao`.

## Global Constraints

- Só conversas individuais: `@g.us` (grupo), `status@broadcast` e `@newsletter` são ignorados.
- A conversa é identificada pelo `remoteJid`; o telefone vem de `key.remoteJidAlt` / `key.senderPn` quando o jid é `@lid`, senão do próprio jid.
- Ligação automática com o cliente: mesmo DDD + últimos 8 dígitos do telefone (cobre o 9º dígito ausente em números antigos); mais de um cliente igual = não liga sozinho.
- Ler e responder: dono, admin, caixa. A RLS confere estabelecimento e papel; gravação de mensagem só pela função (service role).
- Mensagens com mais de 90 dias são apagadas (pg_cron, igual à LGPD dos sócios).
- Aviso fora da tela a cada 10 s; dentro da tela, conversa aberta a cada 4 s. Som curto pelo WebAudio (sem arquivo novo).
- Nada em produção sem o "sim": migration, deploy da função, mudança no `.env` do VPS que reinicia a Evolution, merge.

## Review Focus

- Mensagem repetida pelo webhook (a Evolution reenvia): uma linha só e "não lidas" não dobra.
- Mensagem enviada pelo próprio celular da lanchonete (`fromMe`): aparece como saída e não conta como não lida.
- Caixa de um estabelecimento não lê conversa de outro (RLS) nem vincula cliente de outro.
- Texto com HTML/emoji: escapado na tela, sem quebrar o layout.
- Evolution fora do ar ao enviar: a mensagem não some do campo, aparece o erro.

---

### Task 1: Migration das conversas e mensagens

**Files:**
- Create: `supabase/migrations/20261126000000_whatsapp_conversas.sql`
- Test: `../auditoria-2026-11-03/e2e/t71-whatsapp-conversas-banco.js`

**Interfaces:**
- Produces: `whatsapp_conversas(tenant_id, jid, telefone, nome_contato, member_id → members on delete set null, nao_lidas int, ultima_texto, ultima_em, ultima_direcao, pk (tenant_id, jid))`; `whatsapp_mensagens(id uuid pk, tenant_id, jid, evo_id, direcao 'entrada'|'saida', tipo 'texto'|'imagem'|'documento'|'audio'|'outro', texto, arquivo_nome, mime, enviada_por, situacao 'enviada'|'entregue'|'lida'|'erro'|null, criada_em, unique (tenant_id, evo_id))`, índice `(tenant_id, jid, criada_em desc)`.
- RLS select nas duas para `tenant_id = current_tenant_id() and current_staff_role() in ('owner','admin','caixa')`; sem insert/update/delete para authenticated.
- `whatsapp_registrar_mensagem(p_tenant, p_jid, p_telefone, p_nome, p_evo_id, p_direcao, p_tipo, p_texto, p_arquivo, p_mime, p_enviada_por, p_criada_em) returns boolean` (service_role; true = inseriu; upsert da conversa; `nao_lidas+1` só em entrada nova; liga `member_id` pela regra do telefone se ainda nulo e houver exatamente 1 cliente ativo).
- `whatsapp_atualizar_situacao(p_tenant, p_evo_id, p_situacao)` (service_role; não volta de 'lida' para 'entregue').
- `whatsapp_marcar_lida(p_jid) returns void` e `whatsapp_vincular_cliente(p_jid, p_member_id) returns void` (authenticated; tenant e papel como a RLS; member de outro tenant = erro).
- Job pg_cron diário apagando `whatsapp_mensagens` com mais de 90 dias (só se a extensão existir, como na LGPD).

- [ ] **Step 1:** Escrever `t71`: registrar 2x o mesmo evo_id = 1 linha e nao_lidas 1; `fromMe` não soma; liga Maria pelo telefone `554499990001` (cadastro `44999990001`) e também pelo jid sem o 9; dois clientes com o mesmo final não liga; caixa do t-a lê, cozinha não lê, owner do t-b não lê; `marcar_lida` zera; `vincular_cliente` com member do t-b falha; authenticated não executa `registrar`; situação não volta de lida.
- [ ] **Step 2:** `bash db/up.sh …; node e2e/t71-…` → FALHA.
- [ ] **Step 3:** Migration.
- [ ] **Step 4:** Rodar de novo → ok; `t68` → ok.
- [ ] **Step 5:** Commit `feat(whatsapp): conversas e mensagens no banco (etapa 2)`.

### Task 2: Evolution falsa com envio e mídia

**Files:**
- Modify: `../auditoria-2026-11-03/e2e/fake-evolution.js`

**Interfaces:**
- Produces: `POST /message/sendText/:nome {number, text}` → 201 `{key:{id:'SAIDA<n>', remoteJid:number, fromMe:true}, message:{conversation:text}, messageTimestamp, status:'PENDING'}` (guarda em `fake.enviadas`); `POST /chat/getBase64FromMediaMessage/:nome {message:{key:{id}}}` → `{base64:'iVBORw0KGgo=', mimetype:'image/png'}` ou 400 se o id não estiver em `fake.midias`; helper `mensagem({id, jid, texto, fromMe, tipo, pushName, alt})` que monta o corpo `messages.upsert` no formato da v2.
- [ ] **Step 1:** Acrescentar rotas e helper; selftest com envio e mídia.
- [ ] **Step 2:** `node e2e/fake-evolution.js --selftest` → ok.

### Task 3: Função — receber, enviar e mídia

**Files:**
- Modify: `supabase/functions/whatsapp/index.ts`
- Test: `../auditoria-2026-11-03/e2e/t72-whatsapp-mensagens-funcao.js`

**Interfaces:**
- Consumes: Task 1 RPCs; Task 2 fake.
- Produces: webhook `messages.upsert` (um item ou lista em `data`) → `whatsapp_registrar_mensagem` (texto de `conversation`/`extendedTextMessage.text`/legenda; tipo pela chave da mensagem; `criada_em` de `messageTimestamp`); `messages.update` → `whatsapp_atualizar_situacao` (`DELIVERY_ACK`→entregue, `READ`/`PLAYED`→lida, `SERVER_ACK`→enviada, `ERROR`→erro).
- Produces: `{action:'enviar_texto', jid, texto}` (dono/admin/caixa, Pro, texto 1–4096) → `sendText` com `number: jid`; grava saída com `enviada_por` = nome do usuário; 503 com mensagem em português se a Evolution falhar. `{action:'midia', evo_id}` (dono/admin/caixa, mensagem do próprio tenant) → `{ok, base64, mime}`.
- [ ] **Step 1:** Escrever `t72`: webhook de texto grava e conta; repetido não dobra; grupo ignorado; `@lid` com `remoteJidAlt` grava o telefone certo; foto com legenda vira tipo imagem; `messages.update` READ marca lida; `enviar_texto` pelo caixa chega na fake e grava saída com o nome; texto vazio = 400; Evolution lenta = 503 e nada gravado; `midia` de mensagem de outro tenant = 404; `midia` própria devolve base64.
- [ ] **Step 2:** Rodar → FALHA. **Step 3:** Implementar. **Step 4:** `t72`, `t69` → ok. **Step 5:** Commit `feat(whatsapp): receber e responder mensagens na função (etapa 2)`.

### Task 4: Tela WhatsApp e aviso

**Files:**
- Create: `assets/js/operacao/whatsapp.js`
- Modify: `assets/js/core/config.js` (grupo `Atendimento` na aba `principal` com `{label:'WhatsApp', icon:ICN.bot, view:'whatsapp', perm:'whatsapp'}`), `assets/js/core/navegacao.js` (`SIDEBAR_LABELS.whatsapp`, contador no link), `index.html` (`<div class="view" id="view-whatsapp">` e a tag do script depois de `operacao/`), `assets/css/componentes.css` (estilos `wa-*`), `assets/js/sistema/novidades.js`
- Test: `../auditoria-2026-11-03/e2e/t73-whatsapp-tela-conversas.js`

**Interfaces:**
- Consumes: tabelas pela RLS (`supabaseClient.from('whatsapp_conversas')…`), RPCs `whatsapp_marcar_lida`/`whatsapp_vincular_cliente`, função `enviar_texto`/`midia`/`situacao`.
- Produces: `renderWhatsApp()`; `waIniciarAvisos()` chamado depois do login com a permissão (só liga se `situacao.plano_pro`); contador na lateral; toast "Nova mensagem no WhatsApp" com Responder (abre a conversa) e Depois; som.
- Layout do artboard Main: lista (pesquisa, Todas / Não lidas), chat (bolhas, data, situação da saída), campo + Enviar (Enter envia, Shift+Enter quebra linha), respostas prontas "Chave Pix" (de `settings.pixKey`, só se existir) e "Horário da cozinha" (do horário configurado, só se existir), painel do cliente (cota, nome, comanda aberta, saldo devedor) ou "Vincular a um cliente" (busca por nome/cota). Foto: botão "Ver foto" abre na hora; PDF: "Abrir PDF" baixa. Áudio: "Áudio recebido — ouça no celular". Em 390 px: lista e chat em telas separadas com Voltar.
- [ ] **Step 1:** Escrever `t73`: item na lateral para admin/caixa, não para cozinha/garçom; plano básico mostra a tela do Pro; mensagem nova (webhook) → contador 1 e toast em outra tela em até 12 s; Responder abre a conversa e zera o contador; enviar texto aparece como saída; HTML no texto aparece escapado; vincular cliente mostra a cota; "Ver foto" mostra a imagem; Evolution lenta ao enviar = erro e texto continua no campo; 390 px sem rolagem lateral; sem erro no console.
- [ ] **Step 2:** Rodar → FALHA. **Step 3:** Implementar. **Step 4:** `t73`, `t70`, `t57`, `t67` → ok. **Step 5:** bump + checks; commit `feat(whatsapp): tela de conversas e aviso de mensagem (etapa 2)`.

### Task 5: Evolution guarda a mensagem para a mídia

**Files:**
- Modify: `infra/evolution/.env.example` (`DATABASE_SAVE_DATA_NEW_MESSAGE=true`, comentário: necessário para buscar foto/PDF; apagar mensagens antigas no VPS fica em `infra/evolution/README.md`, seção Manutenção, com o comando SQL de limpeza > 90 dias), `infra/evolution/README.md`
- [ ] **Step 1:** Editar os arquivos.
- [ ] **Step 2:** Commit `docs(whatsapp): Evolution guarda mensagens para a mídia (etapa 2)`. Aplicar no VPS só no dia da publicação, com o "sim".
