-- =====================================================================
-- COMMANDAH — FASE 2b: SECURITY DEFINER nas RPCs de venda + fecha buraco
-- de devtools que a Fase 2 deixou aberto conscientemente.
-- Data: 2026-09-08
-- =====================================================================
--
-- O PROBLEMA
-- ----------
-- As 3 RPCs de supabase/migrations/20260831020000_rpc_atomicas_venda.sql
-- (next_order_number, consume_insumos, close_sale) sao SECURITY INVOKER:
-- rodam com o privilegio de quem chama, e dependem da RLS de app_data pra
-- decidir se a escrita e permitida. Isso tem duas consequencias:
--   1. A RLS de app_data hoje da ao caixa escrita DIRETA na tabela pra
--      qualquer chave da classe 'operacional' — incluindo
--      cantina2:orderCounter e cantina2:insumos. Ou seja, o caixa pode
--      abrir o devtools e fazer um UPDATE cru nessas chaves, pulando por
--      completo a logica atomica/validada das RPCs (numero de pedido
--      duplicado, estoque negativo).
--   2. Se so convertessemos as RPCs pra SECURITY DEFINER sem checagem
--      interna de papel, a RLS deixaria de valer DENTRO da funcao — um
--      usuario 'cozinha' autenticado (hoje bloqueado pela RLS de
--      'operacional') passaria a conseguir chamar consume_insumos/
--      next_order_number/close_sale com sucesso, ja que GRANT EXECUTE e
--      pra 'authenticated' em geral.
--
-- A SOLUCAO
-- ---------
-- 1. As 3 RPCs viram SECURITY DEFINER (rodam com privilegio do dono,
--    ignoram RLS por dentro) e ganham uma checagem interna explicita de
--    papel logo no inicio: precisa ser is_admin_like() ou
--    current_staff_role() = 'caixa' — a MESMA regra que a RLS de
--    'operacional' ja aplicava antes desta migration. current_tenant_id()
--    continua resolvendo o tenant a partir de auth.uid() (nao muda com
--    SECURITY DEFINER), entao o isolamento por tenant dentro das funcoes
--    segue igual.
-- 2. A RLS de app_data (INSERT/UPDATE) perde, PARA O CAIXA, a escrita
--    direta em cantina2:orderCounter e cantina2:insumos especificamente.
--    Confirmado antes de escrever esta migration que isso e seguro:
--      - ROLE_PERMS do index.html nao da ao caixa os tokens 'insumos' nem
--        'config-sistema' — as unicas telas com save('insumos')/
--        save('orderCounter') diretos em modo nuvem sao admin-only.
--      - Em modo nuvem, consumeInsumosForItems/nextOrderNumber ja chamam
--        exclusivamente as RPCs; os save() diretos que sobram nessas
--        funcoes sao o fallback do Modo Local, que nunca toca o Supabase.
--    O SELECT do caixa nessas chaves NAO muda (ele ainda le estoque e
--    numeracao pra UI normalmente).
-- 3. cantina2:sales fica DE FORA desse aperto — o caixa continua com
--    escrita direta nela. HANDOFF.md documenta ~11 pontos de abertura de
--    comanda/delivery/agendamento fora do close_sale ainda nao migrados;
--    travar essa chave quebraria esses fluxos. Risco residual conhecido,
--    deferido pra Fase 3 (migracao relacional maior).
-- =====================================================================


-- =====================================================================
-- SECAO 1 — next_order_number: SECURITY DEFINER + checagem de papel
-- =====================================================================

create or replace function public.next_order_number(p_start integer default 1)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_next integer;
begin
  if not (public.is_admin_like() or public.current_staff_role() = 'caixa') then
    raise exception 'sem permissao para gerar numero de pedido';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:orderCounter', to_jsonb(greatest(0, p_start - 1) + 1))
  on conflict (tenant_id, key) do update
    set value = to_jsonb(
          greatest(
            coalesce((public.app_data.value)::text::integer, 0),
            p_start - 1
          ) + 1
        ),
        updated_at = now()
  returning (value)::text::integer into v_next;

  return v_next;
end;
$$;

revoke all on function public.next_order_number(integer) from public;
grant execute on function public.next_order_number(integer) to authenticated;


-- =====================================================================
-- SECAO 2 — consume_insumos: SECURITY DEFINER + checagem de papel
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

  if p_consumptions is null or p_consumptions = '{}'::jsonb then
    return '[]'::jsonb;
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

  insert into public.app_data (tenant_id, key, value)
  values (v_tenant, 'cantina2:insumos', v_insumos)
  on conflict (tenant_id, key) do update
    set value = excluded.value, updated_at = now();

  return v_movements;
end;
$$;

revoke all on function public.consume_insumos(jsonb) from public;
grant execute on function public.consume_insumos(jsonb) to authenticated;


-- =====================================================================
-- SECAO 3 — close_sale: SECURITY DEFINER + checagem de papel
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

revoke all on function public.close_sale(text, boolean, jsonb) from public;
grant execute on function public.close_sale(text, boolean, jsonb) to authenticated;


-- =====================================================================
-- SECAO 4 — RLS de app_data: tira do caixa a escrita direta em
-- cantina2:orderCounter e cantina2:insumos (INSERT e UPDATE). O SELECT
-- do caixa nessas chaves nao muda. cantina2:sales fica de fora de
-- proposito (ver cabecalho).
-- =====================================================================

drop policy if exists app_data_insert_por_papel on public.app_data;
create policy app_data_insert_por_papel
  on public.app_data
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
        and key not in ('cantina2:orderCounter','cantina2:insumos')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  );

drop policy if exists app_data_update_por_papel on public.app_data;
create policy app_data_update_por_papel
  on public.app_data
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
        and key not in ('cantina2:orderCounter','cantina2:insumos')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.app_data_key_class(key) <> 'auditoria'
    and (
      (select public.is_admin_like())
      or (
        (select public.current_staff_role()) = 'caixa'
        and public.app_data_key_class(key) in ('pedidos','operacional')
        and key not in ('cantina2:orderCounter','cantina2:insumos')
      )
      or (
        (select public.current_staff_role()) = 'cozinha'
        and public.app_data_key_class(key) = 'pedidos'
      )
    )
  );
