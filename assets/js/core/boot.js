/* Se o jsdelivr não entregou o SDK, tenta de novo por ele e depois pelo unpkg.
   Cada tentativa injeta uma tag nova: a <script> original já falhou e não recarrega. */
const SUPABASE_SDK_URLS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js',
  'https://unpkg.com/@supabase/supabase-js@2.117.0/dist/umd/supabase.js'
];
// Mesmo arquivo nos dois CDNs (conferido byte a byte): mesmo hash.
const SUPABASE_SDK_SRI = 'sha384-xPW3QHswsICVC2mW6BFNwMbhpLkbZ133fKOhxNx3QGGgAOJfL3O9t8r2aWn1aez6';
function loadScriptOnce(src, timeoutMs, integrity){
  return new Promise(resolve=>{
    const s = document.createElement('script');
    const timer = setTimeout(()=>{ s.onload = s.onerror = null; resolve(false); }, timeoutMs);
    if(integrity){ s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    s.src = src;
    s.onload = ()=>{ clearTimeout(timer); resolve(true); };
    s.onerror = ()=>{ clearTimeout(timer); resolve(false); };
    document.head.appendChild(s);
  });
}
async function loadSupabaseSdkFallback(){
  for(const url of SUPABASE_SDK_URLS){
    await loadScriptOnce(url, 8000, SUPABASE_SDK_SRI);
    if(window.supabase && typeof window.supabase.createClient==='function') return true;
  }
  return false;
}
/* Tela de "sem servidor" no boot. Não existe mais Modo Local: vender gravando só
   no aparelho parecia funcionar, mas nada subia pro servidor. Aqui o app espera
   e tenta de novo sozinho a cada BOOT_RETRY_MS. */
const BOOT_RETRY_MS = 10000;
let bootRetryTimer = null;
function renderBootNetworkError(sub){
  const overlay = document.getElementById('tenantSetupOverlay');
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--c-bg);position:fixed;inset:0;z-index:999;padding:20px;overflow:auto;';
  overlay.innerHTML = '<div class="login-box" style="max-width:440px"><div class="login-brand login-brand--commandah"><img class="login-mark" src="assets/marca/horizontal-cor.svg" alt="Commandah"><img class="login-mark-dk" src="assets/marca/horizontal-cor-escuro.svg" alt=""></div><h1>Sem conexão com o servidor</h1><p class="sub">'+(sub||'Você continua logado, mas o servidor não respondeu. Confira a internet e toque em Recarregar.')+'</p><p class="sub">Tentando de novo automaticamente...</p><button class="btn btn-primary btn-block" onclick="location.reload()">Recarregar</button></div>';
  clearTimeout(bootRetryTimer);
  bootRetryTimer = setTimeout(boot, BOOT_RETRY_MS);
}
function hideBootNetworkError(){
  clearTimeout(bootRetryTimer); bootRetryTimer = null;
  const overlay = document.getElementById('tenantSetupOverlay');
  overlay.style.display = 'none'; overlay.innerHTML = '';
}
async function boot(){
  const hasClaudeStorage = window.storage && typeof window.storage.get==='function' && typeof window.storage.set==='function';
  if(hasClaudeStorage){ storageApi = await createStorageAdapter(); startApp(); return; }
  const ready = await waitForSupabaseSdk(6000) || await loadSupabaseSdkFallback();
  if(!ready){
    renderBootNetworkError('O sistema não conseguiu carregar. Confira a internet e toque em Recarregar.');
    return;
  }
  if(bootRetryTimer!==null) hideBootNetworkError();
  if(!supabaseClient) supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(session){
    const resolved = await resolveTenantSession(session.user.id);
    if(resolved && resolved.networkError){
      // Sessão salva e válida, só o servidor não respondeu: mandar pra tela de
      // e-mail/senha faria o operador achar que foi deslogado.
      renderBootNetworkError();
      return;
    }
    if(resolved){
      sessionIsOwner = resolved.isOwner;
      setTenantId(resolved.tenantId);
      storageApi = buildSupabaseStorageApi(supabaseClient, resolved.tenantId);
      startApp();
      return;
    }
  }
  renderTenantSetup();
}
boot();
