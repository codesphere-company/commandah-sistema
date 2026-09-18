# Graph Report - commandah-sistema  (2026-09-12)

## Corpus Check
- 11 files · ~61,306 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 37 nodes · 34 edges · 5 communities (4 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f1f4964d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Estado atual (o que já está pronto)
- Handoff — Commandah
- index.ts
- CLAUDE.md
- supabase

## God Nodes (most connected - your core abstractions)
1. `Estado atual (o que já está pronto)` - 17 edges
2. `Handoff — Commandah` - 7 edges
3. `supabase` - 4 edges
4. `corsHeaders()` - 2 edges
5. `json()` - 2 edges
6. `github` - 1 edges
7. `npx` - 1 edges
8. `@supabase/mcp-server-supabase` - 1 edges
9. `SUPABASE_ACCESS_TOKEN` - 1 edges
10. `admin` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (5 total, 1 thin omitted)

### Community 0 - "Estado atual (o que já está pronto)"
Cohesion: 0.12
Nodes (17): Arquitetura, Auditoria de código vs. HANDOFF (2026-09-12), Cloudflare Turnstile no login/cadastro de estabelecimento (2026-09-10), Correção pontual — card de comanda não atualizava após "Novo Pedido" (2026-09-08), Estado atual (o que já está pronto), Fase 0 — bloqueante/risco ativo, CONCLUÍDA em 2026-08-31 (itens 1-4; item 5 é ação humana, não código), Fase 1 — fundação, CONCLUÍDA em 2026-08-31 (itens 1-3), Fase 1 — Sócios em tabela relacional + limite de crédito real (2026-08-30/31, concluída) (+9 more)

### Community 1 - "Handoff — Commandah"
Cohesion: 0.29
Nodes (6): Handoff — Commandah, Limitação importante da minha conexão, O que é o projeto, Onde achar mais contexto, Pendências (próximos passos, backlog priorizado pelo scrum-master em 2026-08-31), Preferências de trabalho do usuário (Fabricio)

### Community 2 - "index.ts"
Cohesion: 0.50
Nodes (3): admin, corsHeaders(), json()

### Community 4 - "supabase"
Cohesion: 0.33
Nodes (5): SUPABASE_ACCESS_TOKEN, npx, github, supabase, @supabase/mcp-server-supabase

## Knowledge Gaps
- **27 isolated node(s):** `github`, `npx`, `@supabase/mcp-server-supabase`, `SUPABASE_ACCESS_TOKEN`, `admin` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 30 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Estado atual (o que já está pronto)` connect `Estado atual (o que já está pronto)` to `Handoff — Commandah`?**
  _High betweenness centrality (0.368) - this node is a cross-community bridge._
- **Why does `Handoff — Commandah` connect `Handoff — Commandah` to `Estado atual (o que já está pronto)`?**
  _High betweenness centrality (0.186) - this node is a cross-community bridge._
- **What connects `github`, `npx`, `@supabase/mcp-server-supabase` to the rest of the system?**
  _27 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Estado atual (o que já está pronto)` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._