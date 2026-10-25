/* ============ TRAVA CONTRA DUPLO CLIQUE ============
   Fluxos async que gravam dinheiro/pedido (venda, envio pra cozinha, abrir comanda)
   ficam "pendurados" esperando rede. Um segundo toque nesse meio-tempo rodava o
   fluxo de novo: venda duplicada, item lançado 2x na comanda, estoque baixado 2x.
   singleFlight ignora a chamada repetida enquanto a primeira (mesmo 1º argumento)
   não terminar. */
const _singleFlightBusy = new Set();
// UX-12: o botão tocado por último (até 1,5 s antes) fica com aria-busy e um indicador
// girando enquanto o fluxo roda. Antes nada mudava, e o operador tocava de novo.
let _lastPressedBtn = null, _lastPressedAt = 0;
if(typeof document.addEventListener==='function') document.addEventListener('click', e=>{ const b = e.target && e.target.closest && e.target.closest('button'); if(b){ _lastPressedBtn = b; _lastPressedAt = Date.now(); } }, true);
function singleFlight(name, fn){
  return async function(...args){
    const a0 = args[0];
    const key = name+':'+((typeof a0==='string'||typeof a0==='number')?a0:'');
    if(_singleFlightBusy.has(key)){ toast('Aguarde, processando...'); return; }
    _singleFlightBusy.add(key);
    const btn = (Date.now()-_lastPressedAt < 1500) ? _lastPressedBtn : null;
    if(btn) btn.setAttribute('aria-busy','true');
    try{ return await fn.apply(this, args); }
    finally{ _singleFlightBusy.delete(key); if(btn) btn.removeAttribute('aria-busy'); }
  };
}

/* ============ AVISO PERSISTENTE DE FALHA AO SALVAR ============
   O toast some em 2,6s e no salão cheio ninguém vê. Aqui o aviso FICA na tela
   até o dado ser gravado de verdade (por retry manual ou por um save seguinte
   da mesma chave que der certo). Um banner por chave, sem duplicar. */
const SAVE_FAIL_LABELS = {
  sales:'a venda', orders:'o pedido', requests:'a solicitação', scheduled:'o agendamento',
  members:'o cadastro do cliente', products:'o produto', insumos:'o insumo',
  stockMovements:'a movimentação de estoque', cashSession:'o caixa',
  cashMovements:'a movimentação de caixa', cashHistory:'o fechamento de caixa',
  contas:'a conta', coupons:'o cupom', settings:'as configurações', users:'o usuário'
};
const saveFailBanners = new Map();
function saveFailText(entry, state_){
  const what = SAVE_FAIL_LABELS[entry.key] || 'os dados';
  const title = entry.el.querySelector('.save-fail-title');
  const sub = entry.el.querySelector('.save-fail-sub');
  const btn = entry.el.querySelector('.save-fail-btn');
  entry.el.dataset.state = state_;
  if(state_==='saving'){
    title.textContent = `Salvando ${what}...`;
    sub.textContent = 'Aguarde, tentando gravar de novo.';
    btn.textContent = 'Enviando...'; btn.disabled = true;
  }else{
    title.textContent = state_==='again'
      ? `Ainda não foi possível salvar ${what}.`
      : `Não foi possível salvar ${what}.`;
    sub.textContent = 'Toque aqui para tentar de novo.';
    btn.textContent = 'Tentar de novo'; btn.disabled = false;
  }
}
function saveFailShake(entry){
  entry.el.classList.remove('shake');
  void entry.el.offsetWidth;
  entry.el.classList.add('shake');
}
function saveFailBanner(key){
  const root = document.getElementById('saveFailRoot');
  if(!root){ toast('Erro ao salvar dados. A operação pode não ter sido registrada.'); return; }
  const existing = saveFailBanners.get(key);
  if(existing && existing.el.isConnected){
    // Já tem banner desta chave: não duplica. Se está no meio de um retry,
    // quem manda no texto final é retrySaveFail().
    if(!existing.retrying){ saveFailText(existing, 'idle'); saveFailShake(existing); }
    return;
  }
  const el = document.createElement('div');
  el.className = 'save-fail';
  el.setAttribute('role','alert');
  el.innerHTML = '<div class="save-fail-ico" aria-hidden="true">!</div>'
    + '<div class="save-fail-txt"><span class="save-fail-title"></span><span class="save-fail-sub"></span></div>'
    + '<button type="button" class="save-fail-btn"></button>';
  const entry = { key, el, retrying:false };
  el.addEventListener('click', ()=>retrySaveFail(key));
  root.appendChild(el);
  saveFailBanners.set(key, entry);
  saveFailText(entry, 'idle');
}
function clearSaveFailBanner(key){
  const entry = saveFailBanners.get(key);
  if(!entry) return;
  saveFailBanners.delete(key);
  entry.el.remove();
}
async function retrySaveFail(key){
  const entry = saveFailBanners.get(key);
  if(!entry || entry.retrying) return;
  entry.retrying = true;
  saveFailText(entry, 'saving');
  // Reenvia o state[key] ATUAL (pode ter mudado desde a falha) — é o melhor
  // possível sem snapshot por ponto de chamada.
  let ok = false;
  try{ ok = await save(key); }catch(e){ ok = false; }
  if(ok){
    clearSaveFailBanner(key);
    toast('Dados salvos com sucesso.');
    return;
  }
  entry.retrying = false;
  if(saveFailBanners.get(key)===entry && entry.el.isConnected){
    saveFailText(entry, 'again');
    saveFailShake(entry);
  }
}

