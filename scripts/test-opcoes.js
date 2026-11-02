/* Testes das regras de tamanhos e grupos de opções (assets/js/core/opcoes.js).
   Roda no Node puro: node scripts/test-opcoes.js
   Carrega o arquivo como script clássico num contexto vazio (igual ao navegador, sem `state`). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'core', 'opcoes.js'), 'utf8'), ctx);
const {
  gradeOf, productNeedsChoice, sizesForChannel, rulesFor, chargedForGroup, validateGroup,
  buildCustomization, customizationSignature, customizationLines, itemRecipe,
  rebuildCustomization, hiddenInSelfService, blockedInCombo
} = ctx;

// Objetos criados dentro do vm têm outro Array.prototype: compara via JSON.
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);

function fixture(over) {
  over = over || {};
  const complementos = [
    { id: 'gAcai', recordKind: 'grade', nome: 'Açaí', active: true,
      sizes: [{ id: 's300', nome: '300ml', sigla: 'P' }, { id: 's500', nome: '500ml', sigla: 'G' }] },
    { id: 'gAc', recordKind: 'optionGroup', nome: 'Acompanhamentos', active: true, options: [
      { id: 'gran', nome: 'Granola', preco: 0, active: true, recipe: [{ insumoId: 'granola', qty: 0.05 }] },
      { id: 'pac', nome: 'Paçoca', preco: 0, active: true, recipe: [] },
      { id: 'kk', nome: 'Kit Kat', preco: 3, active: over.kkPausada ? false : true, recipe: [] }
    ] },
    { id: 'gMolho', recordKind: 'optionGroup', nome: 'Molho', active: true, options: [
      { id: 'ket', nome: 'Ketchup', preco: 0, active: true, recipe: [] }
    ] }
  ];
  const rule = (max) => ({ groupId: 'gAc', min: 0, max: max, included: max, repeat: over.repeat !== false });
  const acai = {
    id: 'acai', name: 'AÇAÍ NO COPO', price: 0, gradeId: 'gAcai',
    sizes: {
      s300: { price: 18, active: true, channels: { pdv: true, mobile: true, qr: true, online: true },
              recipe: [{ insumoId: 'acai', qty: 0.3 }], groups: [rule(2)] },
      s500: { price: 28, active: true, channels: { pdv: true, mobile: false, qr: true, online: true },
              recipe: [], groups: [rule(3)] }
    }
  };
  return { complementos, acai };
}
const build = (f, sizeId, picks, extra) => buildCustomization(Object.assign(
  { product: f.acai, complementos: f.complementos, sizeId: sizeId, picks: picks, notes: '', observations: [] }, extra || {}));

let n = 0;
function t(nome, fn) {
  try { fn(); n++; } catch (e) {
    console.error('FALHOU ' + nome + '\n' + (e && e.stack || e));
    process.exit(1);
  }
}

t('1.1 inclusos cobrem os mais caros', () => {
  assert.strictEqual(chargedForGroup([{ price: 3, qty: 1 }, { price: 4, qty: 1 }, { price: 2, qty: 1 }], 2), 2);
  assert.strictEqual(chargedForGroup([{ price: 3, qty: 3 }], 2), 3);
  assert.strictEqual(chargedForGroup([{ price: 4, qty: 2 }], 0), 8);
});

t('1.2 açaí 300ml com 2x granola = R$ 18, nome com tamanho', () => {
  const f = fixture();
  const r = build(f, 's300', { gAc: { gran: 2 } });
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.name, 'AÇAÍ NO COPO - 300ml');
  assert.strictEqual(r.price, 18);
  assert.strictEqual(r.basePrice, 18);
  assert.strictEqual(r.customization.v, 2);
  assert.strictEqual(r.customization.sizeId, 's300');
  eq(r.customization.size, { id: 's300', name: '300ml', sigla: 'P', price: 18 });
  assert.strictEqual(r.customization.extra, 0);
  assert.strictEqual(r.customization.summary, 'Acompanhamentos: 2x Granola');
});

t('1.3 passar do máximo', () => {
  const f = fixture();
  assert.match(build(f, 's300', { gAc: { gran: 2, pac: 1 } }).error, /no máximo 2/);
});

t('1.4 repetir desligado', () => {
  const f = fixture({ repeat: false });
  assert.match(build(f, 's300', { gAc: { gran: 2 } }).error, /uma vez/);
  assert.strictEqual(build(f, 's300', { gAc: { gran: 1, pac: 1 } }).error, undefined);
});

t('1.5 mínimo', () => {
  const f = fixture();
  f.acai.sizes.s300.groups.push({ groupId: 'gMolho', min: 1, max: 1, included: 1, repeat: false });
  assert.match(build(f, 's300', {}).error, /Escolha .*Molho/);
  assert.strictEqual(build(f, 's300', { gMolho: { ket: 1 } }).error, undefined);
  assert.strictEqual(validateGroup({ min: 1, max: 1, repeat: false }, 'Molho', []), 'Escolha ao menos 1 em Molho.');
  assert.strictEqual(validateGroup({ min: 0, max: 2, repeat: true }, 'X', [{ qty: 2 }]), '');
});

t('1.6 tamanho inexistente, opção pausada, sem tamanho', () => {
  const f = fixture();
  assert.ok(build(f, 'sXX', {}).error);
  assert.match(build(f, '', {}).error, /tamanho/);
  assert.match(build(f, null, {}).error, /tamanho/);
  const p = fixture({ kkPausada: true });
  assert.match(build(p, 's300', { gAc: { kk: 1 } }).error, /Opção indisponível: Kit Kat/);
  const g = fixture(); g.acai.sizes.s300.active = false;
  assert.match(build(g, 's300', {}).error, /tamanho/);
  // grupo apagado: a regra é ignorada
  const d = fixture(); d.complementos = d.complementos.filter(c => c.id !== 'gAc');
  const r = build(d, 's300', {});
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.customization.groups.length, 0);
});

t('1.7 assinatura', () => {
  const f = fixture();
  const a = build(f, 's300', { gAc: { gran: 1, pac: 1 } }).customization;
  const b = build(f, 's300', { gAc: { pac: 1, gran: 1 } }).customization;
  const c = build(f, 's300', { gAc: { gran: 2 } }).customization;
  const d = build(f, 's500', { gAc: { gran: 1, pac: 1 } }).customization;
  assert.strictEqual(customizationSignature(a), customizationSignature(b));
  assert.notStrictEqual(customizationSignature(a), customizationSignature(c));
  assert.notStrictEqual(customizationSignature(a), customizationSignature(d));
  assert.strictEqual(customizationSignature(null), '');
});

t('1.8 itemRecipe por unidade', () => {
  const f = fixture();
  const r = build(f, 's300', { gAc: { gran: 2 } });
  eq(itemRecipe(f.acai, { customization: r.customization, qty: 3 }),
    [{ insumoId: 'acai', qty: 0.3 }, { insumoId: 'granola', qty: 0.1 }]);
  eq(itemRecipe(f.acai, { customization: null }), []);
});

t('1.9 customizationLines formato 2', () => {
  const f = fixture();
  const r = build(f, 's300', { gAc: { gran: 2 } });
  eq(customizationLines({ customization: r.customization }), ['Acompanhamentos: 2x Granola']);
  f.acai.sizes.s300.groups[0].included = 0;
  const k = build(f, 's300', { gAc: { kk: 1 } });
  assert.strictEqual(k.price, 21);
  eq(customizationLines({ customization: k.customization }), ['Acompanhamentos: 1x Kit Kat (+ R$ 3,00)']);
  const m = build(f, 's300', { gAc: { gran: 1, kk: 1 } });
  eq(customizationLines({ customization: m.customization }), ['Acompanhamentos: 1x Granola, 1x Kit Kat (+ R$ 3,00)']);
});

t('1.10 customizationLines formato antigo', () => {
  eq(customizationLines({ customization: {
    size: { name: 'G' },
    answers: [{ question: 'Ponto', values: [{ text: 'Mal' }] }],
    complements: [{ name: 'Bacon' }]
  } }), ['G', 'Ponto: Mal', 'Bacon']);
  eq(customizationLines({}), []);
});

t('1.11 produto normal, autoatendimento e combo', () => {
  const f = fixture();
  const molho = (min) => ({ groups: [{ groupId: 'gMolho', min: min, max: 1, included: 1, repeat: false }] });
  assert.strictEqual(productNeedsChoice({ kind: 'tamanho' }, f.complementos), false);
  assert.strictEqual(productNeedsChoice(f.acai, f.complementos), true);
  assert.strictEqual(productNeedsChoice(molho(0), f.complementos), true);
  assert.strictEqual(productNeedsChoice({ groups: [{ groupId: 'apagado', min: 1, max: 1, included: 1, repeat: false }] }, f.complementos), false);
  assert.strictEqual(hiddenInSelfService(f.acai, f.complementos), true);
  assert.strictEqual(blockedInCombo(f.acai, f.complementos), true);
  assert.strictEqual(hiddenInSelfService({ kind: 'tamanho' }, f.complementos), false);
  assert.strictEqual(blockedInCombo(molho(1), f.complementos), true);
  assert.strictEqual(blockedInCombo(molho(0), f.complementos), false);
  assert.strictEqual(gradeOf(f.acai, f.complementos).id, 'gAcai');
  assert.strictEqual(gradeOf({ gradeId: 'nada' }, f.complementos), null);
  const grade = gradeOf(f.acai, f.complementos);
  eq(sizesForChannel(f.acai, grade, 'mobile'), [{ sizeId: 's300', name: '300ml', sigla: 'P', price: 18 }]);
  assert.strictEqual(sizesForChannel(f.acai, grade, 'pdv').length, 2);
  assert.strictEqual(rulesFor(f.acai, 's500')[0].max, 3);
  eq(rulesFor({ groups: [{ groupId: 'x' }] }, null), [{ groupId: 'x' }]);
});

t('1.12 rebuildCustomization', () => {
  const f = fixture();
  const old = build(f, 's300', { gAc: { gran: 2 } }).customization;
  f.acai.sizes.s300.price = 20; // preço mudou
  const r = rebuildCustomization({ product: f.acai, complementos: f.complementos, oldCustomization: old });
  assert.strictEqual(r.price, 20);
  assert.strictEqual(r.name, 'AÇAÍ NO COPO - 300ml');
  // opção apagada do grupo
  const d = fixture(); d.complementos[1].options = d.complementos[1].options.filter(o => o.id !== 'gran');
  assert.strictEqual(rebuildCustomization({ product: d.acai, complementos: d.complementos, oldCustomization: old }), null);
  // tamanho removido da grade
  const s = fixture(); s.complementos[0].sizes = s.complementos[0].sizes.filter(x => x.id !== 's300');
  assert.strictEqual(rebuildCustomization({ product: s.acai, complementos: s.complementos, oldCustomization: old }), null);
  // formato antigo / vazio
  assert.strictEqual(rebuildCustomization({ product: f.acai, complementos: f.complementos, oldCustomization: { size: { name: 'G' } } }), null);
  assert.strictEqual(rebuildCustomization({ product: f.acai, complementos: f.complementos, oldCustomization: null }), null);
});

t('1.13 grade pausada ou apagada não vira produto de preço único', () => {
  const pausada = fixture(); pausada.complementos[0].active = false;
  const apagada = fixture(); apagada.complementos = apagada.complementos.filter(c => c.id !== 'gAcai');
  [pausada, apagada].forEach(f => {
    assert.strictEqual(productNeedsChoice(f.acai, f.complementos), true);
    assert.strictEqual(hiddenInSelfService(f.acai, f.complementos), true);
    assert.strictEqual(blockedInCombo(f.acai, f.complementos), true);
    assert.strictEqual(build(f, 's300', {}).error, 'Tamanhos indisponíveis para este produto.');
    assert.strictEqual(rebuildCustomization({ product: f.acai, complementos: f.complementos,
      oldCustomization: { v: 2, sizeId: 's300', groups: [] } }), null);
  });
  assert.strictEqual(productNeedsChoice({ kind: 'tamanho' }, pausada.complementos), false);
});

console.log('ok ' + n + ' testes');
