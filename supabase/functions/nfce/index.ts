// Edge Function: nfce (t207)
// Emite a NFC-e de uma comanda fechada pela Brasil NFe e guarda o resultado em nfce_notas.
// 11/11/2026 (auditoria de lançamento): cada estabelecimento usa o PRÓPRIO emissor (tabela nfce_emissores,
// token da Brasil NFe cifrado no Vault). O token nunca vai para o navegador. Sem emissor configurado,
// o estabelecimento não emite nada, nem em homologação. O secret BRASILNFE_TOKEN (o da lanchonete do
// clube) só vale para o estabelecimento marcado com usa_token_do_servidor (transição).
//
// POST { action: "emitir", sale_id }      -> emite (ou devolve a que já foi autorizada)
// POST { action: "consultar", sale_id }   -> últimas tentativas dessa comanda
// POST { action: "cancelar", sale_id, justificativa } -> cancela a autorizada (até 30 min, regra da SEFAZ)
// POST { action: "emissor" }                 -> situação do emissor do estabelecimento (administrador)
// POST { action: "emissor_salvar", token }   -> cadastra/troca o token da Brasil NFe (administrador)
// POST { action: "emissor_remover" }         -> apaga o token (administrador)
//
// Ambiente: homologação (2) por padrão. Produção (1) só se as DUAS travas do estabelecimento estiverem
// ligadas: settings.nfce.ambiente = 1 (o dono escolhe na tela) E nfce_emissores.producao_liberada
// (a equipe do Commandah liga pelo CLI, função nfce_liberar_producao). Assim nenhum clique no site,
// sozinho, emite nota de verdade, e um estabelecimento nunca libera a produção de outro.
//
// Série: uma só para todos os aparelhos (settings.nfce.serie). A emissão passa por uma trava
// por estabelecimento (t215), então nunca há dois envios ao mesmo tempo na série.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildNfcePayload, type Product, type Sale } from "./payload.ts";
import { buscarXmlCancelamento } from "./cancelamento.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_DO_SERVIDOR = Deno.env.get("BRASILNFE_TOKEN") || "";
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

// Quem chama: dono (tenant_owners) ou colaborador ativo administrador/caixa/garçom.
// isAdmin (dono ou perfil admin): só ele cancela NFC-e (08/11, pedido do dono).
// O token do emissor também é do administrador (11/11): depois do PIN a sessão do aparelho é sempre a do
// colaborador (login.js), então o dono opera pelo perfil Administrador. O token só vale para o próprio
// estabelecimento e a nota de verdade continua dependendo da liberação da equipe do Commandah.
async function caller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const uid = data.user.id;
  const { data: owner } = await admin.from("tenant_owners").select("tenant_id").eq("user_id", uid).maybeSingle();
  if (owner) return { tenantId: owner.tenant_id as string, name: "Dono", isAdmin: true };
  const { data: staff } = await admin.from("tenant_staff").select("tenant_id, role, active").eq("auth_user_id", uid).maybeSingle();
  if (staff && staff.active && (staff.role === "admin" || staff.role === "caixa" || staff.role === "garcom")) {
    const meta = data.user.user_metadata as { staff_name?: string } | undefined;
    return { tenantId: staff.tenant_id as string, name: meta?.staff_name || String(staff.role), isAdmin: staff.role === "admin" };
  }
  return null;
}

async function appData(tenantId: string, key: string) {
  const { data } = await admin.from("app_data").select("value").eq("tenant_id", tenantId).eq("key", key).maybeSingle();
  return data ? data.value : null;
}

