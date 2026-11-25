// Edge Function: whatsapp (25/11/2026, pedido do dono; desenho em docs/superpowers/specs/2026-11-25-whatsapp-design.md)
// Única ponte entre o Commandah e a Evolution API (servidor próprio, v2.3.8). A chave global da Evolution
// (EVOLUTION_API_KEY) fica só aqui e no servidor; o navegador nunca a vê. Uma instância por
// estabelecimento, com o nome = tenant_id. Recurso do plano Pro (whatsapp_plano_pro: 'pro' ou 'isento').
//
// Etapa 1 — conexão:
// POST { action: "situacao" }    -> { plano_pro, situacao, numero, qr, pode_conectar } (dono, admin, caixa)
// POST { action: "conectar" }    -> cria a instância (ou reaproveita) e devolve o QR (dono, admin)
// POST { action: "desconectar" } -> sai do WhatsApp e apaga a instância (dono, admin)
//
// Webhook da Evolution: POST <função>?k=<segredo> com { event, instance, data }. A Evolution não assina o
// webhook, então o segredo (64 hex, um por estabelecimento, whatsapp_instancias.webhook_segredo) vai na URL
// e é comparado em tempo constante com o da instância citada. Sem JWT: publicar com --no-verify-jwt; as
// ações do app conferem o JWT aqui dentro, como a nfce.
// Eventos tratados na etapa 1: qrcode.updated e connection.update. Mensagens chegam na etapa 2.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { comCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVOLUTION_URL = (Deno.env.get("EVOLUTION_URL") || "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const WEBHOOK_URL = Deno.env.get("WHATSAPP_WEBHOOK_URL") || "";
const EVENTOS = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"];
const PRAZO_MS = 8000;
// QR sem renovação há mais que isto (webhook não chegou): a consulta pede um QR novo à Evolution.
const QR_VELHO_MS = 45000;
// Revisão final (25/11): "close" com estes motivos é saída de verdade (logout, banido, sessão trocada).
// Os outros (515 = reinício logo depois de ler o QR, 408/428/500 = rede) a Evolution reconecta sozinha.
const SAIU_DE_VERDADE = new Set([401, 402, 403, 406, 440]);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const FORA_DO_AR = "Não foi possível falar com o WhatsApp agora. Tente de novo em alguns segundos.";

// Mesma regra da nfce (item 3, 12/11): dono com 2 etapas ligada só vale numa sessão aal2.
async function donoSessaoOk(jwt: string, uid: string): Promise<boolean> {
  try {
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
    if (payload && payload.aal === "aal2") return true;
  } catch { /* JWT sem payload legível: segue para a lista de fatores */ }
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: uid });
  if (error) { console.error("[dono-aal] listFactors:", error); return false; }
  return !(data?.factors || []).some((f: { status?: string }) => f.status === "verified");
}

// Quem chama: dono ou colaborador ativo administrador/caixa. isAdmin = pode conectar/desconectar.
async function caller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const uid = data.user.id;
  const { data: owner } = await admin.from("tenant_owners").select("tenant_id").eq("user_id", uid).maybeSingle();
  if (owner) return (await donoSessaoOk(jwt, uid)) ? { tenantId: owner.tenant_id as string, isAdmin: true } : null;
  const { data: staff } = await admin.from("tenant_staff").select("tenant_id, role, active").eq("auth_user_id", uid).maybeSingle();
  if (staff && staff.active && (staff.role === "admin" || staff.role === "caixa")) {
    return { tenantId: staff.tenant_id as string, isAdmin: staff.role === "admin" };
  }
  return null;
}

