/* ============ FORMAS DE PAGAMENTO (tela de cadastro) ============
   09/11 (pedido do dono): botões de ligar e desligar, em dois grupos ("Na hora de pagar" e
   "Ao receber fiado"). Verde = ligada, cinza = desligada; o lápis abre a edição. Só o
   administrador altera (podeEditarCatalogo); os demais perfis veem a tela só para consulta.
   O que fica em state.paymentMethods são itens completos (method, nome, tipo, naVenda,
   noFiado, confere); listaDeFormas() (core/formas.js) mescla com as iniciais por method. */
const FORMAS_CONFERE = {
  operador: 'Operador conta no fechamento',
  admin:    'Administrador confere no banco',
  ninguem:  'Ninguém confere',
};
const FORMAS_GRUPOS = [
  { chave:'naVenda', titulo:'Na hora de pagar', sub:'Botões que o operador vê ao fechar uma venda.' },
  { chave:'noFiado', titulo:'Ao receber fiado', sub:'Formas aceitas quando o sócio paga a conta de fiado.' },
];
const FORMAS_AVISO_ULTIMA = 'Pelo menos uma forma precisa ficar ligada em "Na hora de pagar".';

function formaEhInicial(method){ return FORMAS_INICIAIS.some(f=>f.method===method); }
// Dinheiro e Fiado nunca apagam nem mudam de tipo (calculam troco e lançam na conta do cliente).
function formaTipoTravado(forma){ return !!forma && (forma.tipo==='dinheiro' || forma.tipo==='fiado'); }

function renderPaymentMethods(el){
  if(!el) return;
  const pode = podeEditarCatalogo();
  const formas = listaDeFormas();
  const grupo = g=>{
    const itens = formas.filter(f=> g.chave==='noFiado' ? f.tipo!=='fiado' : true);
    return `<section class="forma-grupo" data-grupo="${g.chave}" aria-labelledby="formaGrupo_${g.chave}">
      <h3 id="formaGrupo_${g.chave}">${h(g.titulo)}</h3><p class="forma-grupo-sub">${h(g.sub)}</p>
      <div class="forma-botoes">${itens.map(f=>{
        const on = !!f[g.chave];
        return `<div class="forma-botao ${on?'on':'off'}"><button type="button" class="forma-chip" data-method="${h(f.method)}" data-grupo="${g.chave}" aria-pressed="${on}" onclick="alternarForma(${jsArg(f.method)},${jsArg(g.chave)})" title="${on?'Clique para desligar':'Clique para ligar'}"><span class="forma-estado" aria-hidden="true">${on?'✓':'○'}</span><span class="forma-nome">${h(f.nome)}</span><small class="forma-situacao">${on?'Ligada':'Desligada'}</small></button><button type="button" class="forma-lapis" data-method="${h(f.method)}" onclick="abrirEdicaoForma(${jsArg(f.method)})" aria-label="Editar ${h(f.nome)}" title="Editar">✎</button></div>`;
      }).join('')}</div></section>`;
  };
  el.innerHTML = `<section class="finance-page formas-page">
    <div class="finance-top"><span class="finance-title-tab" style="margin-left:0">Formas de Pagamento</span><div class="finance-actions"><button type="button" class="op-btn primary" id="formaNova" onclick="abrirEdicaoForma(null)">＋ &nbsp; Nova forma</button></div></div>
    <div class="formas-corpo">
      <p class="formas-ajuda">${pode?'Clique numa forma para ligar ou desligar naquele grupo. O lápis abre a edição.':h(AVISO_SO_CONSULTA)}</p>
      ${FORMAS_GRUPOS.map(grupo).join('')}
    </div></section>`;
}

const alternarForma = singleFlight('alternarForma', async function(method, grupo){
  if(!podeEditarCatalogo()){ toast(AVISO_SO_CONSULTA); return; }
  if(grupo!=='naVenda' && grupo!=='noFiado') return;
  const atual = formaPorMetodo(method);
  if(!atual) return;
  const ligar = !atual[grupo];
  if(!ligar && grupo==='naVenda' && formasNaVenda().filter(f=>f.method!==method).length===0){ toast(FORMAS_AVISO_ULTIMA); return; }
  const antes = JSON.stringify(state.paymentMethods);
  gravarForma({ ...atual, [grupo]: ligar });
  if(!await save('paymentMethods')){ state.paymentMethods = JSON.parse(antes); renderPaymentMethods(document.getElementById('view-pagamentos')); return; }
  logAction((ligar?'Ligou':'Desligou')+' a forma de pagamento "'+atual.nome+'" em "'+(grupo==='naVenda'?'Na hora de pagar':'Ao receber fiado')+'"');
  renderPaymentMethods(document.getElementById('view-pagamentos'));
});

