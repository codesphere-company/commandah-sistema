// Testes do agente (sem framework). Compilar com build-testes.cmd e rodar dist\Testes.exe.
// Os próximos casos entram em Principal.Main, chamando Testes.Ok(condição, nome).
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

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
            TestesFluxo();

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

            Testes.Ok(Updater.LerAvisoAssinado(bytes, sig, priv) == null, "chave privada como publica recusada");
            Testes.Ok(!Config.UpdatePublicKey.Contains("<D>") && !Config.UpdatePublicKey.Contains("<P>"), "Config.UpdatePublicKey sem parte privada");
            string[] jsRuins = {
                "{\"version\":\"2.5.0\",\"url\":\"u\",\"sha256\":\"" + new string('A', 64) + "\",\"size\":1,\"published_at\":\"x\"}",
                "{\"version\":\"2.5.0\",\"url\":\"u\",\"sha256\":\"abc\",\"size\":1,\"published_at\":\"x\"}",
                "{\"version\":\"2.5.0\",\"url\":\"u\",\"sha256\":\"" + new string('a', 64) + "\",\"size\":0,\"published_at\":\"x\"}" };
            foreach (var jr in jsRuins)
            {
                byte[] jb = Encoding.UTF8.GetBytes(jr);
                Testes.Ok(Updater.LerAvisoAssinado(jb, Assina(jb, priv), PubDe(priv)) == null, "aviso com sha256/size invalido");
            }

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

            // aviso publicado em ..\downloads confere com a chave embutida (so roda quando a pasta existe)
            string dl = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"..\..\downloads"));
            string jp = Path.Combine(dl, "agente-impressao.json");
            if (File.Exists(jp) && File.Exists(jp + ".sig"))
            {
                var avPub = Updater.LerAvisoAssinado(File.ReadAllBytes(jp), File.ReadAllText(jp + ".sig").Trim(), Config.UpdatePublicKey);
                Testes.Ok(avPub != null && avPub.Version == Config.Version, "aviso publicado confere: versao");
                Testes.Ok(avPub != null && avPub.Sha256 == Updater.Sha256Hex(File.ReadAllBytes(Path.Combine(dl, "CommandahImpressora.exe"))), "aviso publicado confere: sha256 do exe");
            }
        }

        // ---------- item 5 (auditoria 11/11): fluxo de atualização ----------
        // Pasta temporária com downloads/ (aviso + exe "novo") servida por file:/// e uma pasta do agente
        // com o exe "atual". Nada toca em %USERPROFILE%\.commandah nem na pasta real do agente.
        class Cena : IDisposable
        {
            public string Raiz, Base, Pasta, Exe, Priv, Pub;
            public Agent Agente;
            public Cena(string priv)
            {
                Raiz = Path.Combine(Path.GetTempPath(), "atualiza-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(Path.Combine(Raiz, "site", "downloads"));
                Pasta = Path.Combine(Raiz, "agente");
                Directory.CreateDirectory(Pasta);
                Exe = Path.Combine(Pasta, "CommandahImpressora.exe");
                File.WriteAllText(Exe, "versao velha");
                Base = new Uri(Path.Combine(Raiz, "site") + "\\").AbsoluteUri;
                Priv = priv; Pub = PubDe(priv);
                Agente = new Agent(new Config());
            }
            public string Downloads(string nome) { return Path.Combine(Raiz, "site", "downloads", nome); }
            // publica o exe "novo" e um aviso; sha/size/url/chave podem ser forçados para os casos ruins
            public void Publica(byte[] novo, string versao, string sha, long size, string url, string chaveAssina)
            {
                File.WriteAllBytes(Downloads("CommandahImpressora.exe"), novo);
                string json = "{\"version\":\"" + versao + "\",\"url\":\"" + url + "\",\"sha256\":\"" + (sha ?? Updater.Sha256Hex(novo)) +
                              "\",\"size\":" + (size > 0 ? size : novo.Length) + ",\"published_at\":\"2026-11-14T10:00:00Z\"}";
                byte[] jb = new UTF8Encoding(false).GetBytes(json);
                File.WriteAllBytes(Downloads("agente-impressao.json"), jb);
                File.WriteAllText(Downloads("agente-impressao.json.sig"), Assina(jb, chaveAssina ?? Priv));
            }
            public Updater Novo(string chave)
            {
                var u = new Updater(Agente, Base, chave, Exe);
                u.Reiniciar = false;
                u.EsperaOcupado = TimeSpan.FromMilliseconds(50);
                u.LimiteOcupado = TimeSpan.FromMilliseconds(300);
                return u;
            }
            public string Old { get { return Path.Combine(Pasta, "CommandahImpressora.old.exe"); } }
            public string New { get { return Path.Combine(Pasta, "CommandahImpressora.new.exe"); } }
            public void Dispose()
            {
                for (int i = 0; i < 40; i++)
                {
                    try { Directory.Delete(Raiz, true); return; } catch (Exception) { Thread.Sleep(250); }
                }
            }
        }

        const string UrlCerta = "downloads/CommandahImpressora.exe";

        static bool TemLog(Agent a, string trecho)
        {
            foreach (var e in a.Entries()) if (e.Text.Contains(trecho)) return true;
            return false;
        }

        // Exe minúsculo para o teste de reabrir: grava os argumentos e fica vivo "ms" milissegundos.
        static byte[] ExeDeTeste(string pasta, int ms)
        {
            string saida = Path.Combine(pasta, "teste-" + ms + ".exe");
            var cp = new Microsoft.CSharp.CSharpCodeProvider();
            var op = new System.CodeDom.Compiler.CompilerParameters(new[] { "System.dll" }, saida) { GenerateExecutable = true };
            string src = "using System; using System.IO; class P { static void Main(string[] a) { " +
                         "File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, \"args.txt\"), string.Join(\" \", a)); " +
                         "System.Threading.Thread.Sleep(" + ms + "); } }";
            var r = cp.CompileAssemblyFromSource(op, src);
            if (r.Errors.HasErrors) throw new Exception("não compilou o exe de teste: " + r.Errors[0].ErrorText);
            byte[] b = File.ReadAllBytes(saida);
            File.Delete(saida);
            return b;
        }

        static void TestesFluxo()
        {
            string priv = Chave(true), outraPriv = Chave(true);
            byte[] novo = Encoding.UTF8.GetBytes("versao nova 9.9.9");

            using (var c = new Cena(priv))
            {
                c.Publica(novo, "9.9.9", null, 0, UrlCerta, null);
                var r = c.Novo(c.Pub).ProcurarEAplicar(false);
                Testes.Ok(r == ResultadoAtualizacao.Trocado, "troca quando ha versao nova (" + r + ")");
                Testes.Ok(File.Exists(c.Exe) && File.ReadAllText(c.Exe) == "versao nova 9.9.9", "troca: atual tem o novo");
                Testes.Ok(File.Exists(c.Old) && File.ReadAllText(c.Old) == "versao velha", "troca: .old tem o antigo");
                Testes.Ok(!File.Exists(c.New), "troca: sem .new.exe sobrando");
            }

            using (var c = new Cena(priv))
            {
                c.Publica(novo, "9.9.9", new string('b', 64), 0, UrlCerta, null);
                var r = c.Novo(c.Pub).ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.BaixouErrado, "sha errado nao troca (" + r + ")");
                Testes.Ok(!File.Exists(c.New) && !File.Exists(c.Old), "sha errado: .new apagado, sem .old");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha", "sha errado: atual intacto");
            }

            using (var c = new Cena(priv))
            {
                // aviso diz menos bytes do que chegam: para de baixar (limite de tamanho)
                c.Publica(novo, "9.9.9", null, novo.Length - 3, UrlCerta, null);
                var r = c.Novo(c.Pub).ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.BaixouErrado, "tamanho maior que o aviso nao troca (" + r + ")");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha" && !File.Exists(c.New), "tamanho: atual intacto");
                c.Publica(novo, "9.9.9", null, novo.Length + 3, UrlCerta, null);
                r = c.Novo(c.Pub).ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.BaixouErrado, "tamanho menor que o aviso nao troca (" + r + ")");
            }

            using (var c = new Cena(priv))
            {
                c.Publica(novo, "0.0.1", null, 0, UrlCerta, null);
                var r = c.Novo(c.Pub).ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.SemNovidade, "nao rebaixa no fluxo (" + r + ")");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha", "nao rebaixa: atual intacto");
            }

            using (var c = new Cena(priv))
            {
                c.Publica(novo, "9.9.9", null, 0, UrlCerta, outraPriv);
                var r = c.Novo(c.Pub).ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.AvisoInvalido, "aviso sem assinatura valida (" + r + ")");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha" && !File.Exists(c.New), "assinatura: atual intacto");
            }

            using (var c = new Cena(priv))
            {
                // a url do aviso nunca escolhe de onde baixar: diferente da esperada, recusa
                foreach (var u in new[] { "https://evil.com/CommandahImpressora.exe", "downloads/../x.exe", "downloads/CommandahImpressora.EXE" })
                {
                    c.Publica(novo, "9.9.9", null, 0, u, null);
                    var r = c.Novo(c.Pub).ProcurarEAplicar(true);
                    Testes.Ok(r == ResultadoAtualizacao.AvisoInvalido, "url diferente recusada: " + u + " (" + r + ")");
                }
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha", "url: atual intacto");
            }

            using (var c = new Cena(priv))
            {
                c.Publica(novo, "9.9.9", null, 0, UrlCerta, null);
                var u = new Updater(c.Agente, c.Base, c.Pub, Path.Combine(c.Raiz, "nao-existe", "CommandahImpressora.exe"));
                u.Reiniciar = false;
                var r = u.ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.PastaSemEscrita, "pasta sem escrita avisa (" + r + ")");
                Testes.Ok(TemLog(c.Agente, "Atualização 9.9.9 disponível: baixe pelo Commandah"), "pasta sem escrita: texto no histórico");
                Testes.Ok(u.Situacao.Contains("Atualização 9.9.9 disponível: baixe pelo Commandah"), "pasta sem escrita: texto na janela");
            }

            using (var c = new Cena(priv))
            {
                c.Publica(novo, "9.9.9", null, 0, UrlCerta, null);
                c.Agente.EntrouOcupado();
                var u = c.Novo(c.Pub);
                var t0 = DateTime.Now;
                var r = u.ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.Ocupado, "ocupado espera (" + r + ")");
                Testes.Ok((DateTime.Now - t0).TotalMilliseconds >= 250, "ocupado: esperou o limite");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha" && !File.Exists(c.New) && !File.Exists(c.Old), "ocupado: nao trocou");
                Testes.Ok(!c.Agente.Pausado, "ocupado: agente nao ficou pausado");
                c.Agente.SaiuOcupado();
            }

            using (var c = new Cena(priv))
            {
                c.Publica(novo, "9.9.9", null, 0, UrlCerta, null);
                var r = c.Novo("").ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.Desligado, "chave vazia (" + r + ")");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha", "chave vazia: atual intacto");
            }

            // o novo exe fecha logo (ex.: Smart App Control bloqueou): volta para a versão atual e não encerra
            using (var c = new Cena(priv))
            {
                c.Publica(ExeDeTeste(c.Raiz, 0), "9.9.9", null, 0, UrlCerta, null);
                var u = c.Novo(c.Pub);
                u.Reiniciar = true;
                u.JanelaAbertura = TimeSpan.FromSeconds(5);
                bool encerrou = false;
                u.Encerrar = () => encerrou = true;
                var r = u.ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.NaoAbriu, "nao abriu volta (" + r + ")");
                Testes.Ok(File.Exists(c.Exe) && File.ReadAllText(c.Exe) == "versao velha", "nao abriu: atual restaurado");
                Testes.Ok(!File.Exists(c.Old) && !File.Exists(c.New), "nao abriu: sem .old nem .new");
                Testes.Ok(!encerrou, "nao abriu: nao encerrou o agente");
                Testes.Ok(!c.Agente.Pausado, "nao abriu: agente voltou a imprimir");
                Testes.Ok(TemLog(c.Agente, "Atualização para 9.9.9 não abriu; voltei para a versão " + Config.Version), "nao abriu: log");
            }

            // o novo exe continua aberto depois da janela: encerra este (com os argumentos certos)
            using (var c = new Cena(priv))
            {
                c.Publica(ExeDeTeste(c.Raiz, 4000), "9.9.9", null, 0, UrlCerta, null);
                var u = c.Novo(c.Pub);
                u.Reiniciar = true;
                u.JanelaAbertura = TimeSpan.FromSeconds(1.5);
                bool encerrou = false;
                u.Encerrar = () => encerrou = true;
                var r = u.ProcurarEAplicar(true);
                Testes.Ok(r == ResultadoAtualizacao.Trocado, "abriu e encerra (" + r + ")");
                Testes.Ok(encerrou, "abriu: pediu para encerrar");
                Testes.Ok(c.Agente.Pausado, "abriu: agente fica pausado ate fechar");
                string args = File.Exists(Path.Combine(c.Pasta, "args.txt")) ? File.ReadAllText(Path.Combine(c.Pasta, "args.txt")) : "";
                Testes.Ok(args == "--minimizado --pos-atualizacao", "abriu: argumentos (" + args + ")");
                Testes.Ok(File.Exists(c.Old) && File.ReadAllText(c.Old) == "versao velha", "abriu: .old guardado");
                Thread.Sleep(3000); // deixa o exe de teste terminar antes de apagar a pasta
            }

            // limpeza na abertura: logo depois de atualizar o .old fica; numa abertura normal sai
            using (var c = new Cena(priv))
            {
                File.WriteAllText(c.New, "n"); File.WriteAllText(c.Old, "o");
                Updater.LimparSobras(c.Exe, true);
                Testes.Ok(File.Exists(c.Old) && !File.Exists(c.New), "limpar pos-atualizacao: .old fica, .new sai");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha", "limpar pos-atualizacao: atual intacto");
                File.WriteAllText(c.New, "n");
                Updater.LimparSobras(c.Exe, false);
                Testes.Ok(!File.Exists(c.Old) && !File.Exists(c.New), "limpar abertura normal: .old e .new saem");
                Testes.Ok(File.ReadAllText(c.Exe) == "versao velha", "limpar abertura normal: atual intacto");
            }

            // TrocarArquivos sozinho
            using (var c = new Cena(priv))
            {
                File.WriteAllText(c.New, "n");
                File.WriteAllText(c.Old, "lixo de antes");
                Testes.Ok(Updater.TrocarArquivos(c.Exe, c.New), "TrocarArquivos: true");
                Testes.Ok(File.ReadAllText(c.Exe) == "n" && File.ReadAllText(c.Old) == "versao velha" && !File.Exists(c.New), "TrocarArquivos: renomeou");
                Testes.Ok(!Updater.TrocarArquivos(c.Exe, Path.Combine(c.Pasta, "nao-tem.exe")), "TrocarArquivos: sem novo da false");
                Testes.Ok(File.ReadAllText(c.Exe) == "n", "TrocarArquivos: sem novo nao mexe");
            }
        }

        static string PubDe(string privXml)
        {
            using (var r = new RSACryptoServiceProvider()) { r.PersistKeyInCsp = false; r.FromXmlString(privXml); return r.ToXmlString(false); }
        }
    }
}
