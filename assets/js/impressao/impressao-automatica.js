/* ============ IMPRESSÃO AUTOMÁTICA (11/10) ============
   Pedido do dono: configurar a impressão sem digitar token, nome do Windows nem IP.
   O agente 2.1 se conecta com um código de 6 números (print_agent_pair_confirm) e conta
   as impressoras que encontrou (USB/Windows daquele computador e de rede, porta 9100).
   Aqui o administrador só escolhe o que cada uma imprime. A escolha vira uma entrada comum
   em state.impressoras (origem 'ambos'), então resolvePrinterFor/printSingleTicket seguem
   iguais; impressora USB leva agentId para a ficha ir ao computador certo. Migration
   20261011070000. */
let psAdvancedOpen = false, printSetup = null, printSetupError = '', printSetupClockSkew = 0, printSetupTimer = null;
let psFound = {}, psPaper = {}, psTestResults = {};
const PS_ALIVE_MIN = 3;
const PS_VIRTUAL_RE = /pdf|xps|onenote|fax|send to|enviar para|anydesk|teamviewer|bullzip|cutepdf|nitro|foxit|snagit/i;
function printStationName(k){ return k==='caixa' ? 'Comprovante do caixa' : k==='tudo' ? 'Tudo lançado no computador do caixa' : estacaoLabel(k); }
/* Caixa com computador (decisão do dono, 11/10): tudo que for lançado naquele computador —
   fichas de todas as estações e o comprovante — sai na impressora dele. Pedido do garçom
   pelo celular segue as estações. Cada computador é reconhecido pelo agente 2.1 que roda
   nele (GET 127.0.0.1:9123/status devolve agent_id). A escolha fica em state.impressoras
   como estacao 'tudo' com deviceAgentId = o computador do caixa. */
