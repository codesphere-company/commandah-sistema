/* ============ MODO GARÇOM (mobile) ============ */
let gcFlow = { saleId:null, step:'home', category:null };
let gcCart = [];
let gcRequester = null;
// Rascunho da venda avulsa em cobrança: reaproveitado entre tentativas para o finalizeSale não
// duplicar a venda nem mandar a ficha de novo para a cozinha.
let gcChargeDraft = null;

function gcRenderHome(){
  gcFlow = { saleId:null, step:'home', category:null }; gcCart=[]; levarJunto.gc=false; gcRequester=null; gcChargeDraft=null;
  const screen = document.getElementById('gcScreen'); if(!screen) return;
  const open = state.sales.filter(s=>s.status==='open');
  const isBar = (state.settings.operationMode||'clube')==='bar';
  screen.innerHTML = `
    <div class="gc-bar"><div class="gc-title">Comandas</div><button class="gc-menu-btn" onclick="gcToggleMenu()">${ICN.menu}</button><div class="gc-menu-panel" id="gcMenuPanel"><button onclick="gcToggleTheme()">${document.documentElement.getAttribute('data-theme')==='dark'?'Modo claro':'Modo escuro'}</button><button onclick="gcLogout()">Sair</button></div></div>
    <div class="gc-body">
      ${isBar ? `<input id="gcSearch" placeholder="Número da mesa ou nome do cliente..." oninput="gcRenderHomeSearch(this.value)" autocomplete="off">
      <button class="btn btn-primary btn-block" style="margin-top:10px" onclick="gcOpenBarComanda()">+ Abrir nova comanda</button>`
      : `<input id="gcSearch" placeholder="Nome ou cota do sócio, ou nome/mesa do cliente avulso" oninput="gcRenderHomeSearch(this.value)" autocomplete="off">
      <button class="btn btn-block" style="margin-top:10px" onclick="gcOpenAvulso()">+ Cliente avulso (não sócio) — paga na hora</button>`}
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
    return `<button class="gc-tile ${s.locked?'gc-amber':'gc-green'}" onclick="gcOpenComanda(${jsArg(s.id)})">${s.locked?'<span class="gc-lock">🔒</span>':''}<div>${h(label)}</div><div class="gc-tile-cap">${h((info.person||'').split(' ')[0])}</div></button>`;
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
  }).join('') : `<p class="gc-empty">Nenhum associado encontrado.</p><button class="btn btn-primary btn-block" onclick="gcOpenAvulso()">Atender "${h(String(q).trim())}" como avulso (paga na hora)</button>`;
}
// Cliente avulso no modo clube (pedido do dono, 17/10): não abre comanda. O garçom lança e
// cobra na hora (gcRenderCharge); a venda fecha como balcão e a ficha sai na cozinha.
function gcOpenAvulso(){
  const name = (document.getElementById('gcSearch')?.value||'').trim();
  if(!name){ toast('Digite o nome do cliente ou a mesa na busca acima.'); document.getElementById('gcSearch')?.focus(); return; }
  gcFlow = { saleId:null, step:'categories', category:null, avulso:name }; gcCart=[]; levarJunto.gc=false; gcRequester=null; gcChargeDraft=null;
  gcRenderCategories();
}
// Comanda do fluxo atual; no avulso é uma venda ainda não gravada.
function gcSale(){
  if(gcFlow.avulso) return { id:null, memberId:null, customerName:gcFlow.avulso, notes:gcFlow.obs||'', items:[] };
  return state.sales.find(x=>x.id===gcFlow.saleId);
}
function gcCartTotal(){ return Math.round(gcCart.reduce((a,i)=>a+i.price*i.qty,0)*100)/100; }
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
  if(s.locked){ toast('Comanda bloqueada no caixa: não aceita pedido.'); return; }
  gcFlow = { saleId, step:'categories', category:null }; gcCart=[]; levarJunto.gc=false; gcRequester=null;
  gcRenderCategories();
}
/* ===== Comanda aberta no app do garçom (pedido do dono, 18/10) =====
   Tocar na comanda mostra o que já foi lançado; dali o garçom faz novo pedido ou fecha a
   conta e cobra (gcGoCloseComanda), como o caixa faz no computador. Antes o toque ia direto
   para o novo pedido e não havia como ver nem fechar a comanda pelo celular. */
function gcOpenComanda(saleId){
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  gcFlow = { saleId, step:'comanda', category:null }; gcCart=[]; levarJunto.gc=false; gcRequester=null; gcChargeDraft=null;
  gcRenderComanda();
  // A cópia local pode estar alguns segundos velha: busca a mais nova e redesenha.
  fetchFreshSales().then(fresh=>{ if(fresh) state.sales = fresh; if(gcFlow.step==='comanda' && gcFlow.saleId===saleId) gcRenderComanda(); });
}
// Mesma conta do pagamento do computador (openPaymentModal): crédito do sócio abatido sozinho
// (decisão do dono, 18/10), serviço sobre o que sobra depois do crédito, parcial sai do total.
function gcComandaTotals(s){
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const subtotal = Math.round(saleTotal(s.items)*100)/100;
  const partialPaid = comandaPartialPaid(s);
  const available = memberAvailableCredit(member);
  const creditApplied = available>0.009 ? Math.round(Math.min(available, Math.max(0, subtotal-partialPaid))*100)/100 : 0;
  const afterCredit = Math.max(0, subtotal-creditApplied);
  const service = serviceRatePct()>0 ? Math.round(serviceChargeAmount(afterCredit)*100)/100 : 0;
  // Pendência anterior (fiado de sócio liberado pelo administrador) vem junto: memberDebtDue.
  const debt = memberDebtDue(member);
  const total = Math.round((Math.max(0, afterCredit+service-partialPaid)+debt)*100)/100;
  return { member, subtotal, partialPaid, available, creditApplied, service, debt, total };
}
function gcSummaryHtml(t){
  return `<div class="gc-summary">
    <div><span>Consumo</span><span class="mono">${fmt(t.subtotal)}</span></div>
    ${t.creditApplied>0.009?`<div><span>Crédito do sócio${t.available-t.creditApplied>0.009?' (sobra '+fmt(t.available-t.creditApplied)+')':''}</span><span class="mono">− ${fmt(t.creditApplied)}</span></div>`:''}
    ${serviceRatePct()>0?`<div><span>(+) Serviço (${serviceRatePct()}%)</span><span class="mono">${fmt(t.service)}</span></div>`:''}
    ${t.partialPaid>0.009?`<div><span>Já pago (parcial)</span><span class="mono">− ${fmt(t.partialPaid)}</span></div>`:''}
    ${t.debt>0.009?`<div><span>(+) Pendência anterior (fiado)</span><span class="mono">${fmt(t.debt)}</span></div>`:''}
    <div class="gc-summary-total"><span>Total</span><span class="mono">${fmt(t.total)}</span></div>
  </div>`;
}
function gcRenderComanda(){
  const s = state.sales.find(x=>x.id===gcFlow.saleId);
  if(!s || s.status!=='open' || s.canceled){ toast('Esta comanda já foi fechada ou cancelada.'); gcRenderHome(); return; }
  const info = comandaPersonData(s);
  const items = (s.items||[]).slice().sort((a,b)=>String(a.addedAt||'').localeCompare(String(b.addedAt||'')));
  const count = items.filter(i=>!i.canceled).reduce((a,i)=>a+(Number(i.qty)||0),0);
  const hora = iso=>iso ? new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
  const screen = document.getElementById('gcScreen');
  screen.innerHTML = gcBarHtml('Comanda'+(s.orderNumber?' #'+s.orderNumber:''), info.label) + `
    <div class="gc-body">
      ${s.locked?'<div class="sale-pending-warning" role="alert">Comanda bloqueada no caixa: não aceita pedido nem fechamento pelo app.</div>':''}
      <button class="btn btn-primary btn-block" onclick="gcOpenFlow(${jsArg(s.id)})" ${s.locked?'disabled':''}>+ Novo pedido</button>
      <div class="gc-section-label">Já lançado (${count} ${count===1?'item':'itens'})</div>
      ${items.length ? items.map(i=>`<div class="gc-review-item gc-launched${i.canceled?' canceled':''}"><span><b>${Number(i.qty)||0}x</b> ${h(i.name)}<small>${h(i.requesterName||'')}${i.requesterName&&i.addedAt?' · ':''}${hora(i.addedAt)}${i.canceled?' · cancelado':''}</small></span><span class="mono">${fmt((Number(i.price)||0)*(Number(i.qty)||0))}</span></div>`).join('') : '<p class="gc-empty">Nada lançado ainda.</p>'}
      ${gcSummaryHtml(gcComandaTotals(s))}
    </div>
    <div class="gc-footer"><button class="gc-btn-back" onclick="gcRenderHome()">‹ Voltar</button><button class="gc-btn-review" onclick="gcGoCloseComanda()" ${s.locked?'disabled':''}>Fechar conta ›</button></div>`;
}
async function gcGoCloseComanda(){
  const saleId = gcFlow.saleId;
  const fresh = await fetchFreshSales(); if(fresh) state.sales = fresh;
  const s = state.sales.find(x=>x.id===saleId);
  if(!s || s.status!=='open' || s.canceled){ toast('Esta comanda já foi fechada ou cancelada em outro aparelho.'); gcRenderHome(); return; }
  if(s.locked){ toast('Comanda bloqueada no caixa. Peça para desbloquearem antes de fechar.'); gcRenderComanda(); return; }
  if(s.memberId){ try{ await MembersStore.refreshOne(s.memberId); }catch(e){} } // saldo (crédito ou pendência) mais novo
  gcFlow = { saleId, step:'charge', category:null, closeComanda:true, payMethod:null };
  gcRenderCharge();
}
function gcChargeTotal(){
  if(!gcFlow.closeComanda) return gcCartTotal();
  const s = state.sales.find(x=>x.id===gcFlow.saleId);
  return s ? gcComandaTotals(s).total : 0;
}
function gcBarHtml(title, sub){
  return `<div class="gc-bar"><div class="gc-title">${h(title)}${sub?`<small>${h(sub)}</small>`:''}</div><button class="gc-menu-btn" onclick="gcToggleMenu()">${ICN.menu}</button><div class="gc-menu-panel" id="gcMenuPanel"><button onclick="gcToggleTheme()">${document.documentElement.getAttribute('data-theme')==='dark'?'Modo claro':'Modo escuro'}</button><button onclick="gcLogout()">Sair</button></div></div>`;
}
function gcFooterHtml(backFn){
  const count = gcCart.reduce((a,i)=>a+i.qty,0);
  return `<div class="gc-footer"><button class="gc-btn-back" onclick="${backFn}">‹ Voltar</button><button class="gc-btn-review" ${count?'':'disabled'} onclick="gcRenderReview()">✓ Revisar${count?' ('+count+')':''}</button></div>`;
}
function gcRenderCategories(){
  const s = gcSale(); if(!s){ gcRenderHome(); return; }
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
  if(gcFlow.saleId) gcOpenComanda(gcFlow.saleId); else gcRenderHome();
}
function gcSetRequester(value){
  const s = gcSale(); if(!s) return;
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
  const s = gcSale(); if(!s){ gcRenderHome(); return; }
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
  const s = gcSale(); if(!s) return;
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
    <div class="gc-footer"><button class="gc-btn-back" onclick="gcRenderProducts()">‹ Voltar</button>${gcFlow.avulso
      ? `<button class="gc-btn-review" onclick="gcGoCharge()">Cobrar <span class="mono" id="gcChargeBtnTotal"></span> ›</button>`
      : `<button class="gc-btn-review" onclick="gcConfirmOrder()">✓ Enviar pedido</button>`}</div>`;
  if(gcFlow.avulso && gcFlow.local) document.getElementById('gcLocal').value = gcFlow.local;
  gcRenderReviewList();
}
/* ===== Cobrança do avulso no app do garçom (pedido do dono, 17/10) =====
   O garçom recebe na hora (dinheiro, Pix, crédito ou débito; cartão na maquininha, sem
   integração ainda) e a venda fecha pelo mesmo finalizeSale do balcão: ficha na cozinha,
   close_sale idempotente e pagamento no caixa aberto. */
