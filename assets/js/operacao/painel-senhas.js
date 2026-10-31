/* ============ PAINEL DE SENHAS ============ */
function renderPainelSenhas(){
  const el = document.getElementById('view-painel-senhas');
  const cfg=state.settings.scoreboard||{},cutoff=Date.now()-(Number(cfg.minutes)||10)*60000;
  const prontos = state.orders.filter(o=>o.status==='pronto'&&new Date((o.statusHistory||[]).slice(-1)[0]?.at||o.createdAt).getTime()>=cutoff);
  const preparando = state.orders.filter(o=>o.status==='pendente'||o.status==='preparo');
  el.innerHTML = `<div class="panel score-panel"><div style="display:flex;justify-content:space-between;align-items:center"><div><h2>${h(cfg.title||'Painel de senhas — pedidos prontos')}</h2><p class="sub">Tela para exibir num monitor da cantina, mostrando quem pode retirar o pedido.</p></div><div><button class="op-btn" onclick="toggleScoreboardFullscreen()">⛶ Tela cheia</button><button class="op-btn" onclick="openScoreboardSettings()">⚙ Configurar</button></div></div>
    <div class="tile-grid score-grid" style="margin-top:16px">
      ${prontos.length ? prontos.map(o=>`<div class="tile score-tile ready"><div class="tile-cap">Pronto</div><div class="tile-num">${h(o.who)}</div></div>`).join('') : telaDescansoHtml(preparando.length?'Nenhum pedido pronto no momento':'')}
    </div>
  </div>
  ${cfg.showPreparing===false||(!prontos.length&&!preparando.length)?'':`<div class="panel"><h2>Em preparo</h2>
    <div class="tile-grid score-grid">
      ${preparando.length ? preparando.map(o=>`<div class="tile score-tile"><div class="tile-cap">Aguarde</div><div class="tile-num">${h(o.who)}</div></div>`).join('') : '<p class="empty">Nada em preparo.</p>'}
    </div>
  </div>`}`;
}
function toggleScoreboardFullscreen(){const el=document.getElementById('view-painel-senhas');if(!document.fullscreenElement){el.requestFullscreen?.();}else document.exitFullscreen?.();}
function openScoreboardSettings(){const c=state.settings.scoreboard||{};openModal('Configurar Painel de Senhas',`<div class="consumer-form-frame"><div class="field"><label>Título do painel</label><input id="scoreTitle" value="${h(c.title||'Pedidos prontos')}"></div><div class="row"><div class="field"><label>Tempo de permanência (min)</label><input id="scoreMinutes" type="number" min="1" value="${Number(c.minutes)||10}"></div><div class="field"><label>Atualização (seg)</label><input id="scoreRefresh" type="number" min="2" value="${Number(c.refresh)||10}"></div></div><label><input id="scoreSound" type="checkbox" ${c.sound?'checked':''}> Emitir aviso sonoro ao marcar como pronto</label><br><label><input id="scoreShowPreparing" type="checkbox" ${c.showPreparing!==false?'checked':''}> Exibir pedidos em preparo</label></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveScoreboardSettings()">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
function saveScoreboardSettings(){if(!requirePerm('config-sistema'))return;state.settings.scoreboard={title:document.getElementById('scoreTitle').value.trim(),minutes:Math.max(1,parseInt(document.getElementById('scoreMinutes').value,10)||10),refresh:Math.max(2,parseInt(document.getElementById('scoreRefresh').value,10)||10),sound:document.getElementById('scoreSound').checked,showPreparing:document.getElementById('scoreShowPreparing').checked};save('settings');closeModal();renderAll();toast('Painel configurado.');}

