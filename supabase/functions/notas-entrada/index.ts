// Edge Function: notas-entrada (t-notas, tarefa 3, 27/11/2026; desenho em
// docs/superpowers/specs/2026-11-27-notas-de-compra-design.md, plano em docs/superpowers/plans).
// Notas de compra (NF-e de entrada): busca na Brasil NFe as notas emitidas contra o CNPJ do estabelecimento,
// importa XML à mão e monta o arquivo do mês para o contador. Quem grava em notas_entrada é só esta função
// (service role); o site lê pelo RLS e mexe nas etapas pelas RPCs da migration 20261128000000_notas_entrada.
//
// POST { action: "buscar" }               -> cabeçalho x-segredo = secret NOTAS_ENTRADA_SEGREDO (pg_cron a cada
//                                            2 h, migration 20261128010000_notas_entrada_cron). Percorre os
//                                            estabelecimentos com liberada (equipe) e busca_ligada (administrador).
//                                            { tenants, novas, completas, canceladas }
// POST { action: "buscar_agora" }         -> dono/administrador: o mesmo só para o próprio estabelecimento (exige liberada)
// POST { action: "importar_xml", xml }    -> quem tem "contas" ou "insumos": grava a nota do XML (origem xml_manual)
// POST { action: "arquivo_mes", mes }     -> quem tem "contas": { nome, base64 } do ZIP (XML + resumo.csv)
//
// Sem JWT no cron: publicar com --no-verify-jwt (como a whatsapp); as ações do app conferem o JWT aqui dentro.
// O token da Brasil NFe é o do emissor do estabelecimento (nfce_emissores + Vault, mesmo nfce_emissor_ler da
// nfce) e nunca sai do servidor. As consultas usam sempre TipoAmbiente 1 (homologação não devolve entrada).
// Erros de negócio voltam com 200 e { erro: "codigo" } (outro_cnpj, sem_cnpj, xml_invalido, nao_liberada, ...),
// para a tela mostrar a frase certa; permissão é 401/403.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { comCors } from "../_shared/cors.ts";
import { lerNotaXml, type NotaLida } from "./ler-xml.ts";
import { montarZip, paraBase64, type NotaArquivo } from "./arquivo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SEGREDO = Deno.env.get("NOTAS_ENTRADA_SEGREDO") || "";
const TOKEN_DO_SERVIDOR = Deno.env.get("BRASILNFE_TOKEN") || "";
// BRASILNFE_API só existe na bancada (Brasil NFe falsa); em produção fica o endereço oficial.
const API = (Deno.env.get("BRASILNFE_API") || "https://api.brasilnfe.com.br/services/fiscal").replace(/\/+$/, "");
const PRAZO_MS = 30000;
const DIA_MS = 86400000;
const XML_MAX = 2_000_000;
const AVISO_CANCELADA = "Cancelada pelo fornecedor depois da entrada. Confira e desfaça se for o caso.";
const AVISO_SEM_DEST = "Nota sem CNPJ do destinatário (cupom de supermercado). Confira se é da lanchonete.";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

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

type Quem = { tenantId: string; papel: string; nome: string; jwt: string };
// Quem chama: dono ou colaborador ativo (qualquer perfil; a permissão de cada ação vem de tem_permissao).
async function caller(req: Request): Promise<Quem | null> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const uid = data.user.id;
  const { data: owner } = await admin.from("tenant_owners").select("tenant_id").eq("user_id", uid).maybeSingle();
  if (owner) return (await donoSessaoOk(jwt, uid)) ? { tenantId: owner.tenant_id as string, papel: "owner", nome: "dono", jwt } : null;
  const { data: staff } = await admin.from("tenant_staff").select("id, tenant_id, role, active").eq("auth_user_id", uid).maybeSingle();
  if (staff && staff.active) return { tenantId: staff.tenant_id as string, papel: String(staff.role), nome: String(staff.id), jwt };
  return null;
}
const ehAdmin = (q: Quem) => q.papel === "owner" || q.papel === "admin";

