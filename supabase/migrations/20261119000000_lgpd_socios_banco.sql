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

-- ---------------------------------------------------------------------
-- Parte 2: leitura do cadastro por papel (item 6, auditoria 11/11)
-- ---------------------------------------------------------------------
-- Quem lê o cadastro inteiro: dono, admin e caixa. O garçom só lê quando também
-- opera o caixa (cash_can_write) e o caixa por operador está ligado: aí ele cobra
-- e cadastra no caixa. Os demais papéis (cozinha, sem papel) são recusados.
create or replace function public.lgpd_le_cadastro_inteiro()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case public.current_staff_role()
    when 'owner' then true
    when 'admin' then true
    when 'caixa' then true
    when 'garcom' then public.cash_can_write() and public.caixa_por_operador_ligado()
    else false
  end;
$function$;
revoke all on function public.lgpd_le_cadastro_inteiro() from public, anon, authenticated;

-- Sócios do estabelecimento. Garçom sem caixa recebe só os campos que usa na venda:
-- o resto vem nulo/vazio (a linha é montada a partir do jsonb para manter o tipo e a
-- ordem das colunas da tabela, mesmo que ganhe coluna nova).
create or replace function public.members_list(p_id text default null, p_so_com_saldo boolean default false)
returns setof public.members
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_papel text := public.current_staff_role();
  v_inteiro boolean;
begin
  if v_tenant is null or v_papel is null or v_papel not in ('owner', 'admin', 'caixa', 'garcom') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  v_inteiro := public.lgpd_le_cadastro_inteiro();
  if v_inteiro then
    return query
      select m.* from public.members m
       where m.tenant_id = v_tenant
         and (p_id is null or m.id = p_id)
         and (not p_so_com_saldo or m.debt <> 0 or m.debt_release is not null)
       order by m.id;
  else
    return query
      select (jsonb_populate_record(null::public.members,
               (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(m)) e
                 where e.key in ('id', 'tenant_id', 'name', 'code', 'kind', 'debt', 'credit_limit', 'active',
                                 'archived', 'debt_release', 'anonymized_at', 'created_at', 'updated_at'))
               || jsonb_build_object('tags', '[]'::jsonb, 'points_history', '[]'::jsonb, 'points', 0, 'marketing_opt_in', false))).*
        from public.members m
       where m.tenant_id = v_tenant
         and (p_id is null or m.id = p_id)
         and (not p_so_com_saldo or m.debt <> 0 or m.debt_release is not null)
       order by m.id;
  end if;
end;
$function$;

-- Dependentes: mesma regra de papel; o garçom sem caixa não recebe o documento.
create or replace function public.member_dependents_list(p_member_id text default null)
returns setof public.member_dependents
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_papel text := public.current_staff_role();
  v_inteiro boolean;
begin
  if v_tenant is null or v_papel is null or v_papel not in ('owner', 'admin', 'caixa', 'garcom') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  v_inteiro := public.lgpd_le_cadastro_inteiro();
  return query
    select d.id, d.tenant_id, d.member_id, d.name, d.relationship,
           case when v_inteiro then d.document else null end,
           d.can_order, d.created_at, d.updated_at
      from public.member_dependents d
     where d.tenant_id = v_tenant
       and (p_member_id is null or d.member_id = p_member_id)
     order by d.id;
end;
$function$;

revoke all on function public.members_list(text, boolean) from public, anon;
revoke all on function public.member_dependents_list(text) from public, anon;
grant execute on function public.members_list(text, boolean) to authenticated;
grant execute on function public.member_dependents_list(text) to authenticated;

-- ROLLBACK da parte 1 (manual):
--   drop function if exists public.lgpd_data_efetiva(timestamptz, int, timestamptz),
--     public.lgpd_trocar_jsonb(jsonb, text[], text),
--     public.lgpd_trocar_texto(text, text[], text);
-- ROLLBACK da parte 2 (manual):
--   drop function if exists public.member_dependents_list(text),
--     public.members_list(text, boolean),
--     public.lgpd_le_cadastro_inteiro();
