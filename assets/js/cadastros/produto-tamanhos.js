/* ============ PRODUTO: TAMANHOS E OPÇÕES ============ */
// Abas "Tamanhos" (produto com grade) e "Opções" (produto sem grade) do modal do produto.
// Tudo é editado num rascunho em memória (productSizesDraft, como o tempRecipe) e só vira dado
// do produto no Salvar, via readProductSizesDraft(). Regras puras ficam em core/opcoes.js.
// Valores digitados ficam como texto no rascunho; viram número só na leitura final.

let productSizesDraft = null;

function psdGrade(){
  const d = productSizesDraft;
  return d && d.gradeId ? (state.complementos||[]).find(c=>c&&c.id===d.gradeId&&c.recordKind==='grade')||null : null;
}
function psdGroup(id){ return (state.complementos||[]).find(c=>c&&c.id===id&&c.recordKind==='optionGroup')||null; }
function psdClone(x){ return JSON.parse(JSON.stringify(x)); }
function psdRuleDraft(r){
  return { groupId:r.groupId, included:String(Number(r.included)||0) }; // complemento livre: sem mínimo/máximo/repetir
}
function psdSizeDraft(s, ativoPadrao){
  s = s || {};
  const ch = s.channels || {};
  return {
    price: Number.isFinite(Number(s.price)) && s.price!=='' && s.price!=null ? String(s.price) : '',
    cost: Number(s.cost) ? String(s.cost) : '',
    active: s.active==null ? ativoPadrao : s.active!==false,
    channels: { pdv:ch.pdv!==false, mobile:ch.mobile!==false, qr:ch.qr!==false, online:ch.online!==false },
    recipe: (s.recipe||[]).map(r=>({insumoId:r.insumoId, qty:Number(r.qty)||0})),
    groups: (s.groups||[]).map(psdRuleDraft)
  };
}
// Garante uma entrada de rascunho para cada tamanho da grade escolhida.
function psdEnsureSizes(ativoNovo){
  const d = productSizesDraft, g = psdGrade();
  if(!g) return;
  (g.sizes||[]).forEach(s=>{ if(!d.sizes[s.id]) d.sizes[s.id] = psdSizeDraft(null, ativoNovo); });
  if(!d.sel || !(g.sizes||[]).some(s=>s.id===d.sel)) d.sel = (g.sizes||[])[0] ? g.sizes[0].id : null;
}
function initProductSizesDraft(p){
  const sizes = {};
  Object.keys(p&&p.sizes||{}).forEach(id=>{ sizes[id] = psdSizeDraft(p.sizes[id], true); });
  productSizesDraft = {
    productId: p ? p.id : null,
    gradeId: p && p.gradeId || null,
    sizes,
    groups: (p&&p.groups||[]).map(psdRuleDraft),
    sel: null,
    stash: {},          // tamanhos de grades que o usuário trocou, para voltar atrás sem perder
    copies: [],         // regras a gravar em OUTROS produtos no Salvar
    copyOpen: false
  };
  psdEnsureSizes(false);
}

