-- =====================================================================
-- 20261128020000_cardapio_aviso_na_hora.sql — t-cardapio-aviso (27/11/2026)
-- =====================================================================
-- O caixa passa a ser AVISADO (Supabase Realtime) quando um pedido do cardápio é gravado, em vez de só conferir a
-- fila de 6 em 6 s (com a aba escondida o Chrome segurava a conferência por até 1 min; um pedido levou 151 s).
-- Basta pôr cardapio_pedidos na publicação supabase_realtime. A RLS existente (cardapio_pedidos_ler: owner/admin/caixa
-- do próprio tenant) também filtra os avisos. Pode rodar de novo (só acrescenta se ainda não estiver).
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cardapio_pedidos') then
    alter publication supabase_realtime add table public.cardapio_pedidos;
  end if;
end $$;
