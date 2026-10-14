# Commandah — guia rápido

Comanda/PDV de bares e lanchonetes, em produção. Estado atual e decisões: `docs/HANDOFF.md`. Arquitetura: `docs/ARQUITETURA.md`.

## Stack
- Front: HTML/CSS/JS puro, **sem build, sem npm**. Bibliotecas por CDN com versão fixa + SRI: supabase-js, qrcodejs, xlsx, Turnstile.
- Back: Supabase (Postgres + RLS + RPCs + Edge Functions em Deno/TS). Agente de impressão em C# (Windows).
- Deploy: **GitHub Pages direto da `main`** (merge = produção na hora). Prévia de PR no Netlify (usa o banco de produção).

## Comandos
- Rodar local: `npx serve .` ou `python -m http.server` na raiz e abrir `http://localhost:<porta>/` (login real precisa do domínio publicado por causa do Turnstile).
- Checar (o mesmo que o CI faz): `node scripts/check-app.js` e `node scripts/check-load-order.js` (precisa de `npm i --no-save acorn@8.14.0 acorn-walk@8.3.4`).
- Depois de mudar qualquer arquivo de `assets/js` ou `assets/css`: `node scripts/bump-version.js` (troca o `?v=`; o CI recusa o PR sem isso).
- Não há testes automáticos nem lint. Mudança de tela: conferir no Chrome (captura) e na prévia do Netlify antes do merge.
- Migrations e Edge Functions: ver "Limitação importante" em `docs/HANDOFF.md` (CLI do Supabase desta máquina).

## Mapa das pastas
```
index.html            casca: <head>, HTML base, <link>/<script src> NA ORDEM de carregamento
sw.js                 service worker (cache do app para abrir sem internet; nunca guarda dados)
manifest.webmanifest  PWA
assets/marca/         logos e ícones
assets/css/           tokens → estrutura → componentes → ajustes (a ordem é a cascata)
assets/js/core/       config, dados (load/save, stores, sync), login, navegação, janelas, CRUD, boot
assets/js/cadastros/  insumos, produtos, dados fiscais do produto, associados, usuários
assets/js/vendas/     venda/balcão, pagamento, delivery, comandas, localizar produto, agendamento, fila
assets/js/operacao/   cozinha (KDS), garçom (mobile), caixa, cardápio, totem, painel de senhas
assets/js/fiscal/     NFC-e: configuração, cupom (DANFE), emissão da comanda
assets/js/impressao/  impressoras e impressão automática (agente local)
assets/js/gestao/     relatórios, logs, contas, financeiro/fiado, cupons, alterar em lote
assets/js/sistema/    configurações, backup, ajuda, LGPD, central de módulos
supabase/migrations/  SQL versionado (AAAAMMDDhhmmss_nome.sql)
supabase/functions/   nfce (Brasil NFe), staff-auth (login por PIN)
agente-impressao/     código C# do agente; build.cmd gera o .exe
downloads/            .exe do agente servido pelo site (URL pública: não mover)
scripts/              checagens do app e bump de versão (CI e hooks usam)
docs/                 HANDOFF (estado atual), ARQUITETURA, historico/
.github/workflows/    check do app (exigido na main) e backup do Supabase
```

## Regras dos scripts (importante)
- Todos são **scripts clássicos** (não `type="module"`), síncronos, e compartilham o escopo global. Os `onclick="..."` do HTML gerado chamam funções globais: **não** transformar em módulo.
- A ordem das tags em `index.html` é a ordem de execução. Código que roda no carregamento (fora de função) só pode usar o que já foi declarado em arquivo anterior. `core/travas.js` e `core/boot.js` são sempre os últimos.
- Arquivo novo: criar na pasta da área, acrescentar a tag com o mesmo `?v=` no lugar certo da ordem e rodar as checagens.
- Achar uma função: `grep -rn "function nome" assets/js`. Cada arquivo começa com o marcador `/* ============ SEÇÃO ============ */`.

## Convenções
- Código, comentários, UI e commits em **português**. Nomes de função em camelCase inglês/misto, como já existe (ex.: `renderComandas`, `gcConfirmOrder`).
- Comentários citam o ID da auditoria/tarefa (SEG-12, PROD-17, t207...) com o porquê.
- Ações que gravam venda/pedido passam por `singleFlight` (trava de duplo clique).
- Escape de HTML/atributos com os helpers existentes (`h`, `jsArg`); nunca concatenar dado do usuário cru.
- Endereço externo novo no código = acrescentar na meta CSP do `index.html`.

## Não fazer sem perguntar
- Merge na `main` (publica na hora), aplicar migration em produção, deploy de Edge Function.
- Editar migration já aplicada (crie uma nova). Mexer em `downloads/`, nas chaves do Supabase ou na meta CSP.
- Renomear o workflow/job `syntax-check` (é o check exigido pela proteção da main).

## Não ler (caro e inútil)
`node_modules/`, `downloads/`, `assets/marca/*.png`, `graphify-out/graph.json` (use os comandos do graphify), `.claude/worktrees/`, `supabase/.temp/`, `.local-backups/`, `agente-impressao/dist/`. `docs/historico/` só quando precisar de uma decisão antiga.

## graphify
O mapa do código fica em `graphify-out/` (local, não versionado). Para perguntas sobre o código, rode antes `graphify query "<pergunta>"`; `graphify path "<A>" "<B>"` para relações e `graphify explain "<conceito>"`. Depois de mudar código: `graphify update .`.
