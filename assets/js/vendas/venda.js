/* ============ VENDA — lógica compartilhada Balcão/Comandas ============ */
function newDraft(type){ currentSaleDraft = { items:[], memberId:null, customerName:'', type }; }
function productEnabledForCurrentChannel(product){
  if(!product||product.active===false)return false;
  const channels=product.channels||{};
  const channel=currentSaleDraft&&currentSaleDraft.type==='delivery'?'online':currentSaleDraft&&currentSaleDraft.type==='comanda'?'mobile':'pdv';
  return channels[channel]!==false;
}
function renderProductPicker(containerId){
  const el = document.getElementById(containerId);
  if(!state.products.length){ el.innerHTML = `<p class="empty">Cadastre produtos na aba Produtos antes de vender.</p>`; return; }
  el.innerHTML = `<div class="grid3">` + state.products.filter(productEnabledForCurrentChannel).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)).map(p=>{
    const av = productAvailable(p); const out = av!==Infinity && av<=0;
    return `<button class="btn" style="text-align:left;display:flex;align-items:center;gap:8px;justify-content:space-between" data-search="${h(p.name.toLowerCase())}" ${out?'disabled':''} onclick="addDraftItem(${jsArg(p.id)})">
      <span style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden">${p.image?`<img src="${h(p.image)}" alt="" style="width:28px;height:28px;border-radius:4px;object-fit:cover;flex-shrink:0">`:''}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(p.name)}</span></span><span class="mono" style="flex-shrink:0">${fmt(p.price)}</span></button>`;
  }).join('') + `</div>`;
}
function addDraftItem(productId){
  if(currentSaleDraft&&currentSaleDraft.type==='comanda'&&!window.currentComandaRequester){toast('Selecione quem está solicitando antes de adicionar o produto.');return;}
  if(currentSaleDraft&&currentSaleDraft.type==='comanda'&&window.currentComandaRequester&&window.currentComandaRequester.canOrder===false){toast('Esta pessoa está bloqueada para consumir nesta cota.');return;}
  const p = state.products.find(x=>x.id===productId);
  if(!p) return;
  const questions=(p.questionIds||[]).map(id=>state.perguntas.find(q=>q.id===id)).filter(q=>q&&q.active!==false);
  const complements=(p.complementIds||[]).map(id=>state.complementos.find(c=>c.id===id)).filter(c=>c&&c.active!==false);
  const observations=(p.observationIds||[]).map(id=>state.observacoes.find(o=>o.id===id)).filter(Boolean);
  const sizes=(p.sizeIds||[]).map(id=>state.complementos.find(s=>s.id===id)).filter(s=>s&&s.recordKind==='size'&&s.active!==false);
  if(questions.length||complements.length||observations.length||sizes.length){ openProductCustomization(productId,questions,complements,observations,sizes); return; }
  commitDraftItem(productId,null);
}
function commitDraftItem(productId,customization){
  const p=state.products.find(x=>x.id===productId);if(!p)return;
  const comboItems=(p.comboProductIds||[]).map(id=>state.products.find(x=>x.id===id)).filter(Boolean).map(x=>({productId:x.id,name:x.name,qty:1}));
  if(comboItems.length){customization=customization?{...customization}:{answers:[],complementIds:[],observationIds:[],notes:'',extra:0};const comboText='Combo: '+comboItems.map(x=>x.name).join(', ');customization.comboItems=comboItems;customization.summary=[comboText,customization.summary].filter(Boolean).join(' · ');}
  const extra=customization?Number(customization.extra)||0:0;
  const requester=currentSaleDraft.type==='comanda'?window.currentComandaRequester:null,requesterKey=requester&&requester.key||'';
  const signature=(customization?JSON.stringify({sizeId:customization.sizeId||null,answers:customization.answers,complementIds:customization.complementIds,observationIds:customization.observationIds,notes:customization.notes}):'')+'|'+requesterKey;
  const existing = currentSaleDraft.items.find(i=>i.productId===productId && !i.sent && (i.customizationSignature||'')===signature);
  const candidate={lineId:uid(),productId,name:p.name,basePrice:Number(p.price)||0,price:(Number(p.price)||0)+extra,qty:1,sent:false,isCombo:productKind(p)==='combo',comboItems,customization:customization||null,customizationSignature:signature,notes:customization&&customization.summary||'',addedAt:new Date().toISOString(),addedById:currentUser&&currentUser.id||null,addedBy:currentUser&&currentUser.name||'—',requesterId:requester&&requester.id||null,requesterName:requester&&requester.name||'',requesterType:requester&&requester.type||''};
  const unsent=currentSaleDraft.items.filter(i=>!i.sent).map(i=>({...i}));
  const proposed=unsent.find(i=>i.productId===productId&&(i.customizationSignature||'')===signature);
  if(proposed) proposed.qty+=1; else unsent.push(candidate);
  if(!canFulfillItems(unsent)){ toast('Estoque insuficiente para aumentar este item.'); return; }
  if(existing) existing.qty+=1; else currentSaleDraft.items.push(candidate);
  renderDraftItems();renderComandaAuditHistory();
}
function openProductCustomization(productId,questions,complements,observations,sizes){
  const p=state.products.find(x=>x.id===productId);if(!p)return;
  const questionHtml=questions.map(q=>{
    const answers=Array.isArray(q.answers)?q.answers:[];
    if(q.type==='text')return `<div class="field product-question" data-question="${q.id}" data-type="text" data-required="${q.required?'1':'0'}"><label>${h(q.texto)}${q.required?' *':''}</label><textarea class="custom-text" rows="2"></textarea></div>`;
    if(q.type==='quantity')return `<div class="field product-question" data-question="${q.id}" data-type="quantity" data-required="${q.required?'1':'0'}"><label>${h(q.texto)}${q.required?' *':''}</label><input class="custom-quantity" type="number" min="${q.required?'1':'0'}" value="${q.required?'1':'0'}"></div>`;
    const inputType=q.type==='multiple'?'checkbox':'radio';
    return `<fieldset class="product-question" data-question="${q.id}" data-type="${q.type||'single'}" data-required="${q.required?'1':'0'}" data-max="${Number(q.maxChoices)||1}"><legend>${h(q.texto)}${q.required?' *':''}</legend>${answers.map(a=>`<label class="item-line"><span>${h(a.text)} ${Number(a.price)?`<small>+ ${fmt(a.price)}</small>`:''}</span><input class="custom-answer" type="${inputType}" name="question_${q.id}" value="${a.id}" data-text="${h(a.text)}" data-price="${Number(a.price)||0}"></label>`).join('')}</fieldset>`;
  }).join('');
  const complementHtml=complements.length?`<fieldset><legend>Complementos</legend>${complements.map(c=>`<label class="item-line"><span>${h(c.nome)} ${Number(c.preco)?`<small>+ ${fmt(c.preco)}</small>`:''}</span><input class="custom-complement" type="checkbox" value="${c.id}" data-name="${h(c.nome)}" data-price="${Number(c.preco)||0}"></label>`).join('')}</fieldset>`:'';
  const sizeHtml=(sizes||[]).length?`<fieldset class="product-size-group"><legend>Tamanho *</legend>${sizes.map(s=>`<label class="item-line"><span>${h(s.nome)} ${Number(s.preco)?`<small>+ ${fmt(s.preco)}</small>`:''}</span><input class="custom-size" type="radio" name="custom_product_size" value="${s.id}" data-name="${h(s.nome)}" data-price="${Number(s.preco)||0}"></label>`).join('')}</fieldset>`:'';
  const observationHtml=(observations||[]).length?`<fieldset><legend>Observações rápidas</legend>${observations.map(o=>`<label class="item-line"><span>${h(o.texto)}</span><input class="custom-observation" type="checkbox" value="${o.id}" data-text="${h(o.texto)}"></label>`).join('')}</fieldset>`:'';
  openModal('Personalizar item',`<div class="consumer-form-frame"><div class="app-status"><b>${h(p.name)}</b><span id="customItemPrice" class="mono">${fmt(p.price)}</span></div><div class="customization-scroll">${sizeHtml}${questionHtml}${complementHtml}${observationHtml}<div class="field"><label>Observações para o preparo</label><textarea id="customItemNotes" rows="3" placeholder="Ex.: retirar ingrediente, ponto de preparo..."></textarea></div></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveProductCustomization(${jsArg(productId)})">✓ Adicionar</button></div>`,true);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');
  document.querySelectorAll('#modalRoot .custom-answer,#modalRoot .custom-complement,#modalRoot .custom-size').forEach(el=>el.addEventListener('change',()=>{const group=el.closest('.product-question');if(group&&group.dataset.type==='multiple'){const checked=group.querySelectorAll('.custom-answer:checked');const max=Number(group.dataset.max)||1;if(checked.length>max){el.checked=false;toast('Escolha no máximo '+max+' opção(ões).');}}updateCustomizationPrice(productId);}));
}
function updateCustomizationPrice(productId){const p=state.products.find(x=>x.id===productId);const extras=[...document.querySelectorAll('#modalRoot .custom-answer:checked,#modalRoot .custom-complement:checked,#modalRoot .custom-size:checked')].reduce((sum,x)=>sum+(Number(x.dataset.price)||0),0);const el=document.getElementById('customItemPrice');if(el)el.textContent=fmt((Number(p&&p.price)||0)+extras);}
function saveProductCustomization(productId){
  const answers=[];let invalid='';
  document.querySelectorAll('#modalRoot .product-question').forEach(group=>{if(invalid)return;const q=state.perguntas.find(x=>x.id===group.dataset.question);if(!q)return;let values=[];
    if(group.dataset.type==='text'){const value=group.querySelector('.custom-text').value.trim();if(value)values=[{text:value,price:0}];}
    else if(group.dataset.type==='quantity'){const value=Number(group.querySelector('.custom-quantity').value)||0;if(value>0)values=[{text:String(value),value,price:0}];}
    else values=[...group.querySelectorAll('.custom-answer:checked')].map(x=>({id:x.value,text:x.dataset.text,price:Number(x.dataset.price)||0}));
    if(group.dataset.required==='1'&&!values.length){invalid='Responda: '+q.texto;return;}if(values.length)answers.push({questionId:q.id,question:q.texto,type:q.type,values});
  });
  if(invalid){toast(invalid);return;}
  const sizeInput=document.querySelector('#modalRoot .custom-size:checked'),hasSizes=!!document.querySelector('#modalRoot .product-size-group');
  if(hasSizes&&!sizeInput){toast('Escolha o tamanho do produto.');return;}
  const selectedSize=sizeInput?{id:sizeInput.value,name:sizeInput.dataset.name,price:Number(sizeInput.dataset.price)||0}:null;
  const selectedComplements=[...document.querySelectorAll('#modalRoot .custom-complement:checked')].map(x=>({id:x.value,name:x.dataset.name,price:Number(x.dataset.price)||0}));
  const selectedObservations=[...document.querySelectorAll('#modalRoot .custom-observation:checked')].map(x=>({id:x.value,text:x.dataset.text}));
  const typedNotes=document.getElementById('customItemNotes').value.trim(),notes=[...selectedObservations.map(o=>o.text),typedNotes].filter(Boolean).join(' · ');
  const extra=answers.flatMap(a=>a.values).reduce((s,a)=>s+(Number(a.price)||0),0)+selectedComplements.reduce((s,c)=>s+c.price,0)+(selectedSize?selectedSize.price:0);
  const parts=[];if(selectedSize)parts.push('Tamanho: '+selectedSize.name);answers.forEach(a=>parts.push(a.question+': '+a.values.map(v=>v.text).join(', ')));if(selectedComplements.length)parts.push('Complementos: '+selectedComplements.map(c=>c.name).join(', '));if(notes)parts.push('Obs.: '+notes);
  commitDraftItem(productId,{sizeId:selectedSize&&selectedSize.id,size:selectedSize,answers,complementIds:selectedComplements.map(c=>c.id),complements:selectedComplements,observationIds:selectedObservations.map(o=>o.id),observations:selectedObservations,notes,extra,summary:parts.join(' · ')});
  const locatorSaleId = window.comandaLocatorSaleId;
  if(currentSaleDraft.type==='comanda' && locatorSaleId){
    const sale = state.sales.find(x=>x.id===locatorSaleId);
    if(sale){ sale.items = currentSaleDraft.items; sale.total = draftTotal(); save('sales'); }
    closeModal();
    openComandaProductLocator(locatorSaleId);
  } else {
    closeModal();
  }
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
    </div>`).join('') : `<p class="empty">${el.closest('.cash-order-modal')?'Nenhum item lançado.':'Nenhum item adicionado.'}</p>`;
  }
  const totEl = document.getElementById('draftTotal');
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
    el.innerHTML = `<div class="consumer-workspace"><section class="free-cash"><h2>Caixa livre</h2><div class="free-cash-actions"><button class="op-btn" onclick="switchView('principal')">‹ &nbsp; Voltar</button><button class="op-btn primary" onclick="switchView('caixa')"><span class="op-ico">＋</span> Abrir caixa</button></div><p class="sub" style="margin-top:25px">Abra o caixa para iniciar um novo pedido.</p></section></div>`; return;
  }
  el.innerHTML = `<div class="consumer-workspace"><section class="free-cash"><h2>Caixa livre</h2><div class="free-cash-actions"><button class="op-btn" onclick="switchView('principal')">‹ &nbsp; Voltar</button><button class="op-btn primary" onclick="openNewPdvSale()"><span class="op-ico">＋</span> Novo pedido</button></div><p class="sub" style="margin-top:25px">Caixa aberto. Pronto para iniciar uma venda no balcão.</p></section></div>`;
  return;
  /* A grade histórica permanece implementada para futura consulta dedicada. */
  const list = state.sales.filter(s=>s.type==='balcao' && (pdvShowClosed || s.status!=='closed')).slice().sort((a,b)=>new Date(b.openedAt)-new Date(a.openedAt));
  const rows = list.map(s=>{
    const member=s.memberId?state.members.find(m=>m.id===s.memberId):null;
    const who=member?member.name:(s.customerName||'Cliente avulso');
    const status=s.status==='closed'?'Finalizado':'Em atendimento';
    const statusAt=s.closedAt||s.openedAt;
    const duration=Math.max(0,Math.floor((new Date(statusAt)-new Date(s.openedAt))/60000));
    return `<tr data-search="${h((who+' '+(s.orderNumber||'')).toLowerCase())}" class="${selectedPdvSaleId===s.id?'selected':''}" onclick="selectPdvSale(${jsArg(s.id)})" ondblclick="editSelectedPdvSale()">
      <td class="mono">#${s.orderNumber||'—'}</td><td>${new Date(s.openedAt).toLocaleString('pt-BR')}</td><td>${duration} min</td>
      <td>${h(who)}</td><td>${s.status==='closed'?'<span class="tag tag-green">Finalizado</span>':'<span class="tag tag-amber">Em atendimento</span>'}</td>
      <td>${new Date(statusAt).toLocaleString('pt-BR')}</td><td>Balcão</td><td>${h(s.operatorName||'—')}</td><td class="mono">${fmt(s.total)}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="pdv-shell">
    <div class="pdv-actions">
      <div class="pdv-search"><input id="pdvSearch" placeholder="Pesquisar cliente ou pedido..."></div><div class="spacer"></div>
      <div class="pdv-menu-wrap"><button class="pdv-action ${pdvOptionsOpen?'active':''}" onclick="togglePdvOptions()">••• &nbsp; Opções ▾</button>
        ${pdvOptionsOpen?`<div class="pdv-menu"><button onclick="toast('As principais colunas já estão visíveis.')">☰ &nbsp; Exibir colunas</button><button onclick="finalizeSelectedPdvSale()">☷ &nbsp; Finalizar selecionado</button><button onclick="focusPdvAdvancedSearch()">⌕ &nbsp; Busca avançada</button></div>`:''}</div>
      <button class="pdv-action" onclick="editSelectedPdvSale()">✎ &nbsp; Editar</button>
      <button class="pdv-action" onclick="openNewPdvSale()">＋ &nbsp; Novo</button>
    </div>
    <div class="pdv-table-wrap"><table class="pdv-table"><thead><tr><th>Pedido</th><th>Data abertura</th><th>Duração</th><th>Cliente</th><th>Status</th><th>Data do status</th><th>Atendimento</th><th>Operador</th><th>Total pedido</th></tr></thead>
      <tbody id="pdvRows">${rows||'<tr><td colspan="9" class="pdv-empty">Nenhum pedido encontrado</td></tr>'}</tbody></table></div>
    <div class="pdv-footer"><b class="mono">${list.length}</b><label>Mostrar pedidos finalizados: <select onchange="pdvShowClosed=this.value==='sim';selectedPdvSaleId=null;renderBalcao()"><option value="nao" ${!pdvShowClosed?'selected':''}>Não mostrar</option><option value="sim" ${pdvShowClosed?'selected':''}>Mostrar</option></select></label></div>
  </div>`;
  document.getElementById('pdvSearch').oninput=e=>{ const q=e.target.value.toLowerCase(); document.querySelectorAll('#pdvRows tr[data-search]').forEach(r=>r.style.display=r.dataset.search.includes(q)?'':'none'); };
}
function togglePdvOptions(){ pdvOptionsOpen=!pdvOptionsOpen; renderBalcao(); }
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
function renderPdvProductLocator(){const el=document.getElementById('pdvProductGrid');if(!el)return;const list=state.products.filter(productEnabledForCurrentChannel);el.innerHTML=`<table><thead><tr><th>Categoria</th><th>Código</th><th>Nome do Produto</th><th>Preço de Venda</th></tr></thead><tbody>${list.map(p=>`<tr data-pdv-product-search="${h(((p.category||'')+' '+(p.code||'')+' '+p.name).toLowerCase())}" ondblclick="addPdvProductAndClose(${jsArg(p.id)})"><td>${h(p.category||'—')}</td><td>${h(p.code||'—')}</td><td>${h(p.name)}</td><td class="mono">${fmt(p.price)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhum produto encontrado.</td></tr>'}</tbody></table>`;}
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
  if(pdvProductView==='cards'){el.innerHTML=`<div class="pdv-product-cards">${list.map(p=>`<button class="pdv-product-card" data-pdv-product-search="${h(((p.category||'')+' '+(p.code||'')+' '+p.name).toLowerCase())}" onclick="addPdvProductAndClose(${jsArg(p.id)})"><small>${h(p.category||'Sem categoria')} · ${h(p.code||'—')}</small><strong>${h(p.name)}</strong><strong>${fmt(p.price)}</strong></button>`).join('')||'<p class="empty">Nenhum produto encontrado.</p>'}</div>`;return;}
  el.innerHTML=`<table><thead><tr><th>Categoria</th><th>Código</th><th>Nome do Produto</th><th>Preço de Venda</th></tr></thead><tbody>${list.map(p=>`<tr data-pdv-product-search="${h(((p.category||'')+' '+(p.code||'')+' '+p.name).toLowerCase())}" ondblclick="addPdvProductAndClose(${jsArg(p.id)})"><td>${h(p.category||'—')}</td><td>${h(p.code||'—')}</td><td>${h(p.name)}</td><td class="mono">${fmt(p.price)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhum produto encontrado.</td></tr>'}</tbody></table>`;
}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('#pdvProductSheet .pdv-sheet-new');if(!button)return;if(button.title.includes('lista'))setPdvProductView('list');if(button.title.includes('cartões'))setPdvProductView('cards');});
function showPdvClientFields(){const el=document.getElementById('pdvClientSheet');if(!el)return;el.classList.add('visible');document.getElementById('pdvClientSearch').focus();filterPdvClients('');}
function closePdvClientSheet(){document.getElementById('pdvClientSheet')?.classList.remove('visible');}
function filterPdvClients(q){const value=String(q).trim().toLowerCase(),tips=document.getElementById('pdvClientTips'),results=document.getElementById('pdvClientResults');if(!results)return;if(!value){tips.style.display='block';results.innerHTML='';return;}tips.style.display='none';const list=state.members.filter(m=>[m.name,m.phone,m.document,m.email,m.address,m.code].some(v=>String(v||'').toLowerCase().includes(value)));results.innerHTML=list.map(m=>`<div class="pdv-client-row"><div><b>${h(m.name)}</b><div class="sub">${h(m.phone||m.email||m.code||'Sem contato')}</div></div><button class="op-btn" onclick="selectPdvClient(${jsArg(m.id)})">Vincular</button></div>`).join('')||'<p class="empty">Nenhum cliente encontrado.</p>';}
function selectPdvClient(id){const m=state.members.find(x=>x.id===id);if(!m)return;currentSaleDraft.memberId=m.id;currentSaleDraft.customerName=m.name;closePdvClientSheet();toast('Cliente vinculado: '+m.name);}
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

