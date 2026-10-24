/* ============ INSUMOS ============ */
let selectedInsumoId=null;
function selectInsumoRow(id){selectedInsumoId=id;renderInsumos();}
function editSelectedInsumo(){if(!selectedInsumoId){toast('Selecione um insumo para editar.');return;}openInsumoModal(selectedInsumoId);}
function stockSelectedInsumo(){if(!selectedInsumoId){toast('Selecione um insumo para movimentar o estoque.');return;}openInsumoStockModal(selectedInsumoId);}
function renderInsumos(){
  const el = document.getElementById('view-insumos');
  const rows = state.insumos.length ? state.insumos.map(i=>`
    <tr data-search="${h(((i.code||'')+' '+i.name+' '+i.unit).toLowerCase())}" class="${selectedInsumoId===i.id?'selected':''}" onclick="selectInsumoRow(${jsArg(i.id)})" ondblclick="openInsumoModal(${jsArg(i.id)})"><td>${h(i.code||'—')}</td><td>${h(i.name)}</td><td>${h(i.unit)}</td>
    <td class="mono ${i.stock<=i.minStock?'low-stock':''}">${i.stock}</td>
    <td class="mono">${i.minStock}</td><td class="mono">${fmt(i.costPerUnit)}</td>
    <td>${i.stock<=i.minStock?'<span class="tag tag-red">Estoque baixo</span>':'<span class="tag tag-green">Normal</span>'}</td><td>${i.active===false?'Pausado':'Ativo'}</td><td>${h(i.pdvCode||'—')}</td></tr>`).join('')
    : `<tr><td colspan="9" class="empty">Nenhum insumo cadastrado.</td></tr>`;
  const totalCost=state.insumos.reduce((sum,i)=>sum+Number(i.stock||0)*Number(i.costPerUnit||0),0);
  el.innerHTML = `<div class="workspace-gray"><section class="op-window input-window"><header class="op-titlebar"><span>Insumos</span><span class="op-controls"><span onclick="closeOperationalWindow()" style="cursor:pointer" title="Fechar">×</span></span></header><div class="op-toolbar"><div class="op-search"><span>⌕</span><input id="insumoSearch" placeholder="Pesquisar aqui..."></div><div class="op-toolbar-spacer"></div><div class="pdv-menu-wrap"><button class="op-btn" onclick="toggleInsumoOptions()">••• &nbsp; Opções ▾</button>${insumoOptionsOpen?`<div class="pdv-menu" style="top:48px;right:0;left:auto;min-width:245px"><button onclick="window.print()">▣ &nbsp; Imprimir</button><b>Exportar Insumos</b><button onclick="exportInsumosCsv()">⇩ &nbsp; Para arquivo CSV</button><b>Importar Insumos</b><button onclick="importInsumosCsv()">⇧ &nbsp; De arquivo CSV</button><button onclick="openStockMovementHistory()">▤ &nbsp; Histórico de Estoque</button></div>`:''}</div><button class="op-btn" onclick="openStockCountModal()" title="Contar o estoque e lançar as diferenças">☑ &nbsp; Contagem</button><button class="op-btn" onclick="stockSelectedInsumo()" ${selectedInsumoId?'':'disabled'}>▣ &nbsp; Estoque</button><button class="op-btn" onclick="editSelectedInsumo()" ${selectedInsumoId?'':'disabled'}>✎ &nbsp; Editar</button><button class="op-btn primary" onclick="openInsumoModal()"><span class="op-ico">＋</span> Novo</button></div><div class="op-tabs"><button class="active">Insumos (${state.insumos.length})</button></div><div class="op-grid"><table><thead><tr><th>Cód. Sistema</th><th>Nome</th><th>Medida</th><th>Estoque</th><th>Estoque Mín.</th><th>Custo Unitário</th><th>Sit. Estoque</th><th>Status</th><th>Cód. PDV</th></tr></thead><tbody id="insumoRows">${rows}</tbody></table></div><footer class="op-footer"><span>Registros: ${state.insumos.length}</span><span>Custo do Estoque=${fmt(totalCost)}</span></footer></section></div>`;
  document.getElementById('insumoSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#insumoRows tr[data-search]').forEach(r=>r.style.display=r.dataset.search.includes(q)?'':'none');};
}
const renderInsumosBase=renderInsumos;
renderInsumos=function(){renderInsumosBase();if(!insumoOptionsOpen)return;const menu=document.querySelector('#view-insumos .pdv-menu');if(!menu)return;menu.style.minWidth='270px';menu.innerHTML=`<button onclick="insumoOptionsOpen=false;window.print()">▣ &nbsp; Imprimir</button><button onclick="insumoOptionsOpen=false;renderAll();toast('Lista atualizada.')">↻ &nbsp; Atualizar Lista</button><button onclick="duplicateSelectedInsumo()" ${selectedInsumoId?'':'disabled'}>▣ &nbsp; Duplicar Selecionado</button><button onclick="openStockMovementHistory()">▤ &nbsp; Histórico de Estoque</button><button onclick="insumoOptionsOpen=false;openStockCountModal()">☑ &nbsp; Contagem de Estoque</button><b>Alterar Situação</b><button onclick="setInsumosStatus(true)">✓ Ativar ${selectedInsumoId?'selecionado':'todos'}</button><button onclick="setInsumosStatus(false)">‖ Pausar ${selectedInsumoId?'selecionado':'todos'}</button><b>Exportar Insumos</b><button onclick="exportInsumosCsv()">⇩ &nbsp; Para arquivo CSV</button><button onclick="exportInsumosPackage()">⇩ &nbsp; Pacote completo</button><button onclick="exportInsumosTemplate()">□ &nbsp; Modelo para preenchimento</button><b>Importar Insumos</b><button onclick="importInsumosFile('csv')">⇧ &nbsp; De arquivo CSV</button><button onclick="importInsumosFile('json')">⇧ &nbsp; De pacote completo</button>`;};
function toggleInsumoOptions(){insumoOptionsOpen=!insumoOptionsOpen;renderInsumos();}
function downloadCsvFile(name,rows){const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function downloadJsonFile(name,data){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportInsumosCsv(){insumoOptionsOpen=false;downloadCsvFile('insumos-'+todayStr()+'.csv',[['Código','Nome','Unidade','Estoque','Estoque Mínimo','Custo Unitário','Código PDV','Código NFe','Situação'],...state.insumos.map((i,n)=>[i.code||n+1,i.name,i.unit,i.stock,i.minStock,i.costPerUnit,i.pdvCode||'',i.nfeCode||'',i.active===false?'pausado':'ativo'])]);renderInsumos();}
function exportInsumosPackage(){insumoOptionsOpen=false;downloadJsonFile('pacote-insumos-'+todayStr()+'.json',{format:'cantina-insumos',version:1,exportedAt:new Date().toISOString(),insumos:state.insumos});logAction('Pacote de insumos exportado');}
function exportInsumosTemplate(){insumoOptionsOpen=false;downloadCsvFile('modelo-importacao-insumos.csv',[['Código','Nome','Unidade','Estoque','Estoque Mínimo','Custo Unitário','Código PDV','Código NFe','Situação'],['001','Exemplo','un','0','5','0,00','','','ativo']]);}
function duplicateSelectedInsumo(){insumoOptionsOpen=false;const source=state.insumos.find(x=>x.id===selectedInsumoId);if(!source){toast('Selecione um insumo para duplicar.');return;}const copy={...JSON.parse(JSON.stringify(source)),id:uid(),code:'',pdvCode:'',nfeCode:'',name:source.name+' — Cópia',stock:0};state.insumos.push(copy);selectedInsumoId=copy.id;save('insumos');renderAll();toast('Insumo duplicado com estoque zerado.');}
function setInsumosStatus(active){insumoOptionsOpen=false;const ids=selectedInsumoId?[selectedInsumoId]:state.insumos.map(x=>x.id);ids.forEach(id=>{const item=state.insumos.find(x=>x.id===id);if(item)item.active=active;});save('insumos');renderAll();toast(`${ids.length} insumo(s) ${active?'ativado(s)':'pausado(s)'}.`);}
function importInsumosFile(format='csv'){insumoOptionsOpen=false;const input=document.createElement('input');input.type='file';input.accept=format==='json'?'.json,application/json':'.csv,text/csv';input.onchange=async()=>{const file=input.files&&input.files[0];if(!file)return;try{let incoming;if(format==='json'){const data=JSON.parse(await file.text());incoming=Array.isArray(data)?data:data&&data.format==='cantina-insumos'?data.insumos:null;if(!Array.isArray(incoming))throw new Error('Pacote de insumos inválido.');}else{const lines=(await file.text()).replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);incoming=lines.slice(1).map(line=>{const c=line.split(';').map(x=>x.replace(/^"|"$/g,'').replace(/""/g,'"'));return{code:(c[0]||'').trim(),name:(c[1]||'').trim(),unit:(c[2]||'un').trim(),stock:Number(String(c[3]||0).replace(',','.'))||0,minStock:Number(String(c[4]||0).replace(',','.'))||0,costPerUnit:Number(String(c[5]||0).replace(',','.'))||0,pdvCode:(c[6]||'').trim(),nfeCode:(c[7]||'').trim(),active:String(c[8]||'ativo').toLowerCase()!=='pausado'};}).filter(x=>x.name);}if(!incoming.length)throw new Error('Nenhum insumo válido foi encontrado.');if(!confirm(`Importar ${incoming.length} insumo(s) de ${file.name}? Registros com o mesmo código serão atualizados.`))return;let added=0,updated=0;incoming.forEach(raw=>{const code=String(raw.code||'').trim(),existing=state.insumos.find(x=>(raw.id&&x.id===raw.id)||(code&&x.code===code)||(raw.nfeCode&&x.nfeCode===raw.nfeCode));const target=existing||{id:raw.id||uid()};Object.assign(target,{code,name:String(raw.name||'').trim(),unit:UNIT_OPTIONS.includes(raw.unit)?raw.unit:'un',stock:Math.max(0,Number(raw.stock)||0),minStock:Math.max(0,Number(raw.minStock)||0),costPerUnit:Math.max(0,Number(raw.costPerUnit)||0),pdvCode:String(raw.pdvCode||''),nfeCode:String(raw.nfeCode||''),active:raw.active!==false});if(existing)updated++;else{state.insumos.push(target);added++;}});save('insumos');renderAll();toast(`${added} insumo(s) incluído(s) e ${updated} atualizado(s).`);logAction('Insumos importados de '+file.name);}catch(error){toast(error.message||'Não foi possível importar o arquivo.');}};input.click();}
function importInsumosCsv(){importInsumosFile('csv');}
function stockMovementList(){const q=(document.getElementById('stockHistorySearch')?.value||'').toLowerCase(),type=document.getElementById('stockHistoryType')?.value||'',from=document.getElementById('stockHistoryFrom')?.value,to=document.getElementById('stockHistoryTo')?.value;return(state.stockMovements||[]).filter(m=>{const at=localDay(m.at||m.createdAt),text=[m.name,m.insumoName,m.operation,m.note,m.reference,m.user].join(' ').toLowerCase();return(!q||text.includes(q))&&(!type||String(m.type||m.kind)===type)&&(!from||at>=from)&&(!to||at<=to);}).sort((a,b)=>String(b.at||b.createdAt||'').localeCompare(String(a.at||a.createdAt||'')));}
function renderStockMovementRows(){const list=stockMovementList(),body=document.getElementById('stockHistoryRows'),footer=document.getElementById('stockHistoryFooter');if(!body)return;body.innerHTML=list.map(m=>{const qty=Number(m.qty??m.quantity)||0,type=String(m.type||m.kind||'movimento').toLowerCase(),signal=type==='saida'?'-':'+';if(type==='contagem')return`<tr><td>${reportDateTime(m.at)}</td><td><span class="tag">Contagem</span></td><td>${h(m.name||'Contagem de estoque')}</td><td class="mono">${qty} ${qty===1?'item':'itens'}</td><td>${h(stockCountSummaryText(m))}</td><td class="mono">—</td><td class="mono">—</td><td>${h(m.user||'—')}</td></tr>`;return`<tr ondblclick="openStockMovementDetail(${jsArg(m.id)})"><td>${reportDateTime(m.at||m.createdAt)}</td><td><span class="tag ${type==='saida'?'tag-red':'tag-green'}">${h(type==='saida'?'Saída':'Entrada')}</span></td><td>${h(m.insumoName||m.name||'—')}</td><td class="mono">${signal}${qty.toLocaleString('pt-BR')} ${h(m.unit||'')}</td><td>${h(m.operation||m.note||m.source||'—')}</td><td class="mono">${Number(m.before||0).toLocaleString('pt-BR')}</td><td class="mono">${Number(m.after||0).toLocaleString('pt-BR')}</td><td>${h(m.user||'—')}</td></tr>`;}).join('')||'<tr><td colspan="8" class="empty">Nenhuma movimentação encontrada.</td></tr>';if(footer){const entries=list.filter(m=>!['saida','contagem'].includes(String(m.type||m.kind).toLowerCase())).reduce((s,m)=>s+(Number(m.qty??m.quantity)||0),0),outputs=list.filter(m=>String(m.type||m.kind).toLowerCase()==='saida').reduce((s,m)=>s+(Number(m.qty??m.quantity)||0),0);footer.innerHTML=`<span>Registros: ${list.length}</span><span>Entradas=${entries.toLocaleString('pt-BR')} &nbsp; Saídas=${outputs.toLocaleString('pt-BR')}</span>`;}}
function openStockMovementHistory(){const today=todayStr(),start=new Date();start.setDate(1);openModal('Histórico de Estoque',`<div class="op-toolbar"><div class="op-search"><span>⌕</span><input id="stockHistorySearch" placeholder="Pesquisar insumo, origem ou operador..." oninput="renderStockMovementRows()"></div><select id="stockHistoryType" onchange="renderStockMovementRows()"><option value="">Todos os movimentos</option><option value="entrada">Entradas</option><option value="saida">Saídas</option><option value="contagem">Contagens</option></select><input id="stockHistoryFrom" type="date" value="${localDay(start)}" onchange="renderStockMovementRows()"><input id="stockHistoryTo" type="date" value="${today}" onchange="renderStockMovementRows()"><span class="op-toolbar-spacer"></span><button class="op-btn" onclick="exportStockMovementHistory()">▧ Exportar</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button></div><div class="finance-grid" style="height:430px"><table><thead><tr><th>Data/Hora</th><th>Tipo</th><th>Insumo</th><th>Quantidade</th><th>Origem</th><th>Saldo Anterior</th><th>Saldo Atual</th><th>Operador</th></tr></thead><tbody id="stockHistoryRows"></tbody></table></div><footer id="stockHistoryFooter" class="op-footer"></footer><p class="sub" style="padding:0 12px">Clique duas vezes em um movimento para ver todos os detalhes.</p>`,true);document.querySelector('#modalRoot .modal').classList.add('nfe-stock-modal');renderStockMovementRows();}
function exportStockMovementHistory(){const rows=stockMovementList();downloadCsvFile('historico-estoque.csv',[['Data/Hora','Tipo','Insumo','Quantidade','Unidade','Origem','Saldo Anterior','Saldo Atual','Operador','Referência'],...rows.map(m=>[reportDateTime(m.at||m.createdAt),m.type||m.kind,m.insumoName||m.name,m.qty??m.quantity,m.unit,m.operation||m.note||m.source,m.before,m.after,m.user,m.reference])]);}
function openStockMovementDetail(id){const m=(state.stockMovements||[]).find(x=>x.id===id);if(!m)return;const ins=state.insumos.find(x=>x.id===(m.insumoId||''));openModal('Detalhes da Movimentação',`<div class="consumer-form-frame"><div class="row"><div class="field"><label>Data e hora</label><input readonly value="${h(reportDateTime(m.at||m.createdAt))}"></div><div class="field"><label>Operador</label><input readonly value="${h(m.user||'—')}"></div></div><div class="row"><div class="field"><label>Insumo</label><input readonly value="${h(m.insumoName||m.name||ins&&ins.name||'—')}"></div><div class="field"><label>Tipo</label><input readonly value="${h(String(m.type||m.kind||'Movimento').toUpperCase())}"></div></div><div class="grid3"><div class="field"><label>Saldo anterior</label><input readonly value="${h(m.before??'—')}"></div><div class="field"><label>Quantidade</label><input readonly value="${h(m.qty??m.quantity??'—')} ${h(m.unit||ins&&ins.unit||'')}"></div><div class="field"><label>Saldo resultante</label><input readonly value="${h(m.after??'—')}"></div></div><div class="field"><label>Origem / Operação</label><input readonly value="${h(m.operation||m.note||m.source||'—')}"></div><div class="field"><label>Referência</label><input readonly value="${h(m.reference||'—')}"></div></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal();openStockMovementHistory()">〈 Voltar</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
/* PROD-15 (decisão do dono: contagem semanal com % de perda). O operador digita o que
   contou; o que ficar em branco não entra. A diferença é lançada pelo servidor
   (consume_insumos na falta, restore_insumos na sobra), sobre o estoque lido de novo na
   hora de gravar: venda feita durante a contagem não é apagada (regravar o cadastro
   inteiro de insumos apagaria). Cada contagem deixa uma linha de resumo no histórico
   de estoque (type 'contagem') com o valor no sistema, a falta, a sobra e a % de perda. */
let stockCountDraft = {};
function stockCountSummaryText(m){
  const pct = Number(m.countBase)>0 ? (Number(m.countLoss)||0)/Number(m.countBase)*100 : 0;
  return 'Falta '+fmt(m.countLoss)+' · Sobra '+fmt(m.countSurplus)+' · Perda '+pct.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'+(m.note?' · '+m.note:'');
}
function stockCountQty(v){ const n = parseFloat(String(v??'').replace(',','.')); return Number.isFinite(n) ? Math.round(n*1000)/1000 : null; }
function stockCountInsumos(){ return state.insumos.filter(i=>i.active!==false).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')); }
function stockCountTotals(list){
  let base=0, loss=0, surplus=0, counted=0;
  list.forEach(i=>{
    const c = stockCountQty(stockCountDraft[i.id]); if(c===null) return;
    const stock = Number(i.stock)||0, cost = Number(i.costPerUnit)||0, diff = Math.round((c-stock)*1000)/1000;
    counted++; base += stock*cost;
    if(diff<0) loss += -diff*cost; else surplus += diff*cost;
  });
  return { base, loss, surplus, counted, pct: base>0 ? loss/base*100 : 0 };
}
function renderStockCountTotals(){
  const t = stockCountTotals(stockCountInsumos()), el = document.getElementById('stockCountSum'); if(!el) return;
  el.innerHTML = `<div><span>Itens contados</span><b class="mono">${t.counted}</b></div><div><span>Valor no sistema</span><b class="mono">${fmt(t.base)}</b></div><div class="count-loss"><span>Falta (perda)</span><b class="mono">${fmt(t.loss)}</b></div><div class="count-gain"><span>Sobra</span><b class="mono">${fmt(t.surplus)}</b></div><div><span>% de perda</span><b class="mono">${t.pct.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</b></div>`;
}
function stockCountInput(id, value){
  stockCountDraft[id] = value;
  const i = state.insumos.find(x=>x.id===id), cell = document.getElementById('scDiff-'+id); if(!i || !cell) return;
  const c = stockCountQty(value);
  if(c===null){ cell.textContent='—'; cell.className='mono'; }
  else { const d = Math.round((c-(Number(i.stock)||0))*1000)/1000; cell.textContent = (d>0?'+':'')+d.toLocaleString('pt-BR')+' '+(i.unit||''); cell.className = 'mono '+(d<0?'count-falta':d>0?'count-sobra':''); }
  renderStockCountTotals();
}
function filterStockCountRows(q){ q = String(q||'').toLowerCase(); document.querySelectorAll('#stockCountRows tr[data-search]').forEach(r=>r.style.display=r.dataset.search.includes(q)?'':'none'); }
async function openStockCountModal(){
  if(isCloudMode()){
    try{ await (saveQueues.insumos||Promise.resolve()); const r = await storageApi.get(STORE.insumos); if(r){ state.insumos = JSON.parse(r.value); setInsumosBase(state.insumos); } }catch(e){}
  }
  stockCountDraft = {};
  const list = stockCountInsumos();
  const counts = (state.stockMovements||[]).filter(m=>m.type==='contagem').sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,12);
  const rows = list.length ? list.map(i=>`<tr data-search="${h(((i.code||'')+' '+i.name).toLowerCase())}"><td>${h(i.name)}${i.code?` <span class="sub">· ${h(i.code)}</span>`:''}</td><td>${h(i.unit)}</td><td class="mono">${(Number(i.stock)||0).toLocaleString('pt-BR')}</td><td><input type="text" inputmode="decimal" placeholder="—" oninput="stockCountInput(${jsArg(i.id)},this.value)" aria-label="Quantidade contada de ${h(i.name)}"></td><td id="scDiff-${i.id}" class="mono">—</td><td class="mono">${fmt(i.costPerUnit)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">Nenhum insumo ativo cadastrado.</td></tr>';
  const hist = counts.length ? counts.map(m=>`<tr><td>${reportDateTime(m.at)}</td><td>${h(m.user||'—')}</td><td class="mono">${Number(m.qty)||0}</td><td class="mono">${fmt(m.countLoss)}</td><td class="mono">${fmt(m.countSurplus)}</td><td class="mono">${(Number(m.countBase)>0?(Number(m.countLoss)||0)/Number(m.countBase)*100:0).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">Nenhuma contagem registrada ainda.</td></tr>';
  openModal('Contagem de Estoque', `<div class="count-body">
    <p class="sub" style="margin:0">Conte o que tem na prateleira e digite a quantidade. O que ficar em branco não entra na contagem. A diferença vira saída (falta) ou entrada (sobra) no estoque.</p>
    <div class="count-top"><div class="op-search"><span>⌕</span><input id="stockCountSearch" placeholder="Pesquisar insumo..." oninput="filterStockCountRows(this.value)"></div><div class="field" style="margin:0;flex:1;min-width:200px"><input id="stockCountNote" placeholder="Observação (opcional): ex. contagem de segunda"></div></div>
    <div class="finance-grid count-grid"><table><thead><tr><th>Insumo</th><th>Un.</th><th>No sistema</th><th>Contado</th><th>Diferença</th><th>Custo un.</th></tr></thead><tbody id="stockCountRows">${rows}</tbody></table></div>
    <div class="count-sum" id="stockCountSum"></div>
    <details class="count-history"><summary>Contagens anteriores (${counts.length})</summary><div class="finance-grid"><table><thead><tr><th>Data</th><th>Operador</th><th>Itens</th><th>Falta</th><th>Sobra</th><th>% de perda</th></tr></thead><tbody>${hist}</tbody></table></div></details>
    <div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 &nbsp; Voltar</button><button class="consumer-save" id="stockCountSaveBtn" onclick="saveStockCount()">✓ &nbsp; Lançar contagem</button></div>
  </div>`, true);
  document.querySelector('#modalRoot .modal').classList.add('count-modal');
  renderStockCountTotals();
}
async function saveStockCount(){
  const ids = Object.keys(stockCountDraft).filter(id=>stockCountQty(stockCountDraft[id])!==null);
  if(!ids.length){ toast('Digite a quantidade contada de pelo menos um insumo.'); return; }
  if(ids.some(id=>stockCountQty(stockCountDraft[id])<0)){ toast('A quantidade contada não pode ser negativa.'); return; }
  const btn = document.getElementById('stockCountSaveBtn'); if(btn) btn.disabled = true;
  const note = (document.getElementById('stockCountNote')?.value||'').trim().slice(0,200);
  // Lê o estoque de novo: a diferença é calculada sobre o número mais atual.
  if(isCloudMode()){
    try{ await (saveQueues.insumos||Promise.resolve()); const r = await storageApi.get(STORE.insumos); if(r){ state.insumos = JSON.parse(r.value); setInsumosBase(state.insumos); } }catch(e){}
  }
  const countId = uid(), at = new Date().toISOString(), user = currentUser ? currentUser.name : '—';
  const consume = {}, restore = {};
  let base = 0, counted = 0;
  ids.forEach(id=>{
    const i = state.insumos.find(x=>x.id===id); if(!i) return;
    const c = stockCountQty(stockCountDraft[id]), stock = Number(i.stock)||0, diff = Math.round((c-stock)*1000)/1000;
    counted++; base += stock*(Number(i.costPerUnit)||0);
    if(diff<0) consume[id] = -diff; else if(diff>0) restore[id] = diff;
  });
  const moves = [];
  const pushMove = (m, type)=>{ const ins = state.insumos.find(x=>x.id===m.insumoId); moves.push({ ins, m:{id:uid(),insumoId:m.insumoId,name:ins?ins.name:'',unit:ins?ins.unit:'',type,operation:'Contagem de estoque',note,countId,before:m.before,qty:m.qty,after:m.after,user,at} }); };
  if(isCloudMode()){
    if(Object.keys(consume).length){
      const { data, error } = await supabaseClient.rpc('consume_insumos', { p_consumptions: consume });
      if(error){ if(btn) btn.disabled = false; toast('Não foi possível lançar a contagem: '+(error.message||'erro no servidor')+'. Confira e tente de novo.', 'error'); return; }
      (data||[]).forEach(m=>pushMove(m,'saida'));
    }
    if(Object.keys(restore).length){
      const { data, error } = await supabaseClient.rpc('restore_insumos', { p_consumptions: restore });
      if(error) toast('As faltas foram lançadas, mas as sobras não: '+(error.message||'erro no servidor')+'. Lance as sobras pela opção Estoque.', 'error');
      else (data||[]).forEach(m=>pushMove(m,'entrada'));
    }
    moves.forEach(x=>{ if(x.ins){ x.ins.stock = x.m.after; markInsumoServerStock(x.ins.id, x.m.after); } });
  } else {
    Object.entries(consume).forEach(([id,qty])=>{ const i = state.insumos.find(x=>x.id===id); const before = Number(i.stock)||0; i.stock = Math.round((before-qty)*1000)/1000; pushMove({insumoId:id,before,qty,after:i.stock},'saida'); });
    Object.entries(restore).forEach(([id,qty])=>{ const i = state.insumos.find(x=>x.id===id); const before = Number(i.stock)||0; i.stock = Math.round((before+qty)*1000)/1000; pushMove({insumoId:id,before,qty,after:i.stock},'entrada'); });
    save('insumos');
  }
  const costOf = id => Number((state.insumos.find(x=>x.id===id)||{}).costPerUnit)||0;
  const loss = moves.filter(x=>x.m.type==='saida').reduce((t,x)=>t+x.m.qty*costOf(x.m.insumoId),0);
  const surplus = moves.filter(x=>x.m.type==='entrada').reduce((t,x)=>t+x.m.qty*costOf(x.m.insumoId),0);
  const summary = {id:uid(),type:'contagem',countId,name:'Contagem de estoque',operation:'Contagem de estoque',note,qty:counted,unit:'itens',countBase:Math.round(base*100)/100,countLoss:Math.round(loss*100)/100,countSurplus:Math.round(surplus*100)/100,user,at};
  state.stockMovements.unshift(summary, ...moves.map(x=>x.m));
  save('stockMovements');
  logAction('Contagem de estoque: '+counted+' itens, '+stockCountSummaryText(summary));
  closeModal(); renderAll();
  toast('Contagem lançada: '+stockCountSummaryText(summary)+'.');
}
function openInsumoModal(id){
  const i = id ? state.insumos.find(x=>x.id===id) : null;
  openModal(i?'Editar Insumo':'Novo Insumo', `<div class="record-body"><div class="record-tabs"><button class="active">Principal</button></div><div class="consumer-form-frame">
    <div class="comp-code-row"><span>Código do sistema:</span><b>${h(i&&i.code||'')}</b><label class="comp-switch"><input id="iActive" type="checkbox" ${!i||i.active!==false?'checked':''}><span></span> Ativo</label></div>
    <div class="field"><label>Nome</label><input id="iName" value="${h(i?i.name:'')}" placeholder="Ex: Pão de hambúrguer"></div>
    <div class="row">
      <div class="field"><label>Unidade</label><select id="iUnit">${UNIT_OPTIONS.map(u=>`<option ${i&&i.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label>Custo por unidade</label><input id="iCost" type="number" step="0.01" value="${i?i.costPerUnit:0}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Estoque atual</label><input id="iStock" type="number" step="0.01" value="${i?i.stock:0}"></div>
      <div class="field"><label>Estoque mínimo (alerta)</label><input id="iMin" type="number" step="0.01" value="${i?i.minStock:5}"></div>
    </div>
    <div class="field"><label>Código PDV</label><input id="iPdv" value="${h(i&&i.pdvCode||'')}"></div></div><div class="consumer-modal-actions"><button class="consumer-delete" id="iDeleteBtn" ${i?'':'disabled'}>✕ Excluir</button><span style="flex:1"></span><button onclick="closeModal()">〈 Voltar</button><button class="consumer-save" id="iSaveBtn">✓ Salvar</button></div></div>`);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');
  document.getElementById('iSaveBtn').onclick = ()=>{
    const name = document.getElementById('iName').value.trim();
    if(!name){ toast('Informe o nome do insumo.'); return; }
    const costPerUnit=parseFloat(document.getElementById('iCost').value);
    const stock=parseFloat(document.getElementById('iStock').value);
    const minStock=parseFloat(document.getElementById('iMin').value);
    if(![costPerUnit,stock,minStock].every(Number.isFinite) || costPerUnit<0 || stock<0 || minStock<0){ toast('Custo e estoques devem ser números iguais ou maiores que zero.'); return; }
    const data = { name, unit:document.getElementById('iUnit').value, costPerUnit, stock, minStock,active:document.getElementById('iActive').checked,pdvCode:document.getElementById('iPdv').value.trim() };
    if(i){ Object.assign(i,data); } else { state.insumos.push({id:uid(),code:String(state.insumos.length+1).padStart(3,'0'), ...data}); }
    save('insumos'); closeModal(); renderAll(); toast('Insumo salvo.');
  };
  if(i)document.getElementById('iDeleteBtn').onclick=()=>deleteInsumo(i.id);
}
function deleteInsumo(id){
  if(state.products.some(p=>(p.recipe||[]).some(r=>r.insumoId===id))){ toast('Este insumo está em uma ficha técnica. Remova o vínculo antes de excluí-lo.'); return; }
  if(!confirm('Excluir este insumo?')) return;
  state.insumos = state.insumos.filter(i=>i.id!==id);selectedInsumoId=null;save('insumos');closeModal();renderAll();toast('Insumo excluído.'); }
function openInsumoStockModal(id){
  const i = state.insumos.find(x=>x.id===id);if(!i)return;
  openModal('Movimentar Estoque — '+i.name, `<div class="consumer-form-frame"><div class="panel"><b>Estoque atual: ${i.stock} ${h(i.unit)}</b><p class="sub">Registre entradas, saídas ou acertos de inventário.</p></div><div class="row"><div class="field"><label>Operação</label><select id="entOperation"><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste">Definir saldo</option></select></div><div class="field"><label>Quantidade</label><input id="entQty" type="number" min="0" step="0.001"></div></div><div class="field"><label>Motivo / Documento</label><input id="entReason" placeholder="Compra, perda, inventário, correção..."></div></div><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" id="entSaveBtn">✓ Confirmar</button></div>`);
  document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');
  document.getElementById('entSaveBtn').onclick = ()=>{
    const q=parseFloat(document.getElementById('entQty').value),operation=document.getElementById('entOperation').value,reason=document.getElementById('entReason').value.trim();if(!Number.isFinite(q)||q<0||(operation!=='ajuste'&&q===0)){toast('Informe uma quantidade válida.');return;}if(!reason){toast('Informe o motivo da movimentação.');return;}const before=Number(i.stock)||0,after=operation==='entrada'?before+q:operation==='saida'?before-q:q;if(after<0){toast('A saída não pode deixar o estoque negativo.');return;}i.stock=after;const type=after>=before?'entrada':'saida';state.stockMovements.unshift({id:uid(),insumoId:i.id,name:i.name,unit:i.unit,type,operation:operation==='ajuste'?'Ajuste de inventário':operation==='entrada'?'Entrada manual':'Saída manual',note:reason,before,qty:Math.abs(after-before),after,user:currentUser?currentUser.name:'—',at:new Date().toISOString()});
    save('stockMovements');save('insumos');closeModal();renderAll();toast('Movimentação registrada.');
  };
}

