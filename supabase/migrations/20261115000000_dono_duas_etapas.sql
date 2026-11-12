-- =====================================================================
-- 12/11/2026 (auditoria de lançamento, item 3): verificação em duas etapas da conta do dono
--
-- O dono pode ligar um código de app autenticador (TOTP, Supabase Auth MFA). Para a trava valer de
-- verdade, e não só na tela, o banco passa a reconhecer o dono com fator VERIFICADO apenas numa sessão
-- aal2 (senha + código). Sessão só de senha (aal1) desse dono fica sem estabelecimento: as policies
-- que usam current_tenant_id()/current_staff_role() não deixam ler nem gravar nada.
-- Dono sem fator (ou com o cadastro do fator não terminado, status 'unverified'): nada muda.
-- Colaborador (tenant_staff, login por PIN): nada muda.
--
-- Funções só da service_role/CLI que leem tenant_owners (cadastro_por_convite, nfce_emissor_salvar_token,
-- nfce_liberar_producao) ficam como estão: não dependem da sessão do dono.
-- =====================================================================

create or replace function public.dono_sessao_ok()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$function$;

revoke all on function public.dono_sessao_ok() from public, anon;
grant execute on function public.dono_sessao_ok() to authenticated, service_role;

create or replace function public.current_tenant_id()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select tenant_id from public.tenant_owners where user_id = auth.uid() and public.dono_sessao_ok()),
    (select tenant_id from public.tenant_staff where auth_user_id = auth.uid() and active = true)
  );
$function$;

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when exists (select 1 from public.tenant_owners where user_id = auth.uid()) and public.dono_sessao_ok()
      then 'owner'
    when exists (select 1 from public.tenant_owners where user_id = auth.uid())
      then null
    else (select role from public.tenant_staff
           where auth_user_id = auth.uid() and active = true)
  end;
$function$;

drop policy if exists owner_manage_print_token on public.print_agent_tokens;
create policy owner_manage_print_token on public.print_agent_tokens
  as permissive for all to authenticated
  using (tenant_id = (select tenant_owners.tenant_id from public.tenant_owners
                       where tenant_owners.user_id = (select auth.uid()))
         and (select public.dono_sessao_ok()))
  with check (tenant_id = (select tenant_owners.tenant_id from public.tenant_owners
                            where tenant_owners.user_id = (select auth.uid()))
              and (select public.dono_sessao_ok()));

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- create or replace function public.current_tenant_id() returns text language sql stable security definer
--   set search_path to '' as $f$ select coalesce(
--     (select tenant_id from public.tenant_owners where user_id = auth.uid()),
--     (select tenant_id from public.tenant_staff where auth_user_id = auth.uid() and active = true)); $f$;
-- create or replace function public.current_staff_role() returns text language sql stable security definer
--   set search_path to '' as $f$ select case when exists (select 1 from public.tenant_owners where user_id = auth.uid())
--     then 'owner' else (select role from public.tenant_staff where auth_user_id = auth.uid() and active = true) end; $f$;
-- drop policy if exists owner_manage_print_token on public.print_agent_tokens;
-- create policy owner_manage_print_token on public.print_agent_tokens as permissive for all to authenticated
--   using (tenant_id = (select tenant_owners.tenant_id from public.tenant_owners where tenant_owners.user_id = (select auth.uid())))
--   with check (tenant_id = (select tenant_owners.tenant_id from public.tenant_owners where tenant_owners.user_id = (select auth.uid())));
-- drop function if exists public.dono_sessao_ok();
