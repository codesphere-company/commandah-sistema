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
async function printSingleTicket(who, cota, local, estacao, printer, items, orderNumber){
  // Computador de caixa: tudo que for lançado aqui sai na impressora dele (ver deviceCaixaPrinter).
  // Exceção (12/10): estações com preparo (padrão: Cozinha) mandam a ficha para a impressora delas,
  // não para a do caixa; o resto (bebida, lanche pronto, sem preparo) sai no caixa para o cliente retirar.
  const devicePrinter = deviceCaixaPrinter();
  if(devicePrinter && !(caixaKeepsStation(devicePrinter, estacao) && printer)) printer = devicePrinter.nome;
  if(printer){
    const imp = state.impressoras.find(p=>p.nome===printer);
    const targetName = imp&&imp.osName ? imp.osName : printer;
    const useEscPos = !!(imp && imp.ip);
    const text = buildTicketText(who, cota, local, estacao, items, orderNumber, paperColumns(imp), useEscPos);
    if(supabaseClient && getTenantId()){
      try{
        // agent_id: impressora USB escolhida na configuração automática vai para o computador dela.
        const job = { tenant_id: getTenantId(), printer_name: targetName, printer_ip: imp&&imp.ip||null, content: text, status: 'pendente' };
        if(imp && imp.agentId) job.agent_id = imp.agentId;
        let { error } = await supabaseClient.from('print_jobs').insert(job);
        // Computador removido (ou banco sem a coluna): manda sem computador definido, como antes.
        if(error && job.agent_id){ delete job.agent_id; ({ error } = await supabaseClient.from('print_jobs').insert(job)); }
        if(!error){ toast('Pedido enviado pra fila de impressão: '+printer); return; }
      }catch(e){ /* cai pro modo antigo abaixo */ }
    }
    const base = printerAgentBase(imp);
    try{
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 4000);
      const res = await fetch(base+'/print', {
        method:'POST', signal:ctrl.signal,
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ printer: targetName, text, ip: imp&&imp.ip||'' }) // agente 2.0: impressora de rede pelo IP
      });
      clearTimeout(t);
      if(res.ok){ toast('Impresso automaticamente: '+printer); return; }
    }catch(e){ /* agente indisponível — cai no modo com caixa de diálogo abaixo */ }
  }
  // OP-19: nada de janela automática (no celular do garçom ela é bloqueada e a ficha
  // sumia). O pedido fica num aviso vermelho fixo até alguém imprimir aqui ou resolver.
  notePrintFailure({ who, cota, local, estacao, printer, items, orderNumber, at:new Date().toISOString() });
}
/* OP-19 (decisão do dono): ficha que não foi para a impressora vira um aviso vermelho e
   fixo, em vez da janela de impressão do navegador. "Imprimir aqui" abre todas as fichas
   pendentes numa janela só (é um toque do operador, o navegador não bloqueia). Estação
   que também tem tela (Monitor de Cozinha) e não tem impressora só avisa: o pedido está
   na tela. */
let failedPrintTickets = [];
function notePrintFailure(t){
  if(!t.printer && saidaTemTela(t.estacao)){ toast('Sem impressora para '+(estacaoLabel(t.estacao)||t.estacao)+': o pedido está só no Monitor de Cozinha.'); return; }
  failedPrintTickets.push(t);
  renderPrintFailBanner();
}
function renderPrintFailBanner(){
  const root = document.getElementById('localModeRoot'); if(!root) return;
  let el = root.querySelector('.print-fail');
  if(!failedPrintTickets.length){ if(el){ el.remove(); applyTopBannerOffset(); } return; }
  if(!el){
    el = document.createElement('div');
    el.className = 'local-mode print-stuck print-fail';
    el.setAttribute('role','alert');
    el.innerHTML = '<div class="local-mode-ico" aria-hidden="true">&#128424;</div><div class="local-mode-txt"><span class="local-mode-title"></span><span class="local-mode-sub"></span></div>'
      + '<div class="print-fail-actions"><button type="button" class="local-mode-btn" data-a="print">Imprimir aqui</button><button type="button" class="local-mode-btn print-fail-done" data-a="done">Já resolvi</button></div>';
    el.querySelector('[data-a="print"]').addEventListener('click', printFailedTicketsHere);
    el.querySelector('[data-a="done"]').addEventListener('click', ()=>{ logAction('Aviso de ficha não impressa dispensado ('+failedPrintTickets.length+' ficha(s))'); failedPrintTickets = []; renderPrintFailBanner(); });
    root.appendChild(el);
  }
  const last = failedPrintTickets[failedPrintTickets.length-1], est = estacaoLabel(last.estacao)||last.estacao;
  const n = failedPrintTickets.length;
  el.querySelector('.local-mode-title').textContent = last.printer
    ? (n===1 ? 'Ficha de '+est+' não foi para a impressora' : n+' fichas não foram para a impressora')
    : (n===1 ? 'Estação '+est+' sem impressora: item não impresso' : n+' fichas sem impressora: itens não impressos');
  const resumo = failedPrintTickets.slice(-3).map(t=>(t.orderNumber?'#'+t.orderNumber+' ':'')+(t.who||'')+' ('+(estacaoLabel(t.estacao)||t.estacao)+')').join(' · ');
  el.querySelector('.local-mode-sub').textContent = resumo + '. Toque em "Imprimir aqui" para sair na impressora deste aparelho, ou leve o pedido até a estação.'
    + (last.printer ? ' Confira se o agente de impressão está aberto no computador.' : ' Cadastre a impressora em Configurações › Impressoras.');
  applyTopBannerOffset();
}
function ticketPopupHtml(t){
  const { who, cota, local, estacao, printer, items, orderNumber } = t;
  const total = items.reduce((a,i)=>a+i.price*i.qty,0);
  return `<section class="ticket">
    <div class="estacao">${h((estacaoLabel(estacao)||estacao).toUpperCase())}</div>
    <h1>Pedido ${orderNumber?'#'+orderNumber:''}</h1>
    <div class="muted">${dataHoraBR(t.at||Date.now())}</div>
    <div><b>Solicitante:</b> ${h(who)}</div>
    ${cota?`<div><b>Cota:</b> ${h(cota)}</div>`:''}
    ${local?`<div class="local">ENTREGAR EM: ${h(local)}</div>`:''}
    <table>${items.map(i=>`<tr><td>${i.qty}x ${h(i.name)}${i.copos!=null?' — <b>'+i.copos+' copo'+(i.copos===1?'':'s')+'</b>':''}</td><td style="text-align:right">${fmt(i.price*i.qty)}</td></tr>`).join('')}</table>
    <div class="total">Total: ${fmt(total)}</div>
    ${printer?`<div class="printer">Imprimir na: <b>${h(printer)}</b> (não recebeu a ficha; impressa neste aparelho)</div>`:`<div class="warn">Nenhuma impressora configurada para ${h(estacaoLabel(estacao)||estacao)} nesta origem — encaminhar manualmente.</div>`}
  </section>`;
}
function printFailedTicketsHere(){
  const list = failedPrintTickets.slice();
  if(!list.length) return;
  const win = window.open('', '_blank', 'width=380,height=600');
  if(!win){ toast('O navegador bloqueou a janela de impressão. Libere as janelas deste site e toque de novo.', 'error'); return; }
  win.document.write(`<html><head><title>Fichas não impressas</title><style>
    body{font-family:Arial,sans-serif;padding:16px;font-size:13px;color:#111}
    h1{font-size:16px;margin:0 0 4px}
    .muted{color:#666;font-size:11px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    td{padding:4px 0;border-bottom:1px dashed #ccc}
    .total{font-weight:bold;font-size:15px;margin-top:12px;text-align:right}
    .local{background:none;color:#000;border:2px solid #000;padding:6px 10px;font-weight:bold;font-size:16px;margin:8px 0}
    .estacao{background:none;color:#000;border:2px solid #000;padding:6px 10px;font-weight:bold;font-size:16px;margin:8px 0 4px}
    .printer{color:#666;font-size:11px;margin-top:8px}
    .warn{color:#c1443c;font-size:11px;margin-top:8px;font-weight:bold}
    .ticket{page-break-after:always;break-after:page}
    .ticket:last-child{page-break-after:auto;break-after:auto}
  </style></head><body>${list.map(ticketPopupHtml).join('')}</body></html>`);
  win.document.close(); win.focus();
  setTimeout(()=>{ win.print(); }, 300);
  failedPrintTickets = failedPrintTickets.filter(t=>!list.includes(t));
  logAction(list.length+' ficha(s) não impressa(s) enviada(s) para impressão neste aparelho');
  renderPrintFailBanner();
}

