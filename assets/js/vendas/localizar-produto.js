/* ============ MAIS OPÇÕES DA COMANDA ============ */
/* ============ LOCALIZAR PRODUTO (janela própria) ============ */
let comandaLocatorCategory='', comandaLocatorGroup=true;
function openComandaProductLocator(saleId){
  if(currentSaleDraft && currentSaleDraft.type==='comanda' && !window.currentComandaRequester){ toast('Selecione quem está solicitando antes de adicionar produtos.'); return; }
  window.comandaLocatorSaleId = saleId; comandaLocatorCategory='';
  openModal('Localizar Produto', `
    <div class="op-toolbar" style="padding:0 0 12px;border:0">
      <div class="op-search" style="flex:1"><input id="clSearch" placeholder="Pesquisar..." oninput="renderComandaLocatorGrid()"></div>
      <button class="op-btn" onclick="renderComandaLocatorGrid()">↻ &nbsp; Atualizar</button>
    </div>
    <div class="pdv-sheet-tabs" id="clTabs" style="border-bottom:1px solid var(--c-border);padding-left:0"></div>
    <div id="clGrid" class="finance-grid" style="height:420px;margin-top:0"></div>
    <div class="op-footer" style="margin-top:0">
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--c-text-3);font-weight:400"><input type="checkbox" id="clGroupToggle" ${comandaLocatorGroup?'checked':''} onchange="comandaLocatorGroup=this.checked;renderComandaLocatorGrid()" style="width:auto"> Agrupar Categoria</label>
      <span id="clCount" style="margin-left:auto;font-weight:400"></span>
    </div>
  `, true);
  const modal = document.querySelector('#modalRoot .modal');
  modal.classList.add('record-modal');
  modal.style.width='900px'; modal.style.maxWidth='calc(100vw - 40px)';
  const closeBtn = document.getElementById('modalCloseBtn');
  if(closeBtn) closeBtn.onclick = ()=>{
    const sale = state.sales.find(x=>x.id===saleId);
    if(sale){ sale.items = currentSaleDraft.items; sale.total = draftTotal(); save('sales'); }
    closeModal(); openComanda(saleId, true);
  };
  renderComandaLocatorTabs(); renderComandaLocatorGrid();
  setTimeout(()=>document.getElementById('clSearch')?.focus(),0);
}
function renderComandaLocatorTabs(){
  const tabs=document.getElementById('clTabs'); if(!tabs) return;
  const categories=[...new Set(state.products.filter(productEnabledForCurrentChannel).map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const tab=(label,val)=>`<button data-cat="${h(val)}" style="border:0;border-bottom:3px solid ${comandaLocatorCategory===val?'var(--c-primary)':'transparent'};background:none;padding:9px 14px;color:${comandaLocatorCategory===val?'var(--c-text)':'var(--c-text-2)'};font-size:13px">${h(label)}</button>`;
  tabs.innerHTML = tab('Todas','') + categories.map(c=>tab(c,c)).join('');
  tabs.querySelectorAll('[data-cat]').forEach(btn=>btn.onclick=()=>{ comandaLocatorCategory=btn.dataset.cat; renderComandaLocatorTabs(); renderComandaLocatorGrid(); });
}
function renderComandaLocatorGrid(){
  const el=document.getElementById('clGrid'); if(!el) return;
  const q=(document.getElementById('clSearch')?.value||'').toLowerCase();
  let list = state.products.filter(productEnabledForCurrentChannel);
  if(comandaLocatorCategory) list = list.filter(p=>p.category===comandaLocatorCategory);
  if(q) list = list.filter(p=>((p.category||'')+' '+(p.code||'')+' '+p.name).toLowerCase().includes(q));
  const countEl=document.getElementById('clCount'); if(countEl) countEl.textContent = list.length+' Produto'+(list.length===1?'':'s')+' encontrado'+(list.length===1?'':'s')+'.';
  const head = `<thead><tr><th>Categoria</th><th>Código</th><th>Nome do Produto</th><th>Preço de Venda</th><th>Adicionar (F11)</th><th>Personalizar (Enter)</th></tr></thead>`;
  const row = p => `<tr><td>${h(p.category||'—')}</td><td>${h(p.code||'—')}</td><td>${h(p.name)}</td><td class="mono">${fmt(p.price)}</td>
    <td style="text-align:center"><button class="op-mini" onclick="addComandaLocatorProduct(${jsArg(p.id)})" title="Adicionar">✓</button></td>
    <td style="text-align:center"><button class="op-mini" onclick="addComandaLocatorProduct(${jsArg(p.id)})" title="Personalizar">✎</button></td></tr>`;
  if(!list.length){ el.innerHTML = `<table>${head}</table><p class="empty">Nenhum produto encontrado.</p>`; return; }
  if(comandaLocatorGroup && !comandaLocatorCategory){
    const groups={};
    list.forEach(p=>{ const key=p.category||'Sem categoria'; (groups[key]=groups[key]||[]).push(p); });
    el.innerHTML = `<table>${head}<tbody>${Object.keys(groups).sort((a,b)=>a.localeCompare(b,'pt-BR')).map(cat=>groups[cat].map(row).join('')).join('')}</tbody></table>`;
  } else {
    el.innerHTML = `<table>${head}<tbody>${list.map(row).join('')}</tbody></table>`;
  }
}
function addComandaLocatorProduct(productId){
  const before = currentSaleDraft.items.reduce((n,i)=>n+i.qty,0);
  addDraftItem(productId);
  if(document.getElementById('clGrid')){
    const after = currentSaleDraft.items.reduce((n,i)=>n+i.qty,0);
    if(after>before){
      toast('Item adicionado.');
      const sale = state.sales.find(x=>x.id===window.comandaLocatorSaleId);
      if(sale){ sale.items = currentSaleDraft.items; sale.total = draftTotal(); save('sales'); }
    }
  }
}

/* "Mais opções" da comanda: o painel abria dentro da coluna da esquerda, que rola e corta
   o que passa da borda (texto cortado em cima e à direita). Agora ele sai da coluna e flutua
   acima de tudo, encostado no botão; fecha ao tocar fora ou ao escolher uma opção. */
function toggleComandaOrderOptions(force){
  const el=document.getElementById('comandaOrderOptions'); if(!el) return;
  const open = force===undefined ? !el.classList.contains('visible') : !!force;
  if(open){
    if(!el.classList.contains('floating')){ el.classList.add('floating'); document.body.appendChild(el); }
    const btn=document.getElementById('comandaMoreBtn');
    const r = btn ? btn.getBoundingClientRect() : {left:16, top:window.innerHeight-60};
    const width = Math.min(360, window.innerWidth-16);
    el.style.cssText = `position:fixed;left:${Math.min(Math.max(8,r.left), window.innerWidth-width-8)}px;bottom:${Math.max(8, window.innerHeight-r.top+6)}px;top:auto;right:auto;width:${width}px;max-height:${Math.max(180, r.top-16)}px;overflow:auto;margin:0;z-index:350`;
  }
  el.classList.toggle('visible', open);
}
function removeFloatingComandaOptions(){ document.querySelectorAll('body > .pdv-options-panel.floating').forEach(e=>e.remove()); }
if(typeof document.addEventListener==='function') document.addEventListener('click', e=>{
  const panel = document.querySelector('body > .pdv-options-panel.floating.visible'); if(!panel) return;
  if(e.target.closest && e.target.closest('#comandaMoreBtn')) return;
  if(panel.contains(e.target)){ if(e.target.closest('button')) setTimeout(()=>panel.classList.remove('visible'),0); return; }
  panel.classList.remove('visible');
});
function openComandaTransferOptions(saleId){
  toggleComandaOrderOptions(false);
  const s=state.sales.find(x=>x.id===saleId); const member=s&&s.memberId?state.members.find(m=>m.id===s.memberId):null;
  const quota=member&&member.code?member.code:'—';
  openModal('Trocar pedido para...', `<div class="pdv-options-inner" style="border:1px solid var(--c-border)">
    <button onclick="closeModal();openComandaItemTransfer(${jsArg(saleId)})">Outra Mesa/Comanda (Atual: ${h(quota)})</button>
    <button onclick="toast('Use Caixa/PDV para atender este pedido no balcão.')">Balcão</button>
    <button disabled title="Recurso da versão paga">Pedido no Caixa</button>
    <button onclick="toast('Delivery não está disponível — o clube não trabalha com entregas.')">Delivery</button>
    <button class="cancel" onclick="closeModal();openComanda(${jsArg(saleId)},true)">Cancelar (ESC)</button>
  </div>`);
  const modal=document.querySelector('#modalRoot .modal');
  modal.classList.add('record-modal');
  modal.style.width='380px';
}
function viewComandaSummary(saleId){toggleComandaOrderOptions(false);const s=state.sales.find(x=>x.id===saleId);if(!s)return;const member=s.memberId?state.members.find(m=>m.id===s.memberId):null,who=member?member.name:(s.customerName||'Avulso'),items=(currentSaleDraft.items||[]).filter(i=>!i.canceled),total=saleTotal(items);openModal('Conta Resumida — '+who,`<div class="finance-grid" style="max-height:320px"><table><thead><tr><th>Produto</th><th>Qtd.</th><th>Valor Unit.</th><th>Total</th></tr></thead><tbody>${items.length?items.map(i=>`<tr><td>${h(i.name)}</td><td>${i.qty}</td><td class="mono">${fmt(i.price)}</td><td class="mono">${fmt(i.price*i.qty)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nenhum item lançado.</td></tr>'}</tbody></table></div><div style="display:flex;justify-content:space-between;margin:14px 4px;font-size:18px;font-weight:700"><span>Total</span><span class="mono">${fmt(total)}</span></div><div class="consumer-modal-actions"><button onclick="closeModal();openComanda(${jsArg(saleId)},true)">〈 Voltar</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button></div>`,true);}
// Transferir/copiar itens (pedido do dono, 10/10): o destino pode ser uma comanda nova, aberta
// ali mesmo (sócio ou avulso), e os itens são escolhidos um a um, inclusive os já enviados à
// cozinha (lançado na comanda errada). Copiar continua só para itens ainda não enviados: copiar
// um enviado cobraria duas vezes sem a cozinha saber.
let transferAccount = null;
function openComandaItemTransfer(saleId){
  toggleComandaOrderOptions(false);
  const items=(currentSaleDraft.items||[]).map((it,idx)=>({it,idx})).filter(x=>!x.it.canceled);
  if(!items.length){ toast('Não há itens nesta comanda para transferir.'); return; }
  transferAccount=null;
  const targets=state.sales.filter(x=>x.status==='open'&&!x.canceled&&x.id!==saleId&&x.type==='comanda');
  const opts=targets.map(t=>{const m=t.memberId?state.members.find(x=>x.id===t.memberId):null,who=m?m.name:(t.customerName||'Avulso');return `<option value="${h(t.id)}">${h(who)}${t.orderNumber?' — Pedido #'+t.orderNumber:''}</option>`;}).join('');
  const clube=(state.settings.operationMode||'clube')!=='bar';
  openModal('Transferir/Copiar Itens',`
    <div class="field"><label>Itens</label><div class="transfer-items">${items.map(({it,idx})=>`<label class="transfer-item"><input type="checkbox" value="${idx}" ${it.sent?'':'checked'}><span>${Number(it.qty)||0}x ${h(it.name)}</span><span class="sub">${it.sent?'já na cozinha':'não enviado'}</span><span class="mono">${fmt((Number(it.qty)||0)*(Number(it.price)||0))}</span></label>`).join('')}</div></div>
    <div class="field"><label>Pedido de destino</label><select id="transferTargetSale" onchange="toggleTransferNew()">${opts}<option value="__new">＋ Abrir nova comanda…</option></select></div>
    <div id="transferNewBox" hidden>
      ${clube?`<div class="field"><label>Sócio (nome ou cota)</label><input id="trAccountSearch" autocomplete="off" placeholder="Digite o nome do titular ou a cota..." oninput="transferAccount=null;filterTransferAccounts(this.value)"></div><div id="trAccountResults" class="comanda-account-results"></div><p class="sub" style="margin:4px 0 8px">Ou, para cliente avulso:</p>`:''}
      <div class="field"><label>${clube?'Cliente avulso (nome ou mesa)':'Mesa ou nome do cliente'}</label><input id="trCustomer" placeholder="Ex.: Mesa 4 — João" oninput="if(this.value.trim()){transferAccount=null;const b=document.getElementById('trAccountSearch');if(b)b.value='';}"></div>
    </div>
    <div class="field"><label>Ação</label><select id="transferMode"><option value="move">Transferir (remove daqui)</option><option value="copy">Copiar (mantém aqui também)</option></select></div>
    <div class="consumer-modal-actions"><button onclick="closeModal();openComanda(${jsArg(saleId)},true)">〈 Voltar</button><button class="consumer-save" onclick="confirmComandaItemTransfer(${jsArg(saleId)})">✓ Confirmar</button></div>`,true);
  if(!targets.length){ document.getElementById('transferTargetSale').value='__new'; toggleTransferNew(); }
}
function toggleTransferNew(){ const box=document.getElementById('transferNewBox'); if(box) box.hidden=document.getElementById('transferTargetSale').value!=='__new'; }
function filterTransferAccounts(value){
  const q=String(value||'').trim().toLowerCase(), box=document.getElementById('trAccountResults'); if(!box) return;
  if(!q){ box.innerHTML=''; return; }
  const choices=comandaAccountChoices().filter(x=>[x.name,x.quota].join(' ').toLowerCase().includes(q)).slice(0,20);
  box.innerHTML=choices.map(x=>`<button type="button" class="comanda-account-choice" onclick="selectTransferAccount(${jsArg(x.key)})"><b>${h(x.name)}</b><span>Titular${x.quota?' · Cota '+h(x.quota):''}</span></button>`).join('')||'<p class="empty">Nenhum titular ou cota encontrado.</p>';
}
function selectTransferAccount(key){
  const c=comandaAccountChoices().find(x=>x.key===key); if(!c) return;
  transferAccount=c;
  document.getElementById('trAccountSearch').value=c.quota?c.name+' — Cota '+c.quota:c.name;
  document.getElementById('trAccountResults').innerHTML='';
  const cust=document.getElementById('trCustomer'); if(cust) cust.value='';
}
async function confirmComandaItemTransfer(saleId){
  const src=state.sales.find(x=>x.id===saleId); if(!src) return;
  const mode=document.getElementById('transferMode').value;
  const picked=[...document.querySelectorAll('.transfer-item input:checked')].map(x=>currentSaleDraft.items[Number(x.value)]).filter(Boolean);
  if(!picked.length){ toast('Marque os itens que vão para o outro pedido.'); return; }
  if(mode==='copy' && picked.some(i=>i.sent)){ toast('Copiar só vale para itens ainda não enviados à cozinha. Para item já enviado, use Transferir.'); return; }
  if(mode==='move'){
    const rest=saleTotal(currentSaleDraft.items.filter(i=>!picked.includes(i)));
    if(comandaPartialPaid(src)>rest+TOLERANCIA_CENTAVO){ toast('Esta comanda já recebeu '+fmt(comandaPartialPaid(src))+' em pagamento parcial; sem esses itens o total fica menor que isso. Estorne o parcial antes.'); return; }
  }
  let targetId=document.getElementById('transferTargetSale').value, target=null, created=false;
  if(targetId==='__new'){
    const customer=(document.getElementById('trCustomer')||{}).value?.trim()||'';
    const choice=transferAccount;
    if(!choice && !customer){ toast('Escolha o sócio ou informe o cliente avulso da nova comanda.'); return; }
    if(choice && choice.memberId){
      const existing=state.sales.find(x=>x.status==='open'&&!x.canceled&&x.memberId===choice.memberId&&x.id!==saleId);
      if(existing){ target=existing; }
      else if(!await ensureMemberCanOpen(state.members.find(m=>m.id===choice.memberId), ()=>openComanda(saleId,true))) return;
    }
    if(!target){
      target={id:uid(),type:'comanda',tableNumber:null,orderNumber:await nextOrderNumber(),memberId:choice&&choice.memberId||null,dependentId:null,dependentName:'',customerName:choice?choice.name:customer,items:[],total:0,status:'open',payments:[],openedAt:new Date().toISOString(),operatorName:currentUser.name};
      state.sales.push(target); created=true;
    }
    targetId=target.id;
  } else {
    target=state.sales.find(x=>x.id===targetId);
  }
  if(!target){ toast('Selecione um pedido de destino.'); return; }
  const moved=picked.map(i=>mode==='copy'?{...i,lineId:uid()}:{...i});
  const movedKeys=new Set(picked.map(comandaItemKey));
  if(created){ target.items=moved; target.total=saleTotal(target.items); await save('sales'); }
  else await commitSaleChange(targetId, cur=>{ cur.items=[...(cur.items||[]), ...moved]; cur.total=saleTotal(cur.items); });
  if(mode==='move'){
    currentSaleDraft.items=currentSaleDraft.items.filter(i=>!picked.includes(i));
    await commitSaleChange(saleId, cur=>{ cur.items=(cur.items||[]).filter(i=>!movedKeys.has(comandaItemKey(i))); cur.total=saleTotal(cur.items); });
  }
  const dest=target.customerName||'Avulso';
  logAction('Itens '+(mode==='move'?'transferidos':'copiados')+' do pedido #'+(src.orderNumber||saleId)+' para #'+(target.orderNumber||targetId)+(created?' (comanda nova)':'')+': '+picked.map(i=>i.qty+'x '+i.name).join(', '));
  closeModal(); renderAll();
  toast((mode==='move'?'Itens transferidos':'Itens copiados')+' para '+dest+(created?' (comanda nova aberta)':'')+'.');
  openComanda(saleId,true);
}
function printComandaConsumption(saleId){toggleComandaOrderOptions(false);window.print();}
function recalculateComandaOrder(saleId){toggleComandaOrderOptions(false);renderDraftItems();toast('Pedido recalculado.');}
async function deleteComandaOrder(saleId){toggleComandaOrderOptions(false);const s=state.sales.find(x=>x.id===saleId);if(!s)return;if((s.items||[]).some(i=>i.sent)){toast('Este pedido já tem itens enviados à cozinha e não pode ser excluído. Use o fechamento normal.');return;}if(!await askConfirm({title:'Excluir este pedido?',message:'Essa ação não pode ser desfeita.',confirmLabel:'Excluir pedido'}))return;state.sales=state.sales.filter(x=>x.id!==saleId);save('sales');closeModal();renderAll();toast('Pedido excluído.');logAction('Pedido excluído: '+saleId);}

/* Comandas nominais: exibe somente atendimentos abertos, sem grade fixa numerada. */
function comandaPersonData(s){const member=s.memberId?state.members.find(m=>m.id===s.memberId):null,person=member&&member.name||s.customerName||'Sem identificação',quota=member&&member.code?String(member.code):'';return{member,person,quota,label:quota?person+' — Cota '+quota:person};}
function comandaListOrder(){ try{ return localStorage.getItem('cantina2:comandaOrder')==='nome'?'nome':'antigas'; }catch(e){ return 'antigas'; } }
function setComandaListOrder(v){ try{ localStorage.setItem('cantina2:comandaOrder', v); }catch(e){} renderComandas(); }
function renderComandas(){
  const el=document.getElementById('view-comandas');
  if(!state.cashSession||state.cashSession.status!=='open'){comandaAbertaId=null;el.innerHTML=`<div class="consumer-workspace"><section class="free-cash"><h2>Caixa livre</h2><div class="free-cash-actions"><button class="op-btn" onclick="switchView('caixa')">‹ &nbsp; Abrir caixa</button><button class="op-btn primary" onclick="switchView('caixa')"><span class="op-ico">＋</span> Iniciar atendimento</button></div><p class="sub" style="margin-top:25px">Abra o caixa para liberar mesas e comandas.</p></section></div>`;return;}
  // Comanda aberta na tela (openComanda): a atualização periódica não redesenha por cima do que
  // o caixa está digitando; se ela foi fechada, cancelada ou apagada, volta para a lista.
  if(comandaAbertaId){
    const cur=state.sales.find(s=>s.id===comandaAbertaId);
    if(cur&&cur.status==='open'&&!cur.canceled){ if(!el.querySelector('.comanda-inline[data-sale="'+CSS.escape(cur.id)+'"]')) renderComandaDetail(cur.id); return; }
    comandaAbertaId=null;
  }
  const open=state.sales.filter(s=>s.status==='open'&&s.type==='comanda');
  // Lista de comandas abertas (pedido do dono, 09/10): cartões compactos que enchem a largura,
  // nome e total na mesma linha, cota e local abaixo, cor do tempo por idade (verde < 1 h,
  // amarelo < 2 h, vermelho a partir de 2 h), ordem escolhida e resumo do que está em aberto.
  const order = comandaListOrder();
  const sorted = open.slice().sort((a,b)=> order==='nome'
    ? comandaPersonData(a).person.localeCompare(comandaPersonData(b).person,'pt-BR')
    : new Date(a.openedAt||0)-new Date(b.openedAt||0));
  const totalAberto = open.reduce((t,s)=>t+(Number(s.total)||0),0);
  // Visual A, etapa 2: a comanda escolhida aparece no painel à direita (comandaPanelHtml).
  // Pedido do dono (31/10): nada vem escolhido de saída; o painel só aparece depois do clique
  // numa comanda, e a lista ocupa a largura toda enquanto isso.
  if(!sorted.some(s=>s.id===comandaSelecionadaId)) comandaSelecionadaId = null;
  const prevSearch = document.getElementById('comandaSearch'), prevQ = prevSearch ? prevSearch.value : '', searchFocused = document.activeElement===prevSearch;
  const cards=sorted.map(s=>{const info=comandaPersonData(s);const ageMin=kOrderAgeMin(s.openedAt);const age=comandaAgeClass(ageMin);
    const meta=[info.quota?'Cota '+info.quota:(info.member&&info.person!==info.member.name?info.member.name:''), s.local||''].filter(Boolean);
    const sel = s.id===comandaSelecionadaId;
    return `<button class="comanda-card ${age} ${sel?'selected':''}" aria-pressed="${sel}" title="Dois cliques abrem a comanda completa" data-search="${h(([info.person,info.quota,info.member&&info.member.name,s.orderNumber,s.local].filter(Boolean).join(' ')).toLowerCase())}" onclick="selectComanda(${jsArg(s.id)})" ondblclick="abrirComandaDoClique(${jsArg(s.id)})">
      <span class="cc-name">${h(info.person)}</span><span class="cc-total mono">${fmt(s.total)}</span>
      <span class="cc-meta">${meta.length?meta.map(h).join(' · '):'Sem cota ou local'}</span>
      <span class="cc-time" title="Tempo em aberto"><i class="cc-dot"></i>${fmtOpenDuration(ageMin)}</span>
    </button>`;}).join('');
  el.innerHTML=`<div class="table-workspace comanda-workspace comanda-split"><div class="comanda-list-col"><div class="table-toolbar"><div class="op-search"><input type="search" id="comandaSearch" placeholder="Pessoa ou cota"></div><div class="seg-toggle" role="group" aria-label="Ordenar comandas"><button class="${order==='antigas'?'active':''}" onclick="setComandaListOrder('antigas')">Mais antigas</button><button class="${order==='nome'?'active':''}" onclick="setComandaListOrder('nome')">Nome</button></div><div style="flex:1"></div><div class="pdv-menu-wrap"><button class="op-btn ${comandaOptionsOpen?'active':''}" onclick="toggleComandaOptions()">••• &nbsp; Opções ▾</button>${comandaOptionsOpen?`<div class="pdv-menu" style="top:48px"><button onclick="openMergeOrdersModal()">⇄ &nbsp; Juntar pedidos</button><button onclick="refreshComandas()">↻ &nbsp; Atualizar</button></div>`:''}</div><button class="op-btn primary" onclick="openNewComandaModal()">＋ Iniciar Pedido Balcão (F6)</button></div><div class="comanda-list-head"><h3 class="table-heading">Comandas abertas <span>${open.length}</span></h3><span class="comanda-list-sum">Em aberto: <b class="mono">${fmt(totalAberto)}</b></span></div><div class="comanda-grid" id="comandaTiles"><button class="comanda-card comanda-card-add" onclick="openNewComandaModal()" title="Abrir nova mesa ou comanda"><span class="cc-plus">＋</span><span>Abrir comanda</span></button>${cards}</div></div>${comandaPanelHtml(state.sales.find(s=>s.id===comandaSelecionadaId))}</div>`;
  const search=document.getElementById('comandaSearch');
  search.oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#comandaTiles .comanda-card[data-search]').forEach(card=>card.style.display=card.dataset.search.includes(q)?'':'none');};
  // a atualização periódica redesenha a lista: mantém o que estava digitado na busca
  if(prevQ){ search.value=prevQ; search.oninput({target:search}); }
  if(searchFocused) search.focus();
};
function comandaAccountChoices(){return state.members.filter(m=>!m.archived&&m.active!==false).map(m=>({key:m.id,memberId:m.id,dependentId:null,name:m.name,owner:m.name,quota:m.code||'',canOrder:true}));}
function openNewComandaModal(){
  window.selectedComandaAccount=null;
  if((state.settings.operationMode||'clube')==='bar'){
    openModal('Abrir Comanda', `<div class="consumer-form-frame"><div class="field"><label>Número da mesa ou nome do cliente</label><input id="ncCustomer" placeholder="Ex: Mesa 5, ou o nome do cliente"></div></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveNewNamedComanda()">✓ Abrir Comanda</button></div>`,true);
    document.querySelector('#modalRoot .modal').classList.add('finance-record-modal','named-comanda-modal');
    setTimeout(()=>document.getElementById('ncCustomer')?.focus(),0);
    return;
  }
  openModal('Abrir Mesa / Comanda',`<div class="consumer-form-frame"><div class="field"><label>Buscar pelo nome do titular ou número da cota</label><div class="op-search comanda-account-search" style="width:100%"><input id="ncAccountSearch" autocomplete="off" placeholder="Digite o nome do titular ou a cota..." oninput="clearSelectedComandaAccount();filterComandaAccountChoices(this.value)"></div></div><div id="ncAccountResults" class="comanda-account-results"><p class="empty">Digite ao menos parte do nome ou da cota para pesquisar.</p></div><div id="ncSelectedAccount" class="panel" hidden></div><div class="field"><label>Cliente avulso</label><input id="ncCustomer" placeholder="Use somente quando não houver cota cadastrada" oninput="if(this.value.trim())clearSelectedComandaAccount(true)"></div></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveNewNamedComanda()">✓ Abrir Comanda</button></div>`,true);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal','named-comanda-modal');setTimeout(()=>document.getElementById('ncAccountSearch')?.focus(),0);};
function filterComandaAccountChoices(value){const q=String(value||'').trim().toLowerCase(),box=document.getElementById('ncAccountResults');if(!box)return;if(!q){box.innerHTML='<p class="empty">Digite ao menos parte do nome ou da cota para pesquisar.</p>';return;}const choices=comandaAccountChoices().filter(x=>[x.name,x.quota].join(' ').toLowerCase().includes(q)).slice(0,30);box.innerHTML=choices.map(x=>`<button type="button" class="comanda-account-choice" onclick="selectComandaAccount(${jsArg(x.key)})"><b>${h(x.name)}</b><span>Titular${x.quota?' · Cota '+h(x.quota):''}</span></button>`).join('')||'<p class="empty">Nenhum titular ou cota encontrado.</p>';}
function clearSelectedComandaAccount(keepSearch){window.selectedComandaAccount=null;const selected=document.getElementById('ncSelectedAccount');if(selected){selected.hidden=true;selected.innerHTML='';}if(!keepSearch){const customer=document.getElementById('ncCustomer');if(customer)customer.value='';}}
function selectComandaAccount(key){const choice=comandaAccountChoices().find(x=>x.key===key);if(!choice||!choice.canOrder)return;window.selectedComandaAccount=choice;document.getElementById('ncAccountSearch').value=choice.quota?choice.name+' — Cota '+choice.quota:choice.name;document.getElementById('ncAccountResults').innerHTML='';const selected=document.getElementById('ncSelectedAccount');selected.hidden=false;selected.innerHTML=`<b>${h(choice.name)}</b><p class="sub">${choice.dependentId?'Dependente de '+h(choice.owner):'Titular da conta'}${choice.quota?' · Cota '+h(choice.quota):''}</p>`;document.getElementById('ncCustomer').value='';}
async function saveNewNamedComanda(){
  const customerName=document.getElementById('ncCustomer').value.trim();
  if((state.settings.operationMode||'clube')==='bar'){
    if(!customerName){ toast('Informe a mesa ou o nome do cliente.'); return; }
    const s={id:uid(),type:'comanda',tableNumber:null,orderNumber:await nextOrderNumber(),memberId:null,dependentId:null,dependentName:'',customerName,items:[],total:0,status:'open',payments:[],openedAt:new Date().toISOString(),operatorName:currentUser.name};
    state.sales.push(s);save('sales');closeModal();renderAll();openNovoPedidoModal(s.id);
    return;
  }
  const choice=window.selectedComandaAccount;if(!choice&&!customerName){toast('Busque e selecione uma cota ou informe o cliente avulso.');return;}
  if(choice&&choice.memberId){
    const member = state.members.find(x=>x.id===choice.memberId);
    const existing=state.sales.find(x=>x.status==='open'&&x.memberId===choice.memberId);if(existing){closeModal();renderAll();toast('Essa cota já tem uma comanda aberta — abrindo ela.');openComanda(existing.id,true);return;}
    if(!await ensureMemberCanOpen(member, ()=>createComandaForAccount(choice,''))) return;
  }
  await createComandaForAccount(choice, customerName);
}
async function createComandaForAccount(choice, customerName){
  const s={id:uid(),type:'comanda',tableNumber:null,orderNumber:await nextOrderNumber(),memberId:choice&&choice.memberId||null,dependentId:null,dependentName:'',customerName:choice?choice.name:customerName,items:[],total:0,status:'open',payments:[],openedAt:new Date().toISOString(),operatorName:currentUser.name};state.sales.push(s);save('sales');closeModal();renderAll();openNovoPedidoModal(s.id);
}

