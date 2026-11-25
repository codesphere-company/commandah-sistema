/* ============ WHATSAPP: CONVERSAS (25/11, etapa 2) ============
   Tela WhatsApp no menu lateral (dono, admin, caixa; plano Pro). Lê whatsapp_conversas e whatsapp_mensagens pela
   RLS e envia/abre foto pela Edge Function "whatsapp" (enviar_texto, midia). Sem Realtime: consulta periódica,
   como o caixa por operador. Aviso de mensagem nova (toast, som, contador na lateral) em qualquer tela.
   Plano: docs/superpowers/plans/2026-11-25-whatsapp-etapa2.md.
   Tráfego (25/11, egress do Supabase estourou): o aviso de 10 s busca só as conversas com não lidas (poucas
   colunas, sem mensagens) e nada roda com a aba escondida; a conversa aberta é consultada a cada 4 s só nesta tela. */
let waAvisosTimer = null, waTelaTimer = null;
let waProCache = { uid:null, pro:null, conectado:null };   // situação do plano por usuário (uma consulta por login)
let waBaseAviso = null, waBaseUid = null;                  // maior ultima_em já avisada (por usuário)
let waNaoLidasTotal = 0;
let waConvs = [], waMsgs = [], waAberta = null, waFiltro = 'todas', waBuscaTxt = '', waCarregou = false;
const WA_FALHA = 'Não foi possível falar com o WhatsApp agora. Tente de novo em alguns segundos.';

async function waInvocar(body){
  try {
    const r = await supabaseClient.functions.invoke('whatsapp', { body });
    if(r.error){ let c=null; try { c = await r.error.context.json(); } catch(e){ /* sem corpo */ } return { ok:false, erro:(c&&c.erro)||WA_FALHA }; }
    return r.data || { ok:false, erro:WA_FALHA };
  } catch(e){ return { ok:false, erro:WA_FALHA }; }
}
// Plano Pro e conexão: pergunta à função uma vez por usuário logado.
async function waPlano(){
  const uid = currentUser && currentUser.id;
  if(waProCache.uid===uid && waProCache.pro!==null) return waProCache;
  const s = await waInvocar({ action:'situacao' });
  if(!s.ok) return { uid, pro:null, conectado:null };
  waProCache = { uid, pro:s.plano_pro===true, conectado:s.situacao==='conectado' };
  return waProCache;
}

