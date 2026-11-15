# LGPD dos sócios: garçom vê menos, anonimização completa e automática

Item 6 da auditoria de lançamento (11/11/2026). Pedido do dono em 15/11/2026.

## Por quê

O dono quer vender o Commandah para outros bares e clubes. Hoje três pontos não se sustentam diante da LGPD:

1. O aparelho do garçom baixa o cadastro inteiro do sócio (CPF, RG, telefone, e-mail, endereço, nascimento, observações), embora o app do garçom só use nome, cota, tipo, saldo, bloqueio e dependentes.
2. "Anonimizar" apaga o cadastro, os dependentes e o nome nas comandas e pedidos, mas o nome continua no registro de ações (`audit_log`, texto livre como "Pagamento de fiado: Fulano — R$ 30"), nos lançamentos de fiado (`member_debt_entries.reason/info`) e em cópias de backup dentro de `app_data` (chaves `backup:*`).
3. Não há expurgo: Configurações › Privacidade só lista quem passou do prazo (padrão 2 anos depois de arquivado) e o admin anonimiza um por um. Se ninguém clicar, os dados ficam para sempre.

## Objetivos

- O garçom recebe só o que o app dele usa, e o bloqueio vale no servidor (RLS), não só na tela.
- A anonimização acontece no banco, numa função só, usada pelo botão manual e pelo agendador.
- Ela troca o nome do sócio e dos dependentes por "Sócio anonimizado XXXX" em todos os lugares do banco onde ele aparece, exceto nas NFC-e.
- Toda madrugada o banco anonimiza sozinho quem está arquivado há mais tempo que o prazo configurado.
- O admin vê, uma semana antes, quem vai ser anonimizado.

## Fora do escopo

- NFC-e (`nfce_*`, XML, CPF na nota): a lei fiscal obriga guardar; não mexer.
- Backups fora do banco (Google Drive, arquivos baixados): o aviso de privacidade já cobre; fica para o dono.
- Caixa continua lendo o cadastro inteiro (precisa para cadastrar e cobrar).
- Revisão jurídica do aviso de privacidade (pendência do dono com o advogado).

## Anti-objetivos (seria falha mesmo funcionando)

- Anonimizar quem tem saldo (fiado ou crédito) diferente de zero ou comanda aberta. Esses ficam de fora do automático e aparecem na lista para o admin resolver.
- Mudar valores: vendas, fiado, pontos e totais continuam iguais; só os campos de identificação mudam.
- Quebrar o app do garçom: ele continua vendo nome, cota, saldo/crédito, bloqueio, tipo (sócio/colaborador) e dependentes com "pode pedir".
- Mudar o aviso de privacidade sem o advogado (o texto atual já descreve este comportamento: "em seguida o cadastro é anonimizado").

## Abordagens consideradas

**Quem roda o automático**
1. pg_cron no próprio banco, toda madrugada, chamando a função SQL. **Escolhida pelo dono (15/11).** Sem peça fora do banco; manual e automático usam a mesma função.
2. Edge Function agendada: no Supabase o agendamento também é pg_cron por baixo; mais peças para o mesmo resultado.
3. Rodar quando o admin abre a tela: depende de alguém entrar. Descartada.

**Garçom ver menos**
1. View (ou RPC) só com as colunas que o garçom usa, e o garçom sai da policy de SELECT de `members`. **Escolhida (call do Claude, aceita pelo dono).**
2. Esconder só na tela: os dados continuariam chegando ao aparelho. Descartada.

## Desenho

### 1. Garçom com leitura restrita

