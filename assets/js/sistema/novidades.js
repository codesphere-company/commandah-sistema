/* ============ NOVIDADES ============ */
// 08/11 (pedido do dono): ao entrar com o PIN, uma janela mostra o que mudou no sistema desde a última vez,
// com o que foi incluído e onde aconteceu; o × fecha. Cada pessoa vê só o que tem a ver com o perfil dela
// (item com `perms`: aparece se ela tiver ao menos uma dessas permissões; sem `perms`, aparece para todos).
// Depois de mostrada, a novidade não volta para aquela pessoa naquele aparelho. Ajuda › Novidades reabre tudo.
// A cada publicação, acrescentar uma entrada NO TOPO da lista (id único, data dd/mm/aaaa).
const NOVIDADES = [
  { id:'2026-11-27-cardapio-aviso-na-hora', data:'27/11/2026', itens:[
    { titulo:'Pedido do cardápio chega ao caixa na hora',
      texto:'O caixa agora é avisado no momento em que o cliente envia o pedido pelo celular, mesmo com a tela do sistema minimizada ou em outra aba. Antes ele conferia a fila de tempos em tempos e, com a aba escondida, o pedido podia demorar até um minuto. Basta ter um caixa logado, como já era.',
      onde:'Cardápio do QR', perms:['caixa'] },
  ]},
  { id:'2026-11-27-notas-de-compra', data:'27/11/2026', itens:[
    { titulo:'Notas de compra: conferir, pagar e dar entrada no estoque',
      texto:'Nova tela com as notas fiscais de compra dos fornecedores. Para cada nota o sistema mostra quatro etapas: conferida, contabilidade, pagamento e estoque. Ao abrir a nota, você escolhe o que cada item é (insumo, produto ou algo que não vai para o estoque) e confirma: a entrada no estoque e o contas a pagar saem juntos, e dá para desfazer. Há também o arquivo do mês para mandar ao escritório. Quando chega nota nova, aparece um número ao lado do menu e um aviso na tela; se o fornecedor cancelar uma nota que já tinha entrada ou pagamento, o sistema avisa. Por enquanto as notas entram importando o arquivo XML; a busca automática será ligada na virada.',
      onde:'Financeiro ou Produtos › Notas de compra', perms:['contas','insumos'] },
  ]},
  { id:'2026-11-27-cardapio-opcoes', data:'27/11/2026', itens:[
    { titulo:'Cardápio do QR pergunta as opções',
      texto:'No cardápio do celular, produto com opções (como a água com gás ou sem gás, ou os adicionais do lanche) abre a escolha antes de ir para o pedido, respeitando o mínimo, o máximo e os inclusos de cada grupo. As escolhas saem na comanda e na ficha da cozinha como no app do garçom. Só produto vendido por quilo continua "peça ao garçom".',
      onde:'Cardápio do QR', perms:['caixa'] },
  ]},
  { id:'2026-11-27-cardapio-pedido-cota', data:'27/11/2026', itens:[
    { titulo:'Sócio pede pelo cardápio e marca na cota',
      texto:'No cardápio do QR, o sócio monta o pedido, escolhe levar na mesa ou retirar no balcão e toca em "Marcar na minha cota". Ele confirma com um código que chega no WhatsApp, e o pedido entra na comanda dele e vai para a cozinha, lançado sozinho pelo computador Caixa do app. Quem está bloqueado por fiado não consegue pedir. Os pedidos do dia aparecem em Apps › Cardápio Digital.',
      onde:'Cardápio do QR e Apps › Cardápio Digital', perms:['caixa'] },
  ]},
  { id:'2026-11-26-cardapio-digital', data:'26/11/2026', itens:[
    { titulo:'Cardápio digital no QR da mesa',
      texto:'Em Apps › Cardápio Digital, ligue o cardápio e imprima o QR de cada mesa. O cliente aponta a câmera e vê os produtos com foto, preço e tamanhos no celular, sem instalar nada. Nesta primeira etapa ele só olha: para pedir, chama o garçom. Produto pausado some do cardápio.',
      onde:'Apps › Cardápio Digital', perms:['config-sistema'] },
  ]},
  { id:'2026-11-26-troca-sem-contagem', data:'26/11/2026', itens:[
    { titulo:'Passar o caixa sem contar',
      texto:'Em Configurações › Caixa por operador, o administrador pode desligar "Contar o dinheiro na passagem de caixa". Desligado, na troca de pessoa (por exemplo, na janta) ninguém conta: quem sai escolhe Passar o caixa e quem entra só toca em Abrir caixa, continuando com o dinheiro da gaveta. O fechamento do fim da noite continua contado.',
      onde:'Caixa e Configurações › Caixa por operador', perms:['caixa'] },
  ]},
  { id:'2026-11-26-logo-reduzido', data:'26/11/2026', itens:[
    { titulo:'Logotipo de qualquer tamanho',
      texto:'Em Configurações › Sistema, o logotipo pode ser escolhido em qualquer tamanho: o sistema reduz a imagem sozinho, mantendo o fundo transparente. Assim os aparelhos abrem o sistema mais rápido e gastam menos internet.',
      onde:'Configurações › Sistema', perms:['config-sistema'] },
  ]},
  { id:'2026-11-27-whatsapp-fiado-automatico', data:'27/11/2026', itens:[
    { titulo:'Fiado pelo WhatsApp, sozinho',
      texto:'Em Configurações › WhatsApp, o administrador pode ligar "No fiado, mandar sozinho". Ligado, a conta vai pelo WhatsApp do Commandah na hora que a comanda fecha no fiado, com o Pix e o QR, e quando o pagamento zera a conta vai o aviso de consumo liberado. Se não der para mandar (sem celular no cadastro, WhatsApp desconectado), o fiado fecha do mesmo jeito e a mensagem fica em WhatsApp › Não enviadas, com Reenviar e Descartar. Vem desligado.',
      onde:'Configurações › WhatsApp e tela WhatsApp', perms:['whatsapp'] },
  ]},
  { id:'2026-11-26-liberacao-fiado', data:'26/11/2026', itens:[
    { titulo:'Fiado novo bloqueia o cliente liberado',
      texto:'Quando o administrador libera um cliente com pendência, a liberação vale só para a dívida daquele momento. Um fiado lançado depois bloqueia de novo, mesmo que o valor seja menor que o liberado. Antes, uma liberação antiga continuava valendo depois que o cliente pagava.',
      onde:'Comandas, Ficha e Pagamento', perms:['caixa'] },
  ]},
  { id:'2026-11-26-caixa-padrao-garcom', data:'26/11/2026', itens:[
    { titulo:'Caixa organizado como o app do garçom',
      texto:'Com o caixa fechado, a tela mostra um cartão com o campo grande para contar a gaveta e o botão Abrir caixa. Com o caixa aberto, a situação fica no topo (o administrador vê o dinheiro esperado na gaveta) e embaixo vêm as escolhas: Fechar / passar o caixa, Novo lançamento, Movimentação, Resumo por forma e Fechamentos anteriores. Toque para entrar; "‹ Caixa" volta. Nenhuma regra de abertura, contagem ou fechamento mudou.',
      onde:'Caixa', perms:['caixa'] },
  ]},
  { id:'2026-11-26-categorias-blocos', data:'26/11/2026', itens:[
    { titulo:'Ficha e Novo pedido começam pelas categorias, como no app do garçom',
      texto:'A Ficha e o Novo pedido da comanda abrem com as categorias em blocos grandes, cada um com quantos itens tem. Toque na categoria para ver os produtos dela; "‹ Categorias" volta. "Todos os produtos" fica no fim. Na comanda que já tem pedidos, o primeiro bloco é "Já pedidos". A busca continua procurando em todos os produtos, mesmo dentro de uma categoria. Depois de cobrar, a Ficha volta às categorias.',
      onde:'Ficha e Comanda › Novo pedido' },
  ]},
  { id:'2026-11-26-apps-central', data:'26/11/2026', itens:[
    { titulo:'Apps organizados como Configurações',
      texto:'A área Apps abre uma lista com os apps em três grupos (Outros atendimentos, Ferramentas e Módulos), uma linha explicando cada um e uma busca. Antes eram onze botões numa faixa e a área já abria a Fila de Atendimento. Dentro de um app, "‹ Apps" volta para a lista.',
      onde:'Menu lateral › Apps' },
  ]},
  { id:'2026-11-26-cofre-padrao-garcom', data:'26/11/2026', itens:[
    { titulo:'Cofre organizado como o app do garçom',
      texto:'A tela do Cofre abre com o saldo no topo e seis escolhas: A recolher (com a quantidade esperando), Contar cofre, Abastecer caixa, Recolher de caixa fechado, Outra saída e Extrato. Toque numa delas para entrar; "‹ Cofre" volta. Antes as ações ficavam empilhadas numa coluna estreita e algumas só apareciam rolando a tela. Para abastecer ou recolher, o caixa agora é um botão grande (Caixa 1, Caixa 2).',
      onde:'Cofre', perms:['cofre'] },
  ]},
  { id:'2026-11-26-fiado-whatsapp-interno', data:'26/11/2026', itens:[
    { titulo:'Cobrança do fiado pelo WhatsApp do Commandah (plano Pro)',
      texto:'Ao fechar uma comanda no fiado, "Enviar cobrança via WhatsApp" agora manda pelo número da lanchonete, de dentro do Commandah, sem abrir o WhatsApp Web: a hora do fechamento, o consumo de hoje, o total em aberto, o Pix copia e cola e o QR. Colaborador e plano básico continuam abrindo o WhatsApp como antes.',
      onde:'Fechar comanda no fiado', perms:['whatsapp'] },
  ]},
  { id:'2026-11-26-whatsapp-conta-pix', data:'26/11/2026', itens:[
    { titulo:'Mandar a conta da comanda pelo WhatsApp, com Pix copia e cola e QR (plano Pro)',
      texto:'Na comanda aberta de um cliente, "Mandar conta pelo WhatsApp" manda pelo número da lanchonete o texto com os itens e o total, o Pix copia e cola com o valor, o QR do Pix e o pedido do comprovante. A comanda fica com o selo "Conta enviada · aguardando Pix" até você conferir o comprovante e dar baixa como sempre. Na tela WhatsApp, o painel do cliente tem "Mandar conta com Pix" e a lista ganhou o filtro "Conta enviada". Para o Pix ir junto, preencha a chave, o nome e a cidade em Configurações › Sistema › Ajustes do Cupom. Colaborador não recebe conta.',
      onde:'Comanda › Mandar conta pelo WhatsApp', perms:['whatsapp'] },
  ]},
  { id:'2026-11-25-admin-escolhe-caixa', data:'25/11/2026', itens:[
    { titulo:'Administrador abre o caixa de qualquer computador',
      texto:'Com o caixa por operador ligado, num computador que ainda não é um caixa o administrador escolhe ali mesmo, na tela do Caixa, qual caixa ele é (Caixa 1, Caixa 2...) e já abre ou fecha. Antes era preciso ir em Configurações. Quem não é administrador continua vendo o aviso para chamar um administrador.',
      onde:'Caixa', perms:['caixa'] },
  ]},
  { id:'2026-11-26-whatsapp-conversas', data:'26/11/2026', itens:[
    { titulo:'Conversas do WhatsApp dentro do Commandah (plano Pro)',
      texto:'No menu lateral, WhatsApp mostra as conversas do número da lanchonete. Quando um cliente escreve, aparece um aviso com som em qualquer tela e um número no menu; Responder abre a conversa. Dá para responder em texto (Enter envia), usar as respostas prontas de chave Pix e horário da cozinha, ver foto e baixar PDF recebidos e ligar a conversa ao cadastro do cliente para ver a cota e a conta. Áudio continua só no celular.',
      onde:'Menu lateral › WhatsApp', perms:['whatsapp'] },
  ]},
  { id:'2026-11-25-padrao-caixa', data:'25/11/2026', itens:[
    { titulo:'Caixa mais fácil de ler',
      texto:'O título do caixa mostra o selo "Aberto". Os valores da movimentação não quebram mais em duas linhas, e o Resumo traz cada valor alinhado à direita do nome. O botão Fechar Caixa ficou maior e, em telas menores, fica sempre à vista embaixo. Nenhum valor ou passo do caixa mudou.',
      onde:'Caixa', perms:['caixa'] },
  ]},
  { id:'2026-11-25-padrao-venda', data:'25/11/2026', itens:[
    { titulo:'Botões de quantidade maiores na Ficha, nas comandas e no app do garçom',
      texto:'Os botões de menos e mais da quantidade ficaram maiores (44 pixels), mais fáceis de acertar no tablet e no celular, e com ícones desenhados no lugar dos símbolos. As categorias da Ficha também cresceram um pouco. Nenhum passo da venda mudou.',
      onde:'Ficha, Comandas e app do garçom' },
  ]},
  { id:'2026-11-25-padrao-janelas', data:'25/11/2026', itens:[
    { titulo:'Salvar sempre à vista nas janelas de cadastro',
      texto:'Nas janelas de cadastro (produto, cliente, colaborador e as outras), o título e os botões Voltar e Salvar ficam fixos enquanto você rola o formulário. Antes, em telas mais baixas, o Salvar ficava escondido lá embaixo. A janela do colaborador também ficou do tamanho certo para os campos que tem.',
      onde:'Janelas de cadastro' },
  ]},
  { id:'2026-11-25-padrao-letras', data:'25/11/2026', itens:[
    { titulo:'Tamanhos de letra padronizados',
      texto:'As letras do sistema passaram a seguir uma escala única. Os textos menores das listas e etiquetas ficaram um pouco maiores e mais fáceis de ler.',
      onde:'Todo o sistema' },
  ]},
  { id:'2026-11-25-padrao-selecao', data:'25/11/2026', itens:[
    { titulo:'Botões do item marcado só aparecem quando você marca',
      texto:'Em Produtos, os botões Duplicar, Estoque, Editar e Excluir, e em Clientes, Editar e Arquivar, deixaram de ficar apagados o tempo todo: eles aparecem juntos, num grupo verde-claro, quando você toca numa linha da lista. Em Produtos, Atualizar Lista passou para dentro de Opções.',
      onde:'Produtos e Clientes', perms:['produtos','associados'] },
  ]},
  { id:'2026-11-25-padrao-impressoras', data:'25/11/2026', itens:[
    { titulo:'Tela de Impressoras mais limpa',
      texto:'A tela de Impressoras ficou com seções separadas por linhas, sem caixas umas dentro das outras, e com botões maiores para tocar. Em Formas de Pagamento, o botão Nova forma passou para a direita, como o Novo das outras telas.',
      onde:'Configurações › Impressoras e Financeiro › Formas de Pagamento', perms:['impressoras','pagamentos'] },
  ]},
  { id:'2026-11-25-padrao-cabecalho', data:'25/11/2026', itens:[
    { titulo:'Título e botões das telas num bloco só',
      texto:'Nos cadastros, o título da tela e a barra com a busca e os botões passaram a formar um bloco só, com a busca alinhada ao título. Nos relatórios, o nome do relatório não aparece mais duas vezes.',
      onde:'Cadastros e relatórios' },
  ]},
  { id:'2026-11-25-padrao-icones-sistema', data:'25/11/2026', itens:[
    { titulo:'Ícones desenhados em Configurações e nos Módulos',
      texto:'O menu de Configurações do Sistema (Geral, Ajustes do Cupom, Horário da Cozinha, Sobre), as páginas dos Módulos e os menus de Apps e Marketing trocaram os símbolos e emojis por ícones desenhados, iguais aos do resto do sistema.',
      onde:'Configurações, Apps e Marketing', perms:['config-sistema','modulos','cupons'] },
  ]},
  { id:'2026-11-25-padrao-icones-gestao', data:'25/11/2026', itens:[
    { titulo:'Ícones desenhados também nos relatórios e no financeiro',
      texto:'Imprimir, Exportar, Pesquisar, Voltar, Dia anterior e os botões de Contas, Fiado, Cupons e Logs também passaram a usar ícones desenhados no lugar dos símbolos de texto.',
      onde:'Relatórios e Financeiro', perms:['relatorios','relatorios-gerencia','contas','receber-fiado','cupons','logs'] },
  ]},
  { id:'2026-11-25-padrao-icones', data:'25/11/2026', itens:[
    { titulo:'Ícones desenhados nos botões',
      texto:'Os botões dos cadastros (Novo, Editar, Excluir, Imprimir, Duplicar, Exportar, Opções...) trocaram os símbolos de texto por ícones desenhados, iguais aos do menu lateral. Nada mudou no que cada botão faz.',
      onde:'Cadastros' },
  ]},
  { id:'2026-11-25-central-relatorios', data:'25/11/2026', itens:[
    { titulo:'Relatórios em uma página só, com busca',
      texto:'Ao tocar em Relatórios no menu lateral, abre uma página com os 20 relatórios em grupos (Vendas, Caixa, Auditoria, Financeiro, Estoque), cada um com uma linha dizendo o que mostra, igual à página de Configurações. Dentro de um relatório, a barra de cima tem o botão Voltar e os outros relatórios do mesmo grupo. A faixa de 4 linhas de botões pequenos saiu. Em Financeiro, os atalhos voltaram a aparecer grandes, com o nome do grupo.',
      onde:'Relatórios e Financeiro', perms:['relatorios','relatorios-gerencia','logs'] },
  ]},
  { id:'2026-11-25-padrao-lote-2', data:'25/11/2026', itens:[
    { titulo:'Botões e campos mais fáceis de tocar',
      texto:'Nos cadastros, nos relatórios e nas janelas, a busca, os campos, as abas e os botões Editar e Excluir das listas passaram a ter pelo menos 44 pixels de altura, o tamanho mínimo confortável para o dedo no tablet.',
      onde:'Cadastros, relatórios e janelas' },
  ]},
  { id:'2026-11-25-padrao-lote-1', data:'25/11/2026', itens:[
    { titulo:'Lupa e botão de fechar mais nítidos',
      texto:'A lupa das buscas e o × de fechar telas e janelas passaram a ser desenhados como os outros ícones do sistema. O × ficou com uma área maior para tocar no tablet. Nada mudou no funcionamento.',
      onde:'Buscas, telas e janelas' },
  ]},
  { id:'2026-11-25-central-configuracoes', data:'25/11/2026', itens:[
    { titulo:'Configurações em uma página só, com busca',
      texto:'Ao tocar em Configurações no menu lateral, abre uma página com todas as configurações em 5 grupos (Estabelecimento, Equipe e acesso, Áreas e impressão, Dados e registros, Plano e ajuda), cada uma com uma linha explicando o que faz. Use a busca para achar pelo nome. Dentro de uma configuração, a barra de cima tem o botão Voltar e as outras do mesmo grupo. A faixa de botões pequenos saiu.',
      onde:'Configurações' },
  ]},
  { id:'2026-11-25-whatsapp-conectar', data:'25/11/2026', itens:[
    { titulo:'WhatsApp da lanchonete no Commandah (plano Pro)',
      texto:'Em Configurações › WhatsApp, o administrador conecta o número separado da lanchonete lendo um QR com o celular, como no WhatsApp Web. A tela mostra se está conectado e com qual número. Use um número só da lanchonete, não o que os clientes já usam. As conversas, o aviso de mensagem nova e o envio da conta chegam nas próximas etapas.',
      onde:'Configurações › WhatsApp', perms:['whatsapp'] },
  ]},
  { id:'2026-11-24-clientes-cota-ordenar', data:'24/11/2026', itens:[
    { titulo:'Clientes: cota no topo e lista que ordena pela coluna',
      texto:'No cadastro do cliente, a Cota passou a ser o primeiro campo, acima do Nome (antes ficava em Dados Secundários). Na lista de Clientes, clique no título de qualquer coluna para ordenar: o primeiro clique ordena de A a Z (ou do menor para o maior), o segundo inverte e o terceiro volta à ordem normal. A cota ordena como número (2, 18, 180). A pesquisa filtra enquanto você digita, sem precisar do botão Buscar.',
      onde:'Cadastros › Clientes', perms:['associados'] },
  ]},
  { id:'2026-11-21-nfce-codigo-agrupar', data:'21/11/2026', itens:[
    { titulo:'NFC-e com o código curto do produto e itens iguais juntos',
      texto:'Na nota fiscal, o código do produto passou a ser o Código PDV do cadastro (por exemplo, 123), e não mais um código interno comprido. E o mesmo produto lançado várias vezes, pelo mesmo preço, sai numa linha só com a quantidade somada (8 x 3,00 em vez de 8 linhas). Produto sem Código PDV ganha o próximo número livre ao salvar.',
      onde:'NFC-e e Produtos › Editar', perms:['produtos','caixa'] },
  ] },
  { id:'2026-11-21-falta-parcial', data:'21/11/2026', itens:[
    { titulo:'"Falta" da comanda com parcial considera o crédito e o serviço',
      texto:'Na faixa do pagamento parcial e na comanda impressa, o "Falta" contava só os itens menos o parcial. Com crédito do sócio ou taxa de serviço, mostrava um valor diferente do total da comanda. Agora é a mesma conta do total, e a comanda impressa mostra o crédito e o serviço.',
      onde:'Comandas › Receber parcial e Imprimir', perms:['caixa','comandas'] },
    { titulo:'Formas de Pagamento sem o salário na participação',
      texto:'Em Recebimentos, aba Formas de Pagamento, o descontado do salário entrava na porcentagem de participação, mas não no total recebido. Agora a porcentagem é só do dinheiro que entrou, e o salário aparece como "não entra no caixa".',
      onde:'Relatórios › Recebimentos', perms:['relatorios-gerencia'] },
  ] },
  { id:'2026-11-20-credito-servico-parcial', data:'20/11/2026', itens:[
    { titulo:'Comanda de sócio com crédito e serviço fecha certo depois do parcial',
      texto:'Quando o sócio tinha crédito e a comanda tinha taxa de serviço, pagar em parcial o valor mostrado deixava alguns reais de serviço sobrando. Agora o parcial que cobre a conta zera a comanda, e o crédito usado nunca passa do saldo do sócio.',
      onde:'Comandas › Pagamento e app do garçom', perms:['caixa','comandas'] },
  ] },
  { id:'2026-11-20-relatorios-recebido', data:'20/11/2026', itens:[
    { titulo:'Recebido sem o fiado em aberto',
      texto:'O Resumo Financeiro e Recebimentos agora mostram só o dinheiro que entrou: o que foi pago na hora, mais o fiado pago, inclusive conta antiga. O que ficou no fiado entra quando o cliente pagar. O descontado do salário aparece à parte.',
      onde:'Relatórios › Resumo Financeiro e Recebimentos', perms:['relatorios-gerencia'] },
    { titulo:'Filtros de Recebimentos e do Resumo Financeiro funcionando',
      texto:'Em Recebimentos, Todos, Fiado, Pedidos, Avulsos, o período e a busca por cliente ou colaborador agora filtram de verdade, com o total no fim. No Resumo Financeiro dá para escolher o mês, o ano e ver por mês.',
      onde:'Relatórios › Recebimentos e Resumo Financeiro', perms:['relatorios-gerencia'] },
    { titulo:'Ranking pelo garçom que atendeu',
      texto:'O Ranking de Atendimentos conta cada pedido para quem lançou os itens, não para quem fechou no caixa. Quando dois atendem a mesma mesa, o valor é dividido pela parte de cada um.',
      onde:'Relatórios › Ranking de Atendimentos', perms:['relatorios-gerencia'] },
    { titulo:'Histórico de Pedidos pela data de fechamento',
      texto:'O Histórico de Pedidos agora abre pela data de fechamento: um pedido aberto ontem e fechado hoje aparece em hoje. Dá para trocar para a data de abertura em Pesquisar.',
      onde:'Relatórios › Histórico de Pedidos', perms:['relatorios-gerencia'] },
  ] },
  { id:'2026-11-18-permissoes-rolagem', data:'18/11/2026', itens:[
    { titulo:'Permissões do colaborador sem barra dupla',
      texto:'A lista de permissões próprias do colaborador agora aparece inteira. Só a janela rola, sem uma segunda barra de rolagem dentro dela.',
      onde:'Cadastros › Colaboradores › Acesso', perms:['usuarios'] },
  ] },
  { id:'2026-11-16-cofre', data:'16/11/2026', itens:[
    { titulo:'Troco por caixa',
      texto:'Em Configurações › Geral › Caixa por operador, cada caixa tem o campo "Troco (R$)": o dinheiro que fica na gaveta de uma noite para a outra. O que passar do troco vai para o cofre.',
      onde:'Configurações › Geral › Caixa por operador', perms:['cofre'] },
    { titulo:'Fim da noite separa o dinheiro do cofre',
      texto:'Ao tocar em "Fechar / passar o caixa", escolha "Passar o caixa" (troca de operador, o dinheiro continua na gaveta) ou "Fechar no fim da noite". No fim da noite o sistema avisa: "Deixe R$ X de troco na gaveta e separe R$ Y para o cofre."',
      onde:'Caixa › Fechar / passar o caixa', perms:['cofre'] },
    { titulo:'Sangria vai para o cofre',
      texto:'A sangria tirada do caixa entra na lista "A recolher" do cofre. Quando o dinheiro chegar lá, o administrador confirma e conta o valor; se não bater, a diferença fica registrada no extrato.',
      onde:'Caixa › Novo Lançamento e Caixa › Cofre', perms:['cofre'] },
    { titulo:'Pagamento de funcionário e outro pagamento',
      texto:'Novo Lançamento ganhou "Pagamento de funcionário" (com o nome de quem recebeu), que o operador também pode lançar. "Outro pagamento" só o administrador lança.',
      onde:'Caixa › Novo Lançamento', perms:['cofre'] },
    { titulo:'Nova tela Cofre',
      texto:'Mostra o saldo do cofre, o que falta recolher e o extrato. Dá para contar o cofre, abastecer um caixa com troco, registrar outra saída (com motivo) e recolher o dinheiro de um caixa que já fechou. Só aparece para o administrador e quando o caixa por operador está ligado.',
      onde:'Caixa › Cofre', perms:['cofre'] },
  ] },
  { id:'2026-11-16-seguranca', data:'16/11/2026', itens:[
    { titulo:'Planilhas mais seguras',
      texto:'O leitor e gerador de planilhas do Excel foi atualizado para uma versão mais nova e segura. Importar e exportar produtos e clientes e gerar planilhas dos relatórios continua do mesmo jeito.',
      onde:'Cadastros e Relatórios', perms:['produtos','associados','relatorios','relatorios-gerencia'] },
  ] },
  { id:'2026-11-15-ficha-local', data:'15/11/2026', itens:[
    { titulo:'Local de entrega obrigatório',
      texto:'Todo pedido agora pede o local de entrega antes de enviar. Se o cliente vai buscar, escolha "Retirar no balcão". O ajuste fica em Configurações › Geral › Pedidos.',
      onde:'Comandas e App do Garçom', perms:['comandas'] },
    { titulo:'Ficha mais fácil de ler',
      texto:'Os adicionais saem um pouco maiores na ficha (dá para mudar em Modelo da ficha). A escolha do sabor ou tipo pode sair junto do nome do produto: "1x AGUA COM GAS". A ficha não imprime mais "?" no lugar do traço, e há uma opção para a impressora que imprime um "!" solto.',
      onde:'Configurações › Impressoras › Modelo da ficha', perms:['impressoras'] },
    { titulo:'Sabor junto do nome',
      texto:'Em grupo de opções em que se escolhe só 1 (sabor da água, ponto da carne), a escolha sai sozinha junto do nome na ficha ("1x AGUA COM GAS") e na tela ("AGUA · COM GAS"). Grupos de várias escolhas continuam embaixo, como adicionais. Para mudar um grupo, use "Na ficha" no cadastro do grupo: Automático, Sempre junto do nome ou Nunca junto do nome.',
      onde:'Cadastros › Grupos de opções', perms:['impressoras'] },
    { titulo:'Histórico da comanda mais compacto',
      texto:'O histórico da comanda ficou parecido com o do Saipos: os itens aparecem agrupados por lançamento ("SARAH NAYELLEN · 15/11 às 17:49"), um por linha, com os adicionais e a observação em letra pequena. Reimprimir, Repetir e Cancelar viraram ícones (pare o mouse em cima para ver o nome), e o ícone do lançamento reimprime todos os itens dele. Item enviado não tem mais etiqueta; o cancelado fica riscado.',
      onde:'Comandas › comanda aberta', perms:['comandas'] },
    { titulo:'Cliente avulso paga na hora',
      texto:'No clube, cliente avulso (sem cota) não abre mais comanda: escolha os itens e o local, e o sistema vai direto para o pagamento. Pago, o pedido vai para a cozinha com a ficha e a venda fecha. Se fechar o pagamento sem pagar, nada é enviado.',
      onde:'Comandas › Abrir comanda', perms:['comandas'] },
    { titulo:'Pergunta antes de imprimir o cupom fiscal',
      texto:'A NFC-e continua sendo emitida sozinha depois do pagamento, mas o sistema pergunta "Imprimir o cupom fiscal?" antes de imprimir. Enter imprime. Para imprimir direto como antes, desligue "Perguntar antes de imprimir o cupom fiscal" em Configurações › NFC-e.',
      onde:'Pagamento', perms:['caixa'] },
    { titulo:'Imprimir a comanda completa',
      texto:'O botão Imprimir da comanda (e da Conta Resumida) agora imprime de verdade: o administrador escolhe a impressora ou "Imprimir aqui (navegador)", e a última escolha fica marcada. Os demais imprimem direto na impressora do caixa.',
      onde:'Comandas › comanda aberta', perms:['comandas'] },
  ] },
  { id:'2026-11-15-lgpd', data:'15/11/2026', itens:[
    { titulo:'Privacidade dos sócios',
      texto:'O garçom não recebe mais CPF, telefone e endereço dos sócios. Anonimizar um sócio agora apaga o nome também no histórico de vendas e pedidos. Dá para ligar a anonimização automática de quem passou do prazo, com aviso antes, em Configurações › Privacidade.',
      onde:'Configurações › Privacidade', perms:['config-sistema'] },
  ] },
  { id:'2026-11-15-cota-clientes', data:'15/11/2026', itens:[
    { titulo:'Cota na lista de clientes',
      texto:'A lista de clientes mostra a cota de cada sócio na primeira coluna. Para achar pela cota, escolha "Cota" ao lado da pesquisa e digite o número: aparece só aquela cota (18 não traz 180 nem 1801).',
      onde:'Cadastros › Clientes', perms:['associados'] },
  ] },
  { id:'2026-11-14-agente-2-4', data:'14/11/2026', itens:[
    { titulo:'Programa de impressão 2.4',
      texto:'O programa que imprime as fichas ficou mais seguro: só aceita ordens do Commandah oficial, imprime só em impressoras da rede interna e se atualiza sozinho nas próximas versões. Instale esta versão uma vez em cada computador (baixe de novo, feche o programa antigo pelo ícone perto do relógio, troque o arquivo em C:\\Commandah e abra). O pareamento continua valendo.',
      onde:'Configurações › Impressoras', perms:['impressoras'] },
  ] },
  { id:'2026-11-14-conferencia-no-servidor', data:'14/11/2026', itens:[
    { titulo:'Venda conferida com o cadastro',
      texto:'O sistema agora confere cada venda fechada com o cadastro (preço, desconto, crédito e pagamento). Venda que não bate fica listada no relatório Vendas com divergência. Quem tem o ajuste ligado em Configurações passa a ter a venda recusada na hora. Cancelar item ou comanda e receber fiado também passam a exigir a permissão certa.',
      onde:'Relatórios › Vendas com divergência', perms:['relatorios-gerencia'] },
  ] },
  { id:'2026-11-13-caixa-por-operador', data:'13/11/2026', itens:[
    { titulo:'Caixa por operador',
      texto:'Caixa por operador: cada computador tem o seu caixa, com contagem na abertura e no fechamento. Diferença trava até um administrador ou o dono liberar.',
      onde:'Caixa', perms:['caixa'] },
  ] },
  { id:'2026-11-12-dono-duas-etapas', data:'12/11/2026', itens:[
    { titulo:'Verificação em duas etapas para o dono',
      texto:'O dono pode proteger a conta com um código de 6 números de um aplicativo no celular (Google Authenticator ou parecido). Com ela ligada, quem souber só a senha não entra como dono. Garçom, caixa e cozinha continuam entrando só com o PIN.',
      onde:'Tela do PIN › Proteger a conta do dono', perms:['config-sistema'] },
  ] },
  { id:'2026-11-12-selo-pro', data:'12/11/2026', itens:[
    { titulo:'Recursos do plano Pro',
      texto:'Os recursos que ainda estão chegando (Delivery, SMS, Pix Online, Bot WhatsApp e outros) aparecem no menu com o selo "Pro · em breve", no lugar de "Em construção". Eles continuam sem funcionar por enquanto.',
      onde:'Menu' },
  ] },
  { id:'2026-11-12-primeiro-acesso', data:'12/11/2026', itens:[
    { titulo:'Estabelecimento novo começa do zero',
      texto:'Quem cria um estabelecimento novo responde como atende (sócios, mesas, balcão e onde os pedidos são preparados) e segue uma lista de primeiros passos até a primeira venda. Nada muda para quem já usa o sistema.',
      onde:'Primeiro acesso do administrador', perms:['config-sistema'] },
  ] },
  { id:'2026-11-11-nfce-salvar-emissor', data:'11/11/2026', itens:[
    { titulo:'Salvar o emissor provisório da NFC-e',
      texto:'Quem aparece com "Emissor provisório" agora salva esse emissor no próprio estabelecimento com um clique, sem colar o token. Outro estabelecimento continua começando sem emissor, com o campo vazio para cadastrar o dele.',
      onde:'Configurações › NFC-e (nota fiscal)', perms:['config-sistema'] },
  ] },
  { id:'2026-11-11-pin-obvio', data:'11/11/2026', itens:[
    { titulo:'PIN fácil de adivinhar precisa ser trocado',
      texto:'Quem entra com um PIN óbvio (1234, 0000, 123456 ou outra sequência) troca o PIN logo ao entrar, antes de operar. Administrador passa a usar 6 dígitos. Ao cadastrar ou redefinir um colaborador, esses PINs não são mais aceitos.',
      onde:'Tela de entrada (PIN)' },
  ] },
  { id:'2026-11-11-cadastro-convite', data:'11/11/2026', itens:[
    { titulo:'Estabelecimento novo só com convite',
      texto:'Criar um estabelecimento novo no Commandah passou a exigir o código de convite que o cliente recebe ao contratar. Ninguém de fora consegue mais abrir uma conta sozinho. Quem já usa o sistema não precisa fazer nada.',
      onde:'Tela de entrada › Criar novo estabelecimento', perms:['config-sistema'] },
  ] },
  { id:'2026-11-11-nfce-emissor', data:'11/11/2026', itens:[
    { titulo:'Emissor de NFC-e de cada estabelecimento',
      texto:'Cada estabelecimento emite a NFC-e pela própria conta na Brasil NFe. O dono cadastra o token da conta na tela da NFC-e; o token fica guardado só no servidor. A nota de verdade (produção) só sai depois que a equipe do Commandah libera o estabelecimento.',
      onde:'Configurações › NFC-e (nota fiscal)', perms:['config-sistema'] },
  ] },
  { id:'2026-11-10-xml-cancelamento', data:'10/11/2026', itens:[
    { titulo:'XML do cancelamento no pacote da contabilidade',
      texto:'Ao cancelar uma NFC-e, o sistema guarda o XML do evento de cancelamento. O pacote de Cupons Fiscais passa a levar esse arquivo junto da nota.',
      onde:'Relatórios › Cupons Fiscais', perms:['relatorios-gerencia'] },
  ] },
  { id:'2026-11-10-relatorios', data:'10/11/2026', itens:[
    { titulo:'Relatórios detalhados',
      texto:'Novos relatórios: Conta do Cliente (quem deve, última compra e tudo o que comprou), Relatório de Vendas (com filtro por forma de pagamento e itens), Vendas dos Garçons e Cupons Fiscais, com pacote de planilha e XMLs para a contabilidade.',
      onde:'Relatórios', perms:['relatorios-gerencia'] },
    { titulo:'Vendas contam pela data do pagamento',
      texto:'Comanda aberta à noite e paga no dia seguinte agora conta no dia seguinte. Mais Vendidos passou a mostrar os números do período escolhido.',
      onde:'Relatórios', perms:['relatorios-gerencia'] },
  ] },
  { id:'2026-11-09-pix', data:'09/11/2026', itens:[
    { titulo:'Pix pela chave e Pix pela maquininha',
      texto:'Quando o cliente pagar pela chave CNPJ, use o botão "Pix CNPJ". Quando pagar pelo QR Code da maquininha, use o botão "Pix".',
      onde:'Janela de pagamento', perms:['caixa'] },
  ] },
  { id:'2026-11-09-formas', data:'09/11/2026', itens:[
    { titulo:'Formas de pagamento você escolhe',
      texto:'Agora dá para ligar e desligar as formas de pagamento, criar novas (como "Pago online") e dizer quem confere cada uma. O Fiado e o Vale só aparecem na venda se estiverem ligados.',
      onde:'Financeiro › Organização de Contas › Formas de Pagamento', perms:['pagamentos'] },
    { titulo:'Fechamento do caixa: o que contar',
      texto:'Ao fechar, conte o dinheiro e as outras formas que o administrador marcou para você. Você digita o que contou e finaliza; quem vê o valor esperado e a diferença é o administrador.',
      onde:'Principal › Caixa › Abrir/Fechar › Fechar Caixa', perms:['caixa'] },
    { titulo:'Fechamento por forma de pagamento',
      texto:'O fechamento mostra uma linha para cada forma, com o esperado, o contado e a diferença. O recebimento de fiado em Pix ou outra forma aparece separado ("Pix fiado").',
      onde:'Relatórios › Caixa › Histórico do Caixa', perms:['relatorios-gerencia'] },
    { titulo:'Conferência de pagamentos',
      texto:'O administrador confere o que entrou em cartão, Pix e vales e marca vários pagamentos de uma vez.',
      onde:'Financeiro › Conferência › Conferência de pagamentos', perms:['conferir-pagamentos'] },
  ] },
  { id:'2026-11-09', data:'09/11/2026', itens:[
    { titulo:'Novo perfil: Garçom',
      texto:'Para quem atende pelo celular: lança pedido e fecha comanda. Fiado, caixa e cadastros continuam com o caixa e o administrador.',
      onde:'Colaboradores › Editar › Acesso e Permissões', perms:['usuarios'] },
    { titulo:'Produtos em falta',
      texto:'Acabou um item? Pause o produto e ele sai da venda em todos os aparelhos em até 30 segundos. Ative de novo na mesma tela.',
      onde:'Menu › Produtos em falta', perms:['pausar-produto'] },
    { titulo:'Diária de freelancer',
      texto:'Registre a diária como retirada, com o nome da pessoa. Ela aparece separada no fechamento do caixa.',
      onde:'Caixa › Retirada › Diária de freelancer', perms:['caixa'] },
    { titulo:'Conta do colaborador',
      texto:'Cliente do tipo Colaborador tem desconto na comanda, e o consumo fica na conta dele. A comanda fecha só no caixa, e o administrador dá baixa como "Descontado do salário".',
      onde:'Clientes › Editar › Tipo de cliente; Conta Corrente (Fiado)', perms:['associados','receber-fiado'] },
    { titulo:'Cancelar NFC-e: só o administrador',
      texto:'O cancelamento da nota fiscal passou a ser feito apenas pelo administrador.',
      onde:'Comanda fechada › Cancelar NFC-e', perms:['caixa'] },
  ] },
  { id:'2026-11-08', data:'08/11/2026', itens:[
    { titulo:'Entrada mais rápida',
      texto:'O aparelho lembra quem entrou por último ("Continuar como …", só falta o PIN). Para outra pessoa, digite o nome na busca e tecle Enter.',
      onde:'Tela de entrada (login)' },
    { titulo:'Duplo clique abre o item certo',
      texto:'Nas listas com pesquisa ou rolagem, o duplo clique não pula mais para o primeiro item da lista.',
      onde:'Categorias, Insumos, Clientes, Fornecedores, Observações e as outras listas de cadastro',
      perms:['categorias','insumos','associados','fornecedores','observacoes','perguntas','pagamentos','locais'] },
    { titulo:'Ordenar produtos pela coluna',
      texto:'Clique no título de qualquer coluna: ▲ crescente, ▼ decrescente; o 3º clique volta à ordem normal.',
      onde:'Gestão › Produtos', perms:['produtos'] },
    { titulo:'Foto do produto sem limite de tamanho',
      texto:'Qualquer foto entra (até 25 MB); o sistema reduz sozinho para 600 × 600.',
      onde:'Gestão › Produtos › Editar › Selecionar imagem', perms:['produtos'] },
  ] },
];

