-- =====================================================================
-- 11/11/2026 (auditoria de lançamento, achado crítico): emissor de NFC-e por estabelecimento
--
-- Antes, a Edge Function "nfce" usava um token único da Brasil NFe (secret BRASILNFE_TOKEN,
-- o da lanchonete do clube) e aceitava o dono de QUALQUER estabelecimento. Um cadastro novo
-- emitia notas de homologação na conta do clube e, com o secret NFCE_PRODUCAO ligado, emitiria
-- nota real no CNPJ do clube.
--
-- Agora cada estabelecimento tem a própria linha em nfce_emissores:
--   - token_secret_id: o token da conta do estabelecimento na Brasil NFe, guardado cifrado no
--     Supabase Vault. O dono cadastra pela tela (Configurações › NFC-e) por meio da função
--     "nfce"; o token nunca volta para o navegador, só os 4 últimos caracteres (token_final).
--   - usa_token_do_servidor: transição. Só o clube, que já usa o BRASILNFE_TOKEN, tem true.
--     Some quando o dono do clube cadastrar o token pela tela.
--   - producao_liberada: segunda trava da nota de verdade, POR ESTABELECIMENTO. Só a equipe do
--     Commandah liga (função nfce_liberar_producao, rodada pelo CLI, nunca pelo site), depois de
--     conferir série, CSC e códigos fiscais com o contador do cliente. A primeira trava continua
--     sendo settings.nfce.ambiente = 1, escolhida pelo dono na tela.
-- Sem linha (ou sem token), o estabelecimento não emite nada, nem em homologação.
--
-- Tudo aqui é só da service_role (a Edge Function) e do postgres (CLI). Nenhuma policy.
-- =====================================================================

create table if not exists public.nfce_emissores (
  tenant_id             text        not null,
  token_secret_id       uuid,
  token_final           text,
  usa_token_do_servidor boolean     not null default false,
  producao_liberada     boolean     not null default false,
  producao_obs          text,
  producao_alterada_em  timestamptz,
  atualizado_em         timestamptz not null default now(),
  atualizado_por        text,
  constraint nfce_emissores_pkey primary key (tenant_id),
  constraint nfce_emissores_tenant_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade
);

alter table public.nfce_emissores enable row level security;
revoke all on table public.nfce_emissores from public, anon, authenticated;
grant all on table public.nfce_emissores to service_role;

-- ---------------------------------------------------------------------
-- Leitura do emissor (só a Edge Function). Devolve o token decifrado.
-- ---------------------------------------------------------------------
create or replace function public.nfce_emissor_ler(p_tenant text)
returns table (token text, usa_token_do_servidor boolean, producao_liberada boolean, token_final text)
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret, e.usa_token_do_servidor, e.producao_liberada, e.token_final
  from public.nfce_emissores e
  left join vault.decrypted_secrets ds on ds.id = e.token_secret_id
  where e.tenant_id = p_tenant;
$$;

