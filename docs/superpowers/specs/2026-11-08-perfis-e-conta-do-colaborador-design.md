# Perfis novos (Administrador, Caixa, Garçom, Cozinha) e conta do colaborador

Data: 08/11/2026. Pedido do dono, conversado no chat. Virada do Saipos marcada para 23/11.

## Por quê

Os perfis de hoje (Administrador, Operador de caixa, Cozinha) não batem com o clube:

- o garçom é um "Operador de caixa" marcado com origem `app`, e o banco o trata como caixa. Ele
  consegue no banco tudo o que o caixa consegue;
- caixa e cozinha não conseguem pausar um produto que acabou: produto é escrita só do administrador
  (RLS de `cantina2:products`, grupo "catalogo");
- não existe como o funcionário consumir com desconto e pagar no fim da semana ou do mês;
- não existe lugar para a diária do freelancer paga da gaveta.

## O que o dono decidiu

### Os quatro perfis

**Administrador** — faz tudo, como hoje. Só ele: preço e cadastro de produto, categoria e complemento,
excluir produto, colaboradores, permissões, configurações, relatórios com valores, o dinheiro esperado
no fechamento, liberar sócio com dívida, reabrir comanda fechada, cancelar NFC-e e **dar baixa no
consumo do colaborador**.

**Caixa**
- abrir e fechar o caixa (às cegas, como já está: decisão de 08/11, só na tela);
- ativar e pausar produto (só isso: não muda preço nem cadastro);
- cancelar item e comanda;
- retirada (sangria) e **pagamento de diária de freelancer** tirado da gaveta;
- fechar comanda com qualquer forma de pagamento, inclusive fiado; dar baixa em fiado de sócio;
- lançar fichas;
- aplicar o **desconto de colaborador** (é o único desconto que o caixa dá);
- o que já tem hoje e continua: transferir itens entre comandas, reimprimir ficha e comprovante,
  emitir NFC-e, cadastrar cliente e sócio, reenviar impressão que falhou, Histórico de Pedidos.

**Garçom** (no app do celular)
- abre comanda, lança itens e fecha a comanda recebendo qualquer forma de pagamento, **menos fiado**;
- **não** transfere item, **não** cancela item (chama o caixa), não dá desconto.

**Cozinha** — Monitor da cozinha e **ativar e pausar produto** (quando acaba um ingrediente).

### Conta do colaborador

- O colaborador não é sócio e não tem cota. Ele é cadastrado em **Clientes** com o tipo
  **"Colaborador"**, sem cota. Pode ou não ser usuário do sistema (ajudante e limpeza também consomem).
- Ele abre a comanda no nome dele e consome normalmente.
- **20% de desconto fixo** em tudo, aplicado sozinho porque o cadastro é de colaborador.
- Ao fechar, o valor fica na conta dele (como um fiado). **A dívida do colaborador não bloqueia** o
  consumo (o sócio com dívida fica bloqueado; o colaborador não).
- O salário é pago **por fora** (Pix/transferência do escritório). No dia do pagamento, o
  **administrador** dá baixa no consumo como **"descontado do salário"**: não entra dinheiro no caixa,
  então essa baixa não mexe no fechamento do caixa.

### Decisões do Claude (o dono pode mudar)

- **Desconto de colaborador:** os 20% entram sozinhos quando a comanda é de um cliente do tipo
  Colaborador (não há botão de desconto). "O caixa aplica" quer dizer: só o caixa (e o administrador)
  fecha comanda de colaborador, e ela vai **sempre para a conta dele**. O garçom não fecha comanda de
  colaborador (seria fiado; o banco já o barra no fiado). Sem pagar na hora com desconto.
- **Onde vale:** só em comanda (onde o colaborador é identificado pelo nome). Ficha (balcão),
  delivery, cardápio e totem: sem desconto de colaborador.
- **Garçom não transfere nem cancela:** bloqueio **na tela** (o app do garçom não tem essas opções).
  O banco barra o garçom no fiado, no caixa (abrir/fechar, sangria) e na escrita de cadastros; não se
  refaz a gravação de `orders` por RPC para separar lançar de cancelar/transferir (risco alto a duas
  semanas da virada; mesmo raciocínio do caixa às cegas, decidido pelo dono em 08/11). O garçom também
  não cancela comanda aberta por engano: chama o caixa.
- **Baixa "descontado do salário":** o administrador abre o extrato do colaborador por período
  (lançamentos com data e valor) e dá baixa no valor que informar, por padrão o saldo inteiro (aceita
  baixa parcial).
- **Funcionário que hoje tem fiado como sócio comum:** não é convertido sozinho. O dono recadastra
  como Colaborador se quiser; a dívida antiga fica onde está.

### Diária de freelancer

