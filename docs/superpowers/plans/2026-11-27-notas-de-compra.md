# Notas de compra (NF-e de entrada) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As notas de compra chegam ao Commandah (busca automática pela Brasil NFe ou XML importado à mão) e a dona trata cada uma em quatro etapas — conferida, contabilidade, pagamento, estoque — com a nota montando o cadastro de insumos.

**Architecture:** Duas tabelas novas (`notas_entrada`, `notas_entrada_vinculos`) + `notas_entrada_config`, escritas só por RPCs e pela Edge Function `notas-entrada` (busca, importação manual, arquivo do mês). O estoque entra pelo servidor reaproveitando `insumos_apply` (por diferença, trava na linha). Fornecedor, contas a pagar e ficha de revenda são gravados pelo site pelos caminhos que já existem, com `notaChave` contra duplicar. Tela nova em Gestão.

**Tech Stack:** Postgres/RLS/pg_cron/pg_net, Deno/TS (supabase-js 2.117.0, `npm:fast-xml-parser@4.5.1`, `npm:fflate@0.8.2`), HTML/CSS/JS puro sem build, bancada Playwright + fakesupa (`../auditoria-2026-11-03`).

**Spec:** `docs/superpowers/specs/2026-11-27-notas-de-compra-design.md`

## Global Constraints

- Sem build, scripts clássicos globais; arquivo novo entra em `index.html` na ordem; `node scripts/bump-version.js`, `node scripts/check-app.js` e `node scripts/check-load-order.js` passando.
- Português em código, comentários (citar `t-notas` e o porquê), tela e commits. Escape com `h`/`jsArg`. Gravações com `singleFlight`.
- Token da Brasil NFe nunca vai ao navegador; vem de `nfce_emissores` (mesma regra de `tokenDo()` em `functions/nfce/index.ts`).
- API: `https://api.brasilnfe.com.br/services/fiscal` (env `BRASILNFE_API` sobrescreve, para a bancada); consultas de entrada sempre com `TipoAmbiente: 1`; o Commandah **não** chama `ManifestarNotaFiscal`.
- Busca só roda para tenant com `notas_entrada_config.liberada = true` (equipe, pelo CLI) **e** `busca_ligada = true` (administrador, na tela).
- Nota com `emissao < notas_entrada_config.inicio` entra com `fora = true` ("tratada fora"): não pede conferência, não mexe em estoque nem em contas.
- Custo por unidade de estoque = (`vProd − vDesc + vFrete + vSeg + vOutro + vIPI + vST`) ÷ (`qCom × fator`); atualiza `costPerUnit` (último custo).
- Permissões: tela para `contas` **ou** `insumos` (e dono/admin); Pagamento e Contabilidade exigem `contas`; Estoque exige `insumos`. SQL: `public.tem_permissao(text)`.
- Migration, deploy de função, secret e merge só com o "sim" do dono.

## Review Focus

1. A mesma nota chega duas vezes (XML importado à mão e depois pela busca, ou duas buscas sobrepostas) → uma linha só; XML manual completa uma nota `resumo` (teste em T2 e T3).
2. Confirmar duas vezes ou repetir depois de erro de rede → estoque entra uma vez, contas criadas uma vez (teste em T2 e T5).
3. Item em KG com quantidade decimal, fator decimal, nota sem duplicatas → custo certo e uma conta com vencimento na emissão (teste em T1 e T5).
4. Nota cancelada pelo fornecedor depois da entrada → aviso, nada desfeito sozinho; "desfazer entrada" aplica o delta contrário uma vez só (teste em T2 e T3).
5. XML de outro CNPJ → recusado; NFC-e de supermercado sem destinatário → aceita com aviso (teste em T3).

---

### Task 1: Leitor do XML da NF-e

**Files:**
- Create: `supabase/functions/notas-entrada/ler-xml.ts` (puro, sem Deno.env)
- Test: bancada `notas-entrada/ler-xml.test.mjs` + amostras em `notas-entrada/amostras/` (NF-e 55 com 2 duplicatas e item em CX; NF-e sem `cobr`; item em KG com `qCom` decimal; NFC-e 65 sem `dest`; nota de outro CNPJ; XML quebrado; `procNFe` e `NFe` sem protocolo)

