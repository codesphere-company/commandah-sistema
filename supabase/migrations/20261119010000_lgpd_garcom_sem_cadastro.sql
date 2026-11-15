-- =====================================================================
-- Item 6 (auditoria 11/11): LGPD dos sócios, migration B.
-- Garçom sai das policies de leitura direta de members e member_dependents.
-- Ele passa a ler só por members_list() e member_dependents_list() (migration A),
-- que já escondem CPF, telefone, e-mail, endereço e notas.
--
-- ATENÇÃO: aplicar só depois do merge do front e da recarga de todos os aparelhos.
-- Aparelho com o front antigo lê members direto e, depois desta migration, veria
-- a lista de sócios vazia para o garçom.
--
-- Depende da migration A (20261119000000_lgpd_socios_banco.sql).
-- =====================================================================
set lock_timeout = '5s';

-- A policy chama lgpd_le_cadastro_inteiro() com o privilégio de quem consulta, então
-- o papel authenticated precisa de EXECUTE. A função só devolve um boolean sobre o
-- próprio chamador (security definer, sem parâmetros).
grant execute on function public.lgpd_le_cadastro_inteiro() to authenticated;

-- members: dono, admin e caixa leem; garçom só quando opera o caixa (função).
drop policy if exists members_select_por_papel on public.members;
create policy members_select_por_papel
  on public.members
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_staff_role()) in ('owner','admin','caixa')
      or (select public.lgpd_le_cadastro_inteiro())
    )
  );

-- member_dependents: owner/admin/caixa já leem por member_dependents_por_papel (for all).
-- Sai a leitura direta do garçom; o garçom que opera caixa lê pela função.
drop policy if exists member_dependents_select_garcom on public.member_dependents;
drop policy if exists member_dependents_select_cadastro_inteiro on public.member_dependents;
create policy member_dependents_select_cadastro_inteiro
  on public.member_dependents
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.lgpd_le_cadastro_inteiro())
  );

-- ROLLBACK (recria as duas policies como em 20261108000000_perfil_garcom.sql:154-180):
-- drop policy if exists members_select_por_papel on public.members;
-- create policy members_select_por_papel
--   on public.members
--   for select
--   to authenticated
--   using (
--     tenant_id = (select public.current_tenant_id())
--     and (select public.current_staff_role()) in ('owner','admin','caixa','garcom')
--   );
-- drop policy if exists member_dependents_select_cadastro_inteiro on public.member_dependents;
-- drop policy if exists member_dependents_select_garcom on public.member_dependents;
-- create policy member_dependents_select_garcom
--   on public.member_dependents
--   for select
--   to authenticated
--   using (
--     tenant_id = (select public.current_tenant_id())
--     and (select public.current_staff_role()) = 'garcom'
--   );
-- revoke execute on function public.lgpd_le_cadastro_inteiro() from authenticated;
