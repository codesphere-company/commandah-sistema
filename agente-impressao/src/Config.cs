// Configuração do agente: token (guardado cifrado com a conta do Windows) e opções.
// Fica em %APPDATA%\Commandah\agente-impressao.json, um por usuário do Windows.
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace Commandah.Agente
{
    public class Config
    {
        public const string Version = "2.3.0";
        public const string DefaultApiUrl = "https://ezfoymdesmarpunmixbs.supabase.co";
        public const string DefaultApiKey = "sb_publishable_m56iV0j3aIHlj_jth44jyw_CIw7CmyG";
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string RunName = "CommandahImpressora";

        public string Token = "";
        public string AgentName = ""; // nome no Commandah quando conectado por código (vazio = token do estabelecimento)
        public string AgentId = "";   // id deste computador no Commandah (o navegador deste PC lê em /status)
        public string ApiUrl = DefaultApiUrl;
        public string ApiKey = DefaultApiKey;
        public int PollSeconds = 3;
        public int LocalPort = 9123;
        public string PrintToFileDir = ""; // só para teste: imprime em arquivo em vez da impressora
        public bool IsNew; // primeira vez neste computador (sem arquivo de configuração)

        // COMMANDAH_AGENT_DIR: só para teste (configuração numa pasta à parte).
        static string Dir
        {
            get
            {
                var test = Environment.GetEnvironmentVariable("COMMANDAH_AGENT_DIR");
                return !string.IsNullOrEmpty(test) ? test : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Commandah");
            }
        }
        static string FilePath { get { return Path.Combine(Dir, "agente-impressao.json"); } }

        public static Config Load()
        {
            var c = new Config();
            try
            {
                if (!File.Exists(FilePath)) { c.IsNew = true; return c; }
                var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(FilePath, Encoding.UTF8));
                object v;
                if (d.TryGetValue("tokenProtected", out v) && v is string && ((string)v).Length > 0)
                    c.Token = Unprotect((string)v);
                if (d.TryGetValue("agentName", out v) && v is string) c.AgentName = (string)v;
                if (d.TryGetValue("agentId", out v) && v is string) c.AgentId = (string)v;
                if (d.TryGetValue("apiUrl", out v) && v is string && ((string)v).Length > 0) c.ApiUrl = (string)v;
                if (d.TryGetValue("apiKey", out v) && v is string && ((string)v).Length > 0) c.ApiKey = (string)v;
                if (d.TryGetValue("pollSeconds", out v) && v is int && (int)v >= 1) c.PollSeconds = (int)v;
                if (d.TryGetValue("printToFileDir", out v) && v is string) c.PrintToFileDir = (string)v;
            }
            catch (Exception) { /* arquivo estragado: começa do zero */ }
            return c;
        }

        public void Save()
        {
            Directory.CreateDirectory(Dir);
            var d = new Dictionary<string, object>();
            d["tokenProtected"] = string.IsNullOrEmpty(Token) ? "" : Protect(Token);
            if (!string.IsNullOrEmpty(AgentName)) d["agentName"] = AgentName;
            if (!string.IsNullOrEmpty(AgentId)) d["agentId"] = AgentId;
            if (ApiUrl != DefaultApiUrl) d["apiUrl"] = ApiUrl;
            if (ApiKey != DefaultApiKey) d["apiKey"] = ApiKey;
            if (PollSeconds != 3) d["pollSeconds"] = PollSeconds;
            if (!string.IsNullOrEmpty(PrintToFileDir)) d["printToFileDir"] = PrintToFileDir;
            File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(d), Encoding.UTF8);
        }

        static string Protect(string s)
        {
            var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(s), null, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(bytes);
        }

        static string Unprotect(string s)
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(s), null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }

        public static bool StartsWithWindows
        {
            get
            {
                using (var k = Registry.CurrentUser.OpenSubKey(RunKey))
                    return k != null && k.GetValue(RunName) != null;
            }
            set
            {
                using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (value) k.SetValue(RunName, "\"" + System.Windows.Forms.Application.ExecutablePath + "\" --minimizado");
                    else if (k.GetValue(RunName) != null) k.DeleteValue(RunName);
                }
            }
        }
    }
}
