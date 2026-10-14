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
// gravada de novo. Sem a migration aplicada, cai na gravação antiga (vale a última).
let salesApplyV2 = true;
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
    let res = salesApplyV2 ? await supabaseClient.rpc('sales_apply', { p_upserts:d.upserts, p_delete_ids:d.deletes, p_bases:bases }) : null;
    if(res && res.error && (res.error.code==='PGRST202' || /sales_apply/.test(res.error.message||'') && /(could not find|does not exist|não existe)/i.test(res.error.message||''))){ salesApplyV2 = false; res = null; }
    if(!res) res = await supabaseClient.rpc('sales_apply', { p_upserts:d.upserts, p_delete_ids:d.deletes });
    if(res.error) throw res.error;
    const conflicts = (res.data && res.data.conflicts) || [];
    const conflictIds = new Set(conflicts.map(c=>c.id));
    d.upserts.filter(u=>!conflictIds.has(u.id)).forEach(markSaleServer); d.deletes.forEach(id=>salesBase.delete(id));
    if(!conflicts.length) return;
    conflicts.forEach(c=>{
      const idx = state.sales.findIndex(x=>x && x.id===c.id);
      if(c.data) salesBase.set(c.id, JSON.stringify(c.data)); else salesBase.delete(c.id);
      if(idx<0) return;
      const merged = mergeSaleThreeWay(bases[c.id], state.sales[idx], c.data);
      if(merged===null) state.sales.splice(idx, 1); else state.sales[idx] = merged;
    });
    if(!document.querySelector('#modalRoot .modal')) renderAll();
  }
}
function parseAppDataValue(r, fallback){ if(!r) return fallback; const v = JSON.parse(r.value); return v===null ? null : v; }
// Traz o caixa (sessão, lançamentos e, se a sessão mudou, o histórico) feito em outro aparelho.
async function refreshCashState(){
  if(!isCloudMode() || !currentUser) return false;
  try{
    await (saveQueues.cashMovements||Promise.resolve()).catch(()=>{});
    const [rs, rm] = await Promise.all([storageApi.get(STORE.cashSession), storageApi.get(STORE.cashMovements)]);
    const session = parseAppDataValue(rs, null);
    let changed = false;
    if(JSON.stringify(session) !== JSON.stringify(state.cashSession)){
      const before = state.cashSession && state.cashSession.id;
      state.cashSession = session; changed = true;
      if((session && session.id) !== before){ const rh = await storageApi.get(STORE.cashHistory); state.cashHistory = parseAppDataValue(rh, []) || []; }
    }
    const pending = cashMovementsDiff(cashMovementsBase, state.cashMovements||[]);
    if(!pending.upserts.length && !pending.deletes.length){
      const movements = parseAppDataValue(rm, []) || [];
      if(JSON.stringify(movements) !== JSON.stringify(state.cashMovements)){ state.cashMovements = movements; setCashMovementsBase(movements); changed = true; }
    }
    return changed;
  }catch(e){ return false; }
}

