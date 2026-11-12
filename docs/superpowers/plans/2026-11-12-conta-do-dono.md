# Conta do dono (texto + verificação em duas etapas) — plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o dono pode ligar um código de 6 números (app autenticador) na conta dele; com ele ligado, a sessão só de senha não vale como dono nem no banco, nem nas funções, nem na tela.

**Architecture:** Supabase Auth MFA (TOTP) no front (`supabase.auth.mfa.*`, supabase-js 2.117.0 já carregado). No servidor, um helper SQL `public.dono_sessao_ok()` entra nos dois pontos que reconhecem o dono (`current_tenant_id`, `current_staff_role`) e na policy `owner_manage_print_token`; as Edge Functions `nfce` e `staff-auth` fazem a mesma conferência pelo JWT (`aal`) + lista de fatores (API admin).

**Tech Stack:** JS puro (scripts clássicos), Postgres/RLS, Edge Functions Deno, bancada local `../auditoria-2026-11-03` (Postgres 18 + `e2e/fakesupa.js` + Chrome sem janela).

**Spec:** `docs/superpowers/specs/2026-11-12-conta-do-dono-design.md`

## Global Constraints

- Só TOTP (app autenticador); opcional; só a conta do dono (`tenant_owners`). Colaborador (PIN) não muda.
- "Esqueci minha senha" fora do escopo.
- Texto da entrada (exato): "Entrada do dono do estabelecimento. Para configurar um computador ou celular, o dono entra aqui; garçom, caixa e cozinha usam o próprio PIN. Não compartilhe esta senha."
- Regra do servidor: dono com fator `verified` só vale como dono com `aal = 'aal2'` no JWT; sem fator, nada muda.
- Funções que só a service_role/CLI chamam (`cadastro_por_convite`, `nfce_emissor_salvar_token`, `nfce_liberar_producao`) não mudam.
- Migration nova `supabase/migrations/20261115000000_dono_duas_etapas.sql` (não editar migration aplicada). Aplicar e publicar funções só com o "sim" do dono.
- Scripts clássicos; arquivo novo no `index.html` na ordem; `bump-version.js`, `check-app.js`, `check-load-order.js`; escape com `h`/`jsArg`; Novidades com `perms:['config-sistema']`.

## Review Focus

1. Clube em operação depois da publicação, sem fator ligado: nada muda (dono, admin, caixa, garçom, cozinha) — etapa `sem-fator` do e2e e caso SQL "dono sem fator, aal1 → tenant".
2. Sessão salva no aparelho com fator ligado e só `aal1` (recarregou a página no meio do login): o boot pede o código, não entra direto — etapa `boot-aal1` do e2e.
3. Código errado ou vazio: mensagem e nova tentativa, sem travar a tela — etapa `codigo-errado`.
4. Colaborador entra por PIN num aparelho de dono com fator: a sessão vira a do colaborador e opera normal — etapa `pin-com-fator`.
5. Dono desliga o fator: volta a entrar só com a senha e o servidor volta a aceitar `aal1` — caso SQL "fator apagado" e etapa `desligar`.

---

### Task 1: Trava no banco

**Files:**
- Create: `supabase/migrations/20261115000000_dono_duas_etapas.sql`
- Modify (bancada, fora do repo): `../auditoria-2026-11-03/db/stubs.sql` (tabela `auth.mfa_factors`), novo `../auditoria-2026-11-03/db/t-dono-aal.js`

**Interfaces:**
- Produces: `public.dono_sessao_ok() returns boolean` (`stable security definer`, `search_path=''`): `true` se `coalesce(auth.jwt()->>'aal','aal1')='aal2'` ou não existe linha em `auth.mfa_factors` com `user_id=auth.uid() and status='verified'`. `grant execute` a `authenticated, service_role`.
- `current_tenant_id()` e `current_staff_role()` recriadas: o ramo `tenant_owners` só vale com `public.dono_sessao_ok()`; o ramo `tenant_staff` igual ao de hoje. Policy `owner_manage_print_token` (tabela `print_agent_tokens`) recriada com a mesma condição + `public.dono_sessao_ok()`. Copiar a definição atual de produção (`pg_get_functiondef`/`pg_policies`) e mudar só isso. Rollback comentado no fim do arquivo.

