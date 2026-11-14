set lock_timeout = '5s';
-- =====================================================================
-- 20261117000000_conferencia_no_servidor.sql — item 4 (auditoria 11/11)
-- =====================================================================
-- Parte 1: tem_permissao(token). Espelho, no banco, de userPermissions e
-- rolePermissions (assets/js/core/config.js). As próximas partes desta
-- migration usam esta função para o servidor conferir quem pode o quê.
-- =====================================================================

-- Permissões de um perfil, pela mesma regra de rolePermissions() da tela:
-- matriz salva em cantina2:settings.rolePermissions.<perfil> quando for array
-- (somando 'receber-fiado' se a versão < 2 e 'pausar-produto' se < 3, só se o
-- padrão do perfil tiver o token); sem matriz, vale o padrão de ROLE_PERMS.
create or replace function public._permissoes_do_perfil(p_settings jsonb, p_perfil text)
returns text[]
language plpgsql
stable
set search_path to ''
as $function$
declare
  -- Padrões copiados de ROLE_PERMS em assets/js/core/config.js. Mudou lá, muda aqui.
  v_padrao text[] := case p_perfil
    when 'caixa' then array['caixa','balcao','comandas','delivery','fila-atendimento','agendamentos','cardapio','associados','locais','quemlevou','impressoras','estacoes','origens','relatorios','painel-senhas','totem','ajuda','mobile-qr','senha-propria','cancelar-comanda','receber-fiado','pausar-produto']
    when 'garcom' then array['comandas','senha-propria','mobile-qr']
    when 'cozinha' then array['cozinha','senha-propria','pausar-produto']
    else array[]::text[]
  end;
  v_matriz jsonb := p_settings #> array['rolePermissions', p_perfil];
  v_lista text[];
  v_versao numeric;
begin
  if v_matriz is null or jsonb_typeof(v_matriz) <> 'array' then
    return v_padrao;
  end if;
  select coalesce(array_agg(t), array[]::text[]) into v_lista from jsonb_array_elements_text(v_matriz) t;
  -- Number(x)||1 da tela: ausente, inválido ou zero valem 1.
  begin
    v_versao := nullif((p_settings ->> 'rolePermissionsVersion')::numeric, 0);
  exception when others then
    v_versao := null;
  end;
  v_versao := coalesce(v_versao, 1);
  if v_versao < 2 and 'receber-fiado' = any(v_padrao) and not ('receber-fiado' = any(v_lista)) then
    v_lista := array_append(v_lista, 'receber-fiado');
  end if;
  if v_versao < 3 and 'pausar-produto' = any(v_padrao) and not ('pausar-produto' = any(v_lista)) then
    v_lista := array_append(v_lista, 'pausar-produto');
  end if;
  return v_lista;
end;
$function$;
revoke all on function public._permissoes_do_perfil(jsonb, text) from public, anon, authenticated;

-- O colaborador logado tem a permissão? Dono e admin: sempre. Sem sessão ou sem
-- papel: não. p_token é o mesmo token de tela ('cancelar-comanda', 'receber-fiado'...).
create or replace function public.tem_permissao(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_papel text := public.current_staff_role();
  v_staff record;
  v_settings jsonb;
  v_users jsonb;
  v_user jsonb;
  v_lista text[];
begin
  if v_papel is null then return false; end if;
  if v_papel in ('owner', 'admin') then return true; end if;

  select id, tenant_id, opera_caixa into v_staff
    from public.tenant_staff
   where auth_user_id = auth.uid() and active = true;
  if not found then return false; end if;

  select value into v_settings from public.app_data
   where tenant_id = v_staff.tenant_id and key = 'cantina2:settings';
  if v_settings is null or jsonb_typeof(v_settings) <> 'object' then v_settings := '{}'::jsonb; end if;

  -- Caixa com lista própria no registro do colaborador: vale só ela.
  if v_papel = 'caixa' then
    select value into v_users from public.app_data
     where tenant_id = v_staff.tenant_id and key = 'cantina2:users';
    if v_users is not null and jsonb_typeof(v_users) = 'array' then
      select u into v_user from jsonb_array_elements(v_users) u
       where u ->> 'id' = v_staff.id limit 1;
      if v_user is not null and jsonb_typeof(v_user -> 'permissions') = 'array' then
        return p_token in (select jsonb_array_elements_text(v_user -> 'permissions'));
      end if;
    end if;
  end if;

  v_lista := public._permissoes_do_perfil(v_settings, v_papel);

  -- Caixa por operador: garçom marcado soma o que o perfil caixa libera, só com o ajuste ligado.
  if v_papel = 'garcom' and coalesce(v_staff.opera_caixa, false)
     and v_settings -> 'caixaPorOperador' = 'true'::jsonb then
    v_lista := v_lista || public._permissoes_do_perfil(v_settings, 'caixa');
  end if;

  return p_token = any(v_lista);
end;
$function$;
revoke all on function public.tem_permissao(text) from public, anon;
grant execute on function public.tem_permissao(text) to authenticated;
