/* ============ GRADES DE TAMANHO E GRUPOS DE OPÇÕES ============ */
// Cadastros novos (recordKind 'grade' e 'optionGroup' em state.complementos). Os registros
// antigos (type/size/complement) ficam no array, ignorados por estas telas.
// Regras puras (preço, validação) ficam em core/opcoes.js.
let complementosTela = 'grupos';   // qual tela usa a view 'complementos': 'grades' | 'grupos'
let gradeDraft = null;             // grade em edição no modal
let gradeOriginalSizeIds = [];     // ids de tamanhos que já existiam ao abrir o modal
let gradeOnSaved = null;
let groupDraft = null;
let groupRecipeIdx = -1;           // opção cuja ficha técnica está aberta
let groupOnSaved = null;

function openGradesView(){ complementosTela='grades'; activeRibbonAction='Grades de tamanho'; switchView('complementos'); }
function openOptionGroupsView(){ complementosTela='grupos'; activeRibbonAction='Grupos de opções'; switchView('complementos'); }

function productsUsingGrade(gradeId){
  return (state.products||[]).filter(p=>p.gradeId===gradeId);
}
function productsUsingGroup(groupId){
  return (state.products||[]).filter(p=>{
    if((p.groups||[]).some(g=>g&&g.groupId===groupId)) return true;
    return Object.values(p.sizes||{}).some(s=>s&&(s.groups||[]).some(g=>g&&g.groupId===groupId));
  });
}
function productsUsingGradeSize(gradeId,sizeId){
  return productsUsingGrade(gradeId).filter(p=>p.sizes&&p.sizes[sizeId]);
}
function opcoesListaOrdenada(kind){
  return (state.complementos||[]).filter(x=>x&&x.recordKind===kind)
    .sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
}
function opcoesPlural(n,um,varios){ return n+' '+(n===1?um:varios); }

