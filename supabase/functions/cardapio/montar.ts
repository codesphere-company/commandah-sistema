// Cardápio digital, etapa 1 (26/11/2026): monta o que a página pública mostra, a partir dos dados do
// estabelecimento. Puro (não lê banco nem relógio por conta própria), para testar com dados fixos.
// Só sai o que é público: nome, descrição, categoria, preço, tamanhos e se há foto. Nada de custo,
// estoque, fiscal, receita ou ids internos de cadastro além do id do produto (usado para pedir a foto).

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Obj[] : []);
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

export type ProdutoPublico = {
  id: string; nome: string; descricao: string; categoria: string; preco: number | null;
  foto: boolean; unidade: "un" | "kg"; tamanhos: { id: string; nome: string; preco: number; grupos: Grupo[] }[];
  // Grupos de opções do produto sem tamanho (com tamanho, ficam em cada tamanho). 26/11: o cliente escolhe no celular.
  grupos: Grupo[];
  // Dá para pedir pelo celular? (por quilo: "peça ao garçom"). cozinha = sai pela cozinha.
  pedivel: boolean; cozinha: boolean;
};
export type Grupo = { id: string; nome: string; min: number; max: number; incluidos: number; opcoes: { id: string; nome: string; preco: number }[] };
export type CardapioPublico = {
  nome: string; mesa: string; logo: boolean;
  cozinha: { aberta: boolean; texto: string };
  categorias: { nome: string; fotoId: string | null }[];
  produtos: ProdutoPublico[];
};

// Hora local de São Paulo (a função roda em UTC).
export function horaSaoPaulo(agora: Date): { dia: number; minutos: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(agora);
  const get = (t: string) => p.find((x) => x.type === t)?.value || "";
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dia, minutos: Number(get("hour")) * 60 + Number(get("minute")) };
}