/* Empurra o conteúdo pra baixo somando TODOS os banners do topo (sincronização,
   fila de impressão travada, sobras do Modo Local), pra dois avisos simultâneos
   não se sobreporem. */
function applyTopBannerOffset(){
  const root = document.getElementById('localModeRoot');
  document.documentElement.style.setProperty('--top-banner-offset', root ? root.offsetHeight + 'px' : '0px');
}
window.addEventListener('resize', applyTopBannerOffset);

/* ============ SOBRAS DO ANTIGO MODO LOCAL ============
   Até 2026-09-25, se o SDK do Supabase não carregasse no boot, o app rodava
   gravando tudo no localStorage do aparelho — e isso nunca subia pro servidor.
   O Modo Local foi removido; aqui só resgatamos o que ficou pra trás. Não
   mistura nada no caixa: o dono baixa o arquivo e decide o que lançar. */
function localModeLeftovers(){
  const data = {};
  let vendas = 0;
  try{
    for(const key of Object.keys(STORE)){
      const raw = localStorage.getItem(STORE[key]);
      if(raw===null) continue;
      try{ data[key] = JSON.parse(raw); }catch(e){ data[key] = raw; }
    }
    if(Array.isArray(data.sales)) vendas = data.sales.length;
  }catch(e){ return null; }
  return vendas ? { data, vendas } : null;
}
function checkLocalModeLeftovers(){
  if(!isCloudMode() || !sessionIsOwner) return;
  const found = localModeLeftovers();
  if(!found) return;
  const root = document.getElementById('localModeRoot');
  if(!root || root.querySelector('.local-leftovers')) return;
  const el = document.createElement('div');
  el.className = 'local-mode local-leftovers';
  el.setAttribute('role','alert');
  el.innerHTML = '<div class="local-mode-ico" aria-hidden="true">&#9888;</div>'
    + '<div class="local-mode-txt">'
    +   '<span class="local-mode-title">'+(found.vendas===1 ? '1 venda ficou só neste aparelho' : found.vendas+' vendas ficaram só neste aparelho')+'</span>'
    +   '<span class="local-mode-sub">Foram feitas sem conexão com o servidor e não entraram no caixa. Baixe o arquivo para conferir e lançar o que faltar.</span>'
    + '</div>'
    + '<button type="button" class="local-mode-btn">Baixar arquivo</button>'
    + '<button type="button" class="local-mode-btn local-leftovers-del">Apagar</button>';
  el.querySelector('.local-mode-btn').addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(found.data, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vendas-sem-conexao-'+todayStr()+'.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  });
  el.querySelector('.local-leftovers-del').addEventListener('click', ()=>{
    if(!confirm('Apagar deste aparelho as vendas feitas sem conexão? Baixe o arquivo antes, se ainda não baixou.')) return;
    try{ Object.values(STORE).forEach(k=>localStorage.removeItem(k)); }catch(e){}
    el.remove(); applyTopBannerOffset();
  });
  root.appendChild(el);
  applyTopBannerOffset();
}

