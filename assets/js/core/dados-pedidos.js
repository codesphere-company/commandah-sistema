/* ============ ORDERS (fila da cozinha) — tabela relacional em modo nuvem, blob em modo local ============ */
function orderFromRow(row){
  return {
    id: row.id, saleId: row.sale_id||null, who: row.who, local: row.local||'',
    items: row.items||[], status: row.status, statusHistory: row.status_history||[],
    kitchenNote: row.kitchen_note||'', source: row.source||null, createdAt: row.created_at
  };
}
// BD-06 (decisão do dono, 10/10): a cozinha e a tela de pedidos carregam os pedidos abertos e os
// das últimas 48 h; depois, a cada 6 s, só o que mudou (updated_at, carimbado pelo banco desde a
// migration 20261011040000). Antes: a tabela inteira a cada 6 s, sem paginar.
const ORDERS_WINDOW_MS = 48*3600*1000;
let ordersCursor = null;
function noteOrdersCursor(rows){ (rows||[]).forEach(r=>{ if(r.updated_at && (!ordersCursor || r.updated_at > ordersCursor)) ordersCursor = r.updated_at; }); }
function orderInWindow(o){ return !['entregue','cancelado'].includes(o.status) || (Date.now() - new Date(o.createdAt).getTime()) < ORDERS_WINDOW_MS; }
function sortOrders(list){ return list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); }
// Junta no state.orders o que mudou no servidor. Devolve true se algo mudou na tela.
function mergeOrderChanges(rows){
  let changed = false;
  (rows||[]).forEach(r=>{
    const o = orderFromRow(r), idx = state.orders.findIndex(x=>x.id===o.id);
    if(idx>-1){ if(JSON.stringify(state.orders[idx])!==JSON.stringify(o)){ state.orders[idx] = o; changed = true; } }
    else if(orderInWindow(o)){ state.orders.push(o); changed = true; }
  });
  const before = state.orders.length;
  state.orders = state.orders.filter(orderInWindow);
  if(changed || state.orders.length!==before){ sortOrders(state.orders); return true; }
  return false;
}
const OrdersStore = {
  async load(){
    if(isCloudMode()){
      const since = new Date(Date.now() - ORDERS_WINDOW_MS).toISOString(), t = storageApi.tenantId;
      const [open, recent] = await Promise.all([
        fetchAllRows(()=>supabaseClient.from('orders').select('*').eq('tenant_id', t).not('status','in','("entregue","cancelado")').order('id')),
        fetchAllRows(()=>supabaseClient.from('orders').select('*').eq('tenant_id', t).gte('created_at', since).order('id'))
      ]);
      const byId = new Map();
      [...open, ...recent].forEach(r=>byId.set(r.id, r));
      ordersCursor = null; noteOrdersCursor([...byId.values()]);
      return sortOrders([...byId.values()].map(orderFromRow));
    }
    const r = await storageApi.get(STORE.orders);
    return r ? JSON.parse(r.value) : [];
  },
  async changes(){
    const since = ordersCursor ? new Date(new Date(ordersCursor).getTime() - 15000).toISOString() : new Date(Date.now() - ORDERS_WINDOW_MS).toISOString();
    const rows = await fetchAllRows(()=>supabaseClient.from('orders').select('*').eq('tenant_id', storageApi.tenantId).gt('updated_at', since).order('updated_at').order('id'));
    noteOrdersCursor(rows);
    return rows;
  },
  async create(order){
    if(isCloudMode()){
      const row = {
        id: order.id, tenant_id: storageApi.tenantId, sale_id: order.saleId||null, who: order.who,
        local: order.local||null, items: order.items, status: order.status,
        status_history: order.statusHistory||[], kitchen_note: order.kitchenNote||null,
        source: order.source||null, created_at: order.createdAt
      };
      const { error } = await supabaseClient.from('orders').insert(row);
      if(error) throw error;
      state.orders.unshift(order);
    } else {
      state.orders.unshift(order);
      await save('orders');
    }
    return order;
  },
  async advance(id, next){
    const o = state.orders.find(x=>x.id===id); if(!o) return;
    const from = o.status;
    o.status = next;
    o.statusHistory = Array.isArray(o.statusHistory)?o.statusHistory:[];
    o.statusHistory.push({ from, to: next, at: new Date().toISOString(), user: currentUser.name });
    if(isCloudMode()){
      const { error } = await supabaseClient.from('orders').update({ status: next, status_history: o.statusHistory, updated_at: new Date().toISOString() }).eq('id', id);
      if(error) throw error;
    } else {
      await save('orders');
    }
  },
  async setItems(id, items){
    const o = state.orders.find(x=>x.id===id); if(!o) return;
    o.items = items;
    if(isCloudMode()){
      const { error } = await supabaseClient.from('orders').update({ items, updated_at: new Date().toISOString() }).eq('id', id);
      if(error) throw error;
    } else {
      await save('orders');
    }
  },
  async saveNote(id, note){
    const o = state.orders.find(x=>x.id===id); if(!o) return;
    o.kitchenNote = note;
    if(isCloudMode()){
      const { error } = await supabaseClient.from('orders').update({ kitchen_note: note, updated_at: new Date().toISOString() }).eq('id', id);
      if(error) throw error;
    } else {
      await save('orders');
    }
  },
  async returnStep(id){
    const o = state.orders.find(x=>x.id===id); if(!o) return;
    const previous = {preparo:'pendente',pronto:'preparo',entregue:'pronto'}[o.status];
    if(!previous) return;
    const from = o.status;
    o.status = previous;
    o.statusHistory = Array.isArray(o.statusHistory)?o.statusHistory:[];
    o.statusHistory.push({ from, to: previous, at: new Date().toISOString(), user: currentUser.name, reason: 'Retorno manual' });
    if(isCloudMode()){
      const { error } = await supabaseClient.from('orders').update({ status: previous, status_history: o.statusHistory, updated_at: new Date().toISOString() }).eq('id', id);
      if(error) throw error;
    } else {
      await save('orders');
    }
  },
  async reassignSale(sourceId, targetId){
    state.orders.forEach(o=>{ if(o.saleId===sourceId) o.saleId=targetId; });
    if(isCloudMode()){
      const { error } = await supabaseClient.from('orders').update({ sale_id: targetId, updated_at: new Date().toISOString() }).eq('sale_id', sourceId);
      if(error) throw error;
    } else {
      await save('orders');
    }
  },
  async cancelBySale(saleId){
    state.orders.filter(o=>o.saleId===saleId&&o.status!=='entregue').forEach(o=>{ o.status='cancelado'; });
    if(isCloudMode()){
      const { error } = await supabaseClient.from('orders').update({ status:'cancelado', updated_at: new Date().toISOString() }).eq('sale_id', saleId).neq('status','entregue');
      if(error) throw error;
    } else {
      await save('orders');
    }
  }
};

