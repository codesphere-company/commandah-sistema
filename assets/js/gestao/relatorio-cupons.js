/* ============ RELATÓRIO: CUPONS FISCAIS ============ */
// 10/11 (pedido do dono): lista das NFC-e de produção e pacote .zip para a contabilidade, com planilha e XMLs
// (necessários para o cálculo de imposto). Notas de homologação nunca entram. O XML só é buscado ao exportar.
// Rejeitadas e erros vão só na planilha, pois não têm valor fiscal.
const JSZIP_SRC='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', JSZIP_SRI='sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG';
function loadJsZip(){
  if(window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve,reject)=>{ const sc=document.createElement('script'); sc.src=JSZIP_SRC; sc.integrity=JSZIP_SRI; sc.crossOrigin='anonymous'; sc.onload=()=>resolve(window.JSZip); sc.onerror=()=>reject(new Error('não foi possível carregar o gerador de arquivos (sem internet?)')); document.head.appendChild(sc); });
}
const FISCAL_NOTE_COLS='id,sale_id,status,numero,serie,chave,protocolo,cod_status,motivo,valor,created_at,created_by,cancelada_em,cancel_protocolo,cancel_motivo,cancelada_por';
const FISCAL_STATUS_LABEL={autorizada:'Autorizada',cancelada:'Cancelada',rejeitada:'Rejeitada',erro:'Erro'};
const fiscalNotesFilter={from:'',to:'',status:'',rows:null,loading:false,error:'',notice:''};
function fiscalPeriod(){ const f=fiscalNotesFilter, from=f.from||reportMonthStart(), to=f.to||todayStr(); return { from, to, start:new Date(from+'T00:00:00').toISOString(), end:new Date(new Date(to+'T00:00:00').getTime()+86400000).toISOString() }; }
function fiscalNotesQuery(cols){ const p=fiscalPeriod(); return ()=>supabaseClient.from('nfce_notas').select(cols).eq('tenant_id',storageApi.tenantId).eq('ambiente',1).gte('created_at',p.start).lt('created_at',p.end).order('created_at',{ascending:false}); }
async function loadFiscalNotes(){
  const f=fiscalNotesFilter; f.loading=true; f.error=''; renderFiscalNotesReport(true);
  try{ f.rows=isCloudMode()?await fetchAllRows(fiscalNotesQuery(FISCAL_NOTE_COLS)):[]; }
  catch(e){ f.rows=[]; f.error='Não foi possível carregar: '+(e.message||'erro'); }
  f.loading=false; renderFiscalNotesReport(true);
}
function applyFiscalNotesFilter(){ const v=id=>document.getElementById(id), f=fiscalNotesFilter; f.from=v('fnFrom').value; f.to=v('fnTo').value; f.status=v('fnStatus').value; f.notice=''; loadFiscalNotes(); }
// A nota cancelada guarda em motivo o texto da autorização da SEFAZ: o que explica o cancelamento é cancel_motivo.
function fiscalNoteReason(n){ return n.status==='cancelada'?(n.cancel_motivo||''):n.status==='autorizada'?'':(n.motivo||''); }
function fiscalPackageNotice(semXml,total){ return semXml?(semXml===1?'1 nota ficou sem XML guardado e não entrou no pacote.':semXml+' notas ficaram sem XML guardado e não entraram no pacote.')+' Baixe no portal da Brasil NFe.':'Pacote gerado com '+total+' nota'+(total===1?'':'s')+'.'; }
function fiscalOrderNumber(n){ const s=state.sales.find(x=>x.id===n.sale_id); return s&&s.orderNumber?String(s.orderNumber):String(n.sale_id||'—'); }
function renderFiscalNotesReport(fromLoad){
  const el=document.getElementById('view-relatorios'); if(!el) return;
  const f=fiscalNotesFilter; if(!fromLoad&&f.rows===null&&!f.loading){ loadFiscalNotes(); return; }
  const p=fiscalPeriod(), todas=f.rows||[], rows=todas.filter(n=>!f.status||n.status===f.status), aut=todas.filter(n=>n.status==='autorizada');
  const filtros=`<div class="field"><label for="fnFrom">De</label><input id="fnFrom" type="date" value="${h(p.from)}"></div><div class="field"><label for="fnTo">Até</label><input id="fnTo" type="date" value="${h(p.to)}"></div><div class="field"><label for="fnStatus">Situação</label><select id="fnStatus"><option value="">Todas</option>${Object.keys(FISCAL_STATUS_LABEL).map(k=>`<option value="${k}" ${k===f.status?'selected':''}>${FISCAL_STATUS_LABEL[k]}</option>`).join('')}</select></div><button class="op-btn primary" onclick="applyFiscalNotesFilter()">⌕ &nbsp; Pesquisar</button><button class="op-btn" id="fnExport" onclick="exportFiscalPackage()">▧ &nbsp; Exportar para a contabilidade</button>`;
  const linhas=rows.map(n=>`<tr><td>${h(n.numero==null?'—':String(n.numero))}</td><td>${h(n.serie==null?'—':String(n.serie))}</td><td>${h(reportWhen(n.created_at))}</td><td>#${h(fiscalOrderNumber(n))}</td><td class="mono">${fmt(Number(n.valor)||0)}</td><td>${h(FISCAL_STATUS_LABEL[n.status]||n.status||'—')}${fiscalNoteReason(n)?`<small class="det-small">${h(fiscalNoteReason(n))}</small>`:''}</td><td class="mono det-chave">${h(n.chave||'—')}</td><td>${n.status==='autorizada'?`<button class="op-btn" onclick="printNfceDanfe(${jsArg(n.id)})">Reimprimir</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhuma nota nesse período.</td></tr>';
  el.innerHTML=detReportHtml('Cupons Fiscais','',filtros,
    f.loading?'<p class="empty">Carregando…</p>':f.error?`<p class="empty">${h(f.error)}</p>`:
    detStatsHtml([['Autorizadas',aut.length],['Valor autorizado',fmt(aut.reduce((a,n)=>a+(Number(n.valor)||0),0))],['Rejeitadas ou com erro',todas.filter(n=>n.status==='rejeitada'||n.status==='erro').length]])+
    (f.notice?`<p class="det-aviso">${h(f.notice)}</p>`:'')+
    `<div class="finance-grid det-grid"><table><thead><tr><th>Número</th><th>Série</th><th>Data e hora</th><th>Pedido</th><th>Valor</th><th>Situação</th><th>Chave</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`);
}
function fiscalSheetRows(notas){
  return [['Número','Série','Data e hora','Pedido','Valor','Situação','Motivo','Chave','Protocolo','Cancelada em','Protocolo do cancelamento','Motivo do cancelamento','Emitida por'],
    ...notas.map(n=>[n.numero==null?'':n.numero,n.serie==null?'':n.serie,reportWhen(n.created_at),fiscalOrderNumber(n),arredondaCentavos(Number(n.valor)||0),FISCAL_STATUS_LABEL[n.status]||n.status||'',n.status==='cancelada'?'':fiscalNoteReason(n),n.chave||'',n.protocolo||'',reportValidDate(n.cancelada_em)?reportWhen(n.cancelada_em):'',n.cancel_protocolo||'',n.cancel_motivo||'',n.created_by||''])];
}
function fiscalPackageFiles(notas, planilha){
  const files=[{path:'notas.xlsx',content:planilha}]; let semXml=0, canceladaSemEvento=false;
  notas.forEach(n=>{
    if(n.status!=='autorizada'&&n.status!=='cancelada') return;
    if(n.xml) files.push({path:(n.status==='autorizada'?'autorizadas/':'canceladas/')+(n.chave||n.id)+'.xml',content:n.xml}); else semXml++;
    if(n.status==='cancelada') canceladaSemEvento=true;
  });
  if(canceladaSemEvento) files.push({path:'canceladas/LEIA-ME.txt',content:'Estas notas foram canceladas: não contam como venda.\r\nO XML do evento de cancelamento deve ser baixado no portal da Brasil NFe.\r\nO protocolo de cada cancelamento está na planilha notas.xlsx.\r\n'});
  return { files, semXml };
}
async function exportFiscalPackage(){
  // Usa as datas que estão nos campos, mesmo sem clicar em Pesquisar: o pacote vai para o contador.
  const f=fiscalNotesFilter, de=document.getElementById('fnFrom'), ate=document.getElementById('fnTo'), antes=fiscalPeriod();
  if(de&&de.value) f.from=de.value; if(ate&&ate.value) f.to=ate.value;
  const p=fiscalPeriod(), mudou=p.from!==antes.from||p.to!==antes.to, btn=document.getElementById('fnExport');
  if(p.from>p.to){ toast('Escolha um período válido.'); return; }
  if(btn) btn.disabled=true;
  try{
    const notas=isCloudMode()?await fetchAllRows(fiscalNotesQuery(FISCAL_NOTE_COLS+',xml')):[];
    if(!notas.length){ if(mudou){ f.rows=[]; f.notice=''; renderFiscalNotesReport(true); } toast('Nenhuma nota nesse período.'); return; }
    const [XLSX,JSZip]=await Promise.all([loadXlsx(),loadJsZip()]), wb=XLSX.utils.book_new(), ws=XLSX.utils.aoa_to_sheet(fiscalSheetRows(notas));
    ws['!cols']=[8,6,19,9,11,12,34,48,18,19,20,34,16].map(w=>({wch:w})); XLSX.utils.book_append_sheet(wb,ws,'Notas');
    const pacote=fiscalPackageFiles(notas,XLSX.write(wb,{type:'array',bookType:'xlsx'})), zip=new JSZip();
    pacote.files.forEach(a=>zip.file(a.path,a.content));
    const url=URL.createObjectURL(await zip.generateAsync({type:'blob'})), a=document.createElement('a');
    a.href=url; a.download='commandah-nfce-'+p.from+'-a-'+p.to+'.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
    logAction('Pacote de NFC-e para a contabilidade gerado: '+p.from+' a '+p.to);
    f.notice=fiscalPackageNotice(pacote.semXml,notas.length);
    if(mudou||f.rows===null) f.rows=notas.map(({xml,...resto})=>resto);
    renderFiscalNotesReport(true); toast('Pacote gerado.');
  }catch(e){ console.error(e); toast('Não foi possível gerar: '+(e.message||e),'error'); }
  finally{ const b=document.getElementById('fnExport'); if(b) b.disabled=false; }
}
