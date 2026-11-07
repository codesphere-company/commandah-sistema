/* ============ ESCOLHA DO PESO (venda por peso) ============ */
// Venda por peso, 05/11: janela em que o caixa digita o peso de cada peça (da etiqueta do cozinheiro)
// de uma carne vendida por kg (rascunho aprovado: opção B, "Várias peças na mesma janela").
// openWeightChoice(productId, onDone): onDone(lines) recebe um array de weighedLine (core/peso.js),
// uma linha por peça. NÃO mexe no pedido: quem chama decide o que fazer com as linhas.
// Abre numa camada própria (#weightChoiceRoot), por cima do modal, como a escolha do item
// (vendas/escolha-item.js): a comanda "Novo pedido" é modal e openModal trocaria a janela dela.
// Preço do quilo: travado para quem não é admin; "Alterar (PIN do admin)" abre um painel dentro da
// janela onde o admin digita o preço novo e o PIN juntos (staff-auth price_override, que grava o
// audit_log). Admin logado edita direto (logAction uma vez ao adicionar). Estoque: só bloqueia
// quando a carne tem ficha técnica (weighedAvailableKg finito); sem ficha, nunca bloqueia.

let weightChoiceState = null, _wsRowSeq = 0;

function _wsNewRow(text){ _wsRowSeq++; return { id: 'wr' + _wsRowSeq, text: text || '', touched: false }; }
function _wsPriceBR(n){ return (Number(n) || 0).toFixed(2).replace('.', ','); }
// Preço digitado: "129,90", "129.90", "R$ 1.299,90". Devolve o número ou null.
function _wsParsePrice(texto){
  let s = String(texto == null ? '' : texto).replace(/R\$/i, '').replace(/\s+/g, '');
  if(s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  if(!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const v = Math.round(parseFloat(s) * 100) / 100;
  return v > 0 ? v : null;
}
function _wsIsAdmin(){ return !!(currentUser && currentUser.role === 'admin'); }
function _wsAdmins(){ return (state.users || []).filter(u => u && u.role === 'admin' && u.active !== false); }
function weightChoiceProduct(){
  const st = weightChoiceState;
  return st ? (state.products || []).find(p => p.id === st.productId) || null : null;
}

function openWeightChoice(productId, onDone){
  const product = (state.products || []).find(p => p.id === productId);
  if(!product || !isWeighedProduct(product)){ toast('Produto indisponível.', 'erro'); return; }
  closeWeightChoice();
  const original = arredondaCentavos(Number(product.price) || 0); // 2 casas: a NFC-e rejeita preço com mais (Rejeição 629)
  const admin = _wsIsAdmin();
  weightChoiceState = { productId, onDone, rows: [_wsNewRow('')], original, price: original, priceText: _wsPriceBR(original),
    override: null, pinBusy: false, returnFocus: document.activeElement };
  const root = document.createElement('div');
  root.id = 'weightChoiceRoot';
  root.className = 'item-choice-backdrop';
  root.innerHTML = `<div class="item-choice-box ws-box" role="dialog" aria-modal="true" aria-labelledby="wsTitle">
    <header class="ic-head"><h3 id="wsTitle">${h(product.name)}</h3><button type="button" class="ic-close" aria-label="Fechar" onclick="closeWeightChoice()">&times;</button></header>
    <div class="ic-body">
      <label class="ws-label" for="wsPrice">Preço do quilo</label>
      <div class="ws-price">
        <span class="ws-cur">R$</span>
        <input id="wsPrice" class="mono" inputmode="decimal" autocomplete="off" maxlength="12" value="${h(_wsPriceBR(original))}" ${admin ? '' : 'readonly aria-readonly="true"'}>
        ${admin ? '' : `<button type="button" class="op-btn ws-unlock" id="wsPriceUnlock" onclick="weightChoiceOpenPin()">Alterar (PIN do admin)</button>`}
      </div>
      <p class="ws-price-note" id="wsPriceNote">${admin ? '' : '🔒 Só administrador altera.'}</p>
      ${admin ? '' : weightChoicePinPanelHtml()}
      <div class="ws-label" id="wsPiecesLabel">Peças (peso da etiqueta, kg)</div>
      <div class="ws-pieces" id="wsPieces" role="list" aria-labelledby="wsPiecesLabel"></div>
    </div>
    <div class="ic-total ws-sum"><span id="wsCount"></span><b class="mono" id="wsTotal"></b></div>
    <p class="ic-hint ws-warn" id="wsWarn" role="alert"></p>
    <div class="ic-actions ws-actions"><button type="button" class="op-btn" onclick="closeWeightChoice()">Voltar</button><button type="button" class="op-btn primary" id="wsAdd" onclick="weightChoiceConfirm()">Adicionar</button></div>
  </div>`;
  root.addEventListener('click', e => { if(e.target === root) closeWeightChoice(); });
  root.addEventListener('input', weightChoiceOnInput);
  root.addEventListener('keydown', weightChoiceOnKey);
  root.addEventListener('focusout', weightChoiceOnBlur);
  document.body.appendChild(root);
  document.addEventListener('keydown', weightChoiceKeydown, true);
  renderWeightChoice();
  weightChoiceFocusRow(weightChoiceState.rows[0].id);
}

// Painel do PIN do admin, dentro da janela (preço novo + quem autoriza + PIN, uma chamada só).
function weightChoicePinPanelHtml(){
  const admins = _wsAdmins();
  return `<div class="ws-pin" id="wsPinPanel" hidden>
    ${admins.length ? `
    <div class="field"><label for="wsPinPrice">Preço novo do quilo (R$)</label><input id="wsPinPrice" class="mono" inputmode="decimal" autocomplete="off" maxlength="12"></div>
    <div class="field"><label for="wsPinWho">Administrador</label><select id="wsPinWho">${admins.map(u => `<option value="${h(u.id)}">${h(u.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="wsPinValue">Senha (PIN)</label><input id="wsPinValue" type="password" inputmode="numeric" autocomplete="off" maxlength="64"></div>` : '<p class="sub">Não há administrador cadastrado.</p>'}
    <p class="ws-pin-err" id="wsPinError" role="alert"></p>
    <div class="ws-pin-actions"><button type="button" class="op-btn" id="wsPinCancel" onclick="weightChoiceClosePin()">Cancelar</button>${admins.length ? '<button type="button" class="op-btn primary" id="wsPinOk" onclick="weightChoicePinConfirm()">Confirmar</button>' : ''}</div>
  </div>`;
}

function weightChoiceKeydown(e){
  if(e.key !== 'Escape' || !weightChoiceState) return;
  e.preventDefault(); e.stopImmediatePropagation(); // Esc fecha só a janela do peso, não a de baixo
  const panel = document.getElementById('wsPinPanel');
  if(panel && !panel.hidden){ weightChoiceClosePin(); return; } // primeiro fecha o painel do PIN
  closeWeightChoice();
}

function closeWeightChoice(){
  const root = document.getElementById('weightChoiceRoot');
  if(root) root.remove();
  document.removeEventListener('keydown', weightChoiceKeydown, true);
  const back = weightChoiceState && weightChoiceState.returnFocus;
  weightChoiceState = null;
  if(root && back && document.contains(back) && typeof back.focus === 'function') back.focus();
}

// Lê uma linha: vazia = ignorada; senão parsePesoKg (core/peso.js).
function _wsRowParse(row){ return String(row.text || '').trim() ? parsePesoKg(row.text) : null; }

function _wsRowCells(row){
  const p = _wsRowParse(row), price = weightChoiceState.price;
  return {
    kg: p && !p.error ? fmtKg(p.kg) : '',
    val: p && !p.error && price ? fmt(pesoValor(p.kg, price)) : '',
    err: p && p.error && row.touched ? p.error : ''
  };
}

// Desenha a lista de peças. A última linha é sempre a vazia ("peso da próxima"), sem ✕.
function renderWeightChoice(){
  const st = weightChoiceState, el = document.getElementById('wsPieces');
  if(!st || !el) return;
  const rows = st.rows;
  if(!rows.length || String(rows[rows.length - 1].text).trim()) rows.push(_wsNewRow(''));
  el.innerHTML = rows.map((row, i) => {
    const c = _wsRowCells(row), last = i === rows.length - 1;
    return `<div class="ws-row" role="listitem" data-ws-row="${h(row.id)}">
      <div class="ws-line">
        <input class="ws-kg mono" data-ws-row="${h(row.id)}" inputmode="decimal" autocomplete="off" maxlength="12" aria-label="${h('Peso da peça ' + (i + 1))}" placeholder="${last ? 'peso da próxima' : ''}" value="${h(row.text)}">
        <span class="ws-parsed mono">${h(c.kg)}</span>
        <span class="ws-val mono">${h(c.val)}</span>
        ${last ? '<span class="ws-del-ph"></span>' : `<button type="button" class="ws-del" aria-label="${h('Tirar a peça ' + (i + 1))}" onclick="weightChoiceRemove(${jsArg(row.id)})">✕</button>`}
      </div>
      <small class="ws-err">${h(c.err)}</small>
    </div>`;
  }).join('');
  weightChoiceUpdate();
}

// Atualiza uma linha sem redesenhar a lista (não tira o foco de quem está digitando).
function _wsPaintRow(row){
  const el = document.querySelector(`#wsPieces .ws-row[data-ws-row="${CSS.escape(row.id)}"]`);
  if(!el) return;
  const c = _wsRowCells(row);
  el.querySelector('.ws-parsed').textContent = c.kg;
  el.querySelector('.ws-val').textContent = c.val;
  el.querySelector('.ws-err').textContent = c.err;
}

function weightChoiceFocusRow(rowId){
  const input = document.querySelector(`#wsPieces .ws-kg[data-ws-row="${CSS.escape(rowId)}"]`);
  if(input){ input.focus(); try{ input.setSelectionRange(input.value.length, input.value.length); }catch(e){} }
}

function _wsRowById(id){ return weightChoiceState ? weightChoiceState.rows.find(r => r.id === id) : null; }

function weightChoiceOnInput(e){
  const st = weightChoiceState, t = e.target;
  if(!st || !t) return;
  if(t.classList.contains('ws-kg')){
    const row = _wsRowById(t.dataset.wsRow); if(!row) return;
    row.text = t.value;
    const p = _wsRowParse(row);
    if(!p || !p.error) row.touched = false; // corrigiu: some o erro
    _wsPaintRow(row);
    weightChoiceUpdate();
    // começou a digitar na última linha: já abre a próxima vazia (e esta ganha o ✕)
    if(row === st.rows[st.rows.length - 1] && String(row.text).trim()){ renderWeightChoice(); weightChoiceFocusRow(row.id); }
  } else if(t.id === 'wsPrice' && _wsIsAdmin()){
    st.priceText = t.value;
    const v = _wsParsePrice(t.value);
    st.price = v || 0;
    st.rows.forEach(_wsPaintRow);
    weightChoiceUpdate();
  }
}

function weightChoiceOnBlur(e){
  const t = e.target;
  if(!weightChoiceState || !t || !t.classList || !t.classList.contains('ws-kg')) return;
  const row = _wsRowById(t.dataset.wsRow); if(!row) return;
  if(String(row.text).trim()){ row.touched = true; _wsPaintRow(row); }
}

// Enter numa peça: confere; certo, vai para a próxima linha vazia (cria se for a última).
function weightChoiceOnKey(e){
  const t = e.target;
  if(e.key !== 'Enter' || !weightChoiceState || !t) return;
  if(t.id === 'wsPinValue' || t.id === 'wsPinPrice'){ e.preventDefault(); weightChoicePinConfirm(); return; }
  if(!t.classList.contains('ws-kg')) return;
  e.preventDefault();
  const st = weightChoiceState, row = _wsRowById(t.dataset.wsRow); if(!row) return;
  row.text = t.value;
  const p = _wsRowParse(row);
  if(!p) return; // linha vazia: nada a fazer
  if(p.error){ row.touched = true; _wsPaintRow(row); weightChoiceUpdate(); return; }
  const idx = st.rows.indexOf(row);
  const next = st.rows.slice(idx + 1).find(r => !String(r.text).trim());
  renderWeightChoice(); // garante a linha vazia no fim
  weightChoiceFocusRow((next || st.rows[st.rows.length - 1]).id);
}

function weightChoiceRemove(rowId){
  const st = weightChoiceState; if(!st) return;
  const idx = st.rows.findIndex(r => r.id === rowId); if(idx < 0) return;
  st.rows.splice(idx, 1);
  renderWeightChoice();
  const target = st.rows[Math.min(idx, st.rows.length - 1)];
  if(target) weightChoiceFocusRow(target.id);
}

// Soma, aviso de estoque e estado do botão. Devolve o resumo (usado também ao adicionar).
function weightChoiceSummary(){
  const st = weightChoiceState, product = weightChoiceProduct();
  if(!st || !product) return { error: 'Produto indisponível.', pieces: [] };
  const pieces = [];
  let error = '';
  st.rows.forEach(row => {
    const p = _wsRowParse(row);
    if(!p) return;
    if(p.error){ if(!error) error = 'Corrija o peso marcado em vermelho.'; return; }
    pieces.push(p.kg);
  });
  const kg = Math.round(pieces.reduce((s, x) => s + x, 0) * 1000) / 1000;
  const total = arredondaCentavos(pieces.reduce((s, x) => s + pesoValor(x, st.price), 0));
  let warn = '';
  const avail = weighedAvailableKg(product);
  if(isFinite(avail) && kg > avail + 1e-9){ // só com ficha técnica (sem ficha: Infinity, nunca bloqueia)
    warn = 'Estoque de ' + product.name + ': ' + fmtKg(Math.max(0, avail)) + '. Lance a entrada do fornecedor em Insumos.';
  }
  if(!st.price){ error = error || 'Preço do quilo inválido.'; if(!warn) warn = 'Preço do quilo inválido.'; }
  if(!error && !pieces.length) error = 'Digite o peso da peça.';
  return { pieces, kg, total, warn, error: error || warn };
}

function weightChoiceUpdate(){
  const st = weightChoiceState; if(!st) return;
  const s = weightChoiceSummary(), n = s.pieces.length;
  const countEl = document.getElementById('wsCount'), totalEl = document.getElementById('wsTotal');
  const warnEl = document.getElementById('wsWarn'), addBtn = document.getElementById('wsAdd');
  if(countEl) countEl.textContent = n ? n + (n === 1 ? ' peça' : ' peças') + ' · ' + fmtKg(s.kg) : 'Nenhuma peça';
  if(totalEl) totalEl.textContent = fmt(s.total || 0);
  if(warnEl) warnEl.textContent = s.warn || '';
  if(addBtn){
    addBtn.textContent = n ? 'Adicionar ' + n + (n === 1 ? ' peça' : ' peças') : 'Adicionar';
    addBtn.setAttribute('aria-disabled', s.error ? 'true' : 'false');
    addBtn.classList.toggle('ic-blocked', !!s.error);
  }
}

// ---------- preço do quilo com o PIN do admin ----------
function weightChoiceOpenPin(){
  const st = weightChoiceState, panel = document.getElementById('wsPinPanel');
  if(!st || !panel) return;
  panel.hidden = false;
  const err = document.getElementById('wsPinError'); if(err) err.textContent = '';
  const price = document.getElementById('wsPinPrice');
  if(price){ price.value = _wsPriceBR(st.price); price.focus(); price.select(); }
}
function weightChoiceClosePin(){
  const panel = document.getElementById('wsPinPanel');
  if(panel) panel.hidden = true;
  const pin = document.getElementById('wsPinValue'); if(pin) pin.value = '';
  const btn = document.getElementById('wsPriceUnlock'); if(btn) btn.focus();
}

async function weightChoicePinConfirm(){
  const st = weightChoiceState, product = weightChoiceProduct();
  if(!st || !product || st.pinBusy) return;
  const err = document.getElementById('wsPinError'), pinEl = document.getElementById('wsPinValue');
  const priceEl = document.getElementById('wsPinPrice'), whoEl = document.getElementById('wsPinWho'), ok = document.getElementById('wsPinOk');
  if(!pinEl || !priceEl || !whoEl) return;
  const price = _wsParsePrice(priceEl.value);
  if(!price){ err.textContent = 'Digite o preço novo do quilo.'; priceEl.focus(); return; }
  const pin = pinEl.value;
  if(!pin){ err.textContent = 'Digite o PIN do administrador.'; pinEl.focus(); return; }
  const admin = _wsAdmins().find(u => u.id === whoEl.value);
  if(!admin){ err.textContent = 'Escolha um administrador.'; return; }
  st.pinBusy = true; if(ok) ok.disabled = true; err.textContent = '';
  const operator = currentUser ? currentUser.name : '';
  let msg = '', by = admin.name;
  try{
    if(isCloudMode()){
      const r = await staffAuthCall({ action: 'price_override', staff_id: admin.id, pin, product_id: product.id, product_name: product.name,
        original: st.original, price, operator_name: operator });
      if(r.error) msg = r.error; else by = (r.data && r.data.name) || admin.name;
    } else if(String(admin.pin || '') !== String(pin)){
      msg = 'PIN incorreto.';
    } else {
      logAction('Preço do quilo alterado na venda: ' + product.name + ' R$ ' + _wsPriceBR(st.original) + ' → R$ ' + _wsPriceBR(price) + ' por ' + admin.name + ' (caixa: ' + operator + ')');
    }
  }catch(e){ msg = 'Não foi possível conferir a senha agora. Tente de novo.'; }
  if(weightChoiceState !== st) return; // janela fechada enquanto conferia
  st.pinBusy = false; if(ok) ok.disabled = false;
  if(msg){ err.textContent = msg; pinEl.value = ''; pinEl.focus(); return; } // preço e peças continuam iguais
  st.price = price; st.priceText = _wsPriceBR(price);
  st.override = Math.abs(price - st.original) < 0.005 ? null : { original: st.original, by, operator, at: new Date().toISOString() };
  const field = document.getElementById('wsPrice'); if(field) field.value = st.priceText;
  const note = document.getElementById('wsPriceNote');
  if(note) note.textContent = st.override ? 'Alterado por ' + by + ' (antes R$ ' + _wsPriceBR(st.original) + ').' : '🔒 Só administrador altera.';
  pinEl.value = '';
  const panel = document.getElementById('wsPinPanel'); if(panel) panel.hidden = true;
  st.rows.forEach(_wsPaintRow);
  weightChoiceUpdate();
  const empty = st.rows.find(r => !String(r.text).trim()); if(empty) weightChoiceFocusRow(empty.id);
}

function weightChoiceConfirm(){
  const st = weightChoiceState, product = weightChoiceProduct();
  if(!st || !product) return;
  st.rows.forEach(r => { if(String(r.text).trim()){ r.touched = true; _wsPaintRow(r); } });
  const s = weightChoiceSummary();
  if(s.error){ toast(s.error, 'erro'); return; } // não fecha: o operador corrige
  let override = st.override;
  if(_wsIsAdmin() && Math.abs(st.price - st.original) >= 0.005){
    // Admin logado mudou o preço direto: registra uma vez, ao adicionar.
    override = { original: st.original, by: currentUser.name, operator: currentUser.name, at: new Date().toISOString() };
    logAction('Preço do quilo alterado na venda: ' + product.name + ' R$ ' + _wsPriceBR(st.original) + ' → R$ ' + _wsPriceBR(st.price));
  } else if(_wsIsAdmin()) override = null;
  const lines = s.pieces.map(kg => weighedLine(product, kg, st.price, override ? Object.assign({}, override) : null));
  const onDone = st.onDone;
  closeWeightChoice();
  onDone(lines);
}
