/* ============ BACKUP ============ */
const BACKUP_VERSION = 3;
function backupInventory(source=state){
  const inventory={};
  Object.keys(STORE).forEach(key=>{const value=source[key];inventory[key]=Array.isArray(value)?value.length:(value==null?0:1);});
  return inventory;
}
function renderBackup(){
  const el = document.getElementById('view-backup');
  const last=state.settings.lastBackupAt?dataHoraBR(state.settings.lastBackupAt):'Ainda não realizado nesta instalação';
  const total=Object.values(backupInventory()).reduce((sum,n)=>sum+n,0);
  el.innerHTML = `<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">Backup do Sistema</header><div style="padding:22px;display:grid;grid-template-columns:2fr 1fr;gap:24px"><section style="padding-right:24px;border-right:1px solid var(--c-border-strong)"><h2>Configurar Backup</h2><div class="settings-section"><b>Backups manuais neste dispositivo</b><p class="sub">O navegador solicitará o local para salvar o arquivo. Último backup: ${last}.</p><div class="field"><label>Nome sugerido</label><input value="backup-cantina-${todayStr()}.json" disabled></div><p class="sub">${Object.keys(STORE).length} conjuntos persistentes e ${total} registros/itens serão incluídos com as configurações operacionais.</p></div><div class="settings-section"><b>Backups automáticos na nuvem</b><p class="sub">Google Drive, Dropbox ou outro provedor exigem credenciais e autorização externas.</p><div class="grid2"><div class="panel" style="text-align:center"><div style="font-size:34px">☁</div><b>Google Drive</b><br><button class="op-btn" onclick="toast('Google Drive não configurado: são necessárias credenciais OAuth.')">Configurar</button></div><div class="panel" style="text-align:center"><div style="font-size:34px">◇</div><b>Dropbox</b><br><button class="op-btn" onclick="toast('Dropbox não configurado: são necessárias credenciais OAuth.')">Configurar</button></div></div></div></section><section><h2>Restaurar Backup</h2><b>Restaurar um backup existente</b><p class="sub">A restauração substitui os dados locais atuais. Selecione um backup JSON exportado por este sistema.</p><input type="file" id="backupFile" accept=".json,application/json"><button class="op-btn" style="width:100%;margin-top:15px" onclick="importBackup()">⇧ Restaurar Backup de Dados</button><button class="op-btn" style="width:100%;margin-top:10px" onclick="toast('Fotos incorporadas não possuem um pacote separado nesta edição.')">▣ Restaurar Backup de Fotos</button><button class="op-btn" style="width:100%;margin-top:10px" onclick="toast('Importação XML depende do emissor e do leiaute fiscal do arquivo.')">XML &nbsp; Importar Dados</button></section></div><div class="record-actions"><button class="op-btn primary" onclick="exportBackup()">▷ &nbsp; Fazer Backup Agora</button></div><footer class="op-footer"><span>Formato JSON · versão ${BACKUP_VERSION}</span><span>Inclui todas as coleções persistidas</span></footer></section></div>`;
}
function exportBackup(){
  const exportedAt=new Date().toISOString();
  state.settings.lastBackupAt=exportedAt;
  const dump = {}; Object.keys(STORE).forEach(k=> dump[k]=state[k]);
  const backup = { format:'cantina-clube-backup', version:BACKUP_VERSION, exportedAt, inventory:backupInventory(dump), data:dump };
  const blob = new Blob([JSON.stringify(backup,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'backup-cantina-'+todayStr()+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);save('settings');renderBackup();enhanceBackupActions();
  logAction('Backup exportado');
}
function exportMediaBackup(){const media={version:1,exportedAt:new Date().toISOString(),products:state.products.filter(p=>p.image).map(p=>({id:p.id,image:p.image})),backgroundImage:state.settings.backgroundImage||'',printerLogos:Object.fromEntries(Object.entries(state.settings.printerConfig||{}).map(([k,v])=>[k,v.logo||'']))};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(media)],{type:'application/json'}));a.download='backup-midias-'+todayStr()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);logAction('Backup de mídias exportado');}
function enhanceBackupActions(){const actions=document.querySelector('#view-backup .record-actions');if(!actions||actions.querySelector('[data-media-backup]'))return;const b=document.createElement('button');b.className='op-btn';b.dataset.mediaBackup='true';b.textContent='▧ Fazer Backup de Mídias';b.onclick=exportMediaBackup;actions.prepend(b);}
function importMediaBackup(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=()=>{const file=input.files&&input.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const media=JSON.parse(reader.result);if(media.version!==1||!Array.isArray(media.products))throw new Error();media.products.forEach(x=>{const p=state.products.find(y=>y.id===x.id);if(p&&typeof x.image==='string')p.image=x.image;});if(typeof media.backgroundImage==='string')state.settings.backgroundImage=media.backgroundImage;if(media.printerLogos&&typeof media.printerLogos==='object')Object.entries(media.printerLogos).forEach(([k,logo])=>{if(state.settings.printerConfig&&state.settings.printerConfig[k])state.settings.printerConfig[k].logo=logo;});save('products');save('settings');renderAll();toast('Mídias restauradas.');}catch(e){toast('Backup de mídias inválido.');}};reader.readAsText(file);};input.click();}
function openCloudBackupConfig(provider){const all=state.settings.cloudBackup||{},c=all[provider]||{};openModal('Backup — '+provider,`<div class="consumer-form-frame"><div class="app-status"><b>${provider}</b><span class="tag ${c.enabled?'tag-green':'tag-gray'}">${c.enabled?'Configurado':'Não configurado'}</span></div><div class="field"><label>Identificador da conta</label><input id="cloudAccount" value="${h(c.account||'')}"></div><div class="field"><label>Pasta de destino</label><input id="cloudFolder" value="${h(c.folder||'Backups do Sistema')}"></div><label><input id="cloudDaily" type="checkbox" ${c.daily?'checked':''}> Preparar backup diário</label><br><label><input id="cloudEnabled" type="checkbox" ${c.enabled?'checked':''}> Ativar após autorizar o provedor</label><p class="sub">O arquivo local não executa OAuth nem envio externo sozinho. Esta tela armazena a configuração necessária para uma integração autorizada.</p></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveCloudBackupConfig(${jsArg(provider)})">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
function saveCloudBackupConfig(provider){state.settings.cloudBackup=state.settings.cloudBackup||{};state.settings.cloudBackup[provider]={account:document.getElementById('cloudAccount').value.trim(),folder:document.getElementById('cloudFolder').value.trim(),daily:document.getElementById('cloudDaily').checked,enabled:document.getElementById('cloudEnabled').checked};save('settings');closeModal();toast('Configuração de backup salva.');}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{const b=event.target.closest&&event.target.closest('#view-backup button');if(!b)return;const text=b.textContent.trim();if(text==='Configurar'){const panel=b.closest('.panel'),provider=panel&&panel.querySelector('b')?.textContent;if(provider){event.preventDefault();event.stopImmediatePropagation();openCloudBackupConfig(provider);}}else if(text.includes('Restaurar Backup de Fotos')){event.preventDefault();event.stopImmediatePropagation();importMediaBackup();}},true);
function importBackup(){
  const inp = document.getElementById('backupFile');
  if(!inp.files.length){ toast('Selecione um arquivo de backup.'); return; }
  if(inp.files[0].size>50*1024*1024){toast('O arquivo excede o limite de 50 MB.');return;}
  if(!confirm('Isso vai substituir todos os dados atuais. Continuar?')) return;
  const reader = new FileReader();
  reader.onload = async (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(parsed && parsed.version!=null && ![2,3].includes(Number(parsed.version))) throw new Error('Versão de backup não suportada');
      if(Number(parsed.version)===3 && parsed.format!=='cantina-clube-backup') throw new Error('Origem de backup inválida');
      const dump = parsed && parsed.data ? parsed.data : parsed;
      if(!dump || typeof dump!=='object' || Array.isArray(dump)) throw new Error('Formato inválido');
      const scalarTypes={cashSession:'object',settings:'object',orderCounter:'number'};
      for(const k of Object.keys(STORE)){
        if(!(k in dump)) continue;
        if(k==='cashSession' && dump[k]===null) continue;
        if(scalarTypes[k]){ if(typeof dump[k]!==scalarTypes[k] || Array.isArray(dump[k]) || (k==='settings'&&dump[k]===null) || (k==='orderCounter'&&(!Number.isFinite(dump[k])||dump[k]<0))) throw new Error('Tipo inválido em '+k); }
        else if(!Array.isArray(dump[k])) throw new Error('Lista inválida em '+k);
        else if(dump[k].some(item=>!item || typeof item!=='object' || (item.id!=null && !/^[A-Za-z0-9_-]+$/.test(String(item.id))))) throw new Error('Registro inválido em '+k);
      }
      const snapshot={};Object.keys(STORE).forEach(k=>snapshot[k]=state[k]);
      try{for(const k of Object.keys(STORE)){if(k in dump){state[k]=dump[k];if(!(await save(k)))throw new Error('Falha ao persistir '+k);}}}
      catch(saveError){for(const k of Object.keys(STORE)){state[k]=snapshot[k];await save(k);}throw saveError;}
      state.settings.lastRestoreAt=new Date().toISOString();await save('settings');
      toast('Backup restaurado com sucesso.'); logAction('Backup restaurado'); renderAll();
    }catch(err){ toast('Arquivo inválido.'); }
  };
  reader.readAsText(inp.files[0]);
}

