/* ============ CAIXA EM MAIS DE UM APARELHO (BD-03) ============
   Decisão do dono: mais de um aparelho opera o caixa. Antes cada aparelho regravava
   a lista inteira de lançamentos (cantina2:cashMovements) e um apagava o do outro.
   Agora o aparelho manda só o que ELE mudou desde a última leitura (novos/editados e
   apagados) para cash_movements_apply, que aplica sobre a lista atual do servidor com
   trava e devolve a lista completa. cashMovementsBase = a lista como o servidor a tinha
   na última leitura/gravação, por id. Abrir e fechar o caixa usam cash_session_open/close
   (migration 20261010010000). */
let cashMovementsBase = new Map();
function cashMovementsMap(list){ return new Map((list||[]).filter(m=>m&&m.id).map(m=>[m.id, JSON.stringify(m)])); }
function setCashMovementsBase(list){ cashMovementsBase = cashMovementsMap(list); }
function cashMovementsDiff(baseMap, list){
  const upserts = [], ids = new Set();
  (list||[]).forEach(m=>{ if(!m || !m.id) return; ids.add(m.id); if(baseMap.get(m.id)!==JSON.stringify(m)) upserts.push(m); });
  return { upserts, deletes:[...baseMap.keys()].filter(id=>!ids.has(id)) };
}
// Mesma regra do servidor: editado fica no lugar, apagado sai, novo entra no topo.
function applyCashMovementsDiffLocal(list, d){
  const up = new Map(d.upserts.map(m=>[m.id,m])), del = new Set(d.deletes);
  const kept = (list||[]).filter(m=>!(m && del.has(m.id))).map(m=>m && up.has(m.id) ? up.get(m.id) : m);
  const keptIds = new Set(kept.map(m=>m && m.id));
  return d.upserts.filter(m=>!keptIds.has(m.id)).concat(kept);
}
async function pushCashMovements(){
  const snapshot = JSON.parse(JSON.stringify(state.cashMovements||[]));
  const d = cashMovementsDiff(cashMovementsBase, snapshot);
  if(!d.upserts.length && !d.deletes.length) return;
  const { data, error } = await supabaseClient.rpc('cash_movements_apply', { p_upserts:d.upserts, p_delete_ids:d.deletes });
  if(error) throw error;
  const server = Array.isArray(data) ? data : [];
  setCashMovementsBase(server);
  // O que mudou neste aparelho enquanto a gravação ia e voltava continua pendente.
  const later = cashMovementsDiff(cashMovementsMap(snapshot), state.cashMovements||[]);
  state.cashMovements = applyCashMovementsDiffLocal(server, later);
}
/* BD-10: o cadastro de insumos também vai por diferença. Regravar a lista inteira
   desfazia as baixas de venda feitas em outro aparelho (consume_insumos). Agora o
   aparelho manda os insumos que mudou e, no estoque, só QUANTO mudou (delta); o
   servidor soma o delta ao estoque atual (insumos_apply, migration 20261010020000).
   insumosBase = a lista como o servidor a tinha na última leitura/gravação. Quando o
   estoque muda pelo servidor (venda, estorno, contagem), markInsumoServerStock acerta
   a base para essa mudança não ser mandada de novo como delta. */
