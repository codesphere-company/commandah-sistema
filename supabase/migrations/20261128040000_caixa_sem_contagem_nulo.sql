-- Correção (27/11/2026): passar o caixa contando (semContagem ausente no fechamento) gravava sem_contagem = NULL
-- e o banco recusava (coluna not null, migration 20261127010000): "null value in column sem_contagem".
-- jsonb_typeof(NULL) = 'boolean' dá NULL e o AND inteiro vira NULL. Agora coalesce(..., false).
-- Só esta linha muda; o resto da função é igual a 20261127010000_caixa_troca_sem_contagem.sql.

create or replace function public.cash_turno_concluir_fechamento(p_tenant text, p_caixa text, p_turno jsonb, p_closed jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_history jsonb;
  v_closed jsonb;
  v_ultima numeric;
  v_troco numeric;
  v_para numeric := 0;
  v_fim boolean := jsonb_typeof(p_closed->'fimDaNoite') = 'boolean' and (p_closed->>'fimDaNoite')::boolean;
begin
  v_closed := (p_closed - 'pendencia' - 'fimDaNoite' - 'troco' - 'paraCofre') || jsonb_build_object(
    'status', 'closed',
    'caixaId', p_caixa,
    'liberacoes', coalesce(p_turno->'liberacoes', '[]'::jsonb));
  v_ultima := (v_closed->>'countedAmount')::numeric;

  if v_fim and v_ultima is not null then
    v_troco := public.cash_caixa_troco(p_tenant, p_caixa);
    if round(v_ultima * 100) > round(v_troco * 100) then
      v_para := public.cash_turno_dif(v_ultima, v_troco);
      if not exists (select 1 from public.cash_cofre
                      where tenant_id = p_tenant and turno_id = v_closed->>'id' and origem = 'fim_da_noite') then
        perform public.cash_cofre_entrada(p_tenant, p_caixa, v_closed->>'id', v_para, 'fim_da_noite', p_turno->>'operatorId');
      end if;
      v_ultima := v_troco;
    end if;
    v_closed := v_closed || jsonb_build_object('fimDaNoite', true, 'troco', v_troco, 'paraCofre', v_para);
  end if;

  insert into public.app_data (tenant_id, key, value)
  values (p_tenant, 'cantina2:cashHistory', '[]'::jsonb)
  on conflict (tenant_id, key) do nothing;

  select value into v_history from public.app_data
   where tenant_id = p_tenant and key = 'cantina2:cashHistory'
   for update;
  if jsonb_typeof(v_history) <> 'array' then
    v_history := '[]'::jsonb;
  end if;

  if not exists (select 1 from jsonb_array_elements(v_history) e where e->>'id' = v_closed->>'id') then
    v_history := jsonb_build_array(v_closed) || v_history;
    update public.app_data set value = v_history, updated_at = now()
     where tenant_id = p_tenant and key = 'cantina2:cashHistory';
  end if;

  update public.cash_turnos
     set turno = null, ultima_contagem = v_ultima, updated_at = now(),
         sem_contagem = coalesce(jsonb_typeof(p_closed->'semContagem') = 'boolean' and (p_closed->>'semContagem')::boolean and not v_fim, false)
   where tenant_id = p_tenant and caixa_id = p_caixa;
end;
$function$;
revoke all on function public.cash_turno_concluir_fechamento(text, text, jsonb, jsonb) from public, anon, authenticated;
