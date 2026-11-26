# Handoff — Commandah

> Leia este arquivo no início de qualquer conversa nova sobre o projeto. Ele é curto de propósito: só o estado de agora e o que falta.
> O texto completo de cada sessão até 25/11/2026 está em [`historico/handoff-ate-2026-11-25.md`](historico/handoff-ate-2026-11-25.md); de 11/10 para trás, em [`historico/handoff-ate-2026-10-11.md`](historico/handoff-ate-2026-10-11.md). Procure lá pela data ("21/11, noite") ou pelo número do PR.

Última atualização: **2026-11-25, fim da noite** (WhatsApp etapa 3 publicada, #356: mandar a conta com Pix copia e cola e QR; cobrança do fiado pelo WhatsApp do Commandah, #360; botões do aviso de mensagem, #358; administrador escolhe o caixa na tela do Caixa, #353; github.io desvia para commandah.com.br, #354; publicação automática ligada, #351). Antes: **2026-11-25, noite** (padrão visual: lotes 11, 12a e 12b publicados, 12c sem PR; WhatsApp etapa 2, #348; domínio próprio; Supabase Pro; HANDOFF comprimido).

## O que é

Comanda/PDV de bares e lanchonetes. Primeiro cliente: a lanchonete do **Clube Olímpico** (Maringá), empresa **A&V Rosa Foods Ltda** (CNPJ 55.147.384/0001-61, Simples Nacional), da irmã do Fabricio. O clube ainda opera no **Saipos**; a virada para o Commandah está marcada para **terça, 05/01/2027** (piloto de 14 a 20/12 com o Saipos junto). O dono quer vender o Commandah para outros estabelecimentos.

- **Front:** HTML/CSS/JS puro, sem build (`CLAUDE.md`, `docs/ARQUITETURA.md`).
- **Endereço oficial:** **https://commandah.com.br** (e `www`), Cloudflare Workers com arquivos estáticos (projeto `commandah-sistema`, conta Cloudflare do Fabricio). O antigo `https://codesphere-company.github.io/commandah-sistema/` desvia para commandah.com.br (#354, script no `<head>` do `index.html`); o GitHub Pages fica no ar só pelos arquivos de `downloads/`, porque o agente de impressão instalado busca a atualização lá. Domínio no Registro.br (conta do dono, ~R$ 40/ano), DNS no Cloudflare.
- **Back:** Supabase `ezfoymdesmarpunmixbs`, **plano Pro (US$ 25/mês desde 25/11)** — o grátis estourou o egress (9,5 de 5 GB) por causa das consultas periódicas dos aparelhos. RLS é a barreira de segurança; Edge Functions `nfce`, `staff-auth`, `cadastro`, `whatsapp`.
- **Tenant do clube:** `clube-olimpico-maringa-y8mt` (plano `isento`, que vale como Pro).
- **Impressão:** agente C# (`agente-impressao/`), versão 2.4 com atualização assinada.
- **WhatsApp:** Evolution API 2.3.8 num VPS Hostinger (KVM 1, Campinas, IP 189.24.15.163, R$ 871,05 em 10x), em `https://whats.commandah.com.br` (o DuckDNS antigo `commandah-whats.duckdns.org` ainda responde junto).

## Como o Claude trabalha aqui

- **Banco:** leitura livre (`npx supabase db query --remote --read-only ...`). Escrita, `migration repair`, deploy de função e secrets **só com o "sim" do dono no chat**, com `--yes`. Migration: `npx supabase db query --linked --yes -f <arquivo> < /dev/null` e depois `npx supabase migration repair --yes --status applied <versão> --linked`. Deploy: `npx supabase functions deploy <nome> --project-ref ezfoymdesmarpunmixbs --use-api --yes` (`whatsapp` com `--no-verify-jwt`).
- **Merge na `main`:** o Claude mergeia pela conta `codesphere-company`, depois de perguntar. O check exigido é `syntax-check` (`node scripts/check-app.js` e `check-load-order.js`; `node scripts/bump-version.js` a cada mudança em `assets/`).
- **Publicar em commandah.com.br:** automático a cada push na `main` (`.github/workflows/publicar-cloudflare.yml` + `wrangler.jsonc`, secret `CLOUDFLARE_API_TOKEN`). Na mão, mesmo resultado: `git archive origin/main | tar -x -C _site` na raiz e `npx wrangler deploy` (login do wrangler na conta Cloudflare do Fabricio).
- **VPS:** chave SSH própria do Claude `~/.ssh/commandah_vps`. Nunca pedir a senha do root nem colar chaves no chat. Instalação e manutenção em `infra/evolution/README.md`.
- **Bancada de testes:** `../auditoria-2026-11-03` (Playwright + `fakesupa` + Postgres local; `bash db/up.sh`). Outras sessões usam a mesma bancada (porta 54400, Postgres 54329): para rodar em paralelo, `BENCH_PG_PORT=54339 BENCH_PG_DATA=<pasta> FAKE_PORT=54500`. Login por PIN na bancada com `FAKE_STAFF_AUTH=1`.
- **Fluxo:** brainstorming → spec (`docs/superpowers/specs/`) → plano (`docs/superpowers/plans/`) → execução com teste que falha primeiro → revisão final por outro agente → publicação com o "sim". Novidade em `assets/js/sistema/novidades.js` a cada publicação.

## Estado atual por área

**Vendas e operação** — comandas, Ficha (balcão), delivery, app do garçom, cozinha (KDS, Modo TV por estação, horário da cozinha), venda por peso, tamanhos e grupos de opções, produtos em falta, avulso, parcial, crédito do sócio, serviço, fiado com bloqueio do sócio (libera pagando ou com senha de admin). Formas de pagamento configuráveis (#264), Pix estático (#265).

**Caixa** — caixa por operador (#288) e cofre (#308), **ligados no clube** (troco R$ 250 no cx1 e cx2). A marca "este computador é o Caixa X" é por navegador (`localStorage`) e sumiu na troca para commandah.com.br: num computador sem marca, o **administrador escolhe o caixa ali mesmo na tela do Caixa** (#353, t77); os outros perfis veem o aviso para chamar um administrador. No primeiro turno, lançar "Cofre → Caixa X, R$ 250" antes de abrir. Conferência da venda no servidor (#290) com a recusa **desligada** (`conferenciaBarrar=false`) até ter uso real sem alarme falso. Etapa 3 do caixa (Caixa Campo, relatórios por caixa, esperado calculado no servidor) sem plano.

**NFC-e** — completa em homologação pela Brasil NFe (emissor por estabelecimento #270, série 3, `cProd` = Código PDV e itens agrupados #320, quadro do pedido #322). Clube: `autoEmitir` e `autoImprimir` ligados, e ficam ligados em produção (decisão do dono, 21/11). Série 3 cadastrada em produção na Brasil NFe. Fiscal fechado com o contador em 24/11 (CSOSN 102, CEST só com ST, PIS/COFINS CST 49). **Falta:** notas de teste com "Pix" e "Pix CNPJ" → "sim" → `nfce_liberar_producao` → secret `NFCE_PRODUCAO=liberada`; NCM do Jacobinho e do Kapo (nota de compra).

**Clientes e LGPD** — cota no topo, ordenar e pesquisa (#329, #331); LGPD dos sócios completa (#298, #303): garçom lê só o necessário, anonimizar, expurgo diário que só age se o estabelecimento ligar o automático (nenhum ligado).

**Segurança** — item 7 (#306): SheetJS local, anti-moldura, CORS das funções só para o site oficial + secret `ALLOWED_ORIGINS` (hoje `https://commandah.com.br,https://www.commandah.com.br,https://commandah-sistema.fabricio-villas-boas-rosa.workers.dev`), supabase-js fixo. Dono com 2 etapas (TOTP) habilitado (#285, conferido 24/11). Cadastro de estabelecimento só por convite (#272). PIN óbvio barrado (#274). Turnstile com os hostnames novos.

**Relatórios** — recebido de verdade, filtros, ranking por quem atendeu, DRE (#314, #315, #317); central de Relatórios (#337).

**Impressão** — agente 2.4.0 no Caixa1, Caixa 2 e Pc Fabricio; **Cozinha ainda na 2.3.0**. Depois de reinstalar um agente, conferir o `deviceAgentId` da regra "imprimir tudo". Bematech da cozinha talvez precise ir para ESC/POS. Chave de assinatura em `%USERPROFILE%\.commandah\agente-chave-privada.xml` (guardar cópia num pendrive). **O agente só aceita a origem do github.io na impressão local de reserva** (`LocalServer.cs`, `Config.cs`): precisa de versão nova que aceite `commandah.com.br` (a impressão pela nuvem não é afetada).

**Visual** — central de Configurações (#334). Padrão visual (guia: https://claude.ai/artifact/G6jYTNHuJHguVMSHccxaiH): lotes 1 a 12b publicados (#335–#345, #347, #349 Caixa e Pagamento, #352 e #355 estilo inline virando classe em Tamanhos, Impressoras, Clientes e Relatórios).
- **Telas no padrão do app do garçom (26/11, maquetes aprovadas: https://claude.ai/artifact/WovNp5H6zyZyfb89QsMxmL):** início com a situação no topo (`.hub-status`) e uma escolha por ação (`.cc-lista`/`.cc-item`, os da central); tocar entra na ação com a barra `.hub-trilha` ("‹ Voltar" + título). Um PR por tela, nesta ordem:
  1. **Cofre** — feito neste PR (`cofreSecao`/`cofreAbrir` em `operacao/cofre.js`; caixa em botões grandes; volta ao início depois de agir, menos em A recolher). Bancada: `t79-cofre-central.js` (19/19) e `t62-cofre.js` adaptado.
  2. **Apps** — falta: a área vira central (`central:true` em `RIBBON_TABS`, com `desc` em cada item), como Configurações e Relatórios.
  3. **Ficha + Novo pedido da comanda** — falta: um seletor de produtos só para os dois, que abre **sempre nas categorias** em blocos (decisão do dono: opção A, igual ao garçom); tocar entra nos produtos com "‹ Categorias"; a busca procura em tudo; o cartão perde a linha repetida da categoria. Mexe em tela de venda: fora de dia de jogo; bancada t11, t12, t13, t18.
  4. **Caixa** — falta: situação no topo (esperado na gaveta, saldo inicial, vendido; só admin) e escolhas Fechar/passar, Novo lançamento, Movimentação, Resumo por forma, Fechamentos anteriores, Imprimir; Caixa fechado vira cartão com o campo grande. Bancada t15, t21, t55, t77.
  - Prints de antes: `../auditoria-2026-11-03/shots/antes-design-26-11` (`e2e/cap-antes-design.js`).
- **Lote 12c** (`comandas.js` e `pagamento.js`, inline → classes `cmd-*`/`pag-*`): pronto no branch `design/lote-12c-inline-venda` (worktree `.claude/worktrees/agent-ac79bf7af056cf33b`), **sem PR**. A classe nova `cmd-qtd` colidia com uma que já existia e virou `cmd-qtd-num`. Falta rodar de novo a checagem de estilo calculado; a última rodada foi parada por falta de memória no PC. Ficam inline os `display:none` que o JS troca, a barra de progresso do pagamento, o `${style}` das opções e a margem da janela de impressão.
- **Checagem dos lotes 12:** `estilo-igual.js` compara o `getComputedStyle` e a posição de cada elemento entre duas cópias do app, em claro e escuro, nos cenários `cen-*.js` (Tamanhos, Impressoras e Clientes, Relatórios, Venda). Os arquivos estão na bancada, em `e2e/estilo-igual/` (uso: `FAKE_STAFF_AUTH=1 node e2e/estilo-igual/estilo-igual.js <cópia-antes> <cópia-depois> e2e/estilo-igual/cen-venda.js`; a cópia sai de `git archive <ref> assets index.html`). Antes de mexer, conferir se o nome da classe nova já existe (`git grep`).
- **Falta o lote 13:** limpeza das camadas de CSS. Apagar os `border-radius:0` mortos e as definições repetidas (`.op-titlebar`, `.qty-ctrl`, `.modal`) e reduzir os 575 `!important`. Risco médio, porque um erro na cascata aparece em telas longe da mudança; conferir com a mesma checagem nas 98 telas do `t14-ux-capturas.js`.
- **Testes:** t13 "PIN errado", t18 "Novo Pedido confirma", t11 (janela de Novidades na frente) e as falhas de t2/t54/t55 (servidor falso) acontecem igual no main; investigar à parte.

**WhatsApp (plano Pro)** — desenho `docs/superpowers/specs/2026-11-25-whatsapp-design.md`; telas aprovadas https://claude.ai/artifact/HnigvmnkXEXP9Wf5DEAta2.
- **Etapa 1 (#332):** Configurações › WhatsApp conecta o número pelo QR (só admin; caixa vê a situação).
- **Etapa 2 (#348, publicada 25/11):** menu lateral › WhatsApp com as conversas; aviso em qualquer tela (toast com Responder, som, contador) a cada 10 s, buscando só as não lidas; responder em texto, respostas prontas (chave Pix, horário da cozinha), Ver foto / Abrir PDF, vincular ao cliente (cota, comanda aberta, saldo), tela de celular. Banco: `whatsapp_conversas`/`whatsapp_mensagens` (migration `20261126000000`, limpeza de 90 dias no pg_cron). VPS com `DATABASE_SAVE_DATA_NEW_MESSAGE=true` (limpar mensagens antigas da Evolution uma vez por mês: comando no README). Responder pelo Commandah ou pelo celular da lanchonete zera as não lidas.
- **Etapa 3 (#356, publicada 25/11):** "Mandar conta pelo WhatsApp" na comanda aberta de cliente (nunca colaborador): manda em ordem o texto com os itens e o total (`gcComandaTotals`), o Pix copia e cola sozinho, o QR (PNG) e o pedido do comprovante, pela ação `enviar_conta` da função. Comanda fica "Conta enviada · aguardando Pix" (`sale.contaEnviada`) ou "valor mudou" se mudar depois. Tela WhatsApp: "Mandar conta com Pix" no painel do cliente e filtro "Conta enviada". Pix estático: `core/pix-brcode.js` (BR Code com CRC16, conferido contra o exemplo do Banco Central) com **chave, nome e cidade em Configurações › Sistema › Ajustes do Cupom** (sem os três, vai só o texto). Telefone sem +55 vira chave de telefone, não CPF.
- **Fiado pelo WhatsApp do Commandah (#360):** "Enviar cobrança via WhatsApp" (fechamento no fiado e "Cobrar via WhatsApp" de sócio bloqueado) abre a mesma janela e manda por dentro do sistema, com a hora do fechamento, o consumo de hoje, o total em aberto e o Pix/QR da pendência. Colaborador, sem permissão ou plano básico: o link `wa.me` de sempre (`openWhatsAppCollectionLink`).
- **Aviso de mensagem (#358):** os botões Responder e Depois não respondiam ao clique (o `#toastRoot` ignora cliques; o `.wa-toast` ganhou a exceção). Teste com clique de mouse de verdade.
- **Bancada:** t68–t78 e `e2e/fake-evolution.js` (envio de texto, mídia, `falharMidia`, `lento`).
- **Falta:** conectar o número separado no clube; conferir no uso real o envio para contato `@lid` e contato que aparece duplicado (`@lid` e `@s.whatsapp.net`).
- **Minors adiados (etapa 3):** falha do banco depois do envio perde a contagem parcial; QR que falha ao gerar some calado (o texto ainda diz "leia o QR"); janela antiga pode trocar a prévia; itens ainda não enviados à cozinha ficam fora da conta; conta muito longa dá erro pouco claro; o servidor não confere o valor da legenda com o do Pix.
- **Minors adiados (etapas 1 e 2):** permissão `whatsapp` por colaborador não conferida no servidor; garçom com caixa recebe 401; reaproveitar instância não refaz o webhook; mensagem atrasada só soma no contador (sem toast); situação do plano em cache por login; eco do webhook antes da gravação perde o nome de quem enviou; ligação automática ao cliente sem índice; PDF grande gasta tráfego.

## Pendências (em ordem)

1. **WhatsApp no clube:** conectar o número separado (Configurações › WhatsApp) e preencher chave, nome e cidade do Pix (Ajustes do Cupom). Conferir no uso real o envio para contato `@lid` e o 9º dígito de número antigo.
2. **WhatsApp etapa 4:** no fiado, a conta vai **sozinha** ao fechar (hoje é pelo botão), aviso de "cota liberada" quando o pagamento zera a pendência, e lista de "Não enviadas" com Reenviar (sem telefone, desconectado, erro). O fiado nunca trava por causa do WhatsApp.
3. **Agente de impressão novo** que aceite a origem `commandah.com.br` na impressão local de reserva (`LocalServer.cs`, `Config.cs`); depois disso o GitHub Pages pode sair de vez (mover `downloads/` junto com o endereço de atualização).
4. **Clube, 28/11** (roteiro de 25 passos: https://claude.ai/artifact/DWwoRpDkE1zuUaZLPieM3C): recarregar aparelhos (Ctrl+Shift+R em commandah.com.br), marcar Caixa 1/2 em cada computador, agente 2.4.0 na Cozinha, Bematech, cupom no papel, caixa por operador com cofre, notas de teste com Pix e Pix CNPJ, PIN dos garçons, nota de compra do Jacobinho e do Kapo. Escolhas por aparelho (modo escuro, estação do Modo TV, ordem das comandas) precisam ser refeitas no endereço novo.
5. **Rumo à virada (05/01/2027):** primeira nota real e velocidade do login até 05/12; ensaio 2 e LGPD até 10/12; treino até 12/12; piloto 14–20/12; painel do lançamento: https://claude.ai/artifact/9ZiwkEfqYUeNnPd1T9y3Vm.
6. **Reduzir o tráfego do Supabase** (consultas de 6 s/30 s em todos os aparelhos): medir quais pesam e cortar, quando o dono pedir.
7. Visual: lote 12c (sem PR) e lote 13. Bancada: `t13`, `t18`, `t67` (lupa ⌕ virou SVG) e as falhas de `t2`/`t54`/`t55` acontecem igual na `main`; `t33-novidades` desatualizado.

## Preferências do dono (Fabricio)

- Responder em português do Brasil, com passo a passo quando ele precisa fazer algo em painel externo.
- Mudança segura e escopada; explicar quando o Claude desvia da sugestão literal por uma correção mais segura.
- Perguntar antes de qualquer coisa consequente: produção, credenciais, merge, operação destrutiva.
- Testa no mundo real (impressora, papel, celular) e manda prints em `C:\Users\fabri\Pictures\Screenshots`.

## Onde achar mais contexto

- Histórico completo: `docs/historico/`. Specs e planos: `docs/superpowers/`. Arquitetura: `docs/ARQUITETURA.md`.
- `.claude/agents/` (gitignorado) tem o time de agentes do Commandah; o resto de `.claude/` é de outro projeto misturado por engano.
