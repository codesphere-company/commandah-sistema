/* ============ RELATÓRIOS ============ */
// PROD-06 (decisão do dono, 10/10: "eu escolho quando"): planilha para o contador do período
// escolhido. Vendas e faturamento pelo dia em que a venda abriu (regra do OP-14); fiado e caixa
// pela data do lançamento. Gera .xlsx com a SheetJS, baixada só nesta hora (versão fixa + SRI).
const XLSX_SRC='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', XLSX_SRI='sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
function loadXlsx(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve,reject)=>{ const sc=document.createElement('script'); sc.src=XLSX_SRC; sc.integrity=XLSX_SRI; sc.crossOrigin='anonymous'; sc.onload=()=>resolve(window.XLSX); sc.onerror=()=>reject(new Error('não foi possível carregar o gerador de planilhas (sem internet?)')); document.head.appendChild(sc); });
}
function monthRange(offset){ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+offset); const from=localDay(d.toISOString()); const e=new Date(d.getFullYear(), d.getMonth()+1, 0, 12); return { from, to: localDay(e.toISOString()) }; }
function openAccountantExport(){
  const r=monthRange(-1);
  openModal('Exportar para o contador', `
    <p class="sub">Escolha o período e gere a planilha (Excel). Abas: Resumo, Vendas por dia, Vendas, Produtos, Fiado, Fechamentos de caixa e Entradas e saídas.</p>
    <div class="report-period-links"><button onclick="setAccountantRange(-1)">Mês anterior</button><button onclick="setAccountantRange(0)">Mês atual</button></div>
    <div class="row"><div class="field"><label>De</label><input id="accFrom" type="date" value="${r.from}"></div><div class="field"><label>Até</label><input id="accTo" type="date" value="${r.to}"></div></div>
    <p class="sub">Vendas e faturamento contam pelo dia em que a venda abriu (comanda aberta à noite e paga no dia seguinte conta no dia da abertura). Fiado, sangrias e suprimentos contam pela data do lançamento.</p>
    <div class="row"><button class="btn" onclick="closeModal()">Voltar</button><button class="btn btn-primary" id="accGo" onclick="generateAccountantExport()">Gerar planilha</button></div>`);
}
function setAccountantRange(offset){ const r=monthRange(offset); document.getElementById('accFrom').value=r.from; document.getElementById('accTo').value=r.to; }
function accountantSheets(from, to){
  const inP=d=>d>=from&&d<=to, round=v=>arredondaCentavos(Number(v)||0), fmtD=v=>v?dataHoraBR(v):'';
  const memberOf=id=>state.members.find(m=>m.id===id);
  const sales=state.sales.filter(sl=>saleCountsAsRevenue(sl) && inP(saleRevenueDay(sl)));
  const canceled=state.sales.filter(sl=>sl && sl.canceled && inP(localDay(sl.canceledAt||sl.closedAt||sl.openedAt)));
  const buckets=['dinheiro','cartao','pix','fiado','outros'], bucketLabel={dinheiro:'Dinheiro',cartao:'Cartão',pix:'Pix',fiado:'Fiado (a prazo)',outros:'Outros'};
  const byMethod=sl=>somaPorForma([sl]);
  const tot={ fat:0, n:sales.length, desc:0, serv:0, m:totaisPorFormaVazio() };
  const days={};
  sales.forEach(sl=>{ const d=saleRevenueDay(sl), b=byMethod(sl); tot.fat+=Number(sl.total)||0; tot.desc+=Number(sl.discount)||0; tot.serv+=Number(sl.serviceCharge)||0;
    buckets.forEach(k=>tot.m[k]+=b[k]);
    const x=days[d]=days[d]||{n:0,fat:0,desc:0,serv:0,m:totaisPorFormaVazio()}; x.n++; x.fat+=Number(sl.total)||0; x.desc+=Number(sl.discount)||0; x.serv+=Number(sl.serviceCharge)||0; buckets.forEach(k=>x.m[k]+=b[k]); });
  const debtRows=[]; let fiadoLanc=0, fiadoRec=0;
  state.members.forEach(m=>(m.debtHistory||[]).forEach(e=>{ if(!inP(localDay(e.at))) return; const v=Number(e.value)||0;
    if(!e.reversed){ if(e.type==='debt') fiadoLanc+=v; else if(e.type==='payment' && !/crédito de troco/i.test(e.reason||'')) fiadoRec+=v; }
    debtRows.push([fmtD(e.at), m.name, m.code||'', e.type==='debt'?'Débito':e.type==='payment'?'Pagamento':'Crédito', round(v), e.method||'', e.reason||'', e.reversed?'Sim':'Não']); }));
  const closings=(state.cashHistory||[]).filter(c=>c.closedAt && inP(localDay(c.closedAt)));
  const moves=(state.cashMovements||[]).filter(mv=>mv.at && inP(localDay(mv.at)));
  const supr=moves.filter(mv=>mv.type==='suprimento').reduce((a,mv)=>a+(Number(mv.amount)||0),0), sang=moves.filter(mv=>mv.type==='sangria').reduce((a,mv)=>a+(Number(mv.amount)||0),0);
  const diffs=closings.reduce((a,c)=>a+(Number(c.diff)||0),0), dateBR=d=>new Date(d+'T12:00:00').toLocaleDateString('pt-BR');
  const prod={};
  sales.forEach(sl=>(sl.items||[]).filter(i=>!i.canceled).forEach(i=>{ const pr=state.products.find(x=>x.id===i.productId); const k=i.name; prod[k]=prod[k]||{cat:pr&&pr.category||'',q:0,v:0}; prod[k].q+=Number(i.qty)||0; prod[k].v+=(Number(i.qty)||0)*(Number(i.price)||0); }));
  return [
    ['Resumo', [
      ['Estabelecimento', (state.settings&&state.settings.clubName)||''], ['Período', dateBR(from)+' a '+dateBR(to)], ['Gerado em', new Date().toLocaleString('pt-BR')], [],
      ['Faturamento (vendas fechadas, pelo dia de abertura)', round(tot.fat)], ['Número de vendas', tot.n], ['Ticket médio', tot.n?round(tot.fat/tot.n):0], ['Descontos concedidos', round(tot.desc)], ['Taxa de serviço', round(tot.serv)], [],
      ['Formas de pagamento das vendas do período'], ...buckets.map(k=>[bucketLabel[k], round(tot.m[k])]), [],
      ['Fiado lançado no período', round(fiadoLanc)], ['Fiado recebido no período', round(fiadoRec)], [],
      ['Vendas canceladas (quantidade)', canceled.length], ['Vendas canceladas (valor)', round(canceled.reduce((a,sl)=>a+(Number(sl.total)||0),0))], [],
      ['Fechamentos de caixa', closings.length], ['Entradas (suprimentos)', round(supr)], ['Saídas (sangrias)', round(sang)], ['Soma das diferenças de caixa (contado − esperado)', round(diffs)]
    ], [52,18]],
    ['Vendas por dia', [['Data','Vendas','Faturamento','Dinheiro','Cartão','Pix','Fiado','Outros','Descontos','Serviço'],
      ...Object.keys(days).sort().map(d=>{ const x=days[d]; return [dateBR(d), x.n, round(x.fat), ...buckets.map(k=>round(x.m[k])), round(x.desc), round(x.serv)]; }),
      ['TOTAL', tot.n, round(tot.fat), ...buckets.map(k=>round(tot.m[k])), round(tot.desc), round(tot.serv)]], [12,8,14,12,12,12,12,12,12,12]],
    ['Vendas', [['Pedido','Tipo','Aberta em','Fechada em','Sócio / Cliente','Cota','Subtotal','Desconto','Serviço','Total','Pagamento','Operador'],
      ...sales.slice().sort((a,b)=>new Date(a.openedAt||a.closedAt)-new Date(b.openedAt||b.closedAt)).map(sl=>{ const m=sl.memberId?memberOf(sl.memberId):null; return [sl.orderNumber||sl.id, typeLabel(sl.type), fmtD(sl.openedAt), fmtD(sl.closedAt), m?m.name:(sl.customerName||'Avulso'), m&&m.code||'', round(sl.subtotal!=null?sl.subtotal:sl.total), round(sl.discount), round(sl.serviceCharge), round(sl.total), (sl.payments||[]).map(p=>paymentMethodLabel(p.method)+' '+round(p.amount).toFixed(2).replace('.',',')).join(' + '), sl.operatorName||'']; })],
      [9,10,19,19,32,8,11,10,10,11,30,16]],
    ['Produtos', [['Produto','Categoria','Quantidade','Valor total'], ...Object.keys(prod).sort((a,b)=>prod[b].v-prod[a].v).map(k=>[k, prod[k].cat, prod[k].q, round(prod[k].v)])], [36,16,12,14]],
    ['Fiado', [['Data','Sócio','Cota','Tipo','Valor','Forma','Motivo','Estornado'], ...debtRows.sort((a,b)=>String(a[0]).localeCompare(String(b[0])))], [19,32,8,11,11,12,34,10]],
    ['Fechamentos de caixa', [['Aberto em','Fechado em','Operador','Troco inicial','Esperado (dinheiro)','Contado (dinheiro)','Diferença','Cartão esperado','Cartão informado','Ficou a receber'],
      ...closings.map(c=>[fmtD(c.openedAt), fmtD(c.closedAt), c.operatorName||c.closedBy||'', round(c.openingAmount), round(c.expectedAmount), round(c.countedAmount), round(c.diff), round(c.expectedCard), c.countedCard==null?'':round(c.countedCard), c.openComandasTotal==null?'':round(c.openComandasTotal)])], [19,19,16,12,16,16,11,14,14,14]],
    ['Entradas e saídas', [['Data','Tipo','Valor','Forma','Descrição','Origem','Operador'],
      ...moves.slice().sort((a,b)=>new Date(a.at)-new Date(b.at)).map(mv=>[fmtD(mv.at), mv.type==='suprimento'?'Entrada':'Saída', round(mv.amount), paymentMethodLabel(mv.method||'dinheiro'), mv.description||mv.reason||'', mv.origin||'manual', mv.operatorName||''])], [19,9,11,12,44,14,16]]
  ];
}
async function generateAccountantExport(){
  const from=document.getElementById('accFrom').value, to=document.getElementById('accTo').value;
  if(!from||!to||from>to){ toast('Escolha um período válido.'); return; }
  const btn=document.getElementById('accGo'); btn.disabled=true; btn.textContent='Gerando…';
  try{
    if(typeof fetchFreshSales==='function') await fetchFreshSales();
    const XLSX=await loadXlsx(), wb=XLSX.utils.book_new();
    accountantSheets(from,to).forEach(([name,rows,widths])=>{ const ws=XLSX.utils.aoa_to_sheet(rows); ws['!cols']=(widths||[]).map(w=>({wch:w})); XLSX.utils.book_append_sheet(wb, ws, name); });
    XLSX.writeFile(wb, 'commandah-contador-'+from+'-a-'+to+'.xlsx');
    logAction('Planilha do contador gerada: '+from+' a '+to);
    closeModal(); toast('Planilha gerada.');
  }catch(e){ console.error(e); toast('Não foi possível gerar: '+(e.message||e),'error'); btn.disabled=false; btn.textContent='Gerar planilha'; }
}
// PROD-18 (decisão do dono, 10/10): em vez de e-mail, o resumo diário fica no próprio sistema.
// Faturamento pelo dia em que a venda abriu (OP-14): vendas fechadas + comandas ainda abertas
// daquele dia (a receber). Fiado e caixa pelo que aconteceu no dia.
// Relatório de movimentações por usuário (pedido do dono, 10/10): tudo o que cada colaborador
// fez no período, direto do audit_log (carimbado pelo servidor; só admin/dono lê).
const userActivity={from:null,to:null,user:'',q:'',rows:null,loading:false,error:''};
const SENSITIVE_ACTION=/reabert|cancel|estorn|liberad|exclu|apag|bloquead|PIN|permiss|diferen|sangria|saída/i;
async function loadUserActivity(){
  const f=userActivity, from=f.from||todayStr(), to=f.to||todayStr();
  f.loading=true; f.error=''; renderUserActivityReport(true);
  try{
    if(isCloudMode()){
      const start=new Date(from+'T00:00:00').toISOString(), end=new Date(new Date(to+'T00:00:00').getTime()+86400000).toISOString();
      const rows=await fetchAllRows(()=>{ let q=supabaseClient.from('audit_log').select('id,at,actor_name,actor_role,action').gte('at',start).lt('at',end).order('at',{ascending:false}); if(f.user) q=q.eq('actor_name',f.user); return q; });
      f.rows=rows.map(r=>({at:r.at,user:r.actor_name||'—',role:r.actor_role||'',text:r.action||''}));
    } else {
      f.rows=(state.logs||[]).filter(l=>{const d=localDay(l.at);return d>=from&&d<=to&&(!f.user||l.user===f.user);}).map(l=>({at:l.at,user:l.user||'—',role:'',text:l.text||l.action||''})).sort((a,b)=>new Date(b.at)-new Date(a.at));
    }
  }catch(e){ f.rows=[]; f.error='Não foi possível carregar: '+(e.message||'erro'); }
  f.loading=false; renderUserActivityReport(true);
}
function renderUserActivityReport(fromLoad){
  const el=document.getElementById('view-relatorios'); if(!el) return;
  if(!hasPerm('logs')){ el.innerHTML='<p class="empty">Só o administrador vê as movimentações dos usuários.</p>'; return; }
  const f=userActivity;
  if(!fromLoad && f.rows===null){ loadUserActivity(); return; }
  const q=f.q.trim().toLowerCase(), rows=(f.rows||[]).filter(r=>!q||(r.text+' '+r.user).toLowerCase().includes(q));
  const byUser={}; rows.forEach(r=>{ const k=r.user; byUser[k]=byUser[k]||{n:0,s:0}; byUser[k].n++; if(SENSITIVE_ACTION.test(r.text)) byUser[k].s++; });
  const names=[...new Set([...(state.users||[]).map(u=>u.name),...(f.rows||[]).map(r=>r.user)])].filter(Boolean).sort();
  const roleLabel=r=>({owner:'Dono',admin:'Administrador',caixa:'Caixa',cozinha:'Cozinha',sistema:'Sistema'})[r]||r||'';
  el.innerHTML=`<div class="daily-summary">
  <div class="daily-summary-head"><div><h2>Movimentações por usuário</h2><p class="sub">Tudo o que cada colaborador fez no sistema. Em destaque: cancelamentos, estornos, reaberturas, liberações e exclusões.</p></div></div>
  <div class="user-activity-filters">
    <div class="field"><label>De</label><input type="date" value="${f.from||todayStr()}" max="${todayStr()}" onchange="userActivity.from=this.value;userActivity.rows=null"></div>
    <div class="field"><label>Até</label><input type="date" value="${f.to||todayStr()}" max="${todayStr()}" onchange="userActivity.to=this.value;userActivity.rows=null"></div>
    <div class="field"><label>Usuário</label><select onchange="userActivity.user=this.value;userActivity.rows=null"><option value="">Todos</option>${names.map(n=>`<option ${n===f.user?'selected':''}>${h(n)}</option>`).join('')}</select></div>
    <div class="field"><label>Buscar</label><input value="${h(f.q)}" placeholder="Ex.: cancel, estorno, pedido #12" oninput="userActivity.q=this.value;clearTimeout(window.__uaT);window.__uaT=setTimeout(()=>renderUserActivityReport(true),250)"></div>
    <button class="op-btn primary" onclick="loadUserActivity()">⌕ &nbsp; Pesquisar</button>
    <button class="op-btn" onclick="exportUserActivityCsv()">▧ &nbsp; Exportar</button>
  </div>
  ${f.loading?'<p class="empty">Carregando…</p>':f.error?`<p class="empty">${h(f.error)}</p>`:`
  <div class="user-activity-chips">${Object.keys(byUser).sort((a,b)=>byUser[b].n-byUser[a].n).map(u=>`<button type="button" class="user-activity-chip" onclick="userActivity.user=${jsArg(u)};loadUserActivity()"><b>${h(u)}</b> ${byUser[u].n} ação${byUser[u].n===1?'':'ões'}${byUser[u].s?` · <span class="ua-sens">${byUser[u].s} sensíve${byUser[u].s===1?'l':'is'}</span>`:''}</button>`).join('')||''}</div>
  <div class="panel" style="margin-top:10px"><table><tr><th>Data e hora</th><th>Usuário</th><th>Perfil</th><th>Ação</th></tr>${rows.length?rows.slice(0,2000).map(r=>`<tr class="${SENSITIVE_ACTION.test(r.text)?'ua-row-sens':''}"><td class="mono">${reportDateTime(r.at)}</td><td>${h(r.user)}</td><td class="sub">${h(roleLabel(r.role))}</td><td>${h(r.text)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nenhuma movimentação no período.</td></tr>'}</table>${rows.length>2000?`<p class="sub">Mostrando 2000 de ${rows.length}. Exporte para ver tudo.</p>`:''}</div>`}
  </div>`;
}
function exportUserActivityCsv(){ const q=userActivity.q.trim().toLowerCase(); downloadCsv('movimentacoes-usuarios.csv',[['Data e hora','Usuário','Perfil','Ação'],...(userActivity.rows||[]).filter(r=>!q||(r.text+' '+r.user).toLowerCase().includes(q)).map(r=>[reportDateTime(r.at),r.user,r.role,r.text])]); }
let dailySummaryDay=null;
function shiftDailySummary(delta){ const d=new Date((dailySummaryDay||todayStr())+'T12:00:00'); d.setDate(d.getDate()+delta); dailySummaryDay=localDay(d.toISOString()); renderDailySummaryReport(); }
function renderDailySummaryReport(){
  const day=dailySummaryDay||todayStr(), el=document.getElementById('view-relatorios'); if(!el) return;
  const closed=state.sales.filter(sl=>saleCountsAsRevenue(sl)&&saleRevenueDay(sl)===day);
  const open=state.sales.filter(sl=>sl.status==='open'&&!sl.canceled&&sl.type==='comanda'&&saleRevenueDay(sl)===day);
  const closedTotal=closed.reduce((a,sl)=>a+(Number(sl.total)||0),0), openTotal=open.reduce((a,sl)=>a+comandaDue(sl),0);
  const byMethod=somaPorForma(closed);
  const qty={}, rev={};
  [...closed,...open].forEach(sl=>(sl.items||[]).filter(i=>!i.canceled).forEach(i=>{ qty[i.name]=(qty[i.name]||0)+(Number(i.qty)||0); rev[i.name]=(rev[i.name]||0)+(Number(i.qty)||0)*(Number(i.price)||0); }));
  const top=Object.keys(qty).sort((a,b)=>rev[b]-rev[a]).slice(0,8);
  const canceled=state.sales.filter(sl=>sl.canceled&&localDay(sl.canceledAt||sl.closedAt)===day);
  const fiadoIn=[]; state.members.forEach(m=>(m.debtHistory||[]).forEach(e=>{ if(e.type==='payment'&&!e.reversed&&localDay(e.at)===day) fiadoIn.push({m,e}); }));
  const fiadoInTotal=fiadoIn.reduce((a,x)=>a+(Number(x.e.value)||0),0);
  const debtors=state.members.filter(m=>!m.archived&&(Number(m.debt)||0)>TOLERANCIA_CENTAVO), blocked=debtors.filter(memberBlockedByDebt);
  const closings=(state.cashHistory||[]).filter(c=>localDay(c.closedAt)===day).sort((a,b)=>new Date(a.closedAt)-new Date(b.closedAt));
  const count=closed.length+open.length, ticket=count?(closedTotal+openTotal)/count:0;
  const label=new Date(day+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const methodRows=[['Dinheiro','dinheiro'],['Cartão','cartao'],['Pix','pix'],['Fiado (a receber)','fiado'],['Outros','outros']].filter(([,k])=>byMethod[k]>TOLERANCIA_CENTAVO).map(([l,k])=>`<tr><td>${l}</td><td class="mono">${fmt(byMethod[k])}</td></tr>`).join('')||'<tr><td colspan="2" class="empty">Nenhuma venda fechada.</td></tr>';
  const cashNone=state.cashSession&&day===todayStr()?'Caixa ainda aberto.':'Nenhum caixa fechado neste dia.';
  el.innerHTML=`<div class="daily-summary">
  <div class="daily-summary-head"><div><h2>Resumo do dia</h2><p class="sub">${h(label)}</p></div><div class="daily-summary-nav"><button class="op-btn" onclick="shiftDailySummary(-1)">‹ &nbsp; Dia anterior</button><input type="date" value="${day}" max="${todayStr()}" onchange="dailySummaryDay=this.value||null;renderDailySummaryReport()"><button class="op-btn" onclick="shiftDailySummary(1)" ${day>=todayStr()?'disabled':''}>Próximo dia &nbsp; ›</button><button class="op-btn" onclick="window.print()">▣ &nbsp; Imprimir</button></div></div>
  <div class="grid4">
    <div class="stat"><div class="lbl">Faturamento do dia</div><div class="val">${fmt(closedTotal+openTotal)}</div></div>
    <div class="stat"><div class="lbl">Comandas em aberto (a receber)</div><div class="val">${fmt(openTotal)}</div><div class="sub">${open.length} comanda${open.length===1?'':'s'}</div></div>
    <div class="stat"><div class="lbl">Atendimentos · ticket médio</div><div class="val">${count} · ${fmt(ticket)}</div></div>
    <div class="stat"><div class="lbl">Fiado em aberto (todos os sócios)</div><div class="val">${fmt(debtors.reduce((a,m)=>a+(Number(m.debt)||0),0))}</div><div class="sub">${blocked.length} sócio${blocked.length===1?'':'s'} bloqueado${blocked.length===1?'':'s'}</div></div>
  </div>
  <div class="grid2" style="margin-top:16px">
    <div class="panel"><h2>Vendas fechadas por forma de pagamento</h2><table><tr><th>Forma</th><th>Total</th></tr>${methodRows}</table></div>
    <div class="panel"><h2>Fiado no dia</h2><table><tr><td>Vendido no fiado</td><td class="mono">${fmt(byMethod.fiado)}</td></tr><tr><td>Recebido de fiado (${fiadoIn.length})</td><td class="mono">${fmt(fiadoInTotal)}</td></tr></table>${fiadoIn.length?`<p class="sub" style="margin-top:8px">${fiadoIn.map(x=>h(x.m.name)+' '+fmt(x.e.value)).join(' · ')}</p>`:''}</div>
  </div>
  <div class="panel" style="margin-top:16px"><h2>Fechamento do caixa</h2>${closings.length?`<table><tr><th>Caixa</th><th>Esperado (dinheiro)</th><th>Contado</th><th>Diferença</th><th>Ficou a receber</th></tr>${closings.map(c=>{const d=Number(c.diff)||0;return `<tr><td>${h(c.operatorName||c.closedBy||'—')} · ${timeFmt(c.openedAt)}–${timeFmt(c.closedAt)}</td><td class="mono">${fmt(c.expectedAmount)}</td><td class="mono">${fmt(c.countedAmount)}</td><td class="mono ${Math.abs(d)<0.01?'cash-ok':d<0?'cash-short':'cash-over'}">${Math.abs(d)<0.01?'Confere':(d<0?'Falta ':'Sobra ')+fmt(Math.abs(d))}</td><td class="mono">${c.openComandasTotal!=null?fmt(c.openComandasTotal):'—'}</td></tr>`;}).join('')}</table>`:`<p class="empty">${cashNone}</p>`}</div>
  <div class="grid2" style="margin-top:16px">
    <div class="panel"><h2>Comandas em aberto deste dia</h2>${open.length?`<table><tr><th>Comanda</th><th>Valor</th></tr>${open.map(sl=>`<tr><td>#${h(sl.orderNumber||'—')} · ${h(sl.customerName||'—')}</td><td class="mono">${fmt(comandaDue(sl))}</td></tr>`).join('')}</table>`:'<p class="empty">Nenhuma.</p>'}</div>
    <div class="panel"><h2>Mais vendidos do dia</h2>${top.length?`<table><tr><th>Produto</th><th>Qtd</th><th>Total</th></tr>${top.map(n=>`<tr><td>${h(n)}</td><td>${qty[n]}</td><td class="mono">${fmt(rev[n])}</td></tr>`).join('')}</table>`:'<p class="empty">Nenhum item.</p>'}</div>
  </div>
  ${canceled.length?`<p class="sub" style="margin-top:12px">Cancelamentos no dia: ${canceled.length} (${fmt(canceled.reduce((a,sl)=>a+(Number(sl.total)||0),0))}). Detalhes em Histórico de Pedidos.</p>`:''}
  </div>`;
}
function renderRelatoriosDashboard(){
  const el = document.getElementById('view-relatorios');
  const closedSales = state.sales.filter(saleCountsAsRevenue);
  const totalGeral = closedSales.reduce((a,s)=>a+s.total,0);
  const byMethod = somaPorForma(closedSales);

  const productRevenue = {}, productQty = {};
  closedSales.forEach(s=>s.items.forEach(i=>{ productRevenue[i.name]=(productRevenue[i.name]||0)+i.price*i.qty; productQty[i.name]=(productQty[i.name]||0)+i.qty; }));
  const topByRevenue = Object.entries(productRevenue).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const byOperator = {};
  closedSales.forEach(s=>{ const op = s.operatorName||'—'; byOperator[op]=(byOperator[op]||0)+s.total; });

  let custoTotal = 0;
  closedSales.forEach(s=>s.items.forEach(i=>{ const p = state.products.find(x=>x.id===i.productId); if(p) custoTotal += productCost(p)*i.qty; }));
  const margemTotal = totalGeral - custoTotal;

  const debtors = state.members.filter(m=>m.debt>0).sort((a,b)=>b.debt-a.debt);
  const recentSales = closedSales.slice().sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt)).slice(0,15);

  el.innerHTML = `
  <div class="report-dashboard-actions"><button class="op-btn" onclick="window.print()">▣ &nbsp; Imprimir</button><button class="op-btn" onclick="exportCurrentReport()">▧ &nbsp; Exportar Excel</button></div>
  <div class="grid4">
    <div class="stat"><div class="lbl">Total vendido</div><div class="val">${fmt(totalGeral)}</div></div>
    <div class="stat"><div class="lbl">Custo estimado (insumos)</div><div class="val">${fmt(custoTotal)}</div></div>
    <div class="stat"><div class="lbl">Margem estimada</div><div class="val">${fmt(margemTotal)}</div></div>
    <div class="stat"><div class="lbl">Pendências de fiado</div><div class="val">${fmt(debtors.reduce((a,m)=>a+m.debt,0))}</div></div>
  </div>
  <div class="grid2" style="margin-top:18px">
    <div class="panel"><h2>Por forma de pagamento</h2>
      <table><tr><th>Forma</th><th>Total</th></tr>
        <tr><td>Dinheiro</td><td class="mono">${fmt(byMethod.dinheiro)}</td></tr>
        <tr><td>Cartão</td><td class="mono">${fmt(byMethod.cartao)}</td></tr>
        <tr><td>Pix</td><td class="mono">${fmt(byMethod.pix)}</td></tr>
        <tr><td>Fiado</td><td class="mono">${fmt(byMethod.fiado)}</td></tr>
        <tr><td>Outros</td><td class="mono">${fmt(byMethod.outros)}</td></tr></table></div>
    <div class="panel"><h2>Curva ABC — mais vendidos (por faturamento)</h2>
      ${topByRevenue.length ? `<table><tr><th>Produto</th><th>Qtd.</th><th>Faturamento</th></tr>${topByRevenue.map(([n,rev])=>`<tr><td>${h(n)}</td><td class="mono">${productQty[n]}</td><td class="mono">${fmt(rev)}</td></tr>`).join('')}</table>` : `<p class="empty">Sem dados ainda.</p>`}</div>
  </div>
  <div class="grid2" style="margin-top:18px">
    <div class="panel"><h2>Vendas por operador</h2>
      ${Object.keys(byOperator).length ? `<table><tr><th>Operador</th><th>Total vendido</th></tr>${Object.entries(byOperator).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<tr><td>${h(n)}</td><td class="mono">${fmt(v)}</td></tr>`).join('')}</table>` : `<p class="empty">Sem dados ainda.</p>`}</div>
    <div class="panel"><h2>Associados com pendência</h2>
      ${debtors.length ? `<table><tr><th>Nome</th><th>Saldo devedor</th></tr>${debtors.map(m=>`<tr><td>${h(m.name)}</td><td class="mono" style="color:var(--red)">${fmt(m.debt)}</td></tr>`).join('')}</table>` : `<p class="empty">Nenhuma pendência no momento.</p>`}</div>
  </div>
  <div class="panel" style="margin-top:18px"><h2>Últimas vendas</h2>
    ${recentSales.length ? `<table><tr><th>Data/Hora</th><th>Tipo</th><th>Cliente</th><th>Operador</th><th>Forma</th><th>Total</th></tr>${recentSales.map(s=>{
      const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
      const who = member ? member.name : (s.customerName||'Avulso');
      const method = (s.payments&&s.payments[0])?methodLabel(s.payments[0].method):'—';
      return `<tr ondblclick="openOrderHistoryDetail(${jsArg(s.id)})"><td>${dataHoraBR(s.closedAt)}</td><td>${h(typeLabel(s.type))}</td><td>${h(who)}</td><td>${h(s.operatorName||'—')}</td><td>${h(method)}</td><td class="mono">${fmt(s.total)}</td></tr>`;
    }).join('')}</table>` : `<p class="empty">Nenhuma venda registrada ainda.</p>`}</div>
    <div class="grid4" style="margin-top:18px"><div class="stat"><div class="lbl">Pedidos finalizados</div><div class="val">${closedSales.length}</div></div><div class="stat"><div class="lbl">Ticket médio</div><div class="val">${fmt(closedSales.length?totalGeral/closedSales.length:0)}</div></div><div class="stat"><div class="lbl">Itens vendidos</div><div class="val">${closedSales.reduce((s,v)=>s+(v.items||[]).reduce((q,i)=>q+Number(i.qty||0),0),0)}</div></div><div class="stat"><div class="lbl">Margem sobre venda</div><div class="val">${totalGeral?(margemTotal/totalGeral*100).toFixed(1):'0,0'}%</div></div></div>`;
}

function reportDate(value){return localDay(value);}
function reportDateTime(value){return value?dataHoraBR(value):'—';}
function exportCurrentReport(){const table=document.querySelector('#view-relatorios table');if(!table){toast('Não há grade para exportar.');return;}const rows=[...table.rows].filter(r=>r.style.display!=='none').map(r=>[...r.cells].map(c=>c.innerText.trim()));const csv=rows.map(r=>r.map(v=>'"'+v.replace(/"/g,'""')+'"').join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a.download='relatorio-'+todayStr()+'.csv';a.click();URL.revokeObjectURL(a.href);}
function filterReportRows(){const from=document.getElementById('repFrom')?.value||'';const to=document.getElementById('repTo')?.value||'';const q=(document.getElementById('repSearch')?.value||'').toLowerCase();document.querySelectorAll('#reportRows tr').forEach(r=>{const d=r.dataset.date||'';r.style.display=(!from||!d||d>=from)&&(!to||!d||d<=to)&&(!q||r.textContent.toLowerCase().includes(q))?'':'none';});}
function setReportPeriod(kind){const now=new Date(),from=new Date(now);if(kind==='today'){}else if(kind==='yesterday'){from.setDate(now.getDate()-1);now.setDate(now.getDate()-1);}else if(kind==='7'){from.setDate(now.getDate()-6);}else if(kind==='30'){from.setDate(now.getDate()-29);}else if(kind==='month'){from.setDate(1);}document.getElementById('repFrom').value=localDay(from);document.getElementById('repTo').value=localDay(now);filterReportRows();}
function reportShell(title,headers,rows,options={}){const el=document.getElementById('view-relatorios');const from=new Date();from.setDate(1);el.innerHTML=`<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">${h(title)}</header><div class="op-toolbar"><div class="op-search"><input id="repSearch" placeholder="Pesquisar na grade..."></div><div class="op-toolbar-spacer"></div><button class="op-btn" onclick="filterReportRows()">↻ Atualizar</button><button class="op-btn" onclick="exportCurrentReport()">▧ Exportar CSV</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button></div><div class="generic-report-layout"><aside style="padding:16px;border-right:1px solid var(--c-border-strong);background:var(--c-surface-2)"><b>Opções de Pesquisa</b><hr><p><b>${h(options.periodLabel||'Período')}</b></p><div class="grid2" style="gap:7px"><button class="op-btn" onclick="setReportPeriod('today')">Hoje</button><button class="op-btn" onclick="setReportPeriod('yesterday')">Ontem</button><button class="op-btn" onclick="setReportPeriod('7')">Últimos 7 dias</button><button class="op-btn" onclick="setReportPeriod('30')">Últimos 30 dias</button><button class="op-btn" onclick="setReportPeriod('month')">Mês Atual</button></div><div class="field"><label>De</label><input id="repFrom" type="date" value="${localDay(from)}"></div><div class="field"><label>Até</label><input id="repTo" type="date" value="${todayStr()}"></div>${options.extra||''}<button class="op-btn primary" style="width:100%" onclick="filterReportRows()">⌕ &nbsp; Pesquisar</button></aside><main>${options.tabs||''}<div class="op-grid"><table style="min-width:${options.minWidth||900}px"><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join('')}</tr></thead><tbody id="reportRows">${rows||`<tr><td colspan="${headers.length}" class="empty">Não há registros para mostrar</td></tr>`}</tbody></table></div></main></div><footer class="op-footer"><span>${document.querySelectorAll? 'Relatório operacional':''}</span></footer></section></div>`;document.getElementById('repSearch').oninput=filterReportRows;filterReportRows();}
let bestSellerTab='products';
function setBestSellerTab(tab){bestSellerTab=tab;renderRelatorios();}
function bestSellerPeriod(kind){const now=new Date(),from=new Date(now),to=new Date(now);if(kind==='yesterday'){from.setDate(from.getDate()-1);to.setDate(to.getDate()-1);}else if(kind==='previous'){from.setMonth(from.getMonth()-1,1);to.setDate(0);}else if(kind==='current'){from.setDate(1);}const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);document.getElementById('bestFrom').value=local(from);document.getElementById('bestTo').value=local(to);filterBestSellerReport();}
function filterBestSellerReport(){const from=document.getElementById('bestFrom')?.value||'',to=document.getElementById('bestTo')?.value||'';document.querySelectorAll('#bestSellerRows tr[data-dates]').forEach(r=>{const dates=(r.dataset.dates||'').split(',').filter(Boolean);r.style.display=dates.some(d=>(!from||d>=from)&&(!to||d<=to))?'':'none';});}
function renderBestSellersReport(sales){const maps={products:{},combos:{},complements:{},inputs:{}};sales.forEach(s=>(s.items||[]).forEach(i=>{const p=state.products.find(x=>x.id===i.productId),kind=(p&&productKind(p)==='combo')||i.isCombo?'combos':'products',key=i.productId||i.name,target=maps[kind];if(!target[key])target[key]={name:i.name,category:p&&p.category||'',qty:0,cost:0,revenue:0,stock:p?productAvailability(p):0,dates:new Set()};target[key].qty+=Number(i.qty)||0;target[key].revenue+=(Number(i.qty)||0)*(Number(i.price)||0);target[key].cost+=(Number(i.qty)||0)*(p?productCost(p):0);target[key].dates.add(reportDate(s.openedAt));const itemComplements=i.complements||(i.customization&&i.customization.complements)||[];itemComplements.forEach(c=>{const ck=c.id||c.name;if(!maps.complements[ck])maps.complements[ck]={name:c.name,category:'Complemento',qty:0,cost:0,revenue:0,stock:0,dates:new Set()};maps.complements[ck].qty+=(Number(c.qty)||1)*(Number(i.qty)||1);maps.complements[ck].revenue+=(Number(c.price)||0)*(Number(c.qty)||1)*(Number(i.qty)||1);maps.complements[ck].dates.add(reportDate(s.openedAt));});if(p)(p.recipe||[]).forEach(rec=>{const input=state.insumos.find(x=>x.id===rec.insumoId);if(!input)return;const ik=input.id;if(!maps.inputs[ik])maps.inputs[ik]={name:input.name,category:'Insumo',qty:0,cost:0,revenue:0,stock:input.stock,dates:new Set()};const used=(Number(rec.qty)||0)*(Number(i.qty)||1);maps.inputs[ik].qty+=used;maps.inputs[ik].cost+=used*(Number(input.costPerUnit)||0);maps.inputs[ik].dates.add(reportDate(s.openedAt));});}));const list=Object.values(maps[bestSellerTab]).sort((a,b)=>b.qty-a.qty),rows=list.map((x,i)=>`<tr data-dates="${[...x.dates].join(',')}"><td>${i+1}</td><td>${h(x.name)}</td><td>${h(x.category||'—')}</td><td>${x.qty?fmt(x.cost/x.qty):fmt(0)}</td><td>${Number(x.qty).toLocaleString('pt-BR')}</td><td>${fmt(x.cost)}</td><td>${fmt(x.revenue)}</td><td>${fmt(x.revenue-x.cost)}</td><td>${Number(x.stock)||0}</td><td>${fmt(x.cost)}</td><td>${x.revenue?((x.revenue-x.cost)/x.revenue*100).toFixed(2):'0,00'}%</td></tr>`).join('')||'<tr><td colspan="11" class="empty" style="height:360px">Não há registros para mostrar</td></tr>';const from=new Date();from.setDate(1);document.getElementById('view-relatorios').innerHTML=`<div class="report-workspace"><section class="report-window"><header class="op-titlebar">Mais Vendidos</header><div class="best-report-toolbar"><button class="op-btn" onclick="window.print()">▣ &nbsp; Imprimir</button><button class="op-btn" onclick="exportCurrentReport()">▧ &nbsp; Exportar Excel</button></div><div class="best-report-layout"><aside class="report-filter"><b>Opções de Pesquisa</b><div class="report-period-title">Período de abertura do pedido</div><div class="report-period-links"><button onclick="bestSellerPeriod('today')">Hoje</button><button onclick="bestSellerPeriod('yesterday')">Ontem</button><button onclick="bestSellerPeriod('previous')">Mês Anterior</button><button onclick="bestSellerPeriod('current')">Mês Atual</button></div><div class="report-date-row"><label>De</label><div><input id="bestFrom" type="date" value="${localDay(from)}"><input type="time" value="00:00"></div></div><div class="report-date-row"><label>Até</label><div><input id="bestTo" type="date" value="${todayStr()}"><input type="time" value="23:59"></div></div><button class="report-search-button" onclick="filterBestSellerReport()">⌕ &nbsp; Pesquisar</button></aside><main class="best-report-main"><div class="finance-tabs best-tabs"><button class="${bestSellerTab==='products'?'active':''}" onclick="setBestSellerTab('products')">Produtos mais vendidos</button><button class="${bestSellerTab==='combos'?'active':''}" onclick="setBestSellerTab('combos')">Combos mais vendidos</button><button class="${bestSellerTab==='complements'?'active':''}" onclick="setBestSellerTab('complements')">Complementos mais vendidos</button><button class="${bestSellerTab==='inputs'?'active':''}" onclick="setBestSellerTab('inputs')">Insumos mais utilizados</button></div><div class="finance-grid"><table style="min-width:1300px"><thead><tr><th>Ordem</th><th>Produto</th><th>Categoria</th><th>Custo Médio</th><th>Quantidade</th><th>Custo</th><th>Venda</th><th>Lucro</th><th>Estoque</th><th>Custo do Estoque</th><th>Margem</th></tr></thead><tbody id="bestSellerRows">${rows}</tbody></table></div></main></div></section></div>`;}
let orderHistoryFilters={status:'all',dateType:'opened',from:'',to:'',client:'',operator:'',code:'',showDeleted:false};
function orderHistoryQuickPeriod(kind){const now=new Date(),from=new Date(now),to=new Date(now);if(kind==='yesterday'){from.setDate(from.getDate()-1);to.setDate(to.getDate()-1);}else if(kind==='month')from.setDate(1);else if(kind==='previous'){from.setMonth(from.getMonth()-1,1);to.setDate(0);}else if(kind==='7')from.setDate(from.getDate()-6);else if(kind==='30')from.setDate(from.getDate()-29);const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);document.getElementById('ohFrom').value=local(from);document.getElementById('ohTo').value=local(to);}
function openOrderHistoryFilters(){const f=orderHistoryFilters;openModal('Histórico de Pedidos - Pesquisar',`<div class="history-filter-modal"><h4>Status do Pedido</h4><div class="history-status-grid">${[['all','Todos os pedidos'],['paid','Finalizados e pagos'],['open','Abertos'],['credit','Finalizados como fiado'],['closed','Finalizados']].map(([v,n])=>`<label><input type="radio" name="ohStatus" value="${v}" ${f.status===v?'checked':''}> ${n}</label>`).join('')}</div><h4>Outros Filtros</h4><div class="field"><label>Data para o filtro</label><select id="ohDateType"><option value="opened" ${f.dateType==='opened'?'selected':''}>Data de Abertura</option><option value="closed" ${f.dateType==='closed'?'selected':''}>Data de Fechamento</option></select></div><div class="history-quick-links">${[['today','Hoje'],['month','Mês atual'],['7','Últimos 7 dias'],['yesterday','Ontem'],['previous','Mês anterior'],['30','Últimos 30 dias']].map(([v,n])=>`<button onclick="orderHistoryQuickPeriod(${jsArg(v)})">${n}</button>`).join('')}</div><div class="row"><div class="field"><label>De</label><input id="ohFrom" type="date" value="${f.from||todayStr()}"></div><div class="field"><label>Até</label><input id="ohTo" type="date" value="${f.to||todayStr()}"></div></div><h4>Outros Filtros</h4><div class="row"><div class="field"><label>Nome do cliente</label><input id="ohClient" value="${h(f.client)}"></div><div class="field"><label>Nome do colaborador</label><input id="ohOperator" value="${h(f.operator)}"></div></div><div class="row"><div class="field"><label>Código do Pedido (Ex.: 111, 222)</label><input id="ohCode" value="${h(f.code)}"></div><label class="history-deleted"><input id="ohDeleted" type="checkbox" ${f.showDeleted?'checked':''}> Exibir pedidos excluídos</label></div></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 &nbsp; Voltar</button><button class="consumer-save" id="ohSearch">⌕ &nbsp; Pesquisar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal','history-filter-record-modal');document.getElementById('ohSearch').onclick=()=>{orderHistoryFilters={status:document.querySelector('input[name="ohStatus"]:checked').value,dateType:document.getElementById('ohDateType').value,from:document.getElementById('ohFrom').value,to:document.getElementById('ohTo').value,client:document.getElementById('ohClient').value.trim(),operator:document.getElementById('ohOperator').value.trim(),code:document.getElementById('ohCode').value.trim(),showDeleted:document.getElementById('ohDeleted').checked};closeModal();renderRelatorios();};}
let orderHistoryExtraColumns=[];
let orderHistoryGroupBy='';
const orderHistoryColumnGroups=[
  ['1 - Dados do Cliente',[['client','Cliente'],['phone','Telefone'],['address','Endereço'],['district','Bairro'],['city','Cidade'],['uf','UF']]],
  ['2 - Totais do Pedido',[['subtotal','Subtotal'],['discount','Desconto'],['deliveryFee','Taxa de Entrega'],['total','Total']]],
  ['3 - Pagamento',[['payment','Forma de Pagamento'],['change','Troco'],['paidValue','Valor Pago']]],
  ['4 - Outras Informações',[['operator','Criado por'],['origin','Origem'],['deliveryType','Tipo Entrega'],['notes','Observação']]],
  ['5 - QR na Mesa / Cardápio Digital',[['qrTable','Mesa / QR'],['digitalMenu','Cardápio Digital']]],
  ['6 - UTM',[['utmMedium','UTM Medium'],['utmCampaign','UTM Campaign'],['utmSource','UTM Source']]],
  ['Mais Colunas',[['itemCount','Quantidade de Itens'],['closedAt','Data Fechamento'],['cashId','Identificador do Caixa']]]
];
function historyExtraValue(s,key){const m=state.members.find(x=>x.id===s.memberId),payments=s.payments||[],items=s.items||[];return {client:m?m.name:(s.customerName||'Avulso'),phone:m?.phone||s.customerPhone||'—',address:m?.address||s.address||'—',district:m?.district||'—',city:m?.city||'—',uf:m?.uf||'—',subtotal:fmt(items.reduce((a,i)=>a+Number(i.price||0)*Number(i.qty||0),0)),discount:fmt(s.discount||0),deliveryFee:fmt(s.deliveryFee||0),total:fmt(s.total||0),payment:payments.map(p=>methodLabel(p.method)).join(', ')||'—',change:fmt(s.change||0),paidValue:fmt(payments.reduce((a,p)=>a+Number(p.amount||0),0)),operator:s.operatorName||'—',origin:s.origin||typeLabel(s.type),deliveryType:s.deliveryType||typeLabel(s.type),notes:s.notes||'—',qrTable:s.tableNumber||'—',digitalMenu:s.type==='cardapio'?'Sim':'Não',utmMedium:s.utmMedium||'—',utmCampaign:s.utmCampaign||'—',utmSource:s.utmSource||'—',itemCount:items.reduce((a,i)=>a+Number(i.qty||0),0),closedAt:reportDateTime(s.closedAt),cashId:s.cashSessionId||'—'}[key]??'—';}
function renderOrderHistoryReport(sales){const f=orderHistoryFilters,from=f.from||todayStr(),to=f.to||todayStr(),visible=sales.filter(s=>{const statusOk=f.status==='all'||(f.status==='open'&&s.status==='open')||(f.status==='closed'&&s.status==='closed')||(f.status==='paid'&&s.status==='closed'&&!(s.payments||[]).some(p=>p.method==='fiado'))||(f.status==='credit'&&(s.payments||[]).some(p=>p.method==='fiado'));const member=state.members.find(x=>x.id===s.memberId),client=(member&&member.name||s.customerName||'Avulso').toLowerCase(),operator=(s.operatorName||'').toLowerCase(),date=reportDate(f.dateType==='closed'?s.closedAt:s.openedAt);return statusOk&&(!from||date>=from)&&(!to||date<=to)&&(!f.client||client.includes(f.client.toLowerCase()))&&(!f.operator||operator.includes(f.operator.toLowerCase()))&&(!f.code||String(s.orderNumber||s.id).includes(f.code));}),labelMap=Object.fromEntries(orderHistoryColumnGroups.flatMap(g=>g[1])),extraHeaders=orderHistoryExtraColumns.map(k=>`<th>${h(labelMap[k])}</th>`).join(''),rows=visible.sort((a,b)=>new Date(b.openedAt)-new Date(a.openedAt)).map(s=>{const m=state.members.find(x=>x.id===s.memberId),extra=orderHistoryExtraColumns.map(k=>`<td>${h(String(historyExtraValue(s,k)))}</td>`).join('');return `<tr data-history-sale="${s.id}" ondblclick="openOrderHistoryDetail(${jsArg(s.id)})"><td>${h(String(s.orderNumber||s.id))}</td><td>${reportDateTime(s.openedAt)}</td><td>${s.status==='closed'?'Finalizado':'Aberto'}</td><td>${h(s.operatorName||'—')}</td><td>${h(m?m.name:(s.customerName||'Avulso'))}</td><td>${h(typeLabel(s.type))}</td><td>${reportDateTime(s.closedAt)}</td><td>${h(s.origin||typeLabel(s.type))}</td>${extra}</tr>`}).join('')||`<tr><td colspan="${8+orderHistoryExtraColumns.length}" class="empty" style="height:390px">Não há registros para mostrar</td></tr>`,statusText={all:'Todos os pedidos',open:'Abertos',closed:'Finalizados',paid:'Finalizados e pagos',credit:'Finalizados como fiado'}[f.status];document.getElementById('view-relatorios').innerHTML=`<div class="report-workspace"><section class="report-window order-history-window"><header class="op-titlebar">Histórico de Pedidos</header><div class="history-report-toolbar"><button class="history-filter-summary" onclick="openOrderHistoryFilters()">⌕ &nbsp; <u>${statusText} &gt; ${f.dateType==='opened'?'Data de Abertura':'Data de Fechamento'} [${from} 00:00 - ${to} 23:59]</u></button><button class="history-refresh" onclick="renderRelatorios()">↻ &nbsp; Atualizar</button><button class="op-btn" onclick="window.print()">▣ &nbsp; Imprimir</button><button class="op-btn" onclick="openOrderHistoryColumns()">▦ &nbsp; Mais Colunas</button><button class="op-btn" onclick="exportCurrentReport()">▧ &nbsp; Exportar Excel</button></div><div class="finance-grid history-report-grid"><table style="min-width:${Math.max(1200,960+orderHistoryExtraColumns.length*145)}px"><thead><tr><th>Código</th><th>Data Abertura</th><th>Status</th><th>Criado por</th><th>Cliente</th><th>Tipo</th><th>Data Fechamento</th><th>Origem</th>${extraHeaders}</tr></thead><tbody>${rows}</tbody></table></div></section></div>`;}
function openOrderHistoryColumns(){const groups=orderHistoryColumnGroups.map((g,i)=>`<details class="columns-group" ${i===0?'open':''}><summary>${h(g[0])}</summary><div class="columns-fields">${g[1].map(([key,label])=>`<label><input class="history-column-choice" type="checkbox" value="${key}" ${orderHistoryExtraColumns.includes(key)?'checked':''}> ${h(label)}</label>`).join('')}</div></details>`).join(''),groupChoices=[['operator','Criado por'],['origin','Origem'],['utmMedium','UTM Medium'],['district','Bairro'],['deliveryType','Tipo Entrega'],['utmCampaign','UTM Campaign'],['type','Tipo'],['utmSource','UTM Source']];openModal('Exibir / Ocultar Colunas',`<div class="columns-panel"><div class="columns-tree">${groups}</div><div class="columns-grouping"><b>Agrupar Por</b><div class="columns-grouping-grid">${groupChoices.map(([key,label])=>`<label><input type="radio" name="historyGroup" value="${key}" ${orderHistoryGroupBy===key?'checked':''}>${h(label)}</label>`).join('')}</div></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" id="historyColumnsApply">✓ Aplicar</button></div>`);const modal=document.querySelector('#modalRoot .modal');modal.classList.add('columns-record-modal');document.getElementById('historyColumnsApply').onclick=()=>{orderHistoryExtraColumns=[...document.querySelectorAll('.history-column-choice:checked')].map(x=>x.value);orderHistoryGroupBy=document.querySelector('input[name="historyGroup"]:checked')?.value||'';closeModal();renderRelatorios();toast('Colunas atualizadas.');};}
