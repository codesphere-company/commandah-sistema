/* ============ COMANDAS ============ */
let comandaOptionsOpen=false;
function toggleComandaOptions(){ comandaOptionsOpen=!comandaOptionsOpen; renderComandas(); }
function refreshComandas(){ comandaOptionsOpen=false; renderAll(); toast('Mesas e comandas atualizadas.'); }
function comandaDisplayName(s){
  const member=s.memberId?state.members.find(m=>m.id===s.memberId):null;
  const who=member?member.name:(s.customerName||'Cliente avulso');
  return `${s.tableNumber?'Mesa '+String(s.tableNumber).padStart(2,'0'):'Pedido balcão'} — ${who}`;
}
function openMergeOrdersModal(){
  comandaOptionsOpen=false;
  const open=state.sales.filter(s=>s.status==='open');
  if(open.length<2){ toast('É necessário ter pelo menos dois pedidos abertos para juntar.'); renderComandas(); return; }
  const options=open.map(s=>`<option value="${s.id}">${h(comandaDisplayName(s))} · ${fmt(s.total)}</option>`).join('');
  openModal('Juntar pedidos', `<p class="sub">Todos os itens e registros de cozinha do pedido de origem serão transferidos para o pedido de destino. Nenhum estoque será baixado novamente.</p><div class="field"><label>Pedido de origem</label><select id="mergeSource">${options}</select></div><div class="field"><label>Pedido de destino</label><select id="mergeTarget">${options}</select></div><button class="btn btn-primary btn-block" id="mergeConfirm">Juntar pedidos</button>`);
  document.getElementById('mergeTarget').selectedIndex=1;
  document.getElementById('mergeConfirm').onclick=mergeOpenOrders;
}
async function mergeOpenOrders(){
  const sourceId=document.getElementById('mergeSource').value;
  const targetId=document.getElementById('mergeTarget').value;
  if(sourceId===targetId){ toast('Escolha pedidos diferentes.'); return; }
  const source=state.sales.find(s=>s.id===sourceId&&s.status==='open');
  const target=state.sales.find(s=>s.id===targetId&&s.status==='open');
  if(!source||!target){ toast('Um dos pedidos não está mais aberto. Atualize a tela.'); return; }
  target.items=[...(target.items||[]),...(source.items||[])];
  target.total=target.items.reduce((sum,item)=>sum+(Number(item.price)||0)*(Number(item.qty)||0),0);
  target.mergedFrom=[...(target.mergedFrom||[]),source.orderNumber||source.id,...(source.mergedFrom||[])];
  await OrdersStore.reassignSale(source.id, target.id);
  state.sales=state.sales.filter(s=>s.id!==source.id);
  save('sales'); closeModal(); logAction(`Pedidos juntados: ${comandaDisplayName(source)} em ${comandaDisplayName(target)}`); renderAll(); toast('Pedidos juntados com sucesso.');
}
/* Comanda aberta na própria tela de comandas, no lugar da lista (pedido do dono, 18/10, como no
   Saipos); antes abria num popup. Os popups que saem dela (novo pedido, parcial, trocar cliente,
   pagamento...) continuam por cima e voltam por openComanda(id, true). Fechada, paga, cancelada ou
   apagada, renderComandas volta para a lista. */
let comandaAbertaId = null;
function openComanda(id, keepRequester){
  const s = state.sales.find(x=>x.id===id); if(!s) return;
  if(document.getElementById('modalRoot').innerHTML.trim()) closeModal();
  comandaAbertaId = id;
  if(activeView!=='comandas'){ switchView('comandas'); return; } // renderComandas desenha a comanda
  renderComandaDetail(id, keepRequester);
}
function closeComandaView(){
  comandaAbertaId = null; removeFloatingComandaOptions();
  renderComandas();
}
/* Visual A, etapa 2 (pedido do dono, 22/10): um clique escolhe a comanda e mostra o resumo num
   painel à direita da lista (itens, total, novo pedido, fechar conta); dois cliques, ou "Abrir
   comanda completa", abrem a tela cheia acima. Tela estreita (até 900 px) não tem painel: o
   clique abre direto. */
