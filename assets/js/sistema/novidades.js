/* ============ NOVIDADES ============ */
// 08/11 (pedido do dono): ao entrar com o PIN, uma janela mostra o que mudou no sistema desde a última vez,
// com o que foi incluído e onde aconteceu; o × fecha. Cada pessoa vê só o que tem a ver com o perfil dela
// (item com `perms`: aparece se ela tiver ao menos uma dessas permissões; sem `perms`, aparece para todos).
// Depois de mostrada, a novidade não volta para aquela pessoa naquele aparelho. Ajuda › Novidades reabre tudo.
// A cada publicação, acrescentar uma entrada NO TOPO da lista (id único, data dd/mm/aaaa).
const NOVIDADES = [
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