let insumosBase = new Map();
function setInsumosBase(list){ insumosBase = cashMovementsMap(list); }
function markInsumoServerStock(id, stock){
  const b = insumosBase.get(id); if(b===undefined) return;
  const o = JSON.parse(b); o.stock = stock; insumosBase.set(id, JSON.stringify(o));
}
// Insumo novo vai inteiro; insumo existente vai só com os campos que mudaram (dois
// aparelhos editando campos diferentes do mesmo insumo não se desfazem) e o estoque
// vai como delta.
function insumosDiff(baseMap, list){
  const upserts = [], deltas = {}, ids = new Set();
  (list||[]).forEach(i=>{
    if(!i || !i.id) return; ids.add(i.id);
    const b = baseMap.get(i.id); if(b===JSON.stringify(i)) return;
    if(b===undefined){ upserts.push(i); return; }
    const base = JSON.parse(b), patch = { id:i.id };
    new Set([...Object.keys(base), ...Object.keys(i)]).forEach(k=>{ if(k!=='id' && k!=='stock' && JSON.stringify(i[k])!==JSON.stringify(base[k])) patch[k] = i[k]===undefined ? null : i[k]; });
    const d = Math.round(((Number(i.stock)||0)-(Number(base.stock)||0))*1000)/1000;
    if(d) deltas[i.id] = d;
    if(Object.keys(patch).length>1 || d) upserts.push(patch);
  });
  return { upserts, deltas, deletes:[...baseMap.keys()].filter(id=>!ids.has(id)) };
}
// Mesma regra do servidor: estoque de insumo existente = estoque da lista + delta.
function applyInsumosDiffLocal(list, d){
  const up = new Map(d.upserts.map(i=>[i.id,i])), del = new Set(d.deletes);
  const out = (list||[]).filter(i=>!(i && del.has(i.id))).map(i=>{
    if(!i || !up.has(i.id)) return i;
    return { ...i, ...up.get(i.id), stock: Math.round(((Number(i.stock)||0)+(d.deltas[i.id]||0))*1000)/1000 };
  });
  const have = new Set(out.map(i=>i && i.id));
  return out.concat(d.upserts.filter(i=>!have.has(i.id) && 'name' in i));
}
async function pushInsumos(){
  const snapshot = JSON.parse(JSON.stringify(state.insumos||[]));
  const d = insumosDiff(insumosBase, snapshot);
  if(!d.upserts.length && !d.deletes.length) return;
  const { data, error } = await supabaseClient.rpc('insumos_apply', { p_upserts:d.upserts, p_deltas:d.deltas, p_delete_ids:d.deletes });
  if(error) throw error;
  const server = Array.isArray(data) ? data : [];
  setInsumosBase(server);
  const later = insumosDiff(cashMovementsMap(snapshot), state.insumos||[]);
  state.insumos = applyInsumosDiffLocal(server, later);
}
/* EST-01 (decisão do dono, 09/10: todo o histórico vai para a tabela): vendas na
   tabela public.sales, uma linha por venda (migration 20261010030000). O site continua
   trabalhando com state.sales (o JSON de sempre); o que muda é a gravação e a leitura:
   - save('sales') manda só as vendas que mudaram desde a última leitura/gravação
     (salesBase, por id) para sales_apply; venda tirada da lista vira deleted_at;
   - o poll de 6 s busca só as linhas com updated_at depois do último visto
     (salesCursor, com 15 s de folga para gravações que terminaram fora de ordem);
   - venda com mudança local ainda não gravada não é sobrescrita pelo poll.
   O blob cantina2:sales ficou só como cópia de segurança e recusa gravação. */
