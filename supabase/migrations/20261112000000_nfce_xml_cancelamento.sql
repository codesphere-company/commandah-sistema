-- =====================================================================
-- 10/11/2026: XML do evento de cancelamento da NFC-e
--
-- Necessário para o cálculo de imposto: sem o evento, o XML original de uma
-- nota cancelada pode ser importado pela contabilidade como venda válida.
-- Quem grava é só a Edge Function "nfce" (service_role), como as demais colunas.
-- =====================================================================

alter table public.nfce_notas add column if not exists xml_cancelamento text;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- alter table public.nfce_notas drop column if exists xml_cancelamento;
