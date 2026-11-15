// Atualização do agente: parte pura (aviso assinado, comparação de versão, hash).
// item 5 (auditoria 11/11): o aviso só vale se a assinatura RSA bater com a chave pública embutida.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace Commandah.Agente
{
    public class Aviso
    {
        public string Version, Url, Sha256, PublishedAt;
        public long Size;
    }

    // O fluxo (baixar, trocar, reabrir) fica em UpdaterFluxo.cs: este arquivo também entra na AssinarAgente.
    public partial class Updater
    {
        // Devolve null se a assinatura não bate, se o JSON é inválido ou se falta campo.
        public static Aviso LerAvisoAssinado(byte[] json, string sigBase64, string publicKeyXml)
        {
            try
            {
                if (json == null || string.IsNullOrEmpty(sigBase64) || string.IsNullOrEmpty(publicKeyXml)) return null;
                // chave privada colada no lugar da pública: recusa (iria para todos os caixas)
                if (publicKeyXml.Contains("<D>") || publicKeyXml.Contains("<P>")) return null;
                byte[] sig = Convert.FromBase64String(sigBase64.Trim());
                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.PersistKeyInCsp = false;
                    rsa.FromXmlString(publicKeyXml);
                    if (!rsa.VerifyData(json, "SHA256", sig)) return null;
                }
                var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new UTF8Encoding(false).GetString(json));
                var a = new Aviso();
                a.Version = Texto(d, "version");
                a.Url = Texto(d, "url");
                a.Sha256 = Texto(d, "sha256");
                a.PublishedAt = Texto(d, "published_at");
                object sz;
                if (!d.TryGetValue("size", out sz) || sz == null) return null;
                a.Size = Convert.ToInt64(sz);
                if (a.Version == null || a.Url == null || a.Sha256 == null || a.PublishedAt == null || a.Size <= 0) return null;
                if (!System.Text.RegularExpressions.Regex.IsMatch(a.Sha256, "^[0-9a-f]{64}$")) return null;
                return a;
            }
            catch (Exception) { return null; }
        }

        static string Texto(Dictionary<string, object> d, string k)
        {
            object v;
            string s = d.TryGetValue(k, out v) ? v as string : null;
            return string.IsNullOrEmpty(s) ? null : s;
        }

        // Compara número a número (a.b.c). Texto inválido dá false.
        public static bool VersaoMaior(string nova, string atual)
        {
            int[] n = Partes(nova), a = Partes(atual);
            if (n == null || a == null) return false;
            for (int i = 0; i < 3; i++)
                if (n[i] != a[i]) return n[i] > a[i];
            return false;
        }

        static int[] Partes(string v)
        {
            if (string.IsNullOrEmpty(v)) return null;
            string[] p = v.Trim().Split('.');
            if (p.Length > 4) return null;
            var r = new int[3];
            for (int i = 0; i < p.Length; i++)
            {
                int x;
                if (!int.TryParse(p[i], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out x)) return null;
                if (i < 3) r[i] = x;
            }
            return r;
        }

        public static string Sha256Hex(byte[] dados)
        {
            using (var sha = SHA256.Create())
            {
                var sb = new StringBuilder();
                foreach (byte b in sha.ComputeHash(dados)) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }
    }
}