// Emissor do estabelecimento (nfce_emissores + Vault). Erro de leitura sobe (vira 503 no chamador).
type LinhaEmissor = { token: string | null; usa_token_do_servidor: boolean; producao_liberada: boolean; token_final: string | null };
async function lerEmissor(tenantId: string): Promise<LinhaEmissor | null> {
  const { data, error } = await admin.rpc("nfce_emissor_ler", { p_tenant: tenantId });
  if (error) throw error;
  return ((Array.isArray(data) ? data[0] : data) as LinhaEmissor | undefined) || null;
}
function tokenDo(linha: LinhaEmissor | null): { token: string; origem: "proprio" | "servidor" } | null {
  if (!linha) return null;
  if (linha.token) return { token: linha.token, origem: "proprio" };
  if (linha.usa_token_do_servidor && TOKEN_DO_SERVIDOR) return { token: TOKEN_DO_SERVIDOR, origem: "servidor" };
  return null;
}
function situacaoEmissor(linha: LinhaEmissor | null) {
  const t = tokenDo(linha);
  return {
    configurado: !!t,
    origem: t ? t.origem : null,
    final: t && t.origem === "proprio" && linha ? linha.token_final : null,
    producao_liberada: !!(linha && linha.producao_liberada),
  };
}
const SEM_EMISSOR = "Este estabelecimento ainda não tem emissor de NFC-e. O administrador cadastra o token da Brasil NFe em Configurações › NFC-e.";
const FALHA_EMISSOR = "Não foi possível ler o emissor de NFC-e agora. Tente de novo em alguns segundos.";

