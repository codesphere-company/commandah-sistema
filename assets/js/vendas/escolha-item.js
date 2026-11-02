/* ============ ESCOLHA DO ITEM (tamanho e opções) ============ */
// Tela em que o operador escolhe o tamanho, as opções dos grupos e as observações ao vender um
// produto (rascunho aprovado: docs/superpowers/specs/2026-11-02-tamanhos-e-opcoes-mockups/tamanhos-grupos.html).
// openItemChoice(productId, channel, onDone): channel 'pdv' | 'mobile' | 'online' (delivery).
// NÃO mexe no pedido (currentSaleDraft): quem chama decide o que fazer em
// onDone({ name, basePrice, price, customization }) — o resultado do buildCustomization (core/opcoes.js).
// Usada pelo balcão/delivery (venda.js) e pelas comandas/app do garçom.
// Abre numa camada própria (#itemChoiceRoot), por cima do modal: delivery, PDV e "Localizar produto"
// da comanda são modais, e openModal trocaria a janela deles pela escolha (o pedido sumiria da tela).

let itemChoiceState = null;

// Observações rápidas ligadas ao produto (cadastro do produto, aba Observações).
function itemChoiceObservations(product){
  return ((product && product.observationIds) || []).map(id => (state.observacoes || []).find(o => o.id === id)).filter(Boolean);
}
// Tamanhos que podem ser vendidos no canal (ativos, com preço e liberados no canal).
function itemChoiceSizes(product, channel){
  const grade = gradeOf(product, state.complementos);
  return grade ? sizesForChannel(product, grade, channel) : [];
}
// Regras de grupo que valem (grupo ativo) para o tamanho; com grade e sem tamanho escolhido, nenhuma.
function itemChoiceRules(product, sizeId){
  if(!product || (product.gradeId && !sizeId)) return [];
  return rulesFor(product, sizeId).filter(r => r && opcoesGroupOf(state.complementos, r.groupId));
}
// A venda abre a escolha quando há tamanho/grupo ou observações rápidas para marcar
// (as observações rápidas já abriam a tela antiga de personalizar; continuam).
function productOpensItemChoice(product){
  return productNeedsChoice(product, state.complementos) || itemChoiceObservations(product).length > 0;
}
// Preço mostrado no botão do produto. Com grade, product.price é só o menor preço: nunca é preço de venda.
function productSalePriceLabel(product, channel){
  if(!product || !product.gradeId) return fmt(product && product.price);
  const sizes = itemChoiceSizes(product, channel);
  if(!sizes.length) return 'Indisponível';
  const min = Math.min.apply(null, sizes.map(s => s.price));
  return sizes.length === 1 ? fmt(min) : 'a partir de ' + fmt(min);
}

