-- =====================================================================
-- 20261114000000 — cadastro de estabelecimento só com código de convite (fase 1)
-- =====================================================================
-- Auditoria de lançamento 11/11, A1 (alto): qualquer pessoa na internet criava um
-- estabelecimento pelo botão "Criar novo estabelecimento". O navegador escolhia o
-- tenant_id e inseria direto em tenant_owners (policy insert_own_tenant_mapping), sem
-- aprovação, pagamento ou cota; app_data não tinha limite de tamanho.
--
-- Agora (pedido do dono, 11/11): quem paga recebe um código de convite e cria o
-- próprio estabelecimento com ele. Fase 1: o pagamento é manual e a equipe do
-- Commandah gera o código pelo CLI (convite_criar). Fase 2 ligará a plataforma de
-- cobrança, que vai gerar o código sozinha.
--
--   * convites: guarda só o sha256 do código (o código em si aparece uma vez, na
--     saída de convite_criar) e os 4 últimos caracteres para conferência.
--   * assinaturas: uma linha por estabelecimento. O Clube Olímpico fica 'isento'.
--     A fase 1 só registra; ninguém é bloqueado por situação ainda.
--   * cadastro_por_convite: usada só pela Edge Function "cadastro" (service_role).
--     Consome o convite com trava, gera o tenant_id no servidor e cria o dono.
--   * tenant_owners deixa de aceitar INSERT pelo navegador.
--   * app_data.value ganha teto de 10 MB (o maior valor hoje tem ~1,2 MB).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------
create table if not exists public.convites (
  codigo_hash   bytea primary key,
  codigo_final  text not null,
  plano         text not null default 'padrao',
  obs           text,
  criado_em     timestamptz not null default now(),
  vence_em      timestamptz not null,
  usado_em      timestamptz,
  usado_por     uuid,
  tenant_id     text,
  cancelado_em  timestamptz
);
alter table public.convites enable row level security;
revoke all on public.convites from public, anon, authenticated;
grant select, insert, update on public.convites to service_role;

