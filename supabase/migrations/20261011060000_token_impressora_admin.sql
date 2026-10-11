-- =====================================================================
-- 20261011060000_token_impressora_admin.sql — administrador gera o token
-- do agente de impressão
-- =====================================================================
-- O PROBLEMA
-- ----------
-- regenerate_print_agent_token() só aceitava a sessão do DONO (tenant_owners).
-- Só que, no uso real, depois do e-mail e senha todo mundo entra pelo PIN, e o
-- login por PIN (staff-auth) troca a sessão do dono pela do colaborador. O
-- botão "Gerar/Regenerar token" em Configurações › Impressoras devolvia
-- "not a tenant owner" para todos, inclusive para o administrador (11/10).
--
-- A DECISAO (dono, 11/10: opção A)
-- --------------------------------
-- Dono OU colaborador ativo com perfil administrador gera o token. O
-- administrador já controla todo o resto (impressoras, colaboradores,
-- configurações). Cada geração fica no audit_log com quem gerou.
--
-- O resto não muda: o token em claro só existe na resposta desta chamada, o
-- banco guarda apenas o sha256, e gerar um novo invalida o anterior.
-- =====================================================================

drop function if exists public.regenerate_print_agent_token();

create or replace function public.regenerate_print_agent_token(p_by text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id text := public.current_tenant_id();
  v_token text;
begin
  if v_tenant_id is null or not public.is_admin_like() then
    raise exception 'Só o administrador gera o token do agente de impressão.' using errcode = '42501';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.print_agent_tokens (tenant_id, token_hash, created_at, rotated_at)
  values (v_tenant_id, extensions.digest(v_token, 'sha256'), now(), now())
  on conflict (tenant_id) do update
    set token_hash = excluded.token_hash, rotated_at = now();

  insert into public.audit_log (actor_name, action, entity, entity_id, meta)
  values (nullif(left(coalesce(p_by, ''), 120), ''),
          'Token do agente de impressão gerado (o anterior deixou de valer)',
          'print_agent_token', v_tenant_id, '{}'::jsonb);

  return v_token;
end;
$function$;

revoke all on function public.regenerate_print_agent_token(text) from public, anon;
grant execute on function public.regenerate_print_agent_token(text) to authenticated, service_role;

-- ROLLBACK (volta a ser só o dono, sem parâmetro):
-- drop function if exists public.regenerate_print_agent_token(text);
-- create or replace function public.regenerate_print_agent_token()
-- returns text language plpgsql security definer set search_path to '' as $function$
-- declare v_tenant_id text; v_token text;
-- begin
--   select tenant_id into v_tenant_id from public.tenant_owners where user_id = auth.uid();
--   if v_tenant_id is null then raise exception 'not a tenant owner'; end if;
--   v_token := encode(extensions.gen_random_bytes(24), 'hex');
--   insert into public.print_agent_tokens (tenant_id, token_hash, created_at, rotated_at)
--   values (v_tenant_id, extensions.digest(v_token, 'sha256'), now(), now())
--   on conflict (tenant_id) do update set token_hash = excluded.token_hash, rotated_at = now();
--   return v_token;
-- end; $function$;
-- revoke all on function public.regenerate_print_agent_token() from public, anon;
-- grant execute on function public.regenerate_print_agent_token() to authenticated, service_role;
