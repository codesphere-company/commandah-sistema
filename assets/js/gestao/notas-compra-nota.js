/* ============ NOTAS DE COMPRA — NOTA ABERTA ============ */
// t-notas, tarefa 5 (27/11/2026): abrir uma nota de compra (seção 'nota' da tela de gestao/notas-compra.js).
// Mostra cabeçalho, itens e parcelas; cada item recebe uma escolha (ligar a insumo, novo insumo, revenda de um
// produto, não é estoque) e as etapas saem pelo Confirmar (Conferida + Pagamento + Estoque, só as que a pessoa
// pode e que ainda faltam) ou pelo botão de cada etapa (pagar hoje, dar entrada quando a mercadoria chegar).
// Desenho: docs/superpowers/specs/2026-11-27-notas-de-compra-design.md ("Tela", "Custo do insumo", "Quem grava").
// Quem grava o quê: estoque, insumos novos e vínculos numa transação no servidor (notas_entrada_estoque, que não
// entra duas vezes); fornecedor, contas, ficha da revenda e histórico do estoque pelos blobs de sempre (save).
// Escolha por item: { tipo:'insumo'|'novo'|'revenda'|'fora', insumoId?, nome?, unidade?, fator, produtoId?, tamanhoId? }
// (fator = unidades de estoque por unidade da nota: 1 CX = 12 UN).
let notaCompraAberta = null; // { chave, escolhas:{[n]:escolha}, categoriaId, jaPaga, pagoEm, venc }

