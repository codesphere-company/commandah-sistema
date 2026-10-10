-- =====================================================================
-- 20261011050000_lgpd_socios.sql — PROD-08 (LGPD)
-- =====================================================================
-- A DECISAO (dono, 10/10)
-- -----------------------
-- Aviso de privacidade (modelo padrão, a revisar pelo contador/jurídico),
-- retenção de 2 anos para quem deixou de ser sócio, consentimento separado para
-- campanhas, e ferramentas para atender o titular: exportar os dados e
-- anonimizar.
--
-- A SOLUCAO
-- ---------
-- members.marketing_opt_in: o sócio autorizou campanhas/promoções (cobrança de
--   fiado não depende disso: é execução do contrato).
-- members.anonymized_at: quando o cadastro foi anonimizado (nome, documento e
--   contatos apagados; o histórico de valores continua, sem identificar).
-- =====================================================================

alter table public.members add column if not exists marketing_opt_in boolean not null default false;
alter table public.members add column if not exists anonymized_at timestamptz;

-- ROLLBACK:
-- alter table public.members drop column if exists marketing_opt_in;
-- alter table public.members drop column if exists anonymized_at;
