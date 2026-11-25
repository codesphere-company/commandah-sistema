/* ============ PIX COPIA E COLA (25/11, WhatsApp etapa 3) ============
   Monta o Pix estático com valor (BR Code, padrão EMV do Banco Central) para a conta mandada pelo WhatsApp.
   Campos: 00 formato, 26 conta (GUI br.gov.bcb.pix + chave), 52 categoria 0000, 53 moeda 986, 54 valor,
   58 país BR, 59 nome de quem recebe (até 25), 60 cidade (até 15), 62 txid (*** = sem identificador),
   63 CRC16-CCITT (polinômio 0x1021, início 0xFFFF). Conferido contra o exemplo do manual do BR Code (t74).
   Pix estático não confirma o pagamento: o caixa confere o comprovante e dá baixa como hoje. */
function pixCrc16(texto){
  let crc = 0xFFFF;
  for(let i = 0; i < texto.length; i++){
    crc ^= texto.charCodeAt(i) << 8;
    for(let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
// CPF/CNPJ só com dígitos, e-mail em minúsculas, telefone +55…, chave aleatória como veio.
function pixNormalizarChave(chave){
  const c = String(chave||'').trim();
  if(!c) return '';
  if(c.includes('@')) return c.toLowerCase();
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return c.toLowerCase();
  if(c.startsWith('+')) return '+' + c.replace(/\D/g, '');
  return c.replace(/\D/g, '');
}
// Sem acento e só letras, números e espaço (o BR Code aceita só ASCII nesses campos).
function pixTextoSimples(t, max){
  return String(t||'').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
function pixCampo(id, valor){ return id + String(valor.length).padStart(2, '0') + valor; }
function pixBrCode({ chave, nome, cidade, valor, txid = '***' }){
  const k = pixNormalizarChave(chave), n = pixTextoSimples(nome, 25), c = pixTextoSimples(cidade, 15);
  if(!k) throw new Error('Falta a chave Pix em Configurações.');
  if(!n) throw new Error('Falta o nome de quem recebe o Pix em Configurações.');
  if(!c) throw new Error('Falta a cidade do Pix em Configurações.');
  if(valor !== undefined && valor !== null && !(Number(valor) > 0)) throw new Error('O valor do Pix precisa ser maior que zero.');
  const conta = pixCampo('00', 'br.gov.bcb.pix') + pixCampo('01', k);
  let s = pixCampo('00', '01') + pixCampo('26', conta) + pixCampo('52', '0000') + pixCampo('53', '986');
  if(valor !== undefined && valor !== null) s += pixCampo('54', (Math.round(Number(valor) * 100) / 100).toFixed(2));
  s += pixCampo('58', 'BR') + pixCampo('59', n) + pixCampo('60', c) + pixCampo('62', pixCampo('05', String(txid||'***').slice(0, 25)));
  s += '6304';
  return s + pixCrc16(s);
}
