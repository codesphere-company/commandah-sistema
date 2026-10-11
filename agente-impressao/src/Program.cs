// Agente de impressão do Commandah (versão 2, refeito em 10/10/2026 — OPS-12).
// Um programa só, sem instalação: fica no ícone perto do relógio, busca as fichas na
// fila do Commandah (nuvem) e imprime nas impressoras do clube. Ver ../README.md.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Threading;
using System.Windows.Forms;

namespace Commandah.Agente
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "Local\\CommandahAgenteImpressao", out created))
            {
                if (!created)
                {
                    MessageBox.Show("O agente de impressão do Commandah já está aberto (ícone perto do relógio).", "Commandah", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                bool minimized = Array.Exists(args, a => a == "--minimizado");
                Application.Run(new TrayContext(minimized));
            }
        }
    }

    class TrayContext : ApplicationContext
    {
        readonly Agent agent;
        readonly NotifyIcon tray = new NotifyIcon();
        readonly MainForm form;
        AgentState lastState;

        public TrayContext(bool minimized)
        {
            var cfg = Config.Load();
            if (cfg.IsNew)
            {
                // Primeira vez neste computador: já abre junto com o Windows (dá para desligar na janela).
                try { Config.StartsWithWindows = true; cfg.Save(); } catch (Exception) { }
            }
            agent = new Agent(cfg);
            form = new MainForm(agent);
            new LocalServer(agent).Start();

            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir", null, (s, e) => ShowForm());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair (as fichas param de imprimir)", null, (s, e) => Exit());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => ShowForm();
            lastState = agent.State;
            UpdateTray();
            tray.Visible = true;
            agent.Changed += () => form.BeginInvokeSafe(UpdateTray);
            agent.Start();
            if (!minimized || string.IsNullOrEmpty(cfg.Token)) ShowForm();
        }

        void ShowForm()
        {
            form.Show();
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
            form.Activate();
        }

        void UpdateTray()
        {
            tray.Icon = AgentIcons.For(agent.State);
            string t = agent.State == AgentState.Conectado ? "Commandah: imprimindo" : agent.State == AgentState.SemToken ? "Commandah: aguardando conexão (código)" : agent.State == AgentState.TokenInvalido ? "Commandah: computador desconectado" : "Commandah: sem conexão";
            tray.Text = t;
            if (agent.State != lastState && agent.State != AgentState.Conectado && lastState == AgentState.Conectado)
                tray.ShowBalloonTip(5000, "Agente de impressão", t + ". As fichas não estão saindo.", ToolTipIcon.Warning);
            lastState = agent.State;
        }

        void Exit()
        {
            if (MessageBox.Show("Fechar o agente? Enquanto ele estiver fechado, nenhuma ficha do Commandah sai na impressora.", "Commandah", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
            tray.Visible = false;
            form.ReallyClose = true;
            form.Close();
            ExitThread();
        }
    }

    static class FormExtensions
    {
        public static void BeginInvokeSafe(this Form f, Action a)
        {
            if (f.IsHandleCreated) f.BeginInvoke(a);
            else a();
        }
    }

    // Ícone desenhado na hora: círculo verde (imprimindo), amarelo (falta token) ou vermelho.
    static class AgentIcons
    {
        static readonly System.Collections.Generic.Dictionary<AgentState, Icon> cache = new System.Collections.Generic.Dictionary<AgentState, Icon>();
        public static Icon For(AgentState s)
        {
            lock (cache)
            {
                Icon ic;
                if (cache.TryGetValue(s, out ic)) return ic;
                var color = s == AgentState.Conectado ? Color.FromArgb(22, 150, 90) : s == AgentState.SemToken ? Color.FromArgb(230, 160, 20) : Color.FromArgb(200, 40, 40);
                using (var bmp = new Bitmap(32, 32))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.Clear(Color.Transparent);
                        using (var b = new SolidBrush(color)) g.FillEllipse(b, 1, 1, 30, 30);
                        using (var f = new Font("Segoe UI", 15f, FontStyle.Bold, GraphicsUnit.Pixel))
                        using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                            g.DrawString("C", f, Brushes.White, new RectangleF(0, 0, 32, 32), sf);
                    }
                    ic = Icon.FromHandle(bmp.GetHicon());
                }
                cache[s] = ic;
                return ic;
            }
        }
    }
}
