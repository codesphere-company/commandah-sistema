# Caixa por operador, cofre e caixa do campo — design

Data: 13/11/2026. Pedido do dono do clube, conversa de 13/11.

## Por quê

Hoje o Commandah tem **um caixa só por estabelecimento** (`app_data` chave `cantina2:cashSession`, aberto por
`cash_session_open` em `supabase/migrations/20261010010000_caixa_com_trava.sql`). Todos os aparelhos usam o
mesmo caixa. No clube a realidade é outra:

- Existem **2 caixas fixos trabalhando ao mesmo tempo, cada um com a sua gaveta**. A gaveta fica embaixo do
  computador e nunca muda de lugar.
- Às vezes um **terceiro caixa vai para o campo**. O administrador separa uma quantia em dinheiro e o
  operador leva junto. Hoje esse caixa roda na maquininha laranja do Itaú (Rede), com o Saipos. O clube vai
  trocar o Saipos pelo Commandah.
- Existe um **cofre**, mexido só por administradores. Ele guarda o dinheiro de troco que abastece as gavetas
  e recebe as sangrias, as retiradas e o dinheiro do fim da noite.
- Os operadores saem para jantar. Outra pessoa assume o computador e a gaveta enquanto isso, e o dono da gaveta
  volta depois. Hoje a gaveta só é contada na abertura e no fechamento, então ninguém sabe quem responde pela
  diferença.
- Hoje a abertura não tem contagem: o campo "Saldo inicial" já vem preenchido com o valor contado no último
  fechamento (`assets/js/operacao/caixa.js:16-19`), e basta confirmar.

O dono quer que **cada pessoa responda só pelo dinheiro que passou pela mão dela**, que nenhuma diferença
passe sem um administrador ver e que o dinheiro nunca "suma no meio do caminho" entre a gaveta e o cofre.

## Objetivos

1. **Um caixa por gaveta, aberto por operador.** Os caixas são Caixa 1, Caixa 2 e Caixa Campo. Quem opera
   abre o **turno** dele naquele caixa, e vários turnos (um por caixa) ficam abertos ao mesmo tempo.
2. **Contagem obrigatória e às cegas na abertura e no fechamento de cada turno.** O operador digita o
   dinheiro que contou sem ver o esperado.
3. **Passagem de caixa no jantar (opção 1, escolhida pelo dono).** Quem sai conta e fecha o turno dele. Quem
   cobre conta e abre o próprio turno na mesma gaveta. Na volta, o caminho se repete ao contrário.
4. **Trava em qualquer divergência, sem margem** (decisão do dono: até R$ 0,01 trava). O caixa fica travado,
   **sem vender**, até a liberação.
5. **Liberação só por outra pessoa:** um administrador **diferente de quem contou**, digitando o PIN dele no
   caixa, ou o **dono, de longe**, pelo celular.
6. **Marcação "Pode operar caixa" no colaborador.** Há garçons que também são caixa. Garçom sem a marcação
   nunca abre caixa.
7. **Cofre** com saldo próprio, só para administradores. Todo dinheiro que entra ou sai dele é uma
   **transferência** registrada entre o cofre e um caixa.
8. **Caixa Campo**: abastecido pelo cofre, contado ao sair e ao voltar, devolvido ao cofre.
9. Tudo fica registrado: quem contou, esperado, contado, diferença, quem liberou, como (PIN no local ou dono de
   longe) e a hora. Aparece nos relatórios e no Histórico do Caixa.

## Não objetivos

- **Instalar o Commandah na maquininha laranja do Itaú/Rede.** Esse é um projeto separado, que vem depois. A
  maquininha só roda aplicativo aprovado pela loja da Rede, então é preciso parceria, aplicativo Android e
  aprovação. Neste projeto o Caixa Campo roda em celular ou notebook com o Commandah, e a maquininha fica só
  para o cartão, como nos outros caixas.
- **Mandar o consumo por WhatsApp para o sócio** quando a comanda fecha no fiado. Pedido do dono para um passo
  futuro.
- Notificação automática no celular do dono. O operador avisa por WhatsApp ou ligação, como hoje.
- Contagem por cédula/moeda. O operador digita só o total contado em dinheiro.
- Contagem de cartão e Pix. A contagem e a trava são **só de dinheiro**; o sistema já sabe o resto.
- Mudar o fluxo de pedidos do garçom no app.
- Mudar as "Estações" (cozinha e impressão). Caixa 1/2/Campo é um conceito novo, com nome próprio.

## Antiobjetivos

