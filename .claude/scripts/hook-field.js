// Lê o JSON que o Claude Code manda para o hook (stdin) e imprime um campo.
// Uso: node hook-field.js tool_input.file_path [path]   (campo ausente = linha vazia;
// com "path", troca as barras invertidas do Windows por /)
let raw = '';
process.stdin.on('data', c => raw += c).on('end', () => {
  let v;
  try { v = (process.argv[2] || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), JSON.parse(raw)); } catch (e) { v = undefined; }
  if (v === undefined || v === null) v = '';
  if (process.argv[3] === 'path' && typeof v === 'string') v = v.split(String.fromCharCode(92)).join('/');
  process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
});
