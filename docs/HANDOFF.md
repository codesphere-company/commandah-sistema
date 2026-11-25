# Handoff — Commandah

> Leia este arquivo no início de qualquer conversa nova sobre o projeto. Ele é curto de propósito: só o estado de agora e o que falta.
> O texto completo de cada sessão até 25/11/2026 está em [`historico/handoff-ate-2026-11-25.md`](historico/handoff-ate-2026-11-25.md); de 11/10 para trás, em [`historico/handoff-ate-2026-10-11.md`](historico/handoff-ate-2026-10-11.md). Procure lá pela data ("21/11, noite") ou pelo número do PR.

Última atualização: **2026-11-25, noite** (padrão visual: lotes 11, 12a e 12b publicados, 12c sem PR; WhatsApp etapa 2 publicada, PR #348; site no domínio próprio `commandah.com.br`; Supabase Pro; HANDOFF comprimido).

## O que é

Comanda/PDV de bares e lanchonetes. Primeiro cliente: a lanchonete do **Clube Olímpico** (Maringá), empresa **A&V Rosa Foods Ltda** (CNPJ 55.147.384/0001-61, Simples Nacional), da irmã do Fabricio. O clube ainda opera no **Saipos**; a virada para o Commandah está marcada para **terça, 05/01/2027** (piloto de 14 a 20/12 com o Saipos junto). O dono quer vender o Commandah para outros estabelecimentos.

- **Front:** HTML/CSS/JS puro, sem build (`CLAUDE.md`, `docs/ARQUITETURA.md`).
- **Endereço oficial:** **https://commandah.com.br** (e `www`), Cloudflare Workers com arquivos estáticos (projeto `commandah-sistema`, conta Cloudflare do Fabricio). O antigo `https://codesphere-company.github.io/commandah-sistema/` ainda publica a `main` (GitHub Pages proíbe uso comercial: sair dele). Domínio no Registro.br (conta do dono, ~R$ 40/ano), DNS no Cloudflare.
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

**Caixa** — caixa por operador (#288) e cofre (#308), **ligados no clube** (troco R$ 250 no cx1 e cx2). No primeiro turno, lançar "Cofre → Caixa X, R$ 250" antes de abrir. Conferência da venda no servidor (#290) com a recusa **desligada** (`conferenciaBarrar=false`) até ter uso real sem alarme falso. Etapa 3 do caixa (Caixa Campo, relatórios por caixa, esperado calculado no servidor) sem plano.

**NFC-e** — completa em homologação pela Brasil NFe (emissor por estabelecimento #270, série 3, `cProd` = Código PDV e itens agrupados #320, quadro do pedido #322). Clube: `autoEmitir` e `autoImprimir` ligados, e ficam ligados em produção (decisão do dono, 21/11). Série 3 cadastrada em produção na Brasil NFe. Fiscal fechado com o contador em 24/11 (CSOSN 102, CEST só com ST, PIS/COFINS CST 49). **Falta:** notas de teste com "Pix" e "Pix CNPJ" → "sim" → `nfce_liberar_producao` → secret `NFCE_PRODUCAO=liberada`; NCM do Jacobinho e do Kapo (nota de compra).

**Clientes e LGPD** — cota no topo, ordenar e pesquisa (#329, #331); LGPD dos sócios completa (#298, #303): garçom lê só o necessário, anonimizar, expurgo diário que só age se o estabelecimento ligar o automático (nenhum ligado).

**Segurança** — item 7 (#306): SheetJS local, anti-moldura, CORS das funções só para o site oficial + secret `ALLOWED_ORIGINS` (hoje `https://commandah.com.br,https://www.commandah.com.br,https://commandah-sistema.fabricio-villas-boas-rosa.workers.dev`), supabase-js fixo. Dono com 2 etapas (TOTP) habilitado (#285, conferido 24/11). Cadastro de estabelecimento só por convite (#272). PIN óbvio barrado (#274). Turnstile com os hostnames novos.

**Relatórios** — recebido de verdade, filtros, ranking por quem atendeu, DRE (#314, #315, #317); central de Relatórios (#337).

**Impressão** — agente 2.4.0 no Caixa1, Caixa 2 e Pc Fabricio; **Cozinha ainda na 2.3.0**. Depois de reinstalar um agente, conferir o `deviceAgentId` da regra "imprimir tudo". Bematech da cozinha talvez precise ir para ESC/POS. Chave de assinatura em `%USERPROFILE%\.commandah\agente-chave-privada.xml` (guardar cópia num pendrive). **O agente só aceita a origem do github.io na impressão local de reserva** (`LocalServer.cs`, `Config.cs`): precisa de versão nova que aceite `commandah.com.br` (a impressão pela nuvem não é afetada).

**Visual** — central de Configurações (#334). Padrão visual (guia: https://claude.ai/artifact/G6jYTNHuJHguVMSHccxaiH): lotes 1 a 12b publicados (#335–#345, #347, #349 Caixa e Pagamento, #352 e #355 estilo inline virando classe em Tamanhos, Impressoras, Clientes e Relatórios).
- **Lote 12c** (`comandas.js` e `pagamento.js`, inline → classes `cmd-*`/`pag-*`): pronto no branch `design/lote-12c-inline-venda` (worktree `.claude/worktrees/agent-ac79bf7af056cf33b`), **sem PR**. A classe nova `cmd-qtd` colidia com uma que já existia e virou `cmd-qtd-num`. Falta rodar de novo a checagem de estilo calculado; a última rodada foi parada por falta de memória no PC. Ficam inline os `display:none` que o JS troca, a barra de progresso do pagamento, o `${style}` das opções e a margem da janela de impressão.
- **Checagem dos lotes 12:** `estilo-igual.js` compara o `getComputedStyle` e a posição de cada elemento entre duas cópias do app, em claro e escuro, nos cenários `cen-*.js` (Tamanhos, Impressoras e Clientes, Relatórios, Venda). Os arquivos estão no scratchpad da sessão 93888a47 e se perdem com limpeza; copiar para a bancada antes de reaproveitar. Antes de mexer, conferir se o nome da classe nova já existe (`git grep`).
- **Falta o lote 13:** limpeza das camadas de CSS. Apagar os `border-radius:0` mortos e as definições repetidas (`.op-titlebar`, `.qty-ctrl`, `.modal`) e reduzir os 575 `!important`. Risco médio, porque um erro na cascata aparece em telas longe da mudança; conferir com a mesma checagem nas 98 telas do `t14-ux-capturas.js`.
- **Testes:** t13 "PIN errado", t18 "Novo Pedido confirma", t11 (janela de Novidades na frente) e as falhas de t2/t54/t55 (servidor falso) acontecem igual no main; investigar à parte.

**WhatsApp (plano Pro)** — desenho `docs/superpowers/specs/2026-11-25-whatsapp-design.md`; telas aprovadas https://claude.ai/artifact/HnigvmnkXEXP9Wf5DEAta2.
- **Etapa 1 (#332):** Configurações › WhatsApp conecta o número pelo QR (só admin; caixa vê a situação).
- **Etapa 2 (#348, publicada 25/11):** menu lateral › WhatsApp com as conversas; aviso em qualquer tela (toast com Responder, som, contador) a cada 10 s, buscando só as não lidas; responder em texto, respostas prontas (chave Pix, horário da cozinha), Ver foto / Abrir PDF, vincular ao cliente (cota, comanda aberta, saldo), tela de celular. Banco: `whatsapp_conversas`/`whatsapp_mensagens` (migration `20261126000000`, limpeza de 90 dias no pg_cron). VPS com `DATABASE_SAVE_DATA_NEW_MESSAGE=true` (limpar mensagens antigas da Evolution uma vez por mês: comando no README). Responder pelo Commandah ou pelo celular da lanchonete zera as não lidas.
- **Bancada:** t68–t73 e `e2e/fake-evolution.js`.
- **Falta:** conectar o número separado no clube; conferir no uso real o envio para contato `@lid` e contato que aparece duplicado (`@lid` e `@s.whatsapp.net`).
- **Minors adiados:** permissão `whatsapp` por colaborador não conferida no servidor; garçom com caixa recebe 401; reaproveitar instância não refaz o webhook; mensagem atrasada só soma no contador (sem toast); situação do plano em cache por login; eco do webhook antes da gravação perde o nome de quem enviou; ligação automática ao cliente sem índice; PDF grande gasta tráfego.

## Pendências (em ordem)

1. **Publicação automática:** workflow pronto; falta o dono criar o token do Cloudflare e gravar o secret `CLOUDFLARE_API_TOKEN` no GitHub.
2. **WhatsApp etapa 3:** gerador de Pix copia e cola (BR Code) + QR e "Mandar conta" da comanda pelo WhatsApp. Depois a **etapa 4:** no fiado, a conta vai sozinha ao fechar (com a hora), aviso de "cota liberada" depois do pagamento e lista de "Não enviadas".
3. **Sair do github.io:** redirecionar para `commandah.com.br` mantendo `downloads/` (o agente baixa de lá) e lançar o agente com a origem nova.
4. **Clube, 28/11** (roteiro de 25 passos: https://claude.ai/artifact/DWwoRpDkE1zuUaZLPieM3C): recarregar aparelhos, agente 2.4.0 na Cozinha, Bematech, cupom no papel, caixa por operador com cofre, notas de teste com Pix e Pix CNPJ, PIN dos garçons, nota de compra do Jacobinho e do Kapo.
5. **Rumo à virada (05/01/2027):** primeira nota real e velocidade do login até 05/12; ensaio 2 e LGPD até 10/12; treino até 12/12; piloto 14–20/12; painel do lançamento: https://claude.ai/artifact/9ZiwkEfqYUeNnPd1T9y3Vm.
6. **Reduzir o tráfego do Supabase** (consultas de 6 s/30 s em todos os aparelhos): medir quais pesam e cortar, quando o dono pedir.
7. Visual: lotes 11 a 13. Bancada: `t13`, `t18` e `t67` (lupa ⌕ virou SVG) falham na `main` desde os lotes visuais; `t33-novidades` desatualizado.

## Preferências do dono (Fabricio)

- Responder em português do Brasil, com passo a passo quando ele precisa fazer algo em painel externo.
- Mudança segura e escopada; explicar quando o Claude desvia da sugestão literal por uma correção mais segura.
- Perguntar antes de qualquer coisa consequente: produção, credenciais, merge, operação destrutiva.
- Testa no mundo real (impressora, papel, celular) e manda prints em `C:\Users\fabri\Pictures\Screenshots`.

## Onde achar mais contexto

- Histórico completo: `docs/historico/`. Specs e planos: `docs/superpowers/`. Arquitetura: `docs/ARQUITETURA.md`.
- `.claude/agents/` (gitignorado) tem o time de agentes do Commandah; o resto de `.claude/` é de outro projeto misturado por engano.
