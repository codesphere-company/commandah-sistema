#!/usr/bin/env bash
# OPS-06: migration que já está no git (ou seja, já foi ou vai ser aplicada em
# produção) não se edita: o banco não roda o arquivo de novo e o repositório
# deixaria de contar a verdade. Correção = migration NOVA. Arquivo novo passa.
input="$(cat)"
dir="$(dirname "$0")"
file="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.file_path path)"
[ -z "$file" ] && exit 0
norm="$file"
case "$norm" in
  */supabase/migrations/*.sql|supabase/migrations/*.sql) ;;
  *) exit 0 ;;
esac
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
rel="supabase/migrations/$(basename "$norm")"
if git ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
  echo "Bloqueado (OPS-06): $rel já está no git e provavelmente já foi aplicada em produção. Não edite migration aplicada; crie uma nova (supabase/migrations/AAAAMMDDHHMMSS_descricao.sql)." >&2
  exit 2
fi
exit 0
