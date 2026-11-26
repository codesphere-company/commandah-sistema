/* ============ FIADO PELO WHATSAPP, SOZINHO (26/11, WhatsApp etapa 4) ============
   Com "No fiado, mandar sozinho" ligado em Configurações › WhatsApp (state.settings.waFiadoAuto, desligado por
   padrão), o aparelho que fecha a comanda no fiado manda a cobrança pelo WhatsApp do Commandah (mesmo texto,
   Pix e QR do "Enviar cobrança", vendas/conta-whatsapp.js) sem abrir janela, e o aparelho que lança o pagamento
   que zera a conta manda "consumo liberado". O fiado nunca trava por causa do WhatsApp: se o envio não dá (sem
   telefone, desconectado, erro), a venda já está gravada e o aviso vai para a fila "Não enviadas"
   (tabela whatsapp_envios), com Reenviar e Descartar na tela WhatsApp. Colaborador nunca recebe (o fiado dele
   sai do salário). Sem o plano Pro, continua a pergunta de sempre com o link wa.me. */
let fiadoWaEnvios = [];          // não enviadas abertas (para a tela WhatsApp)
let fiadoWaEnviosCarregou = false;
const fiadoWaOcupado = new Set(); // envio em andamento por cliente/tipo (evita mandar duas vezes)