const NCN_TIPOS = [['insumo','Ligar a insumo'],['novo','Novo insumo'],['revenda','Revenda de produto'],['fora','Não é estoque']];
const NCN_ETAPA_NOME = { conferida:'Conferida', pagamento:'Pagamento', estoque:'Estoque' };
const ncnR6 = x => Math.round((Number(x)||0)*1e6)/1e6;
const ncnR2 = x => Math.round((Number(x)||0)*100)/100;
const ncnQtd = x => (Number(x)||0).toLocaleString('pt-BR', { maximumFractionDigits:3 });
function ncnNum(v){ const x = parseFloat(String(v==null?'':v).replace(',','.')); return isFinite(x) ? x : 0; }
function ncnNota(chave){ return (notasCompraDados && notasCompraDados.notas.find(n=>n.chave===chave)) || null; }
function ncnItens(n){ return n && n.dados && Array.isArray(n.dados.itens) ? n.dados.itens : []; }
// Só nota completa e dentro da data de início tem etapas; "fora", resumo e cancelada abrem para consulta.
function ncnAcionavel(n){ return !!n && n.situacao==='completa' && !n.fora; }
function ncnDia(iso){
  const s = String(iso||'');
  if(/^\d{4}-\d{2}-\d{2}/.test(s) && s.length<=10) return s;
  const d = new Date(s); if(isNaN(d)) return todayStr();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// Dia da emissão: o do XML (fuso do emitente), senão o da coluna.
function ncnEmissaoDia(n){ const s = String((n.dados && n.dados.emissao) || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : ncnDia(n.emissao); }
function ncnFornecedor(n){ const cnpj = ncSoDigitos(n.emitente_cnpj); return cnpj ? (state.fornecedores||[]).find(f=>ncSoDigitos(f.documento)===cnpj) || null : null; }
function ncnTamanhos(p){
  const g = p && typeof gradeOf==='function' ? gradeOf(p, state.complementos) : null;
  return g ? (g.sizes||[]).filter(s=>p.sizes && p.sizes[s.id]) : [];
}

// Escolha lembrada pelo vínculo (fornecedor + código). Insumo ou produto apagado: escolher de novo.
function ncnEscolhaLembrada(n, it){
  const v = ((notasCompraDados && notasCompraDados.vinculosDet) || {})[(n.emitente_cnpj||'')+'|'+it.codigo];
  if(!v) return null;
  const fator = Number(v.fator)>0 ? Number(v.fator) : 1;
  if(v.tipo==='fora') return { tipo:'fora', fator:1 };
  if(v.tipo==='insumo' && (state.insumos||[]).some(i=>i.id===v.insumo_id)) return { tipo:'insumo', insumoId:v.insumo_id, fator };
  if(v.tipo==='revenda' && (state.products||[]).some(p=>p.id===v.produto_id)) return { tipo:'revenda', produtoId:v.produto_id, tamanhoId:v.tamanho_id||'', insumoId:v.insumo_id||'', fator };
  return null;
}
// Ruling da tarefa 5: categoria lembrada = a da conta a pagar mais recente desse fornecedor; senão a de
// notas_entrada_config.categorias[cnpj]; senão vazia (escolher antes do Pagamento). Esta tela não grava a config.
function ncnCategoriaLembrada(n){
  const cats = state.contaCategorias||[], existe = id => cats.some(c=>c.id===id), f = ncnFornecedor(n);
  if(f){
    const ult = (state.contas||[]).filter(c=>c.tipo==='pagar' && c.fornecedorId===f.id && existe(c.categoriaId))
      .sort((a,b)=>String(a.createdAt||a.lancamento||'').localeCompare(String(b.createdAt||b.lancamento||''))).pop();
    if(ult) return ult.categoriaId;
  }
  const c = (((notasCompraDados && notasCompraDados.config) || {}).categorias || {})[n.emitente_cnpj];
  return existe(c) ? c : '';
}
function ncnPreparar(chave){
  const n = ncnNota(chave); if(!n) return null;
  const escolhas = {};
  ncnItens(n).forEach(it=>{ const e = ncnEscolhaLembrada(n, it); if(e) escolhas[it.n] = e; });
  notaCompraAberta = { chave, escolhas, categoriaId:ncnCategoriaLembrada(n), jaPaga:false, pagoEm:todayStr(), venc:ncnEmissaoDia(n) };
  return n;
}
// Revisão final (achado 2): a lista não traz `dados` de toda nota; a que abre sem eles (estoque já feito, fora,
// cancelada...) busca só a dela, uma vez.
async function ncnLerDados(chave){
  const n = ncnNota(chave); if(!n || n.dadosLidos) return true;
  try {
    const { data, error } = await supabaseClient.from('notas_entrada').select('chave,dados').eq('chave', chave).limit(1);
    if(error) return false;
    const m = ncnNota(chave) || n;
    m.dados = data && data[0] ? data[0].dados : null; m.dadosLidos = true;
    return true;
  } catch(e){ return false; }
}
async function abrirNotaCompra(chave){
  if(!ncnNota(chave)){ toast('Nota não encontrada. Atualize a lista.'); return; }
  if(!await ncnLerDados(chave)){ toast(NC_FORA_DO_AR, 'error'); return; }
  if(!ncnPreparar(chave)){ toast('Nota não encontrada. Atualize a lista.'); return; }
  notasCompraSecao = 'nota';
  notasCompraDesenhar();
  const el = document.getElementById('view-notascompra'); if(el) el.scrollTop = 0;
}

// Revenda: o insumo é o da ficha 1:1 do produto (ou do tamanho); senão o lembrado; senão um novo com o nome do produto.
function ncnRevendaInsumo(e){
  const p = (state.products||[]).find(x=>x.id===e.produtoId); if(!p) return null;
  const tam = e.tamanhoId ? ncnTamanhos(p).find(s=>s.id===e.tamanhoId) : null;
  const alvo = tam ? p.sizes[tam.id] : p, rec = (alvo && alvo.recipe) || [];
  const existe = id => !!id && (state.insumos||[]).some(i=>i.id===id);
  if(rec.length===1 && Number(rec[0].qty)===1 && existe(rec[0].insumoId)) return { insumoId:rec[0].insumoId, alvo, muda:false, p };
  const id = existe(e.insumoId) ? e.insumoId : (e.novoId || (e.novoId = uid())); // novoId fica na escolha: nova tentativa usa o mesmo
  return { insumoId:id, alvo, muda:true, cria:!existe(id), outraFicha:rec.length>0, p, nome:p.name+(tam?' '+tam.nome:'') };
}
function ncnCompleta(e){
  if(!e) return false;
  if(e.tipo==='fora') return true;
  if(!(Number(e.fator)>0)) return false;
  if(e.tipo==='insumo') return (state.insumos||[]).some(i=>i.id===e.insumoId);
  if(e.tipo==='novo') return !!String(e.nome||'').trim() && UNIT_OPTIONS.includes(e.unidade);
  if(e.tipo==='revenda'){ const p = (state.products||[]).find(x=>x.id===e.produtoId); if(!p) return false; const t = ncnTamanhos(p); return !t.length || t.some(s=>s.id===e.tamanhoId); }
  return false;
}
// Nome e unidade do insumo que a escolha alimenta (para a linha "→ +60 un, custo R$ 3,20/un").
function ncnDestino(e){
  if(!ncnCompleta(e) || e.tipo==='fora') return null;
  if(e.tipo==='novo') return { nome:String(e.nome).trim(), unit:e.unidade };
  const id = e.tipo==='insumo' ? e.insumoId : (ncnRevendaInsumo(e)||{}).insumoId;
  const ins = (state.insumos||[]).find(i=>i.id===id);
  if(ins) return { nome:ins.name, unit:ins.unit||'un' };
  const r = ncnRevendaInsumo(e); return { nome:r ? r.nome : '', unit:'un' };
}

function ncnTipo(nItem, tipo){
  const A = notaCompraAberta; if(!A || !NCN_TIPOS.some(([k])=>k===tipo)) return;
  const n = ncnNota(A.chave), it = ncnItens(n).find(x=>x.n===nItem); if(!it) return;
  const ant = A.escolhas[nItem] || {};
  A.escolhas[nItem] = { tipo, fator:tipo==='fora' ? 1 : (Number(ant.fator)>0 ? ant.fator : 1),
    nome:ant.nome || String(it.nome||'').trim(), unidade:ant.unidade || 'un', insumoId:tipo==='insumo' ? ant.insumoId||'' : '', produtoId:ant.produtoId||'', tamanhoId:ant.tamanhoId||'' };
  notasCompraDesenhar();
}
function ncnCampo(nItem, campo, valor){
  const A = notaCompraAberta, e = A && A.escolhas[nItem]; if(!e) return;
  if(campo==='fator') e.fator = ncnNum(valor);
  else if(campo==='produtoId'){ e.produtoId = String(valor||''); e.tamanhoId = ''; e.insumoId = ''; e.novoId = ''; }
  else if(['insumoId','nome','unidade','tamanhoId'].includes(campo)) e[campo] = String(valor||'');
  notasCompraDesenhar();
}
function ncnSet(campo, valor){
  const A = notaCompraAberta; if(!A) return;
  if(campo==='jaPaga'){ A.jaPaga = !!valor; notasCompraDesenhar(); return; }
  if(['categoriaId','pagoEm','venc'].includes(campo)) A[campo] = String(valor||'');
}

// ---------- Desenho ----------
function ncnOpcoes(lista, sel, vazio){ return `<option value="">${h(vazio)}</option>`+lista.map(([v,t])=>`<option value="${h(v)}" ${v===sel?'selected':''}>${h(t)}</option>`).join(''); }
function ncnItemHtml(n, it, podeEscolher){
  const A = notaCompraAberta, e = A.escolhas[it.n], ok = ncnCompleta(e), N = Number(it.n);
  const lembrada = !!((notasCompraDados.vinculosDet||{})[(n.emitente_cnpj||'')+'|'+it.codigo]);
  const tag = ok ? (lembrada ? '<span class="nc-tag ncn-ok">já ligado ✓</span>' : '<span class="nc-tag">escolhido</span>') : '<span class="nc-tag nc-tag-novo">novo</span>';
  let corpo = '';
  if(podeEscolher){
    const radios = NCN_TIPOS.map(([k,t])=>`<label class="ncn-op"><input type="radio" name="ncn-tipo-${N}" value="${k}" ${e&&e.tipo===k?'checked':''} onchange="ncnTipo(${N},this.value)"> ${t}</label>`).join('');
    let det = '';
    if(e && e.tipo!=='fora'){
      const un = h(it.unidade||'un');
      const fator = `<div class="field ncn-fator"><label for="ncnFator-${N}">1 ${un} =</label><input id="ncnFator-${N}" inputmode="decimal" value="${h(String(e.fator||''))}" onchange="ncnCampo(${N},'fator',this.value)"></div>`;
      if(e.tipo==='insumo'){
        const ins = (state.insumos||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')).map(i=>[i.id, i.name+' ('+(i.unit||'un')+')']);
        det = `<div class="field"><label for="ncnIns-${N}">Insumo</label><select id="ncnIns-${N}" onchange="ncnCampo(${N},'insumoId',this.value)">${ncnOpcoes(ins, e.insumoId, 'Escolha o insumo')}</select></div>${fator}`;
      } else if(e.tipo==='novo'){
        det = `<div class="field"><label for="ncnNome-${N}">Nome do insumo</label><input id="ncnNome-${N}" maxlength="80" value="${h(e.nome||'')}" onchange="ncnCampo(${N},'nome',this.value)"></div>
          <div class="field ncn-un"><label for="ncnUn-${N}">Unidade</label><select id="ncnUn-${N}" onchange="ncnCampo(${N},'unidade',this.value)">${UNIT_OPTIONS.map(u=>`<option ${u===e.unidade?'selected':''}>${u}</option>`).join('')}</select></div>${fator}`;
      } else {
        const prods = (state.products||[]).filter(p=>!(typeof productKind==='function' && productKind(p)==='combo')).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')).map(p=>[p.id, p.name]);
        const p = (state.products||[]).find(x=>x.id===e.produtoId), tams = ncnTamanhos(p);
        det = `<div class="field"><label for="ncnProd-${N}">Produto</label><select id="ncnProd-${N}" onchange="ncnCampo(${N},'produtoId',this.value)">${ncnOpcoes(prods, e.produtoId, 'Escolha o produto')}</select></div>
          ${tams.length ? `<div class="field ncn-un"><label for="ncnTam-${N}">Tamanho</label><select id="ncnTam-${N}" onchange="ncnCampo(${N},'tamanhoId',this.value)">${ncnOpcoes(tams.map(s=>[s.id, s.nome]), e.tamanhoId, 'Qual?')}</select></div>` : ''}${fator}`;
      }
    }
    corpo = `<div class="ncn-ops" role="radiogroup" aria-label="O que fazer com ${h(it.nome)}">${radios}</div>${det?`<div class="ncn-det">${det}</div>`:''}`;
  }
  const d = ncnDestino(e);
  let res = '';
  if(e && e.tipo==='fora' && ok) res = 'Não é estoque (só conta a pagar).';
  else if(d){
    const q = ncnR6(Number(it.qtd)*Number(e.fator)), u = h(d.unit);
    res = `→ ${h(d.nome)}${e.tipo==='revenda'?' (revenda)':''} · 1 ${h(it.unidade||'')} = ${ncnQtd(e.fator)} ${u} → +${ncnQtd(q)} ${u}${q>0?`, custo ${fmt((Number(it.custoTotal)||0)/q)}/${u}`:''}`;
  }
  return `<div class="ncn-item ${ok?'':'ncn-sem'}" data-item="${N}"><div class="ncn-item-cab"><b>${h(it.nome||'Item '+N)}</b><span class="sub">${ncnQtd(it.qtd)} ${h(it.unidade||'')} · ${fmt(it.custoTotal)}</span>${tag}</div>
    ${corpo}${res?`<div class="ncn-res">${res}</div>`:''}</div>`;
}
function ncnPagamentoHtml(n){
  const A = notaCompraAberta, dups = (n.dados && Array.isArray(n.dados.duplicatas)) ? n.dados.duplicatas : [];
  const parcelas = dups.length
    ? `<ul class="ncn-parcelas">${dups.map((d,i)=>`<li><span class="mono">${i+1}/${dups.length}</span> ${h(ncData(d.vencimento+'T12:00:00'))} <b class="mono">${fmt(d.valor)}</b></li>`).join('')}</ul>`
    : `<div class="field ncn-venc"><label for="ncnVenc">Vencimento (a nota não tem parcelas)</label><input id="ncnVenc" type="date" value="${h(A.venc)}" onchange="ncnSet('venc',this.value)"></div>`;
  if(n.pagamento_em) return `<section class="ncn-pagamento"><h3>Pagamento</h3>${parcelas}<p class="sub">Contas a pagar lançadas em ${h(ncData(n.pagamento_em))}.</p></section>`;
  const cats = (state.contaCategorias||[]).map(c=>[c.id, c.nome||c.name||'']);
  return `<section class="ncn-pagamento"><h3>Pagamento</h3>${parcelas}<div class="ncn-pag-campos">
    <div class="field"><label for="ncnCat">Categoria da conta</label><select id="ncnCat" onchange="ncnSet('categoriaId',this.value)">${ncnOpcoes(cats, A.categoriaId, cats.length?'Escolha':'Cadastre em Financeiro › Categorias')}</select></div>
    <label class="ncn-check"><input type="checkbox" id="ncnJaPaga" ${A.jaPaga?'checked':''} onchange="ncnSet('jaPaga',this.checked)"> Já paga em</label>
    <div class="field"><input id="ncnPagoEm" type="date" aria-label="Data do pagamento" value="${h(A.pagoEm)}" ${A.jaPaga?'':'disabled'} onchange="ncnSet('pagoEm',this.value)"></div></div></section>`;
}
function notaCompraHtml(){
  const A = notaCompraAberta, n = A && ncnNota(A.chave);
  const voltar = `<button type="button" class="cc-voltar" onclick="notasCompraAbrir('')">${ICN.chevLeft}Notas de compra</button>`;
  if(!n) return `<div class="hub-trilha">${voltar}<h2>Nota</h2></div><div class="hub-corpo"><p class="hub-vazio">Nota não encontrada.</p></div>`;
  const em = (n.dados && n.dados.emitente) || {}, forn = em.fantasia || n.emitente_nome || em.nome || 'Fornecedor';
  const itens = ncnItens(n), et = notasCompraEtapas(n), acao = ncnAcionavel(n), J = jsArg(n.chave);
  const podeIns = hasPerm('insumos'), podeContas = hasPerm('contas');
  const aviso = n.fora ? 'Nota tratada fora (emitida antes da data de início): só consulta.'
    : n.situacao==='cancelada' ? 'Nota cancelada pelo fornecedor: só consulta.'+(n.estoque_em?' Se a mercadoria não veio, desfaça a entrada no estoque.':'')
    : n.situacao==='resumo' ? 'Aguardando o XML: a nota ainda não tem itens. Só consulta.' : '';
  const pills = NC_ETAPAS.map(([k,r])=>{ const v = et[k]; return `<span class="ncn-etapa nc-${v}">${v==='feito'?'✓':v==='nao_se_aplica'?'—':'○'} ${r}</span>`; }).join('');
  const faltam = { conferida:!n.conferida_em && (podeIns||podeContas), pagamento:!n.pagamento_em && podeContas, estoque:!n.estoque_em && podeIns };
  const sem = podeIns && !n.estoque_em ? itens.filter(it=>!ncnCompleta(A.escolhas[it.n])).length : 0;
  const bt = (id, txt, f, cls) => `<button type="button" class="${cls||'op-btn'}" id="${id}" onclick="${f}">${txt}</button>`;
  const acoes = acao && Object.values(faltam).some(Boolean) ? `<div class="ncn-acoes">${bt('ncnConfirmar','Confirmar',`notaCompraConfirmar(${J})`,'btn btn-primary hub-acao')}
      ${Object.keys(faltam).filter(k=>faltam[k]).map(k=>bt('ncnEtapa-'+k, 'Só '+NCN_ETAPA_NOME[k].toLowerCase(), `notaCompraEtapa(${J},${jsArg(k)})`)).join('')}
      ${sem?`<p class="sub ncn-falta">Escolha o que fazer com ${sem} ${sem===1?'item novo':'itens novos'} para dar entrada no estoque.</p>`:''}</div>` : '';
  const escritorio = !podeContas || !acao && !n.contabilidade_em ? '' : n.contabilidade_em
    ? `<p class="sub ncn-escritorio">Escritório conferiu em ${h(ncData(n.contabilidade_em))}${n.contabilidade_obs?': '+h(n.contabilidade_obs):''}.</p>`
    : `<div class="ncn-escritorio"><div class="field"><label for="ncnObs">Observação do escritório</label><input id="ncnObs" maxlength="500" autocomplete="off"></div>${bt('ncnEscritorio','Escritório conferiu',`notaCompraEscritorio(${J},document.getElementById('ncnObs').value)`)}</div>`;
  const desfazer = n.estoque_em && podeIns ? `<div class="ncn-desfazer">${bt('ncnDesfazer','Desfazer entrada no estoque',`notaCompraDesfazer(${J})`,'btn btn-danger')}</div>` : '';
  return `<div class="hub-trilha">${voltar}<h2>${n.modelo===65?'NFC-e':'NF-e'} ${h(n.numero||'')}</h2></div>
    <div class="hub-corpo ncn" data-nota="${h(n.chave)}">
      <div class="ncn-cab"><div><b class="ncn-forn">${h(forn)}</b><span class="sub">${n.emitente_cnpj?'CNPJ '+h(n.emitente_cnpj)+' · ':''}Emissão ${h(ncData(n.emissao))} · Valor <b class="mono">${n.valor==null?'—':fmt(n.valor)}</b></span></div><div class="ncn-etapas">${pills}</div></div>
      ${aviso?`<p class="ncn-aviso">${h(aviso)}</p>`:''}${n.aviso?`<p class="ncn-aviso">${h(n.aviso)}</p>`:''}
      <section><h3>Itens</h3><div class="ncn-itens">${itens.map(it=>ncnItemHtml(n, it, acao && podeIns && !n.estoque_em)).join('') || '<p class="hub-vazio">Sem itens.</p>'}</div></section>
      ${acao && podeContas ? ncnPagamentoHtml(n) : ''}${acoes}${escritorio}${desfazer}</div>`;
}

// ---------- Etapas ----------
async function ncnRpc(nome, args){
  try { const { data, error } = await supabaseClient.rpc(nome, args); return error ? { error } : { data }; }
  catch(e){ return { error:{ message:String(e && e.message || e) } }; }
}
async function ncnMarcar(chave, etapa, dados){
  const r = await ncnRpc('notas_entrada_marcar', { p_chave:chave, p_etapa:etapa, p_dados:dados||{} });
  const m = r.error ? String(r.error.message||'') : '';
  if(r.error) return { erro: /sem permissao/i.test(m) ? 'Seu perfil não pode marcar '+etapa+' nesta nota.' : /para consulta/i.test(m) ? 'Esta nota é só para consulta.' : 'Não foi possível marcar '+etapa+' agora. Confira a conexão e tente de novo.' };
  return { ok:!(r.data && r.data.ja) };
}
async function ncnConferida(n){
  if(n.conferida_em || !(hasPerm('contas') || hasPerm('insumos'))) return {};
  return ncnMarcar(n.chave, 'conferida');
}
async function ncnPagamento(n){
  if(n.pagamento_em || !hasPerm('contas')) return {};
  const A = notaCompraAberta, d = n.dados || {}, em = d.emitente || {}, cnpj = ncSoDigitos(n.emitente_cnpj);
  if(!A.categoriaId || !(state.contaCategorias||[]).some(c=>c.id===A.categoriaId)) return { erro:'Escolha a categoria da conta para lançar o pagamento.' };
  if(A.jaPaga && !/^\d{4}-\d{2}-\d{2}$/.test(A.pagoEm)) return { erro:'Informe a data em que a nota foi paga.' };
  const dups = Array.isArray(d.duplicatas) && d.duplicatas.length ? d.duplicatas : [{ numero:'1', vencimento:A.venc, valor:Number(n.valor)||Number(d.valor)||0 }];
  if(dups.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(String(x.vencimento||'')) || !(Number(x.valor)>0))) return { erro:'Confira o vencimento e o valor da conta a pagar.' };
  // Revisão final (achado 5): dois aparelhos na mesma nota. O outro pode ter lançado as contas há pouco (o blob
  // de contas deste aparelho ainda não tem); relê só o pagamento_em desta nota antes de criar qualquer conta.
  try {
    const { data, error } = await supabaseClient.from('notas_entrada').select('pagamento_em').eq('chave', n.chave).limit(1);
    if(error) return { erro:'Não foi possível conferir o pagamento desta nota agora. Confira a conexão e tente de novo.' };
    if(data && data[0] && data[0].pagamento_em) return { erro:'O pagamento desta nota já foi lançado em outro aparelho.' };
  } catch(e){ return { erro:'Não foi possível conferir o pagamento desta nota agora. Confira a conexão e tente de novo.' }; }
  let forn = ncnFornecedor(n);
  if(!forn){
    forn = { id:uid(), nome:em.fantasia || em.nome || n.emitente_nome || ('CNPJ '+cnpj), razaoSocial:em.nome || n.emitente_nome || '', documento:cnpj, telefone:em.fone || '', email:'', contato:'' };
    state.fornecedores.push(forn);
    if(!await save('fornecedores')){ state.fornecedores = state.fornecedores.filter(f=>f!==forn); return { erro:'Não foi possível gravar o fornecedor. Confira a conexão e tente de novo.' }; }
  }
  // Uma conta por duplicata, no formato de savePayableAccount, com notaChave+notaDup: não lança duas vezes.
  const criadas = [], agora = new Date().toISOString();
  dups.forEach((x, i)=>{
    const dup = String(x.numero || i+1), valor = ncnR2(x.valor);
    if((state.contas||[]).some(c=>c.notaChave===n.chave && String(c.notaDup)===dup)) return;
    criadas.push({ id:uid(), tipo:'pagar', descricao:`NF-e ${n.numero||''}${dups.length>1?` parcela ${i+1}/${dups.length}`:''} — ${forn.nome}`, valor, vencimento:x.vencimento,
      categoriaId:A.categoriaId, fornecedorId:forn.id, lancamento:todayStr(), pago:A.jaPaga, dataPagamento:A.jaPaga ? A.pagoEm : '', desconto:0, juros:0,
      valorPago:A.jaPaga ? valor : 0, frequencia:'Mensal', repetitionIndex:1, repetitionCount:1, createdAt:agora, notaChave:n.chave, notaDup:dup });
  });
  if(criadas.length){
    state.contas.push(...criadas);
    if(!await save('contas')){ state.contas = state.contas.filter(c=>!criadas.includes(c)); return { erro:'Não foi possível gravar as contas a pagar. Confira a conexão e tente de novo.' }; }
  }
  const r = await ncnMarcar(n.chave, 'pagamento', { contas:state.contas.filter(c=>c.notaChave===n.chave).map(c=>c.id) });
  return r.erro ? r : { ok:true };
}
function ncnMsgEstoque(error){
  const m = String(error && error.message || '');
  if(/sem permissao/i.test(m)) return 'Seu perfil não pode dar entrada no estoque. Peça a um administrador ou ao caixa.';
  if(/cancelada/i.test(m)) return 'Nota cancelada: não dá para dar entrada no estoque.';
  if(/resumo/i.test(m)) return 'Esta nota ainda não tem o XML (só o resumo): espere o XML para dar entrada no estoque.';
  if(/insumo inexistente/i.test(m)) return 'Um insumo escolhido foi apagado. Escolha de novo e dê entrada no estoque.';
  return 'Não foi possível dar entrada no estoque agora. Confira a conexão e toque em Confirmar de novo.';
}
// Lista de insumos que o servidor devolveu, mantendo o que este aparelho mudou e ainda não gravou (como pushInsumos).
function ncnTrocarInsumos(server, antes){
  if(!Array.isArray(server)) return;
  setInsumosBase(server);
  state.insumos = applyInsumosDiffLocal(server, insumosDiff(cashMovementsMap(antes), state.insumos||[]));
}
function ncnMovimentos(n, deltas, tipo, operacao){
  const at = new Date().toISOString(), quem = currentUser ? currentUser.name : '—';
  Object.entries(deltas).forEach(([id, q])=>{
    const ins = (state.insumos||[]).find(i=>i.id===id); if(!ins) return;
    const after = Number(ins.stock)||0, before = ncnR6(tipo==='entrada' ? after-q : after+q);
    state.stockMovements.unshift({ id:uid(), insumoId:id, type:tipo, name:ins.name, unit:ins.unit, operation:operacao, reference:n.chave, before, qty:q, after, user:quem, at });
  });
}
async function ncnEstoque(n){
  if(n.estoque_em || !hasPerm('insumos')) return {};
  const A = notaCompraAberta, itens = ncnItens(n);
  const sem = itens.filter(it=>!ncnCompleta(A.escolhas[it.n])).length;
  if(sem) return { erro:`Escolha o que fazer com ${sem} ${sem===1?'item novo':'itens novos'}.` };
  const novos = {}, deltas = {}, custos = {}, vinculos = [], fichas = [];
  for(const it of itens){
    const e = A.escolhas[it.n];
    if(e.tipo==='fora'){ vinculos.push({ codigo:it.codigo, tipo:'fora', fator:1 }); continue; }
    let id;
    if(e.tipo==='insumo') id = e.insumoId;
    else if(e.tipo==='novo'){ id = e.novoId || (e.novoId = uid()); novos[id] = { id, name:String(e.nome).trim(), unit:e.unidade }; }
    else {
      const r = ncnRevendaInsumo(e); id = r.insumoId; e.insumoId = id;
      if(r.cria) novos[id] = { id, name:r.nome, unit:'un' };
      if(r.muda) fichas.push(r);
    }
    vinculos.push({ codigo:it.codigo, tipo:e.tipo==='revenda' ? 'revenda' : 'insumo', insumo_id:id, produto_id:e.tipo==='revenda' ? e.produtoId : null, tamanho_id:e.tipo==='revenda' && e.tamanhoId || null, fator:Number(e.fator) });
    const q = ncnR6(Number(it.qtd)*Number(e.fator));
    if(q>0){ deltas[id] = ncnR6((deltas[id]||0)+q); custos[id] = (custos[id]||0)+(Number(it.custoTotal)||0); }
  }
  // Revenda sem ficha 1:1: a ficha do produto (ou do tamanho) passa a ser 1 unidade do insumo. Só o administrador
  // grava o catálogo; trocar uma ficha que já existia pede confirmação.
  if(fichas.length){
    if(!podeEditarCatalogo()) return { erro:'A ficha de '+fichas.map(r=>r.p.name).join(', ')+' precisa ser ligada ao insumo: peça ao administrador para dar entrada desta nota.' };
    const outras = fichas.filter(r=>r.outraFicha);
    if(outras.length && !await confirmarAcao('Isso vai substituir a ficha técnica de '+outras.map(r=>r.nome).join(', ')+' por 1 unidade do insumo. Continuar?', { confirmLabel:'Substituir' }))
      return { erro:'Entrada no estoque não feita: a ficha técnica ficou como estava.' };
  }
  // Custo por unidade de estoque = custo do item ÷ (qtd × fator) (spec, "Custo do insumo"). Insumo novo vai com
  // estoque 0 e a quantidade só no delta (o servidor cria com 0 e aplica o delta: o desfazer volta certo).
  const custo = id => deltas[id] ? ncnR6(custos[id]/deltas[id]) : 0;
  const upserts = Object.keys({ ...novos, ...deltas }).map(id=>novos[id] ? { ...novos[id], stock:0, minStock:0, costPerUnit:custo(id) } : { id, costPerUnit:custo(id) });
  const antes = JSON.parse(JSON.stringify(state.insumos||[]));
  const r = await ncnRpc('notas_entrada_estoque', { p_chave:n.chave, p_upserts:upserts, p_deltas:deltas, p_vinculos:vinculos });
  if(r.error) return { erro:ncnMsgEstoque(r.error) };
  if(r.data && r.data.ja) return {};
  ncnTrocarInsumos(r.data && r.data.insumos, antes);
  ncnMovimentos(n, deltas, 'entrada', 'NF-e '+(n.numero||''));
  save('stockMovements');
  // Depois da entrada, a escolha "novo" vira "ligar a insumo" (desfazer e confirmar de novo não cria outro).
  itens.forEach(it=>{ const e = A.escolhas[it.n]; if(e && e.tipo==='novo' && novos[e.novoId]) A.escolhas[it.n] = { tipo:'insumo', insumoId:e.novoId, fator:e.fator }; });
  if(fichas.length){
    fichas.forEach(f=>{ f.alvo.recipe = [{ insumoId:f.insumoId, qty:1 }]; });
    if(!await save('products')) return { ok:true, erro:'Estoque lançado, mas a ficha do produto não foi gravada. Confira a conexão e ajuste a ficha em Produtos.' };
  }
  return { ok:true };
}

async function ncnRodar(chave, etapas){
  let n = ncnNota(chave);
  if(!ncnAcionavel(n)){ toast('Esta nota é só para consulta.'); return; }
  if(!notaCompraAberta || notaCompraAberta.chave!==chave) n = ncnPreparar(chave);
  const caixa = document.querySelector('#view-notascompra .ncn'); if(caixa) caixa.setAttribute('data-ocupado', '');
  const feitas = [], erros = [];
  try {
    for(const et of etapas){
      const r = et==='conferida' ? await ncnConferida(n) : et==='pagamento' ? await ncnPagamento(n) : et==='estoque' ? await ncnEstoque(n) : {};
      if(r.ok) feitas.push(NCN_ETAPA_NOME[et]);
      if(r.erro) erros.push(r.erro);
    }
  } finally { if(caixa) caixa.removeAttribute('data-ocupado'); }
  if(feitas.length) logAction(`Nota de compra ${n.numero||''} (${n.emitente_nome||n.emitente_cnpj||''}): ${feitas.join(', ')}`);
  await notasCompraRecarregar();
  const ok = feitas.length ? 'Feito: '+feitas.join(', ')+'.' : '';
  if(erros.length) toast([ok, ...erros].filter(Boolean).join(' '), 'error');
  else toast(ok || 'Nada a fazer: as etapas que você pode fazer já estavam feitas.');
}
// Mesmo nome no singleFlight (chave = nota): Confirmar, etapa, escritório e desfazer não correm juntos na mesma nota.
const notaCompraConfirmar = singleFlight('notaCompra', chave => ncnRodar(chave, ['conferida','pagamento','estoque']));
const notaCompraEtapa = singleFlight('notaCompra', (chave, etapa) => NCN_ETAPA_NOME[etapa] ? ncnRodar(chave, [etapa]) : undefined);
const notaCompraEscritorio = singleFlight('notaCompra', async function(chave, obs){
  if(!hasPerm('contas')){ toast('Só quem cuida das contas marca a conferência do escritório.'); return; }
  const r = await ncnMarcar(chave, 'contabilidade', { obs:String(obs||'').trim().slice(0,500) });
  if(r.erro){ toast(r.erro, 'error'); return; }
  logAction('Nota de compra: escritório conferiu ('+chave.slice(-8)+')');
  await notasCompraRecarregar();
  toast('Conferência do escritório registrada.');
});
const notaCompraDesfazer = singleFlight('notaCompra', async function(chave){
  const n = ncnNota(chave);
  if(!n || !n.estoque_em){ toast('Esta nota não tem entrada no estoque.'); return; }
  if(!hasPerm('insumos')){ toast('Seu perfil não pode mexer no estoque.'); return; }
  if(!await confirmarAcao('Desfazer a entrada desta nota no estoque?', { message:'As quantidades que entraram saem do estoque. As contas a pagar continuam.', confirmLabel:'Desfazer', danger:true })) return;
  const antes = JSON.parse(JSON.stringify(state.insumos||[]));
  const r = await ncnRpc('notas_entrada_desfazer_estoque', { p_chave:chave });
  if(r.error){ toast(/sem permissao/i.test(r.error.message||'') ? 'Seu perfil não pode desfazer a entrada. Peça a um administrador ou ao caixa.' : 'Não foi possível desfazer agora. Confira a conexão e tente de novo.', 'error'); return; }
  if(!(r.data && r.data.ja)){
    ncnTrocarInsumos(r.data && r.data.insumos, antes);
    const deltas = {}; Object.entries(n.estoque_deltas||{}).forEach(([id,q])=>{ if(Number(q)>0) deltas[id] = Number(q); });
    ncnMovimentos(n, deltas, 'saida', 'Desfeita a NF-e '+(n.numero||''));
    save('stockMovements');
    logAction('Nota de compra '+(n.numero||'')+': entrada no estoque desfeita');
  }
  await notasCompraRecarregar();
  toast('Entrada no estoque desfeita.');
});
