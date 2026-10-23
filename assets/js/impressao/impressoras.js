/* ============ IMPRESSORAS (estação + origem) ============ */
function estacaoLabel(chave){ const e=state.estacoes.find(x=>x.chave===chave); return e?e.nome:chave==='nenhuma'?'Sem preparo':(chave||'—'); }
function origemLabel(chave){ if(chave==='ambos') return 'Caixa e App (compartilhada)'; const o=state.origens.find(x=>x.chave===chave); return o?o.nome:(chave||'—'); }
function slugifyEstacao(nome){ return String(nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,40)||uid(); }
function slugifyOrigem(nome){ return String(nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,40)||uid(); }
function renderOrigens(){
  const el = document.getElementById('view-origens'); if(!el) return;
  const rows = state.origens.length ? state.origens.map(o=>{
    const emUso = state.users.some(u=>u.origem===o.chave) || state.impressoras.some(p=>p.origem===o.chave);
    return `<tr><td><b>${h(o.nome)}</b><br><small class="mono" style="color:var(--muted)">${h(o.chave)}</small></td>
    <td>${state.users.filter(u=>u.origem===o.chave).length} usuário(s)</td>
    <td>${state.impressoras.filter(p=>p.origem===o.chave).length} impressora(s)</td>
    <td><button class="btn btn-sm" onclick="openOrigemModal(${jsArg(o.id)})">Editar</button>
    <button class="btn btn-sm btn-danger" onclick="deleteOrigem(${jsArg(o.id)})" ${emUso?'disabled title="Em uso por usuários ou impressoras — remova os vínculos primeiro"':''}>Excluir</button></td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">Nenhuma origem cadastrada.</td></tr>`;
  el.innerHTML = `<div class="panel"><h2>Origens de Pedido</h2>
    <p class="sub">Uma origem é de onde um pedido chega (Caixa, App do Garçom, Totem, iFood, WhatsApp — o que fizer sentido pro seu negócio). Impressoras e usuários se vinculam a uma origem pra saber pra onde rotear cada pedido.</p>
    <button class="btn btn-primary" onclick="openOrigemModal()">+ Nova origem</button>
    <table style="margin-top:14px"><tr><th>Origem</th><th>Usuários</th><th>Impressoras vinculadas</th><th>Ações</th></tr>${rows}</table>
  </div>`;
}
function openOrigemModal(id){
  const o = id ? state.origens.find(x=>x.id===id) : null;
  openModal(o?'Editar Origem':'Nova Origem', `
    <div class="field"><label>Nome da origem</label><input id="origNome" value="${o?h(o.nome):''}" placeholder="Ex: Caixa, App do Garçom, Totem, iFood..."></div>
    <button class="btn btn-primary btn-block" onclick="saveOrigem(${jsArg(o?o.id:'')})">Salvar</button>
  `);
}
function saveOrigem(id){
  const nome = document.getElementById('origNome').value.trim();
  if(!nome){ toast('Informe o nome da origem.'); return; }
  const existing = id ? state.origens.find(x=>x.id===id) : null;
  if(existing){ existing.nome = nome; }
  else {
    let chave = slugifyOrigem(nome);
    if(state.origens.some(x=>x.chave===chave) || chave==='ambos') chave = chave+'-'+Math.random().toString(36).slice(2,5);
    state.origens.push({id:uid(), chave, nome});
  }
  save('origens'); closeModal(); renderAll(); toast('Origem salva.');
}
function deleteOrigem(id){
  const o = state.origens.find(x=>x.id===id); if(!o) return;
  const emUso = state.users.some(u=>u.origem===o.chave) || state.impressoras.some(p=>p.origem===o.chave);
  if(emUso){ toast('Essa origem está em uso por usuários ou impressoras — remova os vínculos primeiro.'); return; }
  if(!confirm('Excluir a origem "'+o.nome+'"?')) return;
  state.origens = state.origens.filter(x=>x.id!==id);
  save('origens'); renderAll(); toast('Origem excluída.');
}
function renderEstacoes(){
  const el = document.getElementById('view-estacoes'); if(!el) return;
  const rows = state.estacoes.length ? state.estacoes.map(e=>{
    const emUso = state.products.some(p=>p.estacao===e.chave) || state.impressoras.some(p=>p.estacao===e.chave);
    return `<tr><td><b>${h(e.nome)}</b><br><small class="mono" style="color:var(--muted)">${h(e.chave)}</small></td>
    <td>${({imprime:'Só imprimir',tela:'Só tela (Monitor)',ambos:'Imprimir + Tela'})[e.saida]||e.saida}</td>
    <td>${state.impressoras.filter(p=>p.estacao===e.chave).length} impressora(s)</td>
    <td><button class="btn btn-sm" onclick="openEstacaoModal(${jsArg(e.id)})">Editar</button>
    <button class="btn btn-sm btn-danger" onclick="deleteEstacao(${jsArg(e.id)})" ${emUso?'disabled title="Em uso por produtos ou impressoras — remova os vínculos primeiro"':''}>Excluir</button></td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">Nenhuma estação cadastrada.</td></tr>`;
  el.innerHTML = `<div class="panel"><h2>Estações</h2>
    <p class="sub">Uma estação é qualquer ponto de preparo do seu estabelecimento (Cozinha, Bar, Churrasqueira, Sobremesas, Confeitaria — o que fizer sentido pro seu negócio). Cada uma define se o pedido é impresso, mostrado num monitor/TV, ou os dois. Crie, edite ou remova estações livremente — produtos e impressoras se conectam a elas.</p>
    <button class="btn btn-primary" onclick="openEstacaoModal()">+ Nova estação</button>
    <table style="margin-top:14px"><tr><th>Estação</th><th>Modo de saída</th><th>Impressoras vinculadas</th><th>Ações</th></tr>${rows}</table>
  </div>`;
}
function openEstacaoModal(id){
  const e = id ? state.estacoes.find(x=>x.id===id) : null;
  openModal(e?'Editar Estação':'Nova Estação', `
    <div class="field"><label>Nome da estação</label><input id="estNome" value="${e?h(e.nome):''}" placeholder="Ex: Cozinha, Bar, Sobremesas, Confeitaria..."></div>
    <div class="field"><label>Modo de saída</label><select id="estSaida">
      <option value="imprime" ${!e||e.saida==='imprime'?'selected':''}>Só imprimir</option>
      <option value="tela" ${e&&e.saida==='tela'?'selected':''}>Só tela (Monitor)</option>
      <option value="ambos" ${e&&e.saida==='ambos'?'selected':''}>Imprimir + Tela</option>
    </select><p class="sub">"Tela" mostra os pedidos dessa estação no Monitor de Produção (kanban tipo TV). "Imprimir" manda ticket pra impressora configurada.</p></div>
    <button class="btn btn-primary btn-block" onclick="saveEstacao(${jsArg(e?e.id:'')})">Salvar</button>
  `);
}
function saveEstacao(id){
  const nome = document.getElementById('estNome').value.trim();
  if(!nome){ toast('Informe o nome da estação.'); return; }
  const saida = document.getElementById('estSaida').value;
  const existing = id ? state.estacoes.find(x=>x.id===id) : null;
  if(existing){ existing.nome = nome; existing.saida = saida; }
  else {
    let chave = slugifyEstacao(nome);
    if(state.estacoes.some(x=>x.chave===chave)) chave = chave+'-'+Math.random().toString(36).slice(2,5);
    state.estacoes.push({id:uid(), chave, nome, saida});
  }
  save('estacoes'); closeModal(); renderAll(); toast('Estação salva.');
}
function deleteEstacao(id){
  const e = state.estacoes.find(x=>x.id===id); if(!e) return;
  const emUso = state.products.some(p=>p.estacao===e.chave) || state.impressoras.some(p=>p.estacao===e.chave);
  if(emUso){ toast('Essa estação está em uso por produtos ou impressoras — remova os vínculos primeiro.'); return; }
  if(!confirm('Excluir a estação "'+e.nome+'"?')) return;
  state.estacoes = state.estacoes.filter(x=>x.id!==id);
  save('estacoes'); renderAll(); toast('Estação excluída.');
}
let lastAgentProbeAt = Date.now(); // o login já procura o agente (afterLogin)
function renderImpressoras(){
  const el = document.getElementById('view-impressoras');
  const rows = state.impressoras.length ? state.impressoras.map(p=>`
    <tr><td>${h(p.nome)}${p.osName?`<br><small class="mono" style="color:var(--muted)">${h(p.osName)}</small>`:''}${p.ip?`<br><small class="mono" style="color:var(--muted)">rede: ${h(p.ip)}</small>`:''}</td><td>${h(printStationName(p.estacao)||'—')}</td><td>${h(origemLabel(p.origem)||'—')}</td>
    <td>${p.agentUrl?`<span class="mono" style="font-size:12px">${h(p.agentUrl)}</span>`:'<span class="sub" style="font-size:12px">— (mesmo computador)</span>'}</td>
    <td id="impStatus-${p.id}"><span class="tag tag-gray">verificando...</span></td>
    <td><button class="btn btn-sm" onclick="openImpressoraModal(${jsArg(p.id)})">Editar</button>
    <button class="btn btn-sm btn-danger" onclick="deleteImpressora(${jsArg(p.id)})">Excluir</button></td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">Nenhuma impressora cadastrada.</td></tr>`;
  el.innerHTML = `<div class="panel"><h2>Impressoras</h2>
    ${supabaseClient?`<p class="sub">Abra o agente de impressão em cada computador que tem impressora ligada no USB e conecte com o código que aparece nele. As impressoras de rede (cabo de rede ou Wi-Fi, sem computador) são encontradas pelos computadores conectados na mesma rede. Depois é só escolher aqui o que cada impressora imprime e fazer o teste.</p>
    <div id="printSetupAuto"><div class="ps-block"><p class="sub" style="margin:0">Carregando…</p></div></div>`:''}
    <details class="ps-advanced" ${!supabaseClient||psAdvancedOpen?'open':''} ontoggle="psAdvancedOpen=this.open"><summary>Configuração manual e token antigo (avançado)</summary>
    <p class="sub">Cada impressora atende uma estação. Gerencie quais estações existem e o modo de saída (imprimir/tela) de cada uma em <a href="#" onclick="switchView('estacoes');return false" style="color:var(--c-primary-text);font-weight:600">Configurações → Áreas do Clube → Estações</a>.</p>
    <div id="agentStatusBox" class="tag tag-gray" style="margin-bottom:14px">Verificando agentes de impressão...</div>
    ${supabaseClient?`<div class="field" style="margin-bottom:14px"><label>Token do agente de impressão</label>
      <div id="printTokenStatus" class="sub">Verificando...</div>
      <button class="btn btn-sm" onclick="regeneratePrintAgentToken()">Gerar/Regenerar token</button>
      <p class="sub">Cole esse token no agente de impressão local (ele pede na primeira vez que roda, ou quando você regenerar). Regenerar invalida o token anterior — os agentes já configurados param até você colar o novo.</p>
    </div>`:''}
    <button class="btn btn-primary" onclick="openImpressoraModal()">+ Nova impressora</button>
    <table style="margin-top:14px"><tr><th>Nome</th><th>Estação</th><th>Origem atendida</th><th>Agente (rede)</th><th>Status</th><th>Ações</th></tr>${rows}</table>
    </details>
    ${renderTicketConfigHtml()}
  </div>`;
  // renderAll redesenha esta tela mesmo escondida (ao bloquear comanda, trocar de tela, sincronizar...).
  // As checagens abaixo perguntam ao agente local (localhost:9123) e ao servidor: só com a tela aberta,
  // senão todo computador sem agente enche o console de ERR_CONNECTION_REFUSED (23/10, relato do dono).
  // Fora dela, o agente ligado depois do login ainda é achado: no máximo uma busca por minuto, e
  // detectLocalPrintAgent() sem força só pergunta se existe caixa que imprime tudo.
  if(activeView!=='impressoras'){
    if(!localPrintAgent && Date.now()-lastAgentProbeAt>60000){ lastAgentProbeAt=Date.now(); detectLocalPrintAgent(); }
    return;
  }
  renderPrinterQueueStatus();
  checkPrintTokenStatus();
  if(supabaseClient){ renderPrintSetupAuto(); loadPrintSetup(); startPrintSetupPolling(); detectLocalPrintAgent(true).then(renderPrintSetupAuto); }
}

