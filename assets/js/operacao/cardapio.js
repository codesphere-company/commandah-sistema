/* ============ CARDÁPIO DIGITAL ============ */
let cardapioSub = 'equipe';
/* Cardápio digital, etapa 1 (26/11/2026, pedido do dono): no lugar dos cartões "em breve" de integrações, a
   configuração do cardápio público (cardapio.html, função "cardapio"): ligar/desligar, abrir como cliente, imprimir o
   QR de cada mesa (locais cadastrados) e trocar o código. settings.cardapio = { ligado, codigo }; o código é público
   e aleatório, e trocar invalida os QR antigos. Desenho: docs/superpowers/specs/2026-11-26-cardapio-etapa1-design.md.
   As funções abaixo de renderCardapio (pedidos recebidos, visão interna) ficam para a etapa 2. */
function cardapioCfg(){ return (state.settings && state.settings.cardapio) || {}; }
// O site (Cloudflare) serve a página em /cardapio; cardapio.html redireciona para lá. O QR já usa o endereço final.
function cardapioUrl(mesaId){
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return base + 'cardapio?c=' + encodeURIComponent(cardapioCfg().codigo || '') + (mesaId ? '&m=' + encodeURIComponent(mesaId) : '');
}
function novoCodigoCardapio(){
  const letras = 'abcdefghijkmnpqrstuvwxyz23456789', b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, x => letras[x % letras.length]).join('');
}
function renderCardapio(){
  const el = document.getElementById('view-cardapio'); if(!el) return;
  const c = cardapioCfg(), pode = hasPerm('config-sistema'), ativo = !!(c.ligado && c.codigo), locais = state.locais || [];
  el.innerHTML = `<div class="hub">
    <div class="hub-cartao hub-cartao-largo cardapio-cfg">
      <div class="hub-cartao-topo"><span class="hub-pill ${ativo?'on':'off'}">${ativo?'Ligado':'Desligado'}</span><span class="sub">QR na mesa: fotos e preços no celular do cliente</span></div>
      <p class="sub">Nesta primeira etapa o cliente só olha o cardápio; para pedir, chama o garçom. Aparecem os produtos ativos e liberados para o QR, com a foto do cadastro. Produto pausado some ao recarregar a página.</p>
      ${ativo?`<div class="field"><label for="cardapioLink">Endereço do cardápio</label><input id="cardapioLink" readonly value="${h(cardapioUrl(''))}"></div>`:''}
      <div class="cardapio-acoes">
        ${pode?`<button type="button" class="btn ${ativo?'':'btn-primary'}" id="cardapioLigarBtn" onclick="cardapioLigar(${ativo?'false':'true'})">${ativo?'Desligar o cardápio':'Ligar o cardápio'}</button>`:''}
        ${ativo?`<a class="btn" id="cardapioAbrir" href="${h(cardapioUrl(''))}" target="_blank" rel="noopener">Abrir como cliente</a><button type="button" class="btn" id="cardapioQrBtn" onclick="cardapioImprimirQrs()">Imprimir QR das mesas (${locais.length})</button>${pode?'<button type="button" class="btn" id="cardapioTrocarBtn" onclick="cardapioTrocarCodigo()">Trocar código</button>':''}`:''}
      </div>
      ${pode?'':'<p class="sub">Só o administrador liga ou desliga o cardápio.</p>'}
    </div></div>`;
}
function cardapioLigar(on){
  if(!requirePerm('config-sistema')) return;
  const c = cardapioCfg();
  state.settings.cardapio = { ...c, ligado: !!on, codigo: c.codigo || novoCodigoCardapio() };
  save('settings');
  logAction('Cardápio digital ' + (on ? 'ligado' : 'desligado'));
  toast(on ? 'Cardápio ligado. Imprima o QR das mesas.' : 'Cardápio desligado. Os QR mostram "indisponível".');
  renderCardapio();
}
async function cardapioTrocarCodigo(){
  if(!requirePerm('config-sistema')) return;
  const ok = await askConfirm({ title:'Trocar o código do cardápio?', message:'Os QR já impressos param de abrir o cardápio. Depois, imprima os novos.', confirmLabel:'Trocar código', cancelLabel:'Voltar' });
  if(!ok) return;
  state.settings.cardapio = { ...cardapioCfg(), codigo: novoCodigoCardapio() };
  save('settings');
  logAction('Cardápio digital: código trocado (QR antigos invalidados)');
  toast('Código trocado. Imprima os QR novos.');
  renderCardapio();
}
// Folha só de impressão: um QR geral (sem mesa, para o balcão) e um por local cadastrado, com o nome embaixo.
function cardapioImprimirQrs(){
  const c = cardapioCfg(); if(!c.ligado || !c.codigo){ toast('Ligue o cardápio antes de imprimir os QR.'); return; }
  if(!window.QRCode){ toast('Não foi possível gerar os QR agora. Recarregue a página e tente de novo.', 'erro'); return; }
  document.getElementById('cardapioQrSheet')?.remove();
  const folha = document.createElement('div'); folha.id = 'cardapioQrSheet';
  const nome = (state.settings && state.settings.clubName) || 'Cardápio';
  const itens = [{ id:'', nome:'Balcão' }].concat((state.locais || []).filter(l => l && l.id).map(l => ({ id:l.id, nome:l.nome || l.id })));
  itens.forEach(it => {
    const card = document.createElement('div'); card.className = 'qr-cartao';
    const qr = document.createElement('div'); qr.className = 'qr-img';
    new QRCode(qr, { text: cardapioUrl(it.id), width: 220, height: 220, colorDark:'#000000', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M });
    const t = document.createElement('b'); t.textContent = it.nome;
    const s = document.createElement('small'); s.textContent = nome + ' · aponte a câmera para ver o cardápio';
    card.append(qr, t, s); folha.appendChild(card);
  });
  document.body.appendChild(folha); document.body.classList.add('imprimindo-qr');
  try { window.print(); } finally { document.body.classList.remove('imprimindo-qr'); setTimeout(() => folha.remove(), 1000); }
  logAction('Cardápio digital: QR das mesas impressos (' + itens.length + ')');
}
function openOwnDigitalMenu(mode='equipe'){cardapioSub=mode;const el=document.getElementById('view-cardapio');el.innerHTML=`<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">Cardápio Digital — Canal Próprio <span class="op-controls"><button type="button" onclick="renderCardapio()" aria-label="Fechar" title="Fechar">${ICN.x}</button></span></header><div class="record-tabs"><button class="${mode==='equipe'?'active':''}" onclick="openOwnDigitalMenu('equipe')">Pedidos recebidos</button><button class="${mode==='cliente'?'active':''}" onclick="openOwnDigitalMenu('cliente')">Visão do cliente (QR)</button></div><div id="cardapioBody" style="padding:18px;overflow:auto"></div></section></div>`;if(mode==='equipe')renderCardapioEquipe();else renderCardapioCliente();}
function openDigitalChannelHelp(name){openModal('Manual — '+name,`<div class="consumer-form-frame"><h3>Etapas para ativação</h3><ol><li>Contrate ou cadastre uma conta no provedor escolhido.</li><li>Solicite as credenciais de integração.</li><li>Configure catálogo, modalidades e horários.</li><li>Valide o recebimento de um pedido de teste.</li></ol><p class="sub">A disponibilidade depende de contrato e credenciais do provedor.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button></div>`);}
function openDigitalChannelConfig(name){if(!requirePerm('config-sistema'))return;const all=state.settings.digitalChannels||{},c=all[name]||{};openModal('Configurar '+name,`<div class="consumer-form-frame"><div class="field"><label>Identificador da loja</label><input id="dcStore" value="${h(c.store||'')}"></div><div class="row"><div class="field"><label>Modalidade padrão</label><select id="dcMode"><option ${c.mode==='Entrega'?'selected':''}>Entrega</option><option ${c.mode==='Retirada'?'selected':''}>Retirada</option><option ${c.mode==='Ambas'?'selected':''}>Ambas</option></select></div><div class="field"><label>Tempo estimado (min)</label><input id="dcTime" type="number" min="1" value="${Number(c.time)||40}"></div></div><label><input id="dcAuto" type="checkbox" ${c.autoAccept?'checked':''}> Aceitar pedidos automaticamente</label><br><label><input id="dcEnabled" type="checkbox" ${c.enabled?'checked':''}> Ativar canal após validação</label><p class="sub">Sem credenciais válidas, o canal permanece apenas configurado localmente.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveDigitalChannel(${jsArg(name)})"><span class="b-ic" aria-hidden="true">${ICN.check}</span> Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
function saveDigitalChannel(name){if(!requirePerm('config-sistema'))return;state.settings.digitalChannels=state.settings.digitalChannels||{};state.settings.digitalChannels[name]={store:document.getElementById('dcStore').value.trim(),mode:document.getElementById('dcMode').value,time:Math.max(1,parseInt(document.getElementById('dcTime').value,10)||40),autoAccept:document.getElementById('dcAuto').checked,enabled:document.getElementById('dcEnabled').checked};save('settings');closeModal();toast('Configuração do canal salva.');}
function renderCardapioEquipe(){
  const el = document.getElementById('cardapioBody');
  const pending = state.requests.filter(r=>r.status==='pendente');
  el.innerHTML = pending.length ? `<div class="card-list">${pending.map(r=>{
    const member = r.memberId ? state.members.find(m=>m.id===r.memberId) : null;
    const who = member ? (member.code?member.code+' — ':'')+member.name : (r.customerName||'Avulso');
    return `<div class="tab-card" style="align-items:flex-start" ondblclick="openRequestDetail(${jsArg(r.id)})">
      <div><div class="who">${h(who)}</div><div class="meta">${timeFmt(r.createdAt)} · ${h(r.items.map(i=>i.qty+'x '+i.name).join(', '))}</div></div>
      <div class="total">${fmt(r.items.reduce((a,i)=>a+i.price*i.qty,0))}</div>
      <div><button class="btn btn-sm" onclick="event.stopPropagation();openRequestDetail(${jsArg(r.id)})">Detalhes</button><button class="btn btn-sm btn-green" onclick="event.stopPropagation();acceptRequest(${jsArg(r.id)})">Aceitar</button>
      <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();openRejectRequest(${jsArg(r.id)})">Recusar</button></div>
    </div>`;
  }).join('')}</div>` : `<p class="empty">Nenhum pedido recebido pelo cardápio digital no momento.</p>`;
}
function openRequestDetail(id){const r=state.requests.find(x=>x.id===id);if(!r)return;const member=r.memberId?state.members.find(m=>m.id===r.memberId):null,who=member?member.name:(r.customerName||'Avulso'),rows=(r.items||[]).map(i=>`<tr><td>${Number(i.qty)||0}</td><td>${h(i.name)}</td><td>${fmt(i.price)}</td><td>${fmt(Number(i.qty||0)*Number(i.price||0))}</td><td>${h(i.notes||i.customization&&i.customization.summary||'—')}</td></tr>`).join(''),history=r.statusHistory||[];openModal('Solicitação do Cardápio Digital',`<div class="consumer-form-frame"><div class="app-status"><b>${h(who)}</b><span class="tag ${r.status==='aceito'?'tag-green':r.status==='recusado'?'tag-red':'tag-amber'}">${h(r.status||'pendente')}</span></div><div class="grid3"><p><b>Recebido em</b><br>${reportDateTime(r.createdAt)}</p><p><b>Canal</b><br>${h(r.channel||'cardápio digital')}</p><p><b>Total</b><br>${fmt(r.total||(r.items||[]).reduce((a,i)=>a+Number(i.price||0)*Number(i.qty||0),0))}</p></div><div class="finance-grid" style="height:260px"><table><thead><tr><th>Qtd.</th><th>Produto</th><th>Unitário</th><th>Total</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table></div>${r.notes?`<p><b>Observação geral:</b> ${h(r.notes)}</p>`:''}${r.rejectionReason?`<p><b>Motivo da recusa:</b> ${h(r.rejectionReason)}</p>`:''}<div class="settings-section"><b>Histórico</b>${history.map(x=>`<p class="sub">${reportDateTime(x.at)} · ${h(x.status)} · ${h(x.user||'Sistema')}${x.note?' · '+h(x.note):''}</p>`).join('')||'<p class="sub">Aguardando atendimento.</p>'}</div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button>${r.status==='pendente'?`<button class="consumer-delete" onclick="closeModal();openRejectRequest(${jsArg(r.id)})">Recusar</button><button class="consumer-save" onclick="closeModal();acceptRequest(${jsArg(r.id)})"><span class="b-ic" aria-hidden="true">${ICN.check}</span> Aceitar</button>`:''}</div>`,true);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
function openRejectRequest(id){const r=state.requests.find(x=>x.id===id);if(!r||r.status!=='pendente')return;openModal('Recusar Solicitação',`<div class="consumer-form-frame"><p>Informe o motivo para manter o histórico do atendimento.</p><div class="field"><label>Motivo da recusa</label><select id="requestRejectPreset"><option value="">Selecione...</option><option>Produto indisponível</option><option>Estoque insuficiente</option><option>Fora do horário de atendimento</option><option>Não foi possível confirmar o cliente</option><option>Outro motivo</option></select></div><div class="field"><label>Detalhes</label><textarea id="requestRejectNote" rows="4"></textarea></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-delete" onclick="rejectRequest(${jsArg(id)})"><span class="b-ic" aria-hidden="true">${ICN.x}</span> Confirmar recusa</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
async function acceptRequest(id){
  const r = state.requests.find(x=>x.id===id); if(!r) return;
  let sale = state.sales.find(s=>s.status==='open' && ((r.memberId && s.memberId===r.memberId) || (!r.memberId && s.customerName===r.customerName)));
  const createdSale = !sale;
  if(!sale && r.memberId && !await ensureMemberCanOpen(state.members.find(m=>m.id===r.memberId), ()=>acceptRequest(id))) return;
  if(!sale){
    sale = { id:uid(), type:'comanda', memberId:r.memberId, customerName:r.customerName, items:[], total:0, status:'open', payments:[], openedAt:new Date().toISOString() };
    state.sales.push(sale);
  }
  const newItems = r.items.map(i=>({...i, sent:false}));
  sale.items = sale.items.concat(newItems);
  sale.total = sale.items.reduce((a,i)=>a+i.price*i.qty,0);
  if(r.notes)sale.notes=[sale.notes,r.notes].filter(Boolean).join(' · ');
  const member = r.memberId ? state.members.find(m=>m.id===r.memberId) : null;
  const who = member ? member.name : (r.customerName||'Avulso');
  if(!await sendItemsToKitchen(sale.id, newItems, who, 'cardapio')){
    sale.items=sale.items.filter(i=>!newItems.includes(i));
    sale.total=sale.items.reduce((a,i)=>a+i.price*i.qty,0);
    if(createdSale) state.sales=state.sales.filter(s=>s.id!==sale.id);
    return;
  }
  if(createdSale) sale.orderNumber=await nextOrderNumber();
  newItems.forEach(i=>i.sent=true);
  r.status='aceito';
  r.statusAt=new Date().toISOString();r.statusHistory=r.statusHistory||[];r.statusHistory.push({status:'Aceito',at:r.statusAt,user:currentUser.name,note:'Enviado para a cozinha'});
  save('sales'); save('requests');
  toast('Pedido aceito e enviado para a cozinha.'); renderAll();
}
function rejectRequest(id){const r=state.requests.find(x=>x.id===id);if(!r)return;const preset=document.getElementById('requestRejectPreset')?.value||'',note=document.getElementById('requestRejectNote')?.value.trim()||'';if(document.getElementById('requestRejectPreset')&&!preset){toast('Selecione o motivo da recusa.');return;}r.status='recusado';r.rejectionReason=[preset,note].filter(Boolean).join(' — ')||'Recusado pela equipe';r.statusAt=new Date().toISOString();r.statusHistory=r.statusHistory||[];r.statusHistory.push({status:'Recusado',at:r.statusAt,user:currentUser.name,note:r.rejectionReason});save('requests');logAction('Solicitação do cardápio recusada — '+r.rejectionReason);closeModal();renderAll();toast('Solicitação recusada.');}
function renderCardapioCliente(){
  if(!cardapioDraft) cardapioDraft = { items:[], memberId:null, customerName:'' };
  const el = document.getElementById('cardapioBody');
  const available=state.products.filter(p=>p.active!==false&&!hiddenInSelfService(p,state.complementos)&&(!p.channels||p.channels.qr!==false)).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)),categories=[...new Set(available.map(p=>p.category||'Sem categoria'))];
  const memberOptions = state.members.filter(m=>m.active!==false&&!m.archived).map(m=>`<option value="${m.id}" ${cardapioDraft.memberId===m.id?'selected':''}>${h((m.code?m.code+' — ':'')+m.name)}</option>`).join('');
  el.innerHTML = `
    <div class="grid2">
      <div class="field"><label>Sou associado — cota</label><select id="cdMember"><option value="">— Não sou associado —</option>${memberOptions}</select></div>
      <div class="field"><label>Nome (se não for associado)</label><input id="cdCustomer" value="${h(cardapioDraft.customerName)}"></div>
    </div>
    <div class="op-toolbar"><div class="op-search"><input id="digitalMenuSearch" placeholder="Pesquisar produto..." oninput="filterDigitalMenu()"></div><select id="digitalMenuCategory" onchange="filterDigitalMenu()"><option value="">Todas as categorias</option>${categories.map(c=>`<option>${h(c)}</option>`).join('')}</select><button class="op-btn" onclick="clearSelfServiceDraft()"><span class="b-ic" aria-hidden="true">${ICN.x}</span> Limpar</button></div>
    <div id="digitalMenuProducts" style="margin:14px 0;display:flex;flex-direction:column;gap:8px">
      ${available.map(p=>`<div class="menu-item" data-product="${h(p.id)}" data-category="${h(p.category||'Sem categoria')}">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">${p.image?`<img src="${h(p.image)}" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0">`:''}<div style="min-width:0"><div class="mi-name">${h(p.name)}</div><div class="mi-cat">${h(p.category||'')}</div></div></div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0"><span class="mono">${fmt(p.price)}</span>
        <button class="btn btn-sm btn-primary" onclick="addCardapioItem(${jsArg(p.id)})">Adicionar</button></div>
      </div>`).join('') || '<p class="empty">Cardápio ainda não cadastrado.</p>'}
    </div>
    <div class="panel" style="background:var(--cream)">
      <h2>Meu pedido</h2>
      <div id="cdItemsList"></div>
      <div class="field"><label>Observação geral</label><input id="cdNotes" value="${h(cardapioDraft.notes||'')}" placeholder="Informações para a equipe"></div>
      <div style="display:flex;justify-content:space-between;margin:12px 0;font-size:16px;font-weight:700"><span>Total</span><span class="mono" id="cdTotal">R$ 0,00</span></div>
      <button class="btn btn-primary btn-block" onclick="submitCardapioRequest()">Enviar pedido para a equipe</button>
    </div>`;
  document.getElementById('cdMember').onchange = e=>{ cardapioDraft.memberId = e.target.value||null; };
  document.getElementById('cdCustomer').oninput = e=>{ cardapioDraft.customerName = e.target.value; };
  document.getElementById('cdNotes').oninput = e=>{ cardapioDraft.notes = e.target.value; };
  renderCardapioItems();
}
function filterDigitalMenu(){const q=(document.getElementById('digitalMenuSearch')?.value||'').trim().toLowerCase(),category=document.getElementById('digitalMenuCategory')?.value||'';document.querySelectorAll('#digitalMenuProducts [data-product]').forEach(row=>{row.style.display=(!q||row.textContent.toLowerCase().includes(q))&&(!category||row.dataset.category===category)?'':'none';});}
function addCardapioItem(productId){
  const p = state.products.find(x=>x.id===productId); if(!p) return;
  if(hiddenInSelfService(p,state.complementos)){toast('Este produto não está disponível neste canal.');return;}
  const channel=document.getElementById('view-totem')?.classList.contains('active')?'online':'qr';
  if(p.channels&&p.channels[channel]===false){toast('Este produto não está disponível neste canal.');return;}
  const existing = cardapioDraft.items.find(i=>i.productId===productId);
  const proposed=cardapioDraft.items.map(i=>({...i}));
  const candidate=proposed.find(i=>i.productId===productId);
  if(candidate) candidate.qty+=1; else proposed.push({productId,qty:1});
  if(!canFulfillItems(proposed)){ toast('Estoque insuficiente para aumentar este item.'); return; }
  if(existing) existing.qty += 1; else cardapioDraft.items.push({productId, name:p.name, price:p.price, qty:1});
  renderCardapioItems();
}
function changeCardapioQty(idx, delta){
  const it = cardapioDraft.items[idx]; if(!it) return;
  if(delta>0){ const proposed=cardapioDraft.items.map(i=>({...i})); proposed[idx].qty+=delta; if(!canFulfillItems(proposed)){ toast('Estoque insuficiente para aumentar este item.'); return; } }
  it.qty += delta; if(it.qty<=0) cardapioDraft.items.splice(idx,1);
  renderCardapioItems();
}
function renderCardapioItems(){
  const el = document.getElementById('cdItemsList'); if(!el) return;
  el.innerHTML = cardapioDraft.items.length ? cardapioDraft.items.map((i,idx)=>`
    <div class="item-line"><span>${h(i.name)}</span>
      <div class="qty-ctrl"><button onclick="changeCardapioQty(${idx},-1)" aria-label="Diminuir"><span class="b-ic" aria-hidden="true">${ICN.minus}</span></button><span class="mono">${i.qty}</span>
      <button onclick="changeCardapioQty(${idx},1)" aria-label="Aumentar"><span class="b-ic" aria-hidden="true">${ICN.plus}</span></button>
      <span class="mono" style="min-width:70px;text-align:right">${fmt(i.price*i.qty)}</span></div>
    </div>`).join('') : `<p class="empty">Nenhum item selecionado ainda.</p>`;
  const t = document.getElementById('cdTotal'); if(t) t.textContent = fmt(cardapioDraft.items.reduce((a,i)=>a+i.price*i.qty,0));
}
async function clearSelfServiceDraft(){if(cardapioDraft&&cardapioDraft.items.length&&!await confirmarAcao('Cancelar e remover todos os itens selecionados?'))return;cardapioDraft={items:[],memberId:null,customerName:'',notes:''};renderAll();toast('Pedido cancelado.');}
function filterTotemProducts(){const q=(document.getElementById('totemSearch')?.value||'').trim().toLowerCase(),category=document.getElementById('totemCategory')?.value||'';document.querySelectorAll('#totemProducts [data-product]').forEach(row=>{row.style.display=(!q||row.textContent.toLowerCase().includes(q))&&(!category||row.dataset.category===category)?'':'none';});}
function toggleTotemFullscreen(){const el=document.getElementById('view-totem');if(!document.fullscreenElement)el.requestFullscreen?.();else document.exitFullscreen?.();}
function submitCardapioRequest(){
  if(!cardapioDraft.items.length){ toast('Selecione ao menos um item.'); return; }
  if(!cardapioDraft.memberId && !cardapioDraft.customerName.trim()){ toast('Informe sua cota de associado ou seu nome.'); return; }
  const items=JSON.parse(JSON.stringify(cardapioDraft.items)),total=items.reduce((sum,item)=>sum+Number(item.price||0)*Number(item.qty||0),0);
  state.requests.unshift({ id:uid(), memberId:cardapioDraft.memberId, customerName:cardapioDraft.customerName.trim(),
    items, total, notes:(cardapioDraft.notes||'').trim(), channel:'cardapio-digital', status:'pendente', createdAt:new Date().toISOString() });
  save('requests');
  cardapioDraft = { items:[], memberId:null, customerName:'', notes:'' };
  toast('Pedido enviado! Aguarde a equipe confirmar.');
  renderAll();
}

