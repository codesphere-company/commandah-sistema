/* ============ AJUDA E DIAGNÓSTICO ============ */
/* PROD-16 (auditoria 2026-10-07): manual curto da equipe. Uma folha de uma página por
   função (caixa, garçom, cozinha), o roteiro de "caiu a internet ou a impressora" e o
   treino de 30 minutos antes da troca de sistema. Cada folha imprime sozinha. */
const HELP_SHEETS = {
  caixa: { title:'Folha do Caixa', html:`
    <h3>Começo do turno</h3><ol>
      <li>Entre com o seu PIN. Não use o PIN de outra pessoa.</li>
      <li><b>Principal › Abrir/Fechar › Abrir Caixa</b>: digite o troco que está na gaveta.</li>
      <li>Confira no rodapé: <b>Conexão: Conectado</b> e <b>Caixa: Aberto</b>.</li></ol>
    <h3>Comandas</h3><ol>
      <li><b>Principal › Mesas/Comandas</b>. Para abrir: <b>+ Abrir comanda</b> e busque o sócio pelo nome ou pela cota.</li>
      <li>Toque na comanda para abrir. <b>Novo Pedido</b> lança os itens. Ao confirmar:
        <ul><li><b>Comida com preparo:</b> a ficha sai <b>na cozinha</b> e o pedido aparece na TV.</li>
        <li><b>Bebida, lanche pronto e o que não tem preparo:</b> a ficha sai <b>aqui no caixa</b>. Entregue ao cliente para ele retirar o produto.</li></ul></li>
      <li>Item errado: <b>Cancelar</b> na linha do item. Ficha que não saiu: <b>Reimprimir</b>.</li>
      <li><b>Bloquear Pedido</b> impede novos pedidos na comanda (ex.: o cliente pediu a conta).</li></ol>
    <h3>Receber</h3><ol>
      <li>Alguém vai embora antes e paga a parte dele: <b>Receber parcial</b>. O valor sai do total da comanda.</li>
      <li>Fechar a conta: <b>Pagamento</b>, toque na forma (atalhos: A dinheiro, P Pix, C crédito, B débito, F fiado), confira o valor e <b>Adicionar</b>. Dá para misturar formas.</li>
      <li>Fiado só para sócio. Se aparecer <b>Consumo bloqueado</b>, o sócio tem pendência: receba o pagamento ou chame o gerente.</li>
      <li><b>Comprovante só se o cliente pedir:</b> marque <b>Imprimir comprovante</b> antes de concluir o pagamento. Pediu depois? <b>Relatórios › Histórico de Pedidos</b>, abra o pedido e toque <b>Imprimir comprovante</b>.</li>
      <li><b>Nota fiscal (NFC-e):</b> quando estiver ligada, o cupom fiscal sai sozinho no caixa ao concluir o pagamento. Apareceu o aviso vermelho <b>"NFC-e não emitida"</b> ou <b>"recusou"</b>? A venda está registrada: avise o gerente, que emite de novo pelo detalhe do pedido. Errou a forma de pagamento? O gerente cancela a NFC-e em <b>até 30 minutos</b>.</li>
      <li>Pagamento de fiado: <b>Financeiro › Conta Corrente (Fiado)</b>, escolha o sócio e <b>Registrar Pagamento</b>.</li></ol>
    <h3>Dinheiro na gaveta</h3><ol>
      <li>Retirada ou reforço de troco: <b>Abrir/Fechar › + Novo Lançamento</b> (Saída ou Entrada do caixa), sempre com o motivo.</li></ol>
    <h3>Fim do turno</h3><ol>
      <li>Conte a gaveta <b>antes</b> de fechar.</li>
      <li><b>Abrir/Fechar › Fechar Caixa</b>: digite o dinheiro contado e o total da maquininha e toque <b>Conferir contagem</b>. Só então o sistema mostra o esperado e a diferença.</li>
      <li>Deu diferença? Avise o gerente antes de <b>Finalizar</b>. Use <b>Corrigir contagem</b> só se contou errado, nunca para "fazer bater".</li></ol>
    <div class="help-warn"><b>Nunca:</b> feche o navegador com a faixa vermelha <b>"Não foi possível salvar"</b> na tela (toque em <b>Tentar de novo</b>) · deixe o caixa logado ao sair (use <b>Bloquear ou trocar usuário</b>) · conte o seu PIN a ninguém.</div>` },
  garcom: { title:'Folha do Garçom', html:`
    <h3>Antes de começar</h3><ol>
      <li>Abra o Commandah no celular (deixe o atalho na tela inicial) e entre com o seu PIN.</li>
      <li>Use o Wi-Fi do clube se o sinal do celular estiver fraco.</li></ol>
    <h3>Lançar um pedido</h3><ol>
      <li>Na tela <b>Comandas</b>, digite o nome ou a cota do sócio, ou toque numa comanda em andamento.</li>
      <li>Escolha <b>Quem está pedindo</b> (titular ou dependente).</li>
      <li>Toque na categoria e nos produtos. Para procurar, use <b>Todos os produtos</b>.</li>
      <li>Na revisão, confira as quantidades, o local e a observação (ex.: "sem cebola").</li>
      <li>Toque <b>✓ Enviar pedido</b>. O pedido vai direto para a cozinha, a churrasqueira ou o bar, e a ficha imprime lá. Bebida lacrada e o que não tem preparo saem <b>no bar</b>. Não precisa avisar o caixa.</li></ol>
    <h3>Situações comuns</h3><ul>
      <li>Comanda com <b>🔒</b>: o caixa travou a comanda (ex.: já pediu a conta). Fale com o caixa.</li>
      <li>Sócio com <b>consumo bloqueado</b>: não insista. Peça para ele passar no caixa.</li>
      <li>Pedido errado: peça ao caixa para cancelar o item. O garçom não cancela.</li>
      <li>Desistiu antes de enviar: <b>Descartar pedido</b>.</li></ul>
    <div class="help-warn"><b>Sem sinal:</b> se aparecer erro ao enviar, o pedido <b>não</b> foi para a cozinha. Espere o sinal voltar e confira a comanda antes de mandar de novo, para não sair dobrado.</div>` },
  cozinha: { title:'Folha da Cozinha', html:`
    <h3>A tela</h3><ol>
      <li>Entre com o PIN da cozinha. A tela entra sozinha no <b>Modo TV</b> (letra grande).</li>
      <li>Se houver mais de uma área (cozinha, churrasqueira, bar), escolha <b>qual estação é esta tela</b>.</li>
      <li><b>Em preparo</b> mostra os pedidos, do mais antigo para o mais novo. O selo <b>há X min</b> é o tempo de espera.</li></ol>
    <h3>Marcar pronto</h3><ol>
      <li>Pedido inteiro pronto: toque <b>Pronto</b> no cartão.</li>
      <li>Pedido com vários itens: marque só os itens que ficaram prontos e toque <b>Pronto</b>. O pedido sai da tela quando todos estiverem prontos.</li>
      <li>A aba <b>Prontos</b> mostra os últimos pedidos marcados como prontos, para conferir.</li></ol>
    <h3>Atenção</h3><ul>
      <li>Item <b>riscado com "Cancelado"</b>: o cliente desistiu. Não prepare.</li>
      <li>Leia a <b>Obs.</b> embaixo do item (ex.: "sem cebola", "bem passado").</li>
      <li>A ficha não imprimiu? O pedido continua na tela. Avise o caixa para <b>Reimprimir</b>.</li>
      <li>A tela travou ou sumiu: recarregue a página. Se pedir o PIN, entre de novo.</li></ul>` },
  falhas: { title:'Caiu a internet ou a impressora', html:`
    <h3>Caiu a internet</h3><ol>
      <li>O rodapé mostra a <b>Conexão</b>. Sem internet o sistema <b>não grava</b>: não feche contas nesse momento.</li>
      <li>Anote em papel: comanda, itens, valor e forma de pagamento. Lance tudo quando a internet voltar.</li>
      <li>Apareceu a faixa vermelha <b>"Não foi possível salvar"</b>? Não feche a página. Quando a internet voltar, toque em <b>Tentar de novo</b>.</li>
      <li>Recarregou sem internet e apareceu <b>"O sistema não conseguiu carregar"</b>? Não precisa fazer nada: ele tenta de novo sozinho e entra quando a internet voltar.</li>
      <li><b>Sem internet a NFC-e não sai</b> (é assim também no Saipos). Quando a internet voltar, o gerente emite as notas que faltaram pelo detalhe de cada pedido.</li>
      <li>Celular do garçom sem sinal: use o Wi-Fi do clube ou leve o pedido ao caixa, que lança em <b>Novo Pedido</b>.</li></ol>
    <h3>Parou a impressora</h3><ol>
      <li>Confira papel, tampa fechada e se está ligada. O computador da impressão precisa estar ligado e com internet.</li>
      <li>Enquanto isso, a cozinha vê os pedidos no <b>Monitor de Cozinha</b>.</li>
      <li>Depois de arrumar: na comanda, <b>Reimprimir</b> nos itens que não saíram.</li></ol>
    <h3>Nada resolveu</h3><ol>
      <li>Chame o gerente. Ele vê os erros em <b>Configurações › Erros do Sistema</b>.</li>
      <li>Apareceu <b>"Há uma versão nova"</b>? Toque em <b>Recarregar agora</b> quando não estiver no meio de um pagamento.</li></ol>` },
  treino: { title:'Treino da equipe (30 minutos)', html:`
    <p class="sub">Faça antes de um turno, com o caixa ainda fechado. Use uma comanda chamada <b>TESTE</b> e cancele no final. Na abertura do caixa de treino, escreva "treino" na observação.</p>
    <table><tbody>
      <tr><td>0–5 min</td><td>Cada pessoa entra com o próprio PIN e troca a senha em <b>Alterar Minha Senha</b>. Entregue a folha de cada função.</td></tr>
      <tr><td>5–15 min</td><td><b>Caixa:</b> abre o caixa, abre a comanda TESTE, lança um Novo Pedido, cancela um item e reimprime uma ficha.<br><b>Garçons:</b> lançam pedidos pelo celular na comanda TESTE.<br><b>Cozinha:</b> marca um item pronto, depois o pedido inteiro.</td></tr>
      <tr><td>15–20 min</td><td><b>Caixa:</b> Receber parcial e depois Pagamento com duas formas (ex.: Pix + dinheiro), marcando <b>Imprimir comprovante</b>. Lance uma bebida no caixa e veja a ficha de retirada sair ali; lance um lanche e veja a ficha sair na cozinha. Com a NFC-e em teste, confira o cupom fiscal.</td></tr>
      <tr><td>20–25 min</td><td><b>Simule falhas:</b> desligue o Wi-Fi de um celular e tente enviar um pedido; desligue a impressora e veja o pedido no Monitor de Cozinha. Siga a folha "Caiu a internet ou a impressora".</td></tr>
      <tr><td>25–30 min</td><td><b>Fechamento:</b> conte a gaveta, faça o fechamento às cegas e veja a diferença. Cancele a comanda TESTE. Tire as dúvidas.</td></tr>
    </tbody></table>` }
};
let helpSection = 'central';
function setHelpSection(key){ helpSection = key; renderAjuda(); }
function printHelpSheet(key){
  const sheet = HELP_SHEETS[key]; if(!sheet) return;
  const w = window.open('', '_blank');
  if(!w){ toast('O navegador bloqueou a janela de impressão. Libere as janelas deste site e tente de novo.'); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${h(sheet.title)} — Commandah</title><style>
    @page{size:A4;margin:14mm}body{font-family:Inter,Arial,sans-serif;color:#111;font-size:12.5px;line-height:1.4;margin:0}
    h1{font-size:20px;margin:0 0 2px}h3{font-size:14px;margin:12px 0 4px;color:#0b5e45}.top{display:flex;justify-content:space-between;border-bottom:2px solid #0b5e45;padding-bottom:6px;margin-bottom:6px}
    ol,ul{margin:0;padding-left:20px}li{margin:2px 0}.help-warn{border:1.5px solid #b42318;border-radius:6px;padding:8px 10px;margin-top:12px}.help-warn b{color:#b42318}
    table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ccc;padding:6px 4px;vertical-align:top}td:first-child{white-space:nowrap;font-weight:700;width:80px}.sub{color:#444}
  </style></head><body><div class="top"><h1>${h(sheet.title)}</h1><span>Commandah${state.settings.clubName?' · '+h(state.settings.clubName):''}</span></div>${sheet.html}</body></html>`);
  w.document.close();
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 300);
}
function renderAjuda(){
  const el = document.getElementById('view-ajuda');
  const navBtn = (key,label) => `<button class="${helpSection===key?'active':''}" onclick="setHelpSection(${jsArg(key)})">${label}</button>`;
  const sheet = HELP_SHEETS[helpSection];
  if(sheet){
    el.innerHTML = `<div class="workspace-gray"><section class="op-window" style="max-width:1180px;margin-left:auto"><header class="op-titlebar">Ajuda</header><div style="display:grid;grid-template-columns:270px 1fr;min-height:540px"><nav class="settings-nav" style="border-right:1px solid var(--c-border-strong)">${navBtn('central','Central de Ajuda')}<div class="help-nav-group">Manual da equipe</div>${navBtn('caixa','Folha do Caixa')}${navBtn('garcom','Folha do Garçom')}${navBtn('cozinha','Folha da Cozinha')}${navBtn('falhas','Caiu a internet ou a impressora')}${navBtn('treino','Treino da equipe (30 min)')}</nav><main style="padding:25px;overflow:auto"><article class="help-sheet"><div class="help-sheet-head"><h2>${h(sheet.title)}</h2><button class="op-btn" onclick="printHelpSheet(${jsArg(helpSection)})">▣ &nbsp; Imprimir esta folha</button></div>${sheet.html}</article></main></div><footer class="op-footer"><span>Manual da equipe</span><span>Imprima e deixe perto do posto de trabalho</span></footer></section></div>`;
    return;
  }
  el.innerHTML = `<div class="workspace-gray"><section class="op-window" style="max-width:1180px;margin-left:auto"><header class="op-titlebar">Ajuda</header><div style="display:grid;grid-template-columns:270px 1fr;min-height:540px"><nav class="settings-nav" style="border-right:1px solid var(--c-border-strong)">${navBtn('central','Central de Ajuda')}<div class="help-nav-group">Manual da equipe</div>${navBtn('caixa','Folha do Caixa')}${navBtn('garcom','Folha do Garçom')}${navBtn('cozinha','Folha da Cozinha')}${navBtn('falhas','Caiu a internet ou a impressora')}${navBtn('treino','Treino da equipe (30 min)')}<div class="help-nav-group">Suporte</div><button onclick="toast('O atendimento remoto exige uma ferramenta autorizada pelo estabelecimento.')">Atendimento Remoto</button><button onclick="switchView('diagnostico')">Diagnóstico</button><button onclick="switchView('backup')">Backup dos Dados</button></nav><main style="padding:25px"><h2>Como podemos ajudar?</h2><div class="op-search" style="max-width:520px"><input id="helpSearch" placeholder="Pesquisar na ajuda..."></div><div id="helpTopics" style="display:flex;flex-direction:column;gap:14px;margin-top:22px"><div class="panel"><b>Caixa e pedidos</b><p class="sub">Abra o caixa em Principal › Abrir/Fechar. Mesas, comandas, balcão e pedidos usam a numeração configurada.</p></div><div class="panel"><b>Clientes e fiado</b><p class="sub">Um cliente com saldo devedor não pode realizar novo fiado até registrar a quitação.</p></div><div class="panel"><b>Produtos e estoque</b><p class="sub">A baixa dos insumos ocorre quando os itens são enviados à cozinha conforme a ficha técnica. Uma vez por semana, faça a contagem em Insumos › Contagem: o sistema lança a falta e a sobra e mostra a % de perda.</p></div><div class="panel"><b>Acesso e segurança</b><p class="sub">Um administrador pode alterar perfis em Colaboradores. Cada usuário troca o próprio PIN em Alterar Minha Senha.</p></div><div class="panel"><b>Proteção dos dados</b><p class="sub">Exporte backups regulares em Configurações › Backup e guarde os arquivos em local seguro.</p></div></div></main></div><footer class="op-footer"><span>Ajuda local do sistema</span><span>Suporte externo não configurado</span></footer></section></div>`;
  document.getElementById('helpSearch').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#helpTopics .panel').forEach(p=>p.style.display=p.textContent.toLowerCase().includes(q)?'':'none');};
}
function openRemoteSupport(){const c=state.settings.remoteSupport||{},sessions=state.settings.remoteSupportSessions||[];openModal('Atendimento Remoto',`<div class="consumer-form-frame"><div class="app-status"><b>Acesso de suporte</b><span class="tag ${c.enabled?'tag-green':'tag-gray'}">${c.enabled?'Autorizado':'Bloqueado'}</span></div><p>O sistema não instala nem inicia ferramentas remotas. Registre abaixo a autorização concedida a uma ferramenta aprovada pelo estabelecimento.</p><div class="field"><label>Ferramenta autorizada</label><input id="remoteTool" value="${h(c.tool||'')}"></div><div class="field"><label>Código temporário / protocolo</label><input id="remoteCode"></div><label><input id="remoteConsent" type="checkbox"> Confirmo a autorização para esta sessão</label></div><div class="finance-grid" style="height:190px;margin:0 13px"><table><thead><tr><th>Data</th><th>Ferramenta</th><th>Protocolo</th><th>Operador</th><th>Status</th></tr></thead><tbody>${sessions.map(s=>`<tr><td>${reportDateTime(s.at)}</td><td>${h(s.tool)}</td><td>${h(s.code)}</td><td>${h(s.user)}</td><td>${h(s.status)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhuma sessão registrada.</td></tr>'}</tbody></table></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-delete" onclick="revokeRemoteSupport()">Revogar</button><button class="consumer-save" onclick="authorizeRemoteSupport()">✓ Autorizar sessão</button></div>`);document.querySelector('#modalRoot .modal').classList.add('app-config-modal');}
function authorizeRemoteSupport(){const tool=document.getElementById('remoteTool').value.trim(),code=document.getElementById('remoteCode').value.trim(),consent=document.getElementById('remoteConsent').checked;if(!tool||!code||!consent){toast('Informe ferramenta, protocolo e confirme a autorização.');return;}state.settings.remoteSupport={tool,enabled:true,authorizedAt:new Date().toISOString(),authorizedBy:currentUser.name};state.settings.remoteSupportSessions=state.settings.remoteSupportSessions||[];state.settings.remoteSupportSessions.unshift({id:uid(),at:new Date().toISOString(),tool,code,user:currentUser.name,status:'Autorizada'});save('settings');logAction('Sessão de suporte remoto autorizada: '+tool);closeModal();toast('Autorização registrada. Abra a ferramenta externa separadamente.');}
function revokeRemoteSupport(){state.settings.remoteSupport={...(state.settings.remoteSupport||{}),enabled:false,revokedAt:new Date().toISOString()};const current=(state.settings.remoteSupportSessions||[])[0];if(current&&current.status==='Autorizada')current.status='Revogada';save('settings');logAction('Autorização de suporte remoto revogada');closeModal();toast('Autorização revogada.');}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('#view-ajuda button');if(!button||!button.textContent.includes('Atendimento Remoto'))return;event.preventDefault();event.stopImmediatePropagation();openRemoteSupport();},true);
function renderDiagnostico(){
  const el = document.getElementById('view-diagnostico');
  el.innerHTML = `<div class="workspace-gray"><section class="op-window"><header class="op-titlebar">Diagnóstico de Serviços</header><div class="op-toolbar"><div class="op-toolbar-spacer"></div><button class="op-btn" onclick="showResourceMonitor()">Monitor de Recursos</button><button class="op-btn primary" onclick="runDiagnostics()">▷ &nbsp; Checar</button></div><div class="op-grid"><table><thead><tr><th>Sucesso</th><th>Serviço</th><th>Mensagem</th><th>Exceção</th><th>Retorno</th></tr></thead><tbody id="diagRows"><tr><td colspan="5" class="empty">Clique em Checar para executar os testes locais.</td></tr></tbody></table></div><footer class="op-footer"><span>Testes locais e informativos</span><span>Integrações externas exigem credenciais próprias</span></footer></section></div>`;
}
function diagnosticIntegrityRows(){
  const rows=[],allCollections=Object.keys(STORE).filter(k=>Array.isArray(state[k])),allIds=[];
  allCollections.forEach(k=>state[k].forEach(x=>{if(x&&x.id!=null)allIds.push(k+':'+x.id);}));
  const duplicateIds=allIds.filter((x,i,a)=>a.indexOf(x)!==i),productIds=new Set(state.products.map(x=>x.id)),insumoIds=new Set(state.insumos.map(x=>x.id)),memberIds=new Set(state.members.map(x=>x.id));
  const badRecipes=state.products.reduce((n,p)=>n+(p.recipe||[]).filter(r=>!insumoIds.has(r.insumoId)).length,0);
  const badSaleItems=state.sales.reduce((n,s)=>n+(s.items||[]).filter(i=>i.productId&&!productIds.has(i.productId)).length,0);
  const badMembers=state.sales.filter(s=>s.memberId&&!memberIds.has(s.memberId)).length;
  const invalidStock=state.insumos.filter(i=>!Number.isFinite(Number(i.stock))||Number(i.stock)<0).length;
  const orphanOrders=state.orders.filter(o=>o.saleId&&!state.sales.some(s=>s.id===o.saleId)).length;
  const add=(name,count,okMessage)=>rows.push([count?'✕':'✓',name,count?`${count} inconsistência(s) encontrada(s)`:okMessage,count?'Revise os registros indicados pelo módulo':'—',count?'ATENÇÃO':'OK']);
  add('Identificadores',duplicateIds.length,'Identificadores únicos nas coleções');add('Fichas técnicas',badRecipes,'Todos os insumos vinculados existem');add('Itens vendidos',badSaleItems,'Todos os produtos históricos estão vinculados');add('Clientes em pedidos',badMembers,'Todos os clientes vinculados existem');add('Estoque',invalidStock,'Saldos numéricos e não negativos');add('Pedidos da cozinha',orphanOrders,'Todos os pedidos possuem venda de origem');
  const last=state.settings.lastBackupAt?Date.now()-new Date(state.settings.lastBackupAt).getTime():Infinity,days=Math.floor(last/86400000);rows.push([days<=7?'✓':'!', 'Backup',days<=7?'Backup realizado nos últimos 7 dias':state.settings.lastBackupAt?`Último backup há ${days} dia(s)`:'Nenhum backup registrado','—',days<=7?'OK':'RECOMENDADO']);
  return rows;
}
async function runDiagnostics(){const body=document.getElementById('diagRows');body.innerHTML='<tr><td colspan="5" class="empty">Verificando...</td></tr>';const rows=[];try{const probe=JSON.stringify({t:Date.now()});await storageApi.set('cantina2:diagcheck',probe);const read=await storageApi.get('cantina2:diagcheck');if(!read||read.value!==probe)throw new Error('Leitura de conferência divergente');rows.push(['✓','Armazenamento','Leitura e gravação disponíveis','—','OK']);}catch(e){rows.push(['✕','Armazenamento','Falha ao conferir dados',e.message||'Erro','FALHA']);}rows.push(['✓','Aplicação','JavaScript carregado e estado inicializado','—','OK'],...diagnosticIntegrityRows());rows.push([navigator.onLine?'✓':'!','Rede',navigator.onLine?'Navegador informa conexão disponível':'Navegador está offline','Teste de internet não executado','Informativo']);rows.push(['!','Impressão','Usa a impressora configurada no navegador','Driver/hardware não testados','Informativo']);const integrations=[['WhatsApp',state.settings.whatsappBot],['Pix Online',state.settings.pixOnline],['SMS',state.settings.sms],['Bina',state.settings.bina],['Balança',state.settings.scale]];integrations.forEach(([name,c])=>rows.push([c&&c.enabled?'✓':'!',name,c&&c.enabled?'Configuração local ativa':'Não configurado ou pausado','Conexão externa não executada',c&&c.enabled?'Configurado':'Informativo']));body.innerHTML=rows.map(r=>`<tr><td>${r[0]==='✓'?'<span class="tag tag-green">Sim</span>':r[0]==='✕'?'<span class="tag tag-red">Não</span>':'<span class="tag tag-amber">Info</span>'}</td><td>${h(r[1])}</td><td>${h(r[2])}</td><td>${h(r[3])}</td><td>${h(r[4])}</td></tr>`).join('');state.settings.lastDiagnostic={at:new Date().toISOString(),rows};save('settings');logAction('Diagnóstico local executado');}
function showResourceMonitor(){const openSales=state.sales.filter(s=>s.status==='open').length,pending=state.orders.filter(o=>!['entregue','cancelado'].includes(o.status)).length,queue=state.eventQueue.filter(e=>e.status==='pendente'||e.status==='falha').length,estimatedBytes=new Blob([JSON.stringify(Object.fromEntries(Object.keys(STORE).map(k=>[k,state[k]])))]).size;openModal('Monitor de Recursos',`<div class="grid3"><div class="stat"><div class="lbl">Produtos</div><div class="val">${state.products.length}</div></div><div class="stat"><div class="lbl">Clientes</div><div class="val">${state.members.length}</div></div><div class="stat"><div class="lbl">Vendas</div><div class="val">${state.sales.length}</div></div><div class="stat"><div class="lbl">Pedidos abertos</div><div class="val">${openSales}</div></div><div class="stat"><div class="lbl">Na cozinha</div><div class="val">${pending}</div></div><div class="stat"><div class="lbl">Fila de eventos</div><div class="val">${queue}</div></div></div><div class="panel" style="margin-top:14px"><p>Modo de dados: <b>${h(storageApi.mode)}</b></p><p>Registros de auditoria: <b>${state.logs.length}</b></p><p>Tamanho estimado dos dados: <b>${(estimatedBytes/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB</b></p><p>Último diagnóstico: <b>${state.settings.lastDiagnostic?reportDateTime(state.settings.lastDiagnostic.at):'Ainda não executado'}</b></p></div><div class="consumer-modal-actions"><button onclick="closeModal()">Voltar</button><button class="consumer-save" onclick="closeModal();runDiagnostics()">▷ Executar diagnóstico</button></div>`);}

