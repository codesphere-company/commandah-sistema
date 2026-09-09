-- =====================================================================
-- COMMANDAH — FASE 3a: tabela relacional de ORDERS (fila da cozinha)
-- Projeto Supabase: ezfoymdesmarpunmixbs
-- Data: 2026-09-08  |  Fase 3a do roadmap de seguranca
-- =====================================================================
--
-- CONTEXTO
-- --------
-- `cantina2:orders` era o ultimo blob de app_data com granularidade so de
-- LINHA: caixa e cozinha liam/escreviam a fila inteira de pedidos de todo
-- o tenant de uma vez (classe 'pedidos' em app_data_key_class, ver
-- 20260901000000_rls_por_papel.sql secao 2). Um pedido de uma comanda
-- vazava pra quem so deveria ver o proprio monitor de cozinha, e nao
-- dava pra auditar quem mudou o status de qual pedido.
--
-- Confirmado antes de rodar esta migration: a chave 'cantina2:orders' no
-- banco de producao esta vazia (nenhuma linha) — nao existe dado pra
-- migrar. Se isso mudar antes de aplicar, parar e escrever um passo de
-- backfill primeiro.
--
-- ORDEM DE APLICACAO (obrigatoria, igual Fase 2)
-- -----------------------------------------------
--   1. publicar o index.html com o OrdersStore (le/escreve a tabela nova
--      em modo nuvem, mantem o blob em modo local);
--   2. rodar esta migration;
--   3. reteste imediato: enviar item pra cozinha, avancar status, juntar
--      comandas, cancelar delivery.
--
-- O QUE MUDA
-- ----------
--   - cria public.orders com uma linha por pedido (em vez de um array
--     dentro do blob);
--   - RLS por papel: owner/admin/caixa/cozinha continuam com leitura e
--     escrita total sobre pedidos do proprio tenant — mesma superficie
--     de acesso que a classe 'pedidos' ja dava, so que agora por LINHA;
--   - 'cantina2:orders' sai do app_data_key_class (cai no default 'admin'
--     fail-closed): o frontend em nuvem para de ler/escrever essa chave,
--     entao nenhum papel precisa mais dela.
--
-- ROLLBACK
-- --------
-- Ver secao 4 no fim do arquivo.
-- =====================================================================


-- =====================================================================
-- SECAO 1 — TABELA orders
-- =====================================================================
-- `id` e text pelo mesmo motivo de members: veio do uid() gerado no
-- frontend, e sale_id referencia o id de venda que ainda mora no blob
-- 'cantina2:sales' (por isso sem FK — a tabela de vendas relacional e
-- fase futura).
--
-- `items` e `status_history` ficam JSONB: sao arrays de sub-objetos
-- (item do pedido / entrada de historico) que so o dono do pedido
-- escreve de uma vez, sem necessidade de query relacional sobre eles.
--
-- `status` fechado em check: pendente -> preparo -> pronto -> entregue,
-- ou cancelado (delivery cancelado / comanda cancelada). Sem estado novo
-- sem migration.

create table if not exists public.orders (
  id             text        not null,
  tenant_id      text        not null,
  sale_id        text,
  who            text        not null,
  local          text,
  items          jsonb       not null default '[]'::jsonb,
  status         text        not null default 'pendente',
  status_history jsonb       not null default '[]'::jsonb,
  kitchen_note   text,
  source         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint orders_pkey primary key (id),
  constraint orders_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id),
  constraint orders_status_check
    check (status = any (array['pendente'::text, 'preparo'::text, 'pronto'::text, 'entregue'::text, 'cancelado'::text]))
);

-- Todo acesso passa por tenant_id primeiro (predicado da RLS); status
-- serve o kanban da cozinha (filtra por coluna) e sale_id serve juntar
-- comandas (mergeOpenOrders) e cancelar delivery (cancelDelivery).
create index if not exists idx_orders_tenant on public.orders using btree (tenant_id);
create index if not exists idx_orders_status on public.orders using btree (tenant_id, status);
create index if not exists idx_orders_sale on public.orders using btree (sale_id);

alter table public.orders enable row level security;


