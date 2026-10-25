/* ============ COZINHA (KDS) ============ */
function requiredInsumosForItems(items){
  const required = {};
  items.forEach(it=>{
    const p=state.products.find(x=>x.id===it.productId);
    effectiveProductRecipe(p).forEach(r=>required[r.insumoId]=(required[r.insumoId]||0)+(Number(r.qty)||0)*(Number(it.qty)||0));
    ((it.customization&&it.customization.complementIds)||[]).forEach(id=>{
      const complement=state.complementos.find(x=>x.id===id);
      (complement&&complement.recipe||[]).forEach(r=>required[r.insumoId]=(required[r.insumoId]||0)+(Number(r.qty)||0)*(Number(it.qty)||0));
    });
  });
  return required;
}
function canFulfillItems(items){
  return Object.entries(requiredInsumosForItems(items)).every(([id,qty])=>{
    const ins=state.insumos.find(x=>x.id===id);
    return ins && Number(ins.stock)>=qty-1e-9;
  });
}
async function consumeInsumosForItems(items){
  const required = requiredInsumosForItems(items);
  if(!Object.keys(required).length) return true;
  if(isCloudMode()){
    // Baixa atomica no servidor (RPC consume_insumos): trava a linha de cantina2:insumos,
    // confere se da pra atender TUDO antes de descontar (tudo ou nada), e devolve os
    // numeros de antes/depois reais pra montar o log de auditoria sem recalcular no cliente.
    const { data, error } = await supabaseClient.rpc('consume_insumos', { p_consumptions: required });
    if(error) return false;
    (data||[]).forEach(m=>{
      const ins = state.insumos.find(x=>x.id===m.insumoId);
      if(ins){ ins.stock = m.after; markInsumoServerStock(ins.id, m.after); }
      state.stockMovements.unshift({id:uid(),insumoId:m.insumoId,name:ins?ins.name:'',unit:ins?ins.unit:'',type:'saida',operation:'Baixa por venda',before:m.before,qty:m.qty,after:m.after,user:currentUser?currentUser.name:'—',at:new Date().toISOString()});
    });
    save('stockMovements');
    return true;
  }
  if(!canFulfillItems(items)) return false;
  items.forEach(it=>{
    const p = state.products.find(x=>x.id===it.productId);
    effectiveProductRecipe(p).forEach(r=>{
      const ins = state.insumos.find(x=>x.id===r.insumoId);
      if(ins){const qty=r.qty*it.qty;const before=Number(ins.stock)||0;ins.stock-=qty;state.stockMovements.unshift({id:uid(),insumoId:ins.id,name:ins.name,unit:ins.unit,type:'saida',operation:productKind(p)==='combo'?'Baixa por ficha do combo: '+p.name:'Baixa por ficha técnica',before,qty,after:ins.stock,user:currentUser?currentUser.name:'—',at:new Date().toISOString()});}
    });
    ((it.customization&&it.customization.complementIds)||[]).forEach(id=>{
      const complement=state.complementos.find(x=>x.id===id);
      (complement&&complement.recipe||[]).forEach(r=>{
        const ins=state.insumos.find(x=>x.id===r.insumoId);
        if(ins){const qty=(Number(r.qty)||0)*(Number(it.qty)||0),before=Number(ins.stock)||0;ins.stock-=qty;state.stockMovements.unshift({id:uid(),insumoId:ins.id,name:ins.name,unit:ins.unit,type:'saida',operation:'Baixa por complemento: '+complement.nome,before,qty,after:ins.stock,user:currentUser?currentUser.name:'—',at:new Date().toISOString()});}
      });
    });
  });
  save('insumos');save('stockMovements');
  return true;
}
/* Estorno de estoque pro cancelamento de item já enviado (changeDraftQty barra edição
   de item enviado; este é o caminho de correção quando o lançamento foi errado). Espelha
   consumeInsumosForItems, mas soma em vez de descontar — não há checagem de "estoque
   insuficiente" porque devolver insumo nunca fica negativo. */