let localPrintAgent = null;
async function detectLocalPrintAgent(force){
  // Só pergunta ao agente local quando existe caixa configurado e não é o app do garçom
  // (o navegador pode pedir permissão para acessar programas deste computador).
  const anyDevice = (state.impressoras||[]).some(p=>p.estacao==='tudo');
  if(!force && (!anyDevice || (currentUser && currentUser.origem==='app'))){ localPrintAgent = null; return null; }
  try{
    const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 1500);
    const res = await fetch(PRINT_AGENT_URL+'/status', { signal:ctrl.signal, cache:'no-store' });
    clearTimeout(t);
    const j = res.ok ? await res.json() : null;
    localPrintAgent = j && j.agent_id ? { id:j.agent_id, name:j.agent_name||'' } : null;
  }catch(e){ localPrintAgent = null; }
  return localPrintAgent;
}
function deviceCaixaPrinter(){
  if(!localPrintAgent) return null;
  return (state.impressoras||[]).find(p=>p.estacao==='tudo' && p.deviceAgentId===localPrintAgent.id) || null;
}
// Estações que, lançadas no computador de caixa, imprimem na própria impressora (padrão: Cozinha).
function caixaKeepStations(dev){ return Array.isArray(dev && dev.keepStations) ? dev.keepStations : ['cozinha']; }
function caixaKeepsStation(dev, estacao){ return caixaKeepStations(dev).includes(estacao); }
async function toggleCaixaKeepStation(agentId, estacao, on){
  const dev = state.impressoras.find(p=>p.estacao==='tudo' && p.deviceAgentId===agentId); if(!dev) return;
  const set = new Set(caixaKeepStations(dev)); if(on) set.add(estacao); else set.delete(estacao);
  dev.keepStations = [...set];
  await save('impressoras'); renderImpressoras();
  const a = ((printSetup&&printSetup.agents)||[]).find(x=>x.id===agentId);
  toast(printStationName(estacao)+(on?' lançado no '+(a?a.name:'caixa')+' imprime na impressora da estação.':' lançado no '+(a?a.name:'caixa')+' imprime no caixa.'));
  logAction('Impressão: '+printStationName(estacao)+(on?' imprime na própria impressora':' imprime no caixa')+' quando lançado no '+(a?a.name:'caixa'));
}
async function setDeviceCaixaPrinter(agentId, key){
  const a = ((printSetup&&printSetup.agents)||[]).find(x=>x.id===agentId); if(!a) return;
  state.impressoras = state.impressoras.filter(p=>!(p.estacao==='tudo' && p.deviceAgentId===agentId));
  const fp = key ? psFound[key] : null;
  if(fp){
    const paper = state.impressoras.filter(p=>impKey(p)===key).map(p=>Number(p.larguraPapel)).find(Boolean) || psPaper[key] || 80;
    state.impressoras.push({ id:uid(), nome:'Caixa '+a.name+' — '+fp.title, osName: fp.kind==='windows' ? fp.name : '', ip: fp.kind==='rede' ? fp.name : '',
      agentId: fp.kind==='windows' ? fp.agentId : null, deviceAgentId: agentId, larguraPapel: paper, agentUrl:'', estacao:'tudo', origem:'ambos', auto:true });
  }
  await save('impressoras'); renderImpressoras();
  toast(fp ? 'Tudo que for lançado no '+a.name+' agora imprime em '+fp.title+'.' : a.name+' volta a seguir as impressoras das estações.');
  logAction('Impressão: caixa '+a.name+(fp ? ' imprime tudo em '+fp.title : ' segue as estações'));
  detectLocalPrintAgent();
}
function impKey(p){
  if(p.ip) return 'rede:'+String(p.ip).trim();
  return p.agentId ? 'win:'+p.agentId+':'+String(p.osName||p.nome||'').trim().toLowerCase() : '';
}
function psNow(){ return Date.now() + printSetupClockSkew; }
function psAlive(t){ return !!t && psNow() - new Date(t).getTime() <= PS_ALIVE_MIN*60*1000; }
function psAgo(t){
  if(!t) return 'nunca';
  const min = Math.max(0, Math.round((psNow() - new Date(t).getTime())/60000));
  if(min < 1) return 'agora';
  if(min < 60) return 'há '+min+' min';
  if(min < 48*60) return 'há '+Math.round(min/60)+' h';
  return 'em '+new Date(t).toLocaleDateString('pt-BR');
}
function psTime(t){ const d=new Date(t); return d.toDateString()===new Date().toDateString() ? d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
async function loadPrintSetup(){
  if(!supabaseClient) return;
  try{
    const { data, error } = await supabaseClient.rpc('print_setup_state');
    if(error){
      printSetupError = error.code==='42501' ? 'Só o administrador vê e muda a configuração automática da impressão.'
        : error.code==='PGRST202' || /print_setup_state/.test(error.message||'') ? 'A configuração automática ainda não está ativa no servidor.'
        : 'Não foi possível carregar a configuração da impressão agora. Confira a internet.';
    } else {
      printSetupError = ''; printSetup = data || { agents:[], printers:[] };
      if(data && data.now) printSetupClockSkew = new Date(data.now).getTime() - Date.now();
    }
  }catch(e){ printSetupError = 'Não foi possível carregar a configuração da impressão agora. Confira a internet.'; }
  renderPrintSetupAuto();
}
function startPrintSetupPolling(){
  if(printSetupTimer) return;
  printSetupTimer = setInterval(()=>{
    const v = document.getElementById('view-impressoras');
    if(!v || !v.classList.contains('active') || !document.getElementById('printSetupAuto')){ clearInterval(printSetupTimer); printSetupTimer = null; return; }
    loadPrintSetup();
  }, 15000);
}
// Junta o que os computadores contaram: USB uma por computador; rede uma por IP.
function psFoundPrinters(d){
  const agents = Object.fromEntries((d.agents||[]).map(a=>[a.id,a]));
  const latest = (list, f)=> list.map(x=>x[f]).filter(Boolean).sort().pop() || null;
  const out = [];
  const rede = {};
  (d.printers||[]).filter(p=>p.kind==='rede').forEach(p=>{ (rede[p.name]=rede[p.name]||[]).push(p); });
  Object.keys(rede).sort().forEach(ip=>{
    const list = rede[ip], errAt = latest(list,'last_error_at'), errRow = list.find(p=>p.last_error_at===errAt);
    const names = rows=>[...new Set(rows.map(p=>(agents[p.agent_id]||{}).name).filter(Boolean))].join(', ');
    const manual = list.filter(p=>p.manual), auto = list.filter(p=>!p.manual);
    // t108: IP escolhido que não respondeu na última conferência do computador (1 min de folga).
    const silent = manual.filter(p=>{ const a = agents[p.agent_id]||{}; return a.last_scan_at && new Date(a.last_scan_at).getTime() > new Date(p.last_seen_at).getTime() + 60000; });
    out.push({ key:'rede:'+ip, kind:'rede', name:ip, title:'Impressora de rede '+ip,
      where:[manual.length?'adicionada pelo IP no '+names(manual):'', auto.length?'encontrada por '+names(auto):''].filter(Boolean).join(' · '),
      silentIn:names(silent), last_seen_at:latest(list,'last_seen_at'), last_ok_at:latest(list,'last_ok_at'), last_error_at:errAt, last_error:errRow&&errRow.last_error, virtual:false });
  });
  (d.printers||[]).filter(p=>p.kind==='windows').forEach(p=>{
    const a = agents[p.agent_id] || {};
    out.push({ key:'win:'+p.agent_id+':'+p.name.trim().toLowerCase(), kind:'windows', name:p.name, agentId:p.agent_id, title:p.name,
      where:'ligada no '+(a.name||'computador')+' (Windows)', last_seen_at:p.last_seen_at, last_ok_at:p.last_ok_at,
      last_error_at:p.last_error_at, last_error:p.last_error, virtual:PS_VIRTUAL_RE.test(p.name) });
  });
  return out;
}
function psStations(){ return [...state.estacoes.map(e=>({k:e.chave, n:e.nome})), {k:'caixa', n:'Comprovante do caixa'}]; }
function psPrinterCard(fp){
  const assigned = state.impressoras.filter(p=>impKey(p)===fp.key);
  const chips = psStations().map(s=>{ const mine = assigned.filter(p=>p.estacao===s.k), on = mine.length>0;
    // Cadastro manual que atende só uma origem (ex.: só App do Garçom): marcado pela metade.
    const partial = on && mine.every(p=>p.origem && p.origem!=='ambos');
    const label = partial ? s.n+' (só '+[...new Set(mine.map(p=>origemLabel(p.origem)))].join(', ')+')' : s.n;
    return `<button type="button" class="ps-chip${on?(partial?' partial':' on'):''}" aria-pressed="${partial?'mixed':on}" title="${partial?'Clique para imprimir aqui todos os pedidos de '+h(s.n):''}" onclick="togglePrinterStation(${jsArg(fp.key)},${jsArg(s.k)})">${h(label)}</button>`; }).join('');
  const paper = assigned.length ? (Number(assigned[0].larguraPapel)===58?58:80) : (psPaper[fp.key]||80);
  const okAt = fp.last_ok_at ? new Date(fp.last_ok_at).getTime() : 0, errAt = fp.last_error_at ? new Date(fp.last_error_at).getTime() : 0;
  const health = errAt > okAt ? `<span class="tag tag-red" title="${h(fp.last_error||'')}">✗ Erro ${h(psTime(fp.last_error_at))}: ${h(String(fp.last_error||'').slice(0,80))}</span>`
    : okAt ? `<span class="tag tag-green">● Imprimiu ${h(psTime(fp.last_ok_at))}</span>` : '';
  const stale = fp.silentIn ? `<span class="tag tag-red" title="Confira se a impressora está ligada e se esse computador alcança a rede dela.">não respondeu no ${h(fp.silentIn)}</span>`
    : fp.last_seen_at && psNow() - new Date(fp.last_seen_at).getTime() > 24*3600*1000 ? `<span class="tag tag-gray">não encontrada ${h(psAgo(fp.last_seen_at))}</span>` : '';
  const t = psTestResults[fp.key];
  const agentsById = Object.fromEntries(((printSetup&&printSetup.agents)||[]).map(a=>[a.id,a.name]));
  const caixaTags = assigned.filter(p=>p.estacao==='tudo').map(p=>`<span class="tag tag-blue">Caixa: tudo lançado no ${h(agentsById[p.deviceAgentId]||'computador removido')}</span>`).join('');
  return `<div class="ps-printer${assigned.length?' assigned':''}">
    <div class="ps-printer-top"><span class="ps-printer-name">${h(fp.title)}</span><span class="ps-printer-where">${h(fp.where)}</span>${caixaTags}${health}${stale}</div>
    <div class="ps-chips"><span class="ps-chips-label">Imprime:</span>${chips}</div>
    <div class="ps-actions"><label>Papel <select onchange="setFoundPrinterPaper(${jsArg(fp.key)},this.value)"><option value="80" ${paper===80?'selected':''}>80 mm</option><option value="58" ${paper===58?'selected':''}>58 mm</option></select></label>
      <button type="button" class="btn btn-sm" onclick="testFoundPrinter(${jsArg(fp.key)})">Imprimir teste</button>
      ${fp.kind==='rede'?`<button type="button" class="btn btn-sm" onclick="removeNetworkPrinter(${jsArg(fp.name)})">Remover</button>`:''}
      <span class="ps-test-result${t?' '+t.cls:''}" data-ps-test="${h(fp.key)}" role="status">${t?h(t.msg):''}</span></div>
  </div>`;
}
function renderPrintSetupAuto(){
  const box = document.getElementById('printSetupAuto'); if(!box) return;
  if(printSetupError && !printSetup){ box.innerHTML = `<div class="ps-block"><p class="sub" style="margin:0">${h(printSetupError)}</p></div>`; return; }
  if(!printSetup) return;
  const d = printSetup, agents = d.agents||[];
  const found = psFoundPrinters(d); psFound = Object.fromEntries(found.map(f=>[f.key,f]));
  const agentRows = agents.map(a=>{ const on = psAlive(a.last_seen_at);
    // Caixa: impressoras USB deste computador + as de rede.
    const opts = found.filter(f=>!f.virtual && (f.kind==='rede' || f.agentId===a.id));
    const dev = state.impressoras.find(p=>p.estacao==='tudo' && p.deviceAgentId===a.id), devKey = dev ? impKey(dev) : '';
    const caixaSel = `<label class="ps-caixa">Caixa: <select onchange="setDeviceCaixaPrinter(${jsArg(a.id)},this.value)"><option value="">não — segue as impressoras das estações</option>${opts.map(f=>`<option value="${h(f.key)}" ${f.key===devKey?'selected':''}>imprimir tudo lançado aqui em ${h(f.kind==='rede'?f.title:f.name+' (USB deste PC)')}</option>`).join('')}${dev&&!opts.some(f=>f.key===devKey)?`<option value="${h(devKey)}" selected>${h(dev.nome)}</option>`:''}</select></label>`
      // Estações com preparo: a ficha vai para a impressora delas (padrão: Cozinha).
      + (dev ? `<div class="ps-scan"><span>Exceto, na impressora da própria estação:</span>${state.estacoes.map(e=>`<label><input type="checkbox" id="psKeep-${h(a.id)}-${h(e.chave)}" ${caixaKeepsStation(dev, e.chave)?'checked':''} onchange="toggleCaixaKeepStation(${jsArg(a.id)},${jsArg(e.chave)},this.checked)"> ${h(e.nome)}</label>`).join('')}</div>` : '');
    const here = localPrintAgent && localPrintAgent.id===a.id ? ' <span class="tag tag-blue">este computador</span>' : '';
    // t108: busca na rede por computador (servidor sem a migration 20261012000000 não manda scan_network).
    const scanOn = a.scan_network !== false, hasScanOpt = typeof a.scan_network === 'boolean';
    const oldAgent = a.version && psVersionBelow(a.version, '2.2');
    const scanRow = hasScanOpt ? `<div class="ps-scan"><label><input type="checkbox" id="psScan-${h(a.id)}" ${scanOn?'checked':''} onchange="setAgentScan(${jsArg(a.id)},this.checked,this)"> Procurar impressoras na rede sozinho</label>
      <button type="button" class="btn btn-sm" onclick="openAddPrinterIpModal(${jsArg(a.id)})">＋ Impressora pelo IP</button>
      ${!scanOn?'<span>Só usa as impressoras USB e os IPs escolhidos.</span>':''}${oldAgent&&!scanOn?'<span class="tag tag-gray">atualize o agente para a versão 2.2: a 2.1 continua procurando na rede</span>':''}</div>` : '';
    return `<div class="ps-agent"><span class="ps-dot ${on?'on':'off'}" aria-hidden="true"></span><div class="ps-agent-info"><div class="ps-agent-name">${h(a.name)}${here}</div>
      <p class="sub">${on?'Ligado':'Desligado — visto '+h(psAgo(a.last_seen_at))}${a.machine?' · '+h(a.machine):''}${a.version?' · agente '+h(a.version):''}</p>${caixaSel}${scanRow}</div>
      <div class="ps-agent-actions"><button type="button" class="btn btn-sm" onclick="renamePrintAgent(${jsArg(a.id)})">Renomear</button><button type="button" class="btn btn-sm btn-danger" onclick="removePrintAgent(${jsArg(a.id)})">Remover</button></div></div>`; }).join('');
  const legacy = d.legacy_token ? `<div class="ps-agent"><span class="ps-dot ${psAlive(d.legacy_token.last_seen_at)?'on':'off'}" aria-hidden="true"></span><div><div class="ps-agent-name">Agente com o token do estabelecimento (modo antigo)</div>
      <p class="sub">${psAlive(d.legacy_token.last_seen_at)?'Ligado':'Desligado — visto '+h(psAgo(d.legacy_token.last_seen_at))} · imprime as fichas sem computador definido. Para a configuração automática, clique em "Desconectar" no agente e conecte com o código.</p></div></div>` : '';
  const steps = `<div class="ps-empty"><b>Nenhum computador conectado ainda.</b><ol>
      <li>No computador da impressora, abra o <b>agente de impressão do Commandah</b> (CommandahImpressora.exe) — <a href="downloads/CommandahImpressora.exe" download>baixar o agente</a>.</li>
      <li>A janela do agente mostra um código de 6 números.</li>
      <li>Clique em <b>Conectar computador</b> e digite o código.</li></ol></div>`;
  const real = found.filter(f=>!f.virtual), virt = found.filter(f=>f.virtual);
  const printersHtml = !agents.length ? '<p class="sub" style="margin:0">As impressoras aparecem aqui quando o primeiro computador for conectado.</p>'
    : !found.length ? '<p class="sub" style="margin:0">Nenhuma impressora encontrada ainda. Se acabou de conectar, espere alguns segundos.</p>'
    : `<div class="ps-list">${real.map(psPrinterCard).join('') || '<p class="sub" style="margin:0">Só foram encontradas impressoras virtuais (PDF, Fax…).</p>'}</div>
       ${virt.length?`<details class="ps-more"><summary>Outras impressoras do Windows (PDF, Fax…) — ${virt.length}</summary><div class="ps-list">${virt.map(psPrinterCard).join('')}</div></details>`:''}`;
  // Cadastradas que nenhum computador encontra (computador removido ou desligado, IP que sumiu, cadastro
  // antigo). Antes só apareciam na seção "avançada": a tela parecia vazia, mas o aviso de agente
  // desconectado continuava (25/10, relato do dono). Vale para qualquer estabelecimento.
  const agentsById = Object.fromEntries(agents.map(a=>[a.id,a]));
  const orphans = state.impressoras.filter(p=>{ const k = impKey(p); return !k || !psFound[k]; });
  const orphanReason = p=>{
    const a = p.agentId && agentsById[p.agentId];
    if(p.agentId && !a) return 'o computador dela foi removido';
    if(a) return a.name+(psAlive(a.last_seen_at) ? ' não está encontrando esta impressora' : ' está desligado');
    if(p.ip) return agents.length ? 'nenhum computador está encontrando este IP na rede' : 'nenhum computador conectado para mandar as fichas';
    return 'cadastro manual antigo, sem computador';
  };
  const orphansHtml = !orphans.length ? '' : `<div class="ps-block"><div class="ps-head"><h3>Cadastradas, mas sem computador que imprima</h3></div>
      <p class="sub" style="margin:0 0 8px">As fichas dessas estações não saem enquanto nenhum computador encontrar a impressora. Remova as que não usa mais.</p>
      <div class="ps-list">${orphans.map(p=>`<div class="ps-printer"><div class="ps-printer-top"><span class="ps-printer-name">${h(p.nome)}</span><span class="tag tag-gray">${h(printStationName(p.estacao))}</span></div>
        <div class="ps-printer-where">${p.ip?'Rede '+h(p.ip)+' · ':''}${h(orphanReason(p))}</div>
        <div><button type="button" class="btn btn-sm btn-danger" onclick="deleteImpressora(${jsArg(p.id)})">Remover</button></div></div>`).join('')}</div></div>`;
  box.innerHTML = `
    <div class="ps-block"><div class="ps-head"><h3>Computadores com o agente</h3><button type="button" class="btn btn-primary btn-sm" onclick="openPairAgentModal()">＋ Conectar computador</button></div>
      <div class="ps-list">${agentRows}${legacy}</div>${agents.length?'':steps}</div>
    <div class="ps-block"><div class="ps-head"><h3>Impressoras encontradas</h3>${agents.length?'<button type="button" class="btn btn-sm" onclick="requestPrinterRescan()">↻ Procurar de novo</button>':''}</div>
      ${printersHtml}${printSetupError?`<p class="sub" style="margin:8px 0 0;color:var(--c-danger)">${h(printSetupError)}</p>`:''}</div>
    ${orphansHtml}`;
}
async function togglePrinterStation(key, st){
  const fp = psFound[key]; if(!fp) return;
  const stName = printStationName(st);
  const mine = state.impressoras.filter(p=>impKey(p)===key && p.estacao===st);
  const partial = mine.length && mine.every(p=>p.origem && p.origem!=='ambos');
  if(mine.length && !partial){
    state.impressoras = state.impressoras.filter(p=>!mine.includes(p));
    await save('impressoras'); renderImpressoras();
    toast(stName+' deixou de imprimir em '+fp.title+'.'); logAction('Impressão: '+stName+' saiu de '+fp.title);
    return;
  }
  const others = state.impressoras.filter(p=>p.estacao===st && !mine.includes(p));
  if(others.length){
    const ok = await askConfirm({ title:'Trocar a impressora de '+stName+'?', message:stName+' hoje imprime em '+others.map(p=>p.nome).join(', ')+'. Passar a imprimir em '+fp.title+'?', confirmLabel:'Trocar', cancelLabel:'Manter como está', danger:false });
    if(!ok) return;
  }
  if(st!=='caixa' && saidaModoEstacao(st)==='tela'){
    const ok = await askConfirm({ title:'Ligar a impressão de '+stName+'?', message:stName+' está configurada para aparecer só na tela (Monitor de Cozinha). Passar para tela e impressora?', confirmLabel:'Tela e impressora', cancelLabel:'Cancelar', danger:false });
    if(!ok) return;
    const e = state.estacoes.find(x=>x.chave===st); if(e){ e.saida='ambos'; save('estacoes'); }
  }
  if(partial){
    // Já imprimia aqui só os pedidos de uma origem: passa a imprimir todos.
    mine.forEach(p=>p.origem='ambos');
    state.impressoras = state.impressoras.filter(p=>p.estacao!==st || mine.includes(p));
    await save('impressoras'); renderImpressoras();
    toast('Todos os pedidos de '+stName+' agora imprimem em '+fp.title+'.'); logAction('Impressão: '+stName+' passou a imprimir todos os pedidos em '+fp.title);
    return;
  }
  const paper = state.impressoras.filter(p=>impKey(p)===key).map(p=>Number(p.larguraPapel)).find(Boolean) || psPaper[key] || 80;
  state.impressoras = state.impressoras.filter(p=>p.estacao!==st);
  state.impressoras.push({ id:uid(), nome:stName+' — '+fp.title+(fp.kind==='windows'?' ('+((printSetup.agents||[]).find(a=>a.id===fp.agentId)||{}).name+')':''),
    osName: fp.kind==='windows' ? fp.name : '', ip: fp.kind==='rede' ? fp.name : '', agentId: fp.kind==='windows' ? fp.agentId : null,
    larguraPapel: paper, agentUrl:'', estacao:st, origem:'ambos', auto:true });
  await save('impressoras'); renderImpressoras();
  toast(stName+' agora imprime em '+fp.title+'. Faça um teste.'); logAction('Impressão: '+stName+' passou a imprimir em '+fp.title);
}
function setFoundPrinterPaper(key, v){
  psPaper[key] = Number(v)===58 ? 58 : 80;
  const list = state.impressoras.filter(p=>impKey(p)===key);
  if(!list.length) return;
  list.forEach(p=>p.larguraPapel = psPaper[key]);
  save('impressoras'); toast('Largura do papel: '+psPaper[key]+' mm.');
}
function setPsTestResult(key, cls, msg){
  psTestResults[key] = { cls, msg };
  document.querySelectorAll('[data-ps-test]').forEach(el=>{ if(el.dataset.psTest===key){ el.className='ps-test-result '+cls; el.textContent=msg; } });
}
async function testFoundPrinter(key){
  const fp = psFound[key]; if(!fp || !supabaseClient) return;
  const stations = state.impressoras.filter(p=>impKey(p)===key).map(p=>printStationName(p.estacao));
  const agentName = fp.kind==='windows' ? (((printSetup&&printSetup.agents)||[]).find(a=>a.id===fp.agentId)||{}).name || '' : '';
  const line = c=>c.repeat(32);
  const txt = line('=')+'\nTESTE DE IMPRESSAO - COMMANDAH\n'+line('=')+'\n'+new Date().toLocaleString('pt-BR')+'\nImpressora: '+fp.title+'\n'
    +(agentName?'Computador: '+agentName+'\n':'')+'Imprime: '+(stations.join(', ')||'(nada escolhido ainda)')+'\n'+line('-')+'\nSe este papel saiu, esta tudo certo.\n\n\n';
  const content = fp.kind==='rede' ? '\x1B\x40'+stripAccentsForPrint(txt)+'\n\n\n\x1D\x56\x01' : txt;
  setPsTestResult(key, '', 'Enviando…');
  const job = { tenant_id:getTenantId(), printer_name: fp.kind==='rede' ? 'Teste '+fp.name : fp.name, printer_ip: fp.kind==='rede' ? fp.name : null, content, status:'pendente' };
  if(fp.kind==='windows') job.agent_id = fp.agentId;
  const { data, error } = await supabaseClient.from('print_jobs').insert(job).select('id').single();
  if(error || !data){ setPsTestResult(key, 'err', '✗ Não foi possível mandar o teste: '+((error&&error.message)||'sem resposta')); return; }
  setPsTestResult(key, '', 'Esperando o agente…');
  for(let i=0; i<20; i++){
    await new Promise(r=>setTimeout(r, 1500));
    const { data:row } = await supabaseClient.from('print_jobs').select('status,error').eq('id', data.id).maybeSingle();
    if(row && row.status==='impresso'){ setPsTestResult(key, 'ok', '✓ Enviado às '+psTime(new Date())+'. Confira se o papel saiu.'); loadPrintSetup(); return; }
    if(row && row.status==='erro'){ setPsTestResult(key, 'err', '✗ '+(row.error||'A impressora não imprimiu.')); loadPrintSetup(); return; }
  }
  setPsTestResult(key, 'err', '✗ Nenhum agente pegou o teste em 30 s. '+(agentName?'O computador "'+agentName+'" está ligado e com o agente aberto?':'Algum computador conectado está ligado na mesma rede da impressora?'));
}
function openPairAgentModal(){
  openModal('Conectar computador', `
    <ol class="sub" style="line-height:1.7;padding-left:20px;margin-top:0">
      <li>No computador da impressora, abra o <b>agente de impressão do Commandah</b> (CommandahImpressora.exe). Ainda não tem? <a href="downloads/CommandahImpressora.exe" download>Baixar o agente</a>.</li>
      <li>A janela do agente mostra um código de 6 números.</li>
      <li>Digite o código aqui e dê um nome para esse computador.</li></ol>
    <div class="field"><label for="pairCode">Código que aparece no agente</label><input id="pairCode" class="pair-code-input" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="000 000"></div>
    <div class="field"><label for="pairName">Nome deste computador</label><input id="pairName" maxlength="60" placeholder="Ex.: PC do Caixa, PC da Cozinha"></div>
    <p id="pairError" class="sub" style="color:var(--c-danger)" hidden></p>
    <button class="btn btn-primary btn-block" id="pairBtn">Conectar</button>`);
  const btn = document.getElementById('pairBtn'), err = document.getElementById('pairError');
  document.getElementById('pairCode').focus();
  btn.onclick = async ()=>{
    const code = document.getElementById('pairCode').value.replace(/\D/g,''), name = document.getElementById('pairName').value.trim();
    if(code.length!==6){ err.hidden=false; err.textContent='O código tem 6 números. Confira na janela do agente.'; return; }
    if(!name){ err.hidden=false; err.textContent='Dê um nome para o computador, por exemplo "PC do Caixa".'; return; }
    btn.disabled = true; btn.textContent = 'Conectando…';
    try{
      const { data, error } = await supabaseClient.rpc('print_agent_pair_confirm', { p_code:code, p_name:name, p_by: currentUser ? currentUser.name : null });
      if(error){ err.hidden=false; err.textContent = error.message || 'Não foi possível conectar agora.'; return; }
      closeModal();
      toast('"'+((data&&data.name)||name)+'" conectado. Em alguns segundos as impressoras dele aparecem aqui.');
      loadPrintSetup(); setTimeout(loadPrintSetup, 6000); setTimeout(loadPrintSetup, 15000);
    }catch(e){ err.hidden=false; err.textContent='Não foi possível conectar agora. Confira a internet.'; }
    finally{ btn.disabled = false; btn.textContent = 'Conectar'; }
  };
}
function renamePrintAgent(id){
  const a = ((printSetup&&printSetup.agents)||[]).find(x=>x.id===id); if(!a) return;
  openModal('Renomear computador', `<div class="field"><label for="psRename">Nome</label><input id="psRename" maxlength="60" value="${h(a.name)}"></div><button class="btn btn-primary btn-block" id="psRenameBtn">Salvar</button>`);
  document.getElementById('psRenameBtn').onclick = async ()=>{
    const name = document.getElementById('psRename').value.trim(); if(!name){ toast('Informe o nome.'); return; }
    const { error } = await supabaseClient.rpc('print_agent_manage', { p_action:'rename', p_agent_id:id, p_name:name });
    if(error){ toast(error.message||'Não foi possível renomear.'); return; }
    closeModal(); toast('Computador renomeado.'); loadPrintSetup();
  };
}
async function removePrintAgent(id){
  const a = ((printSetup&&printSetup.agents)||[]).find(x=>x.id===id); if(!a) return;
  const used = state.impressoras.filter(p=>p.agentId===id || p.deviceAgentId===id);
  const ok = await askConfirm({ title:'Remover "'+a.name+'"?', message:'O agente desse computador para de imprimir até ser conectado de novo com um código novo.'+(used.length?' As escolhas das impressoras dele ('+used.map(p=>printStationName(p.estacao)).join(', ')+') também saem.':''), confirmLabel:'Remover computador', cancelLabel:'Manter' });
  if(!ok) return;
  const { error } = await supabaseClient.rpc('print_agent_manage', { p_action:'remove', p_agent_id:id, p_by: currentUser ? currentUser.name : null });
  if(error){ toast(error.message||'Não foi possível remover.'); return; }
  if(used.length){ state.impressoras = state.impressoras.filter(p=>p.agentId!==id && p.deviceAgentId!==id); await save('impressoras'); }
  toast('"'+a.name+'" removido.'); renderImpressoras();
}
async function requestPrinterRescan(){
  const { error } = await supabaseClient.rpc('print_agent_manage', { p_action:'rescan' });
  if(error){ toast(error.message||'Não foi possível pedir a busca.'); return; }
  toast('Os computadores ligados vão procurar as impressoras em até 1 minuto.');
  setTimeout(loadPrintSetup, 20000); setTimeout(loadPrintSetup, 65000);
}
// ---------- t108: busca na rede desligável + impressora pelo IP ----------
function psVersionBelow(v, min){
  const a = String(v).split('.').map(n=>parseInt(n,10)||0), b = String(min).split('.').map(n=>parseInt(n,10)||0);
  for(let i=0; i<Math.max(a.length,b.length); i++){ if((a[i]||0)!==(b[i]||0)) return (a[i]||0) < (b[i]||0); }
  return false;
}
function psManageError(error){
  return /ação inválida/i.test((error&&error.message)||'') ? 'O servidor ainda não tem esta opção: falta aplicar a atualização do banco 20261012000000.'
    : ((error&&error.message) || 'Não foi possível salvar agora. Confira a internet.');
}
function psValidIp(ip){
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(ip);
  return !!m && m.slice(1,5).every(n=>Number(n)<=255) && (m[5]===undefined || (Number(m[5])>=1 && Number(m[5])<=65535));
}
async function setAgentScan(id, on, el){
  const a = ((printSetup&&printSetup.agents)||[]).find(x=>x.id===id); if(!a || !supabaseClient) return;
  const by = currentUser ? currentUser.name : null;
  if(!on){
    // As de rede que esse computador achou sozinho e já imprimem algo viram "escolhidas"; as outras saem da lista.
    const mine = ((printSetup&&printSetup.printers)||[]).filter(p=>p.agent_id===id && p.kind==='rede' && !p.manual);
    const keep = mine.filter(p=>state.impressoras.some(i=>impKey(i)==='rede:'+p.name)), drop = mine.filter(p=>!keep.includes(p));
    const ok = await askConfirm({ title:'Desligar a busca na rede no "'+a.name+'"?',
      message:'O agente deixa de procurar impressoras na rede e passa a usar só as USB deste computador e as impressoras adicionadas pelo IP.'
        +(keep.length?' Continuam, porque já imprimem algo: '+keep.map(p=>p.name).join(', ')+'.':'')+(drop.length?' Saem da lista: '+drop.map(p=>p.name).join(', ')+'.':''),
      confirmLabel:'Desligar a busca', cancelLabel:'Cancelar', danger:false });
    if(!ok){ if(el) el.checked = true; return; }
    for(const p of keep){
      const { error } = await supabaseClient.rpc('print_agent_manage', { p_action:'add_ip', p_agent_id:id, p_name:p.name, p_by:by });
      if(error){ if(el) el.checked = true; toast(psManageError(error)); return; }
    }
  }
  const { error } = await supabaseClient.rpc('print_agent_manage', { p_action:on?'scan_on':'scan_off', p_agent_id:id, p_by:by });
  if(error){ if(el) el.checked = !on; toast(psManageError(error)); return; }
  toast(on ? 'Busca ligada. O "'+a.name+'" procura as impressoras em até 1 minuto.' : 'Busca desligada no "'+a.name+'". Vale em até 1 minuto.');
  logAction('Impressão: busca de impressoras na rede '+(on?'ligada':'desligada')+' no '+a.name);
  loadPrintSetup(); if(on){ setTimeout(loadPrintSetup, 20000); setTimeout(loadPrintSetup, 65000); }
}
function openAddPrinterIpModal(agentId){
  const a = ((printSetup&&printSetup.agents)||[]).find(x=>x.id===agentId); if(!a) return;
  openModal('Impressora de rede pelo IP', `
    <p class="sub" style="margin-top:0">O agente do <b>${h(a.name)}</b> passa a imprimir nesse endereço e confere se ele responde. Serve para impressora em outra faixa de rede ou quando a busca automática está desligada.</p>
    <div class="field"><label for="psIp">IP da impressora</label><input id="psIp" inputmode="decimal" autocomplete="off" maxlength="21" placeholder="Ex.: 192.168.110.113"></div>
    <p class="sub" style="margin-top:-6px">O IP aparece na folha de teste da impressora. Se ela usa uma porta diferente de 9100, escreva depois de dois-pontos (192.168.110.113:9101).</p>
    <p id="psIpError" class="sub" style="color:var(--c-danger)" hidden></p>
    <button class="btn btn-primary btn-block" id="psIpBtn">Adicionar</button>`);
  const input = document.getElementById('psIp'), err = document.getElementById('psIpError'), btn = document.getElementById('psIpBtn');
  input.focus();
  input.onkeydown = e=>{ if(e.key==='Enter') btn.click(); };
  btn.onclick = async ()=>{
    const ip = input.value.trim().replace(/\s+/g,'');
    if(!psValidIp(ip)){ err.hidden = false; err.textContent = 'Confira o IP: são 4 números de 0 a 255 separados por ponto, como 192.168.110.113.'; return; }
    btn.disabled = true; btn.textContent = 'Adicionando…';
    try{
      const { error } = await supabaseClient.rpc('print_agent_manage', { p_action:'add_ip', p_agent_id:agentId, p_name:ip, p_by: currentUser ? currentUser.name : null });
      if(error){ err.hidden = false; err.textContent = psManageError(error); return; }
      closeModal();
      toast('Impressora '+ip+' adicionada ao "'+a.name+'". Escolha o que ela imprime e faça um teste.');
      logAction('Impressão: impressora de rede '+ip+' adicionada pelo IP no '+a.name);
      loadPrintSetup(); setTimeout(loadPrintSetup, 20000); setTimeout(loadPrintSetup, 65000);
    }catch(e){ err.hidden = false; err.textContent = 'Não foi possível adicionar agora. Confira a internet.'; }
    finally{ btn.disabled = false; btn.textContent = 'Adicionar'; }
  };
}
async function removeNetworkPrinter(ip){
  if(!supabaseClient) return;
  const d = printSetup || {}, agents = d.agents || [];
  const used = state.impressoras.filter(p=>impKey(p)==='rede:'+ip);
  const scanning = agents.filter(a=>a.scan_network!==false && (d.printers||[]).some(p=>p.agent_id===a.id && p.kind==='rede' && p.name===ip && !p.manual));
  const ok = await askConfirm({ title:'Remover a impressora '+ip+'?',
    message:'Ela sai da lista de impressoras. '+(used.length?'Deixa de imprimir: '+[...new Set(used.map(p=>printStationName(p.estacao)))].join(', ')+'. ':'')
      +(scanning.length?'Atenção: a busca na rede está ligada no '+scanning.map(a=>a.name).join(', ')+', então ela pode voltar a aparecer na próxima busca. Para não voltar, desligue a busca nesse computador.':''),
    confirmLabel:'Remover', cancelLabel:'Manter' });
  if(!ok) return;
  const { error } = await supabaseClient.rpc('print_agent_manage', { p_action:'remove_ip', p_name:ip, p_by: currentUser ? currentUser.name : null });
  if(error){ toast(psManageError(error)); return; }
  if(used.length){ state.impressoras = state.impressoras.filter(p=>!used.includes(p)); await save('impressoras'); }
  delete psTestResults['rede:'+ip];
  toast('Impressora '+ip+' removida.'); logAction('Impressão: impressora de rede '+ip+' removida');
  renderImpressoras();
}
// Modelo da ficha (renderTicketConfigHtml, saveTicketConfig): impressao/ficha.js (t217).
async function checkPrintTokenStatus(){
  const box = document.getElementById('printTokenStatus'); if(!box || !supabaseClient) return;
  try{
    const { data, error } = await supabaseClient.from('print_agent_tokens').select('rotated_at').maybeSingle();
    if(error) throw error;
    box.textContent = data ? ('Token ativo, gerado/renovado em '+dataHoraBR(data.rotated_at)+'.') : 'Nenhum token gerado ainda — clique em "Gerar/Regenerar token".';
  }catch(e){ box.textContent = 'Não foi possível checar o status do token.'; }
}
async function regeneratePrintAgentToken(){
  if(!supabaseClient){ toast('Disponível só no modo nuvem (Supabase).'); return; }
  if(!confirm('Gerar um novo token vai invalidar o token anterior — qualquer agente de impressão já configurado vai parar de funcionar até você colar o novo token nele. Continuar?')) return;
  try{
    // Dono ou administrador (migration 20261011060000); o nome vai para o audit_log.
    const { data, error } = await supabaseClient.rpc('regenerate_print_agent_token', { p_by: currentUser ? currentUser.name : null });
    if(error){
      if(error.code==='42501' || /tenant owner/i.test(error.message||'')){ toast('Só o administrador gera o token do agente de impressão.'); return; }
      throw error;
    }
    openModal('Token do agente de impressão', `
      <p class="sub">Copie esse token agora e cole no agente de impressão (ele pede na primeira vez que roda, ou quando o token muda). Ele não será mostrado de novo — se perder, gere outro.</p>
      <div class="field"><input value="${h(data)}" readonly class="mono" onclick="this.select()"></div>
    `);
    checkPrintTokenStatus();
  }catch(e){ toast('Não foi possível gerar o token: '+(e.message||e)); }
}

function openImpressoraModal(id){
  const p = id ? state.impressoras.find(x=>x.id===id) : null;
  openModal((p?'Editar':'Nova')+' — Impressora', `
    <div class="field"><label>Nome da impressora (no sistema)</label><input id="impNome" value="${p?h(p.nome):''}" placeholder="Ex: Impressora Bar — App"></div>
    <div class="field"><label>Nome exato no Windows/Mac (opcional)</label><input id="impOsName" value="${p?h(p.osName||''):''}" placeholder="Ex: EPSON TM-T20X"><p class="sub">Se preenchido, o agente de impressão local usa esse nome exato pra imprimir sem abrir tela nenhuma. Deixe em branco pra usar o nome acima.</p></div>
    <div class="field"><label>IP da impressora de rede (opcional)</label><input id="impIp" value="${p?h(p.ip||''):''}" placeholder="Ex: 192.168.110.112"><p class="sub">Preencha só se for impressora de rede (RJ45/Wi-Fi) — o agente manda direto pro IP, na porta 9100, sem instalar no Windows e sem depender de driver. Deixe em branco pra impressora local (USB), que usa o nome do Windows acima.</p></div>
    <div class="field"><label>Largura do papel</label><select id="impLargura">
      <option value="80" ${!p||Number(p.larguraPapel)!==58?'selected':''}>80mm (48 colunas)</option>
      <option value="58" ${p&&Number(p.larguraPapel)===58?'selected':''}>58mm (32 colunas)</option>
    </select></div>
    <div class="field"><label>Endereço do agente na rede (opcional, modo antigo)</label><input id="impAgentUrl" value="${p?h(p.agentUrl||''):''}" placeholder="Deixe em branco — não é mais necessário"><p class="sub">Com a fila de impressão via nuvem ativa, isso não é mais necessário — o agente encontra os pedidos sozinho, de qualquer aparelho. Só preencha se estiver usando o modo antigo sem Supabase.</p></div>
    <div class="field"><label>Estação</label><select id="impEstacao">
      ${state.estacoes.map(e=>`<option value="${h(e.chave)}" ${(p&&p.estacao===e.chave)||(!p&&e.chave==='cozinha')?'selected':''}>${h(e.nome)}</option>`).join('')}
    </select></div>
    <div class="field"><label>Origem atendida</label><select id="impOrigem">
      ${state.origens.map(o=>`<option value="${h(o.chave)}" ${p&&p.origem===o.chave?'selected':''}>Só pedidos: ${h(o.nome)}</option>`).join('')}
      <option value="ambos" ${!p||p.origem==='ambos'?'selected':''}>Todas as origens (compartilhada)</option>
    </select></div>
    <button class="btn btn-primary btn-block" id="impSaveBtn">Salvar</button>
  `);
  document.getElementById('impSaveBtn').onclick = ()=>{
    const nome = document.getElementById('impNome').value.trim();
    if(!nome){ toast('Informe o nome da impressora.'); return; }
    const data = { nome, osName:document.getElementById('impOsName').value.trim(), ip:document.getElementById('impIp').value.trim(), larguraPapel:Number(document.getElementById('impLargura').value), agentUrl:document.getElementById('impAgentUrl').value.trim().replace(/^https?:\/\//,'').replace(/\/$/,''), estacao:document.getElementById('impEstacao').value, origem:document.getElementById('impOrigem').value };
    if(p){ Object.assign(p,data); } else { state.impressoras.push({id:uid(), ...data}); }
    save('impressoras'); closeModal(); renderAll(); toast('Impressora salva.');
  };
}
async function deleteImpressora(id){
  const p = state.impressoras.find(x=>x.id===id); if(!p) return;
  const ok = await askConfirm({ title:'Remover "'+p.nome+'"?', message:'Ela sai da lista de impressoras e '+printStationName(p.estacao)+' deixa de imprimir nela.', confirmLabel:'Remover', cancelLabel:'Manter' });
  if(!ok) return;
  state.impressoras = state.impressoras.filter(x=>x.id!==id);
  await save('impressoras'); logAction('Impressão: impressora "'+p.nome+'" removida'); renderAll();
}
function resolvePrinterFor(estacao, origem){
  // Sem preparo (água, refrigerante lacrado) não tem impressora própria: sai no bar, que entrega
  // (decisão de 12/10). No computador de caixa continua saindo no caixa (deviceCaixaPrinter).
  if(estacao==='nenhuma' && !state.impressoras.some(p=>p.estacao==='nenhuma')) return resolvePrinterFor('bar', origem);
  const exact = state.impressoras.find(p=>p.estacao===estacao && p.origem===origem);
  if(exact) return exact;
  const shared = state.impressoras.find(p=>p.estacao===estacao && p.origem==='ambos');
  if(shared) return shared;
  if(currentUser && currentUser.role==='admin'){
    return state.impressoras.find(p=>p.estacao===estacao) || null;
  }
  return null;
}

/* ============ FICHAS DE PEDIDO E AVISO DE FICHA NÃO IMPRESSA (vieram de fiscal/nfce-cupom.js, codigo-limpo passo E) ============ */
async function printSingleTicket(who, cota, local, estacao, printer, items, orderNumber){
  // Computador de caixa: tudo que for lançado aqui sai na impressora dele (ver deviceCaixaPrinter).
  // Exceção (12/10): estações com preparo (padrão: Cozinha) mandam a ficha para a impressora delas,
  // não para a do caixa; o resto (bebida, lanche pronto, sem preparo) sai no caixa para o cliente retirar.
  const devicePrinter = deviceCaixaPrinter();
  if(devicePrinter && !(caixaKeepsStation(devicePrinter, estacao) && printer)) printer = devicePrinter.nome;
  if(printer){
    const imp = state.impressoras.find(p=>p.nome===printer);
    const targetName = imp&&imp.osName ? imp.osName : printer;
    const useEscPos = !!(imp && imp.ip);
    const text = buildTicketText(who, cota, local, estacao, items, orderNumber, paperColumns(imp), useEscPos);
    if(supabaseClient && getTenantId()){
      try{
        // agent_id: impressora USB escolhida na configuração automática vai para o computador dela.
        const job = { tenant_id: getTenantId(), printer_name: targetName, printer_ip: imp&&imp.ip||null, content: text, status: 'pendente' };
        if(imp && imp.agentId) job.agent_id = imp.agentId;
        let { error } = await supabaseClient.from('print_jobs').insert(job);
        // Computador removido (ou banco sem a coluna): manda sem computador definido, como antes.
        if(error && job.agent_id){ delete job.agent_id; ({ error } = await supabaseClient.from('print_jobs').insert(job)); }
        if(!error){ toast('Pedido enviado pra fila de impressão: '+printer); return; }
      }catch(e){ /* cai pro modo antigo abaixo */ }
    }
    const base = printerAgentBase(imp);
    try{
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 4000);
      const res = await fetch(base+'/print', {
        method:'POST', signal:ctrl.signal,
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ printer: targetName, text, ip: imp&&imp.ip||'' }) // agente 2.0: impressora de rede pelo IP
      });
      clearTimeout(t);
      if(res.ok){ toast('Impresso automaticamente: '+printer); return; }
    }catch(e){ /* agente indisponível — cai no modo com caixa de diálogo abaixo */ }
  }
  // OP-19: nada de janela automática (no celular do garçom ela é bloqueada e a ficha
  // sumia). O pedido fica num aviso vermelho fixo até alguém imprimir aqui ou resolver.
  notePrintFailure({ who, cota, local, estacao, printer, items, orderNumber, at:new Date().toISOString() });
}
/* OP-19 (decisão do dono): ficha que não foi para a impressora vira um aviso vermelho e
   fixo, em vez da janela de impressão do navegador. "Imprimir aqui" abre todas as fichas
   pendentes numa janela só (é um toque do operador, o navegador não bloqueia). Estação
   que também tem tela (Monitor de Cozinha) e não tem impressora só avisa: o pedido está
   na tela. */
