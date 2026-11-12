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
