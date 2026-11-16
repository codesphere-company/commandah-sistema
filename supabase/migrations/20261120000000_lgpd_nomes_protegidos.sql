set lock_timeout = '5s';
-- =====================================================================
-- 20261120000000_lgpd_nomes_protegidos.sql — item 6 (auditoria 11/11),
-- pendência da revisão final de 15/11 (fix/lgpd-nomes-protegidos)
-- =====================================================================
-- A anonimização (migration 20261119000000_lgpd_socios_banco.sql, já aplicada) só troca
-- no texto livre os "nomes seguros": 2 palavras ou mais e não contidos em nenhum nome
-- identificado de OUTRA pessoa ou produto do estabelecimento. A lista desses outros nomes
-- (v_outros) não tinha vários terceiros, e o texto deles era reescrito. Reprodução no banco
-- local, anonimizando "José Lima":
--   1. entregador (cantina2:quemLevou[].nome; aparece em items[].deliveredBy):
--      "José Lima Filho" virava "Sócio anonimizado ZQM1 Filho";
--   2. fornecedor (cantina2:fornecedores[].nome/razaoSocial): conta "Frete José Lima Filho";
--   3. cliente avulso (customerName de outra venda, orders.who de outro pedido);
--   4. item histórico (produto já tirado do cardápio): dependente "Leite Ninho" trocava
--      dentro de "Bolo de Leite Ninho";
--   5. espaços repetidos: outro sócio "José  Lima Filho" não era visto contendo "José Lima".
--
-- Esta migration refaz só member_anonymize_interno (mesma assinatura, SECURITY DEFINER,
-- search_path vazio) com a lista ampliada e os espaços colapsados, cria lgpd_colapsar e
-- refaz lgpd_venda_por_id só para colapsar os espaços na igualdade do requesterName.
-- create or replace function mantém dono e grants da função; o revoke abaixo repete o da
-- migration anterior só para deixar explícito (idempotente).
-- =====================================================================

-- Espaços internos (inclusive tab, quebra de linha e espaço duro U+00A0) viram um espaço só;
-- sem espaços nas pontas. Usada dos dois lados da checagem de nome seguro.
create or replace function public.lgpd_colapsar(p_texto text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select btrim(regexp_replace(p_texto, '[\s ]+', ' ', 'g'));
$function$;

revoke all on function public.lgpd_colapsar(text) from public, anon;

-- Venda do próprio sócio (ligada por memberId): igual à da migration 20261119000000, mas a
-- igualdade do requesterName colapsa os espaços ("José  Lima" é o sócio "José Lima").
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
                                   or public.lgpd_dobrar(public.lgpd_colapsar(i.v->>'requesterName')) = any(coalesce(p_chaves, '{}'::text[])))
                         then i.v || jsonb_build_object('requesterName', p_novo)
                         else i.v end
                    order by i.o), '[]'::jsonb)
             from jsonb_array_elements(p_data->'items') with ordinality as i(v, o)))
         else '{}'::jsonb end
  end;
$function$;

revoke all on function public.lgpd_venda_por_id(jsonb, text, text[], text[], text) from public, anon, authenticated;