const GC_PAY_METHODS = ['dinheiro','pix','credito','debito'];
function gcGoCharge(){
  if(!gcCart.length){ toast('Adicione ao menos um produto.'); return; }
  gcFlow.obs = (document.getElementById('gcObs')?.value||'').trim();
  gcFlow.local = document.getElementById('gcLocal')?.value || '';
  gcFlow.step = 'charge';
  gcRenderCharge();
}
function gcRenderCharge(){
  const total = gcChargeTotal();
  const methods = methodConfig().filter(m=>GC_PAY_METHODS.includes(m.method));
  const s = gcFlow.closeComanda ? state.sales.find(x=>x.id===gcFlow.saleId) : null;
  const t = s ? gcComandaTotals(s) : null;
  gcFlow.shownTotal = total;
  const screen = document.getElementById('gcScreen');
  screen.innerHTML = gcBarHtml(s?'Fechar conta':'Cobrar', s?comandaPersonData(s).label:gcFlow.avulso) + `
    <div class="gc-body">
      ${t ? gcSummaryHtml(t) : ''}
      <div class="gc-charge-total" ${t?'style="margin-top:14px"':''}><span>Total a cobrar</span><b class="mono">${fmt(total)}</b></div>
      ${total<=0.009 ? '<p class="sub" style="margin-top:12px">Nada a cobrar: confirme para fechar a comanda.</p>' : `
      <label class="np-label" style="display:block;margin:16px 0 8px">Forma de pagamento</label>
      <div class="gc-pay-grid">${methods.map(m=>`<button type="button" class="gc-pay-btn${gcFlow.payMethod===m.method?' active':''}" data-method="${h(m.method)}" onclick="gcSelectPay(${jsArg(m.method)})"><span class="gc-pay-icon">${m.icon}</span><span>${h(m.label)}</span></button>`).join('')}</div>
      <div id="gcCashBox" class="np-section" ${gcFlow.payMethod==='dinheiro'?'':'hidden'}>
        <label class="np-label">Valor recebido (vazio = valor exato)</label>
        <input id="gcCashReceived" type="number" inputmode="decimal" min="0" step="0.01" placeholder="${total.toFixed(2)}" oninput="gcUpdateChange()">
        <div class="gc-change" id="gcChange"></div>
      </div>
      <p class="sub" id="gcCardHint" ${['credito','debito'].includes(gcFlow.payMethod)?'':'hidden'}>Passe o cartão na maquininha e confirme aqui depois de aprovado.</p>
`}
      <div id="gcChargePending" class="sale-pending-warning" role="alert" hidden>O pedido já foi para a cozinha, mas o pagamento ainda não foi registrado. Toque em "Confirmar pagamento" de novo.</div>
    </div>
    <div class="gc-footer"><button class="gc-btn-back" onclick="gcBackFromCharge()">‹ Voltar</button><button class="gc-btn-review" id="gcConfirmPayBtn" onclick="gcConfirmCharge()">✓ Confirmar pagamento</button></div>`;
  if(gcChargeDraft && gcChargeDraft.items.some(i=>i.sent)) document.getElementById('gcChargePending').hidden = false;
}
function gcSelectPay(method){
  gcFlow.payMethod = method;
  document.querySelectorAll('.gc-pay-btn').forEach(b=>b.classList.toggle('active', b.dataset.method===method));
  document.getElementById('gcCashBox').hidden = method!=='dinheiro';
  document.getElementById('gcCardHint').hidden = !['credito','debito'].includes(method);  if(method==='dinheiro') setTimeout(()=>document.getElementById('gcCashReceived')?.focus(), 0);
  gcUpdateChange();
}
function gcUpdateChange(){
  const el = document.getElementById('gcChange'); if(!el) return;
  const raw = document.getElementById('gcCashReceived')?.value||'';
  if(raw===''){ el.textContent=''; return; }
  const diff = Math.round(((parseFloat(raw)||0)-gcChargeTotal())*100)/100;
  el.textContent = diff>=0 ? 'Troco: '+fmt(diff) : 'Faltam '+fmt(-diff);
  el.classList.toggle('falta', diff<0);
}
function gcBackFromCharge(){
  if(gcFlow.closeComanda){ gcOpenComanda(gcFlow.saleId); return; }
  // Ficha já na cozinha e venda não registrada: só sai daqui confirmando o pagamento.
  if(gcChargeDraft && gcChargeDraft.items.some(i=>i.sent)){ toast('O pedido já foi para a cozinha. Confirme o pagamento.'); return; }
  gcChargeDraft = null; gcFlow.step = 'review';
  gcRenderReview();
}
async function gcConfirmCharge(){
  if(gcFlow.closeComanda) return gcConfirmCloseComanda();
  const method = gcFlow.payMethod;
  if(!GC_PAY_METHODS.includes(method)){ toast('Escolha a forma de pagamento.'); return; }
  const total = gcCartTotal();
  if(!(total>0)){ toast('Adicione ao menos um produto.'); return; }
  const pay = gcBuildPayment(method, total); if(!pay) return;
  await refreshCashState();
  if(!state.cashSession || state.cashSession.status!=='open'){ toast('O caixa está fechado. Peça para abrirem o caixa antes de cobrar.'); return; }
  if(!gcChargeDraft){
    const local = gcFlow.local||'';
    const items = gcCart.map(i=>({...i, lineId:uid(), sent:false, addedAt:new Date().toISOString(), addedBy:currentUser.name, local, requesterId:null, requesterName:gcFlow.avulso, requesterType:'avulso'}));
    applyLevarJunto(items, levarJunto.gc);
    gcChargeDraft = { items, memberId:null, customerName:gcFlow.avulso, notes:gcFlow.obs||'', type:'balcao' };
  }
  currentSaleDraft = gcChargeDraft;
  const saleId = await finalizeSale('balcao', null, null, [pay], total, 0, 0, { subtotal: total, discount: 0, couponCode: null, creditApplied: 0, serviceCharge: 0, partialPaid: 0, local: gcFlow.local||'' });
  if(!saleId){
    const warn = document.getElementById('gcChargePending');
    if(warn && gcChargeDraft.items.some(i=>i.sent)) warn.hidden = false;
    return;
  }
  logAction('Garçom cobrou cliente avulso '+gcFlow.avulso+' — '+methodLabel(method)+' '+fmt(total)+(pay.change?' (troco '+fmt(pay.change)+')':''));
  gcChargeDraft = null;
  autoEmitNfce(saleId); // não espera: a venda já está registrada
  toast(pay.change ? 'Pago e enviado. Troco: '+fmt(pay.change) : 'Pago e enviado!');
  gcRenderHome();
}
// Pagamento único do valor cheio; no dinheiro guarda recebido e troco (vazio = valor exato).
function gcBuildPayment(method, total){
  const pay = { method, amount: total };
  if(method==='dinheiro'){
    const raw = document.getElementById('gcCashReceived')?.value||'';
    const received = raw==='' ? total : Math.round((parseFloat(raw)||0)*100)/100;
    if(received+0.009 < total){ toast('O valor recebido é menor que o total.'); return null; }
    const change = Math.round((received-total)*100)/100;
    if(change>0.009){ pay.received = received; pay.change = change; }
  }
  return pay;
}
// Fechamento da comanda pelo garçom: o mesmo finalizeSale do caixa (close_sale idempotente,
// recusa se chegou item novo por outro aparelho, lança o crédito usado no sócio). Sem fiado:
// o garçom só cobra (decisão do dono, 18/10); fiado fica com o caixa.
async function gcConfirmCloseComanda(){
  const saleId = gcFlow.saleId;
  await refreshCashState();
  if(!state.cashSession || state.cashSession.status!=='open'){ toast('O caixa está fechado. Peça para abrirem o caixa antes de cobrar.'); return; }
  const fresh = await fetchFreshSales(); if(fresh) state.sales = fresh;
  const s = state.sales.find(x=>x.id===saleId);
  if(!s || s.status!=='open' || s.canceled){ toast('Esta comanda já foi fechada ou cancelada em outro aparelho.'); gcRenderHome(); return; }
  if(s.locked){ toast('Comanda bloqueada no caixa. Peça para desbloquearem antes de fechar.'); return; }
  if(s.memberId){ try{ await MembersStore.refreshOne(s.memberId); }catch(e){} }
  const t = gcComandaTotals(s);
  // Total diferente do que o garçom mostrou ao cliente (item lançado em outro aparelho, saldo do sócio
  // mudou): confere antes.
  if(Math.abs(t.total-(gcFlow.shownTotal||0))>0.009){ gcRenderCharge(); toast('O total mudou (chegou item novo nesta comanda). Confira antes de cobrar.'); return; }
  const method = gcFlow.payMethod;
  let payments = [];
  if(t.total>0.009){
    if(!GC_PAY_METHODS.includes(method)){ toast('Escolha a forma de pagamento.'); return; }
    const pay = gcBuildPayment(method, t.total); if(!pay) return;
    payments = [pay];
  }
  currentSaleDraft = { id:s.id, items:JSON.parse(JSON.stringify(s.items||[])), memberId:s.memberId, customerName:s.customerName, notes:s.notes||'', type:'comanda' };
  const { salePayments, debtParts } = splitDebtFromPayments(payments, t.debt);
  const meta = { subtotal: t.subtotal, discount: 0, couponCode: null, creditApplied: t.creditApplied, serviceCharge: t.service, partialPaid: t.partialPaid };
  if(t.debt>0.009) meta.debtPaid = t.debt;
  const closedId = await finalizeSale('comanda', s.id, s.memberId||null, salePayments, Math.round((t.total-t.debt)*100)/100, t.creditApplied, 0, meta);
  if(closedId && debtParts.length) await recordDebtPaidWithSale(t.member, debtParts, closedId);
  if(!closedId){
    const cur = state.sales.find(x=>x.id===saleId);
    if(!cur || cur.status!=='open' || cur.canceled) gcRenderHome(); else gcRenderCharge();
    return;
  }
  const change = payments[0] && payments[0].change;
  logAction('Garçom fechou a comanda de '+comandaPersonData(s).label+' — '+(payments.length?methodLabel(method)+' '+fmt(t.total):'nada a cobrar')+(change?' (troco '+fmt(change)+')':''));
  autoEmitNfce(closedId); // não espera: a venda já está registrada
  toast(change ? 'Comanda fechada. Troco: '+fmt(change) : 'Comanda fechada!');
  gcRenderHome();
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
  const chEl = document.getElementById('gcChargeBtnTotal'); if(chEl) chEl.textContent = fmt(gcCartTotal());
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
  if(existing){ gcOpenComanda(existing.id); return; }
  if(!await ensureMemberCanOpen(m, ()=>gcSelectMember(memberId))) return;
  const s = { id:uid(), type:'comanda', tableNumber:null, orderNumber:await nextOrderNumber(), memberId:m.id, dependentId:null, dependentName:'', customerName:m.name, items:[], total:0, status:'open', payments:[], openedAt:new Date().toISOString(), operatorName:currentUser.name };
  state.sales.push(s); save('sales');
  gcOpenFlow(s.id);
}


