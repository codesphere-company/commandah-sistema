/* ============ PRIVACIDADE (LGPD) — PROD-08, decisão do dono em 10/10 ============
   Aviso de privacidade em modelo padrão (a revisar pelo contador/jurídico), encarregado e prazo
   de guarda configuráveis (padrão 2 anos depois que o sócio sai), consentimento separado para
   campanhas, exportação dos dados do sócio e anonimização. */
function isAdminUser(){ return !!(currentUser && (currentUser.role==='admin' || sessionIsOwner)); }
function privacySettings(){ const p=(state.settings&&state.settings.privacy)||{}; return { nome:p.nome||'', email:p.email||'', anos:Number(p.anos)>0?Number(p.anos):2, atualizado:p.atualizado||'2026-10-10' }; }
function privacyNoticeHtml(){
  const ps=privacySettings(), clube=h((state.settings&&state.settings.clubName)||'o estabelecimento');
  const enc=ps.nome||ps.email ? `${h(ps.nome||'Encarregado')}${ps.email?` — <a href="mailto:${h(ps.email)}">${h(ps.email)}</a>`:''}` : '<i>a definir (Configurações › Privacidade)</i>';
  return `<div class="privacy-notice">
  <p class="sub">Atualizado em ${new Date(ps.atualizado+'T12:00:00').toLocaleDateString('pt-BR')}. Texto em modelo padrão, em revisão pelo contador/jurídico.</p>
  <h4>1. Quem cuida dos seus dados</h4><p>${clube} (“o clube”), usando o sistema Commandah. Encarregado pelo tratamento de dados pessoais: ${enc}.</p>
  <h4>2. Quais dados usamos</h4><ul><li><b>Sócios e dependentes:</b> nome, cota, documento, data de nascimento, telefone, e-mail, endereço e observações do cadastro.</li><li><b>Consumo:</b> pedidos, itens, valores, formas de pagamento, fiado e créditos, pontos de fidelidade.</li><li><b>Clientes avulsos:</b> o nome ou a mesa informados no pedido.</li><li><b>Colaboradores:</b> nome, usuário, perfil de acesso e o registro das ações feitas no sistema.</li></ul>
  <h4>3. Para que</h4><ul><li>Identificar o sócio e os dependentes na comanda e registrar o consumo e os pagamentos.</li><li>Controlar fiado, crédito e cobrança (inclusive por WhatsApp).</li><li>Imprimir fichas de preparo e comprovantes.</li><li>Segurança e auditoria (quem fez o quê no sistema).</li><li>Cumprir obrigações legais e fiscais.</li><li>Enviar campanhas e promoções, <b>só para quem autorizar</b>.</li></ul>
  <h4>4. Base legal (LGPD, art. 7º)</h4><ul><li><b>Execução do contrato</b> com o sócio: consumo, fiado e cobrança.</li><li><b>Obrigação legal ou regulatória:</b> registros financeiros e fiscais.</li><li><b>Legítimo interesse:</b> segurança, prevenção de fraude e auditoria.</li><li><b>Consentimento:</b> campanhas e promoções — pode ser retirado a qualquer momento.</li></ul>
  <h4>5. Com quem compartilhamos</h4><p>Não vendemos dados. Usamos fornecedores para operar o sistema: Supabase (banco de dados na nuvem), GitHub (hospedagem do sistema e cópias de segurança cifradas), Google Drive (cópia de segurança cifrada, quando ativada) e Cloudflare (proteção contra robôs no cadastro). Os dados podem ficar em servidores fora do Brasil, com as garantias contratuais desses fornecedores. Autoridades recebem dados quando a lei exigir.</p>
  <h4>6. Por quanto tempo</h4><p>Enquanto você for sócio. Depois que deixar de ser, por <b>${ps.anos} ano${ps.anos===1?'':'s'}</b>; em seguida o cadastro é anonimizado: nome, documento e contatos são apagados e o histórico de valores continua, sem identificar a pessoa. Registros financeiros podem ser guardados pelo prazo que a lei exigir, e o registro de ações do sistema é mantido para segurança.</p>
  <h4>7. Segurança</h4><p>Acesso por usuário e senha individual, com bloqueio após tentativas erradas; permissões por perfil; registro das ações; cópias de segurança cifradas.</p>
  <h4>8. Seus direitos (LGPD, art. 18)</h4><p>Confirmar se tratamos seus dados e ter acesso a eles; corrigir dados; pedir anonimização ou eliminação do que não for necessário ou obrigatório; receber seus dados (portabilidade); saber com quem compartilhamos; retirar o consentimento de campanhas; reclamar à ANPD. Para pedir, fale com o encarregado ou na secretaria/caixa do clube. Respondemos em até 15 dias.</p>
  <h4>9. Mudanças neste aviso</h4><p>Quando este aviso mudar, a data de atualização no topo também muda.</p>
  </div>`;
}
function openPrivacyNotice(){ openModal('Aviso de privacidade', privacyNoticeHtml()+'<div class="row" style="margin-top:12px"><button class="btn" onclick="closeModal()">Fechar</button><button class="btn" onclick="printPrivacyNotice()">Imprimir</button></div>'); document.querySelector('#modalRoot .modal').classList.add('privacy-modal'); }
function printPrivacyNotice(){ const w=window.open('','_blank'); if(!w){ toast('Libere as janelas do navegador para imprimir.'); return; } w.document.write('<!doctype html><meta charset="utf-8"><title>Aviso de privacidade</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px}h4{margin:18px 0 4px}</style><h2>Aviso de privacidade</h2>'+privacyNoticeHtml()); w.document.close(); w.focus(); w.print(); }
function membersPastRetention(){
  const anos=privacySettings().anos, limite=Date.now()-anos*365.25*864e5;
  return state.members.filter(m=>m.archived && !m.anonymizedAt && m.archivedAt && new Date(m.archivedAt).getTime()<limite);
}
function openPrivacySettings(){
  if(!requirePerm('config-sistema')) return;
  const ps=privacySettings(), vencidos=membersPastRetention();
  openModal('Privacidade (LGPD)', `
    <div class="row"><div class="field"><label>Encarregado (nome)</label><input id="lgpdNome" value="${h(ps.nome)}" placeholder="Quem responde por dados pessoais"></div><div class="field"><label>E-mail do encarregado</label><input id="lgpdEmail" type="email" value="${h(ps.email)}"></div></div>
    <div class="field"><label>Guardar os dados de quem deixou de ser sócio por (anos)</label><input id="lgpdAnos" type="number" min="1" max="20" value="${ps.anos}"><p class="sub">Depois desse prazo o cadastro pode ser anonimizado (abaixo). O histórico de valores continua.</p></div>
    <div class="row"><button class="btn" onclick="openPrivacyNotice()">Ver aviso de privacidade</button><button class="btn btn-primary" onclick="savePrivacySettings()">Salvar</button></div>
    <h4 style="margin:18px 0 6px">Sócios arquivados há mais de ${ps.anos} ano${ps.anos===1?'':'s'} (${vencidos.length})</h4>
    ${vencidos.length?`<div class="lgpd-list">${vencidos.map(m=>`<div class="lgpd-row"><span>${h(m.name)}${m.code?' · Cota '+h(m.code):''} <span class="sub">arquivado em ${new Date(m.archivedAt).toLocaleDateString('pt-BR')}</span></span>${isAdminUser()?`<button class="op-btn" onclick="anonymizeMember(${jsArg(m.id)})">Anonimizar</button>`:''}</div>`).join('')}</div>`:'<p class="sub">Nenhum. Quando algum passar do prazo, ele aparece aqui.</p>'}`);
}
