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

### Fase 1 — Sócios em tabela relacional + limite de crédito real (2026-08-30, aguardando QA final)
- **Banco**: sócios saíram do blob JSON (`app_data` / chave `cantina2:members`) pra três tabelas relacionais reais — `members`, `member_dependents` e `member_debt_entries` (ledger de débito/pagamento com estorno, no lugar do array `debtHistory` solto). Um trigger (`recalc_member_debt`) recalcula `members.debt` sempre a partir da soma dos lançamentos não estornados — o saldo nunca é escrito direto pelo frontend. RLS igual ao padrão já usado em `app_data`/`print_jobs` (`tenant_id = current_tenant_id()`). Os 1000 sócios que já existiam foram migrados e a migração foi conferida por SQL (contagem batendo, um registro de teste com lançamentos reconciliando certo).
- **Limite de crédito**: campo `creditLimit` já existia meio pronto (usado só de leitura na tela Financeiro → Fiado, sem nenhum jeito de definir) — agora é editável no cadastro do sócio (aba "Dados Secundários"). O bloqueio de consumo trocou de `saldo devedor > 0` pra `saldo devedor > limite de crédito` em todo lugar que checava isso (PDV, comanda, delivery, seleção de titular).
- **Frontend**: criado um objeto `MembersStore` (perto da função `save()`, por volta da linha 910 do `index.html`) que centraliza toda leitura/escrita de sócio — os ~20 pontos do código que antes reescreviam o array inteiro (`state.members.push(...)` + `save('members')`) agora chamam métodos dele (`create`, `update`, `archive/restore`, `saveDependents`, `recordDebtEntry`, `reverseDebtEntry`, `bulkImport`, etc.). Continua funcionando em modo local (sem Supabase, só `localStorage`) e em modo nuvem (tabelas relacionais de verdade), sem duplicar essa lógica em cada função.
- **Limpeza**: removidas funções mortas que já existiam nessa área antes desta mudança — `settleDebt` (nunca era chamada), `renderFiadoLegacy`, e as versões antigas duplicadas/sombreadas de `renderFiado`, `openFiadoEntry`, `toggleFiadoOptions` e `toggleSelectedMemberArchived`.
- **Achados de UX corrigidos no caminho** (relatados pelo Fabricio testando): não existia botão de arquivar sócio na tela Clientes (só escondido em Financeiro → Fiado) — adicionado; a busca de clientes se perdia toda vez que você selecionava/editava um cliente (bug pré-existente, o filtro era só visual e sumia no re-render) — corrigido; o menu "•••  Opções" da tela Clientes não fechava sozinho ao clicar fora — corrigido.
- **Status**: commitado e enviado (`2f672ae`, 2026-08-31) — já publicado em produção via GitHub Pages. Fabricio testou na conta de dono e na de operador antes de commitar; um bloqueio de PIN de operador (5 tentativas erradas → 15 min, mecanismo da Fase 2, não relacionado a esta mudança) não afeta o login por e-mail/senha do dono.

## Pendências (próximos passos)

1. Fases 3–6 do roadmap de arquitetura (extração de pedidos/vendas + sessões de caixa por estação, Pix real, fiscal/TEF, KDS/controle de acesso/delivery em tempo real) — só mapeadas no relatório, sem planejamento ainda.
2. Apertar RLS por papel (follow-up da Fase 2, deixado pra depois de validar o login por operador em produção por um tempo).
3. Fidelidade/pontos (`points`/`pointsHistory`) ficou de fora da Fase 1 de propósito — migrada como coluna simples na tabela `members`, sem virar tabela relacional própria. Se quiser isso relacional também (com ledger de auditoria igual ao de débito), é uma fase separada.

## Preferências de trabalho do usuário (Fabricio)

- Prefere mudança segura e escopada a mudança arriscada de uma vez só — já reforçou positivamente quando eu recusei fazer algo arriscado (ex. fundir telas de Totem/Cardápio, renomear `--amber` globalmente) e escolhi a correção mais pontual.
- Quer ser consultado antes de ações consequentes/irreversíveis: credenciais, `git push`, mudança de schema, qualquer operação destrutiva.
- Como minha conexão com o Supabase é read-only, ele roda o SQL que eu preparo e confirma ("rodei o sql, testa de novo") — esse ciclo é normal e esperado.
- Testa tudo no mundo real (impressora física, fotos de recibo impresso) e dá feedback visual iterativo — leva a sério a aparência do ticket impresso.
- Prefere que eu explique quando desvio da sugestão literal de um relatório de auditoria por uma correção mais segura, em vez de simplesmente aplicar por conta própria.

## Onde achar mais contexto

- Os dois relatórios publicados (links acima) têm o detalhamento completo de cada achado e correção.
- Existe uma pasta `.claude/` no repo (gitignorada) que é um **vault pessoal de outro projeto** (MRNT/Together), misturado aqui por engano — não é deste projeto, não deve ser tratada como fonte de convenções do Commandah.