let comandaSelecionadaId = null;
function selectComanda(id){
  if(matchMedia('(max-width: 900px)').matches){ openComanda(id); return; }
  comandaSelecionadaId = id; renderComandas();
}
// Fechar conta pelo painel: abre a comanda e segue o mesmo caminho do botão Pagamento dela
// (manda o que faltar para a cozinha, junta os itens do garçom e abre o pagamento).
function comandaPanelPay(id){
  openComanda(id);
  const btn = document.getElementById('btnCloseComanda'); if(btn) btn.click();
}
// Rodapé da comanda em tela cheia (22/10): mostrava subtotal + serviço sem abater o crédito do
// sócio, e o total ficava maior que o do pagamento. Agora é a mesma conta do pagamento, do painel
// e do app do garçom (gcComandaTotals), com os itens ainda não enviados do rascunho.
function comandaDraftTotalsHtml(){
  const sale = state.sales.find(x=>x.id===currentSaleDraft.id); if(!sale) return renderTotalWithService(draftTotal());
  const t = gcComandaTotals({ ...sale, items: currentSaleDraft.items });
  return `<div class="cash-order-total-breakdown">
    <div class="cash-order-subtotal-line"><span>Subtotal</span><span class="mono">${fmt(t.subtotal)}</span></div>
    ${t.creditApplied>0.009?`<div class="cash-order-subtotal-line"><span>(−) Crédito do sócio (abatido)</span><span class="mono">− ${fmt(t.creditApplied)}</span></div>`:''}
    ${t.service>0.009?`<div class="cash-order-service-line"><span>(+) Serviço (${serviceRatePct()}%)</span><span class="mono">${fmt(t.service)}</span></div>`:''}
    ${t.partialPaid>0.009?`<div class="cash-order-subtotal-line"><span>(−) Já pago (parcial)</span><span class="mono">− ${fmt(t.partialPaid)}</span></div>`:''}
    ${t.debt>0.009?`<div class="cash-order-subtotal-line"><span>(+) Pendência anterior (fiado)</span><span class="mono">${fmt(t.debt)}</span></div>`:''}
    <div class="cash-order-total"><span>Total</span><span class="mono" id="draftTotal">${fmt(t.total)}</span></div>
  </div>`;
}
function comandaPanelHtml(s){
  if(!s) return `<aside class="comanda-panel comanda-panel-empty" aria-label="Comanda selecionada"><p>Nenhuma comanda aberta.</p><button class="op-btn primary" onclick="openNewComandaModal()">＋ Abrir comanda</button></aside>`;
  const info = comandaPersonData(s);
  const items = (s.items||[]).filter(i=>!i.canceled && Number(i.qty)>0);
  const grouped = [];
  items.forEach(i=>{ const key=(i.productId||'')+'|'+i.name+'|'+Number(i.price); const g=grouped.find(x=>x.key===key); if(g){ g.qty+=Number(i.qty); } else grouped.push({ key, name:i.name, price:Number(i.price)||0, qty:Number(i.qty) }); });
  // Mesma conta do pagamento e do app do garçom: crédito do sócio abatido antes do serviço,
  // parcial no fim e pendência anterior (fiado liberado) junto. Antes o painel somava só
  // consumo + serviço e mostrava um total maior que o do pagamento.
  const t = gcComandaTotals(s);
  const meta = [s.orderNumber?'Pedido #'+s.orderNumber:'', 'aberta há '+fmtOpenDuration(kOrderAgeMin(s.openedAt)), s.operatorName||'', s.local||''].filter(Boolean);
  return `<aside class="comanda-panel" aria-label="Comanda selecionada" data-sale="${h(s.id)}">
    <div class="cp-head"><span class="cp-num">${h(info.quota||(s.orderNumber?'#'+s.orderNumber:''))}</span><span class="cp-name">${h(info.person)}</span></div>
    <div class="cp-meta">${meta.map(h).join(' · ')}</div>
    ${s.locked?`<span class="tag tag-red">Pedido bloqueado</span>`:''}
    <div class="cp-items">${grouped.length?grouped.map(g=>`<div class="cp-item"><span class="cp-qty">${g.qty}×</span><span class="cp-iname">${h(g.name)}</span><span class="mono">${fmt(g.price*g.qty)}</span></div>`).join(''):'<p class="cp-empty">Nenhum item lançado ainda.</p>'}</div>
    <div class="cp-totals">
      <div><span>Consumo</span><span class="mono">${fmt(t.subtotal)}</span></div>
      ${t.creditApplied>0.009?`<div><span>Crédito do sócio (abatido)</span><span class="mono">− ${fmt(t.creditApplied)}</span></div>`:''}
      ${t.service>0.009?`<div><span>Serviço ${serviceRatePct()}%</span><span class="mono">${fmt(t.service)}</span></div>`:''}
      ${t.partialPaid>0.009?`<div><span>Já pago (parcial)</span><span class="mono">− ${fmt(t.partialPaid)}</span></div>`:''}
      ${t.debt>0.009?`<div class="cp-debt"><span>Pendência anterior (fiado)</span><span class="mono">+ ${fmt(t.debt)}</span></div>`:''}
      <div class="cp-total"><span>Total</span><span class="mono">${fmt(t.total)}</span></div>
    </div>
    <div class="cp-actions">
      <button class="op-btn" onclick="openNovoPedidoModal(${jsArg(s.id)})" ${s.locked?'disabled':''}>＋ Novo pedido</button>
      <button class="op-btn" onclick="openComanda(${jsArg(s.id)})">Abrir comanda completa</button>
      <button class="op-btn primary cp-pay" onclick="comandaPanelPay(${jsArg(s.id)})" ${s.locked?'disabled':''}>Fechar conta · ${fmt(t.total)}</button>
    </div>
  </aside>`;
}
function renderComandaDetail(id, keepRequester){
  const s = state.sales.find(x=>x.id===id); if(!s) return;
  removeFloatingComandaOptions();
  currentSaleDraft = { id:s.id, items:JSON.parse(JSON.stringify(s.items)), memberId:s.memberId, customerName:s.customerName, type:'comanda' };
  if(!keepRequester){ comandaQuickCart = []; levarJunto.quick=false; comandaAuditExpanded = new Set(); }
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const person=member&&member.name||s.customerName||'Avulso',who=member?(person+(member.code?' — Cota '+member.code:'')):person;
  const quotaNum = member&&member.code ? h(member.code) : '—';
  const locked = !!s.locked;
  document.getElementById('view-comandas').innerHTML = `<div class="table-workspace comanda-inline" data-sale="${h(s.id)}">
    <div class="record-body">
    <div class="cash-order-head">
      <div class="cash-order-ident"><button class="op-btn comanda-inline-back" onclick="closeComandaView()" title="Voltar para as comandas (Esc)">‹ &nbsp; Comandas</button><span class="cash-order-quota">${quotaNum}</span><span class="delivery-open-badge">Em Aberto</span><strong>${h(person)} &nbsp;·&nbsp; Pedido ${s.orderNumber?'#'+s.orderNumber:''}</strong></div>
      ${member&&Number(member.debt)<-0.009?`<div class="cash-order-balance"><span class="tag tag-green cash-order-balance-tag" title="Abatido automaticamente no pagamento desta comanda">✓ Crédito: ${fmt(-Number(member.debt))}</span></div>`:member&&Number(member.debt)>0.009?`<div class="cash-order-balance"><span class="tag tag-red cash-order-balance-tag" title="Saldo devedor deste sócio">Deve: ${fmt(Number(member.debt))}</span></div>`:''}
    </div>
    <div class="cash-order-layout">
      <aside class="cash-order-side">
        <div class="delivery-meta"><span class="icn">${ICN.clock}</span> Iniciado em ${reportDateTime(s.openedAt)} — <b>${fmtOpenDuration(kOrderAgeMin(s.openedAt))} aberta</b><br><span class="icn">${ICN.user}</span> Criado por: <b>${h(s.operatorName||currentUser.name)}</b></div>
        <div class="field"><input id="comandaNote" value="${h(s.notes||'')}" placeholder="Anotar observação..." onchange="saveComandaNote(${jsArg(s.id)},this.value)" ${locked?'disabled':''}></div>
        <div class="field"><label class="np-label">Mesa / Local</label><select id="comandaLocal" onchange="saveComandaLocal(${jsArg(s.id)},this.value)" ${locked?'disabled':''}><option value="">— Balcão / sem local —</option>${state.locais.map(l=>`<option value="${h(l.nome)}" ${s.local===l.nome?'selected':''}>${h(l.nome)}</option>`).join('')}</select></div>
        <label class="comp-switch" style="margin:8px 0 0"><input type="checkbox" id="comandaLockToggle" ${locked?'checked':''} onchange="toggleComandaLock(${jsArg(s.id)},this.checked)"><span></span> Bloquear Pedido</label>
        <div class="cash-order-links">
          <button onclick="openComandaLinkClient(${jsArg(s.id)})"><span class="icn">${ICN.user}</span> ${member?'Trocar Cliente':'Vincular Cliente'}</button>
          ${member&&hasPerm('associados')?`<button onclick="editMember(${jsArg(member.id)})"><span class="icn">${ICN.idcard}</span> Editar Cadastro</button>`:''}
          <button onclick="openNovoPedidoModal(${jsArg(s.id)})" ${locked?'disabled':''}><span class="icn">${ICN.plus}</span> Novo Pedido</button>
          <button onclick="openPartialPayment(${jsArg(s.id)})" ${locked?'disabled':''}><span class="icn">${ICN.cash}</span> Receber parcial</button>
          <div class="pdv-menu-wrap" style="position:relative">
            <button id="comandaMoreBtn" onclick="toggleComandaOrderOptions()" aria-haspopup="true"><span class="icn">${ICN.menu}</span> Mais Opções</button>
            <div id="comandaOrderOptions" class="pdv-options-panel" style="left:0;right:auto;bottom:100%;top:auto;margin-bottom:6px;width:290px">
              <div class="pdv-options-inner">
                <button onclick="openComandaTransferOptions(${jsArg(s.id)})"><span class="icn">${ICN.swap}</span> Trocar para...</button>
                <button onclick="viewComandaSummary(${jsArg(s.id)})"><span class="icn">${ICN.receipt}</span> Visualizar Conta Resumida</button>
                <button onclick="openComandaItemTransfer(${jsArg(s.id)})"><span class="icn">${ICN.editlist}</span> Transferir/Copiar Itens para Outro Pedido</button>
                <button onclick="printComandaConsumption(${jsArg(s.id)})" ${currentSaleDraft.items.filter(i=>!i.sent).length?'':'disabled'}><span class="icn">${ICN.printer}</span> Imprimir Fichas de Consumação (${currentSaleDraft.items.filter(i=>!i.sent).length} ${currentSaleDraft.items.filter(i=>!i.sent).length===1?'Item novo':'Itens novos'})</button>
                <button onclick="recalculateComandaOrder(${jsArg(s.id)})"><span class="icn">${ICN.gear}</span> Recalcular Pedido</button>
                <div class="pdv-options-danger">
                  ${hasPerm('cancelar-comanda')?`<button class="danger" ${locked?'disabled':''} onclick="openCancelComanda(${jsArg(s.id)})"><span class="icn">${ICN.trash}</span> Cancelar comanda<small>Pede o motivo, devolve o estoque e fica registrado.</small></button>`:''}
                  <button class="danger" onclick="deleteComandaOrder(${jsArg(s.id)})"><span class="icn">${ICN.trash}</span> Excluir pedido<small>Só para pedido sem nada enviado à cozinha. Apaga a comanda.</small></button>
                </div>
                <button class="cancel" onclick="toggleComandaOrderOptions(false)">Fechar menu</button>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <main class="cash-order-main">
        <div class="np-section" style="margin:0 0 12px">
          <label class="np-label">Adicionar produto direto</label>
          <input id="comandaQuickSearch" placeholder="Buscar produto para adicionar..." oninput="renderComandaQuickSearch(this.value)" ${locked?'disabled':''}>
          <div id="comandaQuickSearchResults" class="np-product-grid" style="display:none;margin-top:8px"></div>
          <div id="comandaQuickCartWrap" style="display:none;margin-top:10px"></div>
        </div>
        <div class="comanda-history-panel" style="margin:0;border:0;flex:1;display:flex;flex-direction:column;min-height:0"><div class="comanda-history-head"><b>Histórico da Comanda</b><span>Toque num pedido para ver os itens</span></div><div class="finance-grid" style="flex:1;min-height:0"><table><thead><tr><th>Lançado</th><th>Produto</th><th class="cmd-total">Total</th><th>Entrega</th><th>Situação</th></tr></thead><tbody id="comandaAuditRows"></tbody></table></div></div>
        <div id="draftTotalWrap">${renderTotalWithService(0)}</div>
        <div id="comandaPartialWrap"></div>
      </main>
    </div>
    <div class="record-actions">
      <button class="op-btn" onclick="window.print()"><span class="icn">${ICN.printer}</span> Imprimir</button>
      <button class="op-btn primary" id="btnCloseComanda" ${locked?'disabled':''}>Pagamento</button>
    </div>
  </div></div>`;
  renderDraftItems(); renderComandaAuditHistory(); renderComandaQuickCart(); renderComandaPartials(s.id);
  let closingComanda = false;
  document.getElementById('btnCloseComanda').onclick = async ()=>{
    if(s.locked){ toast('Este pedido está bloqueado. Desbloqueie antes de fechar.'); return; }
    if(closingComanda) return; // duplo clique: não reenviar os mesmos itens pra cozinha
    const unsent = currentSaleDraft.items.filter(i=>!i.sent);
    if(unsent.length){ closingComanda = true; let ok; try{ ok = await sendItemsToKitchen(s.id, unsent, who, 'comanda', s.local); }finally{ closingComanda = false; } if(!ok) return; unsent.forEach(i=>i.sent=true); }
    const fresh = await commitSaleChange(s.id, cur=>{ if(cur.status!=='open'||cur.canceled) return false; cur.items=mergeDraftItems(cur.items, currentSaleDraft.items).items; cur.total=saleTotal(cur.items); });
    if(!fresh) return;
    if(fresh.status!=='open'||fresh.canceled){ toast('Esta comanda já foi fechada ou cancelada em outro aparelho.'); closeComandaView(); renderAll(); return; }
    currentSaleDraft.items = JSON.parse(JSON.stringify(fresh.items)); // itens do garçom entram no total do pagamento
    // OP-04: os itens que iam para a cozinha só neste clique também saem na
    // ficha da estação, como nos outros fluxos. Sem isso, estação "só imprime"
    // (bar, churrasqueira) nunca ficava sabendo e o cliente pagava sem receber.
    if(unsent.length){
      const origem = currentUser.origem||'caixa', groups = {};
      unsent.forEach(i=>{ const key=i.estacao||itemStation(i); (groups[key]=groups[key]||[]).push(i); });
      const printJobs = Object.keys(groups).map(estacao=>{ const printer = resolvePrinterFor(estacao, origem); return { estacao, items:groups[estacao], printer: printer?printer.nome:null }; });
      printNovoPedidoTickets(person, member?member.code:'', s.local, printJobs, s.orderNumber);
    }
    openPaymentModal('comanda', s.id); // paga, finalizeSale -> renderAll volta para a lista
  };
}
function saveComandaNote(saleId,value){const s=state.sales.find(x=>x.id===saleId);if(!s)return;s.notes=value.trim();save('sales');}
function saveComandaLocal(saleId,value){const s=state.sales.find(x=>x.id===saleId);if(!s)return;s.local=value;save('sales');renderAll();logAction('Local de entrega definido: '+(value||'balcão')+' — pedido #'+(s.orderNumber||saleId));}

