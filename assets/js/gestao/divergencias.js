/* ============ VENDAS COM DIVERGÊNCIA E RECUSAS DO BANCO ============ */
// Item 4 (auditoria 11/11): o banco confere a venda fechada com o cadastro. Divergente e com o ajuste
// "Recusar venda que não bate com o cadastro" desligado (padrão), a venda grava com data.conferencia =
// { em, divergencias:[{codigo,item,esperado,recebido}] }; ligado, o banco recusa (erro venda_divergente).
// Este arquivo traz os textos das recusas e o relatório Relatórios › Vendas › Vendas com divergência.
const DIVERGENCIA_TEXTO = {
  preco_abaixo:'Item abaixo do preço do cadastro',
  produto_desconhecido:'Item que não está no cadastro',
  subtotal:'Soma dos itens diferente do subtotal',
  cupom:'Desconto sem cupom válido',
  desconto_colaborador:'Desconto de colaborador indevido',
  credito:'Crédito maior que o do cliente',
  pagamento_abaixo:'Pagamento menor que o total'
};
// d.item vem do banco como lineId ou nome; com a venda (opcional) troca o lineId pelo nome do item.
function motivoDivergencia(d, sale){
  d = d || {};
  let txt = DIVERGENCIA_TEXTO[d.codigo] || ('Divergência: '+String(d.codigo||'desconhecida'));
  if(d.item!=null && d.item!==''){
    let nome = String(d.item);
    const it = sale && (sale.items||[]).find(i=>i && i.lineId===d.item);
    if(it && it.name) nome = it.name;
    txt += ' ('+nome+')';
  }
  if(d.esperado!=null && d.recebido!=null && d.esperado!=='' && d.recebido!=='') txt += ' — esperado '+fmt(Number(d.esperado)||0)+', veio '+fmt(Number(d.recebido)||0);
  return txt;
}
function divergenciasDoErro(err){
  const bruto = err && (err.details||err.detail);
  if(!bruto) return [];
  try{ const l = typeof bruto==='string' ? JSON.parse(bruto) : bruto; return Array.isArray(l) ? l : []; }catch(e){ return []; }
}
// sale (opcional, com items) troca o lineId do motivo pelo nome do item. null quando o erro não é de conferência nem de permissão (quem chama mostra a mensagem genérica).
function textoRecusaVenda(err, sale){
  const msg = String((err && err.message) || '');
  if(msg.includes('venda_divergente')){
    const motivos = divergenciasDoErro(err).map(d=>motivoDivergencia(d, sale));
    return 'Venda recusada: não bate com o cadastro. Confira os itens e o pagamento.'+(motivos.length?' '+motivos.join('; ')+'.':'');
  }
  if(msg.includes('sem permissao para cancelar')) return 'Você não tem permissão para cancelar item ou comanda.';
  if(msg.includes('sem permissao para receber fiado')) return 'Você não tem permissão para receber fiado.';
  return null;
}
const divergenciasFiltro = { from:'', to:'' };
function divergenciasPeriodo(){ return { from:divergenciasFiltro.from||todayStr(), to:divergenciasFiltro.to||todayStr() }; }
function vendasComDivergencia(){
  const p = divergenciasPeriodo();
  return (state.sales||[]).filter(s=>{
    if(!s || !s.conferencia) return false;
    const dia = reportDate(s.closedAt||s.conferencia.em||s.openedAt);
    return dia>=p.from && dia<=p.to;
  }).sort((a,b)=>new Date(b.closedAt||b.conferencia.em||0)-new Date(a.closedAt||a.conferencia.em||0));
}
function aplicarFiltroDivergencias(){
  const de=document.getElementById('dvFrom'), ate=document.getElementById('dvTo');
  divergenciasFiltro.from = de?de.value:''; divergenciasFiltro.to = ate?ate.value:'';
  renderVendasDivergentes();
}
function renderVendasDivergentes(el){
  el = el || document.getElementById('view-relatorios'); if(!el) return;
  const p = divergenciasPeriodo(), lista = vendasComDivergencia();
  const filtros = `<div class="field"><label for="dvFrom">De</label><input id="dvFrom" type="date" value="${h(p.from)}"></div><div class="field"><label for="dvTo">Até</label><input id="dvTo" type="date" value="${h(p.to)}"></div><button class="op-btn primary" onclick="aplicarFiltroDivergencias()">⌕ &nbsp; Pesquisar</button>`;
  const linhas = lista.map(s=>{
    const motivos = ((s.conferencia||{}).divergencias||[]).map(d=>`<li>${h(motivoDivergencia(d,s))}</li>`).join('');
    return `<tr data-divergente="${h(s.id)}" onclick="openOrderHistoryDetail(${jsArg(s.id)})" style="cursor:pointer"><td>${h(reportWhen(s.closedAt||s.conferencia.em))}</td><td>#${h(String(s.orderNumber||s.id))}</td><td>${h(s.operatorName||'—')}</td><td class="mono">${fmt(s.total)}</td><td style="min-width:280px"><ul class="det-motivos" style="margin:0;padding-left:16px">${motivos||'<li>—</li>'}</ul></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">Nenhuma venda com divergência nesse período.</td></tr>';
  el.innerHTML = detReportHtml('Vendas com divergência','',filtros,
    '<p class="sub">Vendas gravadas com algo que não bate com o cadastro (preço, desconto, crédito, pagamento). Toque na linha para abrir o pedido.</p>'+
    detStatsHtml([['Vendas com divergência',lista.length],['Valor total',fmt(lista.reduce((a,s)=>a+(Number(s.total)||0),0))]])+
    `<div class="finance-grid det-grid"><table><thead><tr><th>Data e hora</th><th>Pedido</th><th>Colaborador</th><th>Total</th><th>Motivos</th></tr></thead><tbody>${linhas}</tbody></table></div>`);
}
