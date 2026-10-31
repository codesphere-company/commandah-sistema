/* ============ CONFIG ============ */
// Dinheiro e datas (codigo-limpo, passo C): os mesmos cálculos que antes estavam escritos à mão
// em cada arquivo. TOLERANCIA_CENTAVO: abaixo disso o valor é sobra de arredondamento, não dinheiro.
const TOLERANCIA_CENTAVO = 0.009;
function arredondaCentavos(v){ return Math.round(v*100)/100; }
function dataHoraBR(d){ return new Date(d).toLocaleString('pt-BR'); }
const STORE = {
  users:'cantina2:users', insumos:'cantina2:insumos', products:'cantina2:products',
  members:'cantina2:members', sales:'cantina2:sales', orders:'cantina2:orders',
  requests:'cantina2:requests', scheduled:'cantina2:scheduled', cashSession:'cantina2:cashSession', cashHistory:'cantina2:cashHistory', cashMovements:'cantina2:cashMovements',
  categorias:'cantina2:categorias', complementos:'cantina2:complementos', observacoes:'cantina2:observacoes',
  perguntas:'cantina2:perguntas',
  fornecedores:'cantina2:fornecedores', paymentMethods:'cantina2:paymentMethods', cardBrands:'cantina2:cardBrands', contaCategorias:'cantina2:contaCategorias',
  contas:'cantina2:contas', settings:'cantina2:settings', logs:'cantina2:logs', coupons:'cantina2:coupons', orderCounter:'cantina2:orderCounter',
  stockMovements:'cantina2:stockMovements', eventQueue:'cantina2:eventQueue', locais:'cantina2:locais', quemLevou:'cantina2:quemLevou', impressoras:'cantina2:impressoras', estacoes:'cantina2:estacoes', origens:'cantina2:origens'
};
const ICN = {
  // UX-10: ícones de traço novos (pagamento e itens do menu que repetiam desenho)
  alert:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>',
  cash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5h.01M17.5 14.5h.01"/></svg>',
  pix:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 9-9 9-9-9z"/><path d="M8.5 12h7"/></svg>',
  meal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a2 2 0 0 0 4 0V3M8 11v10"/><path d="M17 21V3c-2 1-3 3.5-3 7h3"/></svg>',
  dots:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></svg>',
  station:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/><path d="M2 10h2M20 10h2M9 6.5c0-1.2 1.2-1.2 1.2-2.5M13.8 6.5c0-1.2 1.2-1.2 1.2-2.5"/></svg>',
  route:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/></svg>',
  handoff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11h5m-2-2 2 2-2 2"/></svg>',
  history:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>',
  listCheck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  cashbox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="10" rx="2"/><path d="M7 10V6h10v4"/><path d="M10 15h4"/></svg>',
  medal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="5"/><path d="M8.5 11.5 6 3h4l2 5 2-5h4l-2.5 8.5"/></svg>',
  fileIn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6m-3-3 3 3 3-3"/></svg>',
  percent:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></svg>',
  folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  pie:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9h9"/><path d="M21 12a9 9 0 1 1-9-9"/></svg>',
  layers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/></svg>',
  menuBook:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  sliders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  star:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/></svg>',
  inbox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/></svg>',
  map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  bot:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/></svg>',
  globe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  plug:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v5"/></svg>',
  stamp:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l-1 7h4a2 2 0 0 1 2 2v3H4v-3a2 2 0 0 1 2-2h4z"/><path d="M5 20h14"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  table:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>',
  cart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l1 6a7 7 0 0 1-14 0z"/><path d="M12 13v6M9 21h6"/></svg>',
  calendar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>',
  phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="8" r="3"/><path d="M2.5 20c.6-3.4 2.9-5.3 6-5.3s5.4 1.9 6 5.3"/><circle cx="17" cy="8" r="2.5"/><path d="M15.7 14.5c1.9.3 3.5 1.9 4 4.8"/></svg>',
  chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>',
  chef:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/></svg>',
  queue:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14M5 12h14M5 18h9"/></svg>',
  delivery:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="11" height="9" rx="1.5"/><path d="M13.5 10.5H17l3.5 3v2.5H13.5z"/><circle cx="6.5" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20c.9-4.3 3.6-6.6 7.5-6.6s6.6 2.3 7.5 6.6"/></svg>',
  send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-7-6.5 16-2.7-6.8L4 12z"/></svg>',
  save:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h7V4M8 20v-6h8v6"/></svg>',
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  printer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  burger:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10h17M3.5 14h17"/><path d="M4.5 10a7.5 5 0 0 1 15 0"/><path d="M4 14.3c.5 3 3.6 5.2 8 5.2s7.5-2.2 8-5.2"/></svg>',
  tag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.5L13 21l8-8L11.5 3.5z"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h7"/></svg>',
  resize:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v5h5M20 9V4h-5M20 4L13 11M4 20l7-7"/></svg>',
  question:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.2 9.5a2.8 2.8 0 1 1 4 2.5c-1 .6-1.2 1-1.2 2"/><circle cx="12" cy="16.7" r=".2" fill="currentColor"/></svg>',
  box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5L12 3l8.5 4.5L12 12z"/><path d="M3.5 7.5V16l8.5 4.5V12M20.5 7.5V16L12 20.5"/></svg>',
  editlist:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 12h7M4 18h7"/><path d="M16 17l5-5-3-3-5 5v3z"/></svg>',
  heart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-9.5-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.5 11c-2 4.4-9.5 9-9.5 9z"/></svg>',
  ticket:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.7 1.7 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.7 1.7 0 0 0 0-3z"/><path d="M9 7v10" stroke-dasharray="2 2.4"/></svg>',
  megaphone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4h3l6 4V6L6 10z"/><path d="M14 9a3.2 3.2 0 0 1 0 6M18 6a7 7 0 0 1 0 12"/></svg>',
  card:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 9.5h18M6 14h5"/></svg>',
  truck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="11" height="9" rx="1.5"/><path d="M13.5 10.5H17l3.5 3v2.5H13.5z"/><circle cx="6.5" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/></svg>',
  arrowUpBox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 16V8M8.5 11.5L12 8l3.5 3.5"/></svg>',
  arrowDownBox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8.5 12.5L12 16l3.5-3.5"/></svg>',
  idcard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="12" r="2.3"/><path d="M5.5 16.3c.5-1.7 1.6-2.6 3-2.6s2.5.9 3 2.6"/><path d="M14.5 9.5h4M14.5 13h4M14.5 16h2.5"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"/><path d="M11 6.5l1-1a4 4 0 0 1 5.5 5.5l-1.5 1.5"/><path d="M13 17.5l-1 1a4 4 0 0 1-5.5-5.5l1.5-1.5"/></svg>',
  trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 5H5a3 3 0 0 0 3 5M16 5h3a3 3 0 0 1-3 5"/><path d="M12 14v3M9 21h6M10 17h4v4h-4z"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  receipt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z"/><path d="M9 8h6M9 12h6"/></svg>',
  swap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.2 6.2l1.4 1.4M18.4 16.4l1.4 1.4M3 12h2M19 12h2M4.2 17.8l1.4-1.4M18.4 7.6l1.4-1.4"/></svg>',
  hash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3L7 21M17 3l-2 18M4 8.5h17M3 15.5h17"/></svg>',
  briefcase:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M8.5 7.5V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/></svg>',
  key:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4.2"/><path d="M11 12l9-9M17 6l2.5 2.5M14 9l2 2"/></svg>',
  scroll:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h11v14a2.5 2.5 0 0 1-2.5 2.5H8.5A2.5 2.5 0 0 1 6 18z"/><path d="M17 4a2.5 2.5 0 0 1 2.5 2.5V9H17M9 9h5M9 13h5"/></svg>',
  headset:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M20 19v1a3 3 0 0 1-3 3h-3"/></svg>',
  pulse:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12h4l2-6 4 12 2-9 1.5 3h5.5"/></svg>',
  monitor:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/></svg>',
  mapPin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.3"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7M18.5 7l-.8 12a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 7"/><path d="M10 11v6M14 11v6"/></svg>',
  scale:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 21h10"/><path d="M4 7h6M14 7h6"/><path d="M4 7l-2.5 5.5a3 3 0 0 0 5 0z"/><path d="M20 7l-2.5 5.5a3 3 0 0 0 5 0z"/></svg>',
  grid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.3"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.3"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.3"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.3"/></svg>',
  brandmark:(ring='var(--c-mark)',dot='var(--c-mark-ink)',size=16)=>`<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><path d="M48.55 44.93A21 21 0 1 1 48.55 19.07" fill="none" stroke="${ring}" stroke-width="10" stroke-linecap="round"/><circle cx="32" cy="32" r="7.5" fill="${dot}"/></svg>`,
};
// PROD-02 (decisão do dono, auditoria 07/10): módulos que só gravam configuração e não fazem
// nada ficam fora do menu, para ninguém achar que nota fiscal, Pix ou SMS estão funcionando.
// O código continua; para voltar um módulo, tire o nome daqui.
const HIDDEN_MODULES = new Set(['Connect','Emissão Fiscal','TEF','SMS','Disparador Inteligente','Fidelidade','Bot WhatsApp','Pix Online','Bina','Mapas','Balança','Minha Assinatura','Meu Delivery','Delivery']);
const RIBBON_TABS = [
  { id:'principal', label:'Principal', groups:[
      { label:'Caixa', items:[ {label:'Abrir/Fechar', icon:ICN.lock, view:'caixa'} ] },
      { label:'Pedidos', items:[
          {label:'Mesas/Comandas', icon:ICN.table, view:'comandas'},
          {label:'Caixa/PDV', icon:ICN.cart, view:'balcao'},
          {label:'Delivery', icon:ICN.delivery, view:'delivery'},
          {label:'Monitor de Cozinha', icon:ICN.chef, view:'cozinha'}
      ]},
      { label:'Clientes', items:[ {label:'Clientes', icon:ICN.users, view:'associados'} ] }
  ]},
  { id:'produtos', label:'Produtos', groups:[
      { label:'Produtos', items:[ {label:'Produtos', icon:ICN.burger, view:'produtos'} ] },
      { label:'Organização de Produtos', items:[
          {label:'Complementos', icon:ICN.plus, perm:'complementos', action:'openComplementsView'}, {label:'Observações', icon:ICN.doc, view:'observacoes'},
          {label:'Categorias', icon:ICN.tag, view:'categorias'}, {label:'Tipos e Tamanhos', icon:ICN.resize, perm:'complementos', action:'openTypesSizesView'}, {label:'Perguntas', icon:ICN.question, view:'perguntas'}
      ]},
      { label:'Insumos', items:[ {label:'Insumos', icon:ICN.box, view:'insumos'} ] },
      { label:'Estoque', items:[ {label:'Alterar em Lote', icon:ICN.editlist, perm:'produtos', action:'openBulkPriceModal'}, {label:'Alterar com NFe', icon:ICN.fileIn, perm:'insumos', action:'openNfeStockWindow'} ] }
  ]},
  { id:'marketing', label:'Marketing', groups:[
      { label:'Benefícios', items:[ {label:'Promoções', icon:ICN.percent, perm:'cupons', action:"openMarketingView", actionArg:'promocoes'}, {label:'Fidelidade', icon:ICN.heart, perm:'cupons', action:'toggleMarketingRibbonMenu', actionArg:'fidelidade'}, {label:'Cupons', icon:ICN.ticket, perm:'cupons', action:"openMarketingView", actionArg:'cupons'} ] },
      { label:'Divulgação', items:[ {label:'SMS', icon:ICN.chat, perm:'cupons', action:'openSmsWindow'} ] },
      { label:'Relacionamento', items:[ {label:'Disparador Inteligente', icon:ICN.megaphone, perm:'cupons', action:'toggleMarketingRibbonMenu', actionArg:'disparador'} ] }
  ]},
  { id:'financeiro', label:'Financeiro', groups:[
      { label:'Organização de Contas', items:[ {label:'Formas de Pagamento', icon:ICN.card, view:'pagamentos'}, {label:'Categoria de Contas', icon:ICN.folder, view:'contascategorias'}, {label:'Fornecedores', icon:ICN.truck, view:'fornecedores'} ] },
      { label:'Contas a Pagar / Receber', items:[ {label:'Contas a Pagar', icon:ICN.arrowUpBox, perm:'contas', action:'openFinancialView', actionArg:'pagar'}, {label:'Contas a Receber', icon:ICN.arrowDownBox, perm:'contas', action:'openFinancialView', actionArg:'receber'} ] },
      { label:'Fiado', items:[ {label:'Conta Corrente (Fiado)', icon:ICN.idcard, perm:'receber-fiado', action:'openFinancialView', actionArg:'fiado'} ] },
      { label:'Integrações', items:[ {label:'Pix Online', icon:ICN.pix, perm:'config-sistema', action:'openPixOnlineConfig'} ] }
  ]},
  { id:'relatorios', label:'Relatórios', groups:[
      { label:'Vendas', items:[ {label:'Mais Vendidos', icon:ICN.trophy, perm:'relatorios', action:'openReportView', actionArg:'Mais Vendidos'}, {label:'Histórico de Pedidos', icon:ICN.history, perm:'relatorios', action:'openReportView', actionArg:'Histórico de Pedidos'}, {label:'Histórico de Itens Vendidos', icon:ICN.listCheck, perm:'relatorios', action:'openReportView', actionArg:'Histórico de Itens Vendidos'}, {label:'Ranking de Atendimentos', icon:ICN.medal, perm:'relatorios', action:'openReportView', actionArg:'Ranking de Atendimentos'} ] },
      { label:'Caixa', items:[ {label:'Histórico do Caixa', icon:ICN.cashbox, perm:'relatorios', action:'openReportView', actionArg:'Histórico do Caixa'} ] },
      { label:'Auditoria', items:[ {label:'Movimentações por Usuário', icon:ICN.history, perm:'logs', action:'openReportView', actionArg:'Movimentações por Usuário'} ] },
      { label:'Financeiro', items:[ {label:'Resumo do Dia', icon:ICN.calendar, perm:'relatorios', action:'openReportView', actionArg:'Resumo do Dia'}, {label:'Exportar para o Contador', icon:ICN.receipt, perm:'relatorios', action:'openAccountantExport'}, {label:'Meu Negócio', icon:ICN.chart, perm:'relatorios', action:'openReportView', actionArg:'Meu Negócio'}, {label:'Meu Delivery', icon:ICN.clock, perm:'relatorios', action:'openReportView', actionArg:'Meu Delivery'}, {label:'Recebimentos (Pedidos e Fiado)', icon:ICN.cash, perm:'relatorios', action:'openReportView', actionArg:'Recebimentos (Pedidos e Fiado)'}, {label:'Resumo Financeiro', icon:ICN.pie, perm:'relatorios', action:'openReportView', actionArg:'Resumo Financeiro'}, {label:'DRE Simplificado', icon:ICN.receipt, perm:'relatorios', action:'openReportView', actionArg:'DRE Simplificado'} ] },
      { label:'Estoque', items:[ {label:'Entradas e Saídas', icon:ICN.swap, perm:'relatorios', action:'openReportView', actionArg:'Entradas e Saídas'}, {label:'Posição por Data', icon:ICN.layers, perm:'relatorios', action:'openReportView', actionArg:'Posição por Data'} ] }
  ]},
  { id:'apps', label:'Apps', groups:[
      { label:'Outros atendimentos', items:[ {label:'Fila de Atendimento', icon:ICN.queue, view:'fila-atendimento'}, {label:'Agendados', icon:ICN.calendar, view:'agendamentos'}, {label:'Cardápio Digital', icon:ICN.menuBook, view:'cardapio'} ] },
      { label:'Atendimento', items:[ {label:'Bot WhatsApp', icon:ICN.bot, perm:'config-sistema', action:'openWhatsAppBotConfig'} ] },
      { label:'Ferramentas', items:[ {label:'Bina', icon:ICN.user, perm:'config-sistema', action:'toggleAppRibbonMenu', actionArg:'bina'}, {label:'Mapas', icon:ICN.map, perm:'config-sistema', action:'toggleAppRibbonMenu', actionArg:'maps'}, {label:'Painel de Senhas', icon:ICN.grid, view:'painel-senhas'}, {label:'Balança', icon:ICN.scale, perm:'config-sistema', action:'openScaleConfig'} ] },
      { label:'Módulos (Recursos Premium)', items:[ {label:'Mobile', icon:ICN.phone, view:'mobile-qr'}, {label:'Pedidos Online', icon:ICN.globe, view:'cardapio'}, {label:'Connect', icon:ICN.link, perm:'modulos', action:'openAppModuleConfig', actionArg:'Connect'}, {label:'Emissão Fiscal', icon:ICN.stamp, perm:'modulos', action:'openAppModuleConfig', actionArg:'Emissão Fiscal'}, {label:'TEF', icon:ICN.plug, perm:'modulos', action:'openAppModuleConfig', actionArg:'TEF'} ] }
  ]},
  { id:'config', label:'Configurações', groups:[
      { label:'Configurações', items:[
          {label:'Configurações do Sistema', icon:ICN.gear, perm:'config-sistema', action:'openSystemSettings'}, {label:'Numeração de Pedidos', icon:ICN.hash, perm:'config-sistema', action:'openNumberingSettings'},
          {label:'Colaboradores', icon:ICN.briefcase, view:'usuarios'}, {label:'Alterar Minha Senha', icon:ICN.key, perm:'senha-propria', action:'openChangePinModal'}, {label:'Backup', icon:ICN.save, view:'backup'}, {label:'Privacidade (LGPD)', icon:ICN.key, perm:'config-sistema', action:'openPrivacySettings'}, {label:'NFC-e (nota fiscal)', icon:ICN.receipt, perm:'config-sistema', action:'openNfceSettings'}
      ]},
      { label:'Áreas do Clube', items:[ {label:'Locais/Áreas', icon:ICN.mapPin, view:'locais'}, {label:'Quem Levou', icon:ICN.handoff, view:'quemlevou'}, {label:'Estações', icon:ICN.station, view:'estacoes'}, {label:'Origens de Pedido', icon:ICN.route, view:'origens'}, {label:'Impressoras', icon:ICN.printer, view:'impressoras'} ] },
      { label:'Logs e Fila de Eventos', items:[ {label:'Logs', icon:ICN.scroll, perm:'logs', action:'openLogsView', actionArg:'Logs'}, {label:'Fila de Eventos', icon:ICN.inbox, perm:'logs', action:'openLogsView', actionArg:'Fila de Eventos'}, {label:'Erros do Sistema', icon:ICN.alert, perm:'logs', action:'openLogsView', actionArg:'Erros do Sistema'} ] },
      { label:'Versão Premium', items:[ {label:'Minha Assinatura', icon:ICN.star, perm:'config-sistema', action:'openSubscriptionView'} ] },
      { label:'Ajuda e Suporte', items:[ {label:'Ajuda e Suporte', icon:ICN.headset, view:'ajuda'}, {label:'Diagnóstico de Serviços', icon:ICN.pulse, view:'diagnostico'} ] }
  ]}
];
const SIMPLE_RIBBON_COZINHA = [
  { id:'cozinha_tab', label:'Cozinha', groups:[ { label:'Preparo', items:[ {label:'Monitor de Cozinha', icon:ICN.chef, view:'cozinha'} ] } ] }
];
/* ROLE_PERMS — tokens de permissão de TELA (client-side).
   ATENÇÃO: isto NÃO é a barreira de segurança. A barreira é a RLS por papel no
   Postgres (ver supabase/migrations/*_rls_por_papel.sql). Este array existe pra
   não mostrar botão que o banco vai recusar — os dois precisam andar juntos.
   Quem escreve `cantina2:settings` exige 'config-sistema'; quem lê o log de
   auditoria exige 'logs'; ambos são exclusivos de admin, igual à migration.
   'senha-propria': token de autoatendimento (trocar o próprio PIN). Todo papel
   tem, porque não depende de escrita administrativa — pra usuário migrado o
   modal só informa que a troca é feita pelo servidor. */
