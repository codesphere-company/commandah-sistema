-- =====================================================================
-- t303 (12/10/2026): cancelamento da NFC-e
--
-- A NFC-e só pode ser cancelada em até 30 minutos depois da autorização (prazo da
-- SEFAZ). Quem cancela é a Edge Function "nfce" (ação "cancelar"); a linha da nota
-- passa de 'autorizada' para 'cancelada' e guarda o protocolo do evento.
-- Depois de cancelada, a comanda pode receber uma nota nova (o índice único só
-- vale para 'autorizada').
-- =====================================================================

alter table public.nfce_notas drop constraint if exists nfce_notas_status_check;
alter table public.nfce_notas add constraint nfce_notas_status_check
  check (status in ('autorizada', 'rejeitada', 'erro', 'cancelada'));

alter table public.nfce_notas add column if not exists cancelada_em     timestamptz;
alter table public.nfce_notas add column if not exists cancel_protocolo text;
alter table public.nfce_notas add column if not exists cancel_motivo    text;
alter table public.nfce_notas add column if not exists cancelada_por    text;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- update public.nfce_notas set status = 'autorizada' where status = 'cancelada';  -- só se for desfazer de verdade
-- alter table public.nfce_notas drop column if exists cancelada_por, drop column if exists cancel_motivo,
--   drop column if exists cancel_protocolo, drop column if exists cancelada_em;
-- alter table public.nfce_notas drop constraint if exists nfce_notas_status_check;
-- alter table public.nfce_notas add constraint nfce_notas_status_check check (status in ('autorizada', 'rejeitada', 'erro'));