// UX-13: aviso de erro tem cara própria (vermelho suave, 5 s, botão de fechar) e os avisos
// se empilham em vez de ficar um em cima do outro. Sem tipo informado, mensagens de falha
// são reconhecidas pelo texto ("Não foi possível…", "Falha…", "…inválido", "Sem permissão"…).
const TOAST_ERROR_RE = /^(n[ãa]o foi poss[íi]vel|falha|erro|sem permiss[ãa]o|sem conex[ãa]o|aviso:)|n[ãa]o (pode|gravou|foi poss)|inv[áa]lid|insuficiente|incorret|bloquead|recusad/i;
function toast(msg, type){
  const root = document.getElementById('toastRoot'); if(!root) return;
  const isError = type==='erro' || (type===undefined && TOAST_ERROR_RE.test(String(msg||'')));
  const el = document.createElement('div');
  el.className = 'toast'+(isError?' toast-erro':'');
  el.setAttribute('role', isError?'alert':'status');
  const text = document.createElement('span'); text.textContent = msg; el.appendChild(text);
  if(isError){ const x=document.createElement('button'); x.type='button'; x.className='toast-close'; x.setAttribute('aria-label','Fechar aviso'); x.textContent='×'; x.onclick=()=>el.remove(); el.appendChild(x); }
  root.appendChild(el);
  while(root.children.length>4) root.firstElementChild.remove();
  setTimeout(()=>el.remove(), isError?5000:2600);
}

