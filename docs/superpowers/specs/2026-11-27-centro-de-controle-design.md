# Centro de controle da plataforma (27/11/2026)

## Por quê
O lançamento está perto, com vários clientes (bares, lanchonetes, clubes) ao mesmo tempo. O dono do Commandah quer
um painel "no estilo do Grafana, como um centro de controle" para ver na hora quando algo **crítico** quebrou em
qualquer cliente, antes de o cliente ligar: "pedido que não chegou à cozinha, venda que não subiu ao servidor, coisas
críticas". E, junto, resumos de cada cliente: vendas, ticket médio, o que mais sai.

Sucesso: um problema crítico em qualquer cliente chega ao WhatsApp do dono e acende o painel em até ~2 minutos, e
continua avisando até ser resolvido.

## Decisões do dono
- Caminho A: painel **dentro do Commandah** (não Grafana externo).
- Vê **todos os clientes ao mesmo tempo**.
- Alertas críticos: pedido que não chegou à cozinha, venda que não subiu ao servidor (e afins).
- Resumos por cliente: ticket médio, mais vendidos etc.
- Alerta chega por **WhatsApp e na tela do painel (som)**, e **repete** enquanto não resolver.
- "Pedido que não chegou à cozinha" = (a) a ficha nem chegou ao servidor (o aparelho falhou ao gravar o `print_jobs`),
  (b) impressão parada, (c) agente de impressão sem sinal. **Não** usar "pedido parado no Monitor" (decisão de 27/11).
- WhatsApp de destino: o celular particular do dono (gravado só no banco, em `plataforma_operadores.whatsapp`; nunca no
  repositório).

## Metas
1. Cada aparelho logado manda um **sinal** periódico ao servidor (vivo, versão, fila de envio, último erro).
2. O banco confere sozinho, a cada minuto, as regras críticas de todos os clientes e mantém uma lista de **incidentes**
   (abre, repete o aviso, fecha sozinho quando a condição some).
3. Incidente aberto manda WhatsApp ao(s) operador(es) e repete a cada 15 min enquanto aberto.
4. Tela **Centro de controle**, só para operadores da plataforma: um cartão por cliente (verde/amarelo/vermelho),
   incidentes abertos, aparelhos, números do dia; som quando abre incidente novo; detalhe por cliente.

## Não-metas
- Não substitui os Relatórios do cliente; os resumos são uma visão rápida do dia.
- Não corrige nada sozinho (não reimprime, não reenvia venda).
- Grafana / histórico de longo prazo: fora desta entrega.
- App de celular próprio: o painel é a página web responsiva.

## Anti-metas (falharia mesmo funcionando)
- Cliente (dono, admin, colaborador de qualquer estabelecimento) enxergar o painel ou dados de outro estabelecimento.
- Operador ver nome de cliente/sócio/telefone (LGPD): só números, nomes de produtos, nomes de aparelhos e de colaboradores
  nos alertas quando necessário (ex.: "Caixa 1 — Ana").
- Celular do dono tocando de madrugada com o clube fechado.
- Estourar de novo o egress do Supabase (já aconteceu com polling): sinal pequeno, painel lê números já somados.
- Alerta falso em massa (aparelho que só foi fechado à noite virar "aparelho sumiu").

## Restrições
- Front em JS puro, scripts clássicos, sem build (CLAUDE.md). Back: Postgres + RLS + RPCs + pg_cron + pg_net + Edge
  Functions (padrão já usado em `notas-entrada` e `whatsapp`).
- Migrations novas só com "sim" do dono; Edge Function idem; merge idem.
- Multi-tenant: todo dado é por `tenant_id`; RLS atual não muda para os clientes.
- Polling do painel: no máximo a cada 15 s e só com a aba visível; payload agregado (alvo < 20 KB por leitura com 20 clientes).

## Abordagens consideradas
- **A (escolhida pelo dono): tudo no Commandah** — sinal dos aparelhos + regras no banco (pg_cron) + incidentes +
  WhatsApp pela Evolution + tela de operador. Mesmo login, sem dado saindo para terceiros, alerta ativo.
- B: Grafana Cloud lendo o banco só-leitura. Descartada: login separado, dados de todos os clientes num serviço de
  fora, e o sinal dos aparelhos (peça central) teria de ser construído igual.
- C: A agora + Grafana depois. Fica como possibilidade futura.

## Como funciona (o que o dono decidiu + propostas do Claude marcadas)

### 1. Operadores da plataforma
- Tabela `plataforma_operadores (auth_uid uuid pk, nome text, whatsapp text, ativo bool)`, preenchida por SQL (sem tela).
  *Call do Claude.*
- Função `eh_operador_plataforma()` (security definer) usada pelas RPCs do painel. Cliente nunca passa nela.
- O operador entra com a conta de dono de sempre (e-mail + senha + 2FA já existente). *Call do Claude.*

### 2. Sinal dos aparelhos
- Cada aparelho ganha um id próprio no localStorage (`commandah:aparelhoId`, uuid) e um nome (caixa marcado → nome do
  caixa; senão perfil + navegador, ex. "Garçom · Android"). *Call do Claude.*
