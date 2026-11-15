set lock_timeout = '5s';

-- Item 5 (auditoria 11/11): limite de códigos errados no pareamento do agente de impressão.
-- O código tem 6 números e vale 30 min; sem limite, um admin logado (ou sessão roubada) poderia
-- varrer os códigos e conectar o computador de OUTRA pessoa. Limite: 10 erros por estabelecimento
-- em 15 min. Falha de código vira retorno {ok:false,error} (não exceção), senão o rollback
-- desfaria o registro da falha.

create table if not exists public.print_agent_pair_falhas (
  tenant_id text not null,
  at timestamptz not null default now(),
  code text
);
create index if not exists idx_print_agent_pair_falhas_tenant_at
  on public.print_agent_pair_falhas (tenant_id, at);
alter table public.print_agent_pair_falhas enable row level security;
revoke all on table public.print_agent_pair_falhas from public, anon, authenticated;
grant all on table public.print_agent_pair_falhas to service_role;

create or replace function public.print_agent_pair_confirm(p_code text, p_name text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_row public.print_agent_pairings%rowtype;
  v_name text;
begin
  if v_tenant is null or not public.is_admin_like() then
    raise exception 'Só o administrador conecta computadores de impressão.' using errcode = '42501';
  end if;
  delete from public.print_agent_pair_falhas where at < now() - interval '1 day';
  if (select count(*) from public.print_agent_pair_falhas
       where tenant_id = v_tenant and at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('ok', false,
      'error', 'Muitas tentativas com código errado. Espere alguns minutos e confira o número na janela do agente.');
  end if;
  select * into v_row from public.print_agent_pairings
   where code = v_code and expires_at > now() and tenant_id is null
   for update;
  if not found then
    insert into public.print_agent_pair_falhas (tenant_id, code) values (v_tenant, left(v_code, 20));
    insert into public.audit_log (actor_name, action, entity, entity_id)
    values (nullif(left(coalesce(p_by, ''), 120), ''), 'Código de impressão errado', 'print_agent', left(v_code, 20));
    return jsonb_build_object('ok', false,
      'error', 'Código não encontrado ou vencido. Confira o número na janela do agente (ele troca a cada 30 minutos).');
  end if;
  v_name := coalesce(nullif(left(trim(coalesce(p_name, '')), 60), ''), nullif(v_row.machine, ''), 'Computador');
  update public.print_agent_pairings
     set tenant_id = v_tenant, agent_name = v_name, confirmed_by = left(p_by, 120), confirmed_at = now()
   where code = v_code;
  insert into public.audit_log (actor_name, action, entity, entity_id, meta)
  values (nullif(left(coalesce(p_by, ''), 120), ''), 'Computador de impressão conectado: ' || v_name,
          'print_agent', v_code, jsonb_build_object('machine', v_row.machine));
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$function$;
revoke all on function public.print_agent_pair_confirm(text, text, text) from public, anon;
grant execute on function public.print_agent_pair_confirm(text, text, text) to authenticated, service_role;
