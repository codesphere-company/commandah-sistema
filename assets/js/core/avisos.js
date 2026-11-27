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
  el.querySelector('.local-leftovers-del').addEventListener('click', async ()=>{
    if(!await confirmarAcao('Apagar deste aparelho as vendas feitas sem conexão? Baixe o arquivo antes, se ainda não baixou.')) return;
    try{ Object.values(STORE).forEach(k=>localStorage.removeItem(k)); }catch(e){}
    el.remove(); applyTopBannerOffset();
  });
  root.appendChild(el);
  applyTopBannerOffset();
}

/* ============ AVISO DA ANONIMIZAÇÃO AUTOMÁTICA (LGPD, item 6, auditoria 11/11) ============
   Para o administrador, com o automático ligado: uma vez por dia, diz quantos sócios entram na anonimização
   dos próximos 7 dias. A marca do dia fica no aparelho (localStorage), sem atrapalhar se o navegador bloquear. */
function avisoLgpdAoEntrar(){
  try{
    document.querySelectorAll('.lgpd-aviso').forEach(e=>e.remove()); // sobra da pessoa anterior
    if(!isCloudMode() || !isAdminUser() || !privacySettings().automatico) return;
    const n=lgpdListas().proximos.length; if(!n) return;
    const hoje=todayStr();
    try{ if(localStorage.getItem('cantina2:lgpdAvisoDia')===hoje) return; }catch(e){}
    const root=document.getElementById('localModeRoot'); if(!root || root.querySelector('.lgpd-aviso')) return;
    // A marca do dia só depois de saber que o aviso vai aparecer (revisão final, Minor 9).
    try{ localStorage.setItem('cantina2:lgpdAvisoDia', hoje); }catch(e){}
    const el=document.createElement('div');
    el.className='local-mode print-stuck lgpd-aviso'; el.setAttribute('role','alert');
    el.innerHTML='<div class="local-mode-ico" aria-hidden="true">&#128274;</div><div class="local-mode-txt"><span class="local-mode-title"></span><span class="local-mode-sub">Ver em Configurações › Privacidade</span></div><div class="print-fail-actions"><button type="button" class="local-mode-btn print-fail-done">Entendi</button></div>';
    el.querySelector('.local-mode-title').textContent=n+(n===1?' sócio será anonimizado':' sócios serão anonimizados')+' nos próximos 7 dias.';
    el.querySelector('button').addEventListener('click', ()=>{ el.remove(); applyTopBannerOffset(); });
    root.appendChild(el); applyTopBannerOffset();
  }catch(e){ /* aviso: nunca atrapalha a entrada */ }
}

/* ============ DONO DE LONGE: LIBERAÇÃO DO CAIXA (caixa por operador, 13/11) ============
   Contagem que não bate e o operador pediu liberação ao dono: na sessão do dono (e-mail e senha, no celular
   dele, sem PIN) aparece esta faixa. Tocar abre a pendência (tipo, esperado, contado, diferença, hora) com
   Liberar e Recusar (cash_turno_liberar_dono, só dono). O polling de refreshCashState (5 s com pedido ao
   dono) é quem chama atualizarFaixaDoDono. Admin e demais colaboradores nunca veem: sessionIsOwner é false
   depois do PIN. O modal tem raiz própria porque a tela de entrada (z-index 200) cobre o #modalRoot. */
