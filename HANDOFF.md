# Handoff — Commandah

> Peça pra eu ler este arquivo no início de qualquer conversa nova sobre este projeto ("lê o HANDOFF.md antes de começar"). Eu mantenho ele atualizado ao fim de cada sessão relevante.

Última atualização: **2026-08-31**

## O que é o projeto

Commandah é o sistema de comanda/PDV do **Clube Olímpico** (Maringá — negócio real do Fabricio, não é side project fictício). Roda direto no navegador, sem servidor de aplicação:

- **Frontend**: um único `index.html` (~5000+ linhas), sem build step.
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
- Fase 2 do roadmap (login por operador) — **feita** (ver Segurança acima).
- Decisão explícita do usuário: **não** dividir o `index.html` em múltiplos arquivos por enquanto — o próprio relatório de arquitetura não recomendava isso agora.
- **Fase 1 do roadmap (sócios em tabela relacional + limite de crédito real) — implementada, em teste, ainda não commitada** (ver seção própria abaixo).

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

## Pendências (próximos passos, backlog priorizado pelo scrum-master em 2026-08-31)

**Fase 1 — fundação:** concluída (itens 1-3, ver seção própria acima). Próxima é a Fase 2.

**Fase 2 — próxima:**
4. RLS por papel com enforcement real (backend-senior + security-specialist) — ainda NÃO feito. Só fazia sentido depois do item 1 da Fase 0 (PIN em claro) estar fechado, senão seria reforçar a porta da frente com a dos fundos aberta — isso já aconteceu, então este item está liberado pra começar.
5. Auditoria append-only — hoje `cantina2:logs` é blob editável por qualquer operador, fraude interna não fica rastreável (security-specialist).

**Fase 3 — arquitetura de dados (médio prazo):**
6. Migrar `sales`/`orders`/`cashSession`/`orderCounter` de blob pra tabelas relacionais — resolve o last-write-wins entre dispositivos (cto-arquiteto + backend-senior + dba-dados).
7. Substituir o poll de 6s (compara JSON inteiro de orders+sales) por Realtime (frontend-senior).

**Fase 4 — evolução, não bloqueante:**
8. Unificar as 5 implementações de carrinho duplicadas (frontend-senior).
9. LGPD formal — aviso de privacidade, base legal, exclusão de titular (security-specialist + product-manager).
10. NFC-e via Edge Function nova, só se o contador confirmar obrigatoriedade (backend-senior + fiscal-tributario).
11. Avaliar PWA/offline pro "app do garçom" (que hoje é só o navegador responsivo, sem app nativo) — só depois que o item 3 da Fase 0 provou que o `save()` online nem finge sucesso hoje (mobile-senior).
12. Fidelidade/pontos (`points`/`pointsHistory`) ficou de fora da Fase 1 de propósito — migrada como coluna simples na tabela `members`, sem virar tabela relacional própria. Se quiser isso relacional também (com ledger de auditoria igual ao de débito), é uma fase separada.

## Preferências de trabalho do usuário (Fabricio)

- Prefere mudança segura e escopada a mudança arriscada de uma vez só — já reforçou positivamente quando eu recusei fazer algo arriscado (ex. fundir telas de Totem/Cardápio, renomear `--amber` globalmente) e escolhi a correção mais pontual.
- Quer ser consultado antes de ações consequentes/irreversíveis: credenciais, `git push`, mudança de schema, qualquer operação destrutiva.
- Como minha conexão com o Supabase é read-only, ele roda o SQL que eu preparo e confirma ("rodei o sql, testa de novo") — esse ciclo é normal e esperado.
- Testa tudo no mundo real (impressora física, fotos de recibo impresso) e dá feedback visual iterativo — leva a sério a aparência do ticket impresso.
- Prefere que eu explique quando desvio da sugestão literal de um relatório de auditoria por uma correção mais segura, em vez de simplesmente aplicar por conta própria.

## Onde achar mais contexto

- Os dois relatórios publicados (links acima) têm o detalhamento completo de cada achado e correção.
- A pasta `.claude/agents/` (gitignorada) tem o time de 13 agentes do Commandah — fonte real de convenções pra esse time (ver seção "Time de agentes" acima). O resto de `.claude/` (skills, `dev-learning/`, etc.) ainda é o **vault pessoal de outro projeto** (MRNT/Together) misturado aqui por engano — só os arquivos de agente do Commandah devem ser tratados como deste projeto.
