// Ciclo do agente: a cada poucos segundos busca as fichas pendentes, pega uma de cada vez
// (claim: só um agente imprime cada ficha), imprime e marca 'impresso' ou 'erro'.
// Ficha de impressora do Windows que não existe neste computador fica pendente (outro
// computador pode ter essa impressora; no Commandah aparece o aviso de fila travada).
// 2.1: sem token, o agente mostra um código para conectar este computador no Commandah
// (Configurações › Impressoras › Conectar computador) e conta as impressoras que encontrou.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace Commandah.Agente
{
    public enum AgentState { SemToken, TokenInvalido, Conectado, SemConexao }

    public class LogEntry
    {
        public DateTime At;
        public string Text;
        public bool Error;
    }

    public class Agent
    {
        public readonly Config Cfg;
        readonly Api api;
        Timer timer;
        int busy, scanning;
        DateTime lastPing = DateTime.MinValue;
        DateTime lastReport = DateTime.MinValue, lastScan = DateTime.MinValue;
        string lastWindowsList = "";
        bool legacyWarned;
        readonly HashSet<string> warnedMissing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly List<LogEntry> log = new List<LogEntry>();

        public AgentState State { get; private set; }
        public DateTime LastContact { get; private set; }
        public int PrintedToday { get; private set; }
        public event Action Changed;

        // Conexão por código (enquanto não há token).
        public string PairCode { get; private set; }
        public DateTime PairExpires { get; private set; }
        string pairSecret;
        DateTime nextPairTry = DateTime.MinValue;

        public List<string> LastNetworkFound { get; private set; }

        public Agent(Config cfg)
        {
            Cfg = cfg;
            api = new Api(cfg);
            Printing.PrintToFileDir = cfg.PrintToFileDir;
            State = string.IsNullOrEmpty(cfg.Token) ? AgentState.SemToken : AgentState.SemConexao;
            LastNetworkFound = new List<string>();
        }

        public static string Machine { get { return Environment.MachineName; } }
        public bool IsPairedByCode { get { return !string.IsNullOrEmpty(Cfg.Token) && !string.IsNullOrEmpty(Cfg.AgentName); } }

        public void Start()
        {
            timer = new Timer(_ => Tick(), null, 500, Math.Max(1, Cfg.PollSeconds) * 1000);
        }

        // Modo antigo: token do estabelecimento colado à mão.
        public void SetToken(string token)
        {
            Cfg.Token = (token ?? "").Trim();
            Cfg.AgentName = "";
            Cfg.Save();
            ResetConnection();
            Log(string.IsNullOrEmpty(Cfg.Token) ? "Token apagado." : "Token salvo. Conferindo com o servidor...", false);
            ThreadPool.QueueUserWorkItem(_ => Tick());
        }

        public void Disconnect()
        {
            Cfg.Token = "";
            Cfg.AgentName = "";
            Cfg.Save();
            ResetConnection();
            Log("Computador desconectado do Commandah. Use o novo código para conectar de novo.", false);
            ThreadPool.QueueUserWorkItem(_ => Tick());
        }

        void ResetConnection()
        {
            lastPing = DateTime.MinValue;
            lastReport = DateTime.MinValue;
            lastScan = DateTime.MinValue;
            lastWindowsList = "";
            legacyWarned = false;
            warnedMissing.Clear();
            PairCode = null; pairSecret = null; nextPairTry = DateTime.MinValue;
            State = string.IsNullOrEmpty(Cfg.Token) ? AgentState.SemToken : AgentState.SemConexao;
            Fire();
        }

        public List<LogEntry> Entries()
        {
            lock (log) return new List<LogEntry>(log);
        }

        public void Log(string text, bool error)
        {
            lock (log)
            {
                log.Insert(0, new LogEntry { At = DateTime.Now, Text = text, Error = error });
                if (log.Count > 200) log.RemoveAt(log.Count - 1);
            }
            Fire();
        }

        void Fire()
        {
            var h = Changed;
            if (h != null) h();
        }

        void SetState(AgentState s)
        {
            if (State == s) return;
            State = s;
            if (s == AgentState.Conectado) Log("Conectado ao Commandah" + (IsPairedByCode ? " como \"" + Cfg.AgentName + "\"" : "") + ". Aguardando fichas.", false);
            else if (s == AgentState.TokenInvalido) Log(IsPairedByCode
                ? "Este computador foi removido no Commandah. Clique em Desconectar e conecte de novo com o código."
                : "Token inválido. Gere um token novo em Configurações › Impressoras e cole aqui.", true);
            else if (s == AgentState.SemConexao) Log("Sem conexão com o servidor. Tentando de novo...", true);
            Fire();
        }

        void Tick()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try
            {
                if (string.IsNullOrEmpty(Cfg.Token)) { SetState(AgentState.SemToken); PairStep(); return; }
                if ((DateTime.Now - lastPing).TotalSeconds >= 60 || State != AgentState.Conectado)
                {
                    var ping = api.Ping();
                    lastPing = DateTime.Now;
                    if (ping.Ok == false) { SetState(AgentState.TokenInvalido); return; }
                    if (!string.IsNullOrEmpty(ping.Name) && ping.Name != Cfg.AgentName && IsPairedByCode)
                    {
                        Cfg.AgentName = ping.Name; // renomeado no Commandah
                        Cfg.Save();
                    }
                    if (ping.Rescan) { Log("O Commandah pediu para procurar as impressoras de novo.", false); ScanAndReport(); }
                }
                var jobs = api.FetchPending();
                LastContact = DateTime.Now;
                SetState(AgentState.Conectado);
                foreach (var job in jobs) Handle(job);
                // Falha ao contar as impressoras não pode parar a impressão.
                try { ReportIfNeeded(); }
                catch (ApiException e) { lastReport = DateTime.Now; Log("Não foi possível enviar a lista de impressoras: " + e.Message, true); }
            }
            catch (ApiException e)
            {
                SetState(AgentState.SemConexao);
                if (e.Status != 0) Log(e.Message, true);
            }
            catch (Exception e)
            {
                Log("Erro inesperado: " + e.Message, true);
            }
            finally
            {
                Interlocked.Exchange(ref busy, 0);
                Fire();
            }
        }

        // ---------- conexão por código ----------
        void PairStep()
        {
            if (DateTime.Now < nextPairTry) return;
            try
            {
                if (PairCode == null || DateTime.Now > PairExpires.AddSeconds(-30))
                {
                    var p = api.StartPairing(Machine);
                    PairCode = p.Code; pairSecret = p.Secret; PairExpires = p.ExpiresAt;
                    Log("Código para conectar este computador: " + FormatCode(PairCode) + " (vale 30 minutos).", false);
                    Fire();
                    return;
                }
                var r = api.PollPairing(PairCode, pairSecret);
                if (r.Status == "ok" && !string.IsNullOrEmpty(r.Token))
                {
                    Cfg.Token = r.Token;
                    Cfg.AgentName = string.IsNullOrEmpty(r.Name) ? Machine : r.Name;
                    Cfg.Save();
                    ResetConnection();
                    Log("Conectado! Este computador aparece no Commandah como \"" + Cfg.AgentName + "\". Procurando as impressoras...", false);
                    ThreadPool.QueueUserWorkItem(_ => Tick());
                }
                else if (r.Status == "expired")
                {
                    PairCode = null; // pede outro no próximo ciclo
                }
            }
            catch (ApiException e)
            {
                nextPairTry = DateTime.Now.AddSeconds(15);
                Log("Não foi possível falar com o servidor para conectar (" + e.Message + "). Tentando de novo...", true);
            }
        }

        public static string FormatCode(string code)
        {
            return string.IsNullOrEmpty(code) || code.Length != 6 ? (code ?? "") : code.Substring(0, 3) + " " + code.Substring(3);
        }

        // ---------- impressoras encontradas ----------
        void ReportIfNeeded()
        {
            if (!IsPairedByCode)
            {
                if (!legacyWarned) { legacyWarned = true; Log("Usando o token do estabelecimento (modo antigo). Para a configuração automática, clique em Desconectar e conecte com o código.", false); }
                return;
            }
            bool scanDue = (DateTime.Now - lastScan).TotalMinutes >= 30;
            var windows = Printing.WindowsPrinters();
            var key = string.Join("\n", windows.OrderBy(x => x));
            if (scanDue) { ScanAndReport(); return; }
            if (key != lastWindowsList || (DateTime.Now - lastReport).TotalMinutes >= 5)
            {
                if (api.Report(Machine, windows, null)) { lastWindowsList = key; lastReport = DateTime.Now; }
            }
        }

        // Varre a rede numa thread à parte (leva alguns segundos) e conta tudo ao servidor.
        public void ScanAndReport()
        {
            if (!IsPairedByCode) { Log("Procurar impressoras de rede funciona só com o computador conectado por código.", true); return; }
            if (Interlocked.Exchange(ref scanning, 1) == 1) return;
            lastScan = DateTime.Now;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var nets = Discovery.LocalSubnets();
                    var found = Discovery.ScanNetwork();
                    LastNetworkFound = found;
                    var windows = Printing.WindowsPrinters();
                    api.Report(Machine, windows, found);
                    lastWindowsList = string.Join("\n", windows.OrderBy(x => x));
                    lastReport = DateTime.Now;
                    Log("Impressoras encontradas: " + windows.Count + " no Windows" +
                        (found.Count > 0 ? ", " + found.Count + " de rede (" + string.Join(", ", found) + ")" : ", nenhuma de rede") +
                        " — rede " + (nets.Count > 0 ? string.Join(", ", nets.Select(n => n + ".x")) : "não encontrada") + ".", false);
                }
                catch (Exception e)
                {
                    Log("Não foi possível procurar as impressoras: " + e.Message, true);
                }
                finally { Interlocked.Exchange(ref scanning, 0); Fire(); }
            });
        }

        // ---------- impressão ----------
        void Handle(PrintJob job)
        {
            bool network = !string.IsNullOrEmpty(job.PrinterIp);
            string winPrinter = network ? null : Printing.FindWindowsPrinter(job.PrinterName);
            if (!network && winPrinter == null)
            {
                if (warnedMissing.Add(job.PrinterName))
                    Log("Ficha para \"" + job.PrinterName + "\": essa impressora não está instalada neste computador. A ficha fica na fila.", true);
                return;
            }
            if (!api.Claim(job.Id)) return; // outro agente pegou
            string dest = network ? job.PrinterName + " (" + job.PrinterIp + ")" : winPrinter;
            try
            {
                if (network) Printing.PrintNetwork(job.PrinterIp, job.Content);
                else Printing.PrintWindows(winPrinter, job.Content, "Commandah " + job.Id.Substring(0, 8));
                api.MarkStatus(job.Id, true, null);
                PrintedToday++;
                Log("Impresso em " + dest + ".", false);
            }
            catch (Exception e)
            {
                try { api.MarkStatus(job.Id, false, e.Message); } catch (Exception) { }
                Log("Falha ao imprimir em " + dest + ": " + e.Message, true);
            }
        }

        public void PrintTest(string windowsPrinter, string ip)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    if (!string.IsNullOrEmpty(ip))
                    {
                        Printing.PrintNetwork(ip, Printing.TestTicket(ip, true));
                        Log("Teste enviado para a impressora de rede " + ip + ".", false);
                    }
                    else
                    {
                        Printing.PrintWindows(windowsPrinter, Printing.TestTicket(windowsPrinter, false), "Commandah teste");
                        Log("Teste enviado para " + windowsPrinter + ".", false);
                    }
                }
                catch (Exception e)
                {
                    Log("Teste falhou: " + e.Message, true);
                }
            });
        }
    }
}
