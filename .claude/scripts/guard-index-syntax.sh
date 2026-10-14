#!/usr/bin/env bash
# OPS-06: depois de editar o index.html ou um arquivo de assets/js|css, roda
# scripts/check-app.js (mesma regra do CI). Erro volta para o Claude corrigir antes de seguir.
input="$(cat)"
dir="$(dirname "$0")"
file="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.file_path path)"
case "$file" in
  */index.html|index.html|*/assets/js/*.js|*/assets/css/*.css) ;;
  *) exit 0 ;;
esac
root="${CLAUDE_PROJECT_DIR:-$dir/../..}"
out="$(node "$root/scripts/check-app.js" "$root" 2>&1)" && exit 0
echo "$out" >&2
exit 2
