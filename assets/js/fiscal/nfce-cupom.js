/* ============ CUPOM DA NFC-e (DANFE NFC-e, t303) ============
   Montado a partir do XML autorizado (nfce_notas.xml), no leiaute do Manual do DANFE NFC-e:
   emitente, itens, totais, pagamento, chave/consulta, consumidor, número/protocolo, QR Code
   e tributos aproximados. Sai sempre em ESC/POS com o QR Code nativo da térmica (GS ( k);
   impressora USB precisa do agente 2.3 (manda os comandos "crus" para o driver). */
const NFCE_TPAG = { '01':'Dinheiro', '02':'Cheque', '03':'Cartao de Credito', '04':'Cartao de Debito', '05':'Credito Loja', '10':'Vale Alimentacao', '11':'Vale Refeicao', '15':'Boleto', '16':'Deposito', '17':'PIX', '18':'Transferencia', '90':'Sem pagamento', '99':'Outros' };
function nfceXmlText(doc, tag, parent){ const el = (parent||doc).getElementsByTagName(tag)[0]; return el ? String(el.textContent||'').trim() : ''; }
function nfceMoney(v){ return (Number(v)||0).toFixed(2).replace('.',','); }
function nfceAscii(s){ return stripAccentsForPrint(String(s||'')).replace(/[^\x20-\x7E]/g, c=>({'–':'-','—':'-','º':'o','ª':'a','°':'o'}[c]||'?')); }
// ESC/POS do QR Code (modelo 2, correção M). null quando o tamanho cairia no byte 0x01, que o
// agente troca por 0x00 (o banco não guarda byte nulo; ver NUL_PLACEHOLDER).
function escPosQr(data, moduleSize){
  const n = data.length + 3, pL = n % 256, pH = Math.floor(n / 256);
  if(pL===1 || pH===1 || /[\x00\x01]/.test(data) || n > 7092) return null;
  const Z = NUL_PLACEHOLDER, b = c=>String.fromCharCode(c);
  return '\x1D(k'+b(4)+Z+'1A2'+Z            // modelo 2
       + '\x1D(k'+b(3)+Z+'1C'+b(moduleSize||5) // tamanho do módulo
       + '\x1D(k'+b(3)+Z+'1E1'                // correção de erro M
       + '\x1D(k'+b(pL)+(pH?b(pH):Z)+'1P0'+data // guarda os dados
       + '\x1D(k'+b(3)+Z+'1Q0';               // imprime
}
// Devolve { text, problems }. cols: 48 (80 mm) ou 32 (58 mm).
function buildNfceDanfe(xmlText, cols){
  const W = cols || 48, problems = [];
  let doc;
  try{ doc = new DOMParser().parseFromString(String(xmlText||''), 'text/xml'); }catch(e){ doc = null; }
  if(!doc || doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('infNFe').length) return { text:'', problems:['O XML da NFC-e não pôde ser lido.'] };
  const x = (t,p)=>nfceXmlText(doc,t,p);
  const emit = doc.getElementsByTagName('emit')[0], ender = emit && emit.getElementsByTagName('enderEmit')[0];
  const ide = doc.getElementsByTagName('ide')[0], tot = doc.getElementsByTagName('ICMSTot')[0];
  const inf = doc.getElementsByTagName('infNFe')[0], chave = String(inf.getAttribute('Id')||'').replace(/^NFe/,'');
  const qr = x('qrCode'), urlChave = x('urlChave');
  const tpAmb = x('tpAmb', ide), tpEmis = x('tpEmis', ide);
  if(!qr) problems.push('O XML não tem o QR Code (infNFeSupl).');
  // Parâmetros em texto ('1'/'0' = 0x31/0x30, aceitos pelo ESC/POS): o byte 0x01 não serve,
  // porque o agente o troca por 0x00 (NUL_PLACEHOLDER) e o "ligar" viraria "desligar".
  const center = '\x1Ba1', left = '\x1Ba0', boldOn = '\x1BE1', boldOff = '\x1BE0';
  const small = '\x1BM1', normal = '\x1BM0'; // fonte B (menor) para itens e rodapé
  const WS = W>=48 ? 64 : 42; // colunas na fonte B (80 mm: 64; 58 mm: 42)
  const line = (c, w)=>c.repeat(w||W)+'\n';
  const wrap = (t, w)=>{ const out=[]; let cur=''; nfceAscii(t).split(/\s+/).forEach(word=>{ while(word.length>w){ if(cur){ out.push(cur); cur=''; } out.push(word.slice(0,w)); word=word.slice(w); } if((cur+' '+word).trim().length>w){ out.push(cur); cur=word; } else cur=(cur+' '+word).trim(); }); if(cur) out.push(cur); return out.join('\n')+'\n'; };
  const lr = (a, b, w)=>{ a=nfceAscii(a); b=nfceAscii(b); w=w||W; const space = Math.max(1, w-a.length-b.length); return (a+' '.repeat(space)+b).slice(0, Math.max(w, a.length+1+b.length))+'\n'; };
  const fmtDt = s=>{ const d = new Date(s); return isNaN(d) ? nfceAscii(s) : d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).replace(',',''); };
  const cnpj = x('CNPJ', emit).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
  let out = '\x1B@' + center;
  // I. Emitente
  out += boldOn + wrap(x('xNome', emit), W) + boldOff;
  out += wrap('CNPJ '+cnpj+'  IE '+x('IE', emit), W);
  if(ender) out += wrap([x('xLgr',ender)+', '+x('nro',ender), x('xBairro',ender), x('xMun',ender)+'/'+x('UF',ender)].filter(Boolean).join(' - '), W);
  out += small + wrap('Documento Auxiliar da Nota Fiscal de Consumidor Eletronica', WS) + normal;
  const homolog = boldOn + wrap('EMITIDA EM AMBIENTE DE HOMOLOGACAO', W) + 'SEM VALOR FISCAL\n' + boldOff;
  if(tpAmb==='2') out += homolog;
  if(tpEmis && tpEmis!=='1') out += boldOn + wrap('EMITIDA EM CONTINGENCIA', W) + boldOff + wrap('Pendente de autorizacao', W);
  out += left + line('-');
  // II. Itens
  out += small + lr('CODIGO DESCRICAO', 'QTD UN  VL UNIT  VL TOTAL', WS);
  const dets = Array.from(doc.getElementsByTagName('det'));
  dets.forEach(d=>{
    const p = d.getElementsByTagName('prod')[0];
    out += wrap(x('cProd',p)+' '+x('xProd',p), WS);
    const q = Number(x('qCom',p))||0, qtxt = Number.isInteger(q) ? String(q) : q.toFixed(3).replace('.',',');
    out += lr('', qtxt+' '+x('uCom',p)+' x '+nfceMoney(x('vUnCom',p))+' = '+nfceMoney(x('vProd',p)), WS);
  });
  out += normal + line('-');
  // III. Totais e pagamento
  const vDesc = Number(x('vDesc', tot))||0, vOutro = Number(x('vOutro', tot))||0;
  out += lr('Qtd. total de itens', String(dets.length));
  out += lr('Valor total R$', nfceMoney(x('vProd', tot)));
  if(vDesc) out += lr('Desconto R$', '-'+nfceMoney(vDesc));
  if(vOutro) out += lr('Acrescimos R$', nfceMoney(vOutro));
  out += boldOn + lr('Valor a pagar R$', nfceMoney(x('vNF', tot))) + boldOff;
  out += lr('FORMA DE PAGAMENTO', 'VALOR PAGO R$');
  Array.from(doc.getElementsByTagName('detPag')).forEach(dp=>{ const t = x('tPag', dp); out += lr(NFCE_TPAG[t] || (x('xPag', dp)||'Outros'), nfceMoney(x('vPag', dp))); });
  const troco = Number(x('vTroco'))||0;
  if(troco) out += lr('Troco R$', nfceMoney(troco));
  out += line('-');
  // IV. Consulta pela chave
  out += center + small + wrap('Consulte pela Chave de Acesso em', WS) + wrap(urlChave || 'www.fazenda.pr.gov.br/nfce/consulta', WS);
  out += (chave.match(/.{1,4}/g)||[]).join(' ') + '\n' + normal;
  // V. Consumidor
  const dest = doc.getElementsByTagName('dest')[0], cpf = dest ? (x('CPF',dest)||x('CNPJ',dest)) : '';
  out += line('-') + (cpf ? wrap('CONSUMIDOR - '+(cpf.length===11?'CPF ':'CNPJ ')+cpf+(x('xNome',dest)?' - '+x('xNome',dest):''), W) : 'CONSUMIDOR NAO IDENTIFICADO\n');
  // VI. Identificação e protocolo
  out += line('-') + boldOn + wrap('NFC-e n '+String(x('nNF', ide)).padStart(9,'0')+' Serie '+String(x('serie', ide)).padStart(3,'0')+' '+fmtDt(x('dhEmi', ide)), W) + boldOff;
  const nProt = x('nProt');
  if(nProt) out += small + wrap('Protocolo de autorizacao: '+nProt, WS) + wrap('Data de autorizacao: '+fmtDt(x('dhRecbto')), WS) + normal;
  if(tpAmb==='2') out += center + homolog;
  // VII. QR Code
  const qrCmd = qr ? escPosQr(qr, W>=48 ? 5 : 4) : null;
  if(qr && !qrCmd) problems.push('O QR Code ficou num tamanho que a impressora não recebe; foi impresso só o endereço.');
  out += '\n' + (qrCmd || small + wrap(qr, WS) + normal) + '\n';
  // VIII. Tributos aproximados (Lei 12.741/2012)
  const vTrib = Number(x('vTotTrib', tot))||0;
  out += small + wrap('Tributos Totais Incidentes (Lei Federal 12.741/2012): R$ '+nfceMoney(vTrib), WS) + normal;
  const infCpl = x('infCpl');
  if(infCpl) out += small + wrap(infCpl, WS) + normal;
  out += left + '\n\n\n\x1DV1'; // corte parcial ('1' = 0x31)
  return { text: out, problems };
}
async function printNfceDanfe(notaId){
  if(!supabaseClient) return;
  const imp = receiptPrinterFor(currentUser);
  if(!imp){ toast('Escolha a impressora do "Comprovante do caixa" em Configurações › Impressoras.'); return; }
  const { data, error } = await supabaseClient.from('nfce_notas').select('xml, numero').eq('id', notaId).maybeSingle();
  if(error || !data || !data.xml){ toast('Não encontrei o XML desta NFC-e para imprimir.'); return; }
  const { text, problems } = buildNfceDanfe(data.xml, paperColumns(imp));
  if(!text){ toast(problems[0] || 'Não foi possível montar o cupom.'); return; }
  const job = { tenant_id: getTenantId(), printer_name: imp.osName || imp.nome, printer_ip: imp.ip||null, content: text, status: 'pendente' };
  if(imp.agentId) job.agent_id = imp.agentId;
  let { error: e2 } = await supabaseClient.from('print_jobs').insert(job);
  if(e2 && job.agent_id){ delete job.agent_id; ({ error: e2 } = await supabaseClient.from('print_jobs').insert(job)); }
  if(e2){ toast('Não foi possível mandar o cupom para a fila de impressão.'); return; }
  toast('Cupom da NFC-e nº '+(data.numero||'')+' enviado para '+(imp.nome||imp.osName)+'.'+(problems.length?' '+problems[0]:''));
}
