/* ============ NOTAS DE COMPRA ============ */
// t-notas, tarefa 4 (27/11/2026): tela Notas de compra (Produtos › Estoque e Financeiro › Contas a Pagar).
// Lista as NF-e de entrada do estabelecimento com as quatro etapas (Conferida, Contabilidade, Pagamento,
// Estoque), importa XML à mão, pede a busca agora, baixa o arquivo do mês para o contador e guarda a
// configuração da busca. Desenho: docs/superpowers/specs/2026-11-27-notas-de-compra-design.md.
// Quem grava as notas é só a Edge Function notas-entrada (service role); aqui o site lê pelo RLS (sem a
// coluna xml, que é grande e só serve ao arquivo do mês) e chama as ações da função. Abrir uma nota e fazer
// as etapas fica em gestao/notas-compra-nota.js (abrirNotaCompra, tarefa 5).
// Padrão das telas novas (Cofre/Caixa, 26/11): situação no topo (.hub-status); Configuração e Arquivo do mês
// entram com a barra .hub-trilha ("‹ Notas de compra" + título).
let notasCompraDados = null;      // { notas:[...], vinculos:{'cnpj|codigo':tipo}, vinculosDet:{'cnpj|codigo':linha}, config:{...}|null }
let notasCompraSecao = '';        // '' = lista; 'config' | 'arquivo'
let notasCompraFiltro = 'pendentes';
let notasCompraMes = '';          // 'AAAA-MM' ou '' (todos os meses)
let notasCompraCarregando = false;
let notasCompraVelha = true;      // t-notas: entrar na tela (switchView) relê do servidor; o renderAll de fundo só redesenha
let notasCompraLidaEm = 0;        // t-notas: entrar e sair da tela em seguida não relê (Supabase Pro por egress, 25/11)

// Sem xml (t-notas: o XML só vai para o arquivo do mês, pela função) e sem `dados` (revisão final, achado 2:
// baixar os itens de 500 notas a cada entrada e depois de cada ação pesava no egress do Supabase Pro). `dados`
// vem numa segunda consulta só das notas que precisam dos itens na lista (completas, dentro do início e sem
// estoque: "itens novos: N" e "não se aplica"); o da nota aberta vem ao abrir (abrirNotaCompra).
const NC_CAMPOS = 'chave,origem,modelo,numero,serie,emitente_cnpj,emitente_nome,emissao,valor,situacao,fora,aviso,conferida_em,contabilidade_em,pagamento_em,contabilidade_obs,estoque_em,estoque_deltas,estoque_desfeito_em,criada_em'; // t-notas tarefa 5: obs do escritório e deltas (o desfazer registra a saída)
const NC_LIMITE = 500;
const NC_FORA_DO_AR = 'Não foi possível falar com o servidor das notas agora. Tente de novo em alguns segundos.';
const NC_ETAPAS = [['conferida','Conferida'],['contabilidade','Contabilidade'],['pagamento','Pagamento'],['estoque','Estoque']];
const NC_SECOES = { config:'Configuração', arquivo:'Arquivo do mês' };
const NC_MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

