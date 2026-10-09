#!/usr/bin/env bash
# OPS-06: arquivos .env reais guardam chaves e senhas; não são editados pelo Claude.
# Modelos (.env.example, .env.sample, .env.template) podem.
input="$(cat)"
dir="$(dirname "$0")"
file="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.file_path path)"
[ -z "$file" ] && exit 0
norm="$file"; base="${norm##*/}"
case "$base" in
  .env.example|.env.sample|.env.template) exit 0 ;;
  .env|.env.*)
    echo "Bloqueado (OPS-06): $base guarda segredos e não é editado por aqui. Peça ao dono para alterar à mão." >&2
    exit 2 ;;
esac
exit 0
