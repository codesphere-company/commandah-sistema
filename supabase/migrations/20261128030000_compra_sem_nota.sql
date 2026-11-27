-- =====================================================================
-- 20261128030000_compra_sem_nota.sql — t-semnota (27/11/2026)
-- Compra sem nota: fornecedor que não emite NF-e (feirante, produtor, padaria do bairro). A dona lança à mão
-- na tela Notas de compra e a compra passa pelas mesmas etapas da nota (conferida, contabilidade, pagamento,
-- estoque). Desenho: docs/superpowers/specs/2026-11-27-compra-sem-nota-design.md.
--
-- notas_entrada ganha:
--   origem 'sem_nota'   chave gerada aqui ('SN' + 32 hex), sem XML; dados no mesmo formato do NotaLida
--                       (itens com codigo = nome do item normalizado, que é o que o vínculo lembra).
--   fornecedor_id       id do fornecedor do blob cantina2:fornecedores (compra sem nota; fornecedor sem CNPJ).
--   recibo              foto do recibo reduzida no aparelho (data:image/jpeg;base64,...), lida só ao abrir.
-- O vínculo (fornecedor + código) usa o CNPJ/CPF quando há; sem documento, 'F:' + fornecedor_id. Por isso
-- notas_entrada_estoque é recriada com essa chave (antes: coalesce(emitente_cnpj, '')).
-- notas_entrada_config_salvar é recriada para a data de início não reclassificar compra sem nota (ela é
-- lançada por quem compra; nunca é "tratada fora").
-- =====================================================================

alter table public.notas_entrada drop constraint if exists notas_entrada_chave_check;
alter table public.notas_entrada add constraint notas_entrada_chave_check
  check (chave ~ '^[0-9]{44}$' or chave ~ '^SN[0-9a-f]{32}$');
alter table public.notas_entrada drop constraint if exists notas_entrada_origem_check;
alter table public.notas_entrada add constraint notas_entrada_origem_check
  check (origem in ('brasilnfe', 'xml_manual', 'sem_nota'));
alter table public.notas_entrada add column if not exists fornecedor_id text check (fornecedor_id is null or length(fornecedor_id) <= 120);
alter table public.notas_entrada add column if not exists recibo text
  check (recibo is null or (length(recibo) <= 700000 and recibo ~ '^data:image/(jpeg|png|webp);base64,'));

