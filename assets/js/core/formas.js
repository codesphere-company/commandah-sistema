/* ============ FORMAS DE PAGAMENTO (modelo) ============
   09/11 (pedido do dono): uma lista única de formas, configurável. Cada forma tem um tipo
   (que define o código fiscal tPag e o grupo dos totais), onde aparece e quem confere.
   Tela, pontos de pagamento, fechamento e relatórios leem daqui. */
const FORMAS_TIPOS = {
  dinheiro:         { label:'Dinheiro',                          tPag:'01' },
  credito:          { label:'Cartão de crédito',                 tPag:'03' },
  debito:           { label:'Cartão de débito',                  tPag:'04' },
  fiado:            { label:'Fiado / crédito da loja',           tPag:'05' },
  vale_alimentacao: { label:'Vale-alimentação',                  tPag:'10' },
  vale_refeicao:    { label:'Vale-refeição',                     tPag:'11' },
  vale_presente:    { label:'Vale-presente',                     tPag:'12' },
  deposito:         { label:'Depósito bancário',                 tPag:'16' },
  pix:              { label:'Pix',                               tPag:'17' },
  // 09/11 (pedido do dono): chave ou QR fixo; o tPag 17 é só do QR gerado a cada venda.
  pix_estatico:     { label:'Pix estático',                      tPag:'20' },
  transferencia:    { label:'Transferência ou carteira digital', tPag:'18' },
  fidelidade:       { label:'Programa de fidelidade ou cashback', tPag:'19' },
  outros:           { label:'Outros',                            tPag:'99' },
};
// Formas com que todo estabelecimento começa (equivalem ao que existia antes).
const FORMAS_INICIAIS = [
  { method:'dinheiro', nome:'Dinheiro', tipo:'dinheiro', naVenda:true, noFiado:true,  confere:'operador' },
  { method:'credito',  nome:'Crédito',  tipo:'credito',  naVenda:true, noFiado:true,  confere:'admin' },
  { method:'debito',   nome:'Débito',   tipo:'debito',   naVenda:true, noFiado:true,  confere:'admin' },
  { method:'pix',      nome:'Pix',      tipo:'pix',      naVenda:true, noFiado:true,  confere:'admin' },
  { method:'vale',     nome:'Vale',     tipo:'vale_refeicao', naVenda:true, noFiado:false, confere:'admin' },
  { method:'fiado',    nome:'Fiado',    tipo:'fiado',    naVenda:true, noFiado:false, confere:'ninguem' },
];
// Iniciais + o que o administrador gravou em state.paymentMethods. Item com o method de uma
// inicial a substitui; item antigo (só nome, sem method) vira extra do tipo Outros.
function listaDeFormas(){
  const lista = FORMAS_INICIAIS.map(f=>({ ...f }));
  const gravadas = (typeof state!=='undefined' && state && Array.isArray(state.paymentMethods)) ? state.paymentMethods : [];
  gravadas.forEach(item=>{
    if(!item) return;
    if(item.method){
      const i = lista.findIndex(f=>f.method===item.method);
      if(i>=0) lista[i] = { ...lista[i], ...item };
      else lista.push({ ...item });
    } else if(item.nome){
      lista.push({ ...item, method:'outro:'+item.nome, tipo:'outros', naVenda:true, noFiado:true, confere:'ninguem' });
    }
  });
  return lista;
}
function formaPorMetodo(m){ return listaDeFormas().find(f=>f.method===m) || null; }
function formasNaVenda(){ return listaDeFormas().filter(f=>f.naVenda); }
function formasNoFiado(){ return listaDeFormas().filter(f=>f.noFiado); }
// Valor legado ('Dinheiro', 'Pix', 'Cartão') vira a chave minúscula sem acento; 'forma:x' e 'outro:Nome' ficam como estão.
function normalizarMetodo(m){
  if(typeof m!=='string') return '';
  if(m.startsWith('forma:') || m.startsWith('outro:')) return m;
  return m.trim().normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
}
function tPagDoMetodo(m){
  const f = formaPorMetodo(normalizarMetodo(m)) || formaPorMetodo(m);
  const t = f && FORMAS_TIPOS[f.tipo];
  return t ? t.tPag : null;
}
// Grupo dos totais por tipo.
function grupoDoTipo(tipo){
  return tipo==='credito'||tipo==='debito' ? 'cartao' : (tipo==='pix'||tipo==='pix_estatico') ? 'pix' : tipo==='dinheiro' ? 'dinheiro' : tipo==='fiado' ? 'fiado' : 'outros';
}
