function renderTenantSetup(){
  const overlay = document.getElementById('tenantSetupOverlay');
  overlay.style.display = 'flex';
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--c-bg);position:fixed;inset:0;z-index:999;padding:20px;overflow:auto;';
  overlay.innerHTML = `<div class="login-box" style="max-width:440px">
    <div class="login-brand login-brand--commandah"><img class="login-mark" src="assets/marca/horizontal-cor.svg" alt="Commandah"><img class="login-mark-dk" src="assets/marca/horizontal-cor-escuro.svg" alt=""></div>
    <h1>Entrar no Commandah</h1>
    <p class="sub">Uma conta por estabelecimento. Compartilhe esse login (e-mail/senha) com quem for configurar outros computadores e celulares do mesmo lugar.</p>
    <div class="field" style="text-align:left"><label>E-mail</label><input id="tsEmail" type="email" placeholder="seu@email.com" autocomplete="username"></div>
    <div class="field" style="text-align:left"><label>Senha</label><input id="tsPassword" type="password" placeholder="Mínimo 6 caracteres" autocomplete="current-password"></div>
    <p id="tsError" class="sub" style="display:none;color:var(--red);text-align:left"></p>
    <div id="tsTurnstile" style="margin:10px 0"></div>
    <button class="btn btn-primary btn-block" id="tsSignInBtn" onclick="tenantSignIn()">Entrar</button>
    <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
    <p class="sub" style="text-align:left;margin-bottom:8px"><b>Ainda não tem conta? Crie o estabelecimento:</b></p>
    <div class="field" style="text-align:left"><label>Nome do estabelecimento</label><input id="tsBusinessName" placeholder="Ex: Clube Olímpico Maringá"></div>
    <button class="btn btn-block" id="tsSignUpBtn" onclick="tenantSignUp()">Criar novo estabelecimento</button>
  </div>`;
  renderTurnstileWidget();
}
function renderTurnstileWidget(){
  // O script da Cloudflare chega assíncrono: espera por ele (antes tentava uma vez só, 300 ms
  // depois, e o quadrinho "não sou robô" às vezes nunca aparecia — com captcha ligado no
  // Supabase, o login falharia).
  let tries = 0;
  const mount = ()=>{
    const box = document.getElementById('tsTurnstile');
    if(!box) return;
    if(!window.turnstile){
      if(++tries <= 66){ setTimeout(mount, 300); return; }
      tsCaptchaFailed = true;
      box.innerHTML = '<p class="sub" style="color:var(--c-danger)">A verificação "não sou robô" não carregou. Recarregue a página; se continuar, desligue o bloqueador de anúncios para este site.</p>';
      return;
    }
    if(box.childElementCount) return;
    tsCaptchaToken = null;
    tsTurnstileWidgetId = window.turnstile.render('#tsTurnstile', {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token)=>{ tsCaptchaToken = token; tsCaptchaFailed = false; },
      'expired-callback': ()=>{ tsCaptchaToken = null; },
      'error-callback': ()=>{ tsCaptchaToken = null; tsCaptchaFailed = true; }
    });
  };
  mount();
}
function resetTurnstile(){
  tsCaptchaToken = null;
  try{ if(window.turnstile && tsTurnstileWidgetId!=null) window.turnstile.reset(tsTurnstileWidgetId); }catch(e){}
}
function slugifyTenant(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,60); }
function showTenantError(msg){ const el=document.getElementById('tsError'); if(el){ el.style.display='block'; el.textContent=msg; } }
function copyTenantCode(){
  const code = getTenantId();
  navigator.clipboard?.writeText(code).then(()=>toast('Código copiado.')).catch(()=>toast('Não foi possível copiar automaticamente — selecione o texto e copie manualmente.'));
}
async function changeTenantSetup(){
  if(!confirm('Isso vai desconectar este aparelho e pedir login de novo. Os dados continuam salvos no Supabase, só esse aparelho vai precisar entrar de novo. Continuar?')) return;
  try{ if(supabaseClient) await supabaseClient.auth.signOut(); }catch(e){}
  try{ localStorage.removeItem(TENANT_KEY); }catch(e){}
  location.reload();
}
async function tenantSignIn(){
  const email = (document.getElementById('tsEmail').value||'').trim();
  const password = document.getElementById('tsPassword').value||'';
  if(!email || !password){ showTenantError('Preencha e-mail e senha.'); return; }
  if(!tsCaptchaToken && !tsCaptchaFailed){ showTenantError('Aguarde a verificação "não sou robô" (alguns segundos) e tente de novo.'); return; }
  const btn=document.getElementById('tsSignInBtn'); btn.disabled=true; btn.textContent='Entrando...';
  try{
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password, options: tsCaptchaToken ? { captchaToken: tsCaptchaToken } : {} });
    if(error){ showTenantError(/captcha/i.test(error.message||'') ? 'A verificação "não sou robô" falhou. Recarregue a página e tente de novo.' : 'E-mail ou senha incorretos.'); resetTurnstile(); return; }
    const resolved = await resolveTenantSession(data.user.id);
    if(resolved && resolved.networkError){ showTenantError('Não foi possível falar com o servidor. Confira a internet e tente de novo.'); return; }
    if(!resolved){ showTenantError('Essa conta ainda não tem um estabelecimento vinculado.'); return; }
    sessionIsOwner = resolved.isOwner;
    setTenantId(resolved.tenantId);
    // Sem isto o loadAll rodava sem a nuvem: toda leitura falhava e a tela de colaboradores
    // vinha vazia até recarregar (o boot só monta a nuvem quando já existe sessão salva).
    storageApi = buildSupabaseStorageApi(supabaseClient, resolved.tenantId);
    document.getElementById('tenantSetupOverlay').style.display = 'none';
    startApp();
  } finally { btn.disabled=false; btn.textContent='Entrar'; resetTurnstile(); }
}
async function tenantSignUp(){
  const email = (document.getElementById('tsEmail').value||'').trim();
  const password = document.getElementById('tsPassword').value||'';
  const name = (document.getElementById('tsBusinessName').value||'').trim();
  if(!email || !password || !name){ showTenantError('Preencha nome do estabelecimento, e-mail e senha.'); return; }
  if(password.length<6){ showTenantError('A senha precisa ter pelo menos 6 caracteres.'); return; }
  if(!tsCaptchaToken && !tsCaptchaFailed){ showTenantError('Aguarde a verificação "não sou robô" (alguns segundos) e tente de novo.'); return; }
  const btn=document.getElementById('tsSignUpBtn'); btn.disabled=true; btn.textContent='Criando...';
  try{
    const { data, error } = await supabaseClient.auth.signUp({ email, password, options: tsCaptchaToken ? { captchaToken: tsCaptchaToken } : {} });
    if(error){ showTenantError(/captcha/i.test(error.message||'') ? 'A verificação "não sou robô" falhou. Recarregue a página e tente de novo.' : error.message); resetTurnstile(); return; }
    if(!data.user){ showTenantError('Conta criada — verifique seu e-mail pra confirmar antes de continuar.'); return; }
    const tenantId = slugifyTenant(name) + '-' + Math.random().toString(36).slice(2,6);
    const { error: insertErr } = await supabaseClient.from('tenant_owners').insert({ user_id: data.user.id, tenant_id: tenantId, business_name: name });
    if(insertErr){ showTenantError('Conta criada, mas houve erro ao vincular o estabelecimento: '+insertErr.message); return; }
    sessionIsOwner = true; // acabou de criar a linha em tenant_owners: é o dono
    setTenantId(tenantId);
    storageApi = buildSupabaseStorageApi(supabaseClient, tenantId);
    document.getElementById('tenantSetupOverlay').style.display = 'none';
    startApp();
  } finally { btn.disabled=false; btn.textContent='Criar novo estabelecimento'; resetTurnstile(); }
}
function startApp(){
  loadAll().then(checkLocalModeLeftovers);
  setInterval(async ()=>{
    if(!currentUser) return;
    let freshOrders, orderRows, rSales, salesRows;
    try{
      if(isCloudMode()){ orderRows = await OrdersStore.changes(); salesRows = await SalesStore.changes(); } // BD-06 / EST-01: só o que mudou
      else freshOrders = await OrdersStore.load();
      if(!isCloudMode()) rSales = await storageApi.get(STORE.sales);
    }catch(e){ noteSyncResult(false); return; }
    noteSyncResult(true);
    try{
      const changedOrders = orderRows ? mergeOrderChanges(orderRows) : JSON.stringify(freshOrders) !== JSON.stringify(state.orders);
      let changedSales;
      if(salesRows) changedSales = mergeSalesChanges(salesRows);
      else {
        const freshSales = rSales ? JSON.parse(rSales.value) : [];
        changedSales = JSON.stringify(freshSales) !== JSON.stringify(state.sales);
        if(changedSales) state.sales = freshSales;
      }
      if(changedOrders && freshOrders) state.orders = freshOrders;
      if(changedOrders || changedSales){
        const cozView = document.getElementById('view-cozinha');
        if(cozView && cozView.classList.contains('active')) renderCozinha();
        const garcomApp = document.getElementById('garcomApp');
        if(garcomApp && garcomApp.classList.contains('show') && (!gcFlow || gcFlow.step==='home')) gcRenderHome();
        renderScoreboard();
      }
    }catch(e){}
  }, 6000);
  setInterval(()=>{
    const cozView = document.getElementById('view-cozinha');
    if(cozView && cozView.classList.contains('active')) renderCozinha();
    const comandasView = document.getElementById('view-comandas');
    if(comandasView && comandasView.classList.contains('active')) renderComandas();
    // OP-14: fiado lançado em outro aparelho bloqueia o sócio aqui também.
    MembersStore.refreshDebts().then(changed=>{ if(changed && !document.querySelector('#modalRoot .modal')) renderAll(); }).catch(()=>{});
    // BD-03: caixa aberto/fechado/lançado em outro aparelho aparece aqui também.
    refreshCashState().then(changed=>{ if(changed && !document.querySelector('#modalRoot .modal')) renderAll(); else if(changed) renderScoreboard(); });
  }, 30000);
  // Computador de caixa (impressão de tudo que for lançado aqui): descobre qual computador é.
  setTimeout(detectLocalPrintAgent, 3000);
  setInterval(detectLocalPrintAgent, 5*60*1000);
  // Vigia a fila de impressão: agente fechado = ficha que nunca sai no papel.
  setTimeout(()=>{ checkPrintAgentStatus().then(checkStuckPrintQueue); }, 20000);
  setInterval(()=>{ checkPrintAgentStatus().then(checkStuckPrintQueue); }, 60000);
  setTimeout(()=>{
    const overlay = document.getElementById('loginOverlay');
    const appShown = document.getElementById('app') && document.getElementById('app').classList.contains('show');
    const garcomShown = document.getElementById('garcomApp') && document.getElementById('garcomApp').classList.contains('show');
    if(overlay && (!overlay.innerHTML.trim() || overlay.querySelector('.boot-loading')) && !appShown && !garcomShown){
      // Ainda carregando não é erro: avisa e só mostra o erro se passar de 30 s.
      overlay.innerHTML = '<div class="login-box boot-loading"><h1>Carregando os dados…</h1><p class="sub">Primeira abertura neste aparelho pode levar alguns segundos.</p></div>';
      setTimeout(()=>{
        const stillLoading = overlay.querySelector('.boot-loading') && !(document.getElementById('app')||{classList:{contains:()=>false}}).classList.contains('show');
        if(stillLoading) overlay.innerHTML = '<div class="login-box"><h1>Não foi possível carregar</h1><p class="sub">A tela não terminou de carregar. Isso costuma acontecer quando o computador bloqueia algum recurso externo (rede corporativa/firewall) ou por falta de conexão à internet. Tente: 1) recarregar a página, 2) checar sua conexão, 3) se estiver numa rede de trabalho, tentar em outra rede.</p><button class="btn btn-primary btn-block" onclick="location.reload()">Recarregar</button></div>';
      }, 24000);
    }
  }, 6000);
}
