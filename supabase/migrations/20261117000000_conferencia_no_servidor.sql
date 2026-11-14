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

-- =====================================================================
-- Parte 2: venda_conferir (item 4, auditoria 11/11)
-- =====================================================================
-- Confere a venda fechada contra o catálogo do tenant e devolve um array
-- jsonb de achados { codigo, item, esperado, recebido } (vazio = tudo certo).
-- Só LÊ e REGISTRA: quem decide barrar ou não é quem chama. Não é exposta ao
-- app (revoke): só outras funções security definer chamam.
-- Tolerância de dinheiro: R$ 0,01. Campo numérico ausente ou inválido vale 0.
-- =====================================================================

-- jsonb -> numeric tolerante: número ou texto numérico; o resto vale 0.
create or replace function public._num_json(p jsonb)
returns numeric
language plpgsql
immutable
set search_path to ''
as $function$
begin
  if p is null then return 0; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  if jsonb_typeof(p) = 'string' then return coalesce((p #>> '{}')::numeric, 0); end if;
  return 0;
exception when others then
  return 0;
end;
$function$;
revoke all on function public._num_json(jsonb) from public, anon, authenticated;

create or replace function public.venda_conferir(p_tenant text, p_sale jsonb, p_credito_antes numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_achados jsonb := '[]'::jsonb;
  v_produtos jsonb;
  v_cupons jsonb;
  v_settings jsonb;
  v_items jsonb;
  v_pagtos jsonb;
  v_item jsonb;
  v_prod jsonb;
  v_ref text;
  v_preco numeric;
  v_piso numeric;
  v_liberado boolean;
  v_soma numeric := 0;
  v_tem_subtotal boolean;
  v_subtotal numeric;
  v_base numeric;
  v_desc numeric := public._num_json(p_sale -> 'discount');
  v_staff numeric := public._num_json(p_sale -> 'staffDiscount');
  v_credito numeric := public._num_json(p_sale -> 'creditApplied');
  v_pago numeric := 0;
  v_cupom jsonb;
  v_codigo text := nullif(p_sale ->> 'couponCode', '');
  v_hoje text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD');
  v_limite numeric;
  v_valor numeric;
  v_kind text;
  v_pct numeric;
begin
  v_produtos := (select value from public.app_data where tenant_id = p_tenant and key = 'cantina2:products');
  v_cupons   := (select value from public.app_data where tenant_id = p_tenant and key = 'cantina2:coupons');
  v_settings := (select value from public.app_data where tenant_id = p_tenant and key = 'cantina2:settings');
  if v_produtos is null or jsonb_typeof(v_produtos) <> 'array' then v_produtos := '[]'::jsonb; end if;
  if v_cupons is null or jsonb_typeof(v_cupons) <> 'array' then v_cupons := '[]'::jsonb; end if;
  if v_settings is null or jsonb_typeof(v_settings) <> 'object' then v_settings := '{}'::jsonb; end if;

  v_items := p_sale -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' then v_items := '[]'::jsonb; end if;
  v_pagtos := p_sale -> 'payments';
  if v_pagtos is null or jsonb_typeof(v_pagtos) <> 'array' then v_pagtos := '[]'::jsonb; end if;

  for v_item in select e from jsonb_array_elements(v_items) e
                 where jsonb_typeof(e) = 'object' and coalesce(e -> 'canceled', 'false'::jsonb) <> 'true'::jsonb
  loop
    v_ref := coalesce(nullif(v_item ->> 'lineId', ''), v_item ->> 'name');
    v_soma := v_soma + public._num_json(v_item -> 'price') * public._num_json(v_item -> 'qty');

    v_prod := null;
    if nullif(v_item ->> 'productId', '') is not null then
      select p into v_prod from jsonb_array_elements(v_produtos) p
       where p ->> 'id' = v_item ->> 'productId' limit 1;
    end if;
    if v_prod is null then
      v_achados := v_achados || jsonb_build_object('codigo', 'produto_desconhecido', 'item', v_ref, 'esperado', null, 'recebido', null);
      continue;
    end if;

    v_piso := public._num_json(v_prod -> 'price');
    if jsonb_typeof(v_item -> 'weight') = 'object' then
      -- Item pesado: o piso vale para o preço por kg, salvo liberação.
      v_preco := public._num_json(v_item -> 'weight' -> 'pricePerKg');
      if v_preco < v_piso - 0.01 then
        v_liberado := exists (
          select 1 from public.audit_log a
           where a.tenant_id = p_tenant and a.entity = 'product' and a.entity_id = v_item ->> 'productId'
             and a.at >= now() - interval '24 hours'
             and abs(public._num_json(a.meta -> 'price') - v_preco) <= 0.01
        );
        if not v_liberado and coalesce(v_item -> 'weight' -> 'override', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb) then
          v_liberado := exists (
            select 1 from public.tenant_staff s
             where s.tenant_id = p_tenant and s.id = v_item ->> 'addedById'
               and s.active = true and s.role = 'admin'
          );
        end if;
        if not v_liberado then
          v_achados := v_achados || jsonb_build_object('codigo', 'preco_abaixo', 'item', v_ref, 'esperado', v_piso, 'recebido', v_preco);
        end if;
      end if;
    else
      v_preco := public._num_json(v_item -> 'price');
      if v_preco < v_piso - 0.01 then
        v_achados := v_achados || jsonb_build_object('codigo', 'preco_abaixo', 'item', v_ref, 'esperado', v_piso, 'recebido', v_preco);
      end if;
    end if;
  end loop;

  -- Subtotal declarado x soma dos itens (só confere se a venda traz subtotal).
  v_tem_subtotal := jsonb_typeof(p_sale -> 'subtotal') in ('number', 'string');
  v_subtotal := public._num_json(p_sale -> 'subtotal');
  if v_tem_subtotal and abs(v_soma - v_subtotal) > 0.01 then
    v_achados := v_achados || jsonb_build_object('codigo', 'subtotal', 'item', null, 'esperado', v_soma, 'recebido', v_subtotal);
  end if;
  v_base := case when v_tem_subtotal then v_subtotal else v_soma end;

  -- Cupom: existe, está ativo e na validade, e o desconto cabe no limite.
  if v_desc > 0.01 then
    select c into v_cupom from jsonb_array_elements(v_cupons) c
     where v_codigo is not null and c ->> 'code' = v_codigo limit 1;
    if v_cupom is null
       or coalesce(v_cupom -> 'active', 'false'::jsonb) <> 'true'::jsonb
       or (coalesce(v_cupom ->> 'startDate', '') <> '' and v_cupom ->> 'startDate' > v_hoje)
       or (coalesce(v_cupom ->> 'endDate', '') <> '' and v_cupom ->> 'endDate' < v_hoje) then
      v_achados := v_achados || jsonb_build_object('codigo', 'cupom', 'item', null, 'esperado', null, 'recebido', v_desc);
    else
      v_valor := public._num_json(v_cupom -> 'value');
      if v_cupom ->> 'type' = 'percent' then
        v_limite := round(v_base * v_valor) / 100;
      else
        v_limite := least(v_base, v_valor);
      end if;
      if v_desc > v_limite + 0.01 then
        v_achados := v_achados || jsonb_build_object('codigo', 'cupom', 'item', null, 'esperado', v_limite, 'recebido', v_desc);
      end if;
    end if;
  end if;

  -- Desconto de colaborador: cliente tem que ser colaborador e o valor cabe no percentual.
  if v_staff > 0.01 then
    if jsonb_typeof(v_settings -> 'staffDiscountPct') in ('number', 'string') then
      v_pct := public._num_json(v_settings -> 'staffDiscountPct');
    else
      v_pct := 20;
    end if;
    v_pct := greatest(0, least(100, v_pct));
    v_limite := round(v_base * v_pct / 100, 2);
    select m.kind into v_kind from public.members m
     where m.tenant_id = p_tenant and m.id = p_sale ->> 'memberId';
    if v_kind is distinct from 'colaborador' or v_staff > v_limite + 0.01 then
      v_achados := v_achados || jsonb_build_object('codigo', 'desconto_colaborador', 'item', null,
        'esperado', case when v_kind is distinct from 'colaborador' then 0 else v_limite end, 'recebido', v_staff);
    end if;
  end if;

  -- Crédito usado x saldo antes da venda.
  if v_credito > coalesce(p_credito_antes, 0) + 0.01 then
    v_achados := v_achados || jsonb_build_object('codigo', 'credito', 'item', null,
      'esperado', coalesce(p_credito_antes, 0), 'recebido', v_credito);
  end if;

  -- Pagamento: os parciais já estão em payments; o serviço fica fora do piso.
  select coalesce(sum(public._num_json(e -> 'amount')), 0) into v_pago
    from jsonb_array_elements(v_pagtos) e where jsonb_typeof(e) = 'object';
  v_limite := v_base - v_staff - v_desc - v_credito;
  if v_pago < v_limite - 0.01 then
    v_achados := v_achados || jsonb_build_object('codigo', 'pagamento_abaixo', 'item', null, 'esperado', v_limite, 'recebido', v_pago);
  end if;

  return v_achados;
end;
$function$;
revoke all on function public.venda_conferir(text, jsonb, numeric) from public, anon, authenticated;
