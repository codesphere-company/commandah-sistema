/* ============ CENTRAL DE MÓDULOS COMPLEMENTARES ============ */
function renderReferenceModule(){
  const el=document.getElementById('view-modulos'); if(!el) return;
  const name=activeModuleReference||'Módulo';
  const definitions={
    'Delivery':{icon:'🛵',desc:'Central interna para acompanhar pedidos de entrega.',kind:'internal',actions:[['Abrir Caixa / PDV','balcao'],['Ver Cardápio Digital','cardapio'],['Consultar relatórios','relatorios']]},
    'Bot WhatsApp':{icon:'💬',desc:'Preparação de atendimento por mensagens e catálogo compartilhável.',kind:'external',needs:'provedor homologado, número comercial e credenciais de API'},
    'SMS':{icon:'💬',desc:'Campanhas de comunicação para clientes que autorizaram contato.',kind:'external',needs:'provedor de SMS, créditos e consentimento LGPD'},
    'Disparador Inteligente':{icon:'📣',desc:'Segmentação de clientes por histórico de compra e relacionamento.',kind:'external',needs:'canal de mensageria contratado e consentimento dos destinatários'},
    'Alterar com NFe':{icon:'📄',desc:'Entrada assistida de produtos e custos a partir de documento fiscal.',kind:'external',needs:'arquivo fiscal válido e integração com provedor/SEFAZ'},
    'Pix Online':{icon:'🔁',desc:'Cobrança Pix com confirmação automática.',kind:'external',needs:'instituição financeira, contrato, chaves e webhook'},
    'Meu Delivery':{icon:'🛵',desc:'Indicadores de pedidos originados por canais de entrega.',kind:'internal',actions:[['Abrir relatórios','relatorios'],['Ver pedidos digitais','cardapio']]},
    'Bina':{icon:'📞',desc:'Identificação de chamadas para localizar rapidamente o cadastro do cliente.',kind:'hardware',needs:'dispositivo de telefonia compatível e driver instalado'},
    'Mapas':{icon:'🗺️',desc:'Apoio a endereços e rotas de entrega.',kind:'external',needs:'provedor de mapas, chave de API e política de uso'},
    'Balança':{icon:'⚖️',desc:'Leitura de peso para itens vendidos por medida.',kind:'hardware',needs:'balança compatível, porta configurada e driver'},
    'Emissão Fiscal':{icon:'🧾',desc:'Preparação para emissão de documentos fiscais vinculados às vendas.',kind:'external',needs:'credenciamento fiscal, certificado, CSC e provedor autorizado'},
    'TEF':{icon:'💳',desc:'Pagamento integrado com cartão.',kind:'hardware',needs:'contrato com adquirente, pinpad homologado e software TEF'},
    'Minha Assinatura':{icon:'🔑',desc:'Informações locais sobre módulos disponíveis nesta edição personalizada.',kind:'info'},
    'Connect':{icon:'☁️',desc:'Visão consolidada para sincronização entre unidades e dispositivos.',kind:'external',needs:'backend, autenticação e banco de dados compartilhado'}
  };
  const d=definitions[name]||{icon:'🧩',desc:'Área complementar inspirada no fluxo operacional observado.',kind:'info'};
  const status=d.kind==='internal'?'<span class="tag tag-green">Disponível</span>':d.kind==='info'?'<span class="tag tag-blue">Informativo</span>':'<span class="tag tag-amber">Requer configuração externa</span>';
  const actions=(d.actions||[]).map(a=>`<button class="btn btn-primary" onclick="switchView(${jsArg(a[1])})">${h(a[0])}</button>`).join('');
  el.innerHTML=`<div class="panel">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px"><div style="font-size:38px">${d.icon}</div><div><h2>${h(name)}</h2>${status}</div></div>
    <p class="sub">${h(d.desc)}</p>
    ${d.needs?`<div class="panel" style="background:var(--cream);margin-top:14px"><h2>Pré-requisitos</h2><p class="sub">Este recurso não está conectado. Para uma operação real são necessários: ${h(d.needs)}.</p><button class="btn" onclick="switchView('diagnostico')">Abrir diagnóstico</button></div>`:''}
    ${actions?`<div class="content-toolbar">${actions}</div>`:''}
    <div class="grid3" style="margin-top:18px">
      <div class="stat"><div class="lbl">Pedidos hoje</div><div class="val">${state.sales.filter(s=>localDay(s.openedAt)===todayStr()).length}</div></div>
      <div class="stat"><div class="lbl">Clientes</div><div class="val">${state.members.length}</div></div>
      <div class="stat"><div class="lbl">Produtos ativos</div><div class="val">${state.products.filter(p=>p.active!==false).length}</div></div>
    </div>
  </div>`;
}

