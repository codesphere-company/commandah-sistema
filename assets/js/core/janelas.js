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

