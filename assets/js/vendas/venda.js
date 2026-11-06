/* ============ VENDA — lógica compartilhada Balcão/Comandas ============ */
function newDraft(type){ currentSaleDraft = { items:[], memberId:null, customerName:'', type }; }
// Canal da venda em andamento (chaves iguais às do produto): delivery = 'online', comanda = 'mobile', resto = 'pdv'.
function currentDraftChannel(){ return currentSaleDraft&&currentSaleDraft.type==='delivery'?'online':currentSaleDraft&&currentSaleDraft.type==='comanda'?'mobile':'pdv'; }
function productEnabledForCurrentChannel(product){
  if(!product||product.active===false)return false;
  const channels=product.channels||{};
  const channel=currentDraftChannel();
  if(channels[channel]===false)return false;
  // Produto com grade: some da lista se nenhum tamanho pode ser vendido neste canal (ou a grade foi pausada/apagada).
  if(product.gradeId&&!itemChoiceSizes(product,channel).length)return false;
  return true;
}
function renderProductPicker(containerId){
  const el = document.getElementById(containerId);
  if(!state.products.length){ el.innerHTML = `<p class="empty">Cadastre produtos na aba Produtos antes de vender.</p>`; return; }
  el.innerHTML = `<div class="grid3">` + state.products.filter(productEnabledForCurrentChannel).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)).map(p=>{
    const av = productAvailable(p); const out = av!==Infinity && av<=0;
    return `<button class="btn" style="text-align:left;display:flex;align-items:center;gap:8px;justify-content:space-between" data-search="${h(p.name.toLowerCase())}" ${out?'disabled':''} onclick="addDraftItem(${jsArg(p.id)})">
      <span style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden">${p.image?`<img src="${h(p.image)}" alt="" style="width:28px;height:28px;border-radius:4px;object-fit:cover;flex-shrink:0">`:''}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(p.name)}</span></span><span class="mono" style="flex-shrink:0">${productSalePriceLabel(p,currentDraftChannel())}</span></button>`;
  }).join('') + `</div>`;
}
function addDraftItem(productId){
  if(currentSaleDraft&&currentSaleDraft.type==='comanda'&&!window.currentComandaRequester){toast('Selecione quem está solicitando antes de adicionar o produto.');return;}
  if(currentSaleDraft&&currentSaleDraft.type==='comanda'&&window.currentComandaRequester&&window.currentComandaRequester.canOrder===false){toast('Esta pessoa está bloqueada para consumir nesta cota.');return;}
  const p = state.products.find(x=>x.id===productId);
  if(!p) return;
  // Tamanhos e opções (escolha-item.js). Os campos antigos questionIds/complementIds/sizeIds não são
  // mais lidos pela venda (nenhum em uso); observações rápidas continuam na tela de escolha.
  if(!productOpensItemChoice(p)){ if(commitDraftItem(productId,null)) comandaLocatorPersist(); return; }
  openItemChoice(productId,currentDraftChannel(),choice=>{
    if(!currentSaleDraft) return;
    if(!commitDraftItem(productId,choice)) return;
    comandaLocatorPersist();
  });
}
// "Localizar produto" da comanda fica aberto (e a escolha abre por cima): ao entrar um item, grava a comanda e avisa uma vez só.
function comandaLocatorPersist(){
  if(!(currentSaleDraft&&currentSaleDraft.type==='comanda'&&window.comandaLocatorSaleId&&document.getElementById('clGrid'))) return;
  const sale=state.sales.find(x=>x.id===window.comandaLocatorSaleId);
  if(sale){ sale.items=currentSaleDraft.items; sale.total=draftTotal(); save('sales'); }
  toast('Item adicionado.');
}
// choice: null (produto sem escolha) ou o resultado do buildCustomization ({name,basePrice,price,customization}).
// Devolve true quando o item entrou no pedido.
function commitDraftItem(productId,choice){
  const p=state.products.find(x=>x.id===productId);if(!p)return false;
  // Produto com grade/grupos sem escolha: product.price (menor tamanho) nunca vira preço de venda.
  if(!choice&&productNeedsChoice(p,state.complementos)){ toast('Escolha o tamanho e as opções do produto.','erro'); return false; }
  let customization=choice?choice.customization:null;
  const comboItems=(p.comboProductIds||[]).map(id=>state.products.find(x=>x.id===id)).filter(Boolean).map(x=>({productId:x.id,name:x.name,qty:1}));
  if(comboItems.length){customization=customization?{...customization}:{answers:[],complementIds:[],observationIds:[],notes:'',extra:0};const comboText='Combo: '+comboItems.map(x=>x.name).join(', ');customization.comboItems=comboItems;customization.summary=[comboText,customization.summary].filter(Boolean).join(' · ');}
  const extra=customization?Number(customization.extra)||0:0;
  const requester=currentSaleDraft.type==='comanda'?window.currentComandaRequester:null,requesterKey=requester&&requester.key||'';
  // Itens iguais se somam só com a mesma assinatura (tamanho, opções e observações) e o mesmo solicitante.
  const signature=(choice?customizationSignature(choice.customization):customization?JSON.stringify({sizeId:customization.sizeId||null,answers:customization.answers,complementIds:customization.complementIds,observationIds:customization.observationIds,notes:customization.notes}):'')+'|'+requesterKey;
  const existing = currentSaleDraft.items.find(i=>i.productId===productId && !i.sent && (i.customizationSignature||'')===signature);
  const name=choice?choice.name:p.name,basePrice=choice?Number(choice.basePrice)||0:Number(p.price)||0,price=choice?Number(choice.price)||0:(Number(p.price)||0)+extra;
  const candidate={lineId:uid(),productId,name,basePrice,price,qty:1,sent:false,isCombo:productKind(p)==='combo',comboItems,customization:customization||null,customizationSignature:signature,notes:customization&&customization.summary||'',addedAt:new Date().toISOString(),addedById:currentUser&&currentUser.id||null,addedBy:currentUser&&currentUser.name||'—',requesterId:requester&&requester.id||null,requesterName:requester&&requester.name||'',requesterType:requester&&requester.type||''};
  const unsent=currentSaleDraft.items.filter(i=>!i.sent).map(i=>({...i}));
  const proposed=unsent.find(i=>i.productId===productId&&(i.customizationSignature||'')===signature);
  if(proposed) proposed.qty+=1; else unsent.push(candidate);
  if(!canFulfillItems(unsent)){ toast('Estoque insuficiente para aumentar este item.'); return false; }
  if(existing) existing.qty+=1; else currentSaleDraft.items.push(candidate);
  renderDraftItems();renderComandaAuditHistory();
  return true;
}
function changeDraftQty(idx, delta){
  const it = currentSaleDraft.items[idx]; if(!it) return;
  if(it.sent){ toast('Itens enviados não podem ser alterados. Use um fluxo de cancelamento com estorno.'); return; }
  if(delta>0){
    const unsent=currentSaleDraft.items.filter(i=>!i.sent).map(i=>({...i}));
    const proposed=unsent.find(i=>i.productId===it.productId&&(i.customizationSignature||'')===(it.customizationSignature||''));
    if(proposed) proposed.qty+=delta;
    if(!canFulfillItems(unsent)){ toast('Estoque insuficiente para aumentar este item.'); return; }
  }
  it.qty += delta;
  if(it.qty<=0) currentSaleDraft.items.splice(idx,1);
  if(currentSaleDraft.type==='comanda' && currentSaleDraft.id){
    const sale = state.sales.find(x=>x.id===currentSaleDraft.id);
    if(sale){ sale.items = currentSaleDraft.items; sale.total = draftTotal(); save('sales'); }
  }
  renderDraftItems();renderComandaAuditHistory();
}
function draftTotal(){ return saleTotal(currentSaleDraft.items)+(Number(currentSaleDraft.deliveryFee)||0); }
function serviceRatePct(){ return Math.max(0,Number(state.settings.serviceRate)||0); }
function serviceChargeAmount(base){ return base*serviceRatePct()/100; }
function renderTotalWithService(subtotal){
  const rate = serviceRatePct();
  if(!rate) return `<div class="cash-order-total"><span>Total</span><span class="mono" id="draftTotal">${fmt(subtotal)}</span></div>`;
  const svc = serviceChargeAmount(subtotal);
  return `<div class="cash-order-total-breakdown">
    <div class="cash-order-subtotal-line"><span>Subtotal</span><span class="mono" id="draftSubtotalLine">${fmt(subtotal)}</span></div>
    <div class="cash-order-service-line"><span>(+) Serviço (${rate}%)</span><span class="mono" id="draftServiceLine">${fmt(svc)}</span></div>
    <div class="cash-order-total"><span>Total</span><span class="mono" id="draftTotal">${fmt(subtotal+svc)}</span></div>
  </div>`;
}
function renderDraftItems(){
  const el = document.getElementById('draftItemsList');
  if(el){
  el.innerHTML = currentSaleDraft.items.length ? currentSaleDraft.items.map((i,idx)=>`
    <div class="item-line">
      <span>${h(i.name)} ${i.sent?'<span class=\"tag tag-blue\">Enviado</span>':''}${i.notes?`<small style="display:block;color:var(--c-text-3);margin-top:3px;max-width:520px">${h(i.notes)}</small>`:''}</span>
      <div class="qty-ctrl">
        <button ${i.sent?'disabled':''} onclick="changeDraftQty(${idx},-1)">−</button>
        <span class="mono">${i.qty}</span>
        <button ${i.sent?'disabled':''} onclick="changeDraftQty(${idx},1)">+</button>
        <span class="mono" style="min-width:70px;text-align:right">${fmt(i.price*i.qty)}</span>
      </div>
    </div>`).join('') : `<p class="empty">${el.closest('.cash-order-modal,.comanda-inline')?'Nenhum item lançado.':'Nenhum item adicionado.'}</p>`;
  }
  // Comanda aberta na tela cheia: o rodapé usa a mesma conta do pagamento (comandaDraftTotalsHtml).
  const comandaTotals = document.getElementById('draftTotalWrap');
  if(comandaTotals && currentSaleDraft.type==='comanda' && currentSaleDraft.id) comandaTotals.innerHTML = comandaDraftTotalsHtml();
  const totEl = comandaTotals && currentSaleDraft.type==='comanda' ? null : document.getElementById('draftTotal');
  if(totEl){
    const subtotal = draftTotal();
    const rate = currentSaleDraft.type==='comanda' ? serviceRatePct() : 0;
    if(rate>0){
      const svc = serviceChargeAmount(subtotal);
      totEl.textContent = fmt(subtotal+svc);
      const subEl=document.getElementById('draftSubtotalLine'); if(subEl) subEl.textContent=fmt(subtotal);
      const svcEl=document.getElementById('draftServiceLine'); if(svcEl) svcEl.textContent=fmt(svc);
    } else {
      totEl.textContent = fmt(subtotal);
    }
  }
  const printBtn=document.getElementById('pdvPrintConsumption');
  if(printBtn){const count=currentSaleDraft.items.reduce((sum,item)=>sum+(Number(item.qty)||0),0);printBtn.disabled=!count;printBtn.textContent=`Imprimir Fichas de Consumação (${count} ${count===1?'Item novo':'Itens novos'})`;}
}

