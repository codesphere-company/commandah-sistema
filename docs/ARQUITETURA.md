# Arquitetura do Commandah

## Visão geral
```
Navegador (PC do caixa, celular do garçom, TV da cozinha, totem)
  index.html + assets/css + assets/js   ← GitHub Pages (estático, sem servidor de aplicação)
  sw.js: guarda só o aplicativo para abrir sem internet
      │  supabase-js (chave pública) + sessão do usuário
      ▼
Supabase (projeto ezfoymdesmarpunmixbs)
  Auth (e-mail/senha + Turnstile) · Postgres com RLS por tenant e papel
  RPCs SECURITY DEFINER com trava (vendas, caixa, insumos, impressão)
  Edge Functions: staff-auth (PIN de operador) · nfce (Brasil NFe → SEFAZ)
      │  fila print_jobs (polling)
      ▼
Agente de impressão (C#, PC da rede das impressoras) → ESC/POS na porta 9100 ou driver USB
```

## Fluxo principal dos dados
1. **Boot** (`core/boot.js`): carrega o SDK (com reserva jsdelivr → unpkg), cria o cliente, confere a sessão. Sem servidor, mostra a tela de "sem conexão" e tenta de novo sozinho.
2. **Estabelecimento e login** (`core/estabelecimento.js`, `core/login.js`): o dono entra por e-mail/senha (o tenant vem de `tenant_owners`). Operadores entram por PIN pela Edge Function `staff-auth`, com bloqueio progressivo.
3. **Carga** (`core/dados.js` → `loadAll`): o estado vive em memória no objeto global `state`. A origem é:
   - **tabelas próprias**: `members` (+ dependentes e extrato de fiado), `orders` (cozinha), `sales` (vendas);
   - **blob JSON** em `app_data` por `(tenant_id, chave)`: configurações, produtos, insumos, caixa etc.;
   - as stores (`MembersStore`, `OrdersStore`, `SalesStore`) escondem essa diferença.
4. **Gravação**: vendas, caixa e insumos gravam por RPCs atômicas com controle de versão (`sales_apply`, `close_sale`, `cash_session_*`, `insumos_apply`...). As ações de tela passam por `singleFlight` (`core/travas.js`) contra o duplo clique. Uma falha mostra um aviso persistente (`core/avisos.js`).
5. **Sincronização entre aparelhos**: não há realtime. A cada 6 s, `startApp` busca só o que mudou em `orders` e `sales` e redesenha cozinha, garçom e placar. Outros timers conferem o agente de impressão, a fila travada e a versão nova do site.
6. **Impressão**: o site insere em `print_jobs`; o agente busca os pendentes (`print_agent_fetch_pending`) e imprime. O computador é pareado por código (`print_agent_pair_confirm`), e as impressoras são escolhidas em Configurações › Impressoras. Se o agente estiver no mesmo PC, o site também conversa com ele em `localhost:9123`.
7. **NFC-e**: `fiscal/nfce-comanda.js` chama a Edge Function `nfce` (emitir/consultar/cancelar). O token do emissor fica só no servidor. O resultado vai para `nfce_notas`, e o cupom (DANFE) é montado em `fiscal/nfce-cupom.js`.
8. **Auditoria e erros**: `audit_log` é append-only. Erros do navegador e violações de CSP vão para `client_errors`.

## Integrações externas
| Serviço | Para quê | Onde |
|---|---|---|
| Supabase | banco, auth, RPCs, Edge Functions | todo o app; `supabase/` |
| Brasil NFe | emissão de NFC-e (homologação) | `supabase/functions/nfce` |
| Cloudflare Turnstile | captcha no login/cadastro | `core/estabelecimento.js` |
| jsdelivr / cdnjs / unpkg | supabase-js, qrcodejs, xlsx (versão fixa + SRI) | `index.html`, `core/boot.js` |
| Google Fonts | fonte Inter | `index.html` |
| GitHub Actions | check do app em PR; backup diário do Supabase | `.github/workflows/` |

## Decisões de arquitetura
- **Sem build nem framework.** Publicar é só copiar arquivos. Em troca, não há testes nem tipos: as checagens de `scripts/` (sintaxe, arquivos, ordem de carregamento, `?v=`) são a rede de segurança.
- **Scripts clássicos em ordem, escopo global** (14/10). O antigo `index.html` de 10 mil linhas foi cortado nos marcadores de seção, sem mudar lógica. Módulos ES exigiriam reescrever centenas de `onclick` inline.
- **Versão por `?v=`** em todas as tags locais: cada versão é uma URL nova, então o cache do Pages (10 min) e o do service worker nunca misturam HTML novo com JS velho.
- **RLS é a única barreira real.** A chave do navegador é pública; tudo que é sensível passa por RPC `SECURITY DEFINER` ou Edge Function (que guardam `service_role` e tokens).
- **Migração gradual do blob para tabelas**: sócios, pedidos e vendas já saíram; caixa e insumos ficam no blob, com gravação por função com trava.
- **Multi-tenant por `tenant_id`** em todas as tabelas, resolvido no servidor por `current_tenant_id()`.
- **Ordem de deploy**: migration/RPC nova vai para produção **antes** do JS que a usa, porque o merge publica na hora.
