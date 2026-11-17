/* ============ NOVIDADES ============ */
// 08/11 (pedido do dono): ao entrar com o PIN, uma janela mostra o que mudou no sistema desde a última vez,
// com o que foi incluído e onde aconteceu; o × fecha. Cada pessoa vê só o que tem a ver com o perfil dela
// (item com `perms`: aparece se ela tiver ao menos uma dessas permissões; sem `perms`, aparece para todos).
// Depois de mostrada, a novidade não volta para aquela pessoa naquele aparelho. Ajuda › Novidades reabre tudo.
// A cada publicação, acrescentar uma entrada NO TOPO da lista (id único, data dd/mm/aaaa).
const NOVIDADES = [
  { id:'2026-11-21-cofre', data:'21/11/2026', itens:[
    { titulo:'Troco por caixa',
      texto:'Em Configurações › Geral › Caixa por operador, cada caixa tem o campo "Troco (R$)": o dinheiro que fica na gaveta de uma noite para a outra. O que passar do troco vai para o cofre.',
      onde:'Configurações › Geral › Caixa por operador', perms:['cofre'] },
    { titulo:'Fim da noite separa o dinheiro do cofre',
      texto:'Ao tocar em "Fechar / passar o caixa", escolha "Passar o caixa" (troca de operador, o dinheiro continua na gaveta) ou "Fechar no fim da noite". No fim da noite o sistema avisa: "Deixe R$ X de troco na gaveta e separe R$ Y para o cofre."',
      onde:'Caixa › Fechar / passar o caixa', perms:['cofre'] },
    { titulo:'Sangria vai para o cofre',
      texto:'A sangria tirada do caixa entra na lista "A recolher" do cofre. Quando o dinheiro chegar lá, o administrador confirma e conta o valor; se não bater, a diferença fica registrada no extrato.',
      onde:'Caixa › Novo Lançamento e Cofre', perms:['cofre'] },
    { titulo:'Pagamento de funcionário e outro pagamento',
      texto:'Novo Lançamento ganhou "Pagamento de funcionário" (com o nome de quem recebeu), que o operador também pode lançar. "Outro pagamento" só o administrador lança.',
      onde:'Caixa › Novo Lançamento', perms:['cofre'] },
    { titulo:'Nova tela Cofre',
      texto:'Mostra o saldo do cofre, o que falta recolher e o extrato. Dá para contar o cofre, abastecer um caixa com troco, registrar outra saída (com motivo) e recolher o dinheiro de um caixa que já fechou. Só aparece para o administrador e quando o caixa por operador está ligado.',
      onde:'Menu lateral › Cofre', perms:['cofre'] },
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
