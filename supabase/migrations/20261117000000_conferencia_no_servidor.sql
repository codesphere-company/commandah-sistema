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
        -- coalesce: token nulo dá false, não NULL (item 4, auditoria 11/11).
        return coalesce(p_token in (select jsonb_array_elements_text(v_user -> 'permissions')), false);
      end if;
    end if;
  end if;

  v_lista := public._permissoes_do_perfil(v_settings, v_papel);

  -- Caixa por operador: garçom marcado soma o que o perfil caixa libera, só com o ajuste ligado.
  if v_papel = 'garcom' and coalesce(v_staff.opera_caixa, false)
     and v_settings -> 'caixaPorOperador' = 'true'::jsonb then
    v_lista := v_lista || public._permissoes_do_perfil(v_settings, 'caixa');
  end if;

  return coalesce(p_token = any(v_lista), false);
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

-- =====================================================================
-- Parte 3: gravação (item 4, auditoria 11/11)
-- =====================================================================
-- close_sale e sales_apply passam a:
--   * conferir a venda fechada (venda_conferir). Desligado o ajuste
--     cantina2:settings.conferenciaBarrar (padrão), a venda grava com a marca
--     conferencia = {em, divergencias} e uma linha no audit_log
--     ('Venda com divergência'). Ligado, a venda divergente é recusada:
--     close_sale dá erro 'venda_divergente'; sales_apply devolve conflito
--     reason 'venda_divergente' e grava o resto do lote.
--   * jogar fora a chave 'conferencia' que vier do aparelho (só o servidor marca).
--   * exigir 'cancelar-comanda' para cancelar item ativo (por lineId) ou a venda
--     inteira: close_sale dá erro 'sem permissao para cancelar'; sales_apply
--     devolve conflito reason 'sem_permissao_cancelar'.
-- Gatilho em member_debt_entries: pagamento de fiado sem venda (receber no
-- Financeiro) exige 'receber-fiado' ou 'contas'. Lançamento com sale_id
-- (pendência paga no fechamento, crédito de troco) e service_role passam.
-- Os corpos de close_sale e sales_apply são os de 20261108000000_perfil_garcom.sql
-- com os blocos marcados "Item 4 (auditoria 11/11)" acrescentados.
-- =====================================================================