const ncSoDigitos = x => String(x==null?'':x).replace(/\D/g,'');
function ncData(iso){ if(!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR'); }
function ncMesDe(iso){ if(!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function ncMesNome(mes){ const [a,m] = String(mes).split('-'); return (NC_MESES[Number(m)-1]||mes)+' de '+a; }
function ncMesAtual(){ return todayStr().slice(0,7); }

// Etapas de uma nota. Estoque "não se aplica" quando todos os itens têm vínculo "não é estoque" (gás,
// limpeza...): a nota só passa pelo financeiro (spec, "Gás Maringá ... — (não é estoque)").
function notasCompraSoFora(n){
  const itens = n && n.dados && Array.isArray(n.dados.itens) ? n.dados.itens : [];
  if(!itens.length) return false;
  const vin = (notasCompraDados && notasCompraDados.vinculos) || {};
  return itens.every(it => vin[(n.emitente_cnpj||'')+'|'+it.codigo]==='fora');
}
function notasCompraEtapas(n){
  const f = x => x ? 'feito' : 'falta';
  return { conferida:f(n.conferida_em), contabilidade:f(n.contabilidade_em), pagamento:f(n.pagamento_em),
    estoque: n.estoque_em ? 'feito' : (notasCompraSoFora(n) ? 'nao_se_aplica' : 'falta') };
}
// Itens que ainda não têm vínculo com este fornecedor ("itens novos: N" na lista).
function notasCompraItensNovos(n){
  const itens = n && n.dados && Array.isArray(n.dados.itens) ? n.dados.itens : [];
  const vin = (notasCompraDados && notasCompraDados.vinculos) || {};
  return itens.filter(it => !vin[(n.emitente_cnpj||'')+'|'+it.codigo]).length;
}
// Pendente = tem etapa faltando, não é "tratada fora" (antes da data de início) e não foi cancelada.
function notasCompraPendente(n){
  if(n.fora || n.situacao==='cancelada') return false;
  const e = notasCompraEtapas(n);
  return Object.values(e).includes('falta');
}

async function notasCompraCarregar(){
  if(!isCloudMode()) throw new Error('As notas de compra precisam do sistema na nuvem.');
  const [rn, rd, rv, rc] = await Promise.all([
    supabaseClient.from('notas_entrada').select(NC_CAMPOS).order('emissao', { ascending:false }).limit(NC_LIMITE),
    supabaseClient.from('notas_entrada').select('chave,dados').eq('situacao','completa').eq('fora',false).is('estoque_em',null)
      .order('emissao', { ascending:false }).limit(NC_LIMITE),
    supabaseClient.from('notas_entrada_vinculos').select('emitente_cnpj,codigo,tipo,insumo_id,produto_id,tamanho_id,fator'), // t-notas tarefa 5: a nota aberta vem com as escolhas lembradas
    supabaseClient.from('notas_entrada_config').select('cnpj,liberada,busca_ligada,inicio,ultima_busca_ok,ultimo_erro,categorias').limit(1)
  ]);
  if(rn.error || rd.error || rv.error || rc.error) throw new Error(NC_FORA_DO_AR);
  const vinculos = {}, vinculosDet = {};
  (rv.data||[]).forEach(v => { vinculos[(v.emitente_cnpj||'')+'|'+v.codigo] = v.tipo; vinculosDet[(v.emitente_cnpj||'')+'|'+v.codigo] = v; });
  // Sem emissão (resumo sem data) vai pelo dia em que chegou.
  const notas = (rn.data||[]).slice().sort((a,b)=>String(b.emissao||b.criada_em||'').localeCompare(String(a.emissao||a.criada_em||'')));
  // `dados` de uma nota não muda enquanto a situação é a mesma: o que já foi lido (nota aberta, por exemplo,
  // que saiu da segunda consulta depois da entrada no estoque) fica, sem baixar de novo.
  const novos = {}; (rd.data||[]).forEach(d => { novos[d.chave] = d.dados; });
  const antigas = {}, mesmo = notasCompraDados && notasCompraDados.quem===(currentUser && currentUser.id);
  ((mesmo && notasCompraDados.notas) || []).forEach(n => { if(n.dadosLidos || n.dados!=null) antigas[n.chave] = n; });
  notas.forEach(n => {
    if(Object.prototype.hasOwnProperty.call(novos, n.chave)){ n.dados = novos[n.chave]; n.dadosLidos = true; return; }
    const a = antigas[n.chave];
    if(a && a.situacao===n.situacao){ n.dados = a.dados; n.dadosLidos = true; }
  });
  notasCompraDados = { notas, vinculos, vinculosDet, config:(rc.data||[])[0] || null, quem:currentUser && currentUser.id };
  notasCompraVelha = false; notasCompraLidaEm = Date.now();
  if(typeof notasCompraAvisoDeDados==='function') notasCompraAvisoDeDados(false); // t-notas tarefa 6: o selo do menu acompanha a tela, sem consulta extra
  return notasCompraDados;
}

async function renderNotasCompra(){
  const el = document.getElementById('view-notascompra');
  if(!el || activeView!=='notascompra') return;
  // Quem está digitando (CNPJ, data) não perde o que escreveu por causa de um renderAll de fundo.
  const foco = document.activeElement;
  if(notasCompraDados && foco && el.contains(foco) && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName) && foco.type!=='file') return;
  // Trocou de usuário (bloquear e entrar com outro PIN): relê, a permissão de leitura pode ser outra.
  if(notasCompraDados && notasCompraDados.quem !== (currentUser && currentUser.id)){ notasCompraVelha = true; notasCompraLidaEm = 0; }
  if(notasCompraDados && (!notasCompraVelha || Date.now()-notasCompraLidaEm<30000)){ notasCompraVelha = false; notasCompraDesenhar(); return; }
  if(notasCompraCarregando) return;
  notasCompraCarregando = true;
  if(!notasCompraDados) el.innerHTML = notasCompraCasca('<p class="hub-vazio">Carregando as notas…</p>');
  try { await notasCompraCarregar(); }
  catch(e){ notasCompraVelha = false; if(!notasCompraDados){ el.innerHTML = notasCompraCasca(`<div class="cash-empty">${h(e.message||NC_FORA_DO_AR)}</div>`); return; } toast(e.message||NC_FORA_DO_AR, 'error'); }
  finally { notasCompraCarregando = false; }
  notasCompraDesenhar();
}

function notasCompraPodeImportar(){ return hasPerm('contas') || hasPerm('insumos'); }
function notasCompraCasca(corpo){
  const bt = (id, ic, txt, acao) => `<button type="button" class="op-btn" id="${id}" onclick="${acao}"><span class="b-ic" aria-hidden="true">${ICN[ic]||''}</span> ${txt}</button>`;
  const acoes = [
    isAdminUser() ? bt('ncBuscarAgora','refresh','Buscar agora','notasCompraBuscarAgora()') : '',
    notasCompraPodeImportar() ? bt('ncImportarBtn','fileIn','Importar XML',"document.getElementById('ncXmlArquivo').click()") : '',
    hasPerm('contas') ? bt('ncArquivoBtn','download','Arquivo do mês',"notasCompraAbrir('arquivo')") : '',
    isAdminUser() ? bt('ncConfigBtn','gear','Configuração','notasCompraConfig()') : ''
  ].join('');
  // O título e o × vêm do cabeçalho padrão das telas de gestão (padronizarCabecalhoDaTela, core/navegacao.js).
  return `<div class="hub nc-hub">${acoes?`<div class="nc-acoes">${acoes}</div>`:''}
    <input type="file" id="ncXmlArquivo" accept=".xml,text/xml,application/xml" multiple hidden onchange="notasCompraImportar()">${corpo}</div>`;
}

// Entra numa seção ('config', 'arquivo') ou volta à lista ('').
function notasCompraAbrir(sec){
  notasCompraSecao = NC_SECOES[sec] ? sec : '';
  notasCompraDesenhar();
  const el = document.getElementById('view-notascompra'); if(!el) return;
  const alvo = notasCompraSecao ? el.querySelector('.hub-corpo input:not([type=file]), .hub-corpo button') : null;
  if(alvo) alvo.focus();
  el.scrollTop = 0;
}
function notasCompraFiltrar(f){ notasCompraFiltro = ['pendentes','todas','canceladas'].includes(f) ? f : 'pendentes'; notasCompraDesenhar(); }
function notasCompraEscolherMes(m){ notasCompraMes = /^\d{4}-\d{2}$/.test(m) ? m : ''; notasCompraDesenhar(); }

function notasCompraDesenhar(){
  const el = document.getElementById('view-notascompra'); if(!el || !notasCompraDados) return;
  // t-notas tarefa 5: a seção 'nota' (uma nota aberta) é desenhada por gestao/notas-compra-nota.js.
  const corpo = notasCompraSecao==='nota' && typeof notaCompraHtml==='function' ? notaCompraHtml() : notasCompraSecao ? notasCompraSecaoHtml() : notasCompraListaHtml();
  el.innerHTML = notasCompraCasca(corpo);
}

function ncSituacaoBusca(c){
  if(!c || !c.liberada) return { txt:'Ainda não liberada', cls:'alerta' };
  return c.busca_ligada ? { txt:'Ligada', cls:'ok' } : { txt:'Desligada', cls:'off' };
}
function ncStatusHtml(){
  const d = notasCompraDados, c = d.config, pend = d.notas.filter(notasCompraPendente).length, b = ncSituacaoBusca(c);
  return `<div class="hub-status"><div><div class="lab">Pendentes</div><div class="big mono" id="ncPendentes">${pend}</div></div>
    <div><div class="lab">Busca automática</div><span class="hub-pill nc-pill-${b.cls}">${b.txt}</span></div>
    <div><div class="lab">Última busca</div><b>${c && c.ultima_busca_ok ? h(dataHoraBR(c.ultima_busca_ok)) : '—'}</b></div>
    ${c && c.ultimo_erro ? `<div class="nc-erro"><div class="lab">Último erro da busca</div><span>${h(c.ultimo_erro)}</span></div>` : ''}</div>`;
}

function ncEtapaHtml(rotulo, v){
  const s = v==='feito' ? ['✓','feito'] : v==='nao_se_aplica' ? ['—','não se aplica'] : ['○','falta'];
  return `<td class="nc-etapa nc-${v}" data-rotulo="${rotulo}"><span title="${rotulo}: ${s[1]}" aria-label="${rotulo}: ${s[1]}">${s[0]}</span></td>`;
}
function ncLinhaHtml(n){
  const e = notasCompraEtapas(n), novos = n.situacao==='completa' && !n.fora && e.estoque==='falta' ? notasCompraItensNovos(n) : 0;
  const tags = [
    n.modelo===65 ? '<span class="nc-tag">NFC-e</span>' : '',
    n.situacao==='cancelada' ? '<span class="nc-tag nc-tag-off">Cancelada</span>' : '',
    n.situacao==='resumo' ? '<span class="nc-tag">Aguardando XML</span>' : '',
    n.fora ? '<span class="nc-tag">Tratada fora</span>' : '',
    novos ? `<span class="nc-tag nc-tag-novo">Itens novos: ${novos}</span>` : ''
  ].join('');
  const forn = n.emitente_nome || (n.emitente_cnpj ? 'CNPJ '+n.emitente_cnpj : 'Fornecedor não informado');
  return `<tr class="nc-linha" data-chave="${h(n.chave)}" tabindex="0" onclick="notasCompraAbrirNota(${jsArg(n.chave)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();notasCompraAbrirNota(${jsArg(n.chave)})}">
    <td class="nc-forn"><b>${h(forn)}</b>${tags?`<span class="nc-tags">${tags}</span>`:''}${n.aviso?`<small class="nc-aviso">${h(n.aviso)}</small>`:''}</td>
    <td class="mono" data-rotulo="Nº">${h(n.numero||'—')}</td><td data-rotulo="Emissão">${ncData(n.emissao)}</td><td class="mono nc-valor" data-rotulo="Valor">${n.valor==null?'—':fmt(n.valor)}</td>
    ${NC_ETAPAS.map(([k,r])=>ncEtapaHtml(r, e[k])).join('')}</tr>`;
}
function notasCompraAbrirNota(chave){
  if(typeof abrirNotaCompra==='function') abrirNotaCompra(chave);
  else toast('Abrir a nota chega na próxima versão.');
}

function notasCompraListaHtml(){
  const d = notasCompraDados;
  const meses = [...new Set(d.notas.map(n=>ncMesDe(n.emissao)).filter(Boolean))].sort().reverse();
  if(notasCompraMes && !meses.includes(notasCompraMes)) meses.unshift(notasCompraMes);
  const lista = d.notas.filter(n => (notasCompraFiltro==='pendentes' ? notasCompraPendente(n) : notasCompraFiltro==='canceladas' ? n.situacao==='cancelada' : true)
    && (!notasCompraMes || ncMesDe(n.emissao)===notasCompraMes));
  const filtros = [['pendentes','Pendentes'],['todas','Todas'],['canceladas','Canceladas']].map(([k,t])=>`<button type="button" role="radio" aria-checked="${notasCompraFiltro===k}" class="${notasCompraFiltro===k?'on':''}" onclick="notasCompraFiltrar(${jsArg(k)})">${t}</button>`).join('');
  const vazio = notasCompraFiltro==='pendentes' ? 'Nenhuma nota pendente. Tudo em dia.' : notasCompraFiltro==='canceladas' ? 'Nenhuma nota cancelada.' : 'Nenhuma nota de compra ainda. Use "Importar XML" para trazer a primeira.';
  const tabela = lista.length ? `<div class="hub-tabela nc-tabela"><table class="cash-movement-table"><thead><tr><th>Fornecedor</th><th>Nº</th><th>Emissão</th><th class="nc-valor">Valor</th>${NC_ETAPAS.map(([,r])=>`<th class="nc-etapa">${r}</th>`).join('')}</tr></thead><tbody>${lista.map(ncLinhaHtml).join('')}</tbody></table></div>`
    : `<p class="hub-vazio">${vazio}</p>`;
  const limite = d.notas.length>=NC_LIMITE ? `<p class="sub">Mostrando as ${NC_LIMITE} notas mais recentes.</p>` : '';
  return `${ncStatusHtml()}<div class="hub-corpo"><div class="hub-filtros nc-filtros"><div class="hub-escolha nc-filtro" role="radiogroup" aria-label="Filtro">${filtros}</div>
    <div class="field"><label for="ncMes">Mês</label><select id="ncMes" onchange="notasCompraEscolherMes(this.value)"><option value="">Todos os meses</option>${meses.map(m=>`<option value="${m}" ${m===notasCompraMes?'selected':''}>${ncMesNome(m)}</option>`).join('')}</select></div></div>
    ${tabela}${limite}</div>`;
}

function notasCompraSecaoHtml(){
  const corpo = notasCompraSecao==='config' ? ncConfigHtml() : ncArquivoHtml();
  return `<div class="hub-trilha"><button type="button" class="cc-voltar" onclick="notasCompraAbrir('')">${ICN.chevLeft}Notas de compra</button><h2>${NC_SECOES[notasCompraSecao]}</h2></div><div class="hub-corpo">${corpo}</div>`;
}

function ncConfigHtml(){
  const c = notasCompraDados.config || {}, b = ncSituacaoBusca(notasCompraDados.config);
  const cnpj = c.cnpj || ncSoDigitos(state.settings && state.settings.cnpj);
  const inicio = c.inicio ? String(c.inicio).slice(0,10) : todayStr();
  return `<div class="hub-form nc-config">
    <div class="field"><label for="ncCnpj">CNPJ do estabelecimento</label><input id="ncCnpj" inputmode="numeric" maxlength="18" autocomplete="off" placeholder="Só os 14 números" value="${h(cnpj)}"><small class="sub">A busca e o XML importado só aceitam notas emitidas para este CNPJ.</small></div>
    <div class="field"><span class="hub-rotulo">Busca automática <span class="hub-pill nc-pill-${b.cls}">${b.txt}</span></span>
      <label class="comp-switch"><input type="checkbox" id="ncBusca" ${c.busca_ligada?'checked':''}><span></span> Buscar as notas na SEFAZ a cada 2 horas</label>
      <small class="sub">A busca automática só funciona depois que a equipe do Commandah liberar para este estabelecimento${c.liberada?' (já liberada)':''}. Enquanto isso, importe o XML das notas.</small></div>
    <div class="field"><label for="ncInicio">Data de início</label><input id="ncInicio" type="date" value="${h(inicio)}"><small class="sub">Notas emitidas antes desta data ficam como "tratadas fora": só consulta e arquivo do contador, sem conferir, sem estoque e sem contas. Mudar a data reclassifica as notas ainda não tratadas (sem nenhuma etapa feita).</small></div>
    <p class="sub nc-ultima">Última busca: <b>${c.ultima_busca_ok ? h(dataHoraBR(c.ultima_busca_ok)) : 'nenhuma ainda'}</b>${c.ultimo_erro ? `<br>Último erro: <b class="nc-erro-txt">${h(c.ultimo_erro)}</b>` : ''}</p>
    <button type="button" class="btn btn-primary hub-acao" id="ncSalvar" onclick="notasCompraConfigSalvar()">Salvar</button></div>`;
}
function ncArquivoHtml(){
  const mes = notasCompraMes || ncMesAtual();
  return `<div class="hub-form"><div class="field"><label for="ncArquivoMes">Mês</label><input id="ncArquivoMes" type="month" value="${h(mes)}"></div>
    <p class="sub">Um arquivo ZIP com o XML de cada nota do mês e uma planilha (fornecedor, CNPJ, número, emissão, valor e etapas) para mandar ao contador.</p>
    <button type="button" class="btn btn-primary hub-acao" id="ncArquivoBaixar" onclick="notasCompraArquivoMes(document.getElementById('ncArquivoMes').value)">Baixar ZIP</button></div>`;
}

function notasCompraConfig(){
  if(!isAdminUser()){ toast('Só o administrador muda a configuração das notas de compra.'); return; }
  if(!notasCompraDados){ notasCompraSecao = 'config'; renderNotasCompra(); return; }
  notasCompraAbrir('config');
}

// Chama a função notas-entrada. Erro HTTP (401/403/400/503) vem com { error }; erro de negócio vem com 200 e { erro }.
async function notasCompraChamar(body){
  try {
    const r = await supabaseClient.functions.invoke('notas-entrada', { body });
    if(r.error){
      let corpo = null; try { corpo = await r.error.context.json(); } catch(e){ /* sem corpo */ }
      return { falha:(corpo && (corpo.error || corpo.erro)) || NC_FORA_DO_AR };
    }
    return r.data || { falha:NC_FORA_DO_AR };
  } catch(e){ return { falha:NC_FORA_DO_AR }; }
}
async function notasCompraRecarregar(){
  try { await notasCompraCarregar(); } catch(e){ toast(e.message||NC_FORA_DO_AR, 'error'); }
  notasCompraDesenhar();
}

const NC_MSG_IMPORTAR = {
  outro_cnpj:'Esta nota é de outro CNPJ (o destinatário não é este estabelecimento).',
  sem_cnpj:'Falta o CNPJ do estabelecimento: o administrador informa em Notas de compra › Configuração.',
  xml_invalido:'Este arquivo não é uma nota fiscal (XML inválido).',
  xml_grande:'Arquivo grande demais para uma nota fiscal.'
};
function ncResultadoImportar(r){
  if(r.falha) return { tipo:'falha', msg:r.falha };
  if(r.erro) return { tipo:'falha', msg:NC_MSG_IMPORTAR[r.erro] || 'Não foi possível importar a nota.' };
  if(r.ja && r.antigo) return { tipo:'ja', msg:'Esta nota já entrou no estoque pela tela antiga (Alterar com NFe).' };
  if(r.ja) return { tipo:'ja', msg:'Esta nota já está na lista.' };
  return { tipo:'ok', msg: r.completou ? 'Nota importada (completou a que a busca já tinha achado).' : 'Nota importada.' };
}
// Importa um ou mais XML escolhidos em #ncXmlArquivo (vários de uma vez: o piloto é só com XML importado).
const notasCompraImportar = singleFlight('notasCompraImportar', async function(){
  const input = document.getElementById('ncXmlArquivo');
  const arquivos = input && input.files ? [...input.files] : [];
  if(!arquivos.length) return;
  if(!notasCompraPodeImportar()){ toast('Sem permissão para importar nota de compra.'); return; }
  const res = [];
  for(const f of arquivos){
    if(f.size > 2000000){ res.push({ tipo:'falha', msg:NC_MSG_IMPORTAR.xml_grande }); continue; }
    let xml = '';
    try { xml = await f.text(); } catch(e){ res.push({ tipo:'falha', msg:'Não foi possível ler o arquivo '+f.name+'.' }); continue; }
    res.push(ncResultadoImportar(await notasCompraChamar({ action:'importar_xml', xml })));
  }
  input.value = '';
  if(res.length===1) toast(res[0].msg, res[0].tipo==='falha' ? 'error' : undefined);
  else {
    const n = t => res.filter(x=>x.tipo===t).length;
    const falhas = res.filter(x=>x.tipo==='falha').map(x=>x.msg);
    toast(`${n('ok')} nota(s) importada(s), ${n('ja')} já estava(m) na lista${falhas.length?`, ${falhas.length} com problema: ${[...new Set(falhas)].join(' ')}`:''}.`, falhas.length ? 'error' : undefined);
  }
  if(res.some(x=>x.tipo==='ok')){
    logAction(`Notas de compra: ${res.filter(x=>x.tipo==='ok').length} XML importado(s)`);
    await notasCompraRecarregar();
  }
});

const notasCompraBuscarAgora = singleFlight('notasCompraBuscarAgora', async function(){
  if(!isAdminUser()){ toast('Só o administrador busca as notas agora.'); return; }
  const bt = document.getElementById('ncBuscarAgora'); if(bt) bt.disabled = true;
  try {
    const r = await notasCompraChamar({ action:'buscar_agora' });
    if(r.falha){ toast(r.falha, 'error'); return; }
    if(r.erro==='nao_liberada'){ toast('A busca automática ainda não foi liberada para este estabelecimento. Enquanto isso, importe o XML das notas.', 'error'); return; }
    if(r.erro==='falha_busca') toast('A busca falhou: '+(r.mensagem||'erro na Brasil NFe')+'.', 'error');
    else toast(r.novas ? `Busca feita: ${r.novas} nota(s) nova(s).` : 'Busca feita: nenhuma nota nova.');
    await notasCompraRecarregar();
  } finally { const b = document.getElementById('ncBuscarAgora'); if(b) b.disabled = false; }
});

const notasCompraArquivoMes = singleFlight('notasCompraArquivoMes', async function(mes){
  if(!hasPerm('contas')){ toast('Só quem cuida das contas baixa o arquivo do mês.'); return; }
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes||''))){ toast('Escolha o mês.'); return; }
  const r = await notasCompraChamar({ action:'arquivo_mes', mes });
  if(r.falha || !r.base64){ toast(r.falha || 'Não foi possível montar o arquivo do mês.', 'error'); return; }
  // t-notas (revisão da tarefa 4): base64 quebrado ou Blob recusado vira aviso, não erro solto no console.
  let href = '';
  try {
    const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    href = URL.createObjectURL(new Blob([bytes], { type:'application/zip' }));
  } catch(e){ toast('Não foi possível montar o arquivo do mês. Tente de novo.', 'error'); return; }
  const a = document.createElement('a');
  a.href = href;
  a.download = r.nome || ('notas-de-compra-'+mes+'.zip');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  logAction('Notas de compra: arquivo de '+ncMesNome(mes)+' baixado');
  toast('Arquivo de '+ncMesNome(mes)+' baixado.');
});

