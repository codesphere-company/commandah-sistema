// Impressão das fichas que o Commandah monta.
// - Impressora de rede (a ficha tem IP): o texto já vem em ESC/POS (sem acento, com corte);
//   o byte nulo dos comandos chega como 0x01 (o banco não aceita 0x00) e volta a ser 0x00
//   aqui. Vai direto para a porta 9100 da impressora (ou a porta escrita depois do IP).
// - Impressora do Windows (sem IP): texto simples, impresso pelo driver com fonte de
//   largura fixa ajustada à largura do papel. Acentos saem certos.
//   2.3: ESC/POS com QR Code (cupom da NFC-e) vai "cru" (RAW) para o driver.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.Linq;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

namespace Commandah.Agente
{
    public static class Printing
    {
        public const char NulPlaceholder = (char)0x01;
        public static string PrintToFileDir = "";

        public static List<string> WindowsPrinters()
        {
            var list = new List<string>();
            foreach (string p in PrinterSettings.InstalledPrinters) list.Add(p);
            return list;
        }

        public static string FindWindowsPrinter(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            foreach (string p in PrinterSettings.InstalledPrinters)
                if (string.Equals(p.Trim(), name.Trim(), StringComparison.OrdinalIgnoreCase)) return p;
            return null;
        }

        public static bool LooksLikeEscPos(string text)
        {
            return !string.IsNullOrEmpty(text) && text.StartsWith("\x1B\x40");
        }

        public static void PrintNetwork(string ipAndPort, string content)
        {
            string host = ipAndPort.Trim();
            int port = 9100;
            int colon = host.LastIndexOf(':');
            if (colon > 0)
            {
                int p;
                if (int.TryParse(host.Substring(colon + 1), out p)) { port = p; host = host.Substring(0, colon); }
            }
            var bytes = EscPosBytes(content);
            using (var client = new TcpClient())
            {
                var ar = client.BeginConnect(host, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(TimeSpan.FromSeconds(5)))
                    throw new Exception("A impressora " + host + ":" + port + " não respondeu (ligada e na rede?)");
                client.EndConnect(ar);
                client.SendTimeout = 10000;
                using (var s = client.GetStream())
                {
                    s.Write(bytes, 0, bytes.Length);
                    s.Flush();
                }
            }
        }

