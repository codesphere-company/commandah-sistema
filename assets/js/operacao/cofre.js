/* ============ COFRE ============ */
// cofre (16/11): tela do administrador para o dinheiro que sai da gaveta e vai ao cofre. Só aparece com o caixa
// por operador ligado e só para quem tem a permissão 'cofre' (admin e dono). Tudo é decidido pelo servidor
// (cash_cofre_*): o aparelho só mostra o que ele devolve e chama a ação. Saldo, a recolher e extrato numa tela.
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
function cofreCasca(corpo){
  return `<div class="consumer-workspace"><section class="cash-window"><header class="cash-title">Cofre</header>${corpo}</section></div>`;
}

function cofreDesenhar(){
  const el = document.getElementById('view-cofre'); if(!el || !cofreDados) return;
  const d = cofreDados, caixas = typeof listaDeCaixas==='function' ? listaDeCaixas() : [];
  const de = (document.getElementById('cofreDe')||{}).value || '', ate = (document.getElementById('cofreAte')||{}).value || '';
  const opcCaixas = caixas.map(c=>`<option value="${h(c.id)}">${h(c.nome)}</option>`).join('');
  const uc = d.ultimaContagem;
  const faixa = uc ? `<div class="cash-summary-line">Última contagem: <b class="mono">${fmt(uc.valor)}</b> · ${h(dataHoraBR(uc.em))}${uc.por?' · '+h(uc.por):''}</div>`
    : `<div class="cash-empty" style="padding:12px 0">Conte o cofre para começar o saldo.</div>`;
  const resultado = cofreResultado ? `<div class="cash-summary-line" id="cofreResultado">Esperado: <b class="mono">${fmt(cofreResultado.esperado)}</b> · Contado: <b class="mono">${fmt(cofreResultado.contado)}</b> · Diferença: ${cofreDifHtml(cofreResultado.diferenca)||'—'}</div>` : '';
  const aRecolher = d.aRecolher||[];
  const linhasRec = aRecolher.map(r=>`<tr>
      <td>${h(dataHoraBR(r.lancadoEm))}</td><td>${cofreNomeCaixa(r.caixaId)}</td><td>${h(r.lancadoPorNome||'—')}</td><td>${h(COFRE_ORIGENS[r.origem]||r.origem)}</td>
      <td class="mono">${fmt(r.valor)}</td>
      <td><input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Valor contado" data-cofre-contado="${h(r.id)}" style="width:130px"></td>
      <td><button class="primary" onclick="cofreConfirmar(${jsArg(r.id)})">Confirmar</button></td></tr>`).join('');
  const extrato = (d.extrato||[]).filter(l=>{
    if(l.tipo==='entrada' && l.status!=='confirmado') return false;
    const dia = cofreDiaLocal(l.lancadoEm);
    return (!de || dia>=de) && (!ate || dia<=ate);
  });
  const linhasExt = extrato.map(l=>{
    const entrada = l.tipo==='entrada', contagem = l.tipo==='contagem';
    const valor = contagem ? fmt(l.valor) : (entrada ? '+ ' : '− ')+fmt(entrada && l.valorContado!=null ? l.valorContado : l.valor);
    const dif = entrada ? l.diferenca : (contagem && l.esperado!=null ? Number(l.valor)-Number(l.esperado) : null);
    const quem = entrada && l.confirmadoPorNome ? l.lancadoPorNome+' → '+l.confirmadoPorNome : (l.lancadoPorNome||'—');
    return `<tr><td>${h(dataHoraBR(l.lancadoEm))}</td><td>${h(COFRE_ORIGENS[l.origem]||l.origem)}${l.motivo?' · '+h(l.motivo):''}</td><td>${cofreNomeCaixa(l.caixaId)}</td><td>${h(quem)}</td><td class="mono">${valor}</td><td>${cofreDifHtml(dif)}</td></tr>`;
  }).join('');
  el.innerHTML = cofreCasca(`<div class="cash-layout"><div class="cash-main" style="overflow:auto">
    <div class="cash-summary"><div class="cash-section-title">Saldo do cofre</div>
      <div class="cash-summary-line">Saldo do cofre: <b class="mono" id="cofreSaldo">${fmt(d.saldo)}</b></div>${faixa}${resultado}
      <div class="field" style="max-width:260px"><label>Dinheiro contado no cofre</label><input id="cofreContado" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div>
      <button class="primary" id="cofreContarBtn" onclick="cofreContar()">Contar cofre</button></div>
    <div class="cash-section-title" style="margin-top:16px">A recolher</div>
    ${aRecolher.length?`<table class="cash-movement-table"><thead><tr><th>Quando</th><th>Caixa</th><th>Quem</th><th>Origem</th><th>Valor</th><th>Contado</th><th></th></tr></thead><tbody>${linhasRec}</tbody></table>`:'<div class="cash-empty" style="padding:8px 0">Nada para recolher.</div>'}
    <div class="cash-section-title" style="margin-top:16px">Abastecer caixa</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field"><label>Caixa</label><select id="cofreAbastCaixa">${opcCaixas}</select></div>
      <div class="field"><label>Valor</label><input id="cofreAbastValor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div>
      <div class="field"><label>Motivo (opcional)</label><input id="cofreAbastMotivo" type="text" maxlength="120"></div>
      <button class="primary" onclick="cofreAbastecer()">Abastecer</button></div>
    <div class="cash-section-title" style="margin-top:16px">Outra saída</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field"><label>Valor</label><input id="cofreSaidaValor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div>
      <div class="field"><label>Motivo</label><input id="cofreSaidaMotivo" type="text" maxlength="120"></div>
      <button class="primary" onclick="cofreSaida()">Registrar saída</button></div>
    <div class="cash-section-title" style="margin-top:16px">Recolher de caixa fechado</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field"><label>Caixa</label><select id="cofreRecCaixa">${opcCaixas}</select></div>
      <div class="field"><label>Valor</label><input id="cofreRecValor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00"></div>
      <button class="primary" onclick="cofreRecolherFechado()">Recolher</button></div>
    <div class="cash-section-title" style="margin-top:16px">Extrato</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
      <div class="field"><label>De</label><input id="cofreDe" type="date" value="${h(de)}" onchange="cofreDesenhar()"></div>
      <div class="field"><label>Até</label><input id="cofreAte" type="date" value="${h(ate)}" onchange="cofreDesenhar()"></div></div>
    ${extrato.length?`<table class="cash-movement-table"><thead><tr><th>Quando</th><th>Lançamento</th><th>Caixa</th><th>Quem</th><th>Valor</th><th>Diferença</th></tr></thead><tbody>${linhasExt}</tbody></table>`:'<div class="cash-empty" style="padding:8px 0">Nenhum lançamento neste período.</div>'}
  </div></div>`);
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
  await cofreAtualizar();
});

