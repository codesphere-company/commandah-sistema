// Confere a ORDEM dos <script src="assets/js/..."> do index.html.
// Os arquivos são scripts clássicos que compartilham o escopo global e rodam em sequência:
// código que roda NO CARREGAMENTO (fora de função) não pode usar nome declarado só num
// arquivo posterior, e uma função não pode ser declarada em dois arquivos (a ordem
// passaria a decidir qual vale). Chamadas de dentro de funções rodam depois e podem.
// Precisa de acorn (no CI: npm i --no-save acorn@8.14.0 acorn-walk@8.3.4).
// Uso: node scripts/check-load-order.js [raiz-do-repo]
const fs = require('fs');
const path = require('path');

let acorn, walk;
try { acorn = require('acorn'); walk = require('acorn-walk'); }
catch (e) {
  console.log('check-load-order: acorn não instalado, pulando (npm i --no-save acorn@8.14.0 acorn-walk@8.3.4).');
  process.exit(0);
}

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="(assets\/js\/[^"?]+)/g)].map(m => m[1]);
const firstDecl = new Map();
const fnFiles = new Map();
const problems = [];

const asts = files.map((f, i) => {
  const ast = acorn.parse(fs.readFileSync(path.join(root, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  for (const n of ast.body) {
    const names = [];
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
      names.push(n.id.name);
      if (!fnFiles.has(n.id.name)) fnFiles.set(n.id.name, new Set());
      fnFiles.get(n.id.name).add(f);
    }
    if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) walk.fullAncestor(d.id, x => { if (x.type === 'Identifier') names.push(x.name); });
    }
    for (const nm of names) if (!firstDecl.has(nm)) firstDecl.set(nm, i);
  }
  return ast;
});

for (const [nm, set] of fnFiles) if (set.size > 1) problems.push(`function ${nm} declarada em ${[...set].join(' e ')}`);

const isFn = n => n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
asts.forEach((ast, i) => {
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') continue;
    const used = new Set();
    (function visit(node) {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression' && isFn(node.callee)) { visit(node.callee.body); node.arguments.forEach(visit); return; } // IIFE roda agora
      if (isFn(node)) return; // corpo de função roda depois
      if (node.type === 'Identifier') used.add(node.name);
      if (node.type === 'MemberExpression' && !node.computed) return visit(node.object);
      if (node.type === 'Property' && !node.computed) return visit(node.value);
      for (const k in node) {
        const v = node[k];
        if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v);
      }
    })(stmt);
    const later = [...used].filter(nm => firstDecl.has(nm) && firstDecl.get(nm) > i);
    if (later.length) problems.push(`${files[i]}:${stmt.loc.start.line} roda no carregamento e usa ${later.join(', ')}, declarado(s) em arquivo posterior`);
  }
});

if (problems.length) {
  console.error('Ordem de carregamento quebrada:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`OK: ordem de carregamento de ${files.length} arquivos.`);
