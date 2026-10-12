-- =====================================================================
-- t207 (12/10/2026): NFC-e emitidas pelo Commandah (via Brasil NFe)
--
-- Cada tentativa de emissão de uma comanda vira uma linha: autorizada, rejeitada
-- (com o código e o motivo da SEFAZ) ou erro (falha de comunicação). Quem grava é
-- só a Edge Function "nfce" (service_role), que guarda o token da Brasil NFe.
-- O site só lê (administrador e caixa do próprio estabelecimento), como as vendas.
--
-- O XML autorizado fica guardado aqui (a lei pede 5 anos; a Brasil NFe também guarda).
-- =====================================================================

create table if not exists public.nfce_notas (
  id            uuid        not null default gen_random_uuid(),
  tenant_id     text        not null,
  sale_id       text        not null,
  ambiente      smallint    not null,              -- 1 produção, 2 homologação
  identificador text        not null,              -- IdentificadorInterno enviado à Brasil NFe
  status        text        not null,              -- autorizada | rejeitada | erro
  numero        bigint,
  serie         integer,
  chave         text,
  protocolo     text,
  cod_status    integer,                           -- cStat da SEFAZ (100 = autorizada)
  motivo        text,
  valor         numeric(12,2),
  xml           text,
  created_at    timestamptz not null default now(),
  created_by    text,
  constraint nfce_notas_pkey primary key (id),
  constraint nfce_notas_ambiente_check check (ambiente in (1, 2)),
  constraint nfce_notas_status_check check (status in ('autorizada', 'rejeitada', 'erro')),
  constraint nfce_notas_tenant_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade
);
create index if not exists idx_nfce_notas_sale on public.nfce_notas (tenant_id, sale_id, created_at desc);
-- Uma comanda tem no máximo uma NFC-e autorizada por ambiente.
create unique index if not exists uq_nfce_notas_autorizada on public.nfce_notas (tenant_id, sale_id, ambiente) where status = 'autorizada';

alter table public.nfce_notas enable row level security;
revoke all on table public.nfce_notas from public, anon, authenticated;
grant select on table public.nfce_notas to authenticated;
grant all on table public.nfce_notas to service_role;

drop policy if exists nfce_notas_select_por_papel on public.nfce_notas;
create policy nfce_notas_select_por_papel
  on public.nfce_notas
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.is_admin_like()) or (select public.current_staff_role()) = 'caixa')
  );
-- Sem policy de insert/update/delete: escrita só pela Edge Function (service_role).

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop table if exists public.nfce_notas;
