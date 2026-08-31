-- =====================================================================
-- COMMANDAH — LIMPEZA DE PII ORFA E DE BLOB LEGADO DE SOCIOS
-- Projeto Supabase: ezfoymdesmarpunmixbs
-- Data: 2026-08-31
-- Autor: dba-dados  |  Origem: achado do security-specialist (Fase 1, item 2)
-- =====================================================================
--
-- ESTE ARQUIVO E DML (apaga dado), NAO DDL. Rodar no SQL Editor do
-- Supabase DEPOIS de conferir o bloco de verificacao (SECAO 1).
--
-- O QUE ELE FAZ
-- -------------
-- (a) Apaga todo o dado residual dos DOIS TENANTS ORFAOS — tenant_ids que
--     existem em app_data mas NAO tem nenhuma linha em tenant_owners, ou
--     seja, nao tem dono, ninguem consegue logar neles e ninguem nunca
--     mais vai usa-los:
--        - 'clube-olimpico-maringa'
--        - 'lanchonete-olimpico-3bew'
--     (O tenant real e ativo do Clube Olimpico e
--      'clube-olimpico-maringa-y8mt' e NAO e tocado por este bloco.)
--
-- (b) Apaga a chave legada 'cantina2:members' — a lista antiga de socios
--     em JSON (~224 KB, com nome, telefone e divida de pessoa real) — do
--     tenant REAL. Essa lista foi migrada para as tabelas relacionais
--     members / member_dependents / member_debt_entries, a migracao foi
--     conferida por SQL e o frontend nao le mais essa chave. O que sobrou
--     e uma COPIA OBSOLETA de dado pessoal, sem finalidade.
--
-- O QUE ELE NAO FAZ (de proposito)
-- --------------------------------
--   - NAO toca em members / member_dependents / member_debt_entries.
--   - NAO toca em nenhuma outra chave de app_data do tenant real.
--   - NAO toca em tenant_owners.
--
-- REVERSAO
-- --------
-- Nao ha rollback transacional depois do commit: sao DELETEs de dado.
-- O caminho de reversao e o BACKUP do Supabase (PITR / daily backup)
-- imediatamente anterior a execucao. Antes de rodar a SECAO 2, confirme
-- que existe backup recente do projeto.
-- =====================================================================


-- =====================================================================
-- SECAO 1 — CONFERENCIA (rodar PRIMEIRO, sozinho, e olhar o resultado)
-- =====================================================================
-- Nao apaga nada. Mostra exatamente quantas linhas cada DELETE abaixo vai
-- remover, tabela por tabela. Se algum numero surpreender, PARE e chame o
-- dba antes de rodar a SECAO 2.

select 'A. orfao: app_data'            as alvo, tenant_id, count(*) as linhas
  from public.app_data
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

union all
select 'A. orfao: print_jobs',          tenant_id, count(*)
  from public.print_jobs
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

union all
select 'A. orfao: print_agent_tokens',  tenant_id, count(*)
  from public.print_agent_tokens
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

union all
select 'A. orfao: tenant_staff',        tenant_id, count(*)
  from public.tenant_staff
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

union all
select 'A. orfao: members',             tenant_id, count(*)
  from public.members
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

union all
select 'A. orfao: member_dependents',   tenant_id, count(*)
  from public.member_dependents
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

union all
select 'A. orfao: member_debt_entries', tenant_id, count(*)
  from public.member_debt_entries
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

-- Sanidade: confirma que os dois tenants acima realmente NAO tem dono.
-- Se esta linha vier com contagem > 0, NAO RODE A SECAO 2 — significa que
-- algum deles ganhou dono e nao e mais orfao.
union all
select 'A. tem dono? (deve ser 0)',     tenant_id, count(*)
  from public.tenant_owners
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
 group by tenant_id

-- (b) O blob legado de socios no tenant REAL.
union all
select 'B. legado cantina2:members',    tenant_id, count(*)
  from public.app_data
 where tenant_id = 'clube-olimpico-maringa-y8mt'
   and key = 'cantina2:members'
 group by tenant_id

-- Sanidade: os socios ja estao nas tabelas relacionais. Esta contagem tem
-- que vir com valor alto (na casa do milhar). Se vier 0, a migracao nao
-- esta la e o blob NAO pode ser apagado.
union all
select 'B. socios ja no relacional',    tenant_id, count(*)
  from public.members
 where tenant_id = 'clube-olimpico-maringa-y8mt'
 group by tenant_id

order by 1, 2;


-- Conferencia extra (opcional): lista as chaves de app_data que SOBRAM no
-- tenant real depois da limpeza. 'cantina2:members' nao deve aparecer.
-- select key from public.app_data
--  where tenant_id = 'clube-olimpico-maringa-y8mt'
--    and key <> 'cantina2:members'
--  order by key;


-- =====================================================================
-- SECAO 2 — EXECUCAO (rodar SO depois de conferir a SECAO 1)
-- =====================================================================
-- Tudo dentro de uma transacao unica: ou apaga os dois blocos, ou nao
-- apaga nada.

begin;

  -- (a) Tenants orfaos, sem dono. As tabelas members/member_dependents/
  --     member_debt_entries/tenant_staff/print_agent_tokens tem FK para
  --     tenant_owners(tenant_id) e por isso NAO conseguem conter linha
  --     desses tenants — os DELETEs relevantes sao os das duas tabelas
  --     que nao tem essa FK: app_data e print_jobs.
  delete from public.app_data
   where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew');

  delete from public.print_jobs
   where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew');

  -- (b) Blob legado de socios do tenant REAL. Uma chave, um tenant.
  --     O `and key = ...` e o que impede isso de virar um acidente.
  delete from public.app_data
   where tenant_id = 'clube-olimpico-maringa-y8mt'
     and key = 'cantina2:members';

commit;


-- =====================================================================
-- SECAO 3 — VERIFICACAO POS-EXECUCAO (rodar depois do commit)
-- =====================================================================
-- As tres primeiras linhas devem vir com 0. A ultima deve continuar
-- mostrando os socios intactos nas tabelas relacionais.

select 'app_data de tenant orfao (esperado 0)' as verificacao, count(*) as valor
  from public.app_data
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
union all
select 'print_jobs de tenant orfao (esperado 0)', count(*)
  from public.print_jobs
 where tenant_id in ('clube-olimpico-maringa', 'lanchonete-olimpico-3bew')
union all
select 'blob cantina2:members (esperado 0)', count(*)
  from public.app_data
 where tenant_id = 'clube-olimpico-maringa-y8mt' and key = 'cantina2:members'
union all
select 'socios no relacional (deve seguir intacto)', count(*)
  from public.members
 where tenant_id = 'clube-olimpico-maringa-y8mt';