**Interfaces:**
- Produces: `lerNotaXml(xml: string): NotaLida` (lança `Error('xml_invalido')`), onde
  `NotaLida = { chave, modelo: 55|65, numero, serie, emissao (ISO), valor, emitente: { cnpj, nome, fantasia, ie, fone, endereco }, destinatarioCnpj: string|null, itens: ItemLido[], duplicatas: { numero, vencimento (YYYY-MM-DD), valor }[] }`;
  `ItemLido = { n, codigo, ean: string|null, nome, ncm, cfop, unidade, qtd, valorUnit, custoTotal }` com `custoTotal = vProd − vDesc + vFrete + vSeg + vOutro + vIPI + vST` (ausente = 0; `vST` = `vICMSST` do item).

- [ ] Escrever o teste: amostra 55 → `chave` de 44 dígitos sem o prefixo `NFe`, 2 duplicatas com datas, item CX com `custoTotal` somando desconto/frete/IPI/ST; sem `cobr` → `duplicatas` vazio; KG → `qtd === 1.234`; NFC-e → `destinatarioCnpj === null`; quebrado → lança `xml_invalido`; `procNFe` e `NFe` dão o mesmo resultado; um item só (objeto, não lista) vira lista.
- [ ] Rodar `node notas-entrada/ler-xml.test.mjs <repo>` → falha.
- [ ] Implementar com `fast-xml-parser` (`ignoreAttributes:false`, números como texto e convertidos à mão).
- [ ] Rodar → passa. Commit.

### Task 2: Banco — tabelas, RPCs e permissões

**Files:**
- Create: `supabase/migrations/20261128000000_notas_entrada.sql`
- Test: bancada `e2e/t93-notas-entrada-banco.js`

**Interfaces:**
- Tabelas (todas com `tenant_id text`, RLS ligada, leitura para dono/admin ou `tem_permissao('contas') or tem_permissao('insumos')`, sem insert/update direto para `authenticated`):
  - `notas_entrada`: `id uuid pk`, `tenant_id`, `chave text` (unique com tenant), `origem text check in ('brasilnfe','xml_manual')`, `modelo int`, `numero text`, `serie text`, `emitente_cnpj text`, `emitente_nome text`, `emissao timestamptz`, `valor numeric`, `situacao text check in ('resumo','completa','cancelada')`, `fora boolean default false`, `aviso text`, `xml text`, `dados jsonb` (o `NotaLida`), `conferida_em/_por`, `contabilidade_em/_por/_obs`, `pagamento_em/_por`, `pagamento_contas jsonb`, `estoque_em/_por`, `estoque_deltas jsonb`, `estoque_desfeito_em/_por`, `criada_em timestamptz default now()`.
  - `notas_entrada_vinculos`: `tenant_id`, `emitente_cnpj`, `codigo`, `tipo text check in ('insumo','revenda','fora')`, `insumo_id text`, `produto_id text`, `tamanho_id text`, `fator numeric default 1`, `atualizado_em`; pk (`tenant_id`,`emitente_cnpj`,`codigo`).
  - `notas_entrada_config`: `tenant_id pk`, `liberada boolean default false`, `busca_ligada boolean default false`, `inicio date`, `ultima_busca_ok timestamptz`, `ultimo_erro text`, `categorias jsonb default '{}'` (cnpj → categoriaId).
- RPCs (`security definer`, `search_path ''`, tenant da sessão como as demais):
  - `notas_entrada_estoque(p_chave text, p_upserts jsonb, p_deltas jsonb, p_vinculos jsonb) returns jsonb` — exige `tem_permissao('insumos')`; recusa se a nota não existe, é `fora`, está `cancelada` ou já tem `estoque_em` (devolve `{ja:true}` sem mexer); chama `public.insumos_apply(p_upserts, p_deltas, '[]')`, grava os vínculos (upsert), `estoque_em/_por`, `estoque_deltas = p_deltas`; devolve `{ ok:true, insumos }`.
  - `notas_entrada_desfazer_estoque(p_chave text) returns jsonb` — exige `insumos`; só com `estoque_em` e sem `estoque_desfeito_em`; aplica `-delta` por `insumos_apply`; marca `estoque_desfeito_em/_por` e limpa `estoque_em`.
  - `notas_entrada_marcar(p_chave text, p_etapa text, p_dados jsonb) returns jsonb` — etapas `conferida` (contas ou insumos), `contabilidade` (contas; `p_dados.obs`), `pagamento` (contas; `p_dados.contas` = ids); idempotente (segunda marcação não troca quem/quando).
  - `notas_entrada_config_salvar(p_busca_ligada boolean, p_inicio date, p_categorias jsonb) returns jsonb` — só dono/admin; não mexe em `liberada`.
  - `notas_entrada_liberar(p_tenant text, p_on boolean)` — só service role (equipe pelo CLI).

