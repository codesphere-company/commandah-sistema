# Agente de impressão 2.4: segurança e atualização automática (item 5 da auditoria)

Data: 14/11/2026. Item 5 da auditoria de lançamento de 11/11. O dono aprovou a proposta e escolheu o caminho A da atualização automática (aviso de versão assinado). Ele mesmo reinstala o agente nos computadores do clube, uma última vez.

## Por quê

- **Atendimento local.** O atendimento local do agente (`agente-impressao/src/LocalServer.cs`, porta 9123) responde a qualquer site (`Access-Control-Allow-Origin: *`). Um site malicioso aberto no navegador do caixa pode imprimir lixo e usar o campo `ip` de `POST /print` para mandar bytes a qualquer endereço e porta, inclusive fora da rede.
- **Fila da nuvem.** As fichas trazem `printer_ip`, que o agente usa sem conferir (`Printing.PrintNetwork`).
- **Pareamento.** `print_agent_pair_confirm` não limita tentativas. O administrador de qualquer estabelecimento pode chutar códigos de 6 dígitos e ficar com o computador que outro estabelecimento está conectando.
- **Atualização.** O agente não se atualiza: cada correção exige reinstalar à mão em cada computador.

## Objetivos

1. O atendimento local só atende o Commandah oficial.
2. O agente só envia para endereços da rede interna, venha o pedido da nuvem ou do atendimento local.
3. Pareamento com no máximo 10 códigos errados por estabelecimento a cada 15 minutos, cada erro registrado.
4. Da 2.4 em diante, o agente se atualiza sozinho e com segurança: nem quem tomar o GitHub ou o site consegue empurrar um programa falso.

## Fora do escopo

Assinatura de código do `.exe` (certificado pago), instalador do Windows e ver no Commandah a versão de cada agente.

## O que não pode acontecer

- Atualização cortando uma impressão, ou deixando o computador sem agente rodando.
- Impressora de rede do clube parando de imprimir. Há IPs em outra faixa, por exemplo 192.168.110.x, e há impressoras configuradas como `IP:porta`.
- A reserva local deixando de funcionar no Commandah oficial quando a internet cai.

## Caminhos considerados (atualização)

- **A. Aviso de versão assinado (escolhido pelo dono).** Um JSON pequeno no site é assinado com uma chave RSA privada que fica só no computador do dono. O agente confere com a chave pública embutida e só então baixa o `.exe` do aviso e confere o SHA-256. Seguro mesmo com o site comprometido. Se a chave se perder, volta a reinstalação manual uma vez, com chave nova.
- **B. Só SHA-256 no aviso, sem assinatura.** Mais simples, mas quem controla o site controla os caixas.
- **C. ClickOnce/Squirrel.** Pesado, exige certificado e outro jeito de compilar.

## Desenho

### 1. Atendimento local só do Commandah (LocalServer.cs)

- Origens aceitas: `https://codesphere-company.github.io`, `http://localhost` e `http://127.0.0.1`, com qualquer porta nas duas últimas, para testes.
- Pedido **com** cabeçalho `Origin` fora da lista: `403` com `{"ok":false,"error":"origem não permitida"}`, sem imprimir. Vale também para `OPTIONS`.
- Pedido **sem** `Origin` (programa local, `curl`) é atendido. Navegador sempre manda `Origin` nesses pedidos, e um programa local já tem acesso ao computador de qualquer jeito.
- `Access-Control-Allow-Origin` devolve a origem do pedido (não mais `*`), com `Vary: Origin`.

### 2. Só rede interna (Printing.cs)

Função única `Printing.EnderecoPermitido(string ipAndPort) -> bool`, chamada em `PrintNetwork` antes de abrir a conexão, para a nuvem e para o atendimento local:

- O host tem de ser IPv4 literal. Nome de máquina é recusado.
- O IPv4 tem de estar em 10.0.0.0/8, 172.16.0.0/12 ou 192.168.0.0/16.
- Porta de 1 a 65535 (`IP:porta` continua valendo).

Recusado: a ficha da nuvem vai para `erro` com o motivo "endereço fora da rede interna" (`print_agent_mark_status`), e o atendimento local responde `400`.

### 3. Limite de tentativas no pareamento (migration nova)

- Tabela `public.print_agent_pair_falhas(tenant_id text, at timestamptz default now(), code text)`, com RLS ligada, sem acesso para `anon`/`authenticated`, e índice em `(tenant_id, at)`.
- `print_agent_pair_confirm`, mesma assinatura:
  - 10 ou mais falhas do estabelecimento nos últimos 15 minutos: devolve `{"ok":false,"error":"Muitas tentativas com código errado. Espere alguns minutos e confira o número na janela do agente."}` sem nem procurar o código.
  - Código não encontrado ou vencido: grava a falha, grava uma linha no `audit_log` (`action = 'Código de impressão errado'`, `entity = 'print_agent'`) e devolve `{"ok":false,"error":"Código não encontrado ou vencido. Confira o número na janela do agente (ele troca a cada 30 minutos)."}`.
  - O erro vem no retorno, não em exceção, porque uma exceção desfaria o registro da falha.
  - Sucesso continua como hoje (`{ok:true, name}`). Falhas com mais de 1 dia são apagadas a cada chamada.
- Front (`assets/js/impressao/impressao-automatica.js:299`): quando `data && data.ok === false`, mostra `data.error` no mesmo lugar do erro de hoje.

### 4. Atualização automática (agente)

**Aviso de versão** (publicado no site, pasta `downloads/`):