// t-notas: notas_entrada_config_salvar grava p_inicio como veio (null apaga o início); por isso vai sempre o
// valor do campo (vazio = hoje). p_categorias null mantém as categorias lembradas (tarefa 5).
const notasCompraConfigSalvar = singleFlight('notasCompraConfigSalvar', async function(){
  if(!isAdminUser()){ toast('Só o administrador muda a configuração das notas de compra.'); return; }
  const cnpj = ncSoDigitos((document.getElementById('ncCnpj')||{}).value);
  if(cnpj && cnpj.length!==14){ toast('O CNPJ precisa ter 14 números.'); const c=document.getElementById('ncCnpj'); if(c) c.focus(); return; }
  const inicio = String((document.getElementById('ncInicio')||{}).value||'') || todayStr();
  const busca = !!(document.getElementById('ncBusca')||{}).checked;
  const { data, error } = await supabaseClient.rpc('notas_entrada_config_salvar', { p_busca_ligada:busca, p_inicio:inicio, p_categorias:null, p_cnpj:cnpj || null });
  if(error || !data){
    const msg = String((error && error.message) || '');
    toast(/sem permissao/i.test(msg) ? 'Só o administrador muda a configuração das notas de compra.' : /cnpj/i.test(msg) ? 'O CNPJ precisa ter 14 números.' : 'Não foi possível salvar: '+(msg||'erro no servidor')+'.', 'error');
    return;
  }
  if(document.activeElement && typeof document.activeElement.blur==='function') document.activeElement.blur();
  notasCompraDados.config = { ...(notasCompraDados.config||{}), ...data };
  logAction(`Notas de compra: busca automática ${busca?'ligada':'desligada'}, início ${inicio.split('-').reverse().join('/')}`);
  toast('Configuração das notas de compra salva.');
  notasCompraSecao = '';
  // Revisão final (achado 1): a data de início reclassifica as notas ainda não tratadas no servidor; relê a lista.
  await notasCompraRecarregar();
});
