/* ============ NAV (ribbon) ============ */
let activeRibbonTab = null, activeView = null, visibleTabs = [];
let activeViewRibbonTab = null, viewHistory = [];
let activeRibbonAction = '';
const VIEW_LABELS = {caixa:'Caixa',balcao:'Ficha',comandas:'Comandas',delivery:'Delivery','fila-atendimento':'Fila de Atendimento',agendamentos:'Agendamentos',cardapio:'Cardápio Digital',cozinha:'Monitor de Cozinha',produtos:'Produtos',insumos:'Insumos',associados:'Clientes',usuarios:'Colaboradores',relatorios:'Relatórios',
  categorias:'Categorias',complementos:'Complementos e Tamanhos',observacoes:'Observações',perguntas:'Perguntas',fornecedores:'Fornecedores',pagamentos:'Formas de Pagamento',
  contascategorias:'Categorias de Contas',contas:'Contas a Pagar/Receber',locais:'Locais e Áreas do Clube',impressoras:'Impressoras',estacoes:'Estações',origens:'Origens de Pedido','config-sistema':'Configurações do Sistema',backup:'Backup',logs:'Logs',
  'painel-senhas':'Painel de Senhas',ajuda:'Ajuda e Suporte',diagnostico:'Diagnóstico de Serviços',totem:'Totem de Autoatendimento',cupons:'Promoções e Cupons',modulos:'Central de Módulos','mobile-qr':'Acesso Mobile — Garçom'};
function buildNav(){
  const allowed = rolePermissions(currentUser.role);
  const tabs = currentUser.role==='cozinha' ? SIMPLE_RIBBON_COZINHA : RIBBON_TABS;
  visibleTabs = tabs;
  activeRibbonTab = tabs[0].id;
  activeView = currentUser.role==='cozinha' ? 'cozinha' : 'comandas';
  activeViewRibbonTab=activeRibbonTab;viewHistory=[];
  renderRibbonTabs(); renderRibbonToolbar();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+activeView).classList.add('active');
  updateTitle();
}
// Permissão e clique de um item do menu (usado pelo menu lateral e pela faixa de atalhos).
function ribbonItemAction(it, allowed){
  const hasAction = !!it.action;
  const hasView = !!it.view;
  // FAIL-CLOSED. Antes era `hasView ? allowed.includes(it.view) : true`, o que
  // liberava os 39 itens de `action:` pra QUALQUER papel — o caixa via e clicava
  // em Configurações do Sistema, Bot WhatsApp (grava token), Contas a Pagar,
  // Logs, Cupons... sem precisar de devtools. Agora todo item de ação declara
  // `perm:`; item de ação SEM `perm` é negado de propósito, pra que um item novo
  // adicionado no futuro sem permissão apareça bloqueado em vez de aberto.
  // Item sem `action` e sem `view` (módulo de referência: Connect, TEF, Emissão
  // Fiscal) segue liberado — só abre um texto explicativo, não toca em dado.
  const permitted = it.perm ? allowed.includes(it.perm)
                  : hasView ? allowed.includes(it.view)
                  : !hasAction;
  if(permitted && MODULOS_EM_CONSTRUCAO.has(it.label)) return { enabled:true, emConstrucao:true, reason:'Em construção', onclick:`avisoEmConstrucao(${jsArg(h(it.label))})` };
  const reason = !hasAction && !hasView ? 'Abrir detalhes e requisitos do módulo'
    : (!permitted ? 'Sem permissão para o seu perfil' : '');
  const onclick = permitted ? (hasAction ? `${it.action}(${it.actionArg?`${jsArg(it.actionArg)}`:''})` : hasView ? `openRibbonView(${jsArg(it.view)},${jsArg(h(it.label))})` : `openReferenceModule(${jsArg(h(it.label))})`) : `toast(${jsArg(reason)})`;
  return { enabled: permitted, reason, onclick };
}
// Visual A (22/10): várias telas têm a altura em calc(100vh - Npx), com N contando a barra e as
// abas antigas do topo (158 px até 800 px de altura de tela, 177 px acima disso; medido em 22/10).
// --shell-gap devolve a diferença para o topo de agora (faixa de atalhos, ou nada na área Principal).
function updateShellGap(){
  const app = document.getElementById('app'), ribbon = document.querySelector('.ribbon'), side = document.querySelector('.sidebar');
  if(!app || !ribbon) return;
  const oldTop = innerHeight<=800 ? 158 : 177;
  const sideOnTop = side && getComputedStyle(app).flexDirection==='column' ? side.offsetHeight : 0;
  const top = sideOnTop + (ribbon.classList.contains('is-empty') ? 0 : ribbon.offsetHeight);
  document.documentElement.style.setProperty('--shell-gap', Math.max(0, oldTop-top)+'px');
}
window.addEventListener('resize', ()=>{ if(currentUser) updateShellGap(); });
// Nome no menu lateral das telas da área Principal (no ribbon eram rótulos de botão).
const SIDEBAR_LABELS = {caixa:'Caixa', comandas:'Comandas', balcao:'Ficha', delivery:'Delivery', cozinha:'Cozinha', associados:'Clientes'};
// Visual A (22/10): o menu lateral mostra direto as telas da primeira área ("Principal": caixa,
// comandas, balcão...) e, abaixo, as outras áreas; clicar numa área abre a faixa de atalhos dela.
function renderRibbonTabs(){
  const el = document.getElementById('ribbonTabs');
  const allowed = rolePermissions(currentUser.role);
  const [home, ...areas] = visibleTabs;
  const homeItems = home ? home.groups.flatMap(g=>g.items).filter(it=>!HIDDEN_MODULES.has(it.label)) : [];
  const links = homeItems.map(it=>{
    const a = ribbonItemAction(it, allowed);
    const active = activeRibbonTab===home.id && it.view && it.view===activeView;
    return `<button class="sb-link ${a.enabled?'':'disabled'} ${a.emConstrucao?'em-construcao':''} ${active?'active':''}" title="${a.reason}" onclick="activeRibbonTab=${jsArg(home.id)};${a.onclick}"><span class="ic">${it.icon||''}</span>${SIDEBAR_LABELS[it.view]||it.label}${a.emConstrucao?'<span class="selo-obra">Em construção</span>':''}</button>`;
  }).join('');
  const areaLinks = areas.map(t=>{
    const first = t.groups[0] && t.groups[0].items[0];
    return `<button class="sb-link ${t.id===activeRibbonTab?'active':''}" data-tab="${t.id}"><span class="ic">${(first&&first.icon)||''}</span>${t.label}</button>`;
  }).join('');
  el.innerHTML = links + (areaLinks ? `<div class="sb-sep">Gestão</div>${areaLinks}` : '');
  // Trocar de área abre a primeira tela da faixa (pedido do dono, 22/10): antes só a faixa mudava e
  // a tela da área anterior continuava no meio.
  el.onclick = (e)=>{ const btn=e.target.closest('button[data-tab]'); if(!btn) return; const mudou=activeRibbonTab!==btn.dataset.tab; activeRibbonTab=btn.dataset.tab; renderRibbonTabs(); renderRibbonToolbar();
    if(mudou) document.querySelector('#ribbonToolbar button[data-abre]')?.click(); };
}
function renderRibbonToolbar(){
  const el = document.getElementById('ribbonToolbar');
  const allowed = rolePermissions(currentUser.role);
  const tab = visibleTabs.find(t=>t.id===activeRibbonTab);
  // A primeira área não tem faixa: os atalhos dela já estão no menu lateral.
  el.parentElement.classList.toggle('is-empty', !tab || tab===visibleTabs[0]);
  if(!tab || tab===visibleTabs[0]){ el.innerHTML=''; updateShellGap(); return; }
  el.classList.toggle('reports-mode',tab.id==='relatorios');
  const groups = tab.groups.map(g=>({...g, items:g.items.filter(it=>!HIDDEN_MODULES.has(it.label))})).filter(g=>g.items.length);
  el.innerHTML = groups.map(g=>`
    <div class="rb-group">
      <div class="rb-icons">${g.items.map(it=>{
        const a = ribbonItemAction(it, allowed);
        // data-abre: item que abre uma tela (liberado; não conta menu suspenso, módulo de referência nem
        // "Alterar Minha Senha", que abre janela: é o primeiro liberado do caixa em Configurações).
        const abre = a.enabled && !a.emConstrucao && (it.view || (it.action && !/^toggle|^openChangePinModal$/.test(it.action)));
        return `<button class="${a.enabled?'':'disabled'} ${a.emConstrucao?'em-construcao':''} ${(it.view && it.view===activeView)||it.label===activeRibbonAction?'active':''}" title="${a.reason}"${abre?' data-abre':''}
          onclick="${a.onclick}">
          <span class="ic">${it.icon}</span><span class="lb">${it.label}</span>${a.emConstrucao?'<span class="selo-obra">Em construção</span>':''}</button>`;
      }).join('')}</div>
      <div class="rb-caption">${g.label}</div>
    </div>`).join('');
  updateShellGap();
}
function openRibbonView(viewId,label){ activeRibbonAction=label||''; switchView(viewId); }
function openReportView(label){activeRibbonAction=label;switchView('relatorios');}
function switchView(viewId){
  if(activeView&&activeView!==viewId){viewHistory.push({view:activeView,tab:activeViewRibbonTab||activeRibbonTab,action:activeRibbonAction});if(viewHistory.length>30)viewHistory.shift();}
  activeView = viewId;
  if(viewId!=='comandas') comandaAbertaId = null; // saiu da tela: voltando, mostra a lista (comandas.js)
  activeViewRibbonTab=activeRibbonTab;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+activeView).classList.add('active');
  renderRibbonTabs(); renderRibbonToolbar(); updateTitle(); renderAll();
}
function closeOperationalWindow(){
  const modalRoot=document.getElementById('modalRoot');
  if(modalRoot&&modalRoot.innerHTML.trim()){closeModal();return;}
  if(activeView==='config-sistema'&&settingsPane==='numeracao'){settingsPane='geral';activeRibbonAction='Configurações do Sistema';renderRibbonToolbar();renderConfigSistema();updateTitle();return;}
  let previous=null;while(viewHistory.length&&!previous){const candidate=viewHistory.pop();if(candidate&&candidate.view!==activeView&&document.getElementById('view-'+candidate.view))previous=candidate;}
  if(previous){activeView=previous.view;activeRibbonTab=previous.tab;activeViewRibbonTab=previous.tab;activeRibbonAction=previous.action||'';renderRibbonTabs();document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById('view-'+activeView).classList.add('active');renderRibbonToolbar();updateTitle();renderAll();return;}
  const home=currentUser&&currentUser.role==='cozinha'?'cozinha':'comandas';activeRibbonTab=currentUser&&currentUser.role==='cozinha'?'cozinha_tab':'principal';activeRibbonAction='';activeView=home;activeViewRibbonTab=activeRibbonTab;renderRibbonTabs();document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById('view-'+home).classList.add('active');renderRibbonToolbar();updateTitle();renderAll();
}
function openReferenceModule(label){ activeModuleReference=label; switchView('modulos'); }
/* Tela de Logs: exclusiva de admin/dono, coerente com o SELECT do audit_log ser
   admin-only na RLS. Hidrata state.logs a partir da tabela ANTES de trocar de
   view — sem isso a tela mostraria só o que foi logado nesta sessão do navegador,
   já que o blob cantina2:logs está congelado (histórico morto, sem escrita nova). */
