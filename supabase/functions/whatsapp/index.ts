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
// Eventos tratados na etapa 1: qrcode.updated e connection.update.
//
// Etapa 2 — conversas (25/11/2026; plano docs/superpowers/plans/2026-11-25-whatsapp-etapa2.md):
// webhook messages.upsert   -> grava em whatsapp_mensagens/whatsapp_conversas (whatsapp_registrar_mensagem,
//                              idempotente pelo id da Evolution). Só conversa individual: grupo, status e canal
//                              são ignorados. Jid @lid: o telefone vem de key.remoteJidAlt / key.senderPn.
// webhook messages.update   -> situação da mensagem enviada (entregue, lida, erro).
// POST { action: "enviar_texto", jid, texto } -> manda pela Evolution e grava a saída com o nome de quem enviou
// POST { action: "midia", evo_id }            -> { base64, mime } da foto/PDF (buscado na Evolution na hora)
// As duas ações: dono, admin e caixa, com plano Pro.
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
  if (owner) return (await donoSessaoOk(jwt, uid)) ? { tenantId: owner.tenant_id as string, isAdmin: true, nome: "Dono" } : null;
  const { data: staff } = await admin.from("tenant_staff").select("tenant_id, role, active").eq("auth_user_id", uid).maybeSingle();
  if (staff && staff.active && (staff.role === "admin" || staff.role === "caixa")) {
    // Nome de quem respondeu (etapa 2): o mesmo staff_name que o login por PIN guarda no usuário.
    const meta = (data.user.user_metadata || {}) as { staff_name?: unknown };
    const nome = typeof meta.staff_name === "string" && meta.staff_name.trim() ? meta.staff_name.trim().slice(0, 80)
      : (staff.role === "admin" ? "Administrador" : "Caixa");
    return { tenantId: staff.tenant_id as string, isAdmin: staff.role === "admin", nome };
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

// ---------- Etapa 2: mensagens ----------
type Item = Record<string, unknown>;
const lista = (d: unknown): Item[] => (Array.isArray(d) ? d : d && typeof d === "object" ? [d] : []) as Item[];
const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
// Só conversa individual (o número de um cliente). Grupo, status e canal ficam de fora.
const individual = (jid: string) => /@(s\.whatsapp\.net|lid)$/.test(jid);
const telefoneDe = (jid: string) => (jid.split("@")[0].split(":")[0].replace(/\D/g, "") || null);

// Revisão final (25/11): o que não é conteúdo (reação, apagar/editar, chaves de criptografia, enquete) não vira
// mensagem nem conta como não lida. Mensagem temporária / de ver uma vez vem embrulhada: desembrulha antes.
const SEM_CONTEUDO = ["reactionMessage", "protocolMessage", "editedMessage", "senderKeyDistributionMessage",
  "messageContextInfo", "pollUpdateMessage", "keepInChatMessage", "pinInChatMessage", "encReactionMessage"];
const EMBRULHOS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"];
function desembrulhar(message: Item | undefined): Item {
  let m = (message || {}) as Item;
  for (let i = 0; i < 3; i++) {
    const k = EMBRULHOS.find((e) => m[e] && typeof m[e] === "object");
    if (!k) break;
    m = (((m[k] as Item).message as Item | undefined) || {}) as Item;
  }
  return m;
}
const temConteudo = (m: Item) => Object.keys(m).some((k) => !SEM_CONTEUDO.includes(k));

// Tipo, texto, arquivo e mime pela chave da mensagem da Evolution/Baileys.
function conteudo(message: Item | undefined) {
  const m = desembrulhar(message) as Record<string, Item | undefined>;
  const doc = m.documentMessage || (m.documentWithCaptionMessage?.message as Record<string, Item> | undefined)?.documentMessage;
  if (typeof m.conversation === "string") return { tipo: "texto", texto: m.conversation as unknown as string, arquivo: null, mime: null };
  if (m.extendedTextMessage) return { tipo: "texto", texto: texto(m.extendedTextMessage.text), arquivo: null, mime: null };
  if (m.imageMessage) return { tipo: "imagem", texto: texto(m.imageMessage.caption), arquivo: null, mime: texto(m.imageMessage.mimetype) };
  if (doc) return { tipo: "documento", texto: texto(doc.caption), arquivo: texto(doc.fileName) || texto(doc.title), mime: texto(doc.mimetype) };
  if (m.audioMessage) return { tipo: "audio", texto: null, arquivo: null, mime: texto(m.audioMessage.mimetype) };
  if (m.videoMessage) return { tipo: "outro", texto: texto(m.videoMessage.caption) || "Vídeo", arquivo: null, mime: texto(m.videoMessage.mimetype) };
  if (m.stickerMessage) return { tipo: "outro", texto: "Figurinha", arquivo: null, mime: null };
  return { tipo: "outro", texto: null, arquivo: null, mime: null };
}

async function registrar(tenantId: string, a: {
  jid: string; telefone: string | null; nome: string | null; evoId: string; direcao: "entrada" | "saida";
  tipo: string; texto: string | null; arquivo: string | null; mime: string | null; enviadaPor: string | null; quando: string;
}) {
  const { error } = await admin.rpc("whatsapp_registrar_mensagem", {
    p_tenant: tenantId, p_jid: a.jid, p_telefone: a.telefone, p_nome: a.nome, p_evo_id: a.evoId, p_direcao: a.direcao,
    p_tipo: a.tipo, p_texto: a.texto, p_arquivo: a.arquivo, p_mime: a.mime, p_enviada_por: a.enviadaPor, p_criada_em: a.quando,
  });
  if (error) throw error;
}

async function mensagensRecebidas(tenantId: string, data: unknown) {
  for (const item of lista(data)) {
    const key = (item.key || {}) as Item;
    const jid = String(key.remoteJid || ""), evoId = String(key.id || "");
    if (!evoId || !individual(jid)) continue;
    if (!temConteudo(desembrulhar(item.message as Item | undefined))) continue;
    const alt = String(key.remoteJidAlt || key.senderPn || "");
    const telefone = jid.endsWith("@lid") ? (alt ? telefoneDe(alt) : null) : telefoneDe(jid);
    const ts = Number(item.messageTimestamp);
    const quando = new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString();
    const c = conteudo(item.message as Item | undefined);
    const fromMe = key.fromMe === true;
    await registrar(tenantId, {
      jid, telefone, nome: fromMe ? null : texto(item.pushName), evoId, direcao: fromMe ? "saida" : "entrada",
      tipo: c.tipo, texto: c.texto, arquivo: c.arquivo, mime: c.mime, enviadaPor: null, quando,
    });
  }
}

const SITUACAO_EVO: Record<string, string> = { SERVER_ACK: "enviada", DELIVERY_ACK: "entregue", READ: "lida", PLAYED: "lida", ERROR: "erro" };
async function situacoesMensagens(tenantId: string, data: unknown) {
  for (const item of lista(data)) {
    const evoId = String(item.keyId || (item.key as Item | undefined)?.id || "");
    const sit = SITUACAO_EVO[String(item.status || "").toUpperCase()];
    if (!evoId || !sit) continue;
    const { error } = await admin.rpc("whatsapp_atualizar_situacao", { p_tenant: tenantId, p_evo_id: evoId, p_situacao: sit });
    if (error) throw error;
  }
}

async function enviarTexto(tenantId: string, nome: string, body: { jid?: unknown; texto?: unknown }) {
  const jid = typeof body.jid === "string" ? body.jid : "";
  const txt = typeof body.texto === "string" ? body.texto.trim() : "";
  if (!individual(jid)) return json({ ok: false, erro: "Conversa inválida." }, 400);
  if (!txt || txt.length > 4096) return json({ ok: false, erro: "Escreva a mensagem (até 4096 caracteres)." }, 400);
  let r;
  try {
    r = await evolution("POST", `/message/sendText/${encodeURIComponent(tenantId)}`, { number: jid, text: txt });
  } catch (e) {
    console.error("[whatsapp] enviar_texto:", e);
    return json({ ok: false, erro: FORA_DO_AR }, 503);
  }
  const evoId = r.ok ? String(((r.body?.key as Item | undefined) || {}).id || "") : "";
  if (!evoId) { console.error("[whatsapp] enviar_texto:", r.status, r.body); return json({ ok: false, erro: FORA_DO_AR }, 503); }
  const quando = new Date().toISOString();
  const telefone = jid.endsWith("@lid") ? null : telefoneDe(jid);
  await registrar(tenantId, { jid, telefone, nome: null, evoId, direcao: "saida", tipo: "texto", texto: txt, arquivo: null, mime: null, enviadaPor: nome, quando });
  return json({ ok: true, mensagem: { evo_id: evoId, criada_em: quando } });
}

async function midia(tenantId: string, body: { evo_id?: unknown }) {
  const evoId = typeof body.evo_id === "string" ? body.evo_id : "";
  if (!evoId) return json({ ok: false, erro: "Mensagem não encontrada." }, 404);
  const { data: msg, error } = await admin.from("whatsapp_mensagens").select("jid, direcao, mime")
    .eq("tenant_id", tenantId).eq("evo_id", evoId).maybeSingle();
  if (error) throw error;
  if (!msg) return json({ ok: false, erro: "Mensagem não encontrada." }, 404);
  try {
    const r = await evolution("POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(tenantId)}`, {
      message: { key: { id: evoId, remoteJid: msg.jid, fromMe: msg.direcao === "saida" } }, convertToMp4: false,
    });
    const b64 = r.ok && typeof r.body?.base64 === "string" ? r.body.base64 as string : "";
    if (!b64) {
      console.error("[whatsapp] midia:", r.status);
      return json({ ok: false, erro: "Não deu para abrir o arquivo. Veja no celular da lanchonete." }, r.status === 400 || r.status === 404 ? 404 : 503);
    }
    return json({ ok: true, base64: b64, mime: texto(r.body?.mimetype) || msg.mime || "application/octet-stream" });
  } catch (e) {
    console.error("[whatsapp] midia:", e);
    return json({ ok: false, erro: FORA_DO_AR }, 503);
  }
}