- A cada 60 s com sessão aberta (e já no login) chama RPC `aparelho_sinal(p jsonb)`: versão (`?v=`), tela atual, papel,
  nome de quem está logado, `online`, **pendências de envio** (vendas com mudança local ainda não confirmada pelo
  servidor — o mesmo critério de `mergeSalesChanges`/`salesBase` — e lançamentos de caixa pendentes), idade da pendência
  mais velha, último erro de gravação (mensagem curta), caixa marcado e se o caixa dele está aberto.
- Sem internet o sinal não chega; quando volta, o primeiro sinal leva a fila acumulada.
- Tabela `aparelhos_sinal (tenant_id, aparelho_id, ... , visto_em)` — um registro por aparelho (upsert), não histórico.
- Fila de envio > 0 por mais de 2 min também aparece **no próprio aparelho** como faixa (já existe padrão de faixas em
  `avisos.js`)? *Fora desta entrega, deixado ao construtor decidir se é trivial.*

### 3. Regras críticas (banco, a cada 1 min, via pg_cron) — limites são *call do Claude*
Só para cliente **funcionando** = algum caixa aberto (modo antigo: `cashSession` aberto; por operador: turno aberto)
ou venda nos últimos 30 min.
| Código | Condição | Gravidade |
|---|---|---|
| `ficha_nao_enviada` | aparelho com ficha de cozinha que falhou ao gravar no servidor (`notePrintFailure` levado no sinal) há > 1 min | crítico |
| `impressao_parada` | `print_jobs` com status `pendente` há > 2 min | crítico |
| `agente_sem_sinal` | agente de impressão com `last_seen_at` > 3 min (e ele tem impressora ativa) | crítico |
| `venda_nao_subiu` | aparelho com pendência de envio há > 2 min | crítico |
| `aparelho_sumiu` | aparelho que é caixa com turno aberto e sem sinal há > 3 min | crítico |
| `estabelecimento_sem_sinal` | cliente funcionando e **todos** os aparelhos e agentes sem sinal há > 3 min (provável queda de internet ou energia) | crítico |
| `nfce_rejeitada` | nota em `nfce_notas` com status `rejeitada`/`erro` nos últimos 30 min | atenção |
| `caixa_travado` | turno `travado*` há > 10 min | atenção |
| `erros_tela` | ≥ 5 `client_errors` do mesmo cliente em 10 min | atenção |
- Tabela `incidentes (id, tenant_id, codigo, chave, gravidade, detalhe jsonb, aberto_em, ultimo_aviso_em, fechado_em,
  avisos int)`; `chave` evita duplicar (ex.: o id da impressora). Condição sumiu → fecha sozinho (`fechado_em`).
- `print_jobs` não tem `order_id`/`sale_id` e estação "só imprimir" não gera `orders`: por isso a falha de "não chegou" é
  medida no aparelho (fichas que falharam, no sinal) e no servidor só como impressão parada / agente sem sinal.
- `impressao_parada` ignora jobs mais velhos que 6 h e de impressora que não está mais cadastrada (mesmo piso de
  `avisos.js:313`).
- **Funcionando** (*call do Claude*): caixa aberto (modo antigo `app_data` `cantina2:cashSession` status `open`; por
  operador `cash_turnos.turno->>'status'` open/travado*) **e** venda nos últimos 60 min. Caixa esquecido aberto de
  madrugada não alerta. `caixa_travado` ignora a regra de 60 min.
- Garçom offline (*call do Claude*): a pendência de venda só vive na memória do aparelho e aparelho sem internet não manda
  sinal. Regra extra `aparelho_sumiu_com_pendencia`: último sinal com pendência > 0 e sem sinal há > 5 min → **atenção**
  (só painel) para qualquer papel; para aparelho de caixa já é `aparelho_sumiu` (crítico).
- Quedas de internet (pedido do dono, 27/11): cada aparelho anota no localStorage quando perdeu e recuperou a conexão
  (eventos `offline`/`online` e falha de rede nas gravações) e manda os períodos no primeiro sinal depois de voltar;
  ficam em `quedas_conexao (tenant_id, aparelho_id, inicio, fim, pendencias_ao_voltar)` para o histórico do cliente
  ("sem internet das 20:10 às 20:25, 3 vendas subiram às 20:26"). `estabelecimento_sem_sinal` substitui os alertas
  individuais (`aparelho_sumiu`, `agente_sem_sinal`) daquele cliente enquanto estiver aberto, para não mandar 5 WhatsApps.
  O WhatsApp sai do servidor do Evolution, então o alerta chega mesmo com a internet do cliente fora.
- Clientes monitorados (*call do Claude*): só com assinatura ativa (`assinaturas`); contas de teste/bancada ficam fora.

### 4. Avisos por WhatsApp
- Incidente **crítico** novo → WhatsApp a cada operador ativo; repete a cada **15 min** enquanto aberto (`ultimo_aviso_em`);
  fechou → mensagem "resolvido". Atenção → só no painel (sem WhatsApp). *Call do Claude.*
