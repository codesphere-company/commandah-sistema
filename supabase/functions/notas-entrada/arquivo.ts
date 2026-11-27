// t-notas, tarefa 3: "Arquivo do mês" para o contador — ZIP com o XML de cada nota (<chave>.xml) e a
// planilha resumo.csv (separador ";" e vírgula decimal, como o Excel em português abre direto).
// Puro (sem Deno.env e sem rede), para testar na bancada.
import { strToU8, zipSync } from 'npm:fflate@0.8.2';

export type NotaArquivo = {
  chave: string; numero: string | null; serie: string | null; emitente_cnpj: string | null; emitente_nome: string | null;
  emissao: string | null; valor: number | string | null; situacao: string; xml: string | null;
  conferida_em: string | null; contabilidade_em: string | null; pagamento_em: string | null; estoque_em: string | null;
};

const CABECALHO = ['Fornecedor', 'CNPJ', 'Número', 'Série', 'Emissão', 'Valor', 'Situação', 'Conferida', 'Contabilidade', 'Pagamento', 'Estoque'];
const SITUACAO: Record<string, string> = { resumo: 'Só resumo', completa: 'Completa', cancelada: 'Cancelada' };

// Data no fuso de Brasília (fixo em −03:00 desde 2019, sem horário de verão): dd/mm/aaaa.
export function dataBr(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!isFinite(t)) return '';
  const d = new Date(t - 3 * 3600 * 1000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}
const valorBr = (v: number | string | null) => (v == null || v === '' || !isFinite(Number(v)) ? '' : Number(v).toFixed(2).replace('.', ','));
// Campo com ";", aspas ou quebra de linha vai entre aspas (aspas dobradas), senão o Excel quebra a coluna.
const campo = (s: string) => (/[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

export function resumoCsv(notas: NotaArquivo[]): string {
  const linhas = [CABECALHO.join(';')];
  for (const n of notas) {
    linhas.push([
      n.emitente_nome || '', n.emitente_cnpj || '', n.numero || '', n.serie || '', dataBr(n.emissao), valorBr(n.valor),
      SITUACAO[n.situacao] || n.situacao, dataBr(n.conferida_em), dataBr(n.contabilidade_em), dataBr(n.pagamento_em), dataBr(n.estoque_em),
    ].map(campo).join(';'));
  }
  // BOM: sem ele o Excel abre o UTF-8 como Latin-1 e estraga os acentos do cabeçalho e dos fornecedores.
  return String.fromCharCode(0xFEFF) + linhas.join('\r\n') + '\r\n';
}

export function montarZip(notas: NotaArquivo[]): Uint8Array {
  const arquivos: Record<string, Uint8Array> = {};
  for (const n of notas) if (n.xml && /^\d{44}$/.test(n.chave)) arquivos[n.chave + '.xml'] = strToU8(n.xml);
  arquivos['resumo.csv'] = strToU8(resumoCsv(notas));
  return zipSync(arquivos, { level: 6 });
}

// Base64 em pedaços (String.fromCharCode com o arquivo inteiro estoura a pilha em ZIP grande).
export function paraBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
