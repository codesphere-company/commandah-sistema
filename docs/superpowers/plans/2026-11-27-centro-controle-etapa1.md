# Centro de controle — Etapa 1 (sinal, incidentes, WhatsApp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Problema crítico em qualquer cliente monitorado abre um incidente no banco em até ~2 min e manda WhatsApp ao operador, repetindo a cada 15 min até fechar sozinho.

**Architecture:** Aparelhos mandam `aparelho_sinal` a cada 60 s (front, arquivo novo `core/sinal.js`). Um pg_cron de 1 min roda `controle_avaliar()` (SQL), que abre/fecha `controle_incidentes` e enfileira mensagens em `controle_avisos`; o mesmo cron chama a Edge Function `whatsapp` (ação nova `alertas_enviar`, protegida por `x-segredo`), que manda as mensagens pela instância da plataforma e marca enviadas.

**Tech Stack:** Postgres (plpgsql, pg_cron, pg_net, vault), Supabase Edge Function (Deno/TS), JS clássico sem build; bancada `../auditoria-2026-11-03` (db/*.js com `pg`, e2e/*.js com o harness).

**Spec:** `docs/superpowers/specs/2026-11-27-centro-de-controle-design.md`

## Global Constraints
- Migration nova: `supabase/migrations/20261129000000_centro_controle.sql` (aplicar em produção só com "sim" do dono).
- Edge Function `whatsapp` só publicada com "sim" do dono; secret novo `CONTROLE_SEGREDO` (vault `controle_segredo` + env da função) e `PLATAFORMA_WHATSAPP_INSTANCIA` (hoje = tenant_id do Clube Olímpico).
- Número do operador nunca no repositório: entra por SQL em `plataforma_operadores` na hora de aplicar.
- Toda função nova `security definer set search_path to ''`, `revoke all … from public, anon`; cliente nunca lê tabelas `controle_*`/`plataforma_*` (RLS ligada sem policy para authenticated, exceto onde dito).
- Limites: ficha não enviada > 1 min; impressão parada > 2 min (ignora > 6 h e impressora não cadastrada); agente sem sinal > 3 min; venda não subiu > 2 min; aparelho de caixa sumiu > 3 min; sumiu com pendência > 5 min (atenção); estabelecimento sem sinal > 3 min; caixa travado > 10 min; nfce rejeitada/erro nos últimos 30 min (atenção); erros de tela ≥ 5 em 10 min (atenção).
- Funcionando = caixa aberto (modo antigo `app_data` `cantina2:cashSession`.status = 'open'; por operador algum `cash_turnos.turno->>'status'` in open/travado_abertura/travado_fechamento) **e** venda (`sales.updated_at`) nos últimos 60 min. `caixa_travado` só exige caixa aberto.
- Monitorado = `assinaturas.situacao in ('isento','ativa','atrasada')`.
- WhatsApp só para gravidade `critico`; repete a cada 15 min; fechou → "✅ resolvido". `estabelecimento_sem_sinal` aberto suprime `aparelho_sumiu`/`agente_sem_sinal`/`aparelho_sumiu_com_pendencia` do mesmo cliente.
- Payload do sinal < 2 KB; sinal a cada 60 s ± 10 s, só com sessão aberta.

## Review Focus
- Cliente (owner/admin/staff) chamando `controle_*`/lendo `plataforma_operadores` → recusado.
- Aparelho que só fechou o navegador à noite (cliente não funcionando) → nenhum incidente.
- Mesmo problema por 40 min → 1 incidente, 3 avisos (0, 15, 30 min), não 40.
- Impressora apagada do cadastro com jobs velhos pendentes → nenhum incidente.
- Cron rodando duas vezes ao mesmo tempo → sem incidente duplicado (índice único parcial em `(tenant_id, codigo, chave) where fechado_em is null`).

---

### Task 1: Banco — tabelas, sinal, regras e fila de avisos

**Files:**
- Create: `supabase/migrations/20261129000000_centro_controle.sql`
- Test: `../auditoria-2026-11-03/db/t-controle.js` (padrão de `db/t-cofre.js`: cada caso numa transação desfeita)

**Interfaces:**
- Produces (SQL):
  - Tabelas `plataforma_operadores(auth_uid uuid pk, nome text, whatsapp text, ativo bool default true)`, `aparelhos_sinal(tenant_id, aparelho_id text, nome, papel, usuario, versao, tela, caixa_id, caixa_aberto bool, pend_vendas int, pend_caixa int, pend_desde timestamptz, fichas_falhas int, fichas_desde timestamptz, ultimo_erro text, visto_em timestamptz, pk(tenant_id, aparelho_id))`, `quedas_conexao(id, tenant_id, aparelho_id, inicio, fim, pendencias_ao_voltar int)`, `controle_incidentes(id uuid, tenant_id, codigo, chave text default '', gravidade 'critico'|'atencao', detalhe jsonb, aberto_em, ultimo_aviso_em, fechado_em, avisos int)`, `controle_avisos(id uuid, incidente_id, para text, texto text, criado_em, enviado_em, erro text)`.
  - `aparelho_sinal(p jsonb) returns jsonb` — authenticated; tenant = `current_tenant_id()`; upsert por `(tenant, p.aparelhoId)`; `p.quedas` (≤ 20 itens `{inicio,fim,pendencias}`) inserido em `quedas_conexao`; corta textos (nome 60, ultimo_erro 300); devolve `{ok:true}`.
  - `eh_operador_plataforma() returns boolean` — authenticated.
  - `controle_avaliar() returns jsonb` — só service_role/postgres (cron); devolve `{abertos, fechados, avisos}`.
  - `controle_limpar()` diária (incidentes fechados > 90 d, avisos > 30 d, sinais com `visto_em` > 30 d, quedas > 90 d).
  - Agendamentos guardados por `pg_available_extensions` (padrão `20261128010000_notas_entrada_cron.sql`): `controle-avaliar` `* * * * *` = `select public.controle_avaliar(); select net.http_post(<função whatsapp>, x-segredo do vault 'controle_segredo', body {"action":"alertas_enviar"})`; `controle-limpar` `55 7 * * *`.

- [ ] **Step 1: Testes** em `db/t-controle.js`:
  - `cliente nao chama controle_avaliar` (como owner/admin → erro), `cliente nao le plataforma_operadores` (select → 0 linhas ou erro).
  - `aparelho_sinal grava e atualiza` (2 chamadas → 1 linha, `visto_em` novo); `aparelho_sinal guarda quedas`.
  - `fechado nao alerta`: aparelho de caixa com sinal velho, sem caixa aberto → `controle_avaliar()` abre 0.
  - Para cada código, um caso que abre e um que fecha: `ficha_nao_enviada`, `impressao_parada` (+ job de 7 h ignorado, + impressora não cadastrada ignorada), `agente_sem_sinal`, `venda_nao_subiu`, `aparelho_sumiu`, `aparelho_sumiu_com_pendencia` (atenção), `estabelecimento_sem_sinal` (e suprime os individuais), `caixa_travado`, `nfce_rejeitada`, `erros_tela`.
  - `repete a cada 15 min`: incidente crítico aberto; avaliar com `ultimo_aviso_em` = agora-14 min → 0 avisos novos; = agora-16 min → 1 aviso; avisos = 2.
  - `atencao nao manda whatsapp`: `nfce_rejeitada` → 0 linhas em `controle_avisos`.
  - `resolvido avisa`: condição some → `fechado_em` preenchido e 1 aviso com "resolvido".
  - `nao duplica`: duas chamadas seguidas → 1 incidente aberto.
  - `so monitorados`: tenant com assinatura `teste` → 0 incidentes.
  - Texto do aviso contém `business_name` e não contém nome de cliente/sócio.
- [ ] **Step 2:** `REPO=<worktree> bash db/up.sh > db/up.log 2>&1 </dev/null && node db/t-controle.js` → FAIL (função não existe).
- [ ] **Step 3:** escrever a migration. Avaliação em CTEs por código; abrir com `insert … on conflict do nothing` sobre o índice único parcial; fechar os abertos cuja condição não aparece mais. Para "agora" usar `now()`; para testes, os casos ajustam timestamps nos dados (não no relógio).
- [ ] **Step 4:** rodar `db/t-controle.js` → PASS; rodar `db/t-cofre.js` e `db/t-caixa-turnos.js` → continuam PASS (banco sobe do zero com a migration nova).
- [ ] **Step 5:** commit `feat(controle): sinal dos aparelhos, incidentes e fila de avisos no banco`.

### Task 2: Aparelho manda o sinal e as quedas de conexão

**Files:**
- Create: `assets/js/core/sinal.js` (seção `/* ============ SINAL DO APARELHO ============ */`)
- Modify: `index.html` (tag depois de `core/caixa-multiaparelho.js` e de `impressao/impressao-automatica.js`, antes de `core/travas.js`), `assets/js/core/login.js:231` (`afterLogin` chama `iniciarSinalDoAparelho()` nos dois caminhos: garçom e desktop), logout para o timer.
- Test: `../auditoria-2026-11-03/e2e/t102-sinal-aparelho.js`

**Interfaces:**
- Consumes: RPC `aparelho_sinal(p jsonb)` da Task 1.
- Produces: `aparelhoId(): string` (uuid em `localStorage['commandah:aparelhoId']`), `nomeDoAparelho(): string` (caixa marcado → `nomeDoCaixa`; senão `roleLabel(role)+' · '+plataforma` curta), `pendenciasDoAparelho(): {vendas, caixa, desde, fichas, fichasDesde}` (vendas = itens de `cashMovementsDiff(salesBase, state.sales).upserts`+deletes; caixa = diff de `cashMovementsBase`; fichas = `failedPrintTickets`), `iniciarSinalDoAparelho()`, `pararSinalDoAparelho()`, `enviarSinal()`.
- Quedas: `window` `offline`/`online` e falha de rede de `enviarSinal` gravam `{inicio,fim}` em `localStorage['commandah:quedas']` (máx. 20); enviadas e apagadas no primeiro sinal ok; `pendencias` = total de pendências no momento da volta.
- Sinal só com `isCloudMode()` e sessão; `document.hidden` não pausa (o caixa fica em segundo plano); falha nunca mostra erro na tela (só guarda a queda).

- [ ] **Step 1: Teste t102** (FAKE_STAFF_AUTH=1): login Ana → em até 5 s existe linha em `aparelhos_sinal` com `aparelho_id` = `localStorage` e `versao` = `?v=`; recarregar mantém o mesmo id; venda local não enviada (forçar `salesBase` diferente) → próximo `enviarSinal()` grava `pend_vendas=1` e `pend_desde`; `notePrintFailure` com impressora → `fichas_falhas=1`; `dispatchEvent(new Event('offline'))` + 2 s + `online` → próximo sinal cria 1 linha em `quedas_conexao`; logout → timer parado (nenhum sinal novo em 3 s com relógio adiantado via `enviarSinal` espiado); garçom (Gabi) também manda sinal; sem erro no console.
- [ ] **Step 2:** rodar t102 → FAIL.
- [ ] **Step 3:** implementar `sinal.js` e os ganchos.
- [ ] **Step 4:** t102 → PASS; t82, t100 e t29 (perfil garçom) → continuam PASS; `node scripts/check-app.js` e `check-load-order.js` OK; `node scripts/bump-version.js`.
- [ ] **Step 5:** commit `feat(controle): aparelho manda sinal e quedas de conexão`.

### Task 3: WhatsApp manda os avisos da fila

**Files:**
- Modify: `supabase/functions/whatsapp/index.ts` (ação `alertas_enviar` antes do `caller(req)`, igual à `buscar` de `notas-entrada`)
- Test: `../auditoria-2026-11-03/e2e/t103-alertas-enviar.js` (sobe a função com o Deno simulado da bancada, como t54 faz com a staff-auth, e um Evolution falso em porta local)

**Interfaces:**
- Consumes: `controle_avisos` (Task 1), env `CONTROLE_SEGREDO`, `PLATAFORMA_WHATSAPP_INSTANCIA`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`.
- Produces: `POST {action:"alertas_enviar"}` com `x-segredo` → lê até 50 avisos com `enviado_em is null` (service role), manda cada um por `/message/sendText/<instancia>` para `para` (só dígitos, com 55 na frente se faltar), marca `enviado_em` ou grava `erro` (tenta de novo na próxima rodada, máx. 5 tentativas → `erro` final); devolve `{enviados, falhas}`. Segredo errado/vazio → 401. Instância vazia → 200 `{enviados:0, erro:"instancia"}` sem tocar na fila.

- [ ] **Step 1: Teste t103:** segredo errado → 401; 2 avisos na fila → Evolution falso recebe 2 `sendText` para `5544…` na instância configurada, fila marcada; Evolution respondendo 500 → `erro` gravado e `enviado_em` nulo; 6ª falha → para de tentar.
- [ ] **Step 2:** rodar t103 → FAIL.
- [ ] **Step 3:** implementar a ação.
- [ ] **Step 4:** t103 → PASS; t69 (WhatsApp sem Pro) e t72 continuam PASS.
- [ ] **Step 5:** commit `feat(controle): função whatsapp manda os avisos da plataforma`.

### Publicação (só com "sim" do dono, nesta ordem)
1. Criar o segredo `controle_segredo` no vault e os secrets da função (`CONTROLE_SEGREDO`, `PLATAFORMA_WHATSAPP_INSTANCIA`).
2. Aplicar a migration; inserir o operador (`auth_uid` da conta do dono, nome, WhatsApp) por SQL.
3. Publicar a Edge Function `whatsapp`.
4. Merge do front (sinal) e recarregar os aparelhos.
5. Teste real: desligar o agente de impressão do clube com o caixa aberto → WhatsApp em até ~4 min; religar → "resolvido".