function toggleComandaLock(saleId,locked){const s=state.sales.find(x=>x.id===saleId);if(!s)return;s.locked=locked;save('sales');logAction((locked?'Pedido bloqueado':'Pedido desbloqueado')+': '+saleId);openComanda(saleId,true);}
function openComandaLinkClient(saleId){const s=state.sales.find(x=>x.id===saleId);if(!s)return;const current=s.memberId?state.members.find(x=>x.id===s.memberId):null;const options=state.members.map(m=>`<option value="${m.id}" ${current&&current.id===m.id?'selected':''}>${m.code?h(m.code)+' — ':''}${h(m.name)}</option>`).join('');openModal(current?'Trocar Cliente':'Vincular Cliente',`<div class="field"><label>Associado</label><select id="linkMemberSelect"><option value="">— Selecione —</option>${options}</select></div><button class="btn btn-primary btn-block" id="linkMemberSaveBtn">${current?'Trocar':'Vincular'}</button>`);document.getElementById('linkMemberSaveBtn').onclick=()=>{const mid=document.getElementById('linkMemberSelect').value;if(!mid){toast('Selecione um associado.');return;}s.memberId=mid;save('sales');closeModal();openComanda(saleId,true);};}
function comandaItemBatchKey(item,idx){ return item.batchId || ('legacy-'+idx); }
// Hora curta: só "21:46" quando é de hoje; "21/09 21:46" quando é de outro dia.
function comandaShortTime(iso){
  if(!iso) return '—';
  const d = new Date(iso); if(isNaN(d)) return '—';
  const t = d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  return localDay(d)===todayStr() ? t : d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' '+t;
}
function comandaLevouSelect(item,idx){
  return `<select class="comanda-levou" aria-label="Quem levou" onchange="setComandaItemDeliveredBy(${idx},this.value)"><option value="">Quem levou?</option>${state.quemLevou.map(p=>`<option value="${h(p.nome)}" ${item.deliveredBy===p.nome?'selected':''}>${h(p.nome)}</option>`).join('')}${item.deliveredBy&&!state.quemLevou.some(p=>p.nome===item.deliveredBy)?`<option value="${h(item.deliveredBy)}" selected>${h(item.deliveredBy)} (não cadastrado)</option>`:''}</select>`;
}
/* Histórico da comanda em 5 colunas (antes eram 10 num espaço de ~650px: "Qtd." e
   "Valor Unit." quebravam letra por letra e Situação/Ações ficavam fora da tela).
   Lançado = hora + quem lançou; Produto = nome + "2× R$ 6,00 · para Fulano";
   Entrega = local + quem levou; Situação = etiqueta + ações lado a lado. */
