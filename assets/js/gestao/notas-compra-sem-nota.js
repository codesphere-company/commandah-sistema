/* ============ NOTAS DE COMPRA — COMPRA SEM NOTA ============ */
// t-semnota (27/11/2026): fornecedor que não emite nota (feirante, produtor, padaria do bairro). A pessoa lança a
// compra à mão (fornecedor, data, itens com quantidade e valor, foto do recibo) e ela entra na lista de Notas de
// compra com a etiqueta "Sem nota". Depois segue igual a uma nota: abrir, escolher o destino de cada item (lembrado
// por fornecedor + nome do item), Confirmar (conferida, contas a pagar, estoque), escritório, desfazer.
// Desenho: docs/superpowers/specs/2026-11-27-compra-sem-nota-design.md. Banco: notas_entrada_sem_nota_salvar e
// notas_entrada_sem_nota_excluir (migration 20261128030000_compra_sem_nota.sql).
// Fornecedor: o blob cantina2:fornecedores só o administrador grava. Administrador escolhe ou cria na hora; quem só
// tem "insumos" escolhe da lista ou digita o nome, e o cadastro é criado com o mesmo id no Pagamento
// (ncnPagamento, gestao/notas-compra-nota.js), para os vínculos continuarem valendo.
let compraSemNota = null; // { chave|null, fornecedorId, novo:{nome,documento,fone}, numero, data, itens:[{nome,unidade,qtd,valor}], recibo, reciboMudou, temReciboAntigo }

