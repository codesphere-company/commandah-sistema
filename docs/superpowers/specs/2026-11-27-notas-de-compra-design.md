# Notas de compra (NF-e de entrada) — desenho

27/11/2026. Conversa com o dono (Fabricio). Memória: `notas-compra`.

## Por quê

Hoje a dona da lanchonete do clube faz tudo no Saipos, nesta ordem, para cada nota de compra:
**confere → concilia com o escritório de contabilidade → coloca para pagamento → dá entrada no estoque**.
Na virada para o Commandah (05/01/2027, piloto de 14 a 20/12) essas quatro etapas precisam existir aqui, ou ela
continua no Saipos/papel. E o dono quer vender o Commandah: tem que funcionar para **qualquer estabelecimento**,
sem preparação, com o estoque ficando automático (a venda já baixa insumos pela ficha técnica, `consume_insumos`).

## Objetivos

1. As NF-e emitidas contra o CNPJ do estabelecimento **chegam sozinhas**: o servidor busca a cada 2 h, sem
   ninguém abrir página.
2. Uma tela **Notas de compra** com as quatro etapas por nota: Conferida, Contabilidade, Pagamento, Estoque.
3. **Nota pronta = um toque.** Depois que um fornecedor já apareceu uma vez, a nota seguinte dele vem com tudo
   preenchido (itens ligados, conversão, categoria da conta); a dona só confere e toca em Confirmar.
4. **A nota monta o estoque** (caminho 1, escolhido pelo dono): cada item novo pede uma escolha, lembrada por
   fornecedor + código do produto:
   - ligar a um insumo que já existe;
   - criar insumo novo, com a conversão da embalagem (1 CX = 12 UN);
   - **revenda de um produto** (refrigerante, cerveja, água): cria o insumo e a ficha técnica 1:1 do produto;
   - **não é estoque** (limpeza, gás, embalagem, uso e consumo): fica de fora do estoque, mas entra no financeiro.
5. Pagamento: as duplicatas do XML viram **Contas a Pagar** (vencimento, valor, fornecedor pelo CNPJ, categoria),
   com "pago em" quando já foi pago.
6. Contabilidade: marcar "escritório conferiu" (com observação) e **baixar o arquivo do mês** (ZIP com os XML,
   mais uma planilha resumo) para mandar ao contador.

## Não objetivos (agora)

- Montar as fichas técnicas dos lanches (pão, carne, queijo). Continuam à mão em Produtos, para quem quiser.
- Importar insumos/fichas do Saipos (caminho 2). Pode vir depois, junto.
- DF-e direto na SEFAZ com certificado A1. A Brasil NFe resolve (só em produção, confirmado 27/11).
- Pedido de compra / cotação com fornecedor.
- Conciliação bancária.

## Anti-objetivos (seria fracasso mesmo funcionando)

- Nota entrar no estoque ou no financeiro **sozinha**, sem o toque de alguém. Sempre confirmação humana.
- Dar entrada em dobro (mesma chave duas vezes, ou retry depois de erro).
- Uma gravação de aparelho com lista velha desfazer baixas de venda (o problema do BD-10). Entrada de estoque
  passa por `insumos_apply` (delta), nunca regrava o blob inteiro.
- Token da Brasil NFe no navegador.
- Obrigar a dona a cadastrar tudo antes de usar.

## Restrições

- Front sem build, scripts clássicos, ordem em `index.html` (`CLAUDE.md`). Português em tudo.
- RLS por estabelecimento é a barreira. Escrita em produção, migration e deploy só com "sim" do dono.
- Brasil NFe: **notas de entrada só funcionam com a conta em produção** (homologação volta vazio). O clube vai a
  produção no piloto de dezembro; até lá, testar com XML real importado na mão e na bancada.
- Token por estabelecimento já existe (`nfce_emissores`, Vault; `tokenDo()` em `functions/nfce/index.ts`).
- Agendamento: `pg_cron` + `pg_net` já usados (WhatsApp, LGPD, cardápio).
- Hoje o clube tem 0 insumos, 0 fornecedores, 0 contas, 0 movimentos de estoque; 572 produtos sem ficha.

## Caminhos considerados

