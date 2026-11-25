-- WhatsApp no Commandah, etapa 2 (25/11/2026): conversas e mensagens.
-- Desenho: docs/superpowers/specs/2026-11-25-whatsapp-design.md; plano: docs/superpowers/plans/2026-11-25-whatsapp-etapa2.md.
--
-- whatsapp_mensagens: cada mensagem que entra ou sai pelo número do estabelecimento. Quem grava é só a função
--   whatsapp (service role), pelo webhook da Evolution ou ao enviar. evo_id é o id da Evolution: a Evolution
--   reenvia webhooks, então a gravação é idempotente por (tenant_id, evo_id).
-- whatsapp_conversas: resumo por contato (jid) para a lista da tela: última mensagem, não lidas e o cliente ligado.
--
-- Ler: dono, admin e caixa do próprio estabelecimento (RLS). Marcar lida e ligar ao cliente: RPCs abaixo.
-- Foto/PDF não são copiados para cá: a função busca na Evolution quando alguém abre.
-- Mensagens com mais de 90 dias são apagadas todo dia (pg_cron), como os dados dos sócios na LGPD.

create table if not exists public.whatsapp_conversas (
  tenant_id       text not null references public.tenant_owners(tenant_id) on delete cascade,
  jid             text not null,
  telefone        text,
  nome_contato    text,
  member_id       text references public.members(id) on delete set null,
  nao_lidas       int  not null default 0,
  ultima_texto    text,
  ultima_em       timestamptz,
  ultima_direcao  text check (ultima_direcao in ('entrada', 'saida')),
  constraint whatsapp_conversas_pkey primary key (tenant_id, jid)
);
create index if not exists idx_whatsapp_conversas_ultima on public.whatsapp_conversas (tenant_id, ultima_em desc);

create table if not exists public.whatsapp_mensagens (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references public.tenant_owners(tenant_id) on delete cascade,
  jid           text not null,
  evo_id        text not null,
  direcao       text not null check (direcao in ('entrada', 'saida')),
  tipo          text not null default 'texto' check (tipo in ('texto', 'imagem', 'documento', 'audio', 'outro')),
  texto         text,
  arquivo_nome  text,
  mime          text,
  enviada_por   text,
  situacao      text check (situacao in ('enviada', 'entregue', 'lida', 'erro')),
  criada_em     timestamptz not null default now(),
  constraint whatsapp_mensagens_evo_unico unique (tenant_id, evo_id)
);
create index if not exists idx_whatsapp_mensagens_conversa on public.whatsapp_mensagens (tenant_id, jid, criada_em desc);

alter table public.whatsapp_conversas enable row level security;
alter table public.whatsapp_mensagens enable row level security;
revoke all on public.whatsapp_conversas from public, anon, authenticated;
revoke all on public.whatsapp_mensagens from public, anon, authenticated;
grant select on public.whatsapp_conversas to authenticated;
grant select on public.whatsapp_mensagens to authenticated;
grant select, insert, update, delete on public.whatsapp_conversas to service_role;
grant select, insert, update, delete on public.whatsapp_mensagens to service_role;

drop policy if exists whatsapp_conversas_ler on public.whatsapp_conversas;
create policy whatsapp_conversas_ler on public.whatsapp_conversas
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_staff_role()) in ('owner', 'admin', 'caixa'));

drop policy if exists whatsapp_mensagens_ler on public.whatsapp_mensagens;
create policy whatsapp_mensagens_ler on public.whatsapp_mensagens
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_staff_role()) in ('owner', 'admin', 'caixa'));

