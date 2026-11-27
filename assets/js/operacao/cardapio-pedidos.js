/* ============ CARDÁPIO DIGITAL — PEDIDOS DO CELULAR (26/11/2026, etapa 2) ============
   O sócio pede pelo celular e marca na cota (função "cardapio" grava em cardapio_pedidos, status 'novo').
   Qualquer aparelho com alguém logado que tenha o caixa pega o pedido (26/11; antes só o "Caixa do app") e faz o mesmo que o app do garçom
   (gcConfirmOrder): acha ou abre a comanda do sócio, manda os itens para a cozinha e imprime as fichas.
   cardapio_pedido_pegar é atômico: só um aparelho pega cada pedido. Pedido com mais de 5 minutos (26/11; antes 3) não é pego
   (o cliente já foi orientado a chamar o garçom). Desenho: docs/superpowers/specs/2026-11-26-cardapio-etapa2-design.md. */
let cardapioPedidosOcupado = false;
const CARDAPIO_QUEM_LANCA = 'Cardápio digital';

// 26/11 (pedido do dono): qualquer aparelho com alguém logado que tenha o caixa (administrador ou caixa) pega os
// pedidos, não só o Caixa do app. cardapio_pedido_pegar garante que só um pega cada pedido, e a ficha vai pela fila do
// agente de impressão (sai na impressora certa, seja qual for o aparelho).
function cardapioSouProcessador(){
  if(!isCloudMode() || !currentUser || !hasPerm('caixa')) return false;
  const c = (state.settings || {}).cardapio;
  return !!(c && c.ligado);
}
async function cardapioTickPedidos(){
  // 26/11: olha a fila mesmo com a aba escondida (o Chrome deixa rodar no máximo 1 vez por minuto em aba escondida;
  // antes esperava alguém voltar à tela e um pedido levou 151 s).
  if(cardapioPedidosOcupado || !cardapioSouProcessador()) return;
  cardapioPedidosOcupado = true;
  try {
    const desde = new Date(Date.now() - 300000).toISOString(); // 5 min (cardapio_pedido_pegar)
    const { data, error } = await supabaseClient.from('cardapio_pedidos').select('id').eq('status', 'novo').gte('criado_em', desde).order('criado_em').limit(5);
    if(error || !data || !data.length) return;
    for(const r of data) await cardapioProcessarPedido(r.id);
  } catch(e){ console.error('[cardapio] fila', e); }
  finally { cardapioPedidosOcupado = false; }
}
async function cardapioConcluirPedido(id, status, motivo, saleId, numero){
  try { await supabaseClient.rpc('cardapio_pedido_concluir', { p_id:id, p_status:status, p_motivo:motivo || null, p_sale_id:saleId || null, p_order_number:numero || null }); }
  catch(e){ console.error('[cardapio] concluir', e); }
}
// Linhas do carrinho como no garçom (cartAddLine), com o preço do cadastro deste aparelho.
function cardapioLinhasDoPedido(p){
  const cart = [];
  for(const it of (p.itens || [])){
    const prod = state.products.find(x=>x.id===it.produtoId);
    if(!prod || prod.active===false) return { erro:(it.nome || 'Um produto') + ' acabou. Chame o garçom.' };
    let choice = null;
    // 26/11: tamanho e opções escolhidos no celular (picks no formato do buildCustomization: {grupo:{opção:qtd}}).
    const picks = it.opcoes && typeof it.opcoes==='object' ? it.opcoes : {};
    if(it.tamanhoId || Object.keys(picks).length || productNeedsChoice(prod, state.complementos)){
      choice = buildCustomization({ product:prod, complementos:state.complementos, sizeId:it.tamanhoId || null, channel:'qr', picks });
      if(choice.error) return { erro:prod.name + ': ' + choice.error + ' Chame o garçom.' };
    }
    cartAddLine(cart, prod, choice, Math.max(1, Math.min(20, parseInt(it.qtd, 10) || 1)));
  }
  if(!cart.length) return { erro:'Pedido vazio.' };
  if(!canFulfillItems(cart)) return { erro:'Um item acabou no estoque. Chame o garçom.' };
  return { cart };
}
async function cardapioProcessarPedido(id){
  const { data:p, error } = await supabaseClient.rpc('cardapio_pedido_pegar', { p_id:id });
  if(error || !p) return;
  try {
    let m = (state.members || []).find(x=>x.id===p.member_id);
    try { m = await MembersStore.refreshOne(p.member_id) || m; } catch(e){ /* usa o que tem */ }
    if(!m){ await cardapioConcluirPedido(id, 'erro', 'Cota não encontrada. Chame o garçom.'); return; }
    if(memberBlockedByDebt(m)){ await cardapioConcluirPedido(id, 'erro', 'Esta cota tem conta em aberto. Fale com o caixa.'); return; }
    const linhas = cardapioLinhasDoPedido(p);
    if(linhas.erro){ await cardapioConcluirPedido(id, 'erro', linhas.erro); return; }
    // Comanda aberta do sócio, ou uma nova com a cota dele (como gcSelectMember).
    const fresh = await fetchFreshSales(); if(fresh) state.sales = fresh;
    let s = state.sales.find(x=>x.status==='open' && !x.canceled && x.memberId===m.id);
    if(!s){
      s = { id:uid(), type:'comanda', tableNumber:null, orderNumber:await nextOrderNumber(), memberId:m.id, dependentId:null, dependentName:'', customerName:m.name, items:[], total:0, status:'open', payments:[], openedAt:new Date().toISOString(), operatorName:CARDAPIO_QUEM_LANCA, origem:'cardapio' };
      state.sales.push(s); await save('sales');
    }
    const quem = p.quem_nome || m.name, agora = new Date().toISOString();
    const items = linhas.cart.map((i, idx)=>({ ...i, lineId:uid(), sent:false, addedAt:agora, addedBy:CARDAPIO_QUEM_LANCA, local:p.local,
      requesterId:p.dependente_id || m.id, requesterName:quem, requesterType:p.dependente_id ? 'dependente' : 'titular',
      notes: idx===0 && p.obs ? [i.notes, p.obs].filter(Boolean).join(' · ') : (i.notes || '') }));
    if(!await sendItemsToKitchen(s.id, items, quem, 'cardapio', p.local)){ await cardapioConcluirPedido(id, 'erro', 'A cozinha não recebeu o pedido (fechada ou sem estoque). Chame o garçom.'); return; }
    items.forEach(i=>i.sent = true);
    await commitSaleChange(s.id, cur=>{ cur.items = [...(cur.items || []), ...items]; cur.total = saleTotal(cur.items); });
    const grupos = {};
    items.forEach(i=>{ const k = i.estacao || 'cozinha'; (grupos[k] = grupos[k] || []).push(i); });
    const jobs = Object.keys(grupos).map(estacao=>{ const pr = resolvePrinterFor(estacao, 'app'); return { estacao, items:grupos[estacao], printer:pr ? pr.nome : null }; });
    printNovoPedidoTickets(quem, m.code || '', p.local, jobs, s.orderNumber);
    logAction('Pedido do cardápio digital — ' + quem + ' — ' + p.local + ' — comanda #' + (s.orderNumber || '') + ' (' + fmt(p.total) + ')');
    await cardapioConcluirPedido(id, 'na_cozinha', null, s.id, s.orderNumber);
    toast('Pedido do cardápio: ' + quem + ' · ' + p.local);
    if(!document.querySelector('#modalRoot .modal')) renderAll();
  } catch(e){
    console.error('[cardapio] pedido', e);
    await cardapioConcluirPedido(id, 'erro', 'Não foi possível lançar o pedido. Chame o garçom.');
  }
}
// Pedidos de hoje na tela Apps › Cardápio Digital (situação de cada um).
async function cardapioPedidosDeHoje(){
  const box = document.getElementById('cardapioPedidosHoje'); if(!box || !isCloudMode()) return;
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  const { data, error } = await supabaseClient.from('cardapio_pedidos').select('quem_nome,local,total,status,motivo,order_number,criado_em').gte('criado_em', ini.toISOString()).order('criado_em', { ascending:false }).limit(50);
  if(!document.getElementById('cardapioPedidosHoje')) return;
  if(error){ box.innerHTML = '<p class="sub">Não foi possível ler os pedidos agora.</p>'; return; }
  const rot = { novo:'Aguardando o caixa', processando:'Lançando', na_cozinha:'Na cozinha', erro:'Não lançado' };
  box.innerHTML = (data || []).length ? `<table class="cardapio-pedidos"><thead><tr><th>Hora</th><th>Quem</th><th>Local</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${data.map(r=>{
    const velho = r.status==='novo' && Date.now() - Date.parse(r.criado_em) > 300000;
    return `<tr><td>${h(timeFmt(r.criado_em))}</td><td>${h(r.quem_nome)}</td><td>${h(r.local)}</td><td class="mono">${fmt(r.total)}</td><td>${h(velho ? 'Não pego (cliente orientado a chamar o garçom)' : (rot[r.status] || r.status) + (r.order_number ? ' · comanda #' + r.order_number : ''))}${r.motivo ? '<br><small class="sub">' + h(r.motivo) + '</small>' : ''}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="sub">Nenhum pedido pelo celular hoje.</p>';
}
setInterval(cardapioTickPedidos, 6000);
