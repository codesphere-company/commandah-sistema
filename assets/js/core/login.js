/* ============ LOGIN ============ */
function renderLogin(){
  const overlay = document.getElementById('loginOverlay');
  const isDefaultOnly = state.users.length<=2 && state.users.some(u=>u.username==='admin'&&u.pin==='1234');
  const clubLogo = !!state.settings.brandLogo;
  const brandBadge = clubLogo
    ? `<img src="${state.settings.brandLogo}" alt="${h(state.settings.clubName||'Estabelecimento')}">`
    : `<img class="login-mark" src="assets/marca/horizontal-cor.svg" alt="Commandah"><img class="login-mark-dk" src="assets/marca/horizontal-cor-escuro.svg" alt="">`;
  overlay.innerHTML = `
  <div class="login-box">
    ${clubLogo?`<div class="login-powered">${ICN.brandmark(undefined,undefined,18)}<span>Commandah</span></div>`:''}
    <div class="login-brand${clubLogo?'':' login-brand--commandah'}">${brandBadge}</div>
    ${state.settings.clubName?`<h1>${h(state.settings.clubName)}</h1>`:''}
    <p class="sub">${isDefaultOnly? 'Primeiro acesso — toque em Administrador e troque o PIN padrão em Configurações' : 'Selecione seu usuário para entrar'}</p>
    <div class="user-pick">${state.users.filter(u=>u.active!==false).map(u=>`
      <button onclick="startPin(${jsArg(u.id)})"><div class="un">${h(u.name)}</div><div class="ur">${h(roleLabel(u.role))}</div></button>
    `).join('')}</div>
    <p class="login-privacy"><button type="button" class="link-btn" onclick="openPrivacyNotice()">Aviso de privacidade</button></p>
  </div>`;
  overlay.classList.remove('hide');
  document.getElementById('app').classList.remove('show');
}
function shadeColor(hex,amount){const clean=/^#[0-9a-f]{6}$/i.test(hex)?hex:'#3568b0',n=parseInt(clean.slice(1),16),r=Math.max(0,Math.min(255,(n>>16)+amount)),g=Math.max(0,Math.min(255,((n>>8)&255)+amount)),b=Math.max(0,Math.min(255,(n&255)+amount));return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');}
function applyBranding(){const s=state.settings||{},savedPrimary=/^#141b33$/i.test(s.brandPrimary)?'':s.brandPrimary,savedAccent=/^#0ea57e$/i.test(s.brandAccent)?'':s.brandAccent,primary=/^#[0-9a-f]{6}$/i.test(savedPrimary)?savedPrimary:'#1D2433',accent=/^#[0-9a-f]{6}$/i.test(savedAccent)?savedAccent:'#0D9E79',root=document.documentElement;root.style.setProperty('--navy',primary);root.style.setProperty('--navy2',shadeColor(primary,14));root.style.setProperty('--navy3',shadeColor(primary,28));root.style.setProperty('--amber',accent);root.style.setProperty('--amber-dark',shadeColor(accent,-22));root.style.setProperty('--gc-blue',primary);document.title=(s.clubName||'Commandah')+' — Sistema de Gestão';const logo=document.querySelector('.wb-logo');if(logo){logo.innerHTML=s.brandLogo?`<img src="${s.brandLogo}" alt="">`:ICN.brandmark(undefined,undefined,26);logo.style.background='transparent';}const sub=document.getElementById('wbTitle');if(sub)sub.textContent=s.clubName||'Sistema de gestão';
  // Pedido do dono (31/10): logado num estabelecimento, o topo do menu mostra o logo e o nome dele
  // no lugar da marca Commandah (que volta se o nome estiver vazio).
  const club=document.getElementById('wbClub'),wrap=document.getElementById('wbTitleWrap'),nome=String(s.clubName||'').trim();
  if(club){club.textContent=nome;club.title=nome;}if(wrap)wrap.classList.toggle('has-club',!!nome);
  document.querySelector('.winbar')?.classList.toggle('has-club-logo',!!s.brandLogo);}
// Tela de descanso das TVs (monitor da cozinha em Modo TV e Painel de Senhas) quando não há pedido:
// logo e nome do estabelecimento; sem logo, a marca Commandah.
function telaDescansoHtml(msg){const s=state.settings||{},nome=String(s.clubName||'').trim();
  const logo=s.brandLogo?`<img class="tela-descanso-logo" src="${h(s.brandLogo)}" alt="">`:`<span class="tela-descanso-logo">${ICN.brandmark(undefined,undefined,140)}</span>`;
  return `<div class="tela-descanso">${logo}${nome?`<div class="tela-descanso-nome">${h(nome)}</div>`:''}${msg?`<p class="tela-descanso-msg">${h(msg)}</p>`:''}</div>`;}
function roleLabel(r){ return r==='admin'?'Administrador':r==='caixa'?'Operador de caixa':'Cozinha'; }
function startPin(userId){
  pinTargetUser = state.users.find(u=>u.id===userId);
  if(!pinTargetUser||pinTargetUser.active===false){toast('Este colaborador está inativo.');renderLogin();return;}
  pinBuffer = '';
  const overlay = document.getElementById('loginOverlay');
  overlay.innerHTML = `
  <div class="login-box">
    <h1>${h(pinTargetUser.name)}</h1>
    <p class="sub">Digite seu PIN de ${pinLengthFor(pinTargetUser)} dígitos</p>
    <div class="pin-dots" id="pinDots">${'<span></span>'.repeat(pinLengthFor(pinTargetUser))}</div>
    <div class="pin-pad">
      ${[1,2,3,4,5,6,7,8,9].map(n=>`<button onclick="pinPress(${jsArg(n)})">${n}</button>`).join('')}
      <button onclick="renderLogin()">Voltar</button>
      <button onclick="pinPress('0')">0</button>
      <button onclick="pinBackspace()">⌫</button>
    </div>
  </div>`;
}
function pinPress(d){
  const len = pinLengthFor(pinTargetUser);
  if(pinBuffer.length>=len) return;
  pinBuffer += d;
  updatePinDots();
  if(pinBuffer.length===len){
    setTimeout(attemptPinLogin,150);
  }
}
/* Tentativa de PIN errado. Duas correções de uma vez:
   1. vai pro audit_log (append-only) em vez do blob;
   2. o campo passa a ser `text`, não `action` — renderLogs() e exportLogsCsv()
      filtram por l.text, então estas entradas simplesmente NÃO apareciam na tela
      de Logs. Justamente as de acesso negado. accessLogEntries() olha
      x.action||x.message, por isso o registro aqui carrega os dois nomes.
   Roda ANTES do login, com currentUser ainda null: quem tentou é pinTargetUser.
   OBS: na nuvem, nesse momento NÃO existe sessão (a tela de login vem depois do
   signOut), então o insert no audit_log é recusado e fica só o registro local da
   sessão. Isso é aceitável porque o registro que vale de PIN errado é o do
   servidor: a Edge Function staff-auth incrementa failed_attempts e grava
   locked_until em tenant_staff com service_role — inforjável pelo navegador. */
function logPinFail(){
  const nome = pinTargetUser ? pinTargetUser.name : '—';
  const texto = 'Tentativa de acesso com PIN incorreto';
  state.logs.unshift({ id:uid(), at:new Date().toISOString(), user:nome, text:texto, action:texto });
  if(state.logs.length>300) state.logs = state.logs.slice(0,300);
  if(isCloudMode() && supabaseClient){
    supabaseClient.from('audit_log')
      .insert({ action:texto, actor_name:nome, entity:'auth' })
      .then(()=>{}, ()=>{});
    return;
  }
  save('logs');
}
async function attemptPinLogin(){
  const pin = pinBuffer;
  // Colaborador já migrado pro acesso seguro: o PIN é validado pela Edge Function
  // (staff-auth), que também controla tentativas erradas com bloqueio de verdade.
  if(supabaseClient && pinTargetUser.migratedAuth){
    try{
      const { data, error } = await supabaseClient.functions.invoke('staff-auth', { body:{ action:'login', staff_id:pinTargetUser.id, pin } });
      if(error || !data || data.error){
        // supabase-js não traz o corpo do erro em "data" quando o status HTTP não é 2xx
        // (401 PIN errado, 423 bloqueado) — o texto real vem em error.context (a Response).
        let msg = data&&data.error;
        if(!msg && error&&error.context&&typeof error.context.json==='function'){
          try{ const body = await error.context.json(); msg = body&&body.error; }catch(e){}
        }
        logPinFail(); toast(msg||'PIN incorreto.'); pinBuffer=''; updatePinDots();
        return;
      }
      await supabaseClient.auth.setSession(data.session);
      currentUser = pinTargetUser; afterLogin();
    }catch(e){
      toast('Não foi possível verificar o PIN agora. Tente de novo.'); pinBuffer=''; updatePinDots();
    }
    return;
  }
  // Ainda não migrado (ou modo local sem Supabase): confere o PIN como sempre foi.
  // Na NUVEM isso agora é um beco sem saída: como o logout derruba a sessão do
  // Supabase, um usuário não migrado entraria sem sessão nenhuma (papel `anon`),
  // com toda leitura e escrita recusada pela RLS — o app abriria quebrado, com
  // banner de falha ao salvar a cada ação. Melhor barrar na porta e dizer o que
  // fazer do que deixar entrar e falhar no meio da venda.
  if(isCloudMode() && !pinTargetUser.migratedAuth){
    toast('Este colaborador ainda não tem acesso seguro. Peça a um administrador para reabrir o cadastro dele em Colaboradores e salvar, que a conta é criada.');
    pinBuffer=''; updatePinDots();
    return;
  }
  if(pinBuffer===pinTargetUser.pin){ currentUser = pinTargetUser; afterLogin(); }
  else { logPinFail(); toast('PIN incorreto.'); pinBuffer=''; updatePinDots(); }
}
function pinBackspace(){ pinBuffer = pinBuffer.slice(0,-1); updatePinDots(); }
function updatePinDots(){
  const dots = document.querySelectorAll('#pinDots span');
  dots.forEach((d,i)=> d.classList.toggle('filled', i<pinBuffer.length));
}
function afterLogin(){
  document.getElementById('loginOverlay').classList.add('hide');
  detectLocalPrintAgent();
  if(currentUser.role==='cozinha' && !document.body.classList.contains('tv-mode')){
    // Cozinha sempre entra em Modo TV (letra grande) — ambiente real não permite ficar
    // lendo texto pequeno de longe; quem quiser sair, o botão manual continua ali.
    document.body.classList.add('tv-mode');
    try{ localStorage.setItem('cantina2:tvmode','1'); }catch(e){}
  }
  if(currentUser.origem==='app' && currentUser.role!=='admin'){
    document.getElementById('garcomApp').classList.add('show');
    gcApplyDeviceTheme();
    gcRenderHome();
    toast('Bem-vindo(a), '+currentUser.name+'.');
    logAction('Login realizado (modo garçom)');
    return;
  }
  document.getElementById('app').classList.add('show');
  document.getElementById('sbUserName').textContent = currentUser.name;
  document.getElementById('sbUserRole').textContent = roleLabel(currentUser.role);
  buildNav();
  renderAll();
  toast('Bem-vindo(a), '+currentUser.name+'.');
  logAction('Login realizado');
  if(currentUser.username==='admin' && currentUser.pin==='1234') setTimeout(openForcedPinModal,0);
}
/* Logout de verdade: derruba TAMBÉM a sessão do Supabase.
   Antes só zerava currentUser — a sessão do operador que saiu continuava viva no
   navegador, e o próximo operador herdava os privilégios dela até (e SE) um login
   de usuário migrado trocasse a sessão. Com RLS por papel isso seria uma escalada
   de privilégio silenciosa: sair como admin e entrar como cozinha mantinha o
   acesso de admin no banco. */
document.getElementById('btnLogout').onclick = async ()=>{
  if(currentUser){ logAction('Logout realizado'); }
  currentUser=null;
  try{ if(supabaseClient) await supabaseClient.auth.signOut(); }catch(e){}
  sessionIsOwner = false;
  renderLogin();
};
document.getElementById('darkToggle').onchange = (e)=>{ const tema=e.target.checked?'dark':'light'; document.documentElement.setAttribute('data-theme', tema); try{ localStorage.setItem('cantina2:theme', tema); }catch(err){} };
try{ if(localStorage.getItem('cantina2:theme')==='dark'){ document.documentElement.setAttribute('data-theme','dark'); document.getElementById('darkToggle').checked=true; } }catch(e){}

