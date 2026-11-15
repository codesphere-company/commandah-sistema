// Testes do agente (sem framework). Compilar com build-testes.cmd e rodar dist\Testes.exe.
// Os próximos casos entram em Principal.Main, chamando Testes.Ok(condição, nome).
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Commandah.Agente.Testes
{
    public static class Testes
    {
        public static int Passou, Falhou;

        public static void Ok(bool cond, string nome)
        {
            if (cond) { Passou++; return; }
            Falhou++;
            Console.WriteLine("FALHOU: " + nome);
        }
    }

    public static class Principal
    {
        public static int Main()
        {
            // item 5 (auditoria 11/11): impressão só na rede interna
            foreach (var ok in new[] { "192.168.110.111", "192.168.110.111:9101", "10.0.0.5", "172.16.0.1", "172.31.255.255" })
                Testes.Ok(Printing.EnderecoPermitido(ok), "endereco aceito: " + ok);
            foreach (var no in new[] { "172.15.0.1", "172.32.0.1", "8.8.8.8", "127.0.0.1", "169.254.1.1", "impressora.local", "::1",
                                       "192.168.0.1:0", "192.168.0.1:70000", "", null, "192.168.1", "192.168.0.1:abc", "0192.168.0.1x" })
                Testes.Ok(!Printing.EnderecoPermitido(no), "endereco recusado: " + (no ?? "(null)"));

            // item 5 (auditoria 11/11): só o Commandah fala com o atendimento local
            foreach (var ok in new[] { "https://codesphere-company.github.io", "http://localhost:5500", "http://localhost", "http://127.0.0.1", "http://127.0.0.1:8080" })
                Testes.Ok(LocalServer.OrigemPermitida(ok), "origem aceita: " + ok);
            foreach (var no in new[] { "https://codesphere-company.github.io.evil.com", "http://codesphere-company.github.io", "https://evil.com", "null",
                                       "http://localhost.evil.com", "http://localhost:abc", "https://codesphere-company.github.io:444" })
                Testes.Ok(!LocalServer.OrigemPermitida(no), "origem recusada: " + no);

            // cabeçalhos CORS: origem ecoada, sem "*"
            string c1 = LocalServer.CabecalhosCors("https://codesphere-company.github.io");
            Testes.Ok(c1.Contains("Access-Control-Allow-Origin: https://codesphere-company.github.io\r\n"), "cors: ecoa origem");
            Testes.Ok(c1.Contains("Vary: Origin"), "cors: Vary");
            Testes.Ok(c1.Contains("Access-Control-Allow-Private-Network: true"), "cors: private network");
            Testes.Ok(!c1.Contains("*"), "cors: sem asterisco");
            string c2 = LocalServer.CabecalhosCors(null);
            Testes.Ok(!c2.Contains("Access-Control-Allow-Origin"), "cors: sem origem nao manda Allow-Origin");
            Testes.Ok(c2.Contains("Access-Control-Allow-Methods"), "cors: sem origem mantem Methods");
            Testes.Ok(!LocalServer.CabecalhosCors("https://evil.com").Contains("Access-Control-Allow-Origin"), "cors: origem recusada nao ecoa");

            TestesAviso();

            Console.WriteLine(Testes.Passou + " ok, " + Testes.Falhou + " falha(s)");
            return Testes.Falhou == 0 ? 0 : 1;
        }

        static string Chave(bool privada)
        {
            using (var r = new RSACryptoServiceProvider(2048)) { r.PersistKeyInCsp = false; return r.ToXmlString(privada); }
        }

        static string Assina(byte[] dados, string chavePrivada)
        {
            using (var r = new RSACryptoServiceProvider()) { r.PersistKeyInCsp = false; r.FromXmlString(chavePrivada); return Convert.ToBase64String(r.SignData(dados, "SHA256")); }
        }

        static int Roda(string exe, string args, out string saida)
        {
            var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true };
            using (var p = Process.Start(psi)) { saida = p.StandardOutput.ReadToEnd(); p.WaitForExit(); return p.ExitCode; }
        }

        // item 5 (auditoria 11/11): aviso de versão assinado
        static void TestesAviso()
        {
            string priv = Chave(true), pub = Chave(false);
            string outra = Chave(false);
            string json = "{\"version\":\"2.5.0\",\"url\":\"downloads/CommandahImpressora.exe\",\"sha256\":\"" + new string('a', 64) + "\",\"size\":123,\"published_at\":\"2026-11-14T10:00:00Z\"}";
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            string sig = Assina(bytes, priv);
            var a = Updater.LerAvisoAssinado(bytes, sig, PubDe(priv));
            Testes.Ok(a != null && a.Version == "2.5.0" && a.Size == 123 && a.Url == "downloads/CommandahImpressora.exe", "aviso valido");
            var ruim = (byte[])bytes.Clone(); ruim[12] ^= 1;
            Testes.Ok(Updater.LerAvisoAssinado(ruim, sig, PubDe(priv)) == null, "aviso adulterado");
            Testes.Ok(Updater.LerAvisoAssinado(bytes, sig, outra) == null, "chave errada");
            Testes.Ok(Updater.LerAvisoAssinado(bytes, "nao-e-base64!", PubDe(priv)) == null, "assinatura invalida");
            Testes.Ok(Updater.LerAvisoAssinado(bytes, sig, "") == null, "sem chave publica");
            byte[] faltando = Encoding.UTF8.GetBytes("{\"version\":\"2.5.0\"}");
            Testes.Ok(Updater.LerAvisoAssinado(faltando, Assina(faltando, priv), PubDe(priv)) == null, "aviso sem campos");

            Testes.Ok(!Updater.VersaoMaior("2.3.9", "2.4.0"), "nao rebaixa: menor");
            Testes.Ok(!Updater.VersaoMaior("2.4.0", "2.4.0"), "nao rebaixa: igual");
            Testes.Ok(Updater.VersaoMaior("2.4.1", "2.4.0"), "versao maior");
            Testes.Ok(Updater.VersaoMaior("2.10.0", "2.9.0"), "versao maior numerica");
            Testes.Ok(!Updater.VersaoMaior("x", "2.4.0"), "versao invalida");
            Testes.Ok(Updater.Sha256Hex(Encoding.ASCII.GetBytes("abc")) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256");

            // ferramenta ponta a ponta (só com caminhos temporários)
            string dist = AppDomain.CurrentDomain.BaseDirectory;
            string ferr = Path.Combine(dist, "AssinarAgente.exe"), agente = Path.Combine(dist, "CommandahImpressora.exe");
            string tmp = Path.Combine(Path.GetTempPath(), "assinar-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            try
            {
                string o, k = Path.Combine(tmp, "k.xml"), saida = Path.Combine(tmp, "saida");
                Testes.Ok(Roda(ferr, "gerar-chave --arquivo \"" + k + "\"", out o) == 0, "ferramenta: gerar-chave");
                string pubImpressa = o.Trim();
                Testes.Ok(Roda(ferr, "gerar-chave --arquivo \"" + k + "\"", out o) == 2, "ferramenta: nao sobrescreve chave");
                Testes.Ok(Roda(ferr, "publicar --chave \"" + k + "\" --exe \"" + agente + "\" --saida \"" + saida + "\"", out o) == 0, "ferramenta: publicar");
                byte[] j = File.ReadAllBytes(Path.Combine(saida, "agente-impressao.json"));
                string s = File.ReadAllText(Path.Combine(saida, "agente-impressao.json.sig")).Trim();
                var r = Updater.LerAvisoAssinado(j, s, pubImpressa);
                Testes.Ok(r != null && r.Version == Config.Version, "ferramenta: versao do aviso");
                Testes.Ok(r != null && r.Sha256 == Updater.Sha256Hex(File.ReadAllBytes(Path.Combine(saida, "CommandahImpressora.exe"))), "ferramenta: sha256 do exe copiado");
                Testes.Ok(j.Length > 3 && !(j[0] == 0xEF && j[1] == 0xBB), "ferramenta: json sem BOM");
            }
            finally { try { Directory.Delete(tmp, true); } catch (Exception) { } }
        }

        static string PubDe(string privXml)
        {
            using (var r = new RSACryptoServiceProvider()) { r.PersistKeyInCsp = false; r.FromXmlString(privXml); return r.ToXmlString(false); }
        }
    }
}
