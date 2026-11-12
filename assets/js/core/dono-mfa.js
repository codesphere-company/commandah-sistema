/* ============ CONTA DO DONO: VERIFICAÇÃO EM DUAS ETAPAS ============ */
// Auditoria 11/11, item 3 (design em docs/superpowers/specs/2026-11-12-conta-do-dono-design.md).
// Opcional: o dono liga um código de app autenticador (TOTP do Supabase Auth). Com ele ligado, a sessão só de
// senha (aal1) não vale como dono no banco (public.dono_sessao_ok) nem nas funções nfce/staff-auth; aqui a tela
// pede o código depois da senha e ao reabrir com sessão salva. Colaborador (PIN) não passa por nada disso.

const DONO_CODIGO_ERRADO = 'Código incorreto. Confira o app e tente de novo.';

async function donoPrecisaCodigo(){
  try{
    // Com o token, o supabase-js consulta os fatores no servidor; sem ele, usa a lista guardada na sessão do
    // aparelho, que fica velha quando o dono liga o código em outro aparelho (revisão final).
    const { data: { session } } = await supabaseClient.auth.getSession();
    if(!session) return false;
    const { data, error } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token);
    return !error && !!data && data.currentLevel==='aal1' && data.nextLevel==='aal2';
  }catch(e){ return false; }
}

// Camada própria por cima de tudo: a janela comum (z-index 50) fica atrás das telas de entrada.
function donoCamada(html){
  donoFecharCamada();
  const el = document.createElement('div');
  el.id = 'donoMfaCamada'; el.className = 'dono-camada';
  el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true');
  el.innerHTML = `<div class="login-box dono-caixa">${html}</div>`;
  document.body.appendChild(el);
  return el;
}
function donoFecharCamada(){ const el=document.getElementById('donoMfaCamada'); if(el) el.remove(); }

async function donoVerificar(factorId, code){
  const ch = await supabaseClient.auth.mfa.challenge({ factorId });
  if(ch.error) return ch.error;
  const v = await supabaseClient.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
  return v.error || null;
}

// Depois da senha (ou ao reabrir com sessão só de senha): pede o código. true = sessão virou aal2.
function pedirCodigoDoDono(){
  return new Promise(async (resolve)=>{
    let fator = null;
    try{ const { data } = await supabaseClient.auth.mfa.listFactors(); fator = data && data.totp && data.totp[0]; }catch(e){}
    if(!fator){ resolve(false); return; }
    donoCamada(`<h1>Código de verificação</h1>
      <p class="sub">A conta do dono tem verificação em duas etapas. Abra o aplicativo autenticador no celular e digite o código de 6 números.</p>
      <div class="field" style="text-align:left"><label for="donoCodigoInput">Código</label><input id="donoCodigoInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"></div>
      <p id="donoCodigoErro" class="dono-erro" role="alert"></p>
      <button type="button" class="btn btn-primary btn-block" id="donoCodigoOk">Entrar</button>
      <button type="button" class="btn btn-block" id="donoCodigoCancelar" style="margin-top:8px">Cancelar</button>`);
    const input = document.getElementById('donoCodigoInput'), ok = document.getElementById('donoCodigoOk'), erro = document.getElementById('donoCodigoErro');
    setTimeout(()=>input.focus(),0);
    const tentar = async ()=>{
      const code = (input.value||'').replace(/\D/g,'');
      if(code.length!==6){ erro.textContent = 'Digite os 6 números do código.'; return; }
      ok.disabled = true; erro.textContent = '';
      const e = await donoVerificar(fator.id, code);
      ok.disabled = false;
      if(e){ erro.textContent = DONO_CODIGO_ERRADO; input.value=''; input.focus(); return; }
      donoFecharCamada(); resolve(true);
    };
    ok.onclick = tentar;
    input.onkeydown = (ev)=>{ if(ev.key==='Enter') tentar(); };
    document.getElementById('donoCodigoCancelar').onclick = async ()=>{
      try{ await supabaseClient.auth.signOut(); }catch(e){}
      donoFecharCamada(); resolve(false);
    };
  });
}

// Link na tela do PIN (só com a sessão do dono): mostra se está ligada e abre o painel.
function donoProtecaoLinkHtml(){
  if(!sessionIsOwner || !isCloudMode()) return '';
  setTimeout(atualizarDonoProtecaoLink,0);
  return `<p class="login-privacy"><button type="button" class="link-btn" id="donoProteger" onclick="abrirProtecaoDoDono()">Proteger a conta do dono</button></p>`;
}
async function atualizarDonoProtecaoLink(){
  const b = document.getElementById('donoProteger'); if(!b) return;
  try{
    const { data } = await supabaseClient.auth.mfa.listFactors();
    if(data && data.totp && data.totp.length && document.body.contains(b)) b.textContent = 'Verificação em duas etapas ligada · Gerenciar';
  }catch(e){}
}

