# Handoff — Commandah

> Peça pra eu ler este arquivo no início de qualquer conversa nova sobre este projeto ("lê o HANDOFF.md antes de começar"). Eu mantenho ele atualizado ao fim de cada sessão relevante.

Última atualização: **2026-09-20** (quantidade de copos para produtos de bar, PR #18)

## O que é o projeto

Commandah é o sistema de comanda/PDV do **Clube Olímpico** (Maringá — negócio real do Fabricio, não é side project fictício). Roda direto no navegador, sem servidor de aplicação:

- **Frontend**: um único `index.html` (6013 linhas / ~915KB), sem build step.
- **Deploy**: GitHub Pages, `https://codesphere-company.github.io/commandah-sistema/` (push em `main` já publica; cache do Pages é `max-age=600` — se algo "não atualizou", é isso, pedir pro usuário dar Ctrl+Shift+R ou testar em anônima antes de investigar bug).
- **Backend**: Supabase (projeto `ezfoymdesmarpunmixbs`) — Postgres + PostgREST + Auth + Edge Functions, acessado direto do navegador com a chave anon. **RLS é a única barreira de segurança real** — não existe camada de API própria.
- **Multi-tenant**: `tenant_owners` (user_id → tenant_id) + tabela `app_data` (JSON por `(tenant_id, key)`, ex. chave `cantina2:members`). Tenant do Fabricio: `clube-olimpico-maringa-y8mt`.
- **Impressão**: agente desktop Electron instalado no PC do estabelecimento (`agente-impressao-app/`), faz polling na fila `print_jobs` e imprime via ESC/POS (TCP raw pra impressoras de rede, driver Windows pras locais).

## Limitação importante da minha conexão

`mcp__supabase__execute_sql` é **somente leitura** nesta sessão — DDL/DML sempre falha. Todo SQL de schema/dados é entregue pronto pro usuário rodar no SQL Editor do Supabase, e eu confirmo depois via leitura. Deploy de Edge Function é feito pela Supabase CLI local (`supabase functions deploy <nome> --project-ref ezfoymdesmarpunmixbs --use-api`), sem precisar de Docker nem `supabase link`.

## Estado atual (o que já está pronto)

### Segurança
- **RLS crítico em `print_jobs` fechado** — antes vazava dados de pedidos entre tenants.
- **Sistema de token por tenant pro agente de impressão** — substituiu o modelo antigo (tenant_id como se fosse segredo).
- **Login real por operador** (não é só um PIN local mais) — Edge Function `staff-auth` + tabela `tenant_staff`, com hash de PIN (bcrypt), bloqueio após 5 tentativas erradas (15 min), reset de PIN pelo dono. RLS em `app_data`/`print_jobs` usa um helper `current_tenant_id()` que reconhece tanto dono quanto operador migrado. Rollout é **aditivo**: quem ainda não migrou continua no PIN local antigo até o dono rodar "Migrar acesso seguro" na tela de Colaboradores.
  - **Ainda não feito de propósito**: restringir por papel (ex. caixa não ver financeiro) — é a fase seguinte, só depois desta rodar em produção por um tempo validando.

### Impressão
- Agente Windows desktop (Electron, tray, GUI, auto-start, instalador) — substituiu o script Node antigo (deletado).
- Impressão ESC/POS via TCP raw (bypassa os problemas de driver do Windows), formatação de ticket configurável (largura do papel, tamanho do nome do produto, destaque do local de entrega, mostrar/esconder preço) numa aba de configurações.
- Impressora do caixa por usuário, estações viraram cadastro gerenciável (não mais fixo cozinha/bar/churrasqueira), modo de saída configurável por estação (imprimir/tela/ambos), origens de pedido também viraram cadastro gerenciável.

### UX
- Auditoria completa feita pelo agente `ux-design-senior`, publicada como artifact. **18/18 achados corrigidos** (7 Alta + 9 Média + 2 Baixa), todos no ar. Relatório: https://claude.ai/code/artifact/577f42d7-e7ef-406b-89b0-51894df6f03b

### Arquitetura
- Auditoria completa feita pelo agente `dev-arquiteto-foodservice`, publicada como artifact: https://claude.ai/code/artifact/3bc0a7d7-78ed-4181-af2d-2151c7589b0e
- Login por operador (chamado de "Fase 2" nesta auditoria antiga, numeração diferente da atual) — **feito** (ver Segurança acima). A partir do diagnóstico de 2026-08-31 o roadmap passou a usar a numeração Fase 0-4 usada no resto deste documento; não confundir as duas.
- Decisão explícita do usuário: **não** dividir o `index.html` em múltiplos arquivos por enquanto — o próprio relatório de arquitetura não recomendava isso agora.
- **Fase 1 do roadmap (sócios em tabela relacional + limite de crédito real) — concluída e commitada** (ver seção própria abaixo).

### Fase 1 — Sócios em tabela relacional + limite de crédito real (2026-08-30/31, concluída)
- **Banco**: sócios saíram do blob JSON (`app_data` / chave `cantina2:members`) pra três tabelas relacionais reais — `members`, `member_dependents` e `member_debt_entries` (ledger de débito/pagamento com estorno, no lugar do array `debtHistory` solto). Um trigger (`recalc_member_debt`) recalcula `members.debt` sempre a partir da soma dos lançamentos não estornados — o saldo nunca é escrito direto pelo frontend. RLS igual ao padrão já usado em `app_data`/`print_jobs` (`tenant_id = current_tenant_id()`). Os 1000 sócios que já existiam foram migrados e a migração foi conferida por SQL (contagem batendo, um registro de teste com lançamentos reconciliando certo).
- **Limite de crédito**: campo `creditLimit` já existia meio pronto (usado só de leitura na tela Financeiro → Fiado, sem nenhum jeito de definir) — agora é editável no cadastro do sócio (aba "Dados Secundários"). O bloqueio de consumo trocou de `saldo devedor > 0` pra `saldo devedor > limite de crédito` em todo lugar que checava isso (PDV, comanda, delivery, seleção de titular).
- **Frontend**: criado um objeto `MembersStore` (perto da função `save()`, por volta da linha 910 do `index.html`) que centraliza toda leitura/escrita de sócio — os ~20 pontos do código que antes reescreviam o array inteiro (`state.members.push(...)` + `save('members')`) agora chamam métodos dele (`create`, `update`, `archive/restore`, `saveDependents`, `recordDebtEntry`, `reverseDebtEntry`, `bulkImport`, etc.). Continua funcionando em modo local (sem Supabase, só `localStorage`) e em modo nuvem (tabelas relacionais de verdade), sem duplicar essa lógica em cada função.
- **Limpeza**: removidas funções mortas que já existiam nessa área antes desta mudança — `settleDebt` (nunca era chamada), `renderFiadoLegacy`, e as versões antigas duplicadas/sombreadas de `renderFiado`, `openFiadoEntry`, `toggleFiadoOptions` e `toggleSelectedMemberArchived`.
- **Achados de UX corrigidos no caminho** (relatados pelo Fabricio testando): não existia botão de arquivar sócio na tela Clientes (só escondido em Financeiro → Fiado) — adicionado; a busca de clientes se perdia toda vez que você selecionava/editava um cliente (bug pré-existente, o filtro era só visual e sumia no re-render) — corrigido; o menu "•••  Opções" da tela Clientes não fechava sozinho ao clicar fora — corrigido.
- **Status**: commitado e enviado (`2f672ae`, 2026-08-31) — já publicado em produção via GitHub Pages. Fabricio testou na conta de dono e na de operador antes de commitar; um bloqueio de PIN de operador (5 tentativas erradas → 15 min, mecanismo da Fase 2, não relacionado a esta mudança) não afeta o login por e-mail/senha do dono.

### Time de agentes especializado + diagnóstico completo (2026-08-31)
Foi criado um time de 13 agentes específicos do Commandah em `.claude/agents/` (cto-arquiteto, backend-senior, frontend-senior, mobile-senior, dba-dados, devops-infra, qa-testes, ux-ui-designer, product-manager, security-specialist, fiscal-tributario, tech-writer, scrum-master — ver `.claude/agents/README.md`). Passamos a trabalhar tarefa por tarefa acionando o agente certo pra cada parte, cada um lendo o código/banco real antes de opinar (não é só "escrever bonito", eles fazem Grep/Read/SQL de verdade).

Rodamos um diagnóstico completo (todos os 8 agentes relevantes + scrum-master pra sequenciar) que gerou um backlog priorizado em ondas (Fase 0 = bloqueante/risco ativo, Fase 1 = fundação, Fase 2 = RLS por papel, Fase 3 = migração de vendas pro relacional, Fase 4 = evolução). Esse diagnóstico achou coisas sérias que auditorias anteriores não tinham pego — ver "Fase 0" abaixo.

**Achados-chave do diagnóstico** (pra não perder o porquê de cada item do backlog):
- Sistema é mais completo do que parecia: comandas/mesas, PDV, estoque com ficha técnica, financeiro, fidelidade, ~12 relatórios, delivery e cardápio digital já prontos.
- **Fiscal é inexistente** (zero NFC-e/NCM/CFOP, só um card decorativo) e **provavelmente é obrigatório** — Paraná não tem isenção de ICMS pra clube, e o fato gerador é a saída da mercadoria, não o pagamento (ou seja, cada venda "fiado" já deveria gerar nota na hora do consumo). Precisa do contador do Fabricio antes de qualquer código — ver Pendências.
- `sales`/`orders`/`cashSession`/`orderCounter` continuam como blob JSON reescrito inteiro a cada save → last-write-wins entre dois dispositivos simultâneos (comanda de um pode sobrescrever a do outro, silenciosamente). É o risco estrutural nº1, ainda não resolvido — fica pra Fase 3 (migrar pro relacional, mesmo padrão da Fase 1).
- `supabase/migrations/` não existe versionado no repo — todo SQL de produção só existe no banco, sem histórico. Fica pra Fase 1 (próxima).

### Fase 0 — bloqueante/risco ativo, CONCLUÍDA em 2026-08-31 (itens 1-4; item 5 é ação humana, não código)
1. **PIN de operador em texto puro** (`app_data.cantina2:users`) — colaborador já migrado pro login seguro (Fase 2) continuava com PIN legível por qualquer operador do tenant, anulando o bcrypt (caixa lia o PIN do admin e virava admin). Corrigido em `index.html` (formulário de Colaboradores para de gravar/exibir PIN de migrado) + SQL rodado pelo Fabricio limpando o que já estava no banco. Commit `9a88147`.
2. **Segredo do Pix exposto no cliente** (`app_data.cantina2:settings.pixOnline.secret`) — removido o campo do formulário (não existe integração real de Pix hoje, e não tem pra onde mandar esse segredo com segurança nesta arquitetura sem Edge Function própria). Campo estava vazio em produção, sem dado a limpar. Achado irmão não resolvido: `waToken` do Bot WhatsApp tem a mesma exposição (também vazio hoje) — próximo candidato óbvio. Commit `b5430a1`.
3. **`save()` falhando silenciosamente** — de ~195 chamadas, só 1 conferia o retorno; falha mostrava um toast que sumia em 2,6s. Agora mostra um banner vermelho persistente (`saveFailBanner`, não some sozinho) com retry manual. Decisão de escopo: não reverte o `state` em memória (exigiria mudar os ~195 call sites, projeto sem testes automatizados) — fica pra quando `sales`/`orders` virarem relacional com RPC idempotente (Fase 3). Commit `866b597`.
4. **Fallback silencioso pro modo Local** — se o SDK do Supabase não carrega em 6s (rede ruim do clube), o sistema virava `localStorage` sem avisar; a noite inteira de vendas podia ficar presa num aparelho só. Agora mostra banner âmbar persistente com botão de recarregar. Decisão de produto confirmada com o Fabricio: **só avisa, não bloqueia** o PDV (não pode parar de vender numa sexta cheia por wi-fi instável). Ressalva registrada pelo frontend-senior: o aviso resolve a visibilidade, mas vendas feitas em modo Local não sobem sozinhas pro Supabase quando a conexão volta — não existe fila de sincronização, isso seria escopo maior. Commit `acf16b5`.
5. **Falar com o contador do clube sobre NFC-e/fiado** — não é código, é decisão externa do Fabricio (ver achado fiscal acima). Ainda pendente, é ação dele, não da IA.

### Fase 1 — fundação, CONCLUÍDA em 2026-08-31 (itens 1-3)
1. **`supabase/migrations/` criado e versionado** — baseline reconstruído por introspecção do catálogo Postgres (8 tabelas, 6 funções, 1 trigger, 8 policies, 22 constraints, 19 índices), conferido número por número contra o banco real. Regra fixada no cabeçalho: daqui pra frente toda mudança de schema nasce como migration commitada ANTES de rodar no Supabase. Commit `ce0ac0f` (`20260831000000_baseline.sql`).
2. **PII órfã limpa** — 2 tenants sem dono (`clube-olimpico-maringa`, `lanchonete-olimpico-3bew`) apagados de `app_data`/`print_jobs`; blob legado `cantina2:members` (~224KB, pós-migração da Fase 1 anterior) apagado do tenant real. SQL em `20260831010000_limpeza_pii_orfa.sql` (commit `ce0ac0f`), executado pelo Fabricio e verificado (0 resíduo, 1001 sócios intactos no relacional). Como o Supabase gratuito não tem PITR/backup automático, uma cópia local do blob foi salva antes do delete em `.local-backups/backup-cantina2-members-pre-delete-2026-08-31.json` (gitignorado, nunca commitado — é PII real).
3. **`finalizeSale`/numeração de pedido/baixa de estoque atômicos via RPC — CONCLUÍDO.** Três RPCs novas no Postgres, com trava de linha (`FOR UPDATE`/`UPDATE...ON CONFLICT`) sobre os próprios blobs JSON em `app_data` — **sem migrar `sales`/`insumos`/`orderCounter` pro relacional agora** (isso continua sendo a Fase 3, maior, separada). Migration `20260831020000_rpc_atomicas_venda.sql` (commit `7b9ac41`), aplicada pelo Fabricio e verificada no banco (funções existem, `security_definer=false`, tabela/policy de idempotência corretas, advisor de segurança sem achado novo):
   - `next_order_number(p_start)` — incremento atômico de `cantina2:orderCounter` via `INSERT...ON CONFLICT DO UPDATE...RETURNING`.
   - `consume_insumos(p_consumptions jsonb)` — trava a linha de `cantina2:insumos`, confere se dá pra atender TUDO antes de descontar qualquer coisa (falha = rollback completo), retorna `{insumoId,before,qty,after}` pro cliente montar o log de auditoria.
   - `close_sale(p_sale_id, p_existing, p_sale_patch)` — grava a venda (insert novo ou merge) com **idempotência real** via tabela `sale_close_receipts (tenant_id, sale_id, result)` — um retry de rede com o mesmo `sale_id` devolve o resultado já gravado em vez de duplicar a venda.
   - As 3 RPCs são **independentes** entre si (não uma transação gigante), chamadas em sequência de dentro de `finalizeSale`. Único risco residual aceito: falha exatamente ENTRE duas chamadas (ex. estoque descontado mas venda falhou ao gravar) — muito menor que o problema original.
   - Nota de segurança menor: `anon` acabou com `EXECUTE` nas 3 funções (a intenção era só `authenticated`) — não é explorável, pois todas checam `current_tenant_id()` primeiro e são `SECURITY INVOKER` (não `DEFINER`); o advisor do Supabase não sinaliza nada. Fica registrado, não é bloqueante.
   - **Mudanças em `index.html` (commit `b307b25`)**: `consumeInsumosForItems`/`nextOrderNumber` viraram `async`, chamam as RPCs em modo nuvem, mantêm o comportamento antigo intacto em modo Local (fallback). Isso obrigou converter **21 pontos de chamada** (9 de estoque via `sendItemsToKitchen`, 11 de numeração, 1 overlap) — nenhum dependia de retorno síncrono (são handlers de UI tipo `onclick`), conversão seguro. `finalizeSale` passa a gravar a venda via `close_sale` em vez de `state.sales.push`/`Object.assign` + `save('sales')` direto — só esse ponto foi convertido; os outros ~26 pontos que ainda escrevem `sales` direto (abrir comanda/delivery/agendamento) ficam pra Fase 3, decisão de escopo consciente.
   - **Ordem de deploy importante que valeu aqui e vale pra qualquer RPC nova no futuro**: a migration foi commitada e o Fabricio a aplicou no Supabase **antes** do `index.html` correspondente ser commitado/publicado — GitHub Pages publica a cada push, então subir o JS que chama uma RPC inexistente teria quebrado o site inteiro até a migration rodar.
   - **Achado durante a investigação, não corrigido (fora de escopo)**: `openNewComandaModal` tem uma definição morta/sombreada — `function openNewComandaModal(tableNumber){...}` (linha ~3271) é imediatamente sobrescrita por `openNewComandaModal=function(){...}` (linha ~3817, fluxo de comanda nominal). É o mesmo padrão de "função duplicada viva" que o `cto-arquiteto` já tinha achado em outro lugar do código numa rodada anterior — não afeta a correção desta sessão (a versão realmente usada já passa pelo `saveNewNamedComanda`, que foi corrigido), mas é candidato a limpeza futura.
   - **Ainda não testado numa venda real de ponta a ponta em produção** — recomendo abrir uma comanda, lançar item, fechar com pagamento (inclusive um teste com fiado) antes de confiar 100% nisso no meio de um expediente cheio.

### Fase 2 — RLS por papel + auditoria append-only — CONCLUÍDA em 2026-09-08

Feito pelo agente `backend-senior` (investigação + implementação). Commitado, publicado no GitHub Pages e a migration aplicada e retestada em produção (ver ordem de deploy abaixo).

**O problema que motivou tudo:** a RLS de hoje só pergunta "esse dado é do meu tenant?", nunca "esse usuário tem papel pra isso?". Um operador de caixa (ou cozinha) autenticado conseguia abrir o devtools e ler/escrever qualquer coisa que a RLS deixasse passar — e o filtro de menu (`ROLE_PERMS`) nem cobria isso direito no client (ver achados abaixo).

**3 achados que tiveram que ser corrigidos ANTES da RLS fazer sentido** (senão a Fase 2 seria cosmética ou, pior, destrutiva):
1. **Buraco no filtro de menu**: item de ribbon com `action:` (em vez de `view:`) era liberado pra qualquer papel sem checagem nenhuma — o caixa já clicava em Configurações do Sistema, Logs, Contas a Pagar, Bot WhatsApp (grava token), Pix Online (grava client secret), Cupons, Alterar em Lote, etc.
2. **Risco de apagar dado real**: `storageApi.get()` não distingue "RLS bloqueou a leitura" de "a linha não existe" — os dois casos viram vazio, e `loadAll()` semeava um valor padrão nesse caso e gravava por cima (users, locais, impressoras, estações, origens). Invariante adotada: *se o papel pode escrever, ele tem que poder ler*.
3. **RLS por papel seria cosmética**: sessão de operador não resolvia o tenant no boot (aparelho ficava preso na sessão do dono, que não tem papel e passa por tudo) e o logout não derrubava a sessão do Supabase de verdade (sessão do operador anterior sobrevivia).

**O que foi implementado no `index.html`** (234 linhas adicionadas, 58 removidas — arquivo modificado, não commitado):
- `renderRibbonToolbar()`: os 39 itens de ação agora declaram `perm:`; item sem `perm` é **negado por padrão** (fail-closed), não liberado.
- `loadAll()`: seed de dado padrão só roda quando dá pra provar que a escrita é segura (fora da nuvem, ou sessão de dono) — operador nunca semeia, e chave cuja leitura falhou por erro de rede também nunca é semeada.
- `resolveTenantId()` virou `resolveTenantSession()`: reconhece sessão de dono E de staff (via RPC `current_tenant_id()`, já que `tenant_staff` tem RLS sem nenhuma policy).
- `btnLogout` e `gcLogout` (app do garçom): agora chamam `supabaseClient.auth.signOut()` de verdade.
- `logAction`/`logPinFail`: em modo nuvem gravam (fire-and-forget) na tabela nova `public.audit_log`; `openLogsView` passou a exigir permissão de admin.
- Achou e corrigiu de passagem 2 bugs preexistentes: `savePermissionMatrix` apagava silenciosamente 5 permissões do caixa (locais/impressoras/estações/origens/mobile-qr) ao salvar a matriz; falha de PIN não aparecia na tela de Logs por divergência de nome de campo.

**Tabela de permissão nova, decisões que o Fabricio ainda precisa confirmar** (nenhuma bloqueante, mas mudam o que o caixa pode fazer sozinho):
- 5 fluxos que hoje o caixa usa pra configurar coisas (formatação de ticket, config. da fila de atendimento, painel de senhas, tags de cliente, canal do cardápio digital) passam a exigir permissão de admin — ficou uniforme com o que a RLS vai impor no banco.
- Cupons/Fidelidade/SMS/Disparador Inteligente agrupados sob a mesma permissão (reaproveitou o token `cupons` já existente, só mudou o rótulo na matriz).
- Os 12 relatórios continuam liberados pro caixa (confirmado que nenhum lê `contas`, então não vaza dado financeiro de retaguarda).
- Verificado por script: admin não perde acesso a nenhum item; todo token novo introduzido está em `ROLE_PERMS.admin`.

**Migration pronta**: `supabase/migrations/20260901000000_rls_por_papel.sql` (já promovida, sem prefixo `DRAFT_`) — `current_staff_role()`/`is_admin_like()`, classificação de todas as chaves de `app_data` em catálogo/pedidos/operacional/auditoria/admin (default fail-closed pra chave nova desconhecida), policies por comando (select/insert/update separados, sem delete) em `app_data`/`members`/`member_dependents`/`member_debt_entries`/`print_jobs`, tabela `public.audit_log` append-only de verdade (sem policy de update/delete nem pro dono), checklist de reteste pós-aplicação (seção 9 — passo a passo do fluxo de caixa que não pode quebrar + o que tem que aparecer bloqueado) e rollback colável (seção 10).

**Assumido de propósito, não resolvido nesta fase:**
- As RPCs de venda eram `SECURITY INVOKER`, deixando o caixa com UPDATE direto nesses blobs via devtools — **resolvido na Fase 2b, ver seção própria abaixo.**
- `cantina2:settings` mistura branding com segredo de integração (token WhatsApp, client secret Pix, token SMS/backup/canais digitais) — todo operador que abre o PDV precisa ler `settings`, então continua lendo os tokens. RLS por linha não resolve isso; segredo tem que sair pra Edge Function/Vault — Fase 3.
- Não existe operador `cozinha` fixo em produção hoje (`tenant_staff` = 1 admin + 1 caixa, ambos migrados) — as policies de cozinha foram validadas com um operador de teste criado e excluído em 2026-09-08 (ver ordem de deploy abaixo), mas nenhum operador de cozinha real fica cadastrado.

**⚠️ Ordem de deploy fixa — TODAS AS 5 ETAPAS CONCLUÍDAS em 2026-09-08:**
1. ✅ Revisar o diff do `index.html` (ver decisões acima) e commitar. (`96ccc2f`)
2. ✅ Publicar (push em `main`) e conferir login de admin E de caixa já no ar, com o menu se comportando certo.
3. ✅ Aplicar a migration no Supabase (Fabricio rodou no SQL Editor). Confirmado via leitura pós-aplicação: `current_staff_role()`/`is_admin_like()`/`current_tenant_id()` corretos pros dois papéis, `app_data_key_class()` cobre as 15 chaves reais em produção sem cair no default fail-closed.
4. ✅ Checklist de reteste da seção 9 rodado com o bar em operação normal (não vazio — decisão consciente do Fabricio pra não perder a janela; testes limitados a leitura/estados que não afetam venda real). Todos os itens passaram, nenhum rollback necessário:
   - Caixa: UI fail-closed confirmada (Configurações/Financeiro/Logs/Fila de Eventos desabilitados), RLS confirmada via devtools (catálogo só leitura, sem escrita fora de pedidos/operacional), não lê `audit_log`, consegue inserir em `audit_log` (mesmo padrão do `logAction` real), não consegue update/delete em `audit_log` (bloqueado por REVOKE de tabela). Admin vê no Logs os eventos gerados pelo caixa.
   - Cozinha: login foi direto pro Monitor em Modo TV, moveu pedido pendente→preparo→pronto→entregue com sucesso, `select members`→0 linhas, `select app_data key='cantina2:sales'`→0 linhas.
   - **Deferido de propósito, não feito**: o teste de venda completa do caixa ("não pode quebrar" — abrir caixa, vender, fechar) foi pulado por decisão do Fabricio pra não gerar dado residual de venda/estoque/fiado sem forma limpa de desfazer. Fica validado organicamente no primeiro uso real supervisionado.
5. ✅ Criado operador de cozinha de teste ("Teste Cozinha Desktop (apagar)", perfil Cozinha) pra validar o item 4 acima, testado e **excluído em seguida** — não existe mais em produção.

### Fase 2b — RPCs de venda SECURITY DEFINER + fecha o buraco de devtools — CONCLUÍDA em 2026-09-08

Feito diretamente nesta sessão (sem agente separado), migration `supabase/migrations/20260908000000_fase2b_rpc_security_definer.sql`.

**O que mudou:**
- `next_order_number`/`consume_insumos`/`close_sale` viraram `SECURITY DEFINER`, com uma checagem interna no topo de cada uma (`is_admin_like() or current_staff_role()='caixa'`) — repete a mesma regra que a RLS de `operacional` já aplicava, porque virar `DEFINER` faz a função ignorar a RLS por dentro, então quem barrava um papel indevido (ex. cozinha) tinha que passar a ser a própria função.
- As policies `app_data_insert_por_papel`/`app_data_update_por_papel` perderam, só pro caixa, a escrita direta em `cantina2:orderCounter` e `cantina2:insumos` (SELECT não mudou). Confirmado antes de escrever a migration que isso é seguro: `ROLE_PERMS` do `index.html` não dá ao caixa os tokens `insumos`/`config-sistema` (únicas telas com escrita direta nessas chaves em modo nuvem são admin-only), e o fallback de Modo Local desses `save()` nunca toca o Supabase.
- `cantina2:sales` ficou de fora de propósito — ainda tem ~11 pontos de abertura de comanda/delivery/agendamento fora do `close_sale`, travar quebraria esses fluxos. Risco residual documentado, deferido pra Fase 3.

**Verificado em produção (2026-09-08), logado como caixa real via devtools:**
- `UPDATE app_data ... where key='cantina2:orderCounter'` → `[] null` (RLS bloqueou, 0 linhas).
- `UPDATE app_data ... where key='cantina2:insumos'` → `[] null` (idem).
- `supabaseClient.rpc('next_order_number', {p_start:1})` → retornou um número normalmente, sem erro — prova que a função está rodando como `SECURITY DEFINER` (se ainda fosse `INVOKER`, teria sido bloqueada pela mesma RLS que acabou de barrar a escrita direta).
- `SELECT app_data where key='cantina2:sales'` → retornou normalmente (não regrediu).
- Efeito colateral do teste: a chamada real de `next_order_number` avançou o contador de pedidos de verdade (pulou pra 13) — deixa um "buraco" na numeração (não existe pedido #13), sem outro impacto. Ajustável em Configurações se quiser, não é urgente.
- Teste negativo do papel cozinha (chamar a RPC esperando o erro `sem permissao`) não foi feito — decisão consciente por já reaproveitar a mesma regra que a RLS da Fase 2 validou pra cozinha, não valia recriar conta de teste só pra isso.

### Fase 3a — pedidos da cozinha em tabela relacional — CONCLUÍDA em 2026-09-08

Primeira fatia da Fase 3 (o resto — `sales`/`cashSession`/`orderCounter` — continua em blob, ver Pendências).

- `cantina2:orders` saiu do blob de `app_data` — cada pedido agora é uma linha em `public.orders`, com RLS por papel (owner/admin/caixa/cozinha têm select/insert/update; sem policy de delete, pedido cancelado vira `status='cancelado'` e nunca some da tabela, mesmo padrão do `archived` de sócios).
- `OrdersStore` novo no `index.html` centraliza enviar pra cozinha, avançar/retornar status, juntar comandas (`mergeOpenOrders`) e cancelar delivery — com fallback pro blob antigo em modo Local, mesmo padrão do `MembersStore` da Fase 1.
- `app_data_key_class()` perdeu a entrada `cantina2:orders` (cai no `else 'admin'` fail-closed) — nenhum papel em nuvem lê/escreve mais essa chave.
- Migration `supabase/migrations/20260908010000_fase3a_orders_table.sql` — aplicada em produção (confirmado antes de rodar: a chave `cantina2:orders` estava vazia no banco real, **sem dado pra migrar/backfill**). Verificado por script depois de aplicar: colunas/policies da tabela nova batem com o esperado, `app_data_key_class` já não menciona mais `cantina2:orders`.
- Commit `7d8a846`.
- **Pendente**: o checklist de reteste funcional descrito no cabeçalho da migration (enviar item pra cozinha, avançar status, juntar comandas, cancelar delivery) ainda não foi confirmado explicitamente nesta sessão — recomendo rodar esse fluxo de ponta a ponta antes de confiar 100% em produção.

**Achado de passagem, corrigido no mesmo dia**: `ROLE_PERMS` já liberava a permissão `cozinha` pra admin e caixa, mas o item nunca tinha entrado em `RIBBON_TABS` — só existia em `SIMPLE_RIBBON_COZINHA`, exclusivo de quem loga como papel cozinha (que hoje não existe fixo em produção). Sem isso, admin/caixa não tinham como abrir o Monitor de Cozinha pela navegação normal. Corrigido (commit `0f2a188`).

### Correção pontual — card de comanda não atualizava após "Novo Pedido" (2026-09-08)

Bug relatado pelo Fabricio testando: ao lançar um item numa comanda já aberta pelo fluxo "Novo Pedido" (dentro do modal da própria comanda), o total certo só aparecia no card da tela de Mesas/Comandas depois de sair e voltar da tela — dentro do modal o valor já vinha certo.

Causa: `confirmNovoPedidoModal` reabre o modal da comanda (`openComanda(saleId, true)`) depois de salvar, mas nunca chamava `renderComandas()` — o card por trás do modal só era redesenhado quando `switchView('comandas')` rodava de novo. Confirmado que **não foi introduzido pela Fase 3a** (comparado com a versão anterior ao commit `7d8a846`, a função já tinha esse comportamento).

Corrigido adicionando a chamada a `renderComandas()` logo depois de reabrir a comanda. Testado no navegador em modo Local (shim temporário de `window.storage`, removido antes do commit): o card atrás do modal já nasce com o total certo. Commit `fdf57e3`.

### Cloudflare Turnstile no login/cadastro de estabelecimento (2026-09-10)

Tela `renderTenantSetup` (login/criação de estabelecimento por e-mail/senha) ganhou captcha — `signInWithPassword`/`signUp` passam `options.captchaToken`, widget renderizado em `#tsTurnstile` via `renderTurnstileWidget()`/`resetTurnstile()`. Sitekey de produção `0x4AAAAAAEvfROl-Igsdqe7h` hardcoded no `index.html` (é pública, não é segredo). Commit `3bc084d`, publicado.

- **Proteção habilitada no Supabase** (Authentication → Attack Protection → Bot and Abuse Protection → Enable Captcha protection, provider Turnstile by Cloudflare, secret key configurada) — sem isso o token enviado não seria validado no servidor e a mudança seria só cosmética. Confirmado ativo (toggle ligado, secret salvo).
- **Testado visualmente**: localhost precisou ter o domínio liberado na sitekey no painel Cloudflare (erro 110200 = domínio inválido antes disso); produção (`codesphere-company.github.io`) já funcionava sem ajuste. Widget confirmado renderizando e completando ("Sucesso!") nos dois ambientes.
- **Testado de ponta a ponta pelo Fabricio**: login real (`signInWithPassword`) com captcha ativo no Supabase, funcionou normalmente.

### Redesign do card do Monitor de Cozinha (2026-09-12)

Card do `renderCozinha()` refeito no estilo Saipos: cabeçalho com nome/comanda e badge de tempo, checkboxes alinhados à direita, divisores entre itens, botão de concluir pedido como faixa lateral integrada ao card — mantendo as cores de status já existentes. Commit `7b1bec9`, publicado.

### Setup de automação do Claude Code (2026-09-12)

Depois de rodar o `claude-automation-recommender` sobre o repo, implementado:

- **`.mcp.json` (novo, commitado)**: registra os MCP servers do projeto de forma compartilhável — `github` (servidor hospedado oficial, `https://api.githubcopilot.com/mcp/`, autentica via OAuth no primeiro uso de cada pessoa) e `supabase` (mesmo pacote read-only já em uso, mas com o token referenciado como `${SUPABASE_ACCESS_TOKEN}` em vez de embutido — cada pessoa seta a própria variável de ambiente; o escopo local do Fabricio com o token real continua funcionando como sempre, sem mudança).
- **Hooks novos em `.claude/settings.json`** (este arquivo é o único de `.claude/` versionado; os scripts abaixo ficam em `.claude/scripts/`, não versionados, mesmo padrão do `guard-migrations.sh` que já existia):
  - `guard-env-files.sh` — bloqueia `Edit`/`Write` em `.env`/`.env.*` reais (permite `.env.example`/`.sample`/`.template`).
  - `warn-large-index-edit.sh` — avisa (não bloqueia) quando um `Edit` no `index.html` troca >150 linhas ou usa `replace_all`, ou um `Write` muda o tamanho do arquivo em >15% — o arquivo é único, ~900KB, sem build/teste automático que pegue uma reescrita acidental.
- **Subagente novo**: `backup-integrity-auditor` (`.claude/agents/`, não versionado) — audita se o workflow `backup-supabase.yml` de fato produz um dump restaurável (runs recentes, artifact não vazio, secret válido, retenção de 90 dias vs. nunca ter havido um teste de restore documentado), não só se o job passou verde. Ainda não foi rodado.
- Commit `f181cb1` (`.mcp.json` + `.claude/settings.json`), pushado.

### Auditoria de código vs. HANDOFF (2026-09-12)

Feita pelo agente `dev-arquiteto-foodservice`, cruzando o texto deste HANDOFF com o código/schema real (`index.html`, migrations, edge function, workflow de backup) — não confiando no texto sem confirmar.

**Confirmado pronto**: RPCs de venda com trava/idempotência, Fase 2b (`SECURITY DEFINER`), Fase 3a (`orders` relacional), RLS por papel, `staff-auth` (bcrypt, bloqueio), backup via `pg_dump`, fiscal de fato zero.

**Pendências quantificadas com mais precisão**:
- Blob `sales`/`cashSession`/`orderCounter`: **~48 pontos de escrita direta** ainda fora do relacional (`save('sales')`×27, `cashSession`×2, `orderCounter`×4, `cashHistory`/`insumos`/etc.×15) — risco de last-write-wins ativo, não é mais "o resto abstrato da Fase 3".
- Poll de 6s (`index.html:5951-5969`) tem `catch` vazio — se a rede cair, a sincronização cozinha/vendas para **sem nenhum aviso** ao operador.
- Carrinho duplicado: são **4 implementações** confirmadas (PDV/comanda, sub-modal "Novo Pedido", app do garçom, Totem/Cardápio Digital), não 5 como o texto antigo sugeria.
- `cantina2:settings` ainda mistura `waToken`/`smsToken` com branding, lido por todo operador no boot (o secret do Pix já foi removido na Fase 0, esse ponto está OK).
- Backup sem restore-drill documentado — segue confirmando o achado do subagente `backup-integrity-auditor` (ainda não executado).

**Gaps novos, não documentados antes**:
- Mais **6 funções mortas/sombreadas** (além da `openNewComandaModal` já conhecida): `openSelectedProductStock`/`openProductStockAdjustment`/`saveProductStockAdjustment` (linhas 2069-2071, mortas), `renderPdvProductLocator` (linha 3244, morta), `renderOrderHistoryReport`/`openOrderHistoryColumns` (linhas 4838/4841, mortas) — todas sobrescritas por versões reais mais completas nas linhas seguintes; nenhuma causa bug hoje, mas edição futura na cópia errada não teria efeito nenhum, silenciosamente.
- `resolveTenantSession()` (`index.html:932-941`) trata falha de rede igual a "sem tenant" — mesma classe de bug que a Fase 2 já corrigiu em `storageApi.get()`, aqui ainda não.
- Grant residual de `EXECUTE` pra `anon` nas RPCs de venda — continua não-explorável (depende de `auth.uid()` nulo pra `anon`), mas a justificativa documentada na Fase 1 ficou desatualizada após a Fase 2b (virar `SECURITY DEFINER` mudou o motivo real de não ser explorável); vale um `REVOKE EXECUTE ... FROM anon` explícito só para não depender disso.
- Nenhum `console.log`/TODO/FIXME esquecido encontrado (ponto positivo).

**Nota técnica**: o grafo do `graphify` (`graphify-out/graph.json`) só indexa `HANDOFF.md`, `supabase/functions/staff-auth/index.ts`, `.mcp.json` e `CLAUDE.md` — **não gera nenhum nó de `index.html`**, que é onde está quase todo o código do sistema. A regra do CLAUDE.md de "rodar `graphify query` antes de grep" não se aplica na prática ao arquivo principal; precisaria de um extrator dedicado pra JS embutido em `<script>` dentro de HTML.

### Auditoria visual/UX — mudanças desde 2026-08-31/09-01 (2026-09-12)

Feita pelo agente `ux-design-senior`, focada só no que mudou desde a auditoria completa anterior (18/18 corrigidos, https://claude.ai/code/artifact/577f42d7-e7ef-406b-89b0-51894df6f03b) — não repetiu telas antigas. 7 achados novos, nenhum repete os 18 já corrigidos.

**Alta severidade:**
1. **Bug funcional, não só visual**: filtro de estação da cozinha (`index.html:2932-2933`) só reseta o valor salvo no `localStorage` se houver mais de 1 estação cadastrada. Se o dono reconfigurar e sobrar 1 estação só, o filtro fica travado (ex. em "bar"), o botão de filtro desaparece da tela, e o Monitor mostra "nenhum pedido em preparo" mesmo com pedidos reais na fila — sem qualquer aviso. Correção é trocar a condição pra não depender de `stations.length>1`.
2. **Botão duplicado**: o redesign de hoje (`7b1bec9`) adicionou um botão flutuante global "✕ Sair do Modo TV" (linha 591), mas a tela de Cozinha já tinha o mesmo botão inline no `<h2>` (linha 2943) — sobra um dos dois numa tela pensada pra ser mais limpa.
3. **Captcha do Turnstile mal posicionado**: widget fica no fim da tela (depois da seção de cadastro), mas valida tanto login quanto cadastro (`tenantSignIn`/`tenantSignUp`, linhas 5915/5934). Quem só faz login recebe o erro acima do botão Entrar, mas o controle pra resolver está bem abaixo, sem indicação de rolar. Erro de senha também expira o token sem avisar que precisa recompletar o captcha.

**Média severidade:** dois padrões visuais diferentes de "ativo" empilhados na mesma tela da Cozinha (subtabs navy vs. filtro amber); contraste do badge de tempo abaixo do mínimo AA (~3,6:1) no estado mais comum ("no prazo"); área de toque da checkbox de item (~25px) abaixo do recomendado (44px) pra ambiente de cozinha; ícone de "marcar pronto" é um tíquete, inconsistente com o `✓` usado no card de "pronto", sem `aria-label`.

**Não verificado**: comportamento do grid em Modo TV com 8+ pedidos simultâneos (precisa teste real, ex. sexta à noite cheia).

### Auditoria de propostas de funcionalidades (2026-09-12)

Feita pelo agente `product-manager`, lendo o HANDOFF completo pra avaliar valor de negócio real (não boa prática de engenharia genérica).

**🚩 Achado que merece correção imediata**: `finalizeCashSession` (`index.html:4743`) grava `countedAmount = expectedAmount` e `diff = 0` **sempre, hardcoded** — o controle de quebra de caixa é decorativo, sempre mostra verde, apesar de a UI já pintar a coluna "Diferença" de vermelho quando `diff != 0` (condição estruturalmente impossível hoje). Além disso, `renderAccountsReceivable` (linha 5407-5410) mostra o ID do caixa **atualmente aberto** pra 100% das vendas históricas — campo errado em toda linha antiga.

**Re-priorização da Fase 4** (valor de negócio, não esforço técnico):
1. **NFC-e deixa de ser "aguardando contador" passivo** — é o único item cujo risco cresce por dia de operação (retroativo, decadência de 5 anos; fiado já deveria gerar nota no consumo, não no pagamento). O que não depende do contador: cadastrar NCM/CFOP no catálogo agora, cotar provedor (Focus/PlugNotas/Tecnospeed/NFe.io). Crítico: a Fase 3 (migrar `sales`) precisa reservar campos fiscais desde já, senão o schema é migrado duas vezes.
2. **LGPD** — risco real é reclamação de sócio, não fiscalização: disparo de SMS/WhatsApp sem opt-in em ~1000 sócios, formulários públicos (totem/delivery/cardápio) sem aviso de privacidade, e "exclusão de titular" prometida no papel é tecnicamente impossível hoje (retenção fiscal) — o certo é anonimização.
3. **Fila de sincronização offline** não é "evolução" — é a contrapartida nunca entregue da decisão da Fase 0 (Modo Local avisa mas não bloqueia = vendas offline nunca sobem). Separar em: cache do app shell/service worker (pequeno, fazer já — hoje um refresh sem internet faz o app desaparecer no meio do expediente), fila de sync (só depois da Fase 3, reaproveitando a idempotência de `close_sale`/`sale_close_receipts`), PWA instalável (descartar, cosmético).
4. **Ledger de fidelidade — não construir ainda**: resgatar ponto hoje não desconta nada no PDV, é só um número. Decidir primeiro se fidelidade por ponto faz sentido num clube antes de dar auditoria a isso.
5. **Unificar os 4 carrinhos** (PDV/comanda, sub-modal "Novo Pedido", app garçom, totem/cardápio) — por último, sem projeto dedicado; fazer oportunisticamente quando uma feature nova tocar 2 deles.

**5 propostas novas priorizadas:**
1. **Conferência de caixa às cegas** (pequeno) — resolve o bug do `diff` hardcoded: pedir valor contado antes de mostrar o esperado, gravar diferença de verdade por operador.
2. **Fatura mensal do sócio / extrato + aging** (médio) — hoje não existe ciclo de cobrança do fiado, só saldo vs. limite de crédito.
3. **Divisão de conta por item na comanda** (médio, fazer só depois da Fase 3 — mexe no caminho mais sensível do sistema, mesmo que passa por `close_sale`).
4. **Contagem de estoque com apuração de perda real vs. teórico** (médio) — perda de chope/dose tipicamente come 3-8% do faturamento de bebida, hoje não medida.
5. **Resumo diário automático pro dono via Telegram** (pequeno-médio) — sem homologação Meta, sem custo, sem problema de LGPD (é o dono recebendo, não cliente).

Parado de propósito: Pix com confirmação automática (grande, depende de decisão comercial e volume real de delivery/totem) e portaria/carteirinha digital (fora do domínio de PDV).

**Reabertura de decisões:** "não dividir o `index.html`" continua válida, mas sugere apagar as 7 funções mortas achadas hoje e extrair só código-folha puro (formatadores, ESC/POS) pra módulos ES quando for tocar nele mesmo, em vez de um split grande. O poll de 6s não é só ineficiente — é a metade ativa do loop de last-write-wins (substitui `state.sales` inteiro a cada 6s enquanto ~27 pontos ainda escrevem o blob de volta), reforçando a Fase 3 como prioridade técnica nº1. Sinaliza 3 dívidas de teste empilhadas no mesmo caminho de dinheiro (venda completa pós-Fase 1, checklist pós-Fase 2, reteste Fase 3a) — recomenda uma sessão supervisionada única cobrindo tudo antes de abrir frente nova.

**Correção sugerida (2x) ao `CLAUDE.md`**: tanto esta auditoria quanto a de código confirmaram que a regra "rodar `graphify query` antes de grep" é inaplicável ao `index.html` (grafo só cobre `HANDOFF.md`/`staff-auth`/`.mcp.json`/`CLAUDE.md`) — vale ajustar a regra pra não exigir isso quando o alvo é `index.html`, até existir um extrator dedicado pra JS embutido em `<script>`.

### Tempo de comanda aberta nos cards e no modal (2026-09-18)

Pedido do Fabricio: mostrar há quanto tempo cada comanda está aberta, calculado a partir de `s.openedAt`.

- **Card da tela "Mesas e Comandas Abertas"** (`renderComandas()`): badge de tempo no canto superior, ao lado de "EM ATENDIMENTO" — verde (<60min), amarelo (60-120min), vermelho (≥120min). Mesma lógica de cor já usada no Monitor de Cozinha (`kOrderAgeClass`), com faixas próprias (`comandaAgeClass`) porque uma comanda fica aberta muito mais tempo que um pedido de cozinha.
- **Modal de detalhe da comanda**: linha "Iniciado em [data/hora]" ganhou o complemento "— Xh Ymin aberta" (`fmtOpenDuration`).
- Tela de comandas entrou no `setInterval` de 30s que já existia só pro Monitor de Cozinha, pra o tempo subir sozinho sem precisar trocar de tela.
- Testado via preview HTML isolado (CSS real extraído + dados de exemplo) — não testado dentro do app logado nesta sessão, por não ter as credenciais do Fabricio.
- Commit `60adf34`, PR #1, merge por fast-forward em `main` (`3b329da`).

### Bug de layout do card de comanda + vínculo de Mesa/Local (2026-09-18)

Fabricio mandou um print real de produção mostrando o card de comanda quebrado: uma comanda aberta há ~18 dias gerava um badge de tempo enorme (`"442h27min"`), fazendo o rótulo "EM ATENDIMENTO" quebrar linha e o valor total vazar pra fora do fundo colorido do card (aparecia como texto branco meio apagado sobre o cinza da página). Causa: `.comanda-person-card` tinha `min-height:150px!important` mas nenhum `height:auto`, e brigava com o `height:120px` de `.table-seat` — o card ficava travado numa altura fixa em vez de crescer com o conteúdo.

- `.comanda-person-card{height:auto!important}` — card cresce com o conteúdo.
- `.comanda-card-top{flex-wrap:wrap}` + `.cap{white-space:nowrap}` — o badge quebra pra linha de baixo se precisar, mas o rótulo nunca mais quebra no meio da palavra.
- `fmtOpenDuration()` fica compacto acima de 24h (`"18d 10h"` em vez de `"442h27min"`).
- Junto veio um pedido novo: vincular uma mesa ou espaço à comanda. O sistema já tinha quase tudo pronto e desconectado — `state.locais` (cadastro em Configurações → "Locais e Áreas do Clube"), o campo `s.local` já exibido no card quando presente, e uma função `saveComandaLocal()` que existia no código mas não tinha nenhum input chamando ela. Adicionado o select "Mesa / Local" no modal de detalhe da comanda, ligado a essa função.
- Testado via preview HTML isolado reproduzindo o cenário do print — não testado no app logado (mesma limitação de sempre).
- Commit `9e82c4b`, PR #2, merge em `main` (`d2f613f`).
- **Pendência levantada e ainda não resolvida**: a comanda de ~18 dias aberta que apareceu no print é bem provável de ser dado de teste/travado — vale o Fabricio localizar e fechar/excluir ela.

### Guard de sintaxe JS no index.html — hook local + CI (2026-09-18)

Saiu de uma sessão do skill `/claude-code-setup:claude-automation-recommender`: `index.html` não tem bundler nem build, então um erro de sintaxe em qualquer `<script>` só aparecia quando a página carregava no navegador. Também descobri que o GitHub Pages deste repo publica **direto da branch `main`, sem staging** (`build_type: legacy`) — ou seja, merge = produção instantânea, sem nenhum freio automatizado antes disso.

- **Hook local** (`.claude/scripts/guard-index-syntax.sh`, registrado em `.claude/settings.json`): roda depois de todo Edit/Write, extrai os blocos `<script>` inline e valida com `new Function()`. Só existe no disco local do Fabricio — o `.gitignore` deste repo exclui `.claude/*` exceto `settings.json`, mesmo padrão dos outros hooks (`guard-migrations.sh`, `guard-env-files.sh` etc.) que também não são versionados.
- **CI** (`.github/workflows/check-index-syntax.yml`): mesmo check rodando como Action em qualquer PR que toque `index.html` — segundo gate, cobrindo edições feitas fora do Claude Code.
- Também criada a skill local `.claude/skills/commandah-ship/SKILL.md`, documentando o fluxo de commit/push/PR deste projeto (branch a partir de `main`, stage seletivo, o lembrete de que não existe staging aqui) — mesma situação do `.gitignore`: só no disco local, não versionada.
- Testado manualmente: o hook passa limpo no `index.html` real e pega erro de sintaxe (exit code 2) num HTML quebrado de teste.
- Commit `58aa044`, PR #3, merge em `main` (`d4579df`).

### Backup Supabase — pg_dump 16 continuava resolvendo no PATH mesmo após instalar a 17 (2026-09-20)

O fix da Fase 0 (`supabase-backup.yml` instalando `postgresql-client-17` via apt) parecia correto mas o workflow seguiu falhando em **todos** os runs desde então (17, 18, 19 e 20/09), sempre com o mesmo erro: `pg_dump: error: aborting because of server version mismatch — server version: 17.6; pg_dump version: 16.15`.

Causa real, achada lendo o log de um run que falhou de verdade: a imagem do runner do GitHub Actions já vem com `pg_dump` 16.15 em `/usr/bin`, instalado **fora** do mecanismo de `update-alternatives` do `postgresql-common` — o log da etapa de setup só mostra o `update-alternatives` rodando pro `psql`, nunca pro `pg_dump`. Instalar a 17 via apt não troca essa resolução; o comando `pg_dump` sem path continuava chamando a 16.15.

- **Fix**: adiciona `/usr/lib/postgresql/17/bin` na frente do `PATH` via `GITHUB_PATH` logo depois do `apt-get install postgresql-client-17`, em vez de confiar em `update-alternatives`.
- **Validado de ponta a ponta**: disparado `workflow_dispatch` manual (run `35520135968`) depois do merge — completou com sucesso, artifact `supabase-backup.zip` gerado (55.681 bytes, retention 90 dias). Primeira vez que o backup noturno de fato funciona desde que foi criado.
- Commit `5b0c267`, PR #5, merge por fast-forward em `main` (`0267d8e`).
- **Ainda não feito**: o `backup-integrity-auditor` (subagente criado em 2026-09-12) continua sem rodar — vale acionar ele agora que existe pelo menos um dump real pra auditar, e nenhum restore-drill foi documentado ainda.

### Histórico/Motivo opcional no pagamento de fiado (2026-09-20)

Pedido do Fabricio: no modal de lançamento da Conta Corrente (Fiado) — `openFiadoEntry()` —, o campo **Histórico / Motivo** era obrigatório tanto pra **Registrar Dívida** quanto pra **Registrar Pagamento**, travando a baixa de um pagamento se o operador não digitasse nada ali.

- Mantém obrigatório pra **dívida** (`type==='debt'`); libera como **opcional** pra **pagamento** (`type==='payment'`) — label ganha "(opcional)" e o placeholder muda pra deixar isso claro.
- Se o motivo ficar vazio num pagamento, grava `'Pagamento'` como valor padrão — evita célula em branco na coluna Histórico do extrato do cliente.
- Testado só via checagem de sintaxe JS (`node -e` no bloco `<script>` — OK); não testado no app logado (mesma limitação de sempre, sem credenciais reais do Fabricio).
- Commit `8787c17`, PR #6, merge por fast-forward em `main` (`0c76edb`).

### Botão de Registrar Pagamento no modal de Consumo bloqueado (2026-09-20)

Pedido do Fabricio: quando abre uma comanda/cota vinculada a um sócio com saldo devedor acima do limite de crédito, o modal **"Consumo bloqueado"** (`blockIfMemberInDebt`, `index.html:843-853`) só tinha o botão de cobrança via WhatsApp — pra registrar o pagamento era preciso fechar o modal, ir em Financeiro → Fiado e procurar o cliente de novo.

- Novo botão **"💰 Registrar Pagamento"** ao lado do de WhatsApp: fecha o modal de bloqueio e abre direto o modal de baixa de fiado (`openFiadoEntry('payment')`) já com o sócio certo pré-selecionado.
- Só aparece pra quem tem a permissão `contas` (`hasPerm('contas')`) — mesma que já protege a tela Financeiro → Fiado; caixa/cozinha não ganham acesso novo a lançamento financeiro por essa via.
- `blockIfMemberInDebt` é chamada em 2 pontos (abertura normal de comanda em `confirmNewComanda`, e no app do garçom em `gcSelectMember`) — os dois ganham o botão automaticamente por ser a mesma função central.
- Testado só via checagem de sintaxe JS (`node -e` no bloco `<script>` — OK); não testado no app logado.
- Commit `bf8ba18`, PR #8, merge por fast-forward em `main` (`2ab5f06`).

### Trocar Cliente / Editar Cadastro na comanda já vinculada (2026-09-20)

Pedido do Fabricio: depois que a comanda já está vinculada a um sócio, ele precisava poder trocar pra outro cliente ou corrigir o cadastro sem sair da tela da comanda.

- `openComanda` (side panel `cash-order-links`): botão **"Vincular Cliente"** vira **"Trocar Cliente"** quando já existe `s.memberId`; novo botão **"Editar Cadastro"** ao lado, só quando há membro vinculado, chama `editMember(member.id)` direto.
- "Editar Cadastro" gated por `hasPerm('associados')` — mesma permissão da tela Clientes; `admin` e `caixa` têm, `cozinha` nem chega nessa modal (não tem `associados` nem `comandas`).
- `openComandaLinkClient(saleId)` parou de bloquear o relink com toast quando já havia membro vinculado — agora pré-seleciona o cliente atual no `<select>` e troca título/label do modal pra "Trocar Cliente"/"Trocar" nesse caso.
- Escopo deliberadamente não incluiu: reabrir a comanda automaticamente depois de editar o cadastro (fluxo genérico de `openMemberModal` continua fazendo `closeModal(); renderAll();`), nem filtrar sócios arquivados no dropdown (comportamento pré-existente).
- Testado só via checagem de sintaxe JS (`node -e` no bloco `<script>` — OK); não testado no app logado.
- Commit `66a21ec`, PR #10, merge em `main` (`15c1fa5`).

### Atalho "Já pedidos nesta comanda" no Novo Pedido (2026-09-20)

Pedido do Fabricio: poder fazer um novo pedido a partir do próprio histórico da comanda, sem precisar procurar de novo o produto no cardápio inteiro.

- `openNovoPedidoModal` ganhou uma seção **"Já pedidos nesta comanda"** acima da grade de Produtos, com os itens já lançados no histórico daquela comanda (`s.items`), deduplicados por `productId` e ordenados do mais recente pro mais antigo.
- `renderNpHistoryGrid()` (novo): monta os botões de atalho reaproveitando `npCartAdd` — mesma checagem de estoque de insumos (`productAvailable`) da grade normal. Só entram produtos ainda ativos no catálogo (`p.active!==false`); se o produto foi desativado depois de já ter sido pedido, some do atalho mas continua no histórico da comanda normalmente.
- Seção fica oculta (`display:none`) quando a comanda ainda não tem nenhum item lançado (comanda nova).
- `npSaleId` (novo, global) guarda a comanda da modal aberta pra `renderNpHistoryGrid` achar o histórico certo; chamado também dentro de `npCartAdd`/`npCartChangeQty` pra manter o badge de quantidade sincronizado nas duas grades (produtos + histórico).
- Testado só via checagem de sintaxe JS (`node -e` no bloco `<script>` — OK); não testado no app logado.
- Commit `e9fdabf`, PR #12, merge em `main` (`5472b88`).

### Botão "Pedir novamente" no histórico da comanda (2026-09-20)

Complemento direto do atalho acima: o Fabricio queria repetir um item **sem nem abrir a modal de Novo Pedido** — direto na tabela de histórico da comanda.

- Painel "Histórico da Comanda": cada item já enviado (`item.sent`) ganha um segundo botão ao lado de "🖶 Reimprimir": **"🔁 Pedir novamente"**. Abre um seletor de quantidade (+/-, `openReorderComandaItem`/`reorderQtyChange`) e, ao confirmar (`confirmReorderComandaItem`), lança essa quantidade do mesmo produto como novo item e já envia pra cozinha.
- Usa o mesmo solicitante (`requesterId`/`requesterName`/`requesterType`) do item original — não pede pra selecionar quem está pedindo de novo.
- Reaproveita `sendItemsToKitchen` (checagem de estoque de insumos) e a mesma lógica de impressão por estação (`saidaTemImpressao`/`resolvePrinterFor`/`printSingleTicket`) do fluxo normal de Novo Pedido.
- Só permite repetir produto ainda ativo no catálogo (`product.active!==false`).
- `currentSaleDraft` ganhou o campo `id` (o `saleId` da comanda aberta) pra esses handlers acharem a venda real sem embutir o saleId em cada `onclick` da linha do histórico.
- Testado só via checagem de sintaxe JS (`node -e` no bloco `<script>` — OK); não testado no app logado.
- Commit `8b659e0`, PR #14, merge em `main` (`eae3ed0`).

### Campo de busca de produto direto na comanda (2026-09-20)

Pedido do Fabricio: uma terceira porta de entrada pra adicionar produto, além do "Novo Pedido" e do "Pedir novamente" do histórico — poder procurar e lançar um produto sem sair da tela da comanda nem abrir modal nenhum de cardápio.

- `openComanda`: novo campo **"Adicionar produto direto"** (`comandaQuickSearch`) no topo do `cash-order-main`, acima do painel de Histórico. `renderComandaQuickSearch(q)` filtra produtos ativos por nome (até 24 resultados) e mostra num grid no estilo já usado no "Novo Pedido"/"Pedir novamente" (`np-prod-btn`).
- Clicar num resultado chama `openComandaQuickAdd(productId)`: se a comanda tem sócio vinculado, pede "Quem está pedindo" (titular/dependente, com o mesmo bloqueio por débito/`canOrder` do "Novo Pedido"); se é cliente avulso, pula direto pro seletor de quantidade.
- `confirmComandaQuickAdd()` reaproveita `sendItemsToKitchen` (checagem de estoque via `productAvailable`), `memberBlockedByDebt` e o pipeline de impressão por estação (`resolvePrinterFor`/`printSingleTicket`) — mesma base dos outros dois fluxos.
- Campo de busca desabilitado quando a comanda está bloqueada (`s.locked`); `openComandaQuickAdd` também barra com toast se a comanda foi bloqueada entre a busca e o clique.
- Não mexe no modal "Novo Pedido" nem no "Pedir novamente" — os três fluxos convivem lado a lado. Notado (mas não tocado, fora de escopo) um resquício de código morto de uma versão antiga da tela de comanda (`selectComandaRequester`, ids `comandaProductSearch`/`comandaRequesterStatus`) sem nenhum chamador no código atual; os ids novos deste recurso (`comandaQuickSearch`/`comandaQuickAddRequester`) foram escolhidos pra não colidir com ele.
- Testado só via checagem de sintaxe JS (`node -e` no bloco `<script>` — OK); não testado no app logado.
- Commit `6bd6d21`, PR #16, merge em `main` (`1b564e3`).

### Quantidade de copos para produtos de bar (2026-09-20)

Pedido do Fabricio: quando o produto é de bar, poder escolher quantos copos vão junto (0 é valor válido) — pra imprimir na ficha do bar sem mexer em estoque.

- Gatilho é só `product.estacao==='bar'` — reaproveita o campo que já existe no catálogo, sem categoria nova.
- Aparece nos 3 fluxos de adicionar produto: Novo Pedido (stepper de copos abaixo do de quantidade em cada item do carrinho, `npCartChangeCopos`), Pedir novamente (`reorderCopos`, pré-preenchido com o valor de copos do item original quando existir) e Adicionar produto direto (`comandaQuickAddCopos`).
- O valor só vai impresso na ficha do produto — `buildTicketText` e o fallback HTML de `printSingleTicket` mostram `Nx Produto — N copo(s)`. Não altera `sendItemsToKitchen` nem baixa de insumo; produtos que não são de bar simplesmente não ganham o campo `copos` no item (fica `undefined`).
- Testado só via checagem de sintaxe JS (`node -e` no bloco `<script>` — OK); não testado no app logado.
- Commit `4158e0b`, PR #18, merge em `main` (`93253ed`).

### Quantidade de copos no app do garçom (2026-09-20)

Pedido do Fabricio: o recurso acima só existia nos 3 fluxos do painel administrativo — o "app do garçom" (`#garcomApp`, usuário `garcom`/`origem:'app'`) é uma implementação de carrinho totalmente separada (`gc*`) e não tinha o campo.

- Mesmo gatilho `product.estacao==='bar'`. `gcAddToCart` agora seta `copos:0` no item novo quando o produto é de bar; `gcRenderReviewList` mostra o stepper (nova linha `.gc-copos-row` abaixo da linha de quantidade/preço) só pra esses itens; nova função `gcCartChangeCopos(idx,delta)` incrementa/decrementa com clamp em 0, espelhando `npCartChangeCopos`.
- Não mexeu no pipeline de impressão (`gcConfirmOrder`→`sendItemsToKitchen`→`printNovoPedidoTickets`/`buildTicketText`/`printSingleTicket`): já é compartilhado com os fluxos do admin e já lê `item.copos`; `gcConfirmOrder` espalha o item (`{...i}`) ao montar o pedido, então o campo atravessa sem mudança adicional.
- Testado com checagem de sintaxe JS (OK) e com um harness Node isolado (funções extraídas do arquivo real, rodadas com stubs de `state`/`toast`/`document`/`fmt`/`h`) — 5/5 asserções: item de bar ganha `copos:0`, stepper incrementa/decrementa, clamp em 0, item fora do bar não ganha `copos` nem renderiza a linha. **Não testado logado no app do garçom real** — injeção de JS na página de produção pra testar sem publicar foi bloqueada pela política do ambiente ("Modify Shared Resources"), e o teste via servidor local esbarrou no Supabase Auth/Cloudflare Turnstile (não validam fora do domínio publicado).

### Remove botão "Salvar e Continuar" da comanda + teste no app real (2026-09-20)

Achado ao investigar o botão "Salvar e Continuar" da tela de comanda: ele só existia porque `changeDraftQty` (+/- na tabela "Histórico da Comanda", pra itens ainda não enviados) alterava `currentSaleDraft.items` só em memória, sem persistir em `state.sales` — diferente de todo o resto do fluxo de edição da comanda (nota, local, bloqueio, Novo Pedido, busca rápida, Localizar Produto, transferência de itens), que já salva sozinho a cada ação.

- `changeDraftQty` agora persiste em `sale.items`/`save('sales')` de imediato quando `currentSaleDraft.type==='comanda'` — mesmo padrão dos outros fluxos.
- Removido o botão `btnSaveComanda` ("Salvar e Continuar") e seu handler, redundante depois do fix.
- Commit `04ee8fc`, PR #22, merge em `main` (`ebf9b25`).
- **Testado no app real em produção** (não só sintaxe JS, diferente da maioria das entradas acima):
  - Confirmado visualmente que o botão "Salvar e Continuar" sumiu da tela da comanda.
  - Teste de auto-save: mexi na quantidade de um item não enviado (+/-) na tabela de histórico, fechei a comanda sem clicar em nada, reabri — a alteração persistiu sozinha, confirmando que o `save('sales')` novo dentro de `changeDraftQty` está funcionando.
  - Ao investigar o call site de `changeDraftQty`/`openComandaProductLocator` (`index.html`), achei que `openComandaProductLocator(saleId)` não tem nenhum ponto de entrada na UI atual — a única chamada existente (`index.html:3135`) está dentro de um fluxo que só é alcançado se `window.comandaLocatorSaleId` já estiver setado, e nada no código hoje seta essa variável antes de chegar lá. Ou seja: o fix em `changeDraftQty` protege corretamente um caminho de código que hoje está órfão (sem botão que leve a ele), mas não é perigoso deixar assim — só fica registrado aqui pra não confundir uma futura investigação achando "dead code" e não entender por que o fix existe mesmo assim.
  - Limpeza: apaguei a comanda de teste criada durante essa verificação (#19, "TESTE QA botao comanda") usando o botão "Excluir Pedido" (`deleteComandaOrder`, `index.html:3726`). Ressalva: esse botão dispara um `window.confirm()` nativo do navegador, que trava a extensão do Claude Chrome (diálogo bloqueante); precisei neutralizar o `confirm` via JS (stub que retorna `true` automaticamente) antes de clicar, senão a sessão de automação travava.

## Pendências (próximos passos, backlog priorizado pelo scrum-master em 2026-08-31)

**Fase 1 — fundação:** concluída (itens 1-3, ver seção própria acima).

**Fase 2 — RLS por papel + auditoria append-only:** concluída (ver seção própria acima e a ordem de deploy fixa, todas as 5 etapas ✅ em 2026-09-08).

**Fase 2b — RPCs SECURITY DEFINER + fecha buraco de devtools:** concluída (ver seção própria acima, 2026-09-08).

**Fase 3a — pedidos da cozinha em tabela relacional:** concluída (ver seção própria acima, 2026-09-08) — reteste funcional de ponta a ponta ainda pendente.

**Fase 3 — arquitetura de dados (médio prazo):**
6. Migrar `sales`/`cashSession`/`orderCounter` de blob pra tabelas relacionais — resolve o last-write-wins entre dispositivos (cto-arquiteto + backend-senior + dba-dados). `orders` **já migrado** (Fase 3a, concluída em 2026-09-08, ver seção própria acima) — falta o resto.
7. Substituir o poll de 6s (compara JSON inteiro de orders+sales) por Realtime (frontend-senior) — agora que `orders` é tabela relacional, fica mais direto de fazer só pra ele.

**Fase 4 — evolução, não bloqueante:**
8. Unificar as 5 implementações de carrinho duplicadas (frontend-senior).
9. LGPD formal — aviso de privacidade, base legal, exclusão de titular (security-specialist + product-manager).
10. NFC-e via Edge Function nova, só se o contador confirmar obrigatoriedade (backend-senior + fiscal-tributario).
11. Avaliar PWA/offline pro "app do garçom" (que hoje é só o navegador responsivo, sem app nativo) — só depois que o item 3 da Fase 0 provou que o `save()` online nem finge sucesso hoje (mobile-senior).
12. Fidelidade/pontos (`points`/`pointsHistory`) ficou de fora da Fase 1 de propósito — migrada como coluna simples na tabela `members`, sem virar tabela relacional própria. Se quiser isso relacional também (com ledger de auditoria igual ao de débito), é uma fase separada.
13. ~~Monitor de Cozinha sem filtro por estação~~ — **CONCLUÍDO, já implementado no commit `7b1bec9` (2026-09-12)** junto do redesign visual do card, que originalmente foi documentado só como mudança de layout (ver seção "Redesign do card do Monitor de Cozinha" acima). `kitchenStationFilter`/`setKitchenStationFilter()`/`itemStation()` filtram os itens exibidos por estação, com botões "Todas" + um por estação quando há mais de uma cadastrada. Achado pela auditoria de 2026-09-12 (ver seção própria abaixo) comparando HANDOFF x código real. **Resta só**: não há deep-link por URL pra abrir direto "Monitor só da Cozinha"/"Monitor só do Bar" — o filtro é por clique + `localStorage` por aparelho, então montar monitores físicos dedicados por praça exige configurar cada dispositivo manualmente.
14. Campo "Qtd. Pessoas" (`gcPeople`) na tela "Confirmar Pedido" do app do garçom só existe lá — não tem equivalente no "Novo Pedido" do admin nem em nenhum outro fluxo. O valor é salvo em `sale.peopleCount` (`gcConfirmOrder`, commit `dad9150`) mas **não é lido em lugar nenhum do código atual**: não aparece na ficha impressa, não entra em relatório, não afeta taxa de serviço/couvert. Achado pelo Fabricio em 2026-09-20 perguntando pra que servia o campo. Parece meia-implementação de um recurso futuro (rateio de conta, couvert por pessoa, ou estatística de ocupação de mesa) — decidir se completa o uso real do dado ou remove o campo pra não confundir quem usa o app (product-manager + frontend-senior).

## Preferências de trabalho do usuário (Fabricio)

- Prefere mudança segura e escopada a mudança arriscada de uma vez só — já reforçou positivamente quando eu recusei fazer algo arriscado (ex. fundir telas de Totem/Cardápio, renomear `--amber` globalmente) e escolhi a correção mais pontual.
- Quer ser consultado antes de ações consequentes/irreversíveis: credenciais, `git push`, mudança de schema, qualquer operação destrutiva.
- Como minha conexão com o Supabase é read-only, ele roda o SQL que eu preparo e confirma ("rodei o sql, testa de novo") — esse ciclo é normal e esperado.
- Testa tudo no mundo real (impressora física, fotos de recibo impresso) e dá feedback visual iterativo — leva a sério a aparência do ticket impresso.
- Prefere que eu explique quando desvio da sugestão literal de um relatório de auditoria por uma correção mais segura, em vez de simplesmente aplicar por conta própria.

## Onde achar mais contexto

- Os dois relatórios publicados (links acima) têm o detalhamento completo de cada achado e correção.
- A pasta `.claude/agents/` (gitignorada) tem o time de 13 agentes do Commandah — fonte real de convenções pra esse time (ver seção "Time de agentes" acima). O resto de `.claude/` (skills, `dev-learning/`, etc.) ainda é o **vault pessoal de outro projeto** (MRNT/Together) misturado aqui por engano — só os arquivos de agente do Commandah devem ser tratados como deste projeto.
