/* ============ SINAL DO APARELHO ============ */
// Centro de controle, etapa 1 (27/11/2026, pedido do dono: saber na hora quando "pedido não chegou à cozinha" ou
// "venda não subiu ao servidor" em qualquer cliente). Todo aparelho logado manda, a cada ~60 s, o RPC aparelho_sinal
// (migration 20261129000000_centro_controle): quem é o aparelho, a versão do site, o que está esperando para subir
// (vendas e lançamentos de caixa com mudança local ainda não confirmada pelo servidor — o mesmo critério do pushSales),
// as fichas que não foram para a impressora (failedPrintTickets) e os períodos sem internet anotados aqui.
// O banco confere tudo a cada minuto (controle_avaliar) e avisa o operador da plataforma. Falha de rede aqui nunca
// aparece na tela: só vira uma "queda" guardada, enviada no primeiro sinal que passar.
const SINAL_ID_KEY = 'commandah:aparelhoId', SINAL_QUEDAS_KEY = 'commandah:quedas', SINAL_MS = 60000;
let sinalTimer = null, sinalPendDesde = null, sinalEmVoo = null, sinalGeracao = 0;

function aparelhoId(){
  try{
    let id = localStorage.getItem(SINAL_ID_KEY);
    if(!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)){
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('ap-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
      localStorage.setItem(SINAL_ID_KEY, id);
    }
    return id;
  }catch(e){ return 'sem-localstorage'; }
}
function nomeDoAparelho(){
  const cx = typeof caixaDoAparelho==='function' ? caixaDoAparelho() : null;
  if(cx && typeof nomeDoCaixa==='function') return nomeDoCaixa(cx);
  const ua = navigator.userAgent || '', plat = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Navegador';
  return (currentUser && typeof roleLabel==='function' ? roleLabel(currentUser.role) : 'Aparelho') + ' · ' + plat;
}
function versaoDoSite(){ const s = document.querySelector('script[src*="?v="]'); const m = s && s.src.match(/\?v=([^&]+)/); return m ? m[1] : ''; }
// O que este aparelho ainda não conseguiu gravar no servidor.
function pendenciasDoAparelho(){
  let vendas = 0, caixa = 0;
  try{ const d = cashMovementsDiff(salesBase, state.sales||[]); vendas = d.upserts.length + d.deletes.length; }catch(e){}
  try{ const d = cashMovementsDiff(cashMovementsBase, state.cashMovements||[]); caixa = d.upserts.length + d.deletes.length; }catch(e){}
  if(vendas + caixa > 0){ if(!sinalPendDesde) sinalPendDesde = new Date().toISOString(); } else sinalPendDesde = null;
  const fichas = (typeof failedPrintTickets!=='undefined' && Array.isArray(failedPrintTickets)) ? failedPrintTickets.filter(t=>t && t.printer) : [];
  const fichasDesde = fichas.length ? fichas.map(t=>t.at).filter(Boolean).sort()[0] || new Date().toISOString() : null;
  return { vendas, caixa, desde: sinalPendDesde, fichas: fichas.length, fichasDesde };
}
// ---- quedas de conexão (guardadas no aparelho até um sinal passar) ----
function sinalQuedas(){ try{ const l = JSON.parse(localStorage.getItem(SINAL_QUEDAS_KEY)||'[]'); return Array.isArray(l) ? l : []; }catch(e){ return []; } }
function sinalGuardarQuedas(l){ try{ localStorage.setItem(SINAL_QUEDAS_KEY, JSON.stringify(l.slice(-20))); }catch(e){} }
function sinalCaiu(){ const l = sinalQuedas(); const ult = l[l.length-1]; if(ult && !ult.fim) return; l.push({ inicio: new Date().toISOString(), fim: null }); sinalGuardarQuedas(l); }
function sinalVoltou(){ const l = sinalQuedas(); const ult = l[l.length-1]; if(!ult || ult.fim) return; ult.fim = new Date().toISOString(); const p = pendenciasDoAparelho(); ult.pendencias = p.vendas + p.caixa + p.fichas; sinalGuardarQuedas(l); }
window.addEventListener('offline', sinalCaiu);
window.addEventListener('online', ()=>{ sinalVoltou(); enviarSinal(); });

// Um envio por vez: quem chama durante um envio recebe o mesmo envio (e espera por ele).
// saindo = true: último sinal antes do logout (o servidor não conta "aparelho sumiu" para quem foi para a tela de PIN).
function enviarSinal(saindo){
  if(sinalEmVoo && !saindo) return sinalEmVoo;
  if(!currentUser || typeof isCloudMode!=='function' || !isCloudMode() || !supabaseClient) return Promise.resolve();
  const antes = sinalEmVoo || Promise.resolve();
  sinalEmVoo = antes.then(()=>enviarSinalAgora(!!saindo)).finally(()=>{ sinalEmVoo = null; });
  return sinalEmVoo;
}
async function enviarSinalAgora(saindo){
  try{
    const p = pendenciasDoAparelho();
    const quedas = sinalQuedas().filter(q=>q && q.fim);
    const cx = typeof caixaDoAparelho==='function' ? caixaDoAparelho() : null;
    const { error } = await supabaseClient.rpc('aparelho_sinal', { p: {
      aparelhoId: aparelhoId(), nome: nomeDoAparelho(), papel: currentUser.role || '', usuario: currentUser.name || '',
      versao: versaoDoSite(), tela: (typeof activeView!=='undefined' && activeView) || '',
      caixaId: cx, caixaAberto: !!(cx && state.cashSession && state.cashSession.status==='open'),
      pendVendas: p.vendas, pendCaixa: p.caixa, pendDesde: p.desde, fichas: p.fichas, fichasDesde: p.fichasDesde,
      quedas, saindo: !!saindo
    } });
    if(error){ if(/fetch|network|Failed/i.test(String(error.message||''))) sinalCaiu(); return; }
    sinalVoltou(); // um sinal passou: se havia queda aberta, fecha (o próximo sinal leva)
    if(quedas.length){ const resto = sinalQuedas().filter(q=>!quedas.some(x=>x.inicio===q.inicio)); sinalGuardarQuedas(resto); }
  }catch(e){ sinalCaiu(); }
}
// Cada início é uma geração nova: a cadeia de uma geração antiga para sozinha (relogin não duplica o sinal).
function iniciarSinalDoAparelho(){
  aparelhoId();
  const g = ++sinalGeracao;
  if(sinalTimer) clearTimeout(sinalTimer);
  const ciclo = ()=>{ if(g!==sinalGeracao) return; sinalTimer = setTimeout(async ()=>{ if(g!==sinalGeracao) return; await enviarSinal(); ciclo(); }, SINAL_MS + Math.round((Math.random()-0.5)*20000)); };
  setTimeout(()=>{ if(g===sinalGeracao) enviarSinal(); }, 0);
  ciclo();
}
// Logout: manda o sinal de saída (no máximo 3 s, para não segurar a troca de usuário) e para a cadeia.
async function pararSinalDoAparelho(){
  sinalGeracao++;
  if(sinalTimer){ clearTimeout(sinalTimer); sinalTimer = null; }
  try{ await Promise.race([enviarSinal(true), new Promise(r=>setTimeout(r, 3000))]); }catch(e){}
}
