/* ============ LOAD / SAVE ============ */
async function loadAll(){
  await carregarDados();
  renderLogin();
}
/* Auditoria 03/11 (A1): o que a RLS deixa ler depende do papel da sessão. dadosCarregadosComo guarda
   com qual "visão" os dados em memória foram lidos: 'total' (dono ou admin), 'caixa' ou 'cozinha';
   null = não deu para saber. Quem entra por PIN com outra visão recarrega antes de abrir as telas
   (attemptPinLogin): antes, um admin que entrava num aparelho aberto como caixa via Contas a Pagar
   vazia, e o primeiro "salvar" gravava a lista vazia por cima da real. */
let dadosCarregadosComo = null;
// Auditoria 11/11, item 1: chaves cuja última leitura falhou. A tela de primeiro acesso não abre com falha
// (lista vazia por erro imitaria conta nova). Atualizada a cada carregarDados().
let falhasDeLeitura = [];
// Revisão final, item 2: o garçom tem visão própria (lê quase o mesmo que o caixa, mas não o fiado);
// antes caía em null e todo login de garçom forçava carregarDados() completo, e caixa ↔ garçom no mesmo
// aparelho ficariam com os dados da visão errada se fossem tratados como iguais.
function visaoDoPapel(papel){ return papel==='owner'||papel==='admin' ? 'total' : papel==='caixa'||papel==='garcom'||papel==='cozinha' ? papel : null; }
async function visaoDaSessao(){
  if(!isCloudMode()) return 'total'; // sem RLS: lê tudo
  if(sessionIsOwner) return 'total';
  try{ const { data, error } = await supabaseClient.rpc('current_staff_role'); return error ? null : visaoDoPapel(data); }
  catch(e){ return null; }
}
// Lê tudo do servidor para a memória. Devolve as chaves cuja leitura falhou (vazio = tudo certo).
async function carregarDados(){
  const visaoP = visaoDaSessao();
  const scalarDefaults = { cashSession:null, settings:{clubName:'', pixKey:'', receiptFooter:'Obrigado pela preferência!'}, orderCounter:0 };
  /* readFailed[key] = a leitura ESTOUROU (rede/erro do servidor). Diferente de
     "voltou vazio". Chave que falhou ao ler nunca pode ser semeada por cima. */
  const readFailed = {};
  // Tudo em paralelo (10/10): antes eram ~30 leituras uma depois da outra e, com sócios, vendas e
  // pedidos atrás, o login passava de 6 s e o vigia de boot mostrava "Não foi possível carregar".
  const keys = Object.keys(STORE).filter(key=>!(key==='members'||key==='orders'||(key==='sales' && isCloudMode()))); // EST-01: sales vem da tabela
  const membersP = MembersStore.load().catch(()=>{ readFailed.members = true; return []; });
  const ordersP = OrdersStore.load().catch(()=>{ readFailed.orders = true; return []; });
  const salesP = isCloudMode() ? SalesStore.load().catch(()=>{ readFailed.sales = true; setSalesBase([]); return []; }) : null;
  // t404: na nuvem, as chaves vêm numa leitura só; se ela falhar, lê uma por uma como antes.
  let many = null;
  if(typeof storageApi.getMany === 'function'){ try{ many = await storageApi.getMany(keys.map(k=>STORE[k])); }catch(e){ many = null; } }
  const blobsP = Promise.all(keys.map(async key=>{
    try{
      const r = many ? (many[STORE[key]] || null) : await storageApi.get(STORE[key]);
      state[key] = r ? JSON.parse(r.value) : (key in scalarDefaults ? scalarDefaults[key] : []);
    }catch(e){ readFailed[key] = true; state[key] = (key in scalarDefaults ? scalarDefaults[key] : []); }
  }));
  await blobsP;
  // Caixa por operador (13/11): com o ajuste ligado o turno vem de cash_turnos (RPC redigida), não de cantina2:cashSession.
  if(isCloudMode() && modoCaixaPorOperador()){
    try{ aplicarTurnosNoEstado(await lerTurnosDoServidor()); }
    catch(e){
      // Leitura que falhou NÃO é caixa fechado: com o flag true a tela (Task 4) não oferece "Abrir"; o próximo polling certo limpa.
      readFailed.cashSession = true; state.cashTurnosFalhou = true; state.cashTurnos = null; state.cashSession = null;
    }
  }
  stripIntegrationTokens(state.settings);
  setCashMovementsBase(state.cashMovements);
  setInsumosBase(state.insumos);
  setProdutosAtivoBase(state.products); // 08/11: mescla do "active" no save('products') (caixa-multiaparelho.js)
  state.members = await membersP;
  state.orders = await ordersP;
  if(salesP) state.sales = await salesP;

  /* ---- SEMEADURA DE PADRÕES: quando é seguro gravar ----------------------
     storageApi.get() usa .maybeSingle(): linha filtrada pela RLS volta como
     `null`, SEM erro — exatamente igual a "essa chave ainda não existe". O
     cliente não tem como distinguir os dois casos. Se a gente semeasse mesmo
     assim, um operador sem permissão de leitura gravaria o padrão POR CIMA do
     dado real: 2 usuários fake apagando o quadro de colaboradores, 10 locais
     genéricos apagando as churrasqueiras do clube. Já aconteceria hoje; com a
     RLS por papel viraria rotina.
     Regra: só semeia quando dá pra PROVAR que a escrita é permitida —
       - fora da nuvem (Local/Compartilhado): não existe RLS, comportamento antigo;
       - na nuvem: só a sessão do DONO, que passa por todas as policies.
     Operador (caixa/cozinha) nunca semeia. Se o banco estiver mesmo vazio, quem
     faz a carga inicial é o dono no primeiro acesso — que é o fluxo real. */
  const canSeed = !isCloudMode() || sessionIsOwner;
  const seedable = (key)=> canSeed && !readFailed[key];

  // Auditoria 11/11: na nuvem ninguém nasce mais com PIN 1234. O Administrador e o Garçom App
  // semeados aqui iam para o servidor com 1234 (migratePendingStaffAsOwner) e a troca obrigatória
  // nunca abria (ela só conferia o PIN do aparelho). Agora, sem colaboradores, a tela de entrada
  // pede ao dono para criar o Administrador com PIN próprio (renderLogin → criarPrimeiroAdmin).
  // Só o modo local (sem servidor) continua semeando, e lá a troca obrigatória funciona.
  if(seedable('users') && !state.users.length && !isCloudMode()){
    state.users.push({id:uid(), name:'Administrador', username:'admin', pin:'1234', role:'admin', origem:'caixa'});
    // Revisão final, item 3: o garçom de estabelecimento novo já nasce com o perfil garcom.
    state.users.push({id:uid(), name:'Garçom App', username:'garcom', pin:'1234', role:'garcom', origem:'app'});
    await save('users');
  } else if(seedable('users') && state.users.length && !isCloudMode() && !state.users.some(u=>u.username==='garcom')){
    state.users.push({id:uid(), name:'Garçom App', username:'garcom', pin:'1234', role:'garcom', origem:'app'});
    await save('users');
  }
  const usersMissingOrigem = state.users.filter(u=>!u.origem);
  if(seedable('users') && usersMissingOrigem.length){
    usersMissingOrigem.forEach(u=>{ u.origem = u.username==='garcom' ? 'app' : 'caixa'; });
    await save('users');
  }
  // Auditoria 11/11, item 1: aqui nasciam os 10 locais do clube (Churrasqueira 1 a 5, Piscina...), 5 impressoras
  // e as estações Cozinha, Bar e Churrasqueira em TODO estabelecimento novo. Agora a conta nasce sem eles e a
  // tela "Como você atende?" (sistema/primeiro-acesso.js) cria só as mesas e estações que o dono marcar.
  if(seedable('origens') && !state.origens.length){
    state.origens.push({id:uid(), chave:'caixa', nome:'Caixa'});
    state.origens.push({id:uid(), chave:'app', nome:'App do Garçom'});
    await save('origens');
  }
  await migratePendingStaffAsOwner();
  applyBranding();
  dadosCarregadosComo = await visaoP;
  falhasDeLeitura = Object.keys(readFailed);
  return falhasDeLeitura;
}
/* Estabelecimento recém-criado: os usuários semeados acima (Administrador /
   Garçom App) nascem sem acesso seguro, e na nuvem o login por PIN de quem não
   foi migrado é barrado de propósito (ver pinSubmit). Como só um admin logado
   migra colaboradores, ninguém entrava nunca. Aqui a sessão do DONO — a única
   que pode chamar create_operator sem ninguém logado — migra os pendentes pela
   Edge Function, o mesmo caminho de "Migrar acesso seguro". Não afrouxa nada:
   o PIN passa a ser validado no servidor e sai do cadastro local. */