function renderComandaAuditItemRow(item,idx,locked){
  const qty = Number(item.qty)||0, price = Number(item.price)||0;
  const requester = item.requesterName||currentSaleDraft.customerName||'Não registrado';
  const status = item.canceled?'<span class="tag tag-red">Cancelado</span>':item.sent?'<span class="tag tag-blue">Enviado</span>':'<span class="tag tag-amber">Novo</span>';
  const actions = item.canceled||!item.sent ? '' :
    `<button class="btn btn-sm cmd-act" title="Reimprimir a ficha deste item" onclick="reprintComandaItem(${idx})">${ICN.printer}<span>Reimprimir</span></button>`+
    `<button class="btn btn-sm cmd-act" title="Pedir este item de novo" onclick="openReorderComandaItem(${idx})">${ICN.history}<span>Repetir</span></button>`+
    (hasPerm('cancelar-comanda')?`<button class="btn btn-sm cmd-act cmd-act-danger" title="Cancelar este item" ${locked?'disabled':''} onclick="openCancelComandaItem(${idx})">${ICN.trash}<span>Cancelar</span></button>`:'');
  const qtyCtrl = item.sent ? '' : `<div class="qty-ctrl"><button onclick="changeDraftQty(${idx},-1)" aria-label="Diminuir">−</button><span class="mono">${qty}</span><button onclick="changeDraftQty(${idx},1)" aria-label="Aumentar">+</button></div>`;
  return `<tr class="cmd-row${item.canceled?' is-canceled':''}">
    <td class="cmd-when"><b>${comandaShortTime(item.addedAt)}</b><small>${h(item.addedBy||'Registro anterior')}</small></td>
    <td class="cmd-prod"><b>${item.canceled?'<s>'+h(item.name)+'</s>':h(item.name)}</b><small>${qty}× ${fmt(price)} · para ${h(requester)}</small>${item.notes?`<small class="cmd-note">Obs.: ${h(item.notes)}</small>`:''}${item.levarJunto?'<small class="cmd-junto">Segurar: levar junto com a comida</small>':''}${item.levarJuntoCom?`<small class="cmd-junto">Levar junto: ${h(item.levarJuntoCom)}</small>`:''}${item.canceled&&item.canceledReason?`<small class="cmd-cancel">Motivo: ${h(item.canceledReason)}</small>`:''}${qtyCtrl}</td>
    <td class="mono cmd-total">${fmt(qty*price)}</td>
    <td class="cmd-entrega"><small>${h(item.local||'Sem local')}</small>${item.sent&&!item.canceled?comandaLevouSelect(item,idx):''}</td>
    <td class="cmd-status">${status}${actions?`<div class="cmd-actions">${actions}</div>`:''}</td>
  </tr>`;
}
function renderComandaAuditGroupRow(rows,locked,groupNum){
  const key = comandaItemBatchKey(rows[0].item, rows[0].idx);
  const expanded = comandaAuditExpanded.has(key);
  const activeRows = rows.filter(r=>!r.item.canceled);
  const activeQty = activeRows.reduce((a,r)=>a+(Number(r.item.qty)||0),0);
  const activeValue = activeRows.reduce((a,r)=>a+(Number(r.item.price)||0)*(Number(r.item.qty)||0),0);
  const requesterNames = [...new Set(rows.map(r=>r.item.requesterName||currentSaleDraft.customerName||'Não registrado'))];
  const requesterLabel = requesterNames.length===1 ? h(requesterNames[0]) : 'várias pessoas';
  const allCanceled = rows.every(r=>r.item.canceled);
  const allSent = rows.every(r=>r.item.sent);
  const noneSent = rows.every(r=>!r.item.sent);
  const situacaoTag = allCanceled ? '<span class="tag tag-red">Cancelado</span>'
    : allSent ? '<span class="tag tag-blue">Enviado</span>'
    : noneSent ? '<span class="tag tag-amber">Novo</span>'
    : '<span class="tag tag-amber">Parcial</span>';
  const hasSentActive = rows.some(r=>r.item.sent && !r.item.canceled);
  const headerRow = `<tr class="comanda-audit-group-row cmd-row cmd-group" onclick="toggleComandaAuditGroup(${jsArg(key)})" title="${expanded?'Esconder':'Ver'} os itens deste pedido">
    <td class="cmd-when"><b>${comandaShortTime(rows[0].item.addedAt)}</b><small>${h(rows[0].item.addedBy||'Registro anterior')}</small></td>
    <td class="cmd-prod"><b><span class="cmd-caret${expanded?' open':''}">▸</span> Pedido ${groupNum} · ${rows.length} ${rows.length===1?'item':'itens'}</b><small>${activeQty} un. · para ${requesterLabel} · toque para ${expanded?'esconder':'ver'} os itens</small></td>
    <td class="mono cmd-total">${fmt(activeValue)}</td>
    <td class="cmd-entrega"><small>${h(rows[0].item.local||'Sem local')}</small></td>
    <td class="cmd-status">${situacaoTag}${hasSentActive?`<div class="cmd-actions"><button class="btn btn-sm cmd-act" title="Pedir todos os itens deste pedido de novo" onclick="event.stopPropagation();openReorderComandaBatch(${jsArg(key)})">${ICN.history}<span>Repetir tudo</span></button></div>`:''}</td>
  </tr>`;
  const itemRows = expanded ? rows.map(r=>renderComandaAuditItemRow(r.item,r.idx,locked)).join('') : '';
  return headerRow + itemRows;
}
let comandaAuditExpanded = new Set();
function toggleComandaAuditGroup(key){
  if(comandaAuditExpanded.has(key)) comandaAuditExpanded.delete(key); else comandaAuditExpanded.add(key);
  renderComandaAuditHistory();
}
function renderComandaAuditHistory(){
  const body=document.getElementById('comandaAuditRows'); if(!body||!currentSaleDraft) return;
  const items=currentSaleDraft.items||[];
  const sale=currentSaleDraft.id?state.sales.find(x=>x.id===currentSaleDraft.id):null;
  const locked=!!(sale&&sale.locked);
  if(!items.length){ body.innerHTML = '<tr><td colspan="5" class="empty">Nenhum item lançado nesta comanda.</td></tr>'; return; }
  const groups = new Map();
  items.forEach((item,idx)=>{
    const key = comandaItemBatchKey(item,idx);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({item,idx});
  });
  let groupNum = 0;
  body.innerHTML = [...groups.values()].map(rows=>{
    if(rows.length===1) return renderComandaAuditItemRow(rows[0].item,rows[0].idx,locked);
    groupNum++;
    return renderComandaAuditGroupRow(rows,locked,groupNum);
  }).join('');
}
function setComandaItemDeliveredBy(idx,value){
  const item=(currentSaleDraft&&currentSaleDraft.items||[])[idx]; if(!item) return;
  item.deliveredBy=String(value||'').trim();
  if(currentSaleDraft.type==='comanda' && currentSaleDraft.id){
    const s=state.sales.find(x=>x.id===currentSaleDraft.id);
    if(s){ const draftItems=currentSaleDraft.items; commitSaleChange(s.id, cur=>{ cur.items=mergeDraftItems(cur.items, draftItems).items; }); }
  }
}
let reorderQty = 1, reorderItemIdx = null, reorderCopos = 0;
function openReorderComandaItem(idx){
  const item = (currentSaleDraft&&currentSaleDraft.items||[])[idx]; if(!item) return;
  const product = state.products.find(p=>p.id===item.productId);
  if(!product || product.active===false){ toast('Este produto não está mais disponível no catálogo.'); return; }
  reorderQty = 1; reorderItemIdx = idx; reorderCopos = productAsksCopos(product) ? (item.copos!=null?item.copos:0) : 0;
  openModal('Pedir novamente', `
    <p class="sub">${h(product.name)} · <span class="mono">${fmt(product.price)}</span></p>
    <div class="field" style="text-align:center">
      <label class="np-label">Quantidade</label>
      <div class="qty-ctrl" style="justify-content:center;margin-top:6px">
        <button onclick="reorderQtyChange(-1)">−</button>
        <span class="mono" id="reorderQtyLabel" style="min-width:28px;display:inline-block;text-align:center">1</span>
        <button onclick="reorderQtyChange(1)">+</button>
      </div>
    </div>
    ${productAsksCopos(product)?`<div class="field" style="text-align:center">
      <label class="np-label">Quantidade de copos</label>
      <div class="qty-ctrl" style="justify-content:center;margin-top:6px">
        <button onclick="reorderCoposChange(-1)">−</button>
        <span class="mono" id="reorderCoposLabel" style="min-width:28px;display:inline-block;text-align:center">${reorderCopos}</span>
        <button onclick="reorderCoposChange(1)">+</button>
      </div>
    </div>`:''}
    <div class="row">
      <button class="btn" onclick="openComanda(${jsArg(currentSaleDraft.id)},true)">Cancelar</button>
      <button class="btn btn-primary" id="reorderConfirmBtn">Adicionar e enviar pra cozinha</button>
    </div>
  `);
  document.getElementById('reorderConfirmBtn').onclick = confirmReorderComandaItem;
}
function reorderQtyChange(delta){
  reorderQty = Math.max(1, reorderQty+delta);
  const el = document.getElementById('reorderQtyLabel'); if(el) el.textContent = reorderQty;
}
function reorderCoposChange(delta){
  reorderCopos = Math.max(0, reorderCopos+delta);
  const el = document.getElementById('reorderCoposLabel'); if(el) el.textContent = reorderCopos;
}
async function confirmReorderComandaItem(){
  const saleId = currentSaleDraft&&currentSaleDraft.id; if(!saleId) return;
  const item = (currentSaleDraft.items||[])[reorderItemIdx]; if(!item) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(!comandaAcceptsOrders(s)) return;
  const product = state.products.find(p=>p.id===item.productId);
  if(!product || product.active===false){ toast('Este produto não está mais disponível no catálogo.'); return; }
  const who = item.requesterName || s.customerName || 'Cliente';
  const newItem = {lineId:uid(), productId:product.id, name:product.name, price:product.price, qty:reorderQty, estacao:product.estacao||'cozinha', copos:productAsksCopos(product)?reorderCopos:undefined, sent:false, addedAt:new Date().toISOString(), addedBy:currentUser.name, local:s.local||'', requesterId:item.requesterId, requesterName:item.requesterName, requesterType:item.requesterType};
  if(!await sendItemsToKitchen(saleId, [newItem], who, 'comanda', s.local)) return;
  newItem.sent = true;
  await commitSaleChange(s.id, cur=>{ cur.items=[...(cur.items||[]), newItem]; cur.total=saleTotal(cur.items); });
  if(saidaTemImpressao(newItem.estacao)){
    const origem = currentUser.origem||'caixa';
    const printer = resolvePrinterFor(newItem.estacao, origem);
    const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
    printSingleTicket(who, member?member.code:'', s.local||'', newItem.estacao, printer?printer.nome:null, [newItem], s.orderNumber);
  }
  logAction('Pedido repetido do histórico: '+product.name+' x'+reorderQty+' para '+who+' — pedido #'+(s.orderNumber||saleId));
  toast('Adicionado e enviado para a cozinha.');
  reorderItemIdx = null;
  closeModal(); openComanda(saleId, true); renderComandas();
}
// Reabrir comanda fechada (decisão do dono, 10/10): só administrador, com a própria senha e
// motivo. O banco (sale_reopen) volta a venda para aberta e libera o recibo do close_sale; aqui
// os pagamentos são desfeitos: o fiado e o crédito daquela venda são estornados e, se ela foi
// paga num caixa anterior, o valor sai do caixa de agora (fechada no caixa de agora, os
// pagamentos já deixam de contar quando ela reabre). Depois edita, transfere ou cancela como
// qualquer comanda aberta.
function canReopenSale(s){ return !!s && s.type==='comanda' && s.status==='closed' && !s.canceled; }
async function openReopenComanda(saleId){
  const s=state.sales.find(x=>x.id===saleId); if(!s) return;
  if(!(currentUser && (currentUser.role==='admin' || sessionIsOwner))){ toast('Só o administrador reabre comanda fechada.'); return; }
  if(!canReopenSale(s)){ toast('Só comanda fechada (e não cancelada) pode ser reaberta.'); return; }
  const paid=(s.payments||[]).filter(p=>!p.partial&&methodBucket(p.method)!=='fiado'&&(Number(p.amount)||0)>TOLERANCIA_CENTAVO);
  const fiado=(s.payments||[]).filter(p=>methodBucket(p.method)==='fiado');
  const sameSession=!!(state.cashSession&&s.closedAt&&new Date(s.closedAt)>=new Date(state.cashSession.openedAt));
  if(paid.length && !state.cashSession){ toast('Abra o caixa para reabrir: o valor pago volta a sair do caixa.'); return; }
  const other=s.memberId&&state.sales.find(x=>x.status==='open'&&!x.canceled&&x.memberId===s.memberId&&x.id!==s.id);
  if(other){ toast('Este sócio já tem outra comanda aberta (#'+(other.orderNumber||'—')+'). Feche ou transfira antes de reabrir esta.'); return; }
  const lines=[];
  if(paid.length) lines.push(sameSession?'Os pagamentos ('+paid.map(p=>paymentMethodLabel(p.method)+' '+fmt(p.amount)).join(', ')+') deixam de contar neste caixa.':'Sai do caixa de agora: '+paid.map(p=>paymentMethodLabel(p.method)+' '+fmt(p.amount)).join(', ')+'.');
  if(fiado.length || Number(s.creditApplied)>TOLERANCIA_CENTAVO) lines.push('O fiado/crédito desta venda no extrato do sócio é estornado.');
  // t303: NFC-e autorizada. Dentro do prazo é cancelada junto; fora do prazo não dá para reabrir.
  const nota = await nfceAutorizadaDaComanda(saleId);
  if(nota){
    const mins = nfceMinutesSince(nota.created_at);
    if(mins >= NFCE_CANCEL_MIN){ toast('Esta comanda tem a NFC-e nº '+nota.numero+' autorizada há '+mins+' min. Passou o prazo de 30 minutos para cancelar: fale com o contador (nota de devolução) antes de reabrir.', 'erro'); return; }
    lines.unshift('A NFC-e nº '+nota.numero+(nota.ambiente===2?' (teste)':'')+' será cancelada junto (faltam '+(NFCE_CANCEL_MIN-mins)+' min do prazo).');
  }
  lines.push('Depois é só editar, transferir ou cancelar e fechar de novo.');
  askStaffPin({
    title:'Reabrir pedido #'+(s.orderNumber||'—')+' · '+(s.customerName||'Avulso'),
    message:'Fechado em '+reportDateTime(s.closedAt)+', total '+fmt(s.total)+'. '+lines.join(' '),
    extraHtml:`<div class="field"><label>Motivo *</label><input id="reopenReason" maxlength="200" placeholder="Ex.: item lançado errado, cobrança errada..."></div>`,
    focusId:'reopenReason', whoLabel:'Quem está alterando', staff:[currentUser], lockWho:true, confirmLabel:'Reabrir comanda',
    onCancel:()=>{ closeModal(); openOrderHistoryDetail(saleId); },
    onSubmit: async (staffId, pin)=>{
      const reason=(document.getElementById('reopenReason').value||'').trim();
      if(reason.length<3) return 'Informe o motivo.';
      if(isCloudMode()){
        const r=await staffAuthCall({action:'verify', staff_id:currentUser.id, pin});
        if(r.error) return r.error;
        if(r.data.staff_id!==currentUser.id) return 'Senha de outro colaborador.';
      } else if(String(currentUser.pin||'')!==String(pin)) return 'PIN incorreto.';
      if(nota){
        const just = ('Comanda reaberta para correcao: '+reason).slice(0, 255);
        const c = await nfceCall('cancelar', saleId, { justificativa: just });
        if(c.error) return 'A comanda não foi reaberta porque a NFC-e não pôde ser cancelada: '+c.error;
        logAction('NFC-e nº '+nota.numero+' cancelada ao reabrir o pedido '+(s.orderNumber||saleId));
      }
      return await reopenClosedComanda(saleId, reason, sameSession);
    }
  });
}
async function reopenClosedComanda(saleId, reason, sameSession){
  const s=state.sales.find(x=>x.id===saleId); if(!canReopenSale(s)) return 'Esta comanda não está mais fechada.';
  const before=JSON.parse(JSON.stringify(s)), total=saleTotal(s.items);
  if(isCloudMode()){
    const {data, error}=await supabaseClient.rpc('sale_reopen',{ p_sale_id:saleId, p_total:total, p_meta:{ by:currentUser.name, reason } });
    if(error||!data) return 'Não foi possível reabrir: '+((error&&error.message)||'erro no servidor');
    const idx=state.sales.findIndex(x=>x.id===saleId); if(idx>-1) state.sales[idx]=data; else state.sales.push(data);
    markSaleServer(data);
    logEntryLocal('Comanda reaberta — pedido #'+(before.orderNumber||saleId)+' — motivo: '+reason);
  } else {
    const entry={at:new Date().toISOString(), by:currentUser.name, reason, closedAt:before.closedAt, payments:before.payments||[], total:before.total};
    ['closedAt','creditApplied','couponCode','discount','serviceCharge','partialPaid'].forEach(k=>delete s[k]);
    Object.assign(s,{status:'open', payments:[], total, reopenHistory:[...(s.reopenHistory||[]), entry]});
    await save('sales');
    logAction('Comanda reaberta — pedido #'+(before.orderNumber||saleId)+' — motivo: '+reason);
  }
  // Desfaz o dinheiro. A venda já está reaberta no servidor: falha daqui em diante só avisa.
  const done=[];
  try{
    if(before.memberId){
      let m=state.members.find(x=>x.id===before.memberId);
      try{ m=await MembersStore.refreshOne(before.memberId)||m; }catch(e){}
      const tag='#'+saleId;
      const entries=m?(m.debtHistory||[]).filter(e=>!e.reversed&&(e.saleId===saleId||String(e.reason||'').endsWith(tag))):[];
      for(const e of entries){ await MembersStore.reverseDebtEntry(m.id, e.id, currentUser.name); done.push((e.type==='debt'?'fiado ':'crédito ')+fmt(e.value)+' estornado'); }
    }
    const num='#'+(before.orderNumber||saleId);
    if(!sameSession && state.cashSession){
      // Troco de excedente em Pix/cartão devolvido em dinheiro (OP-02): a venda guarda o líquido em
      // amount e o troco em change. Desfazer = devolver o que entrou naquela forma (received) e o
      // dinheiro do troco volta para a gaveta.
      const mv=(type,amount,method,description,origin)=>state.cashMovements.unshift({id:uid(), cashSessionId:state.cashSession.id, type, amount:arredondaCentavos(Number(amount)), reason:description, description, method, note:reason, origin, saleId, operatorId:currentUser.id, operatorName:currentUser.name, at:new Date().toISOString()});
      (before.payments||[]).filter(p=>!p.partial&&methodBucket(p.method)!=='fiado'&&(Number(p.amount)||0)>TOLERANCIA_CENTAVO).forEach(p=>{
        const change=p.method!=='dinheiro'?Number(p.change)||0:0, out=(Number(p.amount)||0)+change;
        mv('sangria', out, p.method, 'Estorno — reabertura do pedido '+num+' ('+paymentMethodLabel(p.method)+')', 'reabertura');
        done.push(paymentMethodLabel(p.method)+' '+fmt(out)+' saiu do caixa');
        if(change>TOLERANCIA_CENTAVO){ mv('suprimento', change, 'dinheiro', 'Troco devolvido — reabertura do pedido '+num, 'reabertura'); done.push('troco de '+fmt(change)+' volta para a gaveta'); }
      });
      await save('cashMovements');
    } else if(sameSession){
      // Fechada no caixa de agora: os pagamentos já deixam de contar; o troco lançado para ela sai também.
      const trocos=state.cashMovements.filter(m=>m.origin==='troco'&&m.saleId===saleId&&m.cashSessionId===(state.cashSession&&state.cashSession.id));
      if(trocos.length){ state.cashMovements=state.cashMovements.filter(m=>!trocos.includes(m)); await save('cashMovements'); done.push('troco de '+fmt(trocos.reduce((a,m)=>a+(Number(m.amount)||0),0))+' desfeito'); }
    }
    // Pontos de fidelidade dados por esta venda: estorna, para não somar de novo ao fechar outra vez.
    if(before.memberId){
      const m=state.members.find(x=>x.id===before.memberId), hist=m&&Array.isArray(m.pointsHistory)?m.pointsHistory:[];
      const given=hist.filter(e=>e.type==='credit'&&e.saleId===saleId&&!e.reversed);
      const pts=given.reduce((a,e)=>a+(Number(e.points)||0),0);
      if(m && pts>0){
        given.forEach(e=>{ e.reversed=true; });
        hist.unshift({id:uid(), type:'redeem', points:pts, reason:'Estorno — reabertura do pedido '+num, saleId, at:new Date().toISOString(), user:currentUser.name});
        await MembersStore.setPoints(m.id, Math.max(0,(Number(m.points)||0)-pts), hist);
        done.push(pts+' ponto'+(pts===1?'':'s')+' estornado'+(pts===1?'':'s'));
      }
    }
  }catch(e){
    console.error('Reabertura: falha ao desfazer pagamentos', saleId, e);
    logAction('ATENÇÃO: pedido #'+(before.orderNumber||saleId)+' reaberto, mas o estorno do fiado/caixa falhou — conferir extrato do sócio e caixa.');
    setTimeout(()=>toast('Comanda reaberta, mas o estorno do fiado/caixa falhou. Confira o extrato do sócio e o caixa.','error'),300);
  }
  if(done.length) logAction('Reabertura do pedido #'+(before.orderNumber||saleId)+': '+done.join('; '));
  closeModal(); renderAll();
  toast('Comanda reaberta.'+(done.length?' '+done.join('; ')+'.':''));
  openComanda(saleId, true);
}
let cancelItemIdx = null;
function openCancelComandaItem(idx){
  if(!requirePerm('cancelar-comanda')) return;
  const saleId = currentSaleDraft&&currentSaleDraft.id; if(!saleId) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(s.locked){ toast('Este pedido está bloqueado. Desbloqueie antes de cancelar um item.'); return; }
  const item = (currentSaleDraft.items||[])[idx]; if(!item || item.canceled) return;
  cancelItemIdx = idx;
  openModal('Cancelar item', `
    <p class="sub">${h(item.name)} · ${item.qty}x ${fmt(item.price)} — lançado por ${h(item.addedBy||'—')} em ${item.addedAt?reportDateTime(item.addedAt):'—'}</p>
    <p class="sub" style="color:var(--c-danger)"><b>Esta ação não pode ser desfeita.</b> O valor sai do total da comanda e o insumo consumido é devolvido ao estoque.</p>
    <div class="field"><label>Motivo (opcional)</label><input id="cancelItemReason" placeholder="Ex: lançado errado, cliente desistiu..."></div>
    <div class="row">
      <button class="btn" onclick="openComanda(${jsArg(saleId)},true)">Voltar</button>
      <button class="btn btn-danger-solid" id="cancelItemConfirmBtn">Confirmar cancelamento</button>
    </div>
  `);
  document.getElementById('cancelItemConfirmBtn').onclick = confirmCancelComandaItem;
}
async function confirmCancelComandaItem(){
  const saleId = currentSaleDraft&&currentSaleDraft.id; if(!saleId) return;
  const item = (currentSaleDraft.items||[])[cancelItemIdx]; if(!item || item.canceled) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  const reason = (document.getElementById('cancelItemReason').value||'').trim();
  if(!await restoreInsumosForItems([item])){ toast('Falha ao devolver o estoque. Tente novamente.'); return; }
  item.canceled = true; item.canceledAt = new Date().toISOString(); item.canceledBy = currentUser.name; item.canceledReason = reason;
  await commitSaleChange(saleId, cur=>{ cur.items=mergeDraftItems(cur.items, currentSaleDraft.items).items; cur.total=saleTotal(cur.items); });
  if(item.sent) await markKitchenItemCanceled(saleId, item);
  logAction('Item cancelado: '+item.name+' x'+item.qty+' — pedido #'+(s.orderNumber||saleId)+(reason?' — motivo: '+reason:''));
  toast('Item cancelado e estoque devolvido.');
  cancelItemIdx = null;
  closeModal(); openComanda(saleId, true); renderComandas();
}
confirmCancelComandaItem = singleFlight('confirmCancelComandaItem', confirmCancelComandaItem);
// OP-09: marca no Monitor o item cancelado na comanda, para a cozinha não preparar.
// Acha pelo lote (batchId); pedidos de antes desse vínculo, pelo produto, nome e quantidade.
async function markKitchenItemCanceled(saleId, item){
  const orders = state.orders.filter(o=>o.saleId===saleId && o.status!=='entregue');
  const same = x=>!x.canceled && x.productId===item.productId;
  let target = null, pos = -1;
  for(const o of orders){ const k=(o.items||[]).findIndex(x=>same(x) && item.batchId && x.batchId===item.batchId); if(k>-1){ target=o; pos=k; break; } }
  if(!target) for(const o of orders){ const k=(o.items||[]).findIndex(x=>same(x) && !x.batchId && x.name===item.name && Number(x.qty)===Number(item.qty)); if(k>-1){ target=o; pos=k; break; } }
  if(!target) return;
  const items = target.items.map((x,k)=>k===pos?{...x, canceled:true, canceledAt:new Date().toISOString()}:x);
  try{ await OrdersStore.setItems(target.id, items); renderAll(); }
  catch(e){ console.error('Falha ao marcar cancelamento no Monitor', e); toast('Item cancelado, mas o Monitor não foi avisado. Avise a cozinha.'); }
}
let cancelComandaSaleId = null;
function openCancelComanda(saleId){
  if(!requirePerm('cancelar-comanda')) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(s.locked){ toast('Este pedido está bloqueado. Desbloqueie antes de cancelar.'); return; }
  if(s.status!=='open'){ toast('Este pedido já está fechado.'); return; }
  if(comandaPartialPaid(s)>TOLERANCIA_CENTAVO){ toast('Esta comanda tem pagamento parcial de '+fmt(comandaPartialPaid(s))+'. Estorne os pagamentos parciais antes de cancelar.'); return; }
  cancelComandaSaleId = saleId;
  const activeItems = (currentSaleDraft.items||[]).filter(i=>!i.canceled);
  openModal('Cancelar comanda inteira', `
    <p class="sub">${activeItems.length} item(ns) ativo(s) — total atual <b>${fmt(saleTotal(currentSaleDraft.items))}</b>.</p>
    <p class="sub" style="color:var(--c-danger)"><b>Esta ação não pode ser desfeita.</b> Todos os itens ainda não cancelados desta comanda são cancelados de uma vez, o insumo consumido é devolvido ao estoque e a comanda inteira sai da lista de mesas/comandas em aberto.</p>
    <div class="field"><label>Motivo (opcional)</label><input id="cancelComandaReason" placeholder="Ex: pedido duplicado, cliente desistiu..."></div>
    <div class="row">
      <button class="btn" onclick="openComanda(${jsArg(saleId)},true)">Voltar</button>
      <button class="btn btn-danger-solid" id="cancelComandaConfirmBtn">Confirmar cancelamento</button>
    </div>
  `);
  document.getElementById('cancelComandaConfirmBtn').onclick = confirmCancelComanda;
}
async function confirmCancelComanda(){
  if(!requirePerm('cancelar-comanda')) return;
  const saleId = cancelComandaSaleId; if(!saleId) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  const reason = (document.getElementById('cancelComandaReason').value||'').trim();
  const activeItems = (s.items||[]).filter(i=>!i.canceled);
  const sentItems = activeItems.filter(i=>i.sent);
  if(sentItems.length && !await restoreInsumosForItems(sentItems)){ toast('Falha ao devolver o estoque. Tente novamente.'); return; }
  await OrdersStore.cancelBySale(saleId);
  const now = new Date().toISOString();
  activeItems.forEach(i=>{ i.canceled=true; i.canceledAt=now; i.canceledBy=currentUser.name; i.canceledReason=reason||'Comanda cancelada'; });
  s.status = 'closed'; s.canceled = true; s.canceledAt = now; s.canceledBy = currentUser.name; s.canceledReason = reason; s.closedAt = now;
  s.total = saleTotal(s.items);
  save('sales');
  logAction('Comanda cancelada — pedido #'+(s.orderNumber||saleId)+(reason?' — motivo: '+reason:''));
  toast('Comanda cancelada e estoque devolvido.');
  cancelComandaSaleId = null;
  closeModal(); renderAll();
}
confirmCancelComanda = singleFlight('confirmCancelComanda', confirmCancelComanda);
function renderComandaQuickSearch(q){
  const el = document.getElementById('comandaQuickSearchResults'); if(!el) return;
  const query = String(q||'').trim().toLowerCase();
  if(!query){ el.style.display='none'; el.innerHTML=''; return; }
  const list = state.products.filter(p=>p.active!==false && p.name.toLowerCase().includes(query)).slice(0,24);
  el.style.display = '';
  el.innerHTML = list.length ? list.map(p=>{
    const av = productAvailable(p); const out = av!==Infinity && av<=0;
    const inCart = comandaQuickCart.find(i=>i.productId===p.id);
    return `<button class="btn np-prod-btn ${inCart?'has-qty':''}" ${out?'disabled':''} onclick="quickCartAdd(${jsArg(p.id)})">${inCart?`<span class="np-qty-badge">${inCart.qty}</span>`:''}<span class="np-prod-name">${h(p.name)}</span><span class="mono np-prod-price">${fmt(p.price)}</span></button>`;
  }).join('') : '<p class="np-empty">Nenhum produto encontrado.</p>';
}
let comandaQuickCart = [];
function quickCartAdd(productId){
  const saleId = currentSaleDraft&&currentSaleDraft.id; if(!saleId) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(s.locked){ toast('Este pedido está bloqueado.'); return; }
  const p = state.products.find(x=>x.id===productId);
  if(!p || p.active===false){ toast('Este produto não está mais disponível no catálogo.'); return; }
  if(productAvailable(p)<=0){ toast('Sem estoque de insumos para este produto.'); return; }
  const existing = comandaQuickCart.find(i=>i.productId===productId);
  if(existing) existing.qty+=1; else comandaQuickCart.push({productId, name:p.name, price:p.price, qty:1, estacao:p.estacao||'cozinha', copos:productAsksCopos(p)?0:undefined});
  renderComandaQuickSearch(document.getElementById('comandaQuickSearch')?.value||'');
  renderComandaQuickCart();
}
function quickCartChangeQty(idx,delta){
  const it = comandaQuickCart[idx]; if(!it) return;
  it.qty+=delta; if(it.qty<=0) comandaQuickCart.splice(idx,1);
  renderComandaQuickSearch(document.getElementById('comandaQuickSearch')?.value||'');
  renderComandaQuickCart();
}
function quickCartChangeCopos(idx,delta){
  const it = comandaQuickCart[idx]; if(!it) return;
  it.copos = Math.max(0, (it.copos||0)+delta);
  renderComandaQuickCart();
}
function renderComandaQuickCart(){
  const wrap = document.getElementById('comandaQuickCartWrap'); if(!wrap) return;
  if(!comandaQuickCart.length){ wrap.style.display='none'; wrap.innerHTML=''; return; }
  wrap.style.display='';
  const total = comandaQuickCart.reduce((a,i)=>a+i.price*i.qty,0);
  const qty = comandaQuickCart.reduce((a,i)=>a+i.qty,0);
  wrap.innerHTML = `<div class="np-cart" style="border-top:1px solid var(--c-border);padding-top:10px">
    ${comandaQuickCart.map((i,idx)=>`
      <div class="item-line" style="flex-wrap:wrap">
        <span>${h(i.name)}</span>
        <div class="qty-ctrl"><button onclick="quickCartChangeQty(${idx},-1)">−</button><span class="mono">${i.qty}</span>
        <button onclick="quickCartChangeQty(${idx},1)">+</button>
        <span class="mono" style="min-width:70px;text-align:right">${fmt(i.price*i.qty)}</span></div>
        ${i.copos!=null?`<div class="qty-ctrl" style="width:100%;justify-content:flex-end"><span class="sub" style="margin-right:6px">Quantidade de copos:</span><button onclick="quickCartChangeCopos(${idx},-1)">−</button><span class="mono">${i.copos||0}</span><button onclick="quickCartChangeCopos(${idx},1)">+</button></div>`:''}
      </div>`).join('')}
    ${levarJuntoBox(comandaQuickCart,'quick')}
    <div class="np-total"><span>Total</span><span class="mono">${fmt(total)}</span></div>
    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="openComandaQuickAddConfirm()">Adicionar e enviar pra cozinha (${qty} ${qty===1?'item':'itens'})</button>
  </div>`;
}
function openComandaQuickAddConfirm(){
  const saleId = currentSaleDraft&&currentSaleDraft.id; if(!saleId) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(s.locked){ toast('Este pedido está bloqueado.'); return; }
  if(!comandaQuickCart.length) return;
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const requesterOptions = member
    ? `<option value="">— Selecione —</option><option value="holder:${member.id}" ${memberBlockedByDebt(member)?'disabled':''}>Titular — ${h(member.name)}${memberBlockedByDebt(member)?' (bloqueado — deve '+fmt(member.debt)+')':''}</option>${(member.dependents||[]).map(d=>`<option value="dependent:${d.id}" ${d.canOrder===false||memberBlockedByDebt(member)?'disabled':''}>Dependente — ${h(d.name)}${d.canOrder===false?' (bloqueado)':memberBlockedByDebt(member)?' (bloqueado — cota com pendência)':''}</option>`).join('')}`
    : `<option value="guest">${h(s.customerName||'Cliente avulso')}</option>`;
  const requesterSection = member ? `
    <div class="field">
      <label class="np-label">Quem está pedindo *</label>
      <select id="comandaQuickAddRequester">${requesterOptions}</select>
      <p id="comandaQuickAddRequesterWarn" class="sub" style="display:none;color:var(--red);margin:6px 0 0">Esta pessoa está bloqueada para consumir nesta cota.</p>
    </div>` : `<select id="comandaQuickAddRequester" style="display:none">${requesterOptions}</select>`;
  const itemsSummary = comandaQuickCart.map(i=>`${i.qty}x ${h(i.name)}`).join(', ');
  openModal('Adicionar Produtos', `
    <p class="sub">${itemsSummary}</p>
    ${requesterSection}
    <div class="row">
      <button class="btn" onclick="openComanda(${jsArg(saleId)},true)">Voltar</button>
      <button class="btn btn-primary" id="comandaQuickAddConfirmBtn">Confirmar e enviar pra cozinha</button>
    </div>
  `);
  const reqEl = document.getElementById('comandaQuickAddRequester');
  if(member) reqEl.onchange = (e)=>{
    const opt = e.target.selectedOptions[0];
    document.getElementById('comandaQuickAddRequesterWarn').style.display = opt&&opt.disabled ? 'block':'none';
  };
  document.getElementById('comandaQuickAddConfirmBtn').onclick = confirmComandaQuickAdd;
}
async function confirmComandaQuickAdd(){
  const saleId = currentSaleDraft&&currentSaleDraft.id; if(!saleId) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(!comandaAcceptsOrders(s)) return;
  if(!comandaQuickCart.length) return;
  const member = s.memberId ? state.members.find(m=>m.id===s.memberId) : null;
  const reqValue = document.getElementById('comandaQuickAddRequester').value;
  if(!reqValue){ toast('Selecione quem está pedindo.'); return; }
  let requester;
  if(reqValue==='guest') requester={id:null,name:s.customerName||'Cliente avulso',type:'avulso',canOrder:true};
  else if(reqValue.startsWith('holder:')) requester={id:member.id,name:member.name,type:'titular',canOrder:true};
  else { const depId=reqValue.split(':')[1], dep=(member.dependents||[]).find(d=>d.id===depId); requester={id:dep&&dep.id,name:dep&&dep.name||'Dependente',type:'dependente',canOrder:!!dep&&dep.canOrder!==false}; }
  if(!requester.canOrder){ toast('Esta pessoa está bloqueada para consumir nesta cota.'); return; }
  const who = requester.name;
  const origem = currentUser.origem||'caixa';
  const items = comandaQuickCart.map(i=>({...i, lineId:uid(), sent:false, addedAt:new Date().toISOString(), addedBy:currentUser.name, local:s.local||'', requesterId:requester.id, requesterName:who, requesterType:requester.type}));
  applyLevarJunto(items, levarJunto.quick);
  if(!await sendItemsToKitchen(saleId, items, who, 'comanda', s.local)) return;
  items.forEach(i=>i.sent=true);
  await commitSaleChange(s.id, cur=>{ cur.items=[...(cur.items||[]), ...items]; cur.total=saleTotal(cur.items); });
  const groups = {};
  items.forEach(i=>{ const key=i.estacao||'cozinha'; (groups[key]=groups[key]||[]).push(i); });
  const printJobs = Object.keys(groups).map(estacao=>{
    const printer = resolvePrinterFor(estacao, origem);
    return { estacao, items:groups[estacao], printer: printer?printer.nome:null };
  });
  logAction('Produto(s) adicionado(s) via busca na comanda: '+items.map(i=>i.qty+'x '+i.name).join(', ')+' para '+who+' — pedido #'+(s.orderNumber||saleId));
  printNovoPedidoTickets(who, member?member.code:'', s.local, printJobs, s.orderNumber);
  toast('Adicionado e enviado para a cozinha.');
  comandaQuickCart = []; levarJunto.quick=false;
  closeModal(); openComanda(saleId, true); renderComandas();
}
function openReorderComandaBatch(batchKey){
  const saleId = currentSaleDraft&&currentSaleDraft.id; if(!saleId) return;
  const s = state.sales.find(x=>x.id===saleId); if(!s) return;
  if(s.locked){ toast('Este pedido está bloqueado.'); return; }
  const batchItems = (currentSaleDraft.items||[]).filter((it,idx)=>!it.canceled && comandaItemBatchKey(it,idx)===batchKey);
  if(!batchItems.length){ toast('Nenhum item ativo neste pedido para repetir.'); return; }
  comandaQuickCart = []; levarJunto.quick=false;
  let skipped = 0;
  batchItems.forEach(item=>{
    const product = state.products.find(p=>p.id===item.productId);
    if(!product || product.active===false){ skipped++; return; }
    const existing = comandaQuickCart.find(i=>i.productId===product.id);
    if(existing) existing.qty += item.qty;
    else comandaQuickCart.push({productId:product.id, name:product.name, price:product.price, qty:item.qty, estacao:product.estacao||'cozinha', copos:productAsksCopos(product)?(item.copos||0):undefined});
  });
  if(!comandaQuickCart.length){ toast('Nenhum destes produtos está mais disponível no catálogo.'); return; }
  if(skipped) toast(skipped+' item(ns) deste pedido não está(ão) mais disponível(is) e foi(ram) ignorado(s).');
  renderComandaQuickCart();
  openComandaQuickAddConfirm();
}
function reprintComandaItem(idx){
  const item = (currentSaleDraft.items||[])[idx]; if(!item) return;
  const product = state.products.find(p=>p.id===item.productId);
  const estacao = item.estacao || (product&&product.estacao) || 'cozinha';
  if(!saidaTemImpressao(estacao)){ toast('Esta estação está configurada como "só tela" — não imprime.'); return; }
  const origem = currentUser.origem || 'caixa';
  const printer = resolvePrinterFor(estacao, origem);
  const who = item.requesterName || currentSaleDraft.customerName || 'Cliente';
  const reprintMember = currentSaleDraft.memberId ? state.members.find(m=>m.id===currentSaleDraft.memberId) : null;
  printSingleTicket(who, reprintMember?reprintMember.code:'', '', estacao, printer?printer.nome:null, [item], null);
  toast('Reimpressão enviada.');
}