function openItemChoice(productId, channel, onDone){
  const product = (state.products || []).find(p => p.id === productId);
  if(!product){ toast('Produto indisponível.', 'erro'); return; }
  const complementos = state.complementos || [];
  if(product.gradeId && !gradeOf(product, complementos)){
    // grade pausada/apagada: buildCustomization devolve 'Tamanhos indisponíveis para este produto.'
    const r = buildCustomization({ product, complementos });
    toast(r.error || 'Tamanhos indisponíveis para este produto.', 'erro');
    return;
  }
  const sizes = itemChoiceSizes(product, channel);
  if(product.gradeId && !sizes.length){ toast('Nenhum tamanho deste produto está liberado para venda aqui.', 'erro'); return; }
  const observations = itemChoiceObservations(product);
  const onlySize = sizes.length === 1 ? sizes[0].sizeId : null;
  // Toque rápido: nada para escolher (um tamanho só, sem grupos e sem observações rápidas) entra direto.
  if((!product.gradeId || onlySize) && !itemChoiceRules(product, onlySize).length && !observations.length){
    const r = buildCustomization({ product, complementos, sizeId: onlySize, picks: {}, notes: '', observations: [], observationIds: [] });
    if(r.error){ toast(r.error, 'erro'); return; }
    onDone(r);
    return;
  }
  closeItemChoice();
  itemChoiceState = { productId, channel, onDone, sizeId: onlySize, picks: {}, returnFocus: document.activeElement };
  const root = document.createElement('div');
  root.id = 'itemChoiceRoot';
  root.className = 'item-choice-backdrop';
  root.innerHTML = `<div class="item-choice-box" role="dialog" aria-modal="true" aria-labelledby="icTitle">
    <header class="ic-head"><h3 id="icTitle">${h(product.name)}</h3><button type="button" class="ic-close" aria-label="Fechar" onclick="closeItemChoice()">&times;</button></header>
    <div class="ic-body">
      <div id="icChoices"></div>
      ${observations.length ? `<fieldset class="ic-section"><legend>Observações rápidas</legend>${observations.map(o => `<label class="ic-check"><input type="checkbox" class="ic-obs" value="${h(o.id)}"><span>${h(o.texto)}</span></label>`).join('')}</fieldset>` : ''}
      <div class="field ic-notes"><label for="icNotes">Observação para o preparo</label><textarea id="icNotes" rows="2" placeholder="Ex.: retirar ingrediente, ponto de preparo..."></textarea></div>
    </div>
    <div class="ic-total"><span>Total do item</span><b class="mono" id="icTotal"></b></div>
    <p class="ic-hint" id="icHint" role="status"></p>
    <div class="ic-actions"><button type="button" class="op-btn" onclick="closeItemChoice()">Voltar</button><button type="button" class="op-btn primary" id="icAdd" onclick="itemChoiceConfirm()">Adicionar</button></div>
  </div>`;
  root.addEventListener('click', e => { if(e.target === root) closeItemChoice(); });
  document.body.appendChild(root);
  document.addEventListener('keydown', itemChoiceKeydown, true);
  renderItemChoice();
  const first = root.querySelector('.ic-size, .ic-qty button:not([disabled]), #icAdd');
  if(first) first.focus();
}

function itemChoiceKeydown(e){
  if(e.key !== 'Escape' || !itemChoiceState) return;
  e.preventDefault(); e.stopImmediatePropagation(); // Esc fecha só a escolha, não a janela de baixo
  closeItemChoice();
}

function closeItemChoice(){
  const root = document.getElementById('itemChoiceRoot');
  if(root) root.remove();
  document.removeEventListener('keydown', itemChoiceKeydown, true);
  const back = itemChoiceState && itemChoiceState.returnFocus;
  itemChoiceState = null;
  if(root && back && document.contains(back) && typeof back.focus === 'function') back.focus();
}

function itemChoiceProduct(){
  const st = itemChoiceState;
  return st ? (state.products || []).find(p => p.id === st.productId) || null : null;
}