-- A venda que vai ser gravada é conferida? Fechada e não cancelada inteira.
create or replace function public._venda_conferivel(p_sale jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(p_sale ->> 'status', '') = 'closed'
     and coalesce(p_sale -> 'canceled', 'false'::jsonb) <> 'true'::jsonb;
$function$;
revoke all on function public._venda_conferivel(jsonb) from public, anon, authenticated;

-- A nova versão cancela algo que a gravada (p_cur) tinha ativo? Item com lineId ativo
-- na gravada e canceled na nova, ou a venda inteira canceled que antes não estava.
-- Sem versão gravada: false. Itens sem lineId ficam fora.
create or replace function public._venda_cancela(p_cur jsonb, p_new jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_cur is not null and (
    (coalesce(p_new -> 'canceled', 'false'::jsonb) = 'true'::jsonb
     and coalesce(p_cur -> 'canceled', 'false'::jsonb) <> 'true'::jsonb)
    or exists (
      select 1
        from jsonb_array_elements(case when jsonb_typeof(p_new -> 'items') = 'array' then p_new -> 'items' else '[]'::jsonb end) n
        join jsonb_array_elements(case when jsonb_typeof(p_cur -> 'items') = 'array' then p_cur -> 'items' else '[]'::jsonb end) o
          on jsonb_typeof(n) = 'object' and jsonb_typeof(o) = 'object'
         and nullif(n ->> 'lineId', '') is not null and o ->> 'lineId' = n ->> 'lineId'
       where coalesce(n -> 'canceled', 'false'::jsonb) = 'true'::jsonb
         and coalesce(o -> 'canceled', 'false'::jsonb) <> 'true'::jsonb
    )
  );
$function$;
revoke all on function public._venda_cancela(jsonb, jsonb) from public, anon, authenticated;

-- Crédito do sócio antes desta venda: greatest(0, -members.debt), lido for update (trava o
-- sócio até o fim da transação). Na regravação (admin, comanda reaberta) o uso de crédito
-- desta venda ('<venda>-credito') já entrou no saldo; ele volta para não acusar 'credito'
-- falso. No primeiro fechamento esse lançamento ainda não existe e a soma é 0.
create or replace function public._venda_credito_antes(p_tenant text, p_sale_id text, p_member text)
returns numeric
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_credito numeric;
  v_usado numeric;
begin
  if nullif(p_member, '') is null then return 0; end if;
  select greatest(0, -coalesce(m.debt, 0)) into v_credito
    from public.members m
   where m.tenant_id = p_tenant and m.id = p_member
     for update;
  if not found then return 0; end if;
  select coalesce(sum(d.value), 0) into v_usado
    from public.member_debt_entries d
   where d.tenant_id = p_tenant and d.member_id = p_member
     and d.id = p_sale_id || '-credito' and d.type = 'debt' and not d.reversed;
  return v_credito + v_usado;
end;
$function$;
revoke all on function public._venda_credito_antes(text, text, text) from public, anon, authenticated;

-- Devolve a venda pronta para gravar: sempre sem a chave 'conferencia' do aparelho.
-- Venda conferível com divergência: barrar desligado acrescenta a marca e grava no
-- audit_log (o carimbo audit_log_stamp põe tenant, hora, auth.uid() e papel); barrar
-- ligado levanta 'venda_divergente' (detail = divergências) e desfaz a transação.
create or replace function public.venda_conferencia_aplicar(p_tenant text, p_sale_id text, p_sale jsonb, p_credito_antes numeric)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sale jsonb := p_sale - 'conferencia';
  v_div jsonb;
  v_barrar boolean;
begin
  if not public._venda_conferivel(v_sale) then
    return v_sale;
  end if;
  v_div := public.venda_conferir(p_tenant, v_sale, p_credito_antes);
  if v_div is null or jsonb_array_length(v_div) = 0 then
    return v_sale;
  end if;
  v_barrar := coalesce((select a.value -> 'conferenciaBarrar' = 'true'::jsonb
                          from public.app_data a
                         where a.tenant_id = p_tenant and a.key = 'cantina2:settings'), false);
  if v_barrar then
    raise exception 'venda_divergente' using errcode = '42501', detail = v_div::text;
  end if;
  insert into public.audit_log (actor_name, action, entity, entity_id, meta)
  values (nullif(left(coalesce(v_sale ->> 'operatorName', ''), 120), ''),
          'Venda com divergência', 'sale', p_sale_id,
          jsonb_build_object('divergencias', v_div));
  return v_sale || jsonb_build_object('conferencia', jsonb_build_object('em', now(), 'divergencias', v_div));
end;
$function$;
revoke all on function public.venda_conferencia_aplicar(text, text, jsonb, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- sales_apply e close_sale (corpo de 20261108000000 + item 4)
-- ---------------------------------------------------------------------
create or replace function public.sales_apply(p_upserts jsonb, p_delete_ids jsonb, p_bases jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant text := public.current_tenant_id();
  v_admin boolean := public.is_admin_like();
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_del jsonb := coalesce(p_delete_ids, '[]'::jsonb);
  v_bases jsonb := coalesce(p_bases, '{}'::jsonb);
  v_conf jsonb := '[]'::jsonb;
  v_written jsonb := '[]'::jsonb;
  v_rows jsonb;
  e jsonb;
  v_id text;
  v_cur jsonb;
  v_live boolean;
  v_found boolean;
  v_barrar boolean;
  v_div jsonb;
  v_credito numeric;
begin
  if v_tenant is null or not public.pode_vender() then
    raise exception 'sem permissao para gravar vendas';
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_del) <> 'array' or jsonb_typeof(v_bases) <> 'object'
     or jsonb_array_length(v_up) > 500 or jsonb_array_length(v_del) > 500 then
    raise exception 'vendas invalidas';
  end if;
  if exists (select 1 from jsonb_array_elements(v_up) x
              where jsonb_typeof(x) <> 'object' or coalesce(x->>'id', '') = '') then
    raise exception 'venda sem id';
  end if;
  -- 08/11 (pedido do dono): garçom não grava venda com pagamento 'fiado' (mesmo critério do
  -- close_sale e do methodBucket do site). Sem isso ele fecharia a comanda em fiado por aqui,
  -- sem lançamento no sócio. Venda fechada em dinheiro/cartão/pix continua passando.
  if public.current_staff_role() = 'garcom'
     and exists (select 1 from jsonb_array_elements(v_up) x,
                       jsonb_array_elements(case when jsonb_typeof(x->'payments') = 'array'
                                                 then x->'payments' else '[]'::jsonb end) p
                  where p->>'method' = 'fiado') then
    raise exception 'garcom nao fecha fiado' using errcode = '42501';
  end if;

  -- Item 4 (auditoria 11/11): barrar venda divergente? Lido uma vez para o lote inteiro.
  v_barrar := coalesce((select a.value -> 'conferenciaBarrar' = 'true'::jsonb
                          from public.app_data a
                         where a.tenant_id = v_tenant and a.key = 'cantina2:settings'), false);

  for e in select x from jsonb_array_elements(v_up) as t(x) loop
    v_id := e->>'id';
    v_cur := null; v_live := null;
    select s.data, (s.deleted_at is null) into v_cur, v_live
      from public.sales s
     where s.tenant_id = v_tenant and s.id = v_id
       for update;
    v_found := found;
    -- A4: venda fechada (mesmo apagada) só muda por dono/admin.
    if v_found and not v_admin and coalesce(v_cur->>'status', '') = 'closed' then
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', v_id, 'data', case when v_live then v_cur end, 'reason', 'fechada'));
      continue;
    end if;
    -- Trava de versão (20261011020000): a base que o aparelho leu tem que ser a atual.
    if v_bases ? v_id then
      if not (v_found and v_live) or v_cur is distinct from (v_bases->v_id) then
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', v_id, 'data', case when v_live then v_cur end));
        continue;
      end if;
    end if;
    -- Item 4 (auditoria 11/11): cancelar item que estava ativo (por lineId) ou a comanda
    -- inteira exige 'cancelar-comanda', como a tela. Volta como conflito; o lote continua.
    if public._venda_cancela(v_cur, e) and not public.tem_permissao('cancelar-comanda') then
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', v_id, 'data', case when v_live then v_cur end, 'reason', 'sem_permissao_cancelar'));
      continue;
    end if;
    -- Item 4 (auditoria 11/11): conferência da venda fechada. Com barrar ligado a venda
    -- divergente vira conflito (sem gravar) e o lote continua; desligado, grava com a marca
    -- e a linha no audit_log (venda_conferencia_aplicar). Sempre sem a marca do aparelho.
    v_credito := case when public._venda_conferivel(e)
                      then public._venda_credito_antes(v_tenant, v_id, e->>'memberId') else 0 end;
    if v_barrar and public._venda_conferivel(e) then
      v_div := public.venda_conferir(v_tenant, e - 'conferencia', v_credito);
      if jsonb_array_length(v_div) > 0 then
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', v_id, 'data', case when v_live then v_cur end,
                                                                 'reason', 'venda_divergente', 'divergencias', v_div));
        continue;
      end if;
      e := e - 'conferencia';
    else
      e := public.venda_conferencia_aplicar(v_tenant, v_id, e, v_credito);
    end if;
    insert into public.sales as s (tenant_id, id, data)
    values (v_tenant, v_id, e)
    on conflict (tenant_id, id) do update
      set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;
    v_written := v_written || to_jsonb(v_id);
  end loop;

  -- A4: venda fechada só sai por dono/admin; para os outros volta como conflito.
  if not v_admin then
    v_conf := v_conf || coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'data', s.data, 'reason', 'fechada'))
        from public.sales s
       where s.tenant_id = v_tenant and s.deleted_at is null
         and s.id in (select jsonb_array_elements_text(v_del))
         and coalesce(s.data->>'status', '') = 'closed'), '[]'::jsonb);
  end if;

  update public.sales
     set deleted_at = now(), updated_at = now(), version = version + 1
   where tenant_id = v_tenant
     and deleted_at is null
     and id in (select jsonb_array_elements_text(v_del))
     and (v_admin or coalesce(data->>'status', '') <> 'closed');

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'version', version, 'updated_at', updated_at)), '[]'::jsonb)
    into v_rows
    from public.sales
   where tenant_id = v_tenant
     and id in (select jsonb_array_elements_text(v_written) union select jsonb_array_elements_text(v_del));

  return jsonb_build_object('rows', v_rows, 'conflicts', v_conf, 'server_time', now());