-- ---------------------------------------------------------------------
-- Grava (ou troca) o token do estabelecimento no Vault. Chamada pela Edge Function depois
-- de conferir que quem pediu é o dono do estabelecimento.
-- ---------------------------------------------------------------------
create or replace function public.nfce_emissor_salvar_token(p_tenant text, p_token text, p_por text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token  text := btrim(coalesce(p_token, ''));
  v_id     uuid;
  v_nome   text := 'nfce_token:' || p_tenant;
begin
  -- O formato do token é da Brasil NFe: aceita qualquer texto visível, sem espaço.
  -- (regex do Postgres só repete até 255; o tamanho vai à parte)
  if v_token !~ '^[[:graph:]]+$' or length(v_token) not between 8 and 512 then
    raise exception 'token inválido';
  end if;
  if not exists (select 1 from public.tenant_owners where tenant_id = p_tenant) then
    raise exception 'estabelecimento inexistente';
  end if;

  select e.token_secret_id into v_id from public.nfce_emissores e where e.tenant_id = p_tenant;
  -- Segredo com o mesmo nome que ficou sem dono (linha apagada): reaproveita.
  if v_id is null then
    select s.id into v_id from vault.secrets s where s.name = v_nome;
  end if;

  if v_id is null then
    v_id := vault.create_secret(v_token, v_nome, 'Token da Brasil NFe do estabelecimento ' || p_tenant);
  else
    perform vault.update_secret(v_id, v_token);
  end if;

  insert into public.nfce_emissores (tenant_id, token_secret_id, token_final, usa_token_do_servidor, atualizado_em, atualizado_por)
  values (p_tenant, v_id, right(v_token, 4), false, now(), left(p_por, 120))
  on conflict (tenant_id) do update
    set token_secret_id = excluded.token_secret_id,
        token_final = excluded.token_final,
        usa_token_do_servidor = false,
        atualizado_em = now(),
        atualizado_por = excluded.atualizado_por;
end;
$$;

-- ---------------------------------------------------------------------
-- Apaga o token do estabelecimento (troca de conta na Brasil NFe, fim do contrato).
-- A liberação de produção continua como estava: vale para o estabelecimento, não para o token.
-- ---------------------------------------------------------------------
create or replace function public.nfce_emissor_remover_token(p_tenant text, p_por text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select e.token_secret_id into v_id from public.nfce_emissores e where e.tenant_id = p_tenant;
  update public.nfce_emissores
     set token_secret_id = null, token_final = null, usa_token_do_servidor = false,
         atualizado_em = now(), atualizado_por = left(p_por, 120)
   where tenant_id = p_tenant;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Liberação da nota de verdade (produção) de UM estabelecimento. Só pelo CLI (postgres):
--   select public.nfce_liberar_producao('<tenant_id>', true, 'conferido com o contador em dd/mm');
-- A data e a observação ficam na linha do estabelecimento (producao_alterada_em, producao_obs).
-- ---------------------------------------------------------------------
create or replace function public.nfce_liberar_producao(p_tenant text, p_liberar boolean, p_obs text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tenant_owners where tenant_id = p_tenant) then
    raise exception 'estabelecimento inexistente: %', p_tenant;
  end if;
  insert into public.nfce_emissores (tenant_id, producao_liberada, producao_obs, producao_alterada_em, atualizado_em, atualizado_por)
  values (p_tenant, p_liberar, left(p_obs, 500), now(), now(), 'Equipe Commandah')
  on conflict (tenant_id) do update
    set producao_liberada = excluded.producao_liberada,
        producao_obs = excluded.producao_obs,
        producao_alterada_em = now(),
        atualizado_em = now(),
        atualizado_por = 'Equipe Commandah';
  -- Sem audit_log aqui: o carimbo do audit_log (audit_log_stamp) recusa gravação do CLI, que não
  -- tem tenant nem papel. O registro fica em producao_obs/producao_alterada_em e a tela mostra.
end;
$$;

revoke all on function public.nfce_emissor_ler(text) from public, anon, authenticated;
revoke all on function public.nfce_emissor_salvar_token(text, text, text) from public, anon, authenticated;
revoke all on function public.nfce_emissor_remover_token(text, text) from public, anon, authenticated;
revoke all on function public.nfce_liberar_producao(text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.nfce_emissor_ler(text) to service_role;
grant execute on function public.nfce_emissor_salvar_token(text, text, text) to service_role;
grant execute on function public.nfce_emissor_remover_token(text, text) to service_role;

-- ---------------------------------------------------------------------
-- Transição: o clube continua emitindo (homologação) com o token do servidor até o dono
-- cadastrar o token pela tela. Produção NÃO é liberada aqui.
-- ---------------------------------------------------------------------
insert into public.nfce_emissores (tenant_id, usa_token_do_servidor, atualizado_por)
select tenant_id, true, 'migração 20261113000000'
from public.tenant_owners
where tenant_id = 'clube-olimpico-maringa-y8mt'
on conflict (tenant_id) do nothing;

-- =====================================================================
-- ROLLBACK (antes, volte a Edge Function "nfce" para a versão anterior)
-- =====================================================================
-- delete from vault.secrets where name like 'nfce_token:%';
-- drop function if exists public.nfce_liberar_producao(text, boolean, text);
-- drop function if exists public.nfce_emissor_remover_token(text, text);
-- drop function if exists public.nfce_emissor_salvar_token(text, text, text);
-- drop function if exists public.nfce_emissor_ler(text);
-- drop table if exists public.nfce_emissores;
