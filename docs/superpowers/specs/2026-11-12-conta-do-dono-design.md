# Conta do dono: texto da entrada e verificação em duas etapas — design

Data: 12/11/2026. Item 3 da auditoria de lançamento (relatório: https://claude.ai/artifact/4rHCe8zRNhBKW5PBBw81Hr).

## Por quê

Cada aparelho do estabelecimento é configurado entrando com o e-mail e a senha do dono
(`core/estabelecimento.js`, `tenantSignIn`). Na prática **quem configura é o próprio dono** (disse o dono do
Commandah), mas a tela manda o contrário: "Compartilhe esse login (e-mail/senha) com quem for configurar
outros computadores e celulares". Quem tem a senha entra como dono de qualquer lugar e não existe segunda
trava. O Commandah vai ser vendido para outros bares; cliente novo seguiria o texto e espalharia a senha.

## Objetivos

1. A tela de entrada diz a verdade: só o dono entra ali; garçom, caixa e cozinha usam o PIN.
2. Verificação em duas etapas **opcional** para a conta do dono: depois da senha, um código de 6 números de um
   aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, etc.).
3. Com a verificação ligada, quem só tem a senha **não consegue nada como dono**, nem chamando o banco ou as
   funções direto (a trava vale no servidor, não só na tela).

## Não objetivos

- "Esqueci minha senha": **adiado pelo dono** (12/11). O Supabase só manda e-mail para a equipe do projeto;
  precisa de um serviço de envio (Gmail com senha de aplicativo foi a recomendação) e, de preferência, domínio
  próprio. Até lá, senha esquecida é redefinida pela equipe do Commandah no painel do Supabase.
- Verificação em duas etapas para colaboradores (PIN). Só o dono.
- Obrigar a verificação. É opcional.
- SMS ou e-mail como segundo fator. Só aplicativo autenticador (TOTP), que o Supabase Auth já oferece.

## Antiobjetivos

- Dono que não ligou a verificação perceber qualquer diferença (além do texto novo).
- Dono com a verificação ligada ficar trancado sem saída: perdeu o celular → a equipe do Commandah remove o
  fator (CLI, com o "sim" do dono do Commandah) e ele entra só com a senha.
- Quebrar o clube no meio da operação: colaborador entra por PIN e a sessão vira a do colaborador
  (`login.js`); nada disso depende do fator do dono.
- Trava só de tela (pular a tela e chamar a API com a sessão de senha tem que falhar).

## O que está decidido

### 1. Texto da tela de entrada (`renderTenantSetup`)

Trocar "Uma conta por estabelecimento. Compartilhe esse login (e-mail/senha) com quem for configurar outros
computadores e celulares do mesmo lugar." por algo como: "Entrada do dono do estabelecimento. Para configurar
um computador ou celular, o dono entra aqui; garçom, caixa e cozinha usam o próprio PIN. Não compartilhe esta
senha."

### 2. Ligar e desligar a verificação

- Onde: na tela de PIN (`renderLogin`) **enquanto a sessão é do dono** (`sessionIsOwner`), um link
  "Proteger a conta do dono" (ou "Verificação em duas etapas: ligada" com opção de desligar). É o único momento
  em que o aparelho tem a sessão do dono: depois do PIN a sessão é do colaborador.
- Ligar: `supabase.auth.mfa.enroll({ factorType:'totp' })` → mostra o QR (o retorno traz o SVG/URI; o
  `qrcodejs` já está no app) e a chave para digitar à mão → o dono digita o primeiro código →
  `mfa.challenge` + `mfa.verify`. Só fica ligado depois desse código certo.
- Desligar: pede um código atual (sessão `aal2`) e chama `mfa.unenroll`.

### 3. Entrar com a verificação ligada

Depois de `signInWithPassword` em `tenantSignIn`: se `mfa.getAuthenticatorAssuranceLevel()` disser que o próximo
nível é `aal2` e o atual é `aal1`, pede o código de 6 números antes de seguir (`resolveTenantSession`,
`startApp`). Código errado: mensagem e nova tentativa. Sessão salva no aparelho (recarregar a página) também
passa por essa conferência no boot.

### 4. Trava no servidor (a parte que protege de verdade)

Regra: **conta do dono com fator verificado só vale como dono numa sessão `aal2`.** Sessão `aal1` desse dono
é tratada como sem estabelecimento.

- Postgres: um helper (sugestão `public.dono_sessao_ok()`: `auth.jwt()->>'aal' = 'aal2'` ou não existe fator
  `verified` em `auth.mfa_factors` para `auth.uid()`) aplicado em **todo** lugar que reconhece o dono por
  `tenant_owners` + `auth.uid()`: `current_tenant_id()`, `current_staff_role()` (papel `owner`) e qualquer
  policy/RPC que consulte `tenant_owners` direto. Migration nova; testar no Postgres 18 local e na bancada.
- Edge Functions que reconhecem o dono por `tenant_owners` (`nfce` caller, `staff-auth` checagem de dono/admin;
  `cadastro` não, porque cria a conta): com fator verificado, exigir `aal` = `aal2` no JWT; senão, recusar como
  sem permissão. Deploy só com o "sim".

### 5. Recuperação

Sem autoatendimento nesta versão. Comando documentado no HANDOFF para a equipe do Commandah remover o fator de
um dono (apagar em `auth.mfa_factors` pelo CLI, ou API admin), só com o "sim".

### 6. Respostas do dono depois da revisão (12/11)

- **Frequência:** depois de "Bloquear ou trocar usuário", o `signOut()` derruba a sessão e, se a página recarregar,
  o boot cai na tela de e-mail e senha do dono (`boot.js`). No clube isso acontece **quase nunca**, então o
  segundo fator não vira bloqueio de operação e o projeto **não** inclui fazer o aparelho voltar ao PIN sem a
  sessão do dono. O texto da tela não promete "uma vez só": diz que o dono entra ali para configurar o aparelho.
- **Suporte:** a equipe do Commandah **não usa** o e-mail e a senha do dono do cliente. Ligar a verificação não
  afeta implantação nem suporte; o passo a passo não precisa de aviso sobre isso.

## Restrições

- Front em JS puro, scripts clássicos (ver `CLAUDE.md`); escape com `h`/`jsArg`; tokens de cor existentes.
- supabase-js já carregado por CDN com versão fixa: conferir se a versão tem `auth.mfa` (v2 tem).
- Conferir no painel do Supabase que o TOTP está habilitado em Auth › Multi-Factor (padrão: ligado).
- Migration e deploy de função só com o "sim" do dono, fora do horário de movimento.
- Entrada em `NOVIDADES` ao publicar (perms `config-sistema`).

## Para o construtor decidir

- Texto exato da tela e do passo a passo de ligar (QR + chave manual + "digite o código que aparece no app").
- Como a tela de PIN mostra o estado (ligado/desligado) e onde fica o link, sem poluir o login do garçom.
- Lista completa de policies/RPCs que leem `tenant_owners` (grep nas migrations) e como aplicar o helper sem
  reescrever cada uma (ex.: concentrar em funções já usadas pelas policies).
- Como a bancada (`../auditoria-2026-11-03`, `e2e/fakesupa.js`) simula `aal`/fatores para os testes de
  navegador e de RLS; se o fakesupa não suportar, testes de RLS direto no Postgres local com
  `request.jwt.claims` montado à mão.
