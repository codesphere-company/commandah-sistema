-- =====================================================================
-- 20261128000000_notas_entrada.sql — t-notas, tarefa 2 (27/11/2026)
-- Notas de compra (NF-e de entrada): tabelas, RPCs e permissões.
-- Desenho: docs/superpowers/specs/2026-11-27-notas-de-compra-design.md.
-- =====================================================================
-- notas_entrada           uma linha por nota, por estabelecimento. Quem grava a nota é a Edge Function
--                         notas-entrada (service role): busca na Brasil NFe ou XML importado à mão.
--                         `dados` guarda o NotaLida de supabase/functions/notas-entrada/ler-xml.ts.
-- notas_entrada_vinculos  a memória "este código deste fornecedor é tal insumo/produto" (fator = unidades
--                         de estoque por unidade da nota).
-- notas_entrada_config    por estabelecimento: trava da equipe (`liberada`, só pelo CLI) e escolhas do
--                         administrador (busca ligada, início, categoria de conta lembrada por CNPJ).
--
-- Ler (RLS): o próprio estabelecimento, para dono/admin e colaborador com "contas" ou "insumos" (a tela
-- aparece para os dois; a config é lida porque a tela precisa das categorias). Gravar: nunca direto pelo
-- authenticated; só pelas RPCs abaixo e pela service role.
--
-- Entrada no estoque passa por insumos_apply (por diferença, com trava na linha, BD-10): a venda feita
-- entre a leitura da nota e a confirmação não é desfeita, e a mesma nota não entra duas vezes (estoque_em).
-- =====================================================================

create table if not exists public.notas_entrada (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null references public.tenant_owners(tenant_id) on delete cascade,
  chave                 text not null check (chave ~ '^[0-9]{44}$'),
  origem                text not null check (origem in ('brasilnfe', 'xml_manual')),
  modelo                int,
  numero                text,
  serie                 text,
  emitente_cnpj         text,
  emitente_nome         text,
  emissao               timestamptz,
  valor                 numeric,
  situacao              text not null check (situacao in ('resumo', 'completa', 'cancelada')),
  fora                  boolean not null default false,
  aviso                 text,
  xml                   text,
  dados                 jsonb,
  conferida_em          timestamptz,
  conferida_por         text,
  contabilidade_em      timestamptz,
  contabilidade_por     text,
  contabilidade_obs     text,
  pagamento_em          timestamptz,
  pagamento_por         text,
  pagamento_contas      jsonb,
  estoque_em            timestamptz,
  estoque_por           text,
  estoque_deltas        jsonb,
  estoque_desfeito_em   timestamptz,
  estoque_desfeito_por  text,
  criada_em             timestamptz not null default now(),
  unique (tenant_id, chave)
);
create index if not exists idx_notas_entrada_emissao on public.notas_entrada (tenant_id, emissao desc);

create table if not exists public.notas_entrada_vinculos (
  tenant_id      text not null references public.tenant_owners(tenant_id) on delete cascade,
  emitente_cnpj  text not null,
  codigo         text not null,
  tipo           text not null check (tipo in ('insumo', 'revenda', 'fora')),
  insumo_id      text,
  produto_id     text,
  tamanho_id     text,
  fator          numeric not null default 1 check (fator > 0),
  atualizado_em  timestamptz not null default now(),
  primary key (tenant_id, emitente_cnpj, codigo)
);

create table if not exists public.notas_entrada_config (
  tenant_id        text primary key references public.tenant_owners(tenant_id) on delete cascade,
  liberada         boolean not null default false,
  busca_ligada     boolean not null default false,
  inicio           date,
  ultima_busca_ok  timestamptz,
  ultimo_erro      text,
  categorias       jsonb not null default '{}'::jsonb check (jsonb_typeof(categorias) = 'object')
);

alter table public.notas_entrada enable row level security;
alter table public.notas_entrada_vinculos enable row level security;
alter table public.notas_entrada_config enable row level security;
revoke all on public.notas_entrada, public.notas_entrada_vinculos, public.notas_entrada_config from public, anon, authenticated;
grant select on public.notas_entrada, public.notas_entrada_vinculos, public.notas_entrada_config to authenticated;
grant select, insert, update, delete on public.notas_entrada, public.notas_entrada_vinculos, public.notas_entrada_config to service_role;

-- tem_permissao já devolve true para dono e admin.
drop policy if exists notas_entrada_ler on public.notas_entrada;
create policy notas_entrada_ler on public.notas_entrada
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.tem_permissao('contas')) or (select public.tem_permissao('insumos'))));

