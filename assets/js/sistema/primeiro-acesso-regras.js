/* ============ PRIMEIRO ACESSO: REGRAS ============ */
// Auditoria 11/11, item 1: estabelecimento novo nascia com os locais, estações e impressoras do clube e sem
// guia nenhum. Aqui ficam só as regras (sem DOM e sem `state` no carregamento), testadas no Node por
// scripts/test-primeiro-acesso.js. A tela e o cartão ficam em sistema/primeiro-acesso.js.

// Conta nova = nunca respondeu "Como você atende?" e não tem produto nem venda. O clube e o demo têm
// produtos, então nunca caem aqui. Quem chama confere antes se alguma leitura falhou (lista vazia por
// falha de leitura imitaria conta nova).
function precisaPrimeiroAcesso(st){
  const s = (st && st.settings) || {};
  return !s.atendimento && !((st.products||[]).length) && !((st.sales||[]).length);
}

// Estações que a tela pode criar, na ordem e com a mesma saída da semeadura antiga do clube.
const ESTACOES_DO_PRIMEIRO_ACESSO = [
  { chave:'cozinha', nome:'Cozinha', saida:'ambos' },
  { chave:'bar', nome:'Bar', saida:'imprime' },
  { chave:'churrasqueira', nome:'Churrasqueira', saida:'imprime' },
];

// Converte as escolhas da tela no que gravar. Devolve as listas COMPLETAS (atuais + o que falta), para
// abrir a tela de novo depois de um recarregamento não duplicar "Mesa 1" nem estações.
function montarAtendimento(escolhas, atuais, uidFn){
  const e = escolhas || {};
  const nome = String(e.nome||'').trim();
  if(!nome) return { error:'Informe o nome do estabelecimento.' };
  if(nome.length>60) return { error:'O nome pode ter até 60 letras.' };
  let qtdMesas = 0;
  if(e.mesas){
    const txt = String(e.qtdMesas==null?'':e.qtdMesas).trim();
    qtdMesas = /^\d+$/.test(txt) ? parseInt(txt,10) : NaN;
    if(!(qtdMesas>=1 && qtdMesas<=200)) return { error:'Informe quantas mesas (de 1 a 200).' };
  }
  const preparo = e.preparo || {};
  const preparoLimpo = { cozinha:!!preparo.cozinha, bar:!!preparo.bar, churrasqueira:!!preparo.churrasqueira };
  if(!preparoLimpo.cozinha && !preparoLimpo.bar && !preparoLimpo.churrasqueira) return { error:'Marque pelo menos um lugar onde os pedidos são preparados.' };

  const a = atuais || {};
  const locais = (a.locais||[]).slice();
  if(e.mesas){
    const existentes = new Set(locais.map(l=>String(l.nome||'').trim().toLowerCase()));
    for(let i=1;i<=qtdMesas;i++){
      const n = 'Mesa '+i;
      if(!existentes.has(n.toLowerCase())) locais.push({ id:uidFn(), nome:n });
    }
  }
  const estacoes = (a.estacoes||[]).slice();
  const chaves = new Set(estacoes.map(x=>x.chave));
  ESTACOES_DO_PRIMEIRO_ACESSO.forEach(modelo=>{
    if(preparoLimpo[modelo.chave] && !chaves.has(modelo.chave)) estacoes.push({ id:uidFn(), chave:modelo.chave, nome:modelo.nome, saida:modelo.saida });
  });

  const settings = {
    clubName: nome,
    operationMode: e.socios ? 'clube' : 'bar',
    atendimento: { socios:!!e.socios, mesas:!!e.mesas, qtdMesas: e.mesas?qtdMesas:0, balcao:!!e.balcao, preparo:preparoLimpo, em:e.em },
  };
  if(e.mesas) settings.tableCount = qtdMesas;
  return { settings, locais, estacoes };
}

// Produto novo vai para a primeira estação que existe (conta só com Bar não tem "cozinha").
function estacaoPadraoProduto(estacoes){
  return (estacoes && estacoes.length && estacoes[0].chave) ? estacoes[0].chave : 'nenhuma';
}

// Balcão com ficha marcado: o administrador entra na Ficha. Senão, Comandas (o padrão de hoje).
function telaInicialDoAdmin(settings){
  return (settings && settings.atendimento && settings.atendimento.balcao) ? 'balcao' : 'comandas';
}

// Os seis passos do cartão, na ordem aprovada pelo dono. `feito` vem da conferência automática ou da
// marcação manual ("Já fiz") em settings.primeirosPassos.feitos.
function passosPrimeirosPassos(st, extras){
  const s = (st && st.settings) || {};
  const manual = (s.primeirosPassos && s.primeirosPassos.feitos) || {};
  const x = extras || {};
  const preenchido = (v)=> String(v||'').trim()!=='';
  const auto = {
    dados: preenchido(s.clubName) && preenchido(s.address) && preenchido(s.city),
    colaboradores: (st.users||[]).filter(u=>u.active!==false).length>1,
    produtos: (st.products||[]).length>0,
    nfce: x.emissorConfigurado===true,
    impressoras: (st.impressoras||[]).length>0,
    venda: (st.sales||[]).some(v=>v.status==='closed' && !v.canceled),
  };
  return [
    { id:'dados', titulo:'Dados do estabelecimento', detalhe:'nome, logo, endereço' },
    { id:'colaboradores', titulo:'Colaboradores', detalhe:'caixa, garçom, cozinha, com PIN' },
    { id:'produtos', titulo:'Produtos', detalhe:'cadastre ou importe a planilha' },
    { id:'nfce', titulo:'Nota fiscal', detalhe:'token da Brasil NFe e série' },
    { id:'impressoras', titulo:'Impressoras', detalhe:'instalar o agente e parear' },
    { id:'venda', titulo:'Primeira venda de teste', detalhe:'abra uma comanda, lance e feche' },
  ].map(p=>({ ...p, feito: !!(auto[p.id] || manual[p.id]) }));
}
