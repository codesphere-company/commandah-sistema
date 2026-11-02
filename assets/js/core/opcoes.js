/* ============ TAMANHOS E OPÇÕES ============ */
// Regras puras de tamanho (grade) e grupos de opções do produto.
// Só calcula: recebe tudo por parâmetro (produto, complementos, escolhas) e NUNCA lê `state`,
// nem grava, nem desenha tela. As telas (venda, garçom, totem, cardápio) e a cozinha chamam daqui.
// Testes: node scripts/test-opcoes.js
//
// Formato dos dados:
//   complementos: { id, recordKind:'grade', nome, active, sizes:[{id,nome,sigla}] }
//                 { id, recordKind:'optionGroup', nome, active, options:[{id,nome,preco,active,recipe}] }
//   produto: gradeId, sizes{[sizeId]:{price,active,channels,recipe,groups}}, groups (sem grade)
//   GroupRule: { groupId, min, max, included, repeat }
//   customization (v2): { v:2, sizeId, size, groups:[{groupId,name,choices,charged}], observationIds,
//                         observations, notes, extra, summary }
//   Cada choice guarda { optionId, name, qty, price } + recipe (cópia da ficha da opção na hora da
//   venda, para o estoque baixar o que foi vendido mesmo se a opção mudar depois).

function opcoesMoney(n){ return 'R$ ' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace('.', ','); }
function opcoesRound2(n){ return Math.round(n * 100) / 100; }
function opcoesRecordById(complementos, id, kind){
  if(!id) return null;
  return (complementos || []).find(c => c && c.id === id && c.recordKind === kind) || null;
}
function opcoesGroupOf(complementos, groupId){
  const g = opcoesRecordById(complementos, groupId, 'optionGroup');
  return g && g.active !== false ? g : null;
}

// Grade ativa do produto, ou null (produto de preço único).
function gradeOf(product, complementos){
  if(!product || !product.gradeId) return null;
  const g = opcoesRecordById(complementos, product.gradeId, 'grade');
  return g && g.active !== false ? g : null;
}

// Regras de grupo valem para o tamanho escolhido; sem grade, as do produto.
function rulesFor(product, sizeId){
  if(!product) return [];
  if(sizeId && product.sizes && product.sizes[sizeId]) return product.sizes[sizeId].groups || [];
  return product.groups || [];
}

// Todas as regras possíveis do produto (todos os tamanhos), só as de grupo que ainda existe.
function opcoesAllRules(product, complementos){
  if(!product) return [];
  let rules = (product.groups || []).slice();
  if(gradeOf(product, complementos)){
    Object.keys(product.sizes || {}).forEach(id => { rules = rules.concat(product.sizes[id].groups || []); });
  }
  return rules.filter(r => r && opcoesGroupOf(complementos, r.groupId));
}

function productNeedsChoice(product, complementos){
  return !!gradeOf(product, complementos) || opcoesAllRules(product, complementos).length > 0;
}

// Produto com tamanho ou com grupo obrigatório não cabe em fluxo sem balcão (autoatendimento/combo).
function opcoesHasRequiredChoice(product, complementos){
  return !!gradeOf(product, complementos) || opcoesAllRules(product, complementos).some(r => Number(r.min) >= 1);
}
function hiddenInSelfService(product, complementos){ return opcoesHasRequiredChoice(product, complementos); }
function blockedInCombo(product, complementos){ return opcoesHasRequiredChoice(product, complementos); }

function sizesForChannel(product, grade, channel){
  if(!product || !grade) return [];
  const out = [];
  (grade.sizes || []).forEach(s => {
    const ps = product.sizes && product.sizes[s.id];
    if(!ps || ps.active === false) return;
    if((ps.channels || {})[channel] === false) return;
    if(typeof ps.price !== 'number' || !isFinite(ps.price)) return;
    out.push({ sizeId: s.id, name: s.nome, sigla: s.sigla, price: ps.price });
  });
  return out;
}

