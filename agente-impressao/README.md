# Agente de impressão do Commandah (versão 2.3)

**Novo na 2.3 (12/10/2026):** o cupom da NFC-e (ESC/POS com QR Code) vai "cru" (RAW) para as impressoras USB pelo driver do Windows, para o QR Code sair. As fichas comuns continuam como antes.

**Novo na 2.2 (12/10/2026):** em Configurações › Impressoras, cada computador tem a opção **"Procurar impressoras na rede sozinho"** e o botão **"＋ Impressora pelo IP"**. Com a busca desligada, o agente não varre mais a rede: usa só as impressoras USB dele e os IPs escolhidos, que podem estar em outra faixa (por exemplo 192.168.110.x). É o modo indicado quando a rede tem impressoras de outro sistema (no clube, as do Saipos). O agente confere os IPs escolhidos ao conectar, a cada 30 minutos e quando um IP é adicionado; o que não responder aparece em vermelho na tela. Precisa da migration `20261012000000`. Agente 2.1 com a busca desligada continua varrendo, mas o servidor não acrescenta o que ele achar.

Programa que fica nos computadores do estabelecimento e imprime as fichas do Commandah. Foi refeito do zero em 10/10/2026: o agente antigo (Electron) não estava em nenhum repositório (OPS-12) e estava parado desde 29/08, quando o token foi regenerado. A versão 2.1 (11/10/2026) trouxe a **configuração automática**: o computador é conectado por código e as impressoras são encontradas sozinhas.

## Instalar (qualquer estabelecimento)

1. Baixe o agente pelo Commandah: Configurações › Impressoras › Conectar computador › **Baixar o agente**. Também dá para levar o `CommandahImpressora.exe` num pendrive. Guarde em `C:\Commandah\`. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações › Executar assim mesmo**.
2. Abra o programa. Ele mostra um **código de 6 números** e já fica marcado para abrir junto com o Windows.
3. No Commandah, entre como **administrador** e vá em **Configurações › Impressoras › Conectar computador**. Digite o código e dê um nome, por exemplo "PC do Caixa". O agente fica verde, com "Conectado".
4. Em alguns segundos, as impressoras desse computador e as impressoras de rede encontradas aparecem em **Impressoras encontradas**.
5. Em cada impressora, marque o que ela imprime (Cozinha, Bar, Churrasqueira, Comprovante do caixa) e clique em **Imprimir teste**. A tela mostra se saiu ou qual foi o erro.
6. **Computador de caixa:** em "Computadores com o agente", escolha "Caixa: imprimir tudo lançado aqui em…". Assim, tudo que for lançado naquele computador (fichas de todas as estações e o comprovante) sai na impressora dele. Os pedidos do garçom pelo celular continuam indo para as impressoras das estações.

Repita os passos 1 a 3 em cada computador que tem impressora ligada no USB. As impressoras de rede (cabo de rede ou Wi-Fi) não precisam de computador próprio: qualquer computador conectado na mesma rede imprime nelas. Vale fixar o IP delas no roteador, para não mudarem.

## Como funciona

1. O Commandah monta o texto de cada ficha e coloca na fila `print_jobs`, na nuvem. A ficha de uma impressora USB leva o computador dela (`agent_id`), então duas impressoras com o mesmo nome em computadores diferentes não se confundem.
2. A cada 3 segundos o agente busca as fichas pendentes para ele (`print_agent_fetch_pending`). Para impressora de rede, recebe as fichas dos IPs que ele mesmo encontrou ou de IPs que ninguém encontrou.
3. Para cada ficha, o agente primeiro pega a ficha (`print_agent_claim_job`), para dois agentes não imprimirem a mesma. Depois imprime e marca `impresso` ou `erro`, com o motivo (`print_agent_mark_status`).
   - **Impressora de rede:** quando a ficha tem IP, o texto já vem em ESC/POS e vai direto para a porta 9100. Também dá para usar `IP:porta`.
   - **Impressora do Windows:** quando a ficha não tem IP, o agente imprime pelo driver, com fonte de largura fixa ajustada ao papel. Os acentos saem certos.
   - **Impressora que não existe neste computador:** a ficha continua na fila e o histórico do agente avisa.
4. Ao conectar, a cada 30 minutos e quando o Commandah pede ("Procurar de novo"), o agente procura as impressoras: as do Windows e as de rede (porta 9100 aberta na faixa /24 de cada placa de rede, se a busca estiver ligada, mais os IPs escolhidos). Conta tudo ao servidor com `print_agent_report`.
5. A cada minuto o agente confere se o computador continua conectado (`print_agent_ping`). A resposta traz também se a busca na rede está ligada (`scan`) e os IPs escolhidos (`check_ips`). Computador removido no Commandah aparece em vermelho na janela.
6. Atendimento local em `http://127.0.0.1:9123`:
   - `GET /status`: inclui `agent_id` e `agent_name`, para o Commandah aberto neste computador saber qual computador é (regra do caixa);
   - `POST /print {printer, text, ip}`: reserva para quando a ficha não entra na fila da nuvem.

Ícone perto do relógio:
- **verde:** imprimindo;
- **amarelo:** aguardando conexão (código);
- **vermelho:** computador removido ou sem conexão.

Fechar a janela não desliga o agente. Para desligar: botão direito no ícone › Sair.

**Modo antigo:** o token único do estabelecimento (Configurações › Impressoras › avançado › Gerar/Regenerar token) ainda funciona. Na janela do agente, use "Tenho um token do estabelecimento (modo antigo)". Nesse modo não há configuração automática, e o agente só recebe fichas sem computador definido.

A configuração fica em `%APPDATA%\Commandah\agente-impressao.json`. O token fica cifrado com a conta do Windows e não funciona se o arquivo for copiado para outro computador. `COMMANDAH_AGENT_DIR` troca essa pasta, só para teste.

## Gerar o programa a partir do código

Rode `build.cmd`. Ele usa o compilador C# que já vem no Windows 10/11 (.NET Framework 4.8), sem instalar nada, e gera `dist\CommandahImpressora.exe`. Copie o resultado para `downloads\CommandahImpressora.exe`, na raiz do repositório: é o arquivo que o Commandah oferece para baixar.

Código em `src/`:

| Arquivo | O que faz |
|---|---|
| `Program.cs` | Ícone, uma cópia aberta por vez |
| `Agent.cs` | Conexão por código, ciclo da fila, relatório das impressoras |
| `Api.cs` | Funções do banco |
| `Discovery.cs` | Procura impressoras de rede (porta 9100) |
| `Printing.cs` | Rede e Windows |
| `LocalServer.cs` | Porta 9123 |
| `MainForm.cs` | Janela |
| `Config.cs` | Configuração |
