-- =====================================================================
-- COMMANDAH — endurecimento das RPCs de venda/estoque, trigger de fiado
-- sob concorrência, CHECK de print_jobs.status e índice da fila.
-- Data: 2026-10-02  |  Origem: auditoria do setor Banco/Backend
-- =====================================================================
--
-- O QUE MUDA (nenhuma mudança de comportamento no caminho feliz)
-- ----------------------------------------------------------------
-- 1. recalc_member_debt(): trava a linha do sócio ANTES de somar o ledger.
--    Hoje o UPDATE ... SET debt = (SELECT sum ...) roda com o snapshot do
--    início do comando. Dois lançamentos simultâneos no mesmo sócio (dois
--    caixas, ou fiado + crédito da mesma venda em abas diferentes): o 2º
--    espera o lock do 1º, mas a subquery dele não enxerga a linha que o 1º
--    acabou de commitar -> members.debt fica sem um dos lançamentos até o
--    próximo lançamento. Com o SELECT ... FOR UPDATE num comando separado,
--    o UPDATE seguinte pega snapshot novo (READ COMMITTED) e soma certo.
--    Continua SECURITY INVOKER (decisão registrada no baseline/RLS).
--
-- 2. consume_insumos / restore_insumos: recusam quantidade <= 0 ou não
--    numérica. Hoje consume_insumos com qty negativa passa na checagem de
--    "estoque insuficiente" e SOMA ao estoque (caixa pelo devtools inflava
--    estoque mesmo sem escrita direta em cantina2:insumos, que a Fase 2b
--    tirou dele). O cliente só manda qty > 0 (requiredInsumosForItems),
--    mas o filtro abaixo descarta 0 e recusa negativos/NaN.
--    restore_insumos também deixa de gravar NULL em app_data.value quando
--    o tenant ainda não tem a linha cantina2:insumos (NOT NULL estourava
--    com erro genérico).
--
-- 3. close_sale: recusa p_sale_patch que não seja objeto JSON. Com NULL,
--    o append gravava um `null` dentro do array de cantina2:sales (quebra
--    relatórios que fazem s.status) e o recibo ficava com result NULL,
--    então o retry duplicava.
--
-- 4. print_jobs.status ganha CHECK (dívida nº 2 do baseline), NOT VALID:
--    vale pra linhas novas sem varrer/travar as antigas. Rodar o VALIDATE
--    (comentado no fim) depois de conferir que não há valor fora da lista.
--
-- 5. Índice parcial pra fila pendente. print_agent_fetch_pending e o
--    aviso de fila travada (checkStuckPrintQueue no index.html) filtram
--    tenant_id + status='pendente' + ORDER BY created_at, SEM printer_name;
--    o idx_print_jobs_pending (tenant_id, printer_name, status) só ajuda
--    pelo prefixo tenant_id e varre todo o histórico impresso do tenant.
--
-- ROLLBACK: recriar as funções a partir de 20260908000000 /
-- 20260920000000 / 20260831000000 (recalc_member_debt), e
--   alter table public.print_jobs drop constraint if exists print_jobs_status_check;
--   drop index if exists public.idx_print_jobs_tenant_pendente_created;
-- =====================================================================


-- =====================================================================
-- SECAO 1 — recalc_member_debt: trava o sócio antes de recalcular
-- =====================================================================
create or replace function public.recalc_member_debt()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  target_member_id text;
begin
  target_member_id := coalesce(new.member_id, old.member_id);

  -- Serializa lançamentos concorrentes do mesmo sócio. O UPDATE abaixo é
  -- um comando novo, então enxerga o que o concorrente já commitou.
  perform 1 from public.members where id = target_member_id for update;

  update public.members
  set debt = (
        select coalesce(sum(case when type='debt' then value when type='payment' then -value else 0 end), 0)
        from public.member_debt_entries
        where member_id = target_member_id and not reversed
      ),
      updated_at = now()
  where id = target_member_id;
  return null;
end;
$function$;

revoke execute on function public.recalc_member_debt() from public, anon;
grant execute on function public.recalc_member_debt() to authenticated, service_role;