// t-notas: a permissão é a mesma do banco (tem_permissao, lista do colaborador ou do perfil), chamada com o
// JWT de quem pediu; assim a tela, o RLS e esta função nunca discordam. Erro na consulta fecha (false).
async function pode(q: Quem, token: string): Promise<boolean> {
  if (ehAdmin(q)) return true;
  const cli = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${q.jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await cli.rpc("tem_permissao", { p_token: token });
  if (error) { console.error("[notas-entrada] tem_permissao:", error); return false; }
  return data === true;
}

// Comparação em tempo constante (como a whatsapp).
function iguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let dif = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) dif |= (ea[i] || 0) ^ (eb[i] || 0);
  return dif === 0;
}

async function settingsDo(tenantId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("app_data").select("value").eq("tenant_id", tenantId).eq("key", "cantina2:settings").maybeSingle();
  if (error) throw error;
  const v = data ? data.value : null;
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
const soDigitos = (x: unknown) => (typeof x === "string" || typeof x === "number" ? String(x).replace(/\D/g, "") : "");
// CNPJ do estabelecimento (decisão do controlador, 27/11): fica em notas_entrada_config.cnpj, gravado pela
// tela por notas_entrada_config_salvar. A nfce não guarda CNPJ (a Brasil NFe sabe pelo token) e o
// settings.cnpj do clube está vazio (o site não edita); ele só vale como reserva, se tiver 14 dígitos.
function cnpjDo(cfgCnpj: unknown, settings: Record<string, unknown>): string | null {
  const c = soDigitos(cfgCnpj) || soDigitos(settings.cnpj);
  return c.length === 14 ? c : null;
}

// Emissor do estabelecimento: mesma função e mesma regra da nfce (token próprio no Vault; o do servidor só
// para quem está marcado com usa_token_do_servidor).
type LinhaEmissor = { token: string | null; usa_token_do_servidor: boolean };
async function tokenDo(tenantId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("nfce_emissor_ler", { p_tenant: tenantId });
  if (error) throw error;
  const linha = ((Array.isArray(data) ? data[0] : data) as LinhaEmissor | undefined) || null;
  if (!linha) return null;
  if (linha.token) return linha.token;
  if (linha.usa_token_do_servidor && TOKEN_DO_SERVIDOR) return TOKEN_DO_SERVIDOR;
  return null;
}

async function brasilNfe(token: string, path: string, body: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Token: token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PRAZO_MS),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* resposta não-JSON */ }
  return { ok: res.ok, status: res.status, body: parsed, text: text.slice(0, 300) };
}

// t-notas: a documentação da Brasil NFe não diz qual número de Status é "cancelada". Tudo passa por aqui:
// aceita 2 ou um texto com "cancel". CONFERIR com respostas reais de produção antes de ligar a busca.
type Resumo = Record<string, unknown>;
export function notaCancelada(n: Resumo): boolean {
  const s = n.Status;
  return Number(s) === 2 || (typeof s === "string" && /cancel/i.test(s));
}

// Data sem fuso (a API .NET costuma mandar "2026-11-20T10:30:00") é hora de Brasília.
function isoDe(x: unknown): string | null {
  if (typeof x !== "string" || !x.trim()) return null;
  let s = x.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "-03:00";
  const t = Date.parse(s);
  return isFinite(t) ? new Date(t).toISOString() : null;
}
// Dia em Brasília (−03:00 fixo desde 2019): 'AAAA-MM-DD'.
const diaBr = (iso: string) => new Date(Date.parse(iso) - 3 * 3600 * 1000).toISOString().slice(0, 10);

function b64ParaTexto(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
}

