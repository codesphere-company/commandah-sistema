/* ============ TRAVA CONTRA DUPLO CLIQUE: funções protegidas ============
   singleFlight() fica em core/avisos.js. Estas linhas embrulham funções declaradas em vários
   arquivos; precisam rodar DEPOIS que todos foram carregados (antes era um script único e as
   declarações de função subiam para o topo). Carregado logo antes do core/boot.js. */
finalizeSale = singleFlight('finalizeSale', finalizeSale);
confirmNovoPedidoModal = singleFlight('confirmNovoPedidoModal', confirmNovoPedidoModal);
confirmComandaQuickAdd = singleFlight('confirmComandaQuickAdd', confirmComandaQuickAdd);
confirmReorderComandaItem = singleFlight('confirmReorderComandaItem', confirmReorderComandaItem);
saveNewNamedComanda = singleFlight('saveNewNamedComanda', saveNewNamedComanda);
gcOpenBarComanda = singleFlight('gcOpenBarComanda', gcOpenBarComanda);
gcSelectMember = singleFlight('gcSelectMember', gcSelectMember);
gcConfirmOrder = singleFlight('gcConfirmOrder', gcConfirmOrder);
gcConfirmCharge = singleFlight('gcConfirmCharge', gcConfirmCharge);
sendScheduledToKitchen = singleFlight('sendScheduledToKitchen', sendScheduledToKitchen);
acceptRequest = singleFlight('acceptRequest', acceptRequest);
submitTotemOrder = singleFlight('submitTotemOrder', submitTotemOrder);
saveDeliveryOrder = singleFlight('saveDeliveryOrder', saveDeliveryOrder);
duplicateDeliveryOrder = singleFlight('duplicateDeliveryOrder', duplicateDeliveryOrder);
cancelDelivery = singleFlight('cancelDelivery', cancelDelivery);