-- Anonimiza um sócio. Chamada pelo botão (member_anonymize, 'manual') e pelo expurgo
-- ('automatico'). Sem grant para o navegador: quem chama já conferiu o tenant.
-- Devolve {"ok":true,"nome_novo":...} ou {"erro":...}.
--
-- Revisão final (CRITICAL 1): a troca no texto livre decide POR NOME. Há duas listas:
-- - todos os nomes antigos (sócio e dependentes): usados só onde a comparação é de
--   igualdade e a linha é do sócio pelo id (customerName e requesterName das vendas dele,
--   orders.who dessas vendas);
-- - os "nomes seguros": com 2 palavras ou mais e que não estão contidos, como palavra
--   inteira, em nenhum nome identificado do tenant que não é deste sócio (ver v_outros).
--   Só eles entram em qualquer texto livre, inclusive os ligados por id (extrato,
--   audit_log do sócio, pontos, observações das vendas dele). Assim "José Lima" não troca
--   dentro de "José Lima Filho", "Mel" não troca dentro de "Pão de Mel" e "João" não troca
--   dentro de "João Pedro".
-- 20261120 (revisão final 15/11): v_outros tem dois tipos de fonte.
-- - Cadastros de pessoas identificadas: outros sócios não anonimizados, dependentes de
--   outros sócios, colaboradores (cantina2:users), produtos do cardápio atual
--   (cantina2:products), entregadores (cantina2:quemLevou),
--   fornecedores (nome, razaoSocial, contato), nome do clube (cantina2:settings.clubName) e
--   do estabelecimento (tenant_owners.business_name). Bloqueiam também por igualdade
--   exata: um homônimo cadastrado é outra pessoa.
-- - Textos de venda e pedido (customerName, orders.who, requesterName, deliveredBy e
--   items[].name, na tabela e nos blobs cantina2:sales, cantina2:orders, cantina2:scheduled
--   e cantina2:requests, inclusive o nome de produto histórico dos itens): só entram se forem diferentes de todos os
--   nomes antigos (comparados com lgpd_dobrar e lgpd_colapsar). "José Lima Filho" protege;
--   "José Lima" exato não bloqueia: num pedido costuma ser o próprio sócio (pedido de
--   agendamento, pedido sem venda, venda antiga sem memberId), e bloquear deixaria o nome
--   no texto livre para sempre.
-- A checagem compara com os espaços colapsados, e um nome antigo seguro entra no texto
-- livre nas duas formas (como foi gravado e colapsado).
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
  v_brutos text[];
  v_nomes text[];
  v_chaves text[];
  v_nomes_cmp text[];
  v_dep_ids text[];
  v_vendas_socio text[];
  v_vendas text[];
  v_outros text[];
  v_seguros_base text[];
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
  -- v_brutos: como foram gravados (sem espaços nas pontas); v_nomes: espaços colapsados.
  v_novo := 'Sócio anonimizado ' || upper(right(p_member_id, 4));
  select coalesce(array_agg(d.id), '{}'::text[]) into v_dep_ids
    from public.member_dependents d
   where d.tenant_id = p_tenant and d.member_id = p_member_id;
  select coalesce(array_agg(distinct x.n), '{}'::text[]) into v_brutos
    from (select btrim(v_m.name) as n
          union all
          select btrim(d.name) from public.member_dependents d
           where d.tenant_id = p_tenant and d.member_id = p_member_id) x
   where coalesce(x.n, '') <> '';
  select coalesce(array_agg(distinct public.lgpd_colapsar(n)), '{}'::text[]) into v_nomes
    from unnest(v_brutos) as n
   where coalesce(public.lgpd_colapsar(n), '') <> '';
  -- Chaves da igualdade (requesterName das vendas do sócio): as duas formas.
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_chaves
    from (select public.lgpd_dobrar(n) as k from unnest(v_brutos) as n
          union all
          select public.lgpd_dobrar(n) from unnest(v_nomes) as n) kk;
  select coalesce(array_agg(s.id), '{}'::text[]) into v_vendas_socio
    from public.sales s
   where s.tenant_id = p_tenant and s.data->>'memberId' = p_member_id;

  -- Nomes antigos para comparar com os de terceiros: minúsculas e espaços colapsados.
  select coalesce(array_agg(distinct public.lgpd_dobrar(n)), '{}'::text[]) into v_nomes_cmp
    from unnest(v_nomes) as n;

  -- Nomes identificados do tenant que não são deste sócio, já colapsados e em minúsculas
  -- (lgpd_dobrar), sem vazios e sem repetição. Sempre só do mesmo tenant. Dois tipos de
  -- fonte (ver o comentário no topo da função):
  -- - cadastros: bloqueiam também quando o nome é igual ao do sócio (homônimo real);
  -- - textos de venda/pedido (inclusive items[].name histórico): só entram se forem diferentes de todos os
  --   nomes antigos (o nome exato do sócio num pedido é ele mesmo, não um terceiro).
  with vendas as (
    -- Vendas da tabela e, no mesmo formato (customerName, memberId, items), os blobs de
    -- vendas antigas (só leitura), agendamentos e pedidos do cardápio. É do sócio o que está
    -- ligado a ele pelo memberId ou, nos blobs (que podem não ter memberId), o que tem o
    -- mesmo id de uma venda dele na tabela.
    select s.data as d, (s.data->>'memberId' is not distinct from p_member_id) as do_socio
      from public.sales s where s.tenant_id = p_tenant
    union all
    select e.v, (e.v->>'memberId' is not distinct from p_member_id or coalesce(e.v->>'id', '') = any(v_vendas_socio))
      from public.app_data a
      cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) as e(v)
     where a.tenant_id = p_tenant and a.key in ('cantina2:sales', 'cantina2:scheduled', 'cantina2:requests')
       and jsonb_typeof(e.v) = 'object'
  ), itens_venda as (
    select v.d, v.do_socio, i.v from vendas v
      cross join lateral jsonb_array_elements(case when jsonb_typeof(v.d->'items') = 'array' then v.d->'items' else '[]'::jsonb end) as i(v)
     where jsonb_typeof(i.v) = 'object'
  ), pedidos as (
    -- Pedidos da tabela e do blob antigo (lá a venda é saleId). O pedido de um agendamento
    -- tem sale_id = id do agendamento e who = nome do sócio (sendScheduledToKitchen).
    select o.who, o.sale_id, o.items from public.orders o where o.tenant_id = p_tenant
    union all
    select e.v->>'who', e.v->>'saleId', e.v->'items' from public.app_data a
      cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) as e(v)
     where a.tenant_id = p_tenant and a.key = 'cantina2:orders' and jsonb_typeof(e.v) = 'object'
  ), cadastros as (
    -- Outros sócios não anonimizados e dependentes de outros sócios.
    select m.name as nome from public.members m
     where m.tenant_id = p_tenant and m.id <> p_member_id and m.anonymized_at is null
    union all
    select d.name from public.member_dependents d
     where d.tenant_id = p_tenant and d.member_id <> p_member_id
    union all
    -- Cadastros em blob: colaboradores e produtos do cardápio atual (name), entregadores
    -- (nome), fornecedores (nome, razaoSocial e contato, a pessoa de contato do cadastro
    -- genérico).
    select f.nome from public.app_data a
      cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) as u(v)
      cross join lateral (values (u.v->>'name'), (u.v->>'nome'), (u.v->>'razaoSocial'), (u.v->>'contato')) as f(nome)
     where a.tenant_id = p_tenant
       and a.key in ('cantina2:users', 'cantina2:products', 'cantina2:quemLevou', 'cantina2:fornecedores')
       and jsonb_typeof(u.v) = 'object'
    union all
    -- Nome do clube (configurações) e do estabelecimento (cadastro do dono).
    select a.value->>'clubName' from public.app_data a
     where a.tenant_id = p_tenant and a.key = 'cantina2:settings' and jsonb_typeof(a.value) = 'object'
    union all
    select t.business_name from public.tenant_owners t where t.tenant_id = p_tenant
  ), textos as (
    -- Cliente avulso ou de outro sócio: customerName do que não é deste sócio.
    select v.d->>'customerName' as nome from vendas v
     where not v.do_socio
    union all
    -- Itens: produto (mesmo fora do cardápio) e quem levou. Quem pediu entra quando não é o
    -- sócio nem um dependente dele pelo id; na venda do próprio sócio, também não entra o
    -- nome igual a um dos antigos (lgpd_venda_por_id já o trata como dele).
    select f.nome from itens_venda iv
      cross join lateral (values
        (iv.v->>'name'),
        (iv.v->>'deliveredBy'),
        (case when coalesce(iv.v->>'requesterId', '') <> p_member_id
                   and not (coalesce(iv.v->>'requesterId', '') = any(v_dep_ids))
                   and (not iv.do_socio
                        or not (public.lgpd_dobrar(public.lgpd_colapsar(coalesce(iv.v->>'requesterName', ''))) = any(v_chaves)))
              then iv.v->>'requesterName' end)) as f(nome)
    union all
    -- Quem recebe o pedido, fora das vendas deste sócio.
    select p.who from pedidos p
     where p.sale_id is null or not (p.sale_id = any(v_vendas_socio))
    union all
    -- Itens de qualquer pedido: produto e quem levou.
    select f.nome from pedidos p
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.items) = 'array' then p.items else '[]'::jsonb end) as i(v)
      cross join lateral (values (i.v->>'name'), (i.v->>'deliveredBy')) as f(nome)
     where jsonb_typeof(i.v) = 'object'
  )
  select coalesce(array_agg(distinct o.x), '{}'::text[]) into v_outros
    from (
      select public.lgpd_dobrar(public.lgpd_colapsar(c.nome)) as x from cadastros c
      union all
      select t.x from (select public.lgpd_dobrar(public.lgpd_colapsar(tt.nome)) as x from textos tt) t
       where not (t.x = any(v_nomes_cmp))
    ) o
   where coalesce(o.x, '') <> '';

  -- Seguro: 2 palavras ou mais e não contido em nenhum outro nome.
  -- O teste de "contido" é a própria troca: lgpd_trocar_texto(outro, [nome], '#') muda o outro.
  -- Os dois lados vão por lgpd_dobrar e lgpd_colapsar: "JOSÉ  LIMA NETO" contém "José Lima"
  -- (em locale C a troca não iguala É e é, e o nome seria tido como seguro).
  select coalesce(array_agg(n order by n), '{}'::text[]) into v_seguros_base
    from unnest(v_nomes) as n
   where length(n) >= 2
     and coalesce(array_length(regexp_split_to_array(n, ' '), 1), 0) >= 2
     and not exists (
       select 1 from unnest(v_outros) as oo(o)
        where oo.o ilike any(public.lgpd_padroes(array[public.lgpd_dobrar(n)]))
          and public.lgpd_trocar_texto(oo.o, array[public.lgpd_dobrar(n)], '#') is distinct from oo.o);
  v_mantidos := cardinality(v_nomes) - cardinality(v_seguros_base);
  -- No texto livre, cada nome seguro vai nas duas formas: colapsado e como foi gravado.
  select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_seguros
    from (select n as x from unnest(v_seguros_base) as n
          union all
          select b from unnest(v_brutos) as b where public.lgpd_colapsar(b) = any(v_seguros_base)) xx;
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

-- Igual à migration anterior (create or replace já mantém; repetido por clareza).
revoke all on function public.member_anonymize_interno(text, text, text) from public, anon, authenticated;

-- ROLLBACK (não roda; para desfazer, colar no SQL editor):
-- 1. Reaplicar o create or replace function public.member_anonymize_interno(text, text, text)
--    da migration 20261119000000_lgpd_socios_banco.sql (Parte 3, o bloco que começa em
--    "create or replace function public.member_anonymize_interno" e termina no
--    "$function$;" antes de o comentário "Botão Anonimizar do cadastro"), sem mudar nada.
-- 2. Reaplicar do mesmo jeito o create or replace function public.lgpd_venda_por_id da
--    mesma migration (Parte 3), sem mudar nada.
-- 3. Depois (as funções antigas não usam lgpd_colapsar):
--    drop function if exists public.lgpd_colapsar(text);
