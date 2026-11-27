// t-notas: leitor do XML da NF-e/NFC-e (modelos 55 e 65) para as notas de compra.
// Puro: sem Deno.env e sem rede, para testar na bancada. Aceita <nfeProc> (com protocolo) e <NFe> solta.
import { XMLParser, XMLValidator } from 'npm:fast-xml-parser@4.5.1';

export type ItemLido = {
  n: number; codigo: string; ean: string | null; nome: string; ncm: string; cfop: string;
  unidade: string; qtd: number; valorUnit: number; custoTotal: number;
  // t-semnota (27/11): para criar o produto do cardápio pela nota. icms = CST (regime normal) ou CSOSN (Simples)
  // do fornecedor; st = o item veio com ICMS por substituição tributária (CST 10/30/60/70, CSOSN 201/202/203/500
  // ou valor de ST); origem = orig do ICMS (0 nacional...).
  cest: string; icms: string; origem: string; st: boolean;
};
export type NotaLida = {
  chave: string; modelo: 55 | 65; numero: string; serie: string; emissao: string; valor: number;
  emitente: { cnpj: string; nome: string; fantasia: string; ie: string; fone: string; endereco: string };
  destinatarioCnpj: string | null;
  itens: ItemLido[];
  duplicatas: { numero: string; vencimento: string; valor: number }[];
};

// Tudo vem como texto (zeros à esquerda de NCM/CNPJ/número não podem sumir); números convertidos à mão.
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false, trimValues: true,
});

// deno-lint-ignore no-explicit-any
type No = any;
const lista = (x: No): No[] => (x == null || x === '' ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: No): string => (x == null || typeof x === 'object' ? '' : String(x).trim());
const num = (x: No): number => { const v = parseFloat(txt(x)); return isFinite(v) ? v : 0; };

export function lerNotaXml(xml: string): NotaLida {
  let doc: No;
  try {
    if (typeof xml !== 'string') throw new Error();
    // t-notas (revisão da tarefa 1): arquivo salvo pelo Bloco de Notas/Excel vem com BOM UTF-8 no começo e o
    // validador recusa ("<?xml" tem que ser o primeiro caractere). Tira antes de validar.
    if (xml.charCodeAt(0) === 0xFEFF) xml = xml.slice(1);
    if (XMLValidator.validate(xml) !== true) throw new Error();
    doc = parser.parse(xml);
  } catch { throw new Error('xml_invalido'); }
  const inf = (doc?.nfeProc?.NFe ?? doc?.NFe)?.infNFe;
  if (!inf || typeof inf !== 'object') throw new Error('xml_invalido');
  const chave = txt(inf['@_Id']).replace(/^NFe/i, '');
  const modelo = num(inf.ide?.mod);
  if (!/^\d{44}$/.test(chave) || (modelo !== 55 && modelo !== 65)) throw new Error('xml_invalido');

  const e = inf.emit ?? {}, en = e.enderEmit ?? {};
  const endereco = [
    [txt(en.xLgr), txt(en.nro)].filter(Boolean).join(', '), txt(en.xBairro),
    [txt(en.xMun), txt(en.UF)].filter(Boolean).join('/'), txt(en.CEP),
  ].filter(Boolean).join(' - ');

  const itens: ItemLido[] = lista(inf.det).map((d: No, k: number) => {
    const p = d.prod ?? {}, imp = d.imposto ?? {};
    const ean = txt(p.cEAN);
    // vIPI e vICMSST ficam dentro de um grupo variável (IPITrib, ICMS10, ICMS70...): acha o campo no grupo.
    const doGrupo = (g: No, campo: string): number => {
      for (const v of Object.values(g ?? {})) {
        if (v && typeof v === 'object') { const x = (v as No)[campo]; if (x != null) return num(x); }
      }
      return 0;
    };
    // Grupo do ICMS (ICMS00, ICMS60, ICMSSN102, ICMSSN500...): o primeiro objeto dentro de <ICMS>.
    const gIcms = (Object.values(imp.ICMS ?? {}).find((v) => v && typeof v === 'object') ?? {}) as No;
    const icms = txt(gIcms.CST) || txt(gIcms.CSOSN);
    const vST = doGrupo(imp.ICMS, 'vICMSST');
    const st = ['10', '30', '60', '70', '201', '202', '203', '500'].includes(icms) || vST > 0;
    const custoTotal = num(p.vProd) - num(p.vDesc) + num(p.vFrete) + num(p.vSeg) + num(p.vOutro)
      + doGrupo(imp.IPI, 'vIPI') + doGrupo(imp.ICMS, 'vICMSST');
    return {
      n: num(d['@_nItem']) || k + 1, codigo: txt(p.cProd), ean: /^\d+$/.test(ean) ? ean : null,
      nome: txt(p.xProd), ncm: txt(p.NCM), cfop: txt(p.CFOP), unidade: txt(p.uCom),
      qtd: num(p.qCom), valorUnit: num(p.vUnCom), custoTotal: Math.round(custoTotal * 100) / 100,
      cest: txt(p.CEST).replace(/\D/g, ''), icms, origem: txt(gIcms.orig), st,
    };
  });

  const duplicatas = lista(inf.cobr?.dup).map((d: No) => ({
    numero: txt(d.nDup), vencimento: txt(d.dVenc), valor: num(d.vDup),
  }));

  return {
    chave, modelo: modelo as 55 | 65, numero: txt(inf.ide?.nNF), serie: txt(inf.ide?.serie),
    emissao: txt(inf.ide?.dhEmi ?? inf.ide?.dEmi), valor: num(inf.total?.ICMSTot?.vNF),
    emitente: { cnpj: txt(e.CNPJ ?? e.CPF), nome: txt(e.xNome), fantasia: txt(e.xFant), ie: txt(e.IE), fone: txt(en.fone), endereco },
    destinatarioCnpj: txt(inf.dest?.CNPJ) || null,
    itens, duplicatas,
  };
}