- `members_select_por_papel` volta a `owner, admin, caixa` (tira `garcom`).
- Nova função `members_garcom_list()` (SECURITY DEFINER, `search_path=''`, só para `authenticated`, recusa quem não é garçom do tenant atual) devolvendo, do tenant atual: `id, name, code, kind, debt, credit_limit, active, archived, debt_release, anonymized_at`. Função em vez de view porque view com RLS de dono contorna a policy; a função deixa explícita a checagem de papel.
- `member_dependents`: a policy `member_dependents_select_garcom` sai; a mesma função (ou uma irmã `member_dependents_garcom_list()`) devolve `id, member_id, name, relationship, can_order`, sem `document`.
- `member_debt_entries`: conferir que o garçom já não lê (a policy atual é por papel). Se ler, tirar.
- Front: `MembersStore.load()` e o poll de saldo (`dados-socios.js`, que relê `debt`/`debt_release`) usam as funções quando o papel atual é `garcom`. Os campos que não vêm ficam vazios no objeto do sócio.
- Conferir no código do app do garçom todo uso de `member.*` e de `state.members` que dependa de campo removido (ex.: busca por telefone, observações) e ajustar.

### 2. Anonimização no banco

Nova função `member_anonymize(p_member_id text, p_origem text)` (SECURITY DEFINER, `search_path=''`):

- Chamada pelo front: só `owner`/`admin` do tenant do sócio. Chamada pelo agendador: roda como dono da função, sem `auth.uid()`, com `p_origem='automatico'`.
- Recusa se: já anonimizado; `abs(debt) > 0.005`; existe venda aberta do sócio em `sales` (`status='open'`, `deleted_at is null`, não cancelada).
- Nome novo: `'Sócio anonimizado ' || upper(right(id, 4))` (igual ao front de hoje).
- Coleta os nomes antigos: nome do sócio + nomes dos dependentes (não vazios).
- Atualiza, numa transação:
  - `members`: zera nome/cota/telefone/e-mail/sexo/documento/RG/nascimento/endereço/referência/IBGE/tags/notas/coordenadas/`geo_status`/`marketing_opt_in`; `archived=true`, `archived_at=coalesce(archived_at, now())`, `anonymized_at=now()`. Não muda `kind`, `debt`, `points`, `points_history` (conferir se `points_history` tem nome; se tiver, trocar).
  - `member_dependents`: apaga as linhas do sócio.
  - `sales.data`: nas vendas com `memberId` = sócio, `customerName` vira o nome novo; nos itens, `requesterName` que esteja entre os nomes antigos ou com `requesterId` = sócio vira o nome novo. A gravação não pode disparar a conferência de novo (ela só roda na passagem para fechada; conferir o gatilho).
  - `orders.who`: das vendas acima.
  - `member_debt_entries.reason` e `.info` do sócio: troca cada nome **seguro** pelo nome novo (regra abaixo).
  - `audit_log` do tenant (inclusive as linhas `entity='member'` do sócio): `action` e os valores de texto de `meta` pela regra de texto livre (abaixo).
  - Outros lugares com nome, pela mesma regra de texto livre: `print_jobs.content`, `sale_close_receipts.result`, `cash_turnos.turno`, e `app_data` do tenant nas chaves `backup:%`, `cantina2:logs`, `cantina2:requests`, `cantina2:scheduled`, `cantina2:cashHistory` e o blob congelado `cantina2:sales` (cópia das vendas até 10/10). Para esse blob, o gatilho `trg_app_data_sales_somente_leitura` ganha exceção só para esta função (variável de sessão ligada dentro dela, como os outros gatilhos do projeto fazem). O construtor confere no banco local se há mais algum lugar com nome (ex.: `client_errors`) e inclui.
  - **Regra de texto livre (revisão final, 15/11, decisão do controlador):** troca por palavra inteira, sem diferenciar maiúsculas, então "Ana" não troca dentro de "Banana". A decisão é **por nome**: só entra em texto livre o nome "seguro", com 2 palavras ou mais e que não esteja contido, como palavra inteira, em nenhum nome identificado do tenant (outro sócio não anonimizado, dependente de outro sócio, usuário de `cantina2:users`, produto de `cantina2:products`; comparação sem diferenciar maiúscula acentuada). Vale para o texto livre do tenant e para os textos livres ligados por id (extrato, `audit_log` do sócio, pontos, observações das vendas dele). Nome de uma palavra só nunca entra em texto livre. As igualdades ligadas por id (`customerName` e `requesterName` das vendas do sócio, `orders.who` delas) continuam com todos os nomes antigos. Se algum nome ficou fora da lista segura, o `audit_log` da anonimização registra "nomes mantidos no texto livre: N" (sem escrever os nomes) e `meta.nomes_mantidos`.
