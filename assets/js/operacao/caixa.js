/* ============ CAIXA ============ */
// UX P3 (06/11): "Caixa de caio caixa" — o nome do operador aparecia em minúsculas; agora como foi cadastrado.
let selectedCashMovementId=null;
function selectCashMovement(id){selectedCashMovementId=id;document.querySelectorAll('[data-cash-movement]').forEach(row=>row.classList.toggle('selected',row.dataset.cashMovement===id));const edit=document.getElementById('cashEditMovement'),del=document.getElementById('cashDeleteMovement');if(edit)edit.disabled=!id;if(del)del.disabled=!id;}
async function deleteSelectedCashMovement(){if(!selectedCashMovementId)return;const movement=state.cashMovements.find(x=>x.id===selectedCashMovementId);if(!movement||movement.cashSessionId!==state.cashSession?.id){toast('Selecione um lançamento manual deste caixa.');return;}if(!cashMovementEditable(movement))return;if(!await confirmarAcao('Excluir este lançamento do caixa?'))return;state.cashMovements=state.cashMovements.filter(x=>x.id!==selectedCashMovementId);save('cashMovements');logAction('Lançamento de caixa excluído — '+fmt(movement.amount));selectedCashMovementId=null;renderAll();toast('Lançamento excluído.');}
function enhanceCashMovementGrid(){
  const view=document.getElementById('view-caixa');if(!view||!state.cashSession)return;
  const rows=[...view.querySelectorAll('.cash-movement-table tbody tr')],movements=state.cashMovements.filter(m=>m.cashSessionId===state.cashSession.id);
  rows.forEach(row=>{const description=row.cells&&row.cells[1]&&row.cells[1].textContent||'',date=row.cells&&row.cells[0]&&row.cells[0].textContent||'';const movement=movements.find(m=>description.includes(m.description||m.reason||'')&&dataHoraBR(m.at)===date);if(!movement)return;row.dataset.cashMovement=movement.id;row.onclick=()=>selectCashMovement(movement.id);row.ondblclick=()=>openCashMovementModal(null,movement.id);row.classList.toggle('selected',movement.id===selectedCashMovementId);});
  const buttons=view.querySelectorAll('.cash-window-actions button'),deleteButton=buttons[2];if(!deleteButton)return;deleteButton.id='cashDeleteMovement';deleteButton.disabled=!selectedCashMovementId;deleteButton.onclick=deleteSelectedCashMovement;if(!document.getElementById('cashEditMovement'))deleteButton.insertAdjacentHTML('beforebegin',`<button class="op-btn" id="cashEditMovement" onclick="openCashMovementModal(null,selectedCashMovementId)" ${selectedCashMovementId?'':'disabled'}><span class="b-ic" aria-hidden="true">${ICN.editlist}</span> Editar Lançamento</button>`);
}
function renderCaixa(){
  const el = document.getElementById('view-caixa');
  // Caixa por operador (13/11): ligado, a tela vem do turno do caixa deste computador.
  if(modoCaixaPorOperador()) return renderCaixaPorOperador(el);
  const s = state.cashSession;
  if(!s || s.status==='closed'){
    // Pedido do dono (10/10): a abertura vem com o dinheiro contado no último fechamento.
    const lastClosed = (state.cashHistory||[]).filter(c=>c.closedAt).sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt))[0];
    const lastCounted = lastClosed && lastClosed.countedAmount!=null && Number.isFinite(Number(lastClosed.countedAmount)) ? Number(lastClosed.countedAmount) : null;
    el.innerHTML = cascaDoCaixa('Caixa', `<div class="hub-cartao"><div class="hub-cartao-topo"><span class="hub-pill off">Fechado</span><span class="sub">${h(currentUser.name)}</span></div><div class="field"><label for="openAmount">Saldo inicial (dinheiro)</label><input type="number" id="openAmount" class="hub-valor" step="0.01" inputmode="decimal" value="${lastCounted!==null?lastCounted.toFixed(2):'0.00'}">${lastCounted!==null?`<small class="sub">Contado no fechamento de ${reportDateTime(lastClosed.closedAt)}. Confira a gaveta.</small>`:''}</div><div class="field"><label for="openNote">Observação (opcional)</label><textarea id="openNote" rows="2"></textarea></div><button class="btn btn-primary hub-acao" id="btnOpenCash">Abrir caixa</button></div>`); // 26/11: cartão no centro, como na maquete
    if(!document.getElementById('btnOpenCash')) return; // 26/11: com Fechamentos anteriores aberto, o cartão de abrir não está na tela
    document.getElementById('btnOpenCash').onclick = async (ev)=>{
      const v = parseFloat(document.getElementById('openAmount').value)||0;
      const session = { id:uid(), displayId:(state.cashHistory.length||0)+1, openedAt:new Date().toISOString(), openingAmount:v, openingNote:document.getElementById('openNote').value.trim(), status:'open', operatorName: currentUser.name };
      if(isCloudMode()){
        // BD-03: o servidor só abre se não houver caixa aberto (outro aparelho pode ter aberto).
        const btn = ev && ev.currentTarget; if(btn) btn.disabled = true;
        const { data, error } = await supabaseClient.rpc('cash_session_open', { p_session: session });
        if(error || !data){ if(btn) btn.disabled = false; toast('Não foi possível abrir o caixa: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.', 'error'); return; }
        state.cashSession = data.session;
        if(!data.ok){
          const o = data.session||{};
          toast('O caixa já estava aberto'+(o.operatorName?' por '+o.operatorName:'')+(o.openedAt?' desde '+new Date(o.openedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'')+'. Este aparelho passou a usar o mesmo caixa.');
          await refreshCashState(); renderAll(); return;
        }
      } else { state.cashSession = session; save('cashSession'); }
      toast('Caixa aberto.'); logAction('Caixa aberto'); renderAll();
    };
    return;
  }
  renderCaixaAberto(el, s);
}
// 26/11 (maquete aprovada): telas do Caixa no padrão do app do garçom. caixaSecao: '' = início; 'movimentacao',
// 'resumo' ou 'historico' = a tela daquela escolha, com a barra "‹ Caixa". switchView volta para o início.
let caixaSecao = '';
function caixaAbrir(sec){
  caixaSecao = sec||'';
  renderCaixa(); enhanceCashMovementGrid();
  const el = document.getElementById('view-caixa'); if(!el) return;
  el.scrollTop = 0;
  const alvo = caixaSecao ? el.querySelector('.hub-trilha .cc-voltar') : el.querySelector('.cc-item');
  if(alvo) alvo.focus();
}
function caixaTrilha(titulo){ return `<div class="hub-trilha"><button type="button" class="cc-voltar" onclick="caixaAbrir('')">${ICN.chevLeft}Caixa</button><h2>${h(titulo)}</h2></div>`; }
function caixaItem(sec, icon, titulo, desc, cls, onclick){
  return `<button type="button" class="cc-item ${cls||''}" onclick="${onclick||`caixaAbrir(${jsArg(sec)})`}"><span class="ic">${ICN[icon]||''}</span><span class="tx"><span class="t">${h(titulo)}</span><span class="d">${h(desc)}</span></span><span class="go">${ICN.chevRight}</span></button>`;
}
// Telas sem turno aberto (fechado, travado, avisos): o corpo e, para quem vê os totais, a escolha
// "Fechamentos anteriores" embaixo (antes o painel ficava sempre no fim da tela).
function caixaComHistorico(corpo){
  const painel = renderCashHistoryPanel();
  if(caixaSecao==='historico' && painel) return caixaTrilha('Fechamentos anteriores') + `<div class="hub-corpo">${painel}</div>`;
  if(caixaSecao) caixaSecao = '';
  return corpo + (painel ? `<div class="cc-lista hub-mais">${caixaItem('historico', 'history', 'Fechamentos anteriores', 'Os últimos fechamentos, com o contado e a diferença.')}</div>` : '');
}
function cascaDoCaixa(tituloHtml, corpo){
  return `<div class="hub hub-caixa"><div class="cc-head">${caixaTituloComVolta(`<h1 class="cash-title">${tituloHtml}</h1>`)}</div>${caixaComHistorico(corpo)}</div>`;
}
/* caixa-lista (27/11, pedido do dono: "queria poder ver todos os caixas abertos no menu caixa. o cofre poderia ir para
   o final dos caixas"): com o caixa por operador ligado, administrador e dono começam o Caixa numa lista com a situação
   de cada caixa (state.cashTurnos, que o polling já lê de todos) e o Cofre no fim. Só o caixa deste computador é
   tocável: abrir e fechar pedem a gaveta física. Os cartões não mostram dinheiro. caixaNaLista volta a true em switchView. */
