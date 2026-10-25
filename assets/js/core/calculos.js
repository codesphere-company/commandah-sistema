/* ============ CÁLCULOS DE VENDA ============
   Regras de dinheiro da venda e da comanda num lugar só (codigo-limpo, passo B). Antes o total da
   comanda estava escrito duas vezes (recomputeTotals no caixa e gcComandaTotals no garçom) e as
   regras de venda moravam no arquivo da cozinha. Só calculam: não mexem na tela nem no banco. */
function saleTotal(items){ return (items||[]).filter(i=>!i.canceled).reduce((a,i)=>a+i.price*i.qty,0); }
/* Único lugar que decide se uma venda entra em relatório/faturamento: fechada, não cancelada
   como delivery (deliveryStatus) e não cancelada como comanda inteira (s.canceled, ver
   confirmCancelComanda). Todo relatório novo deve usar isto em vez de repetir a condição. */
function saleCountsAsRevenue(s){ return !!s && s.status==='closed' && s.deliveryStatus!=='cancelado' && !s.canceled; }
// OP-14: o faturamento de uma venda é do dia em que ela abriu (comanda aberta à noite e paga no dia
// seguinte conta no dia da abertura). Recebimentos (formas de pagamento, caixa) seguem pela data do pagamento.
function saleRevenueDay(s){ return localDay(s.openedAt||s.closedAt); }
// Total da comanda, igual no caixa, no garçom e no painel. Ordem: cupom; crédito do sócio (até o que
// falta pagar); serviço sobre o que sobrou; menos o parcial já pago; mais a pendência anterior.
// Crédito e serviço são arredondados para centavos antes de somar, então o total é a soma das linhas
// mostradas. applyService: o caixa pode tirar o serviço. includeDebt: cobrar a pendência junto.
function comandaTotals({ subtotal, discount = 0, partialPaid = 0, member = null, applyService = true, includeDebt = true }){
  const afterCoupon = Math.max(0, subtotal - discount);
  const available = memberAvailableCredit(member);
  const creditApplied = available > TOLERANCIA_CENTAVO ? arredondaCentavos(Math.min(available, Math.max(0, afterCoupon - partialPaid))) : 0;
  const afterCredit = Math.max(0, afterCoupon - creditApplied);
  const service = applyService ? arredondaCentavos(serviceChargeAmount(afterCredit)) : 0;
  const debt = includeDebt ? memberDebtDue(member) : 0;
  const total = arredondaCentavos(Math.max(0, afterCredit + service - partialPaid) + debt);
  return { afterCoupon, available, creditApplied, afterCredit, service, debt, total };
}
