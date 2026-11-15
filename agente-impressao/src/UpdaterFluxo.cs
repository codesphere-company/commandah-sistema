// Atualização do agente: o fluxo (procurar, baixar, conferir, trocar e reabrir).
// item 5 (auditoria 11/11): só troca o exe com aviso assinado pela chave embutida, baixado do
// endereço fixo do Commandah, com tamanho e sha256 conferidos. Se a versão nova não abrir
// (ex.: Smart App Control bloqueou), volta para a atual e continua imprimindo.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace Commandah.Agente
{
    public enum ResultadoAtualizacao { SemNovidade, AvisoInvalido, BaixouErrado, PastaSemEscrita, Ocupado, Trocado, Desligado, NaoAbriu }

    public partial class Updater
    {
        // A url do aviso só é aceita se for exatamente esta; o endereço de download é montado aqui.
        const string CaminhoExe = "downloads/CommandahImpressora.exe";
        const string CaminhoAviso = "downloads/agente-impressao.json";
        const long LimiteAviso = 64 * 1024;
        const long LimiteExe = 50L * 1024 * 1024;

        readonly Agent agent;
        readonly string baseUrl, publicKeyXml, exePath;
        Timer timer;
        int rodando;
        bool desligadoAvisado;
        string avisadoSemEscrita;

        // Ajustáveis só nos testes.
        internal TimeSpan EsperaOcupado = TimeSpan.FromSeconds(30);
        internal TimeSpan LimiteOcupado = TimeSpan.FromMinutes(10);
        internal TimeSpan JanelaAbertura = TimeSpan.FromSeconds(15);
        internal bool Reiniciar = true; // false: troca os arquivos mas não abre o novo nem encerra
        internal string VersaoAtual = Config.Version;

        // Chamado quando a versão nova abriu: encerra este app pela thread da UI (solta o mutex).
        public Action Encerrar;
        // Linha de situação da atualização (janela).
        public string Situacao { get; private set; }
        public event Action Mudou;

        public Updater(Agent agent, string baseUrl, string publicKeyXml, string exePath)
        {
            this.agent = agent;
            this.baseUrl = (baseUrl ?? "").EndsWith("/") ? baseUrl : (baseUrl ?? "") + "/";
            this.publicKeyXml = publicKeyXml ?? "";
            this.exePath = exePath;
            Situacao = string.IsNullOrEmpty(this.publicKeyXml) ? "Atualização automática desligada nesta versão." : "Atualização automática ligada (versão " + Config.Version + ").";
        }

        static string SemExe(string exe) { return exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? exe.Substring(0, exe.Length - 4) : exe; }
        public static string CaminhoNovo(string exe) { return SemExe(exe) + ".new.exe"; }
        public static string CaminhoAntigo(string exe) { return SemExe(exe) + ".old.exe"; }

        // Na abertura: apaga um .new que tenha sobrado. O .old (versão anterior) só sai numa abertura
        // normal: logo depois de atualizar (posAtualizacao) ele fica, como cópia boa para voltar à mão
        // se a versão nova abrir e quebrar depois (a volta automática só cobre a que nem abre). item 5 (auditoria 11/11).
        public static void LimparSobras(string exe, bool posAtualizacao)
        {
            ApagarSemErro(CaminhoNovo(exe));
            if (!posAtualizacao) ApagarSemErro(CaminhoAntigo(exe));
        }

        // Primeira procura 2 min depois de abrir; depois a cada 6 h.
        public void Iniciar()
        {
            timer = new Timer(_ =>
            {
                try { ProcurarEAplicar(false); }
                catch (Exception e) { agent.Log("Atualização: erro inesperado: " + e.Message, true); }
            }, null, TimeSpan.FromMinutes(2), TimeSpan.FromHours(6));
        }

        void Situar(string texto)
        {
            Situacao = texto;
            var h = Mudou;
            if (h != null) h();
        }

        public ResultadoAtualizacao ProcurarEAplicar(bool manual)
        {
            if (string.IsNullOrEmpty(publicKeyXml))
            {
                if (!desligadoAvisado) { desligadoAvisado = true; agent.Log("Atualização automática desligada nesta versão.", false); }
                Situar("Atualização automática desligada nesta versão.");
                return ResultadoAtualizacao.Desligado;
            }
            if (Interlocked.Exchange(ref rodando, 1) == 1)
            {
                if (manual) agent.Log("Já estou procurando atualização. Aguarde.", false);
                return ResultadoAtualizacao.Ocupado;
            }
            try { return Fluxo(manual); }
            finally { Interlocked.Exchange(ref rodando, 0); }
        }

        ResultadoAtualizacao Fluxo(bool manual)
        {
            Situar("Procurando atualização...");
            // .NET 4.8 em Windows antigo pode começar só com TLS 1.0 (o GitHub Pages recusa)
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch (Exception) { }

            Aviso aviso;
            try
            {
                byte[] json = Baixar(baseUrl + CaminhoAviso, LimiteAviso);
                byte[] sig = Baixar(baseUrl + CaminhoAviso + ".sig", LimiteAviso);
                aviso = json == null || sig == null ? null : LerAvisoAssinado(json, System.Text.Encoding.ASCII.GetString(sig), publicKeyXml);
            }
            catch (Exception e)
            {
                if (manual) agent.Log("Não foi possível procurar atualização: " + e.Message, true);
                Situar("Não foi possível procurar atualização (" + DateTime.Now.ToString("dd/MM HH:mm") + ").");
                return ResultadoAtualizacao.AvisoInvalido;
            }
            if (aviso == null || aviso.Url != CaminhoExe || aviso.Size > LimiteExe)
            {
                agent.Log("Aviso de atualização inválido (assinatura ou endereço não conferem): ignorado.", true);
                Situar("Aviso de atualização inválido: ignorado.");
                return ResultadoAtualizacao.AvisoInvalido;
            }
            if (!VersaoMaior(aviso.Version, VersaoAtual))
            {
                if (manual) agent.Log("Nenhuma atualização: a versão " + VersaoAtual + " é a mais nova.", false);
                Situar("Versão " + VersaoAtual + " é a mais nova (conferido " + DateTime.Now.ToString("dd/MM HH:mm") + ").");
                return ResultadoAtualizacao.SemNovidade;
            }

            string novo = CaminhoNovo(exePath);
            if (!PodeEscrever(novo))
            {
                string msg = "Atualização " + aviso.Version + " disponível: baixe pelo Commandah";
                if (manual || avisadoSemEscrita != aviso.Version) { avisadoSemEscrita = aviso.Version; agent.Log(msg + " (a pasta do agente não aceita gravação).", true); }
                Situar(msg + ".");
                return ResultadoAtualizacao.PastaSemEscrita;
            }

            Situar("Baixando a versão " + aviso.Version + "...");
            byte[] bin;
            try { bin = Baixar(baseUrl + CaminhoExe, aviso.Size); }
            catch (Exception e) { bin = null; agent.Log("Atualização " + aviso.Version + ": falha ao baixar (" + e.Message + ").", true); }
            if (bin == null || bin.Length != aviso.Size || Sha256Hex(bin) != aviso.Sha256)
            {
                agent.Log("Atualização " + aviso.Version + ": o arquivo baixado não confere com o aviso. Nada foi trocado.", true);
                Situar("Atualização " + aviso.Version + " baixou errado; tento de novo mais tarde.");
                return ResultadoAtualizacao.BaixouErrado;
            }
            try
            {
                File.WriteAllBytes(novo, bin);
                // confere de novo o que ficou no disco antes de rodar qualquer coisa
                byte[] gravado = File.ReadAllBytes(novo);
                if (gravado.Length != aviso.Size || Sha256Hex(gravado) != aviso.Sha256) throw new IOException("arquivo gravado diferente do baixado");
            }
            catch (Exception e)
            {
                ApagarSemErro(novo);
                agent.Log("Atualização " + aviso.Version + ": não consegui gravar a versão nova (" + e.Message + "). Nada foi trocado.", true);
                Situar("Atualização " + aviso.Version + " não gravou; tento de novo mais tarde.");
                return ResultadoAtualizacao.BaixouErrado;
            }

            // Espera terminar a impressão em andamento e pausa a fila durante a troca.
            if (!PausarQuandoLivre())
            {
                ApagarSemErro(novo);
                agent.Log("Atualização " + aviso.Version + " adiada: o agente estava imprimindo. Tento de novo mais tarde.", false);
                Situar("Atualização " + aviso.Version + " adiada (imprimindo).");
                return ResultadoAtualizacao.Ocupado;
            }

            // item 5 (auditoria 11/11): daqui em diante a fila está pausada. Qualquer exceção (ex.: o
            // aviso na janela sem handle no início minimizado) não pode deixar o agente pausado para
            // sempre (ícone verde e nenhuma ficha saindo): o finally volta a imprimir, a não ser que
            // este app esteja de fato encerrando para a versão nova. Se a troca já tinha acontecido e
            // a versão nova não chegou a abrir, volta o arquivo antigo.
            bool encerrando = false, trocado = false, abriu = false;
            try
            {
                Etapa("pausado");
                if (!TrocarArquivos(exePath, novo))
                {
                    ApagarSemErro(novo);
                    string msg = "Atualização " + aviso.Version + " disponível: baixe pelo Commandah";
                    agent.Log(msg + " (não consegui trocar o arquivo do agente).", true);
                    Situar(msg + ".");
                    return ResultadoAtualizacao.PastaSemEscrita;
                }
                trocado = true;
                Etapa("trocado");
                if (!Reiniciar)
                {
                    trocado = false; // troca pedida sem reabrir (testes): fica como está
                    Situar("Versão " + aviso.Version + " instalada.");
                    return ResultadoAtualizacao.Trocado;
                }

                Situar("Abrindo a versão " + aviso.Version + "...");
                if (!AbriuNovo())
                {
                    Desfazer(exePath);
                    trocado = false;
                    agent.Log("Atualização para " + aviso.Version + " não abriu; voltei para a versão " + VersaoAtual + ".", true);
                    Situar("Atualização para " + aviso.Version + " não abriu; continuo na versão " + VersaoAtual + ".");
                    return ResultadoAtualizacao.NaoAbriu;
                }
                abriu = true; // a versão nova está rodando: não desfaz mais (ela segura o arquivo)
                agent.Log("Versão " + aviso.Version + " aberta; fechando a versão " + VersaoAtual + ".", false);
                var enc = Encerrar;
                encerrando = true;
                if (enc != null) enc();
                return ResultadoAtualizacao.Trocado;
            }
            finally
            {
                if (trocado && !abriu && !encerrando) Desfazer(exePath);
                ApagarSemErro(novo);
                if (!encerrando) agent.Pausado = false;
            }
        }

        // Gancho só dos testes: chamado em cada etapa depois de pausar (pode lançar para simular falha).
#pragma warning disable 0649 // só os testes atribuem
        internal Action<string> AposEtapa;
#pragma warning restore 0649
        void Etapa(string nome)
        {
            var h = AposEtapa;
            if (h != null) h(nome);
        }

        // Baixa no máximo "limite" bytes; mais que isso devolve null (aceita file:/// nos testes).
        static byte[] Baixar(string url, long limite)
        {
            var req = WebRequest.Create(url);
            req.Timeout = 60000;
            var http = req as HttpWebRequest;
            if (http != null) { http.ReadWriteTimeout = 60000; http.UserAgent = "CommandahImpressora/" + Config.Version; }
            using (var resp = req.GetResponse())
            using (var s = resp.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                var buf = new byte[81920];
                int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0)
                {
                    if (ms.Length + n > limite) return null;
                    ms.Write(buf, 0, n);
                }
                return ms.ToArray();
            }
        }

        static bool PodeEscrever(string caminho)
        {
            try
            {
                using (new FileStream(caminho, FileMode.Create, FileAccess.Write, FileShare.None)) { }
                File.Delete(caminho);
                return true;
            }
            catch (Exception) { return false; }
        }

        static void ApagarSemErro(string caminho)
        {
            try { if (File.Exists(caminho)) File.Delete(caminho); } catch (Exception) { }
        }

        // Espera de EsperaOcupado em EsperaOcupado, por até LimiteOcupado. true: agente pausado e livre.
        bool PausarQuandoLivre()
        {
            var fim = DateTime.UtcNow + LimiteOcupado;
            bool avisou = false;
            while (true)
            {
                if (!agent.Ocupado)
                {
                    agent.Pausado = true;
                    if (!agent.Ocupado) return true; // ninguém começou a imprimir entre as duas olhadas
                    agent.Pausado = false;
                }
                if (DateTime.UtcNow >= fim) return false;
                if (!avisou) { avisou = true; Situar("Atualização aguardando terminar a impressão..."); }
                var resta = fim - DateTime.UtcNow;
                Thread.Sleep(resta < EsperaOcupado ? (resta > TimeSpan.Zero ? resta : TimeSpan.Zero) : EsperaOcupado);
            }
        }

        // atual -> .old, .new -> atual. Se a segunda parte falhar, desfaz a primeira.
        public static bool TrocarArquivos(string exeAtual, string exeNovo)
        {
            if (!File.Exists(exeNovo)) return false;
            string antigo = CaminhoAntigo(exeAtual);
            try
            {
                if (File.Exists(antigo)) File.Delete(antigo);
                if (File.Exists(exeAtual)) File.Move(exeAtual, antigo); // Windows deixa renomear o exe em uso
            }
            catch (Exception) { return false; }
            try { File.Move(exeNovo, exeAtual); return true; }
            catch (Exception)
            {
                try { if (File.Exists(antigo) && !File.Exists(exeAtual)) File.Move(antigo, exeAtual); } catch (Exception) { }
                return false;
            }
        }

        // Volta o .old para o lugar do exe (a versão nova não abriu).
        static void Desfazer(string exeAtual)
        {
            string antigo = CaminhoAntigo(exeAtual);
            if (!File.Exists(antigo)) return;
            for (int i = 0; i < 20; i++)
            {
                try
                {
                    if (File.Exists(exeAtual)) File.Delete(exeAtual);
                    File.Move(antigo, exeAtual);
                    return;
                }
                catch (Exception) { Thread.Sleep(250); } // o processo que fechou pode ainda segurar o arquivo
            }
        }

        // A versão nova espera o mutex (--pos-atualizacao) por até 120 s; se ela fechar antes da
        // janela (15 s), não abriu.
        bool AbriuNovo()
        {
            try
            {
                // UseShellExecute = true: o processo novo não herda os handles deste (com false ele
                // herdava o socket da porta 9123 e o atendimento local da versão nova não abria).
                var psi = new ProcessStartInfo(exePath, "--minimizado --pos-atualizacao") { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exePath) };
                using (var p = Process.Start(psi))
                {
                    if (p == null) return false;
                    var fim = DateTime.UtcNow + JanelaAbertura;
                    while (DateTime.UtcNow < fim)
                    {
                        if (p.HasExited) return false;
                        Thread.Sleep(200);
                    }
                    return !p.HasExited;
                }
            }
            catch (Exception) { return false; }
        }
    }
}