let caixaNaLista = true;
function caixaVerTodos(){ return modoCaixaPorOperador() && podeVerTotaisDoCaixa(); }
function caixaEntrarNoMeu(){ caixaNaLista = false; caixaAbrir(''); }
function caixaVoltarParaLista(){ caixaNaLista = true; caixaAbrir(''); }
// Na tela do caixa deste computador, quem vê a lista ganha "‹ Todos os caixas" ao lado do título.
function caixaTituloComVolta(h1){
  if(!(caixaVerTodos() && !caixaNaLista)) return h1;
  return `<div class="cx-titulo"><button type="button" class="cc-voltar" onclick="caixaVoltarParaLista()">${ICN.chevLeft}Todos os caixas</button>${h1}</div>`;
}
function caixaSituacao(cx){
  const t = (state.cashTurnos||{})[cx], quem = t && t.operatorName ? ' · '+t.operatorName : '';
  if(t && t.status==='open') return { tom:'on', texto:'Aberto'+quem+(t.openedAt?' · desde '+timeFmt(t.openedAt):'') };
  if(t && /^travado/.test(String(t.status||''))){
    const p = t.pendencia||{}, fech = p.tipo==='fechamento' || t.status==='travado_fechamento', at = p.at||t.openedAt;
    return { tom:'alerta', texto:'Travado '+(fech?'no fechamento':'na abertura')+quem+(at?' · '+timeFmt(at):'') };
  }
  if(t) return { tom:'alerta', texto:String(t.status||'')+quem };
  if(state.cashAbrirSemContagem && state.cashAbrirSemContagem[cx]) return { tom:'alerta', texto:'Passado sem contagem' };
  return { tom:'off', texto:'Fechado' };
}
function renderListaDeCaixas(el){
  if(state.cashTurnosFalhou && !state.cashTurnos){ el.innerHTML = cascaDoCaixa('Caixa', `<div class="hub-cartao"><p class="hub-aviso">Não foi possível ler o caixa. Tentando de novo…</p></div>`); return; }
  const meu = caixaDoAparelho();
  const cartoes = listaDeCaixas().map(c=>{
    const este = c.id===meu, s = caixaSituacao(c.id);
    const miolo = `<span class="ic">${ICN.cashbox||''}</span><span class="tx"><span class="t">${h(c.nome)}${este?' <span class="cx-este">Este computador</span>':''}</span><span class="d cx-sit ${s.tom}">${h(s.texto)}</span></span>`;
    return este ? `<button type="button" class="cc-item cx-cartao" onclick="caixaEntrarNoMeu()">${miolo}<span class="go">${ICN.chevRight}</span></button>`
      : `<div class="cc-item cx-cartao so-ler">${miolo}</div>`;
  }).join('');
  const cofre = userPermissions(currentUser).includes('cofre') ? caixaItem('', 'lock', 'Cofre', 'Saldo, recolher, abastecer e extrato.', 'cx-cofre', "switchView('cofre')") : '';
  const escolha = meu ? '' : `<div class="hub-cartao"><p class="hub-aviso">Este computador ainda não é um caixa. Qual caixa ele é?</p><div class="hub-escolha">${listaDeCaixas().map(c=>`<button type="button" class="cx-escolher" onclick="escolherCaixaAqui(${jsArg(c.id)})">${h(c.nome)}</button>`).join('')}</div><p class="sub">Fica guardado neste computador. Dá para trocar em Configurações › Geral › Caixa por operador.</p></div>`;
  el.innerHTML = cascaDoCaixa('Caixa', `<div class="cc-lista cx-lista">${cartoes}${cofre}</div>${escolha}`);
}
// Caixa por operador (13/11): venda do turno. Ligado, a venda que tem cashSessionId é do turno com esse id
// (dois caixas abertos ao mesmo tempo não somam a venda um do outro); venda sem cashSessionId (antiga) e o
// modo desligado seguem a regra da hora: fechou depois da abertura.
function vendaEntraNoCaixa(sl, s){
  if(!saleCountsAsRevenue(sl)) return false;
  if(modoCaixaPorOperador() && sl.cashSessionId) return sl.cashSessionId===s.id;
  return new Date(sl.closedAt) >= new Date(s.openedAt);
}
// Tela do caixa aberto (a de sempre). Ligado, o título é "<caixa> — <operador>" e o botão "Fechar / passar o caixa".
function renderCaixaAberto(el, s){
  const porOperador = modoCaixaPorOperador();
  const salesInSession = state.sales.filter(sl=>vendaEntraNoCaixa(sl, s));
  const movements = state.cashMovements.filter(m=>m.cashSessionId===s.id);
  // Pagamento parcial (OP-13) conta uma vez só, como no fechamento: pelo movimento que entrou no
  // caixa na hora, e não de novo pela linha partial:true da venda. Antes a tela somava os dois e o
  // dinheiro esperado e o total geral ficavam maiores que o fechamento.
  const totals = cashSessionTotals(salesInSession, movements);
  const manual = movements.filter(m=>!isPartialMovement(m));
  const suprimentos = manual.filter(m=>m.type==='suprimento').reduce((a,m)=>a+m.amount,0);
  const sangrias = manual.filter(m=>m.type==='sangria').reduce((a,m)=>a+m.amount,0);
  const suprimentosDinheiro=manual.filter(m=>m.type==='suprimento'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+m.amount,0);
  const diarias = manual.filter(ehPagamentoDeFuncionario).reduce((a,m)=>a+m.amount,0); // 08/11: separado das outras retiradas
  const sangriasDinheiro=manual.filter(m=>m.type==='sangria'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+m.amount,0);
  // Fiado é venda a receber: não entra no caixa. Fica fora das entradas e do "TUDO"
  // e aparece separado no resumo; o recebimento entra quando o sócio paga.
  const totalVendido = Object.values(totals).reduce((a,b)=>a+b,0) - totals.fiado;
  const esperadoDinheiro = s.openingAmount + totals.dinheiro + suprimentosDinheiro - sangriasDinheiro;
  const saleRows=[];
  salesInSession.forEach(sl=>(sl.payments||[]).filter(p=>!p.partial).forEach(p=>{ const fiado = methodBucket(p.method)==='fiado'; saleRows.push({at:sl.closedAt,description:'PEDIDO #'+(sl.orderNumber||'—')+(fiado?' — fiado, a receber '+fmt(p.amount):''),entry:fiado?0:p.amount,exit:0,method:paymentMethodLabel(p.method)}); }));
  movements.forEach(m=>saleRows.push({id:m.id,visivelOperador:!m.origin||m.origin==='cofre'/* cofre (16/11): a sangria que o operador lançou ele vê */,at:m.at,description:(m.type==='suprimento'?'ENTRADA — ':'SAÍDA — ')+(m.description||m.reason||''),entry:m.type==='suprimento'?m.amount:0,exit:m.type==='sangria'?m.amount:0,method:paymentMethodLabel(m.method||'dinheiro')}));
  saleRows.sort((a,b)=>new Date(a.at)-new Date(b.at));
  const movementRows=[{visivelOperador:true,at:s.openedAt,description:'SALDO INICIAL',entry:Number(s.openingAmount)||0,exit:0,method:'Dinheiro'},...saleRows];
  const caixaId=String(s.displayId||s.id||'').replace(/[^a-zA-Z0-9]/g,'').slice(-6)||'1';
  // UX lote 1 (06/11), PROD-05: a conferência do fechamento é às cegas, mas esta tela mostrava
  // ao operador o "dinheiro esperado na gaveta" e os totais o tempo todo — inclusive atrás do
  // modal "Conte o caixa antes de ver o esperado". Agora só administrador ou dono veem os totais.
  const veTotaisCaixa = podeVerTotaisDoCaixa();
  // 06/11 (pedido do dono): o operador também não vê as linhas de venda da Movimentação — somando
  // à mão dava para chegar no esperado. Ele vê só o saldo inicial e as entradas/saídas manuais
  // (sangria e reforço) que ele mesmo lança; vendas, parciais, troco e fiado ficam para o admin.
  // 26/11 (maquete aprovada, "igual ao app do garçom"): em vez da janela de três colunas com tudo de uma vez,
  // a situação no topo e as escolhas; Movimentação, Resumo e Fechamentos anteriores abrem cada um a sua tela
  // com "‹ Caixa" (caixaSecao). Fechar e Novo lançamento abrem as janelas de sempre.
  const tituloHtml = `${porOperador?h(nomeDoCaixa(s.caixaId||caixaQueVale()))+' — '+h(s.operatorName||currentUser.name):`Caixa de ${h(s.operatorName||currentUser.name)}<span class="cash-selo">Id: ${h(caixaId)}</span>`}`;
  const nLanc = (veTotaisCaixa?movementRows:movementRows.filter(r=>r.visivelOperador)).length - 1;
  const historico = renderCashHistoryPanel();
  if(caixaSecao==='historico' && !historico) caixaSecao = '';
  if(caixaSecao==='resumo' && !veTotaisCaixa) caixaSecao = '';
  let corpo;
  if(caixaSecao==='movimentacao'){
    corpo = caixaTrilha('Movimentação') + `<div class="hub-corpo hub-movimento">${veTotaisCaixa?'<label class="cash-movement-filter"><input type="checkbox" id="cashShowReversed"> Exibir pagamentos estornados e descontos de pedidos</label>':'<p class="cash-movement-filter sub">Conferência às cegas: as vendas aparecem para o administrador e no fechamento, depois da contagem.</p>'}<div class="cash-movement-table"><table><thead><tr><th>Data / Hora</th><th>Descrição</th><th>Entrada</th><th>Saída</th><th>Forma Pagto.</th></tr></thead><tbody>${(veTotaisCaixa?movementRows:movementRows.filter(r=>r.visivelOperador)).map(r=>`<tr><td>${dataHoraBR(r.at)}</td><td>${h(r.description)}</td><td class="mono">${r.entry?fmt(r.entry):''}</td><td class="mono">${r.exit?fmt(r.exit):''}</td><td>${h(r.method)}</td></tr>`).join('')}</tbody>${veTotaisCaixa?`<tfoot><tr><td colspan="2"></td><td class="mono">${fmt((Number(s.openingAmount)||0)+totalVendido+suprimentos)}</td><td class="mono">${fmt(sangrias)}</td><td></td></tr></tfoot>`:''}</table></div><footer class="cash-window-actions"><button class="op-btn" onclick="openCashMovementModal()"><span class="b-ic" aria-hidden="true">${ICN.plus}</span> Novo Lançamento</button><button class="op-btn" onclick="window.print()"><span class="b-ic" aria-hidden="true">${ICN.printer}</span> Imprimir</button><button class="op-btn" disabled>Excluir Lançamento</button></footer></div>`;
  } else if(caixaSecao==='resumo'){
    corpo = caixaTrilha('Resumo por forma') + `<div class="hub-corpo hub-resumo cash-summary"><div class="cash-summary-line">Saldo inicial: <b class="mono">${fmt(s.openingAmount)}</b></div><div class="cash-summary-line">Entradas no caixa</div>${totalVendido+suprimentos?(veTotaisCaixa?`<div class="cash-summary-empty">Vendas recebidas: ${fmt(totalVendido)}<br>Entradas: ${fmt(suprimentos)}</div>`:'<div class="cash-summary-empty">Veja cada lançamento em Movimentação.</div>'):'<div class="cash-summary-empty">Não há registros de entrada</div>'}${totals.fiado&&veTotaisCaixa?`<div class="cash-summary-empty">Vendido no fiado (a receber, fora do caixa): ${fmt(totals.fiado)}</div>`:''}<div class="cash-summary-line">Saídas do caixa</div>${sangrias?(veTotaisCaixa?`<div class="cash-summary-empty">${[sangrias-diarias>TOLERANCIA_CENTAVO?`Saídas: ${fmt(sangrias-diarias)}`:'', diarias?`${rotuloPagFuncionario()}: ${fmt(diarias)}`:''].filter(Boolean).join('<br>')/* revisão final, item 7: só diárias não mostra "Saídas: R$ 0,00" */}</div>`:'<div class="cash-summary-empty">Veja cada lançamento em Movimentação.</div>'):'<div class="cash-summary-empty">Não há registros de saída</div>'}<div class="cash-summary-total"><div class="cash-summary-line">Saldo final</div>${veTotaisCaixa?`<div class="cash-summary-line">Dinheiro esperado na gaveta: <b class="mono">${fmt(esperadoDinheiro)}</b></div><div class="cash-summary-line">Total (todas as formas): <b class="mono">${fmt((Number(s.openingAmount)||0)+totalVendido+suprimentos-sangrias)}</b></div>`:`<div class="cash-summary-empty">Conferência às cegas: o esperado aparece no fechamento, depois que você informar o que contou.</div>`}</div></div>`;
  } else if(caixaSecao==='historico'){
    corpo = caixaTrilha('Fechamentos anteriores') + `<div class="hub-corpo">${historico}</div>`;
  } else {
    const topo = veTotaisCaixa
      ? `<div><div class="lab">Dinheiro esperado na gaveta</div><div class="big mono">${fmt(esperadoDinheiro)}</div></div><div><div class="lab">Saldo inicial</div><b class="mono">${fmt(s.openingAmount)}</b></div><div><div class="lab">Vendido no turno</div><b class="mono">${fmt(totalVendido)}</b></div>`
      : `<div><div class="lab">Saldo inicial</div><div class="big mono">${fmt(s.openingAmount)}</div></div><div class="sub">Conferência às cegas: o esperado aparece no fechamento, depois que você informar o que contou.</div>`;
    const lanc = nLanc===1 ? '1 lançamento neste turno.' : (nLanc>0 ? nLanc+' lançamentos neste turno.' : 'Nenhum lançamento além do saldo inicial.');
    corpo = `<div class="hub-status">${topo}<div><div class="lab">Aberto</div><span>${h(dataHoraBR(s.openedAt))}${s.operatorName?' · '+h(s.operatorName):''}</span></div></div>
      <div class="cc-lista hub-principal">${caixaItem('', 'lock', porOperador?'Fechar / passar o caixa':'Fechar Caixa', porOperador?'Contar a gaveta e entregar para o próximo turno ou fechar a noite.':'Contar a gaveta e fechar o caixa.', 'prim cash-fechar', 'openCloseCashModal()')}</div>
      <div class="cc-lista">${caixaItem('', 'plus', 'Novo lançamento', porOperador?'Entrada, sangria ou pagamento de funcionário.':'Entrada, saída ou diária de freelancer.', '', 'openCashMovementModal()')}${caixaItem('movimentacao', 'listCheck', 'Movimentação', lanc)}${veTotaisCaixa?caixaItem('resumo', 'cash', 'Resumo por forma', 'Entradas, saídas e o total do turno.'):''}${historico?caixaItem('historico', 'history', 'Fechamentos anteriores', 'Os últimos fechamentos, com o contado e a diferença.'):''}</div>`;
  }
  el.innerHTML = `<div class="hub hub-caixa"><div class="cc-head">${caixaTituloComVolta(`<h1 class="cash-title cash-title-aberto">${tituloHtml}</h1>`)}</div>${corpo}</div>`;
}