// Campos da linha que vêm do XML lido (completa a nota; o resumo da busca é só provisório).
function camposDoXml(lida: NotaLida, xml: string) {
  return {
    situacao: "completa", xml, dados: lida, modelo: lida.modelo, numero: lida.numero || null, serie: lida.serie || null,
    emitente_cnpj: lida.emitente.cnpj || null, emitente_nome: (lida.emitente.nome || lida.emitente.fantasia || "").slice(0, 200) || null,
    emissao: isoDe(lida.emissao), valor: lida.valor,
  };
}

// Pede o XML, lê e marca completa. Erro sobe (quem chama conta e segue com a próxima nota).
async function completar(token: string, tenantId: string, cnpj: string, chave: string): Promise<boolean> {
  const r = await brasilNfe(token, "ObterArquivoNotaFiscal", { ChaveNF: chave, FileType: 1, TipoDocumentoFiscal: 0 });
  if (!r.ok || typeof r.body !== "string" || !r.body) throw new Error(`arquivo da nota ${chave}: HTTP ${r.status} ${r.text}`);
  const xml = b64ParaTexto(r.body);
  const lida = lerNotaXml(xml);
  if (lida.chave !== chave) throw new Error(`arquivo da nota ${chave} veio com outra chave (${lida.chave})`);
  // O resumo veio sem CnpjDestinatario e o XML mostra outro destinatário: não é nossa, sai da lista.
  if (lida.destinatarioCnpj && lida.destinatarioCnpj !== cnpj) {
    console.error(`[notas-entrada] ${tenantId} nota ${chave}: XML de outro destinatário (${lida.destinatarioCnpj}), apagada`);
    const { error } = await admin.from("notas_entrada").delete().eq("tenant_id", tenantId).eq("chave", chave).eq("situacao", "resumo");
    if (error) throw error;
    return false;
  }
  const { error } = await admin.from("notas_entrada").update(camposDoXml(lida, xml))
    .eq("tenant_id", tenantId).eq("chave", chave).eq("situacao", "resumo");
  if (error) throw error;
  return true;
}

type Contagem = { novas: number; completas: number; canceladas: number };
type Config = { tenant_id: string; liberada: boolean; busca_ligada: boolean; inicio: string | null; ultima_busca_ok: string | null; cnpj: string | null };

