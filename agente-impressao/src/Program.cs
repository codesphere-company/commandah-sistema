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
            // item 5 (auditoria 11/11): aberto pela versão anterior depois de trocar o exe
            bool posAtualizacao = Array.Exists(args, a => a == "--pos-atualizacao");
            using (var mutex = new Mutex(true, "Local\\CommandahAgenteImpressao", out created))
            {
                if (!created && posAtualizacao)
                {
                    // a versão anterior ainda está fechando: espera ela soltar o mutex (até 120 s)
                    try { created = mutex.WaitOne(TimeSpan.FromSeconds(120)); }
                    catch (AbandonedMutexException) { created = true; }
                }
                if (!created)
                {
                    // depois de atualizar, sem mutex = a anterior continuou (voltou atrás): sai sem avisar
                    if (!posAtualizacao)
                        MessageBox.Show("O agente de impressão do Commandah já está aberto (ícone perto do relógio).", "Commandah", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                bool minimized = Array.Exists(args, a => a == "--minimizado");
                Application.Run(new TrayContext(minimized, posAtualizacao));
                try { mutex.ReleaseMutex(); } catch (Exception) { } // a versão nova espera por ele
            }
        }
    }

    class TrayContext : ApplicationContext
    {
        readonly Agent agent;
        readonly NotifyIcon tray = new NotifyIcon();
        readonly MainForm form;
        readonly LocalServer local;
        readonly Updater updater;
        readonly SynchronizationContext ui;
        AgentState lastState;

        public TrayContext(bool minimized, bool posAtualizacao)
        {
            var cfg = Config.Load();
            if (cfg.IsNew)
            {
                // Primeira vez neste computador: já abre junto com o Windows (dá para desligar na janela).
                try { Config.StartsWithWindows = true; cfg.Save(); } catch (Exception) { }
            }
            agent = new Agent(cfg);
            // item 5 (auditoria 11/11): atualização automática com aviso assinado
            string exe = Application.ExecutablePath;
            updater = new Updater(agent, Config.BaseAtualizacao, Config.ChaveAtualizacao, exe);
            form = new MainForm(agent, updater);
            // criar o form instala o contexto da UI: o fechamento pela atualização volta para esta thread
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            updater.Encerrar = () => ui.Post(_ => FecharParaAtualizar(), null);
            local = new LocalServer(agent);
            local.Start();
            if (posAtualizacao) agent.Log("Atualizado para " + Config.Version + ".", false);
            Updater.LimparSobras(exe, posAtualizacao);

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
            updater.Iniciar();
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

        // Versão nova já aberta (esperando o mutex): fecha sem perguntar, solta a porta local e o
        // mutex (Main o solta quando Application.Run volta).
        void FecharParaAtualizar()
        {
            tray.Visible = false;
            local.Stop();
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
