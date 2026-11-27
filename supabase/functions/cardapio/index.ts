// Edge Function "cardapio" — cardápio digital público (sem login).
// Etapa 1 (26/11/2026): olhar. Etapa 2 (26/11/2026): o sócio pede e marca na cota.
// Desenho: docs/superpowers/specs/2026-11-26-cardapio-etapa1-design.md e ...-etapa2-design.md.
// Deploy: npx supabase functions deploy cardapio --project-ref ezfoymdesmarpunmixbs --use-api --no-verify-jwt --yes
// Segredo: CARDAPIO_SEGREDO (assina a sessão do celular e o hash do código).
//
// O estabelecimento é achado pelo código público settings.cardapio.codigo (ligado = true); o identificador
// interno nunca aparece. Lê e grava com a chave de serviço e devolve só o que é público.
//   GET  ?c=<codigo>&m=<id do local>            -> cardápio { ok:true, nome, mesa, logo, cozinha, categorias, produtos }
//   GET  ?c=<codigo>&foto=<id|logo>             -> a imagem (binária, cache de 1 dia) ou 404
//   GET  ?c=<codigo>&pedido=<id>&t=<sessao>     -> { ok, status, motivo, comanda }
//   POST { c, acao:"codigo", cota }             -> manda o código de 4 números ao WhatsApp do titular
//   POST { c, acao:"confirmar", cota, codigo }  -> { ok, sessao, nome, dependentes:[{id,nome}] }
//   POST { c, acao:"pedir", sessao, m, balcao, quem, itens:[{produtoId,tamanhoId,qtd}], obs } -> { ok, pedido }
// O pedido vai para cardapio_pedidos (status 'novo'); o computador "Caixa do app" processa (operacao/cardapio-pedidos.js).
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { comCors } from "../_shared/cors.ts";
import { imagemDeDataUrl, montarCardapio } from "./montar.ts";
import { assinarSessao, ate4h, bloqueadoPorFiado, conferirItens, hashCodigo, jidDoTelefone, lerSessao, novoCodigo } from "./pedido.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SEGREDO = Deno.env.get("CARDAPIO_SEGREDO") || "";
const EVOLUTION_URL = (Deno.env.get("EVOLUTION_URL") || "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const CODIGO = /^[a-z0-9]{6,32}$/;
type Obj = Record<string, unknown>;

function json(body: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}
const indisponivel = () => json({ ok: false, motivo: "indisponivel" });
const erro = (texto: string, status = 200) => json({ ok: false, erro: texto }, status);

async function tenantDoCodigo(codigo: string): Promise<{ tenant: string; settings: Obj } | null> {
  const { data, error } = await admin.from("app_data").select("tenant_id, value")
    .eq("key", "cantina2:settings").eq("value->cardapio->>codigo", codigo).limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) return null; // código repetido em dois estabelecimentos: não arrisca
  const settings = (data[0].value || {}) as Obj;
  const c = (settings.cardapio || {}) as Obj;
  if (c.ligado !== true || c.codigo !== codigo) return null;
  return { tenant: String(data[0].tenant_id), settings };
}

async function ler(tenant: string, chaves: string[]): Promise<Obj> {
  const { data, error } = await admin.from("app_data").select("key, value").eq("tenant_id", tenant).in("key", chaves.map((k) => "cantina2:" + k));
  if (error) throw error;
  const out: Obj = {};
  for (const r of data || []) out[String(r.key).replace(/^cantina2:/, "")] = r.value;
  return out;
}
async function cardapioDe(t: { tenant: string; settings: Obj }, mesa: string) {
  const d = await ler(t.tenant, ["products", "categorias", "complementos", "locais"]);
  return { cardapio: montarCardapio(t.settings, d.products, d.categorias, d.complementos, d.locais, mesa, new Date()), locais: d.locais };
}

async function socioDaCota(tenant: string, cota: unknown): Promise<Obj | null> {
  const c = String(cota || "").trim();
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(c)) return null;
  const { data, error } = await admin.from("members").select("id, name, phone, kind, debt, debt_release, active, archived")
    .eq("tenant_id", tenant).eq("code", c).limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) return null;
  const m = data[0] as Obj;
  return m.active === false || m.archived ? null : m;
}
async function motivoDoSocio(tenant: string, m: Obj): Promise<string> {
  if (m.kind === "colaborador") return "Colaborador faz o pedido com o garçom.";
  const { data } = await admin.from("member_debt_entries").select("type, at, reversed").eq("member_id", m.id).eq("type", "debt");
  if (bloqueadoPorFiado(m, (data || []) as Obj[])) return "Esta cota tem conta em aberto. Fale com o caixa para liberar.";
  return "";
}
async function destinoWhatsapp(tenant: string, m: Obj): Promise<string | null> {
  const { data } = await admin.from("whatsapp_conversas").select("jid, ultima_em").eq("tenant_id", tenant).eq("member_id", m.id).order("ultima_em", { ascending: false }).limit(1);
  if (data && data[0] && typeof data[0].jid === "string") return data[0].jid as string;
  return jidDoTelefone(m.phone);
}
async function mandarWhatsapp(tenant: string, jid: string, texto: string): Promise<boolean> {
  if (!EVOLUTION_URL || !EVOLUTION_API_KEY) return false;
  try {
    const r = await fetch(EVOLUTION_URL + "/message/sendText/" + encodeURIComponent(tenant), {
      method: "POST", headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: jid, text: texto }), signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch { return false; }
}
const final4 = (jid: string) => jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0].slice(-4) : "";