/* ---- Caixa por operador (13/11): abrir com contagem, trava, liberar e fechar ----
   Cada computador marcado é um caixa (caixaDoAparelho). Abrir pede a contagem do dinheiro da gaveta
   às cegas (campo vazio, sem o esperado); o servidor (cash_turno_abrir) compara com a última contagem
   do caixa em centavos inteiros e, se não bater, o turno nasce travado. Travado não recebe pagamento
   (status ≠ 'open'). Destrava: contar de novo, PIN de um administrador que não contou (staff-auth
   cash_release) ou o dono. Esperado e diferença só para quem passa em podeVerTotaisDoCaixa(). */
function aplicarTurnoDoCaixa(cx, turno){
  state.cashTurnos = Object.assign({}, state.cashTurnos||{}, { [cx]: turno||null });
  state.cashTurnosFalhou = false;
  if(cx===caixaQueVale()) state.cashSession = turno||null;
}
async function recarregarHistoricoDoCaixa(){
  try{ const rh = await storageApi.get(STORE.cashHistory); state.cashHistory = parseAppDataValue(rh, []) || []; }catch(e){}
}
function textoMotivoDoTurno(motivo){
  return ({
    nao_travado:'Este caixa já não está travado. A tela foi atualizada.',
    nao_aberto:'Este caixa não está aberto. A tela foi atualizada.',
    outro_operador:'Só quem abriu o turno ou um administrador pode fazer isso.',
    pendencia_mudou:'A contagem mudou. Confira de novo.',
    contagem_obrigatoria:'A contagem na passagem de caixa está ligada em Configurações. Conte o dinheiro para passar o caixa.'
  })[motivo] || 'A situação do caixa mudou em outro aparelho. A tela foi atualizada.';
}
// Resposta {ok, turno, motivo?} das RPCs: guarda o turno do caixa (null = fechamento concluído) e redesenha.
async function aplicarRespostaDoTurno(cx, data){
  if(!data.ok) toast(textoMotivoDoTurno(data.motivo), 'error');
  // cofre (16/11): fechamento travado que conclui agora (recontagem/liberação) também avisa o que separar.
  const travadoId = state.cashSession && state.cashSession.status==='travado_fechamento' ? state.cashSession.id : null;
  aplicarTurnoDoCaixa(cx, data.turno||null);
  if(!data.turno) await recarregarHistoricoDoCaixa();
  renderAll();
  if(data.ok && !data.turno && travadoId) avisoSeparaCofreDoTurno(travadoId);
}
// cofre (16/11): "Deixe R$ X de troco na gaveta e separe R$ Y para o cofre." Troco e valor vêm do servidor.
function avisoSeparaCofre(troco, paraCofre){
  const msg = paraCofre>=0.005 ? `Deixe ${fmt(troco)} de troco na gaveta e separe ${fmt(paraCofre)} para o cofre.` : `Deixe ${fmt(troco)} de troco na gaveta. Não há dinheiro para o cofre.`;
  openModal('Separe o dinheiro do cofre',`<div class="cash-close-body"><p style="font-size:1.1em;margin:8px 0 16px">${h(msg)}</p><div class="cash-close-actions"><button class="primary" onclick="closeModal()">OK</button></div></div>`);
}
// Fechamento que concluiu depois da trava: troco/paraCofre ficam na entrada do histórico (gravada pelo servidor).
function avisoSeparaCofreDoTurno(turnoId){
  const e = (state.cashHistory||[]).find(c=>c && c.id===turnoId);
  if(e && e.fimDaNoite && typeof e.paraCofre==='number') avisoSeparaCofre(Number(e.troco)||0, e.paraCofre);
}
// Escolha do fechamento (só no caixa por operador): 'passagem', 'fim' ou null.
// 26/11 (pedido do dono: "é inviável contar na troca de pessoa para a janta"): Configurações › Caixa por operador ›
// "Contar o dinheiro na passagem de caixa". Desligado, passar o caixa não pede contagem e a abertura seguinte também
// não; o fim da noite continua contado. O servidor confere a opção (20261127010000_caixa_troca_sem_contagem.sql).
function contarNaTroca(){ return !(state.settings && state.settings.contarNaTroca===false); }
function passagemSemContagem(){ return modoCaixaPorOperador() && !contarNaTroca() && escolhaDoFechamento()==='passagem'; }
function cashFechTipoMudou(){
  const sem = passagemSemContagem(), grid = document.querySelector('.cash-count-grid'), aviso = document.getElementById('cashSemContagemAviso');
  if(grid) grid.hidden = sem;
  if(aviso) aviso.hidden = !sem;
  // Títulos da janela: sem contagem não faz sentido pedir para contar.
  const tit = document.querySelector('#modalRoot .cash-close-body > h2'), sub = document.querySelector('#modalRoot .cash-close-body > p.sub'), btn = document.querySelector('#cashCloseStep1 .primary');
  [[tit,'Passar o caixa'],[sub,'Ninguém conta agora. Confira e passe o caixa para a próxima pessoa.'],[btn,'Continuar']].forEach(([el,txt])=>{ if(!el) return; if(el.dataset.orig===undefined) el.dataset.orig = el.textContent; el.textContent = sem ? txt : el.dataset.orig; });
}
function escolhaDoFechamento(){ const el=document.querySelector('input[name="cashFechTipo"]:checked'); return el?el.value:null; }
function lerValorContado(id){
  const el = document.getElementById(id), raw = el ? String(el.value||'').trim() : '', v = parseFloat(raw.replace(',', '.'));
  if(!raw || !Number.isFinite(v) || v<0){ toast('Informe o dinheiro contado na gaveta.'); if(el) el.focus(); return null; }
  return arredondaCentavos(v);
}
function cascaDoCaixaPorOperador(titulo, corpo){ return cascaDoCaixa(h(titulo), corpo); } // 26/11: mesma casca do padrão
function renderCaixaPorOperador(el){
  const cx = caixaDoAparelho();
  const aviso = (titulo, texto) => cascaDoCaixaPorOperador(titulo, `<div class="hub-cartao"><p class="hub-aviso">${h(texto)}</p></div>`);
  if(!isCloudMode()){ el.innerHTML = aviso('Caixa', 'O caixa por operador precisa da conexão com o servidor.'); return; }
  if(caixaVerTodos() && (caixaNaLista || !cx)) return renderListaDeCaixas(el); // caixa-lista (27/11)
  if(!cx){
    // 25/11 (pedido do dono: administradores abrem e fecham os caixas): o administrador escolhe aqui mesmo qual
    // caixa este computador é, sem ir em Configurações (a marca é por navegador e some ao trocar de endereço,
    // como na mudança para commandah.com.br). O servidor já aceitava administrador em qualquer caixa.
    if(typeof isAdminUser==='function' && isAdminUser()){
      const botoes = listaDeCaixas().map(c=>`<button type="button" class="cx-escolher" onclick="escolherCaixaAqui(${jsArg(c.id)})">${h(c.nome)}</button>`).join('');
      el.innerHTML = cascaDoCaixaPorOperador('Caixa', `<div class="hub-cartao"><p class="hub-aviso">Este computador ainda não é um caixa. Qual caixa ele é?</p><div class="hub-escolha">${botoes}</div><p class="sub">Fica guardado neste computador. Dá para trocar em Configurações › Geral › Caixa por operador.</p></div>`);
      return;
    }
    el.innerHTML = aviso('Caixa', 'Este computador não é um caixa. Peça a um administrador para marcar em Configurações.'); return;
  }
  if(state.cashTurnosFalhou && !state.cashTurnos){ el.innerHTML = aviso(nomeDoCaixa(cx), 'Não foi possível ler o caixa. Tentando de novo…'); return; }
  const s = state.cashSession;
  if(s && s.status==='open') return renderCaixaAberto(el, s);
  if(s && /^travado/.test(String(s.status||''))) return renderCaixaTravado(el, cx, s);
  // Sem turno: contagem às cegas. Campo sempre vazio e nenhum valor do último fechamento na tela.
  // O polling redesenha quando outro caixa muda: o que a pessoa já digitou aqui continua.
  const digitado = el.querySelector('#openAmount') && el.querySelector('#btnOpenCash') && el.dataset.caixa===cx+'|'+currentUser.id ? { v:el.querySelector('#openAmount').value, n:(el.querySelector('#openNote')||{}).value||'' } : null;
  el.dataset.caixa = cx+'|'+currentUser.id;
  if(state.cashAbrirSemContagem && state.cashAbrirSemContagem[cx] && !contarNaTroca()){
    // 26/11: o caixa foi passado sem contagem (troca de pessoa): abre sem contar, com o dinheiro que ficou na gaveta.
    el.innerHTML = cascaDoCaixaPorOperador(nomeDoCaixa(cx), `<div class="hub-cartao"><div class="hub-cartao-topo"><span class="hub-pill off">Passado sem contagem</span><span class="sub">${h(currentUser.name)}</span></div><p class="hub-aviso">O caixa foi passado sem contagem. Abra para continuar com o dinheiro que está na gaveta. A contagem fica para o fechamento do fim da noite.</p><div class="field"><label for="openNote">Observação (opcional)</label><textarea id="openNote" rows="2"></textarea></div><button class="btn btn-primary hub-acao" id="btnOpenCash">Abrir caixa</button></div>`);
    if(!document.getElementById('btnOpenCash')) return;
    if(digitado) document.getElementById('openNote').value = digitado.n;
    document.getElementById('btnOpenCash').onclick = ()=>abrirTurnoDoCaixa(cx, true);
    return;
  }
  el.innerHTML = cascaDoCaixaPorOperador(nomeDoCaixa(cx), `<div class="hub-cartao"><div class="hub-cartao-topo"><span class="hub-pill off">Fechado</span><span class="sub">${h(currentUser.name)}</span></div><div class="field"><label for="openAmount">Conte o dinheiro da gaveta</label><input type="number" id="openAmount" class="hub-valor" min="0" step="0.01" inputmode="decimal" placeholder="0,00" autocomplete="off" value=""><small class="sub">Conte as notas e moedas e digite o total. Se não bater com o último fechamento deste caixa, ele fica travado até um administrador ou o dono liberar.</small></div><div class="field"><label for="openNote">Observação (opcional)</label><textarea id="openNote" rows="2"></textarea></div><button class="btn btn-primary hub-acao" id="btnOpenCash">Abrir caixa</button></div>`); // 26/11: cartão no centro
  if(!document.getElementById('btnOpenCash')) return; // 26/11: Fechamentos anteriores aberto
  if(digitado && document.getElementById('openAmount')){ document.getElementById('openAmount').value = digitado.v; document.getElementById('openNote').value = digitado.n; }
  document.getElementById('btnOpenCash').onclick = ()=>abrirTurnoDoCaixa(cx);
}
// Administrador marca este computador como um dos caixas e segue para abrir/fechar.
async function escolherCaixaAqui(id){
  if(!(typeof isAdminUser==='function' && isAdminUser()) || !listaDeCaixas().some(c=>c.id===id)) return;
  marcarCaixaDoAparelho(id);
  caixaNaLista = false; // caixa-lista (27/11): escolheu na lista, segue para abrir este caixa
  logAction('Computador marcado como ' + nomeDoCaixa(id) + ' pela tela do Caixa');
  try { await refreshCashState(); } catch(e){ /* a consulta periódica tenta de novo */ }
  renderAll();
}
const abrirTurnoDoCaixa = singleFlight('abrirTurnoDoCaixa', async function(cx, semContar){
  const contado = semContar ? null : lerValorContado('openAmount'); if(contado===null && !semContar) return; // 26/11: passado sem contagem
  const nota = (document.getElementById('openNote')||{}).value || '';
  const { data, error } = await supabaseClient.rpc('cash_turno_abrir', { p_caixa:cx, p_contado:contado, p_nota:nota.trim(), p_turno:{ id:uid(), operatorName:currentUser.name, status:'open' } });
  if(error || !data){ toast('Não foi possível abrir o caixa: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.', 'error'); return; }
  if(!data.ok && data.motivo==='outro_turno'){
    // Uma pessoa, um turno: o turno devolvido é o do outro caixa (não é deste).
    toast('Você já tem um turno aberto no '+nomeDoCaixa(data.turno&&data.turno.caixaId)+'. Feche ou passe aquele caixa antes de abrir este.', 'error');
    return;
  }
  if(!data.ok){
    const o = data.turno||{};
    toast('O '+nomeDoCaixa(cx)+' já foi aberto'+(o.operatorName?' por '+o.operatorName:'')+'. Este computador passou a mostrar o mesmo turno.');
    aplicarTurnoDoCaixa(cx, data.turno||null); renderAll(); return;
  }
  aplicarTurnoDoCaixa(cx, data.turno);
  if(data.turno && data.turno.status==='open'){ toast('Caixa aberto.'); logAction('Caixa aberto — '+nomeDoCaixa(cx)+(semContar?' (sem contagem, depois de passagem sem contagem)':'')); }
  else { toast('A contagem não confere com o último fechamento. O caixa fica travado até liberar.', 'error'); logAction('Abertura do caixa travada — '+nomeDoCaixa(cx)+' (contado '+fmt(contado)+')'); }
  renderAll();
});
// Estado 3: turno travado (abertura ou fechamento). O operador vê só o que contou.
function renderCaixaTravado(el, cx, s){
  const p = s.pendencia || {}, ve = podeVerTotaisDoCaixa(), fechamento = p.tipo==='fechamento';
  const dif = ve && p.diferenca!=null ? Number(p.diferenca) : null;
  const linhas = [
    ve && p.esperado!=null ? `<div class="cash-summary-line">Esperado: <b class="mono">${fmt(p.esperado)}</b></div>` : '',
    `<div class="cash-summary-line">Contado: <b class="mono">${fmt(p.contado)}</b></div>`,
    dif!==null ? `<div class="cash-summary-line">Diferença: <b class="mono ${dif<0?'cash-short':'cash-over'}">${dif<0?'Falta ':'Sobra '}${fmt(Math.abs(dif))}</b></div>` : ''
  ].join('');
  const situacao = p.recusada ? 'O dono recusou. Conte de novo.' : (p.pedidoDono ? 'Aguardando o dono…' : '');
  const quando = p.at ? ' às '+timeFmt(p.at) : '';
  el.innerHTML = cascaDoCaixaPorOperador(nomeDoCaixa(cx), `<div class="hub-cartao hub-cartao-largo"><div class="hub-cartao-topo"><span class="hub-pill alerta">Caixa travado</span><b>Contagem não confere</b></div><p class="sub">${fechamento?'A contagem do fechamento não bate com o esperado do turno.':'A contagem da gaveta não bate com o último fechamento deste caixa.'} O caixa não recebe pagamento até a contagem bater ou alguém liberar.</p><div class="hub-detalhe">${fechamento?'Fechamento':'Abertura'} do turno de ${h(s.operatorName||'—')} · Contou: ${h(p.contouNome||'—')}${h(quando)}</div><div class="hub-linhas">${linhas}</div>${situacao?`<p class="cash-close-note" id="cxSituacao"><b>${h(situacao)}</b></p>`:''}<div class="hub-acoes"><button class="btn btn-primary hub-acao" id="cxRecontar" onclick="abrirRecontagemDoCaixa(${jsArg(cx)})">Contar de novo</button><button class="btn hub-acao" id="cxLiberarPin" onclick="liberarTurnoComPin(${jsArg(cx)})">Liberar com PIN de administrador</button>${p.pedidoDono?'':`<button class="btn hub-acao" id="cxPedirDono" onclick="pedirLiberacaoAoDono(${jsArg(cx)})">Pedir liberação ao dono</button>`}</div></div>`); // 26/11: cartão, mesmos botões e ids
}
function abrirRecontagemDoCaixa(cx){
  const s = state.cashSession; if(!s || !s.pendencia) return;
  openModal('Contar de novo', `<div class="cash-close-body"><p class="sub">Conte de novo o dinheiro da gaveta e digite o total.</p><div class="cash-count-grid"><div class="field"><label for="cxRecontarValor">Dinheiro contado na gaveta *</label><input id="cxRecontarValor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00" autocomplete="off"></div></div><div class="cash-close-actions"><button onclick="closeModal()">‹ &nbsp; Voltar</button><button class="primary" id="cxRecontarOk" onclick="recontarTurnoDoCaixa(${jsArg(cx)})">Conferir contagem</button></div></div>`);
  const input = document.getElementById('cxRecontarValor');
  input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); recontarTurnoDoCaixa(cx); } });
  setTimeout(()=>input.focus(), 50);
}
const recontarTurnoDoCaixa = singleFlight('recontarTurnoDoCaixa', async function(cx){
  const s = state.cashSession; if(!s || !s.pendencia){ closeModal(); renderAll(); return; }
  const contado = lerValorContado('cxRecontarValor'); if(contado===null) return;
  const { data, error } = await supabaseClient.rpc('cash_turno_recontar', { p_caixa:cx, p_turno_id:s.id, p_contado:contado });
  if(error || !data){ toast('Não foi possível conferir a contagem: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.', 'error'); return; }
  closeModal();
  await aplicarRespostaDoTurno(cx, data);
  if(!data.ok) return;
  if(!data.turno){ toast('Contagem confere. Caixa fechado.'); logAction('Caixa fechado na recontagem — '+nomeDoCaixa(cx)); }
  else if(data.turno.status==='open'){ toast('Contagem confere. Caixa aberto.'); logAction('Caixa aberto na recontagem — '+nomeDoCaixa(cx)); }
  else toast('A contagem ainda não confere.', 'error');
});
// Liberar com PIN de administrador: como a troca de preço do quilo, escolhe o admin numa lista e digita o
// PIN. Quem contou não aparece na lista (o servidor recusa a autoliberação de qualquer jeito).
function liberarTurnoComPin(cx){
  const s = state.cashSession, p = s && s.pendencia; if(!p) return;
  const admins = (state.users||[]).filter(u=>u && u.role==='admin' && u.active!==false && u.id!==p.contouId);
  askStaffPin({
    title: 'Liberar o '+nomeDoCaixa(cx),
    message: h('Um administrador que não fez a contagem digita o PIN para liberar.'),
    whoLabel: 'Administrador', staff: admins,
    defaultId: currentUser && currentUser.role==='admin' ? currentUser.id : null,
    emptyMessage: 'Não há outro administrador para liberar. Peça liberação ao dono.',
    confirmLabel: 'Liberar caixa',
    onSubmit: singleFlight('liberarTurnoComPin', async function(staffId, pin){
      const atual = state.cashSession;
      if(!atual || !atual.pendencia || atual.id!==s.id){ closeModal(); renderAll(); return null; }
      const r = await staffAuthCall({ action:'cash_release', staff_id:staffId, pin, caixa_id:cx, turno_id:atual.id, pendencia_id:atual.pendencia.id });
      if(r.error){ if(/mudou|desligado/i.test(r.error)) await refreshCashState(); return r.error; }
      closeModal();
      const turno = r.data && r.data.turno || null, admin = admins.find(u=>u.id===staffId);
      aplicarTurnoDoCaixa(cx, turno);
      if(!turno) await recarregarHistoricoDoCaixa();
      logAction('Divergência do caixa liberada por PIN — '+nomeDoCaixa(cx)+' (liberou: '+(admin?admin.name:staffId)+')');
      renderAll();
      toast(turno ? 'Caixa liberado.' : 'Fechamento liberado.');
      return null;
    })
  });
}
const pedirLiberacaoAoDono = singleFlight('pedirLiberacaoAoDono', async function(cx){
  const s = state.cashSession; if(!s || !s.pendencia) return;
  const { data, error } = await supabaseClient.rpc('cash_turno_pedir_dono', { p_caixa:cx, p_turno_id:s.id });
  if(error || !data){ toast('Não foi possível pedir a liberação: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.', 'error'); return; }
  await aplicarRespostaDoTurno(cx, data);
  if(data.ok){ toast('Pedido enviado ao dono.'); logAction('Liberação do caixa pedida ao dono — '+nomeDoCaixa(cx)); }
});
// OP-14 no caixa por operador: comanda avulsa aberta só barra o fechamento do último turno aberto
// (outro caixa ainda aberto pode receber a comanda depois).
function esteEOUltimoTurnoAberto(){
  if(!modoCaixaPorOperador()) return true;
  const cx = caixaQueVale();
  return !Object.entries(state.cashTurnos||{}).some(([id,t])=>id!==cx && t && t.status!=='closed' && t.status!=='travado_fechamento');
}
// Fechamento no caixa por operador (chamado por finalizeCashSession, que já tem a trava de duplo toque):
// cash_turno_fechar compara contado x esperado em centavos. Bate → vai para o histórico e devolve 'fechado';
// não bate → o turno fica travado (tipo fechamento) e a tela vai para "Contagem não confere".
async function fecharTurnoDoCaixa(closed){
  if(!isCloudMode()){ toast('O caixa por operador precisa da conexão com o servidor.', 'error'); return 'erro'; }
  if(typeof closed.countedAmount!=='number'){ toast('Informe o dinheiro contado na gaveta.'); return 'erro'; }
  const cx = caixaQueVale();
  // Comandas abertas (a receber) vão só no fechamento do último turno aberto; nos outros o campo nem existe.
  if(!esteEOUltimoTurnoAberto()){ delete closed.openComandas; delete closed.openComandasTotal; }
  await save('cashMovements');
  const { data, error } = await supabaseClient.rpc('cash_turno_fechar', { p_caixa:cx, p_turno_id:closed.id, p_closed:closed });
  if(error || !data){ toast('Não foi possível fechar o caixa: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.', 'error'); return 'erro'; }
  document.getElementById('modalRoot').innerHTML = '';
  if(!data.ok){ await aplicarRespostaDoTurno(cx, data); return 'erro'; }
  if(data.turno){
    aplicarTurnoDoCaixa(cx, data.turno);
    logAction('Fechamento do caixa travado — '+nomeDoCaixa(cx)+' (contado '+fmt(closed.countedAmount)+')');
    renderAll();
    toast('A contagem não confere. O caixa fica travado até liberar.', 'error');
    return 'travado';
  }
  // cofre (16/11): o servidor diz quanto fica de troco e quanto vai ao cofre (fim da noite); o aparelho só mostra.
  if(data.cofre){ closed.troco = Number(data.cofre.troco)||0; closed.paraCofre = Number(data.cofre.paraCofre)||0; }
  state.cashHistory.unshift({ ...closed, caixaId:cx });
  aplicarTurnoDoCaixa(cx, null);
  return 'fechado';
}

