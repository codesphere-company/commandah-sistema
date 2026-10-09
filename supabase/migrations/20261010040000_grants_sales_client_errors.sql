-- =====================================================================
-- 20261010040000_grants_sales_client_errors.sql — correção do EST-01/OPS-10
-- =====================================================================
-- O PROBLEMA
-- ----------
-- As tabelas novas (sales, de 20261010030000, e client_errors, de 20261009010000)
-- herdaram o padrão do Supabase para tabela nova no schema public: ALL para
-- authenticated, inclusive TRUNCATE, que não passa pela RLS. A API REST não
-- expõe TRUNCATE, mas é a mesma brecha que 20261002010000 fechou nas outras
-- tabelas (defesa em profundidade). Achado na conferência pós-publicação do EST-01.
--
-- A SOLUCAO
-- ---------
-- Deixa só o que o site usa: sales = SELECT (escrita só por sales_apply/close_sale);
-- client_errors = SELECT e INSERT (a RLS continua decidindo quem).
-- **Regra para tabela nova:** sempre "revoke all ... from public, anon, authenticated"
-- antes de dar o grant mínimo.
-- =====================================================================

revoke all on table public.sales from public, anon, authenticated;
grant select on table public.sales to authenticated;

revoke all on table public.client_errors from public, anon, authenticated;
grant select, insert on table public.client_errors to authenticated;

-- ROLLBACK: grant all on table public.sales, public.client_errors to authenticated;
