#!/usr/bin/env bash
# OPS-06: depois de editar o index.html, confere a sintaxe de todos os <script>
# (mesma regra do CI). Erro volta para o Claude corrigir antes de seguir.
input="$(cat)"
dir="$(dirname "$0")"
file="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.file_path path)"
norm="$file"; case "${norm##*/}" in index.html) ;; *) exit 0 ;; esac
out="$(node "$dir/check-index-syntax.js" "$file" 2>&1)" && exit 0
echo "$out" >&2
exit 2