- [ ] **Step 1: Bancada**: em `stubs.sql`, `create table if not exists auth.mfa_factors(id uuid primary key default gen_random_uuid(), user_id uuid not null, friendly_name text, factor_type text not null default 'totp', status text not null default 'unverified', secret text, created_at timestamptz default now(), updated_at timestamptz default now())`. Em `t-dono-aal.js` (mesmo jeito de `db/sqltest.js`: `set_config('request.jwt.claims', ...)` numa transação), com o dono `OWNER` de `e2e/seed.js` e o tenant `t-a`, os casos e o esperado de `select public.current_tenant_id(), public.current_staff_role()`:
  - dono sem fator, claims `{sub, role:'authenticated', aal:'aal1'}` → `('t-a','owner')`
  - dono com fator `verified`, `aal1` → `(null,null)`
  - dono com fator `verified`, `aal2` → `('t-a','owner')`
  - dono com fator `unverified` (cadastro não terminado), `aal1` → `('t-a','owner')`
  - colaborador admin (`sadm`), `aal1`, dono com fator → `('t-a','admin')`
  - fator apagado depois de ligado, `aal1` → `('t-a','owner')`
  - leitura de `app_data` (`select count(*) from app_data where tenant_id='t-a'`) como dono com fator `aal1` → `0`; com `aal2` → `> 0`.
- [ ] **Step 2: Ver falhar**: `bash db/up.sh > db/up.log 2>&1 </dev/null && node db/t-dono-aal.js` → falha no caso "fator verified, aal1" (hoje devolve `t-a`).
- [ ] **Step 3: Escrever a migration** e aplicá-la no banco local (`up.sh` monta com todas as migrations do repo; usar `REPO`/caminho do worktree se o script ler de outra pasta).
- [ ] **Step 4: Ver passar**: `node db/t-dono-aal.js` → todos ok; `node db/sqltest.js` (146 testes de RLS) sem falha nova.
- [ ] **Step 5: Commit** — `feat(conta-do-dono): trava de duas etapas no banco (item 3 da auditoria)`.

### Task 2: Trava nas Edge Functions

**Files:**
- Modify: `supabase/functions/nfce/index.ts` (função `caller`), `supabase/functions/staff-auth/index.ts` (checagem do dono perto da linha 115)
- Modify (bancada): `../auditoria-2026-11-03/e2e/fakesupa.js` (claims com `aal`; rota admin de fatores)

**Interfaces:**
- Produces (em cada função, cópia local — as funções não compartilham módulo): `async function donoSessaoOk(jwt: string, uid: string): Promise<boolean>` — lê `aal` do payload do JWT (base64url, já validado por `getUser`); se `aal2` → `true`; senão `admin.auth.admin.mfa.listFactors({ userId: uid })` e devolve `true` só se nenhum fator `status==='verified'`. Erro na consulta → `false` (fecha).
- Uso: no ramo "é dono" de `caller` (nfce) e da checagem de dono (staff-auth), `if(!await donoSessaoOk(jwt, uid))` trata como sem permissão (mesma resposta de quem não é dono). Ramo do colaborador não muda.

- [ ] **Step 1: Bancada**: `fakesupa.js` — `session(user, aal='aal1')` põe `aal` no JWT; `rest()` repassa `aal` em `request.jwt.claims`; rota `GET /auth/v1/admin/users/{id}/factors` lê `auth.mfa_factors`. Teste novo `e2e/t26-dono-aal-funcoes.js` com `FAKE_NFCE_REAL=1`: dono com fator `verified` e sessão `aal1` chama `nfce` `{action:'emissor'}` → 403; com `aal2` → 200; sem fator `aal1` → 200; `staff-auth` ação de dono (`create_operator`) com fator e `aal1` → recusada.
- [ ] **Step 2: Ver falhar** (hoje `aal1` com fator passa).
- [ ] **Step 3: Implementar** `donoSessaoOk` nas duas funções e usar nos ramos do dono. Conferir a sintaxe com `npx -y esbuild@0.24.0 <arquivo> --log-level=error >/dev/null`.
- [ ] **Step 4: Ver passar** `t26` e `npm run staff-auth` da bancada sem falha nova.
- [ ] **Step 5: Commit** — `feat(conta-do-dono): nfce e staff-auth exigem o código do dono quando ligado`.

### Task 3: Tela — texto, entrar com código, ligar e desligar

**Files:**
- Create: `assets/js/core/dono-mfa.js` (tag logo depois de `core/estabelecimento.js`)
- Modify: `assets/js/core/estabelecimento.js` (texto; `tenantSignIn` pede o código), `assets/js/core/boot.js` (sessão salva `aal1` com fator → pede o código), `assets/js/core/login.js` (link na tela de PIN quando `sessionIsOwner`), `assets/css/ajustes.css`
- Modify (bancada): `fakesupa.js` (rotas MFA do usuário), novo `e2e/t27-dono-mfa.js`

