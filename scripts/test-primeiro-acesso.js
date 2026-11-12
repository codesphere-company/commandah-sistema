/* Testes das regras do primeiro acesso (assets/js/sistema/primeiro-acesso-regras.js), auditoria 11/11, item 1.
   Roda no Node puro: node scripts/test-primeiro-acesso.js
   Carrega o arquivo como script clássico num contexto vazio (as regras não usam DOM nem state). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'sistema', 'primeiro-acesso-regras.js'), 'utf8'), ctx);
const { precisaPrimeiroAcesso, montarAtendimento, estacaoPadraoProduto, telaInicialDoAdmin, passosPrimeirosPassos } = ctx;

let n = 0;
function t(nome, fn) {
  try { fn(); } catch (e) { console.error('FALHOU: ' + nome); throw e; }
  n++;
}
// Arrays vindos do contexto do vm têm outro Array.prototype: compara pelo JSON.
const igual = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
let seq = 0;
const uid = () => 'id' + (++seq);
const EM = '2026-11-12T12:00:00.000Z';
const vazio = () => ({ locais: [], estacoes: [] });
const base = (o) => Object.assign({ nome: 'Bar do Zé', socios: false, mesas: false, qtdMesas: '', balcao: false, preparo: { cozinha: false, bar: true, churrasqueira: false }, em: EM }, o);

t('precisaPrimeiroAcesso: conta vazia', () => {
  assert.strictEqual(precisaPrimeiroAcesso({ settings: {}, products: [], sales: [] }), true);
});
t('precisaPrimeiroAcesso: com produto, venda ou atendimento não abre', () => {
  assert.strictEqual(precisaPrimeiroAcesso({ settings: {}, products: [{ id: 'p' }], sales: [] }), false);
  assert.strictEqual(precisaPrimeiroAcesso({ settings: {}, products: [], sales: [{ id: 's' }] }), false);
  assert.strictEqual(precisaPrimeiroAcesso({ settings: { atendimento: { em: EM } }, products: [], sales: [] }), false);
});

t('montarAtendimento: bar com 3 mesas', () => {
  const r = montarAtendimento(base({ mesas: true, qtdMesas: 3 }), vazio(), uid);
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.settings.clubName, 'Bar do Zé');
  assert.strictEqual(r.settings.operationMode, 'bar');
  assert.strictEqual(r.settings.tableCount, 3);
  igual(r.locais.map(l => l.nome), ['Mesa 1', 'Mesa 2', 'Mesa 3']);
  assert.ok(r.locais.every(l => typeof l.id === 'string' && l.id));
  igual(r.estacoes.map(e => e.chave), ['bar']);
  assert.strictEqual(r.estacoes[0].nome, 'Bar');
  assert.strictEqual(r.estacoes[0].saida, 'imprime');
  igual(r.settings.atendimento, { socios: false, mesas: true, qtdMesas: 3, balcao: false, preparo: { cozinha: false, bar: true, churrasqueira: false }, em: EM });
});
t('montarAtendimento: sócios vira clube; sem mesas não mexe em locais', () => {
  const atuais = { locais: [{ id: 'x', nome: 'Quiosque' }], estacoes: [] };
  const r = montarAtendimento(base({ socios: true, preparo: { cozinha: true, bar: true, churrasqueira: true } }), atuais, uid);
  assert.strictEqual(r.settings.operationMode, 'clube');
  assert.strictEqual('tableCount' in r.settings, false);
  igual(r.locais, atuais.locais);
  igual(r.estacoes.map(e => [e.chave, e.nome, e.saida]), [['cozinha', 'Cozinha', 'ambos'], ['bar', 'Bar', 'imprime'], ['churrasqueira', 'Churrasqueira', 'imprime']]);
});
t('montarAtendimento: não duplica mesas nem estações', () => {
  const atuais = { locais: [{ id: 'a', nome: 'Mesa 1' }], estacoes: [{ id: 'b', chave: 'bar', nome: 'Bar', saida: 'imprime' }] };
  const r = montarAtendimento(base({ mesas: true, qtdMesas: 2 }), atuais, uid);
  assert.strictEqual(r.locais.length, 2);
  igual(r.locais.map(l => l.nome), ['Mesa 1', 'Mesa 2']);
  assert.strictEqual(r.estacoes.length, 1);
  assert.strictEqual(r.estacoes[0].id, 'b');
});
t('montarAtendimento: nome apara espaços', () => {
  assert.strictEqual(montarAtendimento(base({ nome: '  Bar  ' }), vazio(), uid).settings.clubName, 'Bar');
});
t('montarAtendimento: erros com o texto exato', () => {
  [0, 201, 'abc', 2.5, ''].forEach(q => assert.strictEqual(montarAtendimento(base({ mesas: true, qtdMesas: q }), vazio(), uid).error, 'Informe quantas mesas (de 1 a 200).', String(q)));
  assert.strictEqual(montarAtendimento(base({ nome: '   ' }), vazio(), uid).error, 'Informe o nome do estabelecimento.');
  assert.strictEqual(montarAtendimento(base({ nome: 'a'.repeat(61) }), vazio(), uid).error, 'O nome pode ter até 60 letras.');
  assert.strictEqual(montarAtendimento(base({ preparo: { cozinha: false, bar: false, churrasqueira: false } }), vazio(), uid).error, 'Marque pelo menos um lugar onde os pedidos são preparados.');
});
t('montarAtendimento: mesas aceita texto numérico do campo', () => {
  assert.strictEqual(montarAtendimento(base({ mesas: true, qtdMesas: '4' }), vazio(), uid).settings.tableCount, 4);
});

t('estacaoPadraoProduto', () => {
  assert.strictEqual(estacaoPadraoProduto([]), 'nenhuma');
  assert.strictEqual(estacaoPadraoProduto(undefined), 'nenhuma');
  assert.strictEqual(estacaoPadraoProduto([{ chave: 'bar' }, { chave: 'cozinha' }]), 'bar');
});
t('telaInicialDoAdmin', () => {
  assert.strictEqual(telaInicialDoAdmin({ atendimento: { balcao: true } }), 'balcao');
  assert.strictEqual(telaInicialDoAdmin({ atendimento: { balcao: false } }), 'comandas');
  assert.strictEqual(telaInicialDoAdmin({}), 'comandas');
});

const contaVazia = () => ({ settings: {}, users: [{ id: 'u1', active: true }], products: [], impressoras: [], sales: [] });
t('passosPrimeirosPassos: conta vazia', () => {
  const p = passosPrimeirosPassos(contaVazia(), {});
  igual(p.map(x => x.id), ['dados', 'colaboradores', 'produtos', 'nfce', 'impressoras', 'venda']);
  assert.ok(p.every(x => x.feito === false));
  igual(p.map(x => x.titulo), ['Dados do estabelecimento', 'Colaboradores', 'Produtos', 'Nota fiscal', 'Impressoras', 'Primeira venda de teste']);
  assert.ok(p.every(x => typeof x.detalhe === 'string' && x.detalhe));
});
t('passosPrimeirosPassos: tudo feito', () => {
  const st = { settings: { clubName: 'Bar', address: 'Rua A', city: 'Maringá' }, users: [{ id: 'u1' }, { id: 'u2', active: true }],
    products: [{ id: 'p' }], impressoras: [{ id: 'i' }], sales: [{ status: 'closed' }] };
  assert.ok(passosPrimeirosPassos(st, { emissorConfigurado: true }).every(x => x.feito === true));
});
t('passosPrimeirosPassos: casos que não contam', () => {
  const st = contaVazia();
  st.settings = { clubName: 'Bar', address: '', city: 'Maringá' };
  st.users.push({ id: 'u2', active: false });
  st.sales = [{ status: 'closed', canceled: true }, { status: 'open' }];
  const p = passosPrimeirosPassos(st, { emissorConfigurado: false });
  assert.ok(p.every(x => x.feito === false));
});
t('passosPrimeirosPassos: marcação manual', () => {
  const st = contaVazia();
  st.settings = { primeirosPassos: { feitos: { nfce: true } } };
  const p = passosPrimeirosPassos(st);
  assert.strictEqual(p.find(x => x.id === 'nfce').feito, true);
  assert.strictEqual(p.find(x => x.id === 'impressoras').feito, false);
});

console.log('OK: ' + n + ' teste(s) do primeiro acesso.');