// Grava (ou troca) o item completo em state.paymentMethods, sem duplicar. Item antigo só com
// nome (sem method) vira o item completo com method 'outro:Nome'.
function gravarForma(forma){
  const item = { id: forma.id || uid(), method: forma.method, nome: forma.nome, tipo: forma.tipo, naVenda: !!forma.naVenda, noFiado: !!forma.noFiado, confere: forma.confere };
  const lista = Array.isArray(state.paymentMethods) ? state.paymentMethods : (state.paymentMethods = []);
  const i = lista.findIndex(x=> x && (x.method ? x.method===item.method : ('outro:'+x.nome)===item.method));
  if(i>=0){ item.id = lista[i].id || item.id; lista[i] = item; } else lista.push(item);
  return item;
}

// Forma já usada em venda, movimento do caixa ou recebimento de fiado não apaga, só desliga.
async function formaFoiUsada(method){
  const forma = formaPorMetodo(method);
  const nome = forma ? forma.nome : '';
  const e = m=> normalizarMetodo(m)===method || m===method;
  const nasVendas = (state.sales||[]).some(s=> (s.payments||[]).some(p=>e(p.method)) || (s.partialPayments||[]).some(p=>e(p.method)));
  if(nasVendas) return true;
  if((state.cashMovements||[]).some(m=>e(m.method))) return true;
  if((state.members||[]).some(m=>(m.debtHistory||[]).some(x=> x.method && (x.method===method || x.method===nome)))) return true;
  if(typeof isCloudMode==='function' && isCloudMode() && typeof supabaseClient!=='undefined' && supabaseClient){
    try{
      const chaves = [...new Set([method, nome].filter(Boolean))];
      const { data, error } = await supabaseClient.from('member_debt_entries').select('id').in('method', chaves).limit(1);
      if(error) return true; // na dúvida, não apaga
      return !!(data && data.length);
    }catch(err){ return true; }
  }
  return false;
}

function abrirEdicaoForma(method){
  if(!podeEditarCatalogo()){ toast(AVISO_SO_CONSULTA); return; }
  const forma = method ? formaPorMetodo(method) : null;
  if(method && !forma){ toast('Forma não encontrada.'); return; }
  const travado = formaTipoTravado(forma);
  const tipos = Object.keys(FORMAS_TIPOS).filter(t=> travado ? t===forma.tipo : (t!=='dinheiro' && t!=='fiado'));
  const tipoAtual = forma ? forma.tipo : 'outros';
  const podeApagar = !!forma && !travado && !formaEhInicial(forma.method);
  const f = forma || { nome:'', tipo:'outros', naVenda:true, noFiado:true, confere:'admin' };
  openModal(forma?'Editar forma de pagamento':'Nova forma de pagamento', `<div class="consumer-form-frame forma-form">
    <div class="field"><label for="formaNome">Nome</label><input id="formaNome" value="${h(f.nome)}" maxlength="40" autofocus></div>
    <div class="field"><label for="formaTipo">Tipo</label><select id="formaTipo" ${travado?'disabled':''}>${tipos.map(t=>`<option value="${h(t)}" ${t===tipoAtual?'selected':''}>${h(FORMAS_TIPOS[t].label)}</option>`).join('')}</select><small class="forma-dica">O tipo define o código da nota fiscal.</small></div>
    <fieldset class="forma-aparece"><legend>Aparece</legend>
      <label class="forma-check"><input type="checkbox" id="formaNaVenda" ${f.naVenda?'checked':''}> Na hora de pagar</label>
      <label class="forma-check" id="formaNoFiadoLinha"><input type="checkbox" id="formaNoFiado" ${f.noFiado?'checked':''}> Ao receber fiado</label>
    </fieldset>
    <div class="field"><label for="formaConfere">Quem confere</label><select id="formaConfere">${Object.keys(FORMAS_CONFERE).map(k=>`<option value="${k}" ${k===f.confere?'selected':''}>${h(FORMAS_CONFERE[k])}</option>`).join('')}</select></div>
    <div class="forma-acoes">${podeApagar?`<button type="button" class="op-btn danger" id="formaApagar">Apagar</button>`:'<span></span>'}<span><button type="button" class="op-btn" onclick="closeModal()">Cancelar</button> <button type="button" class="op-btn primary" id="formaSalvar">Salvar</button></span></div></div>`);
  const modal = document.querySelector('#modalRoot .modal'); if(modal) modal.classList.add('forma-modal');
  const ajustaFiado = ()=>{
    const tipo = document.getElementById('formaTipo').value;
    const linha = document.getElementById('formaNoFiadoLinha');
    linha.hidden = tipo==='fiado'; // o tipo Fiado só aparece em "Na hora de pagar"
    if(tipo==='fiado') document.getElementById('formaNoFiado').checked = false;
  };
  document.getElementById('formaTipo').onchange = ajustaFiado; ajustaFiado();
  document.getElementById('formaSalvar').onclick = ()=>salvarFormaEditada(forma ? forma.method : null);
  const ap = document.getElementById('formaApagar'); if(ap) ap.onclick = ()=>apagarForma(forma.method);
  const nm = document.getElementById('formaNome'); if(nm) nm.focus();
}