function pendenciasAoDono(){
  if(!isCloudMode() || typeof donoDeLonge!=='function' || !donoDeLonge()) return [];
  return Object.entries(state.cashTurnos||{})
    .filter(([,t])=>t && t.pendencia && t.pendencia.pedidoDono)
    .map(([cx,t])=>({ cx, turno:t, p:t.pendencia }));
}
function atualizarFaixaDoDono(){
  const root = document.getElementById('localModeRoot'); if(!root) return;
  const lista = pendenciasAoDono();
  let el = root.querySelector('.dono-libera');
  const modal = document.getElementById('donoLiberaRoot');
  if(modal && !lista.some(x=>x.p.id===modal.dataset.pendencia)) fecharLiberacaoDoDono();
  if(!lista.length){ if(el){ el.remove(); applyTopBannerOffset(); } return; }
  if(!el){
    el = document.createElement('div');
    el.className = 'local-mode dono-libera';
    el.setAttribute('role','alert');
    el.style.cursor = 'pointer';
    el.innerHTML = '<div class="local-mode-ico" aria-hidden="true">!</div>'
      + '<div class="local-mode-txt"><span class="local-mode-title"></span><span class="local-mode-sub"></span></div>'
      + '<button type="button" class="local-mode-btn">Ver</button>';
    el.addEventListener('click', ()=>{ const l = pendenciasAoDono(); if(l.length) abrirLiberacaoDoDono(l[0].cx); });
    root.appendChild(el);
  }
  const x = lista[0];
  el.querySelector('.local-mode-title').textContent = 'Liberação pendente: '+nomeDoCaixa(x.cx)+' — '+(x.p.contouNome||'—');
  el.querySelector('.local-mode-sub').textContent = lista.length>1 ? 'e mais '+(lista.length-1)+' caixa(s) esperando. Toque para ver.' : 'A contagem não confere. Toque para ver e decidir.';
  applyTopBannerOffset();
}
function fecharLiberacaoDoDono(){
  const m = document.getElementById('donoLiberaRoot');
  try{ if(window.turnstile && typeof donoCaptchaId!=='undefined' && donoCaptchaId!=null) window.turnstile.remove(donoCaptchaId); }catch(e){}
  if(typeof donoCaptchaId!=='undefined'){ donoCaptchaId = null; donoCaptchaToken = null; }
  if(m) m.remove();
}
function abrirLiberacaoDoDono(cx){
  const t = (state.cashTurnos||{})[cx], p = t && t.pendencia; if(!p) return;
  fecharLiberacaoDoDono();
  const fechamento = p.tipo==='fechamento', dif = p.diferenca!=null ? Number(p.diferenca) : null;
  const m = document.createElement('div');
  m.id = 'donoLiberaRoot'; m.dataset.pendencia = String(p.id);
  m.className = 'modal-overlay'; m.style.zIndex = '450';
  m.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><button class="modal-close" id="donoFechar" aria-label="Fechar">'+ICN.x+'</button>'
    + '<h3 class="modal-title">Liberar '+h(nomeDoCaixa(cx))+'</h3>'
    + '<div class="cash-close-body"><p class="sub">'+(fechamento?'Fechamento':'Abertura')+' do turno de '+h(t.operatorName||'—')+'. A contagem não confere.</p>'
    + '<div class="cash-summary-line">Contou: <b>'+h(p.contouNome||'—')+'</b>'+(p.at?' às '+h(timeFmt(p.at)):'')+'</div>'
    + (p.esperado!=null?'<div class="cash-summary-line">Esperado: <b class="mono">'+h(fmt(p.esperado))+'</b></div>':'')
    + '<div class="cash-summary-line">Contado: <b class="mono">'+h(fmt(p.contado))+'</b></div>'
    + (dif!==null?'<div class="cash-summary-line">Diferença: <b class="mono '+(dif<0?'cash-short':'cash-over')+'">'+(dif<0?'Falta ':'Sobra ')+h(fmt(Math.abs(dif)))+'</b></div>':'')
    + '<div class="field" style="text-align:left;margin-top:12px"><label for="donoSenha">Senha do dono</label><input id="donoSenha" type="password" autocomplete="current-password"><small class="sub">Digite a senha para confirmar que é você.</small></div>'
    + '<div id="donoTurnstile"></div><p id="donoLiberaErro" class="dono-erro" role="alert"></p>'
    + '<div class="cash-close-actions"><button class="op-btn" id="donoRecusar" onclick="decidirLiberacaoDoDono('+jsArg(cx)+',false)">Recusar</button>'
    + '<button class="op-btn primary" id="donoLiberar" onclick="decidirLiberacaoDoDono('+jsArg(cx)+',true)">Liberar</button></div></div></div>';
  m.addEventListener('click', e=>{ if(e.target===m) fecharLiberacaoDoDono(); });
  document.body.appendChild(m);
  document.getElementById('donoFechar').onclick = fecharLiberacaoDoDono;
  donoMontarCaptcha();
  setTimeout(()=>{ const i = document.getElementById('donoSenha'); if(i) i.focus(); }, 50);
}
// A senha é conferida de novo por signInWithPassword, que no servidor pede o captcha: widget próprio na janela.
let donoCaptchaToken = null, donoCaptchaId = null;
function donoMontarCaptcha(){
  donoCaptchaToken = null; donoCaptchaId = null;
  let tries = 0;
  const mount = ()=>{
    const box = document.getElementById('donoTurnstile'); if(!box) return;
    if(!window.turnstile){ if(++tries<=66) setTimeout(mount, 300); return; }
    donoCaptchaId = window.turnstile.render('#donoTurnstile', { sitekey:TURNSTILE_SITE_KEY, callback:t=>{ donoCaptchaToken = t; }, 'expired-callback':()=>{ donoCaptchaToken = null; }, 'error-callback':()=>{ donoCaptchaToken = null; } });
  };
  mount();
}
// Confere a senha do dono (mesma conta da sessão): devolve null se vale, ou o texto do erro. Com duas etapas
// ligadas o novo login volta como aal1: pede o código (dono-mfa.js) antes de chamar a RPC.
async function donoConferirSenha(senha){
  const { data:{ session } } = await supabaseClient.auth.getSession();
  if(!session || !session.user || !session.user.email) return 'Sessão do dono não encontrada. Entre de novo com o e-mail.';
  if(!senha) return 'Digite a senha do dono.';
  // O novo login troca a sessão do aparelho (com duas etapas, por uma aal1). Guarda a de antes e devolve ela se o
  // código for cancelado ou algo falhar: nunca deixar o aparelho deslogado com a tela de pé.
  const antes = { access_token:session.access_token, refresh_token:session.refresh_token };
  const restaurar = async ()=>{ try{ await supabaseClient.auth.setSession(antes); }catch(e){} };
  let trocou = false;
  try{
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email:session.user.email, password:senha, options: donoCaptchaToken ? { captchaToken:donoCaptchaToken } : {} });
    donoCaptchaToken = null; try{ if(window.turnstile && donoCaptchaId!=null) window.turnstile.reset(donoCaptchaId); }catch(e){}
    if(error) return /captcha/i.test(error.message||'') ? 'A verificação "não sou robô" falhou. Tente de novo.' : 'Senha do dono incorreta.';
    trocou = true;
    if(!data || !data.user || data.user.id!==session.user.id){ await restaurar(); return 'Senha do dono incorreta.'; }
    if(await donoPrecisaCodigo() && !await pedirCodigoDoDono({ semSair:true })){ await restaurar(); return 'Verificação em duas etapas cancelada.'; }
    return null;
  }catch(e){
    if(trocou) await restaurar();
    return 'Não foi possível conferir a senha agora. Tente de novo.';
  }
}
const decidirLiberacaoDoDono = singleFlight('decidirLiberacaoDoDono', async function(cx, aprovar){
  const t = (state.cashTurnos||{})[cx], p = t && t.pendencia;
  if(!p){ fecharLiberacaoDoDono(); atualizarFaixaDoDono(); return; }
  // Controle do dono (13/11): o aparelho pode estar com o e-mail do dono mas na mão de um operador; a senha confirma.
  const erroSenha = await donoConferirSenha((document.getElementById('donoSenha')||{}).value||'');
  if(erroSenha){ const e = document.getElementById('donoLiberaErro'); if(e) e.textContent = erroSenha; else toast(erroSenha, 'error'); const i = document.getElementById('donoSenha'); if(i){ i.value=''; i.focus(); } return; }
  const { data, error } = await supabaseClient.rpc('cash_turno_liberar_dono', { p_caixa:cx, p_turno_id:t.id, p_pendencia_id:p.id, p_aprovar:!!aprovar });
  if(error || !data){ toast('Não foi possível '+(aprovar?'liberar':'recusar')+': '+((error&&error.message)||'erro no servidor')+'. Tente de novo.', 'error'); return; }
  if(!data.ok) toast(textoMotivoDoTurno(data.motivo), 'error');
  aplicarTurnoDoCaixa(cx, data.turno||null);
  if(!data.turno) await recarregarHistoricoDoCaixa(); // fechamento concluído no servidor: entrou no histórico
  fecharLiberacaoDoDono();
  if(data.ok){
    logAction((aprovar?'Divergência do caixa liberada pelo dono — ':'Liberação recusada pelo dono — ')+nomeDoCaixa(cx)+' (contou '+(p.contouNome||'—')+')');
    toast(aprovar?'Caixa liberado.':'Liberação recusada. O operador vai contar de novo.');
  }
  if(currentUser) renderAll();
  atualizarFaixaDoDono();
});

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
      + '<div class="print-fail-actions"><button type="button" class="local-mode-btn" data-a="fila">Ver fila</button>' // t215
      + '<button type="button" class="local-mode-btn print-fail-done" data-a="ok">Entendi</button></div>';
    el.querySelector('[data-a="fila"]').addEventListener('click', ()=>{ if(typeof openPrintQueue==='function') openPrintQueue(); });
    el.querySelector('[data-a="ok"]').addEventListener('click', ()=>{
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
    versaoNovaDesde = Date.now();
  }catch(e){}
}
/* 26/11 (pedido do dono, depois do cardápio): aparelho parado recarrega sozinho quando sai versão nova. Um caixa
   esquecido com a versão antiga lançava o pedido do cardápio do jeito velho (recusou a Coca com a escolha NORMAL).
   Parado: ninguém mexeu há 2 minutos, nenhuma janela aberta, nenhum campo com o cursor e nada por enviar
   (Ficha, Novo pedido, adição rápida, app do garçom). Fora disso fica só a faixa "Há uma versão nova", como antes.
   "Depois" na faixa também segura a recarga (a faixa some). */