async function acaoCodigo(t: { tenant: string; settings: Obj }, body: Obj) {
  const m = await socioDaCota(t.tenant, body.cota);
  if (!m) return erro("Não achamos essa cota. Confira o número ou chame o garçom.");
  const motivo = await motivoDoSocio(t.tenant, m);
  if (motivo) return erro(motivo);
  const desde = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: recentes } = await admin.from("cardapio_codigos").select("id").eq("member_id", m.id).gte("criado_em", desde).limit(3);
  if ((recentes || []).length >= 3) return erro("Muitos códigos pedidos para esta cota. Espere alguns minutos ou chame o garçom.");
  const jid = await destinoWhatsapp(t.tenant, m);
  if (!jid) return erro("A cota não tem WhatsApp cadastrado. Chame o garçom.");
  const codigo = novoCodigo();
  const clube = String(t.settings.clubName || "o clube");
  if (!await mandarWhatsapp(t.tenant, jid, `${codigo} é o seu código para pedir pelo cardápio de ${clube}. Se não foi você, ignore esta mensagem.`)) {
    return erro("Não conseguimos mandar o código agora. Chame o garçom.");
  }
  await admin.from("cardapio_codigos").insert({ tenant_id: t.tenant, member_id: m.id, codigo_hash: await hashCodigo(SEGREDO, String(m.id), codigo), expira_em: new Date(Date.now() + 10 * 60_000).toISOString() });
  return json({ ok: true, para: final4(jid) });
}

async function acaoConfirmar(t: { tenant: string; settings: Obj }, body: Obj) {
  const m = await socioDaCota(t.tenant, body.cota);
  const codigo = String(body.codigo || "").trim();
  if (!m || !/^\d{4}$/.test(codigo)) return erro("Código incorreto.");
  const { data } = await admin.from("cardapio_codigos").select("id, codigo_hash, expira_em, tentativas, usado_em")
    .eq("member_id", m.id).is("usado_em", null).order("criado_em", { ascending: false }).limit(1);
  const c = data && data[0];
  if (!c || Date.parse(String(c.expira_em)) < Date.now() || Number(c.tentativas) >= 5) return erro("Código vencido. Peça outro.");
  if (c.codigo_hash !== await hashCodigo(SEGREDO, String(m.id), codigo)) {
    await admin.from("cardapio_codigos").update({ tentativas: Number(c.tentativas) + 1 }).eq("id", c.id);
    return erro("Código incorreto.");
  }
  await admin.from("cardapio_codigos").update({ usado_em: new Date().toISOString() }).eq("id", c.id);
  const { data: deps } = await admin.from("member_dependents").select("id, name, can_order").eq("member_id", m.id);
  const sessao = await assinarSessao(SEGREDO, { t: t.tenant, m: String(m.id), exp: ate4h(new Date()) });
  return json({ ok: true, sessao, nome: String(m.name || "").trim().split(/\s+/)[0] || "",
    dependentes: (deps || []).filter((d) => d.can_order !== false).map((d) => ({ id: d.id, nome: d.name })) });
}