- [ ] Escrever t93: seed com nota `completa` e nota `fora`; colaborador com `insumos` dá entrada (+60 no insumo, vínculo gravado); segunda chamada devolve `{ja:true}` e o estoque segue +60; venda no meio (`consume_insumos`) não é desfeita; nota `fora` e `cancelada` recusadas; colaborador só com `insumos` não marca `pagamento`; desfazer volta o estoque e não roda duas vezes; `liberada` não muda por `config_salvar`; colaborador sem `contas`/`insumos` não lê `notas_entrada`; outro tenant não lê.
- [ ] Rodar `node e2e/t93-notas-entrada-banco.js <repo>` → falha.
- [ ] Escrever a migration.
- [ ] Rodar → passa. Commit.

### Task 3: Edge Function `notas-entrada` e agendamento

**Files:**
- Create: `supabase/functions/notas-entrada/index.ts`, `supabase/functions/notas-entrada/arquivo.ts` (ZIP com `fflate`)
- Create: `supabase/migrations/20261128010000_notas_entrada_cron.sql` (`cron.schedule('notas-entrada-buscar', '0 */2 * * *', ...)` com `net.http_post` para `/functions/v1/notas-entrada`, cabeçalho `x-segredo` lido do Vault `notas_entrada_segredo`; mesmo padrão de "se não houver pg_cron, pula" das migrations do WhatsApp)
- Modify: bancada `e2e/fakesupa.js` (rota `/functions/v1/notas-entrada` via `realFunction`; env `BRASILNFE_API` apontando para uma Brasil NFe falsa) e `e2e/brasilnfe-falsa.js` (novo: `ObterNotasFiscais`, `ObterArquivoNotaFiscal`)
- Test: bancada `e2e/t94-notas-entrada-funcao.js`

**Interfaces:**
- Consumes: `lerNotaXml` (T1); tabelas da T2.
- HTTP (POST JSON):
  - `{action:'buscar'}` com `x-segredo` = secret `NOTAS_ENTRADA_SEGREDO` → percorre tenants `liberada and busca_ligada`; janela `ultima_busca_ok − 1 dia` (primeira: 30 dias) até agora; `ObterNotasFiscais {TipoDocumentoFiscal:0, DtInicio, DtFim, TipoAmbiente:1, TipoParticipacao:0}`; descarta `CnpjDestinatario` diferente do CNPJ do tenant (`settings.nfce.emitente.cnpj` ou o campo que a `nfce` já usa); nota nova → `resumo` → `ObterArquivoNotaFiscal {ChaveNF, FileType:1, TipoDocumentoFiscal:0}` → `lerNotaXml` → `completa` + `dados`; `Status` cancelada → `situacao='cancelada'` e, se tiver `estoque_em` ou `pagamento_em`, `aviso='Cancelada pelo fornecedor depois da entrada. Confira e desfaça se for o caso.'`; `fora` pela data de início; erro de uma nota não para as outras; grava `ultima_busca_ok` ou `ultimo_erro`. Devolve `{tenants, novas, completas, canceladas}`.
  - `{action:'buscar_agora'}` (JWT de dono/admin) → o mesmo só para o próprio tenant (exige `liberada`).
  - `{action:'importar_xml', xml}` (JWT com `contas` ou `insumos`) → `lerNotaXml`; destinatário diferente do CNPJ do tenant → `{erro:'outro_cnpj'}`; sem destinatário → grava com `aviso='Nota sem CNPJ do destinatário (cupom de supermercado). Confira se é da lanchonete.'`; chave já existente em `resumo` → completa; em `completa` → `{ja:true}`; também consulta `settings.nfeImports` (chave já aplicada pelo caminho antigo → `{ja:true, antigo:true}`).
  - `{action:'arquivo_mes', mes:'YYYY-MM'}` (JWT com `contas`) → `{nome:'notas-de-compra-YYYY-MM.zip', base64}` com os XML (`<chave>.xml`) e `resumo.csv` (`Fornecedor;CNPJ;Número;Série;Emissão;Valor;Situação;Conferida;Contabilidade;Pagamento;Estoque`, `;` e vírgula decimal).