const cofreSaida = singleFlight('cofreSaida', async function(){
  const valor = cofreLerValor('cofreSaidaValor', 'Informe o valor.'); if(valor===null) return;
  const motivo = String((document.getElementById('cofreSaidaMotivo')||{}).value||'').trim();
  if(!motivo){ toast('Informe o motivo.'); const m=document.getElementById('cofreSaidaMotivo'); if(m) m.focus(); return; }
  const r = await cofreChamar('cash_cofre_saida', { p_valor:valor, p_motivo:motivo }); if(!r) return;
  logAction('Cofre: saída de '+fmt(valor)+' ('+motivo+')');
  toast('Saída registrada.');
  await cofreAtualizar();
});

const cofreContar = singleFlight('cofreContar', async function(){
  const contado = cofreLerValor('cofreContado', 'Informe o dinheiro contado no cofre.', true); if(contado===null) return;
  const r = await cofreChamar('cash_cofre_contar', { p_contado:contado, p_nota:'' }); if(!r) return;
  cofreResultado = { esperado:r.esperado, contado, diferenca:r.diferenca };
  logAction('Cofre: contagem de '+fmt(contado)+(r.esperado!=null?' (esperado '+fmt(r.esperado)+')':''));
  toast('Cofre contado.');
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
  await cofreAtualizar();
});
