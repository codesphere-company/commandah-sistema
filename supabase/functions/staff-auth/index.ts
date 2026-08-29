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
const LOCK_MINUTES = 15;

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

      const { data: staff, error } = await admin.from("tenant_staff").select("*").eq("id", staffId).maybeSingle();
      if (error || !staff) return json({ error: "Colaborador não encontrado" }, 404);
      if (!staff.active) return json({ error: "Colaborador inativo" }, 403);

      if (staff.locked_until && new Date(staff.locked_until as string) > new Date()) {
        const mins = Math.ceil((new Date(staff.locked_until as string).getTime() - Date.now()) / 60000);
        return json({ error: `Muitas tentativas erradas. Tente novamente em ${mins} min.` }, 423);
      }

      const ok = bcrypt.compareSync(pin, staff.pin_hash as string);
      if (!ok) {
        const attempts = ((staff.failed_attempts as number) || 0) + 1;
        const update: Record<string, unknown> = { failed_attempts: attempts, updated_at: new Date().toISOString() };
        let locked = false;
        if (attempts >= MAX_ATTEMPTS) {
          update.locked_until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
          update.failed_attempts = 0;
          locked = true;
        }
        await admin.from("tenant_staff").update(update).eq("id", staffId);
        if (locked) return json({ error: `Muitas tentativas erradas. Bloqueado por ${LOCK_MINUTES} min.` }, 423);
        return json({ error: "PIN incorreto" }, 401);
      }

      await admin.from("tenant_staff").update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", staffId);

      const { data: userRec, error: userErr } = await admin.auth.admin.getUserById(staff.auth_user_id as string);
      if (userErr || !userRec?.user?.email) return json({ error: "Conta de acesso não encontrada para este colaborador" }, 500);

      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: userRec.user.email,
      });
      if (linkErr || !linkData) return json({ error: "Falha ao gerar sessão: " + (linkErr?.message || "") }, 500);
      const hashedToken = (linkData as { properties?: { hashed_token?: string } }).properties?.hashed_token;
      if (!hashedToken) return json({ error: "Falha ao gerar sessão (token)" }, 500);

      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data: sessionData, error: verifyErr } = await anon.auth.verifyOtp({
        type: "magiclink",
        token_hash: hashedToken,
      });
      if (verifyErr || !sessionData?.session) return json({ error: "Falha ao autenticar: " + (verifyErr?.message || "") }, 500);

      return json({ session: sessionData.session });
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

      const email = `staff-${staffId}@${tenantId}.commandah.internal`;
      const randomPassword = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password: randomPassword, email_confirm: true,
        user_metadata: { tenant_id: tenantId, staff_name: name, source: "commandah-staff" },
      });
      if (createErr || !created?.user) return json({ error: "Falha ao criar conta: " + (createErr?.message || "") }, 500);

      const pinHash = bcrypt.hashSync(pin, 10);
      const { error: insertErr } = await admin.from("tenant_staff").insert({
        id: staffId, tenant_id: tenantId, auth_user_id: created.user.id, role, pin_hash: pinHash, active: true,
      });
      if (insertErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: "Falha ao registrar colaborador: " + insertErr.message }, 500);
      }
      return json({ ok: true });
    }

    if (action === "reset_pin") {
      const staffId = String(body.staff_id || "");
      const pin = String(body.pin || "");
      if (!staffId || !pin) return json({ error: "Campos obrigatórios faltando" }, 400);
      const { data: staff } = await admin.from("tenant_staff").select("tenant_id").eq("id", staffId).maybeSingle();
      if (!staff || staff.tenant_id !== tenantId) return json({ error: "Colaborador não encontrado" }, 404);
      const pinHash = bcrypt.hashSync(pin, 10);
      await admin.from("tenant_staff").update({
        pin_hash: pinHash, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString(),
      }).eq("id", staffId);
      return json({ ok: true });
    }

    if (action === "set_active") {
      const staffId = String(body.staff_id || "");
      const active = !!body.active;
      if (!staffId) return json({ error: "Campos obrigatórios faltando" }, 400);
      const { data: staff } = await admin.from("tenant_staff").select("tenant_id").eq("id", staffId).maybeSingle();
      if (!staff || staff.tenant_id !== tenantId) return json({ error: "Colaborador não encontrado" }, 404);
      await admin.from("tenant_staff").update({ active, updated_at: new Date().toISOString() }).eq("id", staffId);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
