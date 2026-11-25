# WhatsApp — Etapa 1 (servidor e conectar pelo QR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O administrador de um estabelecimento com plano Pro conecta o número separado do WhatsApp lendo um QR em Configurações › WhatsApp; plano básico vê a tela do Pro.

**Architecture:** Função nova `whatsapp` (Deno) é a única que fala com a Evolution (chave no servidor). Ela guarda a situação da conexão na tabela `whatsapp_instancias` (só service role) e recebe o webhook da Evolution por URL com segredo. O app chama a função e mostra QR/situação num modal no molde de `openNfceSettings`. A bancada roda a função real com um servidor falso da Evolution.

**Tech Stack:** Supabase (Postgres, Edge Function Deno/TS), JS clássico sem build, bancada Node (`../auditoria-2026-11-03`), Docker Compose (Evolution v2.3.8 + Postgres + Redis + Caddy).

**Spec:** `docs/superpowers/specs/2026-11-25-whatsapp-design.md` (etapa 1). Telas: https://claude.ai/artifact/HnigvmnkXEXP9Wf5DEAta2#artboard-Conectar e `#artboard-Bloqueado`.

## Global Constraints

- Evolution fixada na **v2.3.8**; chave global só em `EVOLUTION_API_KEY` (secret) e no servidor; nunca no navegador.
- Uma instância por estabelecimento, nome = `tenant_id`.
- Webhook: URL `${WHATSAPP_WEBHOOK_URL}?k=<segredo>`; segredo aleatório (32 bytes hex) por instância, comparado em tempo constante; função publicada com `--no-verify-jwt` (o webhook não tem JWT; as ações do app validam o JWT como a `nfce`).
- Plano Pro: `assinaturas.plano = 'pro'`. Conectar/desconectar: dono ou perfil admin. Ver situação: dono, admin, caixa.
- Nada em produção sem o "sim" do dono: migration, deploy da função, secrets, `update` do plano, merge.
- Português na UI, comentários e commits; escape com `h`/`jsArg`; `node scripts/bump-version.js` após mexer em `assets/`.

## Review Focus

- Webhook com segredo errado, ausente ou de outro estabelecimento: 401 e nada gravado.
- Evolution fora do ar ou lenta (timeout): o modal mostra erro claro e não fica girando; `situacao` devolve a última situação gravada.
- Conectar duas vezes (instância já existe na Evolution): reaproveita e só pede QR novo.
- Caixa abrindo o modal: vê a situação, não vê Conectar/Desconectar; a função recusa `conectar` vinda de caixa (403).
- Plano básico: a função não chama a Evolution e o app mostra a tela do Pro.

---

### Task 1: Migration `whatsapp_instancias` e plano Pro

**Files:**
- Create: `supabase/migrations/20261125000000_whatsapp_base.sql`
- Test: `../auditoria-2026-11-03/e2e/t68-whatsapp-banco.js`

**Interfaces:**
- Produces: tabela `public.whatsapp_instancias(tenant_id text pk → tenant_owners on delete cascade, situacao text check in ('desconectado','aguardando_qr','conectado') default 'desconectado', numero text, qr text, webhook_segredo text not null, atualizado_em timestamptz default now())`, RLS ligada, sem policy para `authenticated`/`anon`, `grant all to service_role`.
- Produces: `public.whatsapp_plano_pro(p_tenant text) returns boolean` (security definer, `assinaturas.plano = 'pro'`, sem linha = false; execute só service_role).
- Produces: `public.whatsapp_instancia_preparar(p_tenant text) returns text` (cria a linha se não existe com segredo `encode(gen_random_bytes(32),'hex')`, devolve o segredo; service_role).
- Produces: `public.whatsapp_instancia_atualizar(p_tenant text, p_situacao text, p_numero text, p_qr text) returns void` (service_role; `atualizado_em = now()`).