- [ ] Escrever t94: Brasil NFe falsa com 3 notas (uma de outro destinatário, uma cancelada) → `buscar` com segredo grava 1 `completa` + 1 `cancelada`, ignora a outra; sem segredo → 401; tenant sem `liberada` → nada; segunda busca não duplica; nota antes do `inicio` → `fora`; nota cancelada depois de `estoque_em` → `aviso` e estoque intacto; `importar_xml` de outro CNPJ → `outro_cnpj`; NFC-e sem `dest` → gravada com aviso; importar a mesma de novo → `ja`; `arquivo_mes` → ZIP com N+1 arquivos e o CSV com a linha da nota; caixa sem `contas` → 403 no `arquivo_mes`.
- [ ] Rodar `FAKE_STAFF_AUTH=1 node e2e/t94-notas-entrada-funcao.js <repo>` → falha.
- [ ] Implementar função e migration do cron (CORS por `comCors`, como as outras).
- [ ] Rodar → passa. Commit.

### Task 4: Tela "Notas de compra" — lista, importar, buscar, arquivo, configuração

**Files:**
- Create: `assets/js/gestao/notas-compra.js` (marcador `/* ============ NOTAS DE COMPRA ============ */`)
- Modify: `index.html` (tag depois de `gestao/contas.js`), `assets/js/core/config.js` (menu Estoque e Financeiro: "Notas de compra", perm `contas`/`insumos`; view `notascompra`), `assets/js/core/navegacao.js:265` (`openNfeStockWindow` passa a abrir a tela nova)
- Test: bancada `e2e/t95-notas-compra-lista.js`

**Interfaces:**
- Consumes: HTTP e RPCs de T2/T3.
- Produces: `renderNotasCompra()`, `notasCompraCarregar()` (lê `notas_entrada` sem `xml`), `notasCompraImportar()`, `notasCompraBuscarAgora()`, `notasCompraArquivoMes(mes)`, `notasCompraConfig()`; `notasCompraEtapas(nota) → {conferida, contabilidade, pagamento, estoque: 'feito'|'falta'|'nao_se_aplica'}` (estoque `nao_se_aplica` quando todos os itens são `fora`).

- [ ] Escrever t95: admin abre Gestão › Notas de compra → filtro "Pendentes" mostra só as que têm etapa faltando e não são `fora`; colunas Fornecedor, Nº, Emissão, Valor e as quatro etapas; importar uma amostra XML aparece na lista; importar de outro CNPJ mostra "Esta nota é de outro CNPJ"; "Buscar agora" sem `liberada` mostra "A busca automática ainda não foi liberada para este estabelecimento"; "Arquivo do mês" baixa o ZIP; configuração grava `busca_ligada` e data de início; caixa sem `contas`/`insumos` não vê o menu; 390 px sem rolagem lateral; "Alterar com NFe" abre a tela nova.
- [ ] Rodar → falha. Implementar no padrão visual das telas novas (Caixa/garçom). Rodar → passa. Commit.

### Task 5: Abrir a nota — escolhas, Confirmar, escritório, desfazer

**Files:**
- Create: `assets/js/gestao/notas-compra-nota.js`
- Modify: `index.html` (tag depois de `notas-compra.js`)
- Test: bancada `e2e/t96-notas-compra-nota.js`

