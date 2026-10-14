#!/usr/bin/env bash
# OPS-06: o app não tem teste automático além das checagens de scripts/. Edição muito
# grande ou replace_all no index.html ou num arquivo de assets/js pede confirmação do usuário.
input="$(cat)"
dir="$(dirname "$0")"
file="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.file_path path)"
case "$file" in
  */index.html|index.html|*/assets/js/*.js) ;;
  *) exit 0 ;;
esac
name="${file##*/}"
tool="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_name)"
reason=""
if [ "$tool" = "Edit" ]; then
  all="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.replace_all)"
  lines="$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.old_string | wc -l)"
  [ "$all" = "true" ] && reason="Edit com replace_all em $name."
  [ "${lines:-0}" -gt 150 ] && reason="Edit troca $lines linhas de $name."
elif [ "$tool" = "Write" ]; then
  old=$(wc -c < "$file" 2>/dev/null || echo 0)
  new=$(printf '%s' "$input" | node "$dir/hook-field.js" tool_input.content | wc -c)
  if [ "$old" -gt 0 ]; then
    diff=$(( (new > old ? new - old : old - new) * 100 / old ))
    [ "$diff" -gt 15 ] && reason="Write muda o tamanho de $name em ${diff}%."
  fi
fi
[ -z "$reason" ] && exit 0
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"OPS-06: %s Confirme se a mudança grande é intencional."}}\n' "$reason"
exit 0
