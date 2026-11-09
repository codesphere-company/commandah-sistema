-- =====================================================================
-- 20261111000000_conferencia_pagamentos.sql — conferência de pagamentos
-- 09/11 (pedido do dono): o administrador marca cada pagamento como
-- "confirmado" (caiu na conta) ou "nao_recebido" (com observação).
-- =====================================================================
-- O PROBLEMA
-- ----------
-- Pagamento em pix/cartão é lançado pelo operador, mas ninguém conferia se o
-- dinheiro entrou. A marcação precisa ser do administrador, ficar no servidor
-- (vale para todos os aparelhos) e deixar rastro no audit_log.
--
-- A SOLUCAO
-- ---------
-- 1. payment_checks: uma linha por pagamento conferido, chave (tenant, payment_key).
--    A RLS deixa só dono/admin LEREM; ninguém grava direto (sem grant de escrita).
-- 2. payment_checks_apply(p_keys, p_status, p_note, p_by): SECURITY DEFINER, só
--    dono/admin. Aplica a situação a 1 a 500 chaves de uma vez. 'a_conferir' apaga
--    a marcação. 'nao_recebido' exige observação. Uma linha no audit_log por chamada.
--
-- RETESTE: como admin, confirmar 2 pagamentos -> Logs mostra "Conferência: 2
-- pagamento(s) confirmado(s)"; como caixa, tentar o mesmo -> recusado.
-- =====================================================================

set lock_timeout = '5s';

create table if not exists public.payment_checks (
  tenant_id   text        not null,
  payment_key text        not null,
  status      text        not null check (status in ('confirmado', 'nao_recebido')),
  note        text,
  checked_by  text,
  checked_at  timestamptz not null default now(),
  primary key (tenant_id, payment_key)
);

alter table public.payment_checks enable row level security;
revoke all on public.payment_checks from public, anon, authenticated;
grant select on public.payment_checks to authenticated;

drop policy if exists payment_checks_select on public.payment_checks;
create policy payment_checks_select on public.payment_checks
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin_like());

create or replace function public.payment_checks_apply(p_keys jsonb, p_status text, p_note text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_keys text[];
  v_n int;
  v_by text := nullif(left(coalesce(p_by, ''), 120), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_label text;
begin
  if v_tenant is null or not coalesce(public.is_admin_like(), false) then
    raise exception 'sem permissao para conferir pagamentos' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('confirmado', 'nao_recebido', 'a_conferir') then
    raise exception 'situacao invalida';
  end if;
  if p_keys is null or jsonb_typeof(p_keys) <> 'array'
     or jsonb_array_length(p_keys) < 1 or jsonb_array_length(p_keys) > 500 then
    raise exception 'chaves invalidas: informe de 1 a 500';
  end if;
  if exists (select 1 from jsonb_array_elements(p_keys) e
              where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}') = '') then
    raise exception 'chaves invalidas: so textos nao vazios';
  end if;
  if p_status = 'nao_recebido' and v_note is null then
    raise exception 'informe a observacao do pagamento nao recebido' using errcode = '23514';
  end if;

  select array_agg(distinct e #>> '{}') into v_keys from jsonb_array_elements(p_keys) e;

  if p_status = 'a_conferir' then
    delete from public.payment_checks where tenant_id = v_tenant and payment_key = any (v_keys);
    get diagnostics v_n = row_count;
  else
    insert into public.payment_checks (tenant_id, payment_key, status, note, checked_by, checked_at)
    select v_tenant, k, p_status, v_note, v_by, now() from unnest(v_keys) k
    on conflict (tenant_id, payment_key)
    do update set status = excluded.status, note = excluded.note,
                  checked_by = excluded.checked_by, checked_at = excluded.checked_at;
    get diagnostics v_n = row_count;
  end if;

  v_label := case p_status when 'confirmado' then 'confirmado(s)'
                           when 'nao_recebido' then 'nao recebido(s)'
                           else 'devolvido(s) para conferir' end;
  insert into public.audit_log (actor_name, action, entity, meta)
  values (v_by,
          'Conferência: ' || v_n || ' pagamento(s) ' || v_label,
          'payment_check',
          jsonb_build_object('keys', to_jsonb(v_keys), 'status', p_status, 'n', v_n));

  return jsonb_build_object('ok', true, 'n', v_n);
end;
$function$;
revoke all on function public.payment_checks_apply(jsonb, text, text, text) from public, anon;
grant execute on function public.payment_checks_apply(jsonb, text, text, text) to authenticated;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- drop function if exists public.payment_checks_apply(jsonb, text, text, text);
-- drop table if exists public.payment_checks;
