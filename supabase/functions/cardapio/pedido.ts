// Cardápio digital, etapa 2 (26/11/2026): regras do pedido do sócio na cota. Puro, para testar com dados fixos.
import type { CardapioPublico, Grupo } from "./montar.ts";

type Obj = Record<string, unknown>;
const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hmac(segredo: string, dado: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(dado))));
}
export async function hashCodigo(segredo: string, memberId: string, codigo: string): Promise<string> {
  return hmac(segredo, "codigo|" + memberId + "|" + codigo);
}
export function novoCodigo(): string {
  const b = new Uint32Array(1); crypto.getRandomValues(b);
  return String(b[0] % 10000).padStart(4, "0");
}

// Próximas 4h da manhã em São Paulo (UTC-3, sem horário de verão desde 2019): o celular fica lembrado até lá.
export function ate4h(agora: Date): number {
  const sp = new Date(agora.getTime() - 3 * 3600_000);
  const alvo = Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate(), 4) + 3 * 3600_000;
  return alvo > agora.getTime() ? alvo : alvo + 86400_000;
}

export type Sessao = { t: string; m: string; exp: number };
export async function assinarSessao(segredo: string, s: Sessao): Promise<string> {
  const corpo = b64url(enc.encode(JSON.stringify(s)));
  return corpo + "." + await hmac(segredo, corpo);
}
export async function lerSessao(segredo: string, token: unknown, agora: Date): Promise<Sessao | null> {
  if (typeof token !== "string" || token.length > 600) return null;
  const [corpo, assin] = token.split(".");
  if (!corpo || !assin || await hmac(segredo, corpo) !== assin) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(deB64url(corpo))) as Sessao;
    if (typeof s.t !== "string" || typeof s.m !== "string" || typeof s.exp !== "number" || s.exp <= agora.getTime()) return null;
    return s;
  } catch { return null; }
}

// Mesma regra de memberBlockedByDebt (core/config.js), com a correção de 26/11 (#369): colaborador não bloqueia;
// dívida acima do liberado bloqueia; liberação vale só até o próximo fiado.
export function bloqueadoPorFiado(member: Obj, lancamentos: Obj[]): boolean {
  if (member.kind === "colaborador") return false;
  const divida = Number(member.debt) || 0;
  if (divida <= 0.01) return false;
  const rel = member.debt_release as Obj | null;
  if (!rel || divida > (Number(rel.amount) || 0) + 0.01) return true;
  const em = Date.parse(String(rel.at || "")) || 0;
  return lancamentos.some((e) => e.type === "debt" && !e.reversed && (Date.parse(String(e.at || "")) || 0) > em);
}

export const LIMITE_ITENS = 20, LIMITE_TOTAL = 500;
export type Escolhas = Record<string, Record<string, number>>; // {grupoId: {opcaoId: quantidade}} (formato do buildCustomization)
export type ItemPedido = { produtoId: string; tamanhoId: string | null; opcoes: Escolhas; nome: string; resumo: string; preco: number; qtd: number };

