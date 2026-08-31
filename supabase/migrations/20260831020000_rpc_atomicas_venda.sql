-- =====================================================================
-- COMMANDAH — RPCs ATOMICAS PARA FECHAMENTO DE VENDA
-- Projeto Supabase: ezfoymdesmarpunmixbs
-- Data: 2026-08-31  |  Origem: achado do backend-senior (Fase 1, item 3)
-- =====================================================================
--
-- O PROBLEMA
-- ----------
-- Tres operacoes fazem read-modify-write NO CLIENTE contra blobs JSON em
-- app_data (tabela (tenant_id, key, value jsonb)), sem nenhuma trava:
--   1. Numeracao de pedido (cantina2:orderCounter) — 11 pontos de chamada
--      no index.html, a maioria ao ABRIR uma comanda/delivery/agendamento.
--   2. Baixa de estoque por ficha tecnica (cantina2:insumos) — 9 pontos
--      de chamada, via sendItemsToKitchen/consumeInsumosForItems.
--   3. Registro da venda em si (cantina2:sales) — dentro de finalizeSale,
--      sem idempotencia: um retry de rede pode duplicar a venda.
-- Sob concorrencia (dois caixas, dois dispositivos), isso gera numero de
-- pedido duplicado, estoque ficando negativo, e venda perdida/duplicada.
--
-- A SOLUCAO
-- ---------
-- Tres RPCs que fazem a mesma operacao DENTRO do Postgres, usando trava
-- de linha (FOR UPDATE / UPDATE...ON CONFLICT), que e atomica por
-- natureza. Os blobs continuam sendo JSON em app_data — NAO migramos
-- sales/insumos/orderCounter pro relacional aqui (isso e a Fase 3,
-- maior, separada). A trava e na LINHA do Postgres, nao no formato do
-- dado.
--
-- As 3 RPCs sao INDEPENDENTES entre si (nao uma transacao gigante
-- combinada) — cada uma atomica sozinha, chamadas em sequencia de
-- dentro de finalizeSale no index.html. O unico risco residual e uma
-- falha exatamente ENTRE duas chamadas (ex. estoque descontado mas
-- venda falhou ao gravar) — muito menor que o problema original, e
-- aceitavel dado o estagio do projeto (sem testes automatizados).
--
-- IDEMPOTENCIA
-- ------------
-- close_sale() usa uma tabela nova, sale_close_receipts, pra garantir
-- que um retry de rede com o MESMO sale_id nao duplique a venda: a
-- segunda chamada devolve o resultado ja gravado em vez de repetir o
-- trabalho.
--
-- SEGURANCA
-- ---------
-- Todas as 3 funcoes sao SECURITY INVOKER (rodam com o privilegio de
-- quem chama, nao elevam permissao) e resolvem o tenant via
-- current_tenant_id() — nunca confiam em tenant_id vindo do cliente.
-- Isso segue o mesmo padrao ja usado em recalc_member_debt() e nas RLS
-- policies existentes (ver baseline).
-- =====================================================================


-- =====================================================================
-- SECAO 1 — TABELA DE IDEMPOTENCIA (sale_close_receipts)
-- =====================================================================
-- Guarda o resultado de cada close_sale() bem-sucedido, indexado por
-- (tenant_id, sale_id). Uma segunda chamada com o mesmo sale_id (retry
-- de rede, duplo clique) encontra o resultado aqui e devolve sem repetir
-- o trabalho — em vez de duplicar a venda no array de cantina2:sales.

create table if not exists public.sale_close_receipts (
  tenant_id   text        not null,
  sale_id     text        not null,
  result      jsonb,
  created_at  timestamptz not null default now(),
  constraint sale_close_receipts_pkey primary key (tenant_id, sale_id)
);

alter table public.sale_close_receipts enable row level security;

drop policy if exists tenant_isolated_sale_close_receipts on public.sale_close_receipts;
create policy tenant_isolated_sale_close_receipts on public.sale_close_receipts
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

revoke all on public.sale_close_receipts from anon, authenticated;
grant select, insert, update on public.sale_close_receipts to authenticated;


-- =====================================================================
-- SECAO 2 — next_order_number(p_start)
-- =====================================================================
-- Substitui a logica de nextOrderNumber() no index.html. Um unico
-- INSERT...ON CONFLICT DO UPDATE...RETURNING e atomico por natureza:
-- o Postgres trava a linha durante a operacao, sem precisar de um
-- SELECT FOR UPDATE separado antes. p_start reflete
-- state.settings.customNumbering/numberingStart (calculado no cliente,
-- nao e informacao sensivel a concorrencia — so o INCREMENTO precisa
-- ser atomico).

create or replace function public.next_order_number(p_start integer default 1)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant text;
  v_next integer;
begin
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
-- SECAO 3 — consume_insumos(p_consumptions)
-- =====================================================================
-- Substitui a baixa de estoque de consumeInsumosForItems() no
-- index.html. p_consumptions e um objeto {"insumoId1": 2.5, "insumoId2": 1}
-- — mapa flat de insumoId -> quantidade total necessaria, exatamente o
-- formato que requiredInsumosForItems(items) ja produz no frontend.
--
-- Trava a linha de cantina2:insumos, faz DUAS passadas: primeiro confere
-- se da pra atender TUDO (se nao der, RAISE EXCEPTION desfaz a
-- transacao inteira sozinho, sem descontar nada pela metade), depois
-- desconta de verdade. Retorna um array de movimentos
-- [{insumoId, before, qty, after}, ...] pro cliente montar as entradas
-- de auditoria (cantina2:stockMovements) com numeros confiaveis, sem
-- duplicar a decisao de "quanto descontar" no JS.
--
-- Se um insumoId de p_consumptions nao existir no array de insumos,
-- e tratado como estoque insuficiente (fail-safe: bloqueia a venda em
-- vez de silenciosamente ignorar um insumo desconhecido).

create or replace function public.consume_insumos(p_consumptions jsonb)
returns jsonb
language plpgsql
security invoker
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
-- SECAO 4 — close_sale(p_sale_id, p_existing, p_sale_patch)
-- =====================================================================
-- Substitui o state.sales.push(sale) / state.sales[idx] = {...} +
-- save('sales') de dentro de finalizeSale() no index.html.
--
-- p_existing = true  -> mescla p_sale_patch no item existente de
--                        cantina2:sales cujo id = p_sale_id (fechamento
--                        de comanda/delivery ja aberto).
-- p_existing = false -> insere p_sale_patch como um novo item no array
--                        (venda balcao nova), com id = p_sale_id.
--
-- IDEMPOTENCIA: o INSERT...ON CONFLICT DO NOTHING seguido de
-- SELECT...FOR UPDATE em sale_close_receipts faz com que DUAS chamadas
-- concorrentes com o MESMO sale_id serializem — a segunda espera a
-- primeira terminar e devolve o resultado ja gravado, sem duplicar o
-- append. Um retry sequencial (rede caiu, cliente tenta de novo) tambem
-- cai nesse caminho: o resultado ja esta gravado, devolve na hora sem
-- repetir nada.

create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant text;
  v_result jsonb;
  v_sales jsonb;
  v_idx int;
  v_sale jsonb;
begin
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
