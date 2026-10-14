/* ============ TOTEM DE AUTOATENDIMENTO ============ */
function renderMobileQr(){
  const el = document.getElementById('view-mobile-qr');
  const url = window.location.href;
  const garcons = state.users.filter(u=>u.origem==='app' && u.active!==false);
  el.innerHTML = `<div class="panel" style="max-width:520px;margin:0 auto;text-align:center">
    <h2>Acesso Mobile — Garçom</h2>
    <p class="sub">Aponte a câmera do celular ou tablet do garçom para este código. Ele abre o mesmo sistema no navegador do aparelho — quem estiver logado com origem "Garçom/App" cai direto na tela simplificada de pedidos.</p>
    <div id="mobileQrBox" style="display:flex;justify-content:center;margin:20px 0"></div>
    <p class="mono" style="font-size:12px;color:var(--muted);word-break:break-all;background:var(--cream);padding:8px 12px;border-radius:6px">${h(url)}</p>
    <p class="sub" style="color:var(--red)">Funciona apenas se este endereço for acessível pelo celular (mesma rede/URL pública). Se o sistema estiver aberto como arquivo local no computador, o QR não vai abrir no celular — nesse caso, hospede o arquivo em algum lugar acessível pela rede do clube.</p>
    <div style="text-align:left;margin-top:18px">
      <p class="sub" style="margin-bottom:6px"><b>Usuários com origem "Garçom/App" cadastrados:</b></p>
      ${garcons.length ? '<ul style="margin:0;padding-left:18px;font-size:13px">'+garcons.map(u=>`<li>${h(u.name)} (login: ${h(u.username)})</li>`).join('')+'</ul>' : '<p class="sub">Nenhum ainda — cadastre em Configurações → Colaboradores, com origem "Garçom/App".</p>'}
    </div>
  </div>`;
  const box = document.getElementById('mobileQrBox');
  if(box && window.QRCode){ new QRCode(box, { text:url, width:200, height:200, colorDark:'#141B33', colorLight:'#ffffff' }); }
  else if(box){ box.innerHTML = '<p class="sub">Não foi possível carregar o gerador de QR Code (sem conexão com a internet). Use o link acima manualmente.</p>'; }
}
function renderTotem(){
  if(!cardapioDraft) cardapioDraft = { items:[], memberId:null, customerName:'' };
  const el = document.getElementById('view-totem');
  const available=state.products.filter(p=>p.active!==false&&(!p.channels||p.channels.online!==false)).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)),categories=[...new Set(available.map(p=>p.category||'Sem categoria'))];
  const draftMember = cardapioDraft.memberId ? state.members.find(m=>m.id===cardapioDraft.memberId) : null;
  el.innerHTML = `<div class="panel" style="max-width:920px;margin:0 auto">
    <div style="display:flex;align-items:center;gap:12px"><h2 style="flex:1;text-align:center">Totem de autoatendimento</h2><button class="op-btn" onclick="toggleTotemFullscreen()">⛶ Tela cheia</button><button class="op-btn" onclick="clearSelfServiceDraft()">✕ Cancelar</button></div>
    <p class="sub" style="text-align:center">Toque no seu produto, informe sua cota e envie — o pedido já cai direto na cozinha.</p>
    <div class="grid2">
      <div class="field"><label>Sou associado — digite sua cota</label><input id="totCota" inputmode="numeric" autocomplete="off" placeholder="Número da cota" value="${h(draftMember&&draftMember.code||'')}"><p class="sub" id="totCotaInfo">${draftMember?'Olá, '+h(String(draftMember.name||'').split(' ')[0])+'!':'Deixe em branco se não for associado.'}</p></div>
      <div class="field"><label>Nome (se não for associado)</label><input id="totCustomer" value="${h(cardapioDraft.customerName)}"></div>
    </div>
    <div class="op-toolbar"><div class="op-search"><input id="totemSearch" placeholder="Pesquisar produto..." oninput="filterTotemProducts()"></div><select id="totemCategory" onchange="filterTotemProducts()"><option value="">Todas as categorias</option>${categories.map(c=>`<option>${h(c)}</option>`).join('')}</select></div>
    <div id="totemProducts" style="margin:14px 0;display:flex;flex-direction:column;gap:8px">
      ${available.map(p=>`<div class="menu-item" data-product="${h(p.id)}" data-category="${h(p.category||'Sem categoria')}">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">${p.image?`<img src="${h(p.image)}" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0">`:''}<div style="min-width:0"><div class="mi-name">${h(p.name)}</div><div class="mi-cat">${h(p.category||'Sem categoria')}</div></div></div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0"><span class="mono">${fmt(p.price)}</span>
        <button class="btn btn-primary" onclick="addCardapioItem(${jsArg(p.id)})">Adicionar</button></div></div>`).join('') || '<p class="empty">Cardápio ainda não cadastrado.</p>'}
    </div>
    <div class="panel" style="background:var(--cream)">
      <h2>Meu pedido</h2><div id="cdItemsList"></div>
      <div class="field"><label>Observação geral</label><input id="totNotes" value="${h(cardapioDraft.notes||'')}" placeholder="Informações para a equipe"></div>
      <div style="display:flex;justify-content:space-between;margin:12px 0;font-size:16px;font-weight:700"><span>Total</span><span class="mono" id="cdTotal">R$ 0,00</span></div>
      <button class="btn btn-primary btn-block" onclick="submitTotemOrder()">Confirmar e enviar para a cozinha</button>
    </div>
  </div>`;
  // A cota digitada só é aceita se bater com um sócio ativo; mostra só o primeiro nome.
  document.getElementById('totCota').oninput = e=>{
    const code = String(e.target.value||'').trim();
    const m = code ? state.members.find(x=>x.active!==false && !x.archived && String(x.code||'').trim()===code) : null;
    cardapioDraft.memberId = m ? m.id : null;
    const info = document.getElementById('totCotaInfo');
    if(info) info.textContent = !code ? 'Deixe em branco se não for associado.' : m ? 'Olá, '+String(m.name||'').split(' ')[0]+'!' : 'Cota não encontrada. Confira o número.';
  };
  document.getElementById('totCustomer').oninput = e=>{ cardapioDraft.customerName = e.target.value; };
  document.getElementById('totNotes').oninput = e=>{ cardapioDraft.notes = e.target.value; };
  renderCardapioItems();
}
async function submitTotemOrder(){
  if(!cardapioDraft.items.length){ toast('Selecione ao menos um item.'); return; }
  if(!cardapioDraft.memberId && !cardapioDraft.customerName.trim()){ toast('Informe sua cota de associado ou seu nome.'); return; }
  const member = cardapioDraft.memberId ? state.members.find(m=>m.id===cardapioDraft.memberId) : null;
  const who = member ? member.name : cardapioDraft.customerName.trim();
  const sale = { id:uid(), type:'totem', memberId:cardapioDraft.memberId, customerName:cardapioDraft.customerName.trim(), notes:(cardapioDraft.notes||'').trim(),
    items:cardapioDraft.items, total:cardapioDraft.items.reduce((a,i)=>a+i.price*i.qty,0), status:'open', payments:[], openedAt:new Date().toISOString() };
  state.sales.push(sale);
  if(!await sendItemsToKitchen(sale.id, cardapioDraft.items, who, 'totem')){ state.sales=state.sales.filter(s=>s.id!==sale.id); return; }
  sale.orderNumber=await nextOrderNumber();
  sale.items.forEach(i=>i.sent=true);
  save('sales');
  cardapioDraft = { items:[], memberId:null, customerName:'', notes:'' };
  renderAll();
  // Totem é autoatendimento sem ninguém por perto pra confirmar verbalmente — precisa
  // de uma tela que fique até o cliente tocar em "Novo pedido", não só um toast de 2,6s
  // que some sozinho antes da pessoa conseguir anotar o número.
  openModal('Pedido enviado!', `<div style="text-align:center;padding:20px 10px">
      <div style="font-size:15px;color:var(--muted);margin-bottom:6px">Guarde o número do seu pedido</div>
      <div style="font-size:64px;font-weight:800;font-family:var(--font-sans);color:var(--green)">#${sale.orderNumber}</div>
      <p class="sub" style="margin-top:14px">Aguarde ser chamado no painel de senhas.</p>
      <button class="btn btn-primary btn-block" style="margin-top:20px" onclick="document.getElementById('modalRoot').dataset.locked='false';closeModal();renderAll()">Novo pedido</button>
    </div>`, false, true);
}

