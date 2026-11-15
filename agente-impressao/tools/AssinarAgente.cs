// Ferramenta do dono: gera a chave de assinatura e publica o aviso assinado do agente.
// item 5 (auditoria 11/11). A chave privada fica fora do repositório.
//   AssinarAgente gerar-chave [--arquivo <caminho>]
//   AssinarAgente publicar [--chave <caminho>] [--exe <caminho>] [--saida <pasta>]
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Commandah.Agente;

static class AssinarAgente
{
    static string ChavePadrao
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".commandah", "agente-chave-privada.xml"); }
    }

    static string Opcao(string[] a, string nome, string padrao)
    {
        for (int i = 1; i < a.Length - 1; i++) if (a[i] == nome) return a[i + 1];
        return padrao;
    }

    static int Main(string[] a)
    {
        try
        {
            if (a.Length > 0 && a[0] == "gerar-chave") return Gerar(Opcao(a, "--arquivo", ChavePadrao));
            if (a.Length > 0 && a[0] == "publicar")
                return Publicar(Opcao(a, "--chave", ChavePadrao), Opcao(a, "--exe", @"dist\CommandahImpressora.exe"), Opcao(a, "--saida", @"..\downloads"));
            Console.Error.WriteLine("uso: AssinarAgente gerar-chave [--arquivo <caminho>] | publicar [--chave <caminho>] [--exe <caminho>] [--saida <pasta>]");
            return 1;
        }
        catch (Exception e) { Console.Error.WriteLine("erro: " + e.Message); return 1; }
    }

    static int Gerar(string arquivo)
    {
        if (File.Exists(arquivo)) { Console.Error.WriteLine("ja existe, nao sobrescrevo: " + arquivo); return 2; }
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(arquivo)));
        using (var rsa = new RSACryptoServiceProvider(2048))
        {
            rsa.PersistKeyInCsp = false;
            File.WriteAllText(arquivo, rsa.ToXmlString(true), new UTF8Encoding(false));
            Console.WriteLine(rsa.ToXmlString(false));
        }
        return 0;
    }

    static int Publicar(string chave, string exe, string saida)
    {
        if (!File.Exists(chave)) { Console.Error.WriteLine("chave nao encontrada: " + chave); return 1; }
        if (!File.Exists(exe)) { Console.Error.WriteLine("exe nao encontrado: " + exe); return 1; }
        string[] v = FileVersionInfo.GetVersionInfo(exe).FileVersion.Split('.');
        string versao = v[0] + "." + v[1] + "." + v[2];
        Directory.CreateDirectory(saida);
        string destino = Path.Combine(saida, "CommandahImpressora.exe");
        File.Copy(exe, destino, true);
        byte[] bin = File.ReadAllBytes(destino);

        var d = new Dictionary<string, object>();
        d["version"] = versao;
        d["url"] = "downloads/CommandahImpressora.exe";
        d["sha256"] = Updater.Sha256Hex(bin);
        d["size"] = (long)bin.Length;
        d["published_at"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");
        byte[] json = new UTF8Encoding(false).GetBytes(new JavaScriptSerializer().Serialize(d));

        string sig;
        using (var rsa = new RSACryptoServiceProvider())
        {
            rsa.PersistKeyInCsp = false;
            rsa.FromXmlString(File.ReadAllText(chave, Encoding.UTF8));
            sig = Convert.ToBase64String(rsa.SignData(json, "SHA256"));
        }
        File.WriteAllBytes(Path.Combine(saida, "agente-impressao.json"), json);
        File.WriteAllText(Path.Combine(saida, "agente-impressao.json.sig"), sig, new UTF8Encoding(false));
        Console.WriteLine("publicado " + versao + " em " + saida);
        return 0;
    }
}
