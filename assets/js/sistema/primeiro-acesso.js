/* ============ PRIMEIRO ACESSO: TELA E CARTÃO ============ */
// Auditoria 11/11, item 1 (design em docs/superpowers/specs/2026-11-11-primeiro-acesso-design.md).
// A tela "Como você atende?" abre uma vez só, para o administrador da conta nova, antes de qualquer outra:
// sem ela o estabelecimento nasceria no modo clube e sem estação. As regras ficam em primeiro-acesso-regras.js.

// Só abre com a leitura inteira em dia: lista vazia por falha de leitura imitaria conta nova e a tela
// gravaria por cima do que existe (mesma proteção da semeadura em core/dados.js).
function abrirPrimeiroAcessoSeNecessario(){
  if(!currentUser || currentUser.role!=='admin') return false;
  if((typeof falhasDeLeitura!=='undefined') && falhasDeLeitura.length) return false;
  if(!precisaPrimeiroAcesso(state)) return false;
  if(document.getElementById('primeiroAcesso')) return true;
  const s = state.settings || {};
  const caixa = (id, titulo, texto, extra)=>`<label class="pa-opcao" for="${id}"><input type="checkbox" id="${id}"><span class="pa-opcao-texto"><b>${titulo}</b><small>${texto}</small>${extra||''}</span></label>`;
  const el = document.createElement('div');
  el.id = 'primeiroAcesso';
  el.className = 'pa-camada';
  el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-labelledby','paTitulo');
  el.innerHTML = `<div class="pa-caixa">
    <h1 id="paTitulo">Como você atende?</h1>
    <p class="sub">Responda uma vez para o Commandah já vir do seu jeito. Dá para mudar depois em Configurações.</p>
    <div class="field"><label for="paNomeEst">Nome do estabelecimento</label><input id="paNomeEst" maxlength="60" autocomplete="organization" value="${h(s.clubName||'')}" placeholder="Ex.: Bar do Zé"></div>
    <p class="pa-grupo">Marque tudo o que você tem.</p>
    ${caixa('paSocios','Sócios com cota e dependentes','Fiado do sócio, cota na comanda, locais como churrasqueira e quadra.')}
    ${caixa('paMesas','Mesas','Cria a lista de mesas para escolher na comanda.', `<span class="pa-qtd"><label for="paQtdMesas">Quantas mesas?</label><input id="paQtdMesas" type="number" inputmode="numeric" min="1" max="200" disabled></span>`)}
    ${caixa('paBalcao','Balcão com ficha','A tela Ficha vira a entrada principal do caixa.')}
    <p class="pa-grupo">Onde os pedidos são preparados?</p>
    <div class="pa-preparo">
      <label for="paPrepCozinha"><input type="checkbox" id="paPrepCozinha"> Cozinha</label>
      <label for="paPrepBar"><input type="checkbox" id="paPrepBar"> Bar</label>
      <label for="paPrepChurrasqueira"><input type="checkbox" id="paPrepChurrasqueira"> Churrasqueira</label>
    </div>
    <button type="button" class="btn btn-primary btn-block" id="paComecar">Começar</button>
  </div>`;
  document.body.appendChild(el);
  const mesas = document.getElementById('paMesas'), qtd = document.getElementById('paQtdMesas');
  mesas.onchange = ()=>{ qtd.disabled = !mesas.checked; if(mesas.checked) qtd.focus(); };
  document.getElementById('paComecar').onclick = ()=>salvarPrimeiroAcesso();
  setTimeout(()=>{ const n=document.getElementById('paNomeEst'); if(n) n.focus(); },0);
  return true;
}

const salvarPrimeiroAcesso = singleFlight('primeiro-acesso', async function(){
  const marcado = (id)=>!!(document.getElementById(id)||{}).checked;
  const escolhas = {
    nome: document.getElementById('paNomeEst').value,
    socios: marcado('paSocios'), mesas: marcado('paMesas'), qtdMesas: document.getElementById('paQtdMesas').value, balcao: marcado('paBalcao'),
    preparo: { cozinha: marcado('paPrepCozinha'), bar: marcado('paPrepBar'), churrasqueira: marcado('paPrepChurrasqueira') },
    em: new Date().toISOString(),
  };
  const r = montarAtendimento(escolhas, { locais: state.locais||[], estacoes: state.estacoes||[] }, uid);
  if(r.error){ toast(r.error, 'erro'); return; }
  const antes = { settings: state.settings, locais: state.locais, estacoes: state.estacoes };
  state.settings = { ...(state.settings||{}), ...r.settings };
  state.locais = r.locais; state.estacoes = r.estacoes;
  // Locais e estações antes das configurações: settings.atendimento é o que diz "já respondeu".
  const ok = (await save('locais')) && (await save('estacoes')) && (await save('settings'));
  if(!ok){
    Object.assign(state, antes);
    toast('Não foi possível salvar agora. Confira a internet e tente de novo.', 'erro');
    return;
  }
  const camada = document.getElementById('primeiroAcesso'); if(camada) camada.remove();
  logAction('Primeiro acesso: atendimento configurado ('+(r.settings.operationMode==='clube'?'clube':'bar')+')');
  if(typeof applyBranding==='function') applyBranding();
  buildNav();
  switchView(telaInicialDoAdmin(state.settings));
});