let failedPrintTickets = [];
function notePrintFailure(t){
  if(!t.printer && saidaTemTela(t.estacao)){ toast('Sem impressora para '+(estacaoLabel(t.estacao)||t.estacao)+': o pedido está só no Monitor de Cozinha.'); return; }
  failedPrintTickets.push(t);
  renderPrintFailBanner();
}
function renderPrintFailBanner(){
  const root = document.getElementById('localModeRoot'); if(!root) return;
  let el = root.querySelector('.print-fail');
  if(!failedPrintTickets.length){ if(el){ el.remove(); applyTopBannerOffset(); } return; }
  if(!el){
    el = document.createElement('div');
    el.className = 'local-mode print-stuck print-fail';
    el.setAttribute('role','alert');
    el.innerHTML = '<div class="local-mode-ico" aria-hidden="true">&#128424;</div><div class="local-mode-txt"><span class="local-mode-title"></span><span class="local-mode-sub"></span></div>'
      + '<div class="print-fail-actions"><button type="button" class="local-mode-btn" data-a="print">Imprimir aqui</button><button type="button" class="local-mode-btn print-fail-done" data-a="done">Já resolvi</button></div>';
    el.querySelector('[data-a="print"]').addEventListener('click', printFailedTicketsHere);
    el.querySelector('[data-a="done"]').addEventListener('click', ()=>{ logAction('Aviso de ficha não impressa dispensado ('+failedPrintTickets.length+' ficha(s))'); failedPrintTickets = []; renderPrintFailBanner(); });
    root.appendChild(el);
  }
  const last = failedPrintTickets[failedPrintTickets.length-1], est = estacaoLabel(last.estacao)||last.estacao;
  const n = failedPrintTickets.length;
  el.querySelector('.local-mode-title').textContent = last.printer
    ? (n===1 ? 'Ficha de '+est+' não foi para a impressora' : n+' fichas não foram para a impressora')
    : (n===1 ? 'Estação '+est+' sem impressora: item não impresso' : n+' fichas sem impressora: itens não impressos');
  const resumo = failedPrintTickets.slice(-3).map(t=>(t.orderNumber?'#'+t.orderNumber+' ':'')+(t.who||'')+' ('+(estacaoLabel(t.estacao)||t.estacao)+')').join(' · ');
  el.querySelector('.local-mode-sub').textContent = resumo + '. Toque em "Imprimir aqui" para sair na impressora deste aparelho, ou leve o pedido até a estação.'
    + (last.printer ? ' Confira se o agente de impressão está aberto no computador.' : ' Cadastre a impressora em Configurações › Impressoras.');
  applyTopBannerOffset();
}
function ticketPopupHtml(t){
  // t217: mesma ficha do modelo configurado (impressao/ficha.js), desenhada em HTML.
  const { who, cota, local, estacao, printer, items, orderNumber } = t;
  return `<section class="ticket">
    ${ticketLinesToHtml(buildTicketLines(who, cota, local, estacao, items, orderNumber), 48)}
    ${printer?`<div class="printer">Imprimir na: <b>${h(printer)}</b> (não recebeu a ficha; impressa neste aparelho)</div>`:`<div class="warn">Nenhuma impressora configurada para ${h(estacaoLabel(estacao)||estacao)} nesta origem — encaminhar manualmente.</div>`}
  </section>`;
}
function printFailedTicketsHere(){
  const list = failedPrintTickets.slice();
  if(!list.length) return;
  const win = window.open('', '_blank', 'width=380,height=600');
  if(!win){ toast('O navegador bloqueou a janela de impressão. Libere as janelas deste site e toque de novo.', 'error'); return; }
  win.document.write(`<html><head><title>Fichas não impressas</title><style>
    body{font-family:Arial,sans-serif;padding:16px;font-size:13px;color:#111}
    h1{font-size:16px;margin:0 0 4px}
    .muted{color:#666;font-size:11px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    td{padding:4px 0;border-bottom:1px dashed #ccc}
    .total{font-weight:bold;font-size:15px;margin-top:12px;text-align:right}
    .local{background:none;color:#000;border:2px solid #000;padding:6px 10px;font-weight:bold;font-size:16px;margin:8px 0}
    .estacao{background:none;color:#000;border:2px solid #000;padding:6px 10px;font-weight:bold;font-size:16px;margin:8px 0 4px}
    .printer{color:#666;font-size:11px;margin-top:8px}
    .warn{color:#c1443c;font-size:11px;margin-top:8px;font-weight:bold}
    .ticket{page-break-after:always;break-after:page}
    .ticket:last-child{page-break-after:auto;break-after:auto}
  </style></head><body>${list.map(ticketPopupHtml).join('')}</body></html>`);
  win.document.close(); win.focus();
  setTimeout(()=>{ win.print(); }, 300);
  failedPrintTickets = failedPrintTickets.filter(t=>!list.includes(t));
  logAction(list.length+' ficha(s) não impressa(s) enviada(s) para impressão neste aparelho');
  renderPrintFailBanner();
}
