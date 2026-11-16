// CORS das Edge Functions (item 7 da auditoria de 11/11, decisão do dono 16/11).
// Antes era "Access-Control-Allow-Origin: *": qualquer site podia chamar as funções do navegador de quem
// estivesse logado. Agora só o site oficial (+ o secret opcional ALLOWED_ORIGINS, separado por vírgula)
// recebe a liberação.
//
// - Pedido com Origin da lista: resposta normal + Access-Control-Allow-Origin = essa origem e Vary: Origin.
// - Pedido com Origin fora da lista (inclusive "null"): 403 sem cabeçalho CORS e a função NÃO roda (vale
//   também para o POST, não só para o preflight OPTIONS: um POST "simples" de outro site não chega na função).
// - Pedido SEM Origin (agente de impressão em C#, CLI, chamada servidor-servidor): segue normal, sem
//   cabeçalho CORS. Navegador sempre manda Origin em chamada de outro endereço, então isso não abre brecha.
//
// Uso: Deno.serve(comCors(async (req) => { ... }, "POST, OPTIONS"));
// O empacotamento do deploy (supabase functions deploy <nome>) segue o import "../_shared/cors.ts".
const SITE_OFICIAL = "https://codesphere-company.github.io";
const CABECALHOS_PEDIDO = "authorization, x-client-info, apikey, content-type";

function semBarraNoFim(s: string): string {
  return s.trim().replace(/\/+$/, "");
}

export function origensPermitidas(): Set<string> {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map(semBarraNoFim).filter(Boolean);
  return new Set([SITE_OFICIAL, ...extra]);
}

export function comCors(
  handler: (req: Request) => Response | Promise<Response>,
  metodos = "POST, OPTIONS",
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const origin = req.headers.get("Origin");
    if (origin !== null && !origensPermitidas().has(origin)) {
      return new Response(null, { status: 403 });
    }
    if (req.method === "OPTIONS") {
      const h = new Headers({ "Vary": "Origin" });
      if (origin !== null) {
        h.set("Access-Control-Allow-Origin", origin);
        h.set("Access-Control-Allow-Headers", CABECALHOS_PEDIDO);
        h.set("Access-Control-Allow-Methods", metodos);
        h.set("Access-Control-Max-Age", "600");
      }
      return new Response("ok", { status: 200, headers: h });
    }
    const resp = await handler(req);
    const h = new Headers(resp.headers);
    h.append("Vary", "Origin");
    if (origin !== null) h.set("Access-Control-Allow-Origin", origin);
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
  };
}
