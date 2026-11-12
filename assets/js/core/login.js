/* ============ LOGIN ============ */
// Logo do estabelecimento conforme o tema (31/10): no modo escuro usa o logotipo para fundo escuro,
// se houver; senão, o de sempre.
function temaEscuro(){ return document.documentElement.getAttribute('data-theme')==='dark'; }
function logoDoEstabelecimento(){ const s=state.settings||{}; return (temaEscuro()&&s.brandLogoDark)||s.brandLogo||''; }
function renderLogin(){
  const overlay = document.getElementById('loginOverlay');
  const isDefaultOnly = state.users.length<=2 && state.users.some(u=>u.username==='admin'&&u.pin==='1234');
  const clubLogo = !!logoDoEstabelecimento();
  const brandBadge = clubLogo
    ? `<img class="logo-estabelecimento" src="${logoDoEstabelecimento()}" alt="${h(state.settings.clubName||'Estabelecimento')}">`
    : `<img class="login-mark" src="assets/marca/horizontal-cor.svg" alt="Commandah"><img class="login-mark-dk" src="assets/marca/horizontal-cor-escuro.svg" alt="">`;
  overlay.innerHTML = `
  <div class="login-box">
    ${clubLogo?`<div class="login-powered">${ICN.brandmark(undefined,undefined,18)}<span>Commandah</span></div>`:''}
    <div class="login-brand${clubLogo?'':' login-brand--commandah'}">${brandBadge}</div>
    ${state.settings.clubName?`<h1>${h(state.settings.clubName)}</h1>`:''}
    ${semColaboradoresNaNuvem() ? primeiroAcessoHtml() : `<p class="sub">${isDefaultOnly? 'Primeiro acesso — toque em Administrador e troque o PIN padrão em Configurações' : 'Selecione seu usuário para entrar'}</p>
    ${loginEscolhaHtml()}`}
    <p class="login-privacy"><button type="button" class="link-btn" onclick="openPrivacyNotice()">Aviso de privacidade</button></p>
  </div>`;
  overlay.classList.remove('hide');
  document.getElementById('app').classList.remove('show');
  ligarBuscaDoLogin();
}
/* Auditoria 11/11: estabelecimento novo na nuvem não ganha mais Administrador com PIN 1234.
   Sem colaborador ativo, a sessão do dono cria o Administrador aqui, já com PIN próprio de
   6 dígitos validado no servidor (create_operator recusa PIN óbvio). */