- `downloads/agente-impressao.json`: `{"version":"2.4.0","url":"downloads/CommandahImpressora.exe","sha256":"<hex>","size":<bytes>,"published_at":"<ISO>"}`. A `url` é relativa ao endereço do site.
- `downloads/agente-impressao.json.sig`: assinatura RSA-SHA256, em base64, dos bytes exatos do JSON.
- O endereço base (`https://codesphere-company.github.io/commandah-sistema/`) é constante no agente (`Config.UpdateBase`). Quando o site mudar de domínio, publicar antes uma versão que aponte para o endereço novo.

**Chave:**

- RSA 2048. A chave pública (XML do `RSACryptoServiceProvider`) vai embutida em `Config.UpdatePublicKey`.
- A privada fica fora do repositório, em `%USERPROFILE%\.commandah\agente-chave-privada.xml`.
- O dono guarda uma cópia num pendrive. Sem ela, só reinstalando à mão com uma chave nova.

**Ferramenta do dono** (no repositório, `agente-impressao/tools/`), compilada pelo `build.cmd` como `dist\AssinarAgente.exe`:

- `AssinarAgente.exe gerar-chave`: cria o par de chaves se não existir e imprime a pública para colar em `Config.cs`. Recusa sobrescrever uma chave que já existe.
- `AssinarAgente.exe publicar`:
  - lê a versão de `dist\CommandahImpressora.exe` (`AssemblyVersion`/`FileVersion` alinhada a `Config.Version`);
  - copia o `.exe` para `downloads\CommandahImpressora.exe`;
  - escreve o JSON e o `.sig`.

**No agente** (arquivo novo `src/Updater.cs`):

- **Quando procura:**
  - 2 minutos depois de abrir e a cada 6 horas;
  - também pelo botão novo "Procurar atualização" na janela (`MainForm`).
- **Fluxo:**
  1. Baixa o `.json` e o `.sig`. Confere a assinatura com a chave embutida; falhou, ignora e registra no histórico.
  2. Só segue se a `version` do aviso for maior que `Config.Version`, comparando número a número. Isso impede voltar para uma versão velha, mesmo com aviso assinado.
  3. Baixa o `.exe` para `<pasta do agente>\CommandahImpressora.new.exe` e confere `size` e `sha256`. Diferente: apaga o arquivo e registra.
  4. Espera não haver ficha em impressão: o loop do agente expõe se está ocupado. Confere de novo a cada 30 s, por até 10 minutos; depois tenta na próxima rodada.
  5. Renomeia o `.exe` atual para `CommandahImpressora.old.exe`, apagando um `.old` anterior. Renomeia o `.new` para o nome do atual.
  6. Inicia o novo com `--minimizado --pos-atualizacao`, solta o mutex e encerra.
- **Pasta sem permissão de escrita** (por exemplo `Program Files`): não troca. Registra "Atualização 2.x disponível: baixe pelo Commandah" e mostra o mesmo texto na janela.
- **O novo processo** com `--pos-atualizacao`:
  - espera até 30 s pelo mutex, em vez de mostrar "já está aberto";
  - registra "Atualizado para 2.x";
  - apaga o `.old` na abertura seguinte, quando ela também der certo.
- **Se o novo nem abrir:** fica o `.old` para o dono renomear à mão (passo descrito no README).
- **Inicialização com o Windows:** a entrada do registro usa o caminho do executável, que continua o mesmo.

### 5. Versão 2.4.0

`Config.Version = "2.4.0"`, README com a seção "Novo na 2.4" e o passo a passo de publicar uma versão nova, `downloads/CommandahImpressora.exe` novo, o aviso assinado e entrada em NOVIDADES.

## Publicação

1. Gerar a chave no computador do dono (`gerar-chave`), colar a pública, compilar e assinar (`publicar`).
2. Aplicar a migration, com o "sim" do dono.
3. Merge (site, front e `downloads/`), na mesma janela da migration.
4. O dono reinstala a 2.4.0 em cada computador com agente: fecha o antigo pelo ícone, troca o `.exe` em `C:\Commandah\` e abre. O pareamento continua, porque o token fica na configuração do usuário do Windows, não no `.exe`.

A ordem de 2 e 3 importa pouco: o front novo entende os dois formatos de erro do pareamento.

## Fatos conferidos (checagem do construtor)

- **IPs em produção** (14/11, leitura de `print_jobs` dos últimos 60 dias, `cantina2:impressoras` e `print_agent_printers` de rede): só 192.168.110.111 a 114. A regra das três faixas privadas não derruba nenhuma impressora de hoje.
- **Endereços do Commandah:** o site só roda em `https://codesphere-company.github.io`, mais `localhost` nos testes. Ninguém abre por `file://`. Ao trocar de domínio, publicar antes uma versão do agente com a origem nova na lista e o `UpdateBase` novo.
- **Chave e assinatura (decisão do Claude):** o Claude gera a chave neste computador e assina na mesma sessão, como último passo, depois da compilação final. Qualquer recompilação depois disso exige assinar de novo. O dono autorizou mexer em `downloads/` neste trabalho.
- **Cache do GitHub Pages:** por alguns minutos os três arquivos podem ficar fora de sincronia. O agente trata como falha silenciosa e tenta de novo na rodada seguinte.

## Fica com quem constrói

- Formato exato do histórico e da janela.
- Como o loop do agente expõe "ocupado".
- Testes: compilar com o `build.cmd`; testes de unidade num `.exe` de teste compilado igual (sem framework) para `EnderecoPermitido`, comparação de versões, conferência de assinatura e SHA; teste do pareamento na bancada `../auditoria-2026-11-03/db`; ensaio da troca do `.exe` numa pasta temporária com um aviso assinado por uma chave de teste.
