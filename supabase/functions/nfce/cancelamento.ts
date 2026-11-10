// 10/11/2026 (pedido do dono): o XML do evento de cancelamento é necessário para o cálculo de imposto; sem ele,
// o XML original de uma nota cancelada pode ser importado como venda válida. Pela documentação da Brasil NFe,
// a resposta de CancelarNotaFiscal só traz o XML no modelo 55. Na NFC-e (65) ele vem de BuscarEventos ou de
// ObterArquivoEvento. Nenhuma falha aqui pode desfazer o cancelamento, que já foi aceito pela SEFAZ.
type Chamada = (path: string, body: unknown) => Promise<{ body?: unknown; raw?: string }>;
type Nota = { chave: string; ambiente: number };
const CANCELAMENTO = 110111;

function decodificar(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/^"|"$/g, "");
  if (!t) return null;
  if (t.startsWith("<")) return t;
  try { return new TextDecoder().decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0))); } catch { return null; }
}

// Confere o conteúdo: a nota original nunca pode ser guardada no lugar do evento.
function eventoValido(v: unknown): string | null {
  const x = decodificar(v);
  return x && /<(procEventoNFe|evento)\b/i.test(x) && x.includes(String(CANCELAMENTO)) ? x : null;
}

function nomesDosCampos(o: unknown): string[] {
  return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o as Record<string, unknown>) : [];
}

export async function buscarXmlCancelamento(chamar: Chamada, nota: Nota, resposta: Record<string, unknown>) {
  const campos = nomesDosCampos(resposta);
  const proprio = eventoValido(resposta.Base64Xml);
  if (proprio) return { xml: proprio, origem: "cancelamento", campos };
  try {
    const r = await chamar("BuscarEventos", { TipoAmbiente: nota.ambiente, Chave: nota.chave, TipoEvento: CANCELAMENTO });
    campos.push(...nomesDosCampos(r.body));
    const eventos = (r.body as { Eventos?: { Base64Xml?: unknown }[] } | null)?.Eventos;
    for (const e of Array.isArray(eventos) ? eventos : []) {
      const x = eventoValido(e.Base64Xml);
      if (x) return { xml: x, origem: "buscar-eventos", campos };
    }
  } catch (e) { console.error("[nfce] BuscarEventos falhou:", e); }
  const protocolo = resposta.NuProtocolo;
  if (protocolo) {
    try {
      const r = await chamar("ObterArquivoEvento", { ChaveNF: nota.chave, NuProtocolo: protocolo, TipoArquivo: 1 });
      const x = eventoValido(typeof r.body === "string" ? r.body : r.raw);
      if (x) return { xml: x, origem: "obter-arquivo", campos };
    } catch (e) { console.error("[nfce] ObterArquivoEvento falhou:", e); }
  }
  return { xml: null, origem: "nao-encontrado", campos };
}
