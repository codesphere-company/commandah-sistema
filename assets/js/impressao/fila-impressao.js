/* ============ FILA DE IMPRESSÃO (t215, 01/11) ============
   Pedido do dono no teste do caixa 2: o aviso "1 pedido não saiu na impressora" não dizia
   qual ficha era nem deixava fazer nada com ela. Esta parte de Configurações › Impressoras
   lista as fichas das últimas 24 h (padrão: só as que não saíram) e deixa reenviar ou
   descartar. Ler usa a policy print_jobs_select_por_papel (owner/admin/caixa); reenviar e
   descartar passam pela RPC print_job_resolve (migration 20261101000000), porque
   print_jobs não tem policy de UPDATE. */
let pqShowAll = false, pqJobs = null, pqError = '', pqTimer = null, pqBusy = {};
const PQ_WINDOW_H = 24;
const PQ_STALE_MS = 2*60*1000; // igual à RPC: 'processando' parado há mais de 2 min
const PQ_STATUS = {
  pendente:   { label:'Na fila',             cls:'tag-amber' },
  processando:{ label:'Imprimindo',          cls:'tag-blue' },
  impresso:   { label:'Impressa',            cls:'tag-green' },
  erro:       { label:'Erro',                cls:'tag-red' },
  descartado: { label:'Descartada',          cls:'tag-gray' }
};
// A ficha de impressora de rede vem em ESC/POS: tira os comandos para mostrar só o texto.
// QR Code da NFC-e (GS ( k ... 1P0 <dados>) vira "[QR Code]".
function pqPlainText(content){
  return String(content||'')
    .replace(/\x1D\(k[\s\S]{2}1P0[^\x1D]*/g, '\n[QR Code]\n')
    .replace(/\x1D\(k[\s\S]{2}1(?:A2[\s\S]|C[\s\S]|E1|Q0)/g, '')
    .replace(/\x1B@/g, '')
    .replace(/\x1B[EaM!-][\s\S]/g, '')
    .replace(/\x1D[!V][\s\S]/g, '')
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function pqPrinterLabel(j){
  const imp = (state.impressoras||[]).find(p=>(j.printer_ip && p.ip===j.printer_ip) || (!j.printer_ip && (p.osName||p.nome)===j.printer_name));
  const name = imp ? imp.nome : (j.printer_name||'impressora');
  const agents = Object.fromEntries(((printSetup&&printSetup.agents)||[]).map(a=>[a.id,a.name]));
  const where = j.printer_ip ? 'rede: '+j.printer_ip : (j.agent_id && agents[j.agent_id] ? 'USB no '+agents[j.agent_id] : '');
  return { name, where };
}
function pqIsStale(j){ return j.status==='processando' && psNow() - new Date(j.created_at).getTime() > PQ_STALE_MS; }
async function loadPrintQueue(){
  if(!supabaseClient || !getTenantId()) return;
  try{
    const since = new Date(Date.now() - PQ_WINDOW_H*3600*1000).toISOString();
    let q = supabaseClient.from('print_jobs')
      .select('id,created_at,printed_at,status,printer_name,printer_ip,agent_id,error,content')
      .eq('tenant_id', getTenantId()).gte('created_at', since);
    if(!pqShowAll) q = q.in('status', ['pendente','processando','erro']);
    const { data, error } = await q.order('created_at', { ascending:false }).limit(100);
    if(error){ pqError = error.code==='42501' ? 'Só o caixa ou o administrador vê a fila de impressão.' : 'Não foi possível carregar a fila agora. Confira a internet.'; }
    else { pqError = ''; pqJobs = data || []; }
  }catch(e){ pqError = 'Não foi possível carregar a fila agora. Confira a internet.'; }
  renderPrintQueue();
}
function startPrintQueuePolling(){
  if(pqTimer) return;
  pqTimer = setInterval(()=>{
    const v = document.getElementById('view-impressoras');
    if(!v || !v.classList.contains('active') || !document.getElementById('printQueueBox')){ clearInterval(pqTimer); pqTimer = null; return; }
    if(!document.querySelector('#printQueueBox details[open]')) loadPrintQueue(); // não fecha a ficha aberta
  }, 10000);
}
function renderPrintQueue(){
  const box = document.getElementById('printQueueBox'); if(!box) return;
  const head = `<div class="ps-head"><h3>Fila de impressão</h3>
    <div class="ps-scan" style="margin:0"><label><input type="checkbox" ${pqShowAll?'checked':''} onchange="pqShowAll=this.checked;loadPrintQueue()"> Mostrar também as impressas</label>
    <button type="button" class="btn btn-sm" onclick="loadPrintQueue()">Atualizar</button></div></div>`;
  if(pqError && !pqJobs){ box.innerHTML = head+`<p class="sub" style="margin:0">${h(pqError)}</p>`; return; }
  if(!pqJobs){ box.innerHTML = head+'<p class="sub" style="margin:0">Carregando…</p>'; return; }
  const intro = `<p class="sub" style="margin:0 0 10px">Fichas das últimas ${PQ_WINDOW_H} horas${pqShowAll?'':' que ainda não saíram'}. Ficha parada "Na fila" quase sempre é o agente fechado no computador ou a impressora fora da rede dele. Depois de resolver, use <b>Reenviar</b>. Se o pedido já foi entregue, use <b>Descartar</b>.</p>`;
  if(!pqJobs.length){ box.innerHTML = head+intro+`<p class="empty" style="margin:0">${pqShowAll?'Nenhuma ficha nas últimas '+PQ_WINDOW_H+' horas.':'Nenhuma ficha parada. Tudo saiu na impressora.'}</p>`; return; }
  const rows = pqJobs.map(j=>{
    const st = PQ_STATUS[j.status] || { label:j.status, cls:'tag-gray' };
    const stale = pqIsStale(j);
    const { name, where } = pqPrinterLabel(j);
    const text = pqPlainText(j.content);
    const firstLine = (text.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,2).join(' · ') || '(ficha vazia)').slice(0,90);
    const age = j.status==='pendente' ? ' · '+psAgo(j.created_at) : '';
    const canRetry = j.status==='erro' || j.status==='descartado' || stale;
    const canDiscard = j.status==='pendente' || j.status==='erro' || stale;
    const busy = pqBusy[j.id];
    const actions = [
      canRetry ? `<button type="button" class="btn btn-sm" ${busy?'disabled':''} onclick="resolvePrintJob(${jsArg(j.id)},'reenviar')">Reenviar</button>` : '',
      canDiscard ? `<button type="button" class="btn btn-sm btn-danger" ${busy?'disabled':''} onclick="resolvePrintJob(${jsArg(j.id)},'descartar')">Descartar</button>` : ''
    ].join(' ');
    return `<tr>
      <td style="white-space:nowrap">${h(psTime(j.created_at))}</td>
      <td><b>${h(name)}</b>${where?`<br><small class="mono" style="color:var(--muted)">${h(where)}</small>`:''}</td>
      <td><span class="tag ${st.cls}">${h(st.label+(stale?' (parada)':'')+age)}</span>${j.error?`<br><small style="color:var(--muted)">${h(String(j.error).slice(0,160))}</small>`:''}</td>
      <td><details><summary style="cursor:pointer">${h(firstLine)}</summary><pre class="mono" style="white-space:pre-wrap;font-size:12px;margin:6px 0 0;max-height:320px;overflow:auto">${h(text)}</pre></details></td>
      <td style="white-space:nowrap">${actions||'<span class="sub">—</span>'}</td>
    </tr>`;
  }).join('');
  box.innerHTML = head+intro+`<div style="overflow-x:auto"><table><tr><th>Criada</th><th>Impressora</th><th>Situação</th><th>Ficha</th><th>Ações</th></tr>${rows}</table></div>`
    + (pqJobs.length>=100 ? '<p class="sub">Mostrando as 100 mais recentes.</p>' : '');
}
async function resolvePrintJob(id, action){
  const j = (pqJobs||[]).find(x=>x.id===id); if(!j || pqBusy[id]) return;
  const { name } = pqPrinterLabel(j);
  if(action==='descartar'){
    const ok = await askConfirm({ title:'Descartar esta ficha?', message:'Ela sai da fila e não imprime mais em '+name+'. Use quando o pedido já foi feito ou entregue.', confirmLabel:'Descartar', cancelLabel:'Manter' });
    if(!ok) return;
  }
  pqBusy[id] = true; renderPrintQueue();
  try{
    const { data, error } = await supabaseClient.rpc('print_job_resolve', { p_job_id:id, p_action:action, p_by:(currentUser&&currentUser.name)||null });
    if(error){
      toast(error.code==='PGRST202' || /print_job_resolve/.test(error.message||'') ? 'Reenviar e descartar ainda não estão ativos no servidor.'
        : error.code==='42501' ? 'Só o caixa ou o administrador mexe na fila de impressão.' : 'Não foi possível '+action+' agora. Confira a internet.');
    } else if(data && data.ok){
      toast(action==='reenviar' ? 'Ficha reenviada para '+name+'.' : 'Ficha descartada.');
      logAction('Fila de impressão: ficha '+(action==='reenviar'?'reenviada para ':'descartada de ')+name);
      if(typeof hidePrintQueueBanner==='function') hidePrintQueueBanner();
      if(typeof checkStuckPrintQueue==='function') checkStuckPrintQueue();
    } else {
      toast(data && data.reason==='nao_encontrada' ? 'Essa ficha não existe mais.' : 'Essa ficha mudou de situação. A lista foi atualizada.');
    }
  }catch(e){ toast('Não foi possível '+action+' agora. Confira a internet.'); }
  delete pqBusy[id];
  loadPrintQueue();
}
// Botão "Ver fila" do aviso de fila travada (core/avisos.js).
function openPrintQueue(){
  switchView('impressoras');
  setTimeout(()=>{ const el = document.getElementById('printQueueBox'); if(el) el.scrollIntoView({ behavior:'smooth', block:'start' }); }, 80);
}
