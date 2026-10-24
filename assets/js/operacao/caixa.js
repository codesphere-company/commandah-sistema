/* ============ CAIXA ============ */
let selectedCashMovementId=null;
function selectCashMovement(id){selectedCashMovementId=id;document.querySelectorAll('[data-cash-movement]').forEach(row=>row.classList.toggle('selected',row.dataset.cashMovement===id));const edit=document.getElementById('cashEditMovement'),del=document.getElementById('cashDeleteMovement');if(edit)edit.disabled=!id;if(del)del.disabled=!id;}
function deleteSelectedCashMovement(){if(!selectedCashMovementId)return;const movement=state.cashMovements.find(x=>x.id===selectedCashMovementId);if(!movement||movement.cashSessionId!==state.cashSession?.id){toast('Selecione um lançamento manual deste caixa.');return;}if(!cashMovementEditable(movement))return;if(!confirm('Excluir este lançamento do caixa?'))return;state.cashMovements=state.cashMovements.filter(x=>x.id!==selectedCashMovementId);save('cashMovements');logAction('Lançamento de caixa excluído — '+fmt(movement.amount));selectedCashMovementId=null;renderAll();toast('Lançamento excluído.');}
function enhanceCashMovementGrid(){
  const view=document.getElementById('view-caixa');if(!view||!state.cashSession)return;
  const rows=[...view.querySelectorAll('.cash-movement-table tbody tr')],movements=state.cashMovements.filter(m=>m.cashSessionId===state.cashSession.id);
  rows.forEach(row=>{const description=row.cells&&row.cells[1]&&row.cells[1].textContent||'',date=row.cells&&row.cells[0]&&row.cells[0].textContent||'';const movement=movements.find(m=>description.includes(m.description||m.reason||'')&&new Date(m.at).toLocaleString('pt-BR')===date);if(!movement)return;row.dataset.cashMovement=movement.id;row.onclick=()=>selectCashMovement(movement.id);row.ondblclick=()=>openCashMovementModal(null,movement.id);row.classList.toggle('selected',movement.id===selectedCashMovementId);});
  const buttons=view.querySelectorAll('.cash-window-actions button'),deleteButton=buttons[2];if(!deleteButton)return;deleteButton.id='cashDeleteMovement';deleteButton.disabled=!selectedCashMovementId;deleteButton.onclick=deleteSelectedCashMovement;if(!document.getElementById('cashEditMovement'))deleteButton.insertAdjacentHTML('beforebegin',`<button class="op-btn" id="cashEditMovement" onclick="openCashMovementModal(null,selectedCashMovementId)" ${selectedCashMovementId?'':'disabled'}>✎ Editar Lançamento</button>`);
}
function renderCaixa(){
  const el = document.getElementById('view-caixa');
  const s = state.cashSession;
  if(!s || s.status==='closed'){
    // Pedido do dono (10/10): a abertura vem com o dinheiro contado no último fechamento.
    const lastClosed = (state.cashHistory||[]).filter(c=>c.closedAt).sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt))[0];
    const lastCounted = lastClosed && Number.isFinite(Number(lastClosed.countedAmount)) ? Number(lastClosed.countedAmount) : null;
    el.innerHTML = `<div class="consumer-workspace"><section class="cash-window"><header class="cash-title">Caixa</header><div class="cash-layout"><aside class="cash-side"><div class="cash-state">Caixa Fechado</div><div class="field"><label>Saldo inicial (dinheiro)</label><input type="number" id="openAmount" step="0.01" value="${lastCounted!==null?lastCounted.toFixed(2):'0.00'}">${lastCounted!==null?`<small class="sub">Contado no fechamento de ${reportDateTime(lastClosed.closedAt)}. Confira a gaveta.</small>`:''}</div><div class="field"><label>Observação</label><textarea id="openNote" rows="5"></textarea></div><button class="op-btn primary" id="btnOpenCash" style="width:100%"><span class="op-ico">▷</span> Abrir Caixa</button></aside><div class="cash-main"><div class="cash-id">ID do Caixa: <b>[Fechado]</b></div><h2 style="text-transform:none">Caixa de ${h(currentUser.name.toLowerCase())}</h2><div class="cash-empty">Não há entradas ou saídas.<br>(Caixa fechado).<br>Clique em “Abrir Caixa” para iniciar as vendas.</div></div></div></section>${renderCashHistoryPanel()}</div>`;
    document.getElementById('btnOpenCash').onclick = async (ev)=>{
      const v = parseFloat(document.getElementById('openAmount').value)||0;
      const session = { id:uid(), displayId:(state.cashHistory.length||0)+1, openedAt:new Date().toISOString(), openingAmount:v, openingNote:document.getElementById('openNote').value.trim(), status:'open', operatorName: currentUser.name };
      if(isCloudMode()){
        // BD-03: o servidor só abre se não houver caixa aberto (outro aparelho pode ter aberto).
        const btn = ev && ev.currentTarget; if(btn) btn.disabled = true;
        const { data, error } = await supabaseClient.rpc('cash_session_open', { p_session: session });
        if(error || !data){ if(btn) btn.disabled = false; toast('Não foi possível abrir o caixa: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.', 'error'); return; }
        state.cashSession = data.session;
        if(!data.ok){
          const o = data.session||{};
          toast('O caixa já estava aberto'+(o.operatorName?' por '+o.operatorName:'')+(o.openedAt?' desde '+new Date(o.openedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'')+'. Este aparelho passou a usar o mesmo caixa.');
          await refreshCashState(); renderAll(); return;
        }
      } else { state.cashSession = session; save('cashSession'); }
      toast('Caixa aberto.'); logAction('Caixa aberto'); renderAll();
    };
    return;
  }
  const salesInSession = state.sales.filter(sl=>saleCountsAsRevenue(sl) && new Date(sl.closedAt) >= new Date(s.openedAt));
  const movements = state.cashMovements.filter(m=>m.cashSessionId===s.id);
  // Pagamento parcial (OP-13) conta uma vez só, como no fechamento: pelo movimento que entrou no
  // caixa na hora, e não de novo pela linha partial:true da venda. Antes a tela somava os dois e o
  // dinheiro esperado e o total geral ficavam maiores que o fechamento.
  const totals = cashSessionTotals(salesInSession, movements);
  const manual = movements.filter(m=>!isPartialMovement(m));
  const suprimentos = manual.filter(m=>m.type==='suprimento').reduce((a,m)=>a+m.amount,0);
  const sangrias = manual.filter(m=>m.type==='sangria').reduce((a,m)=>a+m.amount,0);
  const suprimentosDinheiro=manual.filter(m=>m.type==='suprimento'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+m.amount,0);
  const sangriasDinheiro=manual.filter(m=>m.type==='sangria'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+m.amount,0);
  // Fiado é venda a receber: não entra no caixa. Fica fora das entradas e do "TUDO"
  // e aparece separado no resumo; o recebimento entra quando o sócio paga.
  const totalVendido = Object.values(totals).reduce((a,b)=>a+b,0) - totals.fiado;
  const esperadoDinheiro = s.openingAmount + totals.dinheiro + suprimentosDinheiro - sangriasDinheiro;
  const saleRows=[];
  salesInSession.forEach(sl=>(sl.payments||[]).filter(p=>!p.partial).forEach(p=>{ const fiado = methodBucket(p.method)==='fiado'; saleRows.push({at:sl.closedAt,description:'PEDIDO #'+(sl.orderNumber||'—')+(fiado?' — fiado, a receber '+fmt(p.amount):''),entry:fiado?0:p.amount,exit:0,method:paymentMethodLabel(p.method)}); }));
  movements.forEach(m=>saleRows.push({id:m.id,at:m.at,description:(m.type==='suprimento'?'ENTRADA — ':'SAÍDA — ')+(m.description||m.reason||''),entry:m.type==='suprimento'?m.amount:0,exit:m.type==='sangria'?m.amount:0,method:paymentMethodLabel(m.method||'dinheiro')}));
  saleRows.sort((a,b)=>new Date(a.at)-new Date(b.at));
  const movementRows=[{at:s.openedAt,description:'SALDO INICIAL',entry:Number(s.openingAmount)||0,exit:0,method:'Dinheiro'},...saleRows];
  const caixaId=String(s.displayId||s.id||'').replace(/[^a-zA-Z0-9]/g,'').slice(-6)||'1';
  el.innerHTML=`<div class="consumer-workspace"><section class="cash-window"><header class="cash-title">Caixa de ${h((s.operatorName||currentUser.name).toLowerCase())} — Id: ${h(caixaId)}</header><div class="cash-open-layout"><aside class="cash-open-side"><div class="cash-state opened">Caixa Aberto</div><div class="cash-readonly-label">Saldo inicial (dinheiro):</div><div class="cash-readonly-value">${fmt(s.openingAmount)}</div><div class="cash-readonly-label" style="margin-top:20px">Observação:</div><div class="cash-open-note">${h(s.openingNote||`Aberto às ${timeFmt(s.openedAt)} por ${s.operatorName||currentUser.name}`)}</div><div class="cash-open-date"><b>Data / Hora de abertura:</b><br>${new Date(s.openedAt).toLocaleString('pt-BR')}</div></aside><main class="cash-movement-area"><h2>Caixa de ${h((s.operatorName||currentUser.name).toLowerCase())}</h2><div class="cash-section-title">Movimentação</div><label class="cash-movement-filter"><input type="checkbox" id="cashShowReversed"> Exibir pagamentos estornados e descontos de pedidos</label><div class="cash-movement-table"><table><thead><tr><th>Data / Hora</th><th>Descrição</th><th>Entrada</th><th>Saída</th><th>Forma Pagto.</th></tr></thead><tbody>${movementRows.map(r=>`<tr><td>${new Date(r.at).toLocaleString('pt-BR')}</td><td>${h(r.description)}</td><td class="mono">${r.entry?fmt(r.entry):''}</td><td class="mono">${r.exit?fmt(r.exit):''}</td><td>${h(r.method)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2"></td><td class="mono">${fmt((Number(s.openingAmount)||0)+totalVendido+suprimentos)}</td><td class="mono">${fmt(sangrias)}</td><td></td></tr></tfoot></table></div></main><aside class="cash-summary"><div class="cash-section-title">Resumo</div><div class="cash-summary-line">Saldo inicial: <b class="mono">${fmt(s.openingAmount)}</b></div><div class="cash-summary-line">Entradas no caixa</div>${totalVendido+suprimentos?`<div class="cash-summary-empty">Vendas recebidas: ${fmt(totalVendido)}<br>Entradas: ${fmt(suprimentos)}</div>`:'<div class="cash-summary-empty">Não há registros de entrada</div>'}${totals.fiado?`<div class="cash-summary-empty">Vendido no fiado (a receber, fora do caixa): ${fmt(totals.fiado)}</div>`:''}<div class="cash-summary-line">Saídas do caixa</div>${sangrias?`<div class="cash-summary-empty">Saídas: ${fmt(sangrias)}</div>`:'<div class="cash-summary-empty">Não há registros de saída</div>'}<div class="cash-summary-total"><div class="cash-summary-line">Saldo final</div><div class="cash-summary-line">Dinheiro esperado na gaveta: <b class="mono">${fmt(esperadoDinheiro)}</b></div><div class="cash-summary-line">Total (todas as formas): <b class="mono">${fmt((Number(s.openingAmount)||0)+totalVendido+suprimentos-sangrias)}</b></div></div></aside><footer class="cash-window-actions"><button class="op-btn" onclick="openCashMovementModal()">＋ Novo Lançamento</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button><button class="op-btn" disabled>Excluir Lançamento</button><button class="op-btn primary" onclick="openCloseCashModal()">Fechar Caixa</button></footer></div></section>${renderCashHistoryPanel()}</div>`;
}