-- Chave do fornecedor nos vínculos (a mesma conta é feita no site: ncChaveForn em gestao/notas-compra.js).
create or replace function public.notas_entrada_chave_forn(p_cnpj text, p_fornecedor text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select coalesce(nullif(p_cnpj, ''), case when coalesce(p_fornecedor, '') <> '' then 'F:' || p_fornecedor end, '');
$function$;
revoke all on function public.notas_entrada_chave_forn(text, text) from public, anon;
grant execute on function public.notas_entrada_chave_forn(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Lançar ou corrigir uma compra sem nota (exige "contas" ou "insumos").
-- p_chave null = nova (devolve a chave gerada). Com chave: só corrige se for sem_nota e nenhuma etapa
-- tiver sido feita (depois do Confirmar, a correção é desfazer a entrada e lançar de novo).
-- p_dados: { fornecedor:{id, nome, documento, fone}, numero, data:'AAAA-MM-DD',
--            itens:[{codigo, nome, unidade, qtd, custoTotal}] }  (1 a 200 itens)
-- p_recibo: data URL da foto ou null; p_manter_recibo = true mantém a foto gravada (correção sem foto nova).
-- ---------------------------------------------------------------------
create or replace function public.notas_entrada_sem_nota_salvar(p_chave text, p_dados jsonb, p_recibo text, p_manter_recibo boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_f jsonb := v_d->'fornecedor';
  v_doc text := nullif(regexp_replace(coalesce(v_d->'fornecedor'->>'documento', ''), '\D', '', 'g'), '');
  v_fid text := left(coalesce(v_d->'fornecedor'->>'id', ''), 120);
  v_nome text := left(btrim(coalesce(v_d->'fornecedor'->>'nome', '')), 120);
  v_data date;
  v_itens jsonb;
  v_valor numeric;
  v_dados jsonb;
  v_nota public.notas_entrada%rowtype;
  v_chave text;
begin
  if v_tenant is null or not (public.tem_permissao('contas') or public.tem_permissao('insumos')) then
    raise exception 'sem permissao para lancar compra sem nota';
  end if;
  if jsonb_typeof(v_d) <> 'object' or jsonb_typeof(v_f) is distinct from 'object' or v_fid = '' or v_nome = '' then
    raise exception 'fornecedor obrigatorio';
  end if;
  if v_doc is not null and length(v_doc) not in (11, 14) then
    raise exception 'documento do fornecedor invalido (CPF 11 ou CNPJ 14 digitos)';
  end if;
  begin
    v_data := (v_d->>'data')::date;
  exception when others then
    raise exception 'data da compra invalida';
  end;
  if v_data is null or v_data > (now() at time zone 'America/Sao_Paulo')::date + 1 or v_data < date '2020-01-01' then
    raise exception 'data da compra invalida';
  end if;
  if jsonb_typeof(v_d->'itens') is distinct from 'array' or jsonb_array_length(v_d->'itens') = 0
     or jsonb_array_length(v_d->'itens') > 200 then
    raise exception 'itens invalidos (de 1 a 200)';
  end if;
  if exists (select 1 from jsonb_array_elements(v_d->'itens') x
              where jsonb_typeof(x) <> 'object'
                 or btrim(coalesce(x->>'nome', '')) = '' or btrim(coalesce(x->>'codigo', '')) = ''
                 or jsonb_typeof(x->'qtd') <> 'number' or public.jsonb_num(x->'qtd') <= 0
                 or jsonb_typeof(x->'custoTotal') <> 'number' or public.jsonb_num(x->'custoTotal') < 0) then
    raise exception 'item invalido (nome, quantidade maior que zero e valor)';
  end if;
  if p_recibo is not null and (length(p_recibo) > 700000 or p_recibo !~ '^data:image/(jpeg|png|webp);base64,') then
    raise exception 'foto do recibo invalida ou grande demais';
  end if;

  -- Itens no formato do NotaLida (o que a tela da nota aberta lê), numerados na ordem.
  select jsonb_agg(jsonb_build_object(
           'n', e.ord, 'codigo', left(btrim(e.x->>'codigo'), 120), 'ean', null,
           'nome', left(btrim(e.x->>'nome'), 120), 'ncm', '', 'cfop', '',
           'unidade', left(upper(btrim(coalesce(e.x->>'unidade', 'UN'))), 10),
           'qtd', public.jsonb_num(e.x->'qtd'),
           'valorUnit', round(public.jsonb_num(e.x->'custoTotal') / public.jsonb_num(e.x->'qtd'), 6),
           'custoTotal', round(public.jsonb_num(e.x->'custoTotal'), 2)) order by e.ord),
         round(sum(public.jsonb_num(e.x->'custoTotal')), 2)
    into v_itens, v_valor
    from jsonb_array_elements(v_d->'itens') with ordinality as e(x, ord);

  if p_chave is null then
    v_chave := 'SN' || replace(gen_random_uuid()::text, '-', '');
  else
    select * into v_nota from public.notas_entrada where tenant_id = v_tenant and chave = p_chave for update;
    if v_nota.id is null or v_nota.origem <> 'sem_nota' then
      raise exception 'compra sem nota nao encontrada';
    end if;
    if v_nota.conferida_em is not null or v_nota.pagamento_em is not null or v_nota.estoque_em is not null
       or v_nota.contabilidade_em is not null then
      raise exception 'compra ja tratada: desfaca a entrada antes de corrigir';
    end if;
    v_chave := p_chave;
  end if;

  v_dados := jsonb_build_object(
    'chave', v_chave, 'modelo', null, 'numero', left(btrim(coalesce(v_d->>'numero', '')), 30), 'serie', '',
    'emissao', to_char(v_data, 'YYYY-MM-DD'), 'valor', v_valor,
    'emitente', jsonb_build_object('cnpj', coalesce(v_doc, ''), 'nome', v_nome, 'fantasia', '', 'ie', '',
                                   'fone', left(coalesce(v_f->>'fone', ''), 30), 'endereco', ''),
    'destinatarioCnpj', null, 'itens', v_itens, 'duplicatas', '[]'::jsonb, 'fornecedorId', v_fid);

  insert into public.notas_entrada (tenant_id, chave, origem, modelo, numero, serie, emitente_cnpj, emitente_nome,
                                    emissao, valor, situacao, fora, dados, fornecedor_id, recibo)
  values (v_tenant, v_chave, 'sem_nota', null, nullif(v_dados->>'numero', ''), null, v_doc, v_nome,
          (v_data::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo', v_valor, 'completa', false,
          v_dados, v_fid, p_recibo)
  on conflict (tenant_id, chave) do update
    set numero = excluded.numero, emitente_cnpj = excluded.emitente_cnpj, emitente_nome = excluded.emitente_nome,
        emissao = excluded.emissao, valor = excluded.valor, dados = excluded.dados, fornecedor_id = excluded.fornecedor_id,
        recibo = case when coalesce(p_manter_recibo, false) and excluded.recibo is null
                      then public.notas_entrada.recibo else excluded.recibo end;

  return jsonb_build_object('ok', true, 'chave', v_chave);
end;
$function$;
revoke all on function public.notas_entrada_sem_nota_salvar(text, jsonb, text, boolean) from public, anon;
grant execute on function public.notas_entrada_sem_nota_salvar(text, jsonb, text, boolean) to authenticated;

-- Excluir uma compra sem nota lançada errado (contas ou insumos), só antes de qualquer etapa.
create or replace function public.notas_entrada_sem_nota_excluir(p_chave text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_nota public.notas_entrada%rowtype;
begin
  if v_tenant is null or not (public.tem_permissao('contas') or public.tem_permissao('insumos')) then
    raise exception 'sem permissao para excluir compra sem nota';
  end if;
  select * into v_nota from public.notas_entrada where tenant_id = v_tenant and chave = p_chave for update;
  if v_nota.id is null or v_nota.origem <> 'sem_nota' then
    raise exception 'compra sem nota nao encontrada';
  end if;
  if v_nota.conferida_em is not null or v_nota.pagamento_em is not null or v_nota.estoque_em is not null
     or v_nota.contabilidade_em is not null then
    raise exception 'compra ja tratada: desfaca a entrada antes de excluir';
  end if;
  delete from public.notas_entrada where id = v_nota.id;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.notas_entrada_sem_nota_excluir(text) from public, anon;
grant execute on function public.notas_entrada_sem_nota_excluir(text) to authenticated;

-- ---------------------------------------------------------------------
-- notas_entrada_estoque: igual à de 20261128000000, só muda a chave do fornecedor no vínculo
-- (notas_entrada_chave_forn: CNPJ/CPF, senão 'F:' + fornecedor_id da compra sem nota).
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
  if v_nota.situacao = 'resumo' then
    raise exception 'nota so com resumo (sem itens): espere o XML';
  end if;

  if jsonb_array_length(v_up) > 0 or v_deltas <> '{}'::jsonb then
  v_up := coalesce((select jsonb_agg(case when jsonb_typeof(x) = 'object' then x || '{"stock":0}'::jsonb else x end)
                      from jsonb_array_elements(v_up) x), '[]'::jsonb);
  v_lista := public.insumos_apply(v_up, '{}'::jsonb, '[]'::jsonb);

  select d.key into v_falta from jsonb_each(v_deltas) d
   where not exists (select 1 from jsonb_array_elements(v_lista) e where e->>'id' = d.key)
   limit 1;
  if v_falta is not null then
    raise exception 'insumo inexistente: %', v_falta;
  end if;

  v_lista := public.insumos_apply(
    coalesce((select jsonb_agg(jsonb_build_object('id', d.key)) from jsonb_each(v_deltas) d), '[]'::jsonb),
    v_deltas, '[]'::jsonb);
  end if;

  insert into public.notas_entrada_vinculos (tenant_id, emitente_cnpj, codigo, tipo, insumo_id, produto_id, tamanho_id, fator, atualizado_em)
  select v_tenant, public.notas_entrada_chave_forn(v_nota.emitente_cnpj, v_nota.fornecedor_id), left(v->>'codigo', 120), v->>'tipo',
         left(v->>'insumo_id', 120), left(v->>'produto_id', 120), left(v->>'tamanho_id', 120),
         coalesce(nullif(public.jsonb_num(v->'fator'), 0), 1), now()
    from (select distinct on (x->>'codigo') x as v
            from jsonb_array_elements(v_vin) with ordinality as e(x, ord)
           order by x->>'codigo', ord desc) u
  on conflict (tenant_id, emitente_cnpj, codigo) do update
    set tipo = excluded.tipo, insumo_id = excluded.insumo_id, produto_id = excluded.produto_id,
        tamanho_id = excluded.tamanho_id, fator = excluded.fator, atualizado_em = now();

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
-- notas_entrada_config_salvar: igual à de 20261128000000, mas a reclassificação pela data de início
-- não mexe em compra sem nota.
-- ---------------------------------------------------------------------
create or replace function public.notas_entrada_config_salvar(p_busca_ligada boolean, p_inicio date, p_categorias jsonb, p_cnpj text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_row public.notas_entrada_config%rowtype;
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
begin
  if v_tenant is null or coalesce(public.current_staff_role(), '') not in ('owner', 'admin') then
    raise exception 'sem permissao para configurar notas de compra';
  end if;
  if p_cnpj is not null and (v_cnpj is null or v_cnpj !~ '^\d{14}$') then
    raise exception 'cnpj invalido (precisa de 14 digitos)';
  end if;
  if p_categorias is not null and jsonb_typeof(p_categorias) <> 'object' then
    raise exception 'categorias invalidas';
  end if;
  insert into public.notas_entrada_config (tenant_id, busca_ligada, inicio, categorias, cnpj)
  values (v_tenant, coalesce(p_busca_ligada, false), p_inicio, coalesce(p_categorias, '{}'::jsonb), v_cnpj)
  on conflict (tenant_id) do update
    set busca_ligada = coalesce(p_busca_ligada, public.notas_entrada_config.busca_ligada),
        inicio = p_inicio,
        categorias = coalesce(p_categorias, public.notas_entrada_config.categorias),
        cnpj = coalesce(v_cnpj, public.notas_entrada_config.cnpj)
  returning * into v_row;
  update public.notas_entrada
     set fora = (v_row.inicio is not null and emissao is not null
                 and (emissao at time zone 'America/Sao_Paulo')::date < v_row.inicio)
   where tenant_id = v_tenant and origem <> 'sem_nota'
     and conferida_em is null and pagamento_em is null and estoque_em is null and contabilidade_em is null;
  return to_jsonb(v_row);
end;
$function$;
revoke all on function public.notas_entrada_config_salvar(boolean, date, jsonb, text) from public, anon;
grant execute on function public.notas_entrada_config_salvar(boolean, date, jsonb, text) to authenticated;

-- =====================================================================
-- ROLLBACK (manual): reaplicar as duas funções de 20261128000000 e
-- drop function if exists public.notas_entrada_sem_nota_excluir(text);
-- drop function if exists public.notas_entrada_sem_nota_salvar(text, jsonb, text, boolean);
-- drop function if exists public.notas_entrada_chave_forn(text, text);
-- delete from public.notas_entrada where origem = 'sem_nota';
-- alter table public.notas_entrada drop column if exists recibo, drop column if exists fornecedor_id;
-- (e voltar os checks de chave e origem)
-- =====================================================================