-- =====================================================================
-- SECAO 2 — POLICIES DE orders (owner/admin/caixa/cozinha)
-- =====================================================================
-- Mesma superficie de acesso que a classe 'pedidos' do blob antigo: caixa
-- CRIA o pedido (sendItemsToKitchen), cozinha e caixa MOVIMENTAM o status
-- (advanceOrder/saveKitchenOrder/returnKitchenOrder), caixa REATRIBUI
-- sale_id ao juntar comandas (mergeOpenOrders) e CANCELA ao cancelar
-- delivery (cancelDelivery). Nenhum desses fluxos e exclusivo de
-- admin/dono, entao nao restringe alem do que ja existia.
--
-- Sem policy de DELETE: pedido cancelado vira status='cancelado', nunca
-- some da tabela (mesmo padrao de members com archived).

drop policy if exists orders_select_por_papel on public.orders;
create policy orders_select_por_papel
  on public.orders
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','cozinha')
  );

drop policy if exists orders_insert_por_papel on public.orders;
create policy orders_insert_por_papel
  on public.orders
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','cozinha')
  );

drop policy if exists orders_update_por_papel on public.orders;
create policy orders_update_por_papel
  on public.orders
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','cozinha')
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_staff_role()) in ('owner','admin','caixa','cozinha')
  );


-- =====================================================================
-- SECAO 3 — app_data_key_class(): remove 'cantina2:orders'
-- =====================================================================
-- A chave sai do case; cai no `else 'admin'` (fail-closed). Nenhum papel
-- em nuvem le/escreve mais essa chave (o OrdersStore do frontend passou a
-- falar direto com public.orders), entao a chave fica orfa de proposito —
-- se algum cliente antigo em cache ainda tentar ler/escrever, toma nega e
-- nao vaza nem corrompe nada.

create or replace function public.app_data_key_class(p_key text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_key
    -- catalogo: lido por todos os papeis, escrito so por admin/dono
    when 'cantina2:products'        then 'catalogo'
    when 'cantina2:categorias'      then 'catalogo'
    when 'cantina2:complementos'    then 'catalogo'
    when 'cantina2:observacoes'     then 'catalogo'
    when 'cantina2:perguntas'       then 'catalogo'
    when 'cantina2:paymentMethods'  then 'catalogo'
    when 'cantina2:cardBrands'      then 'catalogo'
    when 'cantina2:coupons'         then 'catalogo'
    when 'cantina2:locais'          then 'catalogo'
    when 'cantina2:impressoras'     then 'catalogo'
    when 'cantina2:estacoes'        then 'catalogo'
    when 'cantina2:origens'         then 'catalogo'
    when 'cantina2:settings'        then 'catalogo'
    when 'cantina2:users'           then 'catalogo'
    -- operacional: dinheiro e estoque do expediente
    when 'cantina2:sales'           then 'operacional'
    when 'cantina2:requests'        then 'operacional'
    when 'cantina2:scheduled'       then 'operacional'
    when 'cantina2:cashSession'     then 'operacional'
    when 'cantina2:cashHistory'     then 'operacional'
    when 'cantina2:cashMovements'   then 'operacional'
    when 'cantina2:orderCounter'    then 'operacional'
    when 'cantina2:insumos'         then 'operacional'
    when 'cantina2:stockMovements'  then 'operacional'
    -- auditoria: congelada
    when 'cantina2:logs'            then 'auditoria'
    -- retaguarda
    when 'cantina2:contas'          then 'admin'
    when 'cantina2:contaCategorias' then 'admin'
    when 'cantina2:fornecedores'    then 'admin'
    when 'cantina2:eventQueue'      then 'admin'
    else 'admin'  -- fail-closed (inclui 'cantina2:orders', migrado pra tabela)
  end;
$function$;

revoke all on function public.app_data_key_class(text) from public;
grant execute on function public.app_data_key_class(text) to anon, authenticated, service_role;


-- =====================================================================
-- SECAO 4 — ROLLBACK
-- =====================================================================
-- Volta 'cantina2:orders' pra classe 'pedidos' (repetir o case completo de
-- 20260901000000_rls_por_papel.sql secao 2) e derruba a tabela nova:
--
-- drop policy if exists orders_select_por_papel on public.orders;
-- drop policy if exists orders_insert_por_papel on public.orders;
-- drop policy if exists orders_update_por_papel on public.orders;
-- drop table if exists public.orders;
--
-- Atencao: so faz sentido dar rollback se o index.html tambem voltar pra
-- versao anterior ao OrdersStore — senao o frontend novo tenta falar com
-- uma tabela que nao existe mais.
