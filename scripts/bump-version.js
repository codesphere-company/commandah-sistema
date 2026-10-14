// Troca o ?v= de todas as tags de assets/js e assets/css do index.html por uma versão nova
// (AAAAMMDD + letra). Rode sempre que mudar qualquer arquivo de assets/js ou assets/css.
// Uso: node scripts/bump-version.js [versao]
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const re = /(<(?:script src|link rel="stylesheet" href)="assets\/(?:js|css)\/[^"?]+)\?v=([^"]*)"/g;
const current = [...html.matchAll(re)].map(m => m[2]);

let next = process.argv[2];
if (!next) {
  const d = new Date();
  const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const sameDay = current.filter(v => v.startsWith(today)).map(v => v.slice(8)).sort();
  const last = sameDay[sameDay.length - 1];
  next = today + (last ? String.fromCharCode(last.charCodeAt(0) + 1) : 'a');
}
fs.writeFileSync(file, html.replace(re, `$1?v=${next}"`));
console.log(`?v= ${[...new Set(current)].join(', ') || '(nenhum)'} -> ${next}`);