**Interfaces:**
- Consumes: `supabaseClient.auth.mfa.{enroll, challenge, verify, unenroll, listFactors, getAuthenticatorAssuranceLevel}`.
- Produces:
  - `async function donoPrecisaCodigo() -> boolean` — `getAuthenticatorAssuranceLevel()`: `currentLevel==='aal1' && nextLevel==='aal2'`.
  - `function pedirCodigoDoDono() -> Promise<boolean>` — mostra a caixa "Código de verificação" (6 dígitos, `inputmode="numeric"`, `autocomplete="one-time-code"`), faz `challenge`+`verify` no fator TOTP `verified`; resolve `true` quando a sessão vira `aal2`; código errado → mensagem "Código incorreto. Confira o app e tente de novo." e a caixa fica; "Cancelar" → `signOut()` e resolve `false`.
  - `function abrirProtecaoDoDono() -> void` — janela: desligado → passo a passo (QR do `enroll().totp.qr_code`, chave `totp.secret` para digitar, campo do primeiro código, botão "Ligar"); só fica ligado após `challenge`+`verify` certos; ligado → "Desligar" pede um código atual e chama `unenroll`. Fator `unverified` sobrando de tentativa anterior: `unenroll` antes de um novo `enroll`.
- Rotas no fakesupa (formato do GoTrue): `POST /factors` (enroll: grava `unverified`, devolve `{id,type:'totp',totp:{qr_code,secret,uri}}`), `POST /factors/{id}/challenge` (`{id,expires_at}`), `POST /factors/{id}/verify` (aceita o código `123456`; marca `verified`; devolve sessão `aal2`), `DELETE /factors/{id}`; `GET /user` inclui `factors`.

- [ ] **Step 1: Teste `t27`** com as etapas (cada uma com `assert` e `page.log.errors` vazio):
  - `texto`: a tela de entrada contém o texto exato das Global Constraints e não contém "Compartilhe esse login".
  - `sem-fator`: dono entra com senha, cai na tela de PIN; admin entra por PIN e opera (`activeView` definido).
  - `ligar`: na tela de PIN, link "Proteger a conta do dono" → QR e chave aparecem → código `123456` → fator `verified` em `auth.mfa_factors`; a tela de PIN mostra "Verificação em duas etapas ligada".
  - `codigo-errado`: dono com fator entra com senha → caixa do código; `000000` → mensagem exata acima e a caixa continua; `123456` → tela de PIN.
  - `boot-aal1`: dono com fator, sessão `aal1` salva, recarrega → caixa do código (não a tela de PIN).
  - `pin-com-fator`: depois do código, admin entra por PIN e opera normal.
  - `desligar`: com sessão `aal2`, "Desligar" + `123456` → fator apagado; sair e entrar só com senha → tela de PIN.
- [ ] **Step 2: Ver falhar** (`texto` e `ligar` primeiro).
- [ ] **Step 3: Implementar** `dono-mfa.js`, o texto, o gancho em `tenantSignIn` (depois do `signInWithPassword`, `if(await donoPrecisaCodigo() && !await pedirCodigoDoDono()) return;` antes de `resolveTenantSession`) e no `boot` (mesmo gancho antes de `startApp` quando há sessão), e o link em `renderLogin` só com `sessionIsOwner`. Visual com tokens e componentes existentes (`login-box`, `field`, `btn`).
- [ ] **Step 4: Ver passar** — `t27` todas as etapas; `node scripts/check-app.js && node scripts/check-load-order.js`; regressão `e2e/t2-fluxos.js` 29/29.
- [ ] **Step 5: Commit** — `feat(conta-do-dono): texto da entrada e verificação em duas etapas do dono`.

### Task 4: Fechamento

**Files:**
- Modify: `assets/js/sistema/novidades.js`, `index.html` (bump), `docs/HANDOFF.md`

- [ ] **Step 1: Novidades** no topo: `{ id:'2026-11-1X-dono-duas-etapas', data:'dd/mm/2026', itens:[{ titulo:'Verificação em duas etapas para o dono', texto:'O dono pode proteger a conta com um código de 6 números de um aplicativo no celular (Google Authenticator ou parecido). Com ela ligada, quem souber só a senha não entra como dono. Garçom, caixa e cozinha continuam entrando só com o PIN.', onde:'Tela do PIN › Proteger a conta do dono', perms:['config-sistema'] }] }`.
- [ ] **Step 2: HANDOFF**: o que mudou, ordem de publicação (1. migration `20261115000000` com o "sim"; 2. deploy `nfce` e `staff-auth`; 3. merge e recarregar aparelhos), conferência pós-publicação (clube sem fator entra normal) e o comando de recuperação: `delete from auth.mfa_factors where user_id = (select user_id from public.tenant_owners where tenant_id = '<tenant>');` (só com o "sim").
- [ ] **Step 3: Conferir** — `node scripts/bump-version.js && node scripts/check-app.js && node scripts/check-load-order.js && node scripts/test-primeiro-acesso.js && node scripts/test-peso.js && node scripts/test-opcoes.js`; bancada `t-dono-aal.js`, `t26`, `t27`, `t24`, `t2-fluxos`.
- [ ] **Step 4: Commit e PR em rascunho** — `docs: Novidades e HANDOFF da conta do dono`; push; `gh pr create --draft`.