const minutosDoDia = (hhmm: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Mesma regra de cozinhaAberta (operacao/cozinha.js): sem horário ligado = sempre aberta; fechamento menor
// que a abertura passa da meia-noite.
export function cozinhaAgora(settings: Obj, agora: Date): { aberta: boolean; texto: string } {
  const k = settings.kitchenHours as Obj | undefined;
  if (!k || !k.ativo) return { aberta: true, texto: "" };
  const dias = (k.dias || {}) as Record<string, Obj>;
  const turno = (d: number) => {
    const c = dias[String(d)];
    if (!c || c.fechado) return null;
    const a = minutosDoDia(c.abre), f = minutosDoDia(c.fecha);
    return a == null || f == null ? null : { a, f, fecha: String(c.fecha) };
  };
  const { dia, minutos } = horaSaoPaulo(agora);
  const hoje = turno(dia), ontem = turno((dia + 6) % 7);
  if (hoje && (hoje.f > hoje.a ? minutos >= hoje.a && minutos < hoje.f : minutos >= hoje.a)) return { aberta: true, texto: "Cozinha aberta até " + hoje.fecha };
  if (ontem && ontem.f <= ontem.a && minutos < ontem.f) return { aberta: true, texto: "Cozinha aberta até " + ontem.fecha };
  return { aberta: false, texto: "Cozinha fechada agora" };
}

// Regras de grupo (product.groups ou sizes[id].groups) -> grupos com as opções ativas, como opcoes.js (rulesFor/opcoesGroupOf).
export function gruposDe(regras: unknown, complementos: Obj[]): Grupo[] {
  const out: Grupo[] = [];
  for (const r of arr(regras)) {
    const g = complementos.find((c) => c.id === r.groupId && c.recordKind === "optionGroup" && c.active !== false);
    if (!g) continue;
    out.push({
      id: str(g.id, 80), nome: str(g.nome, 80),
      min: Math.max(0, Math.floor(Number(r.min) || 0)), max: Math.max(0, Math.floor(Number(r.max) || 0)),
      incluidos: Math.max(0, Math.floor(Number(r.included) || 0)),
      opcoes: arr(g.options).filter((o) => o.active !== false && str(o.id, 80)).map((o) => ({ id: str(o.id, 80), nome: str(o.nome, 80), preco: num(o.preco) || 0 })),
    });
  }
  return out;
}
// Grupo obrigatório sem nenhuma opção ativa: não dá para pedir.
const gruposPossiveis = (gs: Grupo[]) => gs.every((g) => g.min <= 0 || g.opcoes.length > 0);

function tamanhos(p: Obj, complementos: Obj[]): { id: string; nome: string; preco: number; grupos: Grupo[] }[] {
  const gradeId = str(p.gradeId, 80);
  if (!gradeId) return [];
  const grade = complementos.find((c) => c.id === gradeId && c.recordKind === "grade" && c.active !== false);
  if (!grade) return [];
  const precos = (p.sizes || {}) as Record<string, Obj>;
  const out: { id: string; nome: string; preco: number; grupos: Grupo[] }[] = [];
  for (const s of arr(grade.sizes)) {
    const ps = precos[String(s.id)];
    if (!ps || ps.active === false) continue;
    if (((ps.channels || {}) as Obj).qr === false) continue;
    const preco = num(ps.price);
    if (preco == null) continue;
    out.push({ id: str(s.id, 80), nome: str(s.nome, 60), preco, grupos: gruposDe(ps.groups, complementos) });
  }
  return out;
}

export function montarCardapio(settings: Obj, products: unknown, categorias: unknown, complementos: unknown, locais: unknown, mesaId: string, agora: Date): CardapioPublico {
  const comps = arr(complementos);
  const cats = arr(categorias);
  const inativas = new Set(cats.filter((c) => c.active === false).map((c) => str(c.nome, 120)));
  const produtos: ProdutoPublico[] = arr(products)
    .filter((p) => p.active !== false && ((p.channels || {}) as Obj).qr !== false && str(p.name))
    .filter((p) => !inativas.has(str(p.category, 120) || "Outros"))
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || str(a.name).localeCompare(str(b.name), "pt-BR"))
    .map((p) => {
      const tam = tamanhos(p, comps);
      return {
        id: str(p.id, 80), nome: str(p.name, 120), descricao: str(p.description, 300), categoria: str(p.category, 120) || "Outros",
        preco: tam.length ? null : num(p.price),
        foto: typeof p.image === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(p.image),
        unidade: String(p.measure || "").toLowerCase() === "kg" ? "kg" : "un",
        tamanhos: tam,
        grupos: tam.length ? [] : gruposDe(p.groups, comps),
        pedivel: String(p.measure || "").toLowerCase() !== "kg" && (tam.length ? tam.some((t) => gruposPossiveis(t.grupos)) : gruposPossiveis(gruposDe(p.groups, comps))),
        cozinha: !p.estacao || p.estacao === "cozinha",
      } as ProdutoPublico;
    })
    .filter((p) => p.id && (p.preco != null || p.tamanhos.length));
  // Ordem das categorias: a do cadastro (código), depois as que só existem nos produtos.
  const ordem = cats.slice().sort((a, b) => str(a.code).localeCompare(str(b.code), "pt-BR", { numeric: true })).map((c) => str(c.nome, 120));
  const usadas = [...new Set(produtos.map((p) => p.categoria))];
  usadas.sort((a, b) => {
    const ia = ordem.indexOf(a), ib = ordem.indexOf(b);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.localeCompare(b, "pt-BR");
  });
  const mesa = arr(locais).find((l) => String(l.id) === mesaId);
  return {
    nome: str(settings.clubName, 120) || "Cardápio",
    mesa: mesa ? str(mesa.nome, 80) : "",
    logo: typeof settings.brandLogo === "string" && /^data:image\//.test(settings.brandLogo),
    cozinha: cozinhaAgora(settings, agora),
    categorias: usadas.map((nome) => ({ nome, fotoId: produtos.find((p) => p.categoria === nome && p.foto)?.id || null })),
    produtos,
  };
}

// data:image/...;base64,... -> bytes. null se não for imagem.
export function imagemDeDataUrl(v: unknown): { mime: string; bytes: Uint8Array } | null {
  if (typeof v !== "string") return null;
  // SVG fica de fora: servido por este endereço, um SVG com script rodaria aqui.
  const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(v);
  if (!m) return null;
  const bin = atob(m[2].replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1].toLowerCase(), bytes };
}