const ROLE_PERMS = {
  admin: ['caixa','balcao','comandas','delivery','fila-atendimento','agendamentos','cardapio','associados','produtos','insumos','usuarios','relatorios','cozinha',
    'categorias','complementos','observacoes','perguntas','fornecedores','pagamentos','contascategorias','contas','locais','quemlevou','impressoras','estacoes','origens',
    'config-sistema','backup','logs','painel-senhas','ajuda','diagnostico','totem','cupons','modulos','mobile-qr','senha-propria','cancelar-comanda','receber-fiado'],
  caixa: ['caixa','balcao','comandas','delivery','fila-atendimento','agendamentos','cardapio','associados','locais','quemlevou','impressoras','estacoes','origens','relatorios','painel-senhas','totem','ajuda','mobile-qr','senha-propria','cancelar-comanda','receber-fiado'],
  cozinha: ['cozinha','senha-propria']
};
function rolePermissions(role){const custom=state&&state.settings&&state.settings.rolePermissions&&state.settings.rolePermissions[role];if(!Array.isArray(custom))return ROLE_PERMS[role]||[];
  // 'receber-fiado' (OP-08) surgiu depois: matriz salva antes dele (versão < 2) recebe o padrão do papel.
  if((Number(state.settings.rolePermissionsVersion)||1)<2&&(ROLE_PERMS[role]||[]).includes('receber-fiado')&&!custom.includes('receber-fiado'))return custom.concat('receber-fiado');
  return custom;}