end;
$function$
;
revoke all on function public.sales_apply(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.sales_apply(jsonb, jsonb, jsonb) to authenticated;

create or replace function public.close_sale(p_sale_id text, p_existing boolean, p_sale_patch jsonb, p_debt_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant text;
  v_result jsonb;
  v_current jsonb;
  v_sale jsonb;
  v_debt jsonb := coalesce(p_debt_entries, '[]'::jsonb);
  v_garcom boolean := public.current_staff_role() = 'garcom';
  v_credito numeric;
  v_credito_antes numeric;
begin
  if not public.pode_vender() then
    raise exception 'sem permissao para fechar venda';
  end if;

  -- 08/11 (pedido do dono): garçom não fecha fiado nem recebe pendência do sócio. O único
  -- lançamento aceito dele é o uso de crédito desta venda, como o finalizeSale do site monta
  -- (vendas/pagamento.js): id '<venda>-credito', type 'debt', sale_id da própria venda.
  -- Valor e sócio são conferidos mais abaixo, depois do recibo (nova tentativa não é recusada).
  if v_garcom and (
       jsonb_typeof(v_debt) <> 'array'
       or jsonb_array_length(v_debt) > 1
       or exists (select 1 from jsonb_array_elements(v_debt) e
                   where jsonb_typeof(e) <> 'object'
                      or e->>'id' is distinct from p_sale_id || '-credito'
                      or e->>'type' is distinct from 'debt'
                      or coalesce(nullif(e->>'sale_id', ''), p_sale_id) is distinct from p_sale_id)) then
    raise exception 'garcom nao fecha fiado' using errcode = '42501';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'sem tenant resolvido para o usuario atual';
  end if;

  if p_sale_id is null or length(p_sale_id) = 0 then
    raise exception 'p_sale_id obrigatorio';
  end if;

  if p_sale_patch is null or jsonb_typeof(p_sale_patch) <> 'object' then
    raise exception 'p_sale_patch deve ser um objeto JSON';
  end if;

  -- M9: lançamentos do sócio validados antes de gravar qualquer coisa.
  if jsonb_typeof(v_debt) <> 'array' or jsonb_array_length(v_debt) > 20 then
    raise exception 'lancamentos de fiado invalidos';
  end if;
  if exists (select 1 from jsonb_array_elements(v_debt) e
              where jsonb_typeof(e) <> 'object'
                 or coalesce(e->>'id', '') = '' or coalesce(e->>'member_id', '') = ''
                 or coalesce(e->>'type', '') not in ('debt', 'payment')
                 or jsonb_typeof(e->'value') <> 'number' or (e->>'value')::numeric <= 0) then
    raise exception 'lancamento de fiado invalido';
  end if;
  if exists (select 1 from jsonb_array_elements(v_debt) e
              where not exists (select 1 from public.members m where m.id = e->>'member_id' and m.tenant_id = v_tenant)) then
    raise exception 'socio do lancamento nao encontrado';
  end if;

  insert into public.sale_close_receipts (tenant_id, sale_id)
  values (v_tenant, p_sale_id)
  on conflict (tenant_id, sale_id) do nothing;

  select result into v_result
    from public.sale_close_receipts
   where tenant_id = v_tenant and sale_id = p_sale_id
   for update;

  if v_result is not null then
    return v_result; -- retry idempotente: ja foi processado (com os lancamentos), nao repete
  end if;

  select data into v_current
    from public.sales
   where tenant_id = v_tenant and id = p_sale_id and deleted_at is null
   for update;

  -- A4 (20261103000000): venda ja fechada sem recibo so e regravada por dono/admin.
  if v_current is not null and coalesce(v_current->>'status', '') = 'closed' and not public.is_admin_like() then
    raise exception 'esta venda ja esta fechada' using errcode = '42501';
  end if;

  if p_existing then
    if v_current is null then
      raise exception 'venda % nao encontrada para atualizar', p_sale_id;
    end if;
    v_sale := v_current || p_sale_patch || jsonb_build_object('id', p_sale_id);
  else
    v_sale := p_sale_patch || jsonb_build_object('id', p_sale_id);
  end if;

  -- 08/11 (pedido do dono): nem pagamento 'fiado' sem lançamento. Mesmo critério do
  -- methodBucket do site (assets/js/core/config.js): só method = 'fiado' cai no grupo fiado.
  -- Confere a venda já juntada, para pegar também os pagamentos que vieram da venda gravada.
  if v_garcom
     and exists (select 1 from jsonb_array_elements(
                   case when jsonb_typeof(v_sale->'payments') = 'array' then v_sale->'payments' else '[]'::jsonb end) p
                  where p->>'method' = 'fiado') then
    raise exception 'garcom nao fecha fiado' using errcode = '42501';
  end if;

  -- 08/11 (pedido do dono): o uso de crédito do garçom só consome crédito que o sócio da venda
  -- já tem (members.debt negativo = crédito, como memberAvailableCredit no site). Nunca cria
  -- nem aumenta dívida.
  if v_garcom and jsonb_array_length(v_debt) = 1 then
    if (v_debt->0->>'member_id') is distinct from (v_sale->>'memberId') then
      raise exception 'garcom nao fecha fiado' using errcode = '42501';
    end if;
    select greatest(0, -coalesce(m.debt, 0)) into v_credito
      from public.members m
     where m.id = v_debt->0->>'member_id' and m.tenant_id = v_tenant
       for update;
    if coalesce(v_credito, 0) + 0.005 < (v_debt->0->>'value')::numeric then
      raise exception 'garcom nao fecha fiado' using errcode = '42501';
    end if;
  end if;

  -- Item 4 (auditoria 11/11): cancelar item que estava ativo (por lineId) ou a venda inteira
  -- exige 'cancelar-comanda'. Compara a venda já juntada com a gravada.
  if public._venda_cancela(v_current, v_sale) and not public.tem_permissao('cancelar-comanda') then
    raise exception 'sem permissao para cancelar' using errcode = '42501';
  end if;

  -- Item 4 (auditoria 11/11): conferência da venda fechada, depois do recibo (nova tentativa
  -- devolve o resultado gravado sem conferir de novo) e antes de gravar venda e lançamentos.
  -- Crédito antes = saldo do sócio lido (for update) antes de inserir os lançamentos desta venda.
  -- Com barrar ligado, a exceção desfaz tudo, recibo incluído: a próxima tentativa confere de novo.
  v_credito_antes := case when public._venda_conferivel(v_sale)
                          then public._venda_credito_antes(v_tenant, p_sale_id, v_sale->>'memberId') else 0 end;
  v_sale := public.venda_conferencia_aplicar(v_tenant, p_sale_id, v_sale, v_credito_antes);

  insert into public.sales as s (tenant_id, id, data)
  values (v_tenant, p_sale_id, v_sale)
  on conflict (tenant_id, id) do update
    set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;

  -- M9: fiado/crédito da venda na mesma transação. O gatilho recalc_member_debt atualiza a dívida.
  insert into public.member_debt_entries (id, tenant_id, member_id, type, value, reason, info, method, sale_id, created_by, at)
  select e->>'id', v_tenant, e->>'member_id', e->>'type', (e->>'value')::numeric,
         nullif(e->>'reason', ''), nullif(e->>'info', ''), nullif(e->>'method', ''),
         coalesce(nullif(e->>'sale_id', ''), p_sale_id), nullif(e->>'created_by', ''),
         coalesce((e->>'at')::timestamptz, now())
    from jsonb_array_elements(v_debt) e
  on conflict (id) do nothing;

  update public.sale_close_receipts
     set result = v_sale
   where tenant_id = v_tenant and sale_id = p_sale_id;

  return v_sale;
end;
$function$
;
revoke all on function public.close_sale(text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.close_sale(text, boolean, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Receber fiado (item 4, auditoria 11/11): pagamento sem venda exige permissão
-- ---------------------------------------------------------------------
create or replace function public.member_debt_entries_guard_receber()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Só o recebimento avulso (Financeiro/fiado). Com sale_id é pendência paga no
  -- fechamento ou crédito de troco, que o close_sale grava; sem sessão é service_role.
  if new.type = 'payment' and nullif(new.sale_id, '') is null and auth.uid() is not null then
    if not (coalesce(public.tem_permissao('receber-fiado'), false) or coalesce(public.tem_permissao('contas'), false)) then
      raise exception 'sem permissao para receber fiado' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.member_debt_entries_guard_receber() from public, anon, authenticated;

drop trigger if exists trg_member_debt_entries_guard_receber on public.member_debt_entries;
create trigger trg_member_debt_entries_guard_receber
  before insert on public.member_debt_entries
  for each row execute function public.member_debt_entries_guard_receber();

-- ROLLBACK da parte 3 (manual):
--   drop trigger if exists trg_member_debt_entries_guard_receber on public.member_debt_entries;
--   drop function if exists public.member_debt_entries_guard_receber();
--   recriar sales_apply(jsonb, jsonb, jsonb) e close_sale(text, boolean, jsonb, jsonb) de
--     20261108000000_perfil_garcom.sql (com os mesmos revoke/grant de cima);
--   drop function if exists public.venda_conferencia_aplicar(text, text, jsonb, numeric),
--     public._venda_credito_antes(text, text, text), public._venda_cancela(jsonb, jsonb),
--     public._venda_conferivel(jsonb);
