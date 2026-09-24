# Graph Report - commandah-sistema  (2026-09-24)

## Corpus Check
- 12 files · ~69,476 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 55 nodes · 52 edges · 5 communities (4 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `80cb3c0e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Estado atual (o que já está pronto)
- Handoff — Commandah
- index.ts
- CLAUDE.md
- supabase

## God Nodes (most connected - your core abstractions)
1. `Estado atual (o que já está pronto)` - 35 edges
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
Cohesion: 0.06
Nodes (35): Arquitetura, Atalho "Já pedidos nesta comanda" no Novo Pedido (2026-09-20), Auditoria de código vs. HANDOFF (2026-09-12), Auditoria de propostas de funcionalidades (2026-09-12), Auditoria visual/UX — mudanças desde 2026-08-31/09-01 (2026-09-12), Backup Supabase — pg_dump 16 continuava resolvendo no PATH mesmo após instalar a 17 (2026-09-20), Botão de Registrar Pagamento no modal de Consumo bloqueado (2026-09-20), Botão "Pedir novamente" no histórico da comanda (2026-09-20) (+27 more)

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
- **45 isolated node(s):** `github`, `npx`, `@supabase/mcp-server-supabase`, `SUPABASE_ACCESS_TOKEN`, `admin` (+40 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 48 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Estado atual (o que já está pronto)` connect `Estado atual (o que já está pronto)` to `Handoff — Commandah`?**
  _High betweenness centrality (0.558) - this node is a cross-community bridge._
- **Why does `Handoff — Commandah` connect `Handoff — Commandah` to `Estado atual (o que já está pronto)`?**
  _High betweenness centrality (0.157) - this node is a cross-community bridge._
- **What connects `github`, `npx`, `@supabase/mcp-server-supabase` to the rest of the system?**
  _45 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Estado atual (o que já está pronto)` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._