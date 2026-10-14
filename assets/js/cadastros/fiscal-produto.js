/* ============ DADOS FISCAIS DO PRODUTO (NFC-e, t207) ============
   p.fiscal = { ncm:'21069090', cest:'', cfop:'5101', csosn:'102', origem:'0', status:'ok'|'conferir', nota }
   Só dígitos nos códigos (é assim que o emissor espera). status 'conferir' = falta o contador confirmar.
   As sugestões seguem o que o Saipos usa hoje (comida 2106.90.90 / 5101 / 102, conferido em 12/10)
   e a planilha codigos-fiscais-sugeridos.xlsx (bebidas: NCM e CSOSN 500 iguais ao Saipos; CEST e CFOP a conferir). */
const FISCAL_CSOSN = [['102','102 · Tributada pelo Simples sem permissão de crédito'],['103','103 · Isenta pelo Simples (faixa de receita)'],['300','300 · Imune'],['400','400 · Não tributada'],['500','500 · ICMS já cobrado por substituição tributária'],['900','900 · Outros']];
const FISCAL_ORIGEM = [['0','0 · Nacional'],['1','1 · Estrangeira, importação direta'],['2','2 · Estrangeira, comprada no Brasil'],['3','3 · Nacional, mais de 40% importado'],['5','5 · Nacional, até 40% importado'],['8','8 · Nacional, mais de 70% importado']];
const FISCAL_FOOD_CATS = /\b(LANCHE|LANCHES|MASSA|MASSAS|MISTO|MISTOS|OVO|OVOS|PASTEL|PASTEIS|PASTÉIS|PORCAO|PORCOES|PORÇÃO|PORÇÕES|PRATO|PRATOS|REFEICAO|REFEICOES|REFEIÇÃO|REFEIÇÕES|KIDS|ESPETINHO|ESPETINHOS|SOBREMESA|SOBREMESAS|SALGADO|SALGADOS|PIZZA|PIZZAS)\b/;
const FISCAL_BEER = /\b(CERVEJA|CERVEJAS|LONG NECK|LONGNECK|CHOPP|CHOPE|AMSTEL|HEINEKEN|BRAHMA|SKOL|BUDWEISER|CORONA|EISENBAHN|ORIGINAL|SPATEN|STELLA|ANTARTICA|ANTARCTICA|MICHELOB|PATAGONIA|MALZBIER|ITAIPAVA|BOHEMIA|DEVASSA|IMPERIO|IMPÉRIO)\b/;
function fiscalDigits(v){ return String(v||'').replace(/\D/g,''); }
function fiscalFmtNcm(v){ const d=fiscalDigits(v); return d.length===8 ? d.slice(0,4)+'.'+d.slice(4,6)+'.'+d.slice(6) : d; }
function fiscalFmtCest(v){ const d=fiscalDigits(v); return d.length===7 ? d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5) : d; }
function productFiscalStatus(p){
  const f = p && p.fiscal;
  if(!f || !fiscalDigits(f.ncm)) return 'vazio';
  return f.status==='ok' ? 'ok' : 'conferir';
}
// Sugestão pelos dados do produto. null = não sei sugerir (fica em branco para alguém preencher).
function suggestProductFiscal(p){
  const t = ((p.category||'')+' '+(p.name||'')).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const zero = /\bZERO\b|\b0[,.]0\b|SEM ALCOOL/.test(t);
  const pack = /\bLATA\b|\b(269|350|473)\s?ML\b/.test(t) ? 'lata' : /LONG ?NECK|\b(275|330|355)\s?ML\b/.test(t) ? 'longneck' : /\b600\s?ML\b|\b1\s?L\b|\bLITRAO\b/.test(t) ? 'retornavel' : '';
  const st = { cfop:'5405', csosn:'500', origem:'0' };
  if(FISCAL_BEER.test(t) && !/\bH2OH\b|REFRIGERANTE|GUARANA|\bSODA\b|TONICA|\bAGUA\b/.test(t)){
    const cest = zero ? {lata:'0302203', longneck:'0302201', retornavel:'0302200'}[pack] : {lata:'0302103', longneck:'0302101', retornavel:'0302100'}[pack];
    return { ...st, ncm: zero?'22029100':'22030000', cest: cest||'', status:'conferir',
      nota:(zero?'Cerveja sem álcool':'Cerveja')+'. NCM e CSOSN 500 iguais ao Saipos; CEST'+(cest?' pela embalagem':' (embalagem não identificada)')+' e CFOP a conferir com o contador.' };
  }
  if(/REFRIGERANTE|\bCOCA\b|GUARANA|\bPEPSI\b|\bFANTA\b|\bSPRITE\b|\bSCHWEPPES\b|\bSODA\b|\bH2OH\b|\bTONICA\b/.test(t))
    return { ...st, ncm:'22021000', cest:'', status:'conferir', nota:'Refrigerante. Atenção: no Saipos a Coca-Cola está com o NCM de cerveja (2203.00.00); o certo é 2202.10.00. CEST e CFOP a conferir.' };
  if(/ISOTONICO|GATORADE|POWERADE|ENERGETICO|RED BULL|MONSTER/.test(t))
    return { ...st, ncm:'22029900', cest:'', status:'conferir', nota:'Isotônico/energético. CEST e CFOP a conferir na nota de compra.' };
  if(/AGUA DE COCO/.test(t))
    return { cfop:'5102', csosn:'102', origem:'0', ncm:'20098990', cest:'', status:'conferir', nota:'Água de coco: 20.09 se for pura; com açúcar ou aditivos, 2202.99.00. Conferir na nota de compra.' };
  if(/\bAGUA\b/.test(t))
    return { ...st, ncm:'22011000', cest:'', status:'conferir', nota:'Água mineral. CEST e CFOP a conferir na nota de compra.' };
  if(/SMIRNOFF|\bICE\b|DRINKS? PRONTOS?|\bBEATS\b|\bSKOL BEATS\b/.test(t))
    return { ...st, ncm:'22089000', cest:'', status:'conferir', nota:'Bebida alcoólica mista: 2208.90.00 ou 2206.00.90 conforme a embalagem. Conferir na nota de compra.' };
  if(FISCAL_FOOD_CATS.test(t))
    return { ncm:'21069090', cest:'', cfop:'5101', csosn:'102', origem:'0', status:'ok', nota:'Feito no clube: igual ao Saipos (NCM 2106.90.90, CFOP 5101, CSOSN 102).' };
  // Só pela estação de preparo não dá para ter certeza de que é comida feita no clube.
  if(p.estacao && p.estacao!=='bar' && p.estacao!=='nenhuma')
    return { ncm:'21069090', cest:'', cfop:'5101', csosn:'102', origem:'0', status:'conferir', nota:'Sugerido pela estação de preparo: se for comida feita no clube, é igual ao Saipos (2106.90.90, 5101, 102). Confira se não é bebida ou produto comprado pronto.' };
  return null;
}
function fiscalPaneHtml(p){
  const f = (p && p.fiscal) || {};
  const opt = (list, v)=>list.map(([k,l])=>`<option value="${k}" ${String(v||'')===k?'selected':''}>${h(l)}</option>`).join('');
  return `<p class="sub" style="margin-top:0">Códigos que vão na NFC-e deste produto. Comida feita no clube e bebida comprada pronta têm códigos diferentes; na dúvida, use "Sugerir" e marque para o contador conferir.</p>
    <div class="row"><div class="field"><label for="pNcm">NCM (8 números)</label><input id="pNcm" inputmode="numeric" maxlength="10" value="${h(fiscalFmtNcm(f.ncm))}" placeholder="2106.90.90"></div>
      <div class="field"><label for="pCest">CEST (7 números, só com substituição tributária)</label><input id="pCest" inputmode="numeric" maxlength="9" value="${h(fiscalFmtCest(f.cest))}" placeholder="03.021.03"></div></div>
    <div class="row"><div class="field"><label for="pCfop">CFOP (4 números)</label><input id="pCfop" inputmode="numeric" maxlength="4" value="${h(fiscalDigits(f.cfop))}" placeholder="5101"></div>
      <div class="field"><label for="pCsosn">CSOSN (Simples Nacional)</label><select id="pCsosn"><option value="">—</option>${opt(FISCAL_CSOSN, f.csosn)}</select></div>
      <div class="field"><label for="pOrigem">Origem</label><select id="pOrigem">${opt(FISCAL_ORIGEM, f.origem||'0')}</select></div></div>
    <label style="font-size:13px"><input type="checkbox" id="pFiscalOk" ${f.status==='ok'?'checked':''}> Códigos conferidos (pelo contador ou iguais ao Saipos)</label>
    <p class="sub" id="pFiscalNota" style="margin-top:8px">${h(f.nota||'')}</p>
    <button type="button" class="op-btn" onclick="fillProductFiscalSuggestion()">Sugerir pelos dados do produto</button>`;
}
function fillProductFiscalSuggestion(){
  const draft = { name:(document.getElementById('pName')||{}).value||'', category:(document.getElementById('pCat')||{}).value||'', estacao:(document.getElementById('pEstacao')||{}).value||'' };
  const s = suggestProductFiscal(draft);
  if(!s){ toast('Não sei sugerir os códigos deste produto. Preencha com o contador.'); return; }
  document.getElementById('pNcm').value = fiscalFmtNcm(s.ncm);
  document.getElementById('pCest').value = fiscalFmtCest(s.cest);
  document.getElementById('pCfop').value = s.cfop;
  document.getElementById('pCsosn').value = s.csosn;
  document.getElementById('pOrigem').value = s.origem;
  document.getElementById('pFiscalOk').checked = s.status==='ok';
  document.getElementById('pFiscalNota').textContent = s.nota;
  toast('Sugestão preenchida. Confira antes de salvar.');
}
// Lê a aba Fiscal. Devolve {fiscal} ou {error}. Tudo em branco = sem dados fiscais.
function readProductFiscal(prev){
  const ncm = fiscalDigits(document.getElementById('pNcm').value), cest = fiscalDigits(document.getElementById('pCest').value),
    cfop = fiscalDigits(document.getElementById('pCfop').value), csosn = document.getElementById('pCsosn').value, origem = document.getElementById('pOrigem').value || '0';
  if(!ncm && !cest && !cfop && !csosn) return { fiscal:null };
  if(ncm.length!==8) return { error:'O NCM tem 8 números (ex.: 2106.90.90).' };
  if(cest && cest.length!==7) return { error:'O CEST tem 7 números (ex.: 03.021.03). Deixe em branco se não houver.' };
  if(!/^[5-6]\d{3}$/.test(cfop)) return { error:'O CFOP de venda tem 4 números e começa com 5 (ex.: 5101 ou 5405).' };
  if(!csosn) return { error:'Escolha o CSOSN.' };
  const nota = (document.getElementById('pFiscalNota')||{}).textContent || (prev&&prev.nota) || '';
  return { fiscal:{ ncm, cest, cfop, csosn, origem, status: document.getElementById('pFiscalOk').checked ? 'ok' : 'conferir', nota } };
}
function openFiscalBulkModal(){
  productOptionsOpen = false;
  const all = state.products.filter(p=>productKind(p)!=='combo');
  const empty = all.filter(p=>productFiscalStatus(p)==='vazio');
  const sugg = empty.map(p=>({ p, s:suggestProductFiscal(p) }));
  const can = sugg.filter(x=>x.s), cannot = sugg.filter(x=>!x.s);
  const count = k=>all.filter(p=>productFiscalStatus(p)===k).length;
  const rows = can.map(({p,s})=>`<tr><td>${h(p.category||'—')}</td><td>${h(p.name)}</td><td class="mono">${h(fiscalFmtNcm(s.ncm))}</td><td class="mono">${h(fiscalFmtCest(s.cest)||'—')}</td><td class="mono">${h(s.cfop)}</td><td class="mono">${h(s.csosn)}</td><td>${s.status==='ok'?'<span class="tag tag-green">igual ao Saipos</span>':'<span class="tag tag-gray">conferir</span>'}</td></tr>`).join('');
  openModal('Dados fiscais dos produtos (NFC-e)', `
    <p class="sub" style="margin-top:0">${count('ok')} conferidos · ${count('conferir')} a conferir · ${empty.length} sem dados fiscais.${empty.length?' Abaixo, a sugestão para os que estão sem dados. Nada é gravado até você clicar em "Preencher".':''}</p>
    ${can.length?`<div class="finance-grid" style="max-height:340px;overflow:auto"><table><thead><tr><th>Categoria</th><th>Produto</th><th>NCM</th><th>CEST</th><th>CFOP</th><th>CSOSN</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}
    ${cannot.length?`<p class="sub">Sem sugestão (preencher no cadastro do produto, aba Fiscal): ${cannot.map(x=>h(x.p.name)).join(', ')}.</p>`:''}
    <p class="sub">Comida segue o cadastro do Saipos. Bebidas ficam "a conferir": o contador confirma o CEST e o CFOP, e a Coca-Cola vai com o NCM de refrigerante (no Saipos está com o de cerveja).</p>
    <div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button>${can.length?`<button class="primary" id="fiscalBulkBtn">Preencher ${can.length} produto(s)</button>`:''}</div>`, true);
  document.querySelector('#modalRoot .modal').classList.add('app-config-modal');
  const btn = document.getElementById('fiscalBulkBtn');
  if(btn) btn.onclick = ()=>{
    can.forEach(({p,s})=>{ if(productFiscalStatus(p)==='vazio') p.fiscal = s; });
    save('products'); closeModal(); renderAll();
    toast(can.length+' produto(s) com dados fiscais preenchidos.'); logAction('Dados fiscais sugeridos preenchidos em '+can.length+' produto(s)');
  };
}
function openProductModal(id){
  const p = id ? state.products.find(x=>x.id===id) : null;
  window.productImageDraft=p&&p.image||'';
  tempRecipe = p ? JSON.parse(JSON.stringify(p.recipe||[])) : [];
  openModal(p?'Editar produto':'Novo produto', `
    <div class="record-body">
      <div class="record-tabs">
        <button data-tab="principal" class="active" onclick="setProductModalTab('principal')">Principal</button>
        <button data-tab="estoque" onclick="setProductModalTab('estoque')">Estoque</button>
        <button data-tab="ficha" onclick="setProductModalTab('ficha')">Ficha Técnica</button>
        <button data-tab="perguntas" onclick="setProductModalTab('perguntas')">Perguntas (${state.perguntas.length})</button>
        <button data-tab="complementos" onclick="setProductModalTab('complementos')">Complementos (${state.complementos.length})</button>
        <button data-tab="observacoes" onclick="setProductModalTab('observacoes')">Observações (${state.observacoes.length})</button>
        <button data-tab="tamanhos" onclick="setProductModalTab('tamanhos')">Tamanhos</button>
        <button data-tab="combo" onclick="setProductModalTab('combo')">Composição do combo</button>
        <button data-tab="fiscal" onclick="setProductModalTab('fiscal')">Fiscal (NFC-e)</button>
      </div>
      <section class="record-pane active" data-pane="principal">
        <div class="row"><div class="field"><label>Código do sistema</label><input id="pCode" value="${h(p?p.code||'':'')}" placeholder="Gerado ou informado"></div><label style="flex:0 0 auto;align-self:center"><input type="checkbox" id="pActive" ${!p||p.active!==false?'checked':''}> Ativo</label></div>
        <div class="record-grid"><div><div class="product-image-box" id="productImagePreview">${p&&p.image?`<img src="${p.image}" alt="Produto" style="width:100%;height:100%;object-fit:contain">`:'🍽'}</div><button class="op-btn" type="button" style="width:100%;margin-top:8px" onclick="selectProductImage()">Selecionar imagem…</button><button class="op-btn" type="button" style="width:100%;margin-top:5px" onclick="clearProductImage()">Limpar imagem</button><input id="productImageFile" type="file" accept="image/*" hidden><p class="sub">Tamanho sugerido: 600 × 600 pixels. Limite: 500 KB.</p></div>
        <div><div class="field"><label>Nome</label><input id="pName" value="${h(p?p.name:'')}" autofocus></div>
        <div class="row"><div class="field"><label>Categoria</label><select id="pCat"><option value="">— Sem categoria —</option>${state.categorias.map(c=>`<option value="${h(c.nome)}" ${p&&p.category===c.nome?'selected':''}>${h(c.nome)}</option>`).join('')}</select></div><div class="field"><label>Vender este item como</label><select id="pMeasure">${[['un','Unidade (UN)'],['kg','Quilo (KG)'],['l','Litro (L)'],['g','Grama (G)'],['ml','Mililitro (ML)']].map(([v,l])=>`<option value="${v}" ${p&&(p.measure||'un')===v?'selected':''}>${l}</option>`).join('')}</select></div></div>
        <div class="row"><div class="field"><label>Preço de custo</label><input id="pManualCost" type="number" step="0.01" value="${p?Number(p.manualCost)||'':''}" placeholder="Calculado pela ficha técnica"></div><div class="field"><label>Preço de venda</label><input id="pPrice" type="number" step="0.01" value="${p?p.price:''}"></div></div>
        <label style="font-size:13px"><input type="checkbox" id="pNoService" ${p&&p.noServiceFee?'checked':''}> Sem taxa de serviço</label>
        <div class="field" style="margin-top:12px"><label>Descrição</label><textarea id="pDescription" rows="2">${h(p?p.description||'':'')}</textarea></div>
        <div class="field"><label>Código personalizado / PDV</label><input id="pCustomCode" value="${h(p?p.pdvCode||'':'')}"></div>
        <div class="field"><label>Estação de preparo</label><select id="pEstacao">
          ${state.estacoes.map(e=>`<option value="${h(e.chave)}" ${(p&&p.estacao===e.chave)||(!p&&e.chave==='cozinha')?'selected':''}>${h(e.nome)}</option>`).join('')}
          <option value="nenhuma" ${p&&p.estacao==='nenhuma'?'selected':''}>Não exige preparo (ex: água, refrigerante lacrado)</option>
        </select><p class="sub">Define pra qual impressora o pedido vai (Cozinha usa impressora única; Bar e Churrasqueira têm impressora diferente por origem do pedido).</p></div>
        <div class="field"><label>Perguntar quantidade de copos</label><select id="pAskCopos"><option value="auto" ${!p||!p.askCopos||p.askCopos==='auto'?'selected':''}>Automático (toda bebida)</option><option value="sim" ${p&&p.askCopos==='sim'?'selected':''}>Sim, sempre</option><option value="nao" ${p&&p.askCopos==='nao'?'selected':''}>Não</option></select><p class="sub">Automático reconhece bebida pela estação Bar, pela categoria ou pelo nome (cerveja, refrigerante, água, suco, drinks…).</p></div>
        <p style="font-size:12px;font-weight:700;margin:16px 0 6px">Disponibilizar este item para venda direta em</p><div class="channel-checks"><label><input type="checkbox" id="pChPdv" ${!p||!p.channels||p.channels.pdv!==false?'checked':''}> PDV Desktop</label><label><input type="checkbox" id="pChMobile" ${!p||!p.channels||p.channels.mobile!==false?'checked':''}> Comanda Mobile</label><label><input type="checkbox" id="pChQr" ${!p||!p.channels||p.channels.qr!==false?'checked':''}> Cardápio Digital (cliente)</label><label><input type="checkbox" id="pChOnline" ${!p||!p.channels||p.channels.online!==false?'checked':''}> Totem de Autoatendimento</label></div><p class="sub">"Cardápio Digital" e "Totem" são checkboxes independentes — desmarcar um não afeta o outro. Se o produto deve sumir dos dois, desmarque ambos.</p></div></div>
      </section>
      <section class="record-pane" data-pane="estoque"><div class="grid3"><div class="field"><label>Estoque mínimo (alerta)</label><input id="pMinStock" type="number" min="0" step="1" value="${p?Number(p.minStock)||0:0}"></div><div class="field"><label>Ordem de exibição</label><input id="pSortOrder" type="number" step="1" value="${p?Number(p.sortOrder)||0:state.products.length}"></div><div class="field"><label>Tipo do cadastro</label><select id="pKind"><option value="produto" ${productKind(p||{})==='produto'?'selected':''}>Produto</option><option value="tamanho" ${productKind(p||{})==='tamanho'?'selected':''}>Produto por tamanho</option><option value="combo" ${productKind(p||{})==='combo'?'selected':''}>Combo</option></select></div></div><p class="sub">O estoque disponível é calculado pela ficha técnica e baixado somente quando o item é enviado à cozinha.</p></section>
      <section class="record-pane" data-pane="ficha"><p class="sub">Insumos consumidos por unidade vendida. O custo estimado é recalculado automaticamente.</p><div id="recipeRowsList"></div><button class="btn btn-sm" onclick="addRecipeRow()">+ Adicionar insumo</button></section>
      <section class="record-pane" data-pane="perguntas"><p class="sub">Perguntas disponíveis para orientar o atendimento deste item.</p>${state.perguntas.length?state.perguntas.map(q=>`<label class="item-line"><span>${h(q.texto)}</span><input type="checkbox" class="pQuestion" value="${q.id}" ${(p&&p.questionIds||[]).includes(q.id)?'checked':''}></label>`).join(''):'<p class="empty">Nenhuma pergunta cadastrada.</p>'}</section>
      <section class="record-pane" data-pane="complementos"><p class="sub">Complementos e tamanhos aceitos para este produto.</p>${state.complementos.length?state.complementos.map(c=>`<label class="item-line"><span>${h(c.nome)} · ${fmt(c.preco)}</span><input type="checkbox" class="pComplement" value="${c.id}" ${(p&&p.complementIds||[]).includes(c.id)?'checked':''}></label>`).join(''):'<p class="empty">Nenhum complemento cadastrado.</p>'}</section>
      <section class="record-pane" data-pane="observacoes"><p class="sub">Observações rápidas disponibilizadas durante o lançamento deste produto.</p>${state.observacoes.length?state.observacoes.map(o=>`<label class="item-line"><span>${h(o.texto)}</span><input type="checkbox" class="pObservation" value="${o.id}" ${(p&&p.observationIds||[]).includes(o.id)?'checked':''}></label>`).join(''):'<p class="empty">Nenhuma observação padrão cadastrada.</p>'}</section>
      <section class="record-pane" data-pane="tamanhos"><p class="sub">Escolha os tamanhos oferecidos por este produto. O cliente deverá selecionar um deles no lançamento.</p>${state.complementos.filter(x=>x.recordKind==='type').map(type=>{const sizes=state.complementos.filter(x=>x.recordKind==='size'&&x.parentId===type.id&&x.active!==false);return `<fieldset><legend>${h(type.nome)}</legend>${sizes.map(size=>`<label class="item-line"><span>${h(size.nome)} ${Number(size.preco)?`· + ${fmt(size.preco)}`:''}</span><input type="checkbox" class="pSize" value="${size.id}" ${(p&&p.sizeIds||[]).includes(size.id)?'checked':''}></label>`).join('')||'<p class="empty">Nenhum tamanho ativo neste tipo.</p>'}</fieldset>`;}).join('')||'<p class="empty">Cadastre tipos e tamanhos para vinculá-los ao produto.</p>'}</section>
      <section class="record-pane" data-pane="combo"><p class="sub">Selecione os produtos que compõem este combo. As fichas técnicas dos itens escolhidos serão consideradas no estoque.</p>${state.products.filter(x=>x.id!==(p&&p.id)&&productKind(x)!=='combo').map(x=>`<label class="item-line"><span>${h(x.name)} <small>${h(x.category||'Sem categoria')}</small></span><input type="checkbox" class="pComboItem" value="${x.id}" ${(p&&p.comboProductIds||[]).includes(x.id)?'checked':''}></label>`).join('')||'<p class="empty">Cadastre produtos individuais antes de montar um combo.</p>'}</section>
      <section class="record-pane" data-pane="fiscal">${fiscalPaneHtml(p)}</section>
      <div class="record-actions"><button class="op-btn" onclick="closeModal()">Voltar</button><button class="op-btn primary" id="pSaveBtn">Salvar</button></div>
    </div>
  `, true);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');
  renderRecipeRows();
  document.getElementById('pSaveBtn').onclick = ()=>{
    const name = document.getElementById('pName').value.trim();
    const price = parseFloat(document.getElementById('pPrice').value);
    const minStock = parseFloat(document.getElementById('pMinStock').value);
    const sortOrder = parseInt(document.getElementById('pSortOrder').value,10);
    if(!name || !Number.isFinite(price) || price<0){ toast('Preencha o nome e um preço igual ou maior que zero.'); return; }
    if(!Number.isFinite(minStock) || minStock<0 || !Number.isFinite(sortOrder)){ toast('Estoque mínimo e ordem devem ser números válidos.'); return; }
    if(tempRecipe.some(r=>!r.insumoId || !Number.isFinite(Number(r.qty)) || Number(r.qty)<=0)){ toast('Toda quantidade da ficha técnica deve ser maior que zero.'); return; }
    const code=document.getElementById('pCode').value.trim();
    // Só confere repetição quando o código é novo ou foi trocado: código repetido que já veio
    // assim (ex.: importação) não pode impedir de editar o resto do cadastro.
    const codeChanged = !p || String(p.code||'').toLowerCase()!==code.toLowerCase();
    const sameCode = code && codeChanged && state.products.find(x=>x.id!==(p&&p.id) && String(x.code||'').toLowerCase()===code.toLowerCase());
    if(sameCode){ toast('O código '+code+' já é do produto "'+sameCode.name+'". Use outro código ou deixe em branco.'); return; }
    const data = { code, image:window.productImageDraft||'', kind:document.getElementById('pKind').value, name, category:document.getElementById('pCat').value, price,
      measure:document.getElementById('pMeasure').value, minStock, sortOrder, active:document.getElementById('pActive').checked, recipe:tempRecipe.filter(r=>r.insumoId),
      manualCost:parseFloat(document.getElementById('pManualCost').value)||0, description:document.getElementById('pDescription').value.trim(),
      pdvCode:document.getElementById('pCustomCode').value.trim(), noServiceFee:document.getElementById('pNoService').checked,
      estacao:document.getElementById('pEstacao').value, askCopos:document.getElementById('pAskCopos').value, kitchenItem:document.getElementById('pEstacao').value==='cozinha', channels:{pdv:document.getElementById('pChPdv').checked,mobile:document.getElementById('pChMobile').checked,qr:document.getElementById('pChQr').checked,online:document.getElementById('pChOnline').checked},
      questionIds:[...document.querySelectorAll('.pQuestion:checked')].map(x=>x.value), complementIds:[...document.querySelectorAll('.pComplement:checked')].map(x=>x.value),
      observationIds:[...document.querySelectorAll('.pObservation:checked')].map(x=>x.value) };
    data.sizeIds=[...document.querySelectorAll('.pSize:checked')].map(x=>x.value);
    data.comboProductIds=[...document.querySelectorAll('.pComboItem:checked')].map(x=>x.value);
    if(data.kind==='combo'&&!data.comboProductIds.length){toast('Selecione ao menos um produto para compor o combo.');setProductModalTab('combo');return;}
    const fiscalRead = readProductFiscal(p&&p.fiscal);
    if(fiscalRead.error){ toast(fiscalRead.error); setProductModalTab('fiscal'); return; }
    data.fiscal = fiscalRead.fiscal;
    if(p){ Object.assign(p,data); } else { state.products.push({id:uid(), ...data}); }
    save('products'); closeModal(); renderAll(); toast('Produto salvo.');
  };
}
function selectProductImage(){const input=document.getElementById('productImageFile');if(!input)return;input.onchange=()=>{const file=input.files&&input.files[0];if(!file)return;if(file.size>500000){toast('Escolha uma imagem de até 500 KB.');return;}const reader=new FileReader();reader.onload=()=>{window.productImageDraft=reader.result;const preview=document.getElementById('productImagePreview');if(preview)preview.innerHTML=`<img src="${reader.result}" alt="Produto" style="width:100%;height:100%;object-fit:contain">`;};reader.readAsDataURL(file);};input.click();}
function clearProductImage(){window.productImageDraft='';const preview=document.getElementById('productImagePreview');if(preview)preview.textContent='🍽';}
function editProduct(id){ openProductModal(id); }
function deleteProduct(id){
  const product=state.products.find(p=>p.id===id);if(!product)return;
  const activeUse=state.sales.some(s=>s.status==='open'&&(s.items||[]).some(i=>i.productId===id));
  if(activeUse){toast('Este produto está em um pedido aberto. Finalize ou remova o item antes de excluir.');return;}
  if(!confirm('Excluir este produto? O histórico de vendas será preservado.')) return;
  state.products=state.products.filter(p=>p.id!==id);state.products.forEach(p=>p.comboProductIds=(p.comboProductIds||[]).filter(productId=>productId!==id));
  save('products');renderAll();toast('Produto excluído.');logAction('Produto excluído: '+product.name);
}

