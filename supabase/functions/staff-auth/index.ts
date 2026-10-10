// Edge Function: staff-auth
// Login por operador (PIN) mediado no servidor + gestão de colaboradores (criar/resetar PIN/ativar-desativar).
// Guarda a chave de admin (service_role) só aqui, nunca no navegador. Ver plano em
// .claude/ (Fase 2 — login por operador de verdade).
import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const MAX_ATTEMPTS = 5;
// Bloqueio progressivo (SEG-01): 15 min, depois 1 h, depois 24 h (até o dono redefinir o PIN).
// Antes era sempre 15 min: ~480 tentativas por dia, PIN de 4 dígitos caía em ~10 dias.
const LOCK_STEPS_MIN = [15, 60, 1440];
// Administrador precisa de PIN de 6 dígitos ao criar ou redefinir (SEG-01). PINs de 4
// que já existiam continuam valendo até serem redefinidos.
const ADMIN_PIN_MIN_LEN = 6;

// staff_id vem do uid() do frontend (base36) e entra no e-mail sintético da conta;
// PIN tem teto porque o bcrypt ignora o que passa de 72 bytes.
const STAFF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PIN_MAX_LEN = 64;
function validStaffId(v: string) { return STAFF_ID_RE.test(v); }
function validPin(v: string) { return v.length >= 1 && v.length <= PIN_MAX_LEN; }

function lockLabel(min: number) { return min >= 1440 ? "24 h" : min >= 60 ? `${min / 60} h` : `${min} min`; }