let salesBase = new Map(), salesCursor = null;
function setSalesBase(list){ salesBase = cashMovementsMap(list); }
function markSaleServer(sale){ if(sale && sale.id) salesBase.set(sale.id, JSON.stringify(sale)); }
function noteSalesCursor(rows){ (rows||[]).forEach(r=>{ if(r.updated_at && (!salesCursor || r.updated_at > salesCursor)) salesCursor = r.updated_at; }); }
const SalesStore = {
  async load(){
    const out = [];
    for(let from = 0; ; from += 1000){
      const { data, error } = await supabaseClient.from('sales').select('id,data,updated_at').eq('tenant_id', storageApi.tenantId)
        .is('deleted_at', null).order('seq', { ascending:true }).range(from, from + 999);
      if(error) throw error;
      noteSalesCursor(data); out.push(...(data||[]).map(r=>r.data));
      if(!data || data.length < 1000) break;
    }
    setSalesBase(out);
    return out;
  },
  async changes(){
    const since = salesCursor ? new Date(new Date(salesCursor).getTime() - 15000).toISOString() : '1970-01-01T00:00:00Z';
    const { data, error } = await supabaseClient.from('sales').select('id,data,updated_at,deleted_at').eq('tenant_id', storageApi.tenantId)
      .gt('updated_at', since).order('updated_at', { ascending:true }).limit(1000);
    if(error) throw error;
    noteSalesCursor(data);
    return data || [];
  }
};
// Junta no state.sales o que mudou no servidor. Devolve true se algo mudou na tela.
function mergeSalesChanges(rows){
  let changed = false;
  rows.forEach(r=>{
    const idx = state.sales.findIndex(x=>x && x.id===r.id), local = idx>-1 ? state.sales[idx] : null;
    if(local && salesBase.get(r.id)!==JSON.stringify(local)) return; // mudança local ainda indo para o servidor
    if(r.deleted_at){ if(idx>-1){ state.sales.splice(idx,1); changed = true; } salesBase.delete(r.id); return; }
    const js = JSON.stringify(r.data);
    if(local && JSON.stringify(local)===js){ salesBase.set(r.id, js); return; }
    if(idx>-1) state.sales[idx] = r.data; else state.sales.push(r.data);
    salesBase.set(r.id, js); changed = true;
  });
  return changed;
}
// Dois aparelhos na mesma venda (migration 20261011020000): cada venda vai com a versão que
// este aparelho tinha lido (salesBase). Se no banco ela mudou nesse meio tempo, o banco não grava
// e devolve a versão atual; aqui as duas mudanças são juntadas (mergeSaleThreeWay) e a venda é
// gravada de novo. Auditoria 03/11 (B2): a versão antiga do sales_apply (sem trava) saiu do banco.
function mergeArrayThreeWay(base, local, server, keyFn){
  const b = new Map((base||[]).map(i=>[keyFn(i), i])), l = new Map((local||[]).map(i=>[keyFn(i), i]));
  const out = [];
  (server||[]).forEach(i=>{
    const k = keyFn(i);
    if(b.has(k) && !l.has(k)) return; // tirado neste aparelho
    out.push(l.has(k) && b.has(k) && JSON.stringify(l.get(k))!==JSON.stringify(b.get(k)) ? l.get(k) : i); // mudado aqui
  });
  const seen = new Set(out.map(keyFn));
  (local||[]).forEach(i=>{ const k = keyFn(i); if(!b.has(k) && !seen.has(k)) out.push(i); }); // novo aqui
  return out;
}
function mergeSaleThreeWay(base, local, server){
  if(!server) return null; // apagada em outro aparelho
  base = base || {};
  const out = JSON.parse(JSON.stringify(server));
  new Set([...Object.keys(base), ...Object.keys(local)]).forEach(k=>{
    if(k==='items' || k==='partialPayments') return;
    if(JSON.stringify(base[k])!==JSON.stringify(local[k])){ if(local[k]===undefined) delete out[k]; else out[k] = local[k]; }
  });
  out.items = mergeArrayThreeWay(base.items, local.items, server.items, comandaItemKey);
  if(base.partialPayments || local.partialPayments || server.partialPayments) out.partialPayments = mergeArrayThreeWay(base.partialPayments, local.partialPayments, server.partialPayments, p=>p.id);
  if(out.status==='open') out.total = saleTotal(out.items);
  return out;
}
async function pushSales(){
  for(let attempt = 0; attempt < 3; attempt++){
    const snapshot = JSON.parse(JSON.stringify(state.sales||[]));
    const d = cashMovementsDiff(salesBase, snapshot);
    if(!d.upserts.length && !d.deletes.length) return;
    const bases = {};
    d.upserts.forEach(u=>{ const b = salesBase.get(u.id); if(b) bases[u.id] = JSON.parse(b); });
    const res = await supabaseClient.rpc('sales_apply', { p_upserts:d.upserts, p_delete_ids:d.deletes, p_bases:bases });
    if(res.error) throw res.error;
    const conflicts = (res.data && res.data.conflicts) || [];
    const conflictIds = new Set(conflicts.map(c=>c.id));
    d.upserts.filter(u=>!conflictIds.has(u.id)).forEach(markSaleServer); d.deletes.forEach(id=>salesBase.delete(id));
    if(!conflicts.length) return;
    conflicts.forEach(c=>{
      const idx = state.sales.findIndex(x=>x && x.id===c.id);
      if(c.data) salesBase.set(c.id, JSON.stringify(c.data)); else salesBase.delete(c.id);
      // Auditoria 03/11 (A4): venda fechada só muda por administrador; o banco recusa e devolve a venda
      // como está. Vale a do servidor (sem juntar), senão o aparelho tentaria gravar de novo para sempre.
      if(c.reason==='fechada'){ if(!c.data){ if(idx>-1) state.sales.splice(idx, 1); return; } if(idx>-1) state.sales[idx] = c.data; else state.sales.push(c.data); return; }
      if(idx<0) return;
      const merged = mergeSaleThreeWay(bases[c.id], state.sales[idx], c.data);
      if(merged===null) state.sales.splice(idx, 1); else state.sales[idx] = merged;
    });
    if(!document.querySelector('#modalRoot .modal')) renderAll();
  }
}
function parseAppDataValue(r, fallback){ if(!r) return fallback; const v = JSON.parse(r.value); return v===null ? null : v; }
/* ---- Caixa por operador (13/11): vários caixas, cada um com o seu turno em public.cash_turnos. ----
   Ajuste state.settings.caixaPorOperador (liga/desliga no admin). Desligado, tudo segue como antes
   (um caixa só, cantina2:cashSession). Ligado, state.cashTurnos guarda o turno de cada caixa e
   state.cashSession fica resolvido para o caixa DESTE aparelho: o código antigo que confere
   state.cashSession.status!=='open' para barrar pagamento continua valendo sem mudança. */