- É dinheiro tirado da gaveta pelo caixa. Fica como uma retirada com o motivo
  **"Diária de freelancer"** e o nome da pessoa, e aparece separada das outras retiradas no fechamento
  e no Histórico do Caixa.

## Não faz parte

- Formas de Pagamento (Financeiro): o dono não entendeu a tela; bandeiras, taxas e dias para receber
  não são usados por nada. Fica para uma conversa depois deste projeto.
- Caixa às cegas pelo banco (decisão de 08/11: fica só na tela).
- Desconto livre, por valor ou porcentagem escolhida na hora. O caixa só aplica o de colaborador.
- Cupons (Marketing › Promoções): ficam como estão neste projeto (o clube não usa). Decisão do dono
  (08/11): standby. Proposta para depois, pensando nos outros estabelecimentos que vão comprar o
  Commandah: o campo de cupom só aparece na cobrança se houver cupom ativo, e "Aplicar cupom de
  desconto" vira permissão na matriz (padrão: Administrador e Caixa sim; Garçom e Cozinha não).
- Folha de pagamento, cálculo de salário ou controle de ponto.

## Não pode acontecer (mesmo que o resto funcione)

- Caixa ou cozinha conseguir mudar preço, nome ou cadastro de produto ao "pausar".
- Garçom conseguir, pelo banco (console), fechar comanda em fiado, abrir/fechar caixa, fazer sangria
  ou gravar cadastros. (Transferir e cancelar item: bloqueio só na tela, ver "Decisões do Claude".)
- Ninguém perder acesso na troca: os usuários de hoje continuam entrando no dia seguinte, com o mesmo
  PIN, no perfil certo (garçom que hoje é "caixa + origem app" vira Garçom; o resto fica como está).
- A baixa "descontado do salário" entrar no dinheiro do caixa ou na conferência às cegas.
- O colaborador ser barrado por dívida como um sócio.
- Quebrar a operação a duas semanas da virada: cada parte entra com teste na bancada
  (`../auditoria-2026-11-03`) e migration testada no Postgres 18 local antes de produção.

## Restrições

- Migrations em produção e deploy de Edge Function só com o "sim" do dono no chat (ver HANDOFF,
  "Limitação importante"). Merge na `main` publica na hora.
- RLS é a barreira real. O que um perfil não pode fazer tem que ser recusado no banco, não só escondido
  na tela.
- `tenant_staff.role` tem um `check` com `admin`, `caixa`, `cozinha` (baseline). A função `staff-auth`
  valida contra `ROLES = ["admin","caixa","cozinha"]`. As policies e RPCs usam
  `current_staff_role() = 'caixa'` em dezenas de pontos (`rls_por_papel`, `caixa_com_trava`,
  `vendas_em_tabela`, `fila_impressao`, lotes 3 e 4 da auditoria...).
- O bloqueio por dívida do sócio é feito no site (`memberBlockedByDebt` em `core/config.js`); a
  liberação é guardada por trigger em `members.debt_release`.
- O app do garçom é escolhido hoje por `currentUser.origem==='app' && role!=='admin'`
  (`core/login.js`). O app já não fecha em fiado (decisão de 18/10).
- Permissões por colaborador (PR #252) existem só para o perfil Caixa; passam a valer para o novo
  perfil também onde fizer sentido (ver "Fica com quem constrói").

## Fica com quem constrói

- Como o papel `garcom` entra no banco: ampliar o `check` de `tenant_staff.role`, `ROLES` da
  `staff-auth` (exige deploy) e cada policy/RPC que hoje diz `'caixa'`, decidindo caso a caso o que o
  garçom pode (ler e lançar em comanda aberta e fechar com pagamento: sim; fiado, transferência,
  cancelamento, caixa, sangria: não).
- Como migrar os garçons de hoje (`role='caixa'` + `origem='app'`) para `garcom`, no banco
  (`tenant_staff`) e no blob `cantina2:users`, sem trocar PIN.
- Como caixa e cozinha pausam produto sem escrever o blob de produtos inteiro: RPC
  `security definer` que só troca `active` de um produto (e registra no log), ou outra forma
  equivalente. Não pode abrir escrita do catálogo.
- Onde fica o tipo do cliente (`members`: coluna nova ou campo existente) e como o fiado do
  colaborador se separa do fiado do sócio nos relatórios.
- Como a baixa "descontado do salário" é gravada (movimento de fiado sem entrada de dinheiro) e onde o
  administrador faz (provavelmente na tela de fiado/Contas, filtrando colaboradores).
- Se o desconto de 20% vira configuração (Configurações › valor do desconto de colaborador) ou fica
  fixo no código. Preferência: configurável, padrão 20%.
- Nome e posição exatos dos itens na matriz de Perfis e permissões (nova coluna Garçom; nova
  permissão "Ativar e pausar produto").
- Ordem de entrega em partes publicáveis separadas, para não segurar tudo até o fim.