/* ---------- Grades ---------- */
function renderGrades(el){
  const list=opcoesListaOrdenada('grade');
  const rows=list.map(g=>{
    const sizes=g.sizes||[], uso=productsUsingGrade(g.id).length;
    return `<tr data-search="${h((g.nome||'').toLowerCase())}" class="${crudSelected.grades===g.id?'selected':''}" onclick="crudSelected.grades=${jsArg(g.id)};renderGrades(document.getElementById('view-complementos'))" ondblclick="openGradeModal(${jsArg(g.id)})"><td>${h(g.nome||'—')}</td><td>${sizes.map(s=>`<span class="tag tag-gray">${h(s.nome)}${s.sigla?' ('+h(s.sigla)+')':''}</span>`).join(' ')||'—'}</td><td class="mono">${uso}</td><td><span class="tag ${g.active===false?'tag-gray':'tag-green'}">${g.active===false?'Pausada':'Ativa'}</span></td></tr>`;
  }).join('')||'<tr><td colspan="4" class="empty">Não há grades cadastradas</td></tr>';
  const sel=!!crudSelected.grades;
  el.innerHTML=`<div class="workspace-gray"><section class="op-window category-window"><header class="op-titlebar"><span>Grades de tamanho</span><span class="op-controls"><span onclick="closeOperationalWindow()" style="cursor:pointer" title="Fechar">×</span></span></header><div style="padding:14px 18px 0;color:var(--c-text-3);font-size:13px">Uma grade é uma lista de tamanhos (ex.: Individual / Família). Cada produto escolhe a sua grade e define preço, ficha técnica e grupos por tamanho.</div><div class="op-toolbar"><div class="op-search"><span>⌕</span><input id="gradeSearch" placeholder="Pesquisar aqui..."></div><div class="op-toolbar-spacer"></div><button class="op-btn" onclick="deleteSelectedGrade()" ${sel?'':'disabled'}>🗑 &nbsp; Excluir</button><button class="op-btn" onclick="crudSelected.grades?openGradeModal(crudSelected.grades):toast('Selecione uma grade.')" ${sel?'':'disabled'}>✎ &nbsp; Editar</button><button class="op-btn primary" onclick="openGradeModal()">＋ &nbsp; Nova grade</button></div><div class="op-tabs"><button class="active">Grades (${list.length})</button></div><div class="op-grid"><table><thead><tr><th>Grade</th><th>Tamanhos</th><th>Produtos usando</th><th>Situação</th></tr></thead><tbody id="gradeRows">${rows}</tbody></table></div><footer class="op-footer"><span>Registros: ${list.length}</span></footer></section></div>`;
  document.getElementById('gradeSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#gradeRows tr[data-search]').forEach(r=>r.style.display=r.dataset.search.includes(q)?'':'none');};
}
function deleteSelectedGrade(){
  const g=state.complementos.find(x=>x.id===crudSelected.grades&&x.recordKind==='grade');
  if(!g){toast('Selecione uma grade.');return;}
  const uso=productsUsingGrade(g.id).length;
  if(uso){toast('Não dá para excluir: '+opcoesPlural(uso,'produto usa','produtos usam')+' esta grade. Pause a grade ou troque a grade dos produtos.');return;}
  askConfirm({title:'Excluir a grade "'+g.nome+'"?',message:'Esta ação não pode ser desfeita.',confirmLabel:'Excluir',cancelLabel:'Manter'}).then(ok=>{
    if(!ok)return;
    state.complementos=state.complementos.filter(x=>x.id!==g.id);
    crudSelected.grades=null;
    save('complementos');renderAll();toast('Grade excluída.');
  });
}
function openGradeModal(id,onSaved){
  const item=id?state.complementos.find(x=>x.id===id&&x.recordKind==='grade'):null;
  gradeDraft={id:item?item.id:uid(),nome:item?item.nome||'':'',active:!item||item.active!==false,
    sizes:(item&&item.sizes||[]).map(s=>({id:s.id,nome:s.nome||'',sigla:s.sigla||''}))};
  if(!gradeDraft.sizes.length) gradeDraft.sizes.push({id:uid(),nome:'',sigla:''});
  gradeOriginalSizeIds=(item&&item.sizes||[]).map(s=>s.id);
  gradeOnSaved=typeof onSaved==='function'?onSaved:null;
  openModal(item?'Editar grade':'Nova grade','<div id="gradeModalBody"></div>');
  const modal=document.querySelector('#modalRoot .modal');modal.style.maxWidth='620px';
  renderGradeModal();
}
function renderGradeModal(){
  const d=gradeDraft,body=document.getElementById('gradeModalBody');if(!body||!d)return;
  const rows=d.sizes.map((s,i)=>`<tr><td><input maxlength="40" placeholder="Ex.: Família" value="${h(s.nome)}" oninput="gradeDraft.sizes[${i}].nome=this.value"></td><td><input maxlength="6" style="width:70px" placeholder="F" value="${h(s.sigla)}" oninput="gradeDraft.sizes[${i}].sigla=this.value"></td><td style="white-space:nowrap"><button type="button" class="op-mini" ${i===0?'disabled':''} onclick="moveGradeSize(${i},-1)" title="Subir">↑</button> <button type="button" class="op-mini" ${i===d.sizes.length-1?'disabled':''} onclick="moveGradeSize(${i},1)" title="Descer">↓</button> <button type="button" class="op-mini" onclick="removeGradeSize(${i})" title="Remover">🗑</button></td></tr>`).join('');
  body.innerHTML=`<div class="field"><label>Nome da grade</label><input id="gradeName" maxlength="100" value="${h(d.nome)}" oninput="gradeDraft.nome=this.value" autofocus></div><label class="comp-switch" style="margin:8px 0"><input type="checkbox" ${d.active?'checked':''} onchange="gradeDraft.active=this.checked"><span></span> Ativa</label><div class="op-grid" style="max-height:300px;overflow:auto"><table><thead><tr><th>Tamanho</th><th>Sigla</th><th>Ordem</th></tr></thead><tbody>${rows}</tbody></table></div><div style="margin-top:8px"><button type="button" class="op-btn" onclick="addGradeSize()">＋ &nbsp; Adicionar tamanho</button></div><div class="crud-modal-actions" style="margin-top:14px"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveGradeDraft()">Salvar</button></div>`;
}
function addGradeSize(){gradeDraft.sizes.push({id:uid(),nome:'',sigla:''});renderGradeModal();}
function moveGradeSize(i,dir){const a=gradeDraft.sizes,j=i+dir;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];renderGradeModal();}
async function removeGradeSize(i){
  const s=gradeDraft.sizes[i];if(!s)return;
  const uso=gradeOriginalSizeIds.includes(s.id)?productsUsingGradeSize(gradeDraft.id,s.id).length:0;
  if(uso){
    const ok=await askConfirm({title:'Remover o tamanho "'+(s.nome||'sem nome')+'"?',message:opcoesPlural(uso,'produto perde','produtos perdem')+' este tamanho (preço, ficha técnica e grupos dele). Só vale depois de salvar a grade.',confirmLabel:'Remover tamanho',cancelLabel:'Manter'});
    if(!ok)return;
  }
  const at=gradeDraft.sizes.findIndex(x=>x.id===s.id);
  if(at>=0)gradeDraft.sizes.splice(at,1);
  renderGradeModal();
}
function saveGradeDraft(){
  const d=gradeDraft;if(!d)return;
  const nome=(d.nome||'').trim();
  if(!nome){toast('Informe o nome da grade.');return;}
  const sizes=d.sizes.map(s=>({id:s.id,nome:(s.nome||'').trim(),sigla:(s.sigla||'').trim()}));
  if(!sizes.length||sizes.some(s=>!s.nome)){toast('Todo tamanho precisa de nome (ou remova a linha vazia).');return;}
  const dup=new Set();for(const s of sizes){const k=s.nome.toLowerCase();if(dup.has(k)){toast('Tamanho repetido: '+s.nome+'.');return;}dup.add(k);}
  const dupName=state.complementos.some(x=>x.recordKind==='grade'&&x.id!==d.id&&String(x.nome||'').trim().toLowerCase()===nome.toLowerCase());
  if(dupName){toast('Já existe uma grade com este nome.');return;}
  const rec={id:d.id,recordKind:'grade',nome,active:d.active!==false,sizes};
  const at=state.complementos.findIndex(x=>x.id===d.id);
  if(at>=0)state.complementos[at]={...state.complementos[at],...rec};else state.complementos.push(rec);
  crudSelected.grades=d.id;
  save('complementos');
  const cb=gradeOnSaved;gradeDraft=null;gradeOnSaved=null;
  closeModal();renderAll();toast('Grade salva.');
  if(cb)cb(rec);
}