drop policy if exists notas_entrada_vinculos_ler on public.notas_entrada_vinculos;
create policy notas_entrada_vinculos_ler on public.notas_entrada_vinculos
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.tem_permissao('contas')) or (select public.tem_permissao('insumos'))));

drop policy if exists notas_entrada_config_ler on public.notas_entrada_config;
create policy notas_entrada_config_ler on public.notas_entrada_config
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and ((select public.tem_permissao('contas')) or (select public.tem_permissao('insumos'))));

-- ---------------------------------------------------------------------
-- Entrada no estoque (exige "insumos").
-- p_upserts: insumos novos e campos mudados dos existentes (como insumos_apply);
-- p_deltas:  {insumoId: quanto entra} (> 0); p_vinculos: [{codigo, tipo, insumo_id, produto_id, tamanho_id, fator}].
-- Insumo novo nasce com estoque 0 e recebe o delta: assim estoque_deltas é exatamente o que entrou
-- e o "desfazer" volta certo (insumos_apply sozinho não aplica delta em insumo novo).
-- Nota que já teve entrada devolve {ja:true} sem mexer em nada (toque duplo, nova tentativa).
-- ---------------------------------------------------------------------
create or replace function public.notas_entrada_estoque(p_chave text, p_upserts jsonb, p_deltas jsonb, p_vinculos jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_nota public.notas_entrada%rowtype;
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_deltas jsonb := coalesce(p_deltas, '{}'::jsonb);
  v_vin jsonb := coalesce(p_vinculos, '[]'::jsonb);
  v_lista jsonb;
  v_falta text;
begin
  if v_tenant is null or not public.tem_permissao('insumos') then
    raise exception 'sem permissao para dar entrada de nota no estoque';
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_deltas) <> 'object' or jsonb_typeof(v_vin) <> 'array'
     or jsonb_array_length(v_vin) > 1000 then
    raise exception 'dados da entrada invalidos';
  end if;
  if exists (select 1 from jsonb_each(v_deltas) d
              where jsonb_typeof(d.value) <> 'number' or public.jsonb_num(d.value) <= 0) then
    raise exception 'delta de entrada invalido (tem que ser maior que zero)';
  end if;
  if exists (select 1 from jsonb_array_elements(v_vin) v
              where jsonb_typeof(v) <> 'object' or coalesce(v->>'codigo', '') = ''
                 or coalesce(v->>'tipo', '') not in ('insumo', 'revenda', 'fora')
                 or (v ? 'fator' and (jsonb_typeof(v->'fator') <> 'number' or public.jsonb_num(v->'fator') <= 0))) then
    raise exception 'vinculo invalido';
  end if;

  select * into v_nota from public.notas_entrada
   where tenant_id = v_tenant and chave = p_chave
   for update;
  if v_nota.id is null then
    raise exception 'nota nao encontrada';
  end if;
  if v_nota.estoque_em is not null then
    return jsonb_build_object('ja', true);
  end if;
  if v_nota.fora then
    raise exception 'nota marcada como fora do estoque';
  end if;
  if v_nota.situacao = 'cancelada' then
    raise exception 'nota cancelada';
  end if;
  -- Decisão do Claude (não estava no plano): resumo ainda não tem itens (o XML não chegou).
  if v_nota.situacao = 'resumo' then
    raise exception 'nota so com resumo (sem itens): espere o XML';
  end if;

  -- 1) Cadastro: insumos novos com estoque 0; dos existentes, insumos_apply já ignora "stock".
  v_up := coalesce((select jsonb_agg(case when jsonb_typeof(x) = 'object' then x || '{"stock":0}'::jsonb else x end)
                      from jsonb_array_elements(v_up) x), '[]'::jsonb);
  v_lista := public.insumos_apply(v_up, '{}'::jsonb, '[]'::jsonb);

  -- 2) Todo delta precisa ser de insumo que existe (senão sumiria calado e o desfazer ficaria errado).
  select d.key into v_falta from jsonb_each(v_deltas) d
   where not exists (select 1 from jsonb_array_elements(v_lista) e where e->>'id' = d.key)
   limit 1;
  if v_falta is not null then
    raise exception 'insumo inexistente: %', v_falta;
  end if;

  -- 3) Estoque = atual + delta, com a trava de insumos_apply (que só aplica delta de insumo listado
  --    em p_upserts: vai {id} sozinho, sem outro campo, para não mexer no cadastro).
  v_lista := public.insumos_apply(
    coalesce((select jsonb_agg(jsonb_build_object('id', d.key)) from jsonb_each(v_deltas) d), '[]'::jsonb),
    v_deltas, '[]'::jsonb);

  insert into public.notas_entrada_vinculos (tenant_id, emitente_cnpj, codigo, tipo, insumo_id, produto_id, tamanho_id, fator, atualizado_em)
  select v_tenant, coalesce(v_nota.emitente_cnpj, ''), left(v->>'codigo', 120), v->>'tipo',
         left(v->>'insumo_id', 120), left(v->>'produto_id', 120), left(v->>'tamanho_id', 120),
         coalesce(nullif(public.jsonb_num(v->'fator'), 0), 1), now()
    from (select distinct on (x->>'codigo') x as v  -- mesmo código duas vezes: vale o último
            from jsonb_array_elements(v_vin) with ordinality as e(x, ord)
           order by x->>'codigo', ord desc) u
  on conflict (tenant_id, emitente_cnpj, codigo) do update
    set tipo = excluded.tipo, insumo_id = excluded.insumo_id, produto_id = excluded.produto_id,
        tamanho_id = excluded.tamanho_id, fator = excluded.fator, atualizado_em = now();

  -- Nova entrada depois de um "desfazer" (vínculo errado corrigido) limpa a marca do desfazer,
  -- para poder desfazer de novo se precisar.
  update public.notas_entrada
     set estoque_em = now(), estoque_por = coalesce(public.current_staff_id(), 'dono'), estoque_deltas = v_deltas,
         estoque_desfeito_em = null, estoque_desfeito_por = null
   where id = v_nota.id;

  return jsonb_build_object('ok', true, 'insumos', v_lista);
