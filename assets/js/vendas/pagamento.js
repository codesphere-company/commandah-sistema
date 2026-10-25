/* ============ PAGAMENTO ============ */
function methodConfig(){
  const base=[
    {key:'A',method:'dinheiro',label:'Dinheiro',icon:ICN.cash},
    {key:'P',method:'pix',label:'Pix',icon:ICN.pix},
    {key:'C',method:'credito',label:'Crédito',icon:ICN.card},
    {key:'B',method:'debito',label:'Débito',icon:ICN.card},
    {key:'V',method:'vale',label:'Vale Refeição',icon:ICN.meal},
    {key:'F',method:'fiado',label:'Fiado',icon:ICN.doc},
  ];
  const usedKeys=new Set(base.map(b=>b.key));
  const extras=state.paymentMethods.map((pm,i)=>{
    let key = pm.nome.trim().charAt(0).toUpperCase();
    if(!key || usedKeys.has(key)) key = 'ZYXWQJK'[i%7];
    usedKeys.add(key);
    return {key,method:'outro:'+pm.nome,label:pm.nome,icon:ICN.dots};
  });
  base.push({key:'O',method:'outro',label:'Outros',icon:ICN.dots});
  return [...base,...extras];
}
function openPaymentModal(mode, comandaId){
  // Comanda aberta sem nenhum consumo precisa poder ser fechada mesmo assim
  // (ex. cliente abriu e desistiu) — só balcão/delivery/agendamento (venda
  // criada do zero) exigem ao menos um item.
  if(!currentSaleDraft.items.length && mode!=='comanda'){ toast('Adicione ao menos um item.'); return; }
  const subtotal = draftTotal();
  const applyService = mode==='comanda' && serviceRatePct()>0;
  const partialPaid = mode==='comanda' && comandaId ? comandaPartialPaid(state.sales.find(x=>x.id===comandaId)) : 0;
  const memberOptions = state.members.filter(m=>!m.archived).map(m=>`<option value="${m.id}" ${memberBlockedByDebt(m)?'data-blocked="1"':''}>${h((m.code?m.code+' — ':'')+m.name+memberDebtLabel(m))}</option>`).join('');
  const preselected = currentSaleDraft.memberId || '';
  const methods = methodConfig();
  // Visual A, etapa 3 (22/10): duas colunas (resumo e opções | forma de pagamento e confirmar),
  // para caber em 1366x768 sem rolar; até 900 px de largura viram uma coluna só.
  openModal('Pagamento', `<div class="pay-cols"><div class="pay-col">
    <div class="pay-summary">
      <div><span>Subtotal</span><span class="mono" id="paySubtotalLine">${fmt(subtotal)}</span></div>
      <div id="payDiscountRow" style="display:none"><span>Desconto</span><span class="mono" id="payDiscountLine">− R$ 0,00</span></div>
      <div id="payCreditRow" style="display:none"><span>Crédito do sócio (abatido)</span><span class="mono" id="payCreditLine">− R$ 0,00</span></div>
      ${applyService?`<div><span>(+) Serviço (${serviceRatePct()}%)</span><span class="mono" id="payServiceLine">R$ 0,00</span></div>`:''}
      ${partialPaid>TOLERANCIA_CENTAVO?`<div><span>Já pago (parcial)</span><span class="mono">− ${fmt(partialPaid)}</span></div>`:''}
      <div id="payDebtRow" style="display:none"><span>(+) Pendência anterior (fiado)</span><span class="mono" id="payDebtLine">R$ 0,00</span></div>
      <div class="pay-total-row"><span>Total a pagar</span><span class="mono" id="payFinalTotal">${fmt(subtotal)}</span></div>
    </div>
    <div class="row" style="align-items:flex-end;margin-top:10px">
      <div class="field" style="flex:1"><label>Cupom de desconto (opcional)</label><input id="payCoupon" placeholder="Ex: SOCIO10"></div>
      <button class="btn btn-sm" id="applyCouponBtn">Aplicar</button>
    </div>
    <label class="comp-switch" style="margin:12px 0 4px"><input type="checkbox" id="paySplitToggle"><span></span> Rachar a conta</label>
    <div id="paySplitBox" style="display:none;background:var(--cream);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:10px">
      <div class="field" style="margin-bottom:0"><label>Dividir em quantas partes?</label><input id="paySplitCount" type="number" min="2" value="2"></div>
      <p class="sub" style="margin:8px 0 0">Cada parte: <b class="mono" id="paySplitPerPart">R$ 0,00</b> — clique numa forma de pagamento pra lançar cada parte.</p>
    </div>
    <div class="field"><label>Associado (opcional — necessário para fiado)</label>
      <select id="paySelMember"><option value="">— Cliente avulso —</option>${memberOptions}</select></div>
    <label class="comp-switch" id="payDebtBox" style="margin:0 0 8px" hidden><input type="checkbox" id="payChargeDebt" checked><span></span> <b id="payDebtLabel" style="font-weight:400">Cobrar a pendência anterior junto</b></label>
    <label class="comp-switch" style="margin:0 0 8px"><input type="checkbox" id="payPrintReceipt"><span></span> <b style="font-weight:400">Imprimir comprovante (se o cliente pedir)</b></label>
    </div><div class="pay-col">
    <label class="np-label" style="margin-top:0;display:block">Forma de pagamento <span style="text-transform:none;font-weight:400">(atalho de teclado entre parênteses)</span></label>
    <div class="pay-method-grid" id="payMethodGrid">
      ${methods.map(m=>`<button class="pay-method-btn" data-key="${m.key}" data-method="${h(m.method)}" onclick="selectPayMethod(${jsArg(m.key)})"><span class="pay-method-icon">${m.icon}</span><span>${h(m.label)}</span><span class="pay-method-key">${m.key}</span></button>`).join('')}
    </div>
    <div class="row" style="margin-top:10px">
      <div class="field" style="flex:1"><label>Valor desta forma</label><input id="payPartAmount" type="number" min="0.01" step="0.01"></div>
      <button class="btn" id="addPaymentBtn" style="align-self:flex-end">+ &nbsp; Adicionar</button>
    </div>
    <p id="fiadoWarning" style="display:none;color:var(--red);font-size:12px">Este associado possui saldo devedor pendente e não pode usar fiado até quitar.</p>
    <div id="paymentParts"></div>
    <div class="panel pay-progress-panel">
      <div class="pay-progress-track"><div class="pay-progress-fill" id="payProgressFill" style="width:0%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <div><small class="sub">Total Pago</small><br><b class="mono" id="payReceived">R$ 0,00</b></div>
        <div style="text-align:right"><small class="sub" id="payBalanceLabel">Falta pagar</small><br><b class="mono" id="payBalance">R$ 0,00</b></div>
      </div>
      <div id="payChangeChoice" style="display:none;gap:8px;margin-top:10px"></div>
    </div>
    <button class="btn btn-primary btn-block" id="confirmPayBtn">Confirmar pagamento</button></div></div>`,true);
  const modal=document.querySelector('#modalRoot .modal'); modal.classList.add('record-modal','pay-modal'); modal.style.width='960px';
  const selMember = document.getElementById('paySelMember');
  let finalTotal = subtotal, discount = 0, selectedMethodKey = 'A', creditApplied = 0, changeDecision = 'troco', appliedCouponCode = '', serviceAmount = 0, debtIncluded = 0;
  tempPayments = [];
  if(preselected) selMember.value = preselected;
  function currentMethod(){ return methods.find(m=>m.key===selectedMethodKey)||methods[0]; }
  function recomputeTotals(){
    const afterCoupon = Math.max(0, subtotal-discount);
    const member = selMember.value ? state.members.find(m=>m.id===selMember.value) : null;
    // Crédito do sócio é abatido sozinho (decisão do dono, 18/10). Antes (10/10) o caixa
    // precisava marcar "Usar crédito do sócio"; o garçom usa a mesma regra (gcComandaTotals).
    const available = memberAvailableCredit(member);
    creditApplied = available>TOLERANCIA_CENTAVO ? Math.min(available, Math.max(0, afterCoupon-partialPaid)) : 0;
    const afterDiscount = Math.max(0, afterCoupon-creditApplied);
    const service = applyService ? serviceChargeAmount(afterDiscount) : 0;
    serviceAmount = arredondaCentavos(service);
    finalTotal = Math.max(0, arredondaCentavos(afterDiscount+service-partialPaid)); // centavos exatos; parcial já pago sai do total
    const debtDue = memberDebtDue(member), debtBox = document.getElementById('payDebtBox');
    debtBox.hidden = !(debtDue>TOLERANCIA_CENTAVO);
    if(debtDue>TOLERANCIA_CENTAVO) document.getElementById('payDebtLabel').textContent = 'Cobrar a pendência anterior junto ('+fmt(debtDue)+')';
    debtIncluded = debtDue>TOLERANCIA_CENTAVO && document.getElementById('payChargeDebt').checked ? debtDue : 0;
    document.getElementById('payDebtRow').style.display = debtIncluded>TOLERANCIA_CENTAVO ? 'flex':'none';
    if(debtIncluded>TOLERANCIA_CENTAVO) document.getElementById('payDebtLine').textContent = fmt(debtIncluded);
    finalTotal = arredondaCentavos(finalTotal+debtIncluded);
    document.getElementById('payDiscountRow').style.display = discount>0 ? 'flex':'none';
    if(discount>0) document.getElementById('payDiscountLine').textContent = '− '+fmt(discount);
    document.getElementById('payCreditRow').style.display = creditApplied>TOLERANCIA_CENTAVO ? 'flex':'none';
    if(creditApplied>TOLERANCIA_CENTAVO) document.getElementById('payCreditLine').textContent = '− '+fmt(creditApplied);
    if(applyService) document.getElementById('payServiceLine').textContent = fmt(service);
    document.getElementById('payFinalTotal').textContent = fmt(finalTotal);
    updateSplitInfo(); renderPaymentParts();
  }
  function splitActive(){ return document.getElementById('paySplitToggle').checked; }
  function splitCount(){ return Math.max(2,parseInt(document.getElementById('paySplitCount').value,10)||2); }
  function updateSplitInfo(){
    const box=document.getElementById('paySplitBox');
    box.style.display = splitActive() ? 'block':'none';
    if(splitActive()) document.getElementById('paySplitPerPart').textContent = fmt(finalTotal/splitCount());
  }
  document.getElementById('paySplitToggle').onchange = updateSplitInfo;
  document.getElementById('paySplitCount').oninput = updateSplitInfo;
  window.selectPayMethod = function(key){
    selectedMethodKey = key;
    document.querySelectorAll('.pay-method-btn').forEach(b=>b.classList.toggle('active', b.dataset.key===key));
    const received = tempPayments.reduce((a,p)=>a+p.amount,0);
    const remaining = Math.max(0, finalTotal-received);
    const share = Math.round(finalTotal/splitCount()*100)/100;
    const suggested = splitActive() ? (remaining-share < 0.05 ? remaining : Math.min(remaining, share)) : remaining;
    document.getElementById('payPartAmount').value = suggested.toFixed(2);
    checkFiado();
  };
  function checkFiado(){
    const opt = selMember.options[selMember.selectedIndex];
    const blocked = opt && opt.dataset.blocked==='1';
    document.getElementById('fiadoWarning').style.display = (currentMethod().method==='fiado' && blocked) ? 'block':'none';
  }
  selMember.onchange = ()=>{ checkFiado(); changeDecision='troco'; tempPayments=[]; document.getElementById('payChargeDebt').checked=true; recomputeTotals(); };
  document.getElementById('payChargeDebt').onchange = ()=>{ tempPayments=[]; recomputeTotals(); };
  function renderPaymentParts(){
    const received = tempPayments.reduce((a,p)=>a+p.amount,0);
    const balance = finalTotal-received;
    document.getElementById('paymentParts').innerHTML = tempPayments.length ? tempPayments.map((p,idx)=>`
      <div class="item-line"><span>${methodLabel(p.method)}</span><div><b class="mono">${fmt(p.amount)}</b>
      <button class="btn btn-sm btn-danger" style="margin-left:8px" onclick="tempPayments.splice(${idx},1);renderPaymentPartsGlobal()">Remover</button></div></div>`).join('') : '<p class="empty" style="padding:12px">Clique numa forma de pagamento e depois em Adicionar.</p>';
    document.getElementById('payReceived').textContent = fmt(received);
    document.getElementById('payBalanceLabel').textContent = balance>=0 ? 'Falta pagar' : 'Troco';
    document.getElementById('payBalance').textContent = fmt(Math.abs(balance));
    document.getElementById('payBalance').style.color = balance>TOLERANCIA_CENTAVO ? 'var(--red)' : 'var(--green)';
    const pct = finalTotal>0 ? Math.min(100,(received/finalTotal)*100) : 0;
    document.getElementById('payProgressFill').style.width = pct+'%';
    document.getElementById('payProgressFill').style.background = balance>TOLERANCIA_CENTAVO ? 'var(--amber)':'var(--green)';
    if(!splitActive()) document.getElementById('payPartAmount').value = Math.max(0,balance).toFixed(2);
    else updateSplitInfo();
    const member = selMember.value ? state.members.find(m=>m.id===selMember.value) : null;
    const choiceBox = document.getElementById('payChangeChoice');
    if(balance<-TOLERANCIA_CENTAVO && member){
      choiceBox.style.display = 'flex';
      choiceBox.innerHTML = `
        <button type="button" class="btn btn-sm ${changeDecision==='troco'?'btn-primary':''}" onclick="setPayChangeDecision('troco')">💰 &nbsp; Devolver Troco</button>
        <button type="button" class="btn btn-sm ${changeDecision==='credito'?'btn-primary':''}" onclick="setPayChangeDecision('credito')">✓ &nbsp; Deixar como Crédito</button>`;
    } else {
      choiceBox.style.display = 'none'; choiceBox.innerHTML = '';
    }
  }
  window.renderPaymentPartsGlobal = renderPaymentParts;
  window.setPayChangeDecision = function(v){ changeDecision=v; renderPaymentParts(); };
  document.getElementById('addPaymentBtn').onclick = ()=>{
    const method = currentMethod().method; const amount = parseFloat(document.getElementById('payPartAmount').value);
    const member = selMember.value ? state.members.find(m=>m.id===selMember.value) : null;
    if(!amount || amount<=0){ toast('Informe o valor desta forma de pagamento.'); return; }
    if(method==='fiado' && (!member || memberBlockedByDebt(member))){ toast(!member?'Selecione um associado para usar fiado.':'Associado com pendência não pode usar fiado.'); return; }
    if(method==='fiado' && debtIncluded>TOLERANCIA_CENTAVO){ toast('Para lançar no fiado, desmarque "Cobrar a pendência anterior junto".'); return; }
    tempPayments.push({method,amount}); renderPaymentParts();
  };
  document.getElementById('payPartAmount').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addPaymentBtn').click(); } });
  selectPayMethod('A');
  recomputeTotals();
  document.getElementById('applyCouponBtn').onclick = ()=>{
    const code = document.getElementById('payCoupon').value.trim().toUpperCase();
    const c = state.coupons.find(x=>x.code===code && isCouponUsable(x));
    if(!c){ toast('Cupom inválido ou inativo.'); return; }
    discount = c.type==='percent' ? Math.round(subtotal*c.value)/100 : Math.min(subtotal,c.value);
    recomputeTotals();
    tempPayments = []; renderPaymentParts();
    appliedCouponCode = code;
    toast('Cupom '+code+' aplicado.');
  };
  function payKeyHandler(e){
    if(!document.getElementById('confirmPayBtn')){ document.removeEventListener('keydown',payKeyHandler); return; }
    const tag=(e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='select'||tag==='textarea') return;
    const key = e.key.toUpperCase();
    const btn = document.querySelector('.pay-method-btn[data-key="'+key+'"]');
    if(btn){ e.preventDefault(); btn.click(); }
  }
  document.addEventListener('keydown', payKeyHandler);
  document.getElementById('confirmPayBtn').onclick = async ()=>{
    const memberId = selMember.value || null;
    const member = memberId ? state.members.find(m=>m.id===memberId) : null;
    if(tempPayments.some(p=>p.method==='fiado')){
      if(!member){ toast('Selecione um associado para usar fiado.'); return; }
      if(memberBlockedByDebt(member)){ toast('Associado com pendência não pode usar fiado.'); return; }
      if(debtIncluded>TOLERANCIA_CENTAVO){ toast('Para lançar no fiado, desmarque "Cobrar a pendência anterior junto".'); return; }
    }
    const received = tempPayments.reduce((a,p)=>a+p.amount,0);
    if(received+TOLERANCIA_CENTAVO<finalTotal){ toast('Ainda falta '+fmt(finalTotal-received)+'.'); return; }
    const payments = tempPayments.map(p=>({...p}));
    const change = Math.max(0,received-finalTotal);
    let creditFromChange = 0;
    // Troco que sai da gaveta por excedente pago em Pix/cartão (OP-02).
    const cashChangeOut = [];
    if(change>TOLERANCIA_CENTAVO){
      if(member && changeDecision==='credito'){
        creditFromChange = change; // dinheiro fica todo registrado; excedente vira crédito do sócio
      } else {
        // O troco físico sai da gaveta: desconta primeiro das linhas em dinheiro
        // (a mais recente antes). Antes saía da última forma lançada, e "dinheiro
        // e depois Pix" gravava o Pix a menos e a gaveta fechava com falta.
        const order = payments.map((p,i)=>i).sort((a,b)=>((payments[b].method==='dinheiro')-(payments[a].method==='dinheiro')) || (b-a));
        let remaining = change;
        for(const i of order){
          if(remaining<=TOLERANCIA_CENTAVO) break;
          const p = payments[i];
          const take = arredondaCentavos(Math.min(p.amount, remaining));
          if(take<=0) continue;
          p.received = p.amount; p.change = arredondaCentavos((p.change||0)+take); p.amount = arredondaCentavos(p.amount-take); remaining = arredondaCentavos(remaining-take);
          // Excedente em Pix/cartão devolvido em dinheiro: a gaveta perde esse valor.
          if(p.method!=='dinheiro' && p.method!=='fiado') cashChangeOut.push({method:p.method, amount:take});
        }
      }
    }
    document.removeEventListener('keydown', payKeyHandler);
    const wantReceipt = !!(document.getElementById('payPrintReceipt')||{}).checked;
    // OP-15: a venda guarda como o total foi formado (antes só o total final, sem saber de cupom ou desconto).
    // A pendência sai das formas de pagamento: a venda fica só com o consumo e a pendência
    // entra como recebimento de fiado (extrato do sócio e caixa), depois da venda gravada.
    const { salePayments, debtParts } = splitDebtFromPayments(payments, debtIncluded);
    const meta = { subtotal: arredondaCentavos(subtotal), discount: arredondaCentavos(discount), couponCode: appliedCouponCode||null, creditApplied: arredondaCentavos(creditApplied||0), serviceCharge: serviceAmount, partialPaid };
    if(debtIncluded>TOLERANCIA_CENTAVO) meta.debtPaid = debtIncluded;
    const closedSaleId = await finalizeSale(mode, comandaId, memberId, salePayments, arredondaCentavos(finalTotal-debtIncluded), creditApplied, creditFromChange, meta);
    if(closedSaleId){
      if(debtParts.length) await recordDebtPaidWithSale(member, debtParts, closedSaleId);
      recordChangeOutInCash(cashChangeOut, closedSaleId);
      if(wantReceipt) printSaleReceipt(closedSaleId);
      autoEmitNfce(closedSaleId); // não espera: a venda já está registrada
      if(mode==='balcao') document.getElementById('modalRoot').dataset.confirmPdv='false';
      closeModal();
    }
  };
}
if(typeof document.addEventListener==='function') document.addEventListener('click', e=>{
  const b = e.target && e.target.closest && e.target.closest('.report-period-links button, .history-quick-links button');
  if(!b) return;
  b.parentNode.querySelectorAll('button').forEach(x=>x.classList.toggle('active', x===b));
});
function showSalePendingWarning(){
  const btn = document.getElementById('confirmPayBtn'); if(!btn || document.getElementById('salePendingWarning')) return;
  const box = document.createElement('div');
  box.id = 'salePendingWarning'; box.className = 'sale-pending-warning'; box.setAttribute('role','alert');
  box.textContent = 'O pedido já foi para a cozinha, mas a venda ainda não foi registrada. Clique em confirmar de novo antes de fechar esta tela.';
  btn.parentNode.insertBefore(box, btn);
}
/* Pendência do sócio cobrada junto no fechamento (pedido do dono, 18/10): sócio liberado com a
   senha do administrador consome com fiado em aberto; ao fechar, o total traz consumo + pendência.
   No caixa dá para desmarcar ("Cobrar a pendência anterior junto"); o garçom cobra sempre. */
