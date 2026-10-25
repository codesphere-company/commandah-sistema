/* ============ NFC-e: CONFIGURAÇÃO (t207) ============
   state.settings.nfce = { ambiente: 2|1, serie, autoEmitir, autoImprimir }. A Edge Function "nfce"
   lê ambiente e série daqui; produção ainda exige o secret NFCE_PRODUCAO=liberada no servidor. */
function nfceSettings(){ const c=(state.settings&&state.settings.nfce)||{}; return { ambiente: Number(c.ambiente)===1?1:2, serie: Number(c.serie)>0?Number(c.serie):'', autoEmitir: !!c.autoEmitir, autoImprimir: c.autoImprimir!==false }; }
function openNfceSettings(){
  if(!requirePerm('config-sistema')) return;
  const c = nfceSettings();
  openModal('NFC-e (nota fiscal)', `
    <p class="sub" style="margin-top:0">A nota é emitida pela Brasil NFe, no CNPJ da lanchonete. Os códigos fiscais de cada produto ficam em Produtos › Editar › aba Fiscal.</p>
    <div class="row">
      <div class="field"><label for="nfceAmb">Ambiente</label><select id="nfceAmb"><option value="2" ${c.ambiente===2?'selected':''}>Teste (homologação) — sem valor fiscal</option><option value="1" ${c.ambiente===1?'selected':''}>Produção — nota de verdade</option></select></div>
      <div class="field"><label for="nfceSerie">Série da NFC-e do Commandah</label><input id="nfceSerie" type="number" min="1" max="999" value="${c.serie}" placeholder="definida pelo contador"></div>
    </div>
    <p class="sub">A série precisa ser <b>diferente da do Saipos</b>, porque os dois emitem no mesmo CNPJ durante o piloto. Sem série, a produção não emite. Produção também precisa estar liberada no servidor (proteção contra nota de verdade por engano).</p>
    <label class="comp-switch" style="margin:10px 0"><input type="checkbox" id="nfceAuto" ${c.autoEmitir?'checked':''}><span></span> <b style="font-weight:400">Emitir a NFC-e sozinha ao fechar a comanda (pagamento)</b></label>
    <label class="comp-switch" style="margin:0 0 10px"><input type="checkbox" id="nfceAutoPrint" ${c.autoImprimir?'checked':''}><span></span> <b style="font-weight:400">Imprimir o cupom da NFC-e no caixa quando ela for autorizada</b></label>
    <p class="sub">Desligado, a nota é emitida pelo botão "Emitir NFC-e" no detalhe da comanda (Relatórios › Histórico de Pedidos). Cancelamento: até 30 minutos depois da autorização, no mesmo lugar.</p>
    <button class="btn btn-primary btn-block" id="nfceSaveBtn">Salvar</button>`);
  document.getElementById('nfceSaveBtn').onclick = async ()=>{
    const ambiente = document.getElementById('nfceAmb').value==='1' ? 1 : 2;
    const serieRaw = document.getElementById('nfceSerie').value.trim(), serie = serieRaw ? parseInt(serieRaw,10) : '';
    if(serieRaw && !(serie>=1 && serie<=999)){ toast('A série é um número de 1 a 999.'); return; }
    if(ambiente===1 && !serie){ toast('Para produção, informe a série do Commandah (pedir ao contador).'); return; }
    if(ambiente===1 && c.ambiente!==1){
      const ok = await askConfirm({ title:'Passar a NFC-e para produção?', message:'A partir daqui as notas têm valor fiscal, no CNPJ da lanchonete, na série '+serie+'. Confirme que o contador aprovou os códigos fiscais e a série.', confirmLabel:'Passar para produção', cancelLabel:'Continuar em teste' });
      if(!ok) return;
    }
    state.settings.nfce = { ambiente, serie: serie||null, autoEmitir: document.getElementById('nfceAuto').checked, autoImprimir: document.getElementById('nfceAutoPrint').checked };
    await save('settings');
    logAction('NFC-e: ambiente '+(ambiente===1?'PRODUÇÃO':'teste')+', série '+(serie||'—')+', emissão '+(state.settings.nfce.autoEmitir?'automática':'manual'));
    closeModal(); toast('Configuração da NFC-e salva.');
  };
}
// Depois do pagamento (t207): emite sozinha se estiver ligado, e imprime o cupom no caixa.
async function autoEmitNfce(saleId){
  const c = nfceSettings(); if(!c.autoEmitir) return;
  const sale = state.sales.find(x=>x.id===saleId); if(!nfceCanUse(sale)) return;
  const r = await nfceCall('emitir', saleId);
  if(r.error){
    toast('NFC-e não emitida: '+r.error+((r.problemas||[]).length?' '+r.problemas[0]:'')+' Veja no detalhe da comanda.', 'erro');
    logAction('NFC-e não emitida (pedido '+(sale.orderNumber||saleId)+'): '+r.error);
    return;
  }
  const n = r.nota || {};
  if(n.status==='autorizada'){
    if(c.autoImprimir && n.id) printNfceDanfe(n.id);
  } else {
    toast('A SEFAZ recusou a NFC-e do pedido '+(sale.orderNumber||'')+': '+(n.motivo||'sem motivo')+'. Veja no detalhe da comanda.', 'erro');
    logAction('NFC-e recusada (pedido '+(sale.orderNumber||saleId)+'): '+(n.cod_status||'')+' '+(n.motivo||''));
  }
}
function savePrivacySettings(){
  const anos=Math.max(1,Math.min(20,parseInt(document.getElementById('lgpdAnos').value,10)||2));
  state.settings.privacy={ nome:document.getElementById('lgpdNome').value.trim(), email:document.getElementById('lgpdEmail').value.trim(), anos, atualizado:todayStr() };
  save('settings'); logAction('Privacidade (LGPD): encarregado/prazo atualizados'); toast('Privacidade salva.'); openPrivacySettings();
}
// Acesso/portabilidade: tudo o que o sistema guarda do sócio, num arquivo JSON.
async function exportMemberData(memberId){
  let m=state.members.find(x=>x.id===memberId); if(!m) return;
  try{ m=await MembersStore.refreshOne(memberId)||m; }catch(e){}
  const sales=state.sales.filter(s=>s.memberId===memberId).map(s=>({ pedido:s.orderNumber||s.id, aberto_em:s.openedAt||null, fechado_em:s.closedAt||null, situacao:s.canceled?'cancelado':s.status, total:s.total, itens:(s.items||[]).map(i=>({ produto:i.name, quantidade:i.qty, valor_unitario:i.price, pedido_por:i.requesterName||null, cancelado:!!i.canceled })), pagamentos:(s.payments||[]).map(p=>({ forma:paymentMethodLabel(p.method), valor:p.amount })) }));
  const data={ gerado_em:new Date().toISOString(), estabelecimento:(state.settings&&state.settings.clubName)||'', base_legal:'LGPD art. 18 (acesso e portabilidade)',
    socio:{ nome:m.name, cota:m.code, documento:m.document, registro:m.registry, nascimento:m.birthDate, sexo:m.gender, telefone:m.phone, email:m.email, endereco:{ cep:m.zip, rua:m.address, numero:m.addressNumber, complemento:m.addressComplement, bairro:m.district, cidade:m.city, uf:m.uf, referencia:m.reference }, tags:m.tags, observacoes:m.notes, aceita_campanhas:!!m.marketingOptIn, arquivado:!!m.archived, saldo_fiado:Number(m.debt)||0, pontos:Number(m.points)||0 },
    dependentes:(m.dependents||[]).map(d=>({ nome:d.name, parentesco:d.relationship, documento:d.document })),
    extrato_fiado:(m.debtHistory||[]).map(e=>({ data:e.at, tipo:e.type==='debt'?'débito':e.type==='payment'?'pagamento':e.type, valor:e.value, motivo:e.reason, estornado:!!e.reversed })),
    pontos:(m.pointsHistory||[]).map(e=>({ data:e.at, tipo:e.type, pontos:e.points, motivo:e.reason })),
    consumo:sales };
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})), a=document.createElement('a');
  a.href=url; a.download='dados-'+String(m.name||'socio').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-')+'-'+todayStr()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  logAction('LGPD: dados do sócio exportados (cota '+(m.code||'—')+')');
}
// Eliminação: apaga nome, documento, contatos e dependentes (também nas comandas e pedidos) e
// mantém os valores. Só administrador, com a própria senha; sócio sem saldo e sem comanda aberta.
function anonymizeMember(memberId){
  const m=state.members.find(x=>x.id===memberId); if(!m) return;
  if(!isAdminUser()){ toast('Só o administrador anonimiza cadastro.'); return; }
  if(m.anonymizedAt){ toast('Este cadastro já foi anonimizado.'); return; }
  if(Math.abs(Number(m.debt)||0)>TOLERANCIA_CENTAVO){ toast('Zere o saldo (fiado ou crédito) antes de anonimizar.'); return; }
  if(state.sales.some(s=>s.memberId===memberId && s.status==='open' && !s.canceled)){ toast('Feche a comanda aberta deste sócio antes de anonimizar.'); return; }
  askStaffPin({ title:'Anonimizar '+m.name, message:'Apaga nome, documento, telefone, e-mail, endereço, observações e dependentes deste sócio, inclusive nas comandas e pedidos antigos. Os valores (vendas, fiado, pontos) continuam, sem identificar a pessoa. Não dá para desfazer.', whoLabel:'Quem está alterando', staff:[currentUser], lockWho:true, confirmLabel:'Anonimizar',
    onSubmit: async (staffId, pin)=>{
      if(isCloudMode()){ const r=await staffAuthCall({ action:'verify', staff_id:currentUser.id, pin }); if(r.error) return r.error; }
      else if(String(currentUser.pin||'')!==String(pin)) return 'PIN incorreto.';
      return await doAnonymizeMember(memberId);
    } });
}
async function doAnonymizeMember(memberId){
  const m=state.members.find(x=>x.id===memberId); if(!m) return 'Sócio não encontrado.';
  const tag=memberId.slice(-4).toUpperCase(), newName='Sócio anonimizado '+tag, oldNames=new Set([m.name, ...(m.dependents||[]).map(d=>d.name)].filter(Boolean)), at=new Date().toISOString();
  const blank={ name:newName, code:'', phone:'', email:'', gender:'', document:'', registry:'', birthDate:'', zip:'', address:'', addressNumber:'', addressComplement:'', district:'', city:'', uf:'', reference:'', ibge:'', tags:[], notes:'', marketingOptIn:false };
  try{
    if(isCloudMode()){
      const { error } = await supabaseClient.from('members').update({ ...memberFieldsToRow(blank), latitude:null, longitude:null, geo_status:null, archived:true, archived_at:m.archivedAt||at, anonymized_at:at }).eq('id', memberId);
      if(error) throw error;
    }
    Object.assign(m, blank, { latitude:undefined, longitude:undefined, geoStatus:undefined, archived:true, archivedAt:m.archivedAt||at, anonymizedAt:at });
    await MembersStore.saveDependents(memberId, []);
    if(!isCloudMode()) await save('members');
    const saleIds=[];
    state.sales.forEach(s=>{ if(s.memberId!==memberId) return; saleIds.push(s.id); s.customerName=newName; (s.items||[]).forEach(i=>{ if(i.requesterName && (oldNames.has(i.requesterName) || i.requesterId===memberId)) i.requesterName=newName; }); });
    if(saleIds.length) await save('sales');
    if(isCloudMode() && saleIds.length){ for(let k=0;k<saleIds.length;k+=200){ await supabaseClient.from('orders').update({ who:newName }).in('sale_id', saleIds.slice(k,k+200)); } }
    state.orders.forEach(o=>{ if(saleIds.includes(o.saleId)) o.who=newName; });
  }catch(e){
    console.error('Falha ao anonimizar', e);
    return 'Não foi possível anonimizar agora: '+(e.message||'erro')+'. Tente de novo.';
  }
  logAction('LGPD: cadastro anonimizado ('+newName+')');
  closeModal(); renderAll(); toast('Cadastro anonimizado.');
}