/* ---------- Grupos de opções ---------- */
function renderOptionGroups(el){
  const list=opcoesListaOrdenada('optionGroup');
  const rows=list.map(g=>{
    const ops=g.options||[], uso=productsUsingGroup(g.id).length;
    return `<tr data-search="${h((g.nome||'').toLowerCase())}" class="${crudSelected.optionGroups===g.id?'selected':''}" onclick="crudSelected.optionGroups=${jsArg(g.id)};renderOptionGroups(document.getElementById('view-complementos'))" ondblclick="openOptionGroupModal(${jsArg(g.id)})"><td>${h(g.nome||'—')}</td><td>${ops.map(o=>h(o.nome)).join(', ')||'—'}</td><td class="mono">${ops.length}</td><td class="mono">${uso}</td><td><span class="tag ${g.active===false?'tag-gray':'tag-green'}">${g.active===false?'Pausado':'Ativo'}</span></td></tr>`;
  }).join('')||'<tr><td colspan="5" class="empty">Não há grupos de opções cadastrados</td></tr>';
  const sel=!!crudSelected.optionGroups;
  el.innerHTML=`<div class="workspace-gray"><section class="op-window category-window"><header class="op-titlebar"><span>Grupos de opções</span><span class="op-controls"><span onclick="closeOperationalWindow()" style="cursor:pointer" title="Fechar">×</span></span></header><div style="padding:14px 18px 0;color:var(--c-text-3);font-size:13px">Um grupo é uma lista de opções que o cliente escolhe no produto (ex.: Acompanhamentos açaí). Cada produto define quantas pode escolher e quantas já vêm inclusas.</div><div class="op-toolbar"><div class="op-search"><span>⌕</span><input id="groupSearch" placeholder="Pesquisar aqui..."></div><div class="op-toolbar-spacer"></div><button class="op-btn" onclick="deleteSelectedOptionGroup()" ${sel?'':'disabled'}>🗑 &nbsp; Excluir</button><button class="op-btn" onclick="crudSelected.optionGroups?openOptionGroupModal(crudSelected.optionGroups):toast('Selecione um grupo.')" ${sel?'':'disabled'}>✎ &nbsp; Editar</button><button class="op-btn primary" onclick="openOptionGroupModal()">＋ &nbsp; Novo grupo</button></div><div class="op-tabs"><button class="active">Grupos (${list.length})</button></div><div class="op-grid"><table><thead><tr><th>Grupo</th><th>Opções</th><th>Qtde.</th><th>Produtos usando</th><th>Situação</th></tr></thead><tbody id="groupRows">${rows}</tbody></table></div><footer class="op-footer"><span>Registros: ${list.length}</span></footer></section></div>`;
  document.getElementById('groupSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#groupRows tr[data-search]').forEach(r=>r.style.display=r.dataset.search.includes(q)?'':'none');};
}
function deleteSelectedOptionGroup(){
  const g=state.complementos.find(x=>x.id===crudSelected.optionGroups&&x.recordKind==='optionGroup');
  if(!g){toast('Selecione um grupo.');return;}
  const uso=productsUsingGroup(g.id).length;
  if(uso){toast('Não dá para excluir: '+opcoesPlural(uso,'produto usa','produtos usam')+' este grupo. Pause o grupo ou tire-o dos produtos.');return;}
  askConfirm({title:'Excluir o grupo "'+g.nome+'"?',message:'Esta ação não pode ser desfeita.',confirmLabel:'Excluir',cancelLabel:'Manter'}).then(ok=>{
    if(!ok)return;
    state.complementos=state.complementos.filter(x=>x.id!==g.id);
    crudSelected.optionGroups=null;
    save('complementos');renderAll();toast('Grupo excluído.');
  });
}
function openOptionGroupModal(id,onSaved){
  const item=id?state.complementos.find(x=>x.id===id&&x.recordKind==='optionGroup'):null;
  groupDraft={id:item?item.id:uid(),nome:item?item.nome||'':'',active:!item||item.active!==false,
    options:(item&&item.options||[]).map(o=>({id:o.id,nome:o.nome||'',preco:Number(o.preco)||0,active:o.active!==false,
      recipe:(o.recipe||[]).map(r=>({insumoId:r.insumoId,qty:Number(r.qty)||0}))}))};
  if(!groupDraft.options.length)groupDraft.options.push({id:uid(),nome:'',preco:0,active:true,recipe:[]});
  groupRecipeIdx=-1;
  groupOnSaved=typeof onSaved==='function'?onSaved:null;
  openModal(item?'Editar grupo de opções':'Novo grupo de opções','<div id="groupModalBody"></div>');
  const modal=document.querySelector('#modalRoot .modal');modal.style.maxWidth='760px';
  renderOptionGroupModal();
}
function groupRecipeCost(row){const i=state.insumos.find(x=>x.id===row.insumoId);return i?(Number(i.costPerUnit)||0)*(Number(row.qty)||0):0;}
function renderOptionGroupModal(){
  const d=groupDraft,body=document.getElementById('groupModalBody');if(!body||!d)return;
  const rows=d.options.map((o,i)=>`<tr class="${groupRecipeIdx===i?'selected':''}"><td><input maxlength="60" placeholder="Ex.: Granola" value="${h(o.nome)}" oninput="groupDraft.options[${i}].nome=this.value"></td><td><input type="number" min="0" step="0.01" style="width:90px" value="${Number(o.preco)||0}" onchange="groupDraft.options[${i}].preco=Math.max(0,parseFloat(this.value)||0)"></td><td><input type="checkbox" ${o.active?'checked':''} onchange="groupDraft.options[${i}].active=this.checked" title="Ativa"></td><td style="white-space:nowrap"><button type="button" class="op-mini" onclick="toggleOptionRecipe(${i})" title="Ficha técnica">Ficha${o.recipe.length?' ('+o.recipe.length+')':''}</button> <button type="button" class="op-mini" ${i===0?'disabled':''} onclick="moveGroupOption(${i},-1)" title="Subir">↑</button> <button type="button" class="op-mini" ${i===d.options.length-1?'disabled':''} onclick="moveGroupOption(${i},1)" title="Descer">↓</button> <button type="button" class="op-mini" onclick="removeGroupOption(${i})" title="Remover">🗑</button></td></tr>`).join('');
  let recipe='';
  const cur=d.options[groupRecipeIdx];
  if(cur){
    const insumoOptions=state.insumos.map(i=>`<option value="${h(i.name)}" data-id="${h(i.id)}">${h(i.name)}</option>`).join('');
    const total=cur.recipe.reduce((s,r)=>s+groupRecipeCost(r),0);
    const recRows=cur.recipe.map(r=>{const i=state.insumos.find(x=>x.id===r.insumoId);if(!i)return'';return `<tr><td>${h(i.name)}</td><td><input type="number" min="0.001" step="0.001" style="width:80px" value="${Number(r.qty)||0}" onchange="changeGroupRecipeQty(${jsArg(r.insumoId)},this.value)"></td><td>${h(i.unit||'un')}</td><td>${fmt(groupRecipeCost(r))}</td><td><button type="button" class="op-mini" onclick="removeGroupRecipeInput(${jsArg(r.insumoId)})">🗑</button></td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">Sem insumos na ficha</td></tr>';
    recipe=`<div style="margin-top:14px;padding:10px;border:1px solid var(--c-border);border-radius:8px"><div class="comp-recipe-head"><b>Ficha técnica de ${h(cur.nome||'opção')} (1 porção)</b><div><input id="groupRecipeSearch" list="groupInputList" placeholder="Pesquisar insumo e adicionar..." onkeydown="if(event.key==='Enter'){event.preventDefault();addGroupRecipeInput()}"><datalist id="groupInputList">${insumoOptions}</datalist> <button type="button" class="op-mini" onclick="addGroupRecipeInput()">Adicionar</button></div></div><div class="op-grid"><table><thead><tr><th>Insumo</th><th>Qtde.</th><th>Medida</th><th>Custo</th><th></th></tr></thead><tbody>${recRows}</tbody></table></div><div style="text-align:right;margin-top:6px">Custo: <b>${fmt(total)}</b></div></div>`;
  }
  body.innerHTML=`<div class="field"><label>Nome do grupo</label><input id="groupName" maxlength="100" value="${h(d.nome)}" oninput="groupDraft.nome=this.value" autofocus></div><label class="comp-switch" style="margin:8px 0"><input type="checkbox" ${d.active?'checked':''} onchange="groupDraft.active=this.checked"><span></span> Ativo</label><div class="op-grid" style="max-height:300px;overflow:auto"><table><thead><tr><th>Opção</th><th>Preço extra (R$)</th><th>Ativa</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table></div><div style="margin-top:8px"><button type="button" class="op-btn" onclick="addGroupOption()">＋ &nbsp; Adicionar opção</button></div>${recipe}<div class="crud-modal-actions" style="margin-top:14px"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveOptionGroupDraft()">Salvar</button></div>`;
}
function addGroupOption(){groupDraft.options.push({id:uid(),nome:'',preco:0,active:true,recipe:[]});renderOptionGroupModal();}
function moveGroupOption(i,dir){const a=groupDraft.options,j=i+dir;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];if(groupRecipeIdx===i)groupRecipeIdx=j;else if(groupRecipeIdx===j)groupRecipeIdx=i;renderOptionGroupModal();}
function removeGroupOption(i){
  groupDraft.options.splice(i,1);
  if(groupRecipeIdx===i)groupRecipeIdx=-1;else if(groupRecipeIdx>i)groupRecipeIdx--;
  renderOptionGroupModal();
}
function toggleOptionRecipe(i){groupRecipeIdx=groupRecipeIdx===i?-1:i;renderOptionGroupModal();}
function addGroupRecipeInput(){
  const input=document.getElementById('groupRecipeSearch'),cur=groupDraft.options[groupRecipeIdx];if(!input||!cur)return;
  const term=input.value.trim().toLowerCase();
  const insumo=state.insumos.find(i=>String(i.name||'').toLowerCase()===term);
  if(!insumo){toast('Selecione um insumo cadastrado.');return;}
  if(cur.recipe.some(r=>r.insumoId===insumo.id)){toast('Este insumo já está na ficha.');return;}
  cur.recipe.push({insumoId:insumo.id,qty:1});renderOptionGroupModal();
}
function removeGroupRecipeInput(insumoId){const cur=groupDraft.options[groupRecipeIdx];if(!cur)return;cur.recipe=cur.recipe.filter(r=>r.insumoId!==insumoId);renderOptionGroupModal();}
function changeGroupRecipeQty(insumoId,value){const cur=groupDraft.options[groupRecipeIdx];const row=cur&&cur.recipe.find(r=>r.insumoId===insumoId);if(row)row.qty=Math.max(0,parseFloat(value)||0);renderOptionGroupModal();}
function saveOptionGroupDraft(){
  const d=groupDraft;if(!d)return;
  const nome=(d.nome||'').trim();
  if(!nome){toast('Informe o nome do grupo.');return;}
  const options=d.options.map(o=>({id:o.id,nome:(o.nome||'').trim(),preco:Math.max(0,parseFloat(o.preco)||0),active:o.active!==false,
    recipe:o.recipe.filter(r=>(parseFloat(r.qty)||0)>0).map(r=>({insumoId:r.insumoId,qty:parseFloat(r.qty)||0}))}));
  if(!options.length||options.some(o=>!o.nome)){toast('Toda opção precisa de nome (ou remova a linha vazia).');return;}
  const dup=new Set();for(const o of options){const k=o.nome.toLowerCase();if(dup.has(k)){toast('Opção repetida: '+o.nome+'.');return;}dup.add(k);}
  const dupName=state.complementos.some(x=>x.recordKind==='optionGroup'&&x.id!==d.id&&String(x.nome||'').trim().toLowerCase()===nome.toLowerCase());
  if(dupName){toast('Já existe um grupo com este nome.');return;}
  const rec={id:d.id,recordKind:'optionGroup',nome,active:d.active!==false,options};
  const at=state.complementos.findIndex(x=>x.id===d.id);
  if(at>=0)state.complementos[at]={...state.complementos[at],...rec};else state.complementos.push(rec);
  crudSelected.optionGroups=d.id;
  save('complementos');
  const cb=groupOnSaved;groupDraft=null;groupOnSaved=null;groupRecipeIdx=-1;
  closeModal();renderAll();toast('Grupo salvo.');
  if(cb)cb(rec);
}
