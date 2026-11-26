-- WhatsApp no Commandah, etapa 4 (26/11/2026): fila "Não enviadas" do fiado automático.
-- Desenho: docs/superpowers/specs/2026-11-25-whatsapp-design.md ("whatsapp_envios").
--
-- Com "No fiado, mandar sozinho" ligado (Configurações › WhatsApp), o aparelho que fecha a comanda no fiado manda
-- a conta pelo WhatsApp do Commandah, e o que lança o pagamento que zera a conta manda "consumo liberado".
-- Quando o envio não dá (sem telefone, WhatsApp desconectado, erro), o fiado fecha do mesmo jeito e o aviso
-- fica aqui, para o caixa reenviar ou descartar na tela WhatsApp › Não enviadas.
-- O conteúdo não é guardado: o Reenviar monta a mensagem de novo com o saldo da hora (o Pix é do valor atual).
--
-- Ler, criar e resolver: dono, admin e caixa do próprio estabelecimento (RLS). Apagar: só a limpeza diária,
-- que tira as resolvidas com mais de 90 dias.

create table if not exists public.whatsapp_envios (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references public.tenant_owners(tenant_id) on delete cascade,
  member_id      text not null references public.members(id) on delete cascade,
  tipo           text not null check (tipo in ('cobranca', 'liberacao')),
  motivo         text not null check (length(motivo) between 1 and 300),
  criada_em      timestamptz not null default now(),
  criada_por     text check (length(criada_por) <= 120),
  tentativas     int  not null default 1 check (tentativas between 1 and 1000),
  resolvida_em   timestamptz,
  resolvida_por  text check (length(resolvida_por) <= 120),
  resolucao      text check (resolucao in ('enviada', 'descartada'))
);
create index if not exists idx_whatsapp_envios_abertas on public.whatsapp_envios (tenant_id, criada_em desc) where resolvida_em is null;

alter table public.whatsapp_envios enable row level security;
revoke all on public.whatsapp_envios from public, anon, authenticated;
grant select, insert, update on public.whatsapp_envios to authenticated;
grant select, insert, update, delete on public.whatsapp_envios to service_role;

drop policy if exists whatsapp_envios_ler on public.whatsapp_envios;
create policy whatsapp_envios_ler on public.whatsapp_envios
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_staff_role()) in ('owner', 'admin', 'caixa'));

drop policy if exists whatsapp_envios_criar on public.whatsapp_envios;
create policy whatsapp_envios_criar on public.whatsapp_envios
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_staff_role()) in ('owner', 'admin', 'caixa')
              and resolvida_em is null);

drop policy if exists whatsapp_envios_resolver on public.whatsapp_envios;
create policy whatsapp_envios_resolver on public.whatsapp_envios
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_staff_role()) in ('owner', 'admin', 'caixa'))
  with check (tenant_id = (select public.current_tenant_id()));

create or replace function public.whatsapp_limpar_envios()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.whatsapp_envios where resolvida_em is not null and resolvida_em < now() - interval '90 days';
$$;
revoke all on function public.whatsapp_limpar_envios() from public, anon, authenticated;
grant execute on function public.whatsapp_limpar_envios() to service_role;

-- Agendamento diário às 07:40 UTC. Banco local não tem pg_cron: só avisa.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    execute $q$select cron.schedule('whatsapp-limpar-envios', '40 7 * * *', 'select public.whatsapp_limpar_envios()')$q$;
  else
    raise notice 'pg_cron indisponivel: limpeza dos envios nao agendada (banco local)';
  end if;
end
$$;

-- ROLLBACK (manual):
--   select cron.unschedule('whatsapp-limpar-envios');
--   drop function if exists public.whatsapp_limpar_envios();
--   drop table if exists public.whatsapp_envios;
