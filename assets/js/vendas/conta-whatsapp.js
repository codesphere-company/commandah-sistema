/* ============ MANDAR CONTA PELO WHATSAPP (25/11, WhatsApp etapa 3) ============
   Da comanda aberta (e do painel do cliente na tela WhatsApp), o caixa manda a conta pelo número da lanchonete:
   texto com os itens e o total, o Pix copia e cola sozinho, o QR do Pix e o pedido do comprovante (tela aprovada
   em https://claude.ai/artifact/HnigvmnkXEXP9Wf5DEAta2#artboard-FecharComanda). A comanda continua aberta, com o
   selo "Conta enviada · aguardando Pix" (sale.contaEnviada); o caixa confere o comprovante e dá baixa como hoje.
   Nunca para colaborador (o fiado dele é descontado do salário). Plano Pro e permissão whatsapp. */
const CONTA_WA_RODAPE = 'Depois de pagar, mande o comprovante aqui. Obrigado!';
let contaWaAtual = null;   // { saleId, jid, tel, comPix }
let contaWaEnviando = false;

function contaWhatsappMembro(s){ return s && s.memberId ? (state.members||[]).find(m=>m.id===s.memberId) : null; }
// Botão aparece para quem tem a permissão, em comanda aberta de cliente que não é colaborador.
function contaWhatsappPode(s){
  const m = contaWhatsappMembro(s);
  return !!s && s.status==='open' && !s.canceled && hasPerm('whatsapp') && !!m && !memberIsColaborador(m);
}
// Telefone do cadastro -> jid do WhatsApp (55 + DDD + número). Formato que não dá para entender = null.
function waJidDoTelefone(tel){
  let d = String(tel||'').replace(/\D/g, '').replace(/^0+/, '');
  if(d.length===10 || d.length===11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? d + '@s.whatsapp.net' : null;
}
// Primeiro a conversa já ligada ao cliente (cobre o jid @lid); senão o telefone do cadastro.
async function contaWhatsappDestino(m){
  try {
    const r = await supabaseClient.from('whatsapp_conversas').select('jid,telefone,ultima_em').eq('member_id', m.id).order('ultima_em', { ascending:false }).limit(1);
    if(!r.error && r.data && r.data[0]) return { jid:r.data[0].jid, tel:r.data[0].telefone || m.phone || '' };
  } catch(e){ /* sem conversa: segue para o telefone */ }
  const jid = waJidDoTelefone(m.phone);
  return jid ? { jid, tel:m.phone } : null;
}
function contaWhatsappQtd(q){ const n = Number(q)||0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace('.', ','); }
// Itens iguais (mesmo nome e preço) numa linha só, como no cupom.
function contaWhatsappLinhas(s){
  const grupos = new Map();
  (s.items||[]).filter(i=>!i.canceled).forEach(i=>{
    const nome = typeof itemNomeTela==='function' ? itemNomeTela(i) : (i.name||'Item');
    const k = nome + '|' + Number(i.price);
    const g = grupos.get(k) || { nome, preco:Number(i.price)||0, qtd:0 };
    g.qtd += Number(i.qty)||0; grupos.set(k, g);
  });
  return [...grupos.values()].map(g=>`${contaWhatsappQtd(g.qtd)}× ${g.nome} — ${fmt(g.preco*g.qtd)}`);
}
function contaWhatsappTotais(s){ return gcComandaTotals(s); }
function contaWhatsappTexto(s, comPix){
  const m = contaWhatsappMembro(s), t = contaWhatsappTotais(s);
  const primeiro = String((m && m.name) || s.customerName || '').trim().split(/\s+/)[0] || '';
  const nome = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : '';
  const linhas = [`Olá${nome ? ', ' + nome : ''}! Segue a conta da comanda${s.orderNumber ? ' #' + s.orderNumber : ''}:`, ...contaWhatsappLinhas(s)];
  if(t.service > TOLERANCIA_CENTAVO) linhas.push(`Serviço (${serviceRatePct()}%) — ${fmt(t.service)}`);
  if(t.creditApplied > TOLERANCIA_CENTAVO) linhas.push(`Crédito — − ${fmt(t.creditApplied)}`);
  if(t.debt > TOLERANCIA_CENTAVO) linhas.push(`Conta anterior em aberto — ${fmt(t.debt)}`);
  if(t.partialPaid > TOLERANCIA_CENTAVO) linhas.push(`Já pago — − ${fmt(t.partialPaid)}`);
  linhas.push(`*Total: ${fmt(t.total)}*`);
  if(comPix) linhas.push('Para pagar pelo Pix, copie o código da próxima mensagem ou leia o QR.');
  return linhas.join('\n');
}
// Pix configurado? Devolve o motivo em português quando falta algo.
function contaWhatsappPixFalta(valor){
  const st = state.settings || {};
  if(!String(st.pixKey||'').trim() || !String(st.pixNome||'').trim() || !String(st.pixCidade||'').trim())
    return 'Para mandar o Pix, preencha a chave, o nome e a cidade em Configurações › Sistema › Ajustes do Cupom.';
  if(!(valor > TOLERANCIA_CENTAVO)) return 'Sem valor a pagar nesta comanda.';
  return '';
}
function contaWhatsappBrCode(valor){
  const st = state.settings || {};
  return pixBrCode({ chave:st.pixKey, nome:st.pixNome, cidade:st.pixCidade, valor });
}
// QR do Pix em PNG (sem o prefixo data:), pela biblioteca QRCode que o app já carrega.
function contaWhatsappQrPng(brcode){
  if(!window.QRCode) return '';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(box);
  try {
    new QRCode(box, { text:brcode, width:320, height:320, colorDark:'#000000', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.M });
    const c = box.querySelector('canvas');
    return c ? c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '') : '';
  } catch(e){ return ''; }
  finally { box.remove(); }
}

