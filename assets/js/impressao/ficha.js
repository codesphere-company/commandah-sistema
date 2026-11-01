/* ============ MODELO DA FICHA (t217, 01/11) ============
   Pedido do dono: "preciso poder configurar tudo na ficha de impressão: um lugar na
   configuração onde possa colocar e tirar campos". Em Configurações › Impressoras ›
   Modelo da ficha cada campo liga/desliga, muda de ordem e pode sair grande ou em
   negrito, com a ficha desenhada ao lado (80 ou 58 mm).
   Também saem aqui os adicionais e a observação do item ("sem cebola"), que só a tela
   da cozinha mostrava.
   Compatibilidade (fotos de 01/11): a Bematech MP-4200 da cozinha imprimia com a letra
   pequena de fábrica e a App-tech Q851L (churrasqueira, bar, caixa) ignorava o GS ! da
   letra grande. Por padrão a ficha pede a fonte A (ESC M 0) e manda a letra grande pelos
   dois comandos (ESC ! e GS !).
   A ficha vira uma lista de linhas ({label, value, size, bold} ou {sep}); daí sai o
   ESC/POS (impressora de rede), o texto simples (impressora do Windows) e o HTML (prévia
   e janela "Imprimir aqui"), todos com a mesma quebra de linha.
   Configuração em state.settings.ticketConfig (campos novos convivem com os antigos:
   nomeProdutoTamanho, entregaDestaque, mostrarPrecoProducao). */
