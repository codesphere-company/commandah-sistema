// Testes do agente (sem framework). Compilar com build-testes.cmd e rodar dist\Testes.exe.
// Os próximos casos entram em Principal.Main, chamando Testes.Ok(condição, nome).
using System;

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

            Console.WriteLine(Testes.Passou + " ok, " + Testes.Falhou + " falha(s)");
            return Testes.Falhou == 0 ? 0 : 1;
        }
    }
}
