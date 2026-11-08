-- =====================================================================
-- D1 — Conta do colaborador: tipo de cliente e baixa "Descontado do salário"
-- 08/11 (pedido do dono)
-- =====================================================================
-- O colaborador (funcionário, ajudante, limpeza) é cadastrado em Clientes,
-- como os sócios, mas com o tipo "Colaborador": sem cota, com 20% de desconto
-- na comanda, e a conta dele fica como um fiado que NÃO bloqueia o consumo.
-- O salário é pago por fora; no dia do pagamento o administrador dá baixa no
-- consumo como "Descontado do salário" — um pagamento de fiado que não entra
-- dinheiro no caixa.
--
-- 1. members.kind: 'socio' (padrão, todos os clientes de hoje) ou
--    'colaborador'. O `code` (cota) já é opcional no banco desde o baseline
--    (members.code text, sem not null e sem unique): o colaborador fica sem
--    cota sem precisar mexer em constraint. Clientes existentes ficam
--    'socio' pelo default da coluna (nenhuma linha muda de sentido;
--    funcionário que hoje tem fiado como sócio comum o dono recadastra se
--    quiser).
--
-- 2. member_debt_entries.method = 'salario': aceito só em pagamento
--    (type = 'payment') e só gravado por dono/admin. A trava é um gatilho
--    BEFORE na própria tabela, e não a policy de insert, porque o caixa
--    também grava lançamentos pelo close_sale (SECURITY DEFINER, p_debt_entries
--    vindo do navegador), que passa por cima da RLS. O gatilho roda em todo
--    caminho: insert direto, close_sale e update (este já é só do admin pela
--    policy debt_entries_update_admin, mas o gatilho fecha "virar salario"
--    numa dívida).
--    O papel vem do JWT (auth.uid() / current_staff_role), não do
--    current_user: dentro do close_sale o current_user é o dono da função.
--    Sem usuário logado (service_role, rotinas do servidor, migrations)
--    passa, como nas outras travas por papel.
--    Grafias como 'Salário', ' SALARIO ' ou 'Descontado do salário' contam
--    como salário: o caixa não contorna a trava escrevendo o rótulo da tela.
--
-- members.debt continua saindo só da soma do extrato (recalc_member_debt):
-- o pagamento 'salario' baixa a dívida igual a Dinheiro/Cartão/Pix.
-- =====================================================================

alter table public.members
  add column if not exists kind text not null default 'socio';

alter table public.members drop constraint if exists members_kind_check;
alter table public.members
  add constraint members_kind_check check (kind in ('socio', 'colaborador'));

comment on column public.members.kind is
  'Tipo de cliente: socio (padrão) ou colaborador (sem cota, desconto de colaborador, dívida não bloqueia). 08/11 (pedido do dono).';

create or replace function public.member_debt_entries_guard_salario()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_metodo text := lower(btrim(translate(coalesce(new.method, ''), 'áàâãÁÀÂÃ', 'aaaaaaaa')));
begin
  if v_metodo in ('salario', 'descontado do salario') then
    if new.type is distinct from 'payment' then
      raise exception 'descontado do salario so em pagamento' using errcode = '23514';
    end if;
    if auth.uid() is not null and not public.is_admin_like() then
      raise exception 'so o administrador da baixa descontado do salario' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.member_debt_entries_guard_salario() from public, anon, authenticated;

drop trigger if exists trg_member_debt_entries_guard_salario on public.member_debt_entries;
create trigger trg_member_debt_entries_guard_salario
  before insert or update of method, type on public.member_debt_entries
  for each row execute function public.member_debt_entries_guard_salario();
