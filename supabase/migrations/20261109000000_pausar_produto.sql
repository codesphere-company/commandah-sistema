-- =====================================================================
-- 20261109000000_pausar_produto.sql — Parte B dos perfis novos
-- 08/11 (pedido do dono): Caixa e Cozinha pausam produto
-- =====================================================================
-- O PROBLEMA
-- ----------
-- Quando acaba um item no meio do expediente, só o administrador conseguia
-- tirá-lo de venda: o cadastro de produtos (cantina2:products) é um blob da
-- classe 'catalogo', que a RLS deixa gravar só para dono/admin. Abrir essa
-- escrita para caixa/cozinha deixaria mudar preço, nome ou cadastro inteiro
-- ("Não pode acontecer" da spec).
--
-- A SOLUCAO
-- ---------
-- 1. product_set_active(p_product_id, p_active): SECURITY DEFINER, permitida a
--    dono/admin/caixa/cozinha (garçom e sem papel: recusa). Trava a linha do
--    blob, troca SÓ o campo "active" do item com esse id e grava um registro no
--    audit_log ("Produto pausado: <nome>" / "Produto ativado: <nome>"). A RLS do
--    catálogo continua igual: update direto no blob segue recusado a caixa/cozinha.
--    Como a RPC lê o blob ATUAL do servidor (e não a cópia do aparelho), a edição
--    que o admin gravou antes da pausa não se perde.
-- 2. app_data.version: número que sobe em TODA gravação da linha (trigger), por
--    qualquer caminho (site, RPC). A RPC devolve a versão nova: {ok, version}.
--    É o que o front usa para saber que o blob mudou desde a sua leitura.
--    Coluna com default constante: no Postgres 11+ não regrava a tabela.
--
-- RETESTE: logar como cozinha, pausar um produto -> some da venda; logar como
-- caixa, ativar de novo; pelo console, como caixa, tentar update direto em
-- app_data de cantina2:products -> nada muda; Logs (admin) mostra as duas ações.
-- =====================================================================

alter table public.app_data add column if not exists version bigint not null default 1;

create or replace function public.app_data_bump_version()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$function$;
revoke all on function public.app_data_bump_version() from public, anon;

drop trigger if exists trg_app_data_bump_version on public.app_data;
create trigger trg_app_data_bump_version
  before update on public.app_data
  for each row execute function public.app_data_bump_version();

create or replace function public.product_set_active(p_product_id text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_role text := public.current_staff_role();
  v_list jsonb;
  v_version bigint;
  v_item jsonb;
  v_ord bigint;
  v_name text;
  v_actor text;
begin
  if v_tenant is null or v_role is null or v_role not in ('owner', 'admin', 'caixa', 'cozinha') then
    raise exception 'sem permissao para pausar produto' using errcode = '42501';
  end if;
  if coalesce(p_product_id, '') = '' or p_active is null then
    raise exception 'produto invalido';
  end if;

  select value, version into v_list, v_version
    from public.app_data
   where tenant_id = v_tenant and key = 'cantina2:products'
   for update;

  if jsonb_typeof(v_list) = 'array' then
    select m.elem, m.ord into v_item, v_ord
      from jsonb_array_elements(v_list) with ordinality as m(elem, ord)
     where jsonb_typeof(m.elem) = 'object' and m.elem->>'id' = p_product_id
     limit 1;
  end if;
  if v_item is null then
    raise exception 'produto nao encontrado';
  end if;

  -- Já está como pedido (produto sem "active" conta como à venda, igual ao site):
  -- não grava nem registra de novo.
  if (v_item->'active' is distinct from 'false'::jsonb) = p_active then
    return jsonb_build_object('ok', true, 'version', v_version);
  end if;

  v_list := jsonb_set(v_list, array[(v_ord - 1)::text], v_item || jsonb_build_object('active', p_active));

  update public.app_data set value = v_list, updated_at = now()
   where tenant_id = v_tenant and key = 'cantina2:products'
  returning version into v_version;

  -- Nome de quem fez: o do colaborador no cadastro (o dono não tem linha em tenant_staff).
  select u->>'name' into v_actor
    from public.tenant_staff s
    join public.app_data d on d.tenant_id = s.tenant_id and d.key = 'cantina2:users'
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) u
   where s.auth_user_id = auth.uid() and s.tenant_id = v_tenant and u->>'id' = s.id
   limit 1;

  v_name := coalesce(nullif(v_item->>'name', ''), p_product_id);
  insert into public.audit_log (actor_name, action, entity, entity_id, meta)
  values (nullif(left(coalesce(v_actor, ''), 120), ''),
          left(case when p_active then 'Produto ativado: ' else 'Produto pausado: ' end || v_name, 300),
          'product', p_product_id, jsonb_build_object('active', p_active, 'version', v_version));

  return jsonb_build_object('ok', true, 'version', v_version);
end;
$function$;
revoke all on function public.product_set_active(text, boolean) from public, anon;
grant execute on function public.product_set_active(text, boolean) to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.product_set_active(text, boolean);
-- drop trigger if exists trg_app_data_bump_version on public.app_data;
-- drop function if exists public.app_data_bump_version();
-- alter table public.app_data drop column if exists version;
