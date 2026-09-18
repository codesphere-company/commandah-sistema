# Graph Report - commandah-sistema  (2026-09-10)

## Corpus Check
- 9 files · ~59,795 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 27 nodes · 25 edges · 4 communities (3 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b15729bb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Estado atual (o que já está pronto)
- Handoff — Commandah
- index.ts
- CLAUDE.md

## God Nodes (most connected - your core abstractions)
1. `Estado atual (o que já está pronto)` - 13 edges
2. `Handoff — Commandah` - 7 edges
3. `corsHeaders()` - 2 edges
4. `json()` - 2 edges
5. `admin` - 1 edges
6. `graphify` - 1 edges
7. `O que é o projeto` - 1 edges
8. `Limitação importante da minha conexão` - 1 edges
9. `Segurança` - 1 edges
10. `Impressão` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (4 total, 1 thin omitted)

### Community 0 - "Estado atual (o que já está pronto)"
Cohesion: 0.15
Nodes (13): Arquitetura, Correção pontual — card de comanda não atualizava após "Novo Pedido" (2026-09-08), Estado atual (o que já está pronto), Fase 0 — bloqueante/risco ativo, CONCLUÍDA em 2026-08-31 (itens 1-4; item 5 é ação humana, não código), Fase 1 — fundação, CONCLUÍDA em 2026-08-31 (itens 1-3), Fase 1 — Sócios em tabela relacional + limite de crédito real (2026-08-30/31, concluída), Fase 2 — RLS por papel + auditoria append-only — CONCLUÍDA em 2026-09-08, Fase 2b — RPCs de venda SECURITY DEFINER + fecha o buraco de devtools — CONCLUÍDA em 2026-09-08 (+5 more)

### Community 1 - "Handoff — Commandah"
Cohesion: 0.29
Nodes (6): Handoff — Commandah, Limitação importante da minha conexão, O que é o projeto, Onde achar mais contexto, Pendências (próximos passos, backlog priorizado pelo scrum-master em 2026-08-31), Preferências de trabalho do usuário (Fabricio)

### Community 2 - "index.ts"
Cohesion: 0.50
Nodes (3): admin, corsHeaders(), json()

## Knowledge Gaps
- **19 isolated node(s):** `admin`, `graphify`, `O que é o projeto`, `Limitação importante da minha conexão`, `Segurança` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 22 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Estado atual (o que já está pronto)` connect `Estado atual (o que já está pronto)` to `Handoff — Commandah`?**
  _High betweenness centrality (0.462) - this node is a cross-community bridge._
- **Why does `Handoff — Commandah` connect `Handoff — Commandah` to `Estado atual (o que já está pronto)`?**
  _High betweenness centrality (0.286) - this node is a cross-community bridge._
- **What connects `admin`, `graphify`, `O que é o projeto` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._