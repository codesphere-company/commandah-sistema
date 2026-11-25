/* ============ WHATSAPP: CONFIGURAÇÃO (25/11, etapa 1) ============
   Configurações › WhatsApp: conectar o número separado da lanchonete lendo o QR (Evolution API, plano Pro).
   Tudo passa pela Edge Function "whatsapp" (a chave da Evolution nunca vem para o navegador). O caixa vê a
   situação; conectar e desconectar é do administrador (a função confere). Desenho:
   docs/superpowers/specs/2026-11-25-whatsapp-design.md. */
let waPollTimer = null;
const WA_FORA_DO_AR = 'Não foi possível falar com o WhatsApp agora. Tente de novo em alguns segundos.';

async function waChamar(action){
  try {
    const r = await supabaseClient.functions.invoke('whatsapp', { body:{ action } });
    if(r.error){
      let corpo = null; try { corpo = await r.error.context.json(); } catch(e){ /* sem corpo */ }
      return { ok:false, erro:(corpo && corpo.erro) || WA_FORA_DO_AR };
    }
    return r.data || { ok:false, erro:WA_FORA_DO_AR };
  } catch(e){ return { ok:false, erro:WA_FORA_DO_AR }; }
}
// "5544999990000" -> "(44) 9 9999-0000"; outro formato volta como veio.
function waFormatarNumero(n){
  const d = String(n||'').replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');
  if(d.length===11) return `(${d.slice(0,2)}) ${d[2]} ${d.slice(3,7)}-${d.slice(7)}`;
  if(d.length===10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return d || '';
}
function waPararPoll(){ if(waPollTimer){ clearTimeout(waPollTimer); waPollTimer=null; } }

function openWhatsAppSettings(){
  if(!requirePerm('whatsapp')) return;
  waPararPoll();
  openModal('WhatsApp', `<div id="waBox" class="wa-config" aria-live="polite"><p class="sub wa-carregando">Conferindo o WhatsApp…</p></div>`);
  waAtualizar();
}

async function waAtualizar(){
  const s = await waChamar('situacao');
  if(!document.getElementById('waBox')) return;
  waDesenhar(s);
}

function waDesenhar(s, erro){
  const box = document.getElementById('waBox'); if(!box) return;
  waPararPoll();
  if(!s || !s.ok){ box.innerHTML = `<p class="wa-erro" role="alert">${h((s&&s.erro)||WA_FORA_DO_AR)}</p><button class="op-btn" type="button" onclick="waAtualizar()">Tentar de novo</button>`; return; }
  if(s.plano_pro===false){
    box.innerHTML = `<h3 style="margin:0 0 8px;font-size:17px">WhatsApp no Commandah faz parte do plano Pro</h3>
      <ul class="sub" style="margin:0 0 12px;padding-left:20px;line-height:1.5"><li>Conversas do WhatsApp da lanchonete dentro do sistema, com aviso quando chega mensagem.</li><li>Mandar a conta da comanda com Pix copia e cola e QR.</li><li>No fiado, a conta vai sozinha na hora que a comanda fecha.</li></ul>
      <p class="sub">Para ligar, fale com a equipe do Commandah.</p>`;
    return;
  }
  const chip = s.situacao==='conectado'
    ? `<span class="tag tag-green">Conectado${s.numero?' · '+h(waFormatarNumero(s.numero)):''}</span>`
    : s.situacao==='aguardando_qr' ? `<span class="tag tag-amber">Aguardando leitura do QR</span>` : `<span class="tag tag-gray">Desconectado</span>`;
  const aviso = (erro||s.aviso) ? `<p class="wa-erro" role="alert">${h(erro||s.aviso)}</p>` : '';
  let corpo = '';
  if(s.situacao==='aguardando_qr' && s.qr){
    corpo = `<div class="wa-qr-linha" style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;margin:12px 0">
      <img class="wa-qr" src="${h(s.qr)}" alt="QR para conectar o WhatsApp" width="200" height="200" style="border:1px solid var(--c-border);border-radius:8px;background:#fff">
      <ol class="sub" style="margin:0;padding-left:20px;line-height:1.6;flex:1;min-width:200px"><li>Pegue o celular do <b>número só da lanchonete</b>.</li><li>No WhatsApp, toque em <b>Aparelhos conectados</b> › <b>Conectar um aparelho</b>.</li><li>Aponte a câmera para este QR.</li></ol></div>`;
  }
  const separado = s.situacao!=='conectado' ? `<p class="wa-aviso" style="background:var(--c-warning-soft);color:var(--c-warning);border-radius:10px;padding:10px 12px;line-height:1.45"><b>Use um número separado.</b> Esta conexão não é a oficial do WhatsApp, e o WhatsApp pode bloquear o número. Não conecte o número que os clientes já usam.</p>` : '';
  const botoes = !s.pode_conectar ? `<p class="sub">Só o administrador conecta ou desconecta o número.</p>`
    : s.situacao==='conectado' ? `<button class="op-btn" type="button" id="waDesconectar" onclick="waDesconectar()">Desconectar</button>`
    : `<button class="op-btn primary" type="button" id="waConectar" onclick="waConectar()">${s.situacao==='aguardando_qr'?'Gerar QR de novo':'Conectar número'}</button>`;
  box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><b style="flex:1">Número da lanchonete</b>${chip}</div>${aviso}${corpo}${separado}<div style="display:flex;gap:10px;margin-top:12px">${botoes}</div>
    <p class="sub" style="margin-top:14px">Conexão feita com a Evolution API.</p>`;
  // Enquanto espera a leitura, confere a cada 3 s (para ao fechar a janela ou ao conectar).
  if(s.situacao==='aguardando_qr') waPollTimer = setTimeout(()=>{ if(document.getElementById('waBox')) waAtualizar(); }, 3000);
}

async function waConectar(){
  const b = document.getElementById('waConectar'); if(b){ b.disabled=true; b.textContent='Conectando…'; }
  const r = await waChamar('conectar');
  if(!document.getElementById('waBox')) return;
  if(!r.ok){ const s = await waChamar('situacao'); waDesenhar(s.ok?s:{ ok:true, plano_pro:true, pode_conectar:true, situacao:'desconectado' }, r.erro); return; }
  logAction('WhatsApp: QR gerado para conectar o número');
  waDesenhar({ ok:true, plano_pro:true, pode_conectar:true, situacao:r.situacao, qr:r.qr, numero:null });
}

async function waDesconectar(){
  const ok = await askConfirm({ title:'Desconectar o WhatsApp?', message:'O Commandah para de receber e de mandar mensagens por este número até conectar de novo.', confirmLabel:'Desconectar', cancelLabel:'Voltar' });
  if(!ok) return;
  const r = await waChamar('desconectar');
  if(!document.getElementById('waBox')) return;
  if(!r.ok){ const s = await waChamar('situacao'); waDesenhar(s, r.erro); return; }
  logAction('WhatsApp: número desconectado');
  waAtualizar();
}