function memberDebtDue(member){ return member ? Math.max(0, arredondaCentavos(Number(member.debt)||0)) : 0; }
// Separa a pendência das formas de pagamento, tirando das últimas linhas lançadas.
function splitDebtFromPayments(payments, debt){
  const salePayments = payments.map(p=>({...p})), debtParts = [];
  let remaining = arredondaCentavos(Number(debt)||0);
  for(let i=salePayments.length-1; i>=0 && remaining>TOLERANCIA_CENTAVO; i--){
    const p = salePayments[i];
    const take = arredondaCentavos(Math.min(p.amount, remaining));
    if(take<=0) continue;
    debtParts.unshift({ method:p.method, amount:take });
    p.amount = arredondaCentavos(p.amount-take); remaining = arredondaCentavos(remaining-take);
  }
  return { salePayments: salePayments.filter(p=>p.amount>TOLERANCIA_CENTAVO || p.change), debtParts };
}
// Mesmo registro do "Registrar Pagamento" da conta corrente: extrato do sócio + entrada no caixa.
async function recordDebtPaidWithSale(member, debtParts, saleId){
  try{
    for(const part of debtParts){
      const entryId = await MembersStore.recordDebtEntry(member.id, 'payment', part.amount, { reason:'Pendência paga no fechamento da venda #'+saleId, method:paymentMethodLabel(part.method), saleId });
      recordFiadoPaymentInCash(member, part.amount, part.method, entryId);
    }
    logAction('Pendência de '+member.name+' paga junto com a venda #'+saleId+' — '+fmt(debtParts.reduce((a,p)=>a+p.amount,0)));
    return true;
  }catch(e){
    // A venda já está gravada: não volta atrás, avisa para lançar o pagamento na conta corrente.
    console.error('Falha ao baixar a pendência do sócio', saleId, e);
    logAction('ATENÇÃO: venda '+saleId+' registrada, mas o pagamento da pendência de '+member.name+' NÃO foi lançado — lançar em Contas › Fiado.');
    setTimeout(()=>toast('Venda registrada, mas a pendência do sócio NÃO foi baixada. Lance o pagamento na conta corrente.'), 2700);
    return false;
  }
}
async function finalizeSale(mode, comandaId, memberId, payments, total, creditApplied, creditFromChange, saleMeta){
  saleMeta = saleMeta || {};
  const saleMember = memberId ? state.members.find(m=>m.id===memberId) : null;
  const who = memberId ? (saleMember||{}).name : (currentSaleDraft.customerName||'Cliente avulso');
  const cota = saleMember ? saleMember.code : '';
  const isExistingComanda = (mode==='comanda' && comandaId);
  const isExistingDelivery = (mode==='delivery' && comandaId);
  let orderNumber = null;
  // Venda nova: reaproveita id e numero entre tentativas da MESMA venda. Sem isso, um retry
  // depois de close_sale gravar no servidor mas a resposta se perder (timeout) gerava uid()
  // novo -> close_sale nao reconhecia o retry e duplicava a venda (e queimava outro numero).
  let pendingClose = null;
  if(!isExistingComanda && !isExistingDelivery){
    const closeKey = JSON.stringify([mode, comandaId||null, memberId||null, total, (currentSaleDraft.items||[]).map(i=>[i.productId, i.qty, i.price, !!i.canceled])]);
    pendingClose = (currentSaleDraft._pendingClose && currentSaleDraft._pendingClose.key===closeKey) ? currentSaleDraft._pendingClose : { key: closeKey, saleId: uid(), orderNumber: null };
    currentSaleDraft._pendingClose = pendingClose;
    if(pendingClose.orderNumber==null){
      try{ pendingClose.orderNumber = await nextOrderNumber(); }catch(e){ return false; }
    }
    orderNumber = pendingClose.orderNumber;
  }
  const cashDisplayId = state.cashSession ? (String(state.cashSession.displayId||state.cashSession.id||'').replace(/[^a-zA-Z0-9]/g,'').slice(-6)||'1') : null;
  const sale = {
    id: (isExistingComanda||isExistingDelivery) ? comandaId : pendingClose.saleId, type: mode, orderNumber, memberId, customerName: currentSaleDraft.customerName||'',
    items: currentSaleDraft.items, total, status:'closed', notes:currentSaleDraft.notes||'',
    payments, operatorId: currentUser.id, operatorName: currentUser.name,
    cashSessionId: state.cashSession ? state.cashSession.id : null, cashDisplayId,
    openedAt: new Date().toISOString(), closedAt: new Date().toISOString(),
    ...saleMeta
  };
  if(mode==='balcao'){
    const unsent = currentSaleDraft.items.filter(i=>!i.sent);
    if(unsent.length){
      const unsentWithEstacao = unsent.map(i=>{ const prod=state.products.find(p=>p.id===i.productId); return {...i, estacao: i.estacao || (prod&&prod.estacao) || 'cozinha'}; });
      // saleMeta.local: venda avulsa cobrada no app do garçom leva o local de entrega para a ficha.
      if(!await sendItemsToKitchen(sale.id, unsentWithEstacao, who, mode, saleMeta.local||'')) return false;
      unsent.forEach(i=>i.sent=true);
      const origem = currentUser.origem||'caixa';
      const groups = {};
      unsentWithEstacao.forEach(i=>{ const key=i.estacao||'cozinha'; (groups[key]=groups[key]||[]).push(i); });
      const printJobs = Object.keys(groups).map(estacao=>{
        const printer = resolvePrinterFor(estacao, origem);
        return { estacao, items:groups[estacao], printer: printer?printer.nome:null };
      });
      printNovoPedidoTickets(who, cota, saleMeta.local||'', printJobs, sale.orderNumber);
      // Comprovante não sai sozinho: só se o cliente pedir (printSaleReceipt).
    }
  } else if(mode==='agendamento'){
    const unsent = currentSaleDraft.items.filter(i=>!i.sent);
    if(unsent.length && !await sendItemsToKitchen(sale.id, unsent, who, mode)) return false;
    unsent.forEach(i=>i.sent=true);
  }
  if(isExistingComanda){
    // OP-01: se o garçom lançou algo enquanto o caixa recebia, o valor pago não cobre a
    // comanda. Não fecha: avisa para reabrir e conferir o total.
    const fresh = await fetchFreshSales();
    const cur = fresh && fresh.find(x=>x.id===comandaId);
    if(cur){
      if(cur.status!=='open'||cur.canceled){ state.sales = fresh; toast('Esta comanda já foi fechada ou cancelada em outro aparelho.'); return false; }
      const merged = mergeDraftItems(cur.items, currentSaleDraft.items);
      const novos = merged.extras.filter(i=>!i.canceled);
      if(novos.length){ state.sales = fresh; toast('Chegou '+novos.length+' item(ns) novo(s) nesta comanda por outro aparelho. Feche o pagamento e reabra a comanda para conferir o total.'); return false; }
      currentSaleDraft.items = merged.items;
      // OP-13: os parciais entram nas formas de pagamento da venda (marcados partial, já contados
      // no caixa quando foram recebidos) e o total da venda volta a ser o total cheio.
      const parts = (cur.partialPayments||[]).filter(p=>!p.reversed).map(p=>({method:p.method, amount:Number(p.amount)||0, partial:true, partialId:p.id, at:p.at, who:p.who||''}));
      if(parts.length){ sale.payments=[...parts, ...sale.payments]; total=arredondaCentavos(total+parts.reduce((t,p)=>t+p.amount,0)); sale.total=total; }
    }
  }
  if(isCloudMode()){
    // Grava a venda no servidor via RPC close_sale — atomica (trava a linha de
    // cantina2:sales, sem last-write-wins entre dois dispositivos) e idempotente
    // (um retry de rede com o mesmo sale.id devolve o resultado ja gravado em vez
    // de duplicar a venda).
    let patch;
    if(isExistingComanda){
      // OP-11: o sócio escolhido no pagamento vai também para a venda. Antes o fiado
      // caía no sócio escolhido e a venda continuava sem sócio (ou no antigo), e o
      // histórico, o "consumo de hoje" e o consumo do associado saíam errados.
      patch = { items:currentSaleDraft.items, total, status:'closed', payments:sale.payments, operatorId:sale.operatorId, operatorName:sale.operatorName, closedAt:sale.closedAt, ...saleMeta };
      if(memberId) patch.memberId = memberId;
    } else if(isExistingDelivery){
      const current = state.sales.find(s=>s.id===comandaId);
      patch = { memberId, customerName:currentSaleDraft.customerName||(current?current.customerName:''), items:currentSaleDraft.items, total, status:'closed', deliveryStatus:'entregue', payments:sale.payments, operatorId:sale.operatorId, operatorName:sale.operatorName, closedAt:sale.closedAt, ...saleMeta };
    } else {
      patch = sale;
    }
    const { data: savedSale, error } = await supabaseClient.rpc('close_sale', { p_sale_id: sale.id, p_existing: !!(isExistingComanda||isExistingDelivery), p_sale_patch: patch });
    if(error){
      // OP-12: no balcão a comida já foi para a cozinha antes deste ponto. Se o
      // operador desistir aqui, sai pedido sem venda: o aviso fica fixo na tela.
      if(mode==='balcao' && (currentSaleDraft.items||[]).some(i=>i.sent)) showSalePendingWarning();
      toast('Não foi possível registrar a venda agora. Tente de novo.'); return false;
    }
    const idx = state.sales.findIndex(s=>s.id===sale.id);
    if(idx>-1) state.sales[idx] = savedSale; else state.sales.push(savedSale);
    markSaleServer(savedSale);
  } else {
    if(mode==='comanda' && comandaId){
      const idx = state.sales.findIndex(s=>s.id===comandaId);
      if(idx>-1) state.sales[idx] = {...state.sales[idx], ...(memberId?{memberId}:{}), items:currentSaleDraft.items, total, status:'closed', payments:sale.payments, operatorId:sale.operatorId, operatorName:sale.operatorName, closedAt:sale.closedAt};
    } else if(isExistingDelivery){const idx=state.sales.findIndex(s=>s.id===comandaId);if(idx>-1)state.sales[idx]={...state.sales[idx],memberId,customerName:currentSaleDraft.customerName||state.sales[idx].customerName,items:currentSaleDraft.items,total,status:'closed',deliveryStatus:'entregue',payments:sale.payments,operatorId:sale.operatorId,operatorName:sale.operatorName,closedAt:sale.closedAt};}
    else { state.sales.push(sale); }
    save('sales');
  }
  if(mode==='agendamento' && comandaId){
    const sch = state.scheduled.find(x=>x.id===comandaId);
    if(sch){ sch.status='entregue'; save('scheduled'); }
  }
  const fiadoTotal = payments.filter(p=>p.method==='fiado').reduce((a,p)=>a+p.amount,0);
  let fiadoMemberForPrompt = null;
  try{
  if(fiadoTotal>0 && memberId){
    const m = state.members.find(x=>x.id===memberId);
    if(m){ await MembersStore.recordDebtEntry(m.id, 'debt', fiadoTotal, { reason:'Venda #'+sale.id, saleId: sale.id }); fiadoMemberForPrompt = m; }
  }
  if(Number(creditApplied)>TOLERANCIA_CENTAVO && memberId){
    const m = state.members.find(x=>x.id===memberId);
    if(m) await MembersStore.recordDebtEntry(m.id, 'debt', creditApplied, { reason:'Uso de crédito na venda #'+sale.id, saleId: sale.id });
  }
  if(Number(creditFromChange)>TOLERANCIA_CENTAVO && memberId){
    const m = state.members.find(x=>x.id===memberId);
    if(m) await MembersStore.recordDebtEntry(m.id, 'payment', creditFromChange, { reason:'Crédito de troco — Venda #'+sale.id, saleId: sale.id });
  }
  await applyAutomaticLoyalty(memberId,total,sale.id);
  }catch(e){
    // A venda JA esta gravada (close_sale). Nao devolve false: o operador tentaria de novo e
    // duplicaria os lancamentos que ja entraram. Avisa e registra pra conferencia manual.
    console.error('Falha ao lancar fiado/credito/pontos da venda', sale.id, e);
    logAction('ATENÇÃO: venda '+sale.id+' registrada, mas fiado/crédito/pontos do sócio NÃO foram lançados por erro — conferir no extrato do sócio.');
    setTimeout(()=>toast('Venda registrada, mas o fiado/crédito do sócio NÃO foi lançado. Confira o extrato do sócio.'), 2700);
  }
  // Comprovante só quando o cliente pede (decisão de 12/10): botão "Imprimir comprovante" no
  // detalhe da comanda (printSaleReceipt). Antes saía sozinho na venda de balcão.
  newDraft(mode); toast('Venda registrada.'); logAction('Venda registrada — '+fmt(total)); renderAll();
  if(fiadoMemberForPrompt) promptWhatsAppCollection(fiadoMemberForPrompt);
  return sale.id;
}

