// Janela do agente: conexão com o Commandah (código), situação, impressoras deste
// computador, teste e histórico.
using System;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace Commandah.Agente
{
    public class MainForm : Form
    {
        readonly Agent agent;
        readonly Label status = new Label();
        // Conexão
        readonly Panel pairPanel = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false };
        readonly Label codeLabel = new Label { AutoSize = true, Font = new Font("Consolas", 30f, FontStyle.Bold), ForeColor = Color.FromArgb(13, 120, 90), Margin = new Padding(0, 4, 0, 4) };
        readonly Label codeExpires = new Label { AutoSize = true, ForeColor = Color.DimGray };
        readonly Panel connectedPanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        readonly Label connectedLabel = new Label { AutoSize = true, Font = new Font("Segoe UI", 10.5f, FontStyle.Bold), Margin = new Padding(0, 7, 10, 0) };
        readonly Panel tokenPanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        readonly LinkLabel tokenLink = new LinkLabel { AutoSize = true, Text = "Tenho um token do estabelecimento (modo antigo)" };
        readonly TextBox token = new TextBox();
        // Impressoras
        readonly ComboBox printers = new ComboBox();
        readonly TextBox ip = new TextBox();
        readonly ListBox history = new ListBox();
        readonly CheckBox autostart = new CheckBox();
        readonly Timer refresh = new Timer();
        public bool ReallyClose;

        public MainForm(Agent agent)
        {
            this.agent = agent;
            Text = "Commandah — Agente de impressão " + Config.Version;
            Font = new Font("Segoe UI", 10f);
            ClientSize = new Size(640, 660);
            MinimumSize = new Size(580, 580);
            StartPosition = FormStartPosition.CenterScreen;
            Icon = AgentIcons.For(AgentState.Conectado);

            var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 6 };
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(root);

            status.AutoSize = false; status.Height = 44; status.Dock = DockStyle.Fill;
            status.TextAlign = ContentAlignment.MiddleLeft; status.Padding = new Padding(10, 0, 0, 0);
            status.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            root.Controls.Add(status);

            // 1. Conexão
            var gConn = Group("1. Conectar este computador ao Commandah");
            pairPanel.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(580, 0), Text = "No Commandah, entre como administrador e vá em Configurações › Impressoras › Conectar computador. Digite este código:" });
            pairPanel.Controls.Add(codeLabel);
            pairPanel.Controls.Add(codeExpires);
            var disconnect = new Button { Text = "Desconectar", AutoSize = true };
            disconnect.Click += (s, e) =>
            {
                if (MessageBox.Show("Desconectar este computador do Commandah? As fichas param de sair nas impressoras dele até conectar de novo com um código.", "Commandah", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    agent.Disconnect();
            };
            connectedPanel.Controls.AddRange(new Control[] { connectedLabel, disconnect });
            token.Width = 330; token.UseSystemPasswordChar = true;
            var show = new CheckBox { Text = "mostrar", AutoSize = true, Margin = new Padding(6, 6, 6, 0) };
            show.CheckedChanged += (s, e) => token.UseSystemPasswordChar = !show.Checked;
            var save = new Button { Text = "Salvar token", AutoSize = true };
            save.Click += (s, e) => { agent.SetToken(token.Text); tokenPanel.Visible = false; };
            tokenPanel.Controls.AddRange(new Control[] { token, show, save });
            tokenPanel.Visible = false;
            tokenLink.LinkClicked += (s, e) => { tokenPanel.Visible = !tokenPanel.Visible; };
            gConn.Controls.Add(Stack(pairPanel, connectedPanel, tokenLink, tokenPanel));
            root.Controls.Add(gConn);

            // 2. Impressoras e teste
            var gPrint = Group("2. Impressoras deste computador e teste");
            printers.DropDownStyle = ComboBoxStyle.DropDownList; printers.Width = 330;
            var reload = new Button { Text = "Atualizar", AutoSize = true };
            reload.Click += (s, e) => LoadPrinters();
            var testWin = new Button { Text = "Imprimir teste", AutoSize = true };
            testWin.Click += (s, e) => { if (printers.SelectedItem != null) agent.PrintTest(printers.SelectedItem.ToString(), null); };
            var row1 = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
            row1.Controls.AddRange(new Control[] { printers, reload, testWin });
            ip.Width = 200; ip.Text = "";
            SetCue(ip, "Ex.: 192.168.0.50");
            var testIp = new Button { Text = "Testar impressora de rede", AutoSize = true };
            testIp.Click += (s, e) => { if (ip.Text.Trim().Length > 0) agent.PrintTest(null, ip.Text.Trim()); };
            var row2 = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
            row2.Controls.AddRange(new Control[] { new Label { Text = "IP:", AutoSize = true, Margin = new Padding(0, 7, 4, 0) }, ip, testIp });
            var scan = new Button { Text = "Procurar impressoras (Windows e rede)", AutoSize = true };
            scan.Click += (s, e) => { LoadPrinters(); agent.ScanAndReport(); };
            var pHelp = new Label { AutoSize = true, MaximumSize = new Size(580, 0), ForeColor = Color.DimGray, Text = "Com o computador conectado, as impressoras encontradas aparecem sozinhas no Commandah (Configurações › Impressoras). Lá você escolhe o que cada uma imprime e faz o teste." };
            gPrint.Controls.Add(Stack(row1, row2, scan, pHelp));
            root.Controls.Add(gPrint);

            autostart.Text = "Abrir o agente sozinho quando o Windows iniciar (recomendado)";
            autostart.AutoSize = true; autostart.Margin = new Padding(3, 8, 3, 8);
            autostart.Checked = Config.StartsWithWindows;
            autostart.CheckedChanged += (s, e) => { try { Config.StartsWithWindows = autostart.Checked; } catch (Exception ex) { MessageBox.Show(ex.Message); } };
            root.Controls.Add(autostart);

            var gHist = Group("Histórico");
            gHist.Dock = DockStyle.Fill;
            history.Dock = DockStyle.Fill; history.IntegralHeight = false; history.HorizontalScrollbar = true;
            history.DrawMode = DrawMode.OwnerDrawFixed; history.ItemHeight = 20;
            history.DrawItem += DrawHistory;
            history.DoubleClick += (s, e) =>
            {
                var item = history.SelectedItem as LogEntry;
                if (item != null) MessageBox.Show(item.At.ToString("dd/MM/yyyy HH:mm:ss") + Environment.NewLine + Environment.NewLine + item.Text, "Histórico", MessageBoxButtons.OK, item.Error ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
            };
            gHist.Controls.Add(history);
            root.Controls.Add(gHist);

            var foot = new Label { AutoSize = true, ForeColor = Color.DimGray, Text = "Fechar esta janela não desliga o agente: ele continua no ícone perto do relógio." };
            root.Controls.Add(foot);

            LoadPrinters();
            agent.Changed += () => { if (IsHandleCreated) BeginInvoke(new Action(RefreshView)); };
            refresh.Interval = 5000; refresh.Tick += (s, e) => RefreshView(); refresh.Start();
            Load += (s, e) => RefreshView();
            FormClosing += (s, e) => { if (!ReallyClose && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        }

        static GroupBox Group(string title)
        {
            return new GroupBox { Text = title, Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(10), Margin = new Padding(0, 6, 0, 6) };
        }

        static Control Stack(params Control[] items)
        {
            var p = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, Dock = DockStyle.Fill, AutoSize = true, WrapContents = false };
            p.Controls.AddRange(items);
            return p;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wp, string lp);
        static void SetCue(TextBox box, string text)
        {
            box.HandleCreated += (s, e) => SendMessage(box.Handle, 0x1501, (IntPtr)1, text);
        }

        void LoadPrinters()
        {
            var sel = printers.SelectedItem as string;
            printers.Items.Clear();
            foreach (var p in Printing.WindowsPrinters()) printers.Items.Add(p);
            if (sel != null && printers.Items.Contains(sel)) printers.SelectedItem = sel;
            else if (printers.Items.Count > 0) printers.SelectedIndex = 0;
        }

        void RefreshView()
        {
            bool hasToken = !string.IsNullOrEmpty(agent.Cfg.Token);
            switch (agent.State)
            {
                case AgentState.Conectado:
                    status.Text = "● Conectado — imprimindo as fichas do Commandah" + (agent.PrintedToday > 0 ? " (" + agent.PrintedToday + " desde que abriu)" : "");
                    status.BackColor = Color.FromArgb(220, 245, 230); status.ForeColor = Color.FromArgb(10, 100, 50); break;
                case AgentState.SemToken:
                    status.Text = "● Aguardando conexão: digite o código abaixo no Commandah";
                    status.BackColor = Color.FromArgb(255, 243, 205); status.ForeColor = Color.FromArgb(120, 80, 0); break;
                case AgentState.TokenInvalido:
                    status.Text = agent.IsPairedByCode ? "● Computador removido no Commandah: clique em Desconectar" : "● Token inválido: gere um novo no Commandah ou conecte com código";
                    status.BackColor = Color.FromArgb(253, 226, 226); status.ForeColor = Color.FromArgb(150, 20, 20); break;
                default:
                    status.Text = "● Sem conexão com o servidor — confira a internet";
                    status.BackColor = Color.FromArgb(253, 226, 226); status.ForeColor = Color.FromArgb(150, 20, 20); break;
            }
            pairPanel.Visible = !hasToken;
            codeLabel.Text = string.IsNullOrEmpty(agent.PairCode) ? "······" : Agent.FormatCode(agent.PairCode);
            codeExpires.Text = string.IsNullOrEmpty(agent.PairCode) ? "Pedindo um código ao servidor..." : "Vale até " + agent.PairExpires.ToString("HH:mm") + ". Depois aparece um código novo sozinho.";
            connectedPanel.Visible = hasToken;
            connectedLabel.Text = agent.IsPairedByCode ? "Conectado como: " + agent.Cfg.AgentName : "Usando o token do estabelecimento (modo antigo)";
            tokenLink.Visible = !hasToken;
            if (hasToken) tokenPanel.Visible = false;
            Icon = AgentIcons.For(agent.State);
            var entries = agent.Entries();
            history.BeginUpdate();
            history.Items.Clear();
            foreach (var e in entries) history.Items.Add(e);
            history.EndUpdate();
        }

        void DrawHistory(object sender, DrawItemEventArgs e)
        {
            e.DrawBackground();
            if (e.Index < 0) return;
            var item = (LogEntry)history.Items[e.Index];
            var color = (e.State & DrawItemState.Selected) != 0 ? SystemColors.HighlightText : item.Error ? Color.FromArgb(170, 20, 20) : SystemColors.ControlText;
            TextRenderer.DrawText(e.Graphics, item.At.ToString("dd/MM HH:mm:ss") + "   " + item.Text, e.Font, e.Bounds, color, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }
}