-- ---------------------------------------------------------------------
-- Assinaturas
-- ---------------------------------------------------------------------
create table if not exists public.assinaturas (
  tenant_id     text primary key references public.tenant_owners(tenant_id) on delete cascade,
  plano         text not null default 'padrao',
  situacao      text not null default 'ativa'
                check (situacao in ('isento', 'teste', 'ativa', 'atrasada', 'suspensa', 'cancelada')),
  vence_em      date,
  obs           text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.assinaturas enable row level security;
revoke all on public.assinaturas from public, anon, authenticated;
grant select, insert, update on public.assinaturas to service_role;

insert into public.assinaturas (tenant_id, plano, situacao, obs)
select tenant_id,
       case when tenant_id = 'clube-olimpico-maringa-y8mt' then 'isento' else 'teste' end,
       case when tenant_id = 'clube-olimpico-maringa-y8mt' then 'isento' else 'teste' end,
       'migração 20261114000000'
from public.tenant_owners
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------
-- Código: 12 caracteres sem 0/O/1/I (60 bits), mostrado como XXXX-XXXX-XXXX.
-- Normalizar: maiúsculas, sem espaço nem hífen.
-- ---------------------------------------------------------------------
create or replace function public.convite_normalizar(p_codigo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g');
$$;
revoke all on function public.convite_normalizar(text) from public, anon, authenticated;
grant execute on function public.convite_normalizar(text) to service_role;

-- Gera um convite. Só pelo CLI (postgres): nem a service_role chama.
--   select public.convite_criar('padrao', 30, 'Bar do Zé — Pix 11/11');
create or replace function public.convite_criar(
  p_plano text default 'padrao',
  p_dias  integer default 30,
  p_obs   text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- 32 símbolos
  b bytea;
  cod text;
  i int;
begin
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'p_dias deve ficar entre 1 e 365';
  end if;
  loop
    -- uuid v4: bytes 6 e 8 têm bits fixos de versão/variante; pulamos o 6 e o 8.
    b := uuid_send(gen_random_uuid());
    cod := '';
    foreach i in array array[0,1,2,3,4,5,7,9,10,11,12,13] loop
      cod := cod || substr(alfabeto, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.convites where codigo_hash = sha256(convert_to(cod, 'UTF8')));
  end loop;
  insert into public.convites (codigo_hash, codigo_final, plano, obs, vence_em)
  values (sha256(convert_to(cod, 'UTF8')), right(cod, 4), coalesce(nullif(trim(p_plano), ''), 'padrao'),
          nullif(trim(coalesce(p_obs, '')), ''), now() + make_interval(days => p_dias));
  return substr(cod, 1, 4) || '-' || substr(cod, 5, 4) || '-' || substr(cod, 9, 4);
end;
$$;
revoke all on function public.convite_criar(text, integer, text) from public, anon, authenticated, service_role;

-- Confere o código sem consumir (a função "cadastro" chama antes de criar a conta).
create or replace function public.convite_valido(p_codigo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.convites
    where codigo_hash = sha256(convert_to(public.convite_normalizar(p_codigo), 'UTF8'))
      and usado_em is null and cancelado_em is null and vence_em > now()
  );
$$;
revoke all on function public.convite_valido(text) from public, anon, authenticated;
grant execute on function public.convite_valido(text) to service_role;

-- Cria o estabelecimento consumindo o convite. Erros com prefixo conhecido para a
-- função "cadastro" traduzir: CONVITE_INVALIDO, JA_TEM_ESTABELECIMENTO, NOME_INVALIDO.
create or replace function public.cadastro_por_convite(p_user uuid, p_codigo text, p_nome text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := sha256(convert_to(public.convite_normalizar(p_codigo), 'UTF8'));
  v_conv public.convites%rowtype;
  v_nome text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_slug text;
  v_tenant text;
  alfabeto constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  b bytea;
  i int;
begin
  if p_user is null then raise exception 'CONVITE_INVALIDO: usuário ausente'; end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then
    raise exception 'NOME_INVALIDO: o nome precisa ter de 2 a 80 caracteres';
  end if;

  select * into v_conv from public.convites where codigo_hash = v_hash for update;
  if not found or v_conv.usado_em is not null or v_conv.cancelado_em is not null or v_conv.vence_em <= now() then
    raise exception 'CONVITE_INVALIDO: código inválido, vencido ou já usado';
  end if;
  if exists (select 1 from public.tenant_owners where user_id = p_user)
     or exists (select 1 from public.tenant_staff where auth_user_id = p_user) then
    raise exception 'JA_TEM_ESTABELECIMENTO: esta conta já pertence a um estabelecimento';
  end if;

  -- tenant_id gerado aqui (antes era o navegador): slug do nome + 6 caracteres.
  v_slug := lower(translate(v_nome,
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
  v_slug := trim(both '-' from regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from left(v_slug, 40));
  if v_slug = '' then v_slug := 'estabelecimento'; end if;
  loop
    b := uuid_send(gen_random_uuid());
    v_tenant := v_slug || '-';
    foreach i in array array[0,1,2,3,4,5] loop
      v_tenant := v_tenant || substr(alfabeto, (get_byte(b, i) % 31) + 1, 1);
    end loop;
    -- Auditoria M3: nunca reaproveitar um tenant_id que ainda tenha dados soltos.
    exit when not exists (select 1 from public.tenant_owners where tenant_id = v_tenant)
          and not exists (select 1 from public.app_data where tenant_id = v_tenant)
          and not exists (select 1 from public.tenant_staff where tenant_id = v_tenant);
  end loop;

  insert into public.tenant_owners (user_id, tenant_id, business_name) values (p_user, v_tenant, v_nome);
  insert into public.assinaturas (tenant_id, plano, situacao, vence_em, obs)
  values (v_tenant, v_conv.plano, 'ativa', current_date + 30, 'convite ••••' || v_conv.codigo_final);
  update public.convites set usado_em = now(), usado_por = p_user, tenant_id = v_tenant where codigo_hash = v_hash;
  return v_tenant;
end;
$$;
revoke all on function public.cadastro_por_convite(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cadastro_por_convite(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- tenant_owners: o navegador não cria mais estabelecimento.
-- ---------------------------------------------------------------------
drop policy if exists insert_own_tenant_mapping on public.tenant_owners;
revoke insert, update, delete on public.tenant_owners from anon, authenticated;

-- ---------------------------------------------------------------------
-- app_data: teto por valor (o maior hoje tem ~1,2 MB).
-- ---------------------------------------------------------------------
alter table public.app_data drop constraint if exists app_data_value_tamanho;
alter table public.app_data add constraint app_data_value_tamanho
  check (pg_column_size(value) < 10 * 1024 * 1024);

commit;

-- =====================================================================
-- ROLLBACK (antes, volte o site e apague a função "cadastro")
-- =====================================================================
-- alter table public.app_data drop constraint if exists app_data_value_tamanho;
-- create policy insert_own_tenant_mapping on public.tenant_owners for insert to public with check (auth.uid() = user_id);
-- grant insert on public.tenant_owners to anon, authenticated;
-- drop function if exists public.cadastro_por_convite(uuid, text, text);
-- drop function if exists public.convite_valido(text);
-- drop function if exists public.convite_criar(text, integer, text);
-- drop function if exists public.convite_normalizar(text);
-- drop table if exists public.assinaturas;
-- drop table if exists public.convites;
