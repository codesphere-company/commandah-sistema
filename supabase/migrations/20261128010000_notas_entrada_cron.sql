-- =====================================================================
-- 20261128010000_notas_entrada_cron.sql — t-notas, tarefa 3 (27/11/2026)
-- Agenda a busca das notas de compra: a cada 2 h o banco chama a Edge Function notas-entrada com
-- { action: "buscar" } e o cabeçalho x-segredo. A função só busca para os estabelecimentos com
-- notas_entrada_config.liberada (equipe) e busca_ligada (administrador); hoje nenhum está liberado,
-- então o agendamento não faz nada até a equipe liberar (piloto de dezembro: busca desligada, ver o desenho).
--
-- O segredo fica no Vault (nome notas_entrada_segredo) e tem de ser o MESMO do secret da função
-- NOTAS_ENTRADA_SEGREDO. Sem o segredo no Vault, o cabeçalho vai vazio e a função responde 401 (nada roda).
-- Passos na publicação (só com o "sim" do dono):
--   1. segredo novo: openssl rand -hex 32
--   2. npx supabase secrets set NOTAS_ENTRADA_SEGREDO=<segredo> --project-ref ezfoymdesmarpunmixbs
--   3. select vault.create_secret('<segredo>', 'notas_entrada_segredo', 'Segredo do cron da função notas-entrada');
--   4. deploy da função com --no-verify-jwt (o cron não manda JWT; a função confere o segredo).
--
-- Banco local (bancada) não tem pg_cron/pg_net: só avisa, como as migrations do WhatsApp.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    -- cron.schedule com o mesmo nome troca o agendamento (rodar de novo não duplica).
    -- timeout de 150 s: a busca percorre os estabelecimentos um por vez (a SEFAZ trava consultas simultâneas).
    execute $q$select cron.schedule('notas-entrada-buscar', '0 */2 * * *', $cmd$
      select net.http_post(
        url := 'https://ezfoymdesmarpunmixbs.supabase.co/functions/v1/notas-entrada',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-segredo', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notas_entrada_segredo'), '')),
        body := '{"action":"buscar"}'::jsonb,
        timeout_milliseconds := 150000)
    $cmd$)$q$;
  else
    raise notice 'pg_cron/pg_net indisponivel: busca das notas de compra nao agendada (banco local)';
  end if;
end
$$;

-- ROLLBACK (manual):
--   select cron.unschedule('notas-entrada-buscar');
--   delete from vault.secrets where name = 'notas_entrada_segredo';
