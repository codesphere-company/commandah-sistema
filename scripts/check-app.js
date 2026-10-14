// Checagem do app (sem build, sem dependências). Usada no CI e no hook local.
// 1. cada <script> inline do index.html compila;
// 2. cada <script src="assets/js/..."> e <link href="assets/css/..."> existe, e o JS compila
//    como script clássico (o mesmo modo do navegador);
// 3. todas as tags locais têm o MESMO ?v= (é ele que faz navegador e service worker trocarem
//    a versão juntos);
// 4. nenhum arquivo em assets/js ou assets/css fica fora do index.html (órfão).
// Uso: node scripts/check-app.js [raiz-do-repo]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];

let m, inline = 0;
const reInline = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
while ((m = reInline.exec(html))) {
  inline++;
  try { new vm.Script(m[1]); } catch (e) { errors.push(`index.html, <script> inline ${inline}: ${e.message}`); }
}

const refs = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="((assets\/(?:js|css))\/[^"?]+)(?:\?v=([^"]*))?"/g)];
const versions = new Set();
const used = new Set();
for (const [, file, , ver] of refs) {
  used.add(file);
  versions.add(ver || '(sem ?v=)');
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { errors.push(`${file}: referenciado no index.html mas não existe`); continue; }
  if (file.endsWith('.js')) {
    try { new vm.Script(fs.readFileSync(full, 'utf8'), { filename: file }); }
    catch (e) { errors.push(`${file}: ${e.message}`); }
  }
}
if (versions.size > 1) errors.push(`?v= diferente entre as tags: ${[...versions].join(', ')} (rode node scripts/bump-version.js)`);

function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);
}
for (const f of [...walk('assets/js'), ...walk('assets/css')]) {
  if (/\.(js|css)$/.test(f) && !used.has(f)) errors.push(`${f}: não está no index.html (órfão)`);
}

if (errors.length) {
  console.error('Problemas no app:\n  - ' + errors.join('\n  - '));
  process.exit(1);
}
console.log(`OK: ${inline} script(s) inline, ${refs.length} arquivo(s) de assets, versão ${[...versions][0]}.`);