async function restoreInsumosForItems(items){
  const required = requiredInsumosForItems(items);
  if(!Object.keys(required).length) return true;
  if(isCloudMode()){
    const { data, error } = await supabaseClient.rpc('restore_insumos', { p_consumptions: required });
    if(error) return false;
    (data||[]).forEach(m=>{
      const ins = state.insumos.find(x=>x.id===m.insumoId);
      if(ins){ ins.stock = m.after; markInsumoServerStock(ins.id, m.after); }
      state.stockMovements.unshift({id:uid(),insumoId:m.insumoId,name:ins?ins.name:'',unit:ins?ins.unit:'',type:'entrada',operation:'Estorno por cancelamento de item',before:m.before,qty:m.qty,after:m.after,user:currentUser?currentUser.name:'—',at:new Date().toISOString()});
    });
    save('stockMovements');
    return true;
  }
  Object.entries(required).forEach(([insumoId,qty])=>{
    const ins = state.insumos.find(x=>x.id===insumoId);
    if(ins){const before=Number(ins.stock)||0;ins.stock=before+qty;state.stockMovements.unshift({id:uid(),insumoId:ins.id,name:ins.name,unit:ins.unit,type:'entrada',operation:'Estorno por cancelamento de item',before,qty,after:ins.stock,user:currentUser?currentUser.name:'—',at:new Date().toISOString()});}
  });
  save('insumos');save('stockMovements');
  return true;
}
function saleTotal(items){ return (items||[]).filter(i=>!i.canceled).reduce((a,i)=>a+i.price*i.qty,0); }
// OP-10: pedido novo só entra em comanda aberta. Se o caixa fechou ou cancelou a
// comanda enquanto o garçom montava o pedido, nada vai para a cozinha nem baixa
// estoque numa conta que ninguém mais vai cobrar.
/* OP-01 (auditoria 07/10): cada aparelho gravava a lista inteira de vendas a partir
   da cópia que tinha na memória (até 6 s velha). O caixa fechando ou cancelando um
   item gravava por cima do que o garçom tinha acabado de lançar: o item saía na
   cozinha e sumia da conta. Agora as gravações de comanda buscam a lista mais nova
   no servidor e JUNTAM os itens pela identidade (lineId; itens antigos, por produto +
   horário + nome + quem lançou). A solução definitiva é vendas em tabela (EST-01). */
function comandaItemKey(i){ return i.lineId || [i.productId||'', i.addedAt||'', i.name||'', i.addedBy||''].join('|'); }
async function fetchFreshSales(){
  try{ await (saveQueues.sales||Promise.resolve()); }catch(e){}
  if(isCloudMode()){
    try{ mergeSalesChanges(await SalesStore.changes()); return state.sales; }
    catch(e){ return null; }
  }
  try{ const r = await storageApi.get(STORE.sales); return r ? JSON.parse(r.value) : []; }
  catch(e){ return null; }
}
// Aplica a mudança na versão mais nova da venda e grava. Se mutate devolver false, não grava.
// Sem rede, cai no estado local (comportamento antigo) e o aviso de falha de gravação aparece.
async function commitSaleChange(saleId, mutate){
  const fresh = await fetchFreshSales();
  if(fresh) state.sales = fresh;
  const cur = state.sales.find(x=>x.id===saleId);
  if(!cur) return null;
  if(mutate(cur)===false) return cur;
  await save('sales');
  return cur;
}
// O rascunho deste aparelho vale para os itens que ele conhece; os que chegaram de outro
// aparelho (extras) entram no fim.
function mergeDraftItems(serverItems, draftItems){
  const keys = new Set((draftItems||[]).map(comandaItemKey));
  const extras = (serverItems||[]).filter(i=>!keys.has(comandaItemKey(i)));
  return { items:[...(draftItems||[]), ...extras], extras };
}
/* OP-13 (decisão do dono: fazer): pagamento parcial de comanda. Quem paga a sua parte e vai
   embora fica registrado na comanda aberta; o fechamento cobra só o que falta. */
