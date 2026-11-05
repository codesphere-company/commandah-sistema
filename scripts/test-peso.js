/* Testes do núcleo da venda por peso (assets/js/core/peso.js), 05/11.
   Roda no Node puro: node scripts/test-peso.js
   Carrega o arquivo como script clássico num contexto com arredondaCentavos injetado (vem de core/config.js). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { arredondaCentavos: (v) => Math.round(v * 100) / 100 };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'core', 'peso.js'), 'utf8'), ctx);
const { isWeighedProduct, parsePesoKg, pesoValor, fmtKg, weighedLine, itemStockQty, itemQtyLabel } = ctx;

let n = 0;
function t(nome, fn) { fn(); n++; }

t('parsePesoKg aceita formatos válidos', () => {
  const casos = [['0,480', 0.48], ['0.480', 0.48], ['480', 0.48], ['1.500', 1.5], ['1,5', 1.5],
    ['2', 2], ['480 g', 0.48], ['0,48 kg', 0.48]];
  casos.forEach(([txt, kg]) => assert.strictEqual(parsePesoKg(txt).kg, kg, txt));
});
t('parsePesoKg rejeita inválidos', () => {
  ['', '0', 'abc', '10,001', '-1'].forEach(txt => {
    const r = parsePesoKg(txt);
    assert.ok(typeof r.error === 'string' && r.error.length > 0 && r.kg === undefined, txt);
  });
});
t('pesoValor', () => {
  assert.strictEqual(pesoValor(0.48, 119.9), 57.55);
  assert.strictEqual(pesoValor(0.515, 119.9), 61.75);
  assert.strictEqual(pesoValor(0.333, 74.9), 24.94);
});
t('fmtKg', () => assert.strictEqual(fmtKg(0.48), '0,480 kg'));
t('isWeighedProduct', () => {
  assert.strictEqual(isWeighedProduct({ measure: 'KG' }), true);
  assert.strictEqual(isWeighedProduct({ measure: 'un' }), false);
  assert.strictEqual(isWeighedProduct({}), false);
});
t('weighedLine', () => {
  const a = ctx.weighedLine({ id: 'p', name: 'PICANHA GRILL KG' }, 0.48, 119.9);
  assert.strictEqual(a.productId, 'p');
  assert.strictEqual(a.name, 'PICANHA GRILL KG');
  assert.strictEqual(a.qty, 1);
  assert.strictEqual(a.price, 57.55);
  assert.strictEqual(a.weight.kg, 0.48);
  assert.strictEqual(a.weight.pricePerKg, 119.9);
  assert.strictEqual(a.notes, '0,480 kg \u00d7 R$ 119,90');
  assert.strictEqual(a.estacao, 'nenhuma');
  const b = weighedLine({ id: 'p', name: 'PICANHA GRILL KG' }, 0.48, 119.9);
  assert.ok(a.customizationSignature.startsWith('peso:'));
  assert.notStrictEqual(a.customizationSignature, b.customizationSignature);
});
t('itemStockQty e itemQtyLabel', () => {
  assert.strictEqual(itemStockQty({ qty: 1, weight: { kg: 0.48 } }), 0.48);
  assert.strictEqual(itemStockQty({ qty: 3 }), 3);
  assert.strictEqual(itemQtyLabel({ qty: 1, weight: { kg: 0.48 } }), '0,480 kg');
  assert.strictEqual(itemQtyLabel({ qty: 2 }), '2x');
});

console.log('ok ' + n + ' testes');