-- =====================================================================
-- SECAO 2 — consume_insumos: valida quantidade
-- =====================================================================
create or replace function public.consume_insumos(p_consumptions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_insumos jsonb;
  v_key text;
  v_qty numeric;
  v_idx int;
  v_stock numeric;
  v_missing text[] := '{}';
  v_movements jsonb := '[]'::jsonb;
begin
  if not (public.is_admin_like() or public.current_staff_role() = 'caixa') then
    raise exception 'sem permissao para baixar estoque';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_consumptions is null or jsonb_typeof(p_consumptions) <> 'object' or p_consumptions = '{}'::jsonb then
    return '[]'::jsonb;
  end if;

  -- Quantidade tem que ser numero > 0. Negativo aqui somaria ao estoque.
  if exists (
    select 1 from jsonb_each(p_consumptions) as e(key, value)
     where jsonb_typeof(e.value) <> 'number' or (e.value)::text::numeric < 0
  ) then
    raise exception 'quantidade invalida em p_consumptions';
  end if;

  perform 1 from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos'
   for update;

  select coalesce(value, '[]'::jsonb) into v_insumos
    from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  -- 1a passada: confere se da pra atender TUDO antes de mexer em qualquer coisa.
  for v_key, v_qty in
    select e.key, e.value::numeric from jsonb_each_text(p_consumptions) as e(key, value)
     where e.value::numeric > 0
  loop
    select (t.ord - 1) into v_idx
      from jsonb_array_elements(v_insumos) with ordinality as t(elem, ord)
     where t.elem->>'id' = v_key;

    if v_idx is null or coalesce((v_insumos -> v_idx ->> 'stock')::numeric, 0) < v_qty - 1e-9 then
      v_missing := array_append(v_missing, v_key);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'estoque insuficiente para: %', array_to_string(v_missing, ', ');
  end if;

  -- 2a passada: desconta de verdade, ja sabendo que da pra atender tudo.
  for v_key, v_qty in
    select e.key, e.value::numeric from jsonb_each_text(p_consumptions) as e(key, value)
     where e.value::numeric > 0
  loop
    select (t.ord - 1) into v_idx
      from jsonb_array_elements(v_insumos) with ordinality as t(elem, ord)
     where t.elem->>'id' = v_key;

    v_stock := coalesce((v_insumos -> v_idx ->> 'stock')::numeric, 0);
    v_movements := v_movements || jsonb_build_object(
      'insumoId', v_key, 'before', v_stock, 'qty', v_qty, 'after', v_stock - v_qty
    );
    v_insumos := jsonb_set(v_insumos, array[v_idx::text, 'stock'], to_jsonb(v_stock - v_qty));
  end loop;

  if jsonb_array_length(v_movements) = 0 then
    return v_movements; -- so tinha qty 0: nada a gravar
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:insumos', v_insumos)
  on conflict (tenant_id, key) do update
    set value = excluded.value, updated_at = now();

  return v_movements;
end;
$$;

revoke execute on function public.consume_insumos(jsonb) from public, anon;
grant execute on function public.consume_insumos(jsonb) to authenticated, service_role;


-- =====================================================================
-- SECAO 3 — restore_insumos: valida quantidade e nao grava NULL
-- =====================================================================
create or replace function public.restore_insumos(p_consumptions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_insumos jsonb;
  v_key text;
  v_qty numeric;
  v_idx int;
  v_stock numeric;
  v_movements jsonb := '[]'::jsonb;
begin
  if not (public.is_admin_like() or public.current_staff_role() = 'caixa') then
    raise exception 'sem permissao para devolver estoque';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_consumptions is null or jsonb_typeof(p_consumptions) <> 'object' or p_consumptions = '{}'::jsonb then
    return '[]'::jsonb;
  end if;

  if exists (
    select 1 from jsonb_each(p_consumptions) as e(key, value)
     where jsonb_typeof(e.value) <> 'number' or (e.value)::text::numeric < 0
  ) then
    raise exception 'quantidade invalida em p_consumptions';
  end if;

  perform 1 from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos'
   for update;

  select value into v_insumos
    from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  if v_insumos is null or jsonb_typeof(v_insumos) <> 'array' then
    return '[]'::jsonb; -- tenant sem cadastro de insumos: nada a devolver
  end if;

  for v_key, v_qty in
    select e.key, e.value::numeric from jsonb_each_text(p_consumptions) as e(key, value)
     where e.value::numeric > 0
  loop
    select (t.ord - 1) into v_idx
      from jsonb_array_elements(v_insumos) with ordinality as t(elem, ord)
     where t.elem->>'id' = v_key;

    if v_idx is null then
      continue; -- insumo removido do cadastro depois do consumo original: nada a devolver aqui
    end if;

    v_stock := coalesce((v_insumos -> v_idx ->> 'stock')::numeric, 0);
    v_movements := v_movements || jsonb_build_object(
      'insumoId', v_key, 'before', v_stock, 'qty', v_qty, 'after', v_stock + v_qty
    );
    v_insumos := jsonb_set(v_insumos, array[v_idx::text, 'stock'], to_jsonb(v_stock + v_qty));
  end loop;

  if jsonb_array_length(v_movements) = 0 then
    return v_movements;
  end if;

  update public.app_data
     set value = v_insumos, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:insumos';

  return v_movements;
end;
$$;

revoke execute on function public.restore_insumos(jsonb) from public, anon;
grant execute on function public.restore_insumos(jsonb) to authenticated, service_role;


-- =====================================================================
-- SECAO 4 — close_sale: p_sale_patch precisa ser objeto
-- =====================================================================
create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_result jsonb;
  v_sales jsonb;
  v_idx int;
  v_sale jsonb;
begin
  if not (public.is_admin_like() or public.current_staff_role() = 'caixa') then
    raise exception 'sem permissao para fechar venda';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_sale_id is null or length(p_sale_id) = 0 then
    raise exception 'p_sale_id obrigatorio';
  end if;

  if p_sale_patch is null or jsonb_typeof(p_sale_patch) <> 'object' then
    raise exception 'p_sale_patch deve ser um objeto JSON';
  end if;

  insert into public.sale_close_receipts (tenant_id, sale_id)
  values (v_tenant, p_sale_id)
  on conflict (tenant_id, sale_id) do nothing;

  select result into v_result
    from public.sale_close_receipts
   where tenant_id = v_tenant and sale_id = p_sale_id
   for update;

  if v_result is not null then
    return v_result; -- retry idempotente: ja foi processado, nao repete
  end if;

  perform 1 from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:sales'
   for update;

  select coalesce(value, '[]'::jsonb) into v_sales
    from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:sales';
  v_sales := coalesce(v_sales, '[]'::jsonb); -- tenant sem nenhuma venda ainda (sem linha)

  if p_existing then
    select (t.ord - 1) into v_idx
      from jsonb_array_elements(v_sales) with ordinality as t(elem, ord)
     where t.elem->>'id' = p_sale_id;

    if v_idx is null then
      raise exception 'venda % nao encontrada para atualizar', p_sale_id;
    end if;

    v_sale := (v_sales -> v_idx) || p_sale_patch;
    v_sales := jsonb_set(v_sales, array[v_idx::text], v_sale);
  else
    v_sale := p_sale_patch || jsonb_build_object('id', p_sale_id);
    v_sales := v_sales || jsonb_build_array(v_sale);
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:sales', v_sales)
  on conflict (tenant_id, key) do update
    set value = excluded.value, updated_at = now();

  update public.sale_close_receipts
     set result = v_sale
   where tenant_id = v_tenant and sale_id = p_sale_id;

  return v_sale;
end;
$$;

revoke execute on function public.close_sale(text, boolean, jsonb) from public, anon;
grant execute on function public.close_sale(text, boolean, jsonb) to authenticated, service_role;


-- =====================================================================
-- SECAO 5 — print_jobs: CHECK de status (NOT VALID) + indice da fila
-- =====================================================================
alter table public.print_jobs drop constraint if exists print_jobs_status_check;
alter table public.print_jobs
  add constraint print_jobs_status_check
  check (status = any (array['pendente'::text, 'processando'::text, 'impresso'::text, 'erro'::text]))
  not valid;

create index if not exists idx_print_jobs_tenant_pendente_created
  on public.print_jobs using btree (tenant_id, created_at)
  where status = 'pendente';

-- Depois de conferir que nada sai da lista:
--   select status, count(*) from public.print_jobs group by 1;
-- validar (le a tabela, nao bloqueia escrita):
--   alter table public.print_jobs validate constraint print_jobs_status_check;