- Envio pela Edge Function `whatsapp` (Evolution), chamada por pg_net com segredo no vault (padrão `notas-entrada`).
  A função `whatsapp` hoje só aceita JWT de dono/colaborador e usa a instância = `tenant_id`: ganha uma ação nova
  `alerta_plataforma` protegida por `x-segredo` (vault, padrão `notas-entrada`).
  Remetente (*call do Claude*, o dono não tem chip separado): a instância do Clube Olímpico, já conectada, mandando para o
  celular particular do dono (números diferentes, então toca). Fica num secret (`PLATAFORMA_WHATSAPP_INSTANCIA`) para
  trocar por um chip da plataforma depois. Se essa instância cair, o painel mostra "WhatsApp de alertas desconectado".
- Texto curto: "🔴 Clube Olímpico — impressora COZINHA parada há 4 min (2 pedidos). commandah.com.br/?controle".

### 5. Tela Centro de controle
- Só aparece para `eh_operador_plataforma()`; entra por `https://commandah.com.br/?controle` e por um item no menu do
  operador. *Call do Claude.*
- Uma RPC `controle_resumo()` devolve, para todos os clientes: nome, situação (pior gravidade aberta), incidentes
  abertos, aparelhos (nome, versão, último sinal, fila), e do dia: nº de vendas, faturamento, ticket médio, top 5
  produtos (nome e quantidade). Sem nomes de clientes/sócios.
- Atualiza a cada 15 s com a aba visível; incidente crítico novo toca som e pisca o cartão; o som repete enquanto houver
  crítico aberto não visto (botão "Ciente" silencia o som daquele incidente no painel, não o WhatsApp).
- Detalhe do cliente (`controle_cliente(tenant)`): vendas por hora (hoje vs. mesmo dia da semana passada), 10 mais
  vendidos, aparelhos, incidentes do dia (abertos e fechados) com duração.
- Layout: o mesmo padrão "hub" das telas novas (cartões, verde/amarelo/vermelho), legível em celular e TV.

### Etapas sugeridas (um PR cada)
1. Operadores + sinal dos aparelhos + tabela de incidentes + regras + WhatsApp (o que resolve "caso tenhamos algum problema").
2. Tela Centro de controle com incidentes, aparelhos e som.
3. Resumos (ticket, mais vendidos, por hora) e detalhe do cliente.

4. (pedido do dono, 27/11) Uso dos servidores no mesmo painel: Supabase (egress, banco, funções, MAU vs. limite do plano,
   pela Management API) e a VPS do Evolution (CPU, memória, disco por um coletor pequeno), com barra de uso do plano para
   decidir upgrade. Desenhar à parte.
5. (pedido do dono, 27/11) Custos das assinaturas da plataforma por mês (Supabase, VPS, Brasil NFe, Cloudflare, domínio…;
   automático onde houver API, o resto cadastrado à mão), ao lado da receita das assinaturas dos clientes. Desenhar à parte.

## Deixado ao construtor
- Nomes exatos de colunas além dos citados; índices.
- Como medir "fila de envio" no aparelho além de vendas e caixa (pedidos `orders` locais?), desde que o critério fique
  num lugar só.
- Ritmo do sinal pode ser 60 s ± jitter.
- Retenção: incidentes fechados > 90 dias e sinais de aparelhos sem uso > 30 dias apagados pelo cron diário.

## Revisão final da etapa 1 (27/11, calls do Claude)
- Alertas vindos dos aparelhos (`ficha_nao_enviada`, `venda_nao_subiu`, `aparelho_sumiu`) são **um por cliente e código**,
  com os nomes no detalhe; no máximo 50 aparelhos por cliente; nomes limpos (sem link) antes do WhatsApp.
- Fecha só depois de **3 min ausente** (histerese); repete no máximo **8 vezes** (2 h); cliente que parou de funcionar
  (sem venda há 60 min) fecha **calado**.
- `estabelecimento_sem_sinal` fica aberto enquanto durar (até 12 h com o caixa aberto) e suprime os individuais e a
  venda pendente do mesmo cliente.
- Venda/ficha pendente vale pelo **último sinal** (até 12 h): aparelho que perdeu a internet continua alertando até
  avisar que enviou. A regra `aparelho_sumiu_com_pendencia` saiu (coberta por essa).
- Não alertam: aparelho que saiu para a tela de PIN (sinal de saída no logout), registro velho do mesmo caixa, turno já
  fechado (por operador), agente substituído (reinstalado), impressora cujo agente já está calado.
- Envio: `controle_avisos_pegar()` reserva atômica (2 min), aviso vale 30 min, no máximo 3 tentativas; alerta de
  incidente já fechado não sai.
- Deixado para depois: `ultimo_erro` não é enviado pelo aparelho; fichas que falharam somem ao recarregar a página (como o
  aviso vermelho de hoje); o diff de `state.sales` roda a cada minuto na thread da tela.