async function migratePendingStaffAsOwner(){
  if(!isCloudMode() || !sessionIsOwner || !supabaseClient) return;
  const pending = state.users.filter(u=>!u.migratedAuth && u.pin);
  if(!pending.length) return;
  let changed = false;
  for(const u of pending){
    try{
      const { data: fnData, error } = await supabaseClient.functions.invoke('staff-auth', { body:{ action:'create_operator', staff_id:u.id, name:u.name, role:u.role, pin:u.pin, legacy_migration:true } });
      if(!error && fnData && !fnData.error){ u.migratedAuth = true; delete u.pin; changed = true; }
    }catch(e){}
  }
  if(changed) await save('users');
}
// 08/11: 'products' na nuvem vai por pushProducts (mescla o "active" pausado em outro aparelho).
async function save(key){
  if(!STORE[key]){ toast('Erro interno: conjunto de dados desconhecido.'); return false; }
  const payload = JSON.stringify(state[key]);
  const previous = saveQueues[key] || Promise.resolve(true);
  const operation = previous.catch(()=>false).then(()=> key==='cashMovements' && isCloudMode() ? pushCashMovements() : key==='insumos' && isCloudMode() ? pushInsumos() : key==='sales' && isCloudMode() ? pushSales() : key==='products' && isCloudMode() ? pushProducts() : storageApi.set(STORE[key], payload));
  saveQueues[key] = operation;
  try{ await operation; clearSaveFailBanner(key); return true; }
  catch(e){ saveFailBanner(key); return false; }
}