// Cobra só o que passa dos inclusos; os inclusos cobrem as unidades mais caras.
function chargedForGroup(choices, included){
  const units = [];
  (choices || []).forEach(c => { for(let i = 0; i < (Number(c.qty) || 0); i++) units.push(Number(c.price) || 0); });
  units.sort((a, b) => b - a);
  let total = 0;
  for(let i = Math.max(0, Number(included) || 0); i < units.length; i++) total += units[i];
  return opcoesRound2(total);
}

function validateGroup(rule, groupName, choices){
  const total = (choices || []).reduce((s, c) => s + (Number(c.qty) || 0), 0);
  const max = Number(rule.max) || 0, min = Number(rule.min) || 0;
  if(total > max) return 'Escolha no máximo ' + max + ' em ' + groupName + '.';
  if(total < min) return 'Escolha ao menos ' + min + ' em ' + groupName + '.';
  if(!rule.repeat && (choices || []).some(c => (Number(c.qty) || 0) > 1)) return 'Cada opção de ' + groupName + ' só pode ser escolhida uma vez.';
  return '';
}

function opcoesGroupLine(g){
  if(!g.choices || !g.choices.length) return '';
  const partes = g.choices.map(c => c.qty + 'x ' + c.name).join(', ');
  return g.name + ': ' + partes + (g.charged > 0 ? ' (+ ' + opcoesMoney(g.charged) + ')' : '');
}

function customizationLines(item){
  const c = item && item.customization;
  if(!c) return [];
  if(c.v === 2) return (c.groups || []).map(opcoesGroupLine).filter(Boolean);
  // formato antigo (size/answers/complements): mesmo resultado do kitchenItemExtras
  const lines = [];
  if(c.size) lines.push(c.size.name);
  (c.answers || []).forEach(a => (a.values || []).forEach(v => lines.push(a.question + ': ' + v.text)));
  (c.complements || []).forEach(comp => lines.push(comp.name));
  return lines;
}

function buildCustomization(p){
  const product = p.product, complementos = p.complementos, picks = p.picks || {};
  if(!product) return { error: 'Produto indisponível.' };
  const grade = gradeOf(product, complementos);
  let size = null, sizeId = null, basePrice = Number(product.price) || 0;
  if(grade){
    const found = sizesForChannel(product, grade, '__qualquer__').find(s => s.sizeId === p.sizeId);
    if(!p.sizeId || !found) return { error: 'Escolha o tamanho.' };
    sizeId = found.sizeId;
    size = { id: found.sizeId, name: found.name, sigla: found.sigla, price: found.price };
    basePrice = found.price;
  }
  const rules = rulesFor(product, sizeId).filter(r => r && opcoesGroupOf(complementos, r.groupId));
  // escolha de grupo que não faz parte das regras do tamanho
  const grupoSemRegra = Object.keys(picks).find(gid => !rules.some(r => r.groupId === gid) &&
    Object.keys(picks[gid] || {}).some(oid => Number(picks[gid][oid]) > 0));
  if(grupoSemRegra){
    const g = opcoesRecordById(complementos, grupoSemRegra, 'optionGroup');
    return { error: 'Opção indisponível: ' + (g ? g.nome : grupoSemRegra) + '.' };
  }
  const groups = [];
  let extra = 0;
  for(let i = 0; i < rules.length; i++){
    const rule = rules[i], grupo = opcoesGroupOf(complementos, rule.groupId);
    const gPicks = picks[rule.groupId] || {};
    const choices = [];
    const optionIds = (grupo.options || []).map(o => o.id);
    const desconhecida = Object.keys(gPicks).find(oid => Number(gPicks[oid]) > 0 && optionIds.indexOf(oid) < 0);
    if(desconhecida) return { error: 'Opção indisponível: ' + desconhecida + '.' };
    for(let j = 0; j < (grupo.options || []).length; j++){ // ordem da definição do grupo
      const op = grupo.options[j], qty = Math.floor(Number(gPicks[op.id]) || 0);
      if(qty <= 0) continue;
      if(op.active === false) return { error: 'Opção indisponível: ' + op.nome + '.' };
      const ch = { optionId: op.id, name: op.nome, qty: qty, price: Number(op.preco) || 0 };
      if(op.recipe && op.recipe.length) ch.recipe = op.recipe.map(r => ({ insumoId: r.insumoId, qty: r.qty }));
      choices.push(ch);
    }
    const erro = validateGroup(rule, grupo.nome, choices);
    if(erro) return { error: erro };
    const charged = chargedForGroup(choices, rule.included);
    extra += charged;
    groups.push({ groupId: grupo.id, name: grupo.nome, choices: choices, charged: charged });
  }
  extra = opcoesRound2(extra);
  const notes = String(p.notes || '').trim();
  const customization = {
    v: 2, sizeId: sizeId, size: size, groups: groups,
    observationIds: (p.observationIds || []).slice(), observations: (p.observations || []).slice(),
    notes: notes, extra: extra, summary: ''
  };
  const resumo = customizationLines({ customization: customization });
  if(notes) resumo.push('Obs.: ' + notes);
  customization.summary = resumo.join(' · ');
  return {
    customization: customization,
    name: size ? product.name + ' - ' + size.name : product.name,
    basePrice: basePrice,
    price: opcoesRound2(basePrice + extra)
  };
}