-- Telefone para comparar: só dígitos, sem o 55 do país; fica DDD (2) + últimos 8 dígitos.
-- Os últimos 8 cobrem o número antigo sem o 9º dígito (WhatsApp ainda usa jid assim para alguns números).
create or replace function public.whatsapp_chave_telefone(p_tel text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when length(d) >= 10 then left(d, 2) || right(d, 8) end
    from (select case when length(x) >= 12 and left(x, 2) = '55' then substr(x, 3) else x end d
            from (select regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') x) a) b;
$$;

create or replace function public.whatsapp_registrar_mensagem(
  p_tenant text, p_jid text, p_telefone text, p_nome text, p_evo_id text, p_direcao text, p_tipo text,
  p_texto text, p_arquivo text, p_mime text, p_enviada_por text, p_criada_em timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_quando timestamptz := coalesce(p_criada_em, now());
  v_chave text := public.whatsapp_chave_telefone(p_telefone);
  v_member text;
  v_resumo text := coalesce(nullif(p_texto, ''),
                     case p_tipo when 'imagem' then 'Foto' when 'documento' then coalesce(p_arquivo, 'Documento')
                                 when 'audio' then 'Áudio' else 'Mensagem' end);
begin
  insert into public.whatsapp_mensagens (tenant_id, jid, evo_id, direcao, tipo, texto, arquivo_nome, mime, enviada_por, situacao, criada_em)
  values (p_tenant, p_jid, p_evo_id, p_direcao, coalesce(p_tipo, 'texto'), p_texto, p_arquivo, p_mime, p_enviada_por,
          case when p_direcao = 'saida' then 'enviada' end, v_quando)
  on conflict (tenant_id, evo_id) do nothing
  returning id into v_id;
  if v_id is null then
    return false; -- repetida: a Evolution reenviou o webhook
  end if;

  insert into public.whatsapp_conversas (tenant_id, jid, telefone, nome_contato, nao_lidas, ultima_texto, ultima_em, ultima_direcao)
  values (p_tenant, p_jid, p_telefone, case when p_direcao = 'entrada' then nullif(p_nome, '') end,
          case when p_direcao = 'entrada' then 1 else 0 end, v_resumo, v_quando, p_direcao)
  on conflict (tenant_id, jid) do update set
    telefone       = coalesce(excluded.telefone, whatsapp_conversas.telefone),
    nome_contato   = coalesce(excluded.nome_contato, whatsapp_conversas.nome_contato),
    -- Respondeu (pelo Commandah ou pelo celular da lanchonete) = leu, como no próprio WhatsApp.
    -- Saída atrasada (mais antiga que a última mensagem) não zera.
    nao_lidas      = case when p_direcao = 'saida'
                           and (whatsapp_conversas.ultima_em is null or v_quando >= whatsapp_conversas.ultima_em)
                          then 0 else whatsapp_conversas.nao_lidas + excluded.nao_lidas end,
    ultima_texto   = case when whatsapp_conversas.ultima_em is null or v_quando >= whatsapp_conversas.ultima_em
                          then excluded.ultima_texto else whatsapp_conversas.ultima_texto end,
    ultima_direcao = case when whatsapp_conversas.ultima_em is null or v_quando >= whatsapp_conversas.ultima_em
                          then excluded.ultima_direcao else whatsapp_conversas.ultima_direcao end,
    ultima_em      = greatest(whatsapp_conversas.ultima_em, v_quando);

  -- Liga ao cliente pelo telefone só se ainda não está ligado e houver exatamente um cliente ativo igual.
  if v_chave is not null and exists (select 1 from public.whatsapp_conversas
                                      where tenant_id = p_tenant and jid = p_jid and member_id is null) then
    select min(m.id) into v_member
      from public.members m
     where m.tenant_id = p_tenant and m.active and not m.archived and m.anonymized_at is null
       and public.whatsapp_chave_telefone(m.phone) = v_chave
    having count(*) = 1;
    if v_member is not null then
      update public.whatsapp_conversas set member_id = v_member where tenant_id = p_tenant and jid = p_jid;
    end if;
  end if;
  return true;
end;
$$;

-- Situação da mensagem enviada. Não volta para trás (o webhook pode chegar fora de ordem).
create or replace function public.whatsapp_atualizar_situacao(p_tenant text, p_evo_id text, p_situacao text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.whatsapp_mensagens
     set situacao = p_situacao
   where tenant_id = p_tenant and evo_id = p_evo_id
     and (p_situacao = 'erro'
          or array_position(array['enviada', 'entregue', 'lida'], p_situacao)
             > coalesce(array_position(array['enviada', 'entregue', 'lida'], situacao), 0));
$$;

-- Quem pode ler (dono, admin, caixa) marca a conversa como lida e liga ao cliente.
create or replace function public.whatsapp_marcar_lida(p_jid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
begin
  if v_tenant is null or coalesce(public.current_staff_role(), '') not in ('owner', 'admin', 'caixa') then
    raise exception 'Sem permissão para o WhatsApp' using errcode = '42501';
  end if;
  update public.whatsapp_conversas set nao_lidas = 0 where tenant_id = v_tenant and jid = p_jid;
end;
$$;

create or replace function public.whatsapp_vincular_cliente(p_jid text, p_member_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
begin
  if v_tenant is null or coalesce(public.current_staff_role(), '') not in ('owner', 'admin', 'caixa') then
    raise exception 'Sem permissão para o WhatsApp' using errcode = '42501';
  end if;
  if p_member_id is not null and not exists (select 1 from public.members where id = p_member_id and tenant_id = v_tenant) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  update public.whatsapp_conversas set member_id = p_member_id where tenant_id = v_tenant and jid = p_jid;
end;
$$;

-- Limpeza diária: mensagens com mais de 90 dias. Conversa sem mensagem nenhuma também sai.
create or replace function public.whatsapp_limpar_antigas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.whatsapp_mensagens where criada_em < now() - interval '90 days';
  get diagnostics v_n = row_count;
  delete from public.whatsapp_conversas c
   where c.ultima_em < now() - interval '90 days'
     and not exists (select 1 from public.whatsapp_mensagens m where m.tenant_id = c.tenant_id and m.jid = c.jid);
  return v_n;
end;
$$;

revoke all on function public.whatsapp_chave_telefone(text) from public, anon, authenticated;
revoke all on function public.whatsapp_registrar_mensagem(text, text, text, text, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.whatsapp_atualizar_situacao(text, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_marcar_lida(text) from public, anon;
revoke all on function public.whatsapp_vincular_cliente(text, text) from public, anon;
revoke all on function public.whatsapp_limpar_antigas() from public, anon, authenticated;
grant execute on function public.whatsapp_chave_telefone(text) to service_role;
grant execute on function public.whatsapp_registrar_mensagem(text, text, text, text, text, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.whatsapp_atualizar_situacao(text, text, text) to service_role;
grant execute on function public.whatsapp_marcar_lida(text) to authenticated, service_role;
grant execute on function public.whatsapp_vincular_cliente(text, text) to authenticated, service_role;
grant execute on function public.whatsapp_limpar_antigas() to service_role;

-- Agendamento diário às 07:30 UTC. Banco local não tem pg_cron: só avisa.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    execute $q$select cron.schedule('whatsapp-limpar-antigas', '30 7 * * *', 'select public.whatsapp_limpar_antigas()')$q$;
  else
    raise notice 'pg_cron indisponivel: limpeza do WhatsApp nao agendada (banco local)';
  end if;
end
$$;

-- ROLLBACK (manual):
--   select cron.unschedule('whatsapp-limpar-antigas');
--   drop function if exists public.whatsapp_limpar_antigas(), public.whatsapp_vincular_cliente(text, text),
--     public.whatsapp_marcar_lida(text), public.whatsapp_atualizar_situacao(text, text, text),
--     public.whatsapp_registrar_mensagem(text, text, text, text, text, text, text, text, text, text, text, timestamptz),
--     public.whatsapp_chave_telefone(text);
--   drop table if exists public.whatsapp_mensagens, public.whatsapp_conversas;
