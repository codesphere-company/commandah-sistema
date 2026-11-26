// Cardápio digital, etapa 2 (26/11/2026): regras do pedido do sócio na cota. Puro, para testar com dados fixos.
import type { CardapioPublico } from "./montar.ts";

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
export type ItemPedido = { produtoId: string; tamanhoId: string | null; nome: string; preco: number; qtd: number };

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
    let preco = p.preco, nome = p.nome, tamanhoId: string | null = null;
    if (p.tamanhos.length) {
      const t = p.tamanhos.find((x) => x.id === it.tamanhoId);
      if (!t) return { erro: "Escolha o tamanho de " + p.nome + "." };
      preco = t.preco; nome = p.nome + " " + t.nome; tamanhoId = t.id;
    }
    if (preco == null) return { erro: p.nome + ": peça ao garçom." };
    out.push({ produtoId: p.id, tamanhoId, nome, preco, qtd });
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
