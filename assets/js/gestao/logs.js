/* ============ LOGS / AUDITORIA ============
   Por que saiu do blob: logAction() fazia unshift + slice(0,300) + save('logs'),
   ou seja, toda gravação reescrevia a linha inteira e DESCARTAVA de propósito as
   entradas antigas. Pro Postgres, "acrescentar um log" e "apagar o log de ontem"
   eram o mesmo UPDATE, com a mesma cara — nenhuma policy de RLS consegue separar
   os dois (WITH CHECK não enxerga a linha antiga). Log que o auditado pode
   reescrever não é auditoria, é rascunho.
   Agora: uma linha por evento em public.audit_log, INSERT-only, sem policy de
   UPDATE nem de DELETE pra ninguém — nem pro dono pelo navegador. Quem é o autor
   e quando aconteceu são carimbados por trigger no servidor, então um caixa não
   consegue registrar ação em nome do admin.
   FIRE-AND-FORGET: gravar log NUNCA pode travar nem atrasar a ação que está sendo
   logada. Se o insert falhar (rede caiu no meio da venda), a entrada continua
   visível na sessão local e a venda segue normalmente. */
function logEntryLocal(text){
  state.logs.unshift({ id:uid(), text, user: currentUser? currentUser.name : '—', at:new Date().toISOString() });
  if(state.logs.length>300) state.logs = state.logs.slice(0,300);
}
function logAction(text){
  logEntryLocal(text);
  if(isCloudMode() && supabaseClient){
    // Sem await de propósito. tenant_id/at/ator saem do trigger audit_log_stamp().
    supabaseClient.from('audit_log')
      .insert({ action:String(text||''), actor_name: currentUser? currentUser.name : null })
      .then(()=>{}, ()=>{});
    return;
  }
  // Modo Local/Compartilhado: não existe RLS nem servidor, mantém o blob de sempre.
  save('logs');
}
let logCategory='geral';
function setLogCategory(category){logCategory=category;renderLogs();}
function setLogPeriod(period){
  const from=document.getElementById('logFrom'),to=document.getElementById('logTo');if(!from||!to)return;
  const end=new Date(),start=new Date(end);end.setHours(12,0,0,0);start.setHours(12,0,0,0);
  if(period==='yesterday'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1);}
  else if(period==='previousMonth'){start.setDate(1);start.setMonth(start.getMonth()-1);end.setDate(0);}
  else if(period==='month')start.setDate(1);
  from.value=localDay(start);to.value=localDay(end);filterLogRows();
}
function exportLogsCsv(){const rows=[['Data/Hora','Usuário','Evento'],...state.logs.map(l=>[new Date(l.at).toLocaleString('pt-BR'),l.user,l.text])];const csv=rows.map(r=>r.map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a.download='logs-'+todayStr()+'.csv';a.click();URL.revokeObjectURL(a.href);}
function renderLogs(){
  const el = document.getElementById('view-logs');
  if(activeRibbonAction==='Erros do Sistema'){
    const list = state.clientErrors||[];
    const rows = list.length ? list.map(x=>`<tr><td>${reportDateTime(x.at)}</td><td>${h(x.actor_name||'—')}</td><td>${h(x.message)}</td><td class="sub">${h(x.page||'')}</td><td class="sub">${h((x.source||'').split('/').pop()||'página')}${x.line?':'+x.line:''}</td><td class="sub">${x.app_version&&x.app_version.length>=16?h(x.app_version.slice(8,10)+'/'+x.app_version.slice(5,7)+' '+x.app_version.slice(11,16)):h(x.app_version||'')}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Nenhum erro registrado. Quando der erro em algum aparelho, ele aparece aqui.</td></tr>';
    el.innerHTML=`<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">Erros do Sistema</header><div class="op-toolbar"><span class="sub">Últimos 300 erros dos aparelhos (caixa, garçom, cozinha). Um erro repetido aparece uma vez por sessão.</span><span class="op-toolbar-spacer"></span><button class="op-btn" onclick="openLogsView('Erros do Sistema')">↻ &nbsp; Atualizar</button></div><div class="finance-grid" style="flex:1;min-height:0"><table><thead><tr><th>Data</th><th>Usuário</th><th>Erro</th><th>Tela</th><th>Onde</th><th>Versão</th></tr></thead><tbody>${rows}</tbody></table></div><footer class="op-footer"><span>Registros: ${list.length}</span></footer></section></div>`;
    return;
  }
  const isQueue=activeRibbonAction==='Fila de Eventos';
  if(isQueue){
    const queue=state.eventQueue||[],now=Date.now();let queueChanged=false;queue.forEach(e=>{if(e.expiresAt&&new Date(e.expiresAt).getTime()<now&&e.status==='pendente'){e.status='expirado';queueChanged=true;}});
    const queueRows=queue.length?queue.map(l=>`<tr data-status="${h(l.status||'pendente')}" class="${l.status==='falha'?'low-stock':''}" ondblclick="openQueueEventModal(${jsArg(l.id)})"><td class="mono">${h(l.id)}</td><td>${reportDateTime(l.at)}</td><td>${h(l.name||'Serviço local')}</td><td>${h(l.tag||'Notificação')}</td><td title="${h(l.message||'')}">${h(l.message||'')}</td><td>${Number(l.attempts)||0}</td><td>${l.expiresAt?reportDateTime(l.expiresAt):'—'}</td><td><span class="tag ${l.status==='concluido'?'tag-green':l.status==='falha'||l.status==='expirado'?'tag-red':'tag-amber'}">${h(l.status||'pendente')}</span></td><td><button class="op-mini" title="Editar" onclick="event.stopPropagation();openQueueEventModal(${jsArg(l.id)})">✎</button><button class="op-mini" title="Reprocessar" onclick="event.stopPropagation();retryQueueEvent(${jsArg(l.id)})">↻</button><button class="op-mini" title="Concluir" onclick="event.stopPropagation();completeQueueEvent(${jsArg(l.id)})">✓</button><button class="op-mini" title="Excluir" onclick="event.stopPropagation();deleteQueueEvent(${jsArg(l.id)})">✕</button></td></tr>`).join(''):'<tr><td colspan="9" class="empty">Não há eventos aguardando processamento.</td></tr>';
    el.innerHTML=`<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">Fila de Eventos <span class="op-controls"><span onclick="switchView('principal')">×</span></span></header><div class="op-toolbar"><div class="op-search"><input id="queueSearch" placeholder="Pesquisar aqui..."></div><select id="queueStatus" onchange="filterQueueRows()"><option value="">Todos os status</option>${['pendente','falha','concluido','expirado'].map(x=>`<option>${x}</option>`).join('')}</select><div class="op-toolbar-spacer"></div><div class="pdv-menu-wrap"><button class="op-btn" onclick="toggleQueueOptions(this)">••• &nbsp; Opções</button></div><button class="op-btn" onclick="renderLogs()">↻ Atualizar</button><button class="op-btn primary" onclick="openQueueEventModal()">＋ Novo Evento</button></div><div class="op-grid"><table style="table-layout:fixed;width:100%"><thead><tr><th style="width:9%">ID</th><th style="width:12%">Inserida Em</th><th style="width:12%">Nome</th><th style="width:9%">Tag</th><th>Mensagem</th><th style="width:7%">Tent.</th><th style="width:12%">Expira em</th><th style="width:9%">Status</th><th style="width:13%">Ações</th></tr></thead><tbody id="queueRows">${queueRows}</tbody></table></div><footer class="op-footer"><span>Total=${queue.length} · Pendentes=${queue.filter(x=>x.status==='pendente').length} · Falhas=${queue.filter(x=>x.status==='falha').length}</span><span>Processamento externo depende do serviço integrado</span></footer></section></div>`;
    document.getElementById('queueSearch').oninput=filterQueueRows;if(queueChanged)save('eventQueue');return;
  }
  const filtered=state.logs.filter(l=>logCategory==='geral'||(logCategory==='pedidos'&&/pedido|venda|comanda|mesa/i.test(l.text))||(logCategory==='itens'&&/item|produto/i.test(l.text))||(logCategory==='clientes'&&/cliente|associado|unific/i.test(l.text)));
  const rows = filtered.length ? filtered.map(l=>`<tr data-date="${h(localDay(l.at))}"><td>${new Date(l.at).toLocaleString('pt-BR')}</td><td>${h(l.user)}</td><td>${h(l.text)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="empty">Nenhum evento registrado ainda.</td></tr>`;
  const from=new Date();from.setDate(1);const fromValue=localDay(from);
  el.innerHTML = `<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">Logs</header><div class="op-toolbar"><div class="op-search"><input id="logSearch" placeholder="Pesquisar usuário ou evento..."></div><div class="op-toolbar-spacer"></div><button class="op-btn" onclick="exportLogsCsv()">▧ Exportar CSV</button><button class="op-btn" onclick="window.print()">▣ Imprimir</button></div><div style="display:grid;grid-template-columns:290px 1fr;min-height:520px"><aside style="padding:16px;border-right:1px solid var(--c-border-strong);background:var(--c-surface-2)"><b>Opções de Pesquisa</b><hr><p><b>Período do evento</b></p><div class="grid2" style="gap:8px"><button class="op-btn" onclick="setLogPeriod('today')">Hoje</button><button class="op-btn" onclick="setLogPeriod('yesterday')">Ontem</button><button class="op-btn" onclick="setLogPeriod('previousMonth')">Mês Anterior</button><button class="op-btn" onclick="setLogPeriod('month')">Mês Atual</button></div><div class="field"><label>De</label><input id="logFrom" type="date" value="${fromValue}"></div><div class="field"><label>Até</label><input id="logTo" type="date" value="${todayStr()}"></div><button class="op-btn primary" style="width:100%" onclick="filterLogRows()">⌕ &nbsp; Pesquisar</button></aside><div><div class="record-tabs">${[['pedidos','Pedidos Excluídos'],['itens','Itens de Pedido Excluídos'],['geral','Geral'],['clientes','Clientes Unificados']].map(([id,n])=>`<button class="${logCategory===id?'active':''}" onclick="setLogCategory(${jsArg(id)})">${n}</button>`).join('')}</div><div class="op-grid"><table><thead><tr><th>Data/Hora</th><th>Usuário</th><th>Evento / Motivo</th></tr></thead><tbody id="logRows">${rows}</tbody></table></div></div></div><footer class="op-footer"><span>Registros: ${filtered.length}</span><span>Últimos 300 eventos</span></footer></section></div>`;
  const logSearch=document.getElementById('logSearch');if(logSearch)logSearch.oninput=filterLogRows;
}
function toggleQueueOptions(button){let menu=button.parentElement.querySelector('.pdv-menu');if(menu){menu.remove();return;}menu=document.createElement('div');menu.className='pdv-menu';menu.style.top='48px';menu.innerHTML='<button onclick="exportQueueCsv()">▧ Exportar CSV</button><button onclick="retryAllQueueEvents()">↻ Reprocessar todos</button><button onclick="clearCompletedQueueEvents()">✕ Limpar concluídos</button>';button.parentElement.appendChild(menu);}
function filterQueueRows(){const q=(document.getElementById('queueSearch')?.value||'').trim().toLowerCase(),status=document.getElementById('queueStatus')?.value||'';document.querySelectorAll('#queueRows tr').forEach(r=>{if(r.classList.contains('empty'))return;r.style.display=(!q||r.textContent.toLowerCase().includes(q))&&(!status||r.dataset.status===status)?'':'none';});}
function openQueueEventModal(id){const item=id?state.eventQueue.find(x=>x.id===id):null,local=item&&item.expiresAt?new Date(new Date(item.expiresAt).getTime()-new Date(item.expiresAt).getTimezoneOffset()*60000).toISOString().slice(0,16):'';openModal(item?'Editar Evento':'Novo Evento Local',`<div class="consumer-form-frame"><div class="row"><div class="field"><label>Nome</label><input id="queueName" value="${h(item&&item.name||'')}"></div><div class="field"><label>Tag</label><input id="queueTag" value="${h(item&&item.tag||'')}"></div></div><div class="field"><label>Mensagem</label><textarea id="queueMessage">${h(item&&item.message||'')}</textarea></div><div class="row"><div class="field"><label>Expira em</label><input id="queueExpires" type="datetime-local" value="${local}"></div><div class="field"><label>Status</label><select id="queueEventStatus">${['pendente','falha','concluido','expirado'].map(x=>`<option ${item&&item.status===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="field"><label>Observação</label><input id="queueNote" value="${h(item&&item.note||'')}"></div></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="saveQueueEvent(${jsArg(id||'')})">✓ Salvar</button></div>`);document.querySelector('#modalRoot .modal').classList.add('finance-record-modal');}
function saveQueueEvent(id){const name=document.getElementById('queueName').value.trim(),message=document.getElementById('queueMessage').value.trim(),expires=document.getElementById('queueExpires').value;if(!name||!message){toast('Informe nome e mensagem.');return;}const data={name,tag:document.getElementById('queueTag').value.trim(),message,note:document.getElementById('queueNote').value.trim(),expiresAt:expires?new Date(expires).toISOString():null,status:document.getElementById('queueEventStatus').value},item=state.eventQueue.find(x=>x.id===id);if(item)Object.assign(item,data,{updatedAt:new Date().toISOString()});else state.eventQueue.unshift({id:uid(),at:new Date().toISOString(),attempts:0,...data});save('eventQueue');closeModal();renderLogs();}
function completeQueueEvent(id){const item=state.eventQueue.find(x=>x.id===id);if(!item)return;item.status='concluido';item.completedAt=new Date().toISOString();item.note=item.note||'Concluído manualmente';save('eventQueue');renderLogs();}
function retryQueueEvent(id){const event=state.eventQueue.find(x=>x.id===id);if(!event)return;event.attempts=(Number(event.attempts)||0)+1;event.lastAttemptAt=new Date().toISOString();event.status='pendente';event.note='Aguardando serviço integrado';save('eventQueue');renderLogs();}
function retryAllQueueEvents(){state.eventQueue.forEach(e=>{e.attempts=(Number(e.attempts)||0)+1;e.lastAttemptAt=new Date().toISOString();e.status='pendente';});save('eventQueue');renderLogs();}
function deleteQueueEvent(id){if(!confirm('Excluir este evento da fila?'))return;state.eventQueue=state.eventQueue.filter(x=>x.id!==id);save('eventQueue');renderLogs();}
function clearCompletedQueueEvents(){state.eventQueue=state.eventQueue.filter(x=>x.status!=='concluido');save('eventQueue');renderLogs();}
function exportQueueCsv(){downloadCsvFile('fila-eventos.csv',[['ID','Inserida em','Nome','Tag','Mensagem','Tentativas','Status'],...(state.eventQueue||[]).map(e=>[e.id,e.at,e.name,e.tag,e.message,e.attempts,e.status])]);}
function filterLogRows(){const from=document.getElementById('logFrom')?.value||'',to=document.getElementById('logTo')?.value||'',q=(document.getElementById('logSearch')?.value||'').trim().toLowerCase();document.querySelectorAll('#logRows tr').forEach(r=>{if(r.classList.contains('empty'))return;const iso=r.dataset.date||'',inPeriod=(!from||iso>=from)&&(!to||iso<=to),matches=!q||r.textContent.toLowerCase().includes(q);r.style.display=inPeriod&&matches?'':'none';});}