const CAIXA_DO_APARELHO_KEY = 'commandah:caixaDoAparelho';
function modoCaixaPorOperador(){ return !!(state.settings && state.settings.caixaPorOperador); }
function listaDeCaixas(){
  const l = state.settings && state.settings.caixas;
  const ok = Array.isArray(l) ? l.filter(c=>c && typeof c.id==='string' && c.id) : [];
  return ok.length ? ok.map(c=>({ id:c.id, nome:String(c.nome||'').trim() || c.id })) : [{ id:'cx1', nome:'Caixa 1' }, { id:'cx2', nome:'Caixa 2' }];
}
function caixaDoAparelho(){ try{ return localStorage.getItem(CAIXA_DO_APARELHO_KEY) || null; }catch(e){ return null; } }
function marcarCaixaDoAparelho(id){ try{ if(id) localStorage.setItem(CAIXA_DO_APARELHO_KEY, String(id)); else localStorage.removeItem(CAIXA_DO_APARELHO_KEY); }catch(e){} }
// Sem marcação neste aparelho vale o "caixa do app" (celular do garçom etc.), padrão cx1.
function caixaQueVale(){ return caixaDoAparelho() || (state.settings && state.settings.caixaDoApp) || 'cx1'; }
function nomeDoCaixa(id){ const c = listaDeCaixas().find(x=>x.id===id); return c ? c.nome : String(id||''); }
// Lê os turnos pela RPC cash_turnos_ler (redigida para quem não é admin/dono; leitura direta da tabela
// só vale para admin/dono). Devolve { turnos:{[caixaId]:turno}, contagens:{[caixaId]:ultima_contagem} }.
async function lerTurnosDoServidor(){
  const { data, error } = await supabaseClient.rpc('cash_turnos_ler');
  if(error) throw error;
  const turnos = {}, contagens = {};
  (Array.isArray(data) ? data : []).forEach(r=>{ if(r && r.caixa_id){ turnos[r.caixa_id] = r.turno || null; if(r.ultima_contagem!=null) contagens[r.caixa_id] = r.ultima_contagem; } });
  return { turnos, contagens };
}
function aplicarTurnosNoEstado(lidos){
  state.cashTurnos = lidos.turnos; state.cashUltimaContagem = lidos.contagens;
  state.cashSession = lidos.turnos[caixaQueVale()] || null;
}
// Polling do caixa por operador (sem realtime, decisão do plano): 5 s enquanto o turno deste aparelho
// está travado ou, na sessão do dono, há pendência com pedido ao dono; senão 30 s. Desligado ou fora
// da nuvem não faz nada (o setInterval de 30 s de estabelecimento.js cuida do caminho antigo).
let caixaPollingUltimo = 0;
function caixaPollingIntervalo(){
  const travado = state.cashSession && /^travado/.test(String(state.cashSession.status||''));
  const pedidoAoDono = sessionIsOwner && Object.values(state.cashTurnos||{}).some(t=>t && t.pendencia && t.pendencia.pedidoDono);
  return travado || pedidoAoDono ? 5000 : 30000;
}
function iniciarPollingCaixa(){
  setInterval(()=>{
    if(!modoCaixaPorOperador() || !isCloudMode() || !currentUser) return;
    if(Date.now() - caixaPollingUltimo < caixaPollingIntervalo() - 500) return;
    caixaPollingUltimo = Date.now();
    refreshCashState().then(changed=>{ if(changed && !document.querySelector('#modalRoot .modal')) renderAll(); else if(changed) renderScoreboard(); });
  }, 1000);
}
// Traz o caixa (sessão, lançamentos e, se a sessão mudou, o histórico) feito em outro aparelho.
async function refreshCashState(){
  if(!isCloudMode() || !currentUser) return false;
  try{
    await (saveQueues.cashMovements||Promise.resolve()).catch(()=>{});
    const porOperador = modoCaixaPorOperador();
    const [rs, rm, rt] = await Promise.all([porOperador ? null : storageApi.get(STORE.cashSession), storageApi.get(STORE.cashMovements), porOperador ? lerTurnosDoServidor() : null]);
    let changed = false;
    if(porOperador){
      const antes = JSON.stringify([state.cashTurnos||null, state.cashSession||null]);
      const before = state.cashSession && state.cashSession.id;
      aplicarTurnosNoEstado(rt);
      if(JSON.stringify([state.cashTurnos, state.cashSession]) !== antes) changed = true;
      if((state.cashSession && state.cashSession.id) !== before){ const rh = await storageApi.get(STORE.cashHistory); state.cashHistory = parseAppDataValue(rh, []) || []; }
    }else{
      const session = parseAppDataValue(rs, null);
      if(JSON.stringify(session) !== JSON.stringify(state.cashSession)){
        const before = state.cashSession && state.cashSession.id;
        state.cashSession = session; changed = true;
        if((session && session.id) !== before){ const rh = await storageApi.get(STORE.cashHistory); state.cashHistory = parseAppDataValue(rh, []) || []; }
      }
    }
    const pending = cashMovementsDiff(cashMovementsBase, state.cashMovements||[]);
    if(!pending.upserts.length && !pending.deletes.length){
      const movements = parseAppDataValue(rm, []) || [];
      if(JSON.stringify(movements) !== JSON.stringify(state.cashMovements)){ state.cashMovements = movements; setCashMovementsBase(movements); changed = true; }
    }
    return changed;
  }catch(e){ return false; }
}