// Busca de um estabelecimento. Erro geral (sem CNPJ, sem emissor, Brasil NFe fora) sobe para gravar ultimo_erro;
// erro de uma nota só vai para o log e a nota fica em resumo para a próxima busca.
async function buscarTenant(cfg: Config, c: Contagem): Promise<void> {
  const tenantId = cfg.tenant_id;
  const cnpj = cnpjDo(cfg.cnpj, await settingsDo(tenantId));
  if (!cnpj) throw new Error("CNPJ do estabelecimento não configurado");
  const token = await tokenDo(tenantId);
  if (!token) throw new Error("Estabelecimento sem emissor da Brasil NFe");

  const agora = Date.now();
  // Janela: desde a última busca boa menos 1 dia de folga; na primeira, 30 dias.
  const desde = cfg.ultima_busca_ok ? Date.parse(cfg.ultima_busca_ok) - DIA_MS : agora - 30 * DIA_MS;
  const r = await brasilNfe(token, "ObterNotasFiscais", {
    TipoDocumentoFiscal: 0, DtInicio: new Date(desde).toISOString(), DtFim: new Date(agora).toISOString(), TipoAmbiente: 1, TipoParticipacao: 0,
  });
  const corpo = (r.body && typeof r.body === "object" ? r.body : {}) as Record<string, unknown>;
  if (!r.ok || corpo.Error) throw new Error(`Brasil NFe: ${String(corpo.Error || `HTTP ${r.status} ${r.text}`).slice(0, 250)}`);
  const lista = (Array.isArray(corpo.Notas) ? corpo.Notas : []) as Resumo[];

  // Só as do CNPJ do estabelecimento (o token é por empresa, mas a busca não confia nisso).
  const nossas = lista.filter((n) => {
    const dest = soDigitos(n.CnpjDestinatario);
    return /^\d{44}$/.test(soDigitos(n.Chave)) && (!dest || dest === cnpj);
  });
  const chaves = [...new Set(nossas.map((n) => soDigitos(n.Chave)))];
  type Existente = { chave: string; situacao: string; estoque_em: string | null; pagamento_em: string | null };
  const existentes = new Map<string, Existente>();
  for (let i = 0; i < chaves.length; i += 100) {
    const { data, error } = await admin.from("notas_entrada").select("chave, situacao, estoque_em, pagamento_em")
      .eq("tenant_id", tenantId).in("chave", chaves.slice(i, i + 100));
    if (error) throw error;
    for (const e of (data || []) as Existente[]) existentes.set(e.chave, e);
  }

  const tentadas = new Set<string>();
  for (const n of nossas) {
    const chave = soDigitos(n.Chave);
    if (tentadas.has(chave)) continue;
    tentadas.add(chave);
    try {
      const cancelada = notaCancelada(n);
      let ex = existentes.get(chave);
      let inseriu = false;
      if (!ex) {
        const emissao = isoDe(n.DtEmissao);
        const linha = {
          tenant_id: tenantId, chave, origem: "brasilnfe", modelo: Number(n.ModeloDocumento) || null,
          numero: n.Numero != null ? String(n.Numero) : null, serie: n.Serie != null ? String(n.Serie) : null,
          emitente_cnpj: soDigitos(n.CnpjEmissor) || null, emitente_nome: typeof n.NomeEmissor === "string" ? n.NomeEmissor.slice(0, 200) : null,
          emissao, valor: isFinite(Number(n.Valor)) ? Number(n.Valor) : null,
          situacao: cancelada ? "cancelada" : "resumo",
          // Nota de antes da data de início escolhida pelo administrador: fica guardada, mas fora das pendências.
          fora: !!(cfg.inicio && emissao && diaBr(emissao) < String(cfg.inicio).slice(0, 10)),
        };
        // ignoreDuplicates: o "Buscar agora" e o cron ao mesmo tempo não duplicam nem dão erro.
        const { data, error } = await admin.from("notas_entrada").upsert(linha, { onConflict: "tenant_id,chave", ignoreDuplicates: true }).select("chave");
        if (error) throw error;
        if (data && data.length) { inseriu = true; c.novas++; if (cancelada) c.canceladas++; }
        ex = { chave, situacao: linha.situacao, estoque_em: null, pagamento_em: null };
      } else if (cancelada && ex.situacao !== "cancelada") {
        // Nunca desfaz sozinha: só avisa quando a nota já teve entrada no estoque ou conta lançada.
        const upd: Record<string, unknown> = { situacao: "cancelada" };
        if (ex.estoque_em || ex.pagamento_em) upd.aviso = AVISO_CANCELADA;
        const { error } = await admin.from("notas_entrada").update(upd).eq("tenant_id", tenantId).eq("chave", chave);
        if (error) throw error;
        c.canceladas++;
        ex = { ...ex, situacao: "cancelada" };
      }
      if (!cancelada && ex.situacao === "resumo") {
        // Apagada por ser de outro destinatário: não conta como nova (volta a cada busca enquanto estiver na janela).
        if (await completar(token, tenantId, cnpj, chave)) c.completas++;
        else if (inseriu) c.novas--;
      }
    } catch (e) {
      console.error(`[notas-entrada] ${tenantId} nota ${chave}:`, e);
    }
  }

  // Nota que ficou em resumo e já saiu da janela (o XML falhou por mais de um dia): tenta de novo aqui.
  const { data: presas, error: errPresas } = await admin.from("notas_entrada").select("chave")
    .eq("tenant_id", tenantId).eq("origem", "brasilnfe").eq("situacao", "resumo").order("criada_em", { ascending: true }).limit(30);
  if (errPresas) throw errPresas;
  for (const p of (presas || []) as { chave: string }[]) {
    if (tentadas.has(p.chave)) continue;
    try { if (await completar(token, tenantId, cnpj, p.chave)) c.completas++; } catch (e) { console.error(`[notas-entrada] ${tenantId} nota ${p.chave} (presa em resumo):`, e); }
  }

  const { error } = await admin.from("notas_entrada_config").update({ ultima_busca_ok: new Date(agora).toISOString(), ultimo_erro: null }).eq("tenant_id", tenantId);
  if (error) throw error;
}