/* Guarda de permissão pra botão que vive DENTRO de uma tela permitida (não é
   item de ribbon). Usada nos fluxos que gravam cantina2:settings, que passou a
   ser escrita exclusiva de admin/dono na RLS — sem isto o caixa clicaria em
   Salvar e tomaria erro de permissão do banco, com banner de falha ao salvar. */
function hasPerm(token){ return !!currentUser && rolePermissions(currentUser.role).includes(token); }
function requirePerm(token){
  if(hasPerm(token)) return true;
  toast('Sem permissão para o seu perfil. Fale com um administrador.');
  return false;
}
const UNIT_OPTIONS = ['g','kg','ml','l','un'];

let state = { users:[], insumos:[], products:[], members:[], sales:[], orders:[], requests:[], scheduled:[], cashSession:null, cashHistory:[], cashMovements:[],
  categorias:[], complementos:[], observacoes:[], perguntas:[], fornecedores:[], paymentMethods:[], cardBrands:[], contaCategorias:[], contas:[], settings:{}, logs:[], coupons:[], orderCounter:0, stockMovements:[], eventQueue:[], locais:[], quemLevou:[], impressoras:[], estacoes:[], origens:[] };
let currentUser = null;
let currentSaleDraft = null;
let cardapioDraft = null;
let tempPayments = [];
let pinBuffer = '';
let pinTargetUser = null;
let activeModuleReference = '';
let marketingSub = 'cupons';
let insumoOptionsOpen = false;
let userOptionsOpen = false;
let selectedPaymentMethodId = null;
let selectedCardBrandId = null;
let selectedCouponId = null;
let selectedPromotionId = null;

