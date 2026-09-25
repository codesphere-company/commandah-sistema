-- =====================================================================
-- COMMANDAH — tira EXECUTE do anon nas RPCs de venda/estoque e apaga os
-- tokens de integração guardados em cantina2:settings.
-- Data: 2026-09-25
-- =====================================================================
--
-- CONTEXTO
-- --------
-- 1. As migrations anteriores fazem "revoke all ... from public" e
--    "grant execute ... to authenticated". Mas o Supabase dá EXECUTE direto
--    pro anon em toda função nova do schema public (default privileges), e
--    o "from public" não remove esse grant. Resultado: anon ficou com
--    EXECUTE nas RPCs. Não é explorável hoje (todas checam papel/tenant, que
--    pra anon dá null), mas não deve depender disso. Todo uso real vem de
--    sessão autenticada: dono e operadores (staff-auth cria usuário no Auth).
--
--    FICAM com anon, de propósito:
--    - print_agent_*: o agente de impressão chama com a chave anon + token.
--    - current_tenant_id, current_staff_role, is_admin_like,
--      app_data_key_class: são chamadas dentro das policies de RLS. Tirar
--      do anon faria uma consulta anon dar erro em vez de voltar vazia.
--
-- 2. cantina2:settings é lido por todo operador no boot, e guardava tokens
--    de integração (WhatsApp, SMS, canais digitais, backup em nuvem). Nenhum
--    desses tokens é usado pelo sistema: não existe integração real, os
--    campos só gravavam o valor. O index.html deixou de pedir e gravar esses
--    campos; aqui apagamos o que já estava salvo. Mesmo tratamento do
--    secret do Pix na Fase 0.
-- =====================================================================

revoke execute on function public.next_order_number(integer)            from public, anon;
revoke execute on function public.consume_insumos(jsonb)                from public, anon;
revoke execute on function public.restore_insumos(jsonb)                from public, anon;
revoke execute on function public.close_sale(text, boolean, jsonb)      from public, anon;
revoke execute on function public.regenerate_print_agent_token()        from public, anon;
-- Funções de trigger: o trigger dispara sem checar EXECUTE de quem grava.
revoke execute on function public.recalc_member_debt()                  from public, anon;
revoke execute on function public.audit_log_stamp()                     from public, anon;

-- Em produção o EXECUTE vinha também do PUBLIC (o revoke só do anon não
-- bastou; conferido em 2026-09-25). Devolve só pra quem tem login.
grant execute on function public.next_order_number(integer)       to authenticated, service_role;
grant execute on function public.consume_insumos(jsonb)           to authenticated, service_role;
grant execute on function public.restore_insumos(jsonb)           to authenticated, service_role;
grant execute on function public.close_sale(text, boolean, jsonb) to authenticated, service_role;
grant execute on function public.regenerate_print_agent_token()   to authenticated, service_role;
grant execute on function public.recalc_member_debt()             to authenticated, service_role;
grant execute on function public.audit_log_stamp()                to authenticated, service_role;

update public.app_data
set value = value #- '{whatsappBot,token}' #- '{sms,token}',
    updated_at = now()
where key = 'cantina2:settings'
  and (value #> '{whatsappBot,token}' is not null or value #> '{sms,token}' is not null);

update public.app_data
set value = jsonb_set(value, '{digitalChannels}',
      (select jsonb_object_agg(k, case when jsonb_typeof(v)='object' then v - 'token' else v end)
       from jsonb_each(value->'digitalChannels') as e(k, v))),
    updated_at = now()
where key = 'cantina2:settings'
  and jsonb_typeof(value->'digitalChannels') = 'object'
  and value->'digitalChannels' <> '{}'::jsonb;

update public.app_data
set value = jsonb_set(value, '{cloudBackup}',
      (select jsonb_object_agg(k, case when jsonb_typeof(v)='object' then v - 'token' else v end)
       from jsonb_each(value->'cloudBackup') as e(k, v))),
    updated_at = now()
where key = 'cantina2:settings'
  and jsonb_typeof(value->'cloudBackup') = 'object'
  and value->'cloudBackup' <> '{}'::jsonb;
