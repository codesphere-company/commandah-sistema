set lock_timeout = '5s';
-- =====================================================================
-- 20261119000000_lgpd_socios_banco.sql — item 6 (auditoria 11/11)
-- =====================================================================
-- Parte 1: funções puras de texto e de data usadas pela anonimização de
-- sócios no banco (as próximas partes desta migration usam estas funções).
-- =====================================================================

-- Troca cada nome de p_nomes por p_novo, por palavra inteira, sem diferenciar
-- maiúsculas. O banco pode estar em locale C, onde \m, \M e [:alnum:] não
-- reconhecem letra acentuada: por isso a borda usa lookaround com classe explícita.
-- O nome é escapado para regex (a lista põe ] e [ antes de ^ e . para não abrir "[.").
-- Nome vazio é ignorado. Do mais longo para o mais curto ("Ana Paula" antes de "Ana").
create or replace function public.lgpd_trocar_texto(p_texto text, p_nomes text[], p_novo text)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_texto text := p_texto;
  v_nome text;
  v_novo text := replace(coalesce(p_novo, ''), '\', '\\');
begin
  if v_texto is null then return null; end if;
  for v_nome in
    select n from unnest(coalesce(p_nomes, '{}'::text[])) as n
    where n is not null and btrim(n) <> ''
    order by length(n) desc, n
  loop
    v_texto := regexp_replace(
      v_texto,
      '(?<![0-9A-Za-zÀ-ÖØ-öø-ÿ_])'
        || regexp_replace(v_nome, '([][^.$*+?(){}|\\])', '\\\1', 'g')
        || '(?![0-9A-Za-zÀ-ÖØ-öø-ÿ_])',
      v_novo, 'gi');
  end loop;
  return v_texto;
end;
$function$;

-- Mesma troca sobre o texto do jsonb. Os nomes (e o texto novo) entram na forma
-- escapada para JSON (aspas e barra), para o resultado continuar sendo JSON válido.
create or replace function public.lgpd_trocar_jsonb(p_valor jsonb, p_nomes text[], p_novo text)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_nomes text[];
  v_novo text;
begin
  if p_valor is null then return null; end if;
  select coalesce(array_agg(substr(to_json(n)::text, 2, length(to_json(n)::text) - 2)), '{}'::text[])
    into v_nomes
    from unnest(coalesce(p_nomes, '{}'::text[])) as n
    where n is not null and btrim(n) <> '';
  v_novo := substr(to_json(coalesce(p_novo, ''))::text, 2, length(to_json(coalesce(p_novo, ''))::text) - 2);
  return public.lgpd_trocar_texto(p_valor::text, v_nomes, v_novo)::jsonb;
end;
$function$;

-- Data a partir da qual o sócio arquivado pode ser anonimizado pelo automático:
-- maior(archived_at + anos, desde) + 7 dias. Sem archived_at, nulo.
create or replace function public.lgpd_data_efetiva(p_archived_at timestamptz, p_anos int, p_desde timestamptz)
returns timestamptz
language sql
immutable
set search_path to ''
as $function$
  select case when p_archived_at is null then null
    else greatest(p_archived_at + interval '1 year' * p_anos, coalesce(p_desde, '-infinity'::timestamptz)) + interval '7 days'
  end;
$function$;

revoke all on function public.lgpd_trocar_texto(text, text[], text) from public, anon;
revoke all on function public.lgpd_trocar_jsonb(jsonb, text[], text) from public, anon;
revoke all on function public.lgpd_data_efetiva(timestamptz, int, timestamptz) from public, anon;

-- ROLLBACK da parte 1 (manual):
--   drop function if exists public.lgpd_data_efetiva(timestamptz, int, timestamptz),
--     public.lgpd_trocar_jsonb(jsonb, text[], text),
--     public.lgpd_trocar_texto(text, text[], text);