async function abrirMandarConta(saleId){
  const s = (state.sales||[]).find(x=>x.id===saleId);
  if(!contaWhatsappPode(s)){ toast('Esta comanda não pode receber a conta pelo WhatsApp.', 'erro'); return; }
  if(typeof toggleComandaOrderOptions==='function') toggleComandaOrderOptions(false);
  openModal('Mandar conta pelo WhatsApp', `<div id="contaWaBox" class="conta-wa" aria-live="polite"><p class="sub">Procurando o WhatsApp do cliente…</p></div>`);
  const m = contaWhatsappMembro(s);
  const plano = typeof waPlano==='function' ? await waPlano() : { pro:false };
  const box = document.getElementById('contaWaBox'); if(!box) return;
  if(plano.pro===false){
    box.innerHTML = `<p><b>Mandar a conta pelo WhatsApp faz parte do plano Pro.</b></p><p class="sub">Para ligar, fale com a equipe do Commandah.</p><div class="conta-wa-acoes"><button type="button" class="op-btn" onclick="closeModal()">Fechar</button></div>`;
    return;
  }
  const destino = await contaWhatsappDestino(m);
  if(!document.getElementById('contaWaBox')) return;
  if(!destino){
    box.innerHTML = `<p class="wa-erro" role="alert">O cadastro de ${h(m.name)} não tem um telefone que dê para usar.</p><p class="sub">Coloque o celular com DDD no cadastro do cliente, ou ligue uma conversa a ele na tela WhatsApp.</p><div class="conta-wa-acoes"><button type="button" class="op-btn" onclick="closeModal()">Fechar</button></div>`;
    return;
  }
  const t = contaWhatsappTotais(s), falta = contaWhatsappPixFalta(t.total);
  contaWaAtual = { saleId, jid:destino.jid, tel:destino.tel, comPix:!falta };
  const para = destino.jid.endsWith('@lid') ? 'a conversa do cliente no WhatsApp' : waFormatarNumero(destino.tel || destino.jid.split('@')[0]);
  box.innerHTML = `<p class="conta-wa-quem"><b>${h(m.name)}</b>${m.code ? ` · cota ${h(m.code)}` : ''}</p>
    <p>Mandar para <b>${h(para)}</b></p>
    <label class="conta-wa-pix"><input type="checkbox" id="contaWaPix" ${falta ? 'disabled' : 'checked'} onchange="contaWaAtual.comPix=this.checked;contaWaPrevia()"> <span>Junto: Pix copia e cola e QR de <b>${h(fmt(t.total))}</b></span></label>
    ${falta ? `<p class="sub conta-wa-falta">${h(falta)}</p>` : ''}
    <div class="conta-wa-previa" id="contaWaPrevia"></div>
    <p class="sub">A comanda fica aberta como "Conta enviada · aguardando Pix". Quando o comprovante chegar, confira e dê baixa como sempre.</p>
    <p class="wa-erro" id="contaWaErro" role="alert"></p>
    <div class="conta-wa-acoes"><button type="button" class="op-btn" onclick="closeModal()">Cancelar</button><button type="button" class="op-btn primary" id="contaWaEnviar" onclick="mandarConta()">Mandar conta pelo WhatsApp</button></div>`;
  contaWaPrevia();
}
function contaWaPrevia(){
  const el = document.getElementById('contaWaPrevia'); if(!el || !contaWaAtual) return;
  const s = (state.sales||[]).find(x=>x.id===contaWaAtual.saleId); if(!s) return;
  // *texto* é negrito no WhatsApp: a prévia mostra como o cliente vê.
  const txt = contaWhatsappTexto(s, contaWaAtual.comPix) + (contaWaAtual.comPix ? '\n\n[Pix copia e cola]\n[QR do Pix]' : '') + '\n\n' + CONTA_WA_RODAPE;
  el.innerHTML = h(txt).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}