let versaoNovaDesde = 0, ultimaAtividade = Date.now();
['pointerdown','keydown','touchstart','wheel'].forEach(ev=>window.addEventListener(ev, ()=>{ ultimaAtividade = Date.now(); }, { passive:true, capture:true }));
function aparelhoParado(){
  if(Date.now() - ultimaAtividade < 120000) return false;
  if(document.querySelector('#modalRoot .modal, #confirmRoot')) return false;
  const foco = document.activeElement; if(foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return false;
  const pendentes = l => Array.isArray(l) && l.some(i=>i && !i.sent);
  if(typeof currentSaleDraft!=='undefined' && currentSaleDraft && pendentes(currentSaleDraft.items)) return false;
  if(typeof gcCart!=='undefined' && pendentes(gcCart)) return false;
  if(typeof npCart!=='undefined' && pendentes(npCart)) return false;
  if(typeof comandaQuickCart!=='undefined' && pendentes(comandaQuickCart)) return false;
  return true;
}
setInterval(()=>{ if(versaoNovaDesde && document.getElementById('newVersionBar') && aparelhoParado()) location.reload(); }, 30000);
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


/* ============ NOTAS DE COMPRA: AVISO (t-notas, 27/11) ============
   Quem tem Contas ou Insumos vê o selo com o número de notas pendentes (alguma etapa faltando, fora as "tratadas
   fora" e as canceladas) na área onde mora a tela Notas de compra, e uma faixa "N notas de compra novas" quando o
   número sobe. Nota cancelada pelo fornecedor que já tinha entrada ou pagamento (campo `aviso`) ganha faixa
   própria, uma vez por nota. Egress (Supabase Pro): sem polling curto novo. Conta ao entrar e a cada 5 min, com
   consulta leve (sem `dados`/`xml`, só as notas ainda abertas); com a tela lida há pouco usa o cache dela, sem
   consulta. `dados` só das poucas notas em que falta apenas o estoque (para saber se todos os itens são
   "não é estoque").
   Revisão final (achados 3 e 4): a faixa "N notas de compra novas" vale só para chaves que este usuário ainda não
   viu (guardadas no localStorage, por usuário); o selo segue com o total de pendentes. A consulta dos 5 min pede
   só as colunas da contagem; nome e número só das canceladas com aviso ainda não mostrado. */
let notasAvisoQtd = 0, notasAvisoOcupado = false;
const NOTAS_AVISO_VISTAS = 'cmd-notas-cancelada-vistas';
const NOTAS_AVISO_NOVAS = 'cmd-notas-novas-vistas:'; // + id do usuário
function notasAvisoPode(){ return !!currentUser && isCloudMode() && (hasPerm('contas') || hasPerm('insumos')); }
function notasAvisoLer(chave){ try{ const v = JSON.parse(localStorage.getItem(chave)||'[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; } }
function notasAvisoGravar(chave, lista, novas, max){
  if(!novas.length) return;
  try{ localStorage.setItem(chave, JSON.stringify(lista.concat(novas).slice(-max))); }catch(e){}
}
function notasAvisoVistas(){ return notasAvisoLer(NOTAS_AVISO_VISTAS); }
function notasAvisoMarcar(chaves){ notasAvisoGravar(NOTAS_AVISO_VISTAS, notasAvisoVistas(), chaves, 300); }
function notasAvisoToast(classe, titulo, texto){
  const root = document.getElementById('toastRoot'); if(!root) return;
  root.querySelectorAll('.toast.'+classe).forEach(t=>t.remove());
  const el = document.createElement('div');
  el.className = 'toast wa-toast nc-toast '+classe; el.setAttribute('role','status');
  el.innerHTML = '<span><b>'+h(titulo)+'</b>'+(texto?'<br>'+h(texto):'')+'</span>'
    + '<span class="wa-toast-acoes"><button type="button" class="op-btn primary" data-nc="ver">Ver</button><button type="button" class="op-btn" data-nc="depois">Depois</button></span>';
  el.querySelector('[data-nc="ver"]').onclick = ()=>{ el.remove(); openRibbonView('notascompra','Notas de compra'); };
  el.querySelector('[data-nc="depois"]').onclick = ()=>el.remove();
  root.appendChild(el);
  setTimeout(()=>el.remove(), 20000);
}
// pendentes = chaves das notas pendentes agora; canceladas = notas canceladas com `aviso`; falar = avisar com
// faixa (false quando vem da tela aberta: quem está vendo a lista já viu as notas, que entram como vistas).
function notasAvisoAplicar(pendentes, canceladas, falar){
  const qtd = pendentes.length, mudouQtd = qtd!==notasAvisoQtd;
  notasAvisoQtd = qtd;
  const chaveNovas = NOTAS_AVISO_NOVAS+currentUser.id, jaVistas = notasAvisoLer(chaveNovas), set = new Set(jaVistas);
  const novas = pendentes.filter(k=>!set.has(k));
  if(falar && novas.length) notasAvisoToast('nc-novas', novas.length===1 ? '1 nota de compra nova' : novas.length+' notas de compra novas', 'Falta conferir, pagar ou dar entrada no estoque.');
  notasAvisoGravar(chaveNovas, jaVistas, novas, 1000);
  const vistas = new Set(notasAvisoVistas());
  const ainda = canceladas.filter(n=>!vistas.has(n.chave));
  if(falar) ainda.forEach(n=>notasAvisoToast('nc-cancelada', 'Nota cancelada pelo fornecedor', (n.emitente_nome||'')+(n.numero?' — nº '+n.numero:'')+'. '+n.aviso));
  notasAvisoMarcar(ainda.map(n=>n.chave));
  if(mudouQtd && typeof renderRibbonTabs==='function') renderRibbonTabs();
}
// Cache da tela Notas de compra (já lido, sem consulta nova).
function notasCompraAvisoDeDados(falar){
  if(!notasAvisoPode() || typeof notasCompraDados==='undefined' || !notasCompraDados) return;
  const notas = notasCompraDados.notas || [];
  notasAvisoAplicar(notas.filter(notasCompraPendente).map(n=>n.chave), notas.filter(n=>n.situacao==='cancelada' && n.aviso), !!falar);
}
async function notasCompraAvisoAtualizar(forcar){
  if(!notasAvisoPode() || notasAvisoOcupado || (document.hidden && !forcar)) return;
  const uid = currentUser.id;
  if(!forcar && typeof notasCompraDados!=='undefined' && notasCompraDados && notasCompraDados.quem===uid && Date.now()-notasCompraLidaEm<5*60000){ notasCompraAvisoDeDados(true); return; }
  notasAvisoOcupado = true;
  try{
    const { data, error } = await supabaseClient.from('notas_entrada')
      .select('chave,emitente_cnpj,situacao,aviso,conferida_em,contabilidade_em,pagamento_em,estoque_em')
      .eq('fora', false).or('conferida_em.is.null,contabilidade_em.is.null,pagamento_em.is.null,estoque_em.is.null,aviso.not.is.null')
      .order('criada_em', { ascending:false }).limit(500);
    if(error || !Array.isArray(data) || !currentUser || currentUser.id!==uid) return;
    const abertas = data.filter(n=>n.situacao!=='cancelada');
    const soEstoque = abertas.filter(n=>n.conferida_em && n.contabilidade_em && n.pagamento_em && !n.estoque_em);
    const fora = new Set();
    if(soEstoque.length){
      const [rd, rv] = await Promise.all([
        supabaseClient.from('notas_entrada').select('chave,dados').in('chave', soEstoque.map(n=>n.chave).slice(0,100)),
        supabaseClient.from('notas_entrada_vinculos').select('emitente_cnpj,codigo,tipo')
      ]);
      if(rd.error || rv.error || !currentUser || currentUser.id!==uid) return;
      const vin = {}; (rv.data||[]).forEach(v=>{ vin[(v.emitente_cnpj||'')+'|'+v.codigo] = v.tipo; });
      const mapa = {}; (rd.data||[]).forEach(d=>{ mapa[d.chave] = d.dados; });
      soEstoque.forEach(n=>{
        const itens = mapa[n.chave] && Array.isArray(mapa[n.chave].itens) ? mapa[n.chave].itens : [];
        if(itens.length && itens.every(it=>vin[(n.emitente_cnpj||'')+'|'+it.codigo]==='fora')) fora.add(n.chave);
      });
    }
    // Nome e número só das canceladas com aviso que ainda não apareceram (a faixa usa; o selo não).
    const vistas = new Set(notasAvisoVistas());
    const canceladas = data.filter(n=>n.situacao==='cancelada' && n.aviso && !vistas.has(n.chave)).slice(0,50);
    if(canceladas.length){
      const rn = await supabaseClient.from('notas_entrada').select('chave,emitente_nome,numero').in('chave', canceladas.map(n=>n.chave));
      if(rn.error || !currentUser || currentUser.id!==uid) return;
      const nomes = {}; (rn.data||[]).forEach(x=>{ nomes[x.chave] = x; });
      canceladas.forEach(n=>{ const x = nomes[n.chave] || {}; n.emitente_nome = x.emitente_nome; n.numero = x.numero; });
    }
    notasAvisoAplicar(abertas.filter(n=>!fora.has(n.chave)).map(n=>n.chave), canceladas, true);
  }catch(e){ /* sem rede: tenta no próximo ciclo */ }
  finally{ notasAvisoOcupado = false; }
}
setInterval(()=>{ if(currentUser) notasCompraAvisoAtualizar(false); }, 5*60000);
