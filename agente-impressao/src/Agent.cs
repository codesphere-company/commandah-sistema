// Ciclo do agente: a cada poucos segundos busca as fichas pendentes, pega uma de cada vez
// (claim: só um agente imprime cada ficha), imprime e marca 'impresso' ou 'erro'.
// Ficha de impressora do Windows que não existe neste computador fica pendente (outro
// computador pode ter essa impressora; no Commandah aparece o aviso de fila travada).
using System;
using System.Collections.Generic;
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
        int busy;
        DateTime lastPing = DateTime.MinValue;
        readonly HashSet<string> warnedMissing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly List<LogEntry> log = new List<LogEntry>();

        public AgentState State { get; private set; }
        public DateTime LastContact { get; private set; }
        public int PrintedToday { get; private set; }
        public event Action Changed;

        public Agent(Config cfg)
        {
            Cfg = cfg;
            api = new Api(cfg);
            Printing.PrintToFileDir = cfg.PrintToFileDir;
            State = string.IsNullOrEmpty(cfg.Token) ? AgentState.SemToken : AgentState.SemConexao;
        }

        public void Start()
        {
            timer = new Timer(_ => Tick(), null, 500, Math.Max(1, Cfg.PollSeconds) * 1000);
        }

        public void SetToken(string token)
        {
            Cfg.Token = (token ?? "").Trim();
            Cfg.Save();
            lastPing = DateTime.MinValue;
            warnedMissing.Clear();
            State = string.IsNullOrEmpty(Cfg.Token) ? AgentState.SemToken : AgentState.SemConexao;
            Log(string.IsNullOrEmpty(Cfg.Token) ? "Token apagado." : "Token salvo. Conferindo com o servidor...", false);
            ThreadPool.QueueUserWorkItem(_ => Tick());
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
            if (s == AgentState.Conectado) Log("Conectado ao Commandah. Aguardando fichas.", false);
            else if (s == AgentState.TokenInvalido) Log("Token inválido. Gere um token novo em Configurações › Impressoras e cole aqui.", true);
            else if (s == AgentState.SemConexao) Log("Sem conexão com o servidor. Tentando de novo...", true);
            Fire();
        }

        void Tick()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try
            {
                if (string.IsNullOrEmpty(Cfg.Token)) { SetState(AgentState.SemToken); return; }
                if ((DateTime.Now - lastPing).TotalSeconds >= 60 || State != AgentState.Conectado)
                {
                    var ok = api.Ping();
                    lastPing = DateTime.Now;
                    if (ok == false) { SetState(AgentState.TokenInvalido); return; }
                }
                var jobs = api.FetchPending();
                LastContact = DateTime.Now;
                SetState(AgentState.Conectado);
                foreach (var job in jobs) Handle(job);
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
                api.MarkStatus(job.Id, true);
                PrintedToday++;
                Log("Impresso em " + dest + ".", false);
            }
            catch (Exception e)
            {
                try { api.MarkStatus(job.Id, false); } catch (Exception) { }
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
