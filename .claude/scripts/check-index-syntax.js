// Mesma checagem do workflow check-index-syntax.yml: cada <script> inline precisa compilar.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0; const errors = [];
while ((m = re.exec(html))) {
  i++;
  try { new Function(m[1]); } catch (e) { errors.push('bloco ' + i + ' (linha ' + (html.slice(0, m.index).split('\n').length) + '): ' + e.message); }
}
if (errors.length) { console.error('Erro de sintaxe JS em index.html:\n  - ' + errors.join('\n  - ')); process.exit(1); }
console.log('OK: ' + i + ' bloco(s) <script> validado(s).');
