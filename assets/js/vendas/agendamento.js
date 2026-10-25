/* ============ AGENDAMENTO DE PEDIDOS ============ */
function typeLabel(t){ return t==='balcao'?'Balcão':t==='comanda'?'Comanda':t==='agendamento'?'Agendamento':t==='totem'?'Totem':t; }
/* Pagamento de fiado recebido com o caixa aberto vira entrada no caixa. Antes ele
   só ia pro extrato do sócio: o dinheiro entrava na gaveta e o fechamento acusava
   sobra. Sem caixa aberto (ex.: lançamento retroativo) fica só no extrato. */
function recordFiadoPaymentInCash(member, value, methodLabel, debtEntryId){
  if(!state.cashSession) return;
  const method = ({'Dinheiro':'dinheiro','Pix':'pix','Cartão':'cartao'})[methodLabel] || methodLabel || 'dinheiro';
  const description = 'Recebimento de fiado — '+member.name;
  state.cashMovements.unshift({id:uid(), cashSessionId:state.cashSession.id, type:'suprimento', amount:arredondaCentavos(Number(value)), reason:description, description, method, note:'', origin:'fiado', debtEntryId:debtEntryId||null, operatorId:currentUser.id, operatorName:currentUser.name, at:new Date().toISOString()});
  save('cashMovements');
}
// OP-06: estornar um pagamento de fiado também tira o valor do caixa. Com o caixa
// do recebimento ainda aberto, a entrada sai; se ele já fechou, entra uma saída de
// mesmo valor no caixa aberto agora (sem caixa aberto, avisa).
function reverseFiadoPaymentInCash(member, entry){
  const value = arredondaCentavos(Number(entry.value));
  const desc = 'Recebimento de fiado — '+member.name;
  let mv = state.cashMovements.find(x=>x.origin==='fiado' && x.debtEntryId===entry.id);
  // Lançamentos de antes deste vínculo: mesma descrição e valor, no caixa aberto, o mais próximo do horário.
  if(!mv && state.cashSession){
    const t = new Date(entry.at).getTime();
    mv = state.cashMovements.filter(x=>x.origin==='fiado' && !x.debtEntryId && x.cashSessionId===state.cashSession.id && x.description===desc && Math.abs((Number(x.amount)||0)-value)<0.005)
      .sort((a,b)=>Math.abs(new Date(a.at).getTime()-t)-Math.abs(new Date(b.at).getTime()-t))[0];
  }
  // Sem entrada achada: foi recebido com o caixa fechado (nunca entrou em caixa) ou é antigo demais.
  if(!mv){ if(state.cashSession) toast('Este recebimento não aparece no caixa. Se o dinheiro saiu da gaveta, lance a saída em Caixa.'); return; }
  if(state.cashSession && mv.cashSessionId===state.cashSession.id){
    state.cashMovements = state.cashMovements.filter(x=>x.id!==mv.id);
    save('cashMovements');
    return;
  }
  if(!state.cashSession){ toast('Caixa fechado: lance a devolução de '+fmt(value)+' manualmente quando abrir o caixa.'); return; }
  const description = 'Estorno de recebimento de fiado — '+member.name;
  state.cashMovements.unshift({id:uid(), cashSessionId:state.cashSession.id, type:'sangria', amount:value, reason:description, description, method:mv.method||'dinheiro', note:'', origin:'fiado-estorno', debtEntryId:entry.id, operatorId:currentUser.id, operatorName:currentUser.name, at:new Date().toISOString()});
  save('cashMovements');
}
// Devolução em dinheiro de excedente pago em Pix/cartão (decisão do dono no OP-02:
// permitir e lançar como saída do caixa, para o dinheiro esperado bater com a gaveta).
function recordChangeOutInCash(list, saleId){
  const total = Math.round((list||[]).reduce((a,x)=>a+(Number(x.amount)||0),0)*100)/100;
  if(total<=TOLERANCIA_CENTAVO) return;
  if(!state.cashSession){ toast('Troco de '+fmt(total)+' em dinheiro sem caixa aberto: não entrou em nenhum fechamento.'); return; }
  const methods = [...new Set(list.map(x=>paymentMethodLabel(x.method)))].join(', ');
  const description = 'Troco em dinheiro de excedente pago em '+methods;
  state.cashMovements.unshift({id:uid(), cashSessionId:state.cashSession.id, type:'sangria', amount:total, reason:description, description, method:'dinheiro', note:'', origin:'troco', saleId:saleId||null, operatorId:currentUser.id, operatorName:currentUser.name, at:new Date().toISOString()});
  save('cashMovements');
  toast('Troco de '+fmt(total)+' lançado como saída de dinheiro do caixa.');
}
let scheduleMode='week';
function setScheduleMode(mode){scheduleMode=mode;renderAgendamentos();}
function renderAgendamentos(){
  const el = document.getElementById('view-agendamentos');
  const list = state.scheduled.slice().sort((a,b)=>new Date(a.pickupAt)-new Date(b.pickupAt));
  const base=new Date(window.scheduleAnchor||Date.now()),day=(base.getDay()+6)%7,monday=new Date(base);monday.setDate(base.getDate()-day);monday.setHours(0,0,0,0);const days=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return d}),hours=Array.from({length:13},(_,i)=>i+8),names=['segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'];
  const grid=`<div class="schedule-week"><div class="schedule-day-head"></div>${days.map((d,i)=>`<div class="schedule-day-head">${names[i]}, ${d.getDate()} de ${d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','')}</div>`).join('')}${hours.map(hour=>`<div class="schedule-hour">${String(hour).padStart(2,'0')}:00</div>${days.map(d=>{const events=list.filter(s=>{const x=new Date(s.pickupAt);return x.toDateString()===d.toDateString()&&x.getHours()===hour});return `<div>${events.map(s=>`<div class="schedule-event" onclick="editScheduledOrder(${jsArg(s.id)})">${new Date(s.pickupAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} ${h(s.customerName||'Cliente')}</div>`).join('')}</div>`}).join('')}`).join('')}</div>`;
  const selectedList=scheduleMode==='day'?list.filter(s=>new Date(s.pickupAt).toDateString()===base.toDateString()):scheduleMode==='month'?list.filter(s=>{const d=new Date(s.pickupAt);return d.getMonth()===base.getMonth()&&d.getFullYear()===base.getFullYear()}):list;
  const tableView=`<div class="finance-grid" style="height:430px;margin:0 14px"><table><thead><tr><th>Data e hora</th><th>Cliente</th><th>Itens</th><th>Status</th><th>Total</th></tr></thead><tbody>${selectedList.map(s=>`<tr onclick="editScheduledOrder(${jsArg(s.id)})"><td>${reportDateTime(s.pickupAt)}</td><td>${h(s.customerName||'Cliente')}</td><td>${h((s.items||[]).map(i=>i.qty+'x '+i.name).join(', '))}</td><td>${h(s.status||'agendado')}</td><td>${fmt((s.items||[]).reduce((a,i)=>a+Number(i.price||0)*Number(i.qty||0),0))}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhum pedido neste período.</td></tr>'}</tbody></table></div>`;
  const scheduleContent=scheduleMode==='week'?grid:tableView,period=scheduleMode==='day'?base.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}):scheduleMode==='month'?base.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}):scheduleMode==='agenda'?'Todos os pedidos agendados':`${days[0].getDate()} - ${days[6].getDate()} de ${days[6].toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}`;
  el.innerHTML=`<div class="workspace-gray"><section class="op-window scheduled-window"><header class="op-titlebar">Pedidos Agendados <span class="op-controls"><span onclick="switchView('delivery')">×</span></span></header><div class="schedule-modes"><button class="today" onclick="scheduleToday()">▣ &nbsp; Ir para hoje</button><button class="${scheduleMode==='day'?'active':''}" onclick="setScheduleMode('day')">▣ Dia</button><button class="${scheduleMode==='week'?'active':''}" onclick="setScheduleMode('week')">▥ Semana</button><button class="${scheduleMode==='month'?'active':''}" onclick="setScheduleMode('month')">▦ Mês</button><button class="${scheduleMode==='agenda'?'active':''}" onclick="setScheduleMode('agenda')">▤ Agenda</button><span class="op-toolbar-spacer"></span><button class="op-btn primary" onclick="openNewAgendamentoModal()">＋ &nbsp; Novo</button></div><div class="schedule-period"><button onclick="moveSchedulePeriod(-1)" ${scheduleMode==='agenda'?'disabled':''}>‹</button><button onclick="moveSchedulePeriod(1)" ${scheduleMode==='agenda'?'disabled':''}>›</button><b>${period}</b></div>${scheduleContent}<footer class="op-footer"><b>Pedidos=${selectedList.length}</b><b>Total=${fmt(selectedList.reduce((a,s)=>a+(s.items||[]).reduce((q,i)=>q+Number(i.price||0)*Number(i.qty||0),0),0))}</b></footer></section></div>`;
  return;
  const rows = list.map(s=>{
    const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
    const who = member ? (member.code?member.code+' — ':'')+member.name : (s.customerName||'Avulso');
    const late = s.status==='agendado' && new Date(s.pickupAt) < new Date();
    const status=s.status==='entregue'?'Entregue':s.status==='cancelado'?'Cancelado':s.status==='enviado'?'Na cozinha':late?'Atrasado':'Agendado';
    return `<tr data-scheduled-id="${s.id}" onclick="selectScheduledRow(${jsArg(s.id)})" ondblclick="editScheduledOrder(${jsArg(s.id)})"><td>${h(String(s.orderNumber||s.id).slice(-8))}</td><td>${h(who)}</td><td>${reportDateTime(s.createdAt)}</td><td>${reportDateTime(s.pickupAt)}</td><td>${(s.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td><td>${fmt((s.items||[]).reduce((a,i)=>a+Number(i.price||0)*Number(i.qty||0),0))}</td><td>${status}</td><td>${h((s.items||[]).map(i=>i.qty+'x '+i.name).join(', '))}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="workspace-gray"><section class="op-window scheduled-window"><header class="op-titlebar">Pedidos Agendados <span class="op-controls"><span onclick="switchView('delivery')">×</span></span></header><div class="op-toolbar"><div class="op-search"><span>⌕</span><input id="scheduledSearch" placeholder="Pesquisar aqui..." oninput="filterScheduledRows(this.value)"></div><span class="op-toolbar-spacer"></span><button class="op-btn" onclick="printCurrentWindow()">▣ &nbsp; Imprimir</button><button class="op-btn" id="scheduledKitchen" onclick="scheduledSelectedAction('kitchen')">♨ &nbsp; Cozinha</button><button class="op-btn" id="scheduledCancel" onclick="scheduledSelectedAction('cancel')">✕ &nbsp; Cancelar</button><button class="op-btn" id="scheduledEdit" onclick="scheduledSelectedAction('edit')">✎ &nbsp; Editar</button><button class="op-btn primary" onclick="openNewAgendamentoModal()">＋ &nbsp; Novo</button></div><div class="op-grid"><table><thead><tr><th>Cód.</th><th>Cliente</th><th>Criado em</th><th>Agendado para</th><th>Qtd.</th><th>Total</th><th>Status</th><th>Itens</th></tr></thead><tbody id="scheduledRows">${rows||'<tr><td colspan="8" class="empty">Nenhum pedido agendado.</td></tr>'}</tbody></table></div><footer class="op-footer"><b>Registros: ${list.length}</b><b>Total=${fmt(list.reduce((a,s)=>a+(s.items||[]).reduce((q,i)=>q+Number(i.price||0)*Number(i.qty||0),0),0))}</b></footer></section></div>`;
}
function moveSchedulePeriod(delta){const d=new Date(window.scheduleAnchor||Date.now());if(scheduleMode==='month')d.setMonth(d.getMonth()+delta);else d.setDate(d.getDate()+delta*(scheduleMode==='week'?7:1));window.scheduleAnchor=d.toISOString();renderAgendamentos();}
function scheduleToday(){window.scheduleAnchor=new Date().toISOString();renderAgendamentos();}
let selectedScheduledId=null;
function selectScheduledRow(id){selectedScheduledId=id;document.querySelectorAll('[data-scheduled-id]').forEach(r=>r.classList.toggle('selected',r.dataset.scheduledId===id));}
function printCurrentWindow(){window.print();}
function filterScheduledRows(query){const q=String(query||'').trim().toLowerCase();document.querySelectorAll('[data-scheduled-id]').forEach(r=>r.hidden=q&&!r.textContent.toLowerCase().includes(q));}
function scheduledSelectedAction(action){if(!selectedScheduledId){toast('Selecione um pedido agendado.');return;}if(action==='kitchen')sendScheduledToKitchen(selectedScheduledId);else if(action==='cancel')cancelScheduled(selectedScheduledId);else editScheduledOrder(selectedScheduledId);}
function openScheduledDetail(id){const s=state.scheduled.find(x=>x.id===id);if(!s)return;const member=s.memberId?state.members.find(m=>m.id===s.memberId):null,who=member?member.name:(s.customerName||'Cliente'),rows=(s.items||[]).map(i=>`<tr><td>${Number(i.qty)||0}</td><td>${h(i.name)}</td><td>${fmt(i.price)}</td><td>${fmt(Number(i.qty||0)*Number(i.price||0))}</td><td>${h(i.notes||'—')}</td></tr>`).join(''),history=s.statusHistory||[];openModal('Pedido Agendado',`<div class="consumer-form-frame"><div class="app-status"><b>${h(who)}</b><span class="tag ${s.status==='enviado'?'tag-green':s.status==='cancelado'?'tag-red':'tag-amber'}">${h(s.status||'agendado')}</span></div><div class="grid3"><p><b>Criado em</b><br>${reportDateTime(s.createdAt)}</p><p><b>Agendado para</b><br>${reportDateTime(s.pickupAt)}</p><p><b>Total</b><br>${fmt((s.items||[]).reduce((a,i)=>a+Number(i.price||0)*Number(i.qty||0),0))}</p></div><div class="finance-grid" style="height:270px"><table><thead><tr><th>Qtd.</th><th>Produto</th><th>Unitário</th><th>Total</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table></div>${s.notes?`<p><b>Observação:</b> ${h(s.notes)}</p>`:''}<div class="settings-section"><b>Histórico</b>${history.map(x=>`<p class="sub">${reportDateTime(x.at)} · ${h(x.status)} · ${h(x.user||'Sistema')}${x.note?' · '+h(x.note):''}</p>`).join('')||'<p class="sub">Pedido aguardando o horário programado.</p>'}</div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button>${!['enviado','cancelado'].includes(s.status)?`<button class="consumer-delete" onclick="closeModal();cancelScheduled(${jsArg(id)})">Cancelar</button><button onclick="closeModal();editScheduledOrder(${jsArg(id)})">Editar</button><button class="consumer-save" onclick="closeModal();sendScheduledToKitchen(${jsArg(id)})">Enviar à cozinha</button>`:''}</div>`,true);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
function editScheduledOrder(id){const s=state.scheduled.find(x=>x.id===id);if(!s)return;openNewAgendamentoModal(id);}
function openNewAgendamentoModal(){
  const editingId=arguments[0]||null,editing=editingId?state.scheduled.find(x=>x.id===editingId):null;
  newDraft('agendamento');
  if(editing) currentSaleDraft.items=JSON.parse(JSON.stringify(editing.items||[]));
  const memberOptions = state.members.map(m=>`<option value="${m.id}">${h((m.code?m.code+' — ':'')+m.name)}</option>`).join('');
  const defaultVal = editing?new Date(editing.pickupAt).toISOString().slice(0,16):new Date(Date.now()+60*60*1000).toISOString().slice(0,16);
  openModal(editing?'Editar Pedido Agendado':'Novo Pedido Agendado', `<div class="scheduled-record-body"><div class="scheduled-record-fields">
      <div class="field"><label>Cliente / Associado</label><select id="agMember"><option value="">— Não informado —</option>${memberOptions}</select></div>
      <div class="field"><label>Nome do Cliente</label><input id="agCustomer" value="${h(editing&&editing.customerName||'')}" placeholder="Cliente avulso"></div>
      <div class="field"><label>Data e hora agendada</label><input id="agPickup" type="datetime-local" value="${defaultVal}"></div>
      <div class="field"><label>Status</label><input value="${h(editing&&editing.status||'Agendado')}" disabled></div></div>
    <div id="agendaPicker"></div>
    <div class="scheduled-record-items"><div id="draftItemsList"></div><div style="display:flex;justify-content:space-between;margin-top:10px;font-weight:700"><span>Total</span><span class="mono" id="draftTotal">R$ 0,00</span></div></div>
    <div class="scheduled-actions"><button class="consumer-back" onclick="closeModal()">〈 &nbsp; Voltar</button><button class="consumer-save" id="agSaveBtn">✓ &nbsp; Salvar</button></div></div>`, true);
  document.querySelector('#modalRoot .modal').classList.add('scheduled-record-modal');
  if(editing&&editing.memberId)document.getElementById('agMember').value=editing.memberId;
  renderProductPicker('agendaPicker'); renderDraftItems();
  document.getElementById('agSaveBtn').onclick = async ()=>{
    if(!currentSaleDraft.items.length){ toast('Adicione ao menos um item.'); return; }
    const memberId = document.getElementById('agMember').value || null;
    const customerName = document.getElementById('agCustomer').value.trim();
    const pickupVal = document.getElementById('agPickup').value;
    if(!memberId && !customerName){ toast('Informe um associado ou o nome do cliente.'); return; }
    if(!pickupVal){ toast('Informe a data e hora de retirada.'); return; }
    if(editing)Object.assign(editing,{memberId,customerName,items:currentSaleDraft.items,pickupAt:new Date(pickupVal).toISOString()});
    else state.scheduled.push({id:uid(),orderNumber:await nextOrderNumber(),memberId,customerName,items:currentSaleDraft.items,pickupAt:new Date(pickupVal).toISOString(),status:'agendado',createdAt:new Date().toISOString()});
    save('scheduled'); closeModal(); renderAll(); toast('Pedido agendado.');
  };
}
async function sendScheduledToKitchen(id){
  const s = state.scheduled.find(x=>x.id===id); if(!s) return;
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const who = member ? member.name : (s.customerName||'Avulso');
  if(!await sendItemsToKitchen(s.id, s.items, who, 'agendamento')) return;
  s.items.forEach(i=>i.sent=true);
  s.status='enviado';s.statusAt=new Date().toISOString();s.statusHistory=s.statusHistory||[];s.statusHistory.push({status:'Enviado à cozinha',at:s.statusAt,user:currentUser.name}); save('scheduled');logAction('Pedido agendado #'+(s.orderNumber||'')+' enviado à cozinha');renderAll(); toast('Pedido enviado para a cozinha.');
}
async function cancelScheduled(id){
  if(!await askConfirm({title:'Cancelar este agendamento?',confirmLabel:'Cancelar agendamento',cancelLabel:'Manter agendamento'})) return;
  const s = state.scheduled.find(x=>x.id===id); if(!s) return;
  s.status='cancelado';s.statusAt=new Date().toISOString();s.statusHistory=s.statusHistory||[];s.statusHistory.push({status:'Cancelado',at:s.statusAt,user:currentUser.name}); save('scheduled');logAction('Pedido agendado #'+(s.orderNumber||'')+' cancelado');renderAll();
}