// Roda e registra o resultado na config (ultima_busca_ok já foi gravada no fim de buscarTenant).
async function buscarRegistrando(cfg: Config, c: Contagem): Promise<string | null> {
  try {
    await buscarTenant(cfg, c);
    return null;
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    console.error(`[notas-entrada] busca de ${cfg.tenant_id}:`, e);
    const { error } = await admin.from("notas_entrada_config").update({ ultimo_erro: msg }).eq("tenant_id", cfg.tenant_id);
    if (error) console.error("[notas-entrada] falha ao gravar ultimo_erro:", error);
    return msg;
  }
}

const CAMPOS_CONFIG = "tenant_id, liberada, busca_ligada, inicio, ultima_busca_ok, cnpj";

async function importarXml(q: Quem, xmlBruto: unknown) {
  if (typeof xmlBruto !== "string" || !xmlBruto.trim()) return json({ erro: "xml_invalido" });
  if (xmlBruto.length > XML_MAX) return json({ erro: "xml_grande" });
  let lida: NotaLida;
  try { lida = lerNotaXml(xmlBruto); } catch { return json({ erro: "xml_invalido" }); }
  const xml = xmlBruto.charCodeAt(0) === 0xFEFF ? xmlBruto.slice(1) : xmlBruto;
  const settings = await settingsDo(q.tenantId);
  const dest = lida.destinatarioCnpj;
  if (dest) {
    const { data: cfgC, error: errC } = await admin.from("notas_entrada_config").select("cnpj").eq("tenant_id", q.tenantId).maybeSingle();
    if (errC) throw errC;
    const cnpj = cnpjDo(cfgC ? cfgC.cnpj : null, settings);
    if (!cnpj) return json({ erro: "sem_cnpj" });
    if (dest !== cnpj) return json({ erro: "outro_cnpj" });
  }
  // Caminho antigo ("Alterar Estoque com NFe"): a mesma nota já entrou no estoque por lá.
  const antigos = Array.isArray(settings.nfeImports) ? settings.nfeImports as { key?: unknown }[] : [];
  if (antigos.some((x) => x && String(x.key || "") === lida.chave)) return json({ ja: true, antigo: true, chave: lida.chave });

  const { data: ex, error: errEx } = await admin.from("notas_entrada").select("situacao")
    .eq("tenant_id", q.tenantId).eq("chave", lida.chave).maybeSingle();
  if (errEx) throw errEx;
  if (ex && ex.situacao !== "resumo") return json({ ja: true, chave: lida.chave });
  if (ex) {
    // A busca achou só o resumo (XML ainda não veio): o XML importado completa a mesma linha.
    const { error } = await admin.from("notas_entrada").update(camposDoXml(lida, xml))
      .eq("tenant_id", q.tenantId).eq("chave", lida.chave).eq("situacao", "resumo");
    if (error) throw error;
    return json({ ok: true, chave: lida.chave, completou: true });
  }
  const linha = {
    tenant_id: q.tenantId, chave: lida.chave, origem: "xml_manual", ...camposDoXml(lida, xml),
    aviso: dest ? null : AVISO_SEM_DEST,
  };
  const { data, error } = await admin.from("notas_entrada").upsert(linha, { onConflict: "tenant_id,chave", ignoreDuplicates: true }).select("chave");
  if (error) throw error;
  if (!data || !data.length) return json({ ja: true, chave: lida.chave }); // dois envios ao mesmo tempo
  await admin.from("audit_log").insert({
    tenant_id: q.tenantId, actor_name: q.nome, entity: "nota_entrada", entity_id: lida.chave,
    action: `Nota de compra importada (XML): nº ${lida.numero} de ${lida.emitente.nome || lida.emitente.cnpj}`, meta: { chave: lida.chave },
  }).then(({ error: e }) => { if (e) console.error("[notas-entrada] audit_log:", e); });
  return json({ ok: true, chave: lida.chave });
}