function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function fmt(n){ return 'R$ ' + (Number(n)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
// OP-14 (decisão do Fabricio, 2026-10-10): qualquer fiado bloqueia. Sócio com dívida não abre
// comanda nem compra até pagar; vale para o titular e os dependentes. Só o administrador libera
// (members.debt_release = {amount, at, by}); a liberação vale enquanto a dívida não passar do valor
// liberado, então um fiado novo bloqueia de novo. credit_limit continua sem uso (decisão de 03/10).
function memberBlockedByDebt(member){
  const debt=Number(member&&member.debt)||0;
  if(debt<=TOLERANCIA_CENTAVO) return false;
  const rel=member.debtRelease;
  return !(rel && debt<=(Number(rel.amount)||0)+TOLERANCIA_CENTAVO);
}
// OP-14 (pedido do dono, 10/10): ao abrir comanda para sócio bloqueado, aviso com Cancelar ou
// Pagar; pagando a dívida toda, a comanda abre e segue para o pedido. Liberar sem pagar exige a
// senha de um administrador (staff-auth release_debt), mesmo com o caixa logado.
let blockedContinue = null, afterFiadoPaid = null;
async function ensureMemberCanOpen(member, onContinue){
  if(!member) return true;
  try{ member = await MembersStore.refreshOne(member.id) || member; }catch(e){ /* sem rede: decide pelo que o aparelho tem */ }
  if(!memberBlockedByDebt(member)) return true;
  blockIfMemberInDebt(member, onContinue);
  return false;
}
function blockIfMemberInDebt(member, onContinue){
  if(!memberBlockedByDebt(member)) return false;
  blockedContinue = onContinue ? { memberId: member.id, fn: onContinue } : null;
  const canReceive = hasPerm('contas')||hasPerm('receber-fiado');
  openModal('Sócio bloqueado', `
    <p class="sub">${h(member.name)} tem <b style="color:var(--c-danger)">${fmt(member.debt)}</b> de fiado em aberto e não pode consumir até pagar.</p>
    ${canReceive?'':'<p class="sub">Peça ao caixa para receber o pagamento.</p>'}
    <div class="row" style="margin-top:14px">
      <button class="btn" onclick="blockedContinue=null;closeModal()">Cancelar</button>
      ${canReceive?`<button class="btn btn-primary" onclick="payDebtAndContinue(${jsArg(member.id)})">💰 &nbsp; Pagar ${fmt(member.debt)}</button>`:''}
    </div>
    <p style="margin:12px 0 0;text-align:right"><button type="button" class="link-btn" onclick="releaseMemberDebtBlock(${jsArg(member.id)})">Liberar com senha de administrador</button></p>
  `);
  return true;
}
function payDebtAndContinue(memberId){
  const m = state.members.find(x=>x.id===memberId); if(!m) return;
  afterFiadoPaid = { memberId, fn: blockedContinue && blockedContinue.memberId===memberId ? blockedContinue.fn : null, at: Date.now() };
  window.selectedFiadoMemberId = memberId;
  openFiadoEntry('payment');
  const v = document.getElementById('fiadoValue'); if(v){ v.value = (arredondaCentavos(Number(m.debt)||0)).toFixed(2); v.select(); }
}
async function runAfterFiadoPaid(m, type){
  const c = afterFiadoPaid;
  if(type!=='payment' || !c || c.memberId!==m.id || Date.now()-c.at>15*60000) return;
  afterFiadoPaid = null;
  try{ m = await MembersStore.refreshOne(m.id) || m; }catch(e){}
  if(memberBlockedByDebt(m)){ toast('Pagamento registrado. Ainda falta '+fmt(m.debt)+' para liberar o sócio.'); return; }
  if(c.fn){ blockedContinue = null; c.fn(); }
}
// Pede o PIN de um colaborador. onSubmit(staffId, pin) devolve uma mensagem de erro ou nada.
function askStaffPin(opts){
  const staff = (opts.staff||[]).filter(Boolean);
  if(!staff.length){ toast(opts.emptyMessage||'Nenhum colaborador habilitado.'); return; }
  const def = staff.find(u=>u.id===(opts.defaultId))||staff[0];
  openModal(opts.title, `
    ${opts.message?`<p class="sub">${opts.message}</p>`:''}
    ${opts.extraHtml||''}
    <div class="field"><label>${h(opts.whoLabel||'Quem autoriza')}</label><select id="staffPinWho" ${opts.lockWho?'disabled':''}>${staff.map(u=>`<option value="${h(u.id)}" ${u.id===def.id?'selected':''}>${h(u.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Senha (PIN)</label><input id="staffPinValue" type="password" inputmode="numeric" autocomplete="off" maxlength="64"></div>
    <p id="staffPinError" class="sub" style="color:var(--c-danger);min-height:1.2em;margin:4px 0 0"></p>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="staffPinCancel">Voltar</button>
      <button class="btn btn-primary" id="staffPinOk">${h(opts.confirmLabel||'Confirmar')}</button>
    </div>`);
  const input = document.getElementById('staffPinValue'), err = document.getElementById('staffPinError'), ok = document.getElementById('staffPinOk');
  document.getElementById('staffPinCancel').onclick = ()=>{ if(opts.onCancel) opts.onCancel(); else closeModal(); };
  const submit = async ()=>{
    const pin = input.value; if(!pin){ input.focus(); return; }
    ok.disabled = true; err.textContent = '';
    let msg;
    try{ msg = await opts.onSubmit(document.getElementById('staffPinWho').value, pin); }
    catch(e){ msg = 'Não foi possível conferir a senha agora. Tente de novo.'; }
    ok.disabled = false;
    if(msg){ err.textContent = msg; input.value = ''; input.focus(); }
  };
  ok.onclick = submit;
  input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
  setTimeout(()=>{ const first=opts.focusId&&document.getElementById(opts.focusId); (first||input).focus(); }, 50);
}
async function staffAuthCall(body){
  const { data, error } = await supabaseClient.functions.invoke('staff-auth', { body });
  if(error || !data || data.error){
    let msg = data && data.error;
    if(!msg && error && error.context && typeof error.context.json==='function'){ try{ const b = await error.context.json(); msg = b && b.error; }catch(e){} }
    return { error: msg || 'Não foi possível conferir a senha agora.' };
  }
  return { data };
}
function releaseMemberDebtBlock(memberId, reopenSaleId){
  const member = state.members.find(x=>x.id===memberId); if(!member) return;
  const admins = (state.users||[]).filter(u=>u.role==='admin' && u.active!==false);
  askStaffPin({
    title: 'Liberar '+member.name,
    message: 'A pendência de '+fmt(member.debt)+' continua em aberto. O sócio volta a consumir; um fiado novo bloqueia de novo.',
    whoLabel: 'Administrador', staff: admins, defaultId: currentUser && currentUser.role==='admin' ? currentUser.id : null,
    emptyMessage: 'Não há administrador cadastrado.', confirmLabel: 'Liberar consumo',
    onCancel: ()=>{ if(blockedContinue && blockedContinue.memberId===memberId) blockIfMemberInDebt(member, blockedContinue.fn); else if(reopenSaleId) openNovoPedidoModal(reopenSaleId); else closeModal(); },
    onSubmit: async (staffId, pin)=>{
      const admin = admins.find(u=>u.id===staffId); if(!admin) return 'Escolha um administrador.';
      if(isCloudMode()){
        const r = await staffAuthCall({ action:'release_debt', staff_id: staffId, pin, member_id: member.id });
        if(r.error) return r.error;
        member.debtRelease = r.data.release;
      } else {
        if(String(admin.pin||'')!==String(pin)) return 'PIN incorreto.';
        member.debtRelease = { amount: arredondaCentavos(Number(member.debt)||0), at: new Date().toISOString(), by: admin.name };
        await save('members');
        logAction('Sócio liberado com pendência de '+fmt(member.debtRelease.amount)+' por '+admin.name+': '+member.name);
      }
      toast(member.name+' liberado para consumir.');
      const c = blockedContinue && blockedContinue.memberId===memberId ? blockedContinue.fn : null;
      blockedContinue = null;
      closeModal(); renderAll();
      if(c) c(); else if(reopenSaleId) openNovoPedidoModal(reopenSaleId);
    }
  });
}
function memberAvailableCredit(member){ return member ? Math.max(0, -(Number(member.debt)||0)) : 0; }
function memberDebtLabel(member){ const d=Number(member.debt)||0; if(d>TOLERANCIA_CENTAVO) return ' (deve '+fmt(d)+')'; if(d<-TOLERANCIA_CENTAVO) return ' (crédito '+fmt(-d)+')'; return ''; }
function todaysSalesForMember(memberId){
  const today = todayStr();
  return state.sales.filter(s=>s.memberId===memberId && localDay(s.closedAt||s.openedAt)===today);
}
function whatsAppCollectionMessage(member){
  const clubName = state.settings.clubName || 'o clube';
  const lines = [];
  todaysSalesForMember(member.id).forEach(s=>{
    (s.items||[]).filter(i=>!i.canceled).forEach(i=>{ lines.push('• '+i.qty+'x '+i.name+' — '+fmt(i.price*i.qty)); });
  });
  const itemsText = lines.length ? ('\n\nConsumo de hoje:\n'+lines.join('\n')) : '';
  const pixKey = (state.settings.pixKey||'').trim();
  const pixText = pixKey ? ('\n\nChave Pix para pagamento: '+pixKey) : '';
  return `Olá, ${member.name}! Aqui é ${clubName}. Notamos uma pendência de ${fmt(member.debt)} em sua conta.${itemsText}${pixText}\n\nPoderia regularizar quando possível? Assim que o pagamento for feito, o consumo é liberado normalmente. Obrigado!`;
}
function openWhatsAppCollection(memberId){
  const m = state.members.find(x=>x.id===memberId); if(!m){ toast('Cliente não encontrado.'); return; }
  if(!m.phone){ toast('Este cliente não tem telefone cadastrado.'); return; }
  const phone = String(m.phone).replace(/\D/g,'');
  const phoneWithCountry = phone.length<=11 ? '55'+phone : phone;
  const text = encodeURIComponent(whatsAppCollectionMessage(m));
  window.open('https://wa.me/'+phoneWithCountry+'?text='+text, '_blank');
  logAction('Cobrança via WhatsApp enviada (abertura de conversa) para '+m.name);
}
function promptWhatsAppCollection(member){
  setTimeout(()=>{
    openModal('Pedido fechado com pendência', `
      <p class="sub">${h(member.name)} ficou com saldo devedor de <b style="color:var(--red)">${fmt(member.debt)}</b>.</p>
      <div class="row" style="margin-top:14px">
        <button class="btn" onclick="closeModal()">Agora não</button>
        <button class="btn btn-primary" onclick="closeModal();openWhatsAppCollection(${jsArg(member.id)})">📱 &nbsp; Enviar cobrança via WhatsApp</button>
      </div>
    `);
  }, 400);
}
// Dia no fuso do aparelho. toISOString() dá o dia em UTC, que no Brasil vira
// "amanhã" às 21h (OP-03, auditoria 07/10). Aceita Date, ISO com hora ou
// data pura 'AAAA-MM-DD' (que volta igual).
function localDay(value){
  if(!value) return '';
  if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if(isNaN(d)) return String(value).slice(0,10);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function todayStr(){ return localDay(new Date()); }
/* Formas de pagamento (codigo-limpo, PR A): o nome que aparece na tela e o grupo usado nos
   totais (dinheiro, cartão, pix, fiado, outros) ficam só aqui. Forma nova = uma linha na tabela.
   Fora da tabela: "outro:Nome" mostra o Nome; o resto aparece como veio e soma em "outros". */
const FORMAS_PAGAMENTO = {
  dinheiro: { label:'Dinheiro',      grupo:'dinheiro' },
  credito:  { label:'Crédito',       grupo:'cartao' },
  debito:   { label:'Débito',        grupo:'cartao' },
  cartao:   { label:'Cartão',        grupo:'cartao' },
  pix:      { label:'Pix',           grupo:'pix' },
  vale:     { label:'Vale Refeição', grupo:'outros' },
  fiado:    { label:'Fiado',         grupo:'fiado' },
};
function formaPagamento(m){ return Object.prototype.hasOwnProperty.call(FORMAS_PAGAMENTO, m) ? FORMAS_PAGAMENTO[m] : null; }
function methodLabel(m){ const f = formaPagamento(m); return f ? f.label : typeof m==='string' && m.startsWith('outro:') ? m.slice(6) : m; }
// Igual a methodLabel, mas sem forma informada mostra "Outro" (caixa e movimentos).
function paymentMethodLabel(m){ return m ? methodLabel(m) : 'Outro'; }
function methodBucket(m){ const f = formaPagamento(m); return f ? f.grupo : 'outros'; }
function totaisPorFormaVazio(){ return { dinheiro:0, cartao:0, pix:0, fiado:0, outros:0 }; }
// Soma os pagamentos das vendas por grupo. pularParcial: o fechamento do caixa não conta de
// novo os parciais (OP-13), que já entraram no caixa como movimento.
function somaPorForma(vendas, opcoes){
  const pularParcial = !!(opcoes && opcoes.pularParcial), total = totaisPorFormaVazio();
  (vendas||[]).forEach(v=>(v.payments||[]).forEach(p=>{ if(pularParcial && p.partial) return; total[methodBucket(p.method)] += Number(p.amount)||0; }));
  return total;
}
function timeFmt(d){ return new Date(d).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function h(value){ return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/* SEG-02 (auditoria 2026-10-07): valor que vai DENTRO de um onclick="..." montado em
   template string. Vira um literal de string JS (JSON) escapado para atributo HTML:
   um id ou nome com aspas, parênteses ou tags chega à função como texto e nunca
   como código. Antes era '${id}' cru: um caixa com conhecimento técnico podia gravar um
   id que fechava a aspa e rodava código quando o admin abrisse a tela. Uso:
   onclick="openComanda(${jsArg(s.id)})" (sem aspas em volta). */
function jsArg(v){ return h(JSON.stringify(v==null ? '' : String(v))); }
function validPin(value, len){ return new RegExp('^\\d{'+(len===6?6:4)+'}$').test(String(value)); }
// Tamanho do PIN de cada colaborador. Quem já tinha PIN de 4 continua com 4 até redefinir.
function pinLengthFor(u){ return Number(u&&u.pinLength)===6 ? 6 : 4; }
const saveQueues = {};

const SUPABASE_URL = 'https://ezfoymdesmarpunmixbs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_m56iV0j3aIHlj_jth44jyw_CIw7CmyG';
const TENANT_KEY = 'commandah:tenant_id';
const TURNSTILE_SITE_KEY = '0x4AAAAAAFTbsXihCdq8uC0z'; // widget "Commandah" (10/10), hostname codesphere-company.github.io
let tsCaptchaToken = null, tsCaptchaFailed = false;
let tsTurnstileWidgetId = null;
function getTenantId(){ try{ return localStorage.getItem(TENANT_KEY)||''; }catch(e){ return ''; } }
function setTenantId(id){ try{ localStorage.setItem(TENANT_KEY, id); }catch(e){} }
function waitForSupabaseSdk(timeoutMs){
  return new Promise(resolve=>{
    const start=Date.now();
    (function check(){
      if(window.supabase && typeof window.supabase.createClient==='function') return resolve(true);
      if(Date.now()-start > timeoutMs) return resolve(false);
      setTimeout(check, 100);
    })();
  });
}
let supabaseClient = null;
const APP_DATA_NULL = '__commandahNull';
function buildSupabaseStorageApi(client, tenantId){
  return {
    mode:'Nuvem (Supabase)', client, tenantId,
    async get(key){
      const { data, error } = await client.from('app_data').select('value').eq('tenant_id', tenantId).eq('key', key).maybeSingle();
      if(error) throw error;
      if(!data) return null;
      if(data.value && data.value[APP_DATA_NULL] === true) return { value: 'null' };
      return { value: JSON.stringify(data.value) };
    },
    // t404: todas as chaves numa requisição só (no login eram ~30 idas e voltas). Chave que não
    // veio (não existe ou a RLS escondeu) fica de fora, igual ao get() que devolve null.
    async getMany(keys){
      const { data, error } = await client.from('app_data').select('key, value').eq('tenant_id', tenantId).in('key', keys);
      if(error) throw error;
      const out = {};
      (data||[]).forEach(row=>{ out[row.key] = (row.value && row.value[APP_DATA_NULL] === true) ? { value: 'null' } : { value: JSON.stringify(row.value) }; });
      return out;
    },
    async set(key, value){
      // app_data.value é NOT NULL e o PostgREST transforma JSON null em NULL do SQL.
      // Sem o marcador, fechar o caixa (cashSession = null) era recusado pelo banco:
      // a tela mostrava o caixa fechado, mas no servidor ele continuava aberto.
      const parsed = JSON.parse(value);
      const stored = parsed === null ? { [APP_DATA_NULL]: true } : parsed;
      const { error } = await client.from('app_data').upsert({ tenant_id: tenantId, key, value: stored, updated_at: new Date().toISOString() }, { onConflict:'tenant_id,key' });
      if(error) throw error;
    }
  };
}
/* Sessão atual é a do DONO do estabelecimento?
   Vale ouro pra decidir o que o cliente pode fazer sem consultar o servidor:
   o dono passa por todas as policies de RLS; o operador (staff) não. */
let sessionIsOwner = false;

/* Resolve o tenant da sessão atual, aceitando as DUAS formas de sessão:
   - dono: linha em tenant_owners (o cliente lê direto, tem policy pra isso);
   - operador: sessão criada pela Edge Function staff-auth. tenant_staff tem RLS
     ligada e ZERO policies de propósito (guarda pin_hash), então o navegador NÃO
     consegue consultá-la. Quem resolve é current_tenant_id(), SECURITY DEFINER,
     já exposta como RPC pra anon/authenticated no baseline.
   Antes daqui só existia o caminho do dono: uma sessão de operador não resolvia
   tenant nenhum no boot e caía na tela de e-mail/senha do dono — resultado, o
   aparelho vivia logado como DONO e a RLS por papel não valeria nada.
   Retorna null só quando as duas consultas RESPONDERAM e não acharam tenant.
   Se alguma falhou (rede/servidor), retorna {networkError:true}: "não consegui
   perguntar" não pode virar "essa conta não tem estabelecimento" — mesma
   armadilha que a Fase 2 corrigiu em storageApi.get(). */
async function resolveTenantSession(userId){
  let failed = false;
  try{
    const { data, error } = await supabaseClient.from('tenant_owners').select('tenant_id').eq('user_id', userId).maybeSingle();
    if(error) failed = true;
    else if(data && data.tenant_id) return { tenantId: data.tenant_id, isOwner: true };
  }catch(e){ failed = true; }
  try{
    const { data: staffTenant, error } = await supabaseClient.rpc('current_tenant_id');
    if(error) failed = true;
    else if(staffTenant) return { tenantId: staffTenant, isOwner: false };
  }catch(e){ failed = true; }
  return failed ? { networkError: true } : null;
}
async function createStorageAdapter(){
  if(window.storage && typeof window.storage.get==='function' && typeof window.storage.set==='function'){
    return { mode:'Compartilhado', get:(key)=>window.storage.get(key,true), set:(key,value)=>window.storage.set(key,value,true) };
  }
  try{
    const check='cantina2:localcheck'; localStorage.setItem(check,'1'); localStorage.removeItem(check);
    return {
      mode:'Local',
      async get(key){ const value=localStorage.getItem(key); return value===null?null:{value}; },
      async set(key,value){ localStorage.setItem(key,value); }
    };
  }catch(e){
    return { mode:'Indisponível', async get(){ throw e; }, async set(){ throw e; } };
  }
}
let storageApi = null;

/* settings é lido por todo operador, então não pode guardar segredo. Os tokens
   de WhatsApp/SMS/canais digitais/backup nunca foram usados (não há integração
   real) e saíram dos formulários; aqui tira da memória o que ainda vier do
   banco, pra um save('settings') qualquer não gravar de volta. */
function stripIntegrationTokens(settings){
  if(!settings || typeof settings!=='object') return;
  // PROD-02/SEG-07: Connect, Emissão Fiscal e TEF não têm integração; o que foi digitado nesses
  // formulários (inclusive campos de senha) ficava em settings, legível por todo operador.
  delete settings.appModules;
  ['whatsappBot','sms'].forEach(k=>{ if(settings[k] && typeof settings[k]==='object') delete settings[k].token; });
  ['digitalChannels','cloudBackup'].forEach(k=>{
    const group = settings[k];
    if(group && typeof group==='object') Object.values(group).forEach(v=>{ if(v && typeof v==='object') delete v.token; });
  });
}

