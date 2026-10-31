// Monta o pedido de NFC-e da Brasil NFe a partir de uma venda do Commandah (t207).
// Função pura (sem rede, sem banco) para poder ser testada sozinha:
//   node --experimental-strip-types (Node 22+) ou deno test.
// Formato: https://brasilnfe.com.br/api/nf-e-e-nfc-e (exemplos "nfce-simples" e "nfce-completa").

export type Fiscal = { ncm?: string; cest?: string; cfop?: string; csosn?: string; origem?: string; status?: string };
export type Product = { id: string; name?: string; code?: string; measure?: string; fiscal?: Fiscal | null };
export type SaleItem = { productId?: string; name?: string; qty?: number; price?: number; canceled?: boolean };
export type Payment = { method?: string; amount?: number; change?: number; partial?: boolean; reversed?: boolean };
export type Sale = {
  id: string; status?: string; canceled?: boolean; items?: SaleItem[]; payments?: Payment[];
  discount?: number; creditApplied?: number; orderNumber?: number | string | null; customerName?: string; cpfNaNota?: string;
};

// Forma de pagamento do Commandah -> código da SEFAZ (tPag).
// 05 = crédito loja (fiado e crédito do sócio). Conferir com o contador.
export const TPAG: Record<string, string> = {
  dinheiro: "01", credito: "03", debito: "04", pix: "17", vale: "10", fiado: "05", "credito-socio": "05", credito_socio: "05",
};

const UNIDADE: Record<string, string> = { un: "UN", kg: "KG", l: "L", g: "G", ml: "ML" };
// CSOSN com ICMS-ST (Simples Nacional): exigem CEST no item.
const CSOSN_ST = ["201", "202", "203", "500"];
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const cents = (v: number) => Math.round(v * 100) / 100;

export type BuildResult = { payload: Record<string, unknown> | null; problems: string[]; total: number };

