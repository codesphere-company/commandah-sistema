/* ============ COFRE ============ */
// cofre (16/11): tela do administrador para o dinheiro que sai da gaveta e vai ao cofre. Só aparece com o caixa
// por operador ligado e só para quem tem a permissão 'cofre' (admin e dono). Tudo é decidido pelo servidor
// (cash_cofre_*): o aparelho só mostra o que ele devolve e chama a ação. 26/11: início com o saldo e uma escolha por ação.
let cofreDados = null;          // última leitura do servidor (cash_cofre_ler)
let cofreResultado = null;      // resultado da última contagem: { esperado, contado, diferenca }
let cofreCarregando = false;
let cofreRedesenhar = false; // cofre (16/11): ação terminou durante uma leitura de fundo; refaz a leitura ao fim dela

const COFRE_ORIGENS = {
  fim_da_noite:'Fim da noite', sangria:'Sangria', recolher_fechado:'Recolhido de caixa fechado',
  abastecer:'Abastecer caixa', outra:'Outra saída', contagem:'Contagem do cofre'
};

// Data local (aaaa-mm-dd) de um instante, para o filtro do extrato.
function cofreDiaLocal(iso){
  const d = new Date(iso); if(isNaN(d)) return '';
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function cofreDifHtml(dif){
  if(dif==null || Math.abs(Number(dif))<0.005) return '—';
  const n = Number(dif);
  return `<b class="mono ${n<0?'cash-short':'cash-over'}">${n<0?'Falta ':'Sobra '}${fmt(Math.abs(n))}</b>`;
}
function cofreNomeCaixa(id){ return id ? h(nomeDoCaixa(id)) : '—'; }

// Lê um valor em reais de um campo; avisa e devolve null se estiver vazio ou inválido.
function cofreLerValor(id, aviso, aceitaZero){
  const el = document.getElementById(id) || document.querySelector('[data-cofre-contado="'+String(id).replace(/"/g,'')+'"]');
  const raw = el ? String(el.value||'').trim() : '', v = parseFloat(raw.replace(',', '.'));
  if(!raw || !Number.isFinite(v) || v<0 || (!aceitaZero && v<=0)){ toast(aviso); if(el) el.focus(); return null; }
  return arredondaCentavos(v);
}

// Chama uma função do servidor e traduz o erro; devolve os dados ou null.
async function cofreChamar(nome, args){
  const { data, error } = await supabaseClient.rpc(nome, args);
  if(error || !data){
    const msg = String((error && error.message) || '');
    if(/sem permissao/i.test(msg)) toast('Só administrador mexe no cofre.', 'error');
    else if(/desligado/i.test(msg)) toast('O caixa por operador está desligado.', 'error');
    else if(/motivo obrigatorio/i.test(msg)) toast('Informe o motivo.');
    else if(/valor invalido/i.test(msg)) toast('Informe um valor maior que zero.');
    else toast('Não foi possível falar com o cofre: '+(msg||'erro no servidor')+'. Tente de novo.', 'error');
    return null;
  }
  return data;
}

async function renderCofre(){
  const el = document.getElementById('view-cofre');
  if(!el || activeView!=='cofre') return;
  // Quem está digitando num campo da tela não perde o que escreveu por causa de um renderAll de fundo.
  const foco = document.activeElement;
  if(cofreDados && foco && el.contains(foco) && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName)) return;
  if(cofreCarregando){ cofreRedesenhar = true; return; }
  if(!isCloudMode() || !modoCaixaPorOperador()){ el.innerHTML = cofreCasca('<div class="cash-empty">O cofre precisa do caixa por operador ligado em Configurações.</div>'); return; }
  cofreCarregando = true;
  try{
    const { data, error } = await supabaseClient.rpc('cash_cofre_ler');
    if(error || !data){ if(!cofreDados) el.innerHTML = cofreCasca('<div class="cash-empty">Não foi possível ler o cofre. Tente de novo.</div>'); else toast('Não foi possível atualizar o cofre.', 'error'); return; }
    cofreDados = data;
  } finally { cofreCarregando = false; }
  cofreDesenhar();
  if(cofreRedesenhar){ cofreRedesenhar = false; renderCofre(); }
}
// 26/11 (dono aprovou a maquete "no padrão do app do garçom"): a tela era uma coluna de 300 px com as seis
// ações empilhadas e botões sem estilo; Abastecer, Outra saída, Recolher e Extrato ficavam duas telas abaixo.
// Agora o início mostra o saldo no topo e uma escolha por ação (cc-item, o mesmo da central de Configurações);
// tocar entra na ação, com a barra "‹ Cofre". Os ids dos campos e as funções de ação não mudaram.
let cofreSecao = '';            // '' = início; senão a chave de COFRE_SECOES
const cofreCaixaEscolhido = { abastecer:'', recolher:'' }; // caixa escolhido nos botões grandes de cada ação
const COFRE_SECOES = {
  recolher:  { titulo:'A recolher', desc:'Sangrias e fins de noite esperando conferência.', icon:'arrowDownBox' },
  contar:    { titulo:'Contar cofre', desc:'Conferir o dinheiro que está no cofre.', icon:'cash' },
  abastecer: { titulo:'Abastecer caixa', desc:'Levar troco do cofre para um caixa.', icon:'swap' },
  fechado:   { titulo:'Recolher de caixa fechado', desc:'Trazer o dinheiro que ficou num caixa já fechado.', icon:'cashbox' },
  saida:     { titulo:'Outra saída', desc:'Pagamento ou retirada, com motivo.', icon:'arrowUpBox' },
  extrato:   { titulo:'Extrato', desc:'Tudo que entrou e saiu do cofre, por período.', icon:'history' }
};

function cofreCasca(corpo){
  return `<div class="hub"><div class="cc-head"><h1>Cofre</h1></div>${corpo}</div>`;
}

// Entra numa ação (ou volta ao início com ''). Leva o foco ao primeiro campo, como no app do garçom.
function cofreAbrir(sec){
  cofreSecao = COFRE_SECOES[sec] ? sec : '';
  cofreDesenhar();
  const el = document.getElementById('view-cofre'); if(!el) return;
  const alvo = cofreSecao ? el.querySelector('.hub-corpo input:not([type=date]):not([hidden])') : el.querySelector('.cc-item');
  if(alvo) alvo.focus();
  el.scrollTop = 0;
}
function cofreEscolherCaixa(acao, id){
  cofreCaixaEscolhido[acao] = id;
  // Guarda o que já foi digitado: o redesenho troca o HTML da ação.
  const ids = acao==='abastecer' ? ['cofreAbastValor','cofreAbastMotivo'] : ['cofreRecValor'];
  const vals = ids.map(i=>(document.getElementById(i)||{}).value||'');
  cofreDesenhar();
  ids.forEach((i,n)=>{ const e=document.getElementById(i); if(e) e.value = vals[n]; });
  const v = document.getElementById(ids[0]); if(v) v.focus();
}

// Botões grandes de caixa (no lugar da lista suspensa) + o select escondido com o mesmo id de antes,
// que é o que as funções de ação leem.
function cofreEscolhaCaixa(acao, idCampo){
  const caixas = typeof listaDeCaixas==='function' ? listaDeCaixas() : [];
  if(!caixas.some(c=>c.id===cofreCaixaEscolhido[acao])) cofreCaixaEscolhido[acao] = caixas.length ? caixas[0].id : '';
  const atual = cofreCaixaEscolhido[acao];
  return `<div class="field"><span class="hub-rotulo">Caixa</span><div class="hub-escolha" role="radiogroup" aria-label="Caixa">${caixas.map(c=>`<button type="button" role="radio" aria-checked="${c.id===atual}" class="${c.id===atual?'on':''}" data-cofre-caixa="${h(c.id)}" onclick="cofreEscolherCaixa(${jsArg(acao)},${jsArg(c.id)})">${h(c.nome)}</button>`).join('')}</div>
    <select id="${idCampo}" hidden aria-hidden="true" tabindex="-1">${caixas.map(c=>`<option value="${h(c.id)}" ${c.id===atual?'selected':''}>${h(c.nome)}</option>`).join('')}</select></div>`;
}
function cofreCampoValor(id, rotulo){
  return `<div class="field"><label for="${id}">${rotulo}</label><input id="${id}" class="hub-valor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div>`;
}

function cofreInicioHtml(d){
  const uc = d.ultimaContagem, aRec = (d.aRecolher||[]).length;
  const contagem = uc ? `<div><div class="lab">Última contagem</div><b class="mono">${fmt(uc.valor)}</b> <span class="sub">· ${h(dataHoraBR(uc.em))}${uc.por?' · '+h(uc.por):''}</span></div>`
    : `<div class="sub">Conte o cofre para começar o saldo.</div>`;
  const resultado = cofreResultado ? `<div id="cofreResultado"><div class="lab">Contagem agora</div>Esperado: <b class="mono">${fmt(cofreResultado.esperado)}</b> · Contado: <b class="mono">${fmt(cofreResultado.contado)}</b> · Diferença: ${cofreDifHtml(cofreResultado.diferenca)||'—'}</div>` : '';
  const itens = Object.keys(COFRE_SECOES).map(k=>{
    const s = COFRE_SECOES[k];
    const cont = k==='recolher' && aRec ? ` <span class="hub-cont">${aRec}</span>` : '';
    return `<button type="button" class="cc-item" onclick="cofreAbrir(${jsArg(k)})"><span class="ic">${ICN[s.icon]||''}</span><span class="tx"><span class="t">${h(s.titulo)}${cont}</span><span class="d">${h(s.desc)}</span></span><span class="go">${ICN.chevRight}</span></button>`;
  }).join('');
  return `<div class="hub-status"><div><div class="lab">Saldo do cofre</div><div class="big mono" id="cofreSaldo">${fmt(d.saldo)}</div></div>${contagem}${resultado}</div>
    <div class="cc-lista">${itens}</div>`;
}

function cofreExtratoHtml(d){
  const de = (document.getElementById('cofreDe')||{}).value || '', ate = (document.getElementById('cofreAte')||{}).value || '';
  const extrato = (d.extrato||[]).filter(l=>{
    if(l.tipo==='entrada' && l.status!=='confirmado') return false;
    const dia = cofreDiaLocal(l.lancadoEm);
    return (!de || dia>=de) && (!ate || dia<=ate);
  });
  const linhas = extrato.map(l=>{
    const entrada = l.tipo==='entrada', contagem = l.tipo==='contagem';
    const valor = contagem ? fmt(l.valor) : (entrada ? '+ ' : '− ')+fmt(entrada && l.valorContado!=null ? l.valorContado : l.valor);
    const dif = entrada ? l.diferenca : (contagem && l.esperado!=null ? Number(l.valor)-Number(l.esperado) : null);
    const quem = entrada && l.confirmadoPorNome ? l.lancadoPorNome+' → '+l.confirmadoPorNome : (l.lancadoPorNome||'—');
    return `<tr><td>${h(dataHoraBR(l.lancadoEm))}</td><td>${h(COFRE_ORIGENS[l.origem]||l.origem)}${l.motivo?' · '+h(l.motivo):''}</td><td>${cofreNomeCaixa(l.caixaId)}</td><td>${h(quem)}</td><td class="mono">${valor}</td><td>${cofreDifHtml(dif)}</td></tr>`;
  }).join('');
  return `<div class="hub-filtros"><div class="field"><label for="cofreDe">De</label><input id="cofreDe" type="date" value="${h(de)}" onchange="cofreDesenhar()"></div><div class="field"><label for="cofreAte">Até</label><input id="cofreAte" type="date" value="${h(ate)}" onchange="cofreDesenhar()"></div></div>
    ${extrato.length?`<div class="hub-tabela"><table class="cash-movement-table"><thead><tr><th>Quando</th><th>Lançamento</th><th>Caixa</th><th>Quem</th><th>Valor</th><th>Diferença</th></tr></thead><tbody>${linhas}</tbody></table></div>`:'<p class="hub-vazio">Nenhum lançamento neste período.</p>'}`;
}

function cofreSecaoHtml(d){
  const s = COFRE_SECOES[cofreSecao];
  let corpo = '';
  if(cofreSecao==='recolher'){
    const aRecolher = d.aRecolher||[];
    corpo = aRecolher.length ? `<div class="hub-tabela"><table class="cash-movement-table"><thead><tr><th>Quando</th><th>Caixa</th><th>Quem</th><th>Origem</th><th>Valor</th><th>Contado</th><th></th></tr></thead><tbody>${aRecolher.map(r=>`<tr>
      <td>${h(dataHoraBR(r.lancadoEm))}</td><td>${cofreNomeCaixa(r.caixaId)}</td><td>${h(r.lancadoPorNome||'—')}</td><td>${h(COFRE_ORIGENS[r.origem]||r.origem)}</td>
      <td class="mono">${fmt(r.valor)}</td>
      <td><input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Valor contado" aria-label="Valor contado" data-cofre-contado="${h(r.id)}" class="hub-contado"></td>
      <td><button type="button" class="btn btn-primary" onclick="cofreConfirmar(${jsArg(r.id)})">Confirmar</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hub-vazio">Nada para recolher.</p>';
  } else if(cofreSecao==='contar'){
    corpo = `<div class="hub-form">${cofreCampoValor('cofreContado','Dinheiro contado no cofre')}<p class="sub">Saldo no sistema: <b class="mono">${fmt(d.saldo)}</b>. A diferença aparece depois de contar.</p><button type="button" class="btn btn-primary hub-acao" id="cofreContarBtn" onclick="cofreContar()">Contar cofre</button></div>`;
  } else if(cofreSecao==='abastecer'){
    corpo = `<div class="hub-form">${cofreEscolhaCaixa('abastecer','cofreAbastCaixa')}${cofreCampoValor('cofreAbastValor','Valor')}<div class="field"><label for="cofreAbastMotivo">Motivo (opcional)</label><input id="cofreAbastMotivo" type="text" maxlength="120"></div><button type="button" class="btn btn-primary hub-acao" onclick="cofreAbastecer()">Abastecer ${h(cofreCaixaEscolhido.abastecer?nomeDoCaixa(cofreCaixaEscolhido.abastecer):'caixa')}</button></div>`;
  } else if(cofreSecao==='fechado'){
    corpo = `<div class="hub-form">${cofreEscolhaCaixa('recolher','cofreRecCaixa')}${cofreCampoValor('cofreRecValor','Valor')}<p class="sub">Depois, confirme em "A recolher" quando o dinheiro chegar ao cofre.</p><button type="button" class="btn btn-primary hub-acao" onclick="cofreRecolherFechado()">Recolher</button></div>`;
  } else if(cofreSecao==='saida'){
    corpo = `<div class="hub-form">${cofreCampoValor('cofreSaidaValor','Valor')}<div class="field"><label for="cofreSaidaMotivo">Motivo</label><input id="cofreSaidaMotivo" type="text" maxlength="120"></div><button type="button" class="btn btn-primary hub-acao" onclick="cofreSaida()">Registrar saída</button></div>`;
  } else if(cofreSecao==='extrato'){
    corpo = cofreExtratoHtml(d);
  }
  return `<div class="hub-trilha"><button type="button" class="cc-voltar" onclick="cofreAbrir('')">${ICN.chevLeft}Cofre</button><h2>${h(s.titulo)}</h2><span class="hub-saldo">Saldo: <b class="mono">${fmt(d.saldo)}</b></span></div><div class="hub-corpo">${corpo}</div>`;
}

function cofreDesenhar(){
  const el = document.getElementById('view-cofre'); if(!el || !cofreDados) return;
  el.innerHTML = cofreCasca(cofreSecao ? cofreSecaoHtml(cofreDados) : cofreInicioHtml(cofreDados));
}

// Depois de qualquer ação: lê de novo do servidor e desenha (o foco já saiu do campo, então o render passa).
async function cofreAtualizar(){
  if(document.activeElement && typeof document.activeElement.blur==='function') document.activeElement.blur();
  await renderCofre();
}

const cofreConfirmar = singleFlight('cofreConfirmar', async function(id){
  const contado = cofreLerValor(id, 'Informe o valor contado.', true); if(contado===null) return;
  const r = await cofreChamar('cash_cofre_confirmar', { p_id:id, p_contado:contado }); if(!r) return;
  if(!r.ok){
    toast(r.motivo==='ja_confirmado' ? 'Esse recolhimento já foi confirmado.' : 'Esse recolhimento não existe mais.', 'error');
    await cofreAtualizar(); return;
  }
  const dif = Number(r.diferenca)||0;
  logAction('Cofre: recolhimento confirmado — contado '+fmt(contado)+(Math.abs(dif)>=0.005?' (diferença '+fmt(dif)+')':''));
  toast(Math.abs(dif)>=0.005 ? 'Recolhimento confirmado com diferença de '+fmt(dif)+'.' : 'Recolhimento confirmado.');
  await cofreAtualizar();
});

const cofreAbastecer = singleFlight('cofreAbastecer', async function(){
  const caixa = (document.getElementById('cofreAbastCaixa')||{}).value || '';
  const valor = cofreLerValor('cofreAbastValor', 'Informe o valor.'); if(valor===null) return;
  if(!caixa){ toast('Escolha o caixa.'); return; }
  const motivo = String((document.getElementById('cofreAbastMotivo')||{}).value||'').trim();
  const r = await cofreChamar('cash_cofre_abastecer', { p_caixa:caixa, p_valor:valor, p_motivo:motivo }); if(!r) return;
  if(!r.ok){
    toast(r.motivo==='travado' ? 'Esse caixa está travado. Resolva a contagem antes de abastecer.' : 'Não foi possível abastecer o caixa.', 'error');
    return;
  }
  logAction('Cofre: abastecido '+nomeDoCaixa(caixa)+' com '+fmt(valor)+(motivo?' ('+motivo+')':''));
  toast('Caixa abastecido.');
  cofreSecao = ''; // 26/11: feita a ação, volta ao início do cofre
  await cofreAtualizar();
});

const cofreSaida = singleFlight('cofreSaida', async function(){
  const valor = cofreLerValor('cofreSaidaValor', 'Informe o valor.'); if(valor===null) return;
  const motivo = String((document.getElementById('cofreSaidaMotivo')||{}).value||'').trim();
  if(!motivo){ toast('Informe o motivo.'); const m=document.getElementById('cofreSaidaMotivo'); if(m) m.focus(); return; }
  const r = await cofreChamar('cash_cofre_saida', { p_valor:valor, p_motivo:motivo }); if(!r) return;
  logAction('Cofre: saída de '+fmt(valor)+' ('+motivo+')');
  toast('Saída registrada.');
  cofreSecao = '';
  await cofreAtualizar();
});

const cofreContar = singleFlight('cofreContar', async function(){
  const contado = cofreLerValor('cofreContado', 'Informe o dinheiro contado no cofre.', true); if(contado===null) return;
  const r = await cofreChamar('cash_cofre_contar', { p_contado:contado, p_nota:'' }); if(!r) return;
  cofreResultado = { esperado:r.esperado, contado, diferenca:r.diferenca };
  logAction('Cofre: contagem de '+fmt(contado)+(r.esperado!=null?' (esperado '+fmt(r.esperado)+')':''));
  toast('Cofre contado.');
  cofreSecao = ''; // o resultado (esperado, contado, diferença) aparece no topo do início
  await cofreAtualizar();
});

const cofreRecolherFechado = singleFlight('cofreRecolherFechado', async function(){
  const caixa = (document.getElementById('cofreRecCaixa')||{}).value || '';
  const valor = cofreLerValor('cofreRecValor', 'Informe o valor.'); if(valor===null) return;
  if(!caixa){ toast('Escolha o caixa.'); return; }
  const r = await cofreChamar('cash_cofre_recolher_fechado', { p_caixa:caixa, p_valor:valor }); if(!r) return;
  if(!r.ok){
    toast(r.motivo==='turno_aberto' ? 'Esse caixa está aberto. Feche o caixa antes de recolher.' : r.motivo==='valor_maior' ? 'O valor é maior que o dinheiro que sobrou nesse caixa.' : 'Não foi possível recolher.', 'error');
    return;
  }
  logAction('Cofre: recolhido '+fmt(valor)+' do '+nomeDoCaixa(caixa)+' (caixa fechado)');
  toast('Recolhimento lançado. Confirme quando o dinheiro chegar ao cofre.');
  cofreSecao = '';
  await cofreAtualizar();
});
