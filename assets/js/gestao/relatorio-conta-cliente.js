/* ============ RELATÓRIO: CONTA DO CLIENTE ============ */
// 10/11 (pedido da Vanessa): quantos clientes devem, quanto, desde quando e a última compra. "Devendo desde"
// segue fiadoOpenDebts (os pagamentos quitam primeiro as dívidas mais antigas). Arquivados ficam fora por
// padrão, para o total bater com o Resumo do Dia.
const customerAccountFilter={search:'',onlyDebtors:true,includeArchived:false,days:7};
function customerAccountRows(f){
  const now=Date.now(), q=String(f.search||'').trim().toLowerCase(), limite=Number.isFinite(Number(f.days))?Number(f.days):7, ultima={};
  state.sales.forEach(s=>{ if(!s.memberId||!saleCountsAsRevenue(s)) return; const at=s.closedAt||s.openedAt; if(reportValidDate(at)&&(!ultima[s.memberId]||new Date(at)>new Date(ultima[s.memberId]))) ultima[s.memberId]=at; });
  const base=state.members.filter(m=>f.includeArchived||!m.archived).map(m=>{
    const debt=Number(m.debt)||0, deve=debt>TOLERANCIA_CENTAVO, abertas=deve?fiadoOpenDebts(m):[], oldest=abertas.length?abertas[0].at:null;
    const pagos=(m.debtHistory||[]).filter(e=>e.type==='payment'&&!e.reversed&&!/crédito de troco/i.test(e.reason||'')&&reportValidDate(e.at)).map(e=>e.at).sort((a,b)=>new Date(b)-new Date(a));
    const dias=oldest?Math.max(0,Math.floor((now-new Date(oldest).getTime())/86400000)):0;
    return { m, debt, deve, lastPurchase:ultima[m.id]||null, lastPayment:pagos[0]||null, oldest, days:dias, overdue:deve&&!!oldest&&dias>limite };
  });
  const devedores=base.filter(r=>r.deve);
  const rows=base.filter(r=>(!f.onlyDebtors||r.deve)&&(!q||String(r.m.name||'').toLowerCase().includes(q)||String(r.m.code||'').toLowerCase()===q)).sort((a,b)=>b.debt-a.debt||String(a.m.name||'').localeCompare(String(b.m.name||''),'pt-BR'));
  return { rows, debtors:devedores.length, total:arredondaCentavos(devedores.reduce((a,r)=>a+r.debt,0)), overdueCount:devedores.filter(r=>r.overdue).length };
}
function applyCustomerAccountFilter(){
  const v=id=>document.getElementById(id);
  Object.assign(customerAccountFilter,{search:v('caSearch').value,onlyDebtors:v('caOnly').checked,includeArchived:v('caArch').checked,days:Math.max(0,parseInt(v('caDays').value,10)||0)});
  renderRelatorios();
}
function renderCustomerAccountReport(){
  if(customerAccountDetail.id){ const aberto=state.members.find(x=>x.id===customerAccountDetail.id); if(aberto){ renderCustomerAccountDetail(aberto); return; } customerAccountDetail.id=null; }
  const f=customerAccountFilter, d=customerAccountRows(f);
  const filtros=`<div class="field"><label for="caSearch">Buscar por nome ou cota</label><input id="caSearch" value="${h(f.search)}" onkeydown="if(event.key==='Enter')applyCustomerAccountFilter()"></div><div class="field det-campo-curto"><label for="caDays">Dias em aberto</label><input id="caDays" type="number" min="0" value="${f.days}" onchange="applyCustomerAccountFilter()"></div><label class="det-check"><input id="caOnly" type="checkbox" ${f.onlyDebtors?'checked':''} onchange="applyCustomerAccountFilter()"> Só quem deve</label><label class="det-check"><input id="caArch" type="checkbox" ${f.includeArchived?'checked':''} onchange="applyCustomerAccountFilter()"> Incluir arquivados</label><button class="op-btn primary" onclick="applyCustomerAccountFilter()">⌕ &nbsp; Pesquisar</button>`;
  const linhas=d.rows.map(r=>`<tr><td><button type="button" class="det-link" onclick="openCustomerAccount(${jsArg(r.m.id)})">${h(r.m.name||'—')}</button>${r.m.archived?' <span class="tag">Arquivado</span>':''}</td><td>${h(r.m.code||'—')}</td><td class="mono">${fmt(r.debt)}</td><td>${reportDateOnly(r.lastPurchase)}</td><td>${reportDateOnly(r.lastPayment)}</td><td>${reportDateOnly(r.oldest)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">Nenhum cliente encontrado.</td></tr>';
  document.getElementById('view-relatorios').innerHTML=detReportHtml('Conta do Cliente','exportCustomerAccountReport()',filtros,
    detStatsHtml([['Clientes devendo',d.debtors],['Total em aberto',fmt(d.total)],['Devendo há mais de '+f.days+' dias',d.overdueCount]])+
    `<div class="finance-grid det-grid"><table><thead><tr><th>Cliente</th><th>Cota</th><th>Saldo devedor</th><th>Última compra</th><th>Último pagamento</th><th>Devendo desde</th></tr></thead><tbody>${linhas}</tbody></table></div>`);
}
async function exportCustomerAccountReport(){
  if(typeof fetchFreshSales==='function') await fetchFreshSales();
  const d=customerAccountRows(customerAccountFilter), dt=v=>reportValidDate(v)?reportDateOnly(v):'';
  await exportAoaXlsx('commandah-clientes-devedores-'+todayStr()+'.xlsx',[['Clientes',[['Cliente','Cota','Telefone','Saldo devedor','Última compra','Último pagamento','Devendo desde','Dias em aberto'],...d.rows.map(r=>[r.m.name||'',r.m.code||'',r.m.phone||'',arredondaCentavos(r.debt),dt(r.lastPurchase),dt(r.lastPayment),dt(r.oldest),r.oldest?r.days:''])],[32,8,16,14,14,16,14,10]]]);
}

// Conta aberta: tudo do cliente em ordem do mais recente para o mais antigo. Lançamento ligado a uma venda
// (saleId) é absorvido pelo cartão da venda, para a compra não aparecer duas vezes. Sem período escolhido,
// mostra a conta inteira. Os indicadores não mudam com as caixas de marcar: elas só escolhem o que listar.
const customerAccountDetail={id:null,from:'',to:'',fiado:true,paid:true,payments:true};
function customerTimeline(member, f){
  const dentro=d=>(!f.from||d>=f.from)&&(!f.to||d<=f.to);
  const vendas=state.sales.filter(s=>s.memberId===member.id&&saleCountsAsRevenue(s));
  const ids=new Set(vendas.map(s=>s.id)), periodo=vendas.filter(s=>dentro(saleRevenueDay(s)));
  const saldos=new Map(fiadoStatementData(member,'','').lines.map(l=>[l.e.id,l.bal]));
  const lanc=(member.debtHistory||[]).filter(e=>!(e.saleId&&ids.has(e.saleId))&&reportValidDate(e.at)&&dentro(localDay(e.at)));
  const pagamentos=lanc.filter(e=>e.type!=='debt');
  const dinheiroNaHora=periodo.reduce((a,s)=>a+(s.payments||[]).filter(p=>!salePayIsFiado(p)).reduce((b,p)=>b+(Number(p.amount)||0),0),0);
  const fiadoPago=pagamentos.filter(e=>e.type==='payment'&&!e.reversed&&!/crédito de troco/i.test(e.reason||'')).reduce((a,e)=>a+(Number(e.value)||0),0);
  const entries=[
    ...periodo.filter(s=>{ const ps=s.payments||[], temFiado=ps.some(salePayIsFiado), temPago=!ps.length||ps.some(p=>!salePayIsFiado(p)); return (f.fiado&&temFiado)||(f.paid&&temPago); }).map(s=>({kind:'sale',at:s.closedAt||s.openedAt,sale:s})),
    ...(f.payments?pagamentos:[]).map(e=>({kind:'payment',at:e.at,e,balance:saldos.get(e.id)})),
    ...(f.fiado?lanc.filter(e=>e.type==='debt'):[]).map(e=>({kind:'entry',at:e.at,e,balance:saldos.get(e.id)})),
  ].sort((a,b)=>new Date(b.at)-new Date(a.at));
  return { entries, bought:arredondaCentavos(periodo.reduce((a,s)=>a+(Number(s.total)||0),0)), paidTotal:arredondaCentavos(dinheiroNaHora+fiadoPago), purchases:periodo.length };
}
function customerTopProducts(member, from, to){
  const mapa={};
  state.sales.filter(s=>s.memberId===member.id&&saleCountsAsRevenue(s)).forEach(s=>{ const d=saleRevenueDay(s); if((from&&d<from)||(to&&d>to)) return;
    (s.items||[]).filter(i=>!i.canceled).forEach(i=>{ const k=i.name||'—', x=mapa[k]=mapa[k]||{name:k,qty:0,kg:0,value:0,last:null}; if(i.weight) x.kg=Math.round((x.kg+(Number(i.weight.kg)||0))*1000)/1000; else x.qty+=Number(i.qty)||0; x.value+=reportItemValue(i); const at=s.closedAt||s.openedAt; if(reportValidDate(at)&&(!x.last||new Date(at)>new Date(x.last))) x.last=at; }); });
  return Object.values(mapa).sort((a,b)=>(b.qty+b.kg)-(a.qty+a.kg)||b.value-a.value);
}
function openCustomerAccount(id){ Object.assign(customerAccountDetail,{id,from:'',to:'',fiado:true,paid:true,payments:true}); renderRelatorios(); }
function closeCustomerAccount(){ customerAccountDetail.id=null; renderRelatorios(); }
function applyCustomerAccountDetail(){
  const v=id=>document.getElementById(id);
  Object.assign(customerAccountDetail,{from:v('cdFrom').value,to:v('cdTo').value,fiado:v('cdFiado').checked,paid:v('cdPaid').checked,payments:v('cdPay').checked});
  renderRelatorios();
}
function customerEntryHtml(x){
  if(x.kind==='sale') return saleCardHtml(x.sale,{});
  const e=x.e, pagamento=x.kind==='payment', forma=fiadoMethodLabel(e.method), titulo=e.reason&&!/^pagamento$/i.test(e.reason)?e.reason:(pagamento?'Pagamento':'Lançamento');
  const linhas=[e.user?(pagamento?'Recebido por ':'Lançado por ')+e.user:'', x.balance!=null?'Saldo depois: '+fmt(x.balance):''].filter(Boolean);
  return `<article class="det-sale"><header><b>${h(reportWhen(e.at))} · ${h(titulo)}${forma?`<span class="det-tag">${h(forma)}</span>`:''}${e.reversed?' <span class="tag tag-red">Estornado</span>':''}</b><b class="mono">${pagamento?'− ':''}${fmt(Number(e.value)||0)}</b></header>${linhas.length?`<ul>${linhas.map(l=>`<li><span>${h(l)}</span></li>`).join('')}</ul>`:''}</article>`;
}
function renderCustomerAccountDetail(m){
  const f=customerAccountDetail, t=customerTimeline(m,f), top=customerTopProducts(m,f.from,f.to), LIMITE=1000;
  const marca=(id,on,txt)=>`<label class="det-check"><input id="${id}" type="checkbox" ${on?'checked':''} onchange="applyCustomerAccountDetail()"> ${txt}</label>`;
  const filtros=`<button class="op-btn" onclick="closeCustomerAccount()">‹ &nbsp; Voltar</button><div class="field"><label for="cdFrom">De</label><input id="cdFrom" type="date" value="${h(f.from)}"></div><div class="field"><label for="cdTo">Até</label><input id="cdTo" type="date" value="${h(f.to)}"></div><button class="op-btn primary" onclick="applyCustomerAccountDetail()">⌕ &nbsp; Pesquisar</button>${marca('cdFiado',f.fiado,'Compras no fiado')}${marca('cdPaid',f.paid,'Compras pagas na hora')}${marca('cdPay',f.payments,'Pagamentos')}`;
  const lista=t.entries.slice(0,LIMITE).map(customerEntryHtml).join('')||'<p class="empty">Nenhum movimento nesse período.</p>';
  const topHtml=top.length?`<div class="finance-grid det-grid"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Valor</th><th>Última vez</th></tr></thead><tbody>${top.map(p=>`<tr><td>${h(p.name)}</td><td>${[p.qty?p.qty:'',p.kg?fmtKg(p.kg):''].filter(Boolean).join(' + ')||0}</td><td class="mono">${fmt(p.value)}</td><td>${reportDateOnly(p.last)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Nenhuma compra nesse período.</p>';
  document.getElementById('view-relatorios').innerHTML=detReportHtml((m.name||'Cliente')+(m.code?' · Cota '+m.code:''),'exportCustomerAccountDetail()',filtros,
    detStatsHtml([['Saldo devedor',fmt(Number(m.debt)||0)],['Comprou no período',fmt(t.bought)],['Pagou no período',fmt(t.paidTotal)],['Compras no período',t.purchases]])+
    `<h3>Movimentos</h3>${lista}${t.entries.length>LIMITE?`<p class="sub">Mostrando ${LIMITE} de ${t.entries.length}. Use o período ou exporte para ver tudo.</p>`:''}<h3>O que mais compra</h3>${topHtml}`);
}
async function exportCustomerAccountDetail(){
  const m=state.members.find(x=>x.id===customerAccountDetail.id); if(!m) return;
  if(typeof fetchFreshSales==='function') await fetchFreshSales();
  const f=customerAccountDetail, t=customerTimeline(m,f), top=customerTopProducts(m,f.from,f.to), arr=arredondaCentavos, linhas=[];
  t.entries.forEach(x=>{
    if(x.kind==='sale'){ const s=x.sale, itens=(s.items||[]); (itens.length?itens:[{}]).forEach(i=>linhas.push([reportWhen(x.at),typeLabel(s.type)||'Pedido',s.orderNumber||s.id||'',reportSalePayments(s),i.name||'',i.weight?fmtKg(i.weight.kg):(i.qty==null?'':Number(i.qty)||0),i.name?arr(reportItemValue(i)):'',i.addedBy||s.operatorName||'',i.canceled?'Sim':'Não',arr(Number(s.total)||0),''])); }
    else { const e=x.e, pag=x.kind==='payment'; linhas.push([reportWhen(e.at),pag?'Pagamento':'Lançamento','',fiadoMethodLabel(e.method),e.reason||'','',arr((pag?-1:1)*(Number(e.value)||0)),e.user||'',e.reversed?'Estornado':'Não','',x.balance==null?'':arr(x.balance)]); }
  });
  await exportAoaXlsx('commandah-conta-'+String(m.code||m.id)+'-'+todayStr()+'.xlsx',[
    ['Movimentos',[['Data','Tipo','Pedido','Forma','Item ou descrição','Qtd.','Valor','Lançado por','Cancelado','Total da venda','Saldo depois'],...linhas],[19,12,9,26,36,10,11,16,10,12,12]],
    ['O que mais compra',[['Produto','Quantidade','Kg','Valor','Última vez'],...top.map(p=>[p.name,p.qty,p.kg,arr(p.value),reportValidDate(p.last)?reportDateOnly(p.last):''])],[36,10,10,12,12]]]);
}
