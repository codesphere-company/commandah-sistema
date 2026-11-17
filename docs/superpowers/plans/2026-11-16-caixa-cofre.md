# Caixa por operador, etapa 2 (cofre) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dinheiro que sai da gaveta (fim da noite e sangria) entra no cofre como "a recolher" na mesma operação do servidor; admin confirma, abastece, conta e lança saídas do cofre numa tela própria.

**Architecture:** tabela `public.cash_cofre` com RLS só-admin e escrita só por RPC `security definer`, no padrão da etapa 1 (`cash_turnos`). O fechamento de fim da noite e a sangria gravam gaveta e cofre na mesma transação (o lançamento da gaveta entra no blob `cantina2:cashMovements` com trava, como `cash_movements_apply`). Front em JS clássico: troco por caixa em Configurações, escolha passagem/fim da noite no fechamento, quatro tipos de lançamento e a tela Cofre.

**Tech Stack:** Postgres (Supabase), plpgsql; HTML/CSS/JS puro sem build; bancada `../auditoria-2026-11-03` (node + pg, Playwright via `e2e/harness.js` e `e2e/fakesupa.js`).

**Spec:** `docs/superpowers/specs/2026-11-16-caixa-cofre-design.md` (e o de 13/11, `2026-11-13-caixa-por-operador-design.md`).

## Global Constraints

- Tudo só vale com `settings.caixaPorOperador === true`; desligado, nenhum comportamento muda.
- Uma migration nova: `supabase/migrations/20261121000000_caixa_cofre.sql`, começando com `set lock_timeout = '5s';`, com bloco ROLLBACK comentado no fim. Não editar migrations aplicadas.
- Funções: `security definer`, `set search_path to ''`, `revoke all ... from public, anon` (e `authenticated` nas internas), `grant execute ... to authenticated` só nas públicas.
- Comparação de dinheiro em centavos via `public.cash_turno_dif(contado, esperado)` (já existe).
- Cofre: só `public.is_admin_like()` lê e lança (servidor). Operador nunca recebe saldo nem extrato.
- Diferença no cofre nunca trava nada.
- Admin pode confirmar recolhimento do próprio fechamento.
- Textos da UI, comentários e commits em português; comentários citam "cofre (16/11)".
- Depois de mexer em `assets/js`/`assets/css`: `node scripts/bump-version.js`; checagens `node scripts/check-app.js` e `node scripts/check-load-order.js`.
- Ao publicar: entrada nova no topo de `NOVIDADES` (`assets/js/sistema/novidades.js`).
- Publicação (fora deste plano, cada passo com "sim" do dono e só depois da etapa 1 testada no clube): migration → merge → recarregar aparelhos.

## Review Focus

1. Aparelho com versão antiga fecha o turno sem `fimDaNoite`: tem de virar passagem (nada vai ao cofre, `ultima_contagem` = contado).
2. `settings.caixas[].troco` ausente, texto, negativo ou caixa fora da lista: troco = 0 (tudo vai ao cofre), sem erro.
3. Duplo clique em Confirmar recolhimento: a segunda chamada devolve `ja_confirmado` e não grava de novo.
4. Abastecer caixa com turno travado: recusa com `travado`; o esperado não muda.
5. Operador/garçom chamando pela API `cash_cofre_ler`, `select` em `cash_cofre`, ou `cash_movements_apply` apagando/editando um lançamento `origin:'cofre'`: recusado.

