/* ============ RELATÓRIOS DETALHADOS: PEÇAS COMUNS ============ */
// 10/11 (pedido da Vanessa): cartão de venda com itens, moldura da tela e exportação em .xlsx, usados
// por Conta do Cliente, Relatório de Vendas, Vendas dos Garçons e Cupons Fiscais. Dado antigo ou
// incompleto aparece como "—": nunca "undefined" nem "Invalid Date".
function reportValidDate(v){ return !!v && !isNaN(new Date(v).getTime()); }
function reportWhen(v){ return reportValidDate(v)?dataHoraBR(v):'—'; }
function reportDateOnly(v){ return reportValidDate(v)?new Date(v).toLocaleDateString('pt-BR'):'—'; }
function reportItemValue(i){ return (Number(i.qty)||0)*(Number(i.price)||0); }
function reportItemQty(i){ return i.weight?fmtKg(i.weight.kg):String(Number(i.qty)||0); }
function reportSaleWho(s){ const m=s.memberId?state.members.find(x=>x.id===s.memberId):null; return m?m.name:(s.customerName||'Avulso'); }
function reportSalePayments(s){ return (s.payments||[]).map(p=>paymentMethodLabel(p.method)+' '+fmt(p.amount)).join(' + ')||'—'; }
function salePayIsFiado(p){ return methodBucket(normalizarMetodo(p.method))==='fiado'; }
function reportItemDetails(i, sale){
  const c=i.customization||{}, linhas=customizationLines(i).slice(), obs=c.v===2?c.notes:(i.notes||c.notes);
  if(obs) linhas.push('Obs.: '+obs);
  const quem=i.addedBy||sale.operatorName;
  if(quem) linhas.push('Lançado por '+quem+(reportValidDate(i.addedAt)?' às '+timeFmt(i.addedAt):''));
  if(i.canceled) linhas.push('Cancelado'+(i.canceledBy?' por '+i.canceledBy:'')+(reportValidDate(i.canceledAt)?' às '+timeFmt(i.canceledAt):'')+(i.canceledReason?' · '+i.canceledReason:''));
  return linhas;
}
function saleCardHtml(sale, opts){
  const o=opts||{}, items=sale.items||[], when=sale.closedAt||sale.openedAt;
  const extras=[['Desconto',-(Number(sale.discount)||0)],['Desconto colaborador',-(Number(sale.staffDiscount)||0)],['Crédito usado',-(Number(sale.creditApplied)||0)],['Serviço',Number(sale.serviceCharge)||0]].filter(x=>Math.abs(x[1])>=0.005);
  const titulo=[reportWhen(when), (typeLabel(sale.type)||'Pedido')+' #'+(sale.orderNumber||sale.id||'—')].concat(o.showCustomer?[reportSaleWho(sale)]:[]).join(' · ');
  const linhas=items.map(i=>`<li class="${i.canceled?'canceled':''}"><span>${h(reportItemQty(i))} × ${h(i.name||'—')}${reportItemDetails(i,sale).map(l=>`<small>${h(l)}</small>`).join('')}</span><span class="mono">${fmt(reportItemValue(i))}</span></li>`).join('')||'<li class="sub">Sem itens registrados.</li>';
  return `<article class="det-sale"><header><b>${h(titulo)}${sale.canceled?' <span class="tag tag-red">Cancelada</span>':''}<span class="det-tag">${h(reportSalePayments(sale))}</span></b><b class="mono">${fmt(Number(sale.total)||0)}</b></header><ul>${linhas}${extras.map(x=>`<li class="det-sale-extra"><span>${h(x[0])}</span><span class="mono">${fmt(x[1])}</span></li>`).join('')}</ul></article>`;
}
function detStatsHtml(lista){ return `<div class="det-stats">${lista.map(([l,v])=>`<div class="stat"><div class="lbl">${h(l)}</div><div class="val">${h(String(v))}</div></div>`).join('')}</div>`; }
// exportCall é código fixo escrito aqui nos relatórios, nunca dado do usuário.
function detReportHtml(title, exportCall, filtros, corpo){
  return `<section class="det-report"><div class="det-report-head"><h2>${h(title)}</h2><div class="det-report-actions"><button class="op-btn" onclick="window.print()">▣ &nbsp; Imprimir</button>${exportCall?`<button class="op-btn" onclick="${exportCall}">▧ &nbsp; Exportar Excel</button>`:''}</div></div>${filtros?`<div class="det-filtros">${filtros}</div>`:''}${corpo}</section>`;
}
// sheets: [[nome, linhas, larguras], ...]. Traz sempre todas as linhas filtradas.
async function exportAoaXlsx(fileName, sheets){
  try{
    const XLSX=await loadXlsx(), wb=XLSX.utils.book_new();
    sheets.forEach(([nome,linhas,larguras])=>{ const ws=XLSX.utils.aoa_to_sheet(linhas); ws['!cols']=(larguras||[]).map(w=>({wch:w})); XLSX.utils.book_append_sheet(wb,ws,nome); });
    XLSX.writeFile(wb,fileName); toast('Planilha gerada.');
  }catch(e){ console.error(e); toast('Não foi possível gerar: '+(e.message||e),'error'); }
}
