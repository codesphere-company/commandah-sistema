/* ============ CENTRAL DE CONFIGURAÇÕES (E DE RELATÓRIOS) ============ */
// 25/11 (dono aprovou a proposta B do redesign; antes: "menu superior das configurações pequeno e desconexo").
// A área Configurações tinha 20 atalhos numa faixa; eles não cabiam numa linha e a faixa encolhia (modo
// compacto: botão de 38 px, ícone de 16 px, sem o nome dos grupos). Agora a área abre esta página, com os
// itens em grupos e uma descrição curta. Dentro de um item, a faixa vira a barra de Voltar com os outros itens
// do mesmo grupo (barraCentralConfig, chamada por renderRibbonToolbar em core/navegacao.js).
// Permissões: cada linha usa ribbonItemAction(), a mesma regra da faixa. Item sem permissão continua visível,
// apagado e com "Sem permissão".
// 25/11 (padrão, lote 3): a mesma central serve qualquer área com central:true (Configurações e Relatórios).
// A área aberta fica em centralAreaId; título, texto da busca e aviso de vazio vêm da área (label, busca, vazio).
let centralConfigBusca = '', centralAreaId = null;
function areaCentralConfig(){
  const ts = visibleTabs||[];
  return ts.find(t=>t.central && t.id===activeRibbonTab) || ts.find(t=>t.central && t.id===centralAreaId) || ts.find(t=>t.central) || null;
}
function openConfigCentral(areaId){
  const ts = visibleTabs||[];
  const area = (areaId && ts.find(t=>t.central && t.id===areaId)) || areaCentralConfig(); if(!area) return;
  activeRibbonTab = area.id; activeRibbonAction = ''; centralAreaId = area.id;
  centralConfigBusca = ''; const inp = document.getElementById('ccBusca'); if(inp) inp.value = '';
  switchView('config-central');
}
function gruposCentralConfig(area){
  return area.groups.map(g=>({label:g.label, items:g.items.filter(it=>!itemEscondido(it))})).filter(g=>g.items.length);
}
function renderCentralConfig(){
  const el = document.getElementById('view-config-central'); if(!el) return;
  if(activeView!=='config-central') return;
  const area = areaCentralConfig(); if(!area){ el.innerHTML=''; return; }
  // A busca é redesenhada sozinha (listaCentralConfig) para o campo não perder o foco a cada letra.
  // Trocou de área (Configurações ↔ Relatórios): redesenha o cabeçalho.
  if(!document.getElementById('ccBusca') || el.dataset.area!==area.id){
    const busca = area.busca || 'Buscar';
    el.dataset.area = area.id;
    el.innerHTML = `<div class="cc"><div class="cc-head"><h1>${h(area.label)}</h1><label class="cc-busca">${ICN.search}<input id="ccBusca" type="search" placeholder="${h(busca)}" aria-label="${h(busca)}" autocomplete="off"></label></div><div id="ccLista"></div></div>`;
    const inp = document.getElementById('ccBusca');
    inp.value = centralConfigBusca;
    inp.oninput = ()=>{ centralConfigBusca = inp.value; listaCentralConfig(); };
  }
  listaCentralConfig();
}
function listaCentralConfig(){
  const box = document.getElementById('ccLista'), area = areaCentralConfig(); if(!box || !area) return;
  const allowed = userPermissions(currentUser);
  const q = centralConfigBusca.trim().toLocaleLowerCase('pt-BR');
  const grupos = gruposCentralConfig(area)
    .map(g=>({label:g.label, items:g.items.filter(it=>!q || `${it.label} ${it.desc||''} ${g.label}`.toLocaleLowerCase('pt-BR').includes(q))}))
    .filter(g=>g.items.length);
  if(!grupos.length){ box.innerHTML = `<p class="cc-vazio">${h(area.vazio||'Nada')} com "${h(centralConfigBusca.trim())}".</p>`; return; }
  box.innerHTML = grupos.map(g=>`<section class="cc-grupo"><h2>${h(g.label)}</h2><div class="cc-lista">${g.items.map(it=>{
    const a = ribbonItemAction(it, allowed);
    return `<button type="button" class="cc-item ${a.enabled?'':'disabled'}" title="${a.reason}" ${a.enabled?'':'aria-disabled="true"'} onclick="${a.onclick}"><span class="ic">${it.icon||''}</span><span class="tx"><span class="t">${h(it.label)}</span>${it.desc?`<span class="d">${h(it.desc)}</span>`:''}</span>${a.emConstrucao?`<span class="selo-obra">${seloEmBreve(it.label)}</span>`:a.enabled?`<span class="go">${ICN.chevRight}</span>`:'<span class="trava">Sem permissão</span>'}</button>`; // lote 3: módulo em construção (Meu Delivery) com o selo, como na faixa
  }).join('')}</div></section>`).join('');
}
// Faixa da área Configurações quando um item está aberto: Voltar para a central e os itens do mesmo grupo.
function barraCentralConfig(area, allowed){
  const grupos = gruposCentralConfig(area);
  const todos = grupos.flatMap(g=>g.items.map(it=>({it, g})));
  const atual = todos.find(x=>activeRibbonAction && x.it.label===activeRibbonAction)
             || todos.find(x=>x.it.view && x.it.view===activeView);
  const irmaos = atual ? atual.g.items.map(it=>{
    const a = ribbonItemAction(it, allowed);
    return `<button type="button" class="${a.enabled?'':'disabled'} ${it===atual.it?'active':''}" title="${a.reason}" onclick="${a.onclick}"><span class="ic">${it.icon||''}</span>${h(it.label)}</button>`;
  }).join('') : '';
  return `<div class="cc-barra"><button type="button" class="cc-voltar" onclick="openConfigCentral(${jsArg(area.id)})">${ICN.chevLeft}${h(area.label)}</button>${irmaos?`<div class="cc-irmaos" aria-label="${h(atual.g.label)}">${irmaos}</div>`:''}</div>`;
}
