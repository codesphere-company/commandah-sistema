-- WhatsApp no Commandah, etapa 1 (25/11/2026, pedido do dono; desenho em
-- docs/superpowers/specs/2026-11-25-whatsapp-design.md).
--
-- whatsapp_instancias: situação da conexão de cada estabelecimento com a Evolution API
-- (uma instância por tenant_id). Só a função whatsapp (service role) lê e grava: o app pergunta
-- a situação pela função, então não há policy para authenticated/anon. O segredo do webhook
-- vai na URL que a Evolution chama (ela não assina o webhook) e nunca sai do servidor.
--
-- Plano Pro: 'pro' ou 'isento' (o clube é isento desde 14/11 e tem tudo), com a assinatura
-- não suspensa nem cancelada. 'teste' e 'padrao' não têm WhatsApp.

create table if not exists public.whatsapp_instancias (
  tenant_id        text primary key references public.tenant_owners(tenant_id) on delete cascade,
  situacao         text not null default 'desconectado'
                   check (situacao in ('desconectado', 'aguardando_qr', 'conectado')),
  numero           text,
  qr               text,
  webhook_segredo  text not null,
  atualizado_em    timestamptz not null default now()
);
alter table public.whatsapp_instancias enable row level security;
revoke all on public.whatsapp_instancias from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_instancias to service_role;

create or replace function public.whatsapp_plano_pro(p_tenant text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select a.plano in ('pro', 'isento') and a.situacao not in ('suspensa', 'cancelada')
      from public.assinaturas a
     where a.tenant_id = p_tenant
  ), false);
$$;

-- Segredo de 64 hex com gen_random_uuid (núcleo do Postgres, sem depender do pgcrypto).
create or replace function public.whatsapp_instancia_preparar(p_tenant text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_segredo text;
begin
  insert into public.whatsapp_instancias (tenant_id, webhook_segredo)
  values (p_tenant, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  on conflict (tenant_id) do nothing;
  select webhook_segredo into v_segredo from public.whatsapp_instancias where tenant_id = p_tenant;
  return v_segredo;
end;
$$;

create or replace function public.whatsapp_instancia_atualizar(p_tenant text, p_situacao text, p_numero text, p_qr text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.whatsapp_instancias
     set situacao = p_situacao, numero = p_numero, qr = p_qr, atualizado_em = now()
   where tenant_id = p_tenant;
$$;

revoke all on function public.whatsapp_plano_pro(text) from public, anon, authenticated;
revoke all on function public.whatsapp_instancia_preparar(text) from public, anon, authenticated;
revoke all on function public.whatsapp_instancia_atualizar(text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_plano_pro(text) to service_role;
grant execute on function public.whatsapp_instancia_preparar(text) to service_role;
grant execute on function public.whatsapp_instancia_atualizar(text, text, text, text) to service_role;