async function mandarConta(){
  if(contaWaEnviando || !contaWaAtual) return;
  const s = (state.sales||[]).find(x=>x.id===contaWaAtual.saleId);
  const btn = document.getElementById('contaWaEnviar'), err = document.getElementById('contaWaErro');
  if(!s || s.status!=='open'){ if(err) err.textContent = 'Esta comanda não está mais aberta.'; return; }
  const t = contaWhatsappTotais(s);
  let brcode = '', qr = '';
  if(contaWaAtual.comPix){
    try { brcode = contaWhatsappBrCode(t.total); } catch(e){ if(err) err.textContent = e.message; return; }
    qr = contaWhatsappQrPng(brcode);
  }
  contaWaEnviando = true;
  if(btn){ btn.disabled = true; btn.textContent = 'Mandando…'; }
  if(err) err.textContent = '';
  let r;
  try {
    r = await waInvocar({ action:'enviar_conta', jid:contaWaAtual.jid, texto:contaWhatsappTexto(s, !!brcode), brcode, qr_png:qr, rodape:CONTA_WA_RODAPE, valor:t.total });
  } finally { contaWaEnviando = false; }
  if(!r || !r.ok){
    if(btn){ btn.disabled = false; btn.textContent = 'Mandar conta pelo WhatsApp'; }
    const parte = r && r.enviadas ? ` Parte da conta já foi (${r.enviadas} mensagem${r.enviadas>1?'s':''}): confira na tela WhatsApp antes de mandar de novo.` : '';
    if(err) err.textContent = ((r && r.erro) || 'Não foi possível falar com o WhatsApp agora.') + parte;
    return;
  }
  // Revisão final: a conversa criada pelo envio fica ligada à cliente (a ligação automática não liga quando
  // dois cadastros têm o mesmo telefone), para o painel e o filtro "Conta enviada" acharem.
  const m = contaWhatsappMembro(s);
  if(m) supabaseClient.rpc('whatsapp_vincular_cliente', { p_jid:contaWaAtual.jid, p_member_id:m.id }).then(()=>{}, ()=>{});
  s.contaEnviada = { em:new Date().toISOString(), por:(currentUser && currentUser.name) || '', valor:t.total, jid:contaWaAtual.jid };
  save('sales');
  logAction('Conta mandada pelo WhatsApp — comanda #' + (s.orderNumber||'') + ' (' + fmt(t.total) + ')');
  contaWaAtual = null;
  closeModal();
  toast('Conta enviada pelo WhatsApp.');
  renderAll();
}
function contaEnviadaSelo(s){
  if(!s || !s.contaEnviada) return '';
  const c = s.contaEnviada;
  const quando = c.em ? new Date(c.em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
  // Revisão final: a comanda mudou depois do envio (item novo, parcial): o Pix que o cliente tem é de outro valor.
  let atual = null; try { atual = contaWhatsappTotais(s).total; } catch(e){ /* sem total: mostra o selo normal */ }
  if(atual!==null && Number(c.valor) > 0 && Math.abs(atual - Number(c.valor)) > TOLERANCIA_CENTAVO)
    return `<span class="tag tag-red conta-enviada-tag" title="${h('Mandada com ' + fmt(c.valor) + '; agora a comanda está em ' + fmt(atual) + '. Mande a conta de novo.')}">Conta enviada · valor mudou</span>`;
  return `<span class="tag tag-amber conta-enviada-tag" title="${h('Mandada' + (quando ? ' em ' + quando : '') + (c.por ? ' por ' + c.por : '') + (c.valor ? ' · ' + fmt(c.valor) : ''))}">Conta enviada · aguardando Pix</span>`;
}