// serie: série da NFC-e do Commandah. Em produção é obrigatória e diferente da do Saipos (os dois
// emitem no mesmo CNPJ durante o piloto; mesma série = números repetidos e notas recusadas).
export function buildNfcePayload(sale: Sale, products: Product[], opts: { ambiente: 1 | 2; identificador: string; serie?: number }): BuildResult {
  const problems: string[] = [];
  if (opts.ambiente === 1 && !(Number(opts.serie) > 0)) problems.push("Defina a série da NFC-e do Commandah antes de emitir em produção (pedir ao contador).");
  if (!sale || sale.status !== "closed" || sale.canceled) {
    return { payload: null, problems: ["A comanda precisa estar fechada (e não cancelada) para emitir a NFC-e."], total: 0 };
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  const itens = (sale.items || []).filter((i) => !i.canceled && Number(i.qty) > 0);
  if (!itens.length) problems.push("A comanda não tem itens.");

  const produtos = itens.map((i, idx) => {
    const p = byId.get(String(i.productId || ""));
    const nome = String(i.name || (p && p.name) || "Item " + (idx + 1)).trim();
    const f = (p && p.fiscal) || {};
    const ncm = digits(f.ncm), cest = digits(f.cest), cfop = digits(f.cfop), csosn = digits(f.csosn);
    if (!p) problems.push(`"${nome}": o produto não existe mais no cadastro.`);
    else if (ncm.length !== 8 || cfop.length !== 4 || !csosn) problems.push(`"${nome}": faltam os dados fiscais (Produtos › Editar › aba Fiscal).`);
    if (cest && cest.length !== 7) problems.push(`"${nome}": o CEST precisa ter 7 números.`);
    // t214: produto com ICMS-ST sem CEST a SEFAZ recusa (Rejeição 806); avisa antes de enviar.
    else if (!cest && CSOSN_ST.includes(csosn)) problems.push(`"${nome}": tem substituição tributária (CSOSN ${csosn}) e está sem CEST; a SEFAZ recusa. Preencha o CEST em Produtos › Editar › aba Fiscal.`);
    const qtd = Number(i.qty) || 0, unit = cents(Number(i.price) || 0);
    const item: Record<string, unknown> = {
      NmProduto: nome.slice(0, 120),
      CodProdutoServico: String((p && (p.code && p.code !== "0" ? p.code : p.id)) || "ITEM" + (idx + 1)).slice(0, 60),
      EAN: "SEM GTIN",
      NCM: ncm,
      Quantidade: qtd,
      UnidadeComercial: UNIDADE[String((p && p.measure) || "un").toLowerCase()] || "UN",
      ValorUnitario: unit,
      ValorTotal: cents(unit * qtd),
      CFOP: Number(cfop) || 0,
      OrigemProduto: Number(f.origem || 0) || 0,
      // Simples Nacional: ICMS pelo CSOSN; PIS/COFINS 49 (outras saídas), como no exemplo da Brasil NFe. Conferir com o contador.
      Imposto: { ICMS: { CodSituacaoTributaria: csosn }, PIS: { CodSituacaoTributaria: "49" }, COFINS: { CodSituacaoTributaria: "49" } },
    };
    if (cest) item.CEST = cest;
    return item;
  });

  const bruto = cents(produtos.reduce((t, i) => t + (i.ValorTotal as number), 0));
  const desconto = cents(Math.max(0, Math.min(Number(sale.discount) || 0, bruto)));
  const total = cents(bruto - desconto);
  if (itens.length && total <= 0) problems.push("O valor da nota ficou zerado (desconto igual ao total).");

  // Pagamentos: a soma precisa fechar com o valor da nota. O que passar disso (taxa de serviço,
  // gorjeta, crédito que sobrou) não entra na NFC-e. Troco só em dinheiro.
  const pagos = (sale.payments || []).filter((p) => !p.reversed && Number(p.amount) > 0);
  // Crédito do sócio usado no pagamento fica fora de payments (OP-15: sale.creditApplied).
  if (Number(sale.creditApplied) > 0) pagos.push({ method: "credito-socio", amount: Number(sale.creditApplied) });
  const pagamentos: Record<string, unknown>[] = [];
  let falta = total;
  for (const p of pagos) {
    if (falta <= 0) break;
    const tPag = TPAG[String(p.method || "").toLowerCase()] || "99";
    const valor = cents(Math.min(Number(p.amount) || 0, falta));
    const pg: Record<string, unknown> = { IndicadorPagamento: 0, FormaPagamento: tPag, VlPago: valor };
    if (tPag === "99") pg.Descricao = String(p.method || "Outros").slice(0, 60);
    // Cartão: a NFC-e exige o grupo do cartão com o tipo de integração. No clube a maquininha
    // não é integrada (TEF existe, mas não é contratado; confirmado em 12/10) -> tpIntegra 2.
    if (tPag === "03" || tPag === "04") pg.TipoIntegracao = false;
    pagamentos.push(pg);
    falta = cents(falta - valor);
  }
  if (falta > 0) {
    if (!pagamentos.length) pagamentos.push({ IndicadorPagamento: 0, FormaPagamento: "90", VlPago: 0 });
    problems.push(`Os pagamentos da comanda não cobrem o valor da nota (faltam R$ ${falta.toFixed(2).replace(".", ",")}).`);
  }

  const payload: Record<string, unknown> = {
    ModeloDocumento: 65,
    Finalidade: 1,
    TipoAmbiente: opts.ambiente,
    NaturezaOperacao: "VENDA AO CONSUMIDOR",
    IndicadorPresenca: 1,
    ConsumidorFinal: true,
    IdentificadorInterno: opts.identificador,
    Produtos: produtos,
    Pagamentos: pagamentos,
    ValorTotal: total,
  };
  if (Number(opts.serie) > 0) payload.Serie = Number(opts.serie);
  if (desconto > 0) payload.ValorDesconto = desconto;
  const cpf = digits(sale.cpfNaNota);
  if (cpf.length === 11 || cpf.length === 14) payload.Cliente = { CpfCnpj: cpf, NmCliente: String(sale.customerName || "CONSUMIDOR").slice(0, 60) };
  if (sale.orderNumber != null && sale.orderNumber !== "") payload.Observacao = "Pedido " + sale.orderNumber + " - Commandah";
  return { payload: problems.length ? null : payload, problems, total };
}