- **Autoliberação.** Um administrador nunca libera a própria divergência, nem com o PIN dele. O sistema recusa.
- **Trava só de tela.** Abrir/fechar turno, transferir para o cofre ou do cofre, liberar divergência e checar
  "Pode operar caixa" têm que valer no servidor. Chamar a API direto, pulando a tela, tem que falhar.
- **Vender com o caixa travado.** Enquanto a divergência não for liberada, nenhum pagamento entra naquele
  caixa.
- **Mostrar o esperado antes da contagem.** O campo da abertura vem vazio; quem entra na passagem não vê o
  valor que o outro contou.
- **Misturar o dinheiro dos caixas.** Venda recebida no Caixa 1 nunca cai no turno do Caixa 2.
- **Dinheiro sem dono no caminho.** Sangria, retirada e dinheiro do fim da noite saem do caixa e entram no
  cofre como uma transferência só. Não existe saída de gaveta para o cofre sem entrada correspondente.
- **Operador mexendo no cofre.** Operador não vê o saldo do cofre nem lança nele.
- **Quebrar quem não usa isso.** O Commandah vai ser vendido para bares e lanchonetes com uma gaveta só
  (memória "virada sem pressa": fazer configurável para bar, lanchonete e clube).

## O que está decidido (pelo dono)

- Caixa por operador, cada um com sua gaveta, dois caixas fixos ao mesmo tempo, mais um no campo às vezes.
- A gaveta dos caixas fixos é presa ao computador, fixa.
- Passagem de caixa com contagem no jantar (opção 1).
- Quem cobre o jantar não é fixo, mas **nunca é um garçom que só tira pedido**. Alguns garçons também são
  caixa: precisa de uma marcação no colaborador.
- Divergência trava e pede liberação de **outro** administrador, nunca o próprio.
- Sem outro administrador presente, **o dono libera de longe**.
- Enquanto não libera, **o caixa fica travado**.
- **Sem margem**: qualquer diferença trava.
- No fechamento, **o próprio operador conta**; o administrador só entra na divergência.
- **Cofre só para administradores.** Tem dinheiro de troco para as gavetas. Sangria e retirada vão para o
  cofre.
- **No fim da noite, o dinheiro sai da gaveta e fica só o troco.** O resto vai para o cofre.
- **O garçom cobra pelo app só com cartão**, nunca em dinheiro. O administrador escolhe em qual caixa entram
  os pagamentos do app.
- **Comandas que sobram abertas no fim do dia** são fechadas pelo administrador **como fiado** (fluxo que já
  existe).
- O Caixa Campo vai rodar no Commandah, substituindo o Saipos.

## Como funciona (fluxo)

### Cadastro dos caixas e configuração do aparelho

Cadastro do estabelecimento (Configurações): a lista de caixas com nome e o **valor de troco** de cada um
(ex.: Caixa 1 = R$ 200, Caixa 2 = R$ 200, Caixa Campo = valor separado na hora). O cofre é um item fixo dessa
lista e não tem aparelho.

Um administrador ou o dono marca **uma vez** em cada computador: "Este computador é o **Caixa 1**" (ou Caixa
2). A marcação fica guardada no aparelho.

O **Caixa Campo** não tem aparelho fixo. O operador escolhe "Caixa Campo" ao abrir o turno, em qualquer
celular ou notebook com o Commandah. Isso só aparece para quem pode operar caixa e só funciona se o Caixa
Campo tiver sido abastecido (veja "Caixa Campo").

Celular de garçom não tem caixa.

### Abrir o turno

1. O operador loga com o PIN no computador do Caixa 1. Ele precisa ter "Pode operar caixa", ou ser admin/dono.
2. Se o Caixa 1 não tiver turno aberto, a tela pede: **"Conte o dinheiro da gaveta"**, com o campo vazio e a
   observação opcional.
3. O servidor compara com o **esperado da gaveta**: o que ficou nela no último fechamento de turno **daquele
   caixa**, somado às transferências do cofre feitas depois.
4. Se bater, o turno abre.
5. Se não bater, o turno fica **travado** (veja "Liberar divergência"). O operador vê só que a contagem não
   bate. Se ele não puder ver totais (conferência às cegas, PROD-05), não vê o esperado nem a diferença.
   Opções na tela: **Contar de novo**, **Liberar com PIN de administrador** e **Pedir liberação ao dono**.

### Passagem de caixa (jantar)

1. O operador A toca em **"Passar o caixa"**. Ele conta a gaveta às cegas e o turno dele fecha. O dinheiro
   **fica todo na gaveta**, sem ida ao cofre. Divergência trava e pede liberação, como em qualquer
   fechamento.
2. A sai do sistema. B loga no mesmo computador e abre o turno dele contando a gaveta. O esperado é o que A
   contou.
