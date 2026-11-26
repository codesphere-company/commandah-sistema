// Edge Function "cardapio" — cardápio digital, etapa 1 (26/11/2026): página pública só para olhar.
// Desenho: docs/superpowers/specs/2026-11-26-cardapio-etapa1-design.md.
// Deploy: npx supabase functions deploy cardapio --project-ref ezfoymdesmarpunmixbs --use-api --no-verify-jwt --yes
//
// Sem login. O estabelecimento é achado pelo código público settings.cardapio.codigo (ligado = true); o
// identificador interno nunca aparece. Lê app_data com a chave de serviço e devolve só o que é público.
//   GET ?c=<codigo>&m=<id do local>  -> { ok:true, nome, mesa, logo, cozinha, categorias, produtos }
//   GET ?c=<codigo>&foto=<id|logo>   -> a imagem (binária, com cache de 1 dia) ou 404
//   desligado / código errado        -> { ok:false, motivo:"indisponivel" }
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { comCors } from "../_shared/cors.ts";
import { imagemDeDataUrl, montarCardapio } from "./montar.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CODIGO = /^[a-z0-9]{6,32}$/;

function json(body: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}
const indisponivel = () => json({ ok: false, motivo: "indisponivel" }, 200, "no-store");

async function tenantDoCodigo(codigo: string): Promise<{ tenant: string; settings: Record<string, unknown> } | null> {
  const { data, error } = await admin.from("app_data").select("tenant_id, value")
    .eq("key", "cantina2:settings").eq("value->cardapio->>codigo", codigo).limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) return null; // código repetido em dois estabelecimentos: não arrisca
  const settings = (data[0].value || {}) as Record<string, unknown>;
  const c = (settings.cardapio || {}) as Record<string, unknown>;
  if (c.ligado !== true || c.codigo !== codigo) return null;
  return { tenant: String(data[0].tenant_id), settings };
}

async function ler(tenant: string, chaves: string[]): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("app_data").select("key, value").eq("tenant_id", tenant).in("key", chaves.map((k) => "cantina2:" + k));
  if (error) throw error;
  const out: Record<string, unknown> = {};
  for (const r of data || []) out[String(r.key).replace(/^cantina2:/, "")] = r.value;
  return out;
}

Deno.serve(comCors(async (req: Request) => {
  if (req.method !== "GET") return json({ ok: false, erro: "Método não aceito." }, 405);
  const url = new URL(req.url);
  const codigo = (url.searchParams.get("c") || "").trim().toLowerCase();
  if (!CODIGO.test(codigo)) return indisponivel();
  try {
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
    const d = await ler(t.tenant, ["products", "categorias", "complementos", "locais"]);
    const mesa = (url.searchParams.get("m") || "").slice(0, 80);
    const cardapio = montarCardapio(t.settings, d.products, d.categorias, d.complementos, d.locais, mesa, new Date());
    return json({ ok: true, ...cardapio }, 200, "public, max-age=60");
  } catch (e) {
    console.error("[cardapio]", e);
    return json({ ok: false, motivo: "erro" }, 503);
  }
}, "GET, OPTIONS"));