function comandaPartialPaid(s){ return Math.round(((s&&s.partialPayments)||[]).filter(p=>!p.reversed).reduce((t,p)=>t+(Number(p.amount)||0),0)*100)/100; }
function openPartialPayment(saleId){
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(!state.cashSession){ toast('Abra o caixa para receber pagamento.'); return; }
  const items = (currentSaleDraft && currentSaleDraft.id===saleId) ? currentSaleDraft.items : s.items;
  const due = Math.max(0, Math.round((saleTotal(items) - comandaPartialPaid(s))*100)/100);
  if(due<=0.009){ toast('Não há saldo a receber nesta comanda.'); return; }
  const methods = methodConfig().filter(m=>m.method!=='fiado');
  openModal('Receber pagamento parcial', `<p class="sub">Para quando alguém paga a sua parte e a comanda continua aberta. Em aberto agora: <b class="mono">${fmt(due)}</b>.</p>
    <div class="field"><label>Valor recebido</label><input id="ppAmount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00"></div>
    <div class="field"><label>Forma de pagamento</label><select id="ppMethod">${methods.map(m=>`<option value="${h(m.method)}">${h(m.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Quem pagou (opcional)</label><input id="ppWho" placeholder="Ex.: João, amigo do titular"></div>
    <div class="row"><button class="btn" onclick="openComanda(${jsArg(saleId)},true)">Voltar</button><button class="btn btn-primary" id="ppSave">Registrar pagamento parcial</button></div>`);
  document.getElementById('ppSave').onclick = ()=>savePartialPayment(saleId);
  setTimeout(()=>document.getElementById('ppAmount')?.focus(),50);
}
async function savePartialPayment(saleId){
  const amount = Math.round(parseFloat(document.getElementById('ppAmount').value)*100)/100;
  const method = document.getElementById('ppMethod').value, who = document.getElementById('ppWho').value.trim();
  if(!Number.isFinite(amount)||amount<=0){ toast('Informe o valor recebido.'); return; }
  if(!state.cashSession){ toast('Abra o caixa para receber pagamento.'); return; }
  const pay = { id:uid(), method, amount, who, at:new Date().toISOString(), operatorId:currentUser.id, operatorName:currentUser.name, cashSessionId:state.cashSession.id };
  let refused = '';
  const cur = await commitSaleChange(saleId, c=>{
    if(c.status!=='open'||c.canceled){ refused='Esta comanda já foi fechada ou cancelada em outro aparelho.'; return false; }
    const due = Math.round((saleTotal(c.items) - comandaPartialPaid(c))*100)/100;
    if(amount > due+0.009){ refused='O valor passa do que está em aberto ('+fmt(due)+').'; return false; }
    c.partialPayments = [...(c.partialPayments||[]), pay];
  });
  if(!cur) return;
  if(refused){ toast(refused); return; }
  const desc = 'Pagamento parcial — pedido #'+(cur.orderNumber||saleId)+(who?' ('+who+')':'');
  state.cashMovements.unshift({id:uid(), cashSessionId:state.cashSession.id, type:'suprimento', amount, method, origin:'parcial', saleId, partialId:pay.id, reason:desc, description:desc, note:'', operatorId:currentUser.id, operatorName:currentUser.name, at:pay.at});
  save('cashMovements');
  logAction('Pagamento parcial: '+fmt(amount)+' ('+paymentMethodLabel(method)+') — pedido #'+(cur.orderNumber||saleId));
  toast('Pagamento parcial de '+fmt(amount)+' registrado.');
  openComanda(saleId, true);
}
async function reversePartialPayment(saleId, pid){
  if(!(currentUser && (currentUser.role==='admin' || sessionIsOwner))){ toast('Só o administrador estorna pagamento parcial.'); return; }
  if(!state.cashSession){ toast('Abra o caixa para estornar (o valor sai do caixa).'); return; }
  const s = state.sales.find(x=>x.id===saleId); const pay = s && (s.partialPayments||[]).find(p=>p.id===pid); if(!pay||pay.reversed) return;
  if(!await askConfirm({title:'Estornar pagamento parcial de '+fmt(pay.amount)+'?', message:'O valor volta a ficar em aberto na comanda e sai do caixa.', confirmLabel:'Estornar pagamento'})) return;
  const cur = await commitSaleChange(saleId, c=>{ const p=(c.partialPayments||[]).find(x=>x.id===pid); if(!p||p.reversed) return false; p.reversed=true; p.reversedAt=new Date().toISOString(); p.reversedBy=currentUser.name; });
  if(!cur) return;
  const mv = state.cashMovements.find(m=>m.origin==='parcial' && m.partialId===pid && m.cashSessionId===state.cashSession.id);
  if(mv) state.cashMovements = state.cashMovements.filter(m=>m.id!==mv.id);
  else { const desc='Estorno de pagamento parcial — pedido #'+(cur.orderNumber||saleId); state.cashMovements.unshift({id:uid(), cashSessionId:state.cashSession.id, type:'sangria', amount:pay.amount, method:pay.method, origin:'parcial-estorno', saleId, partialId:pid, reason:desc, description:desc, note:'', operatorId:currentUser.id, operatorName:currentUser.name, at:new Date().toISOString()}); }
  save('cashMovements');
  logAction('Estorno de pagamento parcial: '+fmt(pay.amount)+' — pedido #'+(cur.orderNumber||saleId));
  toast('Pagamento parcial estornado.');
  openComanda(saleId, true);
}
function renderComandaPartials(saleId){
  const el = document.getElementById('comandaPartialWrap'); if(!el) return;
  const s = state.sales.find(x=>x.id===saleId); const list = (s&&s.partialPayments||[]).filter(p=>!p.reversed);
  if(!list.length){ el.innerHTML=''; return; }
  const paid = comandaPartialPaid(s), due = Math.max(0, Math.round((saleTotal(currentSaleDraft.items)-paid)*100)/100);
  const admin = currentUser && (currentUser.role==='admin' || sessionIsOwner);
  el.innerHTML = `<div class="partial-box"><div class="partial-head"><span>Já pago (parcial): <b class="mono">${fmt(paid)}</b></span><span>Falta: <b class="mono">${fmt(due)}</b></span></div>${list.map(p=>`<div class="partial-line"><span>${comandaShortTime(p.at)} · ${h(paymentMethodLabel(p.method))}${p.who?' · '+h(p.who):''}</span><span class="mono">${fmt(p.amount)}${admin?` <button class="op-mini" title="Estornar este pagamento" onclick="reversePartialPayment(${jsArg(saleId)},${jsArg(p.id)})">↩</button>`:''}</span></div>`).join('')}</div>`;
}
function comandaAcceptsOrders(s){
  if(s && s.status==='open' && !s.canceled) return true;
  toast((s&&s.canceled?'Esta comanda foi cancelada':'Esta comanda já foi fechada')+'. Nada foi enviado: abra uma nova comanda para este cliente.');
  return false;
}
/* Único lugar que decide se uma venda entra em relatório/faturamento: fechada, não cancelada
   como delivery (deliveryStatus) e não cancelada como comanda inteira (s.canceled, ver
   confirmCancelComanda). Todo relatório novo deve usar isto em vez de repetir a condição. */
function saleCountsAsRevenue(s){ return !!s && s.status==='closed' && s.deliveryStatus!=='cancelado' && !s.canceled; }
// OP-14: o faturamento de uma venda é do dia em que ela abriu (comanda aberta à noite e paga no dia
// seguinte conta no dia da abertura). Recebimentos (formas de pagamento, caixa) seguem pela data do pagamento.
function saleRevenueDay(s){ return localDay(s.openedAt||s.closedAt); }
function saidaModoEstacao(estacao){
  const e = state.estacoes.find(x=>x.chave===estacao);
  return e ? e.saida : (estacao==='cozinha' ? 'ambos' : 'imprime');
}
function saidaTemTela(estacao){ const m=saidaModoEstacao(estacao); return m==='ambos'||m==='tela'; }
function saidaTemImpressao(estacao){ const m=saidaModoEstacao(estacao); return m==='ambos'||m==='imprime'; }
async function sendItemsToKitchen(saleId, items, who, source, local){
  if(!items.length) return false;
  const batchId = uid();
  items.forEach(i=>{ if(!i.batchId) i.batchId = batchId; });
  if(!await consumeInsumosForItems(items)){ toast('Estoque insuficiente para enviar todos os itens. Revise as quantidades.'); return false; }
  const monitorItems=items.filter(i=>{const product=state.products.find(p=>p.id===i.productId);const estacao=product&&product.estacao?product.estacao:'cozinha';return saidaTemTela(estacao);});
  if(!monitorItems.length) return true;
  const order = { id:uid(), saleId, who, local: local||'', items: monitorItems.map(i=>({productId:i.productId,batchId:i.batchId||null,name:i.name,qty:i.qty,price:i.price,notes:i.notes||'',copos:i.copos,levarJunto:!!i.levarJunto,levarJuntoCom:i.levarJuntoCom||'',customization:i.customization?JSON.parse(JSON.stringify(i.customization)):null})),
    status:'pendente', statusHistory:[], createdAt:new Date().toISOString(), source };
  try{
    await OrdersStore.create(order);
  }catch(e){
    // consume_insumos ja descontou: sem estorno, o retry do operador baixaria o estoque de novo.
    console.error('Falha ao criar pedido da cozinha', e);
    try{ await restoreInsumosForItems(items); }catch(_){}
    toast('Não foi possível enviar o pedido agora. Tente de novo.');
    return false;
  }
  return true;
}
function kOrderAgeMin(createdAt){ return Math.max(0, Math.floor((Date.now()-new Date(createdAt).getTime())/60000)); }
function kOrderAgeClass(mins){ return mins>=20?'kage-red':mins>=15?'kage-yellow':'kage-green'; }
function fmtOpenDuration(mins){ if(mins<60) return mins+' min'; if(mins<1440){ const hrs=Math.floor(mins/60), rest=mins%60; return hrs+'h'+(rest?String(rest).padStart(2,'0')+'min':''); } const days=Math.floor(mins/1440), hrs=Math.floor((mins%1440)/60); return days+'d'+(hrs?' '+hrs+'h':''); }
function comandaAgeClass(mins){ return mins>=120?'ctime-red':mins>=60?'ctime-yellow':'ctime-green'; }
// Quantidade de copos (pedido do dono, 10/10): vale para toda bebida, não só para produto da
// estação Bar (água e refrigerante cadastrados como "Não exige preparo" ficavam sem). Bebida é
// reconhecida pela estação, categoria ou nome; no cadastro do produto dá para forçar Sim/Não.
const DRINK_RE=/(bebida|cervej|chop+e?\b|refri|suco|[áa]gua|h2oh|drink|\bdoses?\b|vinho|espumante|whisk|vodka|\bgin\b|cacha[çc]a|caipirinha|caipiroska|caipivodka|energ[ée]tico|destilad|long ?neck|\bcoca\b|guaran[áa]|\bsoda\b|t[ôo]nica|isot[ôo]nico|gatorade|heineken|stella|amstel|brahma|skol|budweiser|corona|spaten|eisenbahn|\bbaden|sprite|fanta|pepsi|schweppes|monster|red ?bull|ginger)/i;
function productIsDrink(p){
  if(!p) return false;
  if(p.askCopos==='sim') return true;
  return p.estacao==='bar' || DRINK_RE.test(p.category||'') || DRINK_RE.test(p.name||'');
}
function productAsksCopos(p){ return !!p && p.askCopos!=='nao' && productIsDrink(p); }
// "Levar a bebida junto com a comida" (pedido do dono, 10/10). Caixinha no Novo Pedido, no
// Adicionar produto direto e no app do garçom, só quando o lote tem bebida e comida; vem
// desmarcada. Marcada: a bebida leva "SEGURAR — levar junto com a comida" e a comida leva
// "LEVAR JUNTO: 1x Coca…", na ficha impressa, no Monitor e no histórico da comanda.
const levarJunto={np:false,quick:false,gc:false};
function cartHasDrinkAndFood(cart){
  const prods=(cart||[]).map(i=>state.products.find(p=>p.id===i.productId)).filter(Boolean);
  return prods.some(productIsDrink) && prods.some(p=>!productIsDrink(p));
}
function levarJuntoBox(cart, key){
  if(!cartHasDrinkAndFood(cart)){ levarJunto[key]=false; return ''; }
  return `<label class="levar-junto"><input type="checkbox" ${levarJunto[key]?'checked':''} onchange="levarJunto.${key}=this.checked"> Levar a bebida junto com a comida</label>`;
}
function applyLevarJunto(items, on){
  if(!on) return;
  const isDrink=i=>productIsDrink(state.products.find(p=>p.id===i.productId));
  const drinks=items.filter(isDrink), foods=items.filter(i=>!isDrink(i));
  if(!drinks.length || !foods.length) return;
  const txt=drinks.map(d=>d.qty+'x '+d.name).join(', ');
  drinks.forEach(d=>{ d.levarJunto=true; });
  foods.forEach(f=>{ f.levarJuntoCom=txt; });
}
function itemStation(i){ const p=state.products.find(x=>x.id===i.productId); return p&&p.estacao?p.estacao:'cozinha'; }
function kitchenItemExtras(i){
  const c=i.customization; if(!c) return [];
  const extras=[];
  if(c.size) extras.push(c.size.name);
  (c.answers||[]).forEach(a=>(a.values||[]).forEach(v=>extras.push(a.question+': '+v.text)));
  (c.complements||[]).forEach(comp=>extras.push(comp.name));
  return extras;
}
// UX-07: observação livre ("sem cebola") em linha própria e destacada, não como "+ adicional".
function kitchenItemNote(i){ return String((i.customization&&i.customization.notes)||i.notes||'').trim(); }
let kitchenStationFilter = (function(){ try{ return localStorage.getItem('cantina2:kitchenStation')||'todas'; }catch(e){ return 'todas'; } })();
function setKitchenStationFilter(chave){
  kitchenStationFilter = chave;
  try{ localStorage.setItem('cantina2:kitchenStation', chave); }catch(e){}
  renderCozinha();
}
let kitchenViewTab = 'ativos';
function setKitchenViewTab(tab){
  kitchenViewTab = tab;
  renderCozinha();
}
function kitchenReadyAt(o){
  const hist = (o.statusHistory||[]).slice().reverse().find(x=>x.to==='pronto');
  return hist ? hist.at : o.createdAt;
}
function renderCozinha(){
  const el = document.getElementById('view-cozinha');
  const stations = state.estacoes.filter(e=>saidaTemTela(e.chave));
  if(stations.length<=1) kitchenStationFilter='todas';
  else if(kitchenStationFilter!=='todas' && !stations.some(e=>e.chave===kitchenStationFilter)) kitchenStationFilter='todas';
  const tv = document.body.classList.contains('tv-mode');
  const tvBtn = tv ? '' : '<button class="btn btn-sm" style="margin-left:10px" onclick="toggleTvMode()">📺 Modo TV (tela cheia p/ monitor)</button>';
  // Cada TV fica numa área (ex. cozinha e churrasqueira): em Modo TV a estação fica
  // travada e o filtro some, pra ninguém trocar a tela sem querer. "Todas" não vale
  // em TV — se ainda não escolheu, a tela pede a estação antes de mostrar pedidos.
  // Pra trocar de estação, sai do Modo TV.
  if(tv && stations.length>1 && kitchenStationFilter==='todas'){
    el.innerHTML = `<div class="panel"><h2>Qual estação é esta tela?</h2>
      <div class="kfilter kstation-pick">${stations.map(e=>`<button class="btn btn-primary" onclick="setKitchenStationFilter(${jsArg(e.chave)})">${h(e.nome)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  const stationNome = kitchenStationFilter!=='todas' ? estacaoLabel(kitchenStationFilter) : (stations.length===1 ? stations[0].nome : '');
  const titulo = stationNome ? 'Monitor — '+h(stationNome) : 'Monitor de preparo';
  const filterHtml = stations.length>1 && !tv ? `<div class="kfilter subtabs">
    <button class="${kitchenStationFilter==='todas'?'active':''}" onclick="setKitchenStationFilter('todas')">Todas</button>
    ${stations.map(e=>`<button class="${kitchenStationFilter===e.chave?'active':''}" onclick="setKitchenStationFilter(${jsArg(e.chave)})">${h(e.nome)}</button>`).join('')}
  </div>` : '';
  const subtabsHtml = `<div class="subtabs">
    <button class="${kitchenViewTab==='ativos'?'active':''}" onclick="setKitchenViewTab('ativos')">Em preparo</button>
    <button class="${kitchenViewTab==='prontos'?'active':''}" onclick="setKitchenViewTab('prontos')">Prontos</button>
  </div>`;
  const feedHtml = kitchenViewTab==='prontos' ? renderKitchenReadyFeed() : renderKitchenActiveFeed();
  el.innerHTML = `<div class="panel"><h2>${titulo} ${tvBtn}</h2>
    ${subtabsHtml}
    ${filterHtml}
    ${feedHtml}
  </div>`;
}
function renderKitchenActiveFeed(){
  const ordersRaw = state.orders.filter(o=>o.status==='pendente'||o.status==='preparo').sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const orders = ordersRaw.map(o=>{
    const items = o.items.map((item,idx)=>({item,idx})).filter(({item})=>!item.ready && (kitchenStationFilter==='todas' || itemStation(item)===kitchenStationFilter));
    return {o, items};
  }).filter(x=>x.items.length);
  return `<div class="kfeed">${orders.length? orders.map(({o,items})=>{
    const ageMin = kOrderAgeMin(o.createdAt);
    const showCheck = items.length>1;
    return `
    <div class="kcard ${kOrderAgeClass(ageMin)}" data-order="${o.id}" onclick="openKitchenOrder(${jsArg(o.id)})">
      <div class="kbody">
        <div class="khead">
          <div class="khead-left">
            <div class="kwho">${h(o.who)}</div>
            ${o.local?`<div class="klocal"><span class="icn">${ICN.mapPin}</span>${h(o.local)}</div>`:''}
          </div>
          <div class="khead-right">
            <span class="kagebadge">há ${ageMin} min</span>
          </div>
        </div>
        <div class="ktime">${timeFmt(o.createdAt)} · ${o.source==='cardapio'?'Cardápio digital':o.source==='balcao'?'Balcão':o.source==='agendamento'?'Agendamento':o.source==='totem'?'Totem':o.source==='pedido-avulso'?'Novo Pedido':'Comanda'}</div>
        <ul>${items.map(({item,idx})=>{
          const extras=kitchenItemExtras(item);
          if(item.canceled) return `<li data-idx="${idx}" class="kitem-canceled"><s>${item.qty}x ${h(item.name)}</s> <span class="kcanceled-tag">Cancelado</span></li>`;
          const label=`${item.qty}x ${h(item.name)}`;
          return `<li data-idx="${idx}">${showCheck?`<label class="kcheck" onclick="event.stopPropagation()"><input type="checkbox" class="kitem-check" data-idx="${idx}"> ${label}</label>`:label}${extras.length?`<ul class="kextras">${extras.map(e=>`<li>+ ${h(e)}</li>`).join('')}</ul>`:''}${kitchenItemNote(item)?`<div class="kobs">Obs.: ${h(kitchenItemNote(item))}</div>`:''}${item.copos!=null&&item.copos!==''?`<div class="kobs">${item.copos} copo${Number(item.copos)===1?'':'s'}</div>`:''}${item.levarJunto?'<div class="kjunto">Segurar — levar junto com a comida</div>':''}${item.levarJuntoCom?`<div class="kjunto">Levar junto: ${h(item.levarJuntoCom)}</div>`:''}</li>`;
        }).join('')}</ul>
      </div>
      <button class="kbtn-ready" onclick="event.stopPropagation();finalizeKitchenItems(${jsArg(o.id)})" title="Marcar pronto">${ICN.ticket}<span>Pronto</span></button>
    </div>`;
  }).join('') : `<p class="empty">Nenhum pedido em preparo.</p>`}</div>`;
}
function renderKitchenReadyFeed(){
  const ordersRaw = state.orders.filter(o=>o.status==='pronto').sort((a,b)=>new Date(kitchenReadyAt(b))-new Date(kitchenReadyAt(a)));
  const orders = ordersRaw.map(o=>{
    const items = kitchenStationFilter==='todas' ? o.items : o.items.filter(item=>itemStation(item)===kitchenStationFilter);
    return {o, items};
  }).filter(x=>x.items.length);
  return `<div class="kfeed">${orders.length? orders.map(({o,items})=>`
    <div class="kcard kcard-done" data-order="${o.id}" onclick="openKitchenOrder(${jsArg(o.id)})">
      <div class="kbody">
        <div class="khead">
          <div class="khead-left">
            <div class="kwho">${h(o.who)}</div>
            ${o.local?`<div class="klocal"><span class="icn">${ICN.mapPin}</span>${h(o.local)}</div>`:''}
          </div>
        </div>
        <div class="ktime">${o.source==='cardapio'?'Cardápio digital':o.source==='balcao'?'Balcão':o.source==='agendamento'?'Agendamento':o.source==='totem'?'Totem':o.source==='pedido-avulso'?'Novo Pedido':'Comanda'}</div>
        <ul>${items.map(item=>{
          const extras=kitchenItemExtras(item);
          if(item.canceled) return `<li class="kitem-canceled"><s>${item.qty}x ${h(item.name)}</s> <span class="kcanceled-tag">Cancelado</span></li>`;
          return `<li>${item.qty}x ${h(item.name)}${extras.length?`<ul class="kextras">${extras.map(e=>`<li>+ ${h(e)}</li>`).join('')}</ul>`:''}${kitchenItemNote(item)?`<div class="kobs">Obs.: ${h(kitchenItemNote(item))}</div>`:''}${item.copos!=null&&item.copos!==''?`<div class="kobs">${item.copos} copo${Number(item.copos)===1?'':'s'}</div>`:''}${item.levarJunto?'<div class="kjunto">Segurar — levar junto com a comida</div>':''}${item.levarJuntoCom?`<div class="kjunto">Levar junto: ${h(item.levarJuntoCom)}</div>`:''}</li>`;
        }).join('')}</ul>
        <div class="kdone-badge">✓ Pronto às ${timeFmt(kitchenReadyAt(o))}</div>
      </div>
    </div>`).join('') : `<p class="empty">Nenhum pedido pronto.</p>`}</div>`;
}
async function finalizeKitchenItems(orderId){
  const o = state.orders.find(x=>x.id===orderId); if(!o) return;
  const card = document.querySelector(`.kcard[data-order="${orderId}"]`);
  if(!card) return;
  const boxes = Array.from(card.querySelectorAll('.kitem-check'));
  let idxs;
  if(boxes.length){
    idxs = boxes.filter(b=>b.checked).map(b=>Number(b.dataset.idx));
    if(!idxs.length){ toast('Marque ao menos um item pronto.'); return; }
  } else {
    idxs = Array.from(card.querySelectorAll('li[data-idx]')).map(li=>Number(li.dataset.idx));
  }
  const items = o.items.map((item,idx)=> idxs.includes(idx) ? {...item, ready:true} : item);
  await OrdersStore.setItems(orderId, items);
  // Item cancelado na comanda não fica pronto nunca: não pode travar o pedido (OP-09).
  if(items.every(item=>item.ready||item.canceled)){
    await OrdersStore.advance(orderId, 'pronto');
    toast('Pedido pronto.');
  } else {
    toast('Item(ns) marcado(s) como pronto(s).');
  }
  renderAll();
}
async function advanceOrder(id, next){
  await OrdersStore.advance(id, next);
  renderAll();toast('Pedido atualizado: '+next+'.');
}
function toggleTvMode(){
  const on = !document.body.classList.contains('tv-mode');
  document.body.classList.toggle('tv-mode', on);
  try{ localStorage.setItem('cantina2:tvmode', on?'1':'0'); }catch(e){}
  renderCozinha();
  if(on) toast('Modo TV ativado.');
}
try{ if(localStorage.getItem('cantina2:tvmode')==='1') document.body.classList.add('tv-mode'); }catch(e){}
function openKitchenOrder(id){const o=state.orders.find(x=>x.id===id);if(!o)return;const flow={pendente:['preparo','Iniciar preparo'],preparo:['pronto','Marcar pronto'],pronto:['entregue','Marcar entregue'],entregue:[null,'Entregue']}[o.status]||[null,'Concluído'];openModal('Pedido na Cozinha',`<div class="consumer-form-frame"><div class="app-status"><b>${h(o.who)}</b><span class="tag tag-blue">${h(o.status)}</span></div><p>${reportDateTime(o.createdAt)} · ${h(typeLabel(o.source))}</p><div class="finance-grid" style="height:260px"><table><thead><tr><th>Qtd.</th><th>Item</th><th>Observação</th></tr></thead><tbody>${(o.items||[]).map(i=>`<tr><td>${Number(i.qty)||0}</td><td>${h(i.name)}</td><td>${h(i.notes||'—')}</td></tr>`).join('')}</tbody></table></div><div class="field"><label>Observação da cozinha</label><textarea id="kitchenNote">${h(o.kitchenNote||'')}</textarea></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button><button class="op-btn" onclick="returnKitchenOrder(${jsArg(id)})" ${o.status==='pendente'?'disabled':''}>↶ Retornar etapa</button><button class="consumer-save" onclick="saveKitchenOrder(${jsArg(id)},${jsArg(flow[0]||'')})" ${flow[0]?'':'disabled'}>✓ ${flow[1]}</button></div>`,true);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
async function saveKitchenOrder(id,next){const o=state.orders.find(x=>x.id===id);if(!o)return;await OrdersStore.saveNote(id,document.getElementById('kitchenNote').value.trim());closeModal();if(next)await advanceOrder(id,next);}
async function returnKitchenOrder(id){const o=state.orders.find(x=>x.id===id);if(!o)return;if(!confirm('Retornar o pedido para a etapa anterior?'))return;await OrdersStore.returnStep(id);closeModal();renderAll();}