3. Na volta, o caminho se repete ao contrário: B passa, A abre.

A passagem **não exige comandas fechadas**. Comanda não pertence a uma gaveta: entra no caixa onde for paga.
Cada turno tem as próprias vendas, entradas, saídas, contagens e diferença.

### Fechar o turno no fim da noite

1. O operador toca em **"Fechar o caixa"** e conta a gaveta inteira às cegas. Divergência trava e pede
   liberação.
2. Depois da contagem conferida (ou liberada), o sistema diz: **"Deixe R$ 200,00 de troco na gaveta e separe
   R$ X para o cofre"**, onde X = contado − troco do caixa.
3. Os R$ X viram uma **transferência do Caixa 1 para o cofre**, com o status "a recolher".
4. Um administrador recolhe o dinheiro e confirma a transferência no cofre, contando o valor recebido. Se não
   bater com X, **não trava**: a diferença fica registrada no extrato do cofre (o cofre não tem contagem
   travada, decisão do dono, 13/11).
5. O esperado da próxima abertura daquele caixa é o troco que ficou.

Se o contado for menor que o troco, nada vai para o cofre e o esperado da próxima abertura é o contado (palpite
do Claude). O administrador repõe o troco com uma transferência do cofre.

Fim do dia, comandas: as comandas que sobram abertas são fechadas pelo administrador como fiado, pelo fluxo
que já existe. A regra de hoje continua: o caixa não fecha com comanda avulsa aberta (OP-14,
`caixa.js:155`). No modo por operador, a regra só vale para **o último turno aberto do dia** a fechar; os
outros fecham sem ela.

### Sangria e retirada

Sangria e retirada lançadas num caixa passam a ser **transferência do caixa para o cofre**, com o status "a
recolher". A confirmação no cofre segue o passo 4 acima. Diária de freelancer e outras saídas que não vão para
o cofre (pagamento a alguém) continuam como saída comum do caixa.

### Cofre

- Só administradores e o dono veem o cofre e lançam nele.
- O **saldo esperado** do cofre é a soma das transferências confirmadas que entraram (sangria, retirada,
  fim de noite, devolução do campo) menos as que saíram (abastecer caixa).
- **Abastecer caixa** (troco, reforço, campo): o administrador lança "Cofre → Caixa X, R$ Y". A transferência
  soma no esperado do próximo turno daquele caixa, ou do turno aberto, se houver.
- **Contar o cofre**: o administrador conta quando quiser. **Não trava** (decisão do dono, 13/11): a
  diferença fica só registrada (quem contou, esperado, contado, diferença) e aparece no extrato do cofre.
- **Saldo inicial**: na primeira vez, o administrador informa o saldo atual do cofre (palpite do Claude).
- Retirada do dono ou depósito no banco: saída do cofre com motivo, registrada.

### Caixa Campo

1. O administrador lança "Cofre → Caixa Campo, R$ Y" e entrega o dinheiro ao operador.
2. O operador abre o turno do Caixa Campo no celular ou notebook e conta. O esperado é Y. A divergência trava,
   como nos outros.
3. No campo, vende normalmente. O cartão vai na maquininha.
4. Na volta, fecha o turno contando tudo. Nada fica no Caixa Campo: o contado inteiro vira uma transferência
   "Caixa Campo → cofre", a recolher, e o administrador confirma contando.

### Liberar divergência

- **Administrador presente:** ele digita o PIN no aparelho do caixa, sem trocar de usuário, como já acontece
  na troca de preço do quilo (`staff-auth`, action `price_override`). O servidor confere três coisas: o PIN, se
  o perfil é admin e se **o admin é diferente de quem contou**. A liberação vale para aquela contagem.