Cada item tem teste na task dona (marcado "RF").

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261121000000_caixa_cofre.sql` (novo) | tabela, ajudantes, RPCs do cofre, fechamento com cofre, saída do turno, guarda em `cash_movements_apply` |
| `../auditoria-2026-11-03/db/t-cofre.js` (novo, fora do repo) | testes de banco |
| `assets/js/core/caixa-multiaparelho.js` | `listaDeCaixas()` devolve `troco` |
| `assets/js/sistema/configuracoes.js` | campo Troco por caixa |
| `assets/js/operacao/caixa.js` | escolha passagem/fim, aviso de troco/cofre, comprovante, novo lançamento com 4 tipos, bloqueio de edição |
| `assets/js/operacao/cofre.js` (novo) | tela Cofre |
| `assets/js/core/config.js`, `assets/js/core/navegacao.js`, `index.html` | menu, permissão `cofre`, render, tag do script |
| `assets/js/sistema/novidades.js` | entrada nova |
| `../auditoria-2026-11-03/e2e/t62-cofre.js` (novo, fora do repo) | e2e |

---

### Task 1: Tabela e RPCs de administração do cofre

**Files:**
- Create: `supabase/migrations/20261121000000_caixa_cofre.sql`
- Test: `../auditoria-2026-11-03/db/t-cofre.js` (copiar o esqueleto de `db/t-caixa-turnos.js`: `U`, `PREP`, `como()`, `um()`, `erro()`, transação desfeita por caso)

**Interfaces:**
- Consumes: `public.current_tenant_id()`, `public.is_admin_like()`, `public.current_staff_id()`, `public.caixa_por_operador_ligado()`, `public.cash_turno_nome(tenant, staff)`, `public.cash_turno_dif(numeric, numeric)`, tabela `public.cash_turnos(tenant_id, caixa_id, turno jsonb, ultima_contagem numeric)`.
- Produces:
  - tabela `public.cash_cofre(id text pk default gen_random_uuid()::text, tenant_id text not null fk tenant_owners on delete cascade, tipo text check in ('entrada','saida','contagem'), origem text check in ('fim_da_noite','sangria','recolher_fechado','abastecer','outra','contagem'), caixa_id text, turno_id text, valor numeric not null check (valor >= 0), status text check in ('a_recolher','confirmado'), lancado_por text, lancado_por_nome text, lancado_em timestamptz not null default now(), confirmado_por text, confirmado_por_nome text, confirmado_em timestamptz, valor_contado numeric, diferenca numeric, esperado numeric, motivo text)`; índice `(tenant_id, lancado_em desc)`.
  - interna `public.cash_cofre_checar() returns text` (tenant; exceção `'sem permissao para o cofre'` se não admin, `'caixa por operador desligado'` se desligado).
  - interna `public.cash_cofre_entrada(p_tenant text, p_caixa text, p_turno_id text, p_valor numeric, p_origem text, p_staff text) returns text` (id; status `a_recolher`, tipo `entrada`). Usada pelas Tasks 2.
  - `public.cash_cofre_ler() returns jsonb` → `{saldo numeric, ultimaContagem: {valor, em, por} | null, aRecolher: [linha...], extrato: [linha...] (últimas 300, mais nova primeiro)}`; linha = colunas da tabela em camelCase.
  - `public.cash_cofre_confirmar(p_id text, p_contado numeric) returns jsonb` → `{ok, motivo}`; motivos `nao_encontrado`, `ja_confirmado`.
  - `public.cash_cofre_abastecer(p_caixa text, p_valor numeric, p_motivo text) returns jsonb` → `{ok, motivo}`; motivo `travado`.
  - `public.cash_cofre_saida(p_valor numeric, p_motivo text) returns jsonb` → `{ok}`.
  - `public.cash_cofre_contar(p_contado numeric, p_nota text) returns jsonb` → `{ok, esperado, diferenca}`.
  - `public.cash_cofre_recolher_fechado(p_caixa text, p_valor numeric) returns jsonb` → `{ok, motivo}`; motivos `turno_aberto`, `valor_maior`.

- [ ] **Step 1: Escrever os testes que falham** em `db/t-cofre.js`:

```js
caso('operador e garçom não leem o cofre (RF5)', async () => {
  await como('caixa'); assert.match(await erro('select public.cash_cofre_ler()'), /sem permissao para o cofre/);
  await como('garcom'); assert.equal((await um('select count(*)::int n from public.cash_cofre')).n, 0); // RLS
});
caso('saldo = última contagem + entradas confirmadas − saídas depois dela', async () => {
  await como('admin');
  await um(`select public.cash_cofre_contar(1000, null)`);
  const id = (await um(`select public.cash_cofre_entrada('t-a','cx1','tu1',300,'sangria','s-cx') id`)).id; // como postgres
  let r = await ler(); assert.equal(Number(r.saldo), 1000); assert.equal(r.aRecolher.length, 1);
  await um(`select public.cash_cofre_confirmar($1, 290)`, [id]);
  r = await ler(); assert.equal(Number(r.saldo), 1290); assert.equal(Number(r.extrato.find(l=>l.id===id).diferenca), -10);
  await um(`select public.cash_cofre_saida(90,'depósito')`); r = await ler(); assert.equal(Number(r.saldo), 1200);
  const c = (await um(`select public.cash_cofre_contar(1150,null) r`)).r; assert.equal(Number(c.esperado), 1200); assert.equal(Number(c.diferenca), -50);
  r = await ler(); assert.equal(Number(r.saldo), 1150);
});
caso('sem contagem nenhuma o saldo parte de 0 e nada é recusado', async () => { /* entrada + confirmar → saldo = contado */ });
caso('confirmar duas vezes devolve ja_confirmado (RF3)', async () => { /* segunda chamada: {ok:false, motivo:'ja_confirmado'}, 1 linha só */ });
caso('admin confirma o recolhimento do próprio fechamento', async () => { /* entrada com p_staff='s-adm', confirmar como admin → ok */ });
caso('abastecer sem turno soma em ultima_contagem; com turno travado recusa (RF4)', async () => {
  /* cash_turnos cx1 ultima_contagem 200, turno null → abastecer 50 → 250, extrato tipo saida origem abastecer
     turno status 'travado_abertura' → {ok:false, motivo:'travado'}, ultima_contagem inalterada */
});
caso('abastecer com turno aberto põe suprimento origin cofre no turno', async () => {
  /* turno open id tu9 → abastecer 80 → cantina2:cashMovements tem {type:'suprimento', amount:80, method:'dinheiro', cashSessionId:'tu9', origin:'cofre', cofreId:<id>} */
});
caso('saída sem motivo é recusada', async () => { /* motivo '' → exceção 'motivo obrigatorio' */ });
caso('recolher de caixa fechado', async () => {
  /* ultima_contagem 700, turno null → recolher 500 → ultima_contagem 200 e entrada a_recolher origem recolher_fechado
     valor 800 → valor_maior; turno aberto → turno_aberto */
});
caso('outro estabelecimento não vê', async () => { /* ownerB lê: aRecolher vazio */ });
caso('desligado recusa', async () => { /* settings caixaPorOperador false → 'caixa por operador desligado' */ });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ../auditoria-2026-11-03 && REPO=$PWD/../commandah-cofre bash db/up.sh > db/up.log 2>&1 </dev/null; node db/t-cofre.js`
Expected: FALHA em todos (função/tabela não existe).

- [ ] **Step 3: Implementar a migration** (tabela, RLS `select` só `tenant_id = current_tenant_id() and is_admin_like()`, sem policy de escrita, `revoke all on table ... from public, anon, authenticated; grant select ... to authenticated; grant all ... to service_role`; funções acima). Regras:
  - `cash_cofre_ler`: saldo = valor da última `contagem` (0 se nenhuma) + soma de `valor_contado` das `entrada` confirmadas com `confirmado_em` depois dela − soma de `valor` das `saida` com `lancado_em` depois dela.
  - `cash_cofre_confirmar`: `for update` na linha; `diferenca = cash_turno_dif(p_contado, valor)`; grava quem/quando/nome.
  - `cash_cofre_abastecer`: `for update` em `cash_turnos (tenant, p_caixa)` (cria a linha se não existir, como `cash_turno_abrir`); turno `null`/`closed` → `ultima_contagem = coalesce(ultima_contagem,0) + p_valor`; `status = 'open'` → anexa suprimento no topo de `cantina2:cashMovements` com `for update` (formato do caso de teste, `at` = `cash_turno_agora()`, `description` = `'Abastecido pelo cofre'` + motivo); `travado_*` → `travado`.
  - `p_valor <= 0` ou nulo → exceção `'valor invalido'` em todas.
  - `contagem` grava `esperado` (saldo antes) e `diferenca`.

- [ ] **Step 4: Rodar e ver passar** — mesmo comando. Expected: todos `ok`, e `node db/t-caixa-turnos.js` continua verde.

- [ ] **Step 5: Commit** — `git add supabase/migrations/20261121000000_caixa_cofre.sql && git commit -m "feat(cofre): tabela e funções de administração do cofre"` (teste fica na bancada, fora do repo).

---

### Task 2: Fim da noite e saídas do turno no servidor

**Files:**
- Modify: `supabase/migrations/20261121000000_caixa_cofre.sql`
- Test: `../auditoria-2026-11-03/db/t-cofre.js`

**Interfaces:**
- Consumes: Task 1 `cash_cofre_entrada(...)`; etapa 1 `cash_turno_concluir_fechamento(p_tenant, p_caixa, p_turno, p_closed)`, `cash_turno_fechar`, `cash_turno_checar()`, `cash_turno_resp(ok, turno, motivo)`.
- Produces:
  - `create or replace` de `cash_turno_concluir_fechamento(...)` com a mesma assinatura, agora `returns jsonb` → `{troco numeric, paraCofre numeric}` (para mudar o tipo de retorno: `drop function` + `create`, e recriar os três chamadores com `perform` que já existem; ou manter `void` e gravar `troco`/`paraCofre` dentro do `closed` do histórico — escolha do construtor, desde que `cash_turno_fechar` devolva `cofre: {troco, paraCofre}` quando concluir).
  - `cash_turno_fechar` devolve `cash_turno_resp(true, null, null) || jsonb_build_object('cofre', {troco, paraCofre})` quando conclui.
  - `p_closed.fimDaNoite` (boolean). Ausente/false = passagem.
  - helper `public.cash_caixa_troco(p_tenant text, p_caixa text) returns numeric` (lê `cantina2:settings`→`caixas[]`→`troco`; inválido/negativo → 0).
  - `public.cash_turno_saida(p_caixa text, p_turno_id text, p_mov jsonb) returns jsonb` → `{ok, motivo, movements}`; `p_mov = {id, categoria: 'sangria'|'funcionario'|'outro', amount, method, description, pessoa, note, at}`; motivos `turno_mudou`, `nao_aberto`.
  - guarda nova em `cash_movements_apply` (recriada com a mesma assinatura).

- [ ] **Step 1: Testes que falham**

```js
caso('fim da noite: contado 950, troco 200 → 750 a recolher e próxima abertura espera 200', async () => {
  /* settings caixas [{id:'cx1',troco:200}]; abre cx1 (primeira abertura), fecha com {fimDaNoite:true, countedAmount:950, expectedAmount:950}
     → r.cofre = {troco:200, paraCofre:750}; cash_cofre 1 linha entrada a_recolher 750 origem fim_da_noite turno_id = id; ultima_contagem 200 */
});
caso('passagem (fimDaNoite ausente) não vai ao cofre (RF1)', async () => { /* ultima_contagem = 950, cash_cofre vazio */ });
caso('contado menor que o troco: nada vai ao cofre, próxima abertura espera o contado', async () => { /* 150 com troco 200 → paraCofre 0, ultima_contagem 150 */ });
caso('troco inválido vale 0 (RF2)', async () => { /* troco:'abc' / -5 / caixa ausente → paraCofre = contado */ });
caso('fechamento travado só manda ao cofre quando liberado', async () => {
  /* fecha com divergência → cash_cofre vazio; liberar por admin (cash_turno_liberar_admin como service) → entrada com o contado */
});
caso('sangria do operador: gaveta e cofre juntos', async () => {
  /* como caixa, turno aberto tu1: cash_turno_saida('cx1','tu1',{id:'m1',categoria:'sangria',amount:100,method:'dinheiro'})
     → cashMovements m1 {type:'sangria', origin:'cofre', cofreId, cashSessionId:'tu1'}; cash_cofre entrada a_recolher 100 origem sangria */
});
caso('pagamento de funcionário exige pessoa e não vai ao cofre', async () => { /* sem pessoa → exceção 'nome de quem recebeu obrigatorio'; com pessoa → movimento categoria 'funcionario', sem origin, cofre vazio */ });
caso('outro pagamento: só admin (operador recusado)', async () => { /* caixa → exceção 'so administrador'; admin sem description → 'motivo obrigatorio'; admin ok */ });
caso('sangria em pix não vai ao cofre', async () => { /* method 'pix' → movimento sem origin, cofre vazio */ });
caso('cash_movements_apply não mexe em lançamento do cofre (RF5)', async () => {
  /* como caixa: apply deletes ['m1'] → exceção 'lancamento do cofre'; upsert de m1 alterado → mesma exceção;
     como admin: idem. Nova sangria em dinheiro direto pelo apply, com o modo ligado → exceção 'use a saida do turno' */
});
caso('desligado: cash_movements_apply segue como antes', async () => { /* nova sangria dinheiro pelo apply passa */ });
```

- [ ] **Step 2: Rodar e ver falhar** — `node db/t-cofre.js`. Expected: FALHA nos casos novos.

- [ ] **Step 3: Implementar.** Regras:
  - Concluir fechamento: se `p_closed.fimDaNoite = true`: `troco = cash_caixa_troco`, `contado = countedAmount`; se `contado > troco` (em centavos) grava `cash_cofre_entrada(..., contado − troco, 'fim_da_noite', operador do turno)` e `ultima_contagem = troco`; senão `ultima_contagem = contado`, `paraCofre = 0`. Grava `troco`, `paraCofre`, `fimDaNoite` no `closed` do histórico. Sem `fimDaNoite`: igual hoje.
  - `cash_turno_saida`: `cash_turno_checar()`; `for update` no turno; só `status='open'` e mesmo id; operador só no próprio turno (admin em qualquer). `sangria` em dinheiro → movimento `origin:'cofre'` + `cofreId` e `cash_cofre_entrada(...,'sangria', current_staff_id())`; `funcionario` → `categoria:'funcionario'`, `description = 'Pagamento de funcionário: ' || pessoa`; `outro` → só `is_admin_like()`, `categoria:'outro'`. Todos gravam `type:'sangria'`, `operator` = nome, `cashSessionId` = turno, no topo de `cantina2:cashMovements` com `for update`. Devolve a lista nova em `movements`. `amount <= 0` → `'valor invalido'`. `id` repetido → devolve ok sem gravar de novo (idempotente).
  - `cash_movements_apply`: antes de aplicar, com `caixa_por_operador_ligado()`, recusa (`'lancamento do cofre'`) qualquer upsert/delete cujo id esteja na lista atual com `origin = 'cofre'`; recusa (`'use a saida do turno'`) upsert de id novo com `type='sangria'`. Desligado: sem mudança.

- [ ] **Step 4: Rodar e ver passar** — `node db/t-cofre.js && node db/t-caixa-turnos.js && node db/sqltest.js`. Expected: tudo verde.

- [ ] **Step 5: Commit** — `git commit -am "feat(cofre): fim da noite e sangria gravam gaveta e cofre juntos"`.

---

### Task 3: Troco por caixa e fechamento passagem/fim da noite (front)

**Files:**
- Modify: `assets/js/core/caixa-multiaparelho.js:212-216` (`listaDeCaixas`), `assets/js/sistema/configuracoes.js:60,86` (bloco Caixa por operador), `assets/js/operacao/caixa.js:235-260` (`fecharTurnoDoCaixa`), `:346` (`openCloseCashModal`), `:376` (`finalizeCashSession`), `imprimirFechamentoCaixa`
- Test: `../auditoria-2026-11-03/e2e/t62-cofre.js` (esqueleto de `e2e/t55-caixa-por-operador.js`)

**Interfaces:**
- Consumes: Task 2 `p_closed.fimDaNoite`, resposta `cofre: {troco, paraCofre}`.
- Produces: `listaDeCaixas() → [{id, nome, troco:number}]` (troco inválido → 0); `fecharTurnoDoCaixa(closed)` continua devolvendo `'fechado'` e copia `data.cofre.troco`/`data.cofre.paraCofre` para `closed.troco`/`closed.paraCofre` (usados no aviso e no comprovante).

- [ ] **Step 1: e2e que falha** (`t62-cofre.js`, parte 1):
  - Configurações: campo `.cfg-caixa-troco[data-id="cx1"]` existe; salvar 200 grava `state.settings.caixas[0].troco === 200`.
  - Fechamento no modo ligado: modal tem `input[name="cashFechTipo"]` com valores `passagem` e `fim`, nenhum marcado; "Conferir contagem" sem escolha → toast `'Escolha: passar o caixa ou fechar no fim da noite.'`.
  - Fim da noite com 950 contado e troco 200 → modal final com o texto exato `Deixe R$ 200,00 de troco na gaveta e separe R$ 750,00 para o cofre.`; comprovante (espião em `imprimirFechamentoCaixa`) recebe `troco:200, paraCofre:750`.
  - Passagem → sem esse texto; toast `Caixa passado.`.
  - Modo desligado: sem a escolha (fechamento como hoje).

- [ ] **Step 2: Rodar e ver falhar** — `REPO=../commandah-cofre node e2e/t62-cofre.js`. Expected: FALHA.

- [ ] **Step 3: Implementar.** Em Configurações, um `input type=number min=0 step=0.01` "Troco (R$)" ao lado de cada nome, salvo com o nome. No modal de fechamento (só `modoCaixaPorOperador()`), dois rádios acima da contagem: "Passar o caixa (troca de operador)" e "Fechar no fim da noite (o que passar do troco vai para o cofre)". `closed.fimDaNoite = escolha==='fim'`. Depois do `'fechado'` com `fimDaNoite`, abrir modal "Separe o dinheiro do cofre" com o texto acima e botão OK; `imprimirFechamentoCaixa` mostra as linhas "Troco na gaveta" e "Para o cofre".

- [ ] **Step 4: Rodar e ver passar** — `node e2e/t62-cofre.js && node e2e/t55-caixa-por-operador.js && node e2e/t54-caixa-liberacao.js`. Expected: verde.

- [ ] **Step 5: Commit** — `node scripts/bump-version.js && git commit -am "feat(cofre): troco por caixa e fechamento no fim da noite"`.

---

### Task 4: Novo lançamento com quatro tipos (front)

**Files:**
- Modify: `assets/js/operacao/caixa.js:380-420` (`cashMovementEditable`, `openCashMovementModal`, gravação), `assets/js/core/caixa-multiaparelho.js` (nova `lancarSaidaDoTurno`)
- Test: `../auditoria-2026-11-03/e2e/t62-cofre.js` (parte 2)

**Interfaces:**
- Consumes: Task 2 `cash_turno_saida(p_caixa, p_turno_id, p_mov) → {ok, motivo, movements}`.
- Produces: `async function lancarSaidaDoTurno(mov) → boolean` em `caixa-multiaparelho.js`: chama a RPC com `caixaQueVale()` e `state.cashSession.id`; em `ok` faz `state.cashMovements = movements; setCashMovementsBase(movements)`; senão toast e `false`.

- [ ] **Step 1: e2e que falha**:
  - Modo ligado, operador de caixa: rádios `cmType` = `suprimento`, `sangria`, `funcionario`; **sem** `outro`. Rótulos exatos: `Entrada no caixa`, `Sangria (vai para o cofre)`, `Pagamento de funcionário`.
  - Admin: também `outro`, rótulo `Outro pagamento (só administrador)`.
  - Funcionário sem nome → toast `Informe o nome de quem recebeu.`; com nome → RPC chamada com `categoria:'funcionario'`.
  - Outro sem descrição → toast `Informe o motivo do pagamento.`.
  - Sangria em dinheiro → RPC com `categoria:'sangria'`; a linha aparece na Movimentação.
  - Lançamento com `origin:'cofre'`: editar/excluir mostra toast `Lançamento do cofre: não pode ser alterado aqui. Acerte na confirmação do recolhimento.` e não abre o formulário.
  - Modo desligado: rádios como hoje (`suprimento`, `sangria`, `diaria`) e gravação pelo caminho antigo.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar.** No modo ligado, `diaria` some e vira `funcionario` (mesmo campo de nome, rótulo "Nome de quem recebeu *"); toda saída (sangria/funcionario/outro) grava por `lancarSaidaDoTurno` dentro de `singleFlight`, nunca por `save('cashMovements')`. Entrada continua no caminho de hoje. `cashMovementEditable` recusa `origin==='cofre'` com o texto acima. Relatórios/fechamento que separam `categoria==='diaria'` passam a somar também `'funcionario'` na linha "Pagamentos de funcionário" (rótulo trocado só no modo ligado).

- [ ] **Step 4: Rodar e ver passar** — `node e2e/t62-cofre.js && node e2e/t31-diaria-freelancer.js 2>/dev/null; node e2e/t55-caixa-por-operador.js`. Expected: verde (t31 roda com o modo desligado).

- [ ] **Step 5: Commit** — `node scripts/bump-version.js && git commit -am "feat(cofre): sangria, pagamento de funcionário e outro pagamento"`.

---

### Task 5: Tela Cofre, menu, novidades

**Files:**
- Create: `assets/js/operacao/cofre.js`
- Modify: `index.html` (tag depois de `operacao/caixa.js`, mesmo `?v=`; `<div class="view" id="view-cofre"></div>` depois de `view-caixa`), `assets/js/core/config.js:111` (item `{label:'Cofre', icon:ICN.lock, view:'cofre'}` no grupo Caixa) e `:184` (`'cofre'` só em `admin`), `assets/js/core/navegacao.js:369` (render), `assets/js/sistema/novidades.js` (entrada no topo)
- Test: `../auditoria-2026-11-03/e2e/t62-cofre.js` (parte 3)

**Interfaces:**
- Consumes: Task 1 RPCs `cash_cofre_ler/confirmar/abastecer/saida/contar/recolher_fechado`; `listaDeCaixas()`.
- Produces (globais, para `onclick`): `renderCofre()`, `cofreConfirmar(id)`, `cofreAbastecer()`, `cofreSaida()`, `cofreContar()`, `cofreRecolherFechado()`.

- [ ] **Step 1: e2e que falha**:
  - Item "Cofre" no menu só para admin/dono e só com o modo ligado; operador não vê.
  - Sem contagem: faixa `Conte o cofre para começar o saldo.` com botão Contar cofre.
  - Lista "A recolher" mostra a entrada de fim da noite (caixa, quem, valor); Confirmar pede o valor contado; depois some da lista e aparece no extrato com a diferença.
  - Abastecer (caixa, valor, motivo opcional), Outra saída (valor, motivo obrigatório: toast `Informe o motivo.`), Contar cofre (mostra esperado e diferença depois de gravar), Recolher de caixa fechado (escolhe caixa e valor).
  - Resposta `travado` → toast `Esse caixa está travado. Resolva a contagem antes de abastecer.`; `ja_confirmado` → toast `Esse recolhimento já foi confirmado.` e recarrega.
  - Cada ação chama `logAction` (`Cofre: ...`).
  - `NOVIDADES[0].id === '2026-11-21-cofre'` com `perms:['cofre']`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** `cofre.js` no visual da tela Caixa (`cash-window`, `cash-section-title`, tabelas `cash-movement-table`), botões dentro de `singleFlight`, escape com `h`/`jsArg`. Saldo, a recolher e extrato numa tela só; filtro de data no extrato feito no front sobre as 300 linhas.

- [ ] **Step 4: Rodar e ver passar** — `node scripts/bump-version.js && node scripts/check-app.js && node scripts/check-load-order.js && node e2e/t62-cofre.js`, depois a bateria do caixa (`t21`, `t22`, `t31`, `t54`, `t55`, `t56`) e as de novidades (`t33`, `t59`, `t60`). Expected: verde (t11/t13/t33 já falhavam antes, conferir que não piorou).

- [ ] **Step 5: Commit** — `git commit -am "feat(cofre): tela do cofre e novidades"`.
