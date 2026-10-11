// Fala com o banco (Supabase) pelas funções do agente:
//   print_agent_pair_start / _pair_poll   -> conectar este computador por código (2.1)
//   print_agent_ping(token)               -> o token vale? (e carimba "visto agora")
//   print_agent_report(token, ...)        -> impressoras que este computador encontrou (2.1)
//   print_agent_fetch_pending(token)      -> fichas pendentes para este computador
//   print_agent_claim_job(token, id)      -> pega a ficha (pendente -> processando)
//   print_agent_mark_status(token, id, s, erro) -> 'impresso' ou 'erro' (com o motivo)
// O token vem da conexão por código (um por computador) ou, no modo antigo, de
// Configurações › Impressoras › Gerar/Regenerar token (um por estabelecimento).
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

namespace Commandah.Agente
{
    public class PrintJob
    {
        public string Id;
        public string PrinterName;
        public string PrinterIp;
        public string Content;
        public DateTime CreatedAt;
    }

    public class PingResult
    {
        public bool? Ok;      // null = servidor sem a função de checagem (banco antigo)
        public bool Rescan;   // o Commandah pediu para procurar impressoras de novo
        public string Name;   // nome deste computador no Commandah (vazio no modo antigo)
    }

    public class PairStart
    {
        public string Code;
        public string Secret;
        public DateTime ExpiresAt;
    }

    public class PairPoll
    {
        public string Status; // waiting | ok | expired
        public string Token;
        public string Name;
    }

    public class ApiException : Exception
    {
        public int Status;
        public ApiException(int status, string msg) : base(msg) { Status = status; }
    }

    public class Api
    {
        readonly Config cfg;
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        public Api(Config cfg)
        {
            this.cfg = cfg;
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        }

        object Rpc(string fn, Dictionary<string, object> args)
        {
            var req = (HttpWebRequest)WebRequest.Create(cfg.ApiUrl.TrimEnd('/') + "/rest/v1/rpc/" + fn);
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Headers["apikey"] = cfg.ApiKey;
            req.Headers["Authorization"] = "Bearer " + cfg.ApiKey;
            req.Timeout = 15000;
            req.ReadWriteTimeout = 15000;
            var body = Encoding.UTF8.GetBytes(json.Serialize(args));
            req.ContentLength = body.Length;
            using (var s = req.GetRequestStream()) s.Write(body, 0, body.Length);
            try
            {
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    var text = r.ReadToEnd();
                    return string.IsNullOrEmpty(text) ? null : json.DeserializeObject(text);
                }
            }
            catch (WebException e)
            {
                var resp = e.Response as HttpWebResponse;
                if (resp == null) throw new ApiException(0, "Sem conexão com o servidor (" + e.Status + ")");
                string text;
                using (var r = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) text = r.ReadToEnd();
                throw new ApiException((int)resp.StatusCode, "Servidor respondeu " + (int)resp.StatusCode + ": " + text);
            }
        }

        static Dictionary<string, object> Args(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            return d;
        }

        public PingResult Ping()
        {
            try
            {
                var r = Rpc("print_agent_ping", Args("p_token", cfg.Token)) as Dictionary<string, object>;
                return new PingResult { Ok = r != null && Bool(r, "ok"), Rescan = r != null && Bool(r, "rescan"), Name = r == null ? "" : Str(r, "name") };
            }
            catch (ApiException e)
            {
                if (e.Status == 404) return new PingResult { Ok = null };
                throw;
            }
        }

        public PairStart StartPairing(string machine)
        {
            var r = Rpc("print_agent_pair_start", Args("p_machine", machine, "p_version", Config.Version)) as Dictionary<string, object>;
            if (r == null || Str(r, "code").Length == 0) throw new ApiException(0, "O servidor não devolveu o código.");
            var p = new PairStart { Code = Str(r, "code"), Secret = Str(r, "secret"), ExpiresAt = DateTime.Now.AddMinutes(30) };
            DateTime exp;
            if (DateTime.TryParse(Str(r, "expires_at"), out exp)) p.ExpiresAt = exp;
            return p;
        }

        public PairPoll PollPairing(string code, string secret)
        {
            var r = Rpc("print_agent_pair_poll", Args("p_code", code, "p_secret", secret)) as Dictionary<string, object>;
            if (r == null) return new PairPoll { Status = "expired" };
            return new PairPoll { Status = Str(r, "status"), Token = Str(r, "token"), Name = Str(r, "name") };
        }

        // network = null: não varreu a rede agora (o servidor mantém o que já sabia).
        // Devolve false quando o token é o do estabelecimento (modo antigo, sem configuração automática).
        public bool Report(string machine, List<string> windows, List<string> network)
        {
            var r = Rpc("print_agent_report", Args("p_token", cfg.Token, "p_machine", machine, "p_version", Config.Version,
                "p_windows", windows ?? new List<string>(), "p_network", network)) as Dictionary<string, object>;
            return r != null && Bool(r, "ok");
        }

        public List<PrintJob> FetchPending()
        {
            var list = new List<PrintJob>();
            var arr = Rpc("print_agent_fetch_pending", Args("p_token", cfg.Token)) as object[];
            if (arr == null) return list;
            foreach (var o in arr)
            {
                var d = o as Dictionary<string, object>;
                if (d == null) continue;
                var j = new PrintJob();
                j.Id = Str(d, "id");
                j.PrinterName = Str(d, "printer_name");
                j.PrinterIp = Str(d, "printer_ip");
                j.Content = Str(d, "content");
                DateTime.TryParse(Str(d, "created_at"), out j.CreatedAt);
                if (!string.IsNullOrEmpty(j.Id)) list.Add(j);
            }
            return list;
        }

        public bool Claim(string jobId)
        {
            var r = Rpc("print_agent_claim_job", Args("p_token", cfg.Token, "p_job_id", jobId));
            return r is bool && (bool)r;
        }

        public void MarkStatus(string jobId, bool ok, string error)
        {
            var args = Args("p_token", cfg.Token, "p_job_id", jobId, "p_status", ok ? "impresso" : "erro");
            if (!ok && !string.IsNullOrEmpty(error)) args["p_error"] = error;
            Rpc("print_agent_mark_status", args);
        }

        static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : "";
        }

        static bool Bool(Dictionary<string, object> d, string k)
        {
            object v;
            return d.TryGetValue(k, out v) && v is bool && (bool)v;
        }
    }
}