/* ---- Cartão "Primeiros passos" (só administrador de conta que passou pela tela acima) ---- */
// Fica no topo das telas de operação (Comandas, Ficha, Caixa), não nas de gestão, para não atrapalhar
// quem já está configurando. Some quando os seis passos estiverem feitos ou se for escondido neste aparelho.
const TELAS_DO_CARTAO = new Set(['comandas','balcao','caixa']);
let emissorConferido = null; // null = ainda não perguntou nesta sessão; depois, true/false
let emissorPerguntando = false;
function chavePassosEscondidos(){ return 'commandah:passos-escondidos:'+((typeof getTenantId==='function'&&getTenantId())||'local'); }
function passosEscondidos(){ try{ return localStorage.getItem(chavePassosEscondidos())==='1'; }catch(e){ return false; } }
function conferirEmissorUmaVez(){
  if(emissorConferido!==null || emissorPerguntando) return;
  if(!isCloudMode() || typeof nfceCall!=='function'){ emissorConferido = false; return; }
  emissorPerguntando = true;
  nfceCall('emissor').then(r=>{ emissorConferido = !!(r && r.emissor && r.emissor.configurado); })
    .catch(()=>{ emissorConferido = false; })
    .finally(()=>{ emissorPerguntando = false; renderPrimeirosPassos(); });
}
function renderPrimeirosPassos(){
  const box = document.getElementById('primeirosPassosBox'); if(!box) return;
  const s = (state && state.settings) || {};
  const mostra = currentUser && currentUser.role==='admin' && s.atendimento && !(s.primeirosPassos && s.primeirosPassos.concluidoEm)
    && TELAS_DO_CARTAO.has(activeView) && !passosEscondidos();
  if(!mostra){ box.innerHTML = ''; return; }
  conferirEmissorUmaVez();
  const passos = passosPrimeirosPassos(state, { emissorConfigurado:emissorConferido===true });
  const feitos = passos.filter(p=>p.feito).length;
  if(feitos===passos.length){
    state.settings.primeirosPassos = { ...(s.primeirosPassos||{}), concluidoEm:new Date().toISOString() };
    save('settings'); logAction('Primeiros passos concluídos');
    box.innerHTML = ''; return;
  }
  const proximo = passos.find(p=>!p.feito);
  box.innerHTML = `<section class="pp-cartao" aria-labelledby="ppTitulo">
    <div class="pp-topo"><div><h2 id="ppTitulo">Deixe o Commandah pronto para vender</h2><p id="ppContador">${feitos} de ${passos.length} feitos</p></div>
      <button type="button" class="btn btn-sm" id="ppEsconder" onclick="esconderPrimeirosPassos()">Esconder por enquanto</button></div>
    <ol class="pp-lista">${passos.map(p=>`<li class="pp-passo${p.feito?' feito':''}${p===proximo?' proximo':''}" data-pp-passo="${h(p.id)}">
      <span class="pp-marca" aria-hidden="true">${p.feito?'✓':''}</span>
      <span class="pp-texto"><b>${h(p.titulo)}</b><small>${h(p.detalhe)}</small></span>
      ${p.feito?'<span class="pp-ok">Feito</span>':`<span class="pp-acoes">${(p.id==='nfce'||p.id==='impressoras')?`<button type="button" class="btn btn-sm" data-pp-feito="${h(p.id)}" onclick="marcarPassoFeito(${jsArg(p.id)})">Já fiz</button>`:''}<button type="button" class="btn btn-sm ${p===proximo?'btn-primary':''}" data-pp-abrir="${h(p.id)}" onclick="abrirPassoPrimeirosPassos(${jsArg(p.id)})">Abrir</button></span>`}
    </li>`).join('')}</ol></section>`;
}
function abrirPassoPrimeirosPassos(id){
  if(id==='dados') return openSystemSettings();
  if(id==='colaboradores') return openRibbonView('usuarios','Colaboradores');
  if(id==='produtos') return openRibbonView('produtos','Produtos');
  if(id==='nfce') return openNfceSettings();
  if(id==='impressoras') return openRibbonView('impressoras','Impressoras');
  if(id==='venda') return switchView(telaInicialDoAdmin(state.settings));
}
async function marcarPassoFeito(id){
  const s = state.settings || {};
  const pp = s.primeirosPassos || {};
  state.settings = { ...s, primeirosPassos: { ...pp, feitos: { ...(pp.feitos||{}), [id]:true } } };
  if(!await save('settings')){ toast('Não foi possível salvar agora. Confira a internet e tente de novo.', 'erro'); return; }
  renderPrimeirosPassos();
}
function esconderPrimeirosPassos(){ try{ localStorage.setItem(chavePassosEscondidos(),'1'); }catch(e){} renderPrimeirosPassos(); toast('Você reabre os primeiros passos em Ajuda.'); }
function reabrirPrimeirosPassos(){
  try{ localStorage.removeItem(chavePassosEscondidos()); }catch(e){}
  if(state.settings && state.settings.primeirosPassos && state.settings.primeirosPassos.concluidoEm){ toast('Os primeiros passos já foram concluídos.'); return; }
  switchView(telaInicialDoAdmin(state.settings));
}
function botaoPrimeirosPassosAjuda(){
  const s = (state && state.settings) || {};
  if(!currentUser || currentUser.role!=='admin' || !s.atendimento) return '';
  return `<button type="button" id="ajudaPrimeirosPassos" onclick="reabrirPrimeirosPassos()">Primeiros passos</button>`;
}
