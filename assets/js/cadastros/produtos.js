/* ============ PRODUTOS (com ficha técnica) ============ */
let tempRecipe = [];
function effectiveProductRecipe(product,seen){
  if(!product)return [];
  const visited=seen||new Set();if(visited.has(product.id))return [];visited.add(product.id);
  const quantities={};
  (product.recipe||[]).forEach(r=>quantities[r.insumoId]=(quantities[r.insumoId]||0)+(Number(r.qty)||0));
  (product.comboProductIds||[]).forEach(id=>effectiveProductRecipe(state.products.find(x=>x.id===id),new Set(visited)).forEach(r=>quantities[r.insumoId]=(quantities[r.insumoId]||0)+(Number(r.qty)||0)));
  return Object.entries(quantities).map(([insumoId,qty])=>({insumoId,qty}));
}
function productCost(p){ return effectiveProductRecipe(p).reduce((sum,r)=>{ const ins=state.insumos.find(i=>i.id===r.insumoId); return sum + (ins?ins.costPerUnit*r.qty:0); },0); }
function productAvailable(p){
  const recipe=effectiveProductRecipe(p);if(!recipe.length) return Infinity;
  return Math.floor(Math.min(...recipe.map(r=>{ const ins=state.insumos.find(i=>i.id===r.insumoId); return ins ? ins.stock / r.qty : 0; })));
}
function productAvailability(p){return productAvailable(p);}
let produtosTab = 'produto';
let selectedProductId = null;
let productOptionsOpen = false;
// A tela é redesenhada a cada clique numa linha (botões Editar/Duplicar/Estoque); a busca
// digitada fica guardada aqui para não sumir.
let productSearchQuery = '';
function applyProductSearch(){
  const q = productSearchQuery.toLowerCase();
  document.querySelectorAll('#productRows tr[data-search]').forEach(r=>r.style.display=r.dataset.search.includes(q)?'':'none');
}
function productKind(p){ return p.kind==='tamanho'||p.kind==='combo' ? p.kind : 'produto'; }
function setProdutosTab(kind){ produtosTab=kind; selectedProductId=null; productOptionsOpen=false; renderProdutos(); }
function selectProductRow(id){ selectedProductId=id; renderProdutos(); }
function editSelectedProduct(){ if(!selectedProductId){ toast('Selecione um produto para editar.'); return; } openProductModal(selectedProductId); }
function openSelectedProductStock(){
  if(!selectedProductId){toast('Selecione um produto para consultar o estoque.');return;}
  const p=state.products.find(x=>x.id===selectedProductId);if(!p)return;
  const recipe=effectiveProductRecipe(p),availability=productAvailable(p);
  const rows=recipe.map(r=>{const i=state.insumos.find(x=>x.id===r.insumoId),qty=Number(r.qty)||0,stock=Number(i&&i.stock)||0;return `<tr><td>${h(i&&i.name||'Insumo removido')}</td><td>${qty} ${h(i&&i.unit||'')}</td><td>${stock} ${h(i&&i.unit||'')}</td><td>${qty>0?Math.floor(stock/qty):0}</td><td>${fmt((Number(i&&i.costPerUnit)||0)*qty)}</td><td>${stock<=Number(i&&i.minStock)?'Estoque baixo':'Disponível'}</td></tr>`}).join('');
  openModal('Estoque — '+p.name,`<div class="grid3" style="padding:12px"><div class="stat"><div class="lbl">Disponibilidade estimada</div><div class="val">${availability===Infinity?'—':Math.max(0,availability)}</div></div><div class="stat"><div class="lbl">Estoque mínimo</div><div class="val">${Number(p.minStock)||0}</div></div><div class="stat"><div class="lbl">Custo completo</div><div class="val" style="font-size:18px">${fmt(productCost(p))}</div></div></div>${productKind(p)==='combo'?`<p class="sub" style="padding:0 12px">Composição: ${(p.comboProductIds||[]).map(id=>h((state.products.find(x=>x.id===id)||{}).name||'Produto removido')).join(', ')||'não configurada'}</p>`:''}<div class="finance-grid" style="height:360px"><table><thead><tr><th>Insumo</th><th>Consumo por venda</th><th>Estoque atual</th><th>Rendimento</th><th>Custo</th><th>Situação</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">Produto sem ficha técnica calculável.</td></tr>'}</tbody></table></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="op-btn" onclick="closeModal();switchView('insumos')">Abrir Insumos</button><button class="consumer-save" onclick="openProductStockAdjustment(${jsArg(p.id)})">Ajustar estoque</button></div>`,true);
  document.querySelector('#modalRoot .modal').classList.add('app-config-modal');
}
function openProductStockAdjustment(productId){
  closeModal();const p=state.products.find(x=>x.id===productId),recipe=effectiveProductRecipe(p);if(!p||!recipe.length){toast('Cadastre uma ficha técnica para ajustar os insumos deste produto.');return;}
  openModal('Ajustar Estoque — '+p.name,`<div class="consumer-form-frame"><p class="sub">Informe quantas unidades completas deseja adicionar. A composição total do produto ou combo será aplicada aos insumos.</p><div class="field"><label>Unidades do produto</label><input id="productStockUnits" type="number" min="0.001" step="0.001" value="1"></div><div class="field"><label>Motivo</label><input id="productStockReason" placeholder="Inventário, compra ou correção"></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveProductStockAdjustment(${jsArg(productId)})">✓ Registrar entrada</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');
}
function saveProductStockAdjustment(productId){
  const p=state.products.find(x=>x.id===productId),units=parseFloat(document.getElementById('productStockUnits').value),reason=document.getElementById('productStockReason').value.trim();if(!p||!Number.isFinite(units)||units<=0||!reason){toast('Informe unidades e motivo.');return;}
  effectiveProductRecipe(p).forEach(r=>{const i=state.insumos.find(x=>x.id===r.insumoId);if(!i)return;const qty=units*Number(r.qty||0),before=Number(i.stock)||0;i.stock=before+qty;state.stockMovements.unshift({id:uid(),type:'entrada',name:i.name,insumoName:i.name,productId:p.id,operation:productKind(p)==='combo'?'Ajuste pela composição do combo':'Ajuste por produto',before,qty,after:i.stock,note:reason,user:currentUser.name,at:new Date().toISOString()});});save('insumos');save('stockMovements');closeModal();renderAll();toast('Entrada proporcional registrada.');
}
function toggleProductOptions(){ productOptionsOpen=!productOptionsOpen; renderProdutos(); }
function renderProdutos(){
  const el = document.getElementById('view-produtos');
  const list = state.products.filter(p=>productKind(p)===produtosTab).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||a.name.localeCompare(b.name,'pt-BR'));
  const rows = list.length ? list.map(p=>{
    const av = productAvailable(p); const cost = productCost(p); const min=Number(p.minStock)||0; // S5 (auditoria de design): selo só nas exceções (Baixo, Pausado, Conferir, Sem código); o normal é texto.
    return `<tr data-search="${h(((p.code||'')+' '+(p.category||'')+' '+p.name).toLowerCase())}" class="${selectedProductId===p.id?'selected':''}" onclick="selectProductRow(${jsArg(p.id)})" ondblclick="editProduct(${jsArg(p.id)})">
      <td class="mono">${h(p.code||'—')}</td><td>${h(p.category||'—')}</td><td>${h(p.name)}</td><td class="mono">${fmt(cost)}</td><td class="mono">${fmt(p.price)}</td><td>${h(p.measure||'un')}</td>
      <td class="mono">${av===Infinity?'—':av}</td><td class="mono">${min}</td><td>${av!==Infinity&&av<=min?'<span class="tag tag-red">Baixo</span>':'<span class="tag-quiet">Normal</span>'}</td>
      <td>${(p.recipe||[]).length?'<span class="tag-quiet">Configurada</span>':'—'}</td><td>${p.active===false?'<span class="tag tag-gray">Pausado</span>':'<span class="tag-quiet">À venda</span>'}</td><td class="mono">${h(p.pdvCode||'—')}</td>
      <td>${{ok:'<span class="tag-quiet">OK</span>', conferir:'<span class="tag tag-gray">Conferir</span>', vazio:'<span class="tag tag-red">Sem código</span>'}[productFiscalStatus(p)]}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="13" class="empty">Nenhum produto encontrado</td></tr>`;
  const avgCost=list.length?list.reduce((s,p)=>s+productCost(p),0)/list.length:0;
  const avgPrice=list.length?list.reduce((s,p)=>s+(Number(p.price)||0),0)/list.length:0;
  el.innerHTML = `<div class="workspace-gray"><section class="op-window product-window">
    <header class="op-titlebar"><span>Produtos</span><span class="op-controls"><span onclick="closeOperationalWindow()" style="cursor:pointer" title="Fechar">×</span></span></header>
    <div class="op-toolbar">
      <div class="op-search"><span>⌕</span><input id="productSearch" placeholder="Pesquisar aqui..." value="${h(productSearchQuery)}"></div><div class="op-toolbar-spacer"></div>
      <div style="position:relative"><button class="op-btn" onclick="toggleProductOptions()"><span class="op-ico">•••</span> Opções <span style="margin-left:8px">▾</span></button>${productOptionsOpen?`<div class="pdv-menu product-options-menu" style="top:48px;right:0;left:auto;min-width:270px"><button onclick="productOptionsOpen=false;window.print()">▣ &nbsp; Imprimir</button><button onclick="openProductOrderModal()">↕ &nbsp; Ajustar Ordem</button><button onclick="openFiscalBulkModal()">▤ &nbsp; Dados fiscais (NFC-e)</button><div class="menu-title">Exportar Produtos</div><button onclick="exportProductsXlsx()">▧ &nbsp; Para arquivo Excel (.xlsx)</button><button onclick="exportProductsPackage()">▧ &nbsp; Para arquivo Commandah (.ccprod)</button><div class="menu-title">Importar Produtos</div><button onclick="openProductImportWizard()">▧ &nbsp; De arquivo Excel (.xlsx)</button><button onclick="pickProductsImport('json')">▧ &nbsp; De arquivo Commandah (.ccprod)</button></div>`:''}</div>
      <button class="op-btn" onclick="refreshProductList()">↻ &nbsp; Atualizar Lista</button>
      <button class="op-btn" onclick="duplicateSelectedProduct()" ${selectedProductId?'':'disabled'}>▣ &nbsp; Duplicar</button>
      <button class="op-btn" onclick="openSelectedProductStock()" ${selectedProductId?'':'disabled'}><span class="op-ico">▣</span> Estoque</button>
      <button class="op-btn" onclick="editSelectedProduct()" ${selectedProductId?'':'disabled'}><span class="op-ico">✎</span> Editar</button>
      <button class="op-btn primary" onclick="openProductModal()"><span class="op-ico">＋</span> Novo</button>
    </div>
    <div class="op-tabs">
      <button onclick="setProdutosTab('produto')" class="${produtosTab==='produto'?'active':''}">Produtos (${state.products.filter(p=>productKind(p)==='produto').length})</button>
      <button onclick="setProdutosTab('tamanho')" class="${produtosTab==='tamanho'?'active':''}">Produto por Tamanho (${state.products.filter(p=>productKind(p)==='tamanho').length})</button>
      <button onclick="setProdutosTab('combo')" class="${produtosTab==='combo'?'active':''}">Combos (${state.products.filter(p=>productKind(p)==='combo').length})</button>
    </div>
    <div class="op-grid"><table><thead><tr><th>Cód. Sistema</th><th>Categoria</th><th>Nome</th><th>Preço Custo</th><th>Preço Venda</th><th>Medida</th><th>Estoque</th><th>Estoque Mín</th><th>Sit. Estoque</th><th>Ficha Técnica</th><th>Status Venda</th><th>Cód. PDV</th><th>NFC-e</th></tr></thead><tbody id="productRows">${rows}</tbody></table></div>
    <footer class="op-footer"><span>Registros: ${list.length}</span><span>Média=${fmt(avgCost)}</span><span>Média=${fmt(avgPrice)}</span></footer>
  </section></div>`;
  document.getElementById('productSearch').oninput=e=>{productSearchQuery=e.target.value;applyProductSearch();};
  applyProductSearch();
}
function exportProductsXlsx(){
  productOptionsOpen=false;
  if(!window.XLSX){toast('Não foi possível carregar o gerador de planilhas — verifique sua conexão e tente de novo.');return;}
  const cols=['Cód. Sistema','Categoria','Nome','Preço Custo','Preço Venda','Medida','Estoque Mín','Status Venda','Cód. PDV','NCM','CEST','CFOP','CSOSN','Origem','Fiscal conferido'];
  const rows=state.products.map(p=>{ const f=p.fiscal||{};
    return [p.code||'',p.category||'',p.name,Number(productCost(p))||0,Number(p.price)||0,p.measure||'un',Number(p.minStock)||0,p.active===false?'Pausado':'Ativo',p.pdvCode||'',
      fiscalFmtNcm(f.ncm),fiscalFmtCest(f.cest),f.cfop||'',f.csosn||'',f.ncm?(f.origem||'0'):'',{ok:'Sim',conferir:'Não',vazio:''}[productFiscalStatus(p)]]; });
  const ws=XLSX.utils.aoa_to_sheet([cols,...rows]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Produtos');
  XLSX.writeFile(wb,'produtos-'+todayStr()+'.xlsx');
  logAction('Produtos exportados em Excel (.xlsx)');
}
function exportProductsPackage(){
  productOptionsOpen=false;
  const payload={format:'commandah-produtos',version:1,exportedAt:new Date().toISOString(),products:state.products};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));a.download='pacote-produtos-'+todayStr()+'.ccprod';a.click();URL.revokeObjectURL(a.href);logAction('Pacote de produtos exportado (.ccprod)');
}
function refreshProductList(){productOptionsOpen=false;renderProdutos();toast('Lista de produtos atualizada.');}
function duplicateSelectedProduct(){productOptionsOpen=false;const source=state.products.find(p=>p.id===selectedProductId);if(!source){toast('Selecione um produto para duplicar.');return;}const copy=JSON.parse(JSON.stringify(source));copy.id=uid();copy.code='';copy.pdvCode='';copy.name=source.name+' — Cópia';copy.sortOrder=state.products.length+1;state.products.push(copy);selectedProductId=copy.id;save('products');renderProdutos();toast('Produto duplicado. Revise o cadastro antes de utilizar.');logAction('Produto duplicado: '+source.name);}
function openProductOrderModal(){
  productOptionsOpen=false;
  const list=state.products.filter(p=>productKind(p)===produtosTab).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||a.name.localeCompare(b.name,'pt-BR'));
  openModal('Ajustar Ordem dos Produtos',`<p class="sub">Defina a posição de exibição dos itens desta seção. Números menores aparecem primeiro.</p><div class="product-order-list">${list.map((p,index)=>`<div class="product-order-row"><span class="mono">${index+1}</span><span>${h(p.name)}</span><input type="number" min="1" step="1" value="${Number(p.sortOrder)||index+1}" data-product-order="${p.id}"></div>`).join('')||'<p class="empty">Nenhum produto nesta seção.</p>'}</div><div class="record-actions"><button class="op-btn" onclick="closeModal()">Voltar</button><button class="op-btn primary" onclick="saveProductOrder()">Salvar Ordem</button></div>`,true);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');
}
function saveProductOrder(){
  const fields=[...document.querySelectorAll('[data-product-order]')];
  fields.sort((a,b)=>(Number(a.value)||999999)-(Number(b.value)||999999)).forEach((field,index)=>{const product=state.products.find(p=>p.id===field.dataset.productOrder);if(product)product.sortOrder=index+1;});
  save('products');closeModal();renderAll();toast('Ordem dos produtos atualizada.');logAction('Ordem manual dos produtos atualizada');
}
function pickProductsImport(format){
  productOptionsOpen=false;
  const input=document.createElement('input');input.type='file';
  input.accept=format==='csv'?'.csv,text/csv':format==='xlsx'?'.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel':'.ccprod,.json,application/json';
  input.onchange=()=>{
    const file=input.files&&input.files[0];if(!file)return;
    if(format==='xlsx'){
      if(!window.XLSX){toast('Não foi possível carregar o leitor de planilhas — verifique sua conexão e tente de novo.');return;}
      const reader=new FileReader();
      reader.onload=()=>{
        try{
          const wb=XLSX.read(reader.result,{type:'array'});
          const sheet=wb.Sheets[wb.SheetNames[0]];
          const rows=XLSX.utils.sheet_to_json(sheet,{defval:''});
          const incoming=parseProductsSheetRows(rows);
          mergeImportedProducts(incoming,file.name);
        }catch(error){toast(error.message||'Não foi possível ler essa planilha.');}
      };
      reader.onerror=()=>toast('Não foi possível ler o arquivo.');
      reader.readAsArrayBuffer(file);
      return;
    }
    const reader=new FileReader();
    reader.onload=()=>{try{const incoming=format==='csv'?parseProductsCsv(String(reader.result||'')):parseProductsPackage(String(reader.result||''));mergeImportedProducts(incoming,file.name);}catch(error){toast(error.message||'Não foi possível importar o arquivo.');}};
    reader.readAsText(file,'UTF-8');
  };
  input.click();
}
function pickHeaderValue(row,candidates){
  const keys=Object.keys(row);
  for(const cand of candidates){
    const found=keys.find(k=>k.trim().toLowerCase()===cand.toLowerCase());
    if(found!==undefined) return row[found];
  }
  return '';
}
function parseProductsSheetRows(rows){
  if(!rows.length) throw new Error('A planilha não possui linhas de produtos.');
  return rows.map(row=>{
    const name=String(pickHeaderValue(row,['Nome','Produto','Descrição'])||'').trim();
    const code=String(pickHeaderValue(row,['Código','Cód. Busca','Cod. Busca','Cód','Codigo'])||'').trim();
    const pdvCode=String(pickHeaderValue(row,['Cód. PDV','Cod. PDV','Código PDV'])||'').trim();
    const category=String(pickHeaderValue(row,['Categoria'])||'').trim();
    const measure=String(pickHeaderValue(row,['Medida','Unidade'])||'un').trim()||'un';
    const priceRaw=pickHeaderValue(row,['Preço Venda','Preço de venda','Preco Venda','Preço']);
    const costRaw=pickHeaderValue(row,['Preço Custo','Custo estimado','Preco Custo','Custo']);
    const minStockRaw=pickHeaderValue(row,['Estoque Mín','Estoque mínimo','Estoque Min']);
    const statusRaw=String(pickHeaderValue(row,['Status Venda','Status','Sit. Estoque'])||'ativo').trim().toLowerCase();
    return {
      name, code, pdvCode, category, measure,
      kind:'produto',
      price: Number(String(priceRaw||0).toString().replace(',','.'))||0,
      costPerUnit: Number(String(costRaw||0).toString().replace(',','.'))||0,
      minStock: Number(String(minStockRaw||0).toString().replace(',','.'))||0,
      active: statusRaw!=='pausado' && statusRaw!=='inativo'
    };
  }).filter(p=>p.name && !/^total\s*itens/i.test(p.name));
}
function parseProductsCsv(text){
  const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===';'&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(v=>v.trim()))rows.push(row);row=[];}else cell+=ch;}if(cell||row.length){row.push(cell);rows.push(row);}if(rows.length<2)throw new Error('A planilha não possui produtos.');
  return rows.slice(1).map(cols=>({code:(cols[0]||'').trim(),kind:(cols[1]||'produto').trim(),category:(cols[2]||'').trim(),name:(cols[3]||'').trim(),measure:(cols[4]||'un').trim(),price:Number(String(cols[5]||0).replace(',','.'))||0,minStock:Number(String(cols[7]||0).replace(',','.'))||0,active:(cols[8]||'ativo').trim().toLowerCase()!=='pausado'})).filter(p=>p.name);
}
function parseProductsPackage(text){const data=JSON.parse(text);const list=Array.isArray(data)?data:data&&(data.format==='commandah-produtos'||data.format==='cantina-produtos')&&Array.isArray(data.products)?data.products:null;if(!list)throw new Error('Pacote de produtos inválido.');return list.filter(p=>p&&typeof p.name==='string'&&p.name.trim());}
const IMPORT_FIELDS = [
  {key:'name', label:'Nome do Produto', required:true, guesses:['Nome','Produto','Descrição']},
  {key:'price', label:'Preço Venda', required:true, guesses:['Preço Venda','Preço de venda','Preco Venda','Preço']},
  {key:'cost', label:'Preço Custo', required:false, guesses:['Preço Custo','Custo estimado','Preco Custo','Custo']},
  {key:'category', label:'Categoria', required:false, guesses:['Categoria']},
  {key:'measure', label:'Medida', required:false, guesses:['Medida','Unidade']},
  {key:'minStock', label:'Estoque Mínimo', required:false, guesses:['Estoque Mín','Estoque mínimo','Estoque Min']},
  {key:'pdvCode', label:'Código PDV', required:false, guesses:['Cód. PDV','Cod. PDV','Código PDV']},
  {key:'code', label:'Código Personalizado', required:false, guesses:['Código','Cód. Busca','Cod. Busca','Cód','Codigo']},
  // t204: estação de preparo e dados fiscais (exportação do Saipos ou planilha do contador)
  {key:'estacao', label:'Estação de preparo', required:false, guesses:['Estação','Estacao','Setor','Local de preparo','Impressora','Produção','Producao']},
  {key:'ncm', label:'NCM', required:false, guesses:['NCM','NCM confirmado','NCM sugerido']},
  {key:'cest', label:'CEST', required:false, guesses:['CEST','CEST confirmado','CEST sugerido']},
  {key:'cfop', label:'CFOP', required:false, guesses:['CFOP','CFOP confirmado','CFOP sugerido']},
  {key:'csosn', label:'CSOSN', required:false, guesses:['CSOSN','CSOSN confirmado','CSOSN sugerido','CST','Situação Tributária','Situacao Tributaria']},
  {key:'origem', label:'Origem (fiscal)', required:false, guesses:['Origem','Origem da mercadoria']}
];
// Texto da planilha -> chave da estação (nome ou chave cadastrados; "sem preparo" -> nenhuma). '' = não mexe.
function importEstacaoKey(v){
  const t = String(v||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  if(!t) return '';
  if(/^(nenhum|nenhuma|sem preparo|nao exige|pronto|industrializado)/.test(t)) return 'nenhuma';
  const e = state.estacoes.find(x=>[x.chave, x.nome].some(n=>String(n||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')===t));
  return e ? e.chave : '';
}
// Dados fiscais de uma linha. null = sem NCM válido (o produto fica como está).
function importFiscal(ncm, cest, cfop, csosn, origem){
  const n = fiscalDigits(ncm), ce = fiscalDigits(cest), cf = fiscalDigits(cfop);
  let cs = fiscalDigits(csosn); if(cs.length>3) cs = cs.slice(-3);
  if(n.length!==8) return null;
  if(ce && ce.length!==7) return null;
  if(cf && !/^[5-6]\d{3}$/.test(cf)) return null;
  const o = fiscalDigits(origem).slice(0,1) || '0';
  return { ncm:n, cest:ce, cfop:cf, csosn:cs, origem:o, status:'conferir', nota:'Importado de planilha em '+new Date().toLocaleDateString('pt-BR')+'. Conferir com o contador.' };
}
let importWorkbook=null, importSheetName='', importHeaders=[], importRows=[], importMapping={};
function openProductImportWizard(){
  productOptionsOpen=false;
  importWorkbook=null; importSheetName=''; importHeaders=[]; importRows=[]; importMapping={};
  openModal('Importar Produtos', `
    <div class="import-tabs">
      <button class="import-tab active" id="impTabConfigBtn" onclick="switchImportTab('config')">Configurar Importação</button>
      <button class="import-tab" id="impTabPreviewBtn" onclick="switchImportTab('preview')">Visualizar Registros da Planilha <span id="impRowCount"></span></button>
    </div>
    <div id="importTabConfig">
      <button class="btn" onclick="pickImportExcelFile()">📊 &nbsp; Abrir Arquivo Excel...</button>
      <div class="row" style="margin-top:16px;align-items:flex-start;gap:20px">
        <div style="width:170px;flex-shrink:0">
          <label class="np-label">Planilha selecionada</label>
          <div id="importSheetList" class="import-sheet-list"><p class="sub">Abra um arquivo para ver as planilhas.</p></div>
        </div>
        <div style="flex:1;min-width:0">
          <label class="np-label">Mapear colunas</label>
          <table class="finance-grid" style="width:100%"><thead><tr><th style="width:80px">Obrigat.</th><th>Campo no Commandah</th><th>Coluna na Planilha</th></tr></thead><tbody id="importMapRows"><tr><td colspan="3" class="empty">Abra um arquivo Excel para mapear as colunas.</td></tr></tbody></table>
        </div>
      </div>
    </div>
    <div id="importTabPreview" style="display:none">
      <div class="finance-grid" style="max-height:360px;overflow:auto"><table><thead><tr id="importPreviewHead"></tr></thead><tbody id="importPreviewRows"></tbody></table></div>
    </div>
    <div class="record-actions">
      <button class="op-btn" onclick="closeModal()">〈 &nbsp; Voltar</button>
      <button class="op-btn primary" id="impStartBtn" disabled onclick="startMappedImport()">▷ &nbsp; Iniciar Importação</button>
    </div>
  `, true);
  const modal=document.querySelector('#modalRoot .modal'); modal.classList.add('record-modal'); modal.style.width='860px';
}
function switchImportTab(tab){
  document.getElementById('impTabConfigBtn').classList.toggle('active', tab==='config');
  document.getElementById('impTabPreviewBtn').classList.toggle('active', tab==='preview');
  document.getElementById('importTabConfig').style.display = tab==='config'?'block':'none';
  document.getElementById('importTabPreview').style.display = tab==='preview'?'block':'none';
}
function pickImportExcelFile(){
  if(!window.XLSX){ toast('Não foi possível carregar o leitor de planilhas — verifique sua conexão e tente de novo.'); return; }
  const input=document.createElement('input'); input.type='file'; input.accept='.xlsx,.xls';
  input.onchange=()=>{
    const file=input.files&&input.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        importWorkbook = XLSX.read(reader.result,{type:'array'});
        importSheetName = importWorkbook.SheetNames[0];
        renderImportSheetList();
        loadImportSheet();
      }catch(e){ toast('Não foi possível ler esse arquivo.'); }
    };
    reader.onerror=()=>toast('Não foi possível ler o arquivo.');
    reader.readAsArrayBuffer(file);
  };
  input.click();
}
function renderImportSheetList(){
  const el=document.getElementById('importSheetList'); if(!el) return;
  el.innerHTML = importWorkbook.SheetNames.map(name=>`<button class="import-sheet-item ${name===importSheetName?'active':''}" onclick="selectImportSheet(${h(JSON.stringify(name))})">${h(name)}</button>`).join('');
}
function selectImportSheet(name){ importSheetName=name; renderImportSheetList(); loadImportSheet(); }
function loadImportSheet(){
  const sheet = importWorkbook.Sheets[importSheetName];
  const raw = XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
  if(!raw.length){ importHeaders=[]; importRows=[]; }
  else{
    importHeaders = raw[0].map(c=>String(c||'').trim()).filter(Boolean);
    importRows = raw.slice(1).filter(r=>r.some(v=>String(v||'').trim()) && !r.some(v=>/^total\s*itens/i.test(String(v||''))));
  }
  IMPORT_FIELDS.forEach(f=>{
    const guess = importHeaders.find(col=>f.guesses.some(g=>g.toLowerCase()===col.toLowerCase()));
    importMapping[f.key] = guess || '';
  });
  renderImportMapTable();
  renderImportPreview();
  updateImportStartState();
}
function renderImportMapTable(){
  const el=document.getElementById('importMapRows'); if(!el) return;
  if(!importHeaders.length){ el.innerHTML='<tr><td colspan="3" class="empty">Abra um arquivo Excel para mapear as colunas.</td></tr>'; return; }
  el.innerHTML = IMPORT_FIELDS.map(f=>`<tr>
    <td style="text-align:center">${f.required?'<span style="color:var(--red);font-size:18px">●</span>':''}</td>
    <td>${h(f.label)}</td>
    <td><select onchange="importMapping[${jsArg(f.key)}]=this.value;updateImportStartState()">
      <option value="">— Selecione uma coluna —</option>
      ${importHeaders.map(col=>`<option value="${h(col)}" ${importMapping[f.key]===col?'selected':''}>${h(col)}</option>`).join('')}
    </select></td>
  </tr>`).join('');
}
function renderImportPreview(){
  const head=document.getElementById('importPreviewHead'), body=document.getElementById('importPreviewRows'), countEl=document.getElementById('impRowCount');
  if(countEl) countEl.textContent = importRows.length ? '('+importRows.length+')' : '';
  if(!head||!body) return;
  head.innerHTML = importHeaders.map(c=>`<th>${h(c)}</th>`).join('');
  body.innerHTML = importRows.length ? importRows.slice(0,200).map(r=>`<tr>${importHeaders.map((c,i)=>`<td>${h(String(r[i]!==undefined?r[i]:''))}</td>`).join('')}</tr>`).join('') : '<tr><td class="empty">Nenhum registro.</td></tr>';
}
function updateImportStartState(){
  const btn=document.getElementById('impStartBtn'); if(!btn) return;
  btn.disabled = !(importMapping.name && importMapping.price && importRows.length);
}
function startMappedImport(){
  const colIndex = name => importHeaders.indexOf(name);
  const idx = {}; Object.keys(importMapping).forEach(k=>idx[k]=colIndex(importMapping[k]));
  const val = (r,k) => idx[k]>=0 ? r[idx[k]] : '';
  const incoming = importRows.map(r=>{
    const name = String(val(r,'name')||'').trim();
    if(!name) return null;
    return {
      name,
      price: Number(String(val(r,'price')||0).toString().replace(',','.'))||0,
      costPerUnit: Number(String(val(r,'cost')||0).toString().replace(',','.'))||0,
      category: String(val(r,'category')||'').trim(),
      measure: String(val(r,'measure')||'un').trim()||'un',
      minStock: Number(String(val(r,'minStock')||0).toString().replace(',','.'))||0,
      pdvCode: String(val(r,'pdvCode')||'').trim(),
      code: String(val(r,'code')||'').trim(),
      kind:'produto', active:true,
      // t204: só vão quando a coluna foi mapeada e o valor é válido (senão o produto fica como está)
      ...(importEstacaoKey(val(r,'estacao')) ? { estacao: importEstacaoKey(val(r,'estacao')) } : {}),
      ...(idx.ncm>=0 && importFiscal(val(r,'ncm'), val(r,'cest'), val(r,'cfop'), val(r,'csosn'), val(r,'origem')) ? { fiscal: importFiscal(val(r,'ncm'), val(r,'cest'), val(r,'cfop'), val(r,'csosn'), val(r,'origem')) } : {}),
      _ncmInvalido: idx.ncm>=0 && String(val(r,'ncm')||'').trim()!=='' && !importFiscal(val(r,'ncm'), val(r,'cest'), val(r,'cfop'), val(r,'csosn'), val(r,'origem')),
      _estacaoDesconhecida: idx.estacao>=0 && String(val(r,'estacao')||'').trim()!=='' && !importEstacaoKey(val(r,'estacao')) ? String(val(r,'estacao')).trim() : '',
      _cols: Object.keys(idx).filter(k=>idx[k]>=0) // colunas mapeadas: na atualização só elas mudam
    };
  }).filter(Boolean);
  closeModal();
  mergeImportedProducts(incoming, importSheetName||'planilha selecionada');
}
// Qual produto do cadastro é o mesmo da linha importada: id, código PDV, código (menos o "0" da
// importação antiga) ou, sem código, nome + categoria iguais (o mesmo nome existe em várias
// categorias: AMSTEL lata, long neck, 600 ml…). Nunca só pelo nome.
function findImportMatch(raw, taken){
  const norm = s=>String(s||'').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ');
  const code = String(raw.code||'').trim(), pdvCode = String(raw.pdvCode||'').trim();
  const free = p=>!taken.has(p.id);
  return state.products.find(p=>free(p) && raw.id && p.id===raw.id)
    || (pdvCode && state.products.find(p=>free(p) && String(p.pdvCode||'').trim()===pdvCode))
    || (code && code!=='0' && state.products.find(p=>free(p) && String(p.code||'').trim()===code))
    || (raw.category ? (()=>{ const c = state.products.filter(p=>free(p) && norm(p.name)===norm(raw.name) && norm(p.category)===norm(raw.category)); return c.length===1 ? c[0] : null; })() : null)
    || null;
}
function mergeImportedProducts(incoming,fileName){
  if(!incoming.length){toast('Nenhum produto válido foi encontrado.');return;}
  const full = !incoming[0] || !incoming[0]._cols; // pacote .ccprod: cadastro completo
  const taken = new Set();
  const plan = incoming.map(raw=>{ const existing = findImportMatch(raw, taken); if(existing) taken.add(existing.id); return { raw, existing }; });
  const novos = plan.filter(x=>!x.existing), atual = plan.filter(x=>x.existing);
  const comFiscal = incoming.filter(r=>r.fiscal).length, comEstacao = incoming.filter(r=>r.estacao).length;
  const ncmRuim = incoming.filter(r=>r._ncmInvalido).map(r=>r.name), estRuim = [...new Set(incoming.map(r=>r._estacaoDesconhecida).filter(Boolean))];
  const list = (arr, f)=>arr.slice(0,12).map(f).join(', ')+(arr.length>12?' e mais '+(arr.length-12):'');
  openModal('Conferir a importação', `
    <p class="sub" style="margin-top:0">${h(fileName)}: ${incoming.length} linha(s). Nada é gravado até você clicar em "Importar".</p>
    <div class="finance-grid"><table><tbody>
      <tr><td><b>${novos.length}</b> produto(s) novo(s)</td><td class="sub">${h(list(novos, x=>x.raw.name))}</td></tr>
      <tr><td><b>${atual.length}</b> já existente(s), serão atualizados</td><td class="sub">${h(list(atual, x=>x.existing.name+(x.existing.category?' ('+x.existing.category+')':'')))}${full?'':' — só o que a planilha traz preenchido; ficha técnica e o resto do cadastro ficam como estão'}</td></tr>
      ${comFiscal?`<tr><td><b>${comFiscal}</b> com dados fiscais</td><td class="sub">entram como "a conferir" na aba Fiscal</td></tr>`:''}
      ${comEstacao?`<tr><td><b>${comEstacao}</b> com estação de preparo</td><td class="sub">define a impressora de cada produto</td></tr>`:''}
      ${ncmRuim.length?`<tr><td style="color:var(--c-danger)"><b>${ncmRuim.length}</b> com NCM/CEST/CFOP inválido</td><td class="sub">ficam sem dados fiscais: ${h(list(ncmRuim, n=>n))}</td></tr>`:''}
      ${estRuim.length?`<tr><td style="color:var(--c-danger)">Estação não reconhecida</td><td class="sub">${h(estRuim.join(', '))} — cadastre a estação ou corrija na planilha; esses produtos ficam com a estação atual</td></tr>`:''}
    </tbody></table></div>
    <div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="primary" id="importConfirmBtn">Importar</button></div>`, true);
  document.querySelector('#modalRoot .modal').classList.add('app-config-modal');
  document.getElementById('importConfirmBtn').onclick = ()=>{
    plan.forEach(({ raw, existing })=>{
      const code = String(raw.code||'').trim(), pdvCode = String(raw.pdvCode||'').trim();
      const clean = { ...raw }; delete clean._cols; delete clean._ncmInvalido; delete clean._estacaoDesconhecida;
      if(existing && !full){
        // Atualização parcial: só o que veio preenchido.
        const patch = { name:String(raw.name).trim(), price:Math.max(0,Number(raw.price)||0) };
        if(raw.category) patch.category = String(raw.category);
        if(raw._cols.includes('measure') && raw.measure) patch.measure = String(raw.measure);
        if(raw._cols.includes('minStock')) patch.minStock = Math.max(0,Number(raw.minStock)||0);
        if(raw._cols.includes('cost') && Number(raw.costPerUnit)>0) patch.costPerUnit = Number(raw.costPerUnit);
        if(pdvCode) patch.pdvCode = pdvCode;
        if(code && code!=='0') patch.code = code;
        if(raw.estacao){ patch.estacao = raw.estacao; patch.kitchenItem = raw.estacao==='cozinha'; }
        if(raw.fiscal) patch.fiscal = raw.fiscal;
        Object.assign(existing, patch);
        return;
      }
      const normalized={...clean,id:existing?existing.id:(raw.id||uid()),name:String(raw.name).trim(),code,pdvCode,kind:['produto','tamanho','combo'].includes(raw.kind)?raw.kind:'produto',category:String(raw.category||''),measure:String(raw.measure||'un'),price:Math.max(0,Number(raw.price)||0),minStock:Math.max(0,Number(raw.minStock)||0),active:raw.active!==false,recipe:Array.isArray(raw.recipe)?raw.recipe:(existing&&existing.recipe||[])};
      if(normalized.estacao) normalized.kitchenItem = normalized.estacao==='cozinha';
      if(existing)Object.assign(existing,normalized);else state.products.push(normalized);
    });
    save('products'); closeModal(); renderAll();
    toast(`${novos.length} produto(s) novo(s) e ${atual.length} atualizado(s).`);
    logAction('Produtos importados de '+fileName+': '+novos.length+' novos, '+atual.length+' atualizados'+(comFiscal?', '+comFiscal+' com dados fiscais':''));
  };
}
function renderRecipeRows(){
  const el = document.getElementById('recipeRowsList'); if(!el) return;
  el.innerHTML = tempRecipe.map((r,idx)=>`
    <div class="recipe-row">
      <select onchange="tempRecipe[${idx}].insumoId=this.value">
        ${state.insumos.map(i=>`<option value="${i.id}" ${r.insumoId===i.id?'selected':''}>${h(i.name)} (${h(i.unit)})</option>`).join('')}
      </select>
      <input type="number" step="0.01" value="${r.qty}" onchange="tempRecipe[${idx}].qty=parseFloat(this.value)||0">
      <button class="btn btn-sm btn-danger" onclick="removeRecipeRow(${idx})">Remover</button>
    </div>`).join('') || `<p class="empty" style="padding:10px">Nenhum insumo vinculado ainda.</p>`;
}
function addRecipeRow(){
  if(!state.insumos.length){ toast('Cadastre insumos primeiro na aba Insumos.'); return; }
  tempRecipe.push({insumoId: state.insumos[0].id, qty:1}); renderRecipeRows();
}
function removeRecipeRow(idx){ tempRecipe.splice(idx,1); renderRecipeRows(); }
function setProductModalTab(tab){
  document.querySelectorAll('.record-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.record-pane').forEach(p=>p.classList.toggle('active',p.dataset.pane===tab));
}
