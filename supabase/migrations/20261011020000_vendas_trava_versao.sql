-- =====================================================================
-- 20261011020000_vendas_trava_versao.sql — dois aparelhos na mesma venda
-- =====================================================================
-- O PROBLEMA (limite conhecido desde o EST-01)
-- --------------------------------------------
-- sales_apply grava a venda inteira por cima: se dois aparelhos mexem na MESMA
-- comanda ao mesmo tempo (ex.: garçom lança um item enquanto o caixa cancela
-- outro), vale a última gravação e a mudança do outro aparelho some.
--
-- A SOLUCAO
-- ---------
-- Nova versão sales_apply(p_upserts, p_delete_ids, p_bases): para cada venda, o
-- aparelho manda também a versão que ele tinha lido (p_bases = {id: data}). Se a
-- linha no banco não é mais essa, a venda NÃO é gravada e volta em "conflicts"
-- com a versão atual; o site junta as duas mudanças (itens por chave) e grava de
-- novo. Venda nova (sem base) grava como antes. A versão de 2 argumentos continua
-- existindo para aparelho com o site antigo aberto.
-- =====================================================================

create or replace function public.sales_apply(p_upserts jsonb, p_delete_ids jsonb, p_bases jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_up jsonb := coalesce(p_upserts, '[]'::jsonb);
  v_del jsonb := coalesce(p_delete_ids, '[]'::jsonb);
  v_bases jsonb := coalesce(p_bases, '{}'::jsonb);
  v_conf jsonb := '[]'::jsonb;
  v_written jsonb := '[]'::jsonb;
  v_rows jsonb;
  e jsonb;
  v_id text;
  v_cur jsonb;
  v_found boolean;
begin
  if v_tenant is null or not public.cash_can_write() then
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

  for e in select x from jsonb_array_elements(v_up) as t(x) loop
    v_id := e->>'id';
    if v_bases ? v_id then
      select s.data, true into v_cur, v_found
        from public.sales s
       where s.tenant_id = v_tenant and s.id = v_id and s.deleted_at is null
       for update;
      if not coalesce(v_found, false) or v_cur is distinct from (v_bases->v_id) then
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', v_id, 'data', v_cur));
        v_cur := null; v_found := null;
        continue;
      end if;
      v_cur := null; v_found := null;
    end if;
    insert into public.sales as s (tenant_id, id, data)
    values (v_tenant, v_id, e)
    on conflict (tenant_id, id) do update
      set data = excluded.data, updated_at = now(), deleted_at = null, version = s.version + 1;
    v_written := v_written || to_jsonb(v_id);
  end loop;

  update public.sales
     set deleted_at = now(), updated_at = now(), version = version + 1
   where tenant_id = v_tenant
     and deleted_at is null
     and id in (select jsonb_array_elements_text(v_del));

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'version', version, 'updated_at', updated_at)), '[]'::jsonb)
    into v_rows
    from public.sales
   where tenant_id = v_tenant
     and id in (select jsonb_array_elements_text(v_written) union select jsonb_array_elements_text(v_del));

  return jsonb_build_object('rows', v_rows, 'conflicts', v_conf, 'server_time', now());
end;
$function$;

revoke all on function public.sales_apply(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.sales_apply(jsonb, jsonb, jsonb) to authenticated;

-- ROLLBACK:
-- drop function if exists public.sales_apply(jsonb, jsonb, jsonb);
