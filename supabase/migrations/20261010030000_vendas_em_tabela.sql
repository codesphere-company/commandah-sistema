-- =====================================================================
-- 20261010030000_vendas_em_tabela.sql — EST-01 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- Todas as vendas (comandas abertas e histórico) viviam num blob só,
-- app_data 'cantina2:sales', regravado inteiro por cada aparelho. Dois aparelhos
-- mexendo em comandas diferentes ao mesmo tempo: o último a gravar apagava a
-- mudança do outro. O OP-01 reduziu a janela (relê antes de gravar), mas a causa
-- era o blob. O poll de 6 s também baixava o histórico inteiro toda vez.
--
-- A SOLUCAO
-- ---------
-- Tabela public.sales, uma linha por venda (o JSON da venda em "data", do jeito
-- que o site já usa). Decisão do dono em 09/10: o clube tem só 25 vendas, então
-- TODO o histórico vem para a tabela (uma fonte só).
--   - sales_apply(p_upserts, p_delete_ids): grava só as vendas que o aparelho
--     mudou (uma linha cada); apagar vira deleted_at (o poll dos outros aparelhos
--     precisa ver a exclusão). version sobe a cada gravação.
--   - close_sale: mesma idempotência de antes (sale_close_receipts), agora
--     travando e gravando a LINHA da venda em vez do blob.
--   - O poll do site lê só o que mudou (updated_at > último visto).
--   - Leitura: dono/admin e caixa (como o blob). Escrita só pelas funções.
--   - O blob 'cantina2:sales' fica guardado como cópia de segurança e passa a
--     recusar gravação: aparelho com a versão antiga aberta recebe erro de
--     gravação (faixa vermelha) e o aviso de versão nova manda recarregar.
--
-- RETESTE: select count(*) from sales where tenant_id = '<clube>' deve bater com
-- jsonb_array_length do blob antigo. No site, abrir comanda num aparelho e lançar
-- item em outra comanda no outro: as duas ficam.
-- =====================================================================

create table if not exists public.sales (
  tenant_id   text        not null,
  id          text        not null,
  seq         bigint      generated always as identity,
  data        jsonb       not null,
  status      text        generated always as (data->>'status') stored,
  type        text        generated always as (data->>'type') stored,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  version     integer     not null default 1,
  constraint sales_pkey primary key (tenant_id, id),
  constraint sales_data_objeto check (jsonb_typeof(data) = 'object' and data->>'id' = id),
  constraint sales_tenant_id_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id)
);

create index if not exists idx_sales_tenant_updated on public.sales using btree (tenant_id, updated_at);
create index if not exists idx_sales_tenant_seq on public.sales using btree (tenant_id, seq);
create index if not exists idx_sales_tenant_open on public.sales using btree (tenant_id) where status = 'open' and deleted_at is null;

alter table public.sales enable row level security;

drop policy if exists sales_select_por_papel on public.sales;
create policy sales_select_por_papel
  on public.sales
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.is_admin_like()) or (select public.current_staff_role()) = 'caixa')
  );
-- Sem policy de insert/update/delete: escrita só por sales_apply e close_sale.

revoke all on table public.sales from public, anon;
grant select on table public.sales to authenticated;
grant all on table public.sales to service_role;

