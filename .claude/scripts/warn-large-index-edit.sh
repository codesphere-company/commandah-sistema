#!/usr/bin/env bash
# OPS-06: o index.html é o sistema inteiro (sem build nem teste automático além da
# sintaxe). Edição muito grande ou replace_all pede confirmação do usuário.
input="$(cat)"
dir="$(dirname "$0")"
file="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.file_path path)"
norm="$file"; case "${norm##*/}" in index.html) ;; *) exit 0 ;; esac
tool="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_name)"
reason=""
if [ "$tool" = "Edit" ]; then
  all="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.replace_all)"
  lines="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.old_string | wc -l)"
  [ "$all" = "true" ] && reason="Edit com replace_all no index.html."
  [ "${lines:-0}" -gt 150 ] && reason="Edit troca $lines linhas do index.html."
elif [ "$tool" = "Write" ]; then
  cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null
  old=$(wc -c < index.html 2>/dev/null || echo 0)
  new=$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.content | wc -c)
  if [ "$old" -gt 0 ]; then
    diff=$(( (new > old ? new - old : old - new) * 100 / old ))
    [ "$diff" -gt 15 ] && reason="Write muda o tamanho do index.html em ${diff}%."
  fi
fi
[ -z "$reason" ] && exit 0
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"OPS-06: %s Confirme se a mudança grande é intencional."}}\n' "$reason"
exit 0
