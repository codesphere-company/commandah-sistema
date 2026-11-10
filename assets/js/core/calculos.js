/* ============ CÁLCULOS DE VENDA ============
   Regras de dinheiro da venda e da comanda num lugar só (codigo-limpo, passo B). Antes o total da
   comanda estava escrito duas vezes (recomputeTotals no caixa e gcComandaTotals no garçom) e as
   regras de venda moravam no arquivo da cozinha. Só calculam: não mexem na tela nem no banco. */
function saleTotal(items){ return (items||[]).filter(i=>!i.canceled).reduce((a,i)=>a+i.price*i.qty,0); }
/* Único lugar que decide se uma venda entra em relatório/faturamento: fechada, não cancelada
   como delivery (deliveryStatus) e não cancelada como comanda inteira (s.canceled, ver
   confirmCancelComanda). Todo relatório novo deve usar isto em vez de repetir a condição. */
function saleCountsAsRevenue(s){ return !!s && s.status==='closed' && s.deliveryStatus!=='cancelado' && !s.canceled; }
// 10/11 (pedido do dono): o faturamento de uma venda é do dia do pagamento, ou seja, do dia em que ela fechou
// (comanda aberta à noite e paga no dia seguinte conta no dia seguinte). Comanda ainda aberta não tem
// closedAt e continua no dia em que abriu, como "a receber". O fechamento de caixa (OP-14) não usa esta regra.
function saleRevenueDay(s){ return localDay(s.closedAt||s.openedAt); }
// Rótulo da linha do desconto do colaborador, igual no caixa, no pagamento e no garçom.
function staffDiscountLabel(pct){ return 'Desconto colaborador ('+String(pct).replace('.',',')+'%)'; }
// Total da comanda, igual no caixa, no garçom e no painel. Ordem: cupom; crédito do sócio (até o que
// falta pagar); serviço sobre o que sobrou; menos o parcial já pago; mais a pendência anterior.
// Crédito e serviço são arredondados para centavos antes de somar, então o total é a soma das linhas
// mostradas. applyService: o caixa pode tirar o serviço. includeDebt: cobrar a pendência junto.
// Desconto do colaborador (D2, 08/11, pedido do dono): comanda de cliente do tipo Colaborador tem
// descontoColaborador() % (padrão 20) sobre o consumo, sozinho, antes de cupom/crédito/serviço. Só vale
// em comanda: quem calcula comanda passa applyStaffDiscount:true (padrão false). A dívida do colaborador
// não entra no total (é descontada do salário, não cobrada na comanda).
function comandaTotals({ subtotal, discount = 0, partialPaid = 0, member = null, applyService = true, includeDebt = true, applyStaffDiscount = false }){
  const colaborador = applyStaffDiscount && memberIsColaborador(member);
  const staffDiscountPct = colaborador ? descontoColaborador() : 0;
  const staffDiscount = colaborador ? arredondaCentavos(subtotal * staffDiscountPct / 100) : 0;
  const afterCoupon = Math.max(0, subtotal - staffDiscount - discount);
  const available = memberAvailableCredit(member);
  const creditApplied = available > TOLERANCIA_CENTAVO ? arredondaCentavos(Math.min(available, Math.max(0, afterCoupon - partialPaid))) : 0;
  const afterCredit = Math.max(0, afterCoupon - creditApplied);
  const service = applyService ? arredondaCentavos(serviceChargeAmount(afterCredit)) : 0;
  const debt = includeDebt && !memberIsColaborador(member) ? memberDebtDue(member) : 0;
  const total = arredondaCentavos(Math.max(0, afterCredit + service - partialPaid) + debt);
  return { staffDiscount, staffDiscountPct, afterCoupon, available, creditApplied, afterCredit, service, debt, total };
}
// Quanto falta pagar na comanda aberta, igual ao total que ela mostra (desconto do colaborador,
// crédito e serviço), sem a pendência anterior. Teto do pagamento parcial e conferência de
// transferência (fix D2, 08/11): antes era saleTotal(itens) - parciais e passava do total com desconto.
// items: lista a usar no lugar de s.items (rascunho aberto na tela).
function comandaOpenDue(s, items){
  const member = s && s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  return comandaTotals({ subtotal: arredondaCentavos(saleTotal(items||(s&&s.items))), partialPaid: comandaPartialPaid(s), member, applyService: serviceRatePct()>0, includeDebt: false, applyStaffDiscount: true }).total;
}