// Mesmas escolhas = mesma assinatura (soma no carrinho); escolhas diferentes = linhas separadas.
function customizationSignature(c){
  if(!c) return '';
  if(c.v !== 2) return JSON.stringify(c);
  const groups = (c.groups || []).map(g => ({
    g: g.groupId,
    c: (g.choices || []).map(x => [x.optionId, x.qty]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  })).sort((a, b) => a.g < b.g ? -1 : a.g > b.g ? 1 : 0);
  const obs = (c.observationIds && c.observationIds.length ? c.observationIds : (c.observations || [])).slice().map(String).sort();
  return JSON.stringify({ s: c.sizeId || null, g: groups, o: obs, n: String(c.notes || '').trim() });
}

// Ficha técnica por 1 unidade do item (quem baixa estoque multiplica pela quantidade).
function itemRecipe(product, item){
  const c = item && item.customization;
  if(!c || c.v !== 2) return [];
  const soma = {}, ordem = [];
  const add = (list, mult) => (list || []).forEach(r => {
    if(!r || !r.insumoId) return;
    if(!(r.insumoId in soma)){ soma[r.insumoId] = 0; ordem.push(r.insumoId); }
    soma[r.insumoId] += (Number(r.qty) || 0) * mult;
  });
  const ps = c.sizeId && product && product.sizes && product.sizes[c.sizeId];
  if(ps) add(ps.recipe, 1);
  (c.groups || []).forEach(g => (g.choices || []).forEach(ch => add(ch.recipe, Number(ch.qty) || 0)));
  return ordem.map(id => ({ insumoId: id, qty: Math.round(soma[id] * 1e6) / 1e6 }));
}

// Repetir pedido: refaz as escolhas antigas com o preço atual; null se algo sumiu ou ficou pausado.
function rebuildCustomization(p){
  const old = p.oldCustomization;
  if(!old || old.v !== 2) return null;
  const picks = {};
  for(let i = 0; i < (old.groups || []).length; i++){
    const g = old.groups[i], grupo = opcoesGroupOf(p.complementos, g.groupId);
    if(!grupo) return null;
    picks[g.groupId] = {};
    for(let j = 0; j < (g.choices || []).length; j++){
      const ch = g.choices[j];
      const op = (grupo.options || []).find(o => o.id === ch.optionId);
      if(!op || op.active === false) return null;
      picks[g.groupId][ch.optionId] = ch.qty;
    }
  }
  const r = buildCustomization({
    product: p.product, complementos: p.complementos, sizeId: old.sizeId, picks: picks,
    notes: old.notes, observations: old.observations, observationIds: old.observationIds
  });
  return r.error ? null : r;
}