/* ============ FILA DE IMPRESSÃO TRAVADA ============
   printSingleTicket apenas ENFILEIRA em print_jobs; quem imprime de verdade é o
   agente desktop. Se o agente estiver fechado, o toast segue dizendo "enviado pra
   fila de impressão", o papel nunca sai, e estações com saida:'imprime' (bar e
   churrasqueira) também não aparecem no Monitor de Cozinha — o pedido se perde em
   silêncio. Este alerta é o único sinal de que isso está acontecendo.
   A janela tem PISO de propósito (PRINT_QUEUE_IGNORE_OLDER_H): existem jobs
   pendentes antigos de impressoras que nem estão mais cadastradas, e eles não são
   acionáveis — sem o piso, o banner ficaria ligado pra sempre. */
const PRINT_QUEUE_STUCK_MIN = 3;
const PRINT_QUEUE_IGNORE_OLDER_H = 6;
const PRINT_QUEUE_SNOOZE_MIN = 10;
let printQueueSnoozedUntil = 0;

async function checkStuckPrintQueue(){
  if(!supabaseClient || !getTenantId() || !currentUser) return;
  try{
    const now = Date.now();
    const stuckBefore = new Date(now - PRINT_QUEUE_STUCK_MIN*60*1000).toISOString();
    const floor = new Date(now - PRINT_QUEUE_IGNORE_OLDER_H*3600*1000).toISOString();
    const { data, error } = await supabaseClient.from('print_jobs')
      .select('printer_name,created_at')
      .eq('tenant_id', getTenantId()).eq('status','pendente')
      .lt('created_at', stuckBefore).gte('created_at', floor)
      .order('created_at', {ascending:true}).limit(50);
    if(error) return;
    if(!data || !data.length){ hidePrintQueueBanner(); return; }
    if(now < printQueueSnoozedUntil || printAgentOffline) return; // agente fora do ar já tem o aviso dele
    const mins = Math.max(PRINT_QUEUE_STUCK_MIN, Math.round((now - new Date(data[0].created_at).getTime())/60000));
    showPrintQueueBanner(data.length, mins, data[0].printer_name||'impressora');
  }catch(e){ /* checagem de aviso: nunca deve atrapalhar a venda */ }
}

function showPrintQueueBanner(qtd, mins, printer){
  const root = document.getElementById('localModeRoot'); if(!root) return;
  let el = root.querySelector('.print-queue');
  if(!el){
    el = document.createElement('div');
    el.className = 'local-mode print-stuck print-queue';
    el.setAttribute('role','alert');
    el.innerHTML = '<div class="local-mode-ico" aria-hidden="true">&#128424;</div>'
      + '<div class="local-mode-txt">'
      +   '<span class="local-mode-title"></span>'
      +   '<span class="local-mode-sub"></span>'
      + '</div>'
      + '<button type="button" class="local-mode-btn">Entendi</button>';
    el.querySelector('.local-mode-btn').addEventListener('click', ()=>{
      printQueueSnoozedUntil = Date.now() + PRINT_QUEUE_SNOOZE_MIN*60*1000;
      hidePrintQueueBanner();
    });
    root.appendChild(el);
  }
  el.querySelector('.local-mode-title').textContent = qtd===1
    ? '1 pedido não saiu na impressora'
    : qtd+' pedidos não saíram na impressora';
  el.querySelector('.local-mode-sub').textContent = 'O mais antigo está esperando há '
    + mins + ' min na fila de ' + printer + '. Quase sempre é o agente de impressão fechado '
    + 'no computador — abra ele e confira essas fichas antes de entregar o pedido.';
  applyTopBannerOffset();
}