/* 08/11 (pedido do dono): "Produtos em falta". Caixa e cozinha pausam produto pela RPC
   product_set_active, que troca só o "active" no servidor. O save('products') do administrador
   regravava a lista inteira e, com a cópia lida antes da pausa, desfazia a pausa sem aviso.
   Agora o "active" é mesclado em três vias: produtosAtivoBase = o "active" de cada produto como o
   servidor tinha na última leitura/gravação deste aparelho. Produto cujo "active" este aparelho NÃO
   mudou (igual à base) fica com o do servidor; produto que o admin pausou/ativou de propósito vai com
   o daqui. O resto (preço, nome, produtos novos/excluídos) continua como antes: vale a lista daqui.
   A gravação é condicionada à versão lida (app_data.version, migration 20261109000000): se outro
   aparelho gravou no meio, lê e mescla de novo. */
let produtosAtivoBase = new Map();
function setProdutosAtivoBase(list){ produtosAtivoBase = new Map((list||[]).filter(p=>p&&p.id).map(p=>[p.id, p.active!==false])); }
function marcarAtivoDoProdutoNoServidor(id, ativo){ if(id) produtosAtivoBase.set(id, !!ativo); }
// Aplica em `list` o "active" do servidor nos produtos que este aparelho não mudou (e acerta a base).
function mesclarAtivoDosProdutos(list, server){
  const srv = new Map((server||[]).filter(p=>p&&p.id).map(p=>[p.id, p.active!==false]));
  let mudou = false;
  (list||[]).forEach(p=>{
    if(!p || !p.id || !srv.has(p.id) || !produtosAtivoBase.has(p.id)) return;
    const local = p.active!==false, s = srv.get(p.id);
    if(local!==produtosAtivoBase.get(p.id)) return; // mudado aqui de propósito: vale o daqui
    if(local!==s){ p.active = s; mudou = true; }
    produtosAtivoBase.set(p.id, s);
  });
  return mudou;
}
// { list, version } do servidor; null se a linha não existe. semVersao: banco sem a migration.
async function lerProdutosDoServidor(){
  const { data, error } = await supabaseClient.from('app_data').select('value, version').eq('tenant_id', storageApi.tenantId).eq('key', STORE.products).maybeSingle();
  if(error){ if(/version/i.test(String(error.message||''))) return { semVersao:true, list:[] }; throw error; }
  if(!data) return null;
  return { list: Array.isArray(data.value) ? data.value : [], version: data.version };
}
async function pushProducts(){
  let versaoTentada = null;
  for(let tentativa = 0; tentativa < 3; tentativa++){
    const atual = await lerProdutosDoServidor();
    if(!atual || atual.semVersao){ // chave nova (ou banco antigo): grava como antes
      const payload = JSON.parse(JSON.stringify(state.products||[]));
      await storageApi.set(STORE.products, JSON.stringify(payload));
      setProdutosAtivoBase(payload); produtosVersao = null;
      return;
    }
    // A gravação anterior não mudou nenhuma linha e a versão continua a mesma: ninguém gravou no meio,
    // então foi a RLS que recusou (só o administrador grava o catálogo).
    if(versaoTentada!==null && String(atual.version)===String(versaoTentada)) throw new Error('Sem permissão para gravar o catálogo.');
    mesclarAtivoDosProdutos(state.products, atual.list);
    const payload = JSON.parse(JSON.stringify(state.products||[]));
    versaoTentada = atual.version;
    const { data, error } = await supabaseClient.from('app_data').update({ value: payload, updated_at: new Date().toISOString() })
      .eq('tenant_id', storageApi.tenantId).eq('key', STORE.products).eq('version', atual.version).select('version');
    if(error) throw error;
    if(data && data.length){ setProdutosAtivoBase(payload); produtosVersao = data[0].version; return; }
  }
  throw new Error('O catálogo mudou no servidor durante a gravação. Tente de novo.');
}
/* Revisão B2 (08/11): a pausa feita na cozinha não chegava aos aparelhos já abertos (garçom, Ficha,
   totem, cardápio): o catálogo só era lido no login. O poll de 30 s lê só a versão da linha
   cantina2:products (nunca o blob inteiro a cada volta: pode ter foto em base64). Quando a versão muda,
   lê o catálogo uma vez e troca o daqui pelo do servidor (preço, nome, produtos novos e excluídos
   chegam também), menos o "active" que este aparelho mudou e ainda não gravou. Não roda com o cadastro
   de produto aberto nem com gravação de produtos na fila, para não atropelar edição em andamento. */