1. **A nota monta o estoque** — itens novos escolhem insumo/novo/revenda/não é estoque, lembrado por fornecedor.
   Funciona para qualquer estabelecimento sem preparação; o cadastro cresce com as notas. **Escolhido pelo dono.**
2. **Cadastro antes, pela planilha do Saipos** — importa insumos e as notas só ligam. Rápido se a exportação for
   boa, mas não serve para cliente que não vem do Saipos. Fica para depois, compatível com o 1.
3. **Só financeiro e contabilidade agora** — mais rápido, mas a entrada no estoque continuaria fora na virada.

## Como funciona

### API da Brasil NFe (`https://api.brasilnfe.com.br/services/fiscal`, header `Token`)

- `ObterNotasFiscais` `{ TipoDocumentoFiscal: 0, DtInicio, DtFim, TipoAmbiente: 1, TipoParticipacao: 0 }` →
  `Notas[]` com `Chave, Serie, Numero, ModeloDocumento, Valor, CnpjEmissor, NomeEmissor, Status, DtEmissao,
  DtRecebimento`. Sem paginação documentada: buscar em janelas curtas (desde a última busca − 1 dia de folga).
- `ObterArquivoNotaFiscal` `{ ChaveNF, FileType: 1, TipoDocumentoFiscal: 0 }` → XML em Base64 (string pura).
- **Ciência da operação: a Brasil NFe registra sozinha** quando a busca pega o XML, desde que a configuração
  esteja feita no painel deles (suporte, 27/11). O Commandah **não chama** `ManifestarNotaFiscal`. O dono já
  tinha autorizado a ciência automática (26/11). Confirmação/desconhecimento ficam fora desta etapa.
- **Um sistema buscando por vez**: se outro sistema (ex.: Saipos) buscar as notas do mesmo CNPJ ao mesmo tempo,
  um bloqueia o outro e as notas atrasam (suporte, 27/11; é a trava de consumo da distribuição de DF-e da
  SEFAZ). A busca do Commandah só liga quando a busca do outro sistema estiver desligada.
- `ObterArquivosPorPeriodo` `{ TipoNota: 2, Type: 1, DtInicio, DtFim }` → ZIP: alternativa para o arquivo do
  contador, mas o ZIP é montado por nós a partir dos XML guardados (independe da Brasil NFe).

### Servidor

**Tabela `notas_entrada`** (uma linha por nota, por estabelecimento): `tenant_id`, `chave` (única por tenant),
`origem` (`brasilnfe` | `xml_manual`), `modelo`, `numero`, `serie`, `emitente_cnpj`, `emitente_nome`,
`emissao`, `valor`, `situacao` (`resumo` | `completa` | `cancelada`), `xml` (texto), `itens` (jsonb, lidos do
XML), `duplicatas` (jsonb), etapas com quem/quando: `conferida_em/por`, `contabilidade_em/por/obs`,
`pagamento_em/por` (+ ids das contas criadas), `estoque_em/por` (+ deltas aplicados), `criada_em`.
RLS: leitura do próprio tenant para dono/admin e perfis com `contas` ou `insumos`; escrita só pelas RPCs e pela
Edge Function (ver "Decisões do Claude", permissões).

**Tabela `notas_entrada_vinculos`** (a memória do caminho 1): `tenant_id`, `emitente_cnpj`, `codigo_produto`
(cProd do fornecedor) → `tipo` (`insumo` | `revenda` | `fora`), `insumo_id`, `fator` (unidades de estoque por
unidade da nota), `produto_id` (revenda). Mais, por fornecedor, a categoria de conta lembrada.

**Edge Function `notas-entrada`**:
- `buscar` (chamada pelo `pg_cron` a cada 2 h, com segredo de serviço): para cada estabelecimento com a busca
  ligada **e** emissor em produção (`nfce_emissores.producao_liberada`), lista as notas desde a última busca,
  grava as novas como `resumo`, pede o XML (a Brasil NFe registra a ciência nessa hora) e marca `completa`;
  a que ainda não tiver XML fica `resumo` e é tentada de novo na próxima busca. Notas já gravadas que voltarem canceladas viram `cancelada` (se já tiverem entrada no
  estoque ou conta, avisa; nunca desfaz sozinha). Erro de uma nota não para as outras; registra em log.
