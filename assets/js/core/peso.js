/* ============ PESO ============ */
// Venda por peso (05/11): carne vendida por kg, com o peso digitado a cada peça.
// Funções puras, sem depender de `state` nem de `fmt` (só de arredondaCentavos, de core/config.js, usada na hora da chamada).
const PESO_MAX_KG = 10;
let _pesoSeq = 0;

// Venda por peso, 05/11: produto pesado = vendido em KG.
function isWeighedProduct(p){ return !!p && String(p.measure).toLowerCase() === 'kg'; }

// Venda por peso, 05/11: lê o que o operador digitou. Aceita "0,480", "0.480", "480" (gramas), "1,5", "480 g", "0,48 kg".
function parsePesoKg(texto){
  let s = String(texto == null ? '' : texto).trim().toLowerCase().replace(/\s+/g, '');
  if(!s) return { error: 'Digite o peso.' };
  let gramas = false;
  if(/kg$/.test(s)) s = s.slice(0, -2);
  else if(/g$/.test(s)){ s = s.slice(0, -1); gramas = true; }
  if(!/^\d+([.,]\d+)?$/.test(s)) return { error: 'Peso inválido. Use por exemplo 0,480 ou 480 g.' };
  let v = parseFloat(s.replace(',', '.'));
  if(gramas) v = v / 1000;
  else if(!/[.,]/.test(s) && v >= PESO_MAX_KG) v = v / 1000; // número inteiro >= 10 = gramas (480 -> 0,480 kg; 10 -> 0,010 kg)
  v = Math.round(v * 1000) / 1000;
  if(!(v > 0)) return { error: 'O peso deve ser maior que zero.' };
  if(v > PESO_MAX_KG) return { error: 'Peso acima do limite de ' + PESO_MAX_KG + ' kg.' };
  return { kg: v };
}

// Venda por peso, 05/11: valor da peça = kg × preço do kg, em centavos arredondados.
function pesoValor(kg, pricePerKg){ return arredondaCentavos((Number(kg) || 0) * (Number(pricePerKg) || 0)); }

// Formatação própria (vírgula, 3 casas) para não depender do `fmt` global.
function _pesoBR(n, casas){ return Number(n).toFixed(casas).replace('.', ','); }
function fmtKg(kg){ return _pesoBR(Number(kg) || 0, 3) + ' kg'; }

// Venda por peso, 05/11: linha de venda de uma peça pesada. A assinatura única impede somar com outra linha.
function weighedLine(product, kg, pricePerKg, override){
  const weight = { kg: kg, pricePerKg: pricePerKg };
  if(override) weight.override = override;
  _pesoSeq++;
  return {
    productId: product.id,
    name: product.name,
    price: pesoValor(kg, pricePerKg),
    qty: 1,
    weight: weight,
    notes: fmtKg(kg) + ' \u00d7 R$ ' + _pesoBR(pricePerKg, 2),
    estacao: 'nenhuma',
    customizationSignature: 'peso:' + Date.now().toString(36) + '-' + _pesoSeq + '-' + Math.random().toString(36).slice(2, 8)
  };
}

// Venda por peso, 05/11: quanto sai do estoque (kg se pesado, senão a quantidade).
function itemStockQty(it){ return it.weight ? it.weight.kg : (Number(it.qty) || 0); }
function itemQtyLabel(it){ return it.weight ? fmtKg(it.weight.kg) : it.qty + 'x'; }