const CSN_UNIDADES = ['UN','KG','G','L','ML','CX','PCT','DZ','MAÇO','FD','SC','BD'];
const CSN_RECIBO_MAX = 650000; // caracteres do data URL (o banco aceita até 700 mil)
// Valor em reais: "1.234,56" e "12,50" no jeito brasileiro; "12.50" (ponto sozinho) também vale como decimal.
const csnNum = v => { let t = String(v==null?'':v).trim().replace(/[R$\s]/g,''); t = t.includes(',') ? t.replace(/\./g,'').replace(',','.') : t; const x = parseFloat(t); return isFinite(x) ? x : 0; };
const csnNumSimples = v => { const x = parseFloat(String(v==null?'':v).replace(',','.')); return isFinite(x) ? x : 0; };
// Código do item no vínculo: o nome sem acento, minúsculo e com um espaço só ("Tomate  Italiano" = "tomate italiano").
function csnCodigo(nome){ return String(nome||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim().slice(0,120); }
function csnItemVazio(){ return { nome:'', unidade:'UN', qtd:'', valor:'' }; }

// Fornecedores da lista: os do cadastro e os que já apareceram em compra sem nota (quem não grava fornecedores
// também acha o feirante da semana passada).
function csnFornecedores(){
  const lista = (state.fornecedores||[]).map(f=>({ id:f.id, nome:f.nome||f.razaoSocial||'Sem nome', documento:ncSoDigitos(f.documento) }));
  ((notasCompraDados && notasCompraDados.notas) || []).forEach(n=>{
    if(ncSemNota(n) && n.fornecedor_id && !lista.some(f=>f.id===n.fornecedor_id)) lista.push({ id:n.fornecedor_id, nome:n.emitente_nome||'Fornecedor', documento:n.emitente_cnpj||'' });
  });
  return lista.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
}
function csnUltimaDoFornecedor(fid){
  if(!fid || !notasCompraDados) return null;
  return notasCompraDados.notas.filter(n=>ncSemNota(n) && n.fornecedor_id===fid && n.chave!==(compraSemNota && compraSemNota.chave))
    .sort((a,b)=>String(b.emissao||'').localeCompare(String(a.emissao||'')))[0] || null;
}

function abrirCompraSemNota(chave){
  if(!notasCompraPodeImportar()){ toast('Sem permissão para lançar compra.'); return; }
  const n = chave ? ncnNota(chave) : null;
  if(chave && (!n || !ncSemNota(n) || !n.dados)){ toast('Compra não encontrada. Atualize a lista.'); return; }
  if(n){
    const d = n.dados;
    compraSemNota = { chave, fornecedorId:n.fornecedor_id || '', novo:{ nome:'', documento:'', fone:'' }, numero:d.numero||'', data:String(d.emissao||'').slice(0,10) || todayStr(),
      itens:(d.itens||[]).map(it=>({ nome:it.nome, unidade:it.unidade||'UN', qtd:String(it.qtd).replace('.',','), valor:Number(it.custoTotal||0).toFixed(2).replace('.',',') })),
      recibo:null, reciboMudou:false, temReciboAntigo:!!n.recibo };
  } else {
    compraSemNota = { chave:null, fornecedorId:'', novo:{ nome:'', documento:'', fone:'' }, numero:'', data:todayStr(), itens:[csnItemVazio(), csnItemVazio(), csnItemVazio()], recibo:null, reciboMudou:false, temReciboAntigo:false };
  }
  notasCompraSecao = 'semnota';
  notasCompraDesenhar();
  const el = document.getElementById('view-notascompra'); if(el) el.scrollTop = 0;
  const f = document.getElementById('csnForn'); if(f) f.focus();
}

function csnTotal(){ return (compraSemNota ? compraSemNota.itens : []).reduce((s,it)=>s+csnNum(it.valor),0); }
function compraSemNotaHtml(){
  const C = compraSemNota;
  const voltar = `<button type="button" class="cc-voltar" onclick="${C && C.chave ? `abrirNotaCompra(${jsArg(C.chave)})` : `notasCompraAbrir('')`}">${ICN.chevLeft}${C && C.chave ? 'Voltar à compra' : 'Notas de compra'}</button>`;
  if(!C) return `<div class="hub-trilha">${voltar}<h2>Compra sem nota</h2></div><div class="hub-corpo"><p class="hub-vazio">Nada aberto.</p></div>`;
  const forns = csnFornecedores(), novo = C.fornecedorId==='__novo';
  const opcoes = `<option value="">Escolha o fornecedor</option>${forns.map(f=>`<option value="${h(f.id)}" ${f.id===C.fornecedorId?'selected':''}>${h(f.nome)}${f.documento?' · '+h(f.documento):''}</option>`).join('')}<option value="__novo" ${novo?'selected':''}>+ Fornecedor novo</option>`;
  const ultima = !novo && !C.chave ? csnUltimaDoFornecedor(C.fornecedorId) : null;
  const linhas = C.itens.map((it,i)=>`<div class="csn-item" data-i="${i}">
      <div class="field csn-nome"><label for="csnNome-${i}">Item</label><input id="csnNome-${i}" maxlength="120" autocomplete="off" list="csnSugestoes" value="${h(it.nome)}" placeholder="ex.: Tomate" oninput="csnItem(${i},'nome',this.value)"></div>
      <div class="field csn-qtd"><label for="csnQtd-${i}">Quantidade</label><input id="csnQtd-${i}" inputmode="decimal" autocomplete="off" value="${h(it.qtd)}" placeholder="0" oninput="csnItem(${i},'qtd',this.value)"></div>
      <div class="field csn-un"><label for="csnUn-${i}">Unidade</label><select id="csnUn-${i}" onchange="csnItem(${i},'unidade',this.value)">${CSN_UNIDADES.map(u=>`<option ${u===it.unidade?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="field csn-valor"><label for="csnValor-${i}">Valor total (R$)</label><input id="csnValor-${i}" inputmode="decimal" autocomplete="off" value="${h(it.valor)}" placeholder="0,00" oninput="csnItem(${i},'valor',this.value)"></div>
      <button type="button" class="op-btn csn-tirar" aria-label="Tirar o item ${i+1}" title="Tirar este item" onclick="csnTirarItem(${i})"><span class="b-ic" aria-hidden="true">${ICN.x}</span></button></div>`).join('');
  // Sugestões de nome: itens já lançados para este fornecedor e os insumos cadastrados.
  const sugestoes = [...new Set([...((notasCompraDados && notasCompraDados.notas) || []).filter(n=>ncSemNota(n) && n.fornecedor_id===C.fornecedorId && n.dados)
    .flatMap(n=>(n.dados.itens||[]).map(it=>it.nome)), ...(state.insumos||[]).map(i=>i.name)].filter(Boolean))].slice(0,300);
  const recibo = C.recibo ? `<img class="ncn-recibo" src="${h(C.recibo)}" alt="Foto do recibo escolhida"><button type="button" class="op-btn" onclick="csnTirarRecibo()">Tirar a foto</button>`
    : C.temReciboAntigo && !C.reciboMudou ? `<p class="sub">A foto que já estava fica. Escolha outra para trocar.</p><button type="button" class="op-btn" onclick="csnTirarRecibo()">Tirar a foto</button>` : '';
  return `<div class="hub-trilha">${voltar}<h2>${C.chave ? 'Corrigir compra sem nota' : 'Compra sem nota'}</h2></div>
    <div class="hub-corpo csn">
      <p class="sub">Para fornecedor que não emite nota. Depois de salvar, a compra abre para você escolher o destino de cada item e tocar em Confirmar, como numa nota.</p>
      <section class="csn-bloco"><h3>Fornecedor e data</h3><div class="csn-linha">
        <div class="field csn-forn"><label for="csnForn">Fornecedor</label><select id="csnForn" onchange="csnFornecedor(this.value)">${opcoes}</select></div>
        <div class="field csn-data"><label for="csnData">Data da compra</label><input id="csnData" type="date" value="${h(C.data)}" max="${todayStr()}" onchange="compraSemNota.data=this.value"></div>
        <div class="field csn-num"><label for="csnNumero">Nº do recibo (opcional)</label><input id="csnNumero" maxlength="30" autocomplete="off" value="${h(C.numero)}" oninput="compraSemNota.numero=this.value"></div></div>
        ${novo ? `<div class="csn-linha csn-novo">
          <div class="field csn-forn"><label for="csnNovoNome">Nome do fornecedor</label><input id="csnNovoNome" maxlength="120" autocomplete="off" value="${h(C.novo.nome)}" placeholder="ex.: Seu João da feira" oninput="compraSemNota.novo.nome=this.value"></div>
          <div class="field csn-data"><label for="csnNovoDoc">CPF ou CNPJ (opcional)</label><input id="csnNovoDoc" inputmode="numeric" maxlength="18" autocomplete="off" value="${h(C.novo.documento)}" oninput="compraSemNota.novo.documento=this.value"></div>
          <div class="field csn-num"><label for="csnNovoFone">Telefone (opcional)</label><input id="csnNovoFone" inputmode="tel" maxlength="30" autocomplete="off" value="${h(C.novo.fone)}" oninput="compraSemNota.novo.fone=this.value"></div></div>` : ''}
      </section>
      <section class="csn-bloco"><div class="csn-cab-itens"><h3>Itens</h3>${ultima ? `<button type="button" class="op-btn" id="csnRepetir" onclick="csnRepetirUltima()">Usar os itens da última compra (${h(ncData(ultima.emissao))})</button>` : ''}</div>
        <div class="csn-itens">${linhas}</div>
        <datalist id="csnSugestoes">${sugestoes.map(x=>`<option value="${h(x)}"></option>`).join('')}</datalist>
        <div class="csn-rodape"><button type="button" class="op-btn" onclick="csnMaisItem()"><span class="b-ic" aria-hidden="true">${ICN.plus}</span> Adicionar item</button>
          <span class="csn-total">Total <b class="mono" id="csnTotal">${fmt(csnTotal())}</b></span></div>
      </section>
      <section class="csn-bloco"><h3>Foto do recibo (opcional)</h3>
        <div class="csn-recibo"><label class="op-btn csn-foto"><input type="file" id="csnFoto" accept="image/*" capture="environment" hidden onchange="csnEscolherFoto(this)">${C.recibo || C.temReciboAntigo ? 'Trocar a foto' : 'Tirar ou escolher a foto'}</label>${recibo}</div>
      </section>
      <div class="ncn-acoes"><button type="button" class="btn btn-primary hub-acao" id="csnSalvar" onclick="compraSemNotaSalvar()">${C.chave ? 'Salvar correção' : 'Salvar e conferir'}</button></div>
    </div>`;
}

function csnFornecedor(v){
  compraSemNota.fornecedorId = String(v||'');
  notasCompraDesenhar();
  const alvo = document.getElementById(v==='__novo' ? 'csnNovoNome' : 'csnNome-0'); if(alvo) alvo.focus();
}
// Digitar não redesenha (o foco ficaria perdido): só guarda e atualiza o total.
function csnItem(i, campo, valor){
  const it = compraSemNota && compraSemNota.itens[i]; if(!it) return;
  it[campo] = String(valor==null?'':valor);
  if(campo==='valor'){ const t = document.getElementById('csnTotal'); if(t) t.textContent = fmt(csnTotal()); }
}
function csnMaisItem(){
  if(compraSemNota.itens.length>=200){ toast('Uma compra aceita até 200 itens.'); return; }
  compraSemNota.itens.push(csnItemVazio()); notasCompraDesenhar();
  const el = document.getElementById('csnNome-'+(compraSemNota.itens.length-1)); if(el) el.focus();
}
function csnTirarItem(i){
  compraSemNota.itens.splice(i,1);
  if(!compraSemNota.itens.length) compraSemNota.itens.push(csnItemVazio());
  notasCompraDesenhar();
}
async function csnRepetirUltima(){
  const n = csnUltimaDoFornecedor(compraSemNota.fornecedorId); if(!n) return;
  if(!await ncnLerDados(n.chave)){ toast(NC_FORA_DO_AR, 'error'); return; }
  const m = ncnNota(n.chave), itens = (m && m.dados && m.dados.itens) || [];
  if(!itens.length){ toast('A última compra não tem itens.'); return; }
  // Repete nome e unidade; quantidade e valor ficam em branco (mudam toda semana).
  compraSemNota.itens = itens.map(it=>({ nome:it.nome, unidade:CSN_UNIDADES.includes(it.unidade) ? it.unidade : 'UN', qtd:'', valor:'' }));
  notasCompraDesenhar();
  const el = document.getElementById('csnQtd-0'); if(el) el.focus();
}

// Foto do recibo: reduzida aqui mesmo (lado maior até 1280 px, JPEG), para caber no banco e não pesar no egress.
function csnReduzirFoto(arquivo){
  return new Promise((ok, falha)=>{
    const leitor = new FileReader();
    leitor.onerror = ()=>falha(new Error('leitura'));
    leitor.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>falha(new Error('imagem'));
      img.onload = ()=>{
        for(const [lado, q] of [[1280,.72],[1024,.6],[800,.5]]){
          const k = Math.min(1, lado/Math.max(img.width, img.height));
          const cv = document.createElement('canvas'); cv.width = Math.round(img.width*k); cv.height = Math.round(img.height*k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          const url = cv.toDataURL('image/jpeg', q);
          if(url.length<=CSN_RECIBO_MAX && url.startsWith('data:image/jpeg;base64,')){ ok(url); return; }
        }
        falha(new Error('grande'));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}
async function csnEscolherFoto(input){
  const f = input && input.files && input.files[0]; if(!f) return;
  if(!/^image\//.test(f.type)){ toast('Escolha uma foto (imagem).'); input.value=''; return; }
  try { compraSemNota.recibo = await csnReduzirFoto(f); compraSemNota.reciboMudou = true; }
  catch(e){ toast('Não foi possível usar esta foto. Tente outra.', 'error'); }
  input.value = '';
  notasCompraDesenhar();
}
function csnTirarRecibo(){ compraSemNota.recibo = null; compraSemNota.reciboMudou = true; compraSemNota.temReciboAntigo = false; notasCompraDesenhar(); }

// Confere o formulário; devolve { erro, foco } ou { dados } no formato de notas_entrada_sem_nota_salvar.
function csnMontar(){
  const C = compraSemNota;
  if(!C.fornecedorId) return { erro:'Escolha o fornecedor.', foco:'csnForn' };
  if(C.fornecedorId==='__novo'){
    if(!String(C.novo.nome||'').trim()) return { erro:'Escreva o nome do fornecedor.', foco:'csnNovoNome' };
    const doc = ncSoDigitos(C.novo.documento);
    if(doc && doc.length!==11 && doc.length!==14) return { erro:'O CPF tem 11 números e o CNPJ, 14. Deixe em branco se não tiver.', foco:'csnNovoDoc' };
  }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(C.data||''))) return { erro:'Escolha a data da compra.', foco:'csnData' };
  if(C.data>todayStr()) return { erro:'A data da compra não pode ser depois de hoje.', foco:'csnData' };
  const itens = [];
  for(let i=0;i<C.itens.length;i++){
    const it = C.itens[i], nome = String(it.nome||'').trim(), qtd = csnNumSimples(it.qtd), valor = csnNum(it.valor);
    if(!nome && !String(it.qtd||'').trim() && !String(it.valor||'').trim()) continue; // linha em branco
    if(!nome) return { erro:`Escreva o nome do item ${i+1}.`, foco:'csnNome-'+i };
    if(!(qtd>0)) return { erro:`Informe a quantidade de ${nome}.`, foco:'csnQtd-'+i };
    if(!(valor>=0) || !String(it.valor||'').trim()) return { erro:`Informe o valor de ${nome} (pode ser 0).`, foco:'csnValor-'+i };
    itens.push({ codigo:csnCodigo(nome), nome, unidade:it.unidade||'UN', qtd:Math.round(qtd*1000)/1000, custoTotal:Math.round(valor*100)/100 });
  }
  if(!itens.length) return { erro:'Lance pelo menos um item.', foco:'csnNome-0' };
  return { itens };
}

const compraSemNotaSalvar = singleFlight('compraSemNotaSalvar', async function(){
  const C = compraSemNota; if(!C) return;
  if(!notasCompraPodeImportar()){ toast('Sem permissão para lançar compra.'); return; }
  const m = csnMontar();
  if(m.erro){ toast(m.erro); const f = document.getElementById(m.foco); if(f) f.focus(); return; }
  let forn;
  if(C.fornecedorId==='__novo'){
    const doc = ncSoDigitos(C.novo.documento), nome = String(C.novo.nome).trim();
    // Mesmo CPF/CNPJ de um fornecedor que já existe: usa esse (não duplica o cadastro).
    const ja = doc ? (state.fornecedores||[]).find(f=>ncSoDigitos(f.documento)===doc) : null;
    if(ja) forn = { id:ja.id, nome:ja.nome||nome, documento:doc, fone:ja.telefone||'' };
    else {
      forn = { id:uid(), nome, documento:doc, fone:String(C.novo.fone||'').trim() };
      if(isAdminUser()){
        const novo = { id:forn.id, nome, razaoSocial:'', documento:doc, telefone:forn.fone, email:'', contato:'' };
        state.fornecedores.push(novo);
        if(!await save('fornecedores')){ state.fornecedores = state.fornecedores.filter(f=>f!==novo); toast('Não foi possível gravar o fornecedor. Confira a conexão e tente de novo.', 'error'); return; }
      }
      // Quem não é administrador: o cadastro nasce no Pagamento, com este mesmo id (ncnPagamento).
    }
  } else {
    const f = csnFornecedores().find(x=>x.id===C.fornecedorId);
    if(!f){ toast('Fornecedor não encontrado. Escolha de novo.'); return; }
    const cad = (state.fornecedores||[]).find(x=>x.id===f.id);
    forn = { id:f.id, nome:f.nome, documento:f.documento||'', fone:(cad && cad.telefone) || '' };
  }
  const dados = { fornecedor:forn, numero:String(C.numero||'').trim(), data:C.data, itens:m.itens };
  const bt = document.getElementById('csnSalvar'); if(bt) bt.disabled = true;
  try {
    const r = await ncnRpc('notas_entrada_sem_nota_salvar', { p_chave:C.chave, p_dados:dados, p_recibo:C.reciboMudou ? C.recibo : null, p_manter_recibo:!C.reciboMudou });
    if(r.error){
      const msg = String(r.error.message||'');
      toast(/sem permissao/i.test(msg) ? 'Seu perfil não pode lançar compra.' : /tratada/i.test(msg) ? 'Esta compra já foi conferida ou teve entrada: desfaça a entrada antes de corrigir.'
        : /documento/i.test(msg) ? 'O CPF tem 11 números e o CNPJ, 14.' : /recibo/i.test(msg) ? 'A foto do recibo ficou grande demais. Tente outra.'
        : 'Não foi possível salvar a compra. Confira a conexão e tente de novo.', 'error');
      return;
    }
    const chave = r.data && r.data.chave;
    logAction(`Compra sem nota ${C.chave?'corrigida':'lançada'}: ${forn.nome}, ${m.itens.length} item(ns), ${fmt(m.itens.reduce((s,x)=>s+x.custoTotal,0))}`);
    compraSemNota = null;
    await notasCompraRecarregar();
    toast(C.chave ? 'Compra corrigida.' : 'Compra lançada. Escolha o destino de cada item e toque em Confirmar.');
    if(chave) await abrirNotaCompra(chave);
  } finally { const b = document.getElementById('csnSalvar'); if(b) b.disabled = false; }
});

const compraSemNotaExcluir = singleFlight('notaCompra', async function(chave){
  const n = ncnNota(chave);
  if(!n || !ncSemNota(n)){ toast('Compra não encontrada. Atualize a lista.'); return; }
  if(!await confirmarAcao('Excluir esta compra sem nota?', { message:'Ela sai da lista. Nada foi lançado no estoque nem nas contas.', confirmLabel:'Excluir', danger:true })) return;
  const r = await ncnRpc('notas_entrada_sem_nota_excluir', { p_chave:chave });
  if(r.error){ toast(/tratada/i.test(r.error.message||'') ? 'Esta compra já foi tratada: desfaça a entrada antes de excluir.' : 'Não foi possível excluir agora. Confira a conexão e tente de novo.', 'error'); return; }
  logAction(`Compra sem nota excluída: ${n.emitente_nome||''} (${fmt(n.valor||0)})`);
  notasCompraSecao = '';
  await notasCompraRecarregar();
  toast('Compra excluída.');
});