- `buscar_agora` (administrador, pelo botão da tela): mesma coisa para o próprio estabelecimento.
- `importar_xml` (administrador): recebe um XML colado/enviado (nota de supermercado, NFC-e, nota antiga),
  valida que o destinatário é o CNPJ do estabelecimento e grava com `origem = xml_manual`. NFC-e de
  supermercado sem CNPJ do destinatário: aceita com aviso.
- O XML é lido no servidor (itens com `cProd, xProd, NCM, CFOP, uCom, qCom, vUnCom, vProd, vDesc, vFrete,
  vSeg, vOutro, vIPI, vST` e `cEAN`; duplicatas `cobr/dup` com `nDup, dVenc, vDup`; emitente completo).

**Quem grava o quê (decisão do Claude, depois da revisão).** Só os insumos (`insumos_apply`, por diferença) e os
produtos (`pushProducts`, com versão) têm gravação segura contra aparelho com lista velha. `contas`,
`fornecedores` e `stockMovements` são blobs regravados inteiros pelo site. Por isso:

- **Servidor, numa transação** — `notas_entrada_estoque(chave, escolhas)`: grava os vínculos novos, cria os
  insumos novos e aplica os deltas pelo mesmo mecanismo de `insumos_apply` (estoque atual + delta, trava na
  linha) e marca `estoque_em` com os deltas aplicados — **só se `estoque_em` ainda estiver vazio** (retry não
  duplica).
- **Navegador, pelos caminhos que já existem** (mesmo risco de qualquer lançamento manual de hoje):
  fornecedor novo (`state.fornecedores` + `save`), contas a pagar (`state.contas` + `save`), ficha 1:1 da
  revenda (`state.products` + `pushProducts`) e o movimento de estoque (`state.stockMovements`). Cada conta
  leva `notaChave`; antes de criar, procura conta com a mesma `notaChave` e não cria de novo. Só depois do
  `save('contas')` dar certo a tela chama `notas_entrada_marcar(chave, 'pagamento', contaIds)`.
- Transformar contas e movimentos em tabelas próprias fica fora deste projeto.

### Tela "Notas de compra" (Gestão › Estoque, ou Financeiro — decisão do construtor, com atalho nos dois)

```
Notas de compra                         [Buscar agora] [Importar XML] [Arquivo do mês]
Filtro: (Pendentes) Todas  Canceladas        Mês: [novembro ▾]

Fornecedor            Nº     Emissão   Valor      Conf.  Contab.  Pagto  Estoque
Distribuidora X       1234   25/11     1.280,00    ✓      ·        ✓      ✓
Atacadão (NFC-e)      88812  26/11       312,40    ·      ·        ·      ·   ← itens novos: 6
Gás Maringá           551    26/11       420,00    ✓      ✓        ✓      —   (não é estoque)
```

Abrir uma nota mostra cabeçalho, itens e parcelas:

```
Coca-Cola lata 350ml · 5 CX · R$ 192,00                         já ligado ✓
   → Coca lata (insumo)  1 CX = 12 UN  →  +60 UN, custo R$ 3,20/UN
Detergente 500ml · 2 UN                                          novo
   ( ) Ligar a insumo   ( ) Novo insumo   ( ) Revenda de [produto ▾]   (•) Não é estoque

Parcelas: 1/2 10/12 R$ 640,00 · 2/2 24/12 R$ 640,00    Categoria: [Mercadorias ▾]   [ ] Já paga em [__]

[Confirmar]   (marca Conferida + lança Pagamento + dá entrada no Estoque)
[Escritório conferiu]  obs: [__________]
```

- **Confirmar** = um toque para Conferida + Pagamento + Estoque. Cada etapa também pode ser feita sozinha
  (ex.: pagamento hoje, estoque quando a mercadoria chegar).
- Itens com vínculo lembrado vêm prontos; a nota só bloqueia o Confirmar se houver item sem escolha.
- Fornecedor: achado pelo CNPJ em `fornecedores`; se não existir, criado com os dados do emitente.
- Contas a pagar: uma por duplicata; sem duplicata no XML, uma conta com vencimento na emissão (editável).
  Gravadas no mesmo formato de `savePayableAccount` (`tipo:'pagar'`, `fornecedorId`, `categoriaId`...) com
  referência à chave da nota, para não lançar duas vezes.