let npCart = [];
let npSaleId = null;
function openNovoPedidoModal(saleId){
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  npCart = []; levarJunto.np=false;
  npSaleId = saleId;
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const requesterOptions = member
    ? `<option value="">— Selecione —</option><option value="holder:${member.id}" ${memberBlockedByDebt(member)?'disabled':''}>Titular — ${h(member.name)}${memberBlockedByDebt(member)?' (bloqueado — deve '+fmt(member.debt)+')':''}</option>${(member.dependents||[]).map(d=>`<option value="dependent:${d.id}" ${d.canOrder===false||memberBlockedByDebt(member)?'disabled':''}>Dependente — ${h(d.name)}${d.canOrder===false?' (bloqueado)':memberBlockedByDebt(member)?' (bloqueado — cota com pendência)':''}</option>`).join('')}`
    : `<option value="guest">${h(s.customerName||'Cliente avulso')}</option>`;
  const requesterSection = member ? `
    <div class="np-section">
      <label class="np-label">Quem está pedindo *</label>
      <select id="npRequester">${requesterOptions}</select>
      <p id="npRequesterWarn" class="sub" style="display:none;color:var(--red);margin:6px 0 0">Esta pessoa está bloqueada para consumir nesta cota.</p>
      ${memberBlockedByDebt(member)?`<button class="btn btn-sm" style="margin-top:6px" onclick="openWhatsAppCollection(${jsArg(member.id)})">📱 &nbsp; Cobrar via WhatsApp</button>${currentUser&&(currentUser.role==='admin'||sessionIsOwner)?` <button class="btn btn-sm" style="margin-top:6px" onclick="releaseMemberDebtBlock(${jsArg(member.id)},${jsArg(saleId)})">🔓 &nbsp; Liberar (administrador)</button>`:''}`:''}
    </div>` : `<select id="npRequester" style="display:none">${requesterOptions}</select>`;
  // Novo Pedido em duas colunas (pedido do dono, 09/10): cardápio à esquerda com cartões
  // legíveis e aba "Já pedidos"; à direita, sempre visíveis, quem pede, local, itens,
  // total e Confirmar (antes ficavam abaixo do cardápio, fora da tela).
  openModal('Novo Pedido — '+(member?member.name+(member.code?' · Cota '+member.code:''):(s.customerName||'Cliente avulso')), `
    <div class="np-layout">
      <section class="np-menu">
        <div class="np-search-row"><input id="npProductSearch" type="search" placeholder="Buscar produto pelo nome..." oninput="renderNpProductGrid(this.value)" autocomplete="off"><span class="sub" id="npResultCount"></span></div>
        <div class="np-cat-tabs" id="npCatTabs"></div>
        <div id="npProductGrid" class="np-product-grid np-menu-grid"></div>
      </section>
      <aside class="np-side">
        ${requesterSection}
        <div class="np-section">
          <label class="np-label">Local de entrega</label><select id="npLocal"><option value="">— No balcão / retirar aqui —</option>${state.locais.map(l=>`<option value="${h(l.nome)}" ${s.local===l.nome?'selected':''}>${h(l.nome)}</option>`).join('')}</select>
          <div class="np-origin-badge" title="Origem deste pedido">${h(origemLabel(currentUser.origem)||'Caixa')} · ${h(currentUser.name)}</div>
        </div>
        <div class="np-section np-cart">
          <div class="np-cart-head"><label class="np-label" style="margin:0">Itens do pedido</label><span class="sub" id="npItemCount"></span></div>
          <div id="npCartList"></div>
        </div>
        <div class="np-side-foot">
          <div class="np-total"><span>Total</span><span class="mono" id="npCartTotal">R$ 0,00</span></div>
          <div class="np-actions"><button class="btn" onclick="closeModal();openComanda(${jsArg(saleId)},true)">Cancelar</button><button class="btn btn-primary" id="npConfirmBtn">Confirmar e imprimir</button></div>
        </div>
      </aside>
    </div>
  `, true);
  const modal = document.querySelector('#modalRoot .modal'); modal.classList.add('record-modal','np-modal');
  npCategory = npHistoryProducts().length ? '__hist' : '';
  renderNpCatTabs(); renderNpProductGrid(''); renderNpCart();
  setTimeout(()=>{ const q=document.getElementById('npProductSearch'); if(q && window.matchMedia && matchMedia('(pointer:fine)').matches) q.focus(); }, 50);
  document.getElementById('npRequester').onchange = (e)=>{
    const opt = e.target.selectedOptions[0];
    document.getElementById('npRequesterWarn').style.display = opt&&opt.disabled ? 'block':'none';
  };
  document.getElementById('npConfirmBtn').onclick = ()=>confirmNovoPedidoModal(saleId);
}
let npCategory = '';
function renderNpCatTabs(){
  const el = document.getElementById('npCatTabs'); if(!el) return;
  const cats = [...new Set(state.products.filter(p=>p.active!==false).map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(!cats.length){ el.innerHTML=''; return; }
  const hist = npHistoryProducts().length;
  el.innerHTML = (hist?`<button class="np-cat-tab np-cat-hist ${npCategory==='__hist'?'active':''}" onclick="npCategory='__hist';renderNpCatTabs();renderNpProductGrid(document.getElementById('npProductSearch').value)">Já pedidos <b>${hist}</b></button>`:'') + `<button class="np-cat-tab ${!npCategory?'active':''}" onclick="npCategory='';renderNpCatTabs();renderNpProductGrid(document.getElementById('npProductSearch').value)">Todas</button>` +
    cats.map(c=>`<button class="np-cat-tab ${npCategory===c?'active':''}" onclick="npCategory=${h(JSON.stringify(c))};renderNpCatTabs();renderNpProductGrid(document.getElementById('npProductSearch').value)">${h(c)}</button>`).join('');
}
function renderNpProductGrid(q){
  const el = document.getElementById('npProductGrid'); if(!el) return;
  const query = String(q||'').toLowerCase();
  // Buscar sempre procura no cardápio todo; sem busca, vale a aba escolhida.
  let list = npCategory==='__hist' && !query ? npHistoryProducts() : state.products.filter(p=>p.active!==false && p.name.toLowerCase().includes(query));
  if(npCategory && npCategory!=='__hist' ) list = list.filter(p=>p.category===npCategory);
  const countEl = document.getElementById('npResultCount'); if(countEl) countEl.textContent = list.length+' produto'+(list.length===1?'':'s');
  el.innerHTML = list.length ? list.map(p=>{
    const av = productAvailable(p); const out = av!==Infinity && av<=0;
    const inCart = npCart.find(i=>i.productId===p.id);
    return `<button class="btn np-prod-btn ${inCart?'has-qty':''}" ${out?'disabled':''} title="${h(p.name)}" onclick="npCartAdd(${jsArg(p.id)})">${inCart?`<span class="np-qty-badge">${inCart.qty}</span>`:''}<span class="np-prod-name">${h(p.name)}</span>${p.category?`<span class="np-prod-cat">${h(p.category)}</span>`:''}<span class="mono np-prod-price">${fmt(p.price)}</span></button>`;
  }).join('') : '<p class="np-empty">Nenhum produto encontrado.</p>';
}
function npCartAdd(productId){
  const p = state.products.find(x=>x.id===productId); if(!p) return;
  if(productAvailable(p)<=0){ toast('Sem estoque de insumos para este produto.'); return; }
  const existing = npCart.find(i=>i.productId===productId);
  if(existing) existing.qty+=1; else npCart.push({productId, name:p.name, price:p.price, qty:1, estacao:p.estacao||'cozinha', copos:productAsksCopos(p)?0:undefined});
  renderNpCart();
  renderNpProductGrid(document.getElementById('npProductSearch')?.value||'');
  renderNpHistoryGrid();
}
function npCartChangeQty(idx,delta){
  const it = npCart[idx]; if(!it) return;
  it.qty+=delta; if(it.qty<=0) npCart.splice(idx,1);
  renderNpCart();
  renderNpProductGrid(document.getElementById('npProductSearch')?.value||'');
  renderNpHistoryGrid();
}
function npCartChangeCopos(idx,delta){
  const it = npCart[idx]; if(!it) return;
  it.copos = Math.max(0, (it.copos||0)+delta);
  renderNpCart();
}
// Produtos já pedidos nesta comanda (o mais recente primeiro): aba "Já pedidos" do Novo Pedido.
function npHistoryProducts(){
  const s = state.sales.find(x=>x.id===npSaleId);
  const history = s ? s.items||[] : [];
  const seen = new Set(), out = [];
  for(let i=history.length-1;i>=0;i--){ const pid=history[i].productId; if(pid&&!seen.has(pid)){ seen.add(pid); const p=state.products.find(x=>x.id===pid); if(p&&p.active!==false) out.push(p); } }
  return out;
}
function renderNpHistoryGrid(){
  const el = document.getElementById('npHistoryGrid'), section = document.getElementById('npHistorySection');
  if(!el||!section) return;
  const s = state.sales.find(x=>x.id===npSaleId);
  const history = s ? s.items||[] : [];
  const seen = new Set(), uniqueIds = [];
  for(let i=history.length-1;i>=0;i--){ const pid=history[i].productId; if(pid&&!seen.has(pid)){ seen.add(pid); uniqueIds.push(pid); } }
  const list = uniqueIds.map(pid=>state.products.find(p=>p.id===pid)).filter(p=>p&&p.active!==false);
  section.style.display = list.length ? '' : 'none';
  el.innerHTML = list.map(p=>{
    const av = productAvailable(p); const out = av!==Infinity && av<=0;
    const inCart = npCart.find(i=>i.productId===p.id);
    return `<button class="btn np-prod-btn ${inCart?'has-qty':''}" ${out?'disabled':''} onclick="npCartAdd(${jsArg(p.id)})">${inCart?`<span class="np-qty-badge">${inCart.qty}</span>`:''}<span class="np-prod-name">${h(p.name)}</span><span class="mono np-prod-price">${fmt(p.price)}</span></button>`;
  }).join('');
}
function renderNpCart(){
  const el = document.getElementById('npCartList'); if(!el) return;
  el.innerHTML = npCart.length ? npCart.map((i,idx)=>`
    <div class="np-line">
      <div class="np-line-top"><span class="np-line-name">${h(i.name)}</span><span class="mono np-line-sub">${fmt(i.price*i.qty)}</span></div>
      <div class="np-line-ctrl"><span class="sub mono">${fmt(i.price)} cada</span><div class="qty-ctrl"><button onclick="npCartChangeQty(${idx},-1)" aria-label="Diminuir">−</button><span class="mono">${i.qty}</span><button onclick="npCartChangeQty(${idx},1)" aria-label="Aumentar">+</button></div></div>
      ${i.copos!=null?`<div class="np-line-ctrl"><span class="sub">Copos</span><div class="qty-ctrl"><button onclick="npCartChangeCopos(${idx},-1)" aria-label="Menos copos">−</button><span class="mono">${i.copos||0}</span><button onclick="npCartChangeCopos(${idx},1)" aria-label="Mais copos">+</button></div></div>`:''}
    </div>`).join('') + levarJuntoBox(npCart,'np') : '<p class="np-empty">Toque nos produtos à esquerda para adicionar.</p>';
  const totEl = document.getElementById('npCartTotal'); if(totEl) totEl.textContent = fmt(npCart.reduce((a,i)=>a+i.price*i.qty,0));
  const countEl = document.getElementById('npItemCount'); if(countEl){ const n=npCart.reduce((a,i)=>a+i.qty,0); countEl.textContent = n?n+(n===1?' item':' itens'):''; }
}
async function confirmNovoPedidoModal(saleId){
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(!comandaAcceptsOrders(s)) return;
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const reqValue = document.getElementById('npRequester').value;
  if(!reqValue){ toast('Selecione quem está pedindo.'); return; }
  let requester;
  if(reqValue==='guest') requester={id:null,name:s.customerName||'Cliente avulso',type:'avulso',canOrder:true};
  else if(reqValue.startsWith('holder:')) requester={id:member.id,name:member.name,type:'titular',canOrder:true};
  else { const depId=reqValue.split(':')[1], dep=(member.dependents||[]).find(d=>d.id===depId); requester={id:dep&&dep.id,name:dep&&dep.name||'Dependente',type:'dependente',canOrder:!!dep&&dep.canOrder!==false}; }
  if(!requester.canOrder){ toast('Esta pessoa está bloqueada para consumir nesta cota.'); return; }
  if(!npCart.length){ toast('Adicione ao menos um produto.'); return; }
  const local = document.getElementById('npLocal').value;
  const origem = currentUser.origem||'caixa';
  const who = requester.name;
  const items = npCart.map(i=>({...i, lineId:uid(), sent:false, addedAt:new Date().toISOString(), addedBy:currentUser.name, local:local||s.local||'', requesterId:requester.id, requesterName:who, requesterType:requester.type}));
  applyLevarJunto(items, levarJunto.np);
  if(!await sendItemsToKitchen(saleId, items, who, 'comanda', local)) return;
  items.forEach(i=>i.sent=true);
  await commitSaleChange(s.id, cur=>{ cur.items=[...(cur.items||[]), ...items]; cur.total=saleTotal(cur.items); });
  const groups = {};
  items.forEach(i=>{ const key=i.estacao||'cozinha'; (groups[key]=groups[key]||[]).push(i); });
  const printJobs = Object.keys(groups).map(estacao=>{
    const printer = resolvePrinterFor(estacao, origem);
    return { estacao, items:groups[estacao], printer: printer?printer.nome:null };
  });
  logAction('Pedido registrado para '+who+(local?' — local: '+local:'')+' — origem: '+origemLabel(origem));
  printNovoPedidoTickets(who, member?member.code:'', local, printJobs, s.orderNumber);
  toast('Pedido confirmado e enviado para a cozinha.');
  closeModal(); openComanda(saleId, true); renderComandas();
}
function printNovoPedidoTickets(who, cota, local, printJobs, orderNumber){
  const jobsToPrint = printJobs.filter(job=>saidaTemImpressao(job.estacao));
  if(!jobsToPrint.length) return;
  jobsToPrint.forEach((job, idx)=>{
    setTimeout(()=>printSingleTicket(who, cota, local, job.estacao, job.printer, job.items, orderNumber), idx*700);
  });
}
const PRINT_AGENT_URL = 'http://localhost:9123';
function printerAgentBase(imp){ return imp&&imp.agentUrl ? 'http://'+imp.agentUrl : PRINT_AGENT_URL; }
function explainMixedContentFix(){
  openModal('Como liberar a impressão automática', `
    <p class="sub">O site está em HTTPS (endereço seguro), mas o agente de impressão do computador roda em HTTP simples. Por padrão, o navegador bloqueia essa comunicação por segurança — é preciso liberar manualmente, uma única vez, em CADA computador que imprime.</p>
    <p><b>No Google Chrome:</b></p>
    <ol style="padding-left:20px;font-size:13.5px;line-height:1.8">
      <li>Com o sistema aberto neste computador, clique no ícone de cadeado/informações ao lado do endereço, na barra do navegador</li>
      <li>Clique em "Configurações do site" (ou "Site settings")</li>
      <li>Procure por "Conteúdo inseguro" (ou "Insecure content")</li>
      <li>Mude de "Bloquear (padrão)" para "Permitir"</li>
      <li>Recarregue a página (F5)</li>
    </ol>
    <p class="sub">Depois disso, esse computador específico vai conseguir falar com o agente normalmente, sempre que abrir o sistema por esse mesmo endereço.</p>
    <button class="btn btn-primary btn-block" onclick="closeModal()">Entendi</button>
  `);
}
async function pingPrintAgent(base, timeoutMs){
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), timeoutMs||1200);
    const res = await fetch((base||PRINT_AGENT_URL)+'/status', {signal:ctrl.signal});
    clearTimeout(t);
    return res.ok;
  }catch(e){ return false; }
}
async function renderPrinterQueueStatus(){
  const box = document.getElementById('agentStatusBox'); if(!box) return;
  if(!state.impressoras.length){ box.className='tag tag-gray'; box.textContent='Cadastre impressoras abaixo pra habilitar a checagem do agente.'; return; }
  if(supabaseClient && getTenantId()){
    box.className='tag tag-green';
    box.innerHTML='● Usando fila de impressão via nuvem — funciona em qualquer aparelho (celular incluso), sem precisar liberar nada no navegador. Basta o agente estar rodando no computador com a impressora física.';
    for(const imp of state.impressoras){
      const cell = document.getElementById('impStatus-'+imp.id); if(!cell) continue;
      try{
        const since = new Date(Date.now()-2*60*1000).toISOString();
        const targetName = imp.osName || imp.nome;
        const { data, error } = await supabaseClient.from('print_jobs').select('id')
          .eq('tenant_id', getTenantId()).eq('printer_name', targetName).eq('status','impresso')
          .gte('printed_at', since).limit(1);
        cell.innerHTML = (!error && data && data.length) ? '<span class="tag tag-green">● imprimiu recentemente</span>' : '<span class="tag tag-gray">○ aguardando (sem testes recentes)</span>';
      }catch(e){ cell.innerHTML = '<span class="tag tag-gray">○ não verificado</span>'; }
    }
    return;
  }
  const isHttpsPage = window.location.protocol==='https:';
  if(isHttpsPage) box.innerHTML='<span class="tag tag-amber">⚠ Site em HTTPS — o agente local roda em HTTP, então o navegador pode bloquear isso por padrão. Veja a explicação abaixo de cada impressora.</span>';
  else box.className='tag tag-gray', box.textContent='Verificando agentes de impressão...';
  for(const imp of state.impressoras){
    const base = printerAgentBase(imp);
    const ok = await pingPrintAgent(base, 1200);
    const cell = document.getElementById('impStatus-'+imp.id);
    if(!cell) continue;
    if(ok){ cell.innerHTML = '<span class="tag tag-green">● conectado</span>'; continue; }
    if(isHttpsPage && base.startsWith('http://')){
      cell.innerHTML = '<span class="tag tag-amber">⚠ bloqueado pelo navegador (HTTPS→HTTP)</span><br><button class="btn btn-sm" onclick="explainMixedContentFix()" style="margin-top:4px">Como resolver</button>';
    } else {
      cell.innerHTML = '<span class="tag tag-amber">○ não encontrado</span>';
    }
  }
  if(!isHttpsPage){ box.className='tag tag-gray'; box.textContent='Status por impressora atualizado abaixo — cada impressora fala com o agente do computador onde ela está ligada.'; }
}
function stripAccentsForPrint(s){ const lo=String.fromCharCode(0x0300), hi=String.fromCharCode(0x036f); return String(s||'').normalize('NFD').replace(new RegExp('['+lo+'-'+hi+']','g'),''); }
// Postgres nunca aceita byte nulo (0x00) em coluna de texto — mas vários comandos ESC/POS
// (reset de tamanho de letra, corte total, etc.) precisam de um parâmetro 0x00. Guardamos
// esse placeholder no banco, e só o agente (na hora de mandar pro socket da impressora,
// fora do banco) troca pelo byte nulo de verdade. Ver printRawTcp no agente.
const NUL_PLACEHOLDER = String.fromCharCode(0x01);
function paperColumns(imp){ return imp && Number(imp.larguraPapel)===58 ? 32 : 48; }
function buildTicketText(who, cota, local, estacao, items, orderNumber, columns, escPos, payLines){
  const cfg = state.settings.ticketConfig || {};
  const nameSizeByte = {normal:NUL_PLACEHOLDER, grande:'\x11', extra:'\x22'}[cfg.nomeProdutoTamanho] || '\x11';
  const entregaDestaque = cfg.entregaDestaque!==false;
  const W = columns || 48;
  const line = ch=>ch.repeat(W);
  const wrap = t => t.length>W ? t.slice(0,W) : t;
  let out = '';
  out += line('=')+'\n';
  out += wrap((estacaoLabel(estacao)||estacao||'').toUpperCase())+'\n';
  out += line('=')+'\n';
  out += 'Pedido '+(orderNumber?'#'+orderNumber:'')+'\n';
  out += new Date().toLocaleString('pt-BR')+'\n';
  out += line('-')+'\n';
  out += wrap('Solicitante: '+who)+'\n';
  if(cota) out += wrap('Cota: '+cota)+'\n';
  out += line('-')+'\n';
  if(local){
    const localLabel = 'ENTREGAR EM: ';
    const localValueW = Math.max(1, W-localLabel.length);
    const localValue = local.length>localValueW ? local.slice(0,localValueW) : local;
    // Só o nome do local fica em negrito (label continua no tamanho normal) — configurável
    // em Impressoras > Formatação dos tickets.
    // ESC E '1'/'0' (0x31/0x30): com 0x01 o agente trocava por 0x00 e o negrito nunca ligava.
    const boldOn = entregaDestaque ? '\x1B\x451' : '';
    const boldOff = entregaDestaque ? '\x1B\x450' : '';
    out += (escPos ? localLabel+boldOn+localValue+boldOff : wrap(localLabel+local)) + '\n';
    out += line('-')+'\n';
  }
  const showPrices = estacao==='caixa' || !!cfg.mostrarPrecoProducao; // comprovante do caixa sempre mostra; estação é configurável
  let total = 0;
  items.forEach(i=>{
    total += i.price*i.qty;
    const nameLine = i.qty+'x '+i.name + (i.copos!=null ? ' — '+i.copos+' copo'+(i.copos===1?'':'s') : '');
    // GS ! (tamanho da letra) — configurável em Impressoras > Formatação dos tickets.
    // Só no modo ESC/POS, senão o driver do Windows mostraria os bytes de controle como
    // texto (impressora local não é ESC/POS puro).
    out += (escPos ? '\x1D\x21'+nameSizeByte+nameLine+'\x1D\x21'+NUL_PLACEHOLDER : nameLine) + '\n';
    if(showPrices) out += fmt(i.price*i.qty)+'\n';
  });
  const segurar = items.some(i=>i.levarJunto), juntoCom = [...new Set(items.map(i=>i.levarJuntoCom).filter(Boolean))].join(', ');
  const wrapWords = t => { const lines=[]; let cur=''; String(t).split(/\s+/).forEach(w=>{ if((cur+' '+w).trim().length>W){ if(cur) lines.push(cur); cur=w.slice(0,W); } else cur=(cur+' '+w).trim(); }); if(cur) lines.push(cur); return lines.join('\n'); };
  const big = t => escPos ? '\x1D\x21\x11'+t+'\x1D\x21'+NUL_PLACEHOLDER : t;
  if(segurar) out += line('*')+'\n'+big('*** SEGURAR ***')+'\n'+big('LEVAR JUNTO')+'\n'+big('COM A COMIDA')+'\n'+line('*')+'\n';
  if(juntoCom) out += line('*')+'\n'+big('LEVAR JUNTO:')+'\n'+wrapWords(juntoCom)+'\n(bebida no bar)\n'+line('*')+'\n';
  out += line('-')+'\n';
  if(showPrices) out += 'TOTAL: '+fmt(total)+'\n';
  // Comprovante de pagamento: formas de pagamento e troco (ver printCaixaReceipt).
  if(payLines && payLines.length) out += line('-')+'\n'+payLines.map(l=>wrap(l)).join('\n')+'\n';
  out += line('=')+'\n\n\n';
  if(!escPos) return out;
  // Modo ESC/POS (impressora de rede, via socket cru): sem driver do Windows no meio,
  // então a gente mesmo controla início/corte do papel — e evita acentuação (o code
  // page da impressora térmica é incerto; texto puro ASCII imprime certo em qualquer uma).
  // GS V usa corte PARCIAL (parâmetro 1), não total (parâmetro 0) — Postgres não aceita
  // byte nulo (\x00) em coluna de texto, quebraria o insert do print_jobs.
  return '\x1B\x40' + stripAccentsForPrint(out) + '\n\n\n\x1D\x56\x01';
}
// Impressora do comprovante: a do cadastro do usuário (modo antigo, nome no Windows) ou a
// escolhida como "Comprovante do caixa" na configuração automática (estacao 'caixa').
function receiptPrinterFor(user){
  if(user && user.caixaPrinterOsName) return { nome:user.caixaPrinterOsName, osName:user.caixaPrinterOsName };
  return deviceCaixaPrinter() || (state.impressoras||[]).find(p=>p.estacao==='caixa') || null;
}
// Linhas de pagamento do comprovante: cada forma, e o troco quando o pago passa do total.
function receiptPayLines(payments, total){
  const pays = (payments||[]).filter(p=>!p.reversed && Number(p.amount)>0);
  const lines = pays.map(p=>(p.partial?'Pago antes: ':'')+paymentMethodLabel(p.method)+': '+fmt(p.amount));
  const troco = Math.round((pays.reduce((a,p)=>a+Number(p.amount||0),0)-Number(total||0))*100)/100;
  if(troco>0.009 && pays.some(p=>p.method==='dinheiro')) lines.push('Troco: '+fmt(troco));
  return lines;
}
// Comprovante pedido pelo cliente, de uma comanda já paga (botão no detalhe da comanda).
async function printSaleReceipt(saleId){
  const sale = state.sales.find(x=>x.id===saleId); if(!sale) return;
  const imp = receiptPrinterFor(currentUser);
  if(!imp){ toast('Escolha a impressora do "Comprovante do caixa" em Configurações › Impressoras.'); return; }
  const member = state.members.find(m=>m.id===sale.memberId);
  await printCaixaReceipt(member?member.name:(sale.customerName||'Cliente avulso'), member?member.code:'', sale.items||[], sale.orderNumber, imp, receiptPayLines(sale.payments, sale.total));
  toast('Comprovante enviado para '+(imp.nome||imp.osName)+'.');
}
async function printCaixaReceipt(who, cota, items, orderNumber, imp, payLines){
  const printerOsName = imp.osName || imp.nome;
  const text = buildTicketText(who, cota, '', 'caixa', (items||[]).filter(i=>!i.canceled), orderNumber, paperColumns(imp), !!imp.ip, payLines).replace('CAIXA','COMPROVANTE DE VENDA');
  if(supabaseClient && getTenantId()){
    try{
      const job = { tenant_id: getTenantId(), printer_name: printerOsName, printer_ip: imp.ip||null, content: text, status: 'pendente' };
      if(imp.agentId) job.agent_id = imp.agentId;
      let { error } = await supabaseClient.from('print_jobs').insert(job);
      if(error && job.agent_id){ delete job.agent_id; ({ error } = await supabaseClient.from('print_jobs').insert(job)); }
      if(!error) return;
    }catch(e){ /* segue pro modo manual abaixo */ }
  }
  try{
    const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 3000);
    const res = await fetch(PRINT_AGENT_URL+'/print', { method:'POST', signal:ctrl.signal, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ printer: printerOsName, text, ip: imp.ip||'' }) });
    clearTimeout(t);
    if(res.ok) return;
  }catch(e){}
  toast('Não foi possível enviar o comprovante do caixa pra fila — verifique a impressora deste usuário.');
}