async function webhook(k: string, req: Request) {
  let corpo: { event?: string; instance?: string; data?: Record<string, unknown> } = {};
  try { corpo = await req.json(); } catch { return json({ ok: false, erro: "corpo inválido" }, 400); }
  const tenantId = typeof corpo.instance === "string" ? corpo.instance : "";
  const linha = tenantId ? await lerLinha(tenantId) : null;
  if (!linha || !k || !iguais(k, linha.webhook_segredo)) return json({ ok: false }, 401);
  const evento = String(corpo.event || "").toLowerCase().replace(/_/g, ".");
  const data = corpo.data || {};
  if (evento === "messages.upsert") { await mensagensRecebidas(tenantId, corpo.data); return json({ ok: true }); }
  if (evento === "messages.update") { await situacoesMensagens(tenantId, corpo.data); return json({ ok: true }); }
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
    // A Evolution real (v2.3.8, conferido no VPS em 25/11) não devolve o QR no create: ele vem no connect.
    if (!r.ok && (r.status === 403 || r.status === 409) || (r.ok && !qr)) {
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
    let body: { action?: string; jid?: unknown; texto?: unknown; evo_id?: unknown } = {};
    try { body = await req.json(); } catch { /* corpo vazio */ }
    if (body.action === "situacao") return await situacao(quem.tenantId, quem.isAdmin);
    if (body.action === "enviar_texto" || body.action === "midia") {
      if (!(await planoPro(quem.tenantId))) return json({ ok: false, erro: "Plano Pro" }, 402);
      return body.action === "enviar_texto" ? await enviarTexto(quem.tenantId, quem.nome, body) : await midia(quem.tenantId, body);
    }
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
