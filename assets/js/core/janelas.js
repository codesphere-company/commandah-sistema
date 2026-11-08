/* ============ MODAL HELPER ============ */
function openModal(title, bodyHtml, wide, locked=false){
  const root = document.getElementById('modalRoot');
  root.dataset.locked=locked?'true':'false';
  root.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal${wide?' wide':''}"><button class="modal-close" id="modalCloseBtn" ${locked?'style="display:none"':''}>&times;</button><h3 class="modal-title">${h(title)}</h3>${bodyHtml}</div></div>`;
  if(/Pergunta/i.test(title))root.querySelector('.modal').classList.add('question-record-modal');
  document.getElementById('modalCloseBtn').onclick = closeModal;
  document.getElementById('modalOverlay').addEventListener('click', e=>{ if(e.target.id==='modalOverlay') closeModal(); });}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('.question-record-modal .record-tabs button');if(!button)return;const modal=button.closest('.question-record-modal'),buttons=[...modal.querySelectorAll('.record-tabs button')],responses=buttons.indexOf(button)===1;modal.classList.toggle('question-tab-responses',responses);buttons.forEach((b,i)=>b.classList.toggle('active',responses?i===1:i===0));});
/* UX-04: confirmação do próprio sistema, numa camada acima dos modais (não fecha a janela
   aberta). Título com o verbo, botão de perigo dizendo a ação e botão neutro ("Manter")
   já focado: Enter e Esc nunca confirmam por engano. Na caixinha do navegador o botão
   "Cancelar" de "Cancelar este agendamento?" queria dizer NÃO cancelar. */
