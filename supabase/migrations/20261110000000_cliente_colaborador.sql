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
--    quiser). Só dono/admin cria colaborador ou troca o kind (gatilho
--    trg_members_guard_kind).
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
--    Só a grafia exata 'salario' vale (D2, decisão do coordenador, 08/11):
--    qualquer outra que, normalizada, vire salário ('Salário', ' SALARIO ',
--    acento em NFD, tab/NBSP, pontuação, 'Descontado do salário'...) é
--    recusada para TODOS, inclusive admin e service_role. Relatórios e filtros
--    do site comparam method === 'salario'; uma grafia variante sumiria deles
--    e o caixa ainda contornaria a trava escrevendo o rótulo da tela.
--    Normalização: NFKD (separa acento e desfaz largura cheia), minúsculas e
--    só letras a-z; se o resultado contém 'salario' e o texto não é
--    exatamente 'salario', recusa.
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

-- Só dono/admin cria cliente colaborador ou troca o tipo (socio <-> colaborador).
-- 08/11 (pedido do dono, decisão da revisão da D1): o colaborador tem desconto e
-- dívida que não bloqueia; se o caixa pudesse marcar qualquer cliente como
-- colaborador, daria desconto e fiado sem limite a quem quisesse. O caixa continua
-- criando e editando sócios (e os outros campos do colaborador) como hoje.
-- Gatilho, não policy, pelo mesmo motivo do de salário abaixo: vale também em
-- caminho SECURITY DEFINER. Hoje nenhuma RPC grava members além do
-- recalc_member_debt (que só mexe em debt) e do staff-auth (service_role, só
-- debt_release); o gatilho cobre as que vierem.
-- Atenção para o front: num upsert (insert ... on conflict do update) o gatilho de
-- INSERT roda antes do conflito; o site usa insert e update separados
-- (assets/js/core/dados-socios.js), então editar colaborador pelo caixa funciona.
create or replace function public.members_guard_kind()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if auth.uid() is not null and not coalesce(public.is_admin_like(), false)
     and (tg_op = 'INSERT' and new.kind is distinct from 'socio'
          or tg_op = 'UPDATE' and new.kind is distinct from old.kind) then
    raise exception 'so o administrador define cliente colaborador' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.members_guard_kind() from public, anon, authenticated;

drop trigger if exists trg_members_guard_kind on public.members;
create trigger trg_members_guard_kind
  before insert or update of kind on public.members
  for each row execute function public.members_guard_kind();

create or replace function public.member_debt_entries_guard_salario()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  -- só letras a-z, sem acento (NFKD solta o acento como marca combinante,
  -- que cai fora no [^a-z]), sem espaço/tab/NBSP/pontuação
  v_letras text := regexp_replace(lower(normalize(coalesce(new.method, ''), NFKD)), '[^a-z]', '', 'g');
begin
  if new.method is distinct from 'salario' and position('salario' in v_letras) > 0 then
    raise exception 'grafia de salario nao aceita: use a grafia salario' using errcode = '23514';
  end if;
  if new.method = 'salario' then
    if new.type is distinct from 'payment' then
      raise exception 'descontado do salario so em pagamento' using errcode = '23514';
    end if;
    if auth.uid() is not null and not coalesce(public.is_admin_like(), false) then
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