let produtosVersao = null;
function notarVersaoDosProdutos(v){
  // Só anda uma casa: se outro aparelho gravou no meio, a próxima volta do poll ainda lê o catálogo.
  if(v!=null && produtosVersao!=null && Number(v)===Number(produtosVersao)+1) produtosVersao = v;
}
function aplicarCatalogoDoServidor(server){
  const locais = new Map((state.products||[]).filter(p=>p&&p.id).map(p=>[p.id,p]));
  const ids = new Set();
  const out = (server||[]).filter(s=>s&&s.id).map(s=>{
    ids.add(s.id);
    const p = locais.get(s.id), novo = JSON.parse(JSON.stringify(s));
    if(p && produtosAtivoBase.has(s.id) && (p.active!==false)!==produtosAtivoBase.get(s.id)) novo.active = p.active;
    if(!p) return novo;
    Object.keys(p).forEach(k=>{ delete p[k]; }); Object.assign(p, novo); // mesmo objeto: quem guardou a referência vê o novo
    return p;
  });
  // Produto criado aqui e ainda não gravado (não está no servidor nem na base) continua.
  (state.products||[]).forEach(p=>{ if(p && p.id && !ids.has(p.id) && !produtosAtivoBase.has(p.id)) out.push(p); });
  state.products = out;
  (server||[]).forEach(s=>{ if(s && s.id) produtosAtivoBase.set(s.id, s.active!==false); });
}
let catalogoLendo = false;
async function atualizarCatalogoSeMudou(){
  if(!isCloudMode() || !supabaseClient || !storageApi || catalogoLendo) return false;
  catalogoLendo = true;
  try{
    const { data, error } = await supabaseClient.from('app_data').select('version').eq('tenant_id', storageApi.tenantId).eq('key', STORE.products).maybeSingle();
    if(error || !data || data.version==null) return false;
    if(produtosVersao!=null && String(data.version)===String(produtosVersao)) return false;
    if(document.getElementById('pSaveBtn')) return false; // cadastro de produto aberto: tenta na próxima volta
    const fila = saveQueues.products;
    await (fila||Promise.resolve()).catch(()=>{});
    const atual = await lerProdutosDoServidor();
    if(!atual || atual.semVersao) return false;
    // Durante a leitura alguém abriu o cadastro ou mandou gravar: deixa para a próxima volta.
    if(document.getElementById('pSaveBtn') || saveQueues.products!==fila) return false;
    aplicarCatalogoDoServidor(atual.list);
    produtosVersao = atual.version;
    return true;
  }catch(e){ return false; }
  finally{ catalogoLendo = false; }
}
// Redesenha o que mostra produto: a tela ativa e, no app do garçom, a etapa em que ele está.
function redesenharDepoisDoCatalogo(){
  const gc = document.getElementById('garcomApp');
  if(gc && gc.classList.contains('show')){
    try{
      if(!gcFlow || gcFlow.step==='home') gcRenderHome();
      else if(gcFlow.step==='products') gcRenderProducts((document.getElementById('gcProdSearch2')||{}).value||'');
      else if(gcFlow.step==='categories'){ const q = (document.getElementById('gcProdSearch')||{}).value||''; if(q) gcSearchAllProducts(q); }
    }catch(e){}
    return;
  }
  if(!document.querySelector('#modalRoot .modal')) renderAll();
}