- [ ] **Step 1: Escrever o teste** `t68-whatsapp-banco.js` (molde de `db/sqltest.js`: conecta no Postgres 54329, `set role`):
  - `authenticated` não lê `whatsapp_instancias` (0 linhas ou erro de permissão);
  - `whatsapp_plano_pro('t1')` = false sem assinatura, false com `plano='padrao'`, true com `plano='pro'`;
  - `whatsapp_instancia_preparar` duas vezes devolve o mesmo segredo de 64 caracteres hex;
  - `whatsapp_instancia_atualizar(..., 'conectado', '5544999990000', null)` grava; situação inválida `'xyz'` dá erro de check;
  - `authenticated` não consegue `execute` nas três funções.
- [ ] **Step 2:** `bash db/up.sh > db/up.log 2>&1 </dev/null; node e2e/t68-whatsapp-banco.js` → FALHA (tabela não existe).
- [ ] **Step 3:** Escrever a migration (comentário de cabeçalho com o porquê e a data).
- [ ] **Step 4:** Rodar de novo up.sh e o teste → todos `ok`.
- [ ] **Step 5:** Commit `feat(whatsapp): tabela da conexão e plano Pro (etapa 1)`.

### Task 2: Servidor falso da Evolution e rota na bancada

**Files:**
- Create: `../auditoria-2026-11-03/e2e/fake-evolution.js`
- Modify: `../auditoria-2026-11-03/e2e/fakesupa.js` (rota `/functions/v1/whatsapp` → `realFunction('whatsapp', …)` repassando `url.search`; env `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `WHATSAPP_WEBHOOK_URL`)

**Interfaces:**
- Produces: `startFakeEvolution(port) → {calls, state, close(), fireWebhook(url, body)}` respondendo, com header `apikey` obrigatório (401 sem ele):
  - `POST /instance/create` → 201 `{instance:{instanceName,status:'created'}, qrcode:{base64:'data:image/png;base64,QRFAKE1', code:'2@fake'}}`; nome repetido → 403 `{error:'...already in use'}`;
  - `GET /instance/connect/:nome` → `{base64:'data:image/png;base64,QRFAKE<n>', code, count:n}`;
  - `GET /instance/connectionState/:nome` → `{instance:{instanceName, state}}` (state controlado por `state[nome]`, padrão `'connecting'`);
  - `DELETE /instance/logout/:nome`, `DELETE /instance/delete/:nome` → `{success:true}`;
  - modo `FAKE_EVO_LENTO=1`: responde depois de 15 s (para o teste de timeout).
- Consumes: `realFunction` atual; acrescentar 4º parâmetro `search` e montar `new Request('http://localhost/functions/v1/'+nome+search, …)`.

- [ ] **Step 1:** Escrever `fake-evolution.js` e um teste rápido no próprio arquivo (`node e2e/fake-evolution.js --selftest`: create, create de novo = 403, connect, state, sem apikey = 401).
- [ ] **Step 2:** Rodar o selftest → ok.
- [ ] **Step 3:** Mudar `fakesupa.js` (rota + search + env apontando para `http://localhost:54410`; `WHATSAPP_WEBHOOK_URL=http://localhost:54400/functions/v1/whatsapp`).
- [ ] **Step 4:** Rodar `node e2e/t57-cota-clientes.js ../commandah-sistema` (com `FAKE_STAFF_AUTH=1`) → 11/11 (nada quebrou).

### Task 3: Função `whatsapp`

**Files:**
- Create: `supabase/functions/whatsapp/index.ts`
- Test: `../auditoria-2026-11-03/e2e/t69-whatsapp-funcao.js`

**Interfaces:**
- Consumes: Task 1 (tabela e RPCs), Task 2 (fake e rota), `comCors` de `../_shared/cors.ts`, padrão `caller()`/`donoSessaoOk()` de `nfce/index.ts` (copiar, papéis aceitos `admin` e `caixa`).
- Produces (POST JSON, resposta `{ok, ...}` ou `{ok:false, erro}`):
  - `{action:'situacao'}` → `{ok:true, plano_pro, situacao, numero, qr, pode_conectar}`; sem Pro: `{ok:true, plano_pro:false}` sem chamar a Evolution; com instância não desconectada, consulta `connectionState` (timeout 8 s; falha = devolve o gravado com `aviso`); `state:'open'` → grava `conectado`.
  - `{action:'conectar'}` (dono/admin, Pro) → prepara segredo, `POST /instance/create` com `{instanceName:tenant, qrcode:true, integration:'WHATSAPP-BAILEYS', webhook:{enabled:true, url:WEBHOOK+'?k='+segredo, events:['QRCODE_UPDATED','CONNECTION_UPDATE','MESSAGES_UPSERT','MESSAGES_UPDATE']}}`; 403 "já existe" → `GET /instance/connect/:tenant`; grava `aguardando_qr` + qr; devolve `{ok:true, situacao:'aguardando_qr', qr}`.
  - `{action:'desconectar'}` (dono/admin) → logout + delete (erros 404 ignorados), grava `desconectado`, numero/qr null.
  - Webhook (`?k=` presente, sem JWT): corpo `{event, instance, data}`; evento normalizado `event.toLowerCase().replace(/_/g,'.')`; confere `k` com o segredo da linha de `instance` (tempo constante; sem linha ou diferente = 401); `qrcode.updated` → grava `data.qrcode.base64`; `connection.update` `state:'open'` → `conectado` + numero = dígitos de `data.wuid`; `state:'close'` → `desconectado`; outros eventos → 200 sem gravar (etapa 2).
  - Erros: sem sessão 401; papel sem direito 403; sem Pro 402 `{erro:'Plano Pro'}`; Evolution fora 503 com mensagem em português.

- [ ] **Step 1: Escrever** `t69-whatsapp-funcao.js` (sobe Postgres via `H.up()`, fake-evolution na 54410, fakesupa; chama a função pelo app logado — `supabaseClient.functions.invoke` em `page.evaluate` — como admin e como caixa). Checagens:
  - sem Pro: `situacao` → `plano_pro:false` e `fake.calls` vazio;
  - com Pro (insert em `assinaturas`): `conectar` admin → `aguardando_qr`, qr `QRFAKE1`, `fake.calls` tem create com `webhook.url` terminando em `?k=` + 64 hex;
  - `conectar` de novo → usa `/instance/connect`, qr `QRFAKE2`;
  - `conectar` como caixa → 403; `situacao` como caixa → ok com `pode_conectar:false`;
  - webhook `qrcode.updated` com k certo → qr gravado; com k errado → 401 e qr não muda; k de outro tenant → 401;
  - webhook `connection.update` open com `wuid:'5544999990000@s.whatsapp.net'` → `conectado`, numero `5544999990000`;
  - `FAKE_EVO_LENTO=1`: `situacao` volta em < 12 s com `aviso` e a situação gravada;
  - `desconectar` → `desconectado`, fake recebeu logout e delete.
- [ ] **Step 2:** Rodar → FALHA (função não existe).
- [ ] **Step 3:** Implementar `index.ts` (cabeçalho com as ações, como o da `nfce`; `fetch` com `AbortSignal.timeout(8000)`; comparação de segredo por `crypto.subtle`/loop XOR).
- [ ] **Step 4:** Rodar → todos ok; rodar `t57` → 11/11.
- [ ] **Step 5:** Commit `feat(whatsapp): função whatsapp com conectar, situação e webhook (etapa 1)`.

### Task 4: Configurações › WhatsApp no app

**Files:**
- Create: `assets/js/sistema/whatsapp-config.js`
- Modify: `assets/js/core/config.js` (menu: item `Bot WhatsApp` vira `WhatsApp`, `action:'openWhatsAppSettings'`, `perm:'whatsapp'`; tirar `'Bot WhatsApp'` de `MODULOS_EM_CONSTRUCAO`; token `'whatsapp'` em `ROLE_PERMS.admin` e `.caixa`; `ROLE_PERMS_NOVAS` += `['whatsapp',4]`; `ROLE_PERMS_VERSAO = 4`)
- Modify: `assets/js/core/navegacao.js` (apagar `openWhatsAppBotConfig`/`saveWhatsAppBotConfig`)
- Modify: `index.html` (tag do arquivo novo depois de `fiscal/nfce-config.js`), `assets/js/sistema/novidades.js` (entrada `2026-11-25-whatsapp-conectar`, perms `['whatsapp']`)
- Test: `../auditoria-2026-11-03/e2e/t70-whatsapp-tela.js`

**Interfaces:**
- Consumes: Task 3 (`situacao`, `conectar`, `desconectar`).
- Produces: `openWhatsAppSettings()`; enquanto o modal está aberto e a situação é `aguardando_qr`, consulta `situacao` a cada 3 s (para ao fechar o modal ou ao conectar).

- [ ] **Step 1: Escrever** `t70-whatsapp-tela.js` (fake-evolution + fakesupa, 1366 e 390 px). Checagens:
  - menu mostra "WhatsApp" sem selo "Pro · em breve"; garçom e cozinha não veem;
  - sem Pro: modal mostra "WhatsApp no Commandah faz parte do plano Pro" e nenhum botão Conectar;
  - com Pro, admin: "Conectar número" → `<img>` com src do QR, chip "Aguardando leitura do QR", aviso do número separado;
  - webhook `connection.update` open → em até 5 s o modal mostra "Conectado · (44) 9 9999-0000" e o botão "Desconectar";
  - "Desconectar" pede confirmação e volta a "Desconectado";
  - caixa: vê a situação, sem Conectar/Desconectar;
  - Evolution lenta: mensagem "Não foi possível falar com o WhatsApp agora" em até 12 s;
  - matriz de perfis salva com versão 3 ganha `whatsapp` no caixa; sem erro no console.
- [ ] **Step 2:** Rodar → FALHA.
- [ ] **Step 3:** Implementar (molde visual do artboard Conectar; QR em `<img src>` vindo da função — `data:image/png` já é permitido? conferir `img-src` da CSP; se não for, avisar o dono antes de mudar a CSP).
- [ ] **Step 4:** Rodar t70 → ok; t57, t67 → ok.
- [ ] **Step 5:** `node scripts/bump-version.js && node scripts/check-app.js && node scripts/check-load-order.js`; commit `feat(whatsapp): Configurações › WhatsApp com QR (etapa 1)`.

### Task 5: Instalação do servidor (VPS)

**Files:**
- Create: `infra/evolution/docker-compose.yml`, `infra/evolution/.env.example`, `infra/evolution/Caddyfile`, `infra/evolution/README.md`

**Interfaces:**
- Produces: serviços `evolution` (`evoapicloud/evolution-api:v2.3.8`), `postgres` (16, volume), `redis` (7, volume), `caddy` (2, portas 80/443, volume de certificados); só o Caddy expõe portas; `.env.example` com `AUTHENTICATION_API_KEY=` (gerar com `openssl rand -hex 32`), `SERVER_URL`, `DATABASE_*`, `CACHE_REDIS_*`, `DOMINIO=`.
- README em português, passo a passo para o dono: contratar Hostinger KVM 1 (Ubuntu 24.04), criar subdomínio no DuckDNS, `apt install docker`, copiar a pasta, preencher `.env`, `docker compose up -d`, conferir `https://<dominio>/` responder, e os comandos (com o "sim") de secrets e deploy:
  `npx supabase secrets set EVOLUTION_URL=… EVOLUTION_API_KEY=… WHATSAPP_WEBHOOK_URL=https://ezfoymdesmarpunmixbs.supabase.co/functions/v1/whatsapp`,
  `npx supabase functions deploy whatsapp --no-verify-jwt`, migration, e o `update public.assinaturas set plano='pro' where tenant_id='clube-olimpico-maringa-y8mt'`.

- [ ] **Step 1:** Escrever os arquivos.
- [ ] **Step 2:** Conferir a imagem/tag no Docker Hub e as variáveis na doc `env` da Evolution (WebFetch); ajustar.
- [ ] **Step 3:** Se o Docker estiver instalado aqui: `docker compose -f infra/evolution/docker-compose.yml config` → sem erro (senão, registrar que não foi validado).
- [ ] **Step 4:** Commit `docs(whatsapp): instalação do servidor da Evolution (etapa 1)`.
