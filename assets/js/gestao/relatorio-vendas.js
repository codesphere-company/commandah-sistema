/* ============ RELATÓRIO DE VENDAS ============ */
// 10/11 (pedido da Vanessa): vendas por período e forma de pagamento, com os itens de cada venda. Período pela
// data de pagamento (saleRevenueDay). Venda com duas formas: o filtro a encontra pelas duas, e a tabela por
// forma soma só a parte paga em cada uma, então o faturamento é o total das vendas encontradas.
function reportMonthStart(){ const d=new Date(); return localDay(new Date(d.getFullYear(),d.getMonth(),1,12).toISOString()); }
const salesDetailFilter={from:'',to:'',method:'',type:'',product:'',customer:'',showCanceled:false};
function salesReportData(f){
  const from=f.from||reportMonthStart(), to=f.to||todayStr(), prod=String(f.product||'').trim().toLowerCase(), cli=String(f.customer||'').trim().toLowerCase();
  const sales=state.sales.filter(s=>{
    if(!s||!(saleCountsAsRevenue(s)||(f.showCanceled&&s.canceled))) return false;
    const d=saleRevenueDay(s); if(d<from||d>to) return false;
    if(f.method&&!(s.payments||[]).some(p=>normalizarMetodo(p.method)===normalizarMetodo(f.method))) return false;
    if(f.type&&s.type!==f.type) return false;
    if(prod&&!(s.items||[]).some(i=>!i.canceled&&String(i.name||'').toLowerCase().includes(prod))) return false;
    if(cli){ const m=s.memberId?state.members.find(x=>x.id===s.memberId):null; if(!(reportSaleWho(s).toLowerCase().includes(cli)||(m&&String(m.code||'').toLowerCase()===cli))) return false; }
    return true;
  }).sort((a,b)=>new Date(b.closedAt||b.openedAt)-new Date(a.closedAt||a.openedAt));
  const valid=sales.filter(saleCountsAsRevenue), total=arredondaCentavos(valid.reduce((a,s)=>a+(Number(s.total)||0),0)); let items=0, kg=0;
  valid.forEach(s=>(s.items||[]).filter(i=>!i.canceled).forEach(i=>{ if(i.weight) kg=Math.round((kg+(Number(i.weight.kg)||0))*1000)/1000; else items+=Number(i.qty)||0; }));
  return { sales, total, count:valid.length, ticket:valid.length?arredondaCentavos(total/valid.length):0, items, kg, byMethod:somaPorMetodo(valid) };
}
function applySalesDetailFilter(){
  const v=id=>document.getElementById(id);
  Object.assign(salesDetailFilter,{from:v('sdFrom').value,to:v('sdTo').value,method:v('sdMethod').value,type:v('sdType').value,product:v('sdProduct').value,customer:v('sdCustomer').value,showCanceled:v('sdCanceled').checked});
  renderRelatorios();
}
function renderSalesDetailReport(){
  const f=salesDetailFilter, d=salesReportData(f), LIMITE=1000, from=f.from||reportMonthStart(), to=f.to||todayStr();
  const metodos=[...new Set([...listaDeFormas().map(x=>x.method),...state.sales.flatMap(s=>(s&&s.payments||[]).map(p=>normalizarMetodo(p.method))).filter(Boolean)])];
  const tipos=[...new Set(state.sales.map(s=>s&&s.type).filter(Boolean))];
  const enter=`onkeydown="if(event.key==='Enter')applySalesDetailFilter()"`;
  const filtros=`<div class="field"><label for="sdFrom">De</label><input id="sdFrom" type="date" value="${h(from)}"></div><div class="field"><label for="sdTo">Até</label><input id="sdTo" type="date" value="${h(to)}"></div><div class="field"><label for="sdMethod">Forma de pagamento</label><select id="sdMethod"><option value="">Todas</option>${metodos.map(m=>`<option value="${h(m)}" ${m===f.method?'selected':''}>${h(paymentMethodLabel(m))}</option>`).join('')}</select></div><div class="field"><label for="sdType">Tipo</label><select id="sdType"><option value="">Todos</option>${tipos.map(t=>`<option value="${h(t)}" ${t===f.type?'selected':''}>${h(typeLabel(t))}</option>`).join('')}</select></div><div class="field"><label for="sdProduct">Produto</label><input id="sdProduct" value="${h(f.product)}" ${enter}></div><div class="field"><label for="sdCustomer">Cliente (nome ou cota)</label><input id="sdCustomer" value="${h(f.customer)}" ${enter}></div><label class="det-check"><input id="sdCanceled" type="checkbox" ${f.showCanceled?'checked':''}> Mostrar canceladas</label><button class="op-btn primary" onclick="applySalesDetailFilter()">⌕ &nbsp; Pesquisar</button>`;
  const validas=d.sales.filter(saleCountsAsRevenue), porForma=colunasDeFormas([d.byMethod]).map(c=>`<tr><td>${h(c.label)}</td><td>${validas.filter(s=>(s.payments||[]).some(p=>normalizarMetodo(p.method)===c.method||p.method===c.method)).length}</td><td class="mono">${fmt(d.byMethod[c.method])}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Nenhuma venda no período.</td></tr>';
  document.getElementById('view-relatorios').innerHTML=detReportHtml('Relatório de Vendas','exportSalesDetailReport()',filtros,
    detStatsHtml([['Faturamento',fmt(d.total)],['Vendas',d.count],['Ticket médio',fmt(d.ticket)],['Itens vendidos',d.items+(d.kg?' + '+fmtKg(d.kg):'')]])+
    (f.method?'<p class="det-aviso">O faturamento é o total das vendas encontradas. A tabela por forma soma só a parte paga em cada uma.</p>':'')+
    `<div class="finance-grid det-grid"><table><thead><tr><th>Forma de pagamento</th><th>Vendas</th><th>Total</th></tr></thead><tbody>${porForma}</tbody></table></div><h3>Vendas e itens</h3>${d.sales.slice(0,LIMITE).map(s=>saleCardHtml(s,{showCustomer:true})).join('')||'<p class="empty">Nenhuma venda com esses filtros.</p>'}${d.sales.length>LIMITE?`<p class="sub">Mostrando ${LIMITE} de ${d.sales.length}. Use os filtros ou exporte para ver tudo.</p>`:''}`);
}
function salesDetailSheets(f){
  const d=salesReportData(f), arr=arredondaCentavos, linhas=[];
  d.sales.forEach(s=>{ const itens=s.items&&s.items.length?s.items:[{}]; itens.forEach(i=>linhas.push([s.orderNumber||s.id||'',reportWhen(s.closedAt||s.openedAt),typeLabel(s.type)||'',reportSaleWho(s),reportSalePayments(s),i.name||'',i.weight?fmtKg(i.weight.kg):(i.qty==null?'':Number(i.qty)||0),i.name?arr(reportItemValue(i)):'',i.addedBy||s.operatorName||'',i.canceled||s.canceled?'Sim':'Não',arr(Number(s.total)||0)])); });
  return [['Vendas e itens',[['Pedido','Data','Tipo','Cliente','Forma','Item','Quantidade','Valor','Lançado por','Cancelado','Total da venda'],...linhas],[9,19,10,28,28,34,11,11,16,10,12]],
    ['Por forma',[['Forma de pagamento','Total'],...colunasDeFormas([d.byMethod]).map(c=>[c.label,arr(d.byMethod[c.method])]),['TOTAL',d.total]],[26,14]]];
}
async function exportSalesDetailReport(){
  if(typeof fetchFreshSales==='function') await fetchFreshSales();
  const f=salesDetailFilter; await exportAoaXlsx('commandah-vendas-'+(f.from||reportMonthStart())+'-a-'+(f.to||todayStr())+'.xlsx',salesDetailSheets(f));
}