async function openLogsView(label){
  if(!requirePerm('logs')) return;
  activeRibbonAction=label;
  if(label==='Erros do Sistema') await loadClientErrors(); else await loadAuditLog();
  switchView('logs');
}
/* OPS-10 (decisão do dono: tabela própria): erros de JavaScript não tratados vão para
   public.client_errors, com o mesmo erro gravado uma vez só e no máximo 20 por sessão.
   O dono vê em Configurações > Erros do Sistema. */
const _clientErrSeen = new Set(); let _clientErrCount = 0;
function reportClientError(message, source, line, col, stack){
  try{
    if(!isCloudMode() || !supabaseClient || !currentUser) return;
    const msg = String(message||'Erro sem mensagem').slice(0,2000), src = String(source||'').slice(0,500);
    if(/^(chrome|moz|safari)-extension:/.test(src) || /ResizeObserver loop/.test(msg)) return; // ruído de extensão/navegador
    const key = msg+'|'+src+'|'+(line||0);
    if(_clientErrSeen.has(key) || _clientErrCount >= 20) return;
    _clientErrSeen.add(key); _clientErrCount++;
    supabaseClient.from('client_errors').insert({
      message: msg, source: src || null, line: Number(line)||null, col: Number(col)||null,
      stack: stack ? String(stack).slice(0,8000) : null,
      ...clientErrorContext()
    }).then(()=>{}, ()=>{});
  }catch(e){}
}
// Onde e com quem o registro aconteceu: tela, aparelho, versão aberta e usuário.
function clientErrorContext(){
  const v = typeof appVersionDate==='function' ? appVersionDate() : null;
  return {
    page: String((activeView||'')+(activeRibbonAction?' / '+activeRibbonAction:'')).slice(0,500),
    user_agent: String(navigator.userAgent||'').slice(0,500),
    app_version: v ? v.toISOString().slice(0,16) : null,
    actor_name: String((currentUser&&currentUser.name)||'').slice(0,120)
  };
}
/* Diagnóstico (24/10, pedido do dono): um aviso aparece no topo e some rápido e ninguém
   consegue ler. Cada aviso que entra em #saveFailRoot ou #localModeRoot é gravado em
   client_errors com o texto, e de novo quando sai, com quanto tempo ficou na tela.
   Fonte "aviso do topo" (aparece em Erros do Sistema). No máximo 40 registros por sessão. */