const salvarFormaEditada = singleFlight('salvarForma', async function(method){
  if(!podeEditarCatalogo()){ toast(AVISO_SO_CONSULTA); return; }
  const atual = method ? formaPorMetodo(method) : null;
  const nome = document.getElementById('formaNome').value.trim().replace(/\s+/g,' ');
  if(!nome){ toast('Informe o nome da forma.'); return; }
  const chave = s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  if(listaDeFormas().some(x=>x.method!==method && chave(x.nome)===chave(nome))){ toast('Já existe uma forma com esse nome.'); return; }
  const tipo = atual && formaTipoTravado(atual) ? atual.tipo : document.getElementById('formaTipo').value;
  if(!FORMAS_TIPOS[tipo] || (!atual && (tipo==='dinheiro' || tipo==='fiado'))) { toast('Escolha o tipo da forma.'); return; }
  const naVenda = document.getElementById('formaNaVenda').checked;
  const noFiado = tipo==='fiado' ? false : document.getElementById('formaNoFiado').checked;
  const confere = document.getElementById('formaConfere').value;
  if(!FORMAS_CONFERE[confere]){ toast('Escolha quem confere.'); return; }
  if(!naVenda && formasNaVenda().filter(x=>x.method!==method).length===0){ toast(FORMAS_AVISO_ULTIMA); return; }
  const antes = JSON.stringify(state.paymentMethods);
  const item = gravarForma({ ...(atual||{}), method: atual ? atual.method : 'forma:'+uid(), nome, tipo, naVenda, noFiado, confere });
  if(!await save('paymentMethods')){ state.paymentMethods = JSON.parse(antes); return; }
  logAction((atual?'Alterou':'Criou')+' a forma de pagamento "'+nome+'"'+(atual && atual.nome!==nome?' (antes "'+atual.nome+'")':''));
  closeModal();
  toast(atual?'Forma atualizada.':'Forma criada.');
  renderPaymentMethods(document.getElementById('view-pagamentos'));
  return item;
});

const apagarForma = singleFlight('apagarForma', async function(method){
  if(!podeEditarCatalogo()){ toast(AVISO_SO_CONSULTA); return; }
  const forma = formaPorMetodo(method);
  if(!forma) return;
  if(formaTipoTravado(forma) || formaEhInicial(method)){ toast('Esta forma não pode ser apagada; desligue-a se não quiser usá-la.'); return; }
  if(await formaFoiUsada(method)){ toast('Esta forma já foi usada em vendas ou recebimentos e não pode ser apagada; desligue-a nos dois grupos.'); return; }
  if(!await confirmarAcao('Apagar a forma "'+forma.nome+'"?')) return;
  const antes = JSON.stringify(state.paymentMethods);
  state.paymentMethods = (state.paymentMethods||[]).filter(x=> !(x && (x.method ? x.method===method : ('outro:'+x.nome)===method)));
  if(!await save('paymentMethods')){ state.paymentMethods = JSON.parse(antes); return; }
  logAction('Apagou a forma de pagamento "'+forma.nome+'"');
  closeModal();
  toast('Forma apagada.');
  renderPaymentMethods(document.getElementById('view-pagamentos'));
});

// 09/11 (pedido do dono): listas próprias (Contas a pagar/receber e recebimento de fiado, até a Task 3)
// acrescentam só as formas criadas pelo estabelecimento, sem repetir nome da lista fixa.
function nomesDeFormasCriadas(fixos){
  const vistos = new Set((fixos||[]).map(x=>String(x).toLowerCase()));
  return listaDeFormas().filter(f=>!formaEhInicial(f.method)).map(f=>f.nome).filter(n=>{ const k=String(n).toLowerCase(); if(vistos.has(k)) return false; vistos.add(k); return true; });
}