/* ============ BALCÃO ============ */
let selectedPdvSaleId = null;
let pdvShowClosed = false;
let pdvOptionsOpen = false;
function renderBalcao(){
  const el = document.getElementById('view-balcao');
  if(!state.cashSession || state.cashSession.status!=='open'){
    el.innerHTML = `<div class="consumer-workspace"><section class="free-cash"><h2>Caixa fechado</h2><div class="free-cash-actions free-cash-single"><button class="op-btn primary" onclick="switchView('caixa')">Abrir caixa</button></div><p class="sub" style="margin-top:25px">Abra o caixa para começar a vender na Ficha.</p></section></div>`; return;
  }
  // Só desenha com o balcão na tela: renderAll chama todas as telas, e o balcão usa os mesmos
  // #draftItemsList/#draftTotal e o mesmo currentSaleDraft da comanda aberta.
  if(activeView!=='balcao'){ el.innerHTML=''; return; }
  renderBalcaoPdv(el);
  return;
}
function togglePdvOptions(){ pdvOptionsOpen=!pdvOptionsOpen; renderBalcao(); }
/* Visual A, etapa 3 (22/10): o balcão vende direto na tela, sem popup: produtos por categoria à
   esquerda e o pedido à direita (antes: tela "Caixa livre" + botão Novo pedido + popup com a
   lista de produtos escondida numa gaveta). O rascunho do balcão fica guardado em balcaoDraft
   enquanto o caixa mexe nas comandas (que usam o mesmo currentSaleDraft); finalizeSale cria um
   rascunho novo (newDraft) e renderAll redesenha. */
