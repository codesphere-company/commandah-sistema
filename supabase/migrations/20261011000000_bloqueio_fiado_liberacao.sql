-- =====================================================================
-- 20261011000000_bloqueio_fiado_liberacao.sql — OP-14
-- =====================================================================
-- A DECISAO (dono, 10/10)
-- -----------------------
-- Qualquer fiado bloqueia: sócio com dívida (members.debt > 0) não abre comanda
-- nem compra até pagar. O bloqueio vale para o titular e os dependentes (a
-- dívida do dependente já cai no titular). Só o administrador libera.
--
-- A SOLUCAO
-- ---------
-- members.debt_release guarda a liberação: {"amount": dívida no momento, "at",
-- "by"}. O site considera o sócio liberado enquanto a dívida não passar desse
-- valor; um fiado novo bloqueia de novo. O bloqueio em si é feito no site (como
-- era antes de 03/10); aqui o banco só garante que ninguém além de admin/dono
-- grava a liberação (o caixa tem UPDATE em members por causa do fiado).
-- Restauração de backup (postgres/service_role) passa: a trava só olha os
-- papéis da API.
-- =====================================================================

alter table public.members add column if not exists debt_release jsonb;

create or replace function public.members_guard_debt_release()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon')
     and (tg_op = 'INSERT' and new.debt_release is not null
          or tg_op = 'UPDATE' and new.debt_release is distinct from old.debt_release)
     and not public.is_admin_like() then
    raise exception 'Só o administrador libera sócio bloqueado por fiado.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.members_guard_debt_release() from public, anon, authenticated;

drop trigger if exists trg_members_guard_debt_release on public.members;
create trigger trg_members_guard_debt_release
  before insert or update on public.members
  for each row execute function public.members_guard_debt_release();

-- ROLLBACK:
-- drop trigger if exists trg_members_guard_debt_release on public.members;
-- drop function if exists public.members_guard_debt_release();
-- alter table public.members drop column if exists debt_release;
