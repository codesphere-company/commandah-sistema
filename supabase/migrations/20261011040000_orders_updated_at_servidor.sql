-- =====================================================================
-- 20261011040000_orders_updated_at_servidor.sql — BD-06 (menos carga)
-- =====================================================================
-- A DECISAO (dono, 10/10)
-- -----------------------
-- A cozinha e a tela de pedidos carregam os pedidos abertos e os das últimas
-- 48 h; depois, a cada 6 s, só o que mudou (antes: a tabela inteira a cada 6 s
-- em cada aparelho, e sem paginar — passando de 1000 linhas, pedido sumia).
--
-- POR QUE PRECISA DO BANCO
-- ------------------------
-- "Só o que mudou" é por updated_at. Hoje o site grava updated_at com o relógio
-- do aparelho: um aparelho com o relógio atrasado gravaria uma hora "do
-- passado" e os outros nunca veriam a mudança. Este trigger faz o banco
-- carimbar updated_at = now() em todo insert/update, e o índice atende a busca.
-- =====================================================================

create or replace function public.orders_touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.orders_touch_updated_at() from public, anon, authenticated;

drop trigger if exists trg_orders_touch_updated_at on public.orders;
create trigger trg_orders_touch_updated_at
  before insert or update on public.orders
  for each row execute function public.orders_touch_updated_at();

create index if not exists idx_orders_tenant_updated on public.orders using btree (tenant_id, updated_at);
create index if not exists idx_orders_tenant_created on public.orders using btree (tenant_id, created_at);

-- ROLLBACK:
-- drop trigger if exists trg_orders_touch_updated_at on public.orders;
-- drop function if exists public.orders_touch_updated_at();
-- drop index if exists public.idx_orders_tenant_updated;
-- drop index if exists public.idx_orders_tenant_created;