function chaveNovidadesVistas(){
  const tenant = (typeof storageApi!=='undefined' && storageApi && storageApi.tenantId) || 'local';
  return 'commandah:novidades-vistas:'+tenant+':'+(currentUser && currentUser.id || '');
}
function novidadesVistas(){
  try{ return JSON.parse(localStorage.getItem(chaveNovidadesVistas())||'[]'); }catch(e){ return []; }
}
function marcarNovidadesVistas(ids){
  try{ localStorage.setItem(chaveNovidadesVistas(), JSON.stringify([...new Set([...novidadesVistas(), ...ids])])); }catch(e){}
}
// Entradas com os itens que esta pessoa pode ver (entrada sem nenhum item visível some).
function novidadesDoUsuario(){
  return NOVIDADES.map(n=>({ ...n, itens:n.itens.filter(it=>!it.perms || it.perms.some(p=>hasPerm(p))) })).filter(n=>n.itens.length);
}
function htmlNovidades(lista){
  return `<div class="novidades">${lista.map(n=>`<section class="novidades-dia"><div class="novidades-data">Atualizações de ${h(n.data)}</div>${n.itens.map(it=>`
    <article class="novidades-item"><b>${h(it.titulo)}</b><p>${h(it.texto)}</p><div class="novidades-onde">Onde: ${h(it.onde)}</div></article>`).join('')}</section>`).join('')}</div>`;
}
// Ao entrar: só as novidades ainda não vistas por esta pessoa neste aparelho.
function mostrarNovidadesAoEntrar(){
  if(!currentUser) return;
  const vistas = new Set(novidadesVistas());
  const novas = novidadesDoUsuario().filter(n=>!vistas.has(n.id));
  if(!novas.length) return;
  marcarNovidadesVistas(novas.map(n=>n.id));
  openModal('Novidades', htmlNovidades(novas));
  document.querySelector('#modalRoot .modal')?.classList.add('novidades-modal');
}
// Ajuda › Novidades: todo o histórico que a pessoa pode ver.
function abrirNovidades(){
  const lista = novidadesDoUsuario();
  if(!lista.length){ toast('Nenhuma novidade para o seu perfil.'); return; }
  marcarNovidadesVistas(lista.map(n=>n.id));
  openModal('Novidades', htmlNovidades(lista));
  document.querySelector('#modalRoot .modal')?.classList.add('novidades-modal');
}
