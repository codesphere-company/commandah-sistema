/* ============ PRODUTOS EM FALTA (pausar e ativar produto) ============
   08/11 (pedido do dono): o caixa e a cozinha pausam o produto que acabou, e ativam de novo, sem abrir
   o cadastro de Produtos (que só o administrador grava). A chave chama a RPC product_set_active
   (migration 20261109000000), que troca só o "active" daquele produto no servidor e registra no log.
   Não usa save('products'): caixa e cozinha não gravam o catálogo, e regravar a lista inteira
   desfaria a edição feita em outro aparelho. Pausado some da Ficha, das comandas, do app do garçom,
   do cardápio e do totem (todos filtram active!==false). */
async function abrirProdutosEmFalta(){
  if(!requirePerm('pausar-produto')) return;
  // Mostra o que está no servidor agora: outro aparelho pode ter pausado depois do login.
  if(isCloudMode()){
    try{ await (saveQueues.products||Promise.resolve()); await atualizarCatalogoSeMudou(); }catch(e){}
  }
  const lista = (state.products||[]).filter(p=>p&&p.id).slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
  const linhas = lista.length ? lista.map(p=>`<tr data-id="${h(p.id)}" data-search="${h(((p.name||'')+' '+(p.category||'')+' '+(p.pdvCode||'')).toLowerCase())}"><td>${h(p.name||'—')}</td><td>${h(p.category||'—')}</td><td>${chaveProdutoAVenda(p)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Nenhum produto cadastrado.</td></tr>';
  openModal('Produtos em falta', `<div class="count-body">
    <p class="sub" style="margin:0">Acabou um produto? Desligue a chave e ele sai da Ficha, das comandas e do app do garçom. Ligue de novo quando voltar.</p>
    <div class="count-top"><div class="op-search"><span>⌕</span><input id="pfSearch" placeholder="Pesquisar produto..." oninput="filtrarProdutosEmFalta(this.value)"></div></div>
    <div class="finance-grid count-grid"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Situação</th></tr></thead><tbody id="pfRows">${linhas}</tbody></table></div>
    <div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 &nbsp; Voltar</button></div>
  </div>`, true);
  document.querySelector('#modalRoot .modal').classList.add('count-modal');
  document.getElementById('pfSearch').focus();
}
function chaveProdutoAVenda(p){
  const ativo = p.active!==false;
  return `<label class="comp-switch"><input type="checkbox" ${ativo?'checked':''} onchange="alternarProdutoAVenda(${jsArg(p.id)},this.checked)" aria-label="${h((p.name||'')+': à venda')}"><span></span> <b>${ativo?'À venda':'Pausado'}</b></label>`;
}
function filtrarProdutosEmFalta(q){
  q = String(q||'').trim().toLowerCase();
  document.querySelectorAll('#pfRows tr[data-search]').forEach(r=>r.style.display=!q||r.dataset.search.includes(q)?'':'none');
}
function redesenharChaveProduto(id){
  const p = state.products.find(x=>x.id===id), cel = document.querySelector(`#pfRows tr[data-id="${CSS.escape(id)}"] td:last-child`);
  if(p && cel) cel.innerHTML = chaveProdutoAVenda(p);
}
function mensagemErroPausar(error){
  const m = String(error && error.message || '');
  if(/sem permissao/i.test(m)) return 'Sem permissão para pausar produto. Fale com um administrador.';
  if(/nao encontrado/i.test(m)) return 'Produto não encontrado no servidor. Atualize a página.';
  return 'Não foi possível mudar o produto. Confira a internet e tente de novo.';
}
// Embrulhada por singleFlight em core/travas.js (trava por produto): dois toques seguidos na chave não
// mandam duas gravações.
async function alternarProdutoAVenda(id, ativo){
  const p = state.products.find(x=>x.id===id);
  if(!p || !hasPerm('pausar-produto')){ redesenharChaveProduto(id); return; }
  ativo = !!ativo;
  if(isCloudMode()){
    let r;
    try{ r = await supabaseClient.rpc('product_set_active', { p_product_id:id, p_active:ativo }); }catch(e){ r = { error:e }; }
    if(r.error || !r.data || !r.data.ok){ toast(mensagemErroPausar(r.error)); redesenharChaveProduto(id); return; }
    p.active = ativo;
    marcarAtivoDoProdutoNoServidor(id, ativo);
    notarVersaoDosProdutos(r.data.version);
  } else {
    // Fora da nuvem não há RPC nem RLS: grava a lista como sempre.
    p.active = ativo;
    if(!await save('products')){ redesenharChaveProduto(id); return; }
  }
  redesenharChaveProduto(id);
  renderAll();
  toast((ativo?'À venda: ':'Pausado: ')+(p.name||''));
}