function renderItemChoice(focusKey){
  const st = itemChoiceState, el = document.getElementById('icChoices');
  if(!st || !el) return;
  const product = itemChoiceProduct();
  if(!product){ closeItemChoice(); toast('Produto indisponível.', 'erro'); return; }
  let html = '';
  if(product.gradeId){
    const sizes = itemChoiceSizes(product, st.channel);
    html += `<div class="ic-section"><div class="ic-section-head"><b>Tamanho</b></div><div class="ic-sizes" role="group" aria-label="Tamanho">${sizes.map(s => {
      const on = st.sizeId === s.sizeId;
      return `<button type="button" class="ic-size${on ? ' on' : ''}" aria-pressed="${on}" onclick="itemChoicePickSize(${jsArg(s.sizeId)})">${s.sigla ? h(s.sigla) + ' · ' : ''}${h(s.name)} · <span class="mono">${fmt(s.price)}</span></button>`;
    }).join('')}</div></div>`;
  }
  itemChoiceRules(product, st.sizeId).forEach(rule => {
    const grupo = opcoesGroupOf(state.complementos, rule.groupId);
    const picks = st.picks[rule.groupId] || {};
    const options = (grupo.options || []).filter(o => o && o.active !== false);
    const max = Number(rule.max) || 0, min = Number(rule.min) || 0, included = Number(rule.included) || 0;
    const total = options.reduce((s, o) => s + (Number(picks[o.id]) || 0), 0);
    const info = [min > 0 ? 'Obrigatório: escolha ao menos ' + min : 'Opcional',
      included > 0 && options.some(o => Number(o.preco) > 0) ? included + ' incluso(s) no preço' : ''].filter(Boolean).join(' · ');
    html += `<div class="ic-section"><div class="ic-section-head"><b>${h(grupo.nome)}</b><span class="ic-counter">${total} de ${max}</span></div><small class="ic-rule">${h(info)}</small>`;
    html += options.map(o => {
      const q = Number(picks[o.id]) || 0, canAdd = total < max && (rule.repeat || q < 1);
      const key = rule.groupId + '|' + o.id;
      return `<div class="ic-opt"><span>${h(o.nome)}${Number(o.preco) ? ` <small>+ ${fmt(o.preco)}</small>` : ''}</span><span class="ic-qty">`
        + `<button type="button" data-ic-key="${h(key + '|-1')}" aria-label="${h('Tirar ' + o.nome)}" ${q <= 0 ? 'disabled' : ''} onclick="itemChoiceStep(${jsArg(rule.groupId)},${jsArg(o.id)},-1)">−</button>`
        + `<span class="mono">${q}</span>`
        + `<button type="button" data-ic-key="${h(key + '|1')}" aria-label="${h('Pôr ' + o.nome)}" ${canAdd ? '' : 'disabled'} onclick="itemChoiceStep(${jsArg(rule.groupId)},${jsArg(o.id)},1)">+</button></span></div>`;
    }).join('') || '<p class="sub">Nenhuma opção ativa neste grupo.</p>';
    html += '</div>';
  });
  el.innerHTML = html;
  if(focusKey){ // redesenhou: devolve o foco ao botão tocado (ou ao vizinho, se ele travou)
    const btns = [...el.querySelectorAll('[data-ic-key]')];
    const same = btns.find(b => b.dataset.icKey === focusKey);
    const pair = focusKey.replace(/\|-?1$/, '');
    const other = btns.find(b => b.dataset.icKey !== focusKey && b.dataset.icKey.indexOf(pair + '|') === 0);
    const target = same && !same.disabled ? same : other && !other.disabled ? other : null;
    if(target) target.focus();
  }
  itemChoiceUpdateTotal();
}

function itemChoicePickSize(sizeId){
  const st = itemChoiceState, product = itemChoiceProduct();
  if(!st || !product) return;
  if(!itemChoiceSizes(product, st.channel).some(s => s.sizeId === sizeId)) return;
  st.sizeId = sizeId;
  // As regras mudam com o tamanho: mantém só as escolhas que continuam válidas no tamanho novo.
  const rules = itemChoiceRules(product, sizeId), picks = {};
  rules.forEach(rule => {
    const old = st.picks[rule.groupId]; if(!old) return;
    const grupo = opcoesGroupOf(state.complementos, rule.groupId);
    const ativas = (grupo.options || []).filter(o => o && o.active !== false).map(o => o.id);
    const kept = {};
    Object.keys(old).forEach(oid => { if(ativas.indexOf(oid) >= 0 && Number(old[oid]) > 0) kept[oid] = Number(old[oid]); });
    const total = Object.keys(kept).reduce((s, k) => s + kept[k], 0);
    const repetida = !rule.repeat && Object.keys(kept).some(k => kept[k] > 1);
    if(total > (Number(rule.max) || 0) || repetida) return; // não cabe no tamanho novo: recomeça o grupo
    picks[rule.groupId] = kept;
  });
  st.picks = picks;
  renderItemChoice();
  const on = document.querySelector('#itemChoiceRoot .ic-size.on');
  if(on) on.focus();
}