const TOP_BANNER_LOG_MAX = 40;
let _topBannerLogCount = 0;
const _topBannerShownAt = new WeakMap();
function reportTopBanner(message){
  try{
    if(!isCloudMode() || !supabaseClient || !currentUser || _topBannerLogCount >= TOP_BANNER_LOG_MAX) return;
    _topBannerLogCount++;
    supabaseClient.from('client_errors').insert({ message: String(message).slice(0,2000), source: 'aviso do topo', ...clientErrorContext() }).then(()=>{}, ()=>{});
  }catch(e){}
}
function topBannerText(el){ return String(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,300); }
function watchTopBanners(){
  if(typeof MutationObserver==='undefined') return;
  const observer = new MutationObserver(records=>{
    records.forEach(r=>{
      r.addedNodes.forEach(el=>{
        if(el.nodeType!==1) return;
        _topBannerShownAt.set(el, { at: Date.now(), text: topBannerText(el) });
        reportTopBanner('Aviso apareceu: '+topBannerText(el));
      });
      r.removedNodes.forEach(el=>{
        const shown = el.nodeType===1 && _topBannerShownAt.get(el);
        if(!shown) return;
        const secs = Math.round((Date.now()-shown.at)/100)/10;
        reportTopBanner('Aviso sumiu depois de '+String(secs).replace('.',',')+' s: '+shown.text);
      });
    });
  });
  ['saveFailRoot','localModeRoot'].forEach(id=>{ const root = document.getElementById(id); if(root) observer.observe(root, { childList:true }); });
}
if(typeof document!=='undefined') watchTopBanners();
if(typeof window!=='undefined' && window.addEventListener){
  // SEG-12: o que a política de segurança bloquear também vira registro em Erros do Sistema.
  document.addEventListener('securitypolicyviolation', e=>reportClientError('CSP bloqueou '+e.effectiveDirective+': '+(e.blockedURI||'inline'), e.sourceFile||'', e.lineNumber||0, e.columnNumber||0, ''));
  window.addEventListener('error', e=>reportClientError(e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', e=>{ const r = e.reason; reportClientError((r && r.message) || String(r), 'promessa não tratada', 0, 0, r && r.stack); });
}
async function loadClientErrors(){
  state.clientErrors = [];
  if(!isCloudMode() || !supabaseClient) return;
  try{
    const { data, error } = await supabaseClient.from('client_errors')
      .select('id,at,actor_name,message,source,line,page,app_version,user_agent')
      .order('at',{ascending:false}).limit(300);
    if(!error && Array.isArray(data)) state.clientErrors = data;
  }catch(e){}
}
async function loadAuditLog(){
  if(!isCloudMode() || !supabaseClient) return; // modo Local: state.logs já é o blob
  try{
    const { data, error } = await supabaseClient
      .from('audit_log').select('id,at,actor_name,action')
      .order('at',{ascending:false}).limit(500);
    if(error || !Array.isArray(data)) return; // sem permissão ou rede fora: mantém o que tem
    // Mapeia pro formato que renderLogs/exportLogsCsv/accessLogEntries já esperam.
    const doServidor = data.map(r=>({ id:r.id, at:r.at, user:r.actor_name||'—', text:r.action||'', action:r.action||'' }));
    // Mantém no fim o histórico congelado do blob antigo (só admin/dono lê), pra
    // não perder de vista o que foi registrado antes da migração pra audit_log.
    const doBlob = (state.logs||[]).filter(l=>l && !doServidor.some(x=>x.id===l.id));
    state.logs = doServidor.concat(doBlob).slice(0,800);
  }catch(e){}
}
function openWhatsAppBotConfig(){const c=state.settings.whatsappBot||{};openModal('Bot WhatsApp',`<div class="integration-form"><div class="app-status"><b>Atendimento automatizado</b><span class="tag ${c.enabled?'tag-green':'tag-gray'}">${c.enabled?'Ativo':'Pausado'}</span></div><div class="row"><div class="field"><label>Provedor</label><select id="waProvider"><option value="">Selecione...</option><option ${c.provider==='Meta Cloud API'?'selected':''}>Meta Cloud API</option><option ${c.provider==='Provedor homologado'?'selected':''}>Provedor homologado</option></select></div><div class="field"><label>Número do WhatsApp</label><input id="waPhone" value="${h(c.phone||'')}"></div></div><div class="field"><label>Identificador da conta</label><input id="waAccount" value="${h(c.account||'')}"></div><div class="field"><label>Mensagem de boas-vindas</label><textarea id="waGreeting" rows="4">${h(c.greeting||'Olá! Como podemos ajudar?')}</textarea></div><label><input id="waEnabled" type="checkbox" ${c.enabled?'checked':''}> Ativar após validar o provedor</label><p class="sub">A operação depende de conta oficial, credenciais válidas e consentimento dos clientes.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveWhatsAppBotConfig()">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('integration-modal');}
function saveWhatsAppBotConfig(){state.settings.whatsappBot={provider:document.getElementById('waProvider').value,phone:document.getElementById('waPhone').value.trim(),account:document.getElementById('waAccount').value.trim(),greeting:document.getElementById('waGreeting').value.trim(),enabled:document.getElementById('waEnabled').checked};save('settings');closeModal();toast('Configuração do WhatsApp salva.');}
function openPixOnlineConfig(){const c=state.settings.pixOnline||{};openModal('Pix Online',`<div class="integration-form"><div class="app-status"><b>Recebimentos Pix</b><span class="tag ${c.enabled?'tag-green':'tag-gray'}">${c.enabled?'Ativo':'Não configurado'}</span></div><div class="field"><label>Instituição / Provedor</label><select id="pixProvider"><option value="">Selecione...</option><option>Banco com API Pix</option><option>Intermediador de pagamentos</option></select></div><div class="field"><label>Chave Pix do estabelecimento</label><input id="pixKeyOnline" value="${h(c.key||state.settings.pixKey||'')}"></div><div class="row"><div class="field"><label>Client ID</label><input id="pixClient" value="${h(c.clientId||'')}"></div><div class="field"><label>Ambiente</label><select id="pixEnvironment"><option>Homologação</option><option>Produção</option></select></div></div><label><input id="pixEnabled" type="checkbox" ${c.enabled?'checked':''}> Ativar cobrança Pix online</label><p class="sub">A geração e confirmação automática exigem contrato e API do provedor.</p><p class="sub">O segredo (client secret / token de API) não é cadastrado aqui: tudo que é salvo nesta tela fica visível para qualquer operador logado. Quando a integração de Pix for ligada de verdade, a credencial vai ficar guardada no servidor, nunca no navegador.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="savePixOnlineConfig()">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('integration-modal');}
function savePixOnlineConfig(){state.settings.pixOnline={provider:document.getElementById('pixProvider').value,key:document.getElementById('pixKeyOnline').value.trim(),clientId:document.getElementById('pixClient').value.trim(),environment:document.getElementById('pixEnvironment').value,enabled:document.getElementById('pixEnabled').checked};save('settings');closeModal();toast('Configuração do Pix Online salva.');}
let pendingNfeItems=[],pendingNfeMeta={};
function openNfeStockWindow(){pendingNfeItems=[];pendingNfeMeta={};openModal('Alterar Estoque com NFe',`<div class="nfe-stock-body"><div class="nfe-import-head"><div><b>Importar XML da Nota Fiscal Eletrônica</b><p class="sub">Selecione o XML para conferir a nota, os vínculos e as quantidades antes da entrada.</p><input id="nfeXmlFile" type="file" accept=".xml,text/xml,application/xml"></div><button class="op-btn" onclick="readNfeXml()">▧ &nbsp; Ler XML</button></div><div id="nfeSummary" class="nfe-summary"><div><small>Fornecedor</small><b>—</b></div><div><small>Número</small><b>—</b></div><div><small>Série</small><b>—</b></div><div><small>Emissão</small><b>—</b></div><div><small>Total</small><b>R$ 0,00</b></div></div><div class="finance-grid nfe-preview"><table><thead><tr><th style="width:44px"><input type="checkbox" checked onchange="document.querySelectorAll('.nfe-apply').forEach(x=>x.checked=this.checked);updateNfeSelection()"></th><th>Código</th><th>Produto da NFe</th><th>Quantidade</th><th>Un.</th><th>Valor Unitário</th><th>Vincular ao Insumo</th></tr></thead><tbody id="nfePreviewRows"><tr><td colspan="7" class="empty">Nenhum arquivo carregado.</td></tr></tbody></table></div><div class="nfe-actions"><span id="nfeSelectionStatus" class="sub">0 item selecionado</span><div class="right"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="op-btn" onclick="clearNfeImport()">Limpar</button><button class="consumer-save" onclick="applyNfeStock()">✓ Atualizar Estoque</button></div></div></div>`,true);document.querySelector('#modalRoot .modal').classList.add('nfe-stock-modal');}
function xmlValue(node,name){return node.getElementsByTagName(name)[0]?.textContent?.trim()||'';}
function nfeNormalized(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();}
function findNfeInsumo(item){return state.insumos.find(ins=>(item.code&&String(ins.nfeCode||ins.code||'')===String(item.code))||nfeNormalized(ins.name)===nfeNormalized(item.name));}
function clearNfeImport(){pendingNfeItems=[];pendingNfeMeta={};const file=document.getElementById('nfeXmlFile');if(file)file.value='';document.getElementById('nfeSummary').innerHTML='<div><small>Fornecedor</small><b>—</b></div><div><small>Número</small><b>—</b></div><div><small>Série</small><b>—</b></div><div><small>Emissão</small><b>—</b></div><div><small>Total</small><b>R$ 0,00</b></div>';document.getElementById('nfePreviewRows').innerHTML='<tr><td colspan="7" class="empty">Nenhum arquivo carregado.</td></tr>';updateNfeSelection();}
function updateNfeSelection(){const checked=[...document.querySelectorAll('.nfe-apply:checked')],linked=checked.filter(x=>document.getElementById('nfeLink'+x.dataset.index)?.value).length,total=checked.reduce((sum,x)=>sum+(pendingNfeItems[Number(x.dataset.index)]?.qty||0)*(pendingNfeItems[Number(x.dataset.index)]?.unitValue||0),0),status=document.getElementById('nfeSelectionStatus');if(status)status.textContent=`${checked.length} item(ns) selecionado(s) • ${linked} vinculado(s) • ${fmt(total)}`;}
function readNfeXml(){const file=document.getElementById('nfeXmlFile').files[0];if(!file){toast('Selecione um arquivo XML.');return;}const reader=new FileReader();reader.onload=()=>{const xml=new DOMParser().parseFromString(reader.result,'application/xml');if(xml.querySelector('parsererror')){toast('XML inválido.');return;}const inf=xml.getElementsByTagName('infNFe')[0],emit=xml.getElementsByTagName('emit')[0],ide=xml.getElementsByTagName('ide')[0],total=xml.getElementsByTagName('ICMSTot')[0];pendingNfeMeta={key:String(inf?.getAttribute('Id')||'').replace(/^NFe/,''),number:xmlValue(ide,'nNF'),series:xmlValue(ide,'serie'),issuedAt:xmlValue(ide,'dhEmi')||xmlValue(ide,'dEmi'),supplier:xmlValue(emit,'xNome'),document:xmlValue(emit,'CNPJ')||xmlValue(emit,'CPF'),total:Number(xmlValue(total,'vNF'))||0,fileName:file.name};const imports=state.settings.nfeImports||[];if(pendingNfeMeta.key&&imports.some(x=>x.key===pendingNfeMeta.key)){pendingNfeItems=[];toast('Esta NFe já foi aplicada ao estoque.');return;}pendingNfeItems=[...xml.getElementsByTagName('det')].map((det,i)=>{const p=det.getElementsByTagName('prod')[0];return{id:'nfe-'+i,code:xmlValue(p,'cProd'),name:xmlValue(p,'xProd'),qty:Number(xmlValue(p,'qCom'))||0,unit:xmlValue(p,'uCom'),unitValue:Number(xmlValue(p,'vUnCom'))||0};});document.getElementById('nfeSummary').innerHTML=`<div title="${h(pendingNfeMeta.supplier)}"><small>Fornecedor</small><b>${h(pendingNfeMeta.supplier||'Não informado')}</b></div><div><small>Número</small><b>${h(pendingNfeMeta.number||'—')}</b></div><div><small>Série</small><b>${h(pendingNfeMeta.series||'—')}</b></div><div><small>Emissão</small><b>${pendingNfeMeta.issuedAt?h(pendingNfeMeta.issuedAt.slice(0,10).split('-').reverse().join('/')):'—'}</b></div><div><small>Total</small><b>${fmt(pendingNfeMeta.total)}</b></div>`;document.getElementById('nfePreviewRows').innerHTML=pendingNfeItems.length?pendingNfeItems.map((x,i)=>{const match=findNfeInsumo(x);return`<tr><td><input class="nfe-apply" data-index="${i}" type="checkbox" checked onchange="updateNfeSelection()"></td><td>${h(x.code)}</td><td>${h(x.name)}</td><td>${x.qty}</td><td>${h(x.unit)}</td><td>${fmt(x.unitValue)}</td><td><select id="nfeLink${i}" onchange="updateNfeSelection()"><option value="">Não vincular</option>${state.insumos.map(ins=>`<option value="${ins.id}" ${match&&match.id===ins.id?'selected':''}>${h(ins.name)}</option>`).join('')}</select></td></tr>`;}).join(''):'<tr><td colspan="7" class="empty">A NFe não contém itens de produto.</td></tr>';updateNfeSelection();};reader.onerror=()=>toast('Não foi possível ler o arquivo.');reader.readAsText(file);}
function applyNfeStock(){if(!pendingNfeItems.length){toast('Carregue uma NFe antes de atualizar.');return;}const imports=state.settings.nfeImports||[];if(pendingNfeMeta.key&&imports.some(x=>x.key===pendingNfeMeta.key)){toast('Esta NFe já foi aplicada ao estoque.');return;}const selected=[...document.querySelectorAll('.nfe-apply:checked')].map(x=>Number(x.dataset.index));if(!selected.length){toast('Selecione ao menos um item.');return;}const missing=selected.filter(i=>!document.getElementById('nfeLink'+i)?.value);if(missing.length){toast(`Vincule os ${missing.length} item(ns) selecionado(s) a um insumo.`);return;}const applied=[],at=new Date().toISOString();selected.forEach(i=>{const x=pendingNfeItems[i],id=document.getElementById('nfeLink'+i).value,ins=state.insumos.find(y=>y.id===id);if(!ins)return;const before=Number(ins.stock)||0;ins.stock=before+x.qty;ins.costPerUnit=x.unitValue||ins.costPerUnit;if(x.code&&!ins.nfeCode)ins.nfeCode=x.code;state.stockMovements.unshift({id:uid(),type:'entrada',name:ins.name,unit:ins.unit,operation:`NFe ${pendingNfeMeta.number||''}`.trim(),reference:pendingNfeMeta.key||pendingNfeMeta.fileName,before,qty:x.qty,after:ins.stock,user:currentUser.name,at});applied.push({code:x.code,name:x.name,qty:x.qty,unit:x.unit,unitValue:x.unitValue,insumoId:ins.id});});if(!applied.length){toast('Nenhum item pôde ser atualizado.');return;}state.settings.nfeImports=imports;imports.unshift({...pendingNfeMeta,id:uid(),importedAt:at,user:currentUser.name,items:applied});save('insumos');save('stockMovements');save('settings');closeModal();renderAll();toast(`${applied.length} item(ns) atualizado(s) pela NFe ${pendingNfeMeta.number||''}.`);}
function closeRibbonFlyout(){document.querySelectorAll('.ribbon-flyout').forEach(x=>x.remove());}
function toggleAppRibbonMenu(kind){const anchor=event.currentTarget,existing=document.querySelector('.ribbon-flyout');if(existing){existing.remove();return;}const box=document.createElement('div'),r=anchor.getBoundingClientRect();box.className='ribbon-flyout';box.style.left=Math.max(4,Math.min(r.left,window.innerWidth-275))+'px';box.style.top=r.bottom+'px';box.innerHTML=kind==='bina'?`<button onclick="closeRibbonFlyout();openBinaConfig()"><span style="font-size:25px">⚙</span> Ativar / Configurar</button><button onclick="closeRibbonFlyout();openCallHistory()"><span style="font-size:25px">📞</span> Histórico de Chamadas</button>`:`<button onclick="closeRibbonFlyout();openMapKeyConfig()"><span style="font-size:25px">🔑</span> Definir Chave Para Mapas</button><button onclick="closeRibbonFlyout();reprocessMemberGeolocation()"><span style="font-size:25px">⚙</span> Reprocessar Geolocalização</button><button onclick="closeRibbonFlyout();openCustomerMap()"><span style="font-size:25px">🗺️</span> Mapa de Clientes</button>`;document.body.appendChild(box);}
function openBinaConfig(){const cfg=state.settings.bina||{};openModal('Configuração da Bina',`<div class="app-config-body"><div class="app-status"><b>Identificação de chamadas</b><span class="tag tag-gray">${cfg.enabled?'Ativa':'Pausada'}</span></div><div class="field"><label>Modelo / Dispositivo</label><select id="binaModel"><option value="">Selecione...</option><option ${cfg.model==='Serial'?'selected':''}>Serial</option><option ${cfg.model==='Rede'?'selected':''}>Rede</option></select></div><div class="row"><div class="field"><label>Porta</label><input id="binaPort" value="${h(cfg.port||'')}"></div><div class="field"><label>Velocidade</label><select id="binaBaud"><option>9600</option><option>19200</option><option>115200</option></select></div></div><label><input id="binaEnabled" type="checkbox" ${cfg.enabled?'checked':''}> Ativar identificação de chamadas</label><p class="sub">O funcionamento depende de equipamento compatível e driver instalado neste computador.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveBinaConfig()">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
function saveBinaConfig(){state.settings.bina={enabled:document.getElementById('binaEnabled').checked,model:document.getElementById('binaModel').value,port:document.getElementById('binaPort').value.trim(),baud:document.getElementById('binaBaud').value};save('settings');closeModal();toast('Configuração da Bina salva.');}
function openCallHistory(){const list=state.settings.callHistory||[],rows=list.map(x=>`<tr><td>${reportDateTime(x.at)}</td><td>${h(x.phone)}</td><td>${h(x.customer||'Não identificado')}</td><td>${h(x.duration||'00:00')}</td><td>${h(x.status||'Recebida')}</td><td><button class="op-mini" onclick="openCallRecord(${jsArg(x.id)})">✎</button></td></tr>`).join('');openModal('Histórico de Chamadas',`<div class="op-toolbar"><div class="op-search"><input placeholder="Pesquisar telefone ou cliente..." oninput="filterModalTable(this.value)"></div><div class="op-toolbar-spacer"></div><button class="op-btn" onclick="window.print()">▣ Imprimir</button><button class="op-btn primary" onclick="openCallRecord()">＋ Registrar</button></div><div class="finance-grid" style="height:430px"><table><thead><tr><th>Data/Hora</th><th>Telefone</th><th>Cliente</th><th>Duração</th><th>Status</th><th>Editar</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">Nenhuma chamada registrada neste dispositivo.</td></tr>'}</tbody></table></div>`,true);}
function openCallRecord(id){closeModal();const list=state.settings.callHistory||[],item=id?list.find(x=>x.id===id):null;openModal(item?'Editar Chamada':'Registrar Chamada',`<div class="consumer-form-frame"><div class="row"><div class="field"><label>Data e hora</label><input id="callAt" type="datetime-local" value="${item?new Date(item.at).toISOString().slice(0,16):new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}"></div><div class="field"><label>Telefone</label><input id="callPhone" value="${h(item&&item.phone||'')}"></div></div><div class="field"><label>Cliente</label><input id="callCustomer" value="${h(item&&item.customer||'')}"></div><div class="row"><div class="field"><label>Duração</label><input id="callDuration" type="time" step="1" value="${h(item&&item.duration||'00:00:00')}"></div><div class="field"><label>Status</label><select id="callStatus">${['Recebida','Não atendida','Retornada','Bloqueada'].map(x=>`<option ${item&&item.status===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="field"><label>Observações</label><textarea id="callNotes">${h(item&&item.notes||'')}</textarea></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveCallRecord(${jsArg(id||'')})">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
function saveCallRecord(id){const phone=document.getElementById('callPhone').value.trim(),at=document.getElementById('callAt').value;if(!phone||!at){toast('Informe data e telefone.');return;}state.settings.callHistory=state.settings.callHistory||[];const item=state.settings.callHistory.find(x=>x.id===id),data={phone,at:new Date(at).toISOString(),customer:document.getElementById('callCustomer').value.trim(),duration:document.getElementById('callDuration').value,status:document.getElementById('callStatus').value,notes:document.getElementById('callNotes').value.trim()};if(item)Object.assign(item,data);else state.settings.callHistory.unshift({id:uid(),...data});save('settings');closeModal();toast('Chamada registrada.');}
function openMapKeyConfig(){openModal('Definir Chave Para Mapas',`<div class="app-config-body"><div class="field"><label>Provedor</label><select id="mapProvider"><option>Google Maps</option><option>OpenStreetMap</option></select></div><div class="field"><label>Chave de acesso</label><input id="mapKey" type="password" value="${h(state.settings.mapKey||'')}"></div><p class="sub">A geocodificação externa depende de uma chave válida e das condições do provedor escolhido.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="state.settings.mapKey=document.getElementById('mapKey').value.trim();save('settings');closeModal();toast('Chave de mapas salva.')">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
async function reprocessMemberGeolocation(){const withAddress=state.members.filter(m=>m.address),configured=!!state.settings.mapKey;await MembersStore.bulkSetGeoStatus(withAddress, configured?'Pendente de consulta ao provedor':'Aguardando chave do provedor');toast(`${withAddress.length} cliente(s) colocado(s) na fila de geolocalização.`);}
function openCustomerMap(){const rows=state.members.map(m=>`<tr><td>${h(m.name)}</td><td>${h([m.address,m.addressNumber].filter(Boolean).join(', ')||'—')}</td><td>${h(m.district||'—')}</td><td>${m.latitude&&m.longitude?`${m.latitude}, ${m.longitude}`:h(m.geoStatus||'Sem coordenadas')}</td><td><button class="op-mini" onclick="openMemberCoordinates(${jsArg(m.id)})">✎</button></td></tr>`).join('');openModal('Mapa de Clientes',`<div class="app-config-body"><div class="op-toolbar"><div class="op-search"><input placeholder="Pesquisar cliente..." oninput="filterModalTable(this.value)"></div><span class="op-toolbar-spacer"></span><button class="op-btn" onclick="reprocessMemberGeolocation()">↻ Reprocessar</button></div><div class="finance-grid" style="height:390px;margin-top:12px"><table><thead><tr><th>Cliente</th><th>Endereço</th><th>Bairro</th><th>Coordenadas / Situação</th><th>Editar</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">Nenhum cliente cadastrado.</td></tr>'}</tbody></table></div></div>`);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
function openMemberCoordinates(id){closeModal();const m=state.members.find(x=>x.id===id);if(!m)return;openModal('Coordenadas — '+m.name,`<div class="consumer-form-frame"><p>${h([m.address,m.addressNumber,m.district,m.city,m.uf].filter(Boolean).join(', '))}</p><div class="row"><div class="field"><label>Latitude</label><input id="memberLatitude" type="number" step="any" value="${h(m.latitude||'')}"></div><div class="field"><label>Longitude</label><input id="memberLongitude" type="number" step="any" value="${h(m.longitude||'')}"></div></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveMemberCoordinates(${jsArg(id)})">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
async function saveMemberCoordinates(id){const m=state.members.find(x=>x.id===id),lat=parseFloat(document.getElementById('memberLatitude').value),lng=parseFloat(document.getElementById('memberLongitude').value);if(!m||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180){toast('Informe latitude e longitude válidas.');return;}await MembersStore.saveGeo(id,{latitude:lat,longitude:lng,geoStatus:'Localizado manualmente'});closeModal();toast('Coordenadas salvas.');}
function openScaleConfig(){const c=state.settings.scale||{};openModal('Configuração da Balança',`<div class="scale-config"><h4>Configurar</h4><label><input id="scaleCertified" type="checkbox" ${c.certified!==false?'checked':''}> Mostrar somente modelos homologados</label><div class="field"><label>Modelo</label><select id="scaleModel"><option value="">Selecione...</option><option>Toledo</option><option>Filizola</option><option>Urano</option><option>Elgin</option></select></div><div class="row"><div class="field"><label>Intervalo (ms)</label><input id="scaleInterval" type="number" value="${Number(c.interval)||1000}"></div><div class="field"><label>Timeout (ms)</label><input id="scaleTimeout" type="number" value="${Number(c.timeout)||3000}"></div></div><div class="row"><div class="field"><label>Porta</label><select id="scalePort"><option></option><option>COM1</option><option>COM2</option><option>COM3</option></select></div><div class="field"><label>Baud</label><select id="scaleBaud"><option>9600</option><option>19200</option><option>115200</option></select></div></div><div class="row"><div class="field"><label>Data Bits</label><select id="scaleData"><option>8</option><option>7</option></select></div><div class="field"><label>Stop Bits</label><select id="scaleStop"><option>1</option><option>2</option></select></div></div><div class="field" style="width:50%"><label>Paridade</label><select id="scaleParity"><option>Nenhuma</option><option>Par</option><option>Ímpar</option></select></div><h4>Método de captura do peso na tela do pedido:</h4><div class="scale-capture"><label><input type="radio" name="scaleCapture" value="manual" ${c.capture!=='auto'?'checked':''}> <span><b>Padrão (Recomendado)</b> — captura ao confirmar o peso.</span></label><label><input type="radio" name="scaleCapture" value="auto" ${c.capture==='auto'?'checked':''}> <span><b>Automático</b> — detecta o peso ao pesar o item.</span></label></div><h4>Ativar</h4><label><input id="scaleEnabled" type="checkbox" ${c.enabled?'checked':''}> Integração com a balança</label><p class="sub">A ativação real exige balança conectada e driver compatível.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveScaleConfig()">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('scale-config-modal');}
function saveScaleConfig(){state.settings.scale={certified:document.getElementById('scaleCertified').checked,model:document.getElementById('scaleModel').value,interval:Number(document.getElementById('scaleInterval').value)||1000,timeout:Number(document.getElementById('scaleTimeout').value)||3000,port:document.getElementById('scalePort').value,baud:document.getElementById('scaleBaud').value,dataBits:document.getElementById('scaleData').value,stopBits:document.getElementById('scaleStop').value,parity:document.getElementById('scaleParity').value,capture:document.querySelector('input[name="scaleCapture"]:checked').value,enabled:document.getElementById('scaleEnabled').checked};save('settings');closeModal();toast('Configuração da balança salva.');}
function openAppModuleConfig(name){const modules=state.settings.appModules||{},c=modules[name]||{},profiles={'Mobile':{fields:['Código do estabelecimento','Chave de sincronização'],options:['Sincronizar produtos','Sincronizar clientes','Permitir lançamento de pedidos']},'Connect':{fields:['Endereço do servidor','Token de acesso'],options:['Sincronizar automaticamente','Registrar falhas na fila de eventos']},'Emissão Fiscal':{fields:['CNPJ do emitente','Série fiscal'],options:['Ambiente de homologação','Enviar documento após finalizar pedido']},'TEF':{fields:['Código da loja','Terminal lógico'],options:['Exigir confirmação da operadora','Imprimir comprovante']}}[name]||{fields:['Identificador','Credencial'],options:['Ativar sincronização']};openModal(name,`<div class="app-config-body"><div class="app-status"><b>${h(name)}</b><span class="tag ${c.enabled?'tag-green':'tag-gray'}">${c.enabled?'Configurado':'Não configurado'}</span></div><p><b>Integração ainda não implementada neste sistema.</b> Nada é enviado a nenhum serviço${name==='Emissão Fiscal'?' e nenhuma nota fiscal é emitida':''}, mesmo com a opção ativada.</p>${profiles.fields.map((label,i)=>`<div class="field"><label>${label}</label><input id="appField${i}" ${i?'type="password"':''} value="${h((c.fields||[])[i]||'')}"></div>`).join('')}<div class="field"><label>Ambiente</label><select id="appEnvironment"><option ${c.environment==='Homologação'?'selected':''}>Homologação</option><option ${c.environment==='Produção'?'selected':''}>Produção</option></select></div>${profiles.options.map((label,i)=>`<label style="display:block;margin:10px 0"><input class="appOption" type="checkbox" ${c.options&&c.options[i]?'checked':''}> ${label}</label>`).join('')}<label style="display:block;margin-top:16px"><input id="appEnabled" type="checkbox" ${c.enabled?'checked':''}> Ativar após validar licença, credenciais e equipamento</label><p class="sub">O que for digitado aqui fica salvo nas configurações do estabelecimento, que todos os operadores conseguem ler. Não digite senhas, tokens ou certificados reais.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="op-btn" onclick="testAppModuleConfig(${jsArg(name)})">Testar requisitos</button><button class="consumer-save" onclick="saveAppModuleConfig(${jsArg(name)},${profiles.fields.length})">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
function saveAppModuleConfig(name,count){state.settings.appModules=state.settings.appModules||{};state.settings.appModules[name]={fields:Array.from({length:count},(_,i)=>document.getElementById('appField'+i).value.trim()),environment:document.getElementById('appEnvironment').value,options:[...document.querySelectorAll('.appOption')].map(x=>x.checked),enabled:document.getElementById('appEnabled').checked};save('settings');closeModal();toast('Configuração de '+name+' salva.');}
function testAppModuleConfig(name){const fields=[...document.querySelectorAll('[id^="appField"]')];if(fields.some(x=>!x.value.trim())){toast('Preencha os identificadores e credenciais antes do teste.');return;}toast('Requisitos locais preenchidos. A conexão real depende do serviço contratado.');}
function openSubscriptionView(){
  activeRibbonAction='Minha Assinatura';renderRibbonToolbar();
  openModal('Minha Assinatura',`<div class="record-body"><div style="display:flex;align-items:center;gap:16px;padding:8px 4px 18px"><span style="font-size:48px">🔑</span><h2 style="font-size:25px">Minha Assinatura</h2></div><div class="panel" style="min-height:210px"><b>${h(state.settings.clubName||'Sistema de Gestão')}</b><p>Edição local personalizada.<br>Não vinculada a uma assinatura externa.</p></div><div class="settings-section"><b>Recursos adicionais</b><p class="sub">Planos, testes temporários e licenças externas dependem de contrato e credenciais do respectivo fornecedor.</p><button class="op-btn" onclick="toast('Nenhum serviço de assinatura externa foi configurado.')">↗ Consultar requisitos</button></div><div class="record-actions"><button class="op-btn primary" onclick="toast('Registro de assinatura requer um serviço contratado e credenciais válidas.')">Registrar licença externa</button></div></div>`,true);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');document.querySelector('#modalRoot .modal').style.maxWidth='630px';
}
// Destaca na faixa o atalho aberto (antes nem Promoções nem Cupons ficavam marcados).
function openMarketingView(sub){ marketingSub=sub||'cupons'; activeRibbonAction={promocoes:'Promoções',fidelidade:'Fidelidade'}[marketingSub]||'Cupons'; switchView('cupons'); }
function toggleMarketingRibbonMenu(kind){const anchor=event.currentTarget,existing=document.querySelector('.ribbon-flyout');if(existing){existing.remove();return;}const box=document.createElement('div'),r=anchor.getBoundingClientRect();box.className='ribbon-flyout';box.style.left=Math.max(4,Math.min(r.left,window.innerWidth-275))+'px';box.style.top=r.bottom+'px';box.innerHTML=`<button onclick="closeRibbonFlyout();openSmartCampaignConfig()"><span style="font-size:25px">⚙</span> Configurar Serviço</button><button onclick="closeRibbonFlyout();openSmartCampaigns()"><span style="font-size:25px">📣</span> Campanhas</button>`;document.body.appendChild(box);}
// Fidelidade: a tela antiga (openLoyaltyCampaign/saveLoyaltyCampaign) gravava settings.loyalty
// com outro formato ({name,rate,days,enabled}) e apagava a configuração real de cupons.js
// ({active,valuePerPoint,minimum,rounding}), que applyAutomaticLoyalty lê nas vendas. Saiu;
// o atalho Fidelidade abre renderFidelidade via openMarketingView('fidelidade').
function openLoyaltyResults(){const members=state.members||[],points=members.reduce((a,m)=>a+Number(m.points||0),0);openModal('Resultados da Fidelidade',`<div class="grid3" style="padding:14px"><div class="stat"><div class="lbl">Clientes participantes</div><div class="val">${members.filter(m=>Number(m.points||0)>0).length}</div></div><div class="stat"><div class="lbl">Pontos em circulação</div><div class="val">${points}</div></div><div class="stat"><div class="lbl">Média por cliente</div><div class="val">${members.length?(points/members.length).toFixed(1):'0'}</div></div></div><div class="finance-grid" style="height:390px"><table><thead><tr><th>Cliente</th><th>Pontos</th><th>Saldo de Fiado</th><th>Situação</th></tr></thead><tbody>${members.map(m=>`<tr><td>${h(m.name)}</td><td>${Number(m.points)||0}</td><td>${fmt(m.debt)}</td><td>${Number(m.points||0)>0?'Participante':'Sem pontos'}</td></tr>`).join('')}</tbody></table></div>`,true);}
function openSmsWindow(){const messages=state.settings.smsMessages||[],configured=!!(state.settings.sms&&state.settings.sms.provider),rows=messages.map(m=>`<tr><td>${reportDateTime(m.createdAt)}</td><td>${h(m.recipient)}</td><td>${h(m.message)}</td><td>${h(m.scheduledAt?reportDateTime(m.scheduledAt):'Imediato')}</td><td>${h(m.status)}</td><td><button class="op-mini" onclick="openSmsComposer(${jsArg(m.id)})">✎</button></td></tr>`).join('');openModal('SMS',`<div class="sms-window-body"><div class="sms-toolbar"><button class="history-refresh" onclick="openSmsServiceConfig()">⚙ &nbsp; Configurar Serviço</button><span class="op-toolbar-spacer"></span><button class="op-btn" onclick="window.print()">▣ &nbsp; Imprimir</button><button class="op-btn primary" onclick="openSmsComposer()">＋ &nbsp; Novo SMS</button></div>${configured?`<div class="finance-grid" style="height:430px"><table><thead><tr><th>Criado em</th><th>Destinatário</th><th>Mensagem</th><th>Agendamento</th><th>Status</th><th>Editar</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">Nenhuma mensagem cadastrada.</td></tr>'}</tbody></table></div>`:`<div class="sms-welcome"><span class="sms-icon">💬</span><h2>Serviço de SMS não configurado</h2><p>Cadastre um provedor e credenciais válidas para habilitar o envio. Mensagens podem ser preparadas localmente, mas não serão marcadas como enviadas sem conexão real.</p><button class="finance-link" onclick="openSmsServiceConfig()">Configurar provedor</button></div>`}</div>`,true);document.querySelector('#modalRoot .modal').classList.add('sms-window-modal');}
function openSmsComposer(id){closeModal();const list=state.settings.smsMessages||[],item=id?list.find(x=>x.id===id):null,memberOptions=state.members.map(m=>`<option value="${h(m.phone||'')}" ${item&&item.recipient===m.phone?'selected':''}>${h(m.name)} — ${h(m.phone||'sem telefone')}</option>`).join('');openModal(item?'Editar SMS':'Novo SMS',`<div class="consumer-form-frame"><div class="field"><label>Destinatário</label><select id="smsRecipient"><option value="">Selecione um cliente...</option>${memberOptions}</select></div><div class="field"><label>Mensagem</label><textarea id="smsMessage" rows="6" maxlength="480" oninput="document.getElementById('smsCount').textContent=this.value.length+'/480'">${h(item&&item.message||'')}</textarea><small id="smsCount">${String(item&&item.message||'').length}/480</small></div><div class="row"><div class="field"><label>Envio</label><select id="smsTiming" onchange="document.getElementById('smsSchedule').disabled=this.value==='Imediato'"><option ${!item||!item.scheduledAt?'selected':''}>Imediato</option><option ${item&&item.scheduledAt?'selected':''}>Agendado</option></select></div><div class="field"><label>Data e hora</label><input id="smsSchedule" type="datetime-local" ${!item||!item.scheduledAt?'disabled':''} value="${item&&item.scheduledAt?new Date(item.scheduledAt).toISOString().slice(0,16):''}"></div></div></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveSmsMessage(${jsArg(id||'')})">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
function saveSmsMessage(id){const recipient=document.getElementById('smsRecipient').value,message=document.getElementById('smsMessage').value.trim(),scheduled=document.getElementById('smsTiming').value==='Agendado'?document.getElementById('smsSchedule').value:'';if(!recipient||!message||(document.getElementById('smsTiming').value==='Agendado'&&!scheduled)){toast('Informe destinatário, mensagem e agendamento.');return;}state.settings.smsMessages=state.settings.smsMessages||[];const item=state.settings.smsMessages.find(x=>x.id===id),data={recipient,message,scheduledAt:scheduled?new Date(scheduled).toISOString():null,status:state.settings.sms&&state.settings.sms.provider?'Preparado':'Aguardando configuração'};if(item)Object.assign(item,data);else state.settings.smsMessages.unshift({id:uid(),createdAt:new Date().toISOString(),...data});save('settings');closeModal();toast('Mensagem salva localmente.');}
function openSmsServiceConfig(){closeModal();const c=state.settings.sms||{};openModal('Configurar Serviço de SMS',`<div class="app-config-body"><div class="field"><label>Provedor</label><select id="smsProvider"><option value="">Selecione...</option><option>Provedor HTTP</option><option>Gateway SMPP</option></select></div><div class="field"><label>Usuário / Identificador</label><input id="smsUser" value="${h(c.user||'')}"></div><div class="field"><label>Remetente</label><input id="smsSender" value="${h(c.sender||'')}"></div><p class="sub">O envio permanece indisponível até que um provedor real seja contratado e validado.</p></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="saveSmsConfig()">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
function saveSmsConfig(){state.settings.sms={provider:document.getElementById('smsProvider').value,user:document.getElementById('smsUser').value.trim(),sender:document.getElementById('smsSender').value.trim()};save('settings');closeModal();toast('Configuração de SMS salva.');}
function openSmartCampaignConfig(id){const configMode=!id&&arguments.length===0,c=state.settings.smartSender||{},campaigns=state.settings.smartCampaigns||[],item=id?campaigns.find(x=>x.id===id):null;if(configMode){openModal('Disparador Inteligente',`<div class="app-config-body"><div class="app-status"><b>Automação de relacionamento</b><span class="tag ${c.enabled?'tag-green':'tag-gray'}">${c.enabled?'Ativa':'Pausada'}</span></div><div class="field"><label>Canal padrão</label><select id="smartChannel">${['SMS','WhatsApp','E-mail'].map(x=>`<option ${c.channel===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Horário permitido para envios</label><div class="row"><input id="smartStart" type="time" value="${h(c.start||'09:00')}"><input id="smartEnd" type="time" value="${h(c.end||'18:00')}"></div></div><label><input id="smartEnabled" type="checkbox" ${c.enabled?'checked':''}> Ativar campanhas automáticas após configurar um provedor</label><p class="sub">Mensagens externas exigem provedor, consentimento dos clientes e adequação à LGPD.</p></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveSmartSenderConfig()">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');return;}openModal(item?'Editar Campanha':'Nova Campanha',`<div class="consumer-form-frame"><div class="field"><label>Campanha</label><input id="smartName" value="${h(item&&item.name||'')}"></div><div class="row"><div class="field"><label>Canal</label><select id="smartCampaignChannel">${['SMS','WhatsApp','E-mail'].map(x=>`<option ${item&&item.channel===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Público</label><select id="smartAudience">${['Todos os clientes','Aniversariantes','Clientes inativos','Clientes com pontos'].map(x=>`<option ${item&&item.audience===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="field"><label>Mensagem</label><textarea id="smartText" rows="5">${h(item&&item.message||'')}</textarea></div><div class="field"><label>Agendamento</label><input id="smartWhen" type="datetime-local" value="${item&&item.scheduledAt?new Date(item.scheduledAt).toISOString().slice(0,16):''}"></div><label><input id="smartCampaignActive" type="checkbox" ${!item||item.active?'checked':''}> Campanha ativa</label></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveSmartCampaign(${jsArg(id||'')})">✓ Salvar</button></div>`);}
function saveSmartSenderConfig(){state.settings.smartSender={channel:document.getElementById('smartChannel').value,start:document.getElementById('smartStart').value,end:document.getElementById('smartEnd').value,enabled:document.getElementById('smartEnabled').checked};save('settings');closeModal();toast('Configuração salva.');}
function saveSmartCampaign(id){const name=document.getElementById('smartName').value.trim(),message=document.getElementById('smartText').value.trim(),scheduled=document.getElementById('smartWhen').value;if(!name||!message||!scheduled){toast('Informe nome, mensagem e agendamento.');return;}state.settings.smartCampaigns=state.settings.smartCampaigns||[];const item=state.settings.smartCampaigns.find(x=>x.id===id),data={name,message,channel:document.getElementById('smartCampaignChannel').value,audience:document.getElementById('smartAudience').value,scheduledAt:new Date(scheduled).toISOString(),active:document.getElementById('smartCampaignActive').checked};if(item)Object.assign(item,data);else state.settings.smartCampaigns.unshift({id:uid(),...data});save('settings');closeModal();toast('Campanha salva.');}
function openSmartCampaigns(){const list=state.settings.smartCampaigns||[],rows=list.map(x=>`<tr ondblclick="openSmartCampaignConfig(${jsArg(x.id)})"><td>${h(x.name)}</td><td>${h(x.channel)}</td><td>${h(x.audience)}</td><td>${reportDateTime(x.scheduledAt)}</td><td>${x.active?'Ativa':'Pausada'}</td><td><button class="op-mini" onclick="openSmartCampaignConfig(${jsArg(x.id)})">✎</button></td></tr>`).join('');openModal('Campanhas do Disparador Inteligente',`<div class="op-toolbar"><div class="op-search"><input placeholder="Pesquisar campanha..." oninput="filterModalTable(this.value)"></div><div class="op-toolbar-spacer"></div><button class="op-btn" onclick="openSmartCampaignConfig('new')">＋ Nova Campanha</button></div><div class="finance-grid" style="height:420px"><table><thead><tr><th>Campanha</th><th>Canal</th><th>Público</th><th>Agendamento</th><th>Status</th><th>Editar</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">Nenhuma campanha configurada.</td></tr>'}</tbody></table></div>`,true);}
function filterModalTable(q){q=String(q||'').toLowerCase();document.querySelectorAll('#modalRoot tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q));}
function updateTitle(){ document.getElementById('wbTitle').textContent = VIEW_LABELS[activeView]||'Sistema de gestão'; }
function openChangePinModal(){
  activeRibbonAction='Alterar Minha Senha'; renderRibbonToolbar();
  openModal('Alterar Senha', `<div class="record-body" style="padding:12px 14px 0">
    <div style="border:1px solid var(--c-border-strong);padding:18px 48px 14px;background:var(--c-surface-2)">
      <div class="field"><label>Senha Atual:</label><input id="currentPin" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" autofocus></div>
      <div class="field"><label>Nova Senha:</label><input id="newPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"><small class="sub">(4 dígitos)</small></div>
      <div class="field"><label>Confirmar Nova Senha:</label><input id="confirmPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></div>
    </div><div class="record-actions"><button class="op-btn primary" id="pinSaveBtn">✓ &nbsp; Salvar</button></div></div>`);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');
  document.querySelector('#modalRoot .modal').style.maxWidth='415px';
  document.getElementById('pinSaveBtn').onclick = ()=>{
    // Colaborador com login verificado pelo servidor: o PIN não fica guardado aqui, então esta
    // tela não tem como conferir a senha atual nem trocá-la de verdade (ela só gravava no
    // cadastro local, o que nem valia no login e ainda deixava o PIN legível pros outros
    // operadores do tenant). A troca é feita em Colaboradores, que fala com o servidor.
    if(currentUser && currentUser.migratedAuth){
      toast(currentUser.role==='admin'
        ? 'Seu PIN é verificado pelo servidor. Troque em Colaboradores → editar seu cadastro → novo PIN.'
        : 'Seu PIN é verificado pelo servidor. Peça a um administrador para redefini-lo em Colaboradores.');
      return;
    }
    const current = document.getElementById('currentPin').value.trim();
    const p = document.getElementById('newPin').value.trim();
    const confirmation = document.getElementById('confirmPin').value.trim();
    if(current!==String(currentUser.pin||'')){ toast('A senha atual está incorreta.'); document.getElementById('currentPin').focus(); return; }
    if(!validPin(p)){ toast('A nova senha deve conter 4 dígitos numéricos.'); return; }
    if(p!==confirmation){ toast('A confirmação da nova senha não confere.'); return; }
    if(p===current){ toast('A nova senha deve ser diferente da senha atual.'); return; }
    currentUser.pin = p; save('users'); closeModal(); toast('PIN alterado com sucesso.');
  };
}
function openForcedPinModal(){
  openModal('Troca obrigatória do PIN', `
    <p class="sub">O PIN padrão 1234 não pode ser usado na operação. Defina um novo PIN numérico.</p>
    <div class="field"><label>Novo PIN (4 dígitos)</label><input id="forcedPin" inputmode="numeric" maxlength="4" autocomplete="new-password"></div>
    <button class="btn btn-primary btn-block" id="forcedPinSave">Salvar novo PIN</button>`, false, true);
  document.getElementById('forcedPinSave').onclick = async ()=>{
    const pin=document.getElementById('forcedPin').value.trim();
    if(!validPin(pin) || pin==='1234'){ toast('Escolha quatro dígitos diferentes do PIN padrão.'); return; }
    currentUser.pin=pin;
    if(await save('users')){ document.getElementById('modalRoot').dataset.locked='false'; closeModal(); toast('PIN alterado com sucesso.'); }
  };
}

function renderAll(){
  if(typeof aplicarModoTv==='function') aplicarModoTv(); // Modo TV só no monitor de preparo
  if(document.getElementById('garcomApp') && document.getElementById('garcomApp').classList.contains('show')){ if(!gcFlow||gcFlow.step==='home') gcRenderHome(); return; }
  renderScoreboard();
  const allowed = rolePermissions(currentUser.role);
  if(allowed.includes('caixa')){renderCaixa();enhanceCashMovementGrid();}
  if(allowed.includes('balcao')) renderBalcao();
  if(allowed.includes('comandas')) renderComandas();
  if(allowed.includes('delivery')) renderDelivery();
  if(allowed.includes('fila-atendimento')) renderFilaAtendimento();
  if(allowed.includes('agendamentos')) renderAgendamentos();
  if(allowed.includes('cardapio')) renderCardapio();
  if(allowed.includes('cozinha')) renderCozinha();
  if(allowed.includes('insumos')) renderInsumos();
  if(allowed.includes('produtos')) renderProdutos();
  if(allowed.includes('associados')) renderAssociados();
  if(allowed.includes('usuarios')) renderUsuarios();
  if(allowed.includes('relatorios')) renderRelatorios();
  if(allowed.includes('categorias')) renderCrudView('view-categorias','categorias');
  if(allowed.includes('complementos')) renderCrudView('view-complementos','complementos');
  if(allowed.includes('observacoes')) renderCrudView('view-observacoes','observacoes');
  if(allowed.includes('perguntas')) renderCrudView('view-perguntas','perguntas');
  if(allowed.includes('fornecedores')) renderCrudView('view-fornecedores','fornecedores');
  if(allowed.includes('pagamentos')) renderCrudView('view-pagamentos','paymentMethods');
  if(allowed.includes('contascategorias')) renderCrudView('view-contascategorias','contaCategorias');
  if(allowed.includes('locais')) renderCrudView('view-locais','locais');
  if(allowed.includes('quemlevou')) renderCrudView('view-quemlevou','quemLevou');
  if(allowed.includes('impressoras')) renderImpressoras();
  if(allowed.includes('estacoes')) renderEstacoes();
  if(allowed.includes('origens')) renderOrigens();
  if(allowed.includes('contas') || (contasTab==='fiado' && allowed.includes('receber-fiado'))){ renderContas(); applyFiadoStatementSettings(); }
  if(allowed.includes('config-sistema')) renderConfigSistema();
  if(allowed.includes('backup')){renderBackup();enhanceBackupActions();}
  if(allowed.includes('logs')) renderLogs();
  if(allowed.includes('painel-senhas')) renderPainelSenhas();
  if(allowed.includes('ajuda')) renderAjuda();
  if(allowed.includes('diagnostico')) renderDiagnostico();
  if(allowed.includes('totem')) renderTotem();
  if(allowed.includes('mobile-qr')) renderMobileQr();
  if(allowed.includes('cupons')) renderCupons();
  if(allowed.includes('modulos')) renderReferenceModule();
  enhanceOperationalControls();
  const archivedMembersToggle=document.querySelector('#view-associados .op-footer input[type="checkbox"]');if(archivedMembersToggle){archivedMembersToggle.disabled=false;archivedMembersToggle.title='Abrir clientes arquivados';}
  applyBackgroundImage();
}

function enhanceOperationalControls(){document.querySelectorAll('.op-controls span').forEach(control=>{const text=control.textContent.trim();if(!['×','□','▢'].includes(text))return;control.setAttribute('role','button');control.tabIndex=0;control.title=text==='×'?'Fechar janela':text==='□'?'Maximizar janela':'Restaurar janela';control.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();control.click();}};});}

function renderScoreboard(){
  const s = state.cashSession;
  updateConnectionLabel();
  const el = document.getElementById('sbCaixaStatus');
  if(s && s.status==='open'){ el.textContent='Aberto'; el.className='open'; }
  else { el.textContent='Fechado'; el.className='closed'; }
  document.getElementById('sbComandas').textContent = state.sales.filter(x=>x.status==='open').length;
  document.getElementById('sbCozinha').textContent = state.orders.filter(o=>o.status==='pendente'||o.status==='preparo').length;
  const today = todayStr();
  const vendidoHoje = state.sales.filter(s=>saleCountsAsRevenue(s) && saleRevenueDay(s)===today).reduce((sum,s)=>sum+s.total,0);
  document.getElementById('sbVendidoHoje').textContent = fmt(vendidoHoje);
}

