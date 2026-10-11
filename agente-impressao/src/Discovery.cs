// Procura impressoras de rede: tenta abrir a porta 9100 (impressão direta, a mesma que
// o agente usa para imprimir) em todos os endereços da rede local deste computador.
// Só a faixa /24 de cada placa de rede (ex.: 192.168.110.1 a .254): redes maiores
// teriam milhares de endereços e a impressora quase sempre está na mesma faixa do PC.
// Abre e fecha a conexão sem mandar nada, então a impressora não imprime.
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
            var tries = new List<Tuple<string, TcpClient, IAsyncResult>>();
            foreach (var net in LocalSubnets().Take(4))
            {
                for (int i = 1; i < 255; i++)
                {
                    var ip = net + "." + i;
                    if (own.Contains(ip)) continue;
                    var c = new TcpClient();
                    try { tries.Add(Tuple.Create(ip, c, c.BeginConnect(IPAddress.Parse(ip), PrinterPort, null, null))); }
                    catch (Exception) { c.Close(); }
                }
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
            return found.OrderBy(ip => ip.Split('.').Select(int.Parse).Aggregate(0L, (a, n) => a * 256 + n)).ToList();
        }
    }
}
