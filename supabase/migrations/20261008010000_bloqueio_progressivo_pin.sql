-- =====================================================================
-- 20261008010000_bloqueio_progressivo_pin.sql — SEG-01 (auditoria 2026-10-07)
-- =====================================================================
-- O PROBLEMA
-- ----------
-- O bloqueio de PIN durava sempre 15 min e zerava: ~480 tentativas por dia.
-- Um PIN de 4 digitos (10.000 combinacoes) caia em ~10 dias, e o PIN do
-- administrador vira acesso de administrador.
--
-- A SOLUCAO (decisao do dono: bloqueio progressivo + PIN de 6 para admin)
-- ---------
-- 1. tenant_staff.lock_count: quantos bloqueios seguidos o colaborador teve.
--    A staff-auth bloqueia por 15 min, depois 1 h, depois 24 h (dai em diante
--    sempre 24 h, ate o dono redefinir o PIN). Login certo zera o contador.
-- 2. audit_log_stamp(): a staff-auth (service_role) passa a poder gravar no
--    audit_log com o tenant_id que ela informa, para o bloqueio aparecer na
--    tela de Logs do dono. Para quem chama do navegador nada muda: tenant, hora
--    e ator continuam carimbados pelo servidor.
--
-- ORDEM DE DEPLOY: esta migration ANTES da staff-auth nova (a funcao grava
-- lock_count). O index.html nao depende dela.
--
-- RETESTE: errar o PIN 5x -> "Bloqueado por 15 min" e uma linha "PIN
-- bloqueado" em Configuracoes > Logs; quando os 15 min vencerem, errar 5x de
-- novo -> 1 h. Redefinir o PIN em Colaboradores destrava e zera a contagem.
-- =====================================================================

alter table public.tenant_staff
  add column if not exists lock_count integer not null default 0;

create or replace function public.audit_log_stamp()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Gravacao do servidor (Edge Function com service_role): confia no tenant
  -- informado, que a funcao tirou do proprio banco. Ator fica marcado como sistema.
  if coalesce(auth.role(), '') = 'service_role' then
    new.at             := now();
    new.actor_auth_uid := null;
    new.actor_role     := 'sistema';
    if new.tenant_id is null then
      raise exception 'tenant_id obrigatorio em gravacao do servidor';
    end if;
    return new;
  end if;

  new.tenant_id      := public.current_tenant_id();
  new.at             := now();
  new.actor_auth_uid := auth.uid();
  new.actor_role     := public.current_staff_role();
  if new.tenant_id is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;
  return new;
end;
$function$;

-- =====================================================================
-- ROLLBACK (rodar DEPOIS de voltar a staff-auth anterior)
-- =====================================================================
-- create or replace function public.audit_log_stamp()
-- returns trigger language plpgsql security definer set search_path to '' as $function$
-- begin
--   new.tenant_id      := public.current_tenant_id();
--   new.at             := now();
--   new.actor_auth_uid := auth.uid();
--   new.actor_role     := public.current_staff_role();
--   if new.tenant_id is null then
--     raise exception 'sem tenant resolvido para o usuario atual';
--   end if;
--   return new;
-- end;
-- $function$;
-- alter table public.tenant_staff drop column if exists lock_count;
