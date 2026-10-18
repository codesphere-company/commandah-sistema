# Handoff — Commandah

> Peça pra eu ler este arquivo no início de qualquer conversa nova sobre este projeto ("lê o HANDOFF.md antes de começar"). Eu mantenho ele atualizado ao fim de cada sessão relevante.

Última atualização: **2026-10-18, noite** (comanda abre na própria tela de comandas, não mais em popup; testes reais de 18/10 conferidos pelo dono; app do garçom vê e fecha comanda, sem fiado; crédito do sócio abatido sozinho no caixa e no garçom, PR #127; fechamento cobra consumo + pendência do sócio, PR #129; ver "18/10" no começo do Estado atual). Antes: **2026-10-17, noite** (app do garçom: rolagem e cobrança do avulso na hora, PRs #124 e #125; checagem do `?v=` corrigida; caminho da integração com a laranjinha da Rede; ver "17/10" no começo do Estado atual). Antes: **2026-10-16** (painel do lançamento sincronizado com este arquivo). Antes: **2026-10-15** (CSC 3 é de produção; ver "CSC (15/10)"). Antes: **2026-10-12, noite** (ver "Fim do dia 12/10"). No ar desde 12/10:
- NFC-e completa em homologação: dados fiscais, emissão manual e ao fechar, cupom com QR, cancelamento e configuração;
- regras de impressão do caixa e agente 2.3;
- login com uma leitura só;
- importação de produtos com dados fiscais;
- manual atualizado.

Falta o CSC de homologação para o primeiro teste real. A lanchonete é da irmã do Fabricio. Antes: **2026-10-11, fim do dia** (ver "Fim do dia 11/10" no começo do Estado atual: o Commandah NÃO está em uso no clube, que opera com o Saipos; mapa da rede do clube; impressão automática publicada). Antes: **2026-10-11, noite** (impressão automática: computador conectado por código, impressoras encontradas, caixa imprime tudo). Antes: **2026-10-11** (PR #93: administrador gera o token do agente de impressão; instalação do agente no clube em andamento). Antes: **2026-10-11** (PR #90: login por e-mail mostrava a lista de colaboradores vazia — confirmado; SEG-04 concluído). Antes: **2026-10-10, fim do dia** (ver "Fim do dia 10/10" no começo do Estado atual). Antes: **2026-10-10, tarde** (PRs #65–#67: bloqueio v2, transferir itens, reabrir comanda, movimentações por usuário — ver "Resumo rápido (10/10, tarde)"). Antes: **2026-10-10** (SEG-12, OPS-05, OP-14, PROD-18 e BD-11 publicados; main protegida — ver "Resumo rápido (10/10)"). Antes: **2026-10-09, noite** (auditoria de 07/10 praticamente concluída: Fases A, B, U, C e D publicadas — PRs #40 a #55; SEG-12 no PR #56 esperando "publicar"; o que falta depende do dono. Ver "Resumo rápido (09/10, noite)" no começo do Estado atual). Antes, **2026-10-09, tarde** (PRs #40 a #43 publicados: comandas e Novo Pedido redesenhados, Fase C lotes 1 a 3).

> **Sobre os números de linha** (`index.html:NNNN`): nas seções datadas eles valem para o código **daquela data** e envelhecem a cada mudança — procure pelo nome da função, não pela linha. Só as Pendências abertas são mantidas com linha atual (conferida em 2026-10-02).

Atualização anterior: **2026-09-24** (cancelar item/comanda com permissão por login + carrinho no "Adicionar produto direto" + histórico da comanda agrupado por pedido — os três testados, confirmados e já no ar via PR #27; mais a correção de comanda cancelada não contar como receita nos relatórios, testada e confirmada, no PR #28 — ver seções próprias; mais o alerta de fila de impressão travada, testado e confirmado — ver seção própria)

## O que é o projeto

Commandah é o sistema de comanda/PDV do **Clube Olímpico** (Maringá — negócio real do Fabricio, não é side project fictício). Roda direto no navegador, sem servidor de aplicação.

> **Situação real (confirmada pelo dono em 11/10):** o Commandah **ainda não está em uso** no clube. A operação roda no **Saipos**. Este computador (COMPANYPC, notebook do Fabricio) é onde o Commandah é programado e testado, e ele fica **na rede real do clube**, junto com os notebooks do Saipos. Frases antigas deste arquivo como "nada imprime desde 29/08" ou "colar o token no agente do clube" falam de testes, não de operação. Não varrer a rede, não mandar impressão de teste para as impressoras do clube e não deixar o agente de teste rodando sem combinar com o dono.
>
> **A lanchonete é da irmã do Fabricio** (contado em 12/10): empresa **A&V Rosa Foods Ltda**, CNPJ 55.147.384/0001-61, Simples Nacional. CNPJ, certificado A1, CSC, contador e o contrato com o emissor de NFC-e são dela. Decisões fiscais e a troca do Saipos passam por ela.


- **Frontend**: `index.html` (casca, ~170 linhas) + `assets/css/` (4 arquivos) + `assets/js/` (47 scripts clássicos por módulo, carregados em ordem), sem build step (reorganizado em 14/10, ver `CLAUDE.md` e `docs/ARQUITETURA.md`). Mais `sw.js` (service worker, PROD-17) e `manifest.webmanifest`.
- **Deploy**: GitHub Pages, `https://codesphere-company.github.io/commandah-sistema/` (push em `main` já publica; cache do Pages é `max-age=600` — se algo "não atualizou", é isso, pedir pro usuário dar Ctrl+Shift+R ou testar em anônima antes de investigar bug).
- **Backend**: Supabase (projeto `ezfoymdesmarpunmixbs`) — Postgres + PostgREST + Auth + Edge Functions, acessado direto do navegador com a chave anon. **RLS é a única barreira de segurança real** — não existe camada de API própria.
- **Multi-tenant**: `tenant_owners` (user_id → tenant_id) + tabela `app_data` (JSON por `(tenant_id, key)`, ex. chave `cantina2:settings`). Tenant do Fabricio: `clube-olimpico-maringa-y8mt`. Já saíram do blob para tabela própria: sócios (`members`, Fase 1), pedidos da cozinha (`orders`, Fase 3a) e **vendas (`sales`, EST-01 em 09/10)**. Caixa e insumos continuam no blob, mas gravados por funções com trava (BD-03, BD-10).
- **Impressão**: agente desktop (C#, `agente-impressao/`, versão **2.1** desde 11/10) num computador da rede das impressoras. Ele faz polling na fila `print_jobs` (`print_agent_fetch_pending`) e imprime via ESC/POS (TCP raw na porta 9100 para impressoras de rede, driver do Windows para as USB). Desde 11/10 o computador é conectado por código e as impressoras são escolhidas em Configurações › Impressoras (ver "Impressão automática").

## Limitação importante da minha conexão

O MCP do Supabase está sem token (OPS-14). **Desde 09/10 as migrations são aplicadas pelo CLI desta máquina** (logado na conta do Commandah): `npx supabase db query --linked -f supabase/migrations/<arquivo>.sql < /dev/null` (sem o `< /dev/null` o comando fica preso esperando entrada) e depois `npx supabase migration repair --status applied <versão> --linked`. Leituras de conferência do mesmo jeito, com um `.sql` de `select`. Teste de migration antes de produção: Postgres 18 local (`C:/Program Files/PostgreSQL/18/bin`, cluster temporário com stubs de `current_tenant_id`/`current_staff_role`). Deploy de Edge Function é feito pela Supabase CLI local (`supabase functions deploy <nome> --project-ref ezfoymdesmarpunmixbs --use-api`), sem precisar de Docker nem `supabase link`.

## Estado atual (o que já está pronto)

### 18/10 — comanda no app do garçom, crédito automático e pendência no fechamento (PRs #127 e #129, sem migration)
- **Comanda na própria tela (computador, pedido do dono, como no Saipos):** clicar numa comanda abre o detalhe no lugar da lista de comandas, não mais em popup. "‹ Comandas" (ou Esc) volta para a lista; pagar, cancelar, excluir ou fechar em outro aparelho também volta. Os popups que saem da comanda (novo pedido, parcial, trocar cliente, pagamento) continuam por cima e voltam por `openComanda(id, true)`.
  - No código: `comandaAbertaId`, `openComanda` → `renderComandaDetail` (desenha em `#view-comandas`), `closeComandaView` (`vendas/comandas.js`). `renderComandas` não redesenha a comanda aberta na atualização periódica (não apaga o que o caixa digita) e volta para a lista se ela não estiver mais aberta. `switchView` para outra tela limpa `comandaAbertaId`; aberta de outra tela (ex.: fechamento do caixa), troca para Comandas. Mantém a classe `cash-order-modal` (o CSS e `renderDraftItems` dependem dela) e acrescenta `comanda-inline`; o "Voltar" do menu lateral saiu (o botão fica ao lado da cota).
  - Altura calculada para não dar rolagem na página em 1366×768. Testado no Chrome invisível em 1366×768 e 1920×1080 (15 verificações, `gc-test/tela.js`).
- **Ver a comanda:** tocar numa comanda em andamento (ou "Abrir" num sócio com comanda) abre a tela da comanda (`gcOpenComanda`/`gcRenderComanda`): itens lançados com quem pediu e horário, cancelados riscados, consumo, serviço, parcial já pago e total. Dali, "+ Novo pedido" (o Voltar do pedido retorna à comanda) ou "Fechar conta". Antes o toque ia direto para o novo pedido.
- **Fechar conta pelo garçom** (`gcGoCloseComanda`, `gcConfirmCloseComanda`, mesma tela de cobrança do avulso): dinheiro (troco), Pix, crédito e débito. **Sem fiado: o garçom só cobra** (decisão do dono); fiado só no caixa. Fecha por `finalizeSale('comanda', …)`, igual ao caixa (parciais entram nos pagamentos, `close_sale` idempotente, NFC-e automática).
  - Travas: caixa fechado não cobra; busca a comanda no servidor antes de cobrar e, se o total mudou (item lançado em outro aparelho), mostra o novo total sem fechar; comanda bloqueada no caixa não aceita pedido nem fechamento pelo app.
- **Crédito do sócio abatido sozinho** (decisão do dono, 18/10; substitui a de 10/10, em que o caixa marcava "Usar crédito do sócio"): no pagamento do caixa saíram a pergunta "Sócio com crédito" e o interruptor; o resumo mostra "Crédito do sócio (abatido)". No garçom o resumo da comanda já mostra o crédito e quanto sobra (`gcComandaTotals`, mesma conta do `openPaymentModal`: crédito antes do serviço, parcial no fim). Com duas comandas abertas, o crédito vai para a que fechar primeiro.
- Testado no Chrome invisível a 380 px com servidor simulado (31 verificações, `gc-test/comanda.js` no scratchpad). **Conferido de verdade pelo dono em 18/10 (celular e caixa): funcionou.**
- **Pendência do sócio cobrada junto no fechamento (PR #129, merge `cd8e139`, sem migration):** o dono testou no caixa: sócio com fiado em aberto, liberado com a senha do administrador, fechava a comanda pagando só o consumo. Agora:
  - **Caixa:** o pagamento mostra "(+) Pendência anterior (fiado)" e soma ao total; "Cobrar a pendência anterior junto" vem marcado (dá para desmarcar se o cliente paga só o consumo). Marcado, não aceita fiado.
  - **Garçom:** resumo da comanda e fechar conta trazem a pendência e cobram sempre junto; atualiza o saldo do sócio (`MembersStore.refreshOne`) antes de cobrar.
  - **Registro:** a venda fica só com o consumo (faturamento certo) e guarda `debtPaid`. A pendência sai das últimas formas lançadas (`splitDebtFromPayments`) e vira pagamento de fiado no extrato do sócio + entrada no caixa (`recordDebtPaidWithSale`, igual ao "Registrar Pagamento"). Se essa baixa falhar depois da venda gravada, aviso e log para lançar à mão.
  - Funções em `vendas/pagamento.js` (`memberDebtDue` também é usada por `gcComandaTotals`). Testado no Chrome invisível (17 verificações, `gc-test/pendencia.js`). **Conferido no caixa de verdade pelo dono em 18/10: funcionou.**

### 17/10 — ordem do que falta (combinada com o dono)
- **Nada do site mudou.**
- **Esperando o contador:** CSC de homologação, série nova da NFC-e e as decisões fiscais (t105, t207, t303). Não há o que adiantar até ele mandar.
- **Fica para o fim, tudo junto, quando formos imprimir:** instalar os agentes nos 3 computadores e configurar as impressoras (t202, t203), imprimir o cupom da NFC-e em papel e conferir os NCM (t201).
- **Planilha do Saipos (t109):** a irmã do Fabricio manda depois (o prazo de 18/10 não vale mais). Com ela, rodar a importação (t204), primeiro só na prévia.
- **App do garçom (comparado com fotos do Saipos no celular do clube):** o dono achou o nosso fluxo bom e **não quer copiar as telas do Saipos** (grade de mesas, faixa de categorias). Mudou só o que estava errado:
  - **Rolagem (PR #124, merge `0ef4dfe`):** `html,body{overflow:hidden}` (tela do computador) travava o `#garcomApp`; categorias e produtos além da altura da tela ficavam inalcançáveis. Agora `#garcomApp.show` tem `height:100dvh;overflow-y:auto`.
  - **Cliente avulso paga na hora (PR #125, merge `291a27c`, sem migration):** no modo clube o avulso **não abre comanda**. "+ Cliente avulso (não sócio) — paga na hora" (ou "Atender … como avulso" quando a busca não acha sócio) → itens → revisão (observação e local) → **Cobrar** → dinheiro (valor recebido e troco), Pix, crédito ou débito (cartão passado na maquininha e confirmado no app). Sem comprovante (decisão do dono: não sairia em lugar nenhum).
    - No código: `gcOpenAvulso`, `gcSale`, `gcRenderCharge`, `gcConfirmCharge` (com `singleFlight`). Fecha por `finalizeSale('balcao')` com `gcChargeDraft` como `currentSaleDraft`: ficha na cozinha, `close_sale` idempotente, pagamento no caixa aberto, `autoEmitNfce`. `finalizeSale` (balcão) passou a mandar `saleMeta.local` para a cozinha e a ficha.
    - Travas: caixa fechado (`refreshCashState` antes) ou valor menor não gravam nada; se a ficha saiu e a gravação falhou, aviso fixo, não deixa voltar e a nova tentativa usa o mesmo id.
    - O garçom entra como papel `caixa` com `origem:'app'`; por isso o `close_sale` já aceitava. Sócio e modo bar sem mudança.
    - Testado no Chrome invisível a 380 px com servidor e cozinha simulados (21 verificações, `gc-test/cobrar.js` no scratchpad). **Conferido no celular pelo dono em 18/10: funcionou.**
  - **Checagem do CI corrigida (no PR #125):** o passo "O ?v= do index.html tem que mudar junto" pegava o `?v=` de um comentário do `index.html` (sem número) e recusava todo PR que mexe em `assets/`. Agora exige ao menos um caractere (`?v=[A-Za-z0-9]\{1,\}`). Nome do workflow e do job iguais.
  - **Armadilha do teste no Chrome invisível:** sem login, o `#tenantSetupOverlay` (fixo) cobre a tela e engole toque e roda do mouse. Esconder antes de testar rolagem.
- **Maquininha integrada (pedido do dono):** o clube usa a **laranjinha do Itaú (Laranjinha Smart, Rede)**, contrato da lanchonete. O e.Rede (indicado pelo atendimento) é só pagamento online. O caminho é a **Laranjinha Store** (redestore.service-now.com/dev_portal.do, "Rede Store" no developer.userede.com.br): exige entrar no **Programa de Parcerias Conexão Itaú** (formulário em itau.com.br/empresas/conexaoitau/parceiros) e esperar aprovação. Só depois aparecem SDK e documentação. Requisitos: app Android nativo com o SDK da Rede, modelos N960K e L400, transações só pela Rede, gestão de usuários, certificação; pode ser loja privada. Para o Commandah seria um app Android que abre o site por dentro e faz a ponte com o pagamento (semanas, mais a aprovação). **Esperando o dono decidir e preencher o formulário** (dados da empresa: combinar com a irmã). Até lá o cartão é digitado.
- **Fase 3 conferida no código: concluída.** O item 6 das Pendências já estava resolvido por outras tarefas: vendas na tabela `sales` (EST-01), caixa e insumos por funções com trava (BD-03, BD-10) e número do pedido por função com trava (`set_order_counter`). O poll de 6 s já busca só o que mudou (BD-06). Do item 7 sobra só o Realtime nos pedidos da cozinha: o dono decidiu não fazer agora (ganho de até 6 s, pequeno perto do resto da virada).

### 16/10 — painel do lançamento em dia
- **Nada do site mudou.** O painel (https://claude.ai/artifact/9ZiwkEfqYUeNnPd1T9y3Vm) só abre na conta do claude.ai do Commandah. Se ele der 404, é login em outra conta: fazer `/login` com a conta certa, não criar outro painel.
- Tarefas atualizadas com o que está abaixo (CSC de 15/10, PR #113):
  - **t105** (contador) passou para "em andamento". Falta pedir o CSC de homologação, a série nova e as decisões fiscais da t207.
  - **t107** (emissor): autorização de uso de sistema feita. Falta passar o CSC 3 para os campos de produção na Brasil NFe.
  - **t207** e **t303**: dependem só do CSC de homologação. Cancelamento e Configurações › NFC-e já estão publicados.
- **Prazos de agora:** t107 (16/10), t109 (exportar produtos do Saipos, 18/10; a importação t204 espera essa planilha), e de 21 a 24/10 as t202, t203, t205 e t206 (agente na cozinha, impressoras, colaboradores, locais e pagamentos). Virada mantida em 23/11.

### Estrutura de pastas (14/10) — branch `refactor/estrutura-pastas`
- O `index.html` de 10 mil linhas foi dividido sem mudar lógica: CSS em `assets/css/`, JS em `assets/js/<área>/` na mesma ordem. Conferido por reconstrução byte a byte, análise de ordem de carregamento e Chrome (online e offline, capturas idênticas).
- Ao mudar qualquer arquivo de `assets/`, rode `node scripts/bump-version.js` (troca o `?v=`; o CI exige). Checagens: `node scripts/check-app.js`.
- Histórico até 11/10 foi para `docs/historico/handoff-ate-2026-10-11.md`.

### Fim do dia 12/10 — leia isto primeiro na próxima conversa
- **Nada do site mudou hoje.** O trabalho foi de planejamento da NFC-e, no painel do lançamento e fora do repositório.
- **Respostas do dono e da irmã (dona da lanchonete):**
  - o Saipos emite NFC-e (t101 feito): credenciamento, certificado A1 e CSC já existem;
  - quando a internet cai, o Saipos **não** emite: contingência offline não é obrigatória para a virada;
  - já houve mês com **mais de 8 mil NFC-e**;
  - no Saipos, a comida está com NCM 2106.90.90, CFOP 5101 e CSOSN 102; as cervejas com NCM 2203.00.00 e CSOSN 500; a tela não mostra CEST nem CFOP das bebidas;
  - **erro no Saipos:** a Coca-Cola está com NCM 2203.00.00 (cerveja); o certo é 2202.10.00. Avisar o contador.
- **Emissor escolhido: Brasil NFe** (t106 feito, t107 em andamento). Comparação publicada em https://claude.ai/artifact/HZ1VCTEcbvGGdgWPWFky6U (Focus NFe fica como plano B).
  - Plano de R$ 49,90/mês, NF-e e NFC-e ilimitadas, 1 CNPJ. A Focus custaria uns R$ 475 com 8 mil notas.
  - Tem um programa para o caixa ("Brasil NFe Agente") que assina a nota sem internet; fica para depois.
  - **Conta criada em homologação** no CNPJ da lanchonete. O suporte confirmou pelo WhatsApp: serviços "desativados" no painel = homologação, grátis; ativar (e pagar) só na produção.
  - **Certificado A1 enviado ao painel, válido até 25/03/2027** (renovar antes e subir no Saipos e na Brasil NFe).
  - **Token da empresa** salvo em `.claude/tmp/brasilnfe-token.txt` (pasta fora do git). É o "Token – A&V ROSA FOODS LTDA" do menu Credenciais, não o token pessoal. Vale para produção também: tratar como senha.
  - Teste feito: `POST https://api.brasilnfe.com.br/services/fiscal/ConsultarStatusSefaz` com `{"ModeloDocumento":65}` e header `Token` → 107 "Serviço em Operação", PR (41), 1,2 s.
  - **Falta o CSC de homologação** (o contador manda em 13/10). Vai em Configurações › Geral › NFC-e › "Ident./Código CSC Homologação". Depois: emitir em homologação uma comanda de teste (1 cerveja em lata + 1 lanche).
  - API: `POST /services/Fiscal/EnviarNotaFiscal` (`ModeloDocumento` 65, `TipoAmbiente` 2 = homologação), `ConsultarNotaFiscal`, `ObterArquivoNotaFiscal`, cancelamento em "Eventos". Documentação em https://brasilnfe.com.br/api; SDKs .NET, PHP, Node e Python.
  - Emissor próprio (no agente C#, biblioteca DFe.NET) é possível, mas ficou para depois da virada: com a Brasil NFe a economia seria só uns R$ 600/ano.
- **Códigos fiscais (t201 em andamento):** planilha `C:\Users\fabri\Documents\commandah\codigos-fiscais-sugeridos.xlsx` (fora do repositório) com NCM, CEST, CFOP e CSOSN sugeridos para os 104 produtos do Commandah, colunas amarelas para o contador. Comida confirmada pelo Saipos; bebidas: falta CEST e CFOP (esperado 5405), conferir num XML de NFC-e já emitida ou na nota de compra do fornecedor. O cadastro do Commandah tem só 1 refrigerante e nenhuma água: falta produto em relação ao Saipos.
  - Para ler os produtos de produção: `bash .claude/tmp/produtos.sh` (só `select`; o dono liberou essa regra em `/permissions`). Gera `.claude/tmp/produtos.json`.
- **Painel do lançamento:** as anotações das tarefas agora aparecem inteiras, em destaque, com a etiqueta "tem anotação" (antes ficavam escondidas numa caixa de uma linha). Notas novas em t101, t105, t106, t107, t109 e t201.
- **NFS-e tomadas** (opção da Brasil NFe) não é necessária: são notas de serviço. As notas dos fornecedores são NF-e de produto; o Commandah já importa o XML em Insumos › Alterar Estoque com NFe (manual). Busca automática na SEFAZ fica como melhoria futura.
- **t108 publicada (PR #101, merge `27a7958`; migration `20261012000000` aplicada e registrada pelo dono, `migration list` bate: 28 migrations; agente 2.2 no ar em `downloads/`, conferido igual ao build):**
  - **Tela:** em Configurações › Impressoras, cada computador ganha a chave "Procurar impressoras na rede sozinho" e o botão "＋ Impressora pelo IP". Cada impressora de rede ganha "Remover", e IP escolhido que não respondeu aparece em vermelho.
  - **Ao desligar a busca:** as impressoras de rede achadas sozinho que já imprimem algo viram "escolhidas"; as outras saem da lista.
  - **Agente 2.2** (`downloads/CommandahImpressora.exe` atualizado, igual ao build): com a busca desligada não varre a /24, só confere os IPs escolhidos (`Discovery.Probe`, qualquer faixa, porta opcional).
  - **Migration `20261012000000_impressao_ips_escolhidos.sql`:** `print_agents.scan_network` (padrão true), `print_agent_printers.manual`, `print_ip_valid()`. O ping devolve `scan` e `check_ips`; `print_agent_manage` ganha `scan_on`, `scan_off`, `add_ip` e `remove_ip` (sem computador = todos), com audit_log. O report com a busca desligada não cria impressora nova, o que protege contra o agente 2.1.
  - **Testes:** 34 verificações em Postgres local (`t108.js` + `stubs.sql` no scratchpad da sessão), Probe contra impressora falsa local e captura da tela com dados de exemplo.
  - **Falta (t202):** no computador da cozinha, agente 2.2 e **busca desligada antes de qualquer teste**; depois "＋ Impressora pelo IP" com 192.168.110.112, .113 e .114.
  - **Achado:** a seção de Impressoras passa da largura da tela no celular (já era assim antes; é usada no PC).
- **t207 (NFC-e no Commandah) publicada em homologação** (PR #103, merge da parte 1; PR #105, merge `91641c3` da parte 2; o #104 foi fechado pelo GitHub ao apagar o branch base e substituído pelo #105):
  - **Parte 1, dados fiscais do produto:** `p.fiscal = {ncm, cest, cfop, csosn, origem, status:'ok'|'conferir', nota}` no blob de produtos, sem migration. Aba "Fiscal (NFC-e)" no cadastro, com "Sugerir"; Produtos › Opções › "Dados fiscais (NFC-e)" (prévia e preenchimento em massa, nunca sobrescreve); coluna NFC-e; códigos na exportação Excel. `suggestProductFiscal` testada nos 104 produtos reais (bate com a planilha). **Os produtos de produção ainda NÃO foram preenchidos:** é preciso clicar em "Preencher" (dono ou admin).
  - **Parte 2, emissão:** Edge Function **`nfce`** publicada (secret `BRASILNFE_TOKEN`), com `payload.ts` (montagem pura, 21 testes; rodar com `node payload.test.ts`, Node 24). Migration **`20261012010000_nfce_notas.sql` aplicada e registrada** (29 migrations). Botão "Emitir NFC-e de teste (homologação)" em Relatórios › Histórico de Pedidos › detalhe da comanda fechada (admin/caixa). A função consulta antes de emitir (`IdentificadorInterno` = id da venda + `-h` em homologação), grava cada tentativa em `nfce_notas` e só permite uma autorizada por comanda e ambiente.
  - **Produção tem duas travas:** `settings.nfce.ambiente = 1` **e** o secret `NFCE_PRODUCAO=liberada`. Também é obrigatória `settings.nfce.serie`. Ainda não existe tela para isso.
  - **Teste real em homologação (12/10):** nota montada pela função (Heineken lata + Cheese Burguer, R$ 33) → a Brasil NFe aceitou o formato e a SEFAZ-PR recusou só com **462 (CSC não cadastrado)**. Número 1, série 1 de homologação usados.
  - **Série:** sem `Serie`, a Brasil NFe usa a 1, que deve ser a do Saipos em produção. O Commandah precisa da série nova do contador antes de produção.
  - **Decisões a confirmar com o contador:** fiado e crédito do sócio = tPag 05 (crédito loja); taxa de serviço/gorjeta fora da NFC-e (pagamentos cortados no valor da nota); PIS/COFINS CST 49; Coca-Cola com 2202.10.00.
  - A resposta de `ConsultarNotaFiscal` usa nomes diferentes da emissão (`Chave`, `CodStatusResposta`, `Emitida`, XML dentro de `Nota`): a função trata os dois.
  - **Token da Brasil NFe vazou na tela em 12/10** (o `npm notice` imprimiu o `secrets set`). Foi regenerado no painel, o antigo foi conferido como revogado ("Token inválido") e o secret foi atualizado com `--env-file .claude/tmp/nfce.env`. **Nunca passar o token na linha de comando: usar sempre `--env-file`.**
  - Deploy da função: `npx supabase functions deploy nfce --project-ref ezfoymdesmarpunmixbs --use-api` (a primeira tentativa deu 500 interno; a segunda passou).
- **t303, cupom da NFC-e (DANFE), publicado** (PR #107, merge `07b71d0`; sem migration; agente **2.3** em `downloads/`, conferido igual ao build):
  - `buildNfceDanfe(xml, cols)` no index.html monta o cupom do XML autorizado no leiaute do Manual do DANFE NFC-e, com QR Code nativo ESC/POS (`GS ( k`, modelo 2, correção M) e 80/58 mm.
  - Botão "Imprimir cupom da NFC-e" na nota autorizada; sai em `receiptPrinterFor(currentUser)`.
  - **Agente 2.3:** `Printing.NeedsRaw` (ESC/POS que contém `GS ( k`) faz `PrintWindowsRaw` (winspool RAW) em impressora USB; com `PrintToFileDir` grava `.bin`. Fichas comuns iguais.
  - **Bug antigo corrigido:** o agente troca todo 0x01 por 0x00 (NUL_PLACEHOLDER), então `ESC E 1`, `ESC a 1` e `ESC M 1` viravam "desligar". O negrito do "ENTREGAR EM" das fichas de rede nunca funcionou. **Regra: liga/desliga ESC/POS usa '1'/'0' (0x31/0x30), nunca 0x01.** O QR é recusado quando pL ou pH cairia em 1.
  - **Testes:** 19 do cupom com XML de exemplo (`danfe-test/` no scratchpad: `danfe.test.js`, `sample-nfce.xml`, `paper.js` gera a prévia do papel com o QR); agente em modo arquivo (`RawTest.cs`). **Ainda não impresso em papel real.**
  - **Riscos a conferir no clube:** USB precisa do agente 2.3; Bematech em modo ESC/Bema pode não aceitar `GS ( k`.
- **Equipamentos do clube (t102, respondido em 12/10):**
  - Todas as impressoras são de **rede (cabo)**: cozinha **.111 (Bematech MP-4200)**, caixa **.114** (os 2 caixas imprimem nela, por enquanto há uma só), bar **.113** e churrasqueira **.112**.
  - Os **3 computadores** (2 caixas + cozinha) estão na mesma rede 192.168.110.x.
  - **Plano de instalação (t202):** agente 2.3 nos 3 computadores, com a **busca na rede desligada** e os 4 IPs adicionados pelo IP em todos (se um estiver desligado, outro imprime; o claim garante uma impressão só). Nos 2 caixas, "Caixa: imprimir tudo lançado aqui em .114" + "Exceto: Cozinha".
  - A Bematech fica na cozinha, que só imprime fichas. O cupom da NFC-e (QR) sai na .114.
- **Maquininha (t103):** não é integrada; o TEF existe, mas é opcional e pago. O caixa digita o valor. A NFC-e manda cartão com `TipoIntegracao: false` (PR #111, merge `926921b`; função `nfce` publicada de novo; testado em homologação, recusada só pelo CSC).
- **Saipos (t104):** não há data limite; encerra 30 dias depois do pedido de cancelamento. Sugestão anotada na t901: pedir só depois da decisão da virada (t602, 21/11).
- **Regras de impressão do dono, publicadas no PR #109 (merge `9de054a`, sem migration):**
  - No computador de caixa, comida com preparo (Cozinha) vai **só para a impressora da cozinha** e para o monitor. Bebida, lanche pronto e sem preparo saem **no caixa**, para o cliente retirar.
  - Garçom: cada estação na sua impressora. Bar e churrasqueira só recebem ficha do app do garçom.
  - Comprovante **só se o cliente pedir**: caixinha "Imprimir comprovante (se o cliente pedir)" no pagamento e botão no detalhe da comanda paga. Antes saía sozinho no balcão; agora traz as formas de pagamento e o troco.
  - No código: `caixaKeepStations(dev)` lê `keepStations` na entrada `estacao:'tudo'` (padrão `['cozinha']`). `printSingleTicket` só desvia para o caixa o que não está nessa lista, ou quando a estação não tem impressora. Funções `printSaleReceipt` e `receiptPayLines`.
  - Testado em simulação (11 cenários); ainda não em impressora real.
- **NFC-e: configuração, emissão ao fechar e cancelamento publicados** (PR #113, merge `06a5ea9`; migration **`20261012020000_nfce_cancelamento.sql` aplicada e registrada**, 30 migrations; função `nfce` publicada de novo):
  - **Configurações › "NFC-e (nota fiscal)"** (`openNfceSettings`): `state.settings.nfce = {ambiente, serie, autoEmitir, autoImprimir}`. Produção exige série e confirmação; o servidor ainda exige `NFCE_PRODUCAO=liberada`.
  - **Emissão ao fechar** (`autoEmitNfce`, chamada depois de `finalizeSale` na tela de pagamento): desligada por padrão. Se estiver ligada, emite e imprime o cupom (`printNfceDanfe`). Recusa ou falta de código fiscal vira aviso de erro e log.
  - **Cancelamento:** ação `cancelar` na função (`CancelarNotaFiscal`; sucesso = cStat 135/155; 501 = fora do prazo). A nota vira `cancelada` com `cancel_protocolo`, `cancel_motivo`, `cancelada_por` e `cancelada_em`, e vai para o audit_log. Botão "Cancelar NFC-e (faltam N min)" na nota autorizada (`openCancelNfce`), só dentro de `NFCE_CANCEL_MIN` (30). Depois de cancelada, a comanda pode ter nota nova.
  - **Reabrir comanda com nota autorizada** (`openReopenComanda`, agora async): dentro dos 30 min, cancela a nota junto com o motivo da reabertura; depois, bloqueia com orientação (contador, nota de devolução). Cancelar a comanda inteira só vale para comanda aberta, que não tem nota.
  - **Contingência offline não é necessária para a virada** (o Saipos também não emite sem internet).
  - **Testado:** migration local; resposta real do `CancelarNotaFiscal` com a nota recusada ("protocolo não encontrado"). **Não testado:** cancelamento de nota autorizada (depende do CSC).
- **Login com uma leitura só (t404) e Impressoras no celular** (PR #115, merge `0302fed`; **o dono entrou numa janela anônima e conferiu que está tudo certo**):
  - `storageApi.getMany(keys)` (`.in('key', …)`) traz as ~30 chaves do `app_data` numa requisição. Se falhar, `loadAll` volta para o `get()` chave por chave.
  - Na tela de Impressoras, `.ps-list` passou a usar `grid-template-columns:minmax(0,1fr)`: a opção longa da lista "Caixa:" alargava a grade. Ficou certo a 380 px.
  - **Armadilha do Chrome em modo invisível:** ele não abre janela com menos de 504 px. Para medir celular, limite o contêiner a 380 px (ver `ovf.js` no scratchpad).
  - **Prévias do Netlify não fazem login:** a verificação de humano (Turnstile) só aceita `codesphere-company.github.io`. Mudança no login se confere no site oficial, logo depois do merge, com reversão pronta.
  - O ganho real de velocidade ainda precisa ser medido na internet do clube (t404).
- **Importação de produtos com dados fiscais, manual da equipe e "sem preparo" no bar** (PR #117, merge `b94841c`, sem migration):
  - **Importar (t204, preparado):** `IMPORT_FIELDS` ganhou estação, NCM, CEST, CFOP, CSOSN e origem (`importEstacaoKey`, `importFiscal`; fiscal sempre "a conferir").
    - `findImportMatch` reconhece o produto por id, código PDV, código (menos "0") ou nome + categoria. Nunca só pelo nome: AMSTEL existe em 4 categorias e os 104 produtos têm código PDV único.
    - `mergeImportedProducts` mostra "Conferir a importação" no lugar do `confirm()`. Com `_cols` (planilha), a atualização é parcial e não apaga o que não veio. O pacote .ccprod continua com a atualização completa.
    - **Bug antigo corrigido:** coluna ausente apagava o dado do produto (categoria, código).
    - Testado com o cadastro real (12 verificações, `import-test.js` no scratchpad). Falta a planilha do Saipos (t109).
  - **Manual (t403):** as `HELP_SHEETS` de caixa, garçom, falhas e treino agora falam de ficha na cozinha × retirada no caixa, comprovante só se pedir e NFC-e (aviso, cancelamento em 30 min, sem internet).
  - **Garçom × sem preparo:** `resolvePrinterFor('nenhuma')` cai na impressora do bar quando não há impressora de "nenhuma". No caixa continua no caixa. `estacaoLabel('nenhuma')` = "Sem preparo". Testado com 12 cenários de roteamento.
- **CSC (15/10):** o contador mandou um CSC (ID `000003`), salvo em `.claude/tmp/csc.txt` (fora do git; linha "TOKEN" = IdCSC, linha "CSC" = código). Também saiu a "autorização de uso de sistema" na Receita PR.
  - **Onde fica na Brasil NFe:** no cadastro da empresa, campos "Identificação CSC" e "Código CSC", um par para homologação e outro para produção (na API: `Configuracao.NFCe.IdCSCHomologacao`/`CSCHomologacao` em `services/empresa/EditarEmpresa`). O caminho "Configurações › Geral › NFC-e" anotado antes estava errado. Não editar pela API: o `BuscarEmpresa` sem o `UserToken` (token pessoal, não salvo) devolve o cadastro vazio, e não se sabe se o `EditarEmpresa` troca o cadastro inteiro.
  - O Fabricio cadastrou o CSC nos campos de **homologação**. Teste direto na Brasil NFe (payload da função, Heineken lata + Cheese Burguer, R$ 33): a SEFAZ-PR recusou com **462 "Codigo Identificador do CSC no QR-Code nao cadastrado na SEFAZ"**. O QR saiu com o ID 3, ou seja, a Brasil NFe usa o CSC certo, mas a homologação da SEFAZ não conhece esse ID.
  - **Resposta do escritório (15/10): o CSC 3 é de produção.** Por isso o 462 na homologação; esperar não resolve. O suporte da Brasil NFe tinha sugerido tentar de novo em 30 min, mas o reteste foi cancelado depois dessa resposta.
  - **A fazer:** (1) no painel, passar o CSC 3 para os campos de **produção** e apagar os de homologação (não emite nada: o Commandah segue travado em homologação); (2) pedir ao escritório o **CSC de homologação** (gerado à parte no portal da Receita PR), cadastrar nos campos de homologação e refazer o teste.
  - **Alternativa, só se não houver CSC de homologação:** testar em produção com nota real e cancelar dentro dos 30 min. Exige a série nova do contador (a 1 é do Saipos), o secret `NFCE_PRODUCAO=liberada` e o ok da dona (CNPJ dela). Não recomendado agora.
  - Os produtos do clube ainda estão com `fiscal = null` no banco (o "Preencher" dos dados fiscais não foi rodado).
- **Próximo:** com o CSC de homologação aceito pela SEFAZ:
  1. Produtos › Opções › Dados fiscais › Preencher;
  2. fechar uma comanda de teste, clicar em "Emitir NFC-e de teste" no detalhe e depois em "Imprimir cupom da NFC-e";
  3. testar "Cancelar NFC-e" dentro dos 30 min e, se quiser, ligar "Emitir sozinha ao fechar" em Configurações › NFC-e.

  Se a SEFAZ recusar por causa do primeiro item em homologação (regra do xProd "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"), ajustar o `payload.ts`.

## Pendências (próximos passos, backlog priorizado pelo scrum-master em 2026-08-31)

**Fase 1 — fundação:** concluída (itens 1-3, ver seção própria acima).

**Fase 2 — RLS por papel + auditoria append-only:** concluída (ver seção própria acima e a ordem de deploy fixa, todas as 5 etapas ✅ em 2026-09-08).

**Fase 2b — RPCs SECURITY DEFINER + fecha buraco de devtools:** concluída (ver seção própria acima, 2026-09-08).

**Fase 3a — pedidos da cozinha em tabela relacional:** concluída (ver seção própria acima, 2026-09-08) — reteste funcional de ponta a ponta ainda pendente.

**Fase 3 — arquitetura de dados:** concluída (conferido no código em 2026-10-17).
6. ~~Migrar `sales`/`cashSession`/`orderCounter` de blob pra tabelas relacionais.~~ — **CONCLUÍDO.** O last-write-wins entre aparelhos foi resolvido sem tirar tudo do blob: `orders` em tabela (Fase 3a), `sales` em tabela (EST-01, 09/10), caixa por `cash_session_open/close` e `cash_movements_apply` (BD-03), insumos por `insumos_apply` (BD-10) e número do pedido por `set_order_counter` (migration `20261008000000`), todos com trava no servidor.
7. ~~Substituir o poll de 6s (compara JSON inteiro de orders+sales) por Realtime.~~ — **Em grande parte resolvido:** desde BD-06/EST-01 o poll busca só as linhas com `updated_at` novo (`OrdersStore.changes`, `SalesStore.changes`). Realtime nos pedidos da cozinha ficou como melhoria opcional; o dono decidiu não fazer agora (17/10).

**Fase 4 — evolução, não bloqueante:**
8. Unificar as 5 implementações de carrinho duplicadas (frontend-senior).
9. LGPD formal — aviso de privacidade, base legal, exclusão de titular (security-specialist + product-manager). **Conferido em 2026-10-02: nada disso existe ainda.** Não há aviso de privacidade nem link pra política no login (`renderLogin`, `index.html:1681`) nem no cadastro de sócio (`openMemberModal`, `:2877`), que guarda nome/CPF/telefone/endereço/coordenadas de 1001 sócios e dependentes. Também não há fluxo de exclusão/anonimização de titular (só "arquivar", que mantém os dados) nem de exportação a pedido do titular. As únicas menções à LGPD são avisos genéricos nas telas de bot de WhatsApp/SMS (`:1940`, `:1985`). **Quem decide (não é código):** o Fabricio, como controlador, com o jurídico/contador do clube — definir a base legal (execução de contrato com o sócio? legítimo interesse?), o texto do aviso, quem é o encarregado (DPO) e o prazo de retenção de sócio arquivado/débito quitado. Só depois disso entra código: exibir o aviso, botão de anonimizar titular (preservando o ledger de débito sem PII) e registro no `audit_log`. Não escrever texto jurídico sem essa decisão.
10. NFC-e via Edge Function nova, só se o contador confirmar obrigatoriedade (backend-senior + fiscal-tributario).
11. Avaliar PWA/offline pro "app do garçom" (que hoje é só o navegador responsivo, sem app nativo) — só depois que o item 3 da Fase 0 provou que o `save()` online nem finge sucesso hoje (mobile-senior).
12. Fidelidade/pontos (`points`/`pointsHistory`) ficou de fora da Fase 1 de propósito — migrada como coluna simples na tabela `members`, sem virar tabela relacional própria. Se quiser isso relacional também (com ledger de auditoria igual ao de débito), é uma fase separada.
13. ~~Monitor de Cozinha sem filtro por estação~~ — **CONCLUÍDO, já implementado no commit `7b1bec9` (2026-09-12)** junto do redesign visual do card, que originalmente foi documentado só como mudança de layout (ver seção "Redesign do card do Monitor de Cozinha" acima). `kitchenStationFilter`/`setKitchenStationFilter()`/`itemStation()` filtram os itens exibidos por estação, com botões "Todas" + um por estação quando há mais de uma cadastrada. Achado pela auditoria de 2026-09-12 (ver seção própria abaixo) comparando HANDOFF x código real. **Resta só**: não há deep-link por URL pra abrir direto "Monitor só da Cozinha"/"Monitor só do Bar" — o filtro é por clique + `localStorage` por aparelho, então montar monitores físicos dedicados por praça exige configurar cada dispositivo manualmente. **Atualização 2026-09-25:** o Modo TV agora trava a estação por aparelho (ver "Monitor travado por estação em Modo TV"), o que resolve o caso de uso real (uma TV por área). Deep-link por URL continua não existindo, mas deixou de ser necessário.
14. ~~Campo "Qtd. Pessoas" (`gcPeople`) do app do garçom, gravado em `sale.peopleCount` e nunca lido.~~ — **CONCLUÍDO em 2026-10-09** (PROD-03, commit `6aa223e`): o campo saiu.
15. ~~Código morto da grade fixa de mesas numeradas (`tableNumber`, `state.settings.tableCount`) e o campo "Quantidade de mesas" (`cfgTables`) nas Configurações.~~ — **CONCLUÍDO em 2026-10-09** (PROD-03, commit `6aa223e`): o campo saiu das Configurações (o valor salvo é preservado) e só sobrou uma `renderComandas`/`openNewComandaModal` (`assets/js/vendas/localizar-produto.js`). Comanda nova ainda grava `tableNumber:null`; é inofensivo e não vale mexer por causa das vendas antigas. O local da comanda continua sendo o "Mesa / Local" (`s.local`, `saveComandaLocal`), decisão do Fabricio.
16. ~~Matriz de Permissões (`openPermissionMatrix`, `index.html:2736`) não lista o módulo `quemlevou` no grupo "Áreas e dispositivos" — se alguém salvar uma customização de permissões do perfil `caixa` por essa tela, o acesso a "Quem Levou" some silenciosamente (default de `ROLE_PERMS.caixa` já libera, mas customização salva sobrescreve o array inteiro, não faz merge). Achado em 2026-09-21 (ver seção "'Quem levou' vira dropdown com cadastro de pessoas" acima). Corrigir adicionando `['Quem levou','quemlevou']` na lista de módulos (frontend-senior, mudança pequena).~~ — **CONCLUÍDO em 2026-09-25** (ver seção "Correções rápidas da auditoria").
17. ~~Menu "Módulos (Recursos Premium)" com Connect / Emissão Fiscal / TEF, que só gravavam configuração (inclusive campos de senha) em `state.settings.appModules`.~~ — **CONCLUÍDO em 2026-10-09** (PROD-02, commit `c9a8a65`): esses e mais 11 módulos sem integração ficam fora do menu pela lista `HIDDEN_MODULES` (`assets/js/core/config.js`); `appModules` sai de settings na carga e não é mais gravado. A NFC-e real é a do t207 (Configurações › NFC-e).

## Preferências de trabalho do usuário (Fabricio)

- Prefere mudança segura e escopada a mudança arriscada de uma vez só — já reforçou positivamente quando eu recusei fazer algo arriscado (ex. fundir telas de Totem/Cardápio, renomear `--amber` globalmente) e escolhi a correção mais pontual.
- Quer ser consultado antes de ações consequentes/irreversíveis: credenciais, `git push`, mudança de schema, qualquer operação destrutiva.
- Como minha conexão com o Supabase é read-only, ele roda o SQL que eu preparo e confirma ("rodei o sql, testa de novo") — esse ciclo é normal e esperado.
- Testa tudo no mundo real (impressora física, fotos de recibo impresso) e dá feedback visual iterativo — leva a sério a aparência do ticket impresso.
- Prefere que eu explique quando desvio da sugestão literal de um relatório de auditoria por uma correção mais segura, em vez de simplesmente aplicar por conta própria.

## Onde achar mais contexto

- Os dois relatórios publicados (links no histórico, `historico/handoff-ate-2026-10-11.md`) têm o detalhamento completo de cada achado e correção.
- A pasta `.claude/agents/` (gitignorada) tem o time de 13 agentes do Commandah — fonte real de convenções pra esse time (ver seção "Time de agentes" no histórico). O resto de `.claude/` (skills, `dev-learning/`, etc.) ainda é o **vault pessoal de outro projeto** (MRNT/Together) misturado aqui por engano — só os arquivos de agente do Commandah devem ser tratados como deste projeto.

## Histórico

As seções de 11/10 para trás estão em [`historico/handoff-ate-2026-10-11.md`](historico/handoff-ate-2026-10-11.md).