async function acaoPedir(t: { tenant: string; settings: Obj }, body: Obj) {
  const s = await lerSessao(SEGREDO, body.sessao, new Date());
  if (!s || s.t !== t.tenant) return json({ ok: false, erro: "Confirme a cota de novo.", sessao: "vencida" });
  const { data: mm } = await admin.from("members").select("id, name, phone, kind, debt, debt_release, active, archived").eq("id", s.m).eq("tenant_id", t.tenant).limit(1);
  const m = mm && mm[0] as Obj | undefined;
  if (!m || m.active === false || m.archived) return json({ ok: false, erro: "Confirme a cota de novo.", sessao: "vencida" });
  const motivo = await motivoDoSocio(t.tenant, m);
  if (motivo) return erro(motivo);
  const desde = new Date(Date.now() - 30_000).toISOString();
  const { data: ultimos } = await admin.from("cardapio_pedidos").select("id").eq("member_id", m.id).gte("criado_em", desde).limit(1);
  if ((ultimos || []).length > 0) return erro("Aguarde alguns segundos antes de mandar outro pedido.");
  const mesaId = String(body.m || "").slice(0, 80);
  const { cardapio } = await cardapioDe(t, mesaId);
  const conf = conferirItens(cardapio, body.itens);
  if ("erro" in conf) return erro(conf.erro);
  let quem = String(m.name || "Sócio"), dependente: string | null = null;
  if (body.quem) {
    const { data: dd } = await admin.from("member_dependents").select("id, name, can_order").eq("member_id", m.id).eq("id", String(body.quem)).limit(1);
    const d = dd && dd[0];
    if (!d || d.can_order === false) return erro("Este dependente não pode pedir na cota.");
    quem = String(d.name); dependente = String(d.id);
  }
  const local = body.balcao === true || !cardapio.mesa ? "Retirar no balcão" : cardapio.mesa;
  const obs = String(body.obs || "").trim().slice(0, 140);
  const { data, error } = await admin.from("cardapio_pedidos").insert({
    tenant_id: t.tenant, member_id: m.id, dependente_id: dependente, quem_nome: quem.slice(0, 120), local,
    itens: conf.itens, total: conf.total, obs: obs || null,
    requer: 2, // 26/11: processador que lança opções (cardapio-pedidos.js, CARDAPIO_PROCESSADOR_VERSAO)
  }).select("id").single();
  if (error) throw error;
  // Dependente pedindo: o titular fica sabendo pelo WhatsApp (sem travar o pedido se não der para mandar).
  if (dependente) {
    const jid = await destinoWhatsapp(t.tenant, m);
    if (jid) await mandarWhatsapp(t.tenant, jid, `${quem} pediu R$ ${conf.total.toFixed(2).replace(".", ",")} na sua cota pelo cardápio (${local}).`);
  }
  return json({ ok: true, pedido: data.id, total: conf.total, local });
}

async function situacaoDoPedido(t: { tenant: string }, pedido: string, token: string | null) {
  const s = await lerSessao(SEGREDO, token, new Date());
  if (!s || s.t !== t.tenant || !/^[0-9a-f-]{36}$/.test(pedido)) return json({ ok: false, erro: "Pedido não encontrado." });
  const { data } = await admin.from("cardapio_pedidos").select("status, motivo, order_number, criado_em, member_id").eq("id", pedido).eq("tenant_id", t.tenant).limit(1);
  const p = data && data[0];
  if (!p || p.member_id !== s.m) return json({ ok: false, erro: "Pedido não encontrado." });
  const idade = (Date.now() - Date.parse(String(p.criado_em))) / 1000;
  // 'novo' com mais de 5 minutos não é mais pego pelo caixa (cardapio_pedido_pegar, 26/11): avisa o cliente.
  const status = p.status === "novo" && idade > 300 ? "expirado" : p.status;
  return json({ ok: true, status, motivo: p.motivo || "", comanda: p.order_number || null, segundos: Math.round(idade) });
}

Deno.serve(comCors(async (req: Request) => {
  const url = new URL(req.url);
  try {
    if (req.method === "POST") {
      if (!SEGREDO) return erro("Pedido pelo celular ainda não está ligado. Chame o garçom.");
      let body: Obj = {};
      try { body = await req.json(); } catch { return erro("Pedido inválido.", 400); }
      const codigo = String(body.c || "").trim().toLowerCase();
      if (!CODIGO.test(codigo)) return indisponivel();
      const t = await tenantDoCodigo(codigo);
      if (!t) return indisponivel();
      if (body.acao === "codigo") return await acaoCodigo(t, body);
      if (body.acao === "confirmar") return await acaoConfirmar(t, body);
      if (body.acao === "pedir") return await acaoPedir(t, body);
      return erro("Ação desconhecida.", 400);
    }
    if (req.method !== "GET") return json({ ok: false, erro: "Método não aceito." }, 405);
    const codigo = (url.searchParams.get("c") || "").trim().toLowerCase();
    if (!CODIGO.test(codigo)) return indisponivel();
    const t = await tenantDoCodigo(codigo);
    const foto = url.searchParams.get("foto");
    if (foto !== null) {
      if (!t) return new Response("", { status: 404 });
      let img = null;
      if (foto === "logo") img = imagemDeDataUrl(t.settings.brandLogo);
      else if (/^[A-Za-z0-9_-]{1,80}$/.test(foto)) {
        const { products } = await ler(t.tenant, ["products"]);
        const p = (Array.isArray(products) ? products : []).find((x) => x && x.id === foto && x.active !== false && (x.channels || {}).qr !== false);
        img = p ? imagemDeDataUrl(p.image) : null;
      }
      if (!img) return new Response("", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
      return new Response(img.bytes, { status: 200, headers: {
        "Content-Type": img.mime, "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'",
      } });
    }
    if (!t) return indisponivel();
    const pedido = url.searchParams.get("pedido");
    if (pedido !== null) return await situacaoDoPedido(t, pedido, url.searchParams.get("t"));
    const { cardapio } = await cardapioDe(t, (url.searchParams.get("m") || "").slice(0, 80));
    return json({ ok: true, pedir: !!SEGREDO, ...cardapio }, 200, "public, max-age=60");
  } catch (e) {
    console.error("[cardapio]", e);
    return json({ ok: false, motivo: "erro" }, 503);
  }
}, "GET, POST, OPTIONS"));