/* OP-19 (decisão do dono): agente de impressão fora do ar = aviso vermelho fixo.
   O agente carimba print_agent_tokens.last_seen_at sempre que busca a fila
   (migration 20261010000000); aqui só lemos o carimbo, comparando com o relógio
   do servidor. Sem agente configurado ou sem impressora cadastrada, não avisa.
   O aviso não tem botão: some sozinho quando o agente volta. */
const PRINT_AGENT_OFFLINE_MIN = 3;
let printAgentOffline = false;
// (11/10) Antes havia outra função com este mesmo nome, da tela de Impressoras, declarada
// mais abaixo: ela substituía esta e o aviso nunca aparecia. Aquela virou renderPrinterQueueStatus.
// Com computadores conectados por código (migration 20261011070000), avisa por computador:
// o que tem impressora escolhida e parou de dar sinal.
async function checkPrintAgentStatus(){
  if(!supabaseClient || !getTenantId() || !currentUser) return;
  try{
    const { data, error } = await supabaseClient.rpc('print_agent_status');
    if(error || !data || !data.configured || !(state.impressoras||[]).length){ setPrintAgentOffline(false); return; }
    const now = data.now ? new Date(data.now).getTime() : Date.now();
    const at = t => t ? new Date(t).getTime() : 0;
    const alive = t => at(t) && now - at(t) <= PRINT_AGENT_OFFLINE_MIN*60*1000;
    const agents = data.agents || [];
    const used = new Set((state.impressoras||[]).map(p=>p.agentId).filter(Boolean));
    const down = agents.filter(a=>used.has(a.id) && !alive(a.last_seen_at));
    if(down.length){ setPrintAgentOffline(true, Math.max(...down.map(a=>at(a.last_seen_at))), down.map(a=>a.name)); return; }
    const anyAlive = alive(data.last_seen_at) || agents.some(a=>alive(a.last_seen_at));
    setPrintAgentOffline(!anyAlive, Math.max(at(data.last_seen_at), ...agents.map(a=>at(a.last_seen_at))));
  }catch(e){ /* aviso: nunca deve atrapalhar a venda */ }
}
function setPrintAgentOffline(off, seen, names){
  printAgentOffline = off;
  const root = document.getElementById('localModeRoot'); if(!root) return;
  let el = root.querySelector('.agent-offline');
  if(!off){ if(el){ el.remove(); applyTopBannerOffset(); } return; }
  hidePrintQueueBanner();
  if(!el){
    el = document.createElement('div');
    el.className = 'local-mode print-stuck agent-offline';
    el.setAttribute('role','alert');
    el.innerHTML = '<div class="local-mode-ico" aria-hidden="true">&#128424;</div><div class="local-mode-txt"><span class="local-mode-title">Agente de impressão desconectado</span><span class="local-mode-sub"></span></div>';
    root.appendChild(el);
  }
  el.querySelector('.local-mode-title').textContent = names && names.length ? 'Agente de impressão desconectado: '+names.join(', ') : 'Agente de impressão desconectado';
  el.querySelector('.local-mode-sub').textContent = (seen ? 'Visto pela última vez às '+new Date(seen).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'. ' : '')
    + 'As fichas não estão saindo na impressora. Abra o agente no computador da impressão; até lá, leve os pedidos até a estação.';
  applyTopBannerOffset();
}
// Só o aviso da fila (.print-queue). Antes procurava .print-stuck, a classe de estilo que o aviso de
// agente desconectado e o de ficha não impressa também usam: a checagem da fila, que roda logo depois
// da do agente, apagava o aviso do agente 0,2 s depois de ele aparecer (registro de 25/10, t217).
function hidePrintQueueBanner(){
  const el = document.querySelector('#localModeRoot .print-queue');
  if(el){ el.remove(); applyTopBannerOffset(); }
}

/* ============ SINCRONIZAÇÃO PARADA ============
   O poll de 6s (startApp) é o que traz pedidos e comandas lançados em OUTROS
   aparelhos. Se a rede cai, ele falha — e antes falhava calado: o Monitor de
   Cozinha ficava congelado mostrando "nenhum pedido" com pedido real na fila.
   Só avisa depois de SYNC_FAIL_THRESHOLD falhas seguidas (um soluço de wi-fi não
   alarma) e sai sozinho na primeira sincronização que der certo. */
