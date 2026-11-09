/* ============ CONFERÊNCIA DE PAGAMENTOS ============
   09/11 (pedido do dono): o escritório confere, contra o extrato, o que entrou por Pix, cartão e vale.
   Lista os pagamentos das formas "Administrador confere" (vendas, parciais e recebimentos de fiado) e deixa
   marcar cada um como Confirmado ou Não recebido. A marcação fica em payment_checks (RPC payment_checks_apply,
   que também grava no log) e é só um registro: não muda venda, caixa nem fiado.
   Sem linha em payment_checks = "A conferir". */
const CONF_SITUACOES = { a_conferir:'A conferir', confirmado:'Confirmado', nao_recebido:'Não recebido' };
const confEstado = { de:'', ate:'', forma:'', situacao:'', debitos:[], marcas:{}, carregadoDe:'', carregadoAte:'', carregando:false, erro:'', selecao:new Set(), pendente:[] };

// Chave estável do pagamento. "Reabrir e fechar de novo" gera pagamentos novos: cada reabertura soma 1000 ao
// índice, para a marca do pagamento antigo não valer para o novo (volta a "A conferir").
function chaveDoPagamento(sale, p, indiceEntreIguais){
  if(p && p.partialId) return 'parcial:'+p.partialId;
  const reaberturas = Array.isArray(sale.reopenHistory) ? sale.reopenHistory.length : 0;
  return 'venda:'+sale.id+':'+p.method+':'+((Number(indiceEntreIguais)||0) + reaberturas*1000);
}
// Forma "Administrador confere"? Método antigo sem forma (cartao, outro:Nome) entra, para o escritório ver tudo;
// dinheiro, fiado e salário nunca.
function conferenciaConfere(method){
  const m = normalizarMetodo(method);
  if(m==='dinheiro' || m==='fiado' || m==='salario' || !m) return false;
  const f = formaPorMetodo(m) || formaPorMetodo(method);
  if(f) return f.confere==='admin' && f.tipo!=='dinheiro' && f.tipo!=='fiado';
  return true;
}
function conferenciaPadraoDePeriodo(){
  if(!confEstado.ate) confEstado.ate = todayStr();
  if(!confEstado.de) confEstado.de = localDay(new Date(Date.now()-6*86400000));
}
// Todos os pagamentos do período (sem filtro de forma e situação).
function conferenciaLinhasDoPeriodo(){
  const de = confEstado.de, ate = confEstado.ate, linhas = [];
  const dentro = at => { const d = localDay(at); return !!d && d>=de && d<=ate; };
  (state.sales||[]).forEach(sl=>{
    if(!saleCountsAsRevenue(sl)) return;
    const contagem = {};
    (sl.payments||[]).forEach(p=>{
      const i = contagem[p.method] = (contagem[p.method]===undefined ? 0 : contagem[p.method]+1);
      const valor = Math.round((Number(p.amount)||0)*100)/100;
      if(p.reversed || valor<=0 || !conferenciaConfere(p.method)) return;
      const at = p.at || sl.closedAt || sl.openedAt;
      if(!dentro(at)) return;
      linhas.push({ chave:chaveDoPagamento(sl,p,i), at, valor, method:normalizarMetodo(p.method), forma:methodLabel(p.method), origem:'Comanda #'+(sl.orderNumber||sl.id), quem:p.who||sl.operatorName||'' });
    });
  });
  (confEstado.debitos||[]).forEach(e=>{
    const valor = Math.round((Number(e.value)||0)*100)/100;
    if(e.reversed || e.type!=='payment' || e.sale_id || valor<=0 || !conferenciaConfere(e.method) || !dentro(e.at)) return;
    const m = (state.members||[]).find(x=>x.id===e.member_id);
    linhas.push({ chave:'fiado:'+e.id, at:e.at, valor, method:normalizarMetodo(e.method), forma:methodLabel(e.method), origem:'Fiado — '+(m?m.name:'cliente'), quem:e.created_by||'' });
  });
  return linhas.sort((a,b)=>new Date(b.at)-new Date(a.at));
}
function conferenciaSituacao(chave){ const m = confEstado.marcas[chave]; return m ? m.status : 'a_conferir'; }
function conferenciaLinhasFiltradas(){
  return conferenciaLinhasDoPeriodo().filter(l=>(!confEstado.forma || l.method===confEstado.forma) && (!confEstado.situacao || conferenciaSituacao(l.chave)===confEstado.situacao));
}
// Planilha da lista filtrada (cabeçalho + uma linha por pagamento).
function conferenciaPlanilha(){
  const rows = [['Data','Hora','Valor','Forma','Origem','Lançado por','Situação','Observação']];
  conferenciaLinhasFiltradas().forEach(l=>{
    const d = new Date(l.at), mk = confEstado.marcas[l.chave];
    rows.push([localDay(l.at).split('-').reverse().join('/'), d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}), l.valor, l.forma, l.origem, l.quem, CONF_SITUACOES[conferenciaSituacao(l.chave)], mk&&mk.note?mk.note:'']);
  });
  return rows;
}
async function conferenciaCarregar(){
  if(!(typeof isCloudMode==='function' && isCloudMode() && supabaseClient)) return;
  const de = confEstado.de, ate = confEstado.ate;
  confEstado.carregando = true; confEstado.erro = '';
  try{
    const inicio = new Date(de+'T00:00:00').toISOString(), fim = new Date(new Date(ate+'T00:00:00').getTime()+86400000).toISOString();
    const [debitos, marcas] = await Promise.all([
      fetchAllRows(()=>supabaseClient.from('member_debt_entries').select('id,member_id,type,value,method,at,created_by,reversed,sale_id').eq('type','payment').is('sale_id',null).neq('method','salario').gte('at',inicio).lt('at',fim).order('at',{ascending:false}).order('id')),
      fetchAllRows(()=>supabaseClient.from('payment_checks').select('payment_key,status,note,checked_by,checked_at').order('payment_key'))
    ]);
    // Se o período mudou enquanto carregava, descarta: a tela pede de novo.
    if(confEstado.de===de && confEstado.ate===ate){
      confEstado.debitos = debitos;
      confEstado.marcas = {}; marcas.forEach(m=>{ confEstado.marcas[m.payment_key] = { status:m.status, note:m.note||'', by:m.checked_by||'', at:m.checked_at }; });
      confEstado.carregadoDe = de; confEstado.carregadoAte = ate;
    }
  }catch(e){ confEstado.erro = 'Não foi possível carregar: '+(e.message||'erro'); }
  confEstado.carregando = false;
}
function renderConferencia(el){
  el = el || document.getElementById('view-conferencia'); if(!el) return;
  if(!hasPerm('conferir-pagamentos')){ el.innerHTML = '<p class="empty">Só o administrador confere pagamentos.</p>'; return; }
  conferenciaPadraoDePeriodo();
  const nuvem = typeof isCloudMode==='function' && isCloudMode() && supabaseClient;
  const precisa = nuvem && !confEstado.carregando && (confEstado.carregadoDe!==confEstado.de || confEstado.carregadoAte!==confEstado.ate) && !confEstado.erro;
  if(precisa){
    confEstado.carregando = true;
    conferenciaCarregar().then(()=>{ if(activeView==='conferencia') renderConferencia(document.getElementById('view-conferencia')); });
  }
  conferenciaDesenhar(el, nuvem);
}
function conferenciaDesenhar(el, nuvem){
  const todas = conferenciaLinhasDoPeriodo(), linhas = conferenciaLinhasFiltradas();
  const formas = []; todas.forEach(l=>{ if(!formas.some(f=>f.method===l.method)) formas.push({ method:l.method, forma:l.forma }); });
  const totais = {}; linhas.forEach(l=>{ const t = totais[l.forma] = totais[l.forma]||{ valor:0, n:0 }; t.valor += l.valor; t.n++; });
  const totalGeral = linhas.reduce((a,l)=>a+l.valor,0);
  const vendas = (state.sales||[]).filter(s=>s.openedAt||s.closedAt).map(s=>localDay(s.closedAt||s.openedAt)).sort();
  const maisAntiga = vendas[0];
  const aviso = (vendas.length && confEstado.de < maisAntiga)
    ? `<p class="conf-aviso">As vendas carregadas neste aparelho começam em ${h(maisAntiga.split('-').reverse().join('/'))}. Pagamentos de vendas anteriores a essa data podem não aparecer.</p>` : '';
  const linhasHtml = linhas.map(l=>{
    const d = new Date(l.at), sit = conferenciaSituacao(l.chave), mk = confEstado.marcas[l.chave];
    const nota = mk && mk.note ? `<span class="conf-nota" title="${h(mk.note)}">${h(mk.note)}</span>` : '';
    return `<tr data-chave="${h(l.chave)}" data-valor="${l.valor}" data-forma="${h(l.forma)}"><td><input type="checkbox" class="conf-sel" aria-label="Selecionar" ${confEstado.selecao.has(l.chave)?'checked':''} onchange="conferenciaSelecionar(this)"></td><td>${h(localDay(l.at).split('-').reverse().join('/'))}</td><td>${h(d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))}</td><td>${fmt(l.valor)}</td><td>${h(l.forma)}</td><td>${h(l.origem)}</td><td>${h(l.quem)}</td><td><span class="conf-situacao conf-s-${sit}">${h(CONF_SITUACOES[sit])}</span>${nota}</td></tr>`;
  }).join('');
  const totaisHtml = Object.keys(totais).map(f=>`<div class="conf-total"><span>${h(f)}</span><b>${fmt(totais[f].valor)}</b><small>${totais[f].n} pagamento${totais[f].n===1?'':'s'}</small></div>`).join('');
  const opcoesForma = `<option value="">Todas</option>`+formas.map(f=>`<option value="${h(f.method)}" ${confEstado.forma===f.method?'selected':''}>${h(f.forma)}</option>`).join('');
  const opcoesSit = `<option value="">Todas</option>`+Object.keys(CONF_SITUACOES).map(k=>`<option value="${k==='a_conferir'?'a_conferir':k}" ${confEstado.situacao===k?'selected':''}>${h(CONF_SITUACOES[k])}</option>`).join('');
  el.innerHTML = `<section class="finance-page conf-page">
    <div class="finance-top conf-top">
      <label>De <input type="date" id="confDe" value="${h(confEstado.de)}" onchange="conferenciaFiltro('de',this.value)"></label>
      <label>Até <input type="date" id="confAte" value="${h(confEstado.ate)}" onchange="conferenciaFiltro('ate',this.value)"></label>
      <label>Forma <select id="confForma" onchange="conferenciaFiltro('forma',this.value)">${opcoesForma}</select></label>
      <label>Situação <select id="confSituacao" onchange="conferenciaFiltro('situacao',this.value)">${opcoesSit}</select></label>
      <div class="finance-actions"><button class="op-btn" onclick="conferenciaExportar()">⇩ &nbsp; Exportar planilha</button></div>
    </div>
    ${aviso}
    ${confEstado.erro?`<p class="conf-aviso">${h(confEstado.erro)}</p>`:''}
    ${nuvem?'':'<p class="conf-aviso">A conferência só funciona com o sistema conectado à nuvem.</p>'}
    <div class="conf-totais">${totaisHtml || '<span class="sub">Nenhum pagamento no período.</span>'}${linhas.length?`<div class="conf-total conf-total-geral"><span>Total</span><b>${fmt(totalGeral)}</b><small>${linhas.length} pagamento${linhas.length===1?'':'s'}</small></div>`:''}</div>
    <div class="conf-acoes">
      <button class="op-btn primary" id="confBtnConfirmar" onclick="conferenciaConfirmar()">✓ &nbsp; Confirmar selecionados</button>
      <button class="op-btn" id="confBtnNaoRecebido" onclick="conferenciaPedirNota()">✕ &nbsp; Marcar como não recebido</button>
      <button class="op-btn" id="confBtnVoltar" onclick="conferenciaVoltar()">↩ &nbsp; Voltar para a conferir</button>
      <span class="sub" id="confContagem">${confEstado.selecao.size} selecionado(s)</span>
    </div>
    <div class="finance-grid conf-grid"><table><thead><tr><th><input type="checkbox" aria-label="Selecionar todos" onchange="conferenciaSelecionarTodos(this.checked)"></th><th>Data</th><th>Hora</th><th>Valor</th><th>Forma</th><th>Comanda ou cliente</th><th>Lançado por</th><th>Situação</th></tr></thead><tbody>${linhasHtml||`<tr><td colspan="8" class="empty">${confEstado.carregando?'Carregando…':'Nenhum pagamento para mostrar.'}</td></tr>`}</tbody></table></div>
    <footer class="op-footer"><span>Pagamentos=${linhas.length}</span><span>Só registro de conferência: não altera venda, caixa nem fiado.</span></footer>
  </section>`;
}
function conferenciaFiltro(campo, valor){
  confEstado[campo] = valor; confEstado.erro = '';
  if((campo==='de' || campo==='ate') && confEstado.de && confEstado.ate && confEstado.de>confEstado.ate){
    toast('A data inicial não pode ser depois da final.');
    if(campo==='de') confEstado.de = confEstado.ate; else confEstado.ate = confEstado.de;
  }
  if(!confEstado.de || !confEstado.ate){ confEstado.de = confEstado.de || ''; confEstado.ate = confEstado.ate || ''; conferenciaPadraoDePeriodo(); }
  confEstado.selecao = new Set();
  renderConferencia();
}
function conferenciaSelecionar(box){
  const chave = box.closest('tr').dataset.chave;
  if(box.checked) confEstado.selecao.add(chave); else confEstado.selecao.delete(chave);
  const c = document.getElementById('confContagem'); if(c) c.textContent = confEstado.selecao.size+' selecionado(s)';
}
function conferenciaSelecionarTodos(marcado){
  confEstado.selecao = new Set(marcado ? conferenciaLinhasFiltradas().map(l=>l.chave) : []);
  renderConferencia();
}
// As chaves marcadas na tela (a seleção só vale para o que está na lista filtrada).
function conferenciaChavesMarcadas(){
  const visiveis = new Set(conferenciaLinhasFiltradas().map(l=>l.chave));
  return [...confEstado.selecao].filter(k=>visiveis.has(k));
}
const conferenciaAplicar = singleFlight('conferencia', async function(status, nota, chaves){
  if(!requirePerm('conferir-pagamentos')) return;
  if(!chaves.length){ toast('Marque ao menos um pagamento.'); return; }
  if(status==='nao_recebido' && !String(nota||'').trim()){ toast('Informe a observação: o que aconteceu com esse pagamento.'); return; }
  let feitos = 0;
  for(let i=0; i<chaves.length; i+=500){
    const lote = chaves.slice(i, i+500);
    const { data, error } = await supabaseClient.rpc('payment_checks_apply', { p_keys:lote, p_status:status, p_note:status==='nao_recebido'?String(nota).trim():null, p_by:currentUser?currentUser.name:'' });
    if(error){ toast('Não foi possível gravar a conferência: '+(error.message||'erro')+(feitos?' ('+feitos+' já gravado(s))':''), 'error'); break; }
    feitos += Number(data&&data.n)||lote.length;
    lote.forEach(k=>{ if(status==='a_conferir') delete confEstado.marcas[k]; else confEstado.marcas[k] = { status, note:status==='nao_recebido'?String(nota).trim():'', by:currentUser?currentUser.name:'', at:new Date().toISOString() }; });
  }
  confEstado.selecao = new Set();
  renderConferencia();
  if(feitos) toast(feitos+' pagamento(s) '+(status==='confirmado'?'confirmado(s)':status==='nao_recebido'?'marcado(s) como não recebido':'de volta para conferir')+'.');
});
function conferenciaConfirmar(){ conferenciaAplicar('confirmado', '', conferenciaChavesMarcadas()); }
function conferenciaVoltar(){ conferenciaAplicar('a_conferir', '', conferenciaChavesMarcadas()); }
function conferenciaPedirNota(){
  const chaves = conferenciaChavesMarcadas();
  if(!chaves.length){ toast('Marque ao menos um pagamento.'); return; }
  confEstado.pendente = chaves;
  openModal('Marcar como não recebido', `<div class="field"><label for="confNota">Observação (obrigatória)</label><textarea id="confNota" rows="3" maxlength="300" placeholder="Ex.: não apareceu no extrato do dia"></textarea></div><p class="sub">${chaves.length} pagamento(s). É só um registro: a venda, o caixa e o fiado não mudam.</p><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" id="confNotaOk" onclick="conferenciaNaoRecebido()">✓ Marcar</button></div>`);
  setTimeout(()=>{ const n = document.getElementById('confNota'); if(n) n.focus(); }, 50);
}
async function conferenciaNaoRecebido(){
  const nota = (document.getElementById('confNota')||{}).value || '';
  if(!nota.trim()){ toast('Informe a observação: o que aconteceu com esse pagamento.'); return; }
  closeModal();
  await conferenciaAplicar('nao_recebido', nota, confEstado.pendente);
}
async function conferenciaExportar(){
  try{
    const XL = await loadXlsx(), wb = XL.utils.book_new(), ws = XL.utils.aoa_to_sheet(conferenciaPlanilha());
    ws['!cols'] = [12,8,12,18,26,18,14,30].map(w=>({wch:w}));
    XL.utils.book_append_sheet(wb, ws, 'Conferência');
    XL.writeFile(wb, 'conferencia-'+confEstado.de+'-a-'+confEstado.ate+'.xlsx');
  }catch(e){ toast('Não foi possível gerar a planilha: '+(e.message||'erro'), 'error'); }
}
