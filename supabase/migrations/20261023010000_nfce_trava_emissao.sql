-- =====================================================================
-- t215 (23/10/2026): uma NFC-e por vez em cada estabelecimento
--
-- O Commandah usa uma série só (a 3) para todos os computadores e celulares, e o
-- número é dado pela Brasil NFe. A Brasil NFe recomendou uma série por computador
-- para não haver dois envios ao mesmo tempo na mesma série; em vez disso, a Edge
-- Function "nfce" pega esta trava antes de emitir e solta no fim. Quem chegar com a
-- trava ocupada espera alguns segundos (a emissão leva 1 a 2 s).
--
-- A trava é um "aluguel" com prazo (ate): se a função cair no meio da emissão, a
-- trava vence sozinha e a próxima emissão segue. O token garante que só quem pegou
-- solta (uma emissão que passou do prazo não solta a trava da seguinte).
-- =====================================================================

create table if not exists public.nfce_trava (
  tenant_id text        not null,
  token     uuid        not null,
  ate       timestamptz not null,
  constraint nfce_trava_pkey primary key (tenant_id),
  constraint nfce_trava_tenant_fkey foreign key (tenant_id)
    references public.tenant_owners (tenant_id) on delete cascade
);

alter table public.nfce_trava enable row level security;
revoke all on table public.nfce_trava from public, anon, authenticated;
grant all on table public.nfce_trava to service_role;
-- Sem policy: só a Edge Function (service_role) usa.

-- Pega a trava do estabelecimento por p_segundos. true = pegou; false = ocupada.
create or replace function public.nfce_trava_pegar(p_tenant text, p_token uuid, p_segundos integer)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  insert into public.nfce_trava (tenant_id, token, ate)
  values (p_tenant, p_token, now() + make_interval(secs => p_segundos))
  on conflict (tenant_id) do update
    set token = excluded.token, ate = excluded.ate
    where public.nfce_trava.ate < now();
  return found;
end;
$$;

-- Solta a trava, só se ainda for de quem pegou.
create or replace function public.nfce_trava_soltar(p_tenant text, p_token uuid)
returns void
language sql
set search_path = public
as $$
  delete from public.nfce_trava where tenant_id = p_tenant and token = p_token;
$$;

revoke all on function public.nfce_trava_pegar(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.nfce_trava_soltar(text, uuid) from public, anon, authenticated;
grant execute on function public.nfce_trava_pegar(text, uuid, integer) to service_role;
grant execute on function public.nfce_trava_soltar(text, uuid) to service_role;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.nfce_trava_soltar(text, uuid);
-- drop function if exists public.nfce_trava_pegar(text, uuid, integer);
-- drop table if exists public.nfce_trava;