// Bloqueia o colaborador pelo próximo degrau e registra no audit_log (aparece em Logs para o dono).
async function lockStaff(staff: Record<string, unknown>, matchAttempts?: number) {
  const count = ((staff.lock_count as number | null) ?? 0) + 1;
  const minutes = LOCK_STEPS_MIN[Math.min(count, LOCK_STEPS_MIN.length) - 1];
  let upd = admin.from("tenant_staff").update({
    failed_attempts: 0,
    lock_count: count,
    locked_until: new Date(Date.now() + minutes * 60000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", staff.id as string);
  if (matchAttempts !== undefined) upd = upd.eq("failed_attempts", matchAttempts);
  const { error } = await upd;
  if (error) console.error("[staff-auth] falha ao gravar bloqueio:", error);
  let name = String(staff.id);
  try {
    const { data } = await admin.auth.admin.getUserById(staff.auth_user_id as string);
    const meta = data?.user?.user_metadata as { staff_name?: string } | undefined;
    if (meta?.staff_name) name = meta.staff_name;
  } catch { /* nome é só cosmético no log */ }
  const { error: logErr } = await admin.from("audit_log").insert({
    tenant_id: staff.tenant_id, actor_name: "Sistema", entity: "staff", entity_id: staff.id,
    action: `PIN bloqueado por ${lockLabel(minutes)} após ${MAX_ATTEMPTS} tentativas erradas: ${name} (${count}º bloqueio seguido)`,
    meta: { lock_count: count, minutes },
  });
  if (logErr) console.error("[staff-auth] falha ao registrar bloqueio no audit_log:", logErr);
  return minutes;
}
function lockedMessage(minutes: number) {
  return minutes >= 1440
    ? "Muitas tentativas erradas. Bloqueado por 24 h ou até o dono redefinir o PIN."
    : `Muitas tentativas erradas. Bloqueado por ${lockLabel(minutes)}.`;
}

// Erro interno vai pro log da função, nunca pro navegador.
function internalError(publicMsg: string, detail?: unknown) {
  console.error("[staff-auth]", publicMsg, detail);
  return json({ error: publicMsg }, 500);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

// Identifica quem está chamando (pelo JWT da sessão atual) e se pode gerenciar colaboradores:
// o dono de verdade (tenant_owners), ou um operador com role=admin ativo (mesmo padrão de hoje,
// onde o PIN de administrador já gerencia colaboradores).
async function callerContext(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return { tenantId: null as string | null, canManage: false };
  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData?.user) return { tenantId: null, canManage: false };
  const uid = userData.user.id;

  const { data: ownerRow } = await admin.from("tenant_owners").select("tenant_id").eq("user_id", uid).maybeSingle();
  if (ownerRow) return { tenantId: ownerRow.tenant_id as string, canManage: true };

  const { data: staffRow } = await admin.from("tenant_staff").select("tenant_id, role, active").eq("auth_user_id", uid).maybeSingle();
  if (staffRow && staffRow.active && staffRow.role === "admin") {
    return { tenantId: staffRow.tenant_id as string, canManage: true };
  }
  return { tenantId: null, canManage: false };
}

// Confere o PIN de um colaborador com o mesmo controle de tentativas do login (reserva
// da tentativa por compare-and-swap, bloqueio progressivo). Usado pelo login, pela
// confirmação de senha (verify) e pela liberação de sócio bloqueado (release_debt).
async function checkStaffPin(staffId: string, pin: string): Promise<{ staff: Record<string, unknown> } | { resp: Response }> {
  const { data: staff, error } = await admin.from("tenant_staff").select("*").eq("id", staffId).maybeSingle();
  if (error || !staff) return { resp: json({ error: "Colaborador não encontrado" }, 404) };
  if (!staff.active) return { resp: json({ error: "Colaborador inativo" }, 403) };

  if (staff.locked_until && new Date(staff.locked_until as string) > new Date()) {
    const mins = Math.ceil((new Date(staff.locked_until as string).getTime() - Date.now()) / 60000);
    return { resp: json({ error: `Muitas tentativas erradas. Tente novamente em ${mins} min.` }, 423) };
  }

  // Reserva a tentativa ANTES de conferir o PIN, com compare-and-swap em failed_attempts.
  // Antes o contador era lido, o bcrypt rodava e só depois gravava attempts+1: N requisições
  // em paralelo liam o mesmo valor e furavam o limite de 5 (brute force do PIN em rajada).
  // Agora só uma requisição por valor do contador passa; as concorrentes são recusadas sem
  // nem testar o PIN.
  const prevAttempts = (staff.failed_attempts as number | null) ?? null;
  const prevCount = prevAttempts || 0;
  if (prevCount >= MAX_ATTEMPTS) {
    // Contador ficou no teto sem bloqueio gravado (a gravação do bloqueio falhou): bloqueia agora.
    const minutes = await lockStaff(staff, prevCount);
    return { resp: json({ error: lockedMessage(minutes) }, 423) };
  }
  const attempts = prevCount + 1;
  let reserve = admin.from("tenant_staff")
    .update({ failed_attempts: attempts, updated_at: new Date().toISOString() })
    .eq("id", staffId);
  reserve = prevAttempts === null ? reserve.is("failed_attempts", null) : reserve.eq("failed_attempts", prevAttempts);
  const { data: reserved, error: reserveErr } = await reserve.select("id");
  if (reserveErr) return { resp: internalError("Falha ao verificar o PIN", reserveErr) };
  if (!reserved || reserved.length === 0) {
    return { resp: json({ error: "Outra tentativa de login em andamento. Tente de novo." }, 429) };
  }

  const ok = bcrypt.compareSync(pin, staff.pin_hash as string);
  if (!ok) {
    if (attempts >= MAX_ATTEMPTS) {
      const minutes = await lockStaff(staff);
      return { resp: json({ error: lockedMessage(minutes) }, 423) };
    }
    return { resp: json({ error: "PIN incorreto" }, 401) };
  }
  await admin.from("tenant_staff").update({ failed_attempts: 0, lock_count: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", staffId);
  return { staff };
}

async function staffName(staff: Record<string, unknown>) {
  try {
    const { data } = await admin.auth.admin.getUserById(staff.auth_user_id as string);
    const meta = data?.user?.user_metadata as { staff_name?: string } | undefined;
    if (meta?.staff_name) return meta.staff_name;
  } catch { /* nome é só cosmético */ }
  return String(staff.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  const action = body.action;

  try {
    if (action === "login") {
      const staffId = String(body.staff_id || "");
      const pin = String(body.pin || "");
      if (!staffId || !pin) return json({ error: "staff_id e pin são obrigatórios" }, 400);
      if (!validStaffId(staffId) || !validPin(pin)) return json({ error: "PIN incorreto" }, 401);

      const checked = await checkStaffPin(staffId, pin);
      if ("resp" in checked) return checked.resp;
      const staff = checked.staff;

      const { data: userRec, error: userErr } = await admin.auth.admin.getUserById(staff.auth_user_id as string);
      if (userErr || !userRec?.user?.email) {
        if (userErr) console.error("[staff-auth] getUserById:", userErr);
        return json({ error: "Conta de acesso não encontrada para este colaborador" }, 500);
      }

      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: userRec.user.email,
      });
      if (linkErr || !linkData) return internalError("Falha ao gerar sessão", linkErr);
      const hashedToken = (linkData as { properties?: { hashed_token?: string } }).properties?.hashed_token;
      if (!hashedToken) return json({ error: "Falha ao gerar sessão (token)" }, 500);

      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data: sessionData, error: verifyErr } = await anon.auth.verifyOtp({
        type: "magiclink",
        token_hash: hashedToken,
      });
      if (verifyErr || !sessionData?.session) return internalError("Falha ao autenticar", verifyErr);

      return json({ session: sessionData.session });
    }

    // Confirmação de senha antes de uma alteração sensível (ex.: reabrir comanda fechada).
    // Não devolve sessão: só diz se o PIN confere e o perfil de quem digitou.
    if (action === "verify" || action === "release_debt") {
      const staffId = String(body.staff_id || "");
      const pin = String(body.pin || "");
      if (!staffId || !pin) return json({ error: "staff_id e pin são obrigatórios" }, 400);
      if (!validStaffId(staffId) || !validPin(pin)) return json({ error: "PIN incorreto" }, 401);
      const checked = await checkStaffPin(staffId, pin);
      if ("resp" in checked) return checked.resp;
      const staff = checked.staff;
      const name = await staffName(staff);
      if (action === "verify") return json({ ok: true, staff_id: staff.id, role: staff.role, name });

      // OP-14: liberar sócio bloqueado por fiado exige a senha de um administrador, mesmo
      // com o caixa logado no aparelho. A gravação vai com service_role (a trava do banco
      // só deixa admin/dono gravar debt_release pela API).
      if (staff.role !== "admin") return json({ error: "Só administrador libera sócio bloqueado." }, 403);
      const memberId = String(body.member_id || "");
      if (!validStaffId(memberId)) return json({ error: "Sócio inválido" }, 400);
      const { data: member, error: mErr } = await admin.from("members").select("id, tenant_id, name, debt").eq("id", memberId).maybeSingle();
      if (mErr) return internalError("Falha ao consultar o sócio", mErr);
      if (!member || member.tenant_id !== staff.tenant_id) return json({ error: "Sócio não encontrado" }, 404);
      const release = { amount: Math.round(Number(member.debt || 0) * 100) / 100, at: new Date().toISOString(), by: name };
      const { error: uErr } = await admin.from("members").update({ debt_release: release }).eq("id", memberId);
      if (uErr) return internalError("Falha ao liberar o sócio", uErr);
      await admin.from("audit_log").insert({
        tenant_id: staff.tenant_id, actor_name: name, entity: "member", entity_id: memberId,
        action: `Sócio liberado com pendência de R$ ${release.amount.toFixed(2).replace(".", ",")}: ${member.name}`,
        meta: { release },
      });
      return json({ ok: true, release });
    }

    // Ações abaixo exigem quem chama ser dono do tenant ou admin ativo.
    const { tenantId, canManage } = await callerContext(req);
    if (!tenantId || !canManage) return json({ error: "Sem permissão" }, 403);

    if (action === "create_operator") {
      const staffId = String(body.staff_id || "");
      const name = String(body.name || "");
      const role = String(body.role || "");
      const pin = String(body.pin || "");
      if (!staffId || !role || !pin) return json({ error: "Campos obrigatórios faltando" }, 400);
      if (!["admin", "caixa", "cozinha"].includes(role)) return json({ error: "Perfil inválido" }, 400);
      if (!validStaffId(staffId)) return json({ error: "Identificador de colaborador inválido" }, 400);
      if (!validPin(pin)) return json({ error: "PIN inválido" }, 400);
      // legacy_migration: "Migrar acesso seguro" leva os PINs que já existiam (de 4 dígitos).
      if (role === "admin" && pin.length < ADMIN_PIN_MIN_LEN && body.legacy_migration !== true) {
        return json({ error: `PIN de administrador precisa ter ${ADMIN_PIN_MIN_LEN} dígitos` }, 400);
      }
      if (name.length > 120) return json({ error: "Nome muito longo" }, 400);

      const email = `staff-${staffId}@${tenantId}.commandah.internal`;
      const randomPassword = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password: randomPassword, email_confirm: true,
        user_metadata: { tenant_id: tenantId, staff_name: name, source: "commandah-staff" },
      });
      if (createErr || !created?.user) return internalError("Falha ao criar conta de acesso", createErr);

      const pinHash = bcrypt.hashSync(pin, 10);
      const { error: insertErr } = await admin.from("tenant_staff").insert({
        id: staffId, tenant_id: tenantId, auth_user_id: created.user.id, role, pin_hash: pinHash, active: true,
      });
      if (insertErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return internalError("Falha ao registrar colaborador", insertErr);
      }
      return json({ ok: true });
    }

    if (action === "reset_pin") {
      const staffId = String(body.staff_id || "");
      const pin = String(body.pin || "");
      if (!staffId || !pin) return json({ error: "Campos obrigatórios faltando" }, 400);
      if (!validStaffId(staffId) || !validPin(pin)) return json({ error: "Dados inválidos" }, 400);
      const { data: staff, error: selErr } = await admin.from("tenant_staff").select("tenant_id, role").eq("id", staffId).maybeSingle();
      if (selErr) return internalError("Falha ao consultar colaborador", selErr);
      if (!staff || staff.tenant_id !== tenantId) return json({ error: "Colaborador não encontrado" }, 404);
      // Vale o perfil que o formulário está salvando agora (pode ser promoção ou rebaixamento).
      const role = String(body.role || staff.role || "");
      if (role === "admin" && pin.length < ADMIN_PIN_MIN_LEN) {
        return json({ error: `PIN de administrador precisa ter ${ADMIN_PIN_MIN_LEN} dígitos` }, 400);
      }
      const pinHash = bcrypt.hashSync(pin, 10);
      const { error: updErr } = await admin.from("tenant_staff").update({
        pin_hash: pinHash, failed_attempts: 0, lock_count: 0, locked_until: null, updated_at: new Date().toISOString(),
      }).eq("id", staffId);
      if (updErr) return internalError("Falha ao redefinir PIN", updErr);
      return json({ ok: true });
    }

    if (action === "set_active") {
      const staffId = String(body.staff_id || "");
      const active = !!body.active;
      if (!staffId) return json({ error: "Campos obrigatórios faltando" }, 400);
      if (!validStaffId(staffId)) return json({ error: "Dados inválidos" }, 400);
      const { data: staff, error: selErr } = await admin.from("tenant_staff").select("tenant_id").eq("id", staffId).maybeSingle();
      if (selErr) return internalError("Falha ao consultar colaborador", selErr);
      if (!staff || staff.tenant_id !== tenantId) return json({ error: "Colaborador não encontrado" }, 404);
      const { error: updErr } = await admin.from("tenant_staff").update({ active, updated_at: new Date().toISOString() }).eq("id", staffId);
      if (updErr) return internalError("Falha ao alterar status do colaborador", updErr);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    return internalError("Erro interno", e);
  }
});