- Grava no `audit_log` "LGPD: cadastro anonimizado (Sócio anonimizado XXXX) — manual/automático", sem o nome antigo.
- Devolve `{ok, nome_novo}` ou `{erro}` com motivo legível.

Front: `doAnonymizeMember` passa a chamar `member_anonymize` em modo nuvem e só atualiza o estado local com o resultado. O modo local (sem servidor) continua com o código de hoje.

### 3. Expurgo automático

- Migration habilita `pg_cron` (se ainda não estiver) e agenda `lgpd_expurgo_diario()` às 07:00 UTC (04:00 de Brasília).
- `lgpd_expurgo_diario()`: para cada tenant, lê o prazo em anos de `app_data` `cantina2:settings` → `privacy.anos` (padrão 2, mínimo 1). Para cada sócio com `kind='socio'`, `archived=true`, `anonymized_at is null` e `archived_at < now() - prazo`, chama `member_anonymize(..., 'automatico')`. Recusas (saldo, comanda aberta) não interrompem os demais; cada recusa vai para o `audit_log` uma vez por dia no máximo.
- **Colaborador fora do automático (decisão do dono, 15/11):** `kind='colaborador'` nunca entra no expurgo diário nem nas listas de aviso, até o contador dizer por quanto tempo os dados de funcionário precisam ser guardados. O botão "Anonimizar" manual continua valendo para colaborador.
- Sócio arquivado sem `archived_at` (cadastros antigos): fica fora do automático e aparece na lista "Não puderam ser anonimizados" com o motivo "sem data de arquivamento" (call do Claude: `updated_at` não é confiável depois de importação).
- **Ligar com carência (call do Claude):** a migration cria a função e o agendamento DESLIGADO (`cron.unschedule` ou ajuste `privacy.automatico=false`). Ao ligar (passo separado, com o "sim" do dono), quem já está vencido nesse dia ganha 7 dias: o automático só anonimiza quando hoje ≥ maior(data de vencimento, data em que foi ligado) + 7 dias. Assim todo mundo passa pela lista de aviso antes. A data de ligar fica em `privacy.automaticoDesde`.

### 4. Aviso uma semana antes

- Configurações › Privacidade passa a ter duas listas: "Serão anonimizados nos próximos 7 dias" (com a data) e "Não puderam ser anonimizados" (saldo ou comanda aberta, com o motivo e o botão de abrir o cadastro).
- Ao entrar, o admin vê um aviso no topo quando a primeira lista não está vazia, uma vez por dia.
- O botão "Anonimizar" manual continua no cadastro e na lista.

## Restrições

- Publicação no padrão do projeto: migration primeiro (o front antigo precisa continuar funcionando com ela), depois merge do front, cada passo com o "sim" do dono.
- Atenção à ordem: tirar o garçom da policy de `members` antes do front novo quebraria o app do garçom. Por isso a migration cria as funções novas mas só tira o garçom da policy numa segunda migration, aplicada depois do merge e da recarga dos aparelhos.
- Testes no padrão da bancada (`db/t-*.js` contra banco local, `sqltest`, e2e): garçom não lê CPF; anonimização limpa todos os lugares; recusa com saldo/comanda; expurgo respeita o prazo e pula recusas.
- Entrada em NOVIDADES (`sistema/novidades.js`) ao publicar.

## Fica para o construtor

- Nomes exatos das funções e da migration (seguir o padrão `YYYYMMDDHHMMSS_*.sql`, depois de `20261118000000`).
- Como reaproveitar `memberFieldsToRow` e a lista de campos zerados.
- Formato exato do aviso no topo (seguir os avisos existentes).