- **Dono de longe:**
  1. O operador toca em "Pedir liberação ao dono". O pedido fica gravado no servidor com o caixa, quem contou,
     o esperado, o contado e a diferença.
  2. O dono abre o Commandah no celular, logado com a conta dele (que tem 2FA, PR #285), e vê
     "Liberação pendente" com esses dados.
  3. O dono escolhe **Liberar** ou **Recusar**.
  4. A tela do operador destrava sozinha em poucos segundos. Se o dono recusar, volta para "Contar de novo".
- O dono pode liberar uma divergência que ele mesmo contou (palpite do Claude: o dinheiro é dele).
- Depois da liberação, a abertura segue com o valor contado como saldo inicial do turno. No fechamento, o turno
  fecha com a diferença registrada.

### Vender e receber

- Cada pagamento recebido num aparelho de caixa entra no turno aberto **daquele caixa**: balcão, comanda paga,
  fiado recebido, parcial, troco, entrada e saída.
- **App do garçom:** só aceita cartão nesse modo (dinheiro some das formas do app). Os pagamentos entram no
  caixa que o administrador escolheu em Configurações ("Pagamentos do app entram no: Caixa 1"). Se esse caixa
  não tiver turno aberto, o app não cobra e mostra "O caixa X está fechado".
- Sem turno aberto, ou com turno travado, naquele aparelho: não recebe pagamento. Mensagem: "Abra o caixa
  deste computador para receber".
- Recebimentos feitos fora de um aparelho de caixa (cozinha, celular do administrador): seguem a mesma regra
  do app e entram no caixa escolhido em Configurações (palpite do Claude). Dinheiro recebido fora de um caixa
  fica proibido nesse modo.

### Turnos esquecidos

- Uma pessoa só pode ter **um turno aberto por vez** (palpite do Claude).
- Se o operador for embora sem fechar, um administrador fecha o turno por ele, contando a gaveta. Fica
  registrado "fechado por F no lugar de A" (palpite do Claude).

## Regras de permissão

- **"Pode operar caixa"**: marcação por colaborador, em Colaboradores, junto das permissões por colaborador
  (PR #252). Vale para qualquer perfil, inclusive Garçom. Admin e dono podem sempre.
- O servidor passa a respeitar a marcação. Hoje `cash_can_write()` decide só pelo perfil.
- Cofre: só admin e dono, no servidor.
- Liberar divergência: perfil admin diferente de quem contou, ou o dono (sessão de dono).

## Configuração

Ajuste em Configurações do Sistema: **"Caixa por operador (gavetas separadas e cofre)"**, desligado por
padrão (palpite do Claude).

- **Desligado:** funciona como hoje, com um caixa só e sem contagem obrigatória. Nada muda para quem não
  precisa.
- **Ligado:** tudo o que está neste documento. Para o clube, liga.

## Relatórios

- **Histórico do Caixa:** uma linha por turno, com o caixa (1/2/Campo), o operador, a abertura (esperado,
  contado e diferença), o fechamento (esperado, contado, diferença e quanto foi ao cofre) e as liberações
  (quem, como e quando).
- **Cofre:** extrato com as transferências (de onde, para onde, quem lançou, quem confirmou), as contagens e
  o saldo. Só admin e dono.
- **Resumo do Dia:** cada caixa separado e o total.
- **Exportação para o contador** (aba "Fechamentos de caixa"): ganha as colunas Caixa e Liberação, e uma aba
  Cofre.
- **Log de ações:** cada liberação, recusa e transferência.

## Restrições técnicas

- Respeitar BD-03 (`core/caixa-multiaparelho.js`): o caixa é escrito por RPC com trava no servidor. O registro
  único `cantina2:cashSession` precisa virar um registro por caixa (ou tabela própria), a critério do
  construtor, sem quebrar os dados existentes. O turno aberto hoje vira o turno do "Caixa 1" na migração.
- `cashMovements` e `sales` já guardam `cashSessionId`, mas hoje as vendas de uma sessão são escolhidas pela
  hora (`closedAt >= openedAt`, `caixa.js:47` e `:149`). Com dois turnos abertos ao mesmo tempo isso tem que
  passar a ser por `cashSessionId`; vendas antigas sem o campo continuam pela regra da hora. Cada turno é uma
  sessão. O total por caixa sai do `cashSessionId` + caixa da sessão.
- Lugares que hoje leem `state.cashSession` (singular) precisam passar a ler o turno **do caixa deste
  aparelho**, ou o caixa escolhido para o app: `vendas/pagamento.js`, `vendas/comandas.js`,
  `vendas/delivery.js`, `vendas/agendamento.js`, `vendas/venda.js`, `operacao/cozinha.js`,
  `operacao/garcom.js`, `gestao/relatorios.js`, `gestao/financeiro.js`, `core/avisos.js` e
  `core/navegacao.js`.
- Liberação de divergência, cofre e checagem de "Pode operar caixa" no servidor (`staff-auth` + RPCs de
  caixa).
- Publicação: migration no banco de produção e deploy de `staff-auth` **só com o "sim" do dono no chat**.
- Acrescentar entrada em NOVIDADES (`sistema/novidades.js`) ao publicar.

## Deixado para o construtor

- Formato do armazenamento dos turnos, das transferências e dos pedidos de liberação: `app_data` por chave ou
  tabelas novas.
- Consulta periódica ou realtime para destravar a tela do operador.
- Texto exato das telas, dentro do tom das telas atuais.
- Ordem de entrega em etapas (sugestão: 1. caixas e turnos com contagem e trava; 2. cofre e transferências;
  3. Caixa Campo e relatórios).