// OP-13: pagamento parcial de comanda entra no caixa na hora (movimento origin 'parcial'), por
// forma de pagamento; quando a comanda fecha, essas linhas vêm marcadas partial:true na venda e
// não são contadas de novo. Estorno de parcial ('parcial-estorno') desconta da mesma forma.
// OP-14 (decisão do dono, 10/10): comanda de sócio pode ficar aberta depois do fechamento do
// caixa; ela conta no fechamento do dia em que abriu, como "a receber". Quando é paga num caixa
// seguinte, o dinheiro entra na gaveta daquele caixa mas aparece separado, como recebimento de
// dia anterior. Comanda avulsa (sem sócio) só paga à vista: o caixa não fecha com ela aberta.
// Totais por forma do caixa: as vendas fechadas na sessão sem as linhas de parcial, mais os
// parciais (e seus estornos) que entraram no caixa como movimento. Tela do caixa aberto e fechamento.
function isPartialMovement(m){ return m.origin==='parcial' || m.origin==='parcial-estorno'; }
function cashSessionTotals(sales, movements){
  const totals = somaPorForma(sales, {pularParcial:true});
  movements.filter(isPartialMovement).forEach(m=>{ totals[methodBucket(m.method||'dinheiro')] += (m.origin==='parcial-estorno'?-1:1)*(Number(m.amount)||0); });
  return totals;
}
function cashOpenComandas(){ return state.sales.filter(sl=>sl.status==='open'&&!sl.canceled&&sl.type==='comanda'); }
function comandaDue(sl){ return Math.max(0,(Number(sl.total)||0)-comandaPartialPaid(sl)); }
function lastCashCloseBefore(session){ const opened=new Date(session.openedAt).getTime(); let last=null; (state.cashHistory||[]).forEach(c=>{ const t=new Date(c.closedAt).getTime(); if(Number.isFinite(t)&&t<=opened&&(last===null||t>last)) last=t; }); return last; }
function saleOpenedBeforeClose(sl,lastClose){ return lastClose!==null && !!sl.openedAt && new Date(sl.openedAt).getTime()<lastClose; }
function cashClosingSnapshot(){const s=state.cashSession;if(!s)return null;const sales=state.sales.filter(sl=>saleCountsAsRevenue(sl)&&new Date(sl.closedAt)>=new Date(s.openedAt));const movements=state.cashMovements.filter(m=>m.cashSessionId===s.id),totals=cashSessionTotals(sales,movements),manual=movements.filter(m=>!isPartialMovement(m));const suprimentos=manual.filter(m=>m.type==='suprimento').reduce((a,m)=>a+(Number(m.amount)||0),0),sangrias=manual.filter(m=>m.type==='sangria').reduce((a,m)=>a+(Number(m.amount)||0),0),cashIn=manual.filter(m=>m.type==='suprimento'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+(Number(m.amount)||0),0),cashOut=manual.filter(m=>m.type==='sangria'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+(Number(m.amount)||0),0),totalVendido=Object.values(totals).reduce((a,b)=>a+b,0),money=(Number(s.openingAmount)||0)+totals.dinheiro+cashIn-cashOut,final=(Number(s.openingAmount)||0)+totalVendido+suprimentos-sangrias;const lastClose=lastCashCloseBefore(s),earlier=sales.filter(sl=>saleOpenedBeforeClose(sl,lastClose)),earlierReceived=Math.round(earlier.reduce((a,sl)=>a+(sl.payments||[]).filter(p=>!p.partial&&methodBucket(p.method)!=='fiado').reduce((b,p)=>b+(Number(p.amount)||0),0),0)*100)/100,open=cashOpenComandas(),openToday=open.filter(sl=>!saleOpenedBeforeClose(sl,lastClose)),openEarlier=open.filter(sl=>saleOpenedBeforeClose(sl,lastClose)),openTotal=Math.round(openToday.reduce((a,sl)=>a+comandaDue(sl),0)*100)/100;return{s,totals,suprimentos,sangrias,totalVendido,money,final,earlierReceived,earlierCount:earlier.length,openToday,openEarlier,openTotal};}
// PROD-05 (decisão do dono: conferência às cegas obrigatória). Antes o "dinheiro esperado"
// aparecia antes da contagem e o operador tendia a "achar" o valor esperado. Agora: 1) conta
// a gaveta e informa o total da maquininha sem ver o esperado; 2) "Conferir" mostra esperado x
// contado por forma; 3) só então finaliza. O valor do cartão informado fica no histórico.
async function openCloseCashModal(){if(isCloudMode()){await refreshCashState();if(!state.cashSession){renderAll();toast('Este caixa já foi fechado em outro aparelho.','error');return;}}await fetchFreshSales();const avulsas=cashOpenComandas().filter(sl=>!sl.memberId);if(avulsas.length){openModal('Comandas avulsas em aberto',`<p class="sub">Cliente avulso só paga à vista. Receba ou cancele ${avulsas.length===1?'esta comanda':'estas '+avulsas.length+' comandas'} antes de fechar o caixa.</p><div class="cash-open-list">${avulsas.map(sl=>`<button type="button" class="cash-open-row" onclick="closeModal();openComanda(${jsArg(sl.id)})"><span>#${h(sl.orderNumber||'—')} · ${h(sl.customerName||'Avulso')}</span><span class="mono">${fmt(comandaDue(sl))}</span></button>`).join('')}</div><div class="cash-close-actions"><button onclick="closeModal()">‹ &nbsp; Voltar</button></div>`);return;}const snap=cashClosingSnapshot();if(!snap)return;openModal('Fechamento do Caixa',`<div class="cash-close-body"><h2>Conte o caixa antes de ver o esperado</h2><p class="sub">Informe o que você contou. O sistema só mostra o valor esperado depois.</p><div class="cash-count-grid"><div class="field"><label>Dinheiro contado na gaveta *</label><input id="cashCountedAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div><div class="field"><label>Total da maquininha (cartão)</label><input id="cashCountedCard" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Opcional"></div></div><div id="cashCheckResult" hidden></div><div class="cash-close-actions" id="cashCloseStep1"><button onclick="closeModal()">‹ &nbsp; Voltar</button><button class="primary" onclick="checkCashCount()">Conferir contagem</button></div><div class="cash-close-actions" id="cashCloseStep2" hidden><button onclick="editCashCount()">‹ &nbsp; Corrigir contagem</button><button onclick="finalizeCashSession(true)">▣ &nbsp; Finalizar e imprimir</button><button class="primary" onclick="finalizeCashSession(false)">✓ &nbsp; Finalizar</button></div></div>`);document.querySelector('#modalRoot .modal').classList.add('cash-close-modal');setTimeout(()=>document.getElementById('cashCountedAmount')?.focus(),50);}
function checkCashCount(){
  const snap=cashClosingSnapshot(); if(!snap) return;
  const cash=parseFloat(document.getElementById('cashCountedAmount').value), cardRaw=document.getElementById('cashCountedCard').value;
  if(!Number.isFinite(cash)||cash<0){ toast('Informe o dinheiro contado na gaveta.'); document.getElementById('cashCountedAmount').focus(); return; }
  const card = cardRaw===''?null:parseFloat(cardRaw);
  const line=(label,exp,got)=>{ if(got===null) return `<tr><td>${label}</td><td class="mono">${fmt(exp)}</td><td class="sub">não informado</td><td></td></tr>`; const d=Math.round((got-exp)*100)/100; return `<tr><td>${label}</td><td class="mono">${fmt(exp)}</td><td class="mono">${fmt(got)}</td><td class="mono ${Math.abs(d)<0.01?'cash-ok':d<0?'cash-short':'cash-over'}">${Math.abs(d)<0.01?'Confere':(d<0?'Falta ':'Sobra ')+fmt(Math.abs(d))}</td></tr>`; };
  const box=document.getElementById('cashCheckResult');
  box.innerHTML=`<table class="cash-check-table"><thead><tr><th></th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead><tbody>${line('Dinheiro',snap.money,cash)}${line('Cartão',snap.totals.cartao,card)}</tbody></table><p class="cash-close-note">Esperado em dinheiro = troco inicial + vendas e entradas em dinheiro − sangrias em dinheiro. Pix recebido: ${fmt(snap.totals.pix)} · Outros: ${fmt(snap.totals.outros)} · Vendido no fiado (a receber): ${fmt(snap.totals.fiado)}</p>${snap.earlierReceived>0.009?`<p class="cash-close-note">Inclui ${fmt(snap.earlierReceived)} de ${snap.earlierCount===1?'1 comanda aberta':snap.earlierCount+' comandas abertas'} em dia anterior (já contadas no fechamento daquele dia).</p>`:''}${snap.openToday.length?`<div class="cash-open-summary"><b>Comandas que continuam abertas (a receber): ${fmt(snap.openTotal)}</b><p class="sub">Contam neste fechamento. Quando forem pagas, o valor entra no caixa do dia.</p><div class="cash-open-list">${snap.openToday.map(sl=>`<div class="cash-open-row"><span>#${h(sl.orderNumber||'—')} · ${h(sl.customerName||'—')}</span><span class="mono">${fmt(comandaDue(sl))}</span></div>`).join('')}</div></div>`:''}${snap.openEarlier.length?`<p class="cash-close-note">Ainda abertas de dias anteriores: ${snap.openEarlier.map(sl=>'#'+h(sl.orderNumber||'—')+' '+h(sl.customerName||'')).join(', ')} (já contadas no dia em que abriram).</p>`:''}`;
  box.hidden=false;
  ['cashCountedAmount','cashCountedCard'].forEach(id=>document.getElementById(id).readOnly=true);
  document.getElementById('cashCloseStep1').hidden=true; document.getElementById('cashCloseStep2').hidden=false;
}
function editCashCount(){
  ['cashCountedAmount','cashCountedCard'].forEach(id=>document.getElementById(id).readOnly=false);
  document.getElementById('cashCheckResult').hidden=true;
  document.getElementById('cashCloseStep1').hidden=false; document.getElementById('cashCloseStep2').hidden=true;
  document.getElementById('cashCountedAmount').focus();
}
async function finalizeCashSession(printAfter){const snap=cashClosingSnapshot();if(!snap)return;const step2=document.getElementById('cashCloseStep2');if(step2&&step2.hidden){checkCashCount();return;}const countedInput=document.getElementById('cashCountedAmount'),countedAmount=parseFloat(countedInput&&countedInput.value),cardInput=document.getElementById('cashCountedCard'),countedCard=cardInput&&cardInput.value!==''?parseFloat(cardInput.value):null;if(!Number.isFinite(countedAmount)||countedAmount<0){toast('Informe o valor contado na gaveta.');countedInput&&countedInput.focus();return;}const diff=countedAmount-snap.money;const closed={...snap.s,status:'closed',closedAt:new Date().toISOString(),totals:snap.totals,suprimentos:snap.suprimentos,sangrias:snap.sangrias,countedAmount,expectedAmount:snap.money,diff,countedCard,expectedCard:snap.totals.cartao,blindCount:true,closedBy:currentUser.name,earlierReceived:snap.earlierReceived,openComandas:snap.openToday.map(sl=>({id:sl.id,orderNumber:sl.orderNumber||null,name:sl.customerName||'',memberId:sl.memberId||null,due:comandaDue(sl),openedAt:sl.openedAt})),openComandasTotal:snap.openTotal};if(isCloudMode()){/* BD-03: fecha só se o caixa aberto no servidor ainda for este; o histórico dos outros não é regravado */await save('cashMovements');const {data,error}=await supabaseClient.rpc('cash_session_close',{p_session_id:closed.id,p_closed:closed});if(error||!data){toast('Não foi possível fechar o caixa: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.','error');return;}if(!data.ok){document.getElementById('modalRoot').innerHTML='';await refreshCashState();renderAll();toast('Este caixa já foi fechado em outro aparelho. Confira em Relatórios › Histórico do Caixa.','error');return;}state.cashHistory.unshift(closed);state.cashSession=null;}else{state.cashHistory.unshift(closed);state.cashSession=null;save('cashHistory');save('cashSession');}document.getElementById('modalRoot').innerHTML='';logAction('Caixa fechado — contado '+fmt(countedAmount)+(Math.abs(diff)>=0.01?' (diferença '+fmt(diff)+')':''));renderAll();toast(Math.abs(diff)>=0.01?'Caixa fechado com diferença de '+fmt(diff)+'.':'Caixa fechado.');if(printAfter)setTimeout(()=>window.print(),100);}
// Dois toques em Finalizar: o segundo esperaria a resposta do primeiro e diria "já fechado em outro aparelho".
const _finalizeCashSessionOnce=finalizeCashSession;let _closingCash=false;
finalizeCashSession=async function(printAfter){if(_closingCash)return;_closingCash=true;try{return await _finalizeCashSessionOnce(printAfter);}finally{_closingCash=false;}};
// OP-17 (decisão do dono: só admin): sangria/suprimento já lançados só são editados ou
// excluídos por administrador ou dono; os automáticos (fiado, troco, estorno) não se
// apagam à mão — estorna-se pela origem, para o caixa e o fiado continuarem batendo.
function cashMovementEditable(m){
  if(m && m.origin){ toast('Lançamento automático ('+(m.origin==='troco'?'troco':'fiado')+'): não pode ser alterado aqui. Estorne pela origem.'); return false; }
  if(!(currentUser && (currentUser.role==='admin' || sessionIsOwner))){ toast('Só o administrador pode alterar ou excluir lançamentos do caixa.'); return false; }
  return true;
}
function openCashMovementModal(initialType,movementId){
  if(!state.cashSession){ toast('Abra o caixa primeiro.'); return; }
  if(movementId){ const m=state.cashMovements.find(x=>x.id===movementId); if(m && !cashMovementEditable(m)) return; }
  const item=movementId?state.cashMovements.find(x=>x.id===movementId&&x.cashSessionId===state.cashSession.id):null,now=item?new Date(item.at):new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16),selected=item?item.type:(initialType==='sangria'?'sangria':'suprimento');
  openModal('Novo Lançamento', `<div class="cash-entry-body"><div class="cash-entry-kind"><label><input type="radio" name="cmType" value="suprimento" ${selected==='suprimento'?'checked':''}> Entrada no caixa</label><label><input type="radio" name="cmType" value="sangria" ${selected==='sangria'?'checked':''}> Saída do caixa</label></div><div class="cash-entry-form"><div class="field"><label>Data / Hora</label><input id="cmAt" type="datetime-local" value="${local}"></div><div class="field"><label>Forma de pagamento</label><select id="cmMethod"><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="pix">Pix</option><option value="outro:Cheque">Cheque</option><option value="outro:Vale">Vale / Recibo</option><option value="outro:Outro">Outro</option></select></div><div class="field span2"><label>Descrição</label><input id="cmReason" placeholder="Informe a descrição do lançamento"></div><div class="field"><label>Valor</label><input id="cmAmount" type="number" min="0.01" step="0.01" placeholder="0,00"></div><div class="field"><label>Operador</label><input value="${h(currentUser.name)}" disabled></div><div class="field span2"><label>Observação</label><textarea id="cmNote" rows="3" placeholder="Informações complementares (opcional)"></textarea></div></div><div class="cash-entry-actions"><button class="op-btn" onclick="closeModal()">‹ &nbsp; Voltar</button><button class="op-btn primary" id="cmSaveBtn">✓ &nbsp; Salvar</button></div></div>`);
  document.querySelector('#modalRoot .modal').classList.add('cash-entry-modal');
  if(item){document.querySelector('#modalRoot .modal-title').textContent='Editar Lançamento';document.getElementById('cmMethod').value=item.method||'dinheiro';document.getElementById('cmReason').value=item.description||item.reason||'';document.getElementById('cmAmount').value=Number(item.amount)||0;document.getElementById('cmNote').value=item.note||'';}
  document.getElementById('cmSaveBtn').onclick = ()=>{
    const type=document.querySelector('input[name="cmType"]:checked').value,amount=parseFloat(document.getElementById('cmAmount').value),description=document.getElementById('cmReason').value.trim(),method=document.getElementById('cmMethod').value,atValue=document.getElementById('cmAt').value,note=document.getElementById('cmNote').value.trim();
    if(!amount || amount<=0 || !description || !atValue){ toast('Informe data, descrição e valor válido.'); return; }
    const at=new Date(atValue);if(Number.isNaN(at.getTime())){toast('Informe uma data e hora válidas.');return;}
    const data={cashSessionId:state.cashSession.id,type,amount,reason:description,description,method,note,operatorId:currentUser.id,operatorName:currentUser.name,at:at.toISOString()};if(item){const cur=state.cashMovements.find(x=>x.id===item.id);if(!cur){toast('Este lançamento foi apagado em outro aparelho.','error');closeModal();renderAll();return;}Object.assign(cur,data,{editedAt:new Date().toISOString(),editedBy:currentUser.name});}else state.cashMovements.unshift({id:uid(),...data});
    const label=type==='suprimento'?'Entrada':'Saída';save('cashMovements');closeModal();selectedCashMovementId=null;logAction((item?'Edição de ':'')+label.toLowerCase()+' de caixa — '+fmt(amount));renderAll();toast(item?'Lançamento atualizado.':label+' registrada.');
  };
}
function renderCashHistoryPanel(){
  if(!state.cashHistory.length) return '';
  const rows = state.cashHistory.slice(0,10).map(h=>`
    <tr><td>${new Date(h.openedAt).toLocaleDateString('pt-BR')}</td><td class="mono">${fmt(h.openingAmount)}</td>
    <td class="mono">${fmt(Object.values(h.totals).reduce((a,b)=>a+b,0))}</td><td class="mono">${fmt(h.countedAmount)}</td>
    <td class="mono" style="color:${Math.abs(h.diff)<0.01?'var(--green)':'var(--red)'}">${fmt(h.diff)}</td>
    <td>${h.closedBy||'—'}</td></tr>`).join('');
  return `<div class="panel"><h2>Histórico de fechamentos</h2>
    <table><tr><th>Data</th><th>Abertura</th><th>Vendido</th><th>Contado</th><th>Diferença</th><th>Fechado por</th></tr>${rows}</table></div>`;
}