const FICHA_CAMPOS = [
  { k:'estacao',    n:'Estação (título)',     def:{ on:true, negrito:true } },
  { k:'pedido',     n:'Número do pedido',     def:{ on:true } },
  { k:'datahora',   n:'Data e horário',       def:{ on:true } },
  { k:'cota',       n:'Cota',                 def:{ on:true } },
  { k:'nome',       n:'Nome do cliente',      def:{ on:true } },
  { k:'lancadoPor', n:'Quem lançou',          def:{ on:true } },
  { k:'praOnde',    n:'Pra onde vai',         def:{ on:true, negrito:true } },
  { k:'origem',     n:'Origem do pedido',     def:{ on:false } },
  { k:'produtos',   n:'Produtos',             def:{ on:true }, fixed:true },
  { k:'total',      n:'Total',                def:{ on:true } }
];
const FICHA_HINT = {
  cota:'Sem sócio sai "FICHA".', nome:'Sem nome sai "Consumidor não identificado".',
  praOnde:'Sem local sai "RETIRAR NO BALCÃO". Não sai no comprovante do caixa.',
  lancadoPor:'Não sai no comprovante do caixa.', origem:'Caixa, App do Garçom...',
  total:'Só quando a ficha mostra preço.', pedido:'Logo antes de "Data e horário", os dois dividem a linha.'
};
// Sem sócio sai "Cota: FICHA"; sem nome, "Consumidor não identificado"; sem local, "Retirar no balcão" (t216).
const TICKET_ANON_NAMES = ['', 'cliente avulso', 'cliente', 'avulso', 'consumidor'];
function ticketFields(who, cota, local, items){
  const name = String(who||'').trim();
  const lancou = ((items||[]).map(i=>i.addedBy).find(Boolean)) || (currentUser&&currentUser.name) || '';
  return {
    cota: String(cota||'').trim() || 'FICHA',
    nome: TICKET_ANON_NAMES.includes(name.toLowerCase()) ? 'Consumidor não identificado' : name,
    lancadoPor: lancou,
    praOnde: String(local||'').trim() || 'Retirar no balcão'
  };
}
// Junta o que está salvo com os campos que existem (campo novo entra na posição de fábrica).
function fichaConfig(raw){
  const c = raw || (state.settings && state.settings.ticketConfig) || {};
  const campos = [];
  (Array.isArray(c.campos) ? c.campos : []).forEach(s=>{
    const d = FICHA_CAMPOS.find(f=>f.k===(s&&s.k));
    if(d && !campos.some(x=>x.k===d.k)) campos.push({ k:d.k, on: d.fixed ? true : s.on!==false, grande:!!s.grande, negrito:!!s.negrito });
  });
  FICHA_CAMPOS.forEach((d, idx)=>{
    if(campos.some(x=>x.k===d.k)) return;
    const v = { k:d.k, on: d.fixed ? true : !!d.def.on, grande:!!d.def.grande, negrito:!!d.def.negrito };
    if(d.k==='praOnde' && c.entregaDestaque===false) v.negrito = false; // opção antiga
    campos.splice(Math.min(idx, campos.length), 0, v);
  });
  return {
    campos,
    nomeProdutoTamanho: ['normal','grande','extra'].includes(c.nomeProdutoTamanho) ? c.nomeProdutoTamanho : 'grande',
    mostrarPrecoProducao: !!c.mostrarPrecoProducao,
    mostrarAdicionais: c.mostrarAdicionais!==false,
    mostrarObs: c.mostrarObs!==false,
    fonteA: c.fonteA!==false,
    letraGrandeDupla: c.letraGrandeDupla!==false
  };
}
function buildTicketLines(who, cota, local, estacao, items, orderNumber, payLines, footer, cfg){
  const c = fichaConfig(cfg), f = ticketFields(who, cota, local, items), isCaixa = estacao==='caixa';
  const showPrices = isCaixa || c.mostrarPrecoProducao;
  const L = [];
  // Separadores seguidos viram um só (o mais forte).
  const sep = ch=>{ const last = L[L.length-1]; if(last && last.sep){ if(ch==='='||ch==='*') last.sep = ch; return; } L.push({ sep:ch }); };
  const txt = (label, value, o, extra)=>L.push(Object.assign({ label, value:String(value==null?'':value), size:o&&o.grande?2:1, bold:!!(o&&o.negrito) }, extra||{}));
  const quando = new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).replace(',','');
  const total = (items||[]).reduce((a,i)=>a+(Number(i.price)||0)*(Number(i.qty)||0), 0);
  const prodSize = { normal:1, grande:2, extra:3 }[c.nomeProdutoTamanho] || 2;
  const on = c.campos.filter(x=>x.on);
  sep('=');
  for(let i=0; i<on.length; i++){
    const x = on[i];
    if(x.k==='estacao'){ txt('', isCaixa ? 'COMPROVANTE DE VENDA' : String(estacaoLabel(estacao)||estacao||'').toUpperCase(), x); sep('='); }
    else if(x.k==='pedido'){
      const p = 'Pedido'+(orderNumber ? ' #'+orderNumber : ''), next = on[i+1];
      if(next && next.k==='datahora' && !x.grande && !next.grande){ txt('', p, { negrito: x.negrito||next.negrito }, { right:quando }); i++; }
      else txt('', p, x);
    }
    else if(x.k==='datahora') txt('', quando, x);
    if((x.k==='pedido' || x.k==='datahora') && on[i+1] && ['cota','nome','lancadoPor','praOnde','origem'].includes(on[i+1].k)) sep('-'); // como no modelo aprovado (t216)
    else if(x.k==='cota') txt('Cota: ', f.cota, x);
    else if(x.k==='nome') txt('Nome: ', f.nome, x);
    else if(x.k==='lancadoPor'){ if(!isCaixa && f.lancadoPor) txt('Lançado por: ', f.lancadoPor, x); }
    else if(x.k==='praOnde'){ if(!isCaixa) txt('Pra onde: ', f.praOnde.toUpperCase(), x); }
    else if(x.k==='origem'){ const o = currentUser && currentUser.origem; if(o) txt('Origem: ', origemLabel(o), x); }
    else if(x.k==='total'){ if(showPrices) txt('TOTAL: ', fmt(total), x); }
    else if(x.k==='produtos'){
      sep('-');
      (items||[]).forEach(it=>{
        L.push({ label:'', value: it.qty+'x '+it.name+(it.copos!=null ? ' — '+it.copos+' copo'+(it.copos===1?'':'s') : ''), size:prodSize, bold:false });
        if(c.mostrarAdicionais && typeof kitchenItemExtras==='function') kitchenItemExtras(it).forEach(e=>L.push({ label:'  + ', value:e, size:1, bold:false }));
        if(c.mostrarObs && typeof kitchenItemNote==='function'){ const n = kitchenItemNote(it); if(n) L.push({ label:'  OBS: ', value:n, size:1, bold:true }); }
        if(showPrices) L.push({ label:'', value:fmt((Number(it.price)||0)*(Number(it.qty)||0)), size:1, bold:false });
      });
      const segurar = (items||[]).some(i=>i.levarJunto), juntoCom = [...new Set((items||[]).map(i=>i.levarJuntoCom).filter(Boolean))].join(', ');
      if(segurar){ sep('*'); ['*** SEGURAR ***','LEVAR JUNTO','COM A COMIDA'].forEach(t=>L.push({ label:'', value:t, size:2, bold:false })); sep('*'); }
      if(juntoCom){ sep('*'); L.push({ label:'', value:'LEVAR JUNTO:', size:2, bold:false }); L.push({ label:'', value:juntoCom, size:1, bold:false }); L.push({ label:'', value:'(bebida no bar)', size:1, bold:false }); sep('*'); }
      sep('-');
    }
  }
  // Comprovante: formas de pagamento, troco e texto de rodapé (só o printCaixaReceipt passa).
  if(payLines && payLines.length){ sep('-'); payLines.forEach(l=>L.push({ label:'', value:l, size:1, bold:false })); }
  const rodape = String(footer||'').trim();
  if(rodape){ sep('-'); rodape.split('\n').forEach(l=>L.push({ label:'', value:l, size:1, bold:false })); }
  sep('=');
  return L;
}
// Quebra uma linha em pedaços que cabem no papel (letra grande ocupa 2 ou 3 colunas).
function fichaRows(l, W){
  const max = Math.max(4, Math.floor(W/(l.size||1)));
  const full = (l.label||'') + (l.value||'');
  if(l.right!=null){
    if(full.length + 1 + l.right.length <= max) return [full + ' '.repeat(max-full.length-l.right.length) + l.right];
    return fichaWrap(full, max).concat(fichaWrap(l.right, max));
  }
  return fichaWrap(full, max);
}
function fichaWrap(t, max){
  const rows = []; let cur = '';
  String(t).split('\n').forEach(part=>{
    const lead = (part.match(/^\s*/)||[''])[0]; // mantém o recuo do "  + adicional"
    cur = lead;
    part.trim().split(/\s+/).filter(Boolean).forEach(w=>{
      while(w.length > max){ if(cur.trim()){ rows.push(cur); cur = ''; } rows.push(w.slice(0, max)); w = w.slice(max); }
      if(!w) return;
      if(!cur.trim()) cur = cur + w;
      else if((cur+' '+w).length <= max) cur += ' '+w;
      else { rows.push(cur); cur = w; }
    });
    if(cur.trim()) rows.push(cur);
    cur = '';
  });
  return rows.length ? rows : [''];
}
function ticketLinesToPlain(L, W){
  return L.map(l=>l.sep ? l.sep.repeat(W) : fichaRows(Object.assign({}, l, { size:1 }), W).join('\n')).join('\n') + '\n\n\n';
}
function ticketLinesToEscPos(L, W, cfg){
  const c = fichaConfig(cfg), Z = NUL_PLACEHOLDER;
  // ESC ! '0' (0x30) = altura e largura dobradas; GS ! 0x11 (2x) ou 0x22 (3x). GS ! vem depois:
  // na impressora que entende os dois, vale o último. ESC E '1'/'0' liga/desliga negrito.
  const sizeOn = s => s<2 ? '' : (c.letraGrandeDupla ? '\x1B!0' : '') + '\x1D!' + (s===3 ? '\x22' : '\x11');
  const sizeOff = s => s<2 ? '' : (c.letraGrandeDupla ? '\x1B!'+Z : '') + '\x1D!'+Z;
  let out = '\x1B@' + (c.fonteA ? '\x1BM0' : '');
  L.forEach(l=>{
    if(l.sep){ out += l.sep.repeat(W) + '\n'; return; }
    out += sizeOn(l.size) + (l.bold ? '\x1BE1' : '') + fichaRows(l, W).join('\n') + (l.bold ? '\x1BE0' : '') + sizeOff(l.size) + '\n';
  });
  // Sem driver no meio: texto sem acento (o code page da térmica é incerto) e corte no fim.
  return stripAccentsForPrint(out) + '\n\n\n\x1D\x56\x01';
}
// HTML com estilo próprio (serve na prévia e na janela "Imprimir aqui", que não tem o CSS do app).
function ticketLinesToHtml(L, W){
  const rows = L.map(l=>{
    if(l.sep) return `<div style="white-space:pre;overflow:hidden">${h(l.sep.repeat(W))}</div>`;
    const st = 'white-space:pre;line-height:1.15;'+(l.size>1 ? 'font-size:'+(l.size*100)+'%;' : '')+(l.bold ? 'font-weight:700;' : '');
    return fichaRows(l, W).map(r=>`<div style="${st}">${h(r)||'&nbsp;'}</div>`).join('');
  }).join('');
  return `<div style="font-family:Consolas,'Courier New',monospace;font-size:12px;width:${W}ch;max-width:100%;color:#111">${rows}</div>`;
}
function buildTicketText(who, cota, local, estacao, items, orderNumber, columns, escPos, payLines, footer){
  const W = columns || 48;
  const L = buildTicketLines(who, cota, local, estacao, items, orderNumber, payLines, footer);
  return escPos ? ticketLinesToEscPos(L, W) : ticketLinesToPlain(L, W);
}

