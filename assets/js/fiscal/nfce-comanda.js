// ---------- t207: NFC-e da comanda (Edge Function "nfce"; por enquanto só homologação) ----------
function nfceCanUse(sale){ return !!(sale && sale.status==='closed' && !sale.canceled && isCloudMode() && supabaseClient && ((currentUser && (currentUser.role==='admin'||currentUser.role==='caixa')) || sessionIsOwner)); }
async function nfceCall(action, saleId, extra){
  try{
    const { data, error } = await supabaseClient.functions.invoke('nfce', { body:{ action, sale_id:saleId, ...(extra||{}) } });
    if(error){
      let j = null; try{ j = await error.context.json(); }catch(e){}
      if(j && j.error) return { error:j.error, problemas:j.problemas||[] };
      return { error: /Failed to send|fetch/i.test(error.message||'') ? 'Sem conexão com o servidor. Confira a internet.' : 'O emissor de NFC-e ainda não está ativo no servidor.' };
    }
    return data || {};
  }catch(e){ return { error:'Sem conexão com o servidor. Confira a internet.' }; }
}
// Prazo da SEFAZ para cancelar NFC-e: 30 minutos depois da autorização.
const NFCE_CANCEL_MIN = 30;
function nfceMinutesSince(t){ return t ? Math.floor((Date.now() - new Date(t).getTime())/60000) : Infinity; }
function nfceNotaHtml(n){
  const amb = n.ambiente===2 ? ' <span class="tag tag-gray">homologação (teste)</span>' : '';
  const when = n.created_at ? reportDateTime(n.created_at) : '';
  if(n.status==='cancelada') return `<p style="margin:4px 0"><span class="tag tag-gray">⊘ Cancelada</span>${amb} nº ${h(String(n.numero||'—'))} · série ${h(String(n.serie||'—'))}<br><span class="sub">Cancelada ${n.cancelada_em?h(reportDateTime(n.cancelada_em)):''}${n.cancelada_por?' por '+h(n.cancelada_por):''}: ${h(n.cancel_motivo||'')}</span></p>`;
  if(n.status==='autorizada'){
    const left = NFCE_CANCEL_MIN - nfceMinutesSince(n.created_at);
    return `<p style="margin:4px 0"><span class="tag tag-green">✓ Autorizada</span>${amb} nº ${h(String(n.numero||'—'))} · série ${h(String(n.serie||'—'))} · ${h(when)}<br><span class="sub mono" style="word-break:break-all">Chave ${h(n.chave||'—')}</span></p>
    ${n.id?`<button class="op-btn" onclick="printNfceDanfe(${jsArg(n.id)})">▣ &nbsp; Imprimir cupom da NFC-e</button>`:''}
    ${left>0?`<button class="op-btn" onclick="openCancelNfce(${jsArg(n.sale_id)})">⊘ &nbsp; Cancelar NFC-e (faltam ${left} min)</button>`:'<span class="sub">Prazo de cancelamento (30 min) encerrado.</span>'}`;
  }
  return `<p style="margin:4px 0"><span class="tag tag-red">✗ ${n.status==='rejeitada'?'Recusada pela SEFAZ':'Falha no envio'}</span>${amb} ${h(when)}<br><span class="sub">${n.cod_status?h(String(n.cod_status))+' · ':''}${h(n.motivo||'')}</span></p>`;
}
async function loadNfceBox(saleId, flash){
  const box = document.getElementById('nfceBox'); if(!box) return;
  const r = await nfceCall('consultar', saleId);
  if(document.getElementById('nfceBox')!==box) return;
  const notas = r.notas || [], ok = notas.find(n=>n.status==='autorizada');
  box.innerHTML = `<b>NFC-e</b>${flash||''}
    ${r.error?`<p class="sub" style="margin:4px 0">${h(r.error)}</p>`:notas.length?notas.slice(0,3).map(nfceNotaHtml).join(''):'<p class="sub" style="margin:4px 0">Nenhuma NFC-e emitida para esta comanda.</p>'}
    ${!ok&&!r.error?`<button class="op-btn" id="nfceEmitBtn" onclick="emitNfceForSale(${jsArg(saleId)})">▤ &nbsp; ${nfceSettings().ambiente===1?'Emitir NFC-e':'Emitir NFC-e de teste (homologação)'}</button>`:''}`;
}
function openCancelNfce(saleId){
  openModal('Cancelar NFC-e', `
    <p class="sub" style="margin-top:0">A SEFAZ aceita o cancelamento até 30 minutos depois da autorização. Depois de cancelada, a comanda pode receber uma NFC-e nova.</p>
    <div class="field"><label for="nfceCancelMotivo">Motivo (mínimo 15 letras) *</label><input id="nfceCancelMotivo" maxlength="255" placeholder="Ex.: pagamento lançado na forma errada"></div>
    <p id="nfceCancelErr" class="sub" style="color:var(--c-danger)" hidden></p>
    <div class="row"><button class="btn" id="nfceCancelBack">Voltar</button><button class="btn btn-danger-solid" id="nfceCancelBtn">Cancelar a NFC-e</button></div>`);
  document.getElementById('nfceCancelMotivo').focus();
  document.getElementById('nfceCancelBack').onclick = ()=>{ closeModal(); openOrderHistoryDetail(saleId); };
  document.getElementById('nfceCancelBtn').onclick = async ()=>{
    const motivo = document.getElementById('nfceCancelMotivo').value.trim(), err = document.getElementById('nfceCancelErr'), btn = document.getElementById('nfceCancelBtn');
    if(motivo.length<15){ err.hidden=false; err.textContent='Escreva o motivo com pelo menos 15 letras.'; return; }
    btn.disabled = true; btn.textContent = 'Cancelando…';
    const r = await nfceCall('cancelar', saleId, { justificativa: motivo });
    if(r.error){ err.hidden=false; err.textContent=r.error; btn.disabled=false; btn.textContent='Cancelar a NFC-e'; return; }
    toast('NFC-e cancelada.'); logAction('NFC-e cancelada: pedido '+saleId+' — '+motivo);
    closeModal(); openOrderHistoryDetail(saleId);
  };
}
// Reabrir comanda com NFC-e autorizada: dentro dos 30 min a nota é cancelada junto; depois, bloqueia.
async function nfceAutorizadaDaComanda(saleId){
  if(!isCloudMode() || !supabaseClient) return null;
  try{
    const { data } = await supabaseClient.from('nfce_notas').select('id, numero, serie, ambiente, created_at').eq('sale_id', saleId).eq('status','autorizada').order('created_at',{ascending:false}).limit(1);
    return (data && data[0]) || null;
  }catch(e){ return null; }
}
async function emitNfceForSale(saleId){
  const btn = document.getElementById('nfceEmitBtn'); if(btn){ btn.disabled = true; btn.textContent = 'Emitindo…'; }
  const r = await nfceCall('emitir', saleId);
  let flash = '';
  if(r.error){
    flash = `<div class="sub" style="margin:6px 0;color:var(--c-danger)">${h(r.error)}${(r.problemas||[]).length?'<ul style="margin:4px 0 0 18px">'+r.problemas.map(p=>'<li>'+h(p)+'</li>').join('')+'</ul>':''}</div>`;
  } else if(r.nota){
    toast(r.nota.status==='autorizada' ? 'NFC-e autorizada'+(r.nota.ambiente===2?' (homologação)':'')+'.' : 'A SEFAZ recusou a NFC-e: '+(r.nota.motivo||''));
    if(r.nota.status==='autorizada') logAction('NFC-e '+(r.nota.ambiente===2?'de teste ':'')+'autorizada: pedido '+saleId);
  }
  await loadNfceBox(saleId, flash);
}