async function brasilNfe(token: string, path: string, body: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Token: token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(text); } catch { /* resposta não-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed, text: text.slice(0, 500), raw: text };
}

// t215: trava de emissão (tabela nfce_trava). O prazo cobre a consulta e o envio (45 s cada) com
// folga; se a função cair, a trava vence sozinha. Quem acha ocupada espera até TRAVA_ESPERA_MS.
const TRAVA_PRAZO_S = 120, TRAVA_ESPERA_MS = 25000, TRAVA_INTERVALO_MS = 400;

async function pegarTrava(tenantId: string) {
  const token = crypto.randomUUID();
  const limite = Date.now() + TRAVA_ESPERA_MS;
  while (true) {
    const { data, error } = await admin.rpc("nfce_trava_pegar", { p_tenant: tenantId, p_token: token, p_segundos: TRAVA_PRAZO_S });
    if (error) { console.error("[nfce] falha ao pegar a trava:", error); return null; }
    if (data === true) return token;
    if (Date.now() + TRAVA_INTERVALO_MS > limite) return null;
    await new Promise((r) => setTimeout(r, TRAVA_INTERVALO_MS));
  }
}

async function soltarTrava(tenantId: string, token: string) {
  const { error } = await admin.rpc("nfce_trava_soltar", { p_tenant: tenantId, p_token: token });
  if (error) console.error("[nfce] falha ao soltar a trava (vence sozinha):", error);
}

function b64ToText(b64: unknown) {
  if (typeof b64 !== "string" || !b64) return null;
  try { return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch { return null; }
}

function publicRow(r: Record<string, unknown>) {
  const { xml: _xml, xml_cancelamento: _xc, tenant_id: _t, ...rest } = r;
  return rest;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const who = await caller(req);
  if (!who) return json({ error: "Só o administrador, o caixa ou o garçom emitem NFC-e. Entre de novo e tente outra vez." }, 403);

  let body: { action?: string; sale_id?: string; justificativa?: string; token?: string };
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido." }, 400); }

  // ---- Emissor do estabelecimento (11/11). Não depende de comanda.
  if (body.action === "emissor" || body.action === "emissor_salvar" || body.action === "emissor_remover") {
    if (!who.isAdmin) return json({ error: "Só o administrador vê e configura o emissor de NFC-e." }, 403);
    try {
      if (body.action === "emissor_salvar") {
        const token = String(body.token || "").trim();
        if (!/^\S{8,512}$/.test(token)) return json({ error: "Cole o token inteiro da Brasil NFe, sem espaços." }, 400);
        // Confere com a Brasil NFe antes de guardar: uma consulta em homologação, que não emite nada.
        const t = await brasilNfe(token, "ConsultarNotaFiscal", { IdentificadorInterno: "commandah-confere-token", TipoAmbiente: 2, ModeloDocumento: 65 })
          .catch((e) => ({ ok: false, status: 0, body: null as Record<string, unknown> | null, text: String(e), raw: "" }));
        const msg = String((t.body && (t.body.Error || t.body.Message)) || "");
        if (t.status === 0) return json({ error: "Não foi possível falar com a Brasil NFe para conferir o token. Tente de novo." }, 503);
        if (t.status === 401 || t.status === 403 || /token/i.test(msg)) {
          return json({ error: "A Brasil NFe recusou este token. Confira se copiou o token inteiro da conta do estabelecimento." }, 422);
        }
        const { error } = await admin.rpc("nfce_emissor_salvar_token", { p_tenant: who.tenantId, p_token: token, p_por: who.name });
        if (error) throw error;
        await admin.from("audit_log").insert({
          tenant_id: who.tenantId, actor_name: who.name, entity: "nfce", entity_id: null,
          action: `NFC-e: token do emissor (Brasil NFe) cadastrado, termina em ${token.slice(-4)}`, meta: {},
        });
      } else if (body.action === "emissor_remover") {
        const { error } = await admin.rpc("nfce_emissor_remover_token", { p_tenant: who.tenantId, p_por: who.name });
        if (error) throw error;
        await admin.from("audit_log").insert({
          tenant_id: who.tenantId, actor_name: who.name, entity: "nfce", entity_id: null,
          action: "NFC-e: token do emissor (Brasil NFe) apagado", meta: {},
        });
      }
      return json({ emissor: situacaoEmissor(await lerEmissor(who.tenantId)) });
    } catch (e) {
      console.error("[nfce] emissor:", e);
      return json({ error: FALHA_EMISSOR }, 503);
    }
  }

  const saleId = String(body.sale_id || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(saleId)) return json({ error: "Comanda inválida." }, 400);

  if (body.action === "consultar") {
    const { data } = await admin.from("nfce_notas").select("*").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
      .order("created_at", { ascending: false }).limit(10);
    return json({ notas: (data || []).map(publicRow) });
  }
  if (body.action === "cancelar") {
    if (!who.isAdmin) return json({ error: "Só o administrador cancela NFC-e." }, 403);
    let emC: { token: string } | null;
    try { emC = tokenDo(await lerEmissor(who.tenantId)); } catch (e) { console.error("[nfce] emissor:", e); return json({ error: FALHA_EMISSOR }, 503); }
    if (!emC) return json({ error: SEM_EMISSOR }, 503);
    const tokenC = emC.token;
    const chamarC = (path: string, b: unknown) => brasilNfe(tokenC, path, b);
    const just = String(body.justificativa || "").trim().replace(/\s+/g, " ");
    if (just.length < 15) return json({ error: "Escreva o motivo do cancelamento com pelo menos 15 letras." }, 400);
    const { data: nota } = await admin.from("nfce_notas").select("*").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
      .eq("status", "autorizada").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!nota) return json({ error: "Esta comanda não tem NFC-e autorizada para cancelar." }, 404);
    const r = await chamarC("CancelarNotaFiscal", { ChaveNF: nota.chave, Justificativa: just.slice(0, 1000), TipoAmbiente: nota.ambiente })
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
    const evento = await buscarXmlCancelamento(chamarC, nota, b);
    const upd = { status: "cancelada", cancelada_em: new Date().toISOString(), cancel_protocolo: (b.NuProtocolo as string) || null,
      cancel_motivo: just.slice(0, 500), cancelada_por: who.name, xml_cancelamento: evento.xml };
    const { data: saved, error: updErr } = await admin.from("nfce_notas").update(upd).eq("id", nota.id).select("*").single();
    if (updErr) console.error("[nfce] cancelada na SEFAZ, mas falhou ao gravar:", updErr);
    await admin.from("audit_log").insert({
      tenant_id: who.tenantId, actor_name: who.name, entity: "sale", entity_id: saleId,
      action: `NFC-e cancelada${nota.ambiente === 2 ? " (homologação)" : ""}: nº ${nota.numero} série ${nota.serie} — ${just.slice(0, 120)}`,
      meta: { chave: nota.chave, protocolo: upd.cancel_protocolo, xml_evento: evento.origem, campos: evento.campos },
    });
    return json({ nota: publicRow(saved || { ...nota, ...upd }) });
  }
  if (body.action !== "emitir") return json({ error: "Ação inválida." }, 400);
  let linha: LinhaEmissor | null;
  try { linha = await lerEmissor(who.tenantId); } catch (e) { console.error("[nfce] emissor:", e); return json({ error: FALHA_EMISSOR }, 503); }
  const em = tokenDo(linha);
  if (!em) return json({ error: SEM_EMISSOR }, 503);
  const tokenE = em.token;
  const chamar = (path: string, b: unknown) => brasilNfe(tokenE, path, b);

  const settings = (await appData(who.tenantId, "cantina2:settings")) as Record<string, unknown> | null;
  const cfg = (settings && (settings.nfce as Record<string, unknown>)) || {};
  // Produção só com as duas travas DESTE estabelecimento (a da tela e a liberação da equipe).
  const ambiente: 1 | 2 = Number(cfg.ambiente) === 1 && !!(linha && linha.producao_liberada) ? 1 : 2;
  const serie = Number(cfg.serie) > 0 ? Number(cfg.serie) : undefined;
  const baseId = ambiente === 1 ? saleId : saleId + "-h";

  // t215: uma emissão por vez no estabelecimento. Todos os aparelhos usam a mesma série e a
  // Brasil NFe dá o número; dois envios ao mesmo tempo na série poderiam repetir o número.
  // A trava também cobre a corrida de dois cliques na mesma comanda (a checagem abaixo fica dentro dela).
  const trava = await pegarTrava(who.tenantId);
  if (!trava) return json({ error: "Outra NFC-e está sendo emitida agora. Tente de novo em alguns segundos." }, 503);
  try {
    // Já autorizada neste ambiente: devolve a mesma (clique duplo, nova tentativa depois de timeout).
    const { data: jaTem } = await admin.from("nfce_notas").select("*").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
      .eq("ambiente", ambiente).eq("status", "autorizada").maybeSingle();
    if (jaTem) return json({ nota: publicRow(jaTem), repetida: true });

    // t214: depois de um cancelamento a Brasil NFe continua achando a nota antiga pelo identificador
    // (e diz que foi emitida). Com o mesmo identificador, a consulta abaixo regravava a nota cancelada
    // como autorizada, sem emitir. Cada cancelamento da comanda pede um identificador novo.
    const { data: canceladas } = await admin.from("nfce_notas").select("chave").eq("tenant_id", who.tenantId).eq("sale_id", saleId)
      .eq("ambiente", ambiente).eq("status", "cancelada");
    const chavesCanceladas = new Set((canceladas || []).map((c) => c.chave).filter(Boolean));
    const identificador = chavesCanceladas.size ? baseId + "-" + (chavesCanceladas.size + 1) : baseId;

    const { data: saleRow } = await admin.from("sales").select("data").eq("tenant_id", who.tenantId).eq("id", saleId).is("deleted_at", null).maybeSingle();
    if (!saleRow) return json({ error: "Comanda não encontrada." }, 404);
    const products = ((await appData(who.tenantId, "cantina2:products")) || []) as Product[];
    const built = buildNfcePayload(saleRow.data as Sale, Array.isArray(products) ? products : [], { ambiente, identificador, serie });
    if (!built.payload) return json({ error: "A NFC-e não pode ser emitida ainda.", problemas: built.problems }, 422);

    // Antes de emitir: a Brasil NFe já tem uma nota com este identificador? (resposta perdida numa tentativa anterior)
    const prev = await chamar("ConsultarNotaFiscal", { IdentificadorInterno: identificador, TipoAmbiente: ambiente, ModeloDocumento: 65, RetornarArquivos: true });
    let prevNota = prev.body && prev.body.Encontrada ? (prev.body.Nota as Record<string, unknown> | undefined) : undefined;
    if (prevNota && chavesCanceladas.has(String(prevNota.Chave || ""))) prevNota = undefined;

    let ret: Record<string, unknown> | null = null, xml: string | null = null, erroCom: string | null = null;
    // A consulta usa nomes diferentes da emissão (Chave, CodStatusResposta, Emitida; XML dentro de Nota).
    if (prevNota && (prevNota.Emitida === true || Number(prevNota.CodStatusResposta) === 100)) {
      ret = {
        Numero: prevNota.Numero, Serie: prevNota.Serie, ChaveNF: prevNota.Chave, NumeroProtocolo: prevNota.NumeroProtocolo,
        CodStatusRespostaSefaz: Number(prevNota.CodStatusResposta) || 100, DsStatusRespostaSefaz: prevNota.DsStatusResposta, Ok: true,
      };
      xml = b64ToText(prevNota.Base64Xml);
    } else {
      const r = await chamar("EnviarNotaFiscal", built.payload).catch((e) => ({ ok: false, status: 0, body: null, text: String(e) }));
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
  } finally {
    await soltarTrava(who.tenantId, trava);
  }
});