async function arquivoMes(q: Quem, mes: unknown) {
  if (typeof mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return json({ error: "Mês inválido (use AAAA-MM)." }, 400);
  const [a, m] = mes.split("-").map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  const { data, error } = await admin.from("notas_entrada")
    .select("chave, numero, serie, emitente_cnpj, emitente_nome, emissao, valor, situacao, xml, conferida_em, contabilidade_em, pagamento_em, estoque_em")
    .eq("tenant_id", q.tenantId).gte("emissao", `${mes}-01T00:00:00-03:00`).lt("emissao", `${prox}-01T00:00:00-03:00`)
    .order("emissao", { ascending: true });
  if (error) throw error;
  const zip = montarZip((data || []) as NotaArquivo[]);
  return json({ nome: `notas-de-compra-${mes}.zip`, base64: paraBase64(zip) });
}

Deno.serve(comCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body: { action?: string; xml?: unknown; mes?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido." }, 400); }

  try {
    if (body.action === "buscar") {
      // Só o agendamento (pg_cron) sabe o segredo. Secret vazio = fechado.
      const seg = req.headers.get("x-segredo") || "";
      if (!SEGREDO || !iguais(seg, SEGREDO)) return json({ error: "Não autorizado." }, 401);
      const { data, error } = await admin.from("notas_entrada_config").select(CAMPOS_CONFIG).eq("liberada", true).eq("busca_ligada", true);
      if (error) throw error;
      const c: Contagem = { novas: 0, completas: 0, canceladas: 0 };
      const cfgs = (data || []) as Config[];
      // Um por vez: a Brasil NFe/SEFAZ trava consultas simultâneas da distribuição de DF-e.
      for (const cfg of cfgs) await buscarRegistrando(cfg, c);
      return json({ tenants: cfgs.length, ...c });
    }

    const q = await caller(req);
    if (!q) return json({ error: "Entre de novo e tente outra vez." }, 401);

    if (body.action === "buscar_agora") {
      if (!ehAdmin(q)) return json({ error: "Só o administrador busca as notas agora." }, 403);
      const { data: cfg, error } = await admin.from("notas_entrada_config").select(CAMPOS_CONFIG).eq("tenant_id", q.tenantId).maybeSingle();
      if (error) throw error;
      if (!cfg || !cfg.liberada) return json({ erro: "nao_liberada" });
      const c: Contagem = { novas: 0, completas: 0, canceladas: 0 };
      const falha = await buscarRegistrando(cfg as Config, c);
      return json(falha ? { tenants: 1, ...c, erro: "falha_busca", mensagem: falha } : { tenants: 1, ...c });
    }
    if (body.action === "importar_xml") {
      if (!(await pode(q, "contas")) && !(await pode(q, "insumos"))) return json({ error: "Sem permissão para importar nota de compra." }, 403);
      return await importarXml(q, body.xml);
    }
    if (body.action === "arquivo_mes") {
      if (!(await pode(q, "contas"))) return json({ error: "Só quem cuida das contas baixa o arquivo do mês." }, 403);
      return await arquivoMes(q, body.mes);
    }
    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    console.error("[notas-entrada]", body.action, e);
    return json({ error: "Não foi possível concluir agora. Tente de novo em alguns segundos." }, 503);
  }
}, "POST, OPTIONS"));
