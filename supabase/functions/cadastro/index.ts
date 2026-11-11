// Edge Function: cadastro
// Cria um estabelecimento novo com código de convite (auditoria de lançamento 11/11, A1).
// Antes o navegador fazia auth.signUp e inseria em tenant_owners com o tenant_id que quisesse;
// agora o cadastro público do Auth fica desligado e só esta função cria o dono, depois de
// conferir o convite. Roda sem login (verify_jwt = false): o próprio convite é a barreira.
//
// Corpo: { codigo, nome, email, senha }  →  { ok: true, tenant_id }
// Deploy: npx supabase functions deploy cadastro --project-ref ezfoymdesmarpunmixbs --use-api --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const SENHA_MIN = 8;
const SENHA_MAX = 72;
const CONVITE_RUIM = "Código de convite inválido, vencido ou já usado.";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}
function internalError(publicMsg: string, detail?: unknown) {
  console.error("[cadastro]", publicMsg, detail);
  return json({ error: publicMsg }, 500);
}
function normalizar(c: string) { return c.toUpperCase().replace(/[^A-Z0-9]/g, ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Corpo inválido" }, 400); }

  const codigo = normalizar(String(body.codigo || ""));
  const nome = String(body.nome || "").trim().replace(/\s+/g, " ");
  const email = String(body.email || "").trim().toLowerCase();
  const senha = String(body.senha || "");

  if (!codigo || !nome || !email || !senha) return json({ error: "Preencha código de convite, nome do estabelecimento, e-mail e senha." }, 400);
  if (codigo.length !== 12) return json({ error: CONVITE_RUIM }, 400);
  if (nome.length < 2 || nome.length > 80) return json({ error: "O nome do estabelecimento precisa ter de 2 a 80 caracteres." }, 400);
  if (!EMAIL_RE.test(email) || email.endsWith(".commandah.internal")) return json({ error: "E-mail inválido." }, 400);
  if (senha.length < SENHA_MIN) return json({ error: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` }, 400);
  if (new TextEncoder().encode(senha).length > SENHA_MAX) return json({ error: "Senha longa demais." }, 400);

  try {
    // 1) Confere o convite antes de criar qualquer conta.
    const { data: valido, error: vErr } = await admin.rpc("convite_valido", { p_codigo: codigo });
    if (vErr) return internalError("Não foi possível conferir o convite agora.", vErr);
    if (valido !== true) return json({ error: CONVITE_RUIM }, 400);

    // 2) Cria a conta do dono (a API de admin funciona com o cadastro público desligado).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password: senha, email_confirm: true,
      user_metadata: { source: "commandah-cadastro", business_name: nome },
    });
    if (cErr || !created?.user) {
      const msg = String((cErr as { message?: string } | null)?.message || "");
      const code = String((cErr as { code?: string } | null)?.code || "");
      if (code === "email_exists" || /already (been )?registered|already exists/i.test(msg)) {
        return json({ error: "Este e-mail já tem conta no Commandah. Use outro e-mail." }, 409);
      }
      if (code === "weak_password" || /password/i.test(msg)) return json({ error: "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números." }, 400);
      return internalError("Não foi possível criar a conta agora.", cErr);
    }
    const userId = created.user.id;

    // 3) Consome o convite e cria o estabelecimento (com trava no banco). Falhou: apaga a conta.
    const { data: tenantId, error: tErr } = await admin.rpc("cadastro_por_convite", { p_user: userId, p_codigo: codigo, p_nome: nome });
    if (tErr || typeof tenantId !== "string") {
      await admin.auth.admin.deleteUser(userId).catch((e) => console.error("[cadastro] falha ao desfazer conta:", e));
      const m = String(tErr?.message || "");
      if (m.includes("CONVITE_INVALIDO")) return json({ error: CONVITE_RUIM }, 400);
      if (m.includes("NOME_INVALIDO")) return json({ error: "O nome do estabelecimento precisa ter de 2 a 80 caracteres." }, 400);
      if (m.includes("JA_TEM_ESTABELECIMENTO")) return json({ error: "Este e-mail já tem conta no Commandah. Use outro e-mail." }, 409);
      return internalError("Não foi possível criar o estabelecimento agora.", tErr);
    }

    const { error: logErr } = await admin.from("audit_log").insert({
      tenant_id: tenantId, actor_name: "Cadastro", entity: "tenant", entity_id: tenantId,
      action: `Estabelecimento criado com convite (••••${codigo.slice(-4)}): ${nome}`,
      meta: { email },
    });
    if (logErr) console.error("[cadastro] falha ao registrar no audit_log:", logErr);

    return json({ ok: true, tenant_id: tenantId });
  } catch (e) {
    return internalError("Erro inesperado no cadastro.", e);
  }
});