function itemChoiceStep(groupId, optionId, delta){
  const st = itemChoiceState, product = itemChoiceProduct();
  if(!st || !product) return;
  const rule = itemChoiceRules(product, st.sizeId).find(r => r.groupId === groupId);
  if(!rule) return;
  const picks = st.picks[groupId] = st.picks[groupId] || {};
  const total = Object.keys(picks).reduce((s, k) => s + (Number(picks[k]) || 0), 0);
  const q = Number(picks[optionId]) || 0;
  if(delta > 0){
    if(total >= (Number(rule.max) || 0) || (!rule.repeat && q >= 1)) return; // "+" travado
    picks[optionId] = q + 1;
  } else {
    if(q <= 0) return;
    if(q - 1 > 0) picks[optionId] = q - 1; else delete picks[optionId];
  }
  renderItemChoice(groupId + '|' + optionId + '|' + (delta > 0 ? '1' : '-1'));
}

// Lê a tela e monta o item com as regras de core/opcoes.js. Observações no mesmo formato da tela
// antiga de personalizar: observations [{id,text}] e notes = textos marcados + texto livre, com " · ".
function itemChoiceBuild(){
  const st = itemChoiceState, product = itemChoiceProduct();
  if(!st || !product) return { error: 'Produto indisponível.' };
  if(product.gradeId && st.sizeId && !itemChoiceSizes(product, st.channel).some(s => s.sizeId === st.sizeId)) return { error: 'Tamanho indisponível.' };
  const observations = [...document.querySelectorAll('#itemChoiceRoot .ic-obs:checked')]
    .map(x => (state.observacoes || []).find(o => o.id === x.value)).filter(Boolean)
    .map(o => ({ id: o.id, text: o.texto }));
  const notesEl = document.getElementById('icNotes');
  const typed = notesEl ? notesEl.value.trim() : '';
  const notes = [...observations.map(o => o.text), typed].filter(Boolean).join(' · ');
  return buildCustomization({
    product, complementos: state.complementos, sizeId: st.sizeId, picks: st.picks,
    notes, observations, observationIds: observations.map(o => o.id)
  });
}

// Total ao vivo. Com escolha incompleta (mínimo não atingido, sem tamanho), mostra a prévia do
// preço e o aviso do que falta; "Adicionar" fica com cara de bloqueado e só avisa.
function itemChoiceUpdateTotal(){
  const st = itemChoiceState, product = itemChoiceProduct();
  const totalEl = document.getElementById('icTotal'), hintEl = document.getElementById('icHint'), addBtn = document.getElementById('icAdd');
  if(!st || !product || !totalEl) return;
  const r = itemChoiceBuild();
  let price = r.error ? null : r.price;
  if(r.error){
    const size = product.gradeId ? itemChoiceSizes(product, st.channel).find(s => s.sizeId === st.sizeId) : null;
    if(!product.gradeId || size){
      price = product.gradeId ? size.price : Number(product.price) || 0;
      itemChoiceRules(product, st.sizeId).forEach(rule => {
        const grupo = opcoesGroupOf(state.complementos, rule.groupId), picks = st.picks[rule.groupId] || {};
        const choices = (grupo.options || []).filter(o => Number(picks[o.id]) > 0).map(o => ({ price: Number(o.preco) || 0, qty: Number(picks[o.id]) }));
        price += chargedForGroup(choices, rule.included);
      });
    }
  }
  totalEl.textContent = price == null ? '—' : fmt(price);
  if(hintEl) hintEl.textContent = r.error || '';
  if(addBtn){ addBtn.setAttribute('aria-disabled', r.error ? 'true' : 'false'); addBtn.classList.toggle('ic-blocked', !!r.error); }
}

function itemChoiceConfirm(){
  const st = itemChoiceState;
  if(!st) return;
  const r = itemChoiceBuild();
  if(r.error){ toast(r.error, 'erro'); return; } // não fecha: o operador corrige a escolha
  const onDone = st.onDone;
  closeItemChoice();
  onDone(r);
}
