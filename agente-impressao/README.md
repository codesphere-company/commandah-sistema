# Agente de impressão do Commandah (versão 2)

Programa que fica no computador do clube e imprime as fichas do Commandah. Foi refeito do zero em 10/10/2026: o agente antigo (Electron) não estava em nenhum repositório (OPS-12) e estava parado desde 29/08, quando o token foi regenerado.

## Como funciona

1. O Commandah monta o texto de cada ficha e coloca na fila `print_jobs`, na nuvem.
2. A cada 3 segundos o agente busca as fichas pendentes do estabelecimento com o token. Para isso usa `print_agent_fetch_pending`, que também avisa o Commandah de que o agente está vivo.
3. Para cada ficha, o agente primeiro pega a ficha (`print_agent_claim_job`), para dois agentes não imprimirem a mesma. Depois imprime e marca `impresso` ou `erro` (`print_agent_mark_status`).
   - **Impressora de rede:** quando a ficha tem IP, o texto já vem em ESC/POS e vai direto para a porta 9100. Também dá para usar `IP:porta`.
   - **Impressora do Windows:** quando a ficha não tem IP, o agente imprime pelo driver, com fonte de largura fixa ajustada ao papel. Os acentos saem certos.
   - **Impressora que não existe neste computador:** a ficha continua na fila e o histórico do agente avisa. O Commandah também mostra "fila de impressão travada".
4. O agente confere o token ao abrir e a cada minuto (`print_agent_ping`). Token errado aparece em vermelho na janela.
5. Atendimento local em `http://127.0.0.1:9123`: é a reserva do Commandah quando a ficha não entra na fila da nuvem, por exemplo se a internet do caixa cair.
   - `GET /status`
   - `POST /print {printer, text, ip}`

Ícone perto do relógio:
- **verde:** imprimindo;
- **amarelo:** falta o token;
- **vermelho:** token inválido ou sem conexão.

Fechar a janela não desliga o agente. Para desligar: botão direito no ícone › Sair.

## Instalar no computador do clube

1. Copie `CommandahImpressora.exe` para `C:\Commandah\`. De pendrive é o mais simples. Baixado da internet, o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações › Executar assim mesmo**.
2. Abra o programa. Na primeira vez ele já fica marcado para abrir junto com o Windows.
3. No Commandah, entre como **administrador** (ou dono) e vá em **Configurações › Impressoras › Gerar/Regenerar token**. Copie o token.
4. Cole o token no agente e clique em **Salvar**. A faixa do topo fica verde, com "Conectado".
5. Em **Impressoras deste computador**, escolha a impressora e clique em **Imprimir teste**. Para impressora de rede, digite o IP e clique em **Testar impressora de rede**.
6. No Commandah, em **Configurações › Impressoras**, confira cada impressora:
   - **impressora USB/Windows:** o campo "Nome exato no Windows" tem que ser **igual** ao nome que aparece na lista do agente;
   - **impressora de rede:** preencha o campo "IP".

A configuração fica em `%APPDATA%\Commandah\agente-impressao.json`. O token fica cifrado com a conta do Windows e não funciona se o arquivo for copiado para outro computador.

## Gerar o programa a partir do código

Rode `build.cmd`. Ele usa o compilador C# que já vem no Windows 10/11 (.NET Framework 4.8), sem instalar nada, e gera `dist\CommandahImpressora.exe`.

Código em `src/`:

| Arquivo | O que faz |
|---|---|
| `Program.cs` | Ícone, uma cópia aberta por vez |
| `Agent.cs` | Ciclo da fila |
| `Api.cs` | Funções do banco |
| `Printing.cs` | Rede e Windows |
| `LocalServer.cs` | Porta 9123 |
| `MainForm.cs` | Janela |
| `Config.cs` | Configuração |
