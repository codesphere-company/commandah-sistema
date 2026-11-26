-- Cardápio digital, etapa 2 (26/11/2026): o sócio pede pelo celular e marca na cota.
-- Desenho: docs/superpowers/specs/2026-11-26-cardapio-etapa2-design.md.
--
-- cardapio_codigos: código de 4 números mandado pelo WhatsApp para confirmar que é o sócio (só o hash fica
--   gravado; vale 10 minutos, 5 tentativas). Só a função "cardapio" (service role) lê e grava.
-- cardapio_pedidos: fila do pedido feito no celular. A função grava (status 'novo', itens e preços calculados
--   pelo cadastro); o computador "Caixa do app" pega (cardapio_pedido_pegar), abre ou usa a comanda do sócio,
--   manda para a cozinha e conclui (cardapio_pedido_concluir). Pedido 'novo' com mais de 3 minutos não é mais
--   pego: o cliente já foi orientado a chamar o garçom, e o pedido não pode sair em dobro.
-- Ler: dono, admin e caixa do próprio estabelecimento. Apagar: limpeza diária (mais de 90 dias).

create table if not exists public.cardapio_codigos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null references public.tenant_owners(tenant_id) on delete cascade,
  member_id    text not null references public.members(id) on delete cascade,
  codigo_hash  text not null,
  expira_em    timestamptz not null,
  tentativas   int not null default 0,
  usado_em     timestamptz,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_cardapio_codigos_membro on public.cardapio_codigos (tenant_id, member_id, criado_em desc);

create table if not exists public.cardapio_pedidos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references public.tenant_owners(tenant_id) on delete cascade,
  member_id      text not null references public.members(id) on delete cascade,
  dependente_id  text,
  quem_nome      text not null check (length(quem_nome) between 1 and 120),
  local          text not null check (length(local) between 1 and 120),
  itens          jsonb not null check (jsonb_typeof(itens) = 'array'),
  total          numeric(10,2) not null check (total >= 0),
  obs            text check (length(obs) <= 140),
  status         text not null default 'novo' check (status in ('novo', 'processando', 'na_cozinha', 'erro')),
  motivo         text check (length(motivo) <= 300),
  sale_id        text,
  order_number   int,
  criado_em      timestamptz not null default now(),
  pego_em        timestamptz,
  pego_por       text,
  processado_em  timestamptz
);
create index if not exists idx_cardapio_pedidos_novos on public.cardapio_pedidos (tenant_id, criado_em) where status = 'novo';
create index if not exists idx_cardapio_pedidos_dia on public.cardapio_pedidos (tenant_id, criado_em desc);

alter table public.cardapio_codigos enable row level security;
alter table public.cardapio_pedidos enable row level security;
revoke all on public.cardapio_codigos from public, anon, authenticated;
revoke all on public.cardapio_pedidos from public, anon, authenticated;
grant select, insert, update, delete on public.cardapio_codigos to service_role;
grant select, insert, update, delete on public.cardapio_pedidos to service_role;
grant select on public.cardapio_pedidos to authenticated;

drop policy if exists cardapio_pedidos_ler on public.cardapio_pedidos;
create policy cardapio_pedidos_ler on public.cardapio_pedidos
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_staff_role()) in ('owner', 'admin', 'caixa'));

-- O caixa pega o pedido: só um aparelho consegue (update atômico), e só pedido novo de até 3 minutos.
create or replace function public.cardapio_pedido_pegar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_row public.cardapio_pedidos%rowtype;
begin
  if v_tenant is null or public.current_staff_role() not in ('owner', 'admin', 'caixa') then
    raise exception 'sem permissao para pegar pedido do cardapio';
  end if;
  update public.cardapio_pedidos
     set status = 'processando', pego_em = now(), pego_por = coalesce(public.current_staff_id(), 'dono')
   where id = p_id and tenant_id = v_tenant and status = 'novo' and criado_em > now() - interval '3 minutes'
  returning * into v_row;
  if v_row.id is null then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$function$;
revoke all on function public.cardapio_pedido_pegar(uuid) from public, anon;
grant execute on function public.cardapio_pedido_pegar(uuid) to authenticated;

-- O caixa conclui: 'na_cozinha' (com a comanda) ou 'erro' (com o motivo para o cliente).
create or replace function public.cardapio_pedido_concluir(p_id uuid, p_status text, p_motivo text, p_sale_id text, p_order_number int)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
begin
  if v_tenant is null or public.current_staff_role() not in ('owner', 'admin', 'caixa') then
    raise exception 'sem permissao para concluir pedido do cardapio';
  end if;
  if p_status not in ('na_cozinha', 'erro') then
    raise exception 'situacao invalida';
  end if;
  update public.cardapio_pedidos
     set status = p_status, motivo = left(p_motivo, 300), sale_id = left(p_sale_id, 80),
         order_number = p_order_number, processado_em = now()
   where id = p_id and tenant_id = v_tenant and status = 'processando';
  return found;
end;
$function$;
revoke all on function public.cardapio_pedido_concluir(uuid, text, text, text, int) from public, anon;
grant execute on function public.cardapio_pedido_concluir(uuid, text, text, text, int) to authenticated;

create or replace function public.cardapio_limpar_antigos()
returns void
language sql
security definer
set search_path to ''
as $function$
  delete from public.cardapio_codigos where criado_em < now() - interval '1 day';
  delete from public.cardapio_pedidos where criado_em < now() - interval '90 days';
$function$;
revoke all on function public.cardapio_limpar_antigos() from public, anon, authenticated;
grant execute on function public.cardapio_limpar_antigos() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    execute $q$select cron.schedule('cardapio-limpar-antigos', '50 7 * * *', 'select public.cardapio_limpar_antigos()')$q$;
  else
    raise notice 'pg_cron indisponivel: limpeza do cardapio nao agendada (banco local)';
  end if;
end
$$;

-- ROLLBACK (manual):
--   select cron.unschedule('cardapio-limpar-antigos');
--   drop function if exists public.cardapio_limpar_antigos(), public.cardapio_pedido_concluir(uuid, text, text, text, int), public.cardapio_pedido_pegar(uuid);
--   drop table if exists public.cardapio_pedidos, public.cardapio_codigos;