/* ---------- Aviso em qualquer tela ---------- */
function waIniciarAvisos(){
  if(waAvisosTimer) return;
  waAvisosTimer = setInterval(waTickAvisos, 10000);
  setTimeout(waTickAvisos, 1500);
}
async function waTickAvisos(){
  if(!currentUser || !hasPerm('whatsapp') || !isCloudMode() || document.hidden) return;
  const p = await waPlano(); if(!p.pro) return;
  const { data, error } = await supabaseClient.from('whatsapp_conversas')
    .select('jid,nome_contato,telefone,nao_lidas,ultima_em,ultima_texto').gt('nao_lidas', 0).limit(100);
  if(error || !Array.isArray(data)) return;
  const total = data.reduce((s,c)=>s+(Number(c.nao_lidas)||0), 0);
  const maior = data.reduce((m,c)=>(c.ultima_em && (!m || c.ultima_em>m)) ? c.ultima_em : m, null);
  const naTela = activeView==='whatsapp' && !document.hidden;
  // Primeira consulta do usuário: o que chegou até 15 s antes (o intervalo do aviso) ainda toca; o mais antigo
  // só entra no contador. Sem isso, mensagem que chegasse entre o login e a primeira consulta não avisava.
  if(waBaseUid!==currentUser.id){ waBaseUid = currentUser.id; waBaseAviso = new Date(Date.now()-15000).toISOString(); }
  {
    const novas = data.filter(c=>c.ultima_em && c.ultima_em>waBaseAviso && !(naTela && c.jid===waAberta));
    if(novas.length) waAvisar(novas.sort((a,b)=>a.ultima_em<b.ultima_em?1:-1)[0], novas.length);
    if(maior && maior>waBaseAviso) waBaseAviso = maior;
  }
  waDefinirContador(total);
  if(naTela) waCarregarConversas();
}
function waDefinirContador(n){
  if(n===waNaoLidasTotal) return;
  waNaoLidasTotal = n;
  if(typeof renderRibbonTabs==='function') renderRibbonTabs();
}
function waNomeConversa(c){ return (c && (c.nome_contato || (c.telefone && waFormatarNumero(c.telefone)))) || 'Contato'; }
function waAvisar(c, qtd){
  waBip();
  const root = document.getElementById('toastRoot'); if(!root) return;
  root.querySelectorAll('.toast.wa-toast').forEach(t=>t.remove());
  const el = document.createElement('div');
  el.className = 'toast wa-toast'; el.setAttribute('role','status');
  el.innerHTML = `<span><b>Nova mensagem no WhatsApp</b><br>${h(waNomeConversa(c))}${qtd>1?` e mais ${qtd-1}`:''}: ${h(String(c.ultima_texto||'').slice(0,80))}</span>
    <span class="wa-toast-acoes"><button type="button" class="op-btn primary" data-wa="responder">Responder</button><button type="button" class="op-btn" data-wa="depois">Depois</button></span>`;
  el.querySelector('[data-wa="responder"]').onclick = ()=>{ el.remove(); waAbrirConversa(c.jid, true); };
  el.querySelector('[data-wa="depois"]').onclick = ()=>el.remove();
  root.appendChild(el);
  setTimeout(()=>el.remove(), 15000);
}
// Som curto pelo WebAudio (sem arquivo). O navegador pode bloquear antes do primeiro clique: aí fica só o aviso.
function waBip(){
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if(!Ctx) return;
    const ctx = waBip.ctx || (waBip.ctx = new Ctx());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.18);
  } catch(e){ /* sem som */ }
}