function askConfirm(opts){
  const o = Object.assign({ title:'Confirmar?', message:'', confirmLabel:'Confirmar', cancelLabel:'Manter', danger:true }, opts||{});
  return new Promise(resolve=>{
    const old = document.getElementById('confirmRoot'); if(old) old.remove();
    const root = document.createElement('div');
    root.id = 'confirmRoot'; root.className = 'confirm-backdrop';
    root.innerHTML = `<div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMsg"><h3 id="confirmTitle"></h3><p id="confirmMsg" class="sub"></p><div class="confirm-actions"><button type="button" class="btn" data-a="no"></button><button type="button" class="btn ${o.danger?'btn-danger-solid':'btn-primary'}" data-a="yes"></button></div></div>`;
    root.querySelector('#confirmTitle').textContent = o.title;
    root.querySelector('#confirmMsg').textContent = o.message;
    root.querySelector('#confirmMsg').hidden = !o.message;
    root.querySelector('[data-a="no"]').textContent = o.cancelLabel;
    root.querySelector('[data-a="yes"]').textContent = o.confirmLabel;
    const done = v=>{ document.removeEventListener('keydown', onKey, true); root.remove(); resolve(v); };
    const onKey = e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); done(false); } };
    root.addEventListener('click', e=>{ const b = e.target.closest && e.target.closest('[data-a]'); if(b) done(b.dataset.a==='yes'); else if(e.target===root) done(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);
    root.querySelector('[data-a="no"]').focus();
  });
}
// Auditoria 03/11 (B6): o confirm() do navegador saiu do sistema; tudo usa a confirmação própria (UX-04),
// em que Enter e Esc nunca confirmam por engano. O texto vira o título; o botão leva o verbo da ação.
function confirmarAcao(texto, opcoes){
  const t = String(texto||''), verbo = (t.match(/^(Excluir|Apagar|Remover|Reiniciar|Gerar|Migrar|Transferir|Retornar|Cancelar|Enviar)/)||[])[1];
  return askConfirm(Object.assign({ title:t, confirmLabel:verbo||'Confirmar', cancelLabel:'Voltar', danger:/^(Excluir|Apagar|Remover|Reiniciar|Cancelar|Isso vai substituir)/.test(t) }, opcoes||{}));
}
function closeModal(){
  const root=document.getElementById('modalRoot');
  if(root.dataset.locked==='true') return;
  if(root.dataset.confirmPdv==='true'){
    const shown = root.firstElementChild;
    askConfirm({ title:'Cancelar o pedido em andamento?', message:'Os itens deste pedido não serão salvos.', confirmLabel:'Cancelar pedido', cancelLabel:'Continuar pedido' }).then(ok=>{
      if(!ok) return;
      root.dataset.confirmPdv='false';
      currentSaleDraft=null;
      if(root.firstElementChild===shown) root.innerHTML=''; // não apaga outra janela aberta enquanto perguntava
    });
    return;
  }
  removeFloatingComandaOptions();
  root.innerHTML='';
}
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{
  const controls=event.target.closest&&event.target.closest('.op-controls');
  const control=event.target.closest&&event.target.closest('.op-controls span');
  if(!controls||!control||control.textContent.trim()!=='×')return;
  event.preventDefault();event.stopPropagation();closeOperationalWindow();
});
if(typeof document.addEventListener==='function')document.addEventListener('click',event=>{const control=event.target.closest&&event.target.closest('.op-controls span');if(!control||!['□','▢'].includes(control.textContent.trim()))return;const windowEl=control.closest('.op-window');if(!windowEl)return;event.preventDefault();event.stopPropagation();windowEl.classList.toggle('maximized');control.textContent=windowEl.classList.contains('maximized')?'▢':'□';control.title=windowEl.classList.contains('maximized')?'Restaurar janela':'Maximizar janela';});
if(typeof document.addEventListener==='function')document.addEventListener('keydown',event=>{if(event.key!=='Escape'||document.getElementById('modalRoot')?.innerHTML.trim())return;if(comandaAbertaId&&document.querySelector('#view-comandas.active .comanda-inline')){closeComandaView();return;}/* comanda aberta na tela (comandas.js): Esc volta para a lista */const maximized=document.querySelector('.op-window.maximized');if(maximized){maximized.classList.remove('maximized');const control=maximized.querySelector('.op-controls span');if(control)control.textContent='□';}});
/* ============ ARRASTAR JANELAS (modal-title) ============ */
let modalDragState=null;
if(typeof document.addEventListener==='function'){
  document.addEventListener('mousedown', e=>{
    const handle = e.target.closest && e.target.closest('#modalRoot .modal>h3.modal-title, #modalRoot .modal>h3');
    if(!handle) return;
    const modal = handle.closest('.modal'); if(!modal) return;
    const rect = modal.getBoundingClientRect();
    modalDragState = { modal, offsetX: e.clientX-rect.left, offsetY: e.clientY-rect.top };
    modal.style.position='fixed'; modal.style.margin='0';
    modal.style.left=rect.left+'px'; modal.style.top=rect.top+'px';
    modal.style.right='auto'; modal.style.bottom='auto';
    document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove', e=>{
    if(!modalDragState) return;
    let left=e.clientX-modalDragState.offsetX, top=e.clientY-modalDragState.offsetY;
    left=Math.max(-modalDragState.modal.offsetWidth+80, Math.min(left, window.innerWidth-80));
    top=Math.max(0, Math.min(top, window.innerHeight-40));
    modalDragState.modal.style.left=left+'px'; modalDragState.modal.style.top=top+'px';
  });
  document.addEventListener('mouseup', ()=>{ modalDragState=null; document.body.style.userSelect=''; });
}


/* ============ RÓTULOS DOS CAMPOS ============
   UX P3 (06/11): a auditoria achou até 12 campos por tela sem rótulo para leitor de tela. Quase
   todos têm o rótulo escrito na tela (<label>De</label><input>), só não ligado ao campo; outros
   (buscas) só têm placeholder. Esta rotina liga o rótulo que está ao lado ou, sem ele, usa o
   placeholder/title como aria-label. Roda depois de cada mudança na tela. Não muda o visual. */
