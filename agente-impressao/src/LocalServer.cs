// Atendimento local em http://127.0.0.1:9123 (só neste computador). É a reserva do
// Commandah quando a fila na nuvem não aceita a ficha (ex.: internet caiu no caixa):
//   GET  /status -> {"ok":true,"version":"..."}
//   POST /print  -> {"printer":"Nome no Windows","text":"...","ip":"opcional"}
// Feito sobre TcpListener (não precisa de permissão de administrador no Windows).
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Commandah.Agente
{
    public class LocalServer
    {
        readonly Agent agent;
        TcpListener listener;

        public LocalServer(Agent agent) { this.agent = agent; }

        public void Start()
        {
            try
            {
                listener = new TcpListener(IPAddress.Loopback, agent.Cfg.LocalPort);
                listener.Start();
                new Thread(Loop) { IsBackground = true, Name = "local-http" }.Start();
            }
            catch (Exception e)
            {
                agent.Log("Atendimento local (porta " + agent.Cfg.LocalPort + ") não iniciou: " + e.Message + ". A impressão pela nuvem continua funcionando.", true);
            }
        }

        void Loop()
        {
            while (true)
            {
                TcpClient c;
                try { c = listener.AcceptTcpClient(); } catch (Exception) { return; }
                ThreadPool.QueueUserWorkItem(_ => Serve(c));
            }
        }

        void Serve(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    var stream = client.GetStream();
                    string method, path; int length; byte[] body;
                    ReadRequest(stream, out method, out path, out length, out body);
                    if (method == "OPTIONS") { Send(stream, 204, ""); return; }
                    if (method == "GET" && path.StartsWith("/status"))
                    {
                        // agent_id/agent_name: o Commandah aberto neste computador descobre qual
                        // computador é (para "tudo que for lançado aqui sai na impressora do caixa").
                        var st = new Dictionary<string, object>();
                        st["ok"] = true; st["version"] = Config.Version; st["agent"] = "commandah";
                        st["agent_id"] = agent.Cfg.AgentId ?? ""; st["agent_name"] = agent.Cfg.AgentName ?? "";
                        st["connected"] = agent.State == AgentState.Conectado;
                        Send(stream, 200, new JavaScriptSerializer().Serialize(st));
                        return;
                    }
                    if (method == "POST" && path.StartsWith("/print"))
                    {
                        var d = new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
                        string printer = d.ContainsKey("printer") ? Convert.ToString(d["printer"]) : "";
                        string text = d.ContainsKey("text") ? Convert.ToString(d["text"]) : "";
                        string ip = d.ContainsKey("ip") ? Convert.ToString(d["ip"]) : "";
                        if (!string.IsNullOrEmpty(ip)) Printing.PrintNetwork(ip, text);
                        else
                        {
                            var win = Printing.FindWindowsPrinter(printer);
                            if (win == null) { Send(stream, 404, "{\"ok\":false,\"error\":\"impressora não encontrada\"}"); return; }
                            Printing.PrintWindows(win, text, "Commandah (local)");
                        }
                        agent.Log("Impresso pelo atendimento local em " + (string.IsNullOrEmpty(ip) ? printer : ip) + ".", false);
                        Send(stream, 200, "{\"ok\":true}");
                        return;
                    }
                    Send(stream, 404, "{\"ok\":false}");
                }
                catch (Exception e)
                {
                    try { Send(client.GetStream(), 500, "{\"ok\":false,\"error\":" + new JavaScriptSerializer().Serialize(e.Message) + "}"); } catch (Exception) { }
                }
            }
        }

        static void ReadRequest(NetworkStream s, out string method, out string path, out int length, out byte[] body)
        {
            var head = new MemoryStream();
            int b;
            while ((b = s.ReadByte()) != -1)
            {
                head.WriteByte((byte)b);
                long n = head.Length;
                if (n >= 4)
                {
                    var buf = head.GetBuffer();
                    if (buf[n - 4] == '\r' && buf[n - 3] == '\n' && buf[n - 2] == '\r' && buf[n - 1] == '\n') break;
                }
                if (n > 65536) throw new Exception("cabeçalho grande demais");
            }
            var lines = Encoding.ASCII.GetString(head.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = lines[0].Split(' ');
            method = first.Length > 0 ? first[0].ToUpperInvariant() : "";
            path = first.Length > 1 ? first[1] : "/";
            length = 0;
            foreach (var l in lines)
                if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(l.Substring(15).Trim(), out length);
            if (length > 4 * 1024 * 1024) throw new Exception("ficha grande demais");
            body = new byte[length];
            int read = 0;
            while (read < length)
            {
                int n = s.Read(body, read, length - read);
                if (n <= 0) break;
                read += n;
            }
        }

        static void Send(NetworkStream s, int status, string json)
        {
            var body = Encoding.UTF8.GetBytes(json);
            string reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 404 ? "Not Found" : "Error";
            var head = "HTTP/1.1 " + status + " " + reason + "\r\n" +
                       "Content-Type: application/json; charset=utf-8\r\n" +
                       "Access-Control-Allow-Origin: *\r\n" +
                       "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                       "Access-Control-Allow-Headers: Content-Type\r\n" +
                       "Access-Control-Allow-Private-Network: true\r\n" +
                       "Content-Length: " + body.Length + "\r\n" +
                       "Connection: close\r\n\r\n";
            var h = Encoding.ASCII.GetBytes(head);
            s.Write(h, 0, h.Length);
            s.Write(body, 0, body.Length);
            s.Flush();
        }
    }
}
