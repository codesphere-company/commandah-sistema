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
-- Nome vazio ou com menos de 2 letras (sem os espaços das pontas) é ignorado: um nome
-- de 1 letra acertaria pedaços como o \n do JSON (decisão do controlador, Task 3).
-- Do mais longo para o mais curto ("Ana Paula" antes de "Ana").
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
    select btrim(n) from unnest(coalesce(p_nomes, '{}'::text[])) as n
    where length(btrim(n)) >= 2
    order by length(btrim(n)) desc, btrim(n)
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

-- Minúsculas que também valem para letra acentuada. Em locale C, lower(), ilike e a regex
-- com 'i' só dobram A-Z: "JOSÉ" e "José" ficariam diferentes. Usada onde errar para o lado
-- de "diferente" estraga dado de outra pessoa (lista de nomes seguros) ou deixa nome
-- (igualdade do requesterName). Revisão final, CRITICAL 1.
create or replace function public.lgpd_dobrar(p_texto text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select lower(translate(p_texto, 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ', 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþ'));
$function$;

-- Padrões de ilike que acham os nomes (2+ letras) num texto ou no ::text de um jsonb: o
-- nome cru e o escapado para JSON (aspas e barra), com %, _ e \ escapados para o ilike.
-- Serve só de pré-filtro barato: texto sem nenhum padrão não mudaria na troca.
create or replace function public.lgpd_padroes(p_nomes text[])
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select coalesce(array_agg(distinct '%' || replace(replace(replace(f.n, '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}'::text[])
    from (select btrim(n) as n from unnest(coalesce(p_nomes, '{}'::text[])) as n where length(btrim(n)) >= 2
          union all
          select substr(to_json(btrim(n))::text, 2, length(to_json(btrim(n))::text) - 2)
            from unnest(coalesce(p_nomes, '{}'::text[])) as n where length(btrim(n)) >= 2) f;
$function$;

-- Mesma troca dentro de um jsonb: percorre objetos e listas e troca só nos VALORES de
-- texto, já decodificados. As chaves nunca mudam (uma chave com nome de pessoa, como
-- {"Ana":1}, fica; e duas chaves não podem virar uma só); número, booleano e null
-- ficam como estão. Revisão da Task 3: a versão anterior trocava sobre o ::text do jsonb,
-- o que renomeava chaves e não pegava nome logo depois de um escape ("\nAna").
-- Revisão final (IMPORTANT 2, tempo do botão): só desce no pedaço cujo ::text tem algum
-- nome (ilike, em C); o resto volta como está sem chamar função. Um backup de 2 MB com o
-- nome em poucos lugares deixa de chamar a troca para cada um dos milhares de valores.
create or replace function public.lgpd_trocar_jsonb_filtrado(p_valor jsonb, p_nomes text[], p_novo text, p_pads text[])
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
begin
  case jsonb_typeof(p_valor)
    when 'string' then
      return to_jsonb(public.lgpd_trocar_texto(p_valor #>> '{}', p_nomes, p_novo));
    when 'array' then
      return (select coalesce(jsonb_agg(
                       case when jsonb_typeof(e.v) in ('string', 'array', 'object') and e.v::text ilike any(p_pads)
                            then public.lgpd_trocar_jsonb_filtrado(e.v, p_nomes, p_novo, p_pads) else e.v end
                       order by e.o), '[]'::jsonb)
                from jsonb_array_elements(p_valor) with ordinality as e(v, o));
    when 'object' then
      return (select coalesce(jsonb_object_agg(e.key,
                       case when jsonb_typeof(e.value) in ('string', 'array', 'object') and e.value::text ilike any(p_pads)
                            then public.lgpd_trocar_jsonb_filtrado(e.value, p_nomes, p_novo, p_pads) else e.value end), '{}'::jsonb)
                from jsonb_each(p_valor) as e);
    else
      return p_valor;
  end case;
end;
$function$;

create or replace function public.lgpd_trocar_jsonb(p_valor jsonb, p_nomes text[], p_novo text)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_pads text[] := public.lgpd_padroes(p_nomes);
begin
  if p_valor is null then return null; end if;
  if not (p_valor::text ilike any(v_pads)) then return p_valor; end if;
  return public.lgpd_trocar_jsonb_filtrado(p_valor, p_nomes, p_novo, v_pads);
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
revoke all on function public.lgpd_dobrar(text) from public, anon;
revoke all on function public.lgpd_padroes(text[]) from public, anon;
revoke all on function public.lgpd_trocar_jsonb_filtrado(jsonb, text[], text, text[]) from public, anon;
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

-- Dependentes: mesma regra de papel; o garçom sem caixa não recebe o documento. A linha é
-- montada pelo jsonb, como em members_list (revisão final, Minor 7): coluna nova na tabela
-- não quebra a função (e o login, que lê por ela).
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
    -- Garçom sem caixa: só as colunas da lista (coluna nova vem nula até entrar aqui).
    select (jsonb_populate_record(null::public.member_dependents,
             case when v_inteiro then to_jsonb(d)
                  else (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(d)) e
                         where e.key in ('id', 'tenant_id', 'member_id', 'name', 'relationship', 'can_order',
                                         'created_at', 'updated_at'))
             end)).*
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

-- ---------------------------------------------------------------------
-- Parte 3: anonimização no servidor (item 6, auditoria 11/11)
-- ---------------------------------------------------------------------
-- Antes, a anonimização era feita pelo navegador (doAnonymizeMember em
-- assets/js/fiscal/nfce-config.js): só o cadastro, as comandas e os pedidos. Os
-- textos livres (logs, backups, cupons impressos, extrato do fiado) ficavam com o
-- nome. Agora tudo acontece aqui, numa transação, para o botão e para o expurgo.

-- Carimbo do audit_log. Igual ao da 20261008010000_bloqueio_progressivo_pin.sql, com
-- um caso a mais: gravação sem usuário logado (expurgo automático, que roda sem sessão)
-- dentro da anonimização, que marca o tenant em commandah.lgpd_tenant (set_config local
-- à transação). O ator fica como 'sistema' (audit_log.actor_role não tem check).
-- O teste é pelo papel do JWT, e não por current_user: esta função é SECURITY DEFINER,
-- então aqui dentro current_user é sempre o dono da função.
create or replace function public.audit_log_stamp()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Gravacao do servidor (Edge Function com service_role): confia no tenant
  -- informado, que a funcao tirou do proprio banco. Ator fica marcado como sistema.
  if coalesce(auth.role(), '') = 'service_role' then
    new.at             := now();
    new.actor_auth_uid := null;
    new.actor_role     := 'sistema';
    if new.tenant_id is null then
      raise exception 'tenant_id obrigatorio em gravacao do servidor';
    end if;
    return new;
  end if;

  -- Item 6 (auditoria 11/11): anonimização sem sessão. O tenant vem da marca que
  -- member_anonymize_interno liga só durante a própria transação.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon')
     and public.current_tenant_id() is null
     and coalesce(current_setting('commandah.lgpd_tenant', true), '') <> '' then
    new.tenant_id      := current_setting('commandah.lgpd_tenant', true);
    new.at             := now();
    new.actor_auth_uid := null;
    new.actor_role     := 'sistema';
    return new;
  end if;

  new.tenant_id      := public.current_tenant_id();
  new.at             := now();
  new.actor_auth_uid := auth.uid();
  new.actor_role     := public.current_staff_role();
  if new.tenant_id is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;
  return new;
end;
$function$;

-- O blob antigo de vendas continua só leitura (20261010030000_vendas_em_tabela.sql),
-- menos durante a anonimização, que troca o nome também nele (item 6, auditoria 11/11).
create or replace function public.app_data_sales_somente_leitura()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.key = 'cantina2:sales'
     and coalesce(current_setting('commandah.lgpd_anonimizando', true), '') <> 'on' then
    raise exception 'as vendas agora ficam na tabela sales: recarregue a pagina para usar a versao nova'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- Venda do próprio sócio (ligada por memberId): customerName vira o nome novo e, nos
-- itens, requesterName vira o nome novo quando o pedido é do sócio ou de um dependente
-- (pelo id) ou quando o nome é um dos antigos (p_chaves: nomes em minúsculas, sem
-- espaços nas pontas). Igual ao que o front fazia, mais o id do dependente.
create or replace function public.lgpd_venda_por_id(p_data jsonb, p_member_id text, p_dep_ids text[], p_chaves text[], p_novo text)
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  select case when p_data is null then null else
    p_data || jsonb_build_object('customerName', p_novo)
      || case when jsonb_typeof(p_data->'items') = 'array' then jsonb_build_object('items', (
           select coalesce(jsonb_agg(
                    case when jsonb_typeof(i.v) = 'object'
                              and coalesce(i.v->>'requesterName', '') <> ''
                              and (i.v->>'requesterId' = p_member_id
                                   or i.v->>'requesterId' = any(coalesce(p_dep_ids, '{}'::text[]))
                                   or public.lgpd_dobrar(btrim(i.v->>'requesterName')) = any(coalesce(p_chaves, '{}'::text[])))
                         then i.v || jsonb_build_object('requesterName', p_novo)
                         else i.v end
                    order by i.o), '[]'::jsonb)
             from jsonb_array_elements(p_data->'items') with ordinality as i(v, o)))
         else '{}'::jsonb end
  end;
$function$;

-- Texto livre de uma venda: troca os nomes em tudo, menos nas chaves que identificam a
-- venda (id tem check em sales, memberId liga ao sócio, status/type são colunas geradas)
-- e no nfce, que é registro fiscal (nfce_* fica fora da anonimização).
create or replace function public.lgpd_venda_livre(p_data jsonb, p_nomes text[], p_novo text)
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  select case when p_data is null then null else
    public.lgpd_trocar_jsonb(p_data - array['id', 'memberId', 'status', 'type', 'nfce'], p_nomes, p_novo)
      || (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            from jsonb_each(p_data) e
           where e.key in ('id', 'memberId', 'status', 'type', 'nfce'))
  end;
$function$;

-- Anonimiza um sócio. Chamada pelo botão (member_anonymize, 'manual') e pelo expurgo
-- ('automatico'). Sem grant para o navegador: quem chama já conferiu o tenant.
-- Devolve {"ok":true,"nome_novo":...} ou {"erro":...}.
--
-- Revisão final (CRITICAL 1): a troca no texto livre decide POR NOME. Há duas listas:
-- - todos os nomes antigos (sócio e dependentes): usados só onde a comparação é de
--   igualdade e a linha é do sócio pelo id (customerName e requesterName das vendas dele,
--   orders.who dessas vendas);
-- - os "nomes seguros": com 2 palavras ou mais e que não estão contidos, como palavra
--   inteira, em nenhum nome identificado do tenant (outro sócio não anonimizado,
--   dependente de outro sócio, usuário do sistema em cantina2:users, nome de produto em
--   cantina2:products). Só eles entram em qualquer texto livre, inclusive os ligados por
--   id (extrato, audit_log do sócio, pontos, observações das vendas dele). Assim "José
--   Lima" não troca dentro de "José Lima Filho", "Mel" não troca dentro de "Pão de Mel" e
--   "João" não troca dentro de "João Pedro".
--
-- Revisão final (IMPORTANT 2, statement_timeout de 8 s): cada atualização calcula a troca
-- uma vez por linha, num CTE que trava as linhas (for update) e devolve o valor novo; o
-- update só grava a linha que muda. O CTE trava a versão mais recente da linha e calcula
-- a troca sobre ela, então uma gravação concorrente de um aparelho não é sobrescrita.
create or replace function public.member_anonymize_interno(p_tenant text, p_member_id text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  -- As marcas são locais à transação; guarda o valor anterior para devolver ao sair
  -- (quem chama em lote, como o expurgo, não fica com elas ligadas).
  v_ant_anon text := coalesce(current_setting('commandah.lgpd_anonimizando', true), '');
  v_ant_tenant text := coalesce(current_setting('commandah.lgpd_tenant', true), '');
  v_m public.members%rowtype;
  v_res jsonb;
  v_novo text;
  v_nomes text[];
  v_chaves text[];
  v_dep_ids text[];
  v_vendas text[];
  v_outros text[];
  v_seguros text[];
  v_mantidos int;
  v_pads text[];
  v_acao text;
begin
  if p_origem is null or p_origem not in ('manual', 'automatico') then
    raise exception 'origem invalida: %', p_origem;
  end if;

  -- 1. Marcas: o carimbo do audit_log usa o tenant; o blob de vendas deixa gravar.
  perform set_config('commandah.lgpd_anonimizando', 'on', true);
  perform set_config('commandah.lgpd_tenant', coalesce(p_tenant, ''), true);

  -- 2. Recusas, nesta ordem.
  select * into v_m from public.members
   where tenant_id = p_tenant and id = p_member_id
   for update;
  if not found then
    v_res := jsonb_build_object('erro', 'socio nao encontrado');
  elsif v_m.anonymized_at is not null then
    v_res := jsonb_build_object('erro', 'ja anonimizado');
  elsif abs(v_m.debt) > 0.005 then
    v_res := jsonb_build_object('erro', 'saldo diferente de zero');
  elsif exists (select 1 from public.sales s
                 where s.tenant_id = p_tenant and s.data->>'memberId' = p_member_id
                   and s.status = 'open' and s.deleted_at is null
                   and coalesce((s.data->>'canceled')::boolean, false) = false) then
    v_res := jsonb_build_object('erro', 'comanda aberta');
  end if;
  if v_res is not null then
    perform set_config('commandah.lgpd_anonimizando', v_ant_anon, true);
    perform set_config('commandah.lgpd_tenant', v_ant_tenant, true);
    return v_res;
  end if;

  -- 3. Nomes antigos (sócio e dependentes, sem vazios) e a lista dos seguros.
  v_novo := 'Sócio anonimizado ' || upper(right(p_member_id, 4));
  select coalesce(array_agg(d.id), '{}'::text[]) into v_dep_ids
    from public.member_dependents d
   where d.tenant_id = p_tenant and d.member_id = p_member_id;
  select coalesce(array_agg(distinct x.n), '{}'::text[]) into v_nomes
    from (select btrim(v_m.name) as n
          union all
          select btrim(d.name) from public.member_dependents d
           where d.tenant_id = p_tenant and d.member_id = p_member_id) x
   where coalesce(x.n, '') <> '';
  select coalesce(array_agg(distinct public.lgpd_dobrar(n)), '{}'::text[]) into v_chaves from unnest(v_nomes) as n;

  -- Nomes identificados do tenant que não são deste sócio.
  select coalesce(array_agg(distinct o.nome), '{}'::text[]) into v_outros
    from (
      select m.name as nome from public.members m
       where m.tenant_id = p_tenant and m.id <> p_member_id and m.anonymized_at is null
      union all
      select d.name from public.member_dependents d
       where d.tenant_id = p_tenant and d.member_id <> p_member_id
      union all
      select u.v->>'name' from public.app_data a
        cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) as u(v)
       where a.tenant_id = p_tenant and a.key in ('cantina2:users', 'cantina2:products') and jsonb_typeof(u.v) = 'object'
    ) o
   where coalesce(btrim(o.nome), '') <> '';

  -- Seguro: 2 palavras ou mais (separadas por espaço) e não contido em nenhum outro nome.
  -- O teste de "contido" é a própria troca: lgpd_trocar_texto(outro, [nome], '#') muda o outro.
  -- Os dois lados vão por lgpd_dobrar: "JOSÉ LIMA NETO" contém "José Lima" (em locale C a
  -- troca não iguala É e é, e o nome seria tido como seguro).
  select coalesce(array_agg(n order by n), '{}'::text[]) into v_seguros
    from unnest(v_nomes) as n
   where length(n) >= 2
     and coalesce(array_length(regexp_split_to_array(n, '\s+'), 1), 0) >= 2
     and not exists (
       select 1 from (select public.lgpd_dobrar(x) as o from unnest(v_outros) as x) oo
        where oo.o ilike any(public.lgpd_padroes(array[public.lgpd_dobrar(n)]))
          and public.lgpd_trocar_texto(oo.o, array[public.lgpd_dobrar(n)], '#') is distinct from oo.o);
  v_mantidos := cardinality(v_nomes) - cardinality(v_seguros);
  v_pads := public.lgpd_padroes(v_seguros);

  -- 4. Por id. Não toca em kind, debt nem points.
  update public.members set
    name = v_novo, code = null, phone = null, email = null, gender = null, document = null,
    registry = null, birth_date = null, zip = null, address = null, address_number = null,
    address_complement = null, district = null, city = null, uf = null, reference = null,
    ibge = null, tags = '{}'::text[], notes = null, marketing_opt_in = false,
    latitude = null, longitude = null, geo_status = null,
    points_history = public.lgpd_trocar_jsonb(points_history, v_seguros, v_novo),
    archived = true, archived_at = coalesce(archived_at, now()), anonymized_at = now(), updated_at = now()
   where tenant_id = p_tenant and id = p_member_id;

  delete from public.member_dependents where tenant_id = p_tenant and member_id = p_member_id;

  -- Vendas do sócio: versão sobe para os aparelhos pegarem a mudança. Igualdade com todos
  -- os nomes; texto livre (observações etc.) só com os seguros, no mesmo update.
  with u as (
    update public.sales s set
      data = public.lgpd_venda_livre(public.lgpd_venda_por_id(s.data, p_member_id, v_dep_ids, v_chaves, v_novo), v_seguros, v_novo),
      updated_at = now(), version = s.version + 1
     where s.tenant_id = p_tenant and s.data->>'memberId' = p_member_id
    returning s.id)
  select coalesce(array_agg(u.id), '{}'::text[]) into v_vendas from u;

  update public.orders set who = v_novo
   where tenant_id = p_tenant and sale_id = any(v_vendas) and who is distinct from v_novo;

  -- 5. Texto livre do tenant inteiro (inclui o extrato e o audit_log do próprio sócio), só
  -- com os nomes seguros. Fica de fora tudo o que começa com nfce_ (registro fiscal).
  if cardinality(v_seguros) > 0 then
    with x as materialized (
      select t.id, public.lgpd_trocar_texto(t.action, v_seguros, v_novo) as action,
             public.lgpd_trocar_jsonb(t.meta, v_seguros, v_novo) as meta
        from public.audit_log t
       where t.tenant_id = p_tenant and (t.action ilike any(v_pads) or t.meta::text ilike any(v_pads))
         for update)
    update public.audit_log t set action = x.action, meta = x.meta
      from x
     where t.id = x.id and (x.action is distinct from t.action or x.meta is distinct from t.meta);

    with x as materialized (
      select t.id, public.lgpd_trocar_texto(t.reason, v_seguros, v_novo) as reason,
             public.lgpd_trocar_texto(t.info, v_seguros, v_novo) as info
        from public.member_debt_entries t
       where t.tenant_id = p_tenant and (t.reason ilike any(v_pads) or t.info ilike any(v_pads))
         for update)
    update public.member_debt_entries t set reason = x.reason, info = x.info
      from x
     where t.id = x.id and (x.reason is distinct from t.reason or x.info is distinct from t.info);

    with x as materialized (
      select t.id, public.lgpd_trocar_texto(t.content, v_seguros, v_novo) as content
        from public.print_jobs t
       where t.tenant_id = p_tenant and t.content ilike any(v_pads)
         for update)
    update public.print_jobs t set content = x.content
      from x
     where t.id = x.id and x.content is distinct from t.content;

    with x as materialized (
      select t.tenant_id, t.sale_id, public.lgpd_trocar_jsonb(t.result, v_seguros, v_novo) as result
        from public.sale_close_receipts t
       where t.tenant_id = p_tenant and t.result::text ilike any(v_pads)
         for update)
    update public.sale_close_receipts t set result = x.result
      from x
     where t.tenant_id = x.tenant_id and t.sale_id = x.sale_id and x.result is distinct from t.result;

    with x as materialized (
      select t.tenant_id, t.caixa_id, public.lgpd_trocar_jsonb(t.turno, v_seguros, v_novo) as turno
        from public.cash_turnos t
       where t.tenant_id = p_tenant and t.turno::text ilike any(v_pads)
         for update)
    update public.cash_turnos t set turno = x.turno
      from x
     where t.tenant_id = x.tenant_id and t.caixa_id = x.caixa_id and x.turno is distinct from t.turno;

    with x as materialized (
      select t.id, public.lgpd_trocar_texto(t.message, v_seguros, v_novo) as message
        from public.client_errors t
       where t.tenant_id = p_tenant and t.message ilike any(v_pads)
         for update)
    update public.client_errors t set message = x.message
      from x
     where t.id = x.id and x.message is distinct from t.message;

    -- Blobs com nome de pessoa: os da lista do item 6 e, achados na varredura das colunas
    -- text/jsonb, o caixa (lançamentos "Recebimento de fiado — <nome>"), contas e o blob
    -- antigo de pedidos. O gatilho app_data_bump_version sobe a versão.
    with x as materialized (
      select t.id, public.lgpd_trocar_jsonb(t.value, v_seguros, v_novo) as value
        from public.app_data t
       where t.tenant_id = p_tenant
         and (t.key like 'backup:%'
              or t.key in ('cantina2:logs', 'cantina2:requests', 'cantina2:scheduled', 'cantina2:cashHistory',
                           'cantina2:sales', 'cantina2:cashMovements', 'cantina2:cashSession', 'cantina2:contas',
                           'cantina2:orders'))
         and t.value::text ilike any(v_pads)
         for update)
    update public.app_data t set value = x.value
      from x
     where t.id = x.id and x.value is distinct from t.value;

    -- Achados na varredura (item 6): vendas de outros sócios e avulsas (observações,
    -- pagamentos parciais), menos as comandas abertas, para não dar conflito de versão
    -- com um aparelho que está lançando nelas.
    with x as materialized (
      select t.tenant_id, t.id, public.lgpd_venda_livre(t.data, v_seguros, v_novo) as data
        from public.sales t
       where t.tenant_id = p_tenant
         and t.data->>'memberId' is distinct from p_member_id
         and not (t.status = 'open' and t.deleted_at is null)
         and t.data::text ilike any(v_pads)
         for update)
    update public.sales t set data = x.data, updated_at = now(), version = t.version + 1
      from x
     where t.tenant_id = x.tenant_id and t.id = x.id and x.data is distinct from t.data;

    with x as materialized (
      select t.id, public.lgpd_trocar_texto(t.who, v_seguros, v_novo) as who,
             public.lgpd_trocar_texto(t.local, v_seguros, v_novo) as local,
             public.lgpd_trocar_texto(t.kitchen_note, v_seguros, v_novo) as kitchen_note,
             public.lgpd_trocar_jsonb(t.items, v_seguros, v_novo) as items
        from public.orders t
       where t.tenant_id = p_tenant
         and (t.who ilike any(v_pads) or t.local ilike any(v_pads) or t.kitchen_note ilike any(v_pads) or t.items::text ilike any(v_pads))
         for update)
    update public.orders t set who = x.who, local = x.local, kitchen_note = x.kitchen_note, items = x.items
      from x
     where t.id = x.id
       and (x.who is distinct from t.who or x.local is distinct from t.local
            or x.kitchen_note is distinct from t.kitchen_note or x.items is distinct from t.items);

    with x as materialized (
      select t.id, public.lgpd_trocar_texto(t.notes, v_seguros, v_novo) as notes,
             public.lgpd_trocar_jsonb(t.points_history, v_seguros, v_novo) as points_history
        from public.members t
       where t.tenant_id = p_tenant and t.id <> p_member_id
         and (t.notes ilike any(v_pads) or t.points_history::text ilike any(v_pads))
         for update)
    update public.members t set notes = x.notes, points_history = x.points_history, updated_at = now()
      from x
     where t.id = x.id and (x.notes is distinct from t.notes or x.points_history is distinct from t.points_history);

    with x as materialized (
      select t.tenant_id, t.payment_key, public.lgpd_trocar_texto(t.note, v_seguros, v_novo) as note
        from public.payment_checks t
       where t.tenant_id = p_tenant and t.note ilike any(v_pads)
         for update)
    update public.payment_checks t set note = x.note
      from x
     where t.tenant_id = x.tenant_id and t.payment_key = x.payment_key and x.note is distinct from t.note;
  end if;

  -- 6. Registro da anonimização. Os nomes que ficaram fora da lista segura só são contados
  -- (o registro não escreve nome nenhum).
  v_acao := 'LGPD: cadastro anonimizado (' || v_novo || ') — ' || p_origem;
  if v_mantidos > 0 then
    v_acao := v_acao || ' — nomes mantidos no texto livre: ' || v_mantidos;
  end if;
  insert into public.audit_log(tenant_id, action, entity, entity_id, meta)
  values (p_tenant, v_acao, 'member', p_member_id,
          jsonb_build_object('origem', p_origem, 'nomes_mantidos', v_mantidos));

  perform set_config('commandah.lgpd_anonimizando', v_ant_anon, true);
  perform set_config('commandah.lgpd_tenant', v_ant_tenant, true);
  return jsonb_build_object('ok', true, 'nome_novo', v_novo);
end;
$function$;

-- Botão "Anonimizar" do cadastro: só dono ou admin, e só sócio do próprio estabelecimento.
create or replace function public.member_anonymize(p_member_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_papel text := public.current_staff_role();
begin
  if v_tenant is null or v_papel is null or v_papel not in ('owner', 'admin') then
    return jsonb_build_object('erro', 'sem permissao para anonimizar');
  end if;
  if not exists (select 1 from public.members where tenant_id = v_tenant and id = p_member_id) then
    return jsonb_build_object('erro', 'socio nao encontrado');
  end if;
  return public.member_anonymize_interno(v_tenant, p_member_id, 'manual');
end;
$function$;

revoke all on function public.lgpd_venda_por_id(jsonb, text, text[], text[], text) from public, anon, authenticated;
revoke all on function public.lgpd_venda_livre(jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.member_anonymize_interno(text, text, text) from public, anon, authenticated;
revoke all on function public.member_anonymize(text) from public, anon;
grant execute on function public.member_anonymize(text) to authenticated;

-- Parte 4: expurgo diário (item 6, auditoria 11/11). Só os estabelecimentos que ligaram
-- cantina2:settings.privacy.automatico. Cada sócio roda no próprio bloco: erro inesperado
-- desfaz só ele e vira recusa. Recusa vira linha no audit_log uma vez por dia (fuso de São Paulo).
-- Revisão final (IMPORTANT 3): o prazo é limitado em numeric antes de virar int (um admin
-- que grava anos = 1e12 estourava o int e derrubava o expurgo de todos); cada
-- estabelecimento roda no próprio bloco (erro nele desfaz só o dele, vai para o log do
-- Postgres e para o audit_log dele, e o expurgo segue para o próximo); a gravação da recusa
-- também tem bloco próprio. O resultado ganha "estabelecimentos_com_erro" só quando há erro.
create or replace function public.lgpd_expurgo_diario(p_agora timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_t record;
  v_m record;
  v_anos int;
  v_desde timestamptz;
  v_res jsonb;
  v_msg text;
  v_ok int := 0;
  v_rec int := 0;
  v_ok_t int;
  v_rec_t int;
  v_err int := 0;
  v_out jsonb;
begin
  for v_t in
    select a.tenant_id, a.value->'privacy' as priv
      from public.app_data a
     where a.key = 'cantina2:settings'
       and jsonb_typeof(a.value->'privacy') = 'object'
       and a.value->'privacy'->>'automatico' = 'true'
     order by a.tenant_id
  loop
    v_ok_t := 0;
    v_rec_t := 0;
    begin
      v_anos := 2;
      if jsonb_typeof(v_t.priv->'anos') = 'number' then
        v_anos := greatest(1::numeric, least(20::numeric, floor((v_t.priv->>'anos')::numeric)))::int;
      end if;
      begin
        v_desde := nullif(v_t.priv->>'automaticoDesde', '')::timestamptz;
      exception when others then
        v_desde := null;
      end;

      for v_m in
        select m.id from public.members m
         where m.tenant_id = v_t.tenant_id
           and m.kind = 'socio' and m.archived
           and m.anonymized_at is null and m.archived_at is not null
           and p_agora >= public.lgpd_data_efetiva(m.archived_at, v_anos, v_desde)
         order by m.id
      loop
        v_msg := null;
        begin
          v_res := public.member_anonymize_interno(v_t.tenant_id, v_m.id, 'automatico');
          if v_res ? 'erro' then
            v_msg := v_res->>'erro';
          else
            v_ok_t := v_ok_t + 1;
          end if;
        exception when others then
          v_msg := sqlerrm;
        end;

        if v_msg is not null then
          v_rec_t := v_rec_t + 1;
          begin
            perform set_config('commandah.lgpd_tenant', v_t.tenant_id, true);
            insert into public.audit_log(tenant_id, action, entity, entity_id, meta)
            select v_t.tenant_id, 'LGPD: não anonimizado — ' || v_msg, 'member', v_m.id,
                   jsonb_build_object('origem', 'automatico')
             where not exists (
               select 1 from public.audit_log l
                where l.tenant_id = v_t.tenant_id and l.entity = 'member' and l.entity_id = v_m.id
                  and l.action = 'LGPD: não anonimizado — ' || v_msg
                  and (l.at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date);
          exception when others then
            raise warning 'lgpd_expurgo_diario: recusa de % (%) nao gravada: %', v_m.id, v_t.tenant_id, sqlerrm;
          end;
          perform set_config('commandah.lgpd_tenant', '', true);
        end if;
      end loop;
      v_ok := v_ok + v_ok_t;
      v_rec := v_rec + v_rec_t;
    exception when others then
      v_err := v_err + 1;
      v_msg := sqlerrm;
      raise warning 'lgpd_expurgo_diario: estabelecimento % com erro: %', v_t.tenant_id, v_msg;
      begin
        perform set_config('commandah.lgpd_tenant', v_t.tenant_id, true);
        insert into public.audit_log(tenant_id, action, entity, entity_id, meta)
        values (v_t.tenant_id, 'LGPD: anonimização automática com erro — ' || v_msg, null, null,
                jsonb_build_object('origem', 'automatico'));
      exception when others then
        null; -- já foi para o log do Postgres acima
      end;
    end;
    perform set_config('commandah.lgpd_tenant', '', true);
  end loop;
  v_out := jsonb_build_object('anonimizados', v_ok, 'recusados', v_rec);
  if v_err > 0 then
    v_out := v_out || jsonb_build_object('estabelecimentos_com_erro', v_err);
  end if;
  return v_out;
end;
$function$;

revoke all on function public.lgpd_expurgo_diario(timestamptz) from public, anon, authenticated;

-- Agendamento diário às 07:00 UTC. O job não faz nada enquanto nenhum estabelecimento ligar
-- privacy.automatico. Banco local não tem pg_cron: só avisa.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    execute $q$select cron.schedule('lgpd-expurgo-diario', '0 7 * * *', 'select public.lgpd_expurgo_diario()')$q$;
  else
    raise notice 'pg_cron indisponivel: expurgo diario nao agendado (banco local)';
  end if;
end
$$;

-- ROLLBACK da parte 1 (manual):
--   drop function if exists public.lgpd_data_efetiva(timestamptz, int, timestamptz),
--     public.lgpd_trocar_jsonb(jsonb, text[], text),
--     public.lgpd_trocar_jsonb_filtrado(jsonb, text[], text, text[]),
--     public.lgpd_padroes(text[]),
--     public.lgpd_trocar_texto(text, text[], text);
-- parte 2:
--   drop function if exists public.member_dependents_list(text),
--     public.members_list(text, boolean),
--     public.lgpd_le_cadastro_inteiro();
-- parte 3:
--   drop function if exists public.member_anonymize(text),
--     public.member_anonymize_interno(text, text, text),
--     public.lgpd_venda_livre(jsonb, text[], text),
--     public.lgpd_venda_por_id(jsonb, text, text[], text[], text);
--   Depois, recolocar os corpos anteriores (create or replace, sem mexer nos gatilhos):
--   - public.audit_log_stamp(): o da 20261008010000_bloqueio_progressivo_pin.sql (seção 2,
--     com o caso service_role), não o da 20260901000000_rls_por_papel.sql.
--   - public.app_data_sales_somente_leitura(): o da 20261010030000_vendas_em_tabela.sql
--     (seção "O blob antigo vira só leitura").
-- parte 4:
--   do $$ begin if exists (select 1 from pg_extension where extname = 'pg_cron') then
--     perform cron.unschedule('lgpd-expurgo-diario'); end if; end $$;
--   drop function if exists public.lgpd_expurgo_diario(timestamptz);
--   O que já foi anonimizado não volta (troca irreversível, de propósito).