        // Tira comandos ESC/POS de um texto, para imprimir pelo driver do Windows.
        public static string StripEscPos(string text)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (c == '\x1B' || c == '\x1D')
                {
                    // ESC @ (2) · ESC E n (3) · GS ! n (3) · GS V m (3)
                    char cmd = i + 1 < text.Length ? text[i + 1] : '\0';
                    i += (c == '\x1B' && cmd == '@') ? 1 : 2;
                    continue;
                }
                if (c == NulPlaceholder || c == '\0') continue;
                sb.Append(c);
            }
            return sb.ToString();
        }

        // 2.3: ESC/POS com QR Code (GS ( k), como o cupom da NFC-e, não pode virar texto: vai
        // "cru" para o driver (tipo RAW), que as térmicas USB aceitam.
        public static bool NeedsRaw(string text)
        {
            return LooksLikeEscPos(text) && text.IndexOf("\x1D(k", StringComparison.Ordinal) >= 0;
        }

        static byte[] EscPosBytes(string content)
        {
            var bytes = new byte[content.Length];
            for (int i = 0; i < content.Length; i++)
            {
                char ch = content[i] == NulPlaceholder ? '\0' : content[i];
                bytes[i] = ch < 256 ? (byte)ch : (byte)'?';
            }
            return bytes;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] data, int len, out int written);

        public static void PrintWindowsRaw(string printerName, string content, string jobTitle)
        {
            var bytes = EscPosBytes(content);
            if (!string.IsNullOrEmpty(PrintToFileDir))
            {
                // Modo de teste: grava os bytes que iriam para a impressora.
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(PrintToFileDir, jobTitle.Replace(' ', '-') + "-" + DateTime.Now.ToString("HHmmssfff") + ".bin"), bytes);
                return;
            }
            IntPtr h;
            if (!OpenPrinter(printerName, out h, IntPtr.Zero)) throw new Exception("Impressora \"" + printerName + "\" não encontrada neste computador");
            try
            {
                if (StartDocPrinter(h, 1, new DOCINFO { pDocName = jobTitle, pDataType = "RAW" }) == 0)
                    throw new Exception("O Windows recusou o envio direto para \"" + printerName + "\" (erro " + Marshal.GetLastWin32Error() + ")");
                try
                {
                    StartPagePrinter(h);
                    int written;
                    if (!WritePrinter(h, bytes, bytes.Length, out written) || written != bytes.Length)
                        throw new Exception("A impressora \"" + printerName + "\" não recebeu o cupom inteiro (erro " + Marshal.GetLastWin32Error() + ")");
                    EndPagePrinter(h);
                }
                finally { EndDocPrinter(h); }
            }
            finally { ClosePrinter(h); }
        }

        public static void PrintWindows(string printerName, string text, string jobTitle)
        {
            if (NeedsRaw(text)) { PrintWindowsRaw(printerName, text, jobTitle); return; }
            if (LooksLikeEscPos(text)) text = StripEscPos(text);
            var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').ToList();
            while (lines.Count > 0 && lines[lines.Count - 1].Trim().Length == 0) lines.RemoveAt(lines.Count - 1);
            lines.Add(""); lines.Add("");
            int cols = Math.Max(32, lines.Max(l => l.Length));
            int next = 0;
            using (var doc = new PrintDocument())
            {
                doc.PrinterSettings.PrinterName = printerName;
                if (!doc.PrinterSettings.IsValid) throw new Exception("Impressora \"" + printerName + "\" não encontrada neste computador");
                doc.DocumentName = jobTitle;
                doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                doc.PrintController = new StandardPrintController(); // sem janela "Imprimindo..."
                if (!string.IsNullOrEmpty(PrintToFileDir))
                {
                    doc.PrinterSettings.PrintToFile = true;
                    doc.PrinterSettings.PrintFileName = System.IO.Path.Combine(PrintToFileDir, jobTitle.Replace(' ', '-') + "-" + DateTime.Now.ToString("HHmmssfff") + ".pdf");
                }
                doc.PrintPage += (s, e) =>
                {
                    var area = e.PageSettings.PrintableArea;
                    float width = e.PageSettings.Landscape ? area.Height : area.Width;
                    float height = e.PageSettings.Landscape ? area.Width : area.Height;
                    using (var font = FitFont(e.Graphics, cols, width))
                    {
                        float lineH = font.GetHeight(e.Graphics);
                        float y = 0;
                        while (next < lines.Count && y + lineH <= height)
                        {
                            e.Graphics.DrawString(lines[next], font, Brushes.Black, 0, y, StringFormat.GenericTypographic);
                            y += lineH; next++;
                        }
                    }
                    e.HasMorePages = next < lines.Count;
                };
                doc.Print();
            }
        }

        static Font FitFont(Graphics g, int cols, float width)
        {
            var sample = new string('M', cols);
            for (float size = 12f; size >= 5f; size -= 0.5f)
            {
                var f = new Font("Consolas", size, FontStyle.Regular, GraphicsUnit.Point);
                if (g.MeasureString(sample, f, int.MaxValue, StringFormat.GenericTypographic).Width <= width) return f;
                f.Dispose();
            }
            return new Font("Consolas", 5f, FontStyle.Regular, GraphicsUnit.Point);
        }

        public static string TestTicket(string destino, bool escPos)
        {
            var sb = new StringBuilder();
            sb.Append(new string('=', 32)).Append('\n');
            sb.Append("TESTE DO AGENTE COMMANDAH\n");
            sb.Append(new string('=', 32)).Append('\n');
            sb.Append(DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss")).Append('\n');
            sb.Append("Destino: ").Append(destino).Append('\n');
            sb.Append(escPos ? "Acentos: removidos (ESC/POS)\n" : "Acentos: ação, pão, café\n");
            sb.Append("Versão do agente: ").Append(Config.Version).Append('\n');
            sb.Append(new string('-', 32)).Append("\n\n\n");
            if (!escPos) return sb.ToString();
            var plain = sb.ToString().Normalize(NormalizationForm.FormD);
            var ascii = new StringBuilder();
            foreach (char c in plain) if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark) ascii.Append(c);
            return "\x1B\x40" + ascii + "\n\n\n\x1D\x56\x01";
        }
    }
}