async function abrirProtecaoDoDono(){
  let lista = { all:[], totp:[] };
  try{ const { data } = await supabaseClient.auth.mfa.listFactors(); if(data) lista = data; }catch(e){}
  const ligado = lista.totp && lista.totp[0];
  if(ligado){
    donoCamada(`<h1>Verificação em duas etapas</h1>
      <p class="sub"><b>Ligada.</b> Para entrar como dono num aparelho, além da senha, é preciso o código do aplicativo autenticador.</p>
      <p class="sub">Para desligar, digite um código atual do aplicativo.</p>
      <div class="field" style="text-align:left"><label for="donoMfaCodigo">Código</label><input id="donoMfaCodigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
      <p id="donoMfaErro" class="dono-erro" role="alert"></p>
      <button type="button" class="btn btn-danger btn-block" id="donoMfaDesligar">Desligar</button>
      <button type="button" class="btn btn-block" style="margin-top:8px" onclick="donoFecharCamada()">Fechar</button>`);
    document.getElementById('donoMfaDesligar').onclick = async ()=>{
      const code = (document.getElementById('donoMfaCodigo').value||'').replace(/\D/g,''), erro = document.getElementById('donoMfaErro');
      if(code.length!==6){ erro.textContent = 'Digite os 6 números do código.'; return; }
      const e = await donoVerificar(ligado.id, code);
      if(e){ erro.textContent = DONO_CODIGO_ERRADO; return; }
      const u = await supabaseClient.auth.mfa.unenroll({ factorId: ligado.id });
      if(u.error){ erro.textContent = 'Não foi possível desligar agora. Tente de novo.'; return; }
      donoFecharCamada(); toast('Verificação em duas etapas desligada.'); renderLogin();
    };
    return;
  }
  // Cadastro que ficou pela metade (fator não verificado) é apagado antes de começar de novo.
  for(const f of (lista.all||[]).filter(f=>f.status!=='verified')){ try{ await supabaseClient.auth.mfa.unenroll({ factorId:f.id }); }catch(e){} }
  const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType:'totp', friendlyName:'Commandah '+new Date().toISOString().slice(0,10) });
  if(error || !data){ toast('Não foi possível começar agora. Confira a internet e tente de novo.', 'erro'); return; }
  donoCamada(`<h1>Proteger a conta do dono</h1>
    <ol class="dono-passos">
      <li>Instale no celular um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou parecido).</li>
      <li>No aplicativo, escolha adicionar conta e aponte a câmera para o código abaixo.</li>
      <li>Digite aqui o código de 6 números que aparecer no aplicativo.</li>
    </ol>
    <div id="donoMfaQr" class="dono-qr"></div>
    <p class="sub">Sem câmera? Digite esta chave no aplicativo: <code id="donoMfaChave">${h(data.totp.secret)}</code></p>
    <div class="field" style="text-align:left"><label for="donoMfaCodigo">Código do aplicativo</label><input id="donoMfaCodigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
    <p id="donoMfaErro" class="dono-erro" role="alert"></p>
    <button type="button" class="btn btn-primary btn-block" id="donoMfaLigar">Ligar</button>
    <button type="button" class="btn btn-block" style="margin-top:8px" onclick="donoFecharCamada()">Agora não</button>
    <p class="sub" style="margin-top:12px">Perdeu o celular? A equipe do Commandah desliga a verificação para você entrar só com a senha.</p>`);
  const qr = document.getElementById('donoMfaQr');
  if(window.QRCode) new QRCode(qr, { text:data.totp.uri, width:180, height:180, colorDark:'#111827', colorLight:'#ffffff' });
  document.getElementById('donoMfaLigar').onclick = async ()=>{
    const code = (document.getElementById('donoMfaCodigo').value||'').replace(/\D/g,''), erro = document.getElementById('donoMfaErro');
    if(code.length!==6){ erro.textContent = 'Digite os 6 números do código.'; return; }
    const e = await donoVerificar(data.id, code);
    if(e){ erro.textContent = DONO_CODIGO_ERRADO; return; }
    donoFecharCamada(); toast('Verificação em duas etapas ligada.'); renderLogin();
  };
}
