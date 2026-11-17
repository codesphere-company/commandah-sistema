# Caixa por operador, etapa 2: cofre — design

Data: 16/11/2026. Continua o desenho de 13/11 (`2026-11-13-caixa-por-operador-design.md`, seções "Fechar o
turno no fim da noite", "Sangria e retirada" e "Cofre"). Aquele documento segue valendo. Este aqui fecha o que
estava aberto para a etapa 2 e diz como construir.

## Por que

O dono quer que cada pessoa responda só pelo dinheiro que passou pela mão dela, e que o dinheiro nunca "suma no
meio do caminho" entre a gaveta e o cofre. A etapa 1 (PR #288) separou as gavetas e travou as contagens. Falta o
destino do dinheiro que sai da gaveta: hoje a sangria e o fim da noite não têm para onde ir no sistema.

## Objetivos

1. **Troco fixo por caixa.** Cada caixa tem um valor de troco cadastrado (ex.: Caixa 1 = R$ 200).
2. **Fim da noite.** Depois da contagem conferida (ou liberada), o sistema diz: "Deixe R$ 200,00 de troco na
   gaveta e separe R$ X para o cofre". X = contado − troco. Os R$ X viram uma transferência do caixa para o
   cofre, com status **a recolher**. O esperado da próxima abertura daquele caixa é o troco.
3. **Sangria vai ao cofre.** "Saída do caixa" em dinheiro, no modo por operador, passa a ser transferência do
   caixa para o cofre, a recolher. Saem da gaveta sem passar pelo cofre só (decisão do dono, 16/11):
   - **Pagamento de funcionário** (diária de freelancer, vale, pagamento do dia): operador de caixa e admin podem
     lançar, com o nome de quem recebeu obrigatório. A "Diária de freelancer" de hoje entra aqui.
   - **Outro pagamento** (fornecedor, gelo, entregador etc.): **só administrador ou dono**, com motivo
     obrigatório. O operador não vê essa opção, e o servidor recusa se ele tentar.
4. **Recolher.** Um administrador (ou o dono), **logado na própria conta, no celular ou PC dele** (decisão do
   dono, 16/11; sem PIN no aparelho do caixa, sem mudança na staff-auth), confirma cada transferência a recolher contando o dinheiro
   recebido. Se não bater, não trava: a diferença fica registrada no extrato. **O admin pode confirmar o
   recolhimento do próprio fechamento** (decisão do dono, 16/11).
5. **Abastecer caixa.** O admin lança "Cofre → Caixa X, R$ Y" (repor troco, reforço). Soma no esperado do
   turno aberto daquele caixa, ou da próxima abertura.
6. **Contar o cofre** quando quiser. Não trava; registra quem contou, esperado, contado e diferença. A contagem
   passa a ser a nova base do saldo (veja "Saldo esperado").
7. **Outras saídas do cofre** (retirada do dono, depósito no banco) com motivo obrigatório.
8. **Saldo inicial do cofre:** é a primeira contagem. Lançamentos podem existir antes dela (fechamentos depois
   da migration); nada é recusado por falta de saldo inicial.
9. **Tela Cofre** com saldo, lista "a recolher" e extrato. Só admin e dono.

## Fora desta etapa

- Caixa Campo e relatórios por caixa (Resumo do Dia por caixa, aba Cofre na exportação do contador). Ficam para
  a etapa 3, que reaproveita a tabela do cofre.
- Contagem do cofre por cédula. É um valor só.
- Cofre com o modo por operador desligado. Desligado, nada muda: não existe cofre, a sangria é como hoje.

## Anti-objetivos (falharia mesmo funcionando)

- Dinheiro sair da gaveta sem entrar no cofre como "a recolher" na mesma operação. Se o fechamento gravar e a
  transferência não, ou o contrário, o desenho falhou.
- Operador (inclusive garçom que opera caixa) ver o saldo ou o extrato do cofre, por tela **ou** pela API.
- Diferença no cofre travar o caixa ou o fechamento.
- Quebrar o modo desligado ou os turnos que já existem na tabela `cash_turnos`.

## Restrições

- Mesmo padrão da etapa 1: tabela com RLS, leitura direta só admin/dono, escrita **só por RPC**
  `security definer` com `search_path ''`, conferência de perfil no servidor (`is_admin_like()`,
  `cash_turno_checar()`).
- Publicação em passos, cada um com o "sim" do dono: migration → merge do front → recarregar aparelhos.
- O ajuste `caixaPorOperador` ainda está desligado no clube e a etapa 1 nunca rodou de verdade. **A etapa 2 só
  é publicada depois de o dono ligar e testar a etapa 1 no clube** (pode ser escrita antes).
- Valores em centavos na comparação (como `cash_turno_dif`).
- Entrada nova no topo das NOVIDADES ao publicar.

## Abordagens consideradas

- **A. Tabela própria no banco, escrita só por RPC (escolhida pelo dono, 16/11).** Garante a operação única
  gaveta→cofre (o fechamento chama a mesma função que grava a transferência) e esconde o cofre do operador
  também pela API.
- **B. Dentro do blob `cantina2:*`, como a sangria de hoje.** Mais rápido, mas a trava ficaria só na tela,
  qualquer aparelho leria o saldo e gaveta e cofre gravariam separados. Vai contra o motivo do pedido.
- **C. Tabela no banco com etapa 2 e 3 juntas.** Maior e mais demorado; mistura o cofre, que é o urgente, com o
  campo, que hoje roda no Saipos.

## Como construir

### Banco (migration nova)

- Tabela `cash_cofre` (uma linha por lançamento), por estabelecimento. Campos mínimos: id, tenant, tipo
  (`entrada_caixa`, `saida_caixa`, `saida_outra`, `contagem`, `saldo_inicial`), caixa de origem/destino quando
  houver, valor, status (`a_recolher`, `confirmado`), quem lançou e quando, quem confirmou, valor contado na
  confirmação e a diferença, motivo/observação, id do turno ligado.
- RLS: select só `is_admin_like()` do próprio tenant; sem policy de escrita.
- RPCs (nomes a critério do construtor): ler cofre (saldo + a recolher + extrato), confirmar recolhimento,
  abastecer caixa, outra saída, contar, saldo inicial. Todas exigem admin/dono, exceto as chamadas internas
  feitas pelo fechamento e pela sangria.
- **Saldo esperado** = valor da última contagem (0 se nunca contou) + entradas confirmadas depois dela (pelo
  valor contado na confirmação) − abastecimentos e outras saídas depois dela. "A recolher" aparece separado,
  fora do saldo, até ser confirmado. Não existe tipo `saldo_inicial`: a primeira contagem faz esse papel. Saldo
  negativo é mostrado como está (indica contagem pendente).
- **Fechamento no fim da noite:** `cash_turno_concluir_fechamento` (ou uma variante chamada por ele) grava, na
  mesma transação, a entrada a recolher de X = contado − troco e põe `ultima_contagem` = troco. Se contado ≤
  troco, não grava transferência e `ultima_contagem` = contado.
- **Recolher de caixa fechado (admin):** gaveta sem turno aberto → cofre, a recolher, reduzindo
  `ultima_contagem`. Corrige o caso de alguém ter escolhido "passar o caixa" no fim da noite. O caso contrário
  ("fim da noite" no jantar) aparece na abertura seguinte como divergência e segue a liberação da etapa 1; o
  admin então confirma o recolhimento com o valor que realmente recebeu (pode ser 0) e a diferença fica no
  extrato.
- **Passagem de caixa (jantar)** não vai ao cofre: o fechamento precisa dizer se é passagem ou fim da noite. Hoje
  o botão é um só ("Fechar / passar o caixa"); o front passa a perguntar qual dos dois, e o servidor recebe isso
  no `p_closed`.
- **Fechamento com divergência:** a transferência só nasce quando o turno conclui (contagem bate ou liberação),
  porque é aí que `cash_turno_concluir_fechamento` roda. X usa o valor **contado**.
- **Troco do caixa:** guardado em `settings.caixas[].troco` (junto do nome). O servidor lê de
  `cantina2:settings` dentro da transação; o front não manda o valor. Sem troco cadastrado = 0 (tudo vai ao
  cofre).
- **Abastecer com turno aberto:** a RPC grava a saída do cofre e a entrada no turno daquele caixa de forma que o
  esperado do fechamento já a inclua. Sem turno aberto, soma em `ultima_contagem`. Turno travado: recusa.
- **Sangria em dinheiro no modo por operador:** passa a ser uma RPC que grava a saída do turno e a entrada a
  recolher no cofre juntas.

### Front

- Configurações › Caixa por operador: campo "Troco" ao lado do nome de cada caixa.
- Fechamento: escolha "Passar o caixa (jantar)" ou "Fechar no fim da noite". No fim da noite, depois da contagem
  conferida, a tela mostra "Deixe R$ T de troco na gaveta e separe R$ X para o cofre" e o comprovante impresso
  traz os dois valores.
- Novo Lançamento, no modo por operador: as opções viram Entrada no caixa, **Sangria (vai para o cofre)**,
  **Pagamento de funcionário** (nome obrigatório) e, só para admin/dono, **Outro pagamento** (motivo
  obrigatório).
- Tela **Cofre** (menu do Caixa, só admin/dono): saldo esperado, lista "A recolher" com botão Confirmar (pede o
  valor contado), botões Abastecer caixa, Outra saída, Contar cofre; extrato com filtro por data. Primeiro uso:
  pede o saldo inicial.
- Log de ações: cada transferência, confirmação, contagem e saída.

### Testes

- Bancada `../auditoria-2026-11-03`: `db/` para as RPCs (permissão de operador recusada, operação única do
  fechamento, contado ≤ troco, divergência liberada, abastecer com/sem turno, leitura direta recusada a
  não-admin) e um e2e do fluxo fim da noite → recolher.

## Calls do Claude (o dono pode corrigir)

- Abastecer caixa não pede confirmação de quem recebe: o esperado do turno já cobra a diferença na contagem.
- Sangria em Pix/cartão não vai ao cofre (não é dinheiro na gaveta).
- Sangria que foi ao cofre não pode ser editada nem excluída no caixa (OP-17 deixa de valer para ela); erro
  se acerta na confirmação do recolhimento, pelo valor contado.
- Aparelho com versão antiga que fechar sem dizer passagem/fim da noite: o servidor trata como passagem (não
  move dinheiro); o admin usa "recolher de caixa fechado".
- Recolhimento confirmado não pode ser editado; erro se corrige com um lançamento novo de ajuste (outra saída ou
  contagem).
- Sem limite de tempo para recolher; a lista "A recolher" fica à mostra até alguém confirmar.

## Deixado ao construtor

- Nomes das RPCs e colunas, formato do extrato, como a sangria-RPC convive com `cashMovements` no blob (desde
  que gaveta e cofre gravem juntos no servidor).
- Onde fica a tela Cofre no menu e o layout, seguindo o visual atual do Caixa.

## Publicação

Com o modo ligado, um aparelho com o front antigo que lançar "Saída do caixa" ou "Diária" pelo apply recebe exceção e a fila de lançamentos daquele aparelho trava (troco e estornos seguintes também falham, e os pendentes se perdem ao recarregar). Um admin em aparelho antigo que salvar Configurações apaga o `troco` de `settings.caixas`. Por isso a ordem abaixo é obrigatória (cofre, 16/11):

1. Combinar com o dono: bar fechado e todos os caixas fechados (nenhum turno aberto ou travado).
2. Aplicar a migration `20261121000000_caixa_cofre.sql` (só com "sim" do dono).
3. Fazer o merge do PR (publica o front).
4. Recarregar TODOS os aparelhos (caixas, celulares dos garçons, cozinha, notebook do admin), um após o outro, sem uso do sistema no meio.
5. Só depois configurar o troco de cada caixa em Configurações › Geral › Caixa por operador.

Rollback: reverter o front ANTES de reverter a migration (o front novo depende de `cash_turno_saida` e `cash_cofre_*`); depois seguir o bloco ROLLBACK da migration.
