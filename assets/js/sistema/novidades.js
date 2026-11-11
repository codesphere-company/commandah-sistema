/* ============ NOVIDADES ============ */
// 08/11 (pedido do dono): ao entrar com o PIN, uma janela mostra o que mudou no sistema desde a última vez,
// com o que foi incluído e onde aconteceu; o × fecha. Cada pessoa vê só o que tem a ver com o perfil dela
// (item com `perms`: aparece se ela tiver ao menos uma dessas permissões; sem `perms`, aparece para todos).
// Depois de mostrada, a novidade não volta para aquela pessoa naquele aparelho. Ajuda › Novidades reabre tudo.
// A cada publicação, acrescentar uma entrada NO TOPO da lista (id único, data dd/mm/aaaa).
const NOVIDADES = [
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
