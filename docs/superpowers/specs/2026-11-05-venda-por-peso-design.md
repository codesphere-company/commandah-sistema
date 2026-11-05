# Venda por peso (carnes por kg) — projeto

Data: 05/11/2026. Substitui a decisão B5 da auditoria de 03/11 ("produtos por kg são embalagens de peso fixo, sem venda por peso"): o peso é variável e precisa ser digitado na hora.

## Por quê

O clube vende carnes cruas porcionadas (hoje 6 produtos com medida `kg`: Ancho/Noah, Contra Filé, Filé Mignon, Fraldinha no Shoyu, Picanha Grill, Picanha Suína; preço cadastrado é o preço do quilo). O fluxo real:

1. A carne chega do fornecedor e entra no estoque pelo peso total.
2. O cozinheiro corta, tira aparas e gordura (essa perda sai do estoque), pesa cada porção e cola uma etiqueta com **preço do quilo, peso e data** (sem código de barras).
3. As porções ficam na geladeira; o cliente escolhe e leva ao caixa.
4. No caixa, quem lança digita o peso de cada peça e o sistema calcula o valor.

Hoje vender "1" desses produtos cobra o quilo inteiro: não há como digitar o peso.

## Objetivos

- Ao vender um produto por peso, o operador digita o peso de cada peça (o da etiqueta) e o sistema cobra `peso × preço do quilo`.
- Várias peças do mesmo produto, cada uma com o seu peso, numa janela só.
- Cupom e NFC-e mostram peso, preço do quilo e total; NFC-e com unidade KG e o peso como quantidade.
- Estoque em quilos: cada venda desconta o peso exato.

## Fora do escopo

- Leitura de balança ou de código de barras (as etiquetas não têm código).
- Área de permissões por usuário (pedido do dono, projeto separado e posterior). Hoje as permissões são por perfil (Matriz de Permissões).
- Venda por peso no cardápio digital, autoatendimento (totem), delivery e combos.
- Mudanças no fluxo do cozinheiro (etiqueta continua fora do sistema).
- Deixar o estoque ficar negativo.

## O que o dono decidiu

- **Quem usa:** o caixa, na **Ficha** (balcão) e na janela **Novo pedido da comanda**.
- **Tela (opção B do rascunho):** ao tocar num produto por peso abre uma janela com o preço do quilo e uma lista de peças. O operador digita o peso, Enter, abre a linha da próxima peça. Cada linha mostra o valor da peça e tem ✕ para tirar. Embaixo: quantidade de peças, peso somado e total. Botão "Adicionar N peças".
- **Cada peça vira uma linha no pedido**, ex.: `PICANHA GRILL KG — 0,480 kg × R$ 119,90 = R$ 57,55`.
- **Preço do quilo:** vem do cadastro; **só o administrador** pode alterar. Para os demais o campo aparece travado, com um botão "Alterar (PIN do admin)": abre o pedido de PIN de um administrador **ali mesmo, sem trocar o usuário logado** (o caixa continua no aparelho e o pedido não se perde). Admin logado altera direto.
- **Estoque insuficiente: bloqueia e avisa.** Se a soma das peças passar do estoque do insumo (ou ele estiver em 0 kg), a janela mostra o aviso em vermelho ("Estoque de Picanha Grill: 0,350 kg. Lance a entrada do fornecedor em Insumos.") e o botão "Adicionar" fica bloqueado. Sem mudança no banco: a baixa de estoque atual já é "tudo ou nada".
- **Não vai para a cozinha** (a peça já está pronta e embalada) e não imprime ficha de preparo.
- **Estoque por quilos.** Entrada = peso total do fornecedor; aparas e gordura saem como perda (Insumos › Saída, motivo "Aparas e gordura" — já existe); a venda desconta o peso de cada peça.

## Decisões do Claude (o dono pode trocar)