// OP-13: pagamento parcial de comanda entra no caixa na hora (movimento origin 'parcial'), por
// forma de pagamento; quando a comanda fecha, essas linhas vêm marcadas partial:true na venda e
// não são contadas de novo. Estorno de parcial ('parcial-estorno') desconta da mesma forma.
// OP-14 (decisão do dono, 10/10): comanda de sócio pode ficar aberta depois do fechamento do
// caixa; ela conta no fechamento do dia em que abriu, como "a receber". Quando é paga num caixa
// seguinte, o dinheiro entra na gaveta daquele caixa mas aparece separado, como recebimento de
// dia anterior. Comanda avulsa (sem sócio) só paga à vista: o caixa não fecha com ela aberta.
// Totais por forma do caixa: as vendas fechadas na sessão sem as linhas de parcial, mais os
// parciais (e seus estornos) que entraram no caixa como movimento. Tela do caixa aberto e fechamento.
function isPartialMovement(m){ return m.origin==='parcial' || m.origin==='parcial-estorno'; }
function cashSessionTotals(sales, movements){
  const totals = somaPorForma(sales, {pularParcial:true});
  movements.filter(isPartialMovement).forEach(m=>{ totals[methodBucket(m.method||'dinheiro')] += (m.origin==='parcial-estorno'?-1:1)*(Number(m.amount)||0); });
  return totals;
}
// 09/11 (pedido do dono): o mesmo cálculo por forma (uma chave por method) para o fechamento ter uma
// linha por forma: vendas sem as linhas de parcial, mais os movimentos parciais e seus estornos.
function cashPorMetodo(sales, movements){
  const por = somaPorMetodo(sales, {pularParcial:true});
  movements.filter(isPartialMovement).forEach(m=>{ const k=normalizarMetodo(m.method||'dinheiro')||'dinheiro'; por[k]=(por[k]||0)+(m.origin==='parcial-estorno'?-1:1)*(Number(m.amount)||0); });
  return por;
}
// Campos de contagem do fechamento: Dinheiro (cashCountedAmount) e as outras formas conferidas pelo
// operador (cashCounted-<índice da linha>). Forma "admin" ou "ninguem" não pede contagem.
// 09/11: forma tipo Fiado nunca pede contagem, mesmo com confere=operador.
function cashCountFields(snap){
  const campos=[];
  // Caixa por operador (13/11): a trava do fechamento compara o dinheiro, então o dinheiro sempre é contado.
  const dinheiroSempre = modoCaixaPorOperador();
  snap.linhas.forEach((l,i)=>{ if(l.fiado||l.tipo==='fiado') return; if(l.confere!=='operador' && !(dinheiroSempre && l.method==='dinheiro')) return; campos.push({id:l.method==='dinheiro'?'cashCountedAmount':'cashCounted-'+i,method:l.method,label:l.label}); });
  return campos;
}
// Lê os campos de contagem; devolve {method:valor} ou null (com aviso) se algum faltar.
function lerContagensCaixa(snap){
  const lidos={};
  for(const c of cashCountFields(snap)){
    const el=document.getElementById(c.id),v=el?parseFloat(el.value):NaN;
    if(!Number.isFinite(v)||v<0){ toast(c.method==='dinheiro'?'Informe o dinheiro contado na gaveta.':'Informe o valor contado de '+c.label+'.'); el&&el.focus(); return null; }
    lidos[c.method]=v;
  }
  return lidos;
}
function montarContagens(snap,lidos){
  return snap.linhas.filter(l=>!l.fiado).map(l=>{ const contado=Object.prototype.hasOwnProperty.call(lidos,l.method)?lidos[l.method]:null; return {method:l.method,label:l.label,esperado:l.valor,contado,diff:contado===null?null:arredondaCentavos(contado-l.valor)}; });
}
// Histórico do Caixa: as formas do fechamento em uma linha de texto; sessão antiga (sem porForma) mostra "—".
function resumoPorForma(c){
  if(!c||!c.porForma) return '—';
  // Dinheiro como no fechamento: o esperado da gaveta (inclui troco inicial, entradas e fiado em dinheiro).
  const base=c.expectedAmount!=null?{...c.porForma,dinheiro:c.expectedAmount}:c.porForma;
  const t=linhasPorForma(base,c.fiadoPorForma).filter(l=>Math.abs(l.valor)>=0.005).map(l=>l.label+' '+fmt(l.valor));
  return t.length?t.join(' · '):'—';
}
// 09/11 (pedido do dono): "Finalizar e imprimir" imprime o resumo do fechamento (operador, datas e uma linha
// por forma). A janela do fechamento já foi fechada quando a impressão roda, então o resumo vem de um bloco
// só de impressão (#cashPrintSheet). Operador às cegas: só o contado, sem esperado nem diferença.
function htmlImpressaoFechamento(closed){
  const ve=podeVerTotaisDoCaixa(), cont=(closed.contagens||[]), fia=linhasPorForma({}, closed.fiadoPorForma).filter(l=>l.fiado);
  let tabela;
  if(ve){
    const rows=cont.map(c=>`<tr><td>${h(c.label)}</td><td class="mono">${fmt(c.esperado)}</td><td class="mono">${c.contado!=null?fmt(c.contado):'—'}</td><td class="mono">${c.diff!=null?(Math.abs(c.diff)<0.01?'Confere':(c.diff<0?'Falta ':'Sobra ')+fmt(Math.abs(c.diff))):'—'}</td></tr>`).concat(fia.map(l=>`<tr><td>${h(l.label)}</td><td class="mono">${fmt(l.valor)}</td><td colspan="2">recebido, fora do total vendido</td></tr>`));
    tabela=`<table><thead><tr><th>Forma</th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  } else {
    const rows=cont.filter(c=>c.contado!=null).map(c=>`<tr><td>${h(c.label)}</td><td class="mono">${fmt(c.contado)}</td></tr>`);
    tabela=rows.length?`<table><thead><tr><th>Forma</th><th>Contado</th></tr></thead><tbody>${rows.join('')}</tbody></table>`:'<p>Contagem registrada.</p>';
  }
  // cofre (16/11): só no fechamento de fim da noite (o servidor grava troco e paraCofre).
  const cofre=closed.fimDaNoite&&typeof closed.paraCofre==='number'?`<p>Troco na gaveta: <b>${fmt(Number(closed.troco)||0)}</b><br>Para o cofre: <b>${fmt(closed.paraCofre)}</b></p>`:'';
  return `<h2>Fechamento do Caixa</h2><p>Operador: ${h(closed.operatorName||closed.closedBy||'—')} · Fechado por: ${h(closed.closedBy||'—')}<br>Aberto em ${dataHoraBR(closed.openedAt)} · Fechado em ${dataHoraBR(closed.closedAt)}</p>${tabela}${cofre}`;
}
function imprimirFechamentoCaixa(closed){
  const bloco=document.createElement('div'); bloco.id='cashPrintSheet'; bloco.innerHTML=htmlImpressaoFechamento(closed);
  document.body.appendChild(bloco); document.body.classList.add('imprimindo-fechamento');
  try{ window.print(); } finally { document.body.classList.remove('imprimindo-fechamento'); bloco.remove(); }
}
function cashOpenComandas(){ return state.sales.filter(sl=>sl.status==='open'&&!sl.canceled&&sl.type==='comanda'); }
// Revisão final, item 6: o que falta na comanda aberta é o mesmo valor que ela mostra (desconto do
// colaborador, crédito e serviço), por comandaOpenDue. Antes era sl.total - parciais e o fechamento
// listava a comanda do colaborador sem o desconto.
function comandaDue(sl){ return comandaOpenDue(sl); }
function lastCashCloseBefore(session){ const opened=new Date(session.openedAt).getTime(); let last=null; (state.cashHistory||[]).forEach(c=>{ const t=new Date(c.closedAt).getTime(); if(Number.isFinite(t)&&t<=opened&&(last===null||t>last)) last=t; }); return last; }
function saleOpenedBeforeClose(sl,lastClose){ return lastClose!==null && !!sl.openedAt && new Date(sl.openedAt).getTime()<lastClose; }
function cashClosingSnapshot(){const s=state.cashSession;if(!s)return null;const sales=state.sales.filter(sl=>vendaEntraNoCaixa(sl,s));const movements=state.cashMovements.filter(m=>m.cashSessionId===s.id),totals=cashSessionTotals(sales,movements),manual=movements.filter(m=>!isPartialMovement(m));const suprimentos=manual.filter(m=>m.type==='suprimento').reduce((a,m)=>a+(Number(m.amount)||0),0),sangrias=manual.filter(m=>m.type==='sangria').reduce((a,m)=>a+(Number(m.amount)||0),0),cashIn=manual.filter(m=>m.type==='suprimento'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+(Number(m.amount)||0),0),diarias=manual.filter(ehPagamentoDeFuncionario).reduce((a,m)=>a+(Number(m.amount)||0),0),cashOut=manual.filter(m=>m.type==='sangria'&&(!m.method||m.method==='dinheiro')).reduce((a,m)=>a+(Number(m.amount)||0),0),totalVendido=Object.values(totals).reduce((a,b)=>a+b,0),money=(Number(s.openingAmount)||0)+totals.dinheiro+cashIn-cashOut,final=(Number(s.openingAmount)||0)+totalVendido+suprimentos-sangrias;const lastClose=lastCashCloseBefore(s),earlier=sales.filter(sl=>saleOpenedBeforeClose(sl,lastClose)),earlierReceived=Math.round(earlier.reduce((a,sl)=>a+(sl.payments||[]).filter(p=>!p.partial&&methodBucket(p.method)!=='fiado').reduce((b,p)=>b+(Number(p.amount)||0),0),0)*100)/100,open=esteEOUltimoTurnoAberto()?cashOpenComandas():[]/* caixa por operador (13/11): comandas abertas só no fechamento do último turno aberto, para não contar duas vezes */,openToday=open.filter(sl=>!saleOpenedBeforeClose(sl,lastClose)),openEarlier=open.filter(sl=>saleOpenedBeforeClose(sl,lastClose)),openTotal=Math.round(openToday.reduce((a,sl)=>a+comandaDue(sl),0)*100)/100;const porForma=cashPorMetodo(sales,movements),fiadoPorForma=recebimentosFiadoPorMetodo(movements),linhas=linhasPorForma({...porForma,dinheiro:money},fiadoPorForma);return{s,totals,porForma,fiadoPorForma,linhas,suprimentos,sangrias,diarias,totalVendido,money,final,earlierReceived,earlierCount:earlier.length,openToday,openEarlier,openTotal};}
// PROD-05 (decisão do dono: conferência às cegas obrigatória). Antes o "dinheiro esperado"
// aparecia antes da contagem e o operador tendia a "achar" o valor esperado. Agora: 1) conta
// a gaveta e as formas que o administrador marcou como "operador" (09/11: uma linha por forma, no lugar
// do total da maquininha) sem ver o esperado; 2) "Conferir" mostra esperado x contado por forma
// (o operador às cegas vê só o que contou); 3) só então finaliza. As contagens ficam no histórico.
async function openCloseCashModal(){if(isCloudMode()){await refreshCashState();if(!state.cashSession){renderAll();toast('Este caixa já foi fechado em outro aparelho.','error');return;}}/* caixa por operador (13/11): turno travado não fecha por aqui */if(modoCaixaPorOperador()&&(!state.cashSession||state.cashSession.status!=='open')){renderAll();toast('Este caixa está travado. Resolva a contagem antes de fechar.','error');return;}await fetchFreshSales();const avulsas=cashOpenComandas().filter(sl=>!sl.memberId);if(avulsas.length&&esteEOUltimoTurnoAberto()){openModal('Comandas avulsas em aberto',`<p class="sub">Cliente avulso só paga à vista. Receba ou cancele ${avulsas.length===1?'esta comanda':'estas '+avulsas.length+' comandas'} antes de fechar o caixa.</p><div class="cash-open-list">${avulsas.map(sl=>`<button type="button" class="cash-open-row" onclick="closeModal();openComanda(${jsArg(sl.id)})"><span>#${h(sl.orderNumber||'—')} · ${h(sl.customerName||'Avulso')}</span><span class="mono">${fmt(comandaDue(sl))}</span></button>`).join('')}</div><div class="cash-close-actions"><button onclick="closeModal()">‹ &nbsp; Voltar</button></div>`);return;}const snap=cashClosingSnapshot();if(!snap)return;const campos=cashCountFields(snap);openModal('Fechamento do Caixa',`<div class="cash-close-body"><h2>Conte o caixa antes de conferir</h2><p class="sub">${campos.length?'Informe o que você contou. Quem pode ver os totais do caixa vê o esperado e a diferença depois de conferir; o operador às cegas vê só o que contou.':'Não há contagem a informar neste fechamento. Toque em Conferir contagem para seguir.'}</p>${modoCaixaPorOperador()?`<div class="cash-fech-tipo" style="display:grid;gap:8px;margin:10px 0"><label><input type="radio" name="cashFechTipo" value="passagem" onchange="cashFechTipoMudou()"> Passar o caixa (troca de operador)${contarNaTroca()?'':' — sem contagem'}</label><label><input type="radio" name="cashFechTipo" value="fim" onchange="cashFechTipoMudou()"> Fechar no fim da noite (o que passar do troco vai para o cofre)</label></div><p class="cash-close-note" id="cashSemContagemAviso" hidden>Passagem sem contagem: quem entra continua com o dinheiro da gaveta. A contagem fica para o fechamento do fim da noite.</p>`:''}<div class="cash-count-grid">${campos.map(c=>`<div class="field"><label>${c.method==='dinheiro'?'Dinheiro contado na gaveta':h(c.label)+' contado'} *</label><input id="${c.id}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div>`).join('')}</div><div id="cashCheckResult" hidden></div><div class="cash-close-actions" id="cashCloseStep1"><button onclick="closeModal()">‹ &nbsp; Voltar</button><button class="primary" onclick="checkCashCount()">Conferir contagem</button></div><div class="cash-close-actions" id="cashCloseStep2" hidden><button onclick="editCashCount()">‹ &nbsp; Corrigir contagem</button><button onclick="finalizeCashSession(true)">▣ &nbsp; Finalizar e imprimir</button><button class="primary" onclick="finalizeCashSession(false)">✓ &nbsp; Finalizar</button></div></div>`);document.querySelector('#modalRoot .modal').classList.add('cash-close-modal');setTimeout(()=>document.querySelector('.cash-count-grid input')?.focus(),50);}
function checkCashCount(){
  const snap=cashClosingSnapshot(); if(!snap) return;
  if(modoCaixaPorOperador() && !escolhaDoFechamento()){ toast('Escolha: passar o caixa ou fechar no fim da noite.'); return; } // cofre (16/11)
  const semContar=passagemSemContagem(); // 26/11
  const lidos=semContar?{}:lerContagensCaixa(snap); if(!lidos) return;
  const ve=podeVerTotaisDoCaixa(), contagens=montarContagens(snap,lidos), box=document.getElementById('cashCheckResult');
  // 09/11 (pedido do dono): uma linha por forma. O operador às cegas não vê esperado nem diferença de
  // nenhuma forma, nem depois de contar: só o que ele informou. Quem pode ver os totais vê tudo.
  const celula=(l)=>{
    if(l.fiado) return `<tr><td>${h(l.label)}</td><td class="mono">${fmt(l.valor)}</td><td class="sub" colspan="2">recebido, fora do total vendido</td></tr>`;
    const c=contagens.find(x=>x.method===l.method);
    if(!c||c.contado===null) return `<tr><td>${h(l.label)}</td><td class="mono">${fmt(l.valor)}</td><td class="sub">${l.confere==='admin'?'conferido pelo administrador':'—'}</td><td></td></tr>`;
    const d=c.diff;
    return `<tr><td>${h(l.label)}</td><td class="mono">${fmt(l.valor)}</td><td class="mono">${fmt(c.contado)}</td><td class="mono ${Math.abs(d)<0.01?'cash-ok':d<0?'cash-short':'cash-over'}">${Math.abs(d)<0.01?'Confere':(d<0?'Falta ':'Sobra ')+fmt(Math.abs(d))}</td></tr>`;
  };
  const tabela=ve
    ? `<table class="cash-check-table"><thead><tr><th></th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead><tbody>${snap.linhas.map(celula).join('')}</tbody></table><p class="cash-close-note">Esperado em dinheiro = troco inicial + vendas e entradas em dinheiro − sangrias em dinheiro. Fiado recebido em outra forma aparece como "forma fiado" e não entra no total vendido. Vendido no fiado (a receber): ${fmt(snap.totals.fiado)}</p>`
    : (contagens.some(c=>c.contado!==null)
        ? `<table class="cash-check-table"><thead><tr><th></th><th>Contado</th></tr></thead><tbody>${contagens.filter(c=>c.contado!==null).map(c=>`<tr><td>${h(c.label)}</td><td class="mono">${fmt(c.contado)}</td></tr>`).join('')}</tbody></table>`
        : '')+'<p class="cash-close-note">Contagem registrada. O resultado da conferência fica com o administrador.</p>';
  box.innerHTML=`${semContar?'<p class="cash-close-note"><b>Passagem sem contagem.</b> O caixa vai para a próxima pessoa com o dinheiro que está na gaveta.</p>':''}${tabela}${snap.diarias&&ve?`<p class="cash-close-note">${snap.sangrias-snap.diarias>TOLERANCIA_CENTAVO?`Retiradas: ${fmt(snap.sangrias-snap.diarias)}<br>`:''}${rotuloPagFuncionario()}: ${fmt(snap.diarias)}</p>`:''}${snap.earlierReceived>TOLERANCIA_CENTAVO&&ve?`<p class="cash-close-note">Inclui ${fmt(snap.earlierReceived)} de ${snap.earlierCount===1?'1 comanda aberta':snap.earlierCount+' comandas abertas'} em dia anterior (já contadas no fechamento daquele dia).</p>`:''}${snap.openToday.length?`<div class="cash-open-summary"><b>Comandas que continuam abertas (a receber): ${fmt(snap.openTotal)}</b><p class="sub">Contam neste fechamento. Quando forem pagas, o valor entra no caixa do dia.</p><div class="cash-open-list">${snap.openToday.map(sl=>`<div class="cash-open-row"><span>#${h(sl.orderNumber||'—')} · ${h(sl.customerName||'—')}</span><span class="mono">${fmt(comandaDue(sl))}</span></div>`).join('')}</div></div>`:''}${snap.openEarlier.length?`<p class="cash-close-note">Ainda abertas de dias anteriores: ${snap.openEarlier.map(sl=>'#'+h(sl.orderNumber||'—')+' '+h(sl.customerName||'')).join(', ')} (já contadas no dia em que abriram).</p>`:''}`;
  box.hidden=false;
  document.querySelectorAll('.cash-count-grid input').forEach(i=>i.readOnly=true);
  document.querySelectorAll('input[name="cashFechTipo"]').forEach(i=>i.disabled=true);
  document.getElementById('cashCloseStep1').hidden=true; document.getElementById('cashCloseStep2').hidden=false;
}
function editCashCount(){
  document.querySelectorAll('.cash-count-grid input').forEach(i=>i.readOnly=false);
  document.querySelectorAll('input[name="cashFechTipo"]').forEach(i=>i.disabled=false);
  document.getElementById('cashCheckResult').hidden=true;
  document.getElementById('cashCloseStep1').hidden=false; document.getElementById('cashCloseStep2').hidden=true;
  document.querySelector('.cash-count-grid input')?.focus();
}
async function finalizeCashSession(printAfter){const snap=cashClosingSnapshot();if(!snap)return;const step2=document.getElementById('cashCloseStep2');if(step2&&step2.hidden){checkCashCount();return;}const semContar=passagemSemContagem();/* 26/11 */const lidos=semContar?{}:lerContagensCaixa(snap);if(!lidos)return;const contagens=montarContagens(snap,lidos),countedAmount=Object.prototype.hasOwnProperty.call(lidos,'dinheiro')?lidos.dinheiro:null,countedCard=null,diff=countedAmount===null?null:countedAmount-snap.money;const closed={...snap.s,status:'closed',closedAt:new Date().toISOString(),totals:snap.totals,porForma:snap.porForma,fiadoPorForma:snap.fiadoPorForma,contagens,suprimentos:snap.suprimentos,sangrias:snap.sangrias,diarias:snap.diarias,countedAmount,expectedAmount:snap.money,diff,countedCard,expectedCard:snap.totals.cartao,blindCount:true,closedBy:currentUser.name,earlierReceived:snap.earlierReceived,openComandas:snap.openToday.map(sl=>({id:sl.id,orderNumber:sl.orderNumber||null,name:sl.customerName||'',memberId:sl.memberId||null,due:comandaDue(sl),openedAt:sl.openedAt})),openComandasTotal:snap.openTotal};if(modoCaixaPorOperador()){const esc=escolhaDoFechamento();if(!esc){toast('Escolha: passar o caixa ou fechar no fim da noite.');return;}closed.fimDaNoite=esc==='fim';/* cofre (16/11) */if(semContar){closed.semContagem=true;closed.countedAmount=snap.money;closed.diff=null;}/* 26/11: o servidor grava contado = esperado */if(await fecharTurnoDoCaixa(closed)!=='fechado')return;}else if(isCloudMode()){/* BD-03: fecha só se o caixa aberto no servidor ainda for este; o histórico dos outros não é regravado */await save('cashMovements');const {data,error}=await supabaseClient.rpc('cash_session_close',{p_session_id:closed.id,p_closed:closed});if(error||!data){toast('Não foi possível fechar o caixa: '+((error&&error.message)||'erro no servidor')+'. Tente de novo.','error');return;}if(!data.ok){document.getElementById('modalRoot').innerHTML='';await refreshCashState();renderAll();toast('Este caixa já foi fechado em outro aparelho. Confira em Relatórios › Histórico do Caixa.','error');return;}state.cashHistory.unshift(closed);state.cashSession=null;}else{state.cashHistory.unshift(closed);state.cashSession=null;save('cashHistory');save('cashSession');}document.getElementById('modalRoot').innerHTML='';const temDiff=diff!==null&&Math.abs(diff)>=0.01;logAction('Caixa fechado'+(countedAmount!==null?' — contado '+fmt(countedAmount):'')+(temDiff?' (diferença '+fmt(diff)+')':''));renderAll();toast(temDiff&&podeVerTotaisDoCaixa()?'Caixa fechado com diferença de '+fmt(diff)+'.':(modoCaixaPorOperador()&&!closed.fimDaNoite?(closed.semContagem?'Caixa passado sem contagem.':'Caixa passado.'):'Caixa fechado.'));if(modoCaixaPorOperador()&&closed.fimDaNoite&&typeof closed.paraCofre==='number')avisoSeparaCofre(closed.troco||0,closed.paraCofre);if(printAfter)setTimeout(()=>imprimirFechamentoCaixa(closed),100);}
// Dois toques em Finalizar: o segundo esperaria a resposta do primeiro e diria "já fechado em outro aparelho".
const _finalizeCashSessionOnce=finalizeCashSession;let _closingCash=false;
finalizeCashSession=async function(printAfter){if(_closingCash)return;_closingCash=true;try{return await _finalizeCashSessionOnce(printAfter);}finally{_closingCash=false;}};
// OP-17 (decisão do dono: só admin): sangria/suprimento já lançados só são editados ou
// excluídos por administrador ou dono; os automáticos (fiado, troco, estorno) não se
// apagam à mão — estorna-se pela origem, para o caixa e o fiado continuarem batendo.
// cofre (16/11): a diária de freelancer (categoria 'diaria') e o pagamento de funcionário ('funcionario') são a mesma
// linha no resumo e nos relatórios; o rótulo muda só com o caixa por operador ligado.
function ehPagamentoDeFuncionario(m){ return !!m && m.type==='sangria' && (m.categoria==='diaria' || m.categoria==='funcionario'); }
function rotuloPagFuncionario(){ return modoCaixaPorOperador() ? 'Pagamentos de funcionário' : 'Diárias de freelancer'; }
function cashMovementEditable(m){
  if(m && m.origin==='cofre'){ toast('Lançamento do cofre: não pode ser alterado aqui. Acerte na confirmação do recolhimento.'); return false; } // cofre (16/11)
  if(m && m.origin){ toast('Lançamento automático ('+(m.origin==='troco'?'troco':'fiado')+'): não pode ser alterado aqui. Estorne pela origem.'); return false; }
  if(!(currentUser && (currentUser.role==='admin' || sessionIsOwner))){ toast('Só o administrador pode alterar ou excluir lançamentos do caixa.'); return false; }
  return true;
}
function openCashMovementModal(initialType,movementId){
  if(!state.cashSession){ toast('Abra o caixa primeiro.'); return; }
  if(caixaTravadoAqui()){ toast(textoCaixaTravado()); return; } // caixa por operador (13/11): travado não recebe lançamento
  if(currentUser && currentUser.role==='garcom'){ toast('Garçom não mexe no caixa.'); return; } // 08/11 (pedido do dono): garçom nunca lança dinheiro
  if(movementId){ const m=state.cashMovements.find(x=>x.id===movementId); if(m && !cashMovementEditable(m)) return; }
  // cofre (16/11): com o modo ligado são quatro tipos (Entrada, Sangria, Pagamento de funcionário e, só administrador, Outro pagamento).
  // A "diária de freelancer" vira "Pagamento de funcionário" (mesmo campo de nome). Desligado, o formulário é o de sempre.
  const ligado=modoCaixaPorOperador(),admin=podeVerTotaisDoCaixa(),idDaSaida=uid()/* gerado UMA vez: repetir o envio não grava duas vezes */;
  const item=movementId?state.cashMovements.find(x=>x.id===movementId&&x.cashSessionId===state.cashSession.id):null,now=item?new Date(item.at):new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const kindOf=m=>m.type!=='sangria'?m.type:(m.categoria==='diaria'||m.categoria==='funcionario')?(ligado?'funcionario':'diaria'):(ligado&&m.categoria==='outro'&&admin)?'outro':'sangria';
  const selected=item?kindOf(item):(initialType==='diaria'?(ligado?'funcionario':'diaria'):(initialType==='sangria'||initialType==='funcionario'||(initialType==='outro'&&ligado&&admin))?initialType:'suprimento');
  const radio=(v,t)=>`<label><input type="radio" name="cmType" value="${v}" ${selected===v?'checked':''}> ${t}</label>`;
  const radios=ligado?radio('suprimento','Entrada no caixa')+radio('sangria','Sangria (vai para o cofre)')+radio('funcionario','Pagamento de funcionário')+(admin?radio('outro','Outro pagamento (só administrador)'):''):radio('suprimento','Entrada no caixa')+radio('sangria','Saída do caixa')+radio('diaria','Diária de freelancer');
  openModal('Novo Lançamento', `<div class="cash-entry-body"><div class="cash-entry-kind">${radios}</div><div class="cash-entry-form"><div class="field"><label>Data / Hora</label><input id="cmAt" type="datetime-local" value="${local}"></div><div class="field"><label>Forma de pagamento</label><select id="cmMethod"><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="pix">Pix</option><option value="outro:Cheque">Cheque</option><option value="outro:Vale">Vale / Recibo</option><option value="outro:Outro">Outro</option></select></div><div class="field span2" id="cmPessoaBox" hidden><label>${ligado?'Nome de quem recebeu *':'Nome do freelancer *'}</label><input id="cmPessoa" maxlength="60" placeholder="${ligado?'Quem recebeu o pagamento':'Quem recebeu a diária'}"></div><div class="field span2" id="cmReasonBox"><label id="cmReasonLabel">Descrição</label><input id="cmReason" placeholder="Informe a descrição do lançamento"></div><div class="field"><label>Valor</label><input id="cmAmount" type="number" min="0.01" step="0.01" placeholder="0,00"></div><div class="field"><label>Operador</label><input value="${h(currentUser.name)}" disabled></div><div class="field span2"><label>Observação</label><textarea id="cmNote" rows="3" placeholder="Informações complementares (opcional)"></textarea></div></div><div class="cash-entry-actions"><button class="op-btn" onclick="closeModal()">‹ &nbsp; Voltar</button><button class="op-btn primary" id="cmSaveBtn">✓ &nbsp; Salvar</button></div></div>`);
  document.querySelector('#modalRoot .modal').classList.add('cash-entry-modal');
  // 08/11 (pedido do dono): diária de freelancer é dinheiro tirado da gaveta com o nome de quem recebeu;
  // fica separada das outras retiradas no fechamento. Grava como sangria (categoria 'diaria'), sem migration.
  // cofre (16/11): no modo ligado o mesmo campo serve ao "Pagamento de funcionário" (categoria 'funcionario').
  const syncDiaria=()=>{const k=document.querySelector('input[name="cmType"]:checked').value,d=k==='diaria'||k==='funcionario';document.getElementById('cmPessoaBox').hidden=!d;document.getElementById('cmReasonBox').hidden=d;document.getElementById('cmMethod').disabled=d;if(d)document.getElementById('cmMethod').value='dinheiro';document.getElementById('cmReasonLabel').textContent=k==='outro'?'Motivo do pagamento *':'Descrição';};
  document.querySelectorAll('input[name="cmType"]').forEach(r=>r.addEventListener('change',syncDiaria));
  if(item){document.querySelector('#modalRoot .modal-title').textContent='Editar Lançamento';document.getElementById('cmMethod').value=item.method||'dinheiro';document.getElementById('cmReason').value=item.description||item.reason||'';document.getElementById('cmAmount').value=Number(item.amount)||0;document.getElementById('cmNote').value=item.note||'';if(item.categoria==='diaria'||item.categoria==='funcionario')document.getElementById('cmPessoa').value=item.pessoa||'';}
  syncDiaria();
  const salvar=singleFlight('cmSalvar',async()=>{
    const kind=document.querySelector('input[name="cmType"]:checked').value,isDiaria=kind==='diaria'||kind==='funcionario',type=(isDiaria||kind==='outro')?'sangria':kind,amount=parseFloat(document.getElementById('cmAmount').value),pessoa=isDiaria?document.getElementById('cmPessoa').value.trim():'',description=isDiaria?(pessoa?(ligado?'Pagamento de funcionário: ':'Diária de freelancer: ')+pessoa:''):document.getElementById('cmReason').value.trim(),method=isDiaria?'dinheiro':document.getElementById('cmMethod').value,atValue=document.getElementById('cmAt').value,note=document.getElementById('cmNote').value.trim();
    if(isDiaria && !pessoa){ toast(ligado?'Informe o nome de quem recebeu.':'Informe o nome do freelancer.'); return; }
    if(ligado && kind==='outro' && !description){ toast('Informe o motivo do pagamento.'); return; }
    if(!amount || amount<=0 || (!description && !(ligado&&kind==='sangria')) || !atValue){ toast('Informe data, descrição e valor válido.'); return; }
    const at=new Date(atValue);if(Number.isNaN(at.getTime())){toast('Informe uma data e hora válidas.');return;}
    const categoria=kind==='diaria'?'diaria':kind==='funcionario'?'funcionario':(ligado&&kind==='outro')?'outro':null;
    const label=kind==='diaria'?'Diária':kind==='funcionario'?'Pagamento de funcionário':kind==='outro'?'Outro pagamento':type==='suprimento'?'Entrada':(kind==='sangria'&&ligado)?'Sangria':'Saída';
    // cofre (16/11): saída nova, no modo ligado, só grava pelo servidor (ele cuida da gaveta e do cofre juntos).
    if(ligado && !item && type==='sangria'){
      const ok=await lancarSaidaDoTurno({id:idDaSaida,categoria:kind==='sangria'?'sangria':kind==='funcionario'?'funcionario':'outro',amount,method,description,pessoa,note,at:at.toISOString()});
      if(!ok)return;
      closeModal();selectedCashMovementId=null;logAction(label.toLowerCase()+' de caixa — '+fmt(amount));renderAll();toast(label+' registrada.');return;
    }
    const data={cashSessionId:state.cashSession.id,type,amount,reason:description,description,method,note,...(categoria?{categoria,...(isDiaria?{pessoa}:{})}:{}),operatorId:currentUser.id,operatorName:currentUser.name,at:at.toISOString()};if(item){const cur=state.cashMovements.find(x=>x.id===item.id);if(!cur){toast('Este lançamento foi apagado em outro aparelho.','error');closeModal();renderAll();return;}if(!categoria)delete cur.categoria;if(!isDiaria)delete cur.pessoa;Object.assign(cur,data,{editedAt:new Date().toISOString(),editedBy:currentUser.name});}else state.cashMovements.unshift({id:uid(),...data});
    save('cashMovements');closeModal();selectedCashMovementId=null;logAction((item?'Edição de ':'')+label.toLowerCase()+' de caixa — '+fmt(amount));renderAll();toast(item?'Lançamento atualizado.':label+' registrada.');
  });
  document.getElementById('cmSaveBtn').onclick = salvar;
}
// caixa por operador (13/11): "PIN: Ana 21:10" / "Dono 21:12"; vazio nos fechamentos sem liberação (e nos antigos).
function textoLiberacoes(fc){
  return (Array.isArray(fc&&fc.liberacoes)?fc.liberacoes:[]).map(l=>(l.como==='dono'?'Dono':'PIN: '+(l.porNome||'—'))+(l.at?' '+timeFmt(l.at):'')).join('; ');
}
function renderCashHistoryPanel(){
  if(!state.cashHistory.length || !podeVerTotaisDoCaixa()) return ''; // 06/11: vendido/contado/diferença só para admin/dono
  const rows = state.cashHistory.slice(0,10).map(fc=>`
    <tr><td>${new Date(fc.openedAt).toLocaleDateString('pt-BR')}</td><td>${fc.caixaId?h(nomeDoCaixa(fc.caixaId)):'—'}</td><td class="mono">${fmt(fc.openingAmount)}</td>
    <td class="mono">${fmt(Object.values(fc.totals||{}).reduce((a,b)=>a+b,0))}</td><td class="mono">${fc.countedAmount!=null?fmt(fc.countedAmount):'—'}</td>
    <td class="mono" style="color:${fc.diff==null||Math.abs(fc.diff)<0.01?'var(--green)':'var(--red)'}">${fc.diff!=null?fmt(fc.diff):'—'}</td>
    <td>${h(fc.closedBy||'—')}</td><td>${h(textoLiberacoes(fc))}</td><td class="sub">${h(resumoPorForma(fc))}</td></tr>`).join('');
  return `<div class="panel"><h2>Histórico de fechamentos</h2>
    <table><tr><th>Data</th><th>Caixa</th><th>Abertura</th><th>Vendido</th><th>Contado</th><th>Diferença</th><th>Fechado por</th><th>Liberação</th><th>Por forma</th></tr>${rows}</table></div>`;
}