/* ---------- Tela: Configurações › Impressoras › Modelo da ficha ---------- */
let fichaDraft = null, fichaDirty = false, fichaPreviewPaper = 80, fichaPreviewSample = 'anon';
function fichaSample(kind){
  const nomeUser = (currentUser && currentUser.name) || 'João';
  const items = [
    { qty:1, name:'X-Bacon', price:28, addedBy:nomeUser, customization:{ complements:[{ name:'Bacon extra' }], notes:'sem cebola' } },
    { qty:2, name:'Espeto de alcatra', price:15, addedBy:nomeUser }
  ];
  if(kind==='socio') return ['Maria Silva', '1801', 'Mesa 7', 'cozinha', items, 41, null, ''];
  if(kind==='caixa') return ['', '', '', 'caixa', items, 43, ['Pix: '+fmt(58)], state.settings.receiptFooter||''];
  return ['', '', '', 'cozinha', items, 42, null, ''];
}
function renderTicketConfigHtml(){
  // Só quem grava settings vê o bloco (o banco recusaria o "Salvar").
  if(!hasPerm('config-sistema')) return '';
  return `<div id="fichaConfigBox" class="ps-block">${fichaConfigInner()}</div>`;
}
function fichaConfigInner(){
  if(!fichaDraft) fichaDraft = JSON.parse(JSON.stringify(fichaConfig()));
  const d = fichaDraft, n = d.campos.length;
  const rows = d.campos.map((x, i)=>{
    const def = FICHA_CAMPOS.find(f=>f.k===x.k), hint = FICHA_HINT[x.k];
    const move = `<span class="fc-move"><button type="button" class="btn btn-sm" ${i===0?'disabled':''} onclick="fichaMove(${i},-1)" aria-label="Subir ${h(def.n)}">↑</button><button type="button" class="btn btn-sm" ${i===n-1?'disabled':''} onclick="fichaMove(${i},1)" aria-label="Descer ${h(def.n)}">↓</button></span>`;
    if(x.k==='produtos') return `<div class="fc-row fc-prod">
      <div class="fc-main"><b>Produtos</b> <span class="sub">(sempre sai)</span></div>
      <div class="fc-opts">
        <label>Tamanho <select onchange="fichaSet('nomeProdutoTamanho',this.value)"><option value="normal" ${d.nomeProdutoTamanho==='normal'?'selected':''}>Normal</option><option value="grande" ${d.nomeProdutoTamanho==='grande'?'selected':''}>Grande (2x)</option><option value="extra" ${d.nomeProdutoTamanho==='extra'?'selected':''}>Extra grande (3x)</option></select></label>
        <label><input type="checkbox" ${d.mostrarAdicionais?'checked':''} onchange="fichaSet('mostrarAdicionais',this.checked)"> Adicionais</label>
        <label><input type="checkbox" ${d.mostrarObs?'checked':''} onchange="fichaSet('mostrarObs',this.checked)"> Observação do item</label>
        <label><input type="checkbox" ${d.mostrarPrecoProducao?'checked':''} onchange="fichaSet('mostrarPrecoProducao',this.checked)"> Preço nas estações</label>
      </div>${move}</div>`;
    return `<div class="fc-row${x.on?'':' off'}">
      <div class="fc-main"><label><input type="checkbox" ${x.on?'checked':''} onchange="fichaCampo(${i},'on',this.checked)"> <b>${h(def.n)}</b></label>${hint?`<span class="sub fc-hint">${h(hint)}</span>`:''}</div>
      <div class="fc-opts"><label><input type="checkbox" ${x.grande?'checked':''} ${x.on?'':'disabled'} onchange="fichaCampo(${i},'grande',this.checked)"> Grande</label>
      <label><input type="checkbox" ${x.negrito?'checked':''} ${x.on?'':'disabled'} onchange="fichaCampo(${i},'negrito',this.checked)"> Negrito</label></div>${move}</div>`;
  }).join('');
  const W = fichaPreviewPaper===58 ? 32 : 48;
  const preview = ticketLinesToHtml(buildTicketLines(...fichaSample(fichaPreviewSample), d), W);
  return `<div class="ps-head"><h3>Modelo da ficha</h3>
      <div class="ps-actions">${fichaDirty?'<span class="tag tag-amber">Alterações não salvas</span>':''}
      <button type="button" class="btn btn-sm" onclick="fichaReset()">Voltar ao padrão</button>
      <button type="button" class="btn btn-sm btn-primary" ${fichaDirty?'':'disabled'} onclick="saveTicketConfig()">Salvar modelo</button></div></div>
    <p class="sub" style="margin:0 0 10px">Escolha o que sai na ficha das estações e no comprovante do caixa, e em que ordem. "Grande" e "Negrito" valem nas impressoras de rede (IP). Na impressora ligada no Windows a ficha sai em texto simples, na mesma ordem.</p>
    <div class="fc-grid">
      <div class="fc-list">${rows}
        <div class="fc-compat"><b>Compatibilidade das impressoras</b>
          <label><input type="checkbox" ${d.fonteA?'checked':''} onchange="fichaSet('fonteA',this.checked)"> Usar sempre a letra padrão (fonte A), para todas as impressoras saírem com a mesma letra</label>
          <label><input type="checkbox" ${d.letraGrandeDupla?'checked':''} onchange="fichaSet('letraGrandeDupla',this.checked)"> Letra grande compatível com mais impressoras (manda os dois comandos de tamanho)</label>
        </div>
      </div>
      <div class="fc-preview">
        <div class="ps-actions" style="margin-bottom:8px">
          <label>Exemplo <select onchange="fichaPreviewSample=this.value;renderFichaConfig()"><option value="anon" ${fichaPreviewSample==='anon'?'selected':''}>Ficha sem identificação</option><option value="socio" ${fichaPreviewSample==='socio'?'selected':''}>Ficha com sócio</option><option value="caixa" ${fichaPreviewSample==='caixa'?'selected':''}>Comprovante do caixa</option></select></label>
          <label>Papel <select onchange="fichaPreviewPaper=Number(this.value);renderFichaConfig()"><option value="80" ${W===48?'selected':''}>80 mm</option><option value="58" ${W===32?'selected':''}>58 mm</option></select></label>
        </div>
        <div class="fc-paper">${preview}</div>
        <p class="sub" style="margin:6px 0 0">Prévia aproximada. Na impressora de rede os acentos saem sem acento.</p>
      </div>
    </div>`;
}
function renderFichaConfig(){ const box = document.getElementById('fichaConfigBox'); if(box) box.innerHTML = fichaConfigInner(); }
function fichaCampo(i, prop, val){ const x = fichaDraft && fichaDraft.campos[i]; if(!x) return; x[prop] = val; fichaDirty = true; renderFichaConfig(); }
function fichaSet(prop, val){ if(!fichaDraft) return; fichaDraft[prop] = val; fichaDirty = true; renderFichaConfig(); }
function fichaMove(i, dir){
  const a = fichaDraft && fichaDraft.campos, j = i+dir; if(!a || j<0 || j>=a.length) return;
  [a[i], a[j]] = [a[j], a[i]]; fichaDirty = true; renderFichaConfig();
}
function fichaReset(){ fichaDraft = JSON.parse(JSON.stringify(fichaConfig({}))); fichaDirty = true; renderFichaConfig(); }
async function saveTicketConfig(){
  if(!requirePerm('config-sistema') || !fichaDraft) return;
  const d = fichaDraft;
  // entregaDestaque segue gravado para quem ainda lê o formato antigo.
  const praOnde = d.campos.find(x=>x.k==='praOnde');
  state.settings.ticketConfig = Object.assign({}, state.settings.ticketConfig||{}, JSON.parse(JSON.stringify(d)), { entregaDestaque: !!(praOnde && praOnde.negrito) });
  await save('settings');
  fichaDirty = false; fichaDraft = null; renderFichaConfig();
  logAction('Impressão: modelo da ficha alterado');
  toast('Modelo da ficha salvo. As próximas fichas já saem assim.');
}
