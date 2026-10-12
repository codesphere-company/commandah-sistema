// Edge Function: nfce (t207)
// Emite a NFC-e de uma comanda fechada pela Brasil NFe e guarda o resultado em nfce_notas.
// O token da Brasil NFe fica só aqui (secret BRASILNFE_TOKEN), nunca no navegador.
//
// POST { action: "emitir", sale_id }      -> emite (ou devolve a que já foi autorizada)
// POST { action: "consultar", sale_id }   -> últimas tentativas dessa comanda
// POST { action: "cancelar", sale_id, justificativa } -> cancela a autorizada (até 30 min, regra da SEFAZ)
//
// Ambiente: homologação (2) por padrão. Produção (1) só se as DUAS travas estiverem ligadas:
// settings.nfce.ambiente = 1 no Commandah E o secret NFCE_PRODUCAO = "liberada". Assim nenhum
// clique no site, sozinho, emite nota de verdade.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildNfcePayload, type Product, type Sale } from "./payload.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRASILNFE_TOKEN = Deno.env.get("BRASILNFE_TOKEN") || "";
const PRODUCAO_LIBERADA = Deno.env.get("NFCE_PRODUCAO") === "liberada";
const API = "https://api.brasilnfe.com.br/services/fiscal";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

// Quem chama: dono (tenant_owners) ou colaborador ativo administrador/caixa.
async function caller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const uid = data.user.id;
  const { data: owner } = await admin.from("tenant_owners").select("tenant_id").eq("user_id", uid).maybeSingle();
  if (owner) return { tenantId: owner.tenant_id as string, name: "Dono" };
  const { data: staff } = await admin.from("tenant_staff").select("tenant_id, role, active").eq("auth_user_id", uid).maybeSingle();
  if (staff && staff.active && (staff.role === "admin" || staff.role === "caixa")) {
    const meta = data.user.user_metadata as { staff_name?: string } | undefined;
    return { tenantId: staff.tenant_id as string, name: meta?.staff_name || String(staff.role) };
  }
  return null;
}

async function appData(tenantId: string, key: string) {
  const { data } = await admin.from("app_data").select("value").eq("tenant_id", tenantId).eq("key", key).maybeSingle();
  return data ? data.value : null;
}