const SYNC_FAIL_THRESHOLD = 3;
let syncFailCount = 0;

function noteSyncResult(ok){
  if(ok){ syncFailCount = 0; hideSyncFailBanner(); updateConnectionLabel(); return; }
  syncFailCount++;
  if(syncFailCount >= SYNC_FAIL_THRESHOLD) showSyncFailBanner();
  updateConnectionLabel();
}
// UX-16: o rodapé diz se o aparelho está falando com o servidor, não o nome do banco.
/* OPS-11: a versão aberta no aparelho (data de publicação da página) aparece no rodapé. A cada
   5 min o aparelho pergunta ao servidor se há versão mais nova; se houver, mostra um aviso para
   recarregar (sem recarregar sozinho, para não perder um pedido em andamento). */
function appVersionDate(){ const d = new Date(document.lastModified); return isNaN(d) ? null : d; }
function renderAppVersion(){
  const el = document.getElementById('sbVersion'); if(!el) return;
  const d = appVersionDate();
  el.textContent = d ? d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
}
async function checkNewAppVersion(){
  if(!/^https?:/.test(location.protocol) || document.getElementById('newVersionBar')) return;
  try{
    const r = await fetch(location.href.split('#')[0], { method:'HEAD', cache:'no-store' });
    const server = new Date(r.headers.get('last-modified')), mine = appVersionDate();
    if(isNaN(server) || !mine || server.getTime() <= mine.getTime()+1000) return;
    const bar = document.createElement('div');
    bar.id = 'newVersionBar'; bar.className = 'new-version-bar'; bar.setAttribute('role','status');
    bar.innerHTML = '<span>Há uma versão nova do Commandah.</span><button type="button" onclick="location.reload()">Recarregar agora</button><button type="button" class="nv-later" onclick="this.parentNode.remove()">Depois</button>';
    document.body.appendChild(bar);
  }catch(e){}
}
setTimeout(()=>{ renderAppVersion(); checkNewAppVersion(); }, 3000);
// PROD-17: guarda só o aplicativo (sw.js) para abrir mesmo recarregando sem internet.
if(typeof navigator!=='undefined' && 'serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
  window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}
setInterval(checkNewAppVersion, 5*60000);
function updateConnectionLabel(){
  const el = document.getElementById('sbStorageMode'); if(!el) return;
  const offline = storageApi.mode==='Indisponível' || syncFailCount >= SYNC_FAIL_THRESHOLD;
  const local = storageApi.mode==='Local';
  el.textContent = offline ? 'Sem conexão' : local ? 'Só neste aparelho' : 'Conectado';
  el.title = offline ? 'O aparelho não está conseguindo falar com o servidor. Confira a internet.' : local ? 'Dados salvos somente neste navegador e dispositivo.' : 'Dados sincronizados com o servidor.';
  el.className = offline ? 'closed' : local ? '' : 'open';
}

function showSyncFailBanner(){
  const root = document.getElementById('localModeRoot');
  if(!root || root.querySelector('.sync-fail')) return;
  const el = document.createElement('div');
  el.className = 'local-mode sync-fail';
  el.setAttribute('role','alert');
  el.innerHTML = '<div class="local-mode-ico" aria-hidden="true">&#9888;</div>'
    + '<div class="local-mode-txt">'
    +   '<span class="local-mode-title">Este aparelho parou de sincronizar</span>'
    +   '<span class="local-mode-sub">Pedidos e comandas lançados em outros aparelhos não estão chegando aqui. Confira a internet; o aviso some sozinho quando a conexão voltar.</span>'
    + '</div>'
    + '<button type="button" class="local-mode-btn">Recarregar</button>';
  el.querySelector('.local-mode-btn').addEventListener('click', ()=>location.reload());
  root.appendChild(el);
  applyTopBannerOffset();
}

function hideSyncFailBanner(){
  const el = document.querySelector('#localModeRoot .sync-fail');
  if(el){ el.remove(); applyTopBannerOffset(); }
}

