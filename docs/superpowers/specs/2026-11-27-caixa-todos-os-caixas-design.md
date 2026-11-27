# Caixa: todos os caixas numa lista, Cofre no fim (27/11/2026)

## Por quê
Pedido do dono: "queria poder ver todos os caixas abertos no menu caixa. o cofre poderia ir para o final dos caixas".
Hoje, com o caixa por operador ligado, a tela Caixa mostra só o caixa deste computador, e o Cofre é um item à parte
no menu da esquerda, colado no Caixa.

## O que muda (aprovado pelo dono em 27/11)
- Só com o caixa por operador ligado e só para administrador ou dono (`podeVerTotaisDoCaixa()`): a tela Caixa começa
  numa lista com um cartão por caixa (`listaDeCaixas()`), na ordem de Configurações.
  - Cada cartão: nome; selo "Este computador" se for o `caixaDoAparelho()`; situação "Aberto · operador · desde HH:MM",
    "Travado (abertura|fechamento) · operador · HH:MM", "Passado sem contagem" ou "Fechado".
  - Sem valores em dinheiro nos cartões.
  - Tocar no caixa deste computador abre a tela de sempre (abrir, fechar, lançamentos), com "‹ Todos os caixas" no topo.
  - Os outros caixas são só para olhar (não tocáveis). Liberar travado continua no computador dele ou pelo dono de longe.
  - Último item: Cofre (quem tem a permissão `cofre`), que abre a tela do Cofre; o Cofre ganha "‹ Caixa" no topo.
  - Computador sem marcação: a lista aparece e, embaixo, "Qual caixa este computador é?" (a escolha que já existia).
- O item Cofre sai do menu da esquerda e da faixa (flag `foraDoMenu`); a tela e a permissão continuam iguais.
- Operador comum e modo desligado: nada muda.

## Não muda
Banco, RPCs, migrations, permissões. A lista usa `state.cashTurnos`, que o polling (`refreshCashState`) já lê de todos os caixas.

## Abordagens
- **A (escolhida):** a lista é o início da tela Caixa para admin/dono; a tela do caixa deste computador fica a um toque.
- B: Caixa 1, Caixa 2 e Cofre como itens separados no menu da esquerda. Descartada: o menu muda a cada caixa cadastrado
  e o caixa de outro computador não tem tela própria para abrir.
- C: um painel com os outros caixas embaixo da tela do caixa atual. Descartada: o Cofre "no fim dos caixas" fica perdido
  embaixo das ações do turno.

## Calls do Claude
- Estado novo `caixaNaLista` (volta a `true` em `switchView`), separado de `caixaSecao`.
- Hora mostrada: `openedAt` do turno; travado mostra `pendencia.at`.
