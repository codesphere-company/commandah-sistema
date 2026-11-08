-- 08/11 (pedido do dono): quem hoje atende só pelo app do garçom (tenant_staff com perfil 'caixa' e
-- origem 'app' no cadastro) passa para o perfil 'garcom' criado em 20261108000000_perfil_garcom.sql.
-- Só dados: o PIN (pin_hash) e o id não mudam, então o login continua igual.
--
-- O casamento é por id: tenant_staff.id é o mesmo id do usuário no blob app_data 'cantina2:users'
-- (é o id que o app manda à staff-auth e que o seed da bancada usa).
--
-- Seguro rodar duas vezes: o backup só é gravado se ainda não existe e, depois da primeira
-- execução, não sobra nenhum 'caixa' com origem 'app' para converter.
--
-- Reverter (um tenant): restaurar o value de 'cantina2:users' a partir de
-- 'backup:cantina2:users:2026-11-08-garcom' e
--   update public.tenant_staff set role = 'caixa' where id in (<ids dos garçons convertidos>);

-- 1) Cópia do blob de usuários, por tenant, antes de qualquer mudança (só se ainda não existir).
insert into public.app_data (tenant_id, key, value)
select a.tenant_id, 'backup:cantina2:users:2026-11-08-garcom', a.value
from public.app_data a
where a.key = 'cantina2:users'
  and jsonb_typeof(a.value) = 'array'
  and exists (
    select 1
    from public.tenant_staff s
    join jsonb_array_elements(a.value) u on u->>'id' = s.id::text
    where s.tenant_id = a.tenant_id
      and s.role = 'caixa'
      and u->>'origem' = 'app'
  )
on conflict (tenant_id, key) do nothing;

-- 2) Blob: perfil 'garcom' para os usuários 'caixa' de origem 'app' que existem no banco como tenant_staff 'caixa'.
update public.app_data a
set value = (
      select coalesce(jsonb_agg(
        case
          when u->>'role' = 'caixa' and u->>'origem' = 'app'
               and exists (select 1 from public.tenant_staff s
                           where s.tenant_id = a.tenant_id and s.id::text = u->>'id' and s.role = 'caixa')
            then jsonb_set(u, '{role}', '"garcom"')
          else u
        end order by o), '[]'::jsonb)
      from jsonb_array_elements(a.value) with ordinality t(u, o)
    ),
    updated_at = now()
where a.key = 'cantina2:users'
  and jsonb_typeof(a.value) = 'array'
  and exists (
    select 1
    from public.tenant_staff s
    join jsonb_array_elements(a.value) u on u->>'id' = s.id::text
    where s.tenant_id = a.tenant_id
      and s.role = 'caixa'
      and u->>'origem' = 'app'
      and u->>'role' = 'caixa'
  );

-- 3) Banco de logins: o perfil que vale na RLS. Vem depois do blob porque o blob é a fonte do 'origem'.
update public.tenant_staff s
set role = 'garcom', updated_at = now()
where s.role = 'caixa'
  and exists (
    select 1
    from public.app_data a
    join jsonb_array_elements(a.value) u on true
    where a.tenant_id = s.tenant_id
      and a.key = 'cantina2:users'
      and jsonb_typeof(a.value) = 'array'
      and u->>'id' = s.id::text
      and u->>'origem' = 'app'
      and u->>'role' in ('caixa', 'garcom')
  );