**Interfaces:**
- Consumes: `notas_entrada_estoque`, `notas_entrada_marcar`, `notas_entrada_desfazer_estoque`, `notas_entrada_vinculos`, `notas_entrada_config.categorias`; `state.insumos`, `state.products` + `pushProducts`, `state.fornecedores`, `state.contas`, `state.stockMovements`, `save()`.
- Produces: `abrirNotaCompra(chave)`, `notaCompraConfirmar(chave)`, `notaCompraEtapa(chave, etapa)`, `notaCompraEscritorio(chave, obs)`, `notaCompraDesfazer(chave)`; escolha por item `{tipo:'insumo'|'novo'|'revenda'|'fora', insumoId?, nome?, unidade?, fator, produtoId?, tamanhoId?}`.
- Confirmar, nesta ordem, cada passo só se a pessoa tiver a permissão e a etapa ainda faltar:
  1. `conferida` (`notas_entrada_marcar`);
  2. Pagamento: fornecedor pelo CNPJ em `state.fornecedores` (cria com `nome`=fantasia ou nome, `razaoSocial`, `documento`, `telefone` do emitente); uma conta por duplicata (sem duplicata: uma com vencimento = emissão), formato de `savePayableAccount` + `notaChave` e `notaDup`; pula conta cuja `notaChave+notaDup` já existe; `save('contas')` ok → `notas_entrada_marcar('pagamento', {contas})`; "Já paga em" preenche `pago/dataPagamento/valorPago`; categoria lembrada por CNPJ em `config.categorias`;
  3. Estoque: `novo` e `revenda` viram `p_upserts` (insumo novo `{id:uid(), name, unit, stock:0, minStock:0, costPerUnit}`); deltas `qtd × fator`; `costPerUnit` pela fórmula; revenda grava `product.recipe=[{insumoId, qty:1}]` (ou no tamanho escolhido) por `pushProducts`; `notas_entrada_estoque`; movimentos em `state.stockMovements` (`operation:'NF-e <nº>'`, `reference: chave`) + `save('stockMovements')`.
- Cada etapa também tem botão próprio (`notaCompraEtapa(chave, 'conferida'|'pagamento'|'estoque')`), para pagar hoje e dar entrada quando a mercadoria chegar.
- Item sem escolha bloqueia só a etapa Estoque ("Escolha o que fazer com N itens novos").

- [ ] Escrever t96: nota com 2 itens novos (Coca CX → revenda do produto "Coca lata", fator 12; Detergente → não é estoque) e 2 duplicatas → Confirmar: insumo "Coca lata" com +60 e custo = custoTotal/60; ficha do produto 1:1; 2 contas a pagar com vencimentos e fornecedor criado pelo CNPJ; etapas marcadas; segunda nota do mesmo fornecedor vem com tudo escolhido e confirma num toque; Confirmar de novo não cria conta nem estoque; falha de rede no meio (derrubar `notas_entrada_estoque` uma vez) e repetir → estoque uma vez; nota sem duplicata → 1 conta com vencimento = emissão; item KG com fator 1 e qtd 1,234 → +1,234; "Escritório conferiu" com observação grava; desfazer volta o estoque; colaborador só com `insumos` confirma estoque e não vê o bloco de pagamento; nota `fora` abre só para consulta.
- [ ] Rodar → falha. Implementar. Rodar → passa. Commit.

### Task 6: Aviso no sino, Novidades, HANDOFF e PR

**Files:**
- Modify: `assets/js/core/avisos.js` (aviso "N notas de compra novas", contando `notas_entrada` pendentes não `fora`, para quem tem `contas` ou `insumos`; tocar abre a tela; também "Nota cancelada pelo fornecedor" quando houver `aviso`), `assets/js/sistema/novidades.js`, `docs/HANDOFF.md` (item 9 atualizado; roteiro da virada), `index.html` (`?v=`)
- Test: bancada `e2e/t97-notas-compra-aviso.js`

- [ ] Escrever t97: 2 notas pendentes → sino mostra "2 notas de compra novas" para admin e para quem tem `insumos`, não para garçom; confirmar uma → "1"; nota cancelada com entrada → aviso próprio.
- [ ] Rodar → falha. Implementar. Rodar t93–t97 e os testes antigos que tocam insumos/contas (`ls e2e | grep -i "insumo\|conta\|nfe"`) → passam.
- [ ] `node scripts/bump-version.js`, `check-app.js`, `check-load-order.js`. Commit, push e PR (sem merge; migration, deploy, secret `NOTAS_ENTRADA_SEGREDO` e Vault `notas_entrada_segredo` só com o "sim").

## Depois do "sim" (fora do plano de código)

1. Aplicar as duas migrations, criar secret e segredo no Vault, deploy da função, merge.
2. Piloto (14–20/12): busca desligada; testar com XML reais importados à mão.
3. Virada (05/01): desligar a busca no Saipos → suporte Brasil NFe configura captura com ciência → `notas_entrada_liberar('clube-olimpico-maringa-y8mt', true)` → admin liga a busca com início 05/01.
