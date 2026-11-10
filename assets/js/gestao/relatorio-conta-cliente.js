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
  const f=customerAccountFilter, d=customerAccountRows(f);
  const filtros=`<div class="field"><label for="caSearch">Buscar por nome ou cota</label><input id="caSearch" value="${h(f.search)}" onkeydown="if(event.key==='Enter')applyCustomerAccountFilter()"></div><div class="field det-campo-curto"><label for="caDays">Dias em aberto</label><input id="caDays" type="number" min="0" value="${f.days}" onchange="applyCustomerAccountFilter()"></div><label class="det-check"><input id="caOnly" type="checkbox" ${f.onlyDebtors?'checked':''} onchange="applyCustomerAccountFilter()"> Só quem deve</label><label class="det-check"><input id="caArch" type="checkbox" ${f.includeArchived?'checked':''} onchange="applyCustomerAccountFilter()"> Incluir arquivados</label><button class="op-btn primary" onclick="applyCustomerAccountFilter()">⌕ &nbsp; Pesquisar</button>`;
  const linhas=d.rows.map(r=>`<tr><td>${h(r.m.name||'—')}${r.m.archived?' <span class="tag">Arquivado</span>':''}</td><td>${h(r.m.code||'—')}</td><td class="mono">${fmt(r.debt)}</td><td>${reportDateOnly(r.lastPurchase)}</td><td>${reportDateOnly(r.lastPayment)}</td><td>${reportDateOnly(r.oldest)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">Nenhum cliente encontrado.</td></tr>';
  document.getElementById('view-relatorios').innerHTML=detReportHtml('Conta do Cliente','exportCustomerAccountReport()',filtros,
    detStatsHtml([['Clientes devendo',d.debtors],['Total em aberto',fmt(d.total)],['Devendo há mais de '+f.days+' dias',d.overdueCount]])+
    `<div class="finance-grid det-grid"><table><thead><tr><th>Cliente</th><th>Cota</th><th>Saldo devedor</th><th>Última compra</th><th>Último pagamento</th><th>Devendo desde</th></tr></thead><tbody>${linhas}</tbody></table></div>`);
}
async function exportCustomerAccountReport(){
  if(typeof fetchFreshSales==='function') await fetchFreshSales();
  const d=customerAccountRows(customerAccountFilter), dt=v=>reportValidDate(v)?reportDateOnly(v):'';
  await exportAoaXlsx('commandah-clientes-devedores-'+todayStr()+'.xlsx',[['Clientes',[['Cliente','Cota','Telefone','Saldo devedor','Última compra','Último pagamento','Devendo desde','Dias em aberto'],...d.rows.map(r=>[r.m.name||'',r.m.code||'',r.m.phone||'',arredondaCentavos(r.debt),dt(r.lastPurchase),dt(r.lastPayment),dt(r.oldest),r.oldest?r.days:''])],[32,8,16,14,14,16,14,10]]]);
}
