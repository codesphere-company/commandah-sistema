/* ============ USUÁRIOS ============ */
function renderUsuarios(){
  const el = document.getElementById('view-usuarios');
  const rows = state.users.map(u=>`
    <tr><td>${h(u.name)}</td><td>${h(u.username)}</td><td>${h(u.email||'—')}</td><td>${h(u.phone||'—')}</td><td><span class="tag tag-blue">${h(roleLabel(u.role))}</span>${u.role==='admin'&&pinLengthFor(u)!==6?' <span class="tag tag-amber" title="Redefina o PIN deste administrador para 6 dígitos">PIN de 4 dígitos</span>':''}</td><td>${u.active===false?'<span class="tag tag-gray">Inativo</span>':'<span class="tag tag-green">Ativo</span>'}${u.migratedAuth?' <span class="tag tag-green" title="Login verificado pelo servidor">🔒</span>':' <span class="tag tag-gray" title="Ainda no PIN local — salve o cadastro pra migrar">local</span>'}</td>
    <td><button class="btn btn-sm" onclick="editUser(${jsArg(u.id)})">Editar</button>
    <button class="btn btn-sm btn-danger" onclick="deleteUser(${jsArg(u.id)})">Excluir</button></td></tr>`).join('');
  el.innerHTML = `<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">Colaboradores <span class="op-controls"><span onclick="closeOperationalWindow()" style="cursor:pointer" title="Fechar">×</span></span></header><div class="op-toolbar"><div class="op-search"><input id="userSearch" placeholder="Pesquisar aqui..."></div><div class="op-toolbar-spacer"></div><div class="pdv-menu-wrap"><button class="op-btn" onclick="toggleUserOptions()">••• &nbsp; Opções ▾</button>${userOptionsOpen?`<div class="pdv-menu" style="top:48px;min-width:230px"><button onclick="window.print()">▣ &nbsp; Imprimir</button><button onclick="exportUsersCsv()">⇩ &nbsp; Exportar colaboradores</button><button onclick="openPermissionMatrix()">▦ &nbsp; Perfis e permissões</button><button onclick="openAccessLog()">▤ &nbsp; Histórico de acesso</button>${supabaseClient?`<button onclick="migrateAllStaffAuth()">🔒 &nbsp; Migrar acesso seguro (todos)</button>`:''}</div>`:''}</div><button class="op-btn primary" onclick="openUserModal()"><span class="op-ico">＋</span> Novo</button></div><div class="op-grid"><table><thead><tr><th>Nome</th><th>Usuário</th><th>E-mail</th><th>Telefone</th><th>Perfil</th><th>Situação</th><th>Ações</th></tr></thead><tbody id="userRows">${rows||'<tr><td colspan="7" class="empty">Não há registros para mostrar</td></tr>'}</tbody></table></div><footer class="op-footer"><span>Registros: ${state.users.length}</span><span>Controle de acesso e permissões</span></footer></section></div>`;
  document.getElementById('userSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#userRows tr').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(q)?'':'none');};
}
function toggleUserOptions(){userOptionsOpen=!userOptionsOpen;renderUsuarios();}
function exportUsersCsv(){userOptionsOpen=false;downloadCsvFile('colaboradores.csv',[['Nome','Usuario','Email','Telefone','Perfil','Situacao'],...state.users.map(u=>[u.name,u.username,u.email||'',u.phone||'',roleLabel(u.role),u.active===false?'Inativo':'Ativo'])]);renderUsuarios();}
function openPermissionMatrix(){userOptionsOpen=false;const groups=[['Atendimento',[['Caixa e pedidos','caixa'],['Balcão','balcao'],['Mesas e comandas','comandas'],['Cancelar item/comanda','cancelar-comanda'],['Delivery','delivery'],['Fila de atendimento','fila-atendimento'],['Agendamentos','agendamentos'],['Cardápio digital','cardapio'],['Cozinha','cozinha']]],['Cadastros',[['Clientes','associados'],['Produtos','produtos'],['Insumos','insumos'],['Categorias','categorias'],['Complementos','complementos'],['Observações','observacoes'],['Perguntas','perguntas'],['Fornecedores','fornecedores']]],['Áreas e dispositivos',[['Locais e áreas','locais'],['Quem levou','quemlevou'],['Impressoras','impressoras'],['Estações','estacoes'],['Origens de pedido','origens'],['Acesso mobile (garçom)','mobile-qr']]],['Financeiro e gestão',[['Formas de pagamento','pagamentos'],['Categorias de contas','contascategorias'],['Contas e fiado','contas'],['Receber pagamento de fiado','receber-fiado'],['Relatórios','relatorios'],['Marketing (cupons, fidelidade, SMS)','cupons']]],['Administração',[['Colaboradores','usuarios'],['Configurações','config-sistema'],['Backup','backup'],['Logs e eventos','logs'],['Painel de senhas','painel-senhas'],['Diagnóstico','diagnostico'],['Ajuda','ajuda'],['Módulos e aplicativos','modulos'],['Trocar a própria senha','senha-propria']]]],modules=groups.flatMap(g=>g[1]);openModal('Perfis e Permissões',`<div class="op-toolbar"><span class="op-toolbar-spacer"></span><button class="op-btn" onclick="setPermissionPreset('caixa')">Padrão Caixa</button><button class="op-btn" onclick="setPermissionPreset('cozinha')">Padrão Cozinha</button></div><div class="finance-grid" style="height:440px"><table><thead><tr><th>Grupo / Módulo</th><th>Administrador</th><th>Operador de caixa</th><th>Cozinha</th></tr></thead><tbody>${groups.map(([group,items])=>`<tr><td colspan="4"><b>${h(group)}</b></td></tr>${items.map(([name,key])=>`<tr><td style="padding-left:28px">${name}</td><td style="text-align:center"><input type="checkbox" checked disabled></td>${['caixa','cozinha'].map(role=>`<td style="text-align:center"><input class="permission-choice" type="checkbox" data-role="${role}" value="${key}" ${rolePermissions(role).includes(key)?'checked':''}></td>`).join('')}</tr>`).join('')}`).join('')}</tbody></table></div><p class="sub">As permissões são aplicadas imediatamente à navegação do perfil. O Administrador permanece completo por segurança.</p><div class="consumer-modal-actions"><button class="consumer-back" onclick="closeModal()">〈 Voltar</button><button class="consumer-save" onclick="savePermissionMatrix()">✓ Salvar</button></div>`,true);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');window.permissionMatrixModules=modules;}
function setPermissionPreset(role){document.querySelectorAll(`.permission-choice[data-role="${role}"]`).forEach(input=>input.checked=(ROLE_PERMS[role]||[]).includes(input.value));}
function savePermissionMatrix(){if(!requirePerm('usuarios'))return;state.settings.rolePermissions=state.settings.rolePermissions||{};state.settings.rolePermissionsVersion=2;['caixa','cozinha'].forEach(role=>{state.settings.rolePermissions[role]=[...document.querySelectorAll(`.permission-choice[data-role="${role}"]:checked`)].map(x=>x.value);});save('settings');closeModal();renderAll();logAction('Matriz de permissões atualizada');toast('Permissões salvas.');}
function accessLogEntries(){return(state.logs||[]).filter(x=>/login|logout|acesso|usuário|usuario|senha|pin/i.test(String(x.action||x.message||'')));}
async function openAccessLog(){userOptionsOpen=false;await loadAuditLog();const entries=accessLogEntries(),users=[...new Set(entries.map(x=>x.user||x.userName).filter(Boolean))].sort(),rows=entries.map(x=>{const action=String(x.action||x.message||'Acesso'),status=/incorreto|falha|bloque/i.test(action)?'Falha':/logout|saída|saida/i.test(action)?'Saída':'Sucesso';return `<tr data-access-user="${h(x.user||x.userName||'')}" data-access-status="${status}" data-access-date="${reportDate(x.at||x.createdAt)}"><td>${reportDateTime(x.at||x.createdAt)}</td><td>${h(x.user||x.userName||'—')}</td><td>${h(action)}</td><td><span class="tag ${status==='Falha'?'tag-red':status==='Saída'?'tag-gray':'tag-green'}">${status}</span></td></tr>`}).join('');openModal('Histórico de Acesso',`<div class="op-toolbar"><div class="op-search"><input id="accessLogSearch" placeholder="Pesquisar evento..."></div><select id="accessLogUser" class="op-btn"><option value="">Todos os colaboradores</option>${users.map(u=>`<option>${h(u)}</option>`).join('')}</select><select id="accessLogStatus" class="op-btn"><option value="">Todos os eventos</option><option>Sucesso</option><option>Falha</option><option>Saída</option></select><button class="op-btn" onclick="exportAccessLog()">▧ Exportar CSV</button></div><div class="finance-grid" style="height:410px"><table><thead><tr><th>Data/Hora</th><th>Colaborador</th><th>Evento</th><th>Status</th></tr></thead><tbody id="accessLogRows">${rows||'<tr><td colspan="4" class="empty">Nenhum evento de acesso registrado.</td></tr>'}</tbody></table></div>`,true);const modal=document.querySelector('#modalRoot .modal');modal.classList.add('app-config-modal');['accessLogSearch','accessLogUser','accessLogStatus'].forEach(id=>document.getElementById(id).oninput=filterAccessLog);}
function filterAccessLog(){const q=(document.getElementById('accessLogSearch')?.value||'').toLowerCase(),user=document.getElementById('accessLogUser')?.value||'',status=document.getElementById('accessLogStatus')?.value||'';document.querySelectorAll('#accessLogRows tr[data-access-user]').forEach(row=>row.style.display=(!q||row.textContent.toLowerCase().includes(q))&&(!user||row.dataset.accessUser===user)&&(!status||row.dataset.accessStatus===status)?'':'none');}
function exportAccessLog(){downloadCsvFile('historico-acesso-'+todayStr()+'.csv',[['Data/Hora','Colaborador','Evento'],...accessLogEntries().map(x=>[reportDateTime(x.at||x.createdAt),x.user||x.userName||'',x.action||x.message||'Acesso'])]);logAction('Histórico de acesso exportado');}
function openUserModal(id){
  const u = id ? state.users.find(x=>x.id===id) : null;
  // Colaborador já migrado pro acesso seguro: o PIN existe só como hash (bcrypt) no servidor.
  // Nunca trazemos PIN em texto puro pro formulário — campo vazio = "mantém o PIN atual",
  // campo preenchido = "troca o PIN". Quem ainda não migrou continua como sempre foi.
  const isMigrated = !!(u && u.migratedAuth);
  openModal(u?'Editar Colaborador':'Novo Colaborador', `<div class="record-body"><div class="record-tabs"><button data-tab="principal" class="active" onclick="setProductModalTab('principal')">Dados Principais</button><button data-tab="acesso" onclick="setProductModalTab('acesso')">Acesso e Permissões</button></div><section class="record-pane active" data-pane="principal">
    <div class="field"><label>Nome completo</label><input id="uName" value="${h(u?u.name:'')}"></div><div class="row"><div class="field"><label>E-mail</label><input id="uEmail" type="email" value="${h(u?u.email||'':'')}"></div><div class="field"><label>Telefone</label><input id="uPhone" value="${h(u?u.phone||'':'')}"></div></div></section><section class="record-pane" data-pane="acesso"><div class="row">
      <div class="field"><label>Usuário (login)</label><input id="uUsername" value="${h(u?u.username:'')}"></div>
      <div class="field"><label>PIN (4 dígitos; administrador: 6)</label><input id="uPin" inputmode="numeric" maxlength="6" autocomplete="off" value="${isMigrated?'':h(u?u.pin:'')}" placeholder="${isMigrated?'Manter atual':''}"></div>
    </div>
    ${isMigrated?'<p class="sub">🔒 O PIN deste colaborador é verificado pelo servidor e não fica guardado aqui. Deixe o campo em branco pra manter o PIN atual — preencha só se quiser definir um PIN novo.</p>':''}
    <div class="field"><label>Perfil</label><select id="uRole">
      <option value="admin" ${u&&u.role==='admin'?'selected':''}>Administrador</option>
      <option value="caixa" ${u&&u.role==='caixa'?'selected':''}>Operador de caixa</option>
      <option value="cozinha" ${u&&u.role==='cozinha'?'selected':''}>Cozinha</option>
    </select></div>
    <div class="field"><label>Origem dos pedidos deste usuário</label><select id="uOrigem" onchange="document.getElementById('uCaixaPrinterBox').style.display=this.value!=='app'?'block':'none'">
      ${state.origens.map(o=>`<option value="${h(o.chave)}" ${(u&&u.origem===o.chave)||(!u&&o.chave==='caixa')?'selected':''}>${h(o.nome)}</option>`).join('')}
    </select><p class="sub">Define para qual impressora o pedido vai quando esse usuário confirma um "Novo Pedido" (bar e churrasqueira têm impressoras diferentes por origem). Cadastre novas origens em Configurações → Áreas do Clube → Origens de Pedido.</p></div>
    <div class="field" id="uCaixaPrinterBox" style="display:${!u||u.origem!=='app'?'block':'none'}"><label>Impressora local deste usuário (nome exato no Windows)</label><input id="uCaixaPrinter" value="${h(u?u.caixaPrinterOsName||'':'')}" placeholder="Ex: POS-80C (Caixa 1)"><p class="sub">Se este usuário fica num ponto fixo com impressora própria (caixa, totem etc.), informe o nome exato dela. Toda venda de balcão feita por este usuário imprime automaticamente aqui, além de ir pra cozinha/bar/churrasqueira normalmente.</p></div>
    <label class="item-line"><span>Colaborador ativo</span><input id="uActive" type="checkbox" ${!u||u.active!==false?'checked':''}></label><p class="sub">O perfil define quais módulos podem ser acessados. O PIN é usado para entrar e trocar de operador.</p></section><div class="record-actions"><button class="op-btn" onclick="closeModal()">Voltar</button><button class="op-btn primary" id="uSaveBtn">Salvar e Voltar</button></div></div>`,true);
  document.querySelector('#modalRoot .modal').classList.add('record-modal');
  document.getElementById('uSaveBtn').onclick = async ()=>{
    const name = document.getElementById('uName').value.trim();
    const username = document.getElementById('uUsername').value.trim();
    const pin = document.getElementById('uPin').value.trim();
    // PIN só é obrigatório pra colaborador novo ou pra quem ainda não migrou.
    // Migrado com campo vazio = mantém o PIN que já está no servidor.
    const changingPin = !isMigrated || pin!=='';
    if(!name || !username){ toast('Preencha nome e usuário.'); return; }
    const pinLen = document.getElementById('uRole').value==='admin' ? 6 : 4;
    if(changingPin && !validPin(pin, pinLen)){ toast(pinLen===6?'Administrador precisa de um PIN numérico de 6 dígitos.':'Informe um PIN numérico de 4 dígitos.'); return; }
    const data = { name, username, role:document.getElementById('uRole').value, origem:document.getElementById('uOrigem').value, caixaPrinterOsName:document.getElementById('uCaixaPrinter').value.trim(), email:document.getElementById('uEmail').value.trim(), phone:document.getElementById('uPhone').value.trim(), active:document.getElementById('uActive').checked };
    if(changingPin){ data.pin = pin; data.pinLength = pin.length; }
    if(state.users.some(x=>x.id!==(u&&u.id)&&String(x.username).toLowerCase()===username.toLowerCase())){toast('Já existe um colaborador com este usuário.');return;}
    if(u&&u.id===currentUser.id&&!data.active){toast('Você não pode desativar o colaborador atualmente conectado.');return;}
    if(u&&u.role==='admin'&&(!data.active||data.role!=='admin')&&!state.users.some(x=>x.id!==u.id&&x.role==='admin'&&x.active!==false)){toast('Mantenha ao menos um administrador ativo.');return;}
    const id = u ? u.id : uid();
    await syncStaffAuth(id, u, data);
    // O blob app_data do tenant é legível por QUALQUER operador autenticado (a RLS isola por
    // tenant, não por papel). Então, assim que o servidor passa a validar o PIN, ele não pode
    // sobreviver aqui em texto puro — senão um caixa lê o PIN do admin e loga como admin.
    // SEG-08: na nuvem o PIN nunca fica em texto no cadastro (legível por todo operador). Se a conta
    // segura não foi criada agora, o login fica barrado até o admin salvar de novo com o PIN.
    if(data.migratedAuth || isCloudMode()) delete data.pin;
    if(u){ Object.assign(u,data); if(u.migratedAuth) delete u.pin; } else { state.users.push({id, ...data}); }
    save('users'); closeModal(); renderAll(); toast('Usuário salvo.');
  };
}
// Mantém a conta de acesso real (Edge Function staff-auth) alinhada com o cadastro local.
// Sem Supabase (modo local) ou sem sessão, só grava localmente como sempre — nada quebra.
async function syncStaffAuth(id, existing, data){
  if(!supabaseClient) return;
  const isMigrated = !!(existing && existing.migratedAuth);
  // Antes se comparava existing.pin!==data.pin pra saber se o PIN mudou — era isso que
  // obrigava a manter o PIN em texto puro no cadastro local. Agora quem manda é o formulário:
  // em colaborador migrado, só mexe no PIN do servidor se o admin digitou um PIN novo.
  const needsCreateOrReset = !isMigrated || !!data.pin;
  if(needsCreateOrReset){
    const action = isMigrated ? 'reset_pin' : 'create_operator';
    try{
      const { data: fnData, error } = await supabaseClient.functions.invoke('staff-auth', { body:{ action, staff_id:id, name:data.name, role:data.role, pin:data.pin } });
      if(error || !fnData || fnData.error) toast('Não foi possível criar o acesso deste colaborador agora ('+((fnData&&fnData.error)||'sem conexão')+'). O cadastro foi salvo sem o PIN: abra de novo e salve com o PIN para liberar o login.','erro');
      else data.migratedAuth = true;
    }catch(e){ toast('Não foi possível criar o acesso deste colaborador agora. O cadastro foi salvo sem o PIN: abra de novo e salve com o PIN para liberar o login.','erro'); }
  } else {
    data.migratedAuth = true;
  }
  if(existing && existing.migratedAuth && (existing.active!==false) !== (data.active!==false)){
    try{ await supabaseClient.functions.invoke('staff-auth', { body:{ action:'set_active', staff_id:id, active:data.active!==false } }); }catch(e){}
  }
}
async function migrateAllStaffAuth(){
  userOptionsOpen=false;
  if(!supabaseClient){ toast('Disponível só no modo nuvem (Supabase).'); return; }
  const pending = state.users.filter(u=>!u.migratedAuth);
  if(!pending.length){ toast('Todos os colaboradores já estão com acesso seguro.'); renderUsuarios(); return; }
  if(!confirm(`Migrar ${pending.length} colaborador(es) pro acesso seguro agora? Não muda os PINs — só passa a validá-los pelo servidor.`)) return;
  let ok=0, fail=0;
  for(const u of pending){
    try{
      const { data: fnData, error } = await supabaseClient.functions.invoke('staff-auth', { body:{ action:'create_operator', staff_id:u.id, name:u.name, role:u.role, pin:u.pin, legacy_migration:true } });
      // Migrou: o PIN passa a viver como hash no servidor e sai do cadastro local,
      // que é legível por qualquer operador do tenant.
      if(error || !fnData || fnData.error) fail++; else { u.migratedAuth = true; delete u.pin; ok++; }
    }catch(e){ fail++; }
  }
  await save('users'); renderUsuarios();
  toast(`Migração concluída: ${ok} colaborador(es) migrado(s)`+(fail?`, ${fail} falharam (tente de novo depois)`:'.'));
}
function editUser(id){ openUserModal(id); }
function deleteUser(id){
  if(state.users.length<=1){ toast('É preciso manter ao menos um usuário.'); return; }
  if(id===currentUser.id){ toast('Você não pode excluir o usuário com que está logado.'); return; }
  if(!confirm('Excluir este usuário?')) return;
  state.users = state.users.filter(u=>u.id!==id); save('users'); renderAll();
}