async function brasilNfe(path: string, body: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Token: BRASILNFE_TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(text); } catch { /* resposta não-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed, text: text.slice(0, 500) };
}

function b64ToText(b64: unknown) {
  if (typeof b64 !== "string" || !b64) return null;
  try { return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch { return null; }
}

function publicRow(r: Record<string, unknown>) {
  const { xml: _xml, tenant_id: _t, ...rest } = r;
  return rest;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const who = await caller(req);
  if (!who) return json({ error: "Só o administrador ou o caixa emitem NFC-e. Entre de novo e tente outra vez." }, 403);

  let body: { action?: string; sale_id?: string; justificativa?: string };
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido." }, 400); }
  const saleId = String(body.sale_id || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(saleId)) return json({ error: "Comanda inválida." }, 400);

  if (body.action === "consultar") {
    const { data } = await admin.from("nfce_notas").select("*").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
      .order("created_at", { ascending: false }).limit(10);
    return json({ notas: (data || []).map(publicRow) });
  }
  if (body.action === "cancelar") {
    if (!BRASILNFE_TOKEN) return json({ error: "O emissor de NFC-e ainda não está configurado no servidor." }, 503);
    const just = String(body.justificativa || "").trim().replace(/\s+/g, " ");
    if (just.length < 15) return json({ error: "Escreva o motivo do cancelamento com pelo menos 15 letras." }, 400);
    const { data: nota } = await admin.from("nfce_notas").select("*").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
      .eq("status", "autorizada").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!nota) return json({ error: "Esta comanda não tem NFC-e autorizada para cancelar." }, 404);
    const r = await brasilNfe("CancelarNotaFiscal", { ChaveNF: nota.chave, Justificativa: just.slice(0, 1000), TipoAmbiente: nota.ambiente })
      .catch((e) => ({ ok: false, status: 0, body: null, text: String(e) }));
    const b = (r.body || {}) as Record<string, unknown>;
    const cod = Number(b.CodStatusRespostaSefaz) || null;
    // 135 = evento registrado e vinculado à nota; 155 = cancelamento homologado fora do prazo.
    if (cod !== 135 && cod !== 155) {
      const motivo = String(b.DsMotivo || b.Error || r.text || "sem resposta").slice(0, 300);
      const prazo = cod === 501 || /prazo/i.test(motivo);
      return json({ error: prazo
        ? "Passou o prazo de 30 minutos para cancelar esta NFC-e. Fale com o contador (nota de devolução)."
        : `A SEFAZ não aceitou o cancelamento${cod ? " (" + cod + ")" : ""}: ${motivo}` }, 422);
    }
    const upd = { status: "cancelada", cancelada_em: new Date().toISOString(), cancel_protocolo: (b.NuProtocolo as string) || null,
      cancel_motivo: just.slice(0, 500), cancelada_por: who.name };
    const { data: saved, error: updErr } = await admin.from("nfce_notas").update(upd).eq("id", nota.id).select("*").single();
    if (updErr) console.error("[nfce] cancelada na SEFAZ, mas falhou ao gravar:", updErr);
    await admin.from("audit_log").insert({
      tenant_id: who.tenantId, actor_name: who.name, entity: "sale", entity_id: saleId,
      action: `NFC-e cancelada${nota.ambiente === 2 ? " (homologação)" : ""}: nº ${nota.numero} série ${nota.serie} — ${just.slice(0, 120)}`,
      meta: { chave: nota.chave, protocolo: upd.cancel_protocolo },
    });
    return json({ nota: publicRow(saved || { ...nota, ...upd }) });
  }
  if (body.action !== "emitir") return json({ error: "Ação inválida." }, 400);
  if (!BRASILNFE_TOKEN) return json({ error: "O emissor de NFC-e ainda não está configurado no servidor (falta o token da Brasil NFe)." }, 503);

  const settings = (await appData(who.tenantId, "cantina2:settings")) as Record<string, unknown> | null;
  const cfg = (settings && (settings.nfce as Record<string, unknown>)) || {};
  const ambiente: 1 | 2 = Number(cfg.ambiente) === 1 && PRODUCAO_LIBERADA ? 1 : 2;
  const serie = Number(cfg.serie) > 0 ? Number(cfg.serie) : undefined;
  const identificador = ambiente === 1 ? saleId : saleId + "-h";

  // Já autorizada neste ambiente: devolve a mesma (clique duplo, nova tentativa depois de timeout).
  const { data: jaTem } = await admin.from("nfce_notas").select("*").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
    .eq("ambiente", ambiente).eq("status", "autorizada").maybeSingle();
  if (jaTem) return json({ nota: publicRow(jaTem), repetida: true });

  const { data: saleRow } = await admin.from("sales").select("data").eq("tenant_id", who.tenantId).eq("id", saleId).is("deleted_at", null).maybeSingle();
  if (!saleRow) return json({ error: "Comanda não encontrada." }, 404);
  const products = ((await appData(who.tenantId, "cantina2:products")) || []) as Product[];
  const built = buildNfcePayload(saleRow.data as Sale, Array.isArray(products) ? products : [], { ambiente, identificador, serie });
  if (!built.payload) return json({ error: "A NFC-e não pode ser emitida ainda.", problemas: built.problems }, 422);

  // Antes de emitir: a Brasil NFe já tem uma nota com este identificador? (resposta perdida numa tentativa anterior)
  const prev = await brasilNfe("ConsultarNotaFiscal", { IdentificadorInterno: identificador, TipoAmbiente: ambiente, ModeloDocumento: 65, RetornarArquivos: true });
  const prevNota = prev.body && prev.body.Encontrada ? (prev.body.Nota as Record<string, unknown> | undefined) : undefined;

  let ret: Record<string, unknown> | null = null, xml: string | null = null, erroCom: string | null = null;
  // A consulta usa nomes diferentes da emissão (Chave, CodStatusResposta, Emitida; XML dentro de Nota).
  if (prevNota && (prevNota.Emitida === true || Number(prevNota.CodStatusResposta) === 100)) {
    ret = {
      Numero: prevNota.Numero, Serie: prevNota.Serie, ChaveNF: prevNota.Chave, NumeroProtocolo: prevNota.NumeroProtocolo,
      CodStatusRespostaSefaz: Number(prevNota.CodStatusResposta) || 100, DsStatusRespostaSefaz: prevNota.DsStatusResposta, Ok: true,
    };
    xml = b64ToText(prevNota.Base64Xml);
  } else {
    const r = await brasilNfe("EnviarNotaFiscal", built.payload).catch((e) => ({ ok: false, status: 0, body: null, text: String(e) }));
    if (r.body && r.body.ReturnNF) {
      ret = r.body.ReturnNF as Record<string, unknown>;
      xml = b64ToText(r.body.Base64Xml);
      if (!ret.Ok && r.body.Error) ret = { ...ret, DsStatusRespostaSefaz: ret.DsStatusRespostaSefaz || r.body.Error };
    } else {
      erroCom = (r.body && (r.body.Error as string)) || `Falha ao falar com o emissor (HTTP ${r.status}).`;
      console.error("[nfce] resposta inesperada:", r.status, r.text);
    }
  }

  const cod = ret ? Number(ret.CodStatusRespostaSefaz) || null : null;
  const row = {
    tenant_id: who.tenantId, sale_id: saleId, ambiente, identificador,
    status: cod === 100 ? "autorizada" : ret ? "rejeitada" : "erro",
    numero: ret ? Number(ret.Numero) || null : null,
    serie: ret ? Number(ret.Serie) || null : null,
    chave: ret ? (ret.ChaveNF as string) || null : null,
    protocolo: ret ? (ret.NumeroProtocolo as string) || null : null,
    cod_status: cod,
    motivo: ret ? String(ret.DsStatusRespostaSefaz || "").slice(0, 500) : String(erroCom).slice(0, 500),
    valor: built.total,
    xml: cod === 100 ? xml : null,
    created_by: who.name,
  };
  const { data: saved, error } = await admin.from("nfce_notas").insert(row).select("*").single();
  if (error) {
    // Corrida com outro clique que já gravou a autorizada: devolve a que está no banco.
    const { data: other } = await admin.from("nfce_notas").select("*").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
      .eq("ambiente", ambiente).eq("status", "autorizada").maybeSingle();
    if (other) return json({ nota: publicRow(other), repetida: true });
    console.error("[nfce] falha ao gravar:", error);
    return json({ nota: publicRow(row), aviso: "A nota foi processada, mas não foi possível guardar o resultado no Commandah." });
  }
  if (row.status === "autorizada") {
    await admin.from("audit_log").insert({
      tenant_id: who.tenantId, actor_name: who.name, entity: "sale", entity_id: saleId,
      action: `NFC-e autorizada${ambiente === 2 ? " (homologação)" : ""}: nº ${row.numero} série ${row.serie}`, meta: { chave: row.chave },
    });
  }
  return json({ nota: publicRow(saved) });
});
