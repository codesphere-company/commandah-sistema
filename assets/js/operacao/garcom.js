/* ============ MODO GARÇOM (mobile) ============ */
let gcFlow = { saleId:null, step:'home', category:null };
let gcCart = [];
let gcRequester = null;

function gcRenderHome(){
  gcFlow = { saleId:null, step:'home', category:null }; gcCart=[]; levarJunto.gc=false; gcRequester=null;
  const screen = document.getElementById('gcScreen'); if(!screen) return;
  const open = state.sales.filter(s=>s.status==='open');
  const isBar = (state.settings.operationMode||'clube')==='bar';
  screen.innerHTML = `
    <div class="gc-bar"><div class="gc-title">Comandas</div><button class="gc-menu-btn" onclick="gcToggleMenu()">${ICN.menu}</button><div class="gc-menu-panel" id="gcMenuPanel"><button onclick="gcToggleTheme()">${document.documentElement.getAttribute('data-theme')==='dark'?'Modo claro':'Modo escuro'}</button><button onclick="gcLogout()">Sair</button></div></div>
    <div class="gc-body">
      ${isBar ? `<input id="gcSearch" placeholder="Número da mesa ou nome do cliente..." oninput="gcRenderHomeSearch(this.value)" autocomplete="off">
      <button class="btn btn-primary btn-block" style="margin-top:10px" onclick="gcOpenBarComanda()">+ Abrir nova comanda</button>`
      : `<input id="gcSearch" placeholder="Nome ou cota do sócio, ou nome/mesa do cliente avulso" oninput="gcRenderHomeSearch(this.value)" autocomplete="off">
      <button class="btn btn-block" style="margin-top:10px" onclick="gcOpenBarComanda()">+ Cliente avulso (não sócio)</button>`}
      <div id="gcHomeResults"></div>
      <div class="gc-section-label">Comandas em andamento (${open.length})</div>
      <div class="gc-tile-grid" id="gcOpenTiles"></div>
    </div>`;
  gcRenderOpenTiles();
}
async function gcOpenBarComanda(){
  const name = (document.getElementById('gcSearch')?.value||'').trim();
  if(!name){ toast('Digite o número da mesa ou o nome do cliente na busca acima.'); document.getElementById('gcSearch')?.focus(); return; }
  const s = { id:uid(), type:'comanda', tableNumber:null, orderNumber:await nextOrderNumber(), memberId:null, dependentId:null, dependentName:'', customerName:name, items:[], total:0, status:'open', payments:[], openedAt:new Date().toISOString(), operatorName:currentUser.name };
  state.sales.push(s); save('sales');
  gcOpenFlow(s.id);
}
function gcRenderOpenTiles(){
  const el = document.getElementById('gcOpenTiles'); if(!el) return;
  const open = state.sales.filter(s=>s.status==='open');
  el.innerHTML = open.length ? open.map(s=>{
    const info = comandaPersonData(s);
    const label = info.quota || (info.person||'?').slice(0,4).toUpperCase();
    return `<button class="gc-tile ${s.locked?'gc-amber':'gc-green'}" onclick="gcOpenFlow(${jsArg(s.id)})">${s.locked?'<span class="gc-lock">🔒</span>':''}<div>${h(label)}</div><div class="gc-tile-cap">${h((info.person||'').split(' ')[0])}</div></button>`;
  }).join('') : '<p class="gc-empty">Nenhuma comanda em andamento.</p>';
}
function gcRenderHomeSearch(q){
  const el = document.getElementById('gcHomeResults'); if(!el) return;
  const query = String(q||'').trim().toLowerCase();
  if(!query){ el.innerHTML=''; return; }
  const matches = state.members.filter(m=>!m.archived && m.active!==false && (((m.name||'').toLowerCase().includes(query))||((m.code||'').toLowerCase().includes(query)))).slice(0,8);
  el.innerHTML = matches.length ? matches.map(m=>{
    const existing = state.sales.find(s=>s.status==='open'&&s.memberId===m.id);
    return `<div class="gc-card ${m.debt>0?'gc-debt':''}"><div><div class="gc-name">${h(m.name)}</div><div class="gc-sub">${m.code?'Cota '+h(m.code):''}${m.debt>0?' · Deve '+fmt(m.debt):m.debt<0?' · Crédito '+fmt(-m.debt):''}</div></div><button onclick="gcSelectMember(${jsArg(m.id)})">${existing?'Abrir':'+ Comanda'}</button></div>`;
  }).join('') : `<p class="gc-empty">Nenhum associado encontrado.</p><button class="btn btn-primary btn-block" onclick="gcOpenBarComanda()">Abrir comanda avulsa para "${h(String(q).trim())}"</button>`;
}
// UX-11: no celular do garçom, sem escolha salva, o tema segue o do aparelho (e muda junto
// se o celular mudar); o botão do menu ☰ grava a escolha, como a caixinha do computador.
function setAppTheme(tema, persist){
  document.documentElement.setAttribute('data-theme', tema);
  const t = document.getElementById('darkToggle'); if(t) t.checked = tema==='dark';
  if(persist){ try{ localStorage.setItem('cantina2:theme', tema); }catch(e){} }
}
function gcApplyDeviceTheme(){
  let saved = null; try{ saved = localStorage.getItem('cantina2:theme'); }catch(e){}
  if(saved || !window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  setAppTheme(mq.matches?'dark':'light', false);
  if(!gcApplyDeviceTheme.bound && mq.addEventListener){
    gcApplyDeviceTheme.bound = true;
    mq.addEventListener('change', e=>{ let s2=null; try{ s2=localStorage.getItem('cantina2:theme'); }catch(_){} if(!s2) setAppTheme(e.matches?'dark':'light', false); });
  }
}
function gcToggleTheme(){
  setAppTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark', true);
  gcToggleMenu();
  if(!gcFlow||gcFlow.step==='home') gcRenderHome();
}
function gcToggleMenu(){ const p=document.getElementById('gcMenuPanel'); if(p) p.classList.toggle('open'); }
async function gcLogout(){ logAction('Logout realizado'); currentUser=null; try{ if(supabaseClient) await supabaseClient.auth.signOut(); }catch(e){} sessionIsOwner=false; document.getElementById('garcomApp').classList.remove('show'); renderLogin(); }

function gcOpenFlow(saleId){
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  gcFlow = { saleId, step:'categories', category:null }; gcCart=[]; levarJunto.gc=false; gcRequester=null;
  gcRenderCategories();
}
function gcBarHtml(title, sub){
  return `<div class="gc-bar"><div class="gc-title">${h(title)}${sub?`<small>${h(sub)}</small>`:''}</div><button class="gc-menu-btn" onclick="gcToggleMenu()">${ICN.menu}</button><div class="gc-menu-panel" id="gcMenuPanel"><button onclick="gcToggleTheme()">${document.documentElement.getAttribute('data-theme')==='dark'?'Modo claro':'Modo escuro'}</button><button onclick="gcLogout()">Sair</button></div></div>`;
}
function gcFooterHtml(backFn){
  const count = gcCart.reduce((a,i)=>a+i.qty,0);
  return `<div class="gc-footer"><button class="gc-btn-back" onclick="${backFn}">‹ Voltar</button><button class="gc-btn-review" ${count?'':'disabled'} onclick="gcRenderReview()">✓ Revisar${count?' ('+count+')':''}</button></div>`;
}
function gcRenderCategories(){
  const s = state.sales.find(x=>x.id===gcFlow.saleId); if(!s){ gcRenderHome(); return; }
  const info = comandaPersonData(s);
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const requesterOptions = member
    ? `<option value="">— Selecione —</option><option value="holder:${member.id}" ${memberBlockedByDebt(member)?'disabled':''}>Titular — ${h(member.name)}${memberBlockedByDebt(member)?' (bloqueado — deve '+fmt(member.debt)+')':''}</option>${(member.dependents||[]).map(d=>`<option value="dependent:${d.id}" ${d.canOrder===false||memberBlockedByDebt(member)?'disabled':''}>Dependente — ${h(d.name)}${d.canOrder===false?' (bloqueado)':memberBlockedByDebt(member)?' (bloqueado — cota com pendência)':''}</option>`).join('')}`
    : `<option value="guest">${h(s.customerName||'Cliente avulso')}</option>`;
  const cats = [...new Set(state.products.filter(p=>p.active!==false).map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const screen = document.getElementById('gcScreen');
  screen.innerHTML = gcBarHtml('Novo Pedido', info.person+(info.quota?' — Cota '+info.quota:'')) + `
    <div class="gc-body">
      ${member?`<div class="field" style="margin-bottom:14px"><label class="np-label">Quem está pedindo *</label><select id="gcRequesterSel" onchange="gcSetRequester(this.value)">${requesterOptions}</select></div>`:`<select id="gcRequesterSel" style="display:none">${requesterOptions}</select>`}
      <input id="gcProdSearch" placeholder="Buscar em todas categorias por nome" oninput="gcSearchAllProducts(this.value)">
      <div id="gcSearchProductResults"></div>
      <div class="gc-cat-grid" id="gcCatGrid" style="margin-top:14px">
        ${cats.map(c=>`<button class="gc-cat-tile" onclick="gcSelectCategory(${h(JSON.stringify(c))})">${h(c)}</button>`).join('')}
        <button class="gc-cat-all" onclick="gcSelectCategory('')">Todos os produtos</button>
      </div>
    </div>` + gcFooterHtml('gcBackFromCategories()');
  if(!member){ gcSetRequester('guest'); document.getElementById('gcRequesterSel').value='guest'; }
  else if(gcRequester) document.getElementById('gcRequesterSel').value = gcRequester.key||'';
}
async function gcBackFromCategories(){
  if(gcCart.length && !await askConfirm({title:'Sair sem enviar o pedido?',message:'Você tem itens ainda não confirmados neste pedido.',confirmLabel:'Sair sem enviar',cancelLabel:'Continuar pedido'})) return;
  gcRenderHome();
}
function gcSetRequester(value){
  const s = state.sales.find(x=>x.id===gcFlow.saleId); if(!s) return;
  const member = s.memberId?state.members.find(m=>m.id===s.memberId):null;
  if(!value){ gcRequester=null; return; }
  if(value==='guest'){ gcRequester={key:'guest',id:null,name:s.customerName||'Cliente avulso',type:'avulso',canOrder:true}; return; }
  if(value.startsWith('holder:')){ if(memberBlockedByDebt(member)){ toast('Titular com pendência de '+fmt(member.debt)+' — bloqueado até quitar.'); gcRequester=null; return; } gcRequester={key:value,id:member.id,name:member.name,type:'titular',canOrder:true}; return; }
  const depId=value.split(':')[1], dep=member&&(member.dependents||[]).find(d=>d.id===depId);
  if(dep && dep.canOrder===false){ toast('Este dependente está bloqueado para consumir nesta cota.'); gcRequester=null; return; }
  gcRequester={key:value,id:dep&&dep.id,name:dep&&dep.name||'Dependente',type:'dependente',canOrder:true};
}
function gcSearchAllProducts(q){
  const catGrid = document.getElementById('gcCatGrid');
  const results = document.getElementById('gcSearchProductResults');
  if(!q){ if(catGrid)catGrid.style.display='grid'; if(results)results.innerHTML=''; return; }
  if(catGrid) catGrid.style.display='none';
  const list = state.products.filter(p=>p.active!==false && p.name.toLowerCase().includes(q.toLowerCase()));
  results.innerHTML = `<div class="gc-prod-grid" style="margin-top:10px">${list.length?list.map(p=>{
    const inCart = gcCart.find(i=>i.productId===p.id);
    return `<button class="gc-prod-tile${inCart?' in-cart':''}" onclick="gcAddToCart(${jsArg(p.id)});gcSearchAllProducts(document.getElementById('gcProdSearch').value)"><span>${h(p.name)}</span>${inCart?`<span class="gc-qty-badge">x${inCart.qty}</span>`:''}<span class="gc-price-badge">${fmt(p.price)}</span></button>`;
  }).join(''):'<p class="gc-empty">Nada encontrado.</p>'}</div>`;
}
function gcSelectCategory(cat){
  if(!gcRequester){ toast('Selecione quem está pedindo antes.'); return; }
  gcFlow.category = cat; gcFlow.step='products';
  gcRenderProducts();
}
function gcRenderProducts(q){
  const s = state.sales.find(x=>x.id===gcFlow.saleId); if(!s){ gcRenderHome(); return; }
  const info = comandaPersonData(s);
  const cat = gcFlow.category;
  let list = state.products.filter(p=>p.active!==false);
  if(cat) list = list.filter(p=>p.category===cat);
  const query = String(q||'').toLowerCase();
  if(query) list = list.filter(p=>p.name.toLowerCase().includes(query));
  const screen = document.getElementById('gcScreen');
  screen.innerHTML = gcBarHtml('Novo Pedido', info.person+(info.quota?' — Cota '+info.quota:'')) + `
    <div class="gc-body">
      <input id="gcProdSearch2" placeholder="Buscar em todas categorias por nome" value="${h(q||'')}" oninput="gcRenderProducts(this.value)">
      ${cat?`<div class="gc-section-label">${h(cat)}</div>`:'<div class="gc-section-label">Todos os produtos</div>'}
      <div class="gc-prod-grid" id="gcProdGrid">
        ${list.length ? list.map(p=>{
          const av = productAvailable(p); const out = av!==Infinity && av<=0;
          const inCart = gcCart.find(i=>i.productId===p.id);
          return `<button class="gc-prod-tile${inCart?' in-cart':''}" ${out?'disabled style="opacity:.5"':''} onclick="gcAddToCart(${jsArg(p.id)})"><span>${h(p.name)}</span>${inCart?`<span class="gc-qty-badge">x${inCart.qty}</span>`:''}<span class="gc-price-badge">${fmt(p.price)}</span></button>`;
        }).join('') : '<p class="gc-empty">Nenhum produto encontrado.</p>'}
      </div>
    </div>` + gcFooterHtml("gcFlow.step='categories';gcRenderCategories()");
}
function gcAddToCart(productId){
  if(!gcRequester){ toast('Selecione quem está pedindo antes.'); gcRenderCategories(); return; }
  const p = state.products.find(x=>x.id===productId); if(!p) return;
  if(productAvailable(p)<=0){ toast('Sem estoque de insumos para este produto.'); return; }
  const existing = gcCart.find(i=>i.productId===productId);
  if(existing) existing.qty+=1; else gcCart.push({productId, name:p.name, price:p.price, qty:1, estacao:p.estacao||'cozinha', copos:productAsksCopos(p)?0:undefined});
  const searchEl = document.getElementById('gcProdSearch2');
  gcRenderProducts(searchEl?searchEl.value:'');
}
function gcRenderReview(){
  if(!gcRequester){ toast('Selecione quem está pedindo.'); gcRenderCategories(); return; }
  if(!gcCart.length){ toast('Adicione ao menos um produto.'); return; }
  const s = state.sales.find(x=>x.id===gcFlow.saleId); if(!s) return;
  const info = comandaPersonData(s);
  const screen = document.getElementById('gcScreen');
  screen.innerHTML = gcBarHtml('Confirmar Pedido', info.person) + `
    <div class="gc-body">
      <div class="np-section">
        <label class="np-label">Cliente</label>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div><b>${h(gcRequester.name)}</b>${s.memberId?'':''}${(state.members.find(m=>m.id===s.memberId)||{}).phone?` <span class="sub">(${h((state.members.find(m=>m.id===s.memberId)||{}).phone)})</span>`:''}</div>
        </div>
      </div>
      <div class="np-section">
        <label class="np-label">Observações</label>
        <input id="gcObs" placeholder="Ex: Sem cebola, ponto da carne..." value="${h(s.notes||'')}">
      </div>
      <div class="np-section">
        <div><label class="np-label">Local de entrega</label><select id="gcLocal"><option value="">— No balcão / retirar aqui —</option>${state.locais.map(l=>`<option value="${h(l.nome)}">${h(l.nome)}</option>`).join('')}</select></div>
      </div>
      <label class="np-label" style="margin:16px 0 8px;display:block">Itens para revisão</label>
      <div id="gcReviewList"></div>
      <button type="button" class="gc-discard-link" onclick="gcDiscardOrder()">Descartar pedido</button>
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;margin-top:10px"><span>Total</span><span class="mono" id="gcReviewTotal">R$ 0,00</span></div>
    </div>
    <div class="gc-footer"><button class="gc-btn-back" onclick="gcRenderProducts()">‹ Voltar</button><button class="gc-btn-review" onclick="gcConfirmOrder()">✓ Enviar pedido</button></div>`;
  gcRenderReviewList();
}
async function gcDiscardOrder(){
  if(!await askConfirm({title:'Descartar este pedido?',message:'Os itens ainda não foram enviados para a cozinha.',confirmLabel:'Descartar pedido'})) return;
  gcCart=[]; levarJunto.gc=false; gcRenderProducts();
}
function gcRenderReviewList(){
  const el = document.getElementById('gcReviewList'); if(!el) return;
  el.innerHTML = gcCart.length ? gcCart.map((i,idx)=>`
    <div class="gc-review-item"><span>${h(i.name)}</span>
    <div class="gc-qty"><button onclick="gcCartQty(${idx},-1)">−</button><span class="mono">${i.qty}</span><button onclick="gcCartQty(${idx},1)">+</button>
    <span class="mono" style="min-width:60px;text-align:right">${fmt(i.price*i.qty)}</span></div>
    ${i.copos!=null?`<div class="gc-qty gc-copos-row"><span class="gc-copos-label">Quantidade de copos:</span><button onclick="gcCartChangeCopos(${idx},-1)">−</button><span class="mono">${i.copos||0}</span><button onclick="gcCartChangeCopos(${idx},1)">+</button></div>`:''}</div>`).join('') + levarJuntoBox(gcCart,'gc') : '<p class="gc-empty">Nenhum item.</p>';
  const totEl = document.getElementById('gcReviewTotal'); if(totEl) totEl.textContent = fmt(gcCart.reduce((a,i)=>a+i.price*i.qty,0));
}
function gcCartQty(idx,delta){
  const it = gcCart[idx]; if(!it) return;
  it.qty+=delta; if(it.qty<=0) gcCart.splice(idx,1);
  if(!gcCart.length){ gcRenderProducts(); return; }
  gcRenderReviewList();
}
function gcCartChangeCopos(idx,delta){
  const it = gcCart[idx]; if(!it) return;
  it.copos = Math.max(0, (it.copos||0)+delta);
  gcRenderReviewList();
}
async function gcConfirmOrder(){
  const s = state.sales.find(x=>x.id===gcFlow.saleId); if(!s) return;
  if(!comandaAcceptsOrders(s)) return;
  if(!gcCart.length){ toast('Adicione ao menos um produto.'); return; }
  const local = document.getElementById('gcLocal')?.value || '';
  s.notes = (document.getElementById('gcObs')?.value||'').trim();
  const origem = currentUser.origem||'app';
  const who = gcRequester.name;
  const items = gcCart.map(i=>({...i, lineId:uid(), sent:false, addedAt:new Date().toISOString(), addedBy:currentUser.name, local:local||s.local||'', requesterId:gcRequester.id, requesterName:who, requesterType:gcRequester.type}));
  applyLevarJunto(items, levarJunto.gc);
  if(!await sendItemsToKitchen(s.id, items, who, 'comanda', local)) return;
  items.forEach(i=>i.sent=true);
  await commitSaleChange(s.id, cur=>{ cur.notes=s.notes; cur.items=[...(cur.items||[]), ...items]; cur.total=saleTotal(cur.items); });
  const groups = {};
  items.forEach(i=>{ const key=i.estacao||'cozinha'; (groups[key]=groups[key]||[]).push(i); });
  const printJobs = Object.keys(groups).map(estacao=>{
    const printer = resolvePrinterFor(estacao, origem);
    return { estacao, items:groups[estacao], printer: printer?printer.nome:null };
  });
  logAction('Pedido registrado para '+who+(local?' — local: '+local:'')+' — origem: '+origemLabel(origem));
  const gcMember = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  printNovoPedidoTickets(who, gcMember?gcMember.code:'', local, printJobs, s.orderNumber);
  toast('Pedido confirmado e enviado!');
  gcRenderHome();
}
async function gcSelectMember(memberId){
  const m = state.members.find(x=>x.id===memberId); if(!m) return;
  const existing = state.sales.find(s=>s.status==='open' && s.memberId===memberId);
  if(existing){ gcOpenFlow(existing.id); return; }
  if(!await ensureMemberCanOpen(m, ()=>gcSelectMember(memberId))) return;
  const s = { id:uid(), type:'comanda', tableNumber:null, orderNumber:await nextOrderNumber(), memberId:m.id, dependentId:null, dependentName:'', customerName:m.name, items:[], total:0, status:'open', payments:[], openedAt:new Date().toISOString(), operatorName:currentUser.name };
  state.sales.push(s); save('sales');
  gcOpenFlow(s.id);
}