- **Avisos**: o sino mostra "N notas de compra novas" (sistema de avisos existente).
- **Arquivo do mês**: ZIP com os XML do mês + planilha (fornecedor, CNPJ, nº, emissão, valor, etapas).
- A janela antiga "Alterar Estoque com NFe" passa a abrir esta tela (o import manual vira `importar_xml`).

### Custo do insumo (decisão do Claude)

Custo por unidade de estoque = (`vProd − vDesc + vFrete + vSeg + vOutro + vIPI + vST`) ÷ (`qCom × fator`).
Atualiza `costPerUnit` do insumo (último custo), como a importação manual já faz.

## Decisões do Claude (o dono pode mudar)

- Duas tabelas novas no banco em vez do blob `app_data`, porque quem grava as notas é o servidor e o blob
  regravado inteiro pelo site perderia dados.
- Busca com **trava própria**, separada da emissão de NFC-e: `notas_entrada_liberada` em `nfce_emissores`
  (a equipe liga pelo CLI, como `producao_liberada`) **e** o administrador liga a busca na tela. Usa o token do
  emissor do estabelecimento; não exige emitir NFC-e em produção. As consultas usam sempre `TipoAmbiente: 1`
  (em homologação a Brasil NFe não devolve entrada). O token da Brasil NFe é por empresa; mesmo assim a busca
  descarta nota cujo `CnpjDestinatario` não seja o CNPJ do estabelecimento.
- Caminho antigo (`applyNfeStock`, `settings.nfeImports`, `nfeCode`): não migra (o clube tem 0 insumos). A
  trava contra entrada dupla consulta `notas_entrada` **e** `settings.nfeImports`.
- Janela da busca: desde a última busca bem-sucedida menos 1 dia; primeira busca, 30 dias.
- Confirmar faz três etapas de uma vez; Contabilidade é sempre separada (a dona faz em lote com o escritório).
- Nota cancelada pelo fornecedor depois da entrada: aviso para a dona estornar à mão (botão "desfazer entrada"
  que aplica o delta contrário); nunca automático.
- Permissão: usa as que existem. A tela aparece para quem tem `contas` ou `insumos`. Pagamento e
  Contabilidade exigem `contas` (e o RLS do blob `contas`, hoje só admin); Estoque exige `insumos`
  (`insumos_apply` já aceita admin e caixa). O botão Confirmar só faz as etapas que a pessoa pode. Sino: quem
  tem `contas` ou `insumos`. Sem permissão nova.

## Deixado para o construtor

- Onde a tela fica no menu, nomes de funções e arquivos, layout fino no padrão das telas novas (garçom/Caixa).
- Formato exato da planilha do arquivo do mês.
- Como a ficha 1:1 de revenda lida com produto de grade/tamanhos (provável: ficha por tamanho, só se o
  produto não tiver tamanhos; com tamanhos, pedir o tamanho na escolha).
- Testes na bancada (`../auditoria-2026-11-03`) com XML reais e com a Brasil NFe simulada.
- Entrada em `NOVIDADES` ao publicar.

## Piloto e virada (decidido em 27/11)

- **O Saipos busca as notas sozinho** (certificado digital ligado à SEFAZ). Dois sistemas buscando o mesmo CNPJ
  se bloqueiam. Então, no **piloto (14–20/12), a busca do Commandah fica desligada**: a tela é testada com XML
  importado à mão (`importar_xml`) — conferir, contabilidade, pagamento, estoque e arquivo do mês.
- **Na virada (05/01)**: desligar a busca de notas no Saipos (ou tirar o certificado de lá) → pedir ao suporte
  da Brasil NFe a configuração de captura com ciência automática → ligar a busca no Commandah.
- **Data de início** por estabelecimento (`notas_entrada_inicio`, padrão = dia em que a busca é ligada): nota
  emitida antes dela chega como **"tratada fora"** (só consulta e arquivo do contador; não pede conferência,
  não mexe em estoque nem em contas). Evita entrada e pagamento em dobro das notas já tratadas no Saipos.
- Primeira busca: 30 dias (as anteriores à data de início entram como "tratada fora").
- Custo/limite das chamadas da Brasil NFe: perguntado ao suporte, sem resposta ainda. Busca a cada 2 h até
  saber; se houver cobrança por chamada, espaçar.