- **Produto por peso = `measure` igual a `kg`** no cadastro (as 6 carnes já estão assim). Sem campo novo.
- **Digitação do peso:** "0,480" ou "0.480" = quilos; número inteiro ≥ 10 sem vírgula ("480") = gramas → 0,480 kg. Três casas decimais. Recusa zero e acima de 10 kg (provável erro de digitação), com aviso na linha.
- **Arredondamento:** valor da peça = `round2(peso × preço do quilo)`, igual ao `cents(unit*qty)` da NFC-e (`supabase/functions/nfce/payload.ts`), para cupom e nota baterem centavo a centavo.
- **Representação na venda (revista no plano):** cada peça é uma linha com `qty: 1`, `price` = valor da peça já arredondado e `weight: { kg, pricePerKg, override? }`. Motivo: o total é `price × qty` sem arredondar em 19 lugares do site (pedido, pagamento, fiado, impressão); com `qty` = peso, pedido e NFC-e poderiam diferir em um centavo. Os poucos lugares que precisam do peso leem `weight`: NFC-e (`Quantidade` = kg, `ValorUnitario` = preço do quilo, unidade KG), baixa de estoque (multiplica pelo kg), impressão e relatórios (mostram kg).
- **Linha de peso não soma com outra:** cada peça é uma linha própria (não junta pela assinatura como os itens comuns). No pedido, a linha de peso não tem botões +/−; só tirar. Para corrigir o peso, tira e lança de novo.
- **PIN do admin pelo servidor:** ação nova `price_override` na Edge Function `staff-auth`, no molde da `release_debt` (OP-14, `supabase/functions/staff-auth/index.ts`): confere o PIN (mesma trava de tentativas), exige perfil `admin`, grava no `audit_log` (quem autorizou, operador logado, produto, preço original e novo) e devolve `{ ok, name }`. A janela de PIN reaproveita a da liberação de sócio (`core/config.js`, perto da linha 231). Admin já logado: o site grava o `audit_log` pelo caminho normal. **Ordem: deploy da função (com o "sim" do dono) ANTES do merge do site.**
- **Alteração de preço na linha:** `priceOverride: { original, by: <admin que autorizou>, operator: <usuário logado>, at }`.
- **Estoque:** cada carne ganha um insumo em kg (ex.: "Picanha Grill (kg)") ligado pela ficha técnica com 1 kg por kg. Os insumos e as fichas são cadastro (feito pelo dono ou pelo Claude com o "sim" dele, com cópia de segurança), não código.
- **Disponibilidade:** para produto por peso, "sem estoque" quando o insumo tem 0 kg ou menos (sem `Math.floor` em unidades). Carne sem ficha técnica (sem insumo ligado) não controla estoque, como qualquer produto hoje.
- **Canais:** produto por peso some do cardápio digital e do totem (mesmo mecanismo de `hiddenInSelfService`), não entra em combo (`blockedInCombo`), e no app do garçom também não aparece nesta primeira versão.
- **Relatórios:** produtos por peso aparecem somados em kg (ex.: "3,215 kg") em vez de unidades; valor normal.
- **Cupom:** linha `0,480 kg × R$ 119,90` abaixo do nome e o total da peça.

## Restrições

- Site estático em JS puro (`assets/js`), sem build; trocar o `?v=` de todos os assets (`scripts/bump-version.js`). Ver `CLAUDE.md`.
- Os produtos por peso ficam com estação `nenhuma` (já existe) para não irem à cozinha.
- Vendas e estoque passam por RPCs existentes (`sales_apply`, `close_sale`, `consume_insumos`); conferir que aceitam `qty` decimal e não arredondam (o Postgres local de testes em `auditoria-2026-11-03` tem as migrations reais).
- Testes da bancada (`auditoria-2026-11-03/e2e`) precisam continuar passando; teste novo para o fluxo de peso (Ficha e comanda, 1366 px e 390 px, admin e caixa).
- NFC-e: conferir `UNIDADE['kg']` no payload e que `Quantidade` sai com 3 casas.

## Perguntas abertas

Nenhuma. (Respondidas pelo dono em 05/11: estoque insuficiente bloqueia e avisa; troca de preço pede o PIN do admin na própria janela.)

## Para o construtor decidir

- Onde fica o componente da janela (provavelmente junto de `vendas/escolha-item.js`, mesma camada `#itemChoiceRoot`).
- Formato exato do evento de auditoria, seguindo o que já existe.
- Ajustes de CSS e foco/teclado (Enter avança, Esc fecha), no padrão da escolha de tamanho.