// ---------- Principal: escolha da grade ----------
function productGradeFieldHtml(){
  const d = productSizesDraft;
  const grades = (state.complementos||[]).filter(c=>c&&c.recordKind==='grade'&&(c.active!==false||c.id===d.gradeId))
    .sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
  const achou = !d.gradeId || grades.some(g=>g.id===d.gradeId);
  return `<div class="field"><label for="pGrade">Grade de tamanhos</label><select id="pGrade" onchange="changeProductGrade(this.value)">
    <option value="">— Sem tamanhos (preço único) —</option>
    ${grades.map(g=>`<option value="${h(g.id)}" ${g.id===d.gradeId?'selected':''}>${h(g.nome)}${g.active===false?' (pausada)':''}</option>`).join('')}
    ${achou?'':`<option value="${h(d.gradeId)}" selected>(grade removida)</option>`}
  </select><p class="sub">Com grade, cada tamanho tem o seu preço (aba Tamanhos). Sem grade, o produto tem preço único e pode ter grupos de opções (aba Opções).</p></div>
  <div id="pGradeCards"></div>`;
}
function renderProductGradeCards(){
  const el = document.getElementById('pGradeCards'); if(!el||!productSizesDraft) return;
  const d = productSizesDraft, g = psdGrade();
  if(g){
    el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">${(g.sizes||[]).map(s=>{
      const e = d.sizes[s.id];
      return `<div style="border:1px solid var(--c-border-strong,#c9d0d9);border-radius:6px;padding:8px 14px;min-width:120px;text-align:center;${e&&e.active===false?'opacity:.55':''}">
        <b style="font-size:17px">${h(s.sigla||s.nome)}</b><div class="sub" style="margin:2px 0">${h(s.nome)}</div>
        <button type="button" class="link-btn" onclick="openProductSizeTab(${jsArg(s.id)})">Configurar →</button></div>`;
    }).join('')}</div>`;
  } else {
    el.innerHTML = `<div style="margin:6px 0"><button type="button" class="link-btn" onclick="openProductSizeTab()">Configurar opções do produto →</button></div>`;
  }
}
function openProductSizeTab(sizeId){
  const d = productSizesDraft; if(!d) return;
  if(d.gradeId){ if(sizeId) d.sel = sizeId; renderProductSizesPane(); setProductModalTab('tamanhos'); }
  else { renderProductOptionsPane(); setProductModalTab('opcoes'); }
}
function changeProductGrade(value){
  const d = productSizesDraft; if(!d) return;
  value = value || null;
  if(value===d.gradeId) return;
  // tamanhos da grade antiga saem do produto (guardados só enquanto o modal está aberto)
  if(d.gradeId) d.stash[d.gradeId] = d.sizes;
  d.gradeId = value;
  d.sizes = value && d.stash[value] ? d.stash[value] : {};
  d.copies = []; d.copyOpen = false; d.sel = null;
  psdEnsureSizes(true);
  const kind = document.getElementById('pKind');
  if(value && kind) kind.value = 'tamanho';
  refreshProductGradeUi();
}
function refreshProductGradeUi(){
  const d = productSizesDraft; if(!d) return;
  const comGrade = !!d.gradeId;
  const abaT = document.querySelector('.record-tabs [data-tab="tamanhos"]'), abaO = document.querySelector('.record-tabs [data-tab="opcoes"]');
  if(abaT){ abaT.style.display = comGrade?'':'none'; abaT.textContent = 'Tamanhos'+(comGrade?' ('+Object.values(d.sizes).filter(s=>s.active!==false).length+')':''); }
  if(abaO){ abaO.style.display = comGrade?'none':''; abaO.textContent = 'Opções'+(!comGrade&&d.groups.length?' ('+d.groups.length+')':''); }
  const ativa = document.querySelector('.record-tabs button.active');
  if(ativa && ativa.style.display==='none') setProductModalTab('principal');
  const preco = document.getElementById('pPrice');
  if(preco){ preco.disabled = comGrade; preco.placeholder = comGrade?'Preço por tamanho (aba Tamanhos)':''; }
  renderProductGradeCards(); renderProductSizesPane(); renderProductOptionsPane();
}

// ---------- editor de regras de grupo (compartilhado) ----------
function psdRules(target){
  const d = productSizesDraft; if(!d) return [];
  if(target==='product') return d.groups;
  const s = d.sizes[d.sel]; return s ? s.groups : [];
}
function psdRulesHtml(target){
  const rules = psdRules(target);
  const t = jsArg(target);
  const livres = (state.complementos||[]).filter(c=>c&&c.recordKind==='optionGroup'&&c.active!==false&&!rules.some(r=>r.groupId===c.id))
    .sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
  const num = (i,f,v)=>`<input type="number" min="0" step="1" style="width:60px" value="${h(v)}" onchange="setRuleField(${t},${i},'${f}',this.value)">`;
  return `${rules.map((r,i)=>{
    const g = psdGroup(r.groupId);
    return `<div style="border:1px solid var(--c-border-strong,#c9d0d9);border-radius:6px;padding:10px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>${g?h(g.nome):'(grupo removido)'}${g&&g.active===false?' <small>(pausado)</small>':''}</b>
        <span>${g?`<button type="button" class="link-btn" onclick="editRuleGroup(${jsArg(r.groupId)})">✎ editar lista</button> `:''}<button type="button" class="link-btn" onclick="removeGroupRule(${t},${i})">✕ remover</button></span></div>
      <div class="row" style="align-items:flex-end;margin-top:6px">
        <div class="field"><label>Inclusos no preço</label>${num(i,'included',r.included)}</div></div>
      ${g?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${(g.options||[]).map(o=>`<span class="tag tag-gray" style="${o.active===false?'opacity:.5':''}">${h(o.nome)}${Number(o.preco)?` <small>+ ${h(fmt(o.preco))}</small>`:''}</span>`).join('')}</div>`:''}
      <p class="sub" style="margin:6px 0 0">Escolha livre: sem mínimo nem máximo. Os inclusos já estão no preço; opção com preço só cobra o que passar dos inclusos.</p></div>`;
  }).join('')||'<p class="empty" style="padding:10px">Nenhum grupo de opções ainda.</p>'}
  <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
    <button type="button" class="op-btn primary" onclick="newGroupForProduct(${t})">+ Grupo de opções</button>
    ${livres.length?`<select id="pGroupPick-${h(target)}"><option value="">Usar grupo já cadastrado…</option>${livres.map(g=>`<option value="${h(g.id)}">${h(g.nome)}</option>`).join('')}</select><button type="button" class="op-btn" onclick="addGroupRule(${t})">Adicionar</button>`:''}
  </div>`;
}
function setRuleField(target, idx, field, value){
  const r = psdRules(target)[idx]; if(!r) return;
  r[field] = String(value); // sem redesenhar: não perder o clique seguinte
}
function addGroupRule(target){
  const sel = document.getElementById('pGroupPick-'+target);
  const id = sel && sel.value;
  if(!id){ toast('Escolha um grupo na lista.'); return; }
  psdAddRule(target, id);
}
function psdAddRule(target, groupId){
  const rules = psdRules(target);
  if(rules.some(r=>r.groupId===groupId)){ toast('Este grupo já está na lista.'); return; }
  rules.push({ groupId, included:'0' });
  refreshProductGradeUi();
}
function removeGroupRule(target, idx){
  psdRules(target).splice(idx,1);
  refreshProductGradeUi();
}
// openOptionGroupModal troca a janela inteira; guarda a janela do produto e a devolve ao fechar.
function psdOpenGroupModal(id, onSaved){
  const root = document.getElementById('modalRoot'), guardada = root && root.firstElementChild;
  if(!guardada){ openOptionGroupModal(id, onSaved); return; }
  const travada = root.dataset.locked;
  root.removeChild(guardada);
  const fecharOriginal = closeModal;
  let voltou = false;
  const voltar = ()=>{
    if(voltou) return; voltou = true;
    closeModal = fecharOriginal;
    root.innerHTML = ''; root.appendChild(guardada); root.dataset.locked = travada||'false';
    refreshProductGradeUi();
  };
  closeModal = function(){ const r = fecharOriginal.apply(this, arguments); if(!root.firstElementChild) voltar(); return r; };
  openOptionGroupModal(id, rec=>{ voltar(); if(rec&&onSaved) onSaved(rec); });
}
function newGroupForProduct(target){
  psdOpenGroupModal(null, rec=>psdAddRule(target, rec.id));
}
function editRuleGroup(groupId){ psdOpenGroupModal(groupId, ()=>refreshProductGradeUi()); }

// ---------- aba Tamanhos ----------
function selectProductSize(sizeId){
  const d = productSizesDraft; if(!d||!d.sizes[sizeId]) return;
  d.sel = sizeId; d.copyOpen = false;
  renderProductSizesPane();
}
function toggleSizeActive(sizeId, on){
  const e = productSizesDraft.sizes[sizeId]; if(!e) return;
  e.active = !!on;
  refreshProductGradeUi();
}
function setSizeField(field, value){
  const d = productSizesDraft, e = d&&d.sizes[d.sel]; if(!e) return;
  e[field] = String(value);
  if(field==='price'){
    const sp = document.querySelector('[data-size-price="'+d.sel+'"]');
    const n = parseFloat(value);
    if(sp) sp.textContent = Number.isFinite(n) ? fmt(n) : '—';
  }
}
function setSizeChannel(ch, on){
  const d = productSizesDraft, e = d&&d.sizes[d.sel]; if(e) e.channels[ch] = !!on;
}
function addSizeRecipeRow(){
  const d = productSizesDraft, e = d&&d.sizes[d.sel]; if(!e) return;
  if(!state.insumos.length){ toast('Cadastre insumos primeiro na aba Insumos.'); return; }
  e.recipe.push({ insumoId:state.insumos[0].id, qty:1 }); renderProductSizesPane();
}
function setSizeRecipe(idx, field, value){
  const d = productSizesDraft, e = d&&d.sizes[d.sel], r = e&&e.recipe[idx]; if(!r) return;
  if(field==='qty') r.qty = parseFloat(value)||0; else r.insumoId = value;
}
function removeSizeRecipeRow(idx){
  const d = productSizesDraft, e = d&&d.sizes[d.sel]; if(!e) return;
  e.recipe.splice(idx,1); renderProductSizesPane();
}
function renderProductSizesPane(product){
  const el = document.getElementById('pTamanhosPane'); if(!el||!productSizesDraft) return;
  const d = productSizesDraft, g = psdGrade();
  if(!g){ el.innerHTML = d.gradeId ? '<p class="empty">A grade deste produto foi removida. Escolha outra na aba Principal.</p>' : ''; return; }
  psdEnsureSizes(false);
  const e = d.sizes[d.sel], gs = (g.sizes||[]).find(s=>s.id===d.sel);
  const cards = (g.sizes||[]).map(s=>{
    const x = d.sizes[s.id], n = parseFloat(x.price), on = s.id===d.sel;
    return `<div onclick="selectProductSize(${jsArg(s.id)})" style="cursor:pointer;border:${on?'2px solid var(--c-primary,#2f6fd6)':'1px solid var(--c-border-strong,#c9d0d9)'};border-radius:6px;padding:8px 10px;${x.active?'':'opacity:.55'}">
      <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:18px">${h(s.sigla||s.nome)}</b>
        <input type="checkbox" title="Oferecer este tamanho" ${x.active?'checked':''} onclick="event.stopPropagation()" onchange="toggleSizeActive(${jsArg(s.id)},this.checked)"></div>
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:4px"><span>${h(s.nome)}</span><span data-size-price="${h(s.id)}">${Number.isFinite(n)?h(fmt(n)):'—'}</span></div></div>`;
  }).join('');
  const ch = e ? e.channels : {};
  const chk = (k,l)=>`<label><input type="checkbox" ${ch[k]?'checked':''} onchange="setSizeChannel('${k}',this.checked)"> ${l}</label>`;
  const custoFicha = e ? e.recipe.reduce((s,r)=>{const i=state.insumos.find(x=>x.id===r.insumoId);return s+(i?(Number(i.costPerUnit)||0)*(Number(r.qty)||0):0);},0) : 0;
  const painel = !e||!gs ? '' : `
    <div style="flex:1;min-width:0">
      <div class="row" style="align-items:flex-end">
        <div class="field"><label>Tamanho</label><input value="${h(gs.nome+(gs.sigla?' ('+gs.sigla+')':''))}" disabled></div>
        <div class="field"><label>Preço de venda</label><input type="number" step="0.01" min="0" value="${h(e.price)}" onchange="setSizeField('price',this.value)"></div>
        <div class="field"><label>Custo</label><input type="number" step="0.01" min="0" value="${h(e.cost)}" placeholder="${h(fmt(custoFicha))}" onchange="setSizeField('cost',this.value)"></div></div>
      ${e.active?'':'<p class="sub">Tamanho desligado: não aparece na venda. Ligue a caixinha do cartão para oferecê-lo.</p>'}
      <p style="font-size:12px;font-weight:700;margin:12px 0 6px">Disponível em</p>
      <div class="channel-checks">${chk('pdv','PDV Desktop')}${chk('mobile','Comanda Mobile')}${chk('qr','Cardápio Digital (cliente)')}${chk('online','Totem de Autoatendimento')}</div>
      <p style="font-size:12px;font-weight:700;margin:12px 0 6px">Ficha técnica do tamanho</p>
      ${e.recipe.map((r,idx)=>`<div class="recipe-row"><select onchange="setSizeRecipe(${idx},'insumoId',this.value)">${state.insumos.map(i=>`<option value="${h(i.id)}" ${r.insumoId===i.id?'selected':''}>${h(i.name)} (${h(i.unit)})</option>`).join('')}</select>
        <input type="number" step="0.01" value="${h(r.qty)}" onchange="setSizeRecipe(${idx},'qty',this.value)"><button type="button" class="btn btn-sm btn-danger" onclick="removeSizeRecipeRow(${idx})">Remover</button></div>`).join('')||'<p class="empty" style="padding:6px 0">Sem insumos próprios neste tamanho.</p>'}
      <button type="button" class="btn btn-sm" onclick="addSizeRecipeRow()">+ Adicionar insumo</button>
      <p style="font-size:12px;font-weight:700;margin:14px 0 0">Grupos de opções deste tamanho</p>
      ${psdRulesHtml('size')}
      ${psdCopyHtml()}
    </div>`;
  el.innerHTML = `<div style="display:flex;gap:14px"><div style="display:flex;flex-direction:column;gap:8px;width:170px;flex:none">${cards}</div>${painel}</div>`;
}

// ---------- copiar regras ----------
function psdCopyHtml(){
  const d = productSizesDraft, g = psdGrade();
  if(!g || !d.sel) return '';
  const outros = (g.sizes||[]).filter(s=>s.id!==d.sel);
  const prods = productsUsingGradeSize(d.gradeId, d.sel).filter(p=>p.id!==d.productId);
  if(!outros.length && !prods.length) return '';
  const aberto = d.copyOpen;
  return `<div class="btns" style="margin-top:10px"><button type="button" class="op-btn" onclick="toggleCopyPanel()">Copiar para…</button></div>
    ${aberto?`<div style="border:1px dashed var(--c-border-strong,#9aa4b2);border-radius:6px;padding:10px;margin-top:8px">
      <p class="sub" style="margin-top:0">Copia só as regras de grupo (não o preço) deste tamanho. Os outros produtos só são alterados quando você salvar este.</p>
      ${outros.length?`<b style="font-size:12px">Outros tamanhos deste produto</b>${outros.map(s=>`<label class="item-line"><span>${h(s.nome)}</span><input type="checkbox" class="pCopySize" value="${h(s.id)}"></label>`).join('')}`:''}
      ${prods.length?`<b style="font-size:12px">Mesmo tamanho em outros produtos da grade</b>${prods.map(p=>`<label class="item-line"><span>${h(p.name)}</span><input type="checkbox" class="pCopyProd" value="${h(p.id)}"></label>`).join('')}`:''}
      <button type="button" class="op-btn primary" style="margin-top:8px" onclick="runCopyGroupRules()">Copiar</button></div>`:''}`;
}
function toggleCopyPanel(){ productSizesDraft.copyOpen = !productSizesDraft.copyOpen; renderProductSizesPane(); }
function runCopyGroupRules(){
  const d = productSizesDraft;
  const sizes = [...document.querySelectorAll('.pCopySize:checked')].map(x=>x.value);
  const prods = [...document.querySelectorAll('.pCopyProd:checked')].map(x=>x.value);
  if(!sizes.length && !prods.length){ toast('Marque para onde copiar.'); return; }
  const res = copyGroupRules(d.sel, sizes, prods);
  if(!res || res.error) return; // erro já mostrado; painel segue aberto
  d.copyOpen = false;
  refreshProductGradeUi();
  toast('Regras copiadas'+(prods.length?'. Os outros produtos são atualizados ao salvar.':'.'));
}
// Copia só as regras de grupo de fromSizeId para outros tamanhos deste produto (agora, no
// rascunho) e para o mesmo tamanho de outros produtos (guardado; grava no Salvar).
function copyGroupRules(fromSizeId, toSizeIds, toProductIds){
  const d = productSizesDraft, from = d&&d.sizes[fromSizeId]; if(!from) return;
  const lido = psdReadRules(from.groups, (psdGrade()&&(psdGrade().sizes||[]).find(x=>x.id===fromSizeId)||{}).nome||'');
  if(lido.error){ toast(lido.error); return { error:lido.error }; }
  (toSizeIds||[]).forEach(id=>{ if(id!==fromSizeId && d.sizes[id]) d.sizes[id].groups = lido.rules.map(r=>({ groupId:r.groupId, included:String(r.included) })); });
  (toProductIds||[]).forEach(pid=>{
    if(pid===d.productId) return;
    d.copies = d.copies.filter(c=>!(c.productId===pid && c.sizeId===fromSizeId));
    d.copies.push({ productId:pid, sizeId:fromSizeId, rules:psdClone(lido.rules) }); // números já validados
  });
  return { ok:true };
}
// Chamado no Salvar do produto: grava as regras copiadas nos outros produtos (sem salvar;
// quem chama faz um único save('products')). Devolve quantos produtos mudaram.
function applyPendingSizeCopies(){
  const d = productSizesDraft; if(!d||!d.copies.length) return 0;
  const tocados = new Set();
  d.copies.forEach(c=>{
    const prod = state.products.find(x=>x.id===c.productId);
    if(!prod || prod.gradeId!==d.gradeId || !prod.sizes || !prod.sizes[c.sizeId]) return;
    prod.sizes[c.sizeId].groups = psdClone(c.rules);
    tocados.add(prod.id);
  });
  d.copies = [];
  return tocados.size;
}

// ---------- aba Opções (produto sem grade) ----------
function renderProductOptionsPane(product){
  const el = document.getElementById('pOpcoesPane'); if(!el||!productSizesDraft) return;
  el.innerHTML = productSizesDraft.gradeId ? '' :
    `<p class="sub">Grupos de opções oferecidos na venda deste produto (ex.: acompanhamentos, adicionais). Para ter preço por tamanho, escolha uma grade na aba Principal.</p>${psdRulesHtml('product')}`;
}

// ---------- leitura/validação no Salvar ----------
function psdReadRules(list, onde){
  const out = [];
  for(const r of list){
    const included = parseInt(r.included,10);
    const g = psdGroup(r.groupId), nome = g ? g.nome : 'grupo removido';
    if(!(Number.isFinite(included)&&included>=0)) return { error:'Inclusos de '+nome+(onde?' ('+onde+')':'')+' devem ser um número a partir de 0.' };
    out.push({ groupId:r.groupId, included });
  }
  return { rules:out };
}
// -> { gradeId, sizes, groups } | { error, tab, sizeId }
function readProductSizesDraft(){
  const d = productSizesDraft;
  if(!d) return { gradeId:null, sizes:{}, groups:[] };
  if(!d.gradeId){
    const r = psdReadRules(d.groups, '');
    if(r.error) return { error:r.error, tab:'opcoes' };
    return { gradeId:null, sizes:{}, groups:r.rules };
  }
  const grade = psdGrade();
  if(!grade){ // grade apagada: não dá para conferir os tamanhos; mantém o que o produto já tem
    const keep = {};
    let ativosK = 0;
    for(const id of Object.keys(d.sizes)){
      const e = d.sizes[id], r = psdReadRules(e.groups, '');
      if(r.error) return { error:r.error, tab:'tamanhos', sizeId:id };
      const pr = parseFloat(e.price);
      if(e.active){
        if(!Number.isFinite(pr) || pr<0) return { error:'Informe o preço do tamanho ligado.', tab:'tamanhos', sizeId:id };
        ativosK++;
      }
      keep[id] = psdSizeOut(e, Number.isFinite(pr)&&pr>=0?pr:0, r.rules);
    }
    if(!ativosK) return { error:'Ligue ao menos um tamanho para vender este produto.', tab:'tamanhos' };
    return { gradeId:d.gradeId, sizes:keep, groups:[] };
  }
  const sizes = {};
  let ativos = 0;
  for(const s of (grade.sizes||[])){ // só os tamanhos que ainda existem na grade (sem órfãos)
    const e = d.sizes[s.id]; if(!e) continue;
    const r = psdReadRules(e.groups, s.nome);
    if(r.error) return { error:r.error, tab:'tamanhos', sizeId:s.id };
    let price = parseFloat(e.price);
    if(e.active){
      if(!Number.isFinite(price) || price<0) return { error:'Informe o preço de '+s.nome+'.', tab:'tamanhos', sizeId:s.id };
      ativos++;
    }
    if(!Number.isFinite(price) || price<0) price = 0;
    sizes[s.id] = psdSizeOut(e, price, r.rules);
  }
  if(!ativos) return { error:'Ligue ao menos um tamanho para vender este produto.', tab:'tamanhos' };
  return { gradeId:d.gradeId, sizes, groups:[] };
}
function psdSizeOut(e, price, rules){
  const cost = parseFloat(e.cost);
  return { price, cost:Number.isFinite(cost)&&cost>0?cost:0, active:e.active!==false,
    channels:{ pdv:!!e.channels.pdv, mobile:!!e.channels.mobile, qr:!!e.channels.qr, online:!!e.channels.online },
    recipe:e.recipe.filter(r=>r.insumoId&&Number(r.qty)>0).map(r=>({insumoId:r.insumoId, qty:Number(r.qty)})), groups:rules };
}