type Linha = { situacao: string; numero: string | null; qr: string | null; webhook_segredo: string; atualizado_em: string };
async function lerLinha(tenantId: string): Promise<Linha | null> {
  const { data, error } = await admin.from("whatsapp_instancias").select("situacao, numero, qr, webhook_segredo, atualizado_em").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return (data as Linha | null) || null;
}
async function gravar(tenantId: string, situacao: string, numero: string | null, qr: string | null) {
  const { error } = await admin.rpc("whatsapp_instancia_atualizar", { p_tenant: tenantId, p_situacao: situacao, p_numero: numero, p_qr: qr });
  if (error) throw error;
}
async function planoPro(tenantId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("whatsapp_plano_pro", { p_tenant: tenantId });
  if (error) throw error;
  return data === true;
}

async function evolution(method: string, path: string, body?: unknown) {
  const res = await fetch(EVOLUTION_URL + path, {
    method,
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(PRAZO_MS),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

function qrDe(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const q = (body.qrcode as Record<string, unknown> | undefined) || body;
  return typeof q.base64 === "string" ? q.base64 : null;
}
const numeroDe = (wuid: unknown) => (typeof wuid === "string" ? wuid.split("@")[0].replace(/\D/g, "") : "") || null;

// Comparação em tempo constante (o tamanho do segredo é fixo, 64).
function iguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let dif = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) dif |= (ea[i] || 0) ^ (eb[i] || 0);
  return dif === 0;
}

async function webhook(k: string, req: Request) {
  let corpo: { event?: string; instance?: string; data?: Record<string, unknown> } = {};
  try { corpo = await req.json(); } catch { return json({ ok: false, erro: "corpo inválido" }, 400); }
  const tenantId = typeof corpo.instance === "string" ? corpo.instance : "";
  const linha = tenantId ? await lerLinha(tenantId) : null;
  if (!linha || !k || !iguais(k, linha.webhook_segredo)) return json({ ok: false }, 401);
  const evento = String(corpo.event || "").toLowerCase().replace(/_/g, ".");
  const data = corpo.data || {};
  if (evento === "qrcode.updated") {
    const qr = qrDe(data);
    if (qr) await gravar(tenantId, "aguardando_qr", linha.numero, qr);
  } else if (evento === "connection.update") {
    const st = String(data.state || "");
    if (st === "open") await gravar(tenantId, "conectado", numeroDe(data.wuid) || linha.numero, null);
    else if (st === "close") {
      const motivo = Number(data.statusReason ?? (data as { statusCode?: unknown }).statusCode);
      if (!Number.isFinite(motivo) || SAIU_DE_VERDADE.has(motivo)) await gravar(tenantId, "desconectado", null, null);
    }
  }
  return json({ ok: true });
}

async function situacao(tenantId: string, isAdmin: boolean) {
  if (!(await planoPro(tenantId))) return json({ ok: true, plano_pro: false });
  let linha = await lerLinha(tenantId);
  let aviso: string | undefined;
  if (linha && linha.situacao !== "desconectado") {
    try {
      const r = await evolution("GET", `/instance/connectionState/${encodeURIComponent(tenantId)}`);
      const st = r.ok ? String(((r.body?.instance as Record<string, unknown>) || {}).state || "") : "";
      if (st === "open" && linha.situacao !== "conectado") await gravar(tenantId, "conectado", linha.numero, null);
      else if (st === "close" || r.status === 404) await gravar(tenantId, "desconectado", null, null);
      // Revisão final: sem webhook o QR gravado vence; esperando a leitura e com o QR velho, pede outro.
      else if (linha.situacao === "aguardando_qr" && Date.now() - new Date(linha.atualizado_em).getTime() > QR_VELHO_MS) {
        const c = await evolution("GET", `/instance/connect/${encodeURIComponent(tenantId)}`);
        const qr = c.ok ? qrDe(c.body) : null;
        if (qr) await gravar(tenantId, "aguardando_qr", linha.numero, qr);
      }
      linha = await lerLinha(tenantId);
    } catch (e) {
      console.error("[whatsapp] connectionState:", e);
      aviso = FORA_DO_AR;
    }
  }
  return json({
    ok: true, plano_pro: true, pode_conectar: isAdmin,
    situacao: linha ? linha.situacao : "desconectado",
    numero: linha ? linha.numero : null,
    qr: linha && linha.situacao === "aguardando_qr" ? linha.qr : null,
    ...(aviso ? { aviso } : {}),
  });
}

async function conectar(tenantId: string) {
  const { data: segredo, error } = await admin.rpc("whatsapp_instancia_preparar", { p_tenant: tenantId });
  if (error || !segredo) throw error || new Error("sem segredo");
  const nome = encodeURIComponent(tenantId);
  try {
    let r = await evolution("POST", "/instance/create", {
      instanceName: tenantId, qrcode: true, integration: "WHATSAPP-BAILEYS",
      webhook: { enabled: true, url: `${WEBHOOK_URL}?k=${segredo}`, events: EVENTOS },
    });
    let qr = r.ok ? qrDe(r.body) : null;
    // Instância já existe na Evolution (conectou antes ou a tela foi aberta de novo): só pede QR novo.
    if (!r.ok && (r.status === 403 || r.status === 409)) {
      r = await evolution("GET", `/instance/connect/${nome}`);
      qr = r.ok ? qrDe(r.body) : null;
    }
    if (!r.ok) { console.error("[whatsapp] conectar:", r.status, r.body); return json({ ok: false, erro: FORA_DO_AR }, 503); }
    const linha = await lerLinha(tenantId);
    await gravar(tenantId, "aguardando_qr", linha ? linha.numero : null, qr);
    return json({ ok: true, situacao: "aguardando_qr", qr });
  } catch (e) {
    console.error("[whatsapp] conectar:", e);
    return json({ ok: false, erro: FORA_DO_AR }, 503);
  }
}

async function desconectar(tenantId: string) {
  const nome = encodeURIComponent(tenantId);
  try {
    const sair = await evolution("DELETE", `/instance/logout/${nome}`);
    const apagar = await evolution("DELETE", `/instance/delete/${nome}`);
    // 404 = a Evolution já não tem a instância: para o Commandah, desconectado do mesmo jeito.
    if ((!sair.ok && sair.status !== 404 && sair.status !== 400) || (!apagar.ok && apagar.status !== 404)) {
      console.error("[whatsapp] desconectar:", sair.status, apagar.status);
      return json({ ok: false, erro: FORA_DO_AR }, 503);
    }
  } catch (e) {
    console.error("[whatsapp] desconectar:", e);
    return json({ ok: false, erro: FORA_DO_AR }, 503);
  }
  if (await lerLinha(tenantId)) await gravar(tenantId, "desconectado", null, null);
  return json({ ok: true, situacao: "desconectado" });
}

Deno.serve(comCors(async (req) => {
  if (req.method !== "POST") return json({ ok: false, erro: "método" }, 405);
  try {
    const k = new URL(req.url).searchParams.get("k");
    if (k !== null) return await webhook(k, req);
    const quem = await caller(req);
    if (!quem) return json({ ok: false, erro: "Entre de novo no Commandah." }, 401);
    let body: { action?: string } = {};
    try { body = await req.json(); } catch { /* corpo vazio */ }
    if (body.action === "situacao") return await situacao(quem.tenantId, quem.isAdmin);
    if (body.action === "conectar" || body.action === "desconectar") {
      if (!quem.isAdmin) return json({ ok: false, erro: "Só o administrador conecta ou desconecta o WhatsApp." }, 403);
      if (!(await planoPro(quem.tenantId))) return json({ ok: false, erro: "Plano Pro" }, 402);
      return body.action === "conectar" ? await conectar(quem.tenantId) : await desconectar(quem.tenantId);
    }
    return json({ ok: false, erro: "ação desconhecida" }, 400);
  } catch (e) {
    console.error("[whatsapp] erro:", e);
    return json({ ok: false, erro: "Erro no servidor do WhatsApp." }, 500);
  }
}));
