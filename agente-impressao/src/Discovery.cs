// Procura impressoras de rede: tenta abrir a porta 9100 (impressão direta, a mesma que
// o agente usa para imprimir) em todos os endereços da rede local deste computador.
// Só a faixa /24 de cada placa de rede (ex.: 192.168.110.1 a .254): redes maiores
// teriam milhares de endereços e a impressora quase sempre está na mesma faixa do PC.
// Abre e fecha a conexão sem mandar nada, então a impressora não imprime.
// 2.2: a varredura pode ser desligada no Commandah (por computador); aí o agente só
// confere os IPs escolhidos à mão (Probe), para não tocar nas impressoras de outro sistema.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;

namespace Commandah.Agente
{
    public static class Discovery
    {
        public const int PrinterPort = 9100;

        public static List<string> LocalSubnets()
        {
            var nets = new List<string>();
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    var b = ua.Address.GetAddressBytes();
                    if (b[0] == 127 || (b[0] == 169 && b[1] == 254)) continue; // loopback e "sem DHCP"
                    var net = b[0] + "." + b[1] + "." + b[2];
                    if (!nets.Contains(net)) nets.Add(net);
                }
            }
            return nets;
        }

        static HashSet<string> OwnAddresses()
        {
            var own = new HashSet<string>();
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork) own.Add(ua.Address.ToString());
            return own;
        }

        // Devolve os IPs com a porta 9100 aberta, em ordem. Leva ~1,5 s por faixa.
        public static List<string> ScanNetwork(int timeoutMs = 1500)
        {
            var own = OwnAddresses();
            var ips = new List<string>();
            foreach (var net in LocalSubnets().Take(4))
                for (int i = 1; i < 255; i++)
                    if (!own.Contains(net + "." + i)) ips.Add(net + "." + i);
            return Probe(ips, timeoutMs);
        }

        // 2.2: confere só os endereços pedidos, em qualquer faixa ("192.168.110.113" ou
        // "192.168.110.113:9100"). Devolve os que aceitaram a conexão, escritos como vieram.
        public static List<string> Probe(IEnumerable<string> addresses, int timeoutMs = 1500)
        {
            var tries = new List<Tuple<string, TcpClient, IAsyncResult>>();
            foreach (var addr in addresses.Where(a => a != null).Select(a => a.Trim()).Distinct())
            {
                string host = addr;
                int port = PrinterPort;
                int colon = host.LastIndexOf(':');
                if (colon > 0)
                {
                    int p;
                    if (!int.TryParse(host.Substring(colon + 1), out p) || p < 1 || p > 65535) continue;
                    port = p;
                    host = host.Substring(0, colon);
                }
                IPAddress ip;
                if (!IPAddress.TryParse(host, out ip) || ip.AddressFamily != AddressFamily.InterNetwork) continue;
                var c = new TcpClient();
                try { tries.Add(Tuple.Create(addr, c, c.BeginConnect(ip, port, null, null))); }
                catch (Exception) { c.Close(); }
            }
            var deadline = DateTime.Now.AddMilliseconds(timeoutMs);
            while (DateTime.Now < deadline && tries.Any(t => !t.Item3.IsCompleted)) Thread.Sleep(50);
            var found = new List<string>();
            foreach (var t in tries)
            {
                try
                {
                    if (t.Item3.IsCompleted)
                    {
                        t.Item2.EndConnect(t.Item3);
                        if (t.Item2.Connected) found.Add(t.Item1);
                    }
                }
                catch (Exception) { /* recusou: não é impressora */ }
                finally { t.Item2.Close(); }
            }
            return found.OrderBy(ip => ip.Split(':')[0].Split('.').Select(int.Parse).Aggregate(0L, (a, n) => a * 256 + n)).ToList();
        }
    }
}
