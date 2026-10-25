/* ============ ASSOCIADOS ============ */
let selectedMemberId=null, memberOptionsOpen=false, memberShowMore=false, memberSearchQuery='', memberSearchTypeValue='Busca Padrão';
function selectMemberRow(id){selectedMemberId=id;renderAssociados();}
function toggleMemberOptions(){memberOptionsOpen=!memberOptionsOpen;renderAssociados();}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{
  if(!memberOptionsOpen) return;
  const path = typeof event.composedPath==='function' ? event.composedPath() : [];
  if(path.some(node=>node.classList && node.classList.contains('pdv-menu-wrap'))) return;
  memberOptionsOpen=false; renderAssociados();
});
function editSelectedMember(){if(!selectedMemberId){toast('Selecione um cliente para editar.');return;}openMemberModal(selectedMemberId);}
function archiveSelectedMember(){if(!selectedMemberId){toast('Selecione um cliente para arquivar.');return;}deleteMember(selectedMemberId);}
function openMemberArchiveManager(){memberOptionsOpen=false;const archived=state.members.filter(m=>m.archived);openModal('Clientes Arquivados',`<div class="finance-grid" style="height:390px"><table><thead><tr><th>Cliente</th><th>Arquivado em</th><th>Arquivado por</th><th>Ação</th></tr></thead><tbody>${archived.map(m=>`<tr><td>${h(m.name)}</td><td>${reportDateTime(m.archivedAt)}</td><td>${h(m.archivedBy||'—')}</td><td><button class="op-mini" onclick="restoreMember(${jsArg(m.id)})">Restaurar</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhum cliente arquivado.</td></tr>'}</tbody></table></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button></div>`,true);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
async function restoreMember(id){const member=state.members.find(m=>m.id===id);if(!member)return;await MembersStore.restore(id);closeModal();renderAll();toast('Cliente restaurado.');}
function exportMembersCsv(){const cols=['Nome','Telefone','E-mail','Endereço','Número','Bairro','Cidade','UF','CPF/CNPJ','Cota','Saldo devedor'];const csv=[cols,...state.members.map(m=>[m.name,m.phone||'',m.email||'',m.address||'',m.addressNumber||'',m.district||'',m.city||'',m.uf||'',m.document||'',m.code||'',Number(m.debt)||0])].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='clientes-'+todayStr()+'.csv';a.click();URL.revokeObjectURL(a.href);logAction('Clientes exportados em CSV');}
function filterMemberRows(){memberSearchQuery=document.getElementById('memberSearch').value||'';memberSearchTypeValue=(document.getElementById('memberSearchType')||{}).value||'Busca Padrão';const q=memberSearchQuery.toLowerCase(),type=memberSearchTypeValue;document.querySelectorAll('#memberRows tr[data-search]').forEach(r=>{const cells=r.cells,text=type==='Nome'?cells[0]?.textContent:type==='Telefone'?cells[1]?.textContent:type==='Endereço'?[cells[2]?.textContent,cells[3]?.textContent,cells[4]?.textContent].join(' '):r.dataset.search;r.style.display=String(text||'').toLowerCase().includes(q)?'':'none';});}
const IMPORT_MEMBER_FIELDS = [
  {key:'name', label:'Nome', required:true, guesses:['Nome','Cliente']},
  {key:'phone', label:'Telefone', required:false, guesses:['Telefone','Telefone Principal','Celular']},
  {key:'email', label:'E-mail', required:false, guesses:['E-mail','Email']},
  {key:'address', label:'Endereço', required:false, guesses:['Endereço','Endereco','Rua']},
  {key:'addressNumber', label:'Número', required:false, guesses:['Número','Numero','Núm.','Num.']},
  {key:'district', label:'Bairro', required:false, guesses:['Bairro']},
  {key:'city', label:'Cidade', required:false, guesses:['Cidade']},
  {key:'uf', label:'UF', required:false, guesses:['UF','Estado']},
  {key:'document', label:'CPF/CNPJ', required:false, guesses:['CPF','CNPJ','CPF/CNPJ','Documento']},
  {key:'code', label:'Cota/Código', required:false, guesses:['Cota','Código','Codigo','Cota/Código']},
  {key:'debt', label:'Saldo Devedor', required:false, guesses:['Saldo Devedor','Débito','Debito','Saldo']}
];
let importMembersWorkbook=null, importMembersSheetName='', importMembersHeaders=[], importMembersRows=[], importMembersMapping={};
function openMembersImportWizard(){
  memberOptionsOpen=false;
  importMembersWorkbook=null; importMembersSheetName=''; importMembersHeaders=[]; importMembersRows=[]; importMembersMapping={};
  openModal('Importar Clientes', `
    <div class="import-tabs">
      <button class="import-tab active" id="impMemTabConfigBtn" onclick="switchImportMembersTab('config')">Configurar Importação</button>
      <button class="import-tab" id="impMemTabPreviewBtn" onclick="switchImportMembersTab('preview')">Visualizar Registros da Planilha <span id="impMemRowCount"></span></button>
    </div>
    <div id="importMembersTabConfig">
      <button class="btn" onclick="pickImportMembersExcelFile()">📊 &nbsp; Abrir Arquivo Excel...</button>
      <label class="comp-switch" style="margin:10px 0 0"><input type="checkbox" id="impMemExtractCota" onchange="updateImportMembersStartState()"><span></span> Extrair cota do final do nome (ex: "Fabricio - 1801")</label>
      <div class="row" style="margin-top:16px;align-items:flex-start;gap:20px">
        <div style="width:170px;flex-shrink:0">
          <label class="np-label">Planilha selecionada</label>
          <div id="importMembersSheetList" class="import-sheet-list"><p class="sub">Abra um arquivo para ver as planilhas.</p></div>
        </div>
        <div style="flex:1;min-width:0">
          <label class="np-label">Mapear colunas</label>
          <table class="finance-grid" style="width:100%"><thead><tr><th style="width:80px">Obrigat.</th><th>Campo no Commandah</th><th>Coluna na Planilha</th></tr></thead><tbody id="importMembersMapRows"><tr><td colspan="3" class="empty">Abra um arquivo Excel para mapear as colunas.</td></tr></tbody></table>
        </div>
      </div>
    </div>
    <div id="importMembersTabPreview" style="display:none">
      <div class="finance-grid" style="max-height:360px;overflow:auto"><table><thead><tr id="importMembersPreviewHead"></tr></thead><tbody id="importMembersPreviewRows"></tbody></table></div>
    </div>
    <div class="record-actions">
      <button class="op-btn" onclick="closeModal()">〈 &nbsp; Voltar</button>
      <button class="op-btn primary" id="impMemStartBtn" disabled onclick="startMappedMembersImport()">▷ &nbsp; Iniciar Importação</button>
    </div>
  `, true);
  const modal=document.querySelector('#modalRoot .modal'); modal.classList.add('record-modal'); modal.style.width='860px';
}
function switchImportMembersTab(tab){
  document.getElementById('impMemTabConfigBtn').classList.toggle('active', tab==='config');
  document.getElementById('impMemTabPreviewBtn').classList.toggle('active', tab==='preview');
  document.getElementById('importMembersTabConfig').style.display = tab==='config'?'block':'none';
  document.getElementById('importMembersTabPreview').style.display = tab==='preview'?'block':'none';
}
function pickImportMembersExcelFile(){
  if(!window.XLSX){ toast('Não foi possível carregar o leitor de planilhas — verifique sua conexão e tente de novo.'); return; }
  const input=document.createElement('input'); input.type='file'; input.accept='.xlsx,.xls';
  input.onchange=()=>{
    const file=input.files&&input.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        importMembersWorkbook = XLSX.read(reader.result,{type:'array'});
        importMembersSheetName = importMembersWorkbook.SheetNames[0];
        renderImportMembersSheetList();
        loadImportMembersSheet();
      }catch(e){ toast('Não foi possível ler esse arquivo.'); }
    };
    reader.onerror=()=>toast('Não foi possível ler o arquivo.');
    reader.readAsArrayBuffer(file);
  };
  input.click();
}
function renderImportMembersSheetList(){
  const el=document.getElementById('importMembersSheetList'); if(!el) return;
  el.innerHTML = importMembersWorkbook.SheetNames.map(name=>`<button class="import-sheet-item ${name===importMembersSheetName?'active':''}" onclick="selectImportMembersSheet(${h(JSON.stringify(name))})">${h(name)}</button>`).join('');
}
function selectImportMembersSheet(name){ importMembersSheetName=name; renderImportMembersSheetList(); loadImportMembersSheet(); }
function loadImportMembersSheet(){
  const sheet = importMembersWorkbook.Sheets[importMembersSheetName];
  const raw = XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
  if(!raw.length){ importMembersHeaders=[]; importMembersRows=[]; }
  else{
    importMembersHeaders = raw[0].map(c=>String(c||'').trim()).filter(Boolean);
    importMembersRows = raw.slice(1).filter(r=>r.some(v=>String(v||'').trim()) && !r.some(v=>/^total\s*(itens|registros)/i.test(String(v||''))));
  }
  IMPORT_MEMBER_FIELDS.forEach(f=>{
    const guess = importMembersHeaders.find(col=>f.guesses.some(g=>g.toLowerCase()===col.toLowerCase()));
    importMembersMapping[f.key] = guess || '';
  });
  renderImportMembersMapTable();
  renderImportMembersPreview();
  updateImportMembersStartState();
}
function renderImportMembersMapTable(){
  const el=document.getElementById('importMembersMapRows'); if(!el) return;
  if(!importMembersHeaders.length){ el.innerHTML='<tr><td colspan="3" class="empty">Abra um arquivo Excel para mapear as colunas.</td></tr>'; return; }
  el.innerHTML = IMPORT_MEMBER_FIELDS.map(f=>`<tr>
    <td style="text-align:center">${f.required?'<span style="color:var(--red);font-size:18px">●</span>':''}</td>
    <td>${h(f.label)}</td>
    <td><select onchange="importMembersMapping[${jsArg(f.key)}]=this.value;updateImportMembersStartState()">
      <option value="">— Selecione uma coluna —</option>
      ${importMembersHeaders.map(col=>`<option value="${h(col)}" ${importMembersMapping[f.key]===col?'selected':''}>${h(col)}</option>`).join('')}
    </select></td>
  </tr>`).join('');
}
function renderImportMembersPreview(){
  const head=document.getElementById('importMembersPreviewHead'), body=document.getElementById('importMembersPreviewRows'), countEl=document.getElementById('impMemRowCount');
  if(countEl) countEl.textContent = importMembersRows.length ? '('+importMembersRows.length+')' : '';
  if(!head||!body) return;
  head.innerHTML = importMembersHeaders.map(c=>`<th>${h(c)}</th>`).join('');
  body.innerHTML = importMembersRows.length ? importMembersRows.slice(0,200).map(r=>`<tr>${importMembersHeaders.map((c,i)=>`<td>${h(String(r[i]!==undefined?r[i]:''))}</td>`).join('')}</tr>`).join('') : '<tr><td class="empty">Nenhum registro.</td></tr>';
}
function updateImportMembersStartState(){
  const btn=document.getElementById('impMemStartBtn'); if(!btn) return;
  btn.disabled = !(importMembersMapping.name && importMembersRows.length);
}
function extractCotaFromName(rawName){
  const m = String(rawName||'').trim().match(/^(.*?)\s*-\s*(\d+)\s*-?\s*(.*)$/);
  if(!m) return { name: String(rawName||'').trim(), code:'' };
  const cleanName = m[1].trim();
  const cota = m[2].trim();
  const trailing = m[3].trim();
  return { name: trailing ? `${cleanName} (${trailing})` : cleanName, code: cota };
}
function fixExistingMemberCotas(){
  memberOptionsOpen=false;
  const candidates = state.members.filter(m=>!m.code && /^(.*?)\s*-\s*\d+/.test(m.name||''));
  if(!candidates.length){ toast('Nenhum cliente com esse padrão pendente de correção foi encontrado.'); return; }
  const preview = candidates.slice(0,5).map(m=>{ const r=extractCotaFromName(m.name); return `${h(m.name)} → <b>${h(r.name)}</b> (cota ${h(r.code)})`; }).join('<br>');
  openModal('Corrigir Cota nos Nomes Já Importados', `
    <p class="sub">Encontrados <b>${candidates.length}</b> clientes sem cota cadastrada, cujo nome parece ter o código no final (ex: "Fabricio - 1801"). Isso corrige o cadastro que já existe — não cria clientes novos.</p>
    <div class="panel" style="background:var(--cream);font-size:12.5px;line-height:1.8;padding:12px">${preview}${candidates.length>5?`<br><i>... e mais ${candidates.length-5}.</i>`:''}</div>
    <div class="row" style="margin-top:16px">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmFixExistingMemberCotas()">Corrigir ${candidates.length} cliente(s)</button>
    </div>
  `);
}
async function confirmFixExistingMemberCotas(){
  const candidates = state.members.filter(m=>!m.code && /^(.*?)\s*-\s*\d+/.test(m.name||''));
  let fixed=0;
  const updates=[];
  candidates.forEach(m=>{
    const r = extractCotaFromName(m.name);
    if(!r.code) return;
    const dup = state.members.find(x=>x.id!==m.id && x.code===r.code);
    if(dup) return;
    updates.push(MembersStore.update(m.id, { name:r.name, code:r.code }));
    fixed++;
  });
  await Promise.all(updates);
  closeModal(); renderAll();
  toast(fixed+' cliente(s) corrigido(s).');
  logAction('Correção de cota aplicada em '+fixed+' clientes já cadastrados');
}
async function startMappedMembersImport(){
  const colIndex = name => importMembersHeaders.indexOf(name);
  const idx = {}; Object.keys(importMembersMapping).forEach(k=>idx[k]=colIndex(importMembersMapping[k]));
  const val = (r,k) => idx[k]>=0 ? r[idx[k]] : '';
  const extractCota = document.getElementById('impMemExtractCota')?.checked;
  let count=0;
  const newMembers=[]; const updates=[];
  importMembersRows.forEach(r=>{
    let name = String(val(r,'name')||'').trim();
    let code = String(val(r,'code')||'').trim();
    if(!name) return;
    if(extractCota){
      const extracted = extractCotaFromName(name);
      name = extracted.name;
      if(!code) code = extracted.code;
    }
    const document_ = String(val(r,'document')||'').trim();
    const existing = state.members.find(m=>(code && m.code===code) || (document_ && m.document===document_));
    const data = {
      name,
      phone: String(val(r,'phone')||'').trim(),
      email: String(val(r,'email')||'').trim(),
      address: String(val(r,'address')||'').trim(),
      addressNumber: String(val(r,'addressNumber')||'').trim(),
      district: String(val(r,'district')||'').trim(),
      city: String(val(r,'city')||'').trim(),
      uf: String(val(r,'uf')||'').trim().toUpperCase(),
      document: document_,
      code
    };
    if(existing) updates.push(MembersStore.update(existing.id, data));
    else newMembers.push({ debt:Number(String(val(r,'debt')||0).toString().replace(',','.'))||0, tags:[], ...data });
    count++;
  });
  await Promise.all(updates);
  if(newMembers.length) await MembersStore.bulkImport(newMembers);
  closeModal(); renderAll();
  toast(count+' cliente(s) importado(s) ou atualizado(s).');
  logAction('Clientes importados de '+(importMembersSheetName||'planilha selecionada'));
}
function openMemberTagManager(){memberOptionsOpen=false;const tags=[...new Set([...(state.settings.memberTags||[]),...state.members.flatMap(m=>Array.isArray(m.tags)?m.tags:[])])].sort();openModal('Gerenciar Tags de Clientes',`<div class="consumer-form-frame"><div class="field"><label>Nova tag</label><div class="inline-create"><input id="newMemberTag"><button onclick="addMemberTag()">＋ Adicionar</button></div></div><div class="finance-grid" style="height:310px"><table><thead><tr><th>Tag</th><th>Clientes vinculados</th><th>Excluir</th></tr></thead><tbody>${tags.map(t=>`<tr><td>${h(t)}</td><td>${state.members.filter(m=>(m.tags||[]).includes(t)).length}</td><td><button class="op-mini" data-tag="${h(t)}" onclick="deleteMemberTag(this.dataset.tag)">✕</button></td></tr>`).join('')||'<tr><td colspan="3" class="empty">Nenhuma tag cadastrada.</td></tr>'}</tbody></table></div></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
/* Os 5 blocos abaixo gravam cantina2:settings, que na RLS por papel é escrita
   exclusiva de admin/dono (classe 'catalogo'). Regra adotada, uniforme e fácil de
   auditar: TODO botão que grava settings exige 'config-sistema'. Sem esta guarda o
   caixa clicaria em Salvar dentro de uma tela que ele tem (Clientes, Fila de
   Atendimento, Painel de Senhas, Impressoras, Cardápio Digital) e levaria erro de
   permissão do banco, com banner de falha ao salvar pendurado na tela. */
function addMemberTag(){if(!requirePerm('config-sistema'))return;const tag=document.getElementById('newMemberTag').value.trim();if(!tag){toast('Informe a tag.');return;}state.settings.memberTags=[...new Set([...(state.settings.memberTags||[]),tag])];save('settings');closeModal();openMemberTagManager();}
async function deleteMemberTag(tag){if(!requirePerm('config-sistema'))return;if(!confirm('Remover esta tag de todos os clientes?'))return;await MembersStore.removeTagEverywhere(tag);state.settings.memberTags=(state.settings.memberTags||[]).filter(x=>x!==tag);save('settings');closeModal();openMemberTagManager();}
function openMemberTagFilter(){memberOptionsOpen=false;const tags=[...new Set([...(state.settings.memberTags||[]),...state.members.flatMap(m=>m.tags||[])])].sort();openModal('Filtrar por Tags',`<div class="consumer-form-frame"><div class="field"><label>Tag</label><select id="memberTagFilter"><option value="">Todas</option>${tags.map(t=>`<option>${h(t)}</option>`).join('')}</select></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="applyMemberTagFilter()">⌕ Filtrar</button></div>`);}
function applyMemberTagFilter(){const tag=document.getElementById('memberTagFilter').value;closeModal();const input=document.getElementById('memberSearch');if(input)input.value=tag?`Tag: ${tag}`:'';document.querySelectorAll('#memberRows tr[data-member-id]').forEach(row=>{const member=state.members.find(m=>m.id===row.dataset.memberId);row.style.display=!tag||(member&&member.tags||[]).includes(tag)?'':'none';});}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('button');if(!button)return;const label=button.textContent.trim();if(label.includes('Importar Clientes')){event.preventDefault();event.stopImmediatePropagation();openMembersImportWizard();}else if(label.includes('Gerenciar Tags')){event.preventDefault();event.stopImmediatePropagation();openMemberTagManager();}else if(label.includes('Filtrar Tags')){event.preventDefault();event.stopImmediatePropagation();openMemberTagFilter();}},true);
if(typeof document.addEventListener==='function')document.addEventListener('change',event=>{const checkbox=event.target.closest&&event.target.closest('#view-associados .op-footer input[type="checkbox"]');if(!checkbox)return;event.preventDefault();openMemberArchiveManager();checkbox.checked=false;});
function renderAssociados(){
  const el = document.getElementById('view-associados');
  const activeMembers=state.members.filter(m=>!m.archived);
  const rows=activeMembers.length?activeMembers.map(m=>{const sales=state.sales.filter(s=>s.memberId===m.id&&saleCountsAsRevenue(s)).sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt));const address=[m.address,m.addressNumber,m.district].filter(Boolean).join(', ');return `<tr data-member-id="${m.id}" data-search="${h(([m.name,m.phone,m.email,address,m.code,...(m.tags||[])].join(' ')).toLowerCase())}" class="${selectedMemberId===m.id?'selected':''}" onclick="selectMemberRow(${jsArg(m.id)})" ondblclick="editMember(${jsArg(m.id)})"><td>${h(m.name)}</td><td>${h(m.phone||'—')}</td><td>${h(address||'—')}</td><td>${h(m.addressNumber||'—')}</td><td>${h(m.district||'—')}</td><td>${h(m.email||'—')}</td><td class="mono">${sales.length}</td><td>${sales.length?new Date(sales[0].closedAt).toLocaleDateString('pt-BR'):'—'}</td>${memberShowMore?`<td>${h(m.code||'—')}</td><td class="mono">${fmt(m.debt)}</td>`:''}</tr>`}).join(''):`<tr><td colspan="${memberShowMore?10:8}" class="empty">Não há registros para mostrar</td></tr>`;
  el.innerHTML=`<div class="workspace-gray"><section class="op-window"><header class="op-titlebar"><span>Clientes</span><span class="op-controls"><span onclick="closeOperationalWindow()" style="cursor:pointer" title="Fechar">×</span></span></header><div class="op-toolbar"><div class="op-search"><input id="memberSearch" placeholder="Pesquisar cliente..." value="${h(memberSearchQuery)}"></div><select class="op-btn" id="memberSearchType">${['Busca Padrão','Nome','Telefone','Endereço'].map(x=>`<option ${memberSearchTypeValue===x?'selected':''}>${x}</option>`).join('')}</select><button class="op-btn" onclick="filterMemberRows()"><span class="op-ico">⌕</span> Buscar</button><div class="op-toolbar-spacer"></div><div class="pdv-menu-wrap"><button class="op-btn" onclick="toggleMemberOptions()">••• &nbsp; Opções ▾</button>${memberOptionsOpen?`<div class="pdv-menu" style="top:48px;min-width:210px"><button onclick="memberShowMore=!memberShowMore;memberOptionsOpen=false;renderAssociados()">▦ &nbsp; Mais Colunas</button><button onclick="window.print()">▣ &nbsp; Imprimir</button><button onclick="exportMembersCsv()">⇩ &nbsp; Exportar CSV</button><button onclick="openMembersImportWizard()">⇧ &nbsp; Importar Clientes…</button><button onclick="fixExistingMemberCotas()">✎ &nbsp; Corrigir Cota nos Nomes Já Importados</button><button onclick="openMemberTagManager()">⚙ &nbsp; Gerenciar Tags</button><button onclick="openMemberTagFilter()">▽ &nbsp; Filtrar Tags</button><button onclick="openMemberArchiveManager()">▤ &nbsp; Clientes Arquivados</button></div>`:''}</div><button class="op-btn" onclick="editSelectedMember()" ${selectedMemberId?'':'disabled'}><span class="op-ico">✎</span> Editar</button><button class="op-btn" onclick="archiveSelectedMember()" ${selectedMemberId?'':'disabled'}><span class="op-ico">▤</span> Arquivar</button><button class="op-btn primary" onclick="openMemberModal()"><span class="op-ico">＋</span> Novo</button></div><div class="op-grid"><table style="min-width:1200px"><thead><tr><th>Nome</th><th>Telefone Principal</th><th>Endereço</th><th>Núm.</th><th>Bairro</th><th>E-mail</th><th>Qtd. Pedidos</th><th>Últ. Pedido</th>${memberShowMore?'<th>Cota/Código</th><th>Saldo Devedor</th>':''}</tr></thead><tbody id="memberRows">${rows}</tbody></table></div><footer class="op-footer"><button class="op-mini" onclick="openMemberArchiveManager()">Arquivados: ${state.members.length-activeMembers.length}</button><span>Mostrando ${activeMembers.length} de ${state.members.length} registros.</span></footer></section></div>`;
  document.getElementById('memberSearch').oninput=filterMemberRows;
  document.getElementById('memberSearchType').onchange=filterMemberRows;
  filterMemberRows();
}
function openMemberModal(id){
  const m = id ? state.members.find(x=>x.id===id) : null;
  openModal(m?'Editar Cliente':'Novo Cliente', `<div class="record-body"><div class="record-tabs"><button data-tab="principal" class="active" onclick="setProductModalTab('principal')">Dados Principais</button><button data-tab="secundarios" onclick="setProductModalTab('secundarios')">Dados Secundários</button></div><section class="record-pane active" data-pane="principal"><div class="field"><label>Nome</label><input id="mName" value="${h(m?m.name:'')}"></div><div class="grid3"><div class="field"><label>Telefone Principal</label><input id="mPhone" value="${h(m?m.phone||'':'')}"></div><div class="field"><label>E-mail</label><input id="mEmail" type="email" value="${h(m?m.email||'':'')}"></div><div class="field"><label>Sexo</label><select id="mGender"><option value="">—</option><option ${m&&m.gender==='Feminino'?'selected':''}>Feminino</option><option ${m&&m.gender==='Masculino'?'selected':''}>Masculino</option><option ${m&&m.gender==='Outro'?'selected':''}>Outro</option></select></div></div><div class="grid3"><div class="field"><label>CPF ou CNPJ</label><input id="mDocument" value="${h(m?m.document||'':'')}"></div><div class="field"><label>RG ou IE</label><input id="mRegistry" value="${h(m?m.registry||'':'')}"></div><div class="field"><label>Data de Nascimento</label><input id="mBirth" type="date" value="${h(m?m.birthDate||'':'')}"></div></div><h3 style="font-size:13px;border-bottom:1px solid var(--c-border-strong);padding-bottom:8px">Endereço Principal</h3><div class="grid4"><div class="field"><label>CEP</label><input id="mZip" value="${h(m?m.zip||'':'')}"></div><div class="field" style="grid-column:span 2"><label>Endereço</label><input id="mAddress" value="${h(m?m.address||'':'')}"></div><div class="field"><label>Número</label><input id="mNumber" value="${h(m?m.addressNumber||'':'')}"></div></div><div class="grid4"><div class="field"><label>Complemento</label><input id="mComplement" value="${h(m?m.addressComplement||'':'')}"></div><div class="field"><label>Bairro</label><input id="mDistrict" value="${h(m?m.district||'':'')}"></div><div class="field"><label>Cidade</label><input id="mCity" value="${h(m?m.city||'São Paulo':'São Paulo')}"></div><div class="field"><label>UF</label><input id="mUf" maxlength="2" value="${h(m?m.uf||'SP':'SP')}"></div></div><div class="row"><div class="field"><label>Ponto de Referência</label><input id="mReference" value="${h(m?m.reference||'':'')}"></div><div class="field"><label>Código IBGE</label><input id="mIbge" value="${h(m?m.ibge||'':'')}"></div></div></section><section class="record-pane" data-pane="secundarios"><div class="grid3"><div class="field"><label>Cota / Código</label><input id="mCode" value="${h(m?m.code||'':'')}"></div><div class="field"><label>Tags</label><input id="mTags" value="${h(m?(m.tags||[]).join(', '):'')}" placeholder="VIP, delivery, clube"></div><div class="field"><label>Pontos de fidelidade</label><input value="${Number(m&&m.points)||0}" disabled></div></div><div class="field"><label>Observações</label><textarea id="mNotes" rows="5">${h(m?m.notes||'':'')}</textarea></div><label class="item-line lgpd-optin"><span>Aceita receber campanhas e promoções <small class="sub">(LGPD: consentimento; a cobrança de fiado não depende disto)</small></span><input id="mMarketing" type="checkbox" ${m&&m.marketingOptIn?'checked':''}></label>${m?`<div class="lgpd-actions"><span class="sub">Privacidade (LGPD):</span><button type="button" class="op-btn" onclick="exportMemberData(${jsArg(m.id)})">⇩ &nbsp; Exportar dados</button>${isAdminUser()?`<button type="button" class="op-btn" onclick="anonymizeMember(${jsArg(m.id)})">Anonimizar</button>`:''}<button type="button" class="link-btn" onclick="openPrivacyNotice()">Aviso de privacidade</button></div>`:''}<p class="sub">${(Number(m&&m.debt)||0)<-TOLERANCIA_CENTAVO?`✓ Crédito disponível: <b>${fmt(-(Number(m&&m.debt)||0))}</b>. É abatido automaticamente no total da próxima compra vinculada a este sócio.`:`Saldo devedor atual: <b>${fmt(m?m.debt:0)}</b>. Com fiado em aberto o sócio fica bloqueado até pagar (o administrador pode liberar com a senha).`} Lançamentos ficam em Financeiro → Fiado.</p></section><div class="record-actions"><button class="op-btn" onclick="closeModal()">Voltar</button><button class="op-btn primary" id="mSaveBtn">Salvar e Voltar</button></div></div>`,true);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');
  document.getElementById('mSaveBtn').onclick = async ()=>{
    const name = document.getElementById('mName').value.trim();
    if(!name){ toast('Informe o nome do associado.'); return; }
    const data = { name, code:document.getElementById('mCode').value.trim(), phone:document.getElementById('mPhone').value.trim(),email:document.getElementById('mEmail').value.trim(),gender:document.getElementById('mGender').value,document:document.getElementById('mDocument').value.trim(),registry:document.getElementById('mRegistry').value.trim(),birthDate:document.getElementById('mBirth').value,zip:document.getElementById('mZip').value.trim(),address:document.getElementById('mAddress').value.trim(),addressNumber:document.getElementById('mNumber').value.trim(),addressComplement:document.getElementById('mComplement').value.trim(),district:document.getElementById('mDistrict').value.trim(),city:document.getElementById('mCity').value.trim(),uf:document.getElementById('mUf').value.trim().toUpperCase(),reference:document.getElementById('mReference').value.trim(),ibge:document.getElementById('mIbge').value.trim(),tags:document.getElementById('mTags').value.split(',').map(x=>x.trim()).filter(Boolean),notes:document.getElementById('mNotes').value.trim(),marketingOptIn:!!document.getElementById('mMarketing')?.checked };
    const saved = m ? await MembersStore.update(m.id, data) : await MembersStore.create(data);
    closeModal(); renderAll(); toast('Associado salvo.');
    return saved;
  };
}
const openMemberModalBase=openMemberModal;
openMemberModal=function(id){openMemberModalBase(id);const member=id?state.members.find(x=>x.id===id):null;window.memberDependentsDraft=Array.isArray(member&&member.dependents)?member.dependents.map(d=>({...d})):[];const tabs=document.querySelector('#modalRoot .record-tabs'),actions=document.querySelector('#modalRoot .record-actions'),body=actions&&actions.parentElement;if(!tabs||!actions||!body)return;tabs.insertAdjacentHTML('beforeend','<button data-tab="dependentes" onclick="setProductModalTab(\'dependentes\');renderMemberDependents()">Dependentes</button>');actions.insertAdjacentHTML('beforebegin','<section class="record-pane" data-pane="dependentes"><div class="op-toolbar" style="padding:0 0 10px"><div><b>Dependentes vinculados à cota</b><p class="sub">Controle individualmente quem pode fazer pedidos.</p></div><span class="op-toolbar-spacer"></span><button type="button" class="op-btn primary" onclick="addMemberDependentRow()">＋ Novo Dependente</button></div><div class="finance-grid" style="height:350px"><table><thead><tr><th>Nome</th><th>Parentesco</th><th>Documento/Identificação</th><th>Pode pedir</th><th>Excluir</th></tr></thead><tbody id="memberDependentRows"></tbody></table></div></section>');const saveButton=document.getElementById('mSaveBtn'),originalSave=saveButton.onclick;saveButton.onclick=async ()=>{syncMemberDependentsDraft();const saved=await originalSave();if(saved){const dependents=window.memberDependentsDraft.map(d=>({...d,name:String(d.name||'').trim()})).filter(d=>d.name);await MembersStore.saveDependents(saved.id,dependents);}};renderMemberDependents();};
function renderMemberDependents(){const body=document.getElementById('memberDependentRows');if(!body)return;body.innerHTML=(window.memberDependentsDraft||[]).map((d,index)=>`<tr data-dependent-index="${index}"><td><input class="dep-name" value="${h(d.name||'')}" placeholder="Nome completo"></td><td><input class="dep-relationship" value="${h(d.relationship||'')}" placeholder="Filho, cônjuge..."></td><td><input class="dep-document" value="${h(d.document||'')}"></td><td style="text-align:center"><label><input class="dep-can-order" type="checkbox" ${d.canOrder!==false?'checked':''}> <span>${d.canOrder!==false?'Autorizado':'Bloqueado'}</span></label></td><td><button type="button" class="op-mini" onclick="removeMemberDependent(${index})">✕</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhum dependente cadastrado.</td></tr>';body.querySelectorAll('.dep-can-order').forEach(input=>input.onchange=()=>{input.nextElementSibling.textContent=input.checked?'Autorizado':'Bloqueado';});}
function syncMemberDependentsDraft(){document.querySelectorAll('#memberDependentRows tr[data-dependent-index]').forEach(row=>{const d=window.memberDependentsDraft[Number(row.dataset.dependentIndex)];if(!d)return;d.name=row.querySelector('.dep-name').value.trim();d.relationship=row.querySelector('.dep-relationship').value.trim();d.document=row.querySelector('.dep-document').value.trim();d.canOrder=row.querySelector('.dep-can-order').checked;});}
function addMemberDependentRow(){syncMemberDependentsDraft();window.memberDependentsDraft.push({id:uid(),name:'',relationship:'',document:'',canOrder:true});renderMemberDependents();setTimeout(()=>document.querySelector('#memberDependentRows tr:last-child .dep-name')?.focus(),0);}
function removeMemberDependent(index){syncMemberDependentsDraft();window.memberDependentsDraft.splice(index,1);renderMemberDependents();}
function editMember(id){ openMemberModal(id); }
async function deleteMember(id){const member=state.members.find(m=>m.id===id);if(!member)return;if(Number(member.debt)>0){toast('Quite o saldo devedor antes de arquivar este cliente.');return;}if(!confirm('Arquivar este cliente? O histórico de pedidos será preservado.'))return;await MembersStore.archive(id,currentUser.name);selectedMemberId=null;renderAll();toast('Cliente arquivado.');}