/* ---------- Tela ---------- */
function waAbrirConversa(jid, trocarTela){
  waAberta = jid; waMsgs = [];
  const cli = document.querySelector('#view-whatsapp .wa-cliente'); if(cli) cli.dataset.membro = '';
  if(trocarTela && activeView!=='whatsapp') openRibbonView('whatsapp','WhatsApp');
  else renderWhatsApp();
  waCarregarMensagens(true);
}
function renderWhatsApp(){
  const v = document.getElementById('view-whatsapp'); if(!v) return;
  if(!v.querySelector('.wa-tela, .wa-pro')){
    v.innerHTML = `<div class="wa-carregando sub" style="padding:24px">Abrindo o WhatsApp…</div>`;
    waEntrar();
    return;
  }
  if(v.querySelector('.wa-tela')){ waDesenharLista(); waDesenharChat(); waDesenharCliente(); }
  waLigarTela();
}
async function waEntrar(){
  const v = document.getElementById('view-whatsapp');
  const p = await waPlano();
  if(activeView!=='whatsapp' || !v) return;
  if(p.pro===false){
    v.innerHTML = `<div class="wa-pro"><h3>WhatsApp no Commandah faz parte do plano Pro</h3>
      <ul class="sub"><li>Conversas do WhatsApp da lanchonete dentro do sistema, com aviso quando chega mensagem.</li><li>Mandar a conta da comanda com Pix copia e cola e QR.</li><li>No fiado, a conta vai sozinha na hora que a comanda fecha.</li></ul>
      <p class="sub">Para ligar, fale com a equipe do Commandah.</p></div>`;
    return;
  }
  v.innerHTML = `<div class="wa-tela">
    <aside class="wa-lista" aria-label="Conversas">
      <input id="waPesquisa" type="search" placeholder="Pesquisar conversa" aria-label="Pesquisar conversa" oninput="waBuscaTxt=this.value;waDesenharLista()">
      <div class="wa-filtros" role="group" aria-label="Filtro"><button type="button" class="wa-filtro ativo" data-f="todas" onclick="waTrocarFiltro('todas')">Todas</button><button type="button" class="wa-filtro" data-f="nao" onclick="waTrocarFiltro('nao')">Não lidas</button></div>
      <div class="wa-conversas"></div>
    </aside>
    <section class="wa-chat-area" aria-label="Conversa">
      <header class="wa-chat-topo"><button type="button" class="wa-voltar op-btn" onclick="waVoltarLista()" aria-label="Voltar para as conversas">〈 Voltar</button><b class="wa-chat-nome"></b></header>
      ${p.conectado===false ? `<p class="wa-desconectado">WhatsApp desconectado. O administrador conecta em Configurações › WhatsApp.</p>` : ''}
      <div class="wa-chat" aria-live="polite"></div>
      <div class="wa-respostas"></div>
      <div class="wa-compor"><textarea id="waTexto" rows="2" maxlength="4096" placeholder="Escreva a mensagem (Enter envia, Shift+Enter quebra linha)" aria-label="Mensagem"></textarea><button type="button" id="waEnviar" class="op-btn primary" onclick="waEnviar()">Enviar</button></div>
      <p class="wa-erro-envio" role="alert"></p>
    </section>
    <aside class="wa-cliente" aria-label="Cliente"></aside>
  </div>`;
  document.getElementById('waTexto').addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); waEnviar(); } });
  await waCarregarConversas();
  if(waAberta) waCarregarMensagens(true);
  waDesenharChat(); waDesenharCliente();
  waLigarTela();
}
function waLigarTela(){
  if(waTelaTimer) return;
  waTelaTimer = setInterval(()=>{
    if(activeView!=='whatsapp'){ clearInterval(waTelaTimer); waTelaTimer=null; return; }
    if(document.hidden) return;
    waCarregarConversas(); if(waAberta) waCarregarMensagens(false);
  }, 4000);
}
async function waCarregarConversas(){
  const { data, error } = await supabaseClient.from('whatsapp_conversas')
    .select('jid,telefone,nome_contato,member_id,nao_lidas,ultima_texto,ultima_em,ultima_direcao')
    .order('ultima_em', { ascending:false }).limit(200);
  if(error || !Array.isArray(data)) return;
  waConvs = data; waCarregou = true;
  waDefinirContador(data.reduce((s,c)=>s+(c.jid===waAberta && activeView==='whatsapp' ? 0 : (Number(c.nao_lidas)||0)), 0));
  waDesenharLista(); waDesenharCliente();
}
async function waCarregarMensagens(marcar){
  const jid = waAberta; if(!jid) return;
  const { data, error } = await supabaseClient.from('whatsapp_mensagens')
    .select('evo_id,direcao,tipo,texto,arquivo_nome,mime,enviada_por,situacao,criada_em')
    .eq('jid', jid).order('criada_em', { ascending:false }).limit(80);
  if(error || !Array.isArray(data) || jid!==waAberta) return;
  const antes = waMsgs.length ? waMsgs[waMsgs.length-1].evo_id + waMsgs.length + waMsgs.map(m=>m.situacao).join() : '';
  waMsgs = data.reverse();
  const depois = waMsgs.length ? waMsgs[waMsgs.length-1].evo_id + waMsgs.length + waMsgs.map(m=>m.situacao).join() : '';
  if(antes!==depois) waDesenharChat();
  const c = waConvs.find(x=>x.jid===jid);
  if(marcar || (c && c.nao_lidas>0)){
    const r = await supabaseClient.rpc('whatsapp_marcar_lida', { p_jid: jid });
    if(!r.error && c){ c.nao_lidas = 0; waDesenharLista(); waDefinirContador(waConvs.reduce((s,x)=>s+(Number(x.nao_lidas)||0),0)); }
  }
}
function waTrocarFiltro(f){
  waFiltro = f;
  document.querySelectorAll('#view-whatsapp .wa-filtro').forEach(b=>b.classList.toggle('ativo', b.dataset.f===f));
  waDesenharLista();
}
function waVoltarLista(){ waAberta = null; waMsgs = []; const t=document.querySelector('#view-whatsapp .wa-tela'); if(t) t.classList.remove('chat-aberto'); waDesenharChat(); waDesenharCliente(); waDesenharLista(); }
function waHora(iso){ const d=new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function waDia(iso){
  const d=new Date(iso); if(isNaN(d)) return '';
  const hoje=new Date(), ontem=new Date(Date.now()-86400000);
  if(d.toDateString()===hoje.toDateString()) return 'Hoje';
  if(d.toDateString()===ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR');
}
function waDesenharLista(){
  const box = document.querySelector('#view-whatsapp .wa-conversas'); if(!box) return;
  const termo = waBuscaTxt.trim().toLowerCase();
  const lista = waConvs.filter(c=>(waFiltro!=='nao' || c.nao_lidas>0) && (!termo || waNomeConversa(c).toLowerCase().includes(termo) || String(c.telefone||'').includes(termo.replace(/\D/g,'')||'§')));
  if(!lista.length){ box.innerHTML = `<p class="sub wa-vazio">${waCarregou ? (waConvs.length ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa ainda. Quando um cliente mandar mensagem, ela aparece aqui.') : 'Carregando…'}</p>`; return; }
  box.innerHTML = lista.map(c=>`<button type="button" class="wa-conversa ${c.jid===waAberta?'ativa':''} ${c.nao_lidas>0?'nao-lida':''}" onclick="waAbrirConversa(${jsArg(c.jid)})">
      <span class="wa-conv-topo"><b>${h(waNomeConversa(c))}</b><small>${h(c.ultima_em ? (waDia(c.ultima_em)==='Hoje' ? waHora(c.ultima_em) : waDia(c.ultima_em)) : '')}</small></span>
      <span class="wa-conv-baixo"><span class="wa-conv-texto">${c.ultima_direcao==='saida'?'Você: ':''}${h(String(c.ultima_texto||''))}</span>${c.nao_lidas>0?`<span class="wa-conv-num">${Number(c.nao_lidas)}</span>`:''}</span>
    </button>`).join('');
}
const WA_SITUACAO = { enviada:'✓', entregue:'✓✓', lida:'✓✓ lida', erro:'não enviada' };
function waDesenharChat(){
  const tela = document.querySelector('#view-whatsapp .wa-tela'); if(!tela) return;
  tela.classList.toggle('chat-aberto', !!waAberta);
  const chat = tela.querySelector('.wa-chat'), nome = tela.querySelector('.wa-chat-nome'), resp = tela.querySelector('.wa-respostas');
  const c = waConvs.find(x=>x.jid===waAberta);
  nome.textContent = waAberta ? waNomeConversa(c) + (c && c.telefone && c.nome_contato ? ' · ' + waFormatarNumero(c.telefone) : '') : '';
  const enviar = document.getElementById('waEnviar'), texto = document.getElementById('waTexto');
  if(enviar) enviar.disabled = !waAberta; if(texto) texto.disabled = !waAberta;
  if(!waAberta){ chat.innerHTML = `<p class="sub wa-vazio">Escolha uma conversa à esquerda.</p>`; resp.innerHTML=''; return; }
  let dia = '';
  chat.innerHTML = waMsgs.map(m=>{
    const d = waDia(m.criada_em), sep = d!==dia ? `<div class="wa-dia">${h(d)}</div>` : ''; dia = d;
    let corpo;
    if(m.tipo==='imagem') corpo = `<span class="wa-midia-rotulo">Foto</span>${m.texto?`<span class="wa-texto">${h(m.texto)}</span>`:''}<button type="button" class="op-btn wa-ver-midia" onclick="waVerMidia(${jsArg(m.evo_id)},'imagem',null)">Ver foto</button>`;
    else if(m.tipo==='documento') corpo = `<span class="wa-midia-rotulo">${h(m.arquivo_nome||'Documento')}</span>${m.texto?`<span class="wa-texto">${h(m.texto)}</span>`:''}<button type="button" class="op-btn wa-ver-midia" onclick="waVerMidia(${jsArg(m.evo_id)},'documento',${jsArg(m.arquivo_nome||'documento.pdf')})">Abrir PDF</button>`;
    else if(m.tipo==='audio') corpo = `<span class="wa-midia-rotulo">Áudio recebido — ouça no celular da lanchonete</span>`;
    else if(m.tipo==='outro') corpo = `<span class="wa-texto">${h(m.texto||'Mensagem que o Commandah não mostra — veja no celular')}</span>`;
    else corpo = `<span class="wa-texto">${h(m.texto||'')}</span>`;
    const meta = `<small class="wa-meta">${m.direcao==='saida' && m.enviada_por ? h(m.enviada_por)+' · ' : ''}${h(waHora(m.criada_em))}${m.direcao==='saida' && m.situacao ? ' · '+h(WA_SITUACAO[m.situacao]||'') : ''}</small>`;
    return `${sep}<div class="wa-bolha ${m.direcao==='saida'?'saida':'entrada'}">${corpo}${meta}</div>`;
  }).join('') || `<p class="sub wa-vazio">Carregando a conversa…</p>`;
  chat.scrollTop = chat.scrollHeight;
  // Respostas prontas: só as que têm o dado configurado.
  const prontas = [];
  const pix = String((state.settings||{}).pixKey||'').trim();
  if(pix) prontas.push(['Chave Pix', 'Nossa chave Pix: ' + pix]);
  const hor = waHorarioHoje(); if(hor) prontas.push(['Horário da cozinha', hor]);
  resp.innerHTML = prontas.map(([rot,txt])=>`<button type="button" class="wa-pronta" onclick="waUsarPronta(${jsArg(txt)})">${h(rot)}</button>`).join('');
}
function waHorarioHoje(){
  const kh = (state.settings||{}).kitchenHours; if(!kh || !kh.ativo) return '';
  const d = (kh.dias||{})[new Date().getDay()]; if(!d) return '';
  return d.fechado ? 'Hoje a cozinha não abre.' : `Hoje a cozinha funciona das ${d.abre||'11:00'} às ${d.fecha||'22:00'}.`;
}
function waUsarPronta(txt){ const t=document.getElementById('waTexto'); if(!t) return; t.value = t.value ? t.value + '\n' + txt : txt; t.focus(); }
function waDesenharCliente(){
  const box = document.querySelector('#view-whatsapp .wa-cliente'); if(!box) return;
  if(!waAberta){ box.innerHTML = ''; return; }
  const c = waConvs.find(x=>x.jid===waAberta);
  const m = c && c.member_id ? (state.members||[]).find(x=>x.id===c.member_id) : null;
  if(m){
    const aberta = (state.sales||[]).find(s=>s.status==='open' && s.memberId===m.id);
    const deve = Math.max(0, Number(m.debt)||0);
    if(box.dataset.membro===m.id+'|'+(aberta?aberta.id:'')+'|'+deve) return;
    box.dataset.membro = m.id+'|'+(aberta?aberta.id:'')+'|'+deve;
    box.innerHTML = `<h4>Cliente</h4><p class="wa-cli-nome">${m.code?`<span class="tag tag-gray">Cota ${h(m.code)}</span> `:''}<b>${h(m.name)}</b></p>
      <p class="sub">${aberta ? 'Comanda aberta' : 'Sem comanda aberta'}</p>
      <p class="sub">${deve>TOLERANCIA_CENTAVO ? 'Deve ' + h(fmt(deve)) : 'Sem saldo devedor'}</p>
      <button type="button" class="op-btn" onclick="waVincular(null)">Trocar cliente</button>`;
    return;
  }
  if(box.dataset.membro==='busca' && box.querySelector('#waBuscaCliente')) return;
  box.dataset.membro = 'busca';
  box.innerHTML = `<h4>Vincular a um cliente</h4><p class="sub">Ligue esta conversa ao cadastro para ver a cota e a conta.</p>
    <input id="waBuscaCliente" type="search" placeholder="Nome ou cota" aria-label="Buscar cliente por nome ou cota" oninput="waBuscarCliente(this.value)"><div class="wa-opcoes-cliente"></div>`;
}
function waBuscarCliente(txt){
  const box = document.querySelector('#view-whatsapp .wa-opcoes-cliente'); if(!box) return;
  const t = String(txt||'').trim().toLowerCase();
  if(!t){ box.innerHTML=''; return; }
  const achados = (state.members||[]).filter(m=>m.active!==false && !m.archived && (String(m.code||'').toLowerCase()===t || String(m.name||'').toLowerCase().includes(t))).slice(0,8);
  box.innerHTML = achados.length ? achados.map(m=>`<button type="button" class="wa-opcao-cliente" onclick="waVincular(${jsArg(m.id)})">${m.code?`<b>${h(m.code)}</b> · `:''}${h(m.name)}</button>`).join('') : `<p class="sub">Nenhum cliente encontrado.</p>`;
}
async function waVincular(memberId){
  const jid = waAberta; if(!jid) return;
  const r = await supabaseClient.rpc('whatsapp_vincular_cliente', { p_jid: jid, p_member_id: memberId });
  if(r.error){ toast('Não deu para ligar a conversa ao cliente.', 'erro'); return; }
  const c = waConvs.find(x=>x.jid===jid); if(c) c.member_id = memberId;
  const box = document.querySelector('#view-whatsapp .wa-cliente'); if(box) box.dataset.membro = '';
  waDesenharCliente();
}
async function waEnviar(){
  const t = document.getElementById('waTexto'), b = document.getElementById('waEnviar'), err = document.querySelector('#view-whatsapp .wa-erro-envio');
  if(!t || !waAberta || (b && b.disabled && b.dataset.enviando)) return;
  const texto = t.value.trim(); if(!texto) return;
  const jid = waAberta;
  if(b){ b.disabled = true; b.dataset.enviando = '1'; b.textContent = 'Enviando…'; }
  if(err) err.textContent = '';
  const r = await waInvocar({ action:'enviar_texto', jid, texto });
  if(b){ b.disabled = !waAberta; delete b.dataset.enviando; b.textContent = 'Enviar'; }
  if(!r.ok){ if(err) err.textContent = r.erro || WA_FALHA; return; } // o texto fica no campo para tentar de novo
  if(t.value.trim()===texto) t.value = '';
  if(jid===waAberta){
    waMsgs.push({ evo_id:r.mensagem && r.mensagem.evo_id, direcao:'saida', tipo:'texto', texto, enviada_por:(currentUser&&currentUser.name)||'', situacao:'enviada', criada_em:(r.mensagem&&r.mensagem.criada_em)||new Date().toISOString() });
    waDesenharChat();
  }
  waCarregarConversas();
}
async function waVerMidia(evoId, tipo, nome){
  const r = await waInvocar({ action:'midia', evo_id: evoId });
  if(!r.ok){ toast(r.erro || WA_FALHA, 'erro'); return; }
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(r.mime||'')) ? r.mime : 'application/octet-stream';
  const b64 = String(r.base64||'').replace(/^data:[^,]*,/, '');
  if(!/^[A-Za-z0-9+/=]+$/.test(b64)){ toast(WA_FALHA, 'erro'); return; }
  if(tipo==='imagem'){
    openModal('Foto recebida', `<img class="wa-foto" alt="Foto recebida no WhatsApp" src="data:${h(mime)};base64,${h(b64)}">`);
    return;
  }
  const bytes = Uint8Array.from(atob(b64), ch=>ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type:mime }));
  const a = document.createElement('a'); a.href = url; a.download = String(nome||'documento.pdf').replace(/[\\/:*?"<>|]/g,'_'); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 30000);
}