function semColaboradoresNaNuvem(){ return isCloudMode() && !state.users.some(u=>u.active!==false); }
function primeiroAcessoHtml(){
  if(!sessionIsOwner) return `<p class="sub">Nenhum colaborador cadastrado ainda. Entre neste aparelho com o e-mail e a senha do dono do estabelecimento para criar o Administrador.</p>
    <button class="btn btn-block" onclick="changeTenantSetup()">Entrar com o e-mail do dono</button>`;
  return `<p class="sub"><b>Primeiro acesso:</b> crie o Administrador. Ele entra com o PIN e cadastra os outros colaboradores.</p>
    <div class="field" style="text-align:left"><label for="paNome">Nome</label><input id="paNome" value="Administrador" maxlength="60" autocomplete="off"></div>
    <div class="field" style="text-align:left"><label for="paPin">PIN (6 dígitos)</label><input id="paPin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
    <div class="field" style="text-align:left"><label for="paPin2">Repita o PIN</label><input id="paPin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
    <p class="sub" style="text-align:left">Não use 1234, 000000 nem sequências. Não conte o PIN a ninguém.</p>
    <button class="btn btn-primary btn-block" id="paSalvar" onclick="criarPrimeiroAdmin()">Criar Administrador</button>`;
}
async function criarPrimeiroAdmin(){
  const name=(document.getElementById('paNome').value||'').trim();
  const pin=(document.getElementById('paPin').value||'').trim();
  const pin2=(document.getElementById('paPin2').value||'').trim();
  if(!name){ toast('Informe o nome do Administrador.'); return; }
  if(!validPin(pin,6)){ toast('O PIN do Administrador precisa ter 6 dígitos numéricos.'); return; }
  if(pin!==pin2){ toast('Os dois PINs não conferem.'); return; }
  if(pinFraco(pin)){ toast('Esse PIN é fácil de adivinhar. Evite 1234, 000000 e sequências.'); return; }
  const btn=document.getElementById('paSalvar'); btn.disabled=true; btn.textContent='Criando...';
  try{
    const id=uid();
    const r=await staffAuthCall({ action:'create_operator', staff_id:id, name, role:'admin', pin });
    if(r.error){ toast(r.error==='Não foi possível conferir a senha agora.'?'Não foi possível criar o Administrador agora. Confira a internet e tente de novo.':r.error); return; }
    state.users.push({ id, name, username:'admin', role:'admin', origem:'caixa', migratedAuth:true, pinLength:6, active:true });
    if(!await save('users')){ toast('O Administrador foi criado, mas o cadastro não foi salvo. Tente de novo.'); return; }
    renderLogin();
    toast('Administrador criado. Toque no nome e digite o PIN.');
  } finally { const b=document.getElementById('paSalvar'); if(b){ b.disabled=false; b.textContent='Criar Administrador'; } }
}
// 08/11 (pedido do dono): com muitos colaboradores a grade de botões ficava enorme e quebrava a tela.
// Agora: o aparelho lembra quem entrou por último ("Continuar como …", só falta o PIN) e os demais
// escolhem o nome num campo com busca (digitou, filtrou; Enter escolhe o primeiro), lista com rolagem.
function chaveUltimoLogin(){ const t=(typeof storageApi!=='undefined'&&storageApi&&storageApi.tenantId)||'local'; return 'commandah:ultimo-login:'+t; }
function lembrarUltimoLogin(id){ try{ localStorage.setItem(chaveUltimoLogin(), id); }catch(e){} }
function ultimoLoginDoAparelho(){ let id=''; try{ id=localStorage.getItem(chaveUltimoLogin())||''; }catch(e){} return state.users.find(u=>u.id===id && u.active!==false) || null; }
function semAcento(t){ return String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
function loginEscolhaHtml(){
  const ativos = state.users.filter(u=>u.active!==false).sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR'));
  const ultimo = ultimoLoginDoAparelho();
  const continuar = ultimo ? `<button class="login-continuar" onclick="startPin(${jsArg(ultimo.id)})"><span>Continuar como</span><b>${h(ultimo.name)}</b><small>${h(roleLabel(ultimo.role))}</small></button>
    <div class="login-ou">Não é você? Escolha seu nome</div>` : '';
  return `${continuar}<div class="login-busca"><input id="loginBusca" type="search" autocomplete="off" placeholder="Digite seu nome" aria-label="Seu nome"${ultimo?'':' autofocus'}>
    <div class="login-lista" id="loginLista" role="listbox">${ativos.map(u=>`<button role="option" data-nome="${h(semAcento(u.name))}" onclick="startPin(${jsArg(u.id)})"><span class="un">${h(u.name)}</span><span class="ur">${h(roleLabel(u.role))}</span></button>`).join('')}
    <p class="login-nada" id="loginNada" hidden>Nenhum nome encontrado.</p></div></div>`;
}
function ligarBuscaDoLogin(){
  const campo=document.getElementById('loginBusca'); if(!campo) return;
  const filtrar=()=>{ const q=semAcento(campo.value).trim(); let n=0;
    document.querySelectorAll('#loginLista button').forEach(b=>{ const ok=!q||b.dataset.nome.includes(q); b.hidden=!ok; if(ok) n++; });
    document.getElementById('loginNada').hidden = n>0; };
  campo.oninput=filtrar;
  campo.onkeydown=e=>{ if(e.key==='Enter'){ const b=document.querySelector('#loginLista button:not([hidden])'); if(b){ e.preventDefault(); b.click(); } } };
  if(!ultimoLoginDoAparelho()) setTimeout(()=>campo.focus(),0);
}
function shadeColor(hex,amount){const clean=/^#[0-9a-f]{6}$/i.test(hex)?hex:'#3568b0',n=parseInt(clean.slice(1),16),r=Math.max(0,Math.min(255,(n>>16)+amount)),g=Math.max(0,Math.min(255,((n>>8)&255)+amount)),b=Math.max(0,Math.min(255,(n&255)+amount));return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');}
function applyBranding(){const s=state.settings||{},savedPrimary=/^#141b33$/i.test(s.brandPrimary)?'':s.brandPrimary,savedAccent=/^#0ea57e$/i.test(s.brandAccent)?'':s.brandAccent,primary=/^#[0-9a-f]{6}$/i.test(savedPrimary)?savedPrimary:'#1D2433',accent=/^#[0-9a-f]{6}$/i.test(savedAccent)?savedAccent:'#0D9E79',root=document.documentElement;root.style.setProperty('--navy',primary);root.style.setProperty('--navy2',shadeColor(primary,14));root.style.setProperty('--navy3',shadeColor(primary,28));root.style.setProperty('--amber',accent);root.style.setProperty('--amber-dark',shadeColor(accent,-22));root.style.setProperty('--gc-blue',primary);document.title=(s.clubName||'Commandah')+' — Sistema de Gestão';const logo=document.querySelector('.wb-logo');if(logo){logo.innerHTML=logoDoEstabelecimento()?`<img src="${logoDoEstabelecimento()}" alt="">`:ICN.brandmark(undefined,undefined,26);logo.style.background='transparent';}const sub=document.getElementById('wbTitle');if(sub)sub.textContent=s.clubName||'Sistema de gestão';
  // Pedido do dono (31/10): logado num estabelecimento, o topo do menu mostra o logo e o nome dele
  // no lugar da marca Commandah (que volta se o nome estiver vazio).
  const club=document.getElementById('wbClub'),wrap=document.getElementById('wbTitleWrap'),nome=String(s.clubName||'').trim();
  // Com logo, o nome não se repete (pedido do dono, 31/10): o logo já traz o nome; o bloco de texto some.
  const comLogo=!!logoDoEstabelecimento();
  if(club){club.textContent=nome;club.title=nome;}if(wrap){wrap.classList.toggle('has-club',!!nome);wrap.classList.toggle('so-logo',comLogo);}
  document.querySelector('.winbar')?.classList.toggle('has-club-logo',!!logoDoEstabelecimento());}
// Tela de descanso das TVs (monitor da cozinha em Modo TV e Painel de Senhas) quando não há pedido:
// logo e nome do estabelecimento; sem logo, a marca Commandah.
function telaDescansoHtml(msg,titulo){const s=state.settings||{},nome=String(s.clubName||'').trim();
  const logo=logoDoEstabelecimento()?`<img class="tela-descanso-logo" src="${h(logoDoEstabelecimento())}" alt="">`:`<span class="tela-descanso-logo">${ICN.brandmark(undefined,undefined,140)}</span>`;
  const texto=titulo||(nome&&!logoDoEstabelecimento()?nome:''); // título (ex.: "Cozinha fechada") vale mais que o nome
  return `<div class="tela-descanso">${logo}${texto?`<div class="tela-descanso-nome">${h(texto)}</div>`:''}${msg?`<p class="tela-descanso-msg">${h(msg)}</p>`:''}</div>`;}
// 08/11 (pedido do dono): nomes dos perfis na tela — Administrador, Caixa, Garçom e Cozinha.
function roleLabel(r){ return r==='admin'?'Administrador':r==='caixa'?'Caixa':r==='garcom'?'Garçom':'Cozinha'; }
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
  pinTrocaObrigatoria = null;
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
      // Auditoria 11/11: PIN óbvio (1234, 0000, sequência) → troca obrigatória logo ao entrar.
      // O PIN digitado fica só nesta variável até a troca (change_own_pin confere o atual).
      pinTrocaObrigatoria = data.trocar_pin ? pin : null;
      // Auditoria 03/11 (M1): a sessão agora é do colaborador, nunca do dono. Antes o "é o dono" da
      // entrada por e-mail continuava ligado e um caixa passava nas travas "só administrador" da tela.
      sessionIsOwner = false;
      // A1: dados lidos com outra visão (ex.: aparelho aberto como caixa, entra o admin) são relidos.
      if(await visaoDaSessao()!==dadosCarregadosComo || !dadosCarregadosComo){
        const avisoCarregando = toast('Carregando os dados de '+pinTargetUser.name+'…');
        const falhou = await carregarDados();
        if(avisoCarregando) avisoCarregando.remove(); // UX lote 1: não sobra por cima da tela já aberta
        if(falhou.length){ toast('Não foi possível carregar os dados agora. Confira a internet e tente de novo.'); pinBuffer=''; updatePinDots(); return; }
      }
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
// PIN pelo teclado (pedido do dono, 06/11/2026): números da linha de cima e do teclado numérico
// (com ou sem Num Lock: e.code 'Numpad0'..'Numpad9'), Backspace apaga, Esc volta à lista.
// Só vale com a tela do PIN à vista e o foco fora de campo de texto.
document.addEventListener('keydown', e=>{
  const dots = document.getElementById('pinDots');
  if(!dots || !dots.offsetParent || !pinTargetUser) return;
  if(e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if(t && (t.tagName==='INPUT' || t.tagName==='TEXTAREA' || t.tagName==='SELECT' || t.isContentEditable)) return;
  const num = /^Numpad([0-9])$/.exec(e.code||'');
  const d = num ? num[1] : /^[0-9]$/.test(e.key) ? e.key : null;
  if(d!==null){ e.preventDefault(); pinPress(d); return; }
  if(e.key==='Backspace' || e.key==='Delete'){ e.preventDefault(); pinBackspace(); return; }
  if(e.key==='Escape'){ e.preventDefault(); renderLogin(); }
});
function updatePinDots(){
  const dots = document.querySelectorAll('#pinDots span');
  dots.forEach((d,i)=> d.classList.toggle('filled', i<pinBuffer.length));
}
function afterLogin(){
  if(currentUser) lembrarUltimoLogin(currentUser.id); // 08/11: o aparelho lembra quem entrou por último
  document.getElementById('loginOverlay').classList.add('hide');
  detectLocalPrintAgent();
  if(currentUser.role==='cozinha'){
    // Cozinha sempre entra em Modo TV (letra grande) — ambiente real não permite ficar
    // lendo texto pequeno de longe; quem quiser sair, o botão manual continua ali.
    // Só guarda a preferência: quem liga a tela é aplicarModoTv (cozinha.js), e só no monitor.
    try{ localStorage.setItem('cantina2:tvmode','1'); }catch(e){}
  }
  // 08/11 (pedido do dono): perfil Garçom entra no app do garçom; origem 'app' segue valendo para quem
  // ainda está como Caixa (compatibilidade até a troca dos perfis).
  if(currentUser.role==='garcom' || (currentUser.origem==='app' && currentUser.role!=='admin')){
    document.getElementById('garcomApp').classList.add('show');
    gcApplyDeviceTheme();
    gcRenderHome();
    // UX lote 1 (06/11): sem o aviso "Bem-vindo(a)" — o nome já aparece no topo ("Olá, …").
    logAction('Login realizado (modo garçom)');
    if(pinTrocaObrigatoria) setTimeout(openForcedPinModal,0); // 11/11: PIN óbvio troca antes de operar
    else setTimeout(mostrarNovidadesAoEntrar,0); // 08/11: aviso de novidades (sistema/novidades.js)
    return;
  }
  document.getElementById('app').classList.add('show');
  document.getElementById('sbUserName').textContent = currentUser.name;
  document.getElementById('sbUserRole').textContent = roleLabel(currentUser.role);
  buildNav();
  renderAll();
  // UX lote 1 (06/11): sem o aviso "Bem-vindo(a)" — o nome já aparece na barra de baixo (Usuário).
  logAction('Login realizado');
  // Auditoria 11/11, item 1: conta nova responde "Como você atende?" antes de qualquer outra tela.
  if(abrirPrimeiroAcessoSeNecessario()) return;
  if(currentUser.role==='admin' && telaInicialDoAdmin(state.settings)==='balcao') switchView('balcao');
  if(pinTrocaObrigatoria || (currentUser.username==='admin' && currentUser.pin==='1234')) setTimeout(openForcedPinModal,0);
  else setTimeout(mostrarNovidadesAoEntrar,0); // 08/11: aviso de novidades (sistema/novidades.js)
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
// Tema trocado: atualiza o logo do menu, da tela de login e das TVs sem redesenhar as telas.
new MutationObserver(()=>{ if(typeof state==='undefined'||!state.settings) return; applyBranding(); const src=logoDoEstabelecimento();
  document.querySelectorAll('img.logo-estabelecimento,img.tela-descanso-logo').forEach(img=>{ if(src) img.src=src; }); }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
