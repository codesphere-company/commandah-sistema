/* ============ RELATÓRIO: VENDAS DOS GARÇONS ============ */
// 10/11 (pedido da Vanessa): cada item conta para quem o lançou (addedBy; sem autor, o operador da venda), mesmo
// que outra pessoa tenha aberto ou fechado a comanda. Valor é quantidade × preço, sem desconto nem serviço.
const waiterReportFilter={from:'',to:'',waiter:''};
function waiterReportData(f){
  const from=f.from||reportMonthStart(), to=f.to||todayStr(), mapa={}, rows=[];
  state.sales.filter(s=>{ if(!saleCountsAsRevenue(s)) return false; const d=saleRevenueDay(s); return d>=from&&d<=to; }).forEach(s=>(s.items||[]).filter(i=>!i.canceled).forEach(i=>{
    const name=i.addedBy||s.operatorName||'—', x=mapa[name]=mapa[name]||{name,ids:new Set(),items:0,kg:0,value:0}, value=reportItemValue(i);
    x.ids.add(s.id); if(i.weight) x.kg=Math.round((x.kg+(Number(i.weight.kg)||0))*1000)/1000; else x.items+=Number(i.qty)||0; x.value+=value;
    if(!f.waiter||f.waiter===name) rows.push({at:i.addedAt||s.openedAt||s.closedAt,sale:s,customer:reportSaleWho(s),item:i.name||'—',qty:reportItemQty(i),value,name});
  }));
  const summary=Object.values(mapa).map(x=>({name:x.name,sales:x.ids.size,items:x.items,kg:x.kg,value:arredondaCentavos(x.value)})).sort((a,b)=>b.value-a.value);
  return { summary, rows:rows.sort((a,b)=>new Date(b.at)-new Date(a.at)) };
}
function applyWaiterReportFilter(){ const v=id=>document.getElementById(id); Object.assign(waiterReportFilter,{from:v('wrFrom').value,to:v('wrTo').value,waiter:v('wrWaiter').value}); renderRelatorios(); }
function pickWaiterReport(name){ waiterReportFilter.waiter=name; renderRelatorios(); }
function renderWaiterReport(){
  const f=waiterReportFilter, d=waiterReportData(f), LIMITE=3000, from=f.from||reportMonthStart(), to=f.to||todayStr();
  const nomes=[...new Set([...d.summary.map(x=>x.name),...(f.waiter?[f.waiter]:[])])].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const filtros=`<div class="field"><label for="wrFrom">De</label><input id="wrFrom" type="date" value="${h(from)}"></div><div class="field"><label for="wrTo">Até</label><input id="wrTo" type="date" value="${h(to)}"></div><div class="field"><label for="wrWaiter">Garçom</label><select id="wrWaiter"><option value="">Todos</option>${nomes.map(n=>`<option value="${h(n)}" ${n===f.waiter?'selected':''}>${h(n)}</option>`).join('')}</select></div><button class="op-btn primary" onclick="applyWaiterReportFilter()">⌕ &nbsp; Pesquisar</button>`;
  const resumo=d.summary.map(x=>`<tr><td><button type="button" class="det-link" onclick="pickWaiterReport(${jsArg(x.name)})">${h(x.name)}</button></td><td>${x.sales}</td><td>${x.items}${x.kg?' + '+fmtKg(x.kg):''}</td><td class="mono">${fmt(x.value)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhum item lançado no período.</td></tr>';
  const detalhe=f.waiter?`<h3>${h(f.waiter)}: itens lançados</h3><div class="finance-grid det-grid"><table><thead><tr><th>Data e hora</th><th>Pedido</th><th>Cliente</th><th>Item</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${d.rows.slice(0,LIMITE).map(r=>`<tr><td>${h(reportWhen(r.at))}</td><td>#${h(String(r.sale.orderNumber||r.sale.id))}</td><td>${h(r.customer)}</td><td>${h(r.item)}</td><td>${h(r.qty)}</td><td class="mono">${fmt(r.value)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">Nenhum item.</td></tr>'}</tbody></table></div>${d.rows.length>LIMITE?`<p class="sub">Mostrando ${LIMITE} de ${d.rows.length}. Exporte para ver tudo.</p>`:''}`:'<p class="sub">Clique em um nome para ver os itens lançados.</p>';
  document.getElementById('view-relatorios').innerHTML=detReportHtml('Vendas dos Garçons','exportWaiterReport()',filtros,
    `<p class="det-aviso">O valor é quantidade × preço de cada item lançado, sem desconto nem serviço. Por isso pode não bater exatamente com o faturamento.</p><div class="finance-grid det-grid"><table><thead><tr><th>Garçom</th><th>Comandas atendidas</th><th>Itens lançados</th><th>Valor vendido</th></tr></thead><tbody>${resumo}</tbody></table></div>${detalhe}`);
}
function waiterReportSheets(f){
  const d=waiterReportData(f), arr=arredondaCentavos;
  return [['Resumo',[['Garçom','Comandas atendidas','Itens lançados','Kg','Valor vendido'],...d.summary.map(x=>[x.name,x.sales,x.items,x.kg,x.value])],[26,12,12,10,14]],
    ['Itens lançados',[['Garçom','Data e hora','Pedido','Cliente','Item','Qtd.','Valor'],...d.rows.map(r=>[r.name,reportWhen(r.at),r.sale.orderNumber||r.sale.id||'',r.customer,r.item,r.qty,arr(r.value)])],[22,19,9,28,34,10,11]]];
}
async function exportWaiterReport(){
  if(typeof fetchFreshSales==='function') await fetchFreshSales();
  const f=waiterReportFilter; await exportAoaXlsx('commandah-garcons-'+(f.from||reportMonthStart())+'-a-'+(f.to||todayStr())+'.xlsx',waiterReportSheets(f));
}