function fiadoWaLigado(){ return !!(state.settings && state.settings.waFiadoAuto) && isCloudMode(); }
function fiadoWaQuem(){ return String((currentUser && currentUser.name) || '').slice(0, 120); }
function fiadoWaMembro(id){ return (state.members||[]).find(x=>x.id===id) || null; }
function fiadoWaPrimeiroNome(m){
  const p = String((m && m.name) || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}
function liberacaoWhatsappTexto(m){
  const clube = (state.settings && state.settings.clubName) || 'a lanchonete';
  const nome = fiadoWaPrimeiroNome(m);
  return [`Olá${nome ? ', ' + nome : ''}! Aqui é ${clube}.`, 'Recebemos o seu pagamento: a sua conta está em dia e o consumo está liberado.', 'Obrigado!'].join('\n');
}
async function fiadoWaAtualizarMembro(id){
  try { if(typeof MembersStore!=='undefined' && MembersStore.refreshOne){ const m = await MembersStore.refreshOne(id); if(m) return m; } } catch(e){ /* sem rede: usa o que tem */ }
  return fiadoWaMembro(id);
}

// Manda a cobrança (tipo 'cobranca') ou o "consumo liberado" (tipo 'liberacao'). Devolve { ok, erro, semPro, nada }.
async function fiadoWaMandar(m, tipo){
  const plano = typeof waPlano==='function' ? await waPlano() : { pro:null };
  if(plano.pro===false) return { ok:false, semPro:true, erro:'O WhatsApp do Commandah faz parte do plano Pro.' };
  const destino = await contaWhatsappDestino(m);
  if(!destino) return { ok:false, erro:'O cadastro não tem um celular com DDD.' };
  let texto, brcode = '', qr = '', valor = 0, rodape = '';
  if(tipo==='cobranca'){
    valor = Math.max(0, arredondaCentavos(Number(m.debt)||0));
    if(!(valor > TOLERANCIA_CENTAVO)) return { ok:true, nada:true };
    if(!contaWhatsappPixFalta(valor)){
      try { brcode = contaWhatsappBrCode(valor); qr = contaWhatsappQrPng(brcode); } catch(e){ brcode = ''; qr = ''; }
    }
    texto = cobrancaWhatsappTexto(m, !!brcode);
    rodape = CONTA_WA_RODAPE;
  } else texto = liberacaoWhatsappTexto(m);
  const r = await waInvocar({ action:'enviar_conta', jid:destino.jid, texto, brcode, qr_png:qr, rodape, valor });
  if(!r || !r.ok){
    const parte = r && r.enviadas ? ` Parte já foi (${r.enviadas} ${r.enviadas>1?'mensagens':'mensagem'}): confira a conversa antes de reenviar.` : '';
    return { ok:false, erro:((r && r.erro) || WA_FALHA) + parte };
  }
  supabaseClient.rpc('whatsapp_vincular_cliente', { p_jid:destino.jid, p_member_id:m.id }).then(()=>{}, ()=>{});
  return { ok:true, valor };
}

/* ---------- Fila "Não enviadas" ---------- */
async function fiadoWaRegistrarFalha(m, tipo, motivo){
  try {
    const { error } = await supabaseClient.from('whatsapp_envios').insert({ tenant_id:storageApi.tenantId, member_id:m.id, tipo, motivo:String(motivo||'Erro ao enviar.').slice(0, 300), criada_por:fiadoWaQuem() });
    if(error) throw error;
    return true;
  } catch(e){ console.error('[fiado-wa] não guardou a não enviada', e); return false; }
}
// Fecha as abertas de um cliente (tipos = lista; vazio = todas).
async function fiadoWaResolverDoCliente(memberId, tipos, resolucao){
  try {
    let q = supabaseClient.from('whatsapp_envios').update({ resolvida_em:new Date().toISOString(), resolvida_por:fiadoWaQuem(), resolucao }).eq('member_id', memberId).is('resolvida_em', null);
    if(tipos && tipos.length) q = q.in('tipo', tipos);
    await q;
  } catch(e){ /* fica na lista; o caixa descarta */ }
}
async function fiadoWaCarregarEnvios(){
  if(!isCloudMode()) return;
  try {
    const r = await supabaseClient.from('whatsapp_envios').select('id,member_id,tipo,motivo,criada_em,criada_por,tentativas').is('resolvida_em', null).order('criada_em', { ascending:false }).limit(100);
    if(r.error) return;
    fiadoWaEnvios = r.data || []; fiadoWaEnviosCarregou = true;
  } catch(e){ /* sem rede: mantém a lista anterior */ }
  fiadoWaContador();
}
function fiadoWaContador(){
  const n = document.querySelector('#view-whatsapp .wa-filtro[data-f="falhas"] .wa-filtro-num');
  if(n){ n.textContent = fiadoWaEnvios.length ? String(fiadoWaEnvios.length) : ''; n.hidden = !fiadoWaEnvios.length; }
}
const FIADO_WA_TIPO = { cobranca:'Conta do fiado', liberacao:'Consumo liberado' };
function fiadoWaDesenharEnvios(box){
  if(!fiadoWaEnvios.length){ box.innerHTML = `<p class="sub wa-vazio">${fiadoWaEnviosCarregou ? 'Nenhuma mensagem do fiado deixou de ir.' : 'Carregando…'}</p>`; return; }
  box.innerHTML = fiadoWaEnvios.map(e=>{
    const m = fiadoWaMembro(e.member_id);
    const quitada = e.tipo==='cobranca' && m && !(Number(m.debt) > TOLERANCIA_CENTAVO);
    const quando = e.criada_em ? new Date(e.criada_em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    return `<div class="wa-envio" data-envio="${h(e.id)}">
      <span class="wa-conv-topo"><b>${h(m ? m.name : 'Cliente apagado')}</b><small>${h(quando)}</small></span>
      <span class="wa-envio-tipo">${h(FIADO_WA_TIPO[e.tipo] || e.tipo)}${e.tentativas>1 ? ` · ${Number(e.tentativas)} tentativas` : ''}</span>
      <span class="wa-envio-motivo">${h(quitada ? 'A conta já foi paga: não precisa mais mandar.' : e.motivo)}</span>
      <span class="wa-envio-acoes">${m && !quitada ? `<button type="button" class="op-btn primary" onclick="fiadoWaReenviar(${jsArg(e.id)})">Reenviar</button>` : ''}<button type="button" class="op-btn" onclick="fiadoWaDescartar(${jsArg(e.id)})">Descartar</button></span>
    </div>`;
  }).join('');
}
async function fiadoWaReenviar(id){
  const e = fiadoWaEnvios.find(x=>x.id===id); if(!e) return;
  const chave = e.member_id + '|' + e.tipo; if(fiadoWaOcupado.has(chave)) return;
  const btn = document.querySelector(`.wa-envio[data-envio="${CSS.escape(id)}"] .op-btn.primary`);
  if(btn){ btn.disabled = true; btn.textContent = 'Mandando…'; }
  fiadoWaOcupado.add(chave);
  let r;
  try {
    const m = await fiadoWaAtualizarMembro(e.member_id);
    r = m ? await fiadoWaMandar(m, e.tipo) : { ok:false, erro:'Cliente não encontrado.' };
    if(r.ok){
      await supabaseClient.from('whatsapp_envios').update({ resolvida_em:new Date().toISOString(), resolvida_por:fiadoWaQuem(), resolucao:r.nada ? 'descartada' : 'enviada', tentativas:Math.min(1000, (e.tentativas||1) + 1) }).eq('id', id);
      if(!r.nada) logAction(`${FIADO_WA_TIPO[e.tipo]} reenviado pelo WhatsApp para ${m.name}`);
      toast(r.nada ? 'Este cliente não tem mais conta em aberto.' : 'Mensagem enviada pelo WhatsApp.');
    } else {
      await supabaseClient.from('whatsapp_envios').update({ motivo:String(r.erro).slice(0, 300), tentativas:Math.min(1000, (e.tentativas||1) + 1) }).eq('id', id);
      toast(r.erro, 'erro');
    }
  } catch(err){ toast(WA_FALHA, 'erro'); }
  finally { fiadoWaOcupado.delete(chave); }
  await fiadoWaCarregarEnvios();
  if(typeof waDesenharLista==='function') waDesenharLista();
}
async function fiadoWaDescartar(id){
  try {
    const { error } = await supabaseClient.from('whatsapp_envios').update({ resolvida_em:new Date().toISOString(), resolvida_por:fiadoWaQuem(), resolucao:'descartada' }).eq('id', id);
    if(error) throw error;
  } catch(e){ toast('Não foi possível descartar agora. Tente de novo.', 'erro'); return; }
  fiadoWaEnvios = fiadoWaEnvios.filter(x=>x.id!==id);
  fiadoWaContador();
  if(typeof waDesenharLista==='function') waDesenharLista();
}

/* ---------- Ganchos do fiado ---------- */
// Fechamento no fiado (pagamento.js). true = cuidou (envio automático); false = segue a pergunta de sempre.
function fiadoWaAoFechar(m){
  if(!fiadoWaLigado() || !m || memberIsColaborador(m)) return false;
  const chave = m.id + '|cobranca'; if(fiadoWaOcupado.has(chave)) return true;
  fiadoWaOcupado.add(chave);
  (async ()=>{
    try {
      const atual = await fiadoWaAtualizarMembro(m.id) || m;
      const r = await fiadoWaMandar(atual, 'cobranca');
      if(r.semPro){ promptWhatsAppCollection(atual); return; }
      if(r.ok){
        if(r.nada) return;
        fiadoWaResolverDoCliente(m.id, [], 'descartada'); // a cobrança nova vale pelas antigas
        logAction('Conta do fiado mandada sozinha pelo WhatsApp para ' + atual.name + ' (' + fmt(r.valor) + ')');
        toast('Conta do fiado enviada pelo WhatsApp para ' + atual.name + '.');
        return;
      }
      await fiadoWaResolverDoCliente(m.id, [], 'descartada');
      const guardou = await fiadoWaRegistrarFalha(atual, 'cobranca', r.erro);
      logAction('Conta do fiado NÃO foi pelo WhatsApp para ' + atual.name + ': ' + r.erro);
      toast('A conta do fiado de ' + atual.name + ' não foi pelo WhatsApp: ' + r.erro + (guardou ? ' Está em WhatsApp › Não enviadas.' : ''), 'erro');
    } catch(e){ console.error('[fiado-wa] cobrança', e); }
    finally { fiadoWaOcupado.delete(chave); }
  })();
  return true;
}
// Pagamento de fiado lançado (Contas › Fiado ou junto com a venda). antes = saldo antes do pagamento.
// Só manda quando a conta estava em aberto e agora ficou zerada.
async function fiadoWaAposPagamento(memberId, antes){
  if(!fiadoWaLigado() || !(Number(antes) > TOLERANCIA_CENTAVO)) return;
  const m0 = fiadoWaMembro(memberId); if(!m0 || memberIsColaborador(m0)) return;
  const chave = memberId + '|liberacao'; if(fiadoWaOcupado.has(chave)) return;
  fiadoWaOcupado.add(chave);
  try {
    const m = await fiadoWaAtualizarMembro(memberId) || m0;
    if(Number(m.debt) > TOLERANCIA_CENTAVO) return;
    await fiadoWaResolverDoCliente(memberId, [], 'descartada'); // cobrança antiga não precisa mais ir
    const r = await fiadoWaMandar(m, 'liberacao');
    if(r.semPro) return;
    if(r.ok){ logAction('Aviso de consumo liberado mandado pelo WhatsApp para ' + m.name); toast('Aviso de consumo liberado enviado pelo WhatsApp.'); return; }
    const guardou = await fiadoWaRegistrarFalha(m, 'liberacao', r.erro);
    logAction('Aviso de consumo liberado NÃO foi pelo WhatsApp para ' + m.name + ': ' + r.erro);
    toast('O aviso de consumo liberado não foi pelo WhatsApp: ' + r.erro + (guardou ? ' Está em WhatsApp › Não enviadas.' : ''), 'erro');
  } catch(e){ console.error('[fiado-wa] liberação', e); }
  finally { fiadoWaOcupado.delete(chave); }
}
