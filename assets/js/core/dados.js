/* ============ LOAD / SAVE ============ */
async function loadAll(){
  const scalarDefaults = { cashSession:null, settings:{clubName:'', pixKey:'', receiptFooter:'Obrigado pela preferência!'}, orderCounter:0 };
  /* readFailed[key] = a leitura ESTOUROU (rede/erro do servidor). Diferente de
     "voltou vazio". Chave que falhou ao ler nunca pode ser semeada por cima. */
  const readFailed = {};
  // Tudo em paralelo (10/10): antes eram ~30 leituras uma depois da outra e, com sócios, vendas e
  // pedidos atrás, o login passava de 6 s e o vigia de boot mostrava "Não foi possível carregar".
  const keys = Object.keys(STORE).filter(key=>!(key==='members'||key==='orders'||(key==='sales' && isCloudMode()))); // EST-01: sales vem da tabela
  const membersP = MembersStore.load().catch(()=>[]);
  const ordersP = OrdersStore.load().catch(()=>[]);
  const salesP = isCloudMode() ? SalesStore.load().catch(()=>{ setSalesBase([]); return []; }) : null;
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
  stripIntegrationTokens(state.settings);
  setCashMovementsBase(state.cashMovements);
  setInsumosBase(state.insumos);
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

  if(seedable('users') && !state.users.length){
    state.users.push({id:uid(), name:'Administrador', username:'admin', pin:'1234', role:'admin', origem:'caixa'});
    state.users.push({id:uid(), name:'Garçom App', username:'garcom', pin:'1234', role:'caixa', origem:'app'});
    await save('users');
  } else if(seedable('users') && !state.users.some(u=>u.username==='garcom')){
    state.users.push({id:uid(), name:'Garçom App', username:'garcom', pin:'1234', role:'caixa', origem:'app'});
    await save('users');
  }
  const usersMissingOrigem = state.users.filter(u=>!u.origem);
  if(seedable('users') && usersMissingOrigem.length){
    usersMissingOrigem.forEach(u=>{ u.origem = u.username==='garcom' ? 'app' : 'caixa'; });
    await save('users');
  }
  if(seedable('locais') && !state.locais.length){
    ['Churrasqueira 1','Churrasqueira 2','Churrasqueira 3','Churrasqueira 4','Churrasqueira 5','Sinuca','Bolão','Quadra de Tênis','Salão de Festas','Piscina'].forEach(nome=>state.locais.push({id:uid(), nome}));
    await save('locais');
  }
  if(seedable('impressoras') && !state.impressoras.length){
    state.impressoras.push({id:uid(), nome:'Impressora Cozinha', estacao:'cozinha', origem:'ambos'});
    state.impressoras.push({id:uid(), nome:'Impressora Bar — Caixa', estacao:'bar', origem:'caixa'});
    state.impressoras.push({id:uid(), nome:'Impressora Bar — App', estacao:'bar', origem:'app'});
    state.impressoras.push({id:uid(), nome:'Impressora Churrasqueira — Caixa', estacao:'churrasqueira', origem:'caixa'});
    state.impressoras.push({id:uid(), nome:'Impressora Churrasqueira — App', estacao:'churrasqueira', origem:'app'});
    await save('impressoras');
  }
  if(seedable('estacoes') && !state.estacoes.length){
    state.estacoes.push({id:uid(), chave:'cozinha', nome:'Cozinha', saida:'ambos'});
    state.estacoes.push({id:uid(), chave:'bar', nome:'Bar', saida:'imprime'});
    state.estacoes.push({id:uid(), chave:'churrasqueira', nome:'Churrasqueira', saida:'imprime'});
    await save('estacoes');
  }
  if(seedable('origens') && !state.origens.length){
    state.origens.push({id:uid(), chave:'caixa', nome:'Caixa'});
    state.origens.push({id:uid(), chave:'app', nome:'App do Garçom'});
    await save('origens');
  }
  await migratePendingStaffAsOwner();
  applyBranding();
  renderLogin();
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
async function save(key){
  if(!STORE[key]){ toast('Erro interno: conjunto de dados desconhecido.'); return false; }
  const payload = JSON.stringify(state[key]);
  const previous = saveQueues[key] || Promise.resolve(true);
  const operation = previous.catch(()=>false).then(()=> key==='cashMovements' && isCloudMode() ? pushCashMovements() : key==='insumos' && isCloudMode() ? pushInsumos() : key==='sales' && isCloudMode() ? pushSales() : storageApi.set(STORE[key], payload));
  saveQueues[key] = operation;
  try{ await operation; clearSaveFailBanner(key); return true; }
  catch(e){ saveFailBanner(key); return false; }
}