end;
$function$;
revoke all on function public.notas_entrada_estoque(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.notas_entrada_estoque(text, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Desfazer a entrada (exige "insumos"): aplica o delta contrário por insumos_apply (a venda feita
-- depois da entrada continua baixada). Usado quando o fornecedor cancela a nota depois da entrada,
-- por isso aceita nota cancelada. Segunda vez devolve {ja:true}.
-- ---------------------------------------------------------------------
create or replace function public.notas_entrada_desfazer_estoque(p_chave text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_nota public.notas_entrada%rowtype;
  v_contra jsonb;
  v_lista jsonb;
begin
  if v_tenant is null or not public.tem_permissao('insumos') then
    raise exception 'sem permissao para desfazer entrada de nota';
  end if;
  select * into v_nota from public.notas_entrada
   where tenant_id = v_tenant and chave = p_chave
   for update;
  if v_nota.id is null then
    raise exception 'nota nao encontrada';
  end if;
  if v_nota.estoque_em is null and v_nota.estoque_desfeito_em is not null then
    return jsonb_build_object('ja', true);
  end if;
  if v_nota.estoque_em is null then
    raise exception 'nota sem entrada no estoque';
  end if;

  select coalesce(jsonb_object_agg(d.key, -((d.value #>> '{}')::numeric)), '{}'::jsonb) into v_contra
    from jsonb_each(coalesce(v_nota.estoque_deltas, '{}'::jsonb)) d
   where jsonb_typeof(d.value) = 'number';
  v_lista := public.insumos_apply(
    coalesce((select jsonb_agg(jsonb_build_object('id', d.key)) from jsonb_each(v_contra) d), '[]'::jsonb),
    v_contra, '[]'::jsonb);

  update public.notas_entrada
     set estoque_em = null, estoque_por = null,
         estoque_desfeito_em = now(), estoque_desfeito_por = coalesce(public.current_staff_id(), 'dono')
   where id = v_nota.id;

  return jsonb_build_object('ok', true, 'insumos', v_lista);
end;
$function$;
revoke all on function public.notas_entrada_desfazer_estoque(text) from public, anon;
grant execute on function public.notas_entrada_desfazer_estoque(text) to authenticated;

-- ---------------------------------------------------------------------
-- Etapas: 'conferida' (contas ou insumos), 'contabilidade' (contas; p_dados.obs),
-- 'pagamento' (contas; p_dados.contas = ids das contas criadas pela tela).
-- Idempotente: a segunda marcação não troca quem/quando (nem as contas/obs) — devolve ja:true.
-- ---------------------------------------------------------------------
create or replace function public.notas_entrada_marcar(p_chave text, p_etapa text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_nota public.notas_entrada%rowtype;
  v_dados jsonb := coalesce(p_dados, '{}'::jsonb);
  v_quem text := coalesce(public.current_staff_id(), 'dono');
begin
  if p_etapa is null or p_etapa not in ('conferida', 'contabilidade', 'pagamento') then
    raise exception 'etapa invalida';
  end if;
  if v_tenant is null
     or (p_etapa = 'conferida' and not (public.tem_permissao('contas') or public.tem_permissao('insumos')))
     or (p_etapa in ('contabilidade', 'pagamento') and not public.tem_permissao('contas')) then
    raise exception 'sem permissao para marcar % na nota', p_etapa;
  end if;
  if jsonb_typeof(v_dados) <> 'object' then
    raise exception 'dados invalidos';
  end if;
  if p_etapa = 'pagamento' and (jsonb_typeof(v_dados->'contas') is distinct from 'array'
       or jsonb_array_length(v_dados->'contas') > 200
       or exists (select 1 from jsonb_array_elements(v_dados->'contas') x where jsonb_typeof(x) <> 'string')) then
    raise exception 'contas invalidas (lista de ids)';
  end if;

  select * into v_nota from public.notas_entrada
   where tenant_id = v_tenant and chave = p_chave
   for update;
  if v_nota.id is null then
    raise exception 'nota nao encontrada';
  end if;

  if p_etapa = 'conferida' then
    if v_nota.conferida_em is not null then return jsonb_build_object('ok', true, 'ja', true); end if;
    update public.notas_entrada set conferida_em = now(), conferida_por = v_quem where id = v_nota.id;
  elsif p_etapa = 'contabilidade' then
    if v_nota.contabilidade_em is not null then return jsonb_build_object('ok', true, 'ja', true); end if;
    update public.notas_entrada
       set contabilidade_em = now(), contabilidade_por = v_quem, contabilidade_obs = left(v_dados->>'obs', 500)
     where id = v_nota.id;
  else
    if v_nota.pagamento_em is not null then return jsonb_build_object('ok', true, 'ja', true); end if;
    update public.notas_entrada
       set pagamento_em = now(), pagamento_por = v_quem, pagamento_contas = v_dados->'contas'
     where id = v_nota.id;
  end if;
  return jsonb_build_object('ok', true, 'ja', false);
end;
$function$;
revoke all on function public.notas_entrada_marcar(text, text, jsonb) from public, anon;
grant execute on function public.notas_entrada_marcar(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Configuração do administrador (só dono/admin). Não mexe em `liberada` (trava da equipe).
-- p_categorias null mantém as que estão gravadas.
-- ---------------------------------------------------------------------
create or replace function public.notas_entrada_config_salvar(p_busca_ligada boolean, p_inicio date, p_categorias jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_row public.notas_entrada_config%rowtype;
begin
  if v_tenant is null or coalesce(public.current_staff_role(), '') not in ('owner', 'admin') then
    raise exception 'sem permissao para configurar notas de compra';
  end if;
  if p_categorias is not null and jsonb_typeof(p_categorias) <> 'object' then
    raise exception 'categorias invalidas';
  end if;
  insert into public.notas_entrada_config (tenant_id, busca_ligada, inicio, categorias)
  values (v_tenant, coalesce(p_busca_ligada, false), p_inicio, coalesce(p_categorias, '{}'::jsonb))
  on conflict (tenant_id) do update
    set busca_ligada = coalesce(p_busca_ligada, public.notas_entrada_config.busca_ligada),
        inicio = p_inicio,
        categorias = coalesce(p_categorias, public.notas_entrada_config.categorias)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;
revoke all on function public.notas_entrada_config_salvar(boolean, date, jsonb) from public, anon;
grant execute on function public.notas_entrada_config_salvar(boolean, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Trava da equipe Commandah (pelo CLI, como nfce_liberar_producao): só service role.
-- ---------------------------------------------------------------------
create or replace function public.notas_entrada_liberar(p_tenant text, p_on boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.tenant_owners where tenant_id = p_tenant) then
    raise exception 'estabelecimento inexistente: %', p_tenant;
  end if;
  insert into public.notas_entrada_config (tenant_id, liberada)
  values (p_tenant, coalesce(p_on, false))
  on conflict (tenant_id) do update set liberada = coalesce(p_on, false);
end;
$function$;
revoke all on function public.notas_entrada_liberar(text, boolean) from public, anon, authenticated;
grant execute on function public.notas_entrada_liberar(text, boolean) to service_role;

-- =====================================================================
-- ROLLBACK (manual)
-- =====================================================================
-- drop function if exists public.notas_entrada_liberar(text, boolean);
-- drop function if exists public.notas_entrada_config_salvar(boolean, date, jsonb);
-- drop function if exists public.notas_entrada_marcar(text, text, jsonb);
-- drop function if exists public.notas_entrada_desfazer_estoque(text);
-- drop function if exists public.notas_entrada_estoque(text, jsonb, jsonb, jsonb);
-- drop table if exists public.notas_entrada_config;
-- drop table if exists public.notas_entrada_vinculos;
-- drop table if exists public.notas_entrada;