function ligarRotulosDosCampos(root){
  const sel='input:not([type=hidden]):not([aria-label]):not([aria-labelledby]),select:not([aria-label]):not([aria-labelledby]),textarea:not([aria-label]):not([aria-labelledby])';
  (root||document).querySelectorAll(sel).forEach(el=>{
    if(el.labels && el.labels.length) return;
    const box=el.closest('.field,.report-date-row,.np-section')||el.parentElement;
    const lb=box && [...box.querySelectorAll('label')].find(l=>!l.querySelector('input,select,textarea'));
    if(lb){
      const txt=lb.textContent.replace(/\s+/g,' ').replace(/[:*]\s*$/,'').trim();
      const irmaos=[...box.querySelectorAll('input:not([type=hidden]),select,textarea')];
      if(irmaos[0]===el && el.id && !lb.htmlFor){ lb.htmlFor=el.id; return; }
      if(lb.htmlFor && lb.htmlFor===el.id) return;
      if(txt){ el.setAttribute('aria-label', irmaos[0]===el ? txt : txt+(el.type==='time'?' — hora':'')); return; }
    }
    const alt=(el.getAttribute('placeholder')||el.getAttribute('title')||'').trim();
    if(alt) el.setAttribute('aria-label', alt.replace(/\.\.\.$|…$/,''));
  });
}
(function(){
  let pendente=false;
  const agendar=()=>{ if(pendente) return; pendente=true; requestAnimationFrame(()=>{ pendente=false; ligarRotulosDosCampos(document); }); };
  const iniciar=()=>{ agendar(); new MutationObserver(agendar).observe(document.body,{childList:true,subtree:true}); };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();

/* 08/11 (relato do dono): em Categorias, Insumos, Clientes, Fornecedores e outras listas, clicar numa
   linha redesenha a tela inteira para marcar a seleção. O redesenho jogava a rolagem para o topo e o
   segundo clique do duplo clique abria o item que ficava sob o mouse (o primeiro da lista). Aqui, num
   lugar só: ao clicar numa linha de tabela dentro de uma tela, guarda a rolagem de todas as caixas que
   a contêm (a tabela, a tela e a página em volta) e devolve antes do próximo quadro. Caixa redesenhada
   é achada de novo pelo mesmo caminho dentro da tela. A pesquisa digitada também volta: a maioria das
   telas recriava o campo vazio, a lista inteira reaparecia e o duplo clique abria o primeiro item. */
(function manterRolagemAoClicarNaLinha(){
  const caminho = (el, raiz)=>{ const p=[]; while(el && el!==raiz){ const pai=el.parentElement; if(!pai) return null; p.unshift(Array.prototype.indexOf.call(pai.children, el)); el=pai; } return el===raiz ? p : null; };
  const seguir = (raiz, p)=>p.reduce((el,i)=>el && el.children[i], raiz);
  document.addEventListener('click', e=>{
    const tr = e.target && e.target.closest ? e.target.closest('tbody tr') : null;
    const raiz = tr && tr.closest('.view');
    if(!raiz) return;
    // Campos de texto da tela (pesquisa, filtros digitados), pelo id.
    const campos = [...raiz.querySelectorAll('input[id]')].filter(i=>(!i.type||/^(text|search)$/.test(i.type)) && i.value).map(i=>({ id:i.id, valor:i.value }));
    const guardadas = [];
    for(let el=tr.parentElement; el; el=el.parentElement){
      if(el.scrollTop>0 || el.scrollLeft>0) guardadas.push({ p: raiz.contains(el)&&el!==raiz ? caminho(el, raiz) : null, top:el.scrollTop, left:el.scrollLeft, antiga:el });
    }
    if(!guardadas.length && !campos.length) return;
    let feito = false;
    const devolver = ()=>{
      if(feito) return; feito = true;
      document.removeEventListener('click', devolver);
      campos.forEach(c=>{ const i=document.getElementById(c.id); if(i && raiz.contains(i) && i.value!==c.valor){ i.value=c.valor; i.dispatchEvent(new Event('input',{bubbles:true})); } });
      guardadas.forEach(g=>{
        const caixa = g.antiga.isConnected ? g.antiga : (g.p ? seguir(raiz, g.p) : null);
        if(caixa && (caixa.scrollTop!==g.top || caixa.scrollLeft!==g.left)){ caixa.scrollTop=g.top; caixa.scrollLeft=g.left; }
      });
    };
    // Na hora, logo depois do onclick da linha (o segundo clique de um duplo clique rápido pode chegar
    // antes do próximo quadro). Se a tela parar a propagação do clique, o quadro seguinte faz a devolução;
    // de um jeito ou de outro ela acontece uma vez só e não sobra para o próximo clique.
    document.addEventListener('click', devolver);
    requestAnimationFrame(devolver);
  }, true);
})();