// Cobra só o que passa dos inclusos; os inclusos cobrem as unidades mais caras (chargedForGroup, core/opcoes.js).
function cobradoNoGrupo(precos: number[], incluidos: number): number {
  const u = precos.slice().sort((a, b) => b - a);
  let t = 0; for (let i = Math.max(0, incluidos); i < u.length; i++) t += u[i];
  return Math.round(t * 100) / 100;
}
// Confere as escolhas contra os grupos do produto (ou do tamanho): só grupos e opções existentes, quantidade
// inteira, mínimo e máximo (0 = sem limite). Devolve o acréscimo e o resumo ("AGUA: 1x COM GAS").
export function conferirEscolhas(grupos: Grupo[], escolhas: unknown, nome: string): { opcoes: Escolhas; extra: number; resumo: string } | { erro: string } {
  const ent = (escolhas && typeof escolhas === "object" ? escolhas : {}) as Record<string, unknown>;
  for (const gid of Object.keys(ent)) if (!grupos.some((g) => g.id === gid)) return { erro: nome + ": opção indisponível. Atualize a página." };
  const opcoes: Escolhas = {}; let extra = 0; const linhas: string[] = [];
  for (const g of grupos) {
    const picks = (ent[g.id] && typeof ent[g.id] === "object" ? ent[g.id] : {}) as Record<string, unknown>;
    const precos: number[] = [], partes: string[] = []; let total = 0;
    for (const oid of Object.keys(picks)) {
      const q = Number(picks[oid]);
      if (!q) continue;
      const o = g.opcoes.find((x) => x.id === oid);
      if (!o || !Number.isInteger(q) || q < 0 || q > 20) return { erro: nome + ": opção indisponível. Atualize a página." };
      (opcoes[g.id] = opcoes[g.id] || {})[oid] = q;
      total += q; for (let i = 0; i < q; i++) precos.push(o.preco); partes.push(q + "x " + o.nome);
    }
    if (g.max > 0 && total > g.max) return { erro: "Escolha no máximo " + g.max + " em " + g.nome + "." };
    if (g.min > 0 && total < g.min) return { erro: "Escolha " + (g.min === 1 ? "uma opção" : "ao menos " + g.min) + " em " + g.nome + " (" + nome + ")." };
    extra += cobradoNoGrupo(precos, g.incluidos);
    if (partes.length) linhas.push(g.nome + ": " + partes.join(", "));
  }
  return { opcoes, extra: Math.round(extra * 100) / 100, resumo: linhas.join(" · ") };
}

// Confere o carrinho do celular contra o cardápio montado agora: só produto pedível, tamanho existente,
// quantidade inteira de 1 a 20, cozinha aberta para itens da cozinha. Preço sempre do cadastro.
export function conferirItens(cardapio: CardapioPublico, itens: unknown): { itens: ItemPedido[]; total: number } | { erro: string } {
  if (!Array.isArray(itens) || !itens.length) return { erro: "O carrinho está vazio." };
  if (itens.length > LIMITE_ITENS) return { erro: "Pedido grande demais. Chame o garçom." };
  const out: ItemPedido[] = [];
  for (const raw of itens) {
    const it = (raw || {}) as Obj;
    const p = cardapio.produtos.find((x) => x.id === it.produtoId);
    if (!p) return { erro: "Um produto do carrinho saiu do cardápio. Atualize a página." };
    if (!p.pedivel) return { erro: p.nome + ": peça ao garçom." };
    if (p.cozinha && !cardapio.cozinha.aberta) return { erro: "A cozinha está fechada agora. " + p.nome + " não pode ser pedido." };
    const qtd = Number(it.qtd);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) return { erro: "Quantidade inválida em " + p.nome + "." };
    let preco = p.preco, nome = p.nome, tamanhoId: string | null = null, grupos = p.grupos || [];
    if (p.tamanhos.length) {
      const t = p.tamanhos.find((x) => x.id === it.tamanhoId);
      if (!t) return { erro: "Escolha o tamanho de " + p.nome + "." };
      preco = t.preco; nome = p.nome + " " + t.nome; tamanhoId = t.id; grupos = t.grupos || [];
    }
    if (preco == null) return { erro: p.nome + ": peça ao garçom." };
    const esc = conferirEscolhas(grupos, it.opcoes, p.nome);
    if ("erro" in esc) return { erro: esc.erro };
    out.push({ produtoId: p.id, tamanhoId, opcoes: esc.opcoes, nome, resumo: esc.resumo, preco: Math.round((preco + esc.extra) * 100) / 100, qtd });
  }
  const total = Math.round(out.reduce((a, i) => a + i.preco * i.qtd, 0) * 100) / 100;
  if (total > LIMITE_TOTAL) return { erro: "Pedido acima de R$ 500,00. Chame o garçom." };
  return { itens: out, total };
}

// Telefone do cadastro -> jid do WhatsApp (55 + DDD + número), igual a waJidDoTelefone do app.
export function jidDoTelefone(tel: unknown): string | null {
  let d = String(tel || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d + "@s.whatsapp.net" : null;
}