-- ---------------------------------------------------------------------
-- sales_apply: grava as vendas que este aparelho mudou
-- ---------------------------------------------------------------------
create or replace function public.sales_apply(p_upserts jsonb, p_delete_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_del jsonb := coalesce(p_delete_ids, '[]'::jsonb);
  v_rows jsonb;
begin
  if v_tenant is null or not public.cash_can_write() then
    raise exception 'sem permissao para gravar vendas';
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_del) <> 'array'
     or jsonb_array_length(v_up) > 500 or jsonb_array_length(v_del) > 500 then
    raise exception 'vendas invalidas';
  end if;
  if exists (select 1 from jsonb_array_elements(v_up) e
              where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') = '') then
    raise exception 'venda sem id';
  end if;

  insert into public.sales as s (tenant_id, id, data)
  select v_tenant, e->>'id', e
    from jsonb_array_elements(v_up) with ordinality as t(e, ord)
   order by t.ord
  on conflict (tenant_id, id) do update
    set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;

  update public.sales
     set deleted_at = now(), updated_at = now(), version = version + 1
   where tenant_id = v_tenant
     and deleted_at is null
     and id in (select jsonb_array_elements_text(v_del));

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'version', version, 'updated_at', updated_at)), '[]'::jsonb)
    into v_rows
    from public.sales
   where tenant_id = v_tenant
     and id in (select e->>'id' from jsonb_array_elements(v_up) e union select jsonb_array_elements_text(v_del));

  return jsonb_build_object('rows', v_rows, 'server_time', now());
end;
$function$;
revoke all on function public.sales_apply(jsonb, jsonb) from public, anon;
grant execute on function public.sales_apply(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- close_sale: agora na linha da venda (mesma assinatura e idempotência)
-- ---------------------------------------------------------------------
create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant text;
  v_result jsonb;
  v_current jsonb;
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

  select data into v_current
    from public.sales
   where tenant_id = v_tenant and id = p_sale_id and deleted_at is null
   for update;

  if p_existing then
    if v_current is null then
      raise exception 'venda % nao encontrada para atualizar', p_sale_id;
    end if;
    v_sale := v_current || p_sale_patch || jsonb_build_object('id', p_sale_id);
  else
    v_sale := p_sale_patch || jsonb_build_object('id', p_sale_id);
  end if;

  insert into public.sales as s (tenant_id, id, data)
  values (v_tenant, p_sale_id, v_sale)
  on conflict (tenant_id, id) do update
    set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;

  update public.sale_close_receipts
     set result = v_sale
   where tenant_id = v_tenant and sale_id = p_sale_id;

  return v_sale;
end;
$$;
revoke execute on function public.close_sale(text, boolean, jsonb) from public, anon;
grant execute on function public.close_sale(text, boolean, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Cópia do histórico (todas as vendas, na ordem do blob)
-- ---------------------------------------------------------------------
insert into public.sales (tenant_id, id, data)
select a.tenant_id, t.elem->>'id', t.elem
  from public.app_data a
  join public.tenant_owners o on o.tenant_id = a.tenant_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end)
       with ordinality as t(elem, ord)
 where a.key = 'cantina2:sales'
   and jsonb_typeof(t.elem) = 'object'
   and coalesce(t.elem->>'id', '') <> ''
 order by a.tenant_id, t.ord
on conflict (tenant_id, id) do nothing;

-- ---------------------------------------------------------------------
-- O blob antigo vira só leitura
-- ---------------------------------------------------------------------
create or replace function public.app_data_sales_somente_leitura()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.key = 'cantina2:sales' then
    raise exception 'as vendas agora ficam na tabela sales: recarregue a pagina para usar a versao nova'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_app_data_sales_somente_leitura on public.app_data;
create trigger trg_app_data_sales_somente_leitura
  before insert or update on public.app_data
  for each row execute function public.app_data_sales_somente_leitura();

-- =====================================================================
-- ROLLBACK (volta o site antigo a funcionar; as vendas novas ficam só na tabela)
-- =====================================================================
-- drop trigger if exists trg_app_data_sales_somente_leitura on public.app_data;
-- drop function if exists public.app_data_sales_somente_leitura();
-- Recolocar close_sale da 20261002000000 (seção 4).
-- Para devolver as vendas ao blob:
--   update public.app_data a set value = (select coalesce(jsonb_agg(s.data order by s.seq), '[]'::jsonb)
--     from public.sales s where s.tenant_id = a.tenant_id and s.deleted_at is null), updated_at = now()
--    where a.key = 'cantina2:sales';
-- drop function if exists public.sales_apply(jsonb, jsonb);
-- drop table if exists public.sales;