let balcaoDraft = null, balcaoCategory = '', balcaoQuery = '';
function renderBalcaoPdv(el){
  if(!currentSaleDraft || currentSaleDraft.type!=='balcao'){ if(balcaoDraft) currentSaleDraft = balcaoDraft; else newDraft('balcao'); }
  balcaoDraft = currentSaleDraft;
  const prevSearch = document.getElementById('balcaoSearch'), searchFocused = document.activeElement===prevSearch;
  const products = state.products.filter(productEnabledForCurrentChannel).slice().sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||String(a.name).localeCompare(String(b.name),'pt-BR'));
  const categories = [...new Set(products.map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(balcaoCategory && !categories.includes(balcaoCategory)) balcaoCategory = '';
  const member = currentSaleDraft.memberId ? state.members.find(m=>m.id===currentSaleDraft.memberId) : null;
  const cards = products.map(p=>{ const av = productAvailable(p), out = av!==Infinity && av<=0;
    return `<button class="balcao-prod" data-category="${h(p.category||'')}" data-search="${h(((p.category||'')+' '+(p.code||'')+' '+(p.pdvCode||'')+' '+p.name).toLowerCase())}" ${out?'disabled title="Sem estoque"':''} onclick="addDraftItem(${jsArg(p.id)})"><span class="bp-cat">${h(p.category||'Sem categoria')}</span><span class="bp-name">${h(p.name)}</span><span class="bp-price mono">${out?'Sem estoque':productSalePriceLabel(p,currentDraftChannel())}</span></button>`; }).join('');
  el.innerHTML = `<div class="table-workspace balcao-split">
    <div class="balcao-main">
      <div class="table-toolbar"><div class="op-search"><input type="search" id="balcaoSearch" placeholder="Buscar produto ou código" value="${h(balcaoQuery)}" oninput="filterBalcaoProducts(this.value)"></div></div>
      <div class="balcao-cats" id="balcaoCats" role="group" aria-label="Categorias">${balcaoCatsInner(categories)}</div>
      <div class="balcao-grid" id="balcaoGrid">${cards || '<p class="empty">Cadastre produtos na aba Produtos antes de vender.</p>'}</div>
    </div>
    <aside class="balcao-cart" aria-label="Pedido da ficha">
      <div class="bc-head"><h2>Ficha</h2><span>Pedido #${(state.orderCounter||0)+1}</span></div>
      <div class="bc-client">${member?`<span>Cliente: <b>${h(member.name)}</b></span><button class="link-btn" onclick="openBalcaoClientModal()">Trocar</button><button class="link-btn" onclick="unlinkBalcaoClient()">Tirar</button>`:`<span>Cliente avulso</span><button class="link-btn" onclick="openBalcaoClientModal()">Vincular cliente</button>`}</div>
      <input id="pdvNote" placeholder="Nome para chamar ou observação" value="${h(currentSaleDraft.notes||'')}" oninput="currentSaleDraft.notes=this.value">
      <div class="bc-items" id="draftItemsList"></div>
      <div class="cash-order-total"><span>Total</span><span class="mono" id="draftTotal">R$ 0,00</span></div>
      <div class="bc-actions"><button class="op-btn" onclick="clearPdvDraft()">Limpar</button><button class="op-btn primary" id="balcaoPayBtn" onclick="openPaymentModal('balcao')">Cobrar</button></div>
    </aside>
  </div>`;
  filterBalcaoProducts(balcaoQuery);
  renderDraftItems();
  if(searchFocused) document.getElementById('balcaoSearch').focus();
}
function filterBalcaoProducts(q){
  balcaoQuery = String(q||'');
  const value = balcaoQuery.trim().toLowerCase();
  document.querySelectorAll('#balcaoGrid .balcao-prod').forEach(b=>{ b.style.display = (!balcaoCategory||b.dataset.category===balcaoCategory) && (!value||b.dataset.search.includes(value)) ? '' : 'none'; });
}
/* Pedido do dono (05/11): com 45 categorias os botões tomavam a tela e os produtos da categoria
   escolhida ficavam fora da vista. Com uma categoria escolhida, a barra mostra só ela e o botão de
   voltar para todas; a grade fica com o espaço todo. */
function balcaoCatsInner(categories){
  if(balcaoCategory) return `<button class="balcao-cats-back" onclick="setBalcaoCategory('')">‹ Todas as categorias</button><span class="balcao-cats-current">${h(balcaoCategory)}</span>`;
  return `<button class="active" onclick="setBalcaoCategory('')">Todos</button>${categories.map(c=>`<button data-category="${h(c)}" onclick="setBalcaoCategory(this.dataset.category)">${h(c)}</button>`).join('')}`;
}
function balcaoCategories(){
  return [...new Set(state.products.filter(productEnabledForCurrentChannel).map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
function setBalcaoCategory(c){
  balcaoCategory = c||'';
  const bar = document.getElementById('balcaoCats');
  if(bar){
    bar.innerHTML = balcaoCatsInner(balcaoCategories());
    const alvo = balcaoCategory ? bar.querySelector('.balcao-cats-back') : (c===''&&bar.querySelector('button'));
    if(alvo) alvo.focus();
  }
  filterBalcaoProducts(balcaoQuery);
  const grid = document.getElementById('balcaoGrid'); if(grid) grid.scrollTop = 0;
}
function openBalcaoClientModal(){
  openModal('Vincular cliente', `<div id="balcaoClientPick"><div class="field"><input id="pdvClientSearch" placeholder="Nome, telefone, CPF ou cota" oninput="filterPdvClients(this.value)"></div><p id="pdvClientTips" class="sub">Digite parte do nome, do telefone, do CPF ou o número da cota.</p><div id="pdvClientResults"></div></div>`);
  setTimeout(()=>document.getElementById('pdvClientSearch')?.focus(), 0);
}
function unlinkBalcaoClient(){ currentSaleDraft.memberId=null; currentSaleDraft.customerName=''; renderBalcao(); }
function selectPdvSale(id){ selectedPdvSaleId=id; document.querySelectorAll('#pdvRows tr').forEach(r=>r.classList.toggle('selected',r.getAttribute('onclick')&&r.getAttribute('onclick').includes(id))); }
function focusPdvAdvancedSearch(){ pdvOptionsOpen=false; renderBalcao(); const input=document.getElementById('pdvSearch'); input.placeholder='Busca avançada: cliente, número ou operador...'; input.focus(); }
function openNewPdvSale(){
  newDraft('balcao');
  pdvCategoryFilter='';pdvProductView='list';
  openModal('Pedido no Caixa',`<div class="record-body"><div class="cash-order-head"><div class="cash-order-ident"><span class="delivery-open-badge">Em Aberto</span><strong>Pedido #${(state.orderCounter||0)+1}</strong></div><div class="cash-order-toolbar"><div class="op-search"><input id="pdvProductSearch" placeholder="Buscar Produto..." onfocus="togglePdvCatalog(true)" oninput="filterPdvProducts(this.value)"></div><button class="delivery-locate" onclick="togglePdvCatalog(true)"><span style="font-size:25px">＋</span> Produtos</button></div></div><div class="cash-order-layout"><aside class="cash-order-side"><div class="delivery-meta">◷ &nbsp; Iniciado em ${reportDateTime(new Date().toISOString())}<br>♙ &nbsp; Criado por: <b>${h(currentUser.name)}</b></div><div class="field"><select disabled aria-label="Operador"><option>${h(currentUser.name)}</option></select></div><div class="field"><input id="pdvNote" placeholder="Anotar observação..."></div><div class="cash-order-links"><button onclick="showPdvClientFields()">♙ &nbsp; Vincular Cliente</button><button onclick="togglePdvOrderOptions()">☰ &nbsp; Mais Opções</button></div></aside><main class="cash-order-main"><div class="cash-order-items"><div id="draftItemsList"></div></div><div class="cash-order-total"><span>Total</span><span class="mono" id="draftTotal">R$ 0,00</span></div></main></div><div class="record-actions"><button class="op-btn" onclick="closeModal()">‹ &nbsp; Cancelar (ESC)</button><button class="op-btn primary" id="pdvPayBtn">Pagamento</button></div><section id="pdvProductSheet" class="pdv-sheet product"><header class="pdv-sheet-title"><span>Localizar Produto</span><button onclick="togglePdvCatalog(false)">×</button></header><div class="pdv-sheet-toolbar"><div class="op-search"><input id="pdvLocatorSearch" placeholder="Pesquisar..." oninput="filterPdvProducts(this.value)"></div><button class="pdv-sheet-new" title="Exibição em lista">▤</button><button class="pdv-sheet-new" title="Exibição em cartões">▥</button></div><div class="pdv-sheet-tabs"><button>Todas</button></div><div id="pdvProductGrid" class="pdv-sheet-grid"></div></section><section id="pdvClientSheet" class="pdv-sheet client"><header class="pdv-sheet-title"><span>Buscar Cliente</span><button onclick="closePdvClientSheet()">×</button></header><div class="pdv-sheet-toolbar"><div class="op-search"><input id="pdvClientSearch" placeholder="Pesquisar aqui..." oninput="filterPdvClients(this.value)"></div><button class="pdv-sheet-new" onclick="openPdvQuickClient()"><span style="font-size:24px">＋</span> Novo</button></div><div id="pdvClientTips" class="pdv-search-tips"><div class="tip-title">ⓘ &nbsp; <b style="display:inline">Dicas de Pesquisa</b></div><b>Buscar por Telefone ou CPF/CNPJ:</b>Digite apenas números — sem traços, espaços ou pontos.<b>Buscar por Nome ou endereço:</b>Digite qualquer parte do nome da pessoa ou da rua.<b>Buscar por E-mail:</b>Digite uma parte do e-mail que contenha @.</div><div id="pdvClientResults" class="pdv-client-results"></div><div id="pdvQuickClient" class="pdv-quick-client"><div class="field"><label>Nome</label><input id="pdvNewClientName"></div><div class="row"><div class="field"><label>Telefone</label><input id="pdvNewClientPhone"></div><div class="field"><label>Cota / código</label><input id="pdvNewClientCode"></div></div><button class="op-btn primary" onclick="savePdvQuickClient()">Salvar e vincular</button></div></section><div id="pdvOrderOptions" class="pdv-options-panel"><div class="pdv-options-inner"><button onclick="openPdvTransferOptions()">Trocar para...</button><button onclick="printPdvConsumption()" disabled>Imprimir Fichas de Consumação (${currentSaleDraft.items.length} Item novo)</button><button onclick="toast('Envio por WhatsApp requer provedor e credenciais configurados.')">Enviar para WhatsApp</button><button onclick="recalculatePdvOrder()">Recalcular Pedido</button><button class="danger" onclick="deletePdvDraft()">▥ &nbsp; Excluir Pedido</button><button class="cancel" onclick="togglePdvOrderOptions(false)">Cancelar</button></div></div></div>`,true);
  document.querySelector('#modalRoot .modal').classList.add('record-modal','cash-order-modal');
  document.querySelector('#pdvOrderOptions button[onclick="printPdvConsumption()"]').id='pdvPrintConsumption';
  const pdvRoot=document.getElementById('modalRoot');
  pdvRoot.dataset.confirmPdv='true';
  pdvRoot.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closeModal();}};
  document.getElementById('pdvNote').oninput=e=>currentSaleDraft.notes=e.target.value;
  document.getElementById('pdvPayBtn').onclick=()=>openPaymentModal('balcao');
  renderPdvProductLocator(); renderDraftItems();
}
function addPdvProductAndClose(id){addDraftItem(id);togglePdvCatalog(false);}
function togglePdvCatalog(force){const el=document.getElementById('pdvProductSheet');if(!el)return;el.classList.toggle('visible',force===undefined?!el.classList.contains('visible'):!!force);if(el.classList.contains('visible')){document.getElementById('pdvLocatorSearch').focus();}}
function filterPdvProducts(q){const value=String(q).toLowerCase();document.querySelectorAll('[data-pdv-product-search]').forEach(x=>x.style.display=x.dataset.pdvProductSearch.includes(value)?'':'none');}
let pdvProductView='list';
let pdvCategoryFilter='';
function setPdvCategoryFilter(category){pdvCategoryFilter=category;renderPdvProductLocator();renderPdvCategoryTabs();}
function renderPdvCategoryTabs(){const tabs=document.querySelector('#pdvProductSheet .pdv-sheet-tabs');if(!tabs)return;const categories=[...new Set(state.products.filter(productEnabledForCurrentChannel).map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));tabs.innerHTML=`<button class="${!pdvCategoryFilter?'active':''}" onclick="setPdvCategoryFilter('')">Todas</button>${categories.map(c=>`<button class="${pdvCategoryFilter===c?'active':''}" data-category="${h(c)}">${h(c)}</button>`).join('')}`;tabs.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>setPdvCategoryFilter(button.dataset.category));}
function setPdvProductView(mode){pdvProductView=mode==='cards'?'cards':'list';renderPdvProductLocator();document.querySelectorAll('#pdvProductSheet .pdv-sheet-new').forEach(button=>button.classList.toggle('active',(pdvProductView==='list'&&button.title.includes('lista'))||(pdvProductView==='cards'&&button.title.includes('cartões'))));const query=document.getElementById('pdvLocatorSearch')?.value||document.getElementById('pdvProductSearch')?.value||'';filterPdvProducts(query);}
function renderPdvProductLocator(){
  const el=document.getElementById('pdvProductGrid');if(!el)return;const list=state.products.filter(productEnabledForCurrentChannel).filter(p=>!pdvCategoryFilter||p.category===pdvCategoryFilter);renderPdvCategoryTabs();
  if(pdvProductView==='cards'){el.innerHTML=`<div class="pdv-product-cards">${list.map(p=>`<button class="pdv-product-card" data-pdv-product-search="${h(((p.category||'')+' '+(p.code||'')+' '+p.name).toLowerCase())}" onclick="addPdvProductAndClose(${jsArg(p.id)})"><small>${h(p.category||'Sem categoria')} · ${h(p.code||'—')}</small><strong>${h(p.name)}</strong><strong>${productSalePriceLabel(p,currentDraftChannel())}</strong></button>`).join('')||'<p class="empty">Nenhum produto encontrado.</p>'}</div>`;return;}
  el.innerHTML=`<table><thead><tr><th>Categoria</th><th>Código</th><th>Nome do Produto</th><th>Preço de Venda</th></tr></thead><tbody>${list.map(p=>`<tr data-pdv-product-search="${h(((p.category||'')+' '+(p.code||'')+' '+p.name).toLowerCase())}" ondblclick="addPdvProductAndClose(${jsArg(p.id)})"><td>${h(p.category||'—')}</td><td>${h(p.code||'—')}</td><td>${h(p.name)}</td><td class="mono">${productSalePriceLabel(p,currentDraftChannel())}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhum produto encontrado.</td></tr>'}</tbody></table>`;
}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('#pdvProductSheet .pdv-sheet-new');if(!button)return;if(button.title.includes('lista'))setPdvProductView('list');if(button.title.includes('cartões'))setPdvProductView('cards');});
function showPdvClientFields(){const el=document.getElementById('pdvClientSheet');if(!el)return;el.classList.add('visible');document.getElementById('pdvClientSearch').focus();filterPdvClients('');}
function closePdvClientSheet(){document.getElementById('pdvClientSheet')?.classList.remove('visible');}
function filterPdvClients(q){const value=String(q).trim().toLowerCase(),tips=document.getElementById('pdvClientTips'),results=document.getElementById('pdvClientResults');if(!results)return;if(!value){tips.style.display='block';results.innerHTML='';return;}tips.style.display='none';const list=state.members.filter(m=>[m.name,m.phone,m.document,m.email,m.address,m.code].some(v=>String(v||'').toLowerCase().includes(value)));results.innerHTML=list.map(m=>`<div class="pdv-client-row"><div><b>${h(m.name)}</b><div class="sub">${h(m.phone||m.email||m.code||'Sem contato')}</div></div><button class="op-btn" onclick="selectPdvClient(${jsArg(m.id)})">Vincular</button></div>`).join('')||'<p class="empty">Nenhum cliente encontrado.</p>';}
function selectPdvClient(id){const m=state.members.find(x=>x.id===id);if(!m)return;currentSaleDraft.memberId=m.id;currentSaleDraft.customerName=m.name;closePdvClientSheet();toast('Cliente vinculado: '+m.name);if(document.getElementById('balcaoClientPick')){closeModal();renderBalcao();}}
function openPdvQuickClient(){document.getElementById('pdvClientTips').style.display='none';document.getElementById('pdvClientResults').innerHTML='';document.getElementById('pdvQuickClient').classList.add('visible');document.getElementById('pdvNewClientName').focus();}
async function savePdvQuickClient(){const name=document.getElementById('pdvNewClientName').value.trim();if(!name){toast('Informe o nome do cliente.');return;}const m=await MembersStore.create({name,phone:document.getElementById('pdvNewClientPhone').value.trim(),code:document.getElementById('pdvNewClientCode').value.trim()});selectPdvClient(m.id);}
function togglePdvOrderOptions(force){const el=document.getElementById('pdvOrderOptions');if(el)el.classList.toggle('visible',force===undefined?!el.classList.contains('visible'):!!force);}
function recalculatePdvOrder(){renderDraftItems();togglePdvOrderOptions(false);toast('Pedido recalculado.');}
function printPdvConsumption(){window.print();}
async function deletePdvDraft(){if(!await askConfirm({title:'Excluir o pedido em andamento?',message:'Os itens deste pedido serão descartados.',confirmLabel:'Excluir pedido'}))return;document.getElementById('modalRoot').dataset.confirmPdv='false';currentSaleDraft=null;closeModal();renderBalcao();}
function openPdvTransferOptions(){togglePdvOrderOptions(false);openModal('Trocar pedido para...',`<p class="sub">Escolha o novo tipo de atendimento.</p><div class="grid2"><button class="op-btn" onclick="toast('Use Mesas / Comandas para vincular este atendimento a uma mesa.')">Mesa / Comanda</button><button class="op-btn" onclick="toast('Use Delivery para informar cliente e endereço de entrega.')">Delivery</button></div><button class="op-btn" style="margin-top:14px" onclick="closeModal()">Cancelar</button>`);document.getElementById('modalRoot').dataset.confirmPdv='true';}
async function clearPdvDraft(){if(!currentSaleDraft.items.length)return;if(!await askConfirm({title:'Remover todos os itens?',message:'Os itens ainda não pagos saem deste pedido.',confirmLabel:'Remover itens'}))return;currentSaleDraft.items=[];renderDraftItems();}
function editSelectedPdvSale(){
  if(!selectedPdvSaleId){ toast('Selecione um pedido para editar.'); return; }
  const s=state.sales.find(x=>x.id===selectedPdvSaleId); if(!s) return;
  if(s.status==='closed'){ toast('Pedido finalizado disponível apenas para consulta.'); return; }
  currentSaleDraft={items:JSON.parse(JSON.stringify(s.items)),memberId:s.memberId,customerName:s.customerName,type:'balcao'};
  openModal('Editar pedido #'+(s.orderNumber||'—'),`<div id="balcaoPicker"></div><hr style="border:none;border-top:1px solid var(--line);margin:14px 0"><div id="draftItemsList"></div><div style="display:flex;justify-content:space-between;margin:14px 0;font-size:18px;font-weight:700"><span>Total</span><span class="mono" id="draftTotal">R$ 0,00</span></div><button class="btn btn-primary btn-block" onclick="openPaymentModal('balcao')">Finalizar e receber</button>`,true);
  renderProductPicker('balcaoPicker');renderDraftItems();
}
function finalizeSelectedPdvSale(){ editSelectedPdvSale(); }

