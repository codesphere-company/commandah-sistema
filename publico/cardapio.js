/* ============ CARDÁPIO DIGITAL — PÁGINA PÚBLICA (26/11/2026) ============
   26/11 (noite): produto com opções (ex.: AGUA com gás/sem gás, adicionais) abre a escolha no celular.
   Aberta pelo QR da mesa: /cardapio?c=<código público>&m=<id do local>. Fala só com a função "cardapio" (sem login).
   Etapa 1: boas-vindas, categorias em blocos e produtos com foto, preço e tamanhos (fotos pedidas uma a uma).
   Etapa 2: o sócio monta o carrinho, escolhe mesa ou balcão e marca na cota: confirma com um código de 4 números
   no WhatsApp (o celular fica lembrado até as 4h) e acompanha até "na cozinha". Pagar agora (Pix/cartão) chega
   nas etapas 3 e 4. Produto com adicionais ou por quilo: "peça ao garçom". */
(function(){
  'use strict';
  var FUNCAO = 'https://ezfoymdesmarpunmixbs.supabase.co/functions/v1/cardapio';
  var q = new URLSearchParams(location.search);
  var codigo = (q.get('c') || '').trim().toLowerCase(), mesa = (q.get('m') || '').slice(0, 80);
  var app = document.getElementById('app');
  var dados = null, busca = '', carrinho = [], obs = '', balcao = false, cotaDigitada = '', acompanhando = null, escolhaAtual = null;
  var CHAVE_CARRINHO = 'cardapio-carrinho:' + codigo, CHAVE_SESSAO = 'cardapio-sessao:' + codigo;

  function guardar(chave, v, sessao){ try { (sessao ? sessionStorage : localStorage).setItem(chave, JSON.stringify(v)); } catch(e){ /* sem armazenamento: segue na memória */ } }
  function lerGuardado(chave, sessao){ try { return JSON.parse((sessao ? sessionStorage : localStorage).getItem(chave) || 'null'); } catch(e){ return null; } }
  function apagar(chave, sessao){ try { (sessao ? sessionStorage : localStorage).removeItem(chave); } catch(e){ /* nada */ } }
  function sessaoValida(){ var s = lerGuardado(CHAVE_SESSAO); return s && s.sessao && s.exp > Date.now() ? s : null; }

  function el(tag, attrs, filhos){
    var e = document.createElement(tag);
    if(attrs) Object.keys(attrs).forEach(function(k){
      var v = attrs[k]; if(v === null || v === undefined || v === false) return;
      if(k === 'class') e.className = v;
      else if(k === 'text') e.textContent = v;
      else if(k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (filhos || []).forEach(function(f){ if(f) e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return e;
  }
  function brl(v){ return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }
  function fotoUrl(id){ return FUNCAO + '?c=' + encodeURIComponent(codigo) + '&foto=' + encodeURIComponent(id); }
  function tela(filhos){ app.textContent = ''; filhos.forEach(function(f){ if(f) app.appendChild(f); }); barraCarrinho(); window.scrollTo(0, 0); }
  function contar(n){ return n === 1 ? '1 item' : n + ' itens'; }
  function podePedir(){ return !!(dados && dados.pedir); }
  function totalCarrinho(){ return Math.round(carrinho.reduce(function(a, i){ return a + i.preco * i.qtd; }, 0) * 100) / 100; }
  function qtdCarrinho(){ return carrinho.reduce(function(a, i){ return a + i.qtd; }, 0); }
  function salvarCarrinho(){ guardar(CHAVE_CARRINHO, { itens:carrinho, obs:obs, balcao:balcao }, true); }

  function post(corpo){
    corpo.c = codigo;
    return fetch(FUNCAO, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(corpo) })
      .then(function(r){ return r.json(); })
      .catch(function(){ return { ok:false, erro:'Sem conexão agora. Confira a internet e tente de novo.' }; });
  }

  function indisponivel(texto){
    document.title = 'Cardápio indisponível';
    tela([el('div', { class:'boas' }, [el('div', { class:'logo-letra', text:'!' }), el('h1', { text:'Cardápio indisponível' }), el('p', { class:'aviso', text: texto || 'Este cardápio não está disponível agora. Peça ao garçom.' })])]);
  }
  function topo(titulo, voltar){
    return el('header', { class:'topo' }, [voltar ? el('button', { class:'voltar', type:'button', onclick: voltar, 'aria-label':'Voltar' }, ['‹ Voltar']) : null, el('h2', { text: titulo })]);
  }
  function pillCozinha(){
    var c = dados.cozinha || {};
    if(!c.texto) return null;
    return el('span', { class: 'pill' + (c.aberta ? '' : ' fechada'), text: c.texto });
  }

  // Barra fixa do carrinho (aparece em todas as telas do cardápio enquanto houver item).
  function barraCarrinho(){
    var velha = document.getElementById('barraCarrinho'); if(velha) velha.remove();
    if(!podePedir() || !carrinho.length || !history.state || ['categorias', 'cat'].indexOf(history.state.onde) < 0) return;
    document.body.appendChild(el('div', { id:'barraCarrinho', class:'barra-carrinho' }, [
      el('button', { class:'btn', type:'button', onclick:function(){ ir('carrinho'); } }, ['Ver pedido · ' + contar(qtdCarrinho()) + ' · ' + brl(totalCarrinho())])
    ]));
  }

  // 26/11: produto (ou tamanho) com grupos de opções abre a escolha antes de ir para o carrinho.
  function gruposDe(p, tamanho){ return (tamanho ? tamanho.grupos : p.grupos) || []; }
  function tocar(p, tamanho){ if(gruposDe(p, tamanho).length){ escolhaAtual = { p:p, t:tamanho, picks:{} }; ir('escolha'); } else adicionar(p, tamanho, {}, ''); }
  function cobrado(precos, incluidos){ var u = precos.slice().sort(function(a, b){ return b - a; }), t = 0; for(var i = Math.max(0, incluidos); i < u.length; i++) t += u[i]; return Math.round(t * 100) / 100; }
  function extraDas(grupos, picks){ return grupos.reduce(function(a, g){ var pr = []; g.opcoes.forEach(function(o){ var q = (picks[g.id] || {})[o.id] || 0; for(var i = 0; i < q; i++) pr.push(o.preco); }); return a + cobrado(pr, g.incluidos); }, 0); }
  function chaveOpcoes(o){ return JSON.stringify(Object.keys(o || {}).sort().map(function(g){ return [g, Object.keys(o[g]).sort().map(function(k){ return [k, o[g][k]]; })]; })); }
  function adicionar(p, tamanho, picks, resumo){
    var base = tamanho ? tamanho.preco : p.preco;
    var item = { produtoId:p.id, tamanhoId:tamanho ? tamanho.id : null, opcoes:picks || {}, resumo:resumo || '', nome: p.nome + (tamanho ? ' ' + tamanho.nome : ''), preco: Math.round((base + extraDas(gruposDe(p, tamanho), picks || {})) * 100) / 100, qtd:1 };
    var igual = carrinho.find(function(i){ return i.produtoId === item.produtoId && i.tamanhoId === item.tamanhoId && chaveOpcoes(i.opcoes) === chaveOpcoes(item.opcoes); });
    if(igual){ if(igual.qtd < 20) igual.qtd++; } else carrinho.push(item);
    salvarCarrinho(); barraCarrinho();
  }

  function boasVindas(){
    var marca = dados.logo
      ? el('img', { class:'logo', src: fotoUrl('logo'), alt: dados.nome })
      : el('div', { class:'logo-letra', text: (dados.nome || 'C').trim().charAt(0).toUpperCase() });
    tela([el('div', { class:'boas' }, [
      marca,
      el('div', null, [el('h1', { text: dados.nome }), dados.mesa ? el('p', { class:'mesa', text: dados.mesa }) : null]),
      pillCozinha(),
      el('p', { class:'aviso', text: podePedir() ? 'Sócio: peça por aqui e marque na sua cota. Visitante: peça ao garçom.' : 'Veja o cardápio e peça ao garçom.' }),
      el('button', { class:'btn', type:'button', onclick: function(){ ir('categorias'); } }, ['Ver cardápio'])
    ])]);
  }

  function produtoCard(p){
    var info = [el('b', { text: p.nome })];
    if(p.descricao) info.push(el('p', { class:'desc', text: p.descricao }));
    var fechado = p.cozinha && dados.cozinha && dados.cozinha.aberta === false;
    if(p.tamanhos && p.tamanhos.length){
      info.push(el('div', { class:'tams' }, p.tamanhos.map(function(t){
        var rot = t.nome + ' · ' + brl(t.preco);
        return podePedir() && p.pedivel && !fechado
          ? el('button', { class:'tam-add', type:'button', 'aria-label':'Adicionar ' + p.nome + ' ' + t.nome, onclick:function(){ tocar(p, t); } }, ['+ ' + rot])
          : el('span', { text: rot });
      })));
    } else {
      var linha = [el('span', { class:'preco', text: brl(p.preco) + (p.unidade === 'kg' ? ' o kg' : '') })];
      if(podePedir() && p.pedivel && !fechado) linha.push(el('button', { class:'mais', type:'button', 'aria-label':'Adicionar ' + p.nome, onclick:function(){ tocar(p, null); } }, ['+']));
      info.push(el('div', { class:'linha-preco' }, linha));
    }
    if(podePedir() && !p.pedivel) info.push(el('p', { class:'nota', text:'Peça ao garçom' }));
    else if(podePedir() && fechado) info.push(el('p', { class:'nota', text:'Cozinha fechada agora' }));
    var filhos = p.foto ? [el('img', { src: fotoUrl(p.id), alt: '', loading:'lazy', decoding:'async', width:'84', height:'84' }), el('div', null, info)] : [el('div', null, info)];
    return el('article', { class: 'prod' + (p.foto ? '' : ' sem') }, filhos);
  }

  function categorias(){
    var input = el('input', { class:'busca', type:'search', placeholder:'Buscar no cardápio', 'aria-label':'Buscar no cardápio', value: busca });
    var corpo = el('div');
    function desenhar(){
      corpo.textContent = '';
      var termo = busca.trim().toLowerCase();
      if(termo){
        var achados = dados.produtos.filter(function(p){ return (p.nome + ' ' + (p.descricao || '')).toLowerCase().indexOf(termo) >= 0; });
        corpo.appendChild(achados.length ? el('div', { class:'lista' }, achados.map(produtoCard)) : el('p', { class:'vazio', text:'Nada encontrado com esse nome.' }));
        return;
      }
      corpo.appendChild(el('div', { class:'cats' }, dados.categorias.map(function(c){
        var n = dados.produtos.filter(function(p){ return p.categoria === c.nome; }).length;
        var img = c.fotoId ? el('img', { class:'foto', src: fotoUrl(c.fotoId), alt:'', loading:'lazy', decoding:'async' }) : el('div', { class:'sem-foto', text: c.nome.charAt(0).toUpperCase() });
        return el('button', { class:'cat', type:'button', onclick: function(){ ir('cat', c.nome); } }, [img, el('span', null, [c.nome, el('small', { text: contar(n) })])]);
      })));
    }
    input.addEventListener('input', function(){ busca = input.value; desenhar(); });
    desenhar();
    tela([topo(dados.mesa ? dados.nome + ' · ' + dados.mesa : dados.nome, function(){ history.back(); }), pillCozinha() ? el('div', { class:'linha-pill' }, [pillCozinha()]) : null, input, corpo, el('p', { class:'rodape', text: podePedir() ? 'Visitante: peça ao garçom.' : 'Para pedir, chame o garçom.' })]);
  }

  function categoria(nome){
    var lista = dados.produtos.filter(function(p){ return p.categoria === nome; });
    if(!lista.length){ ir('categorias', null, true); return; }
    tela([topo(nome, function(){ history.back(); }), el('div', { class:'lista' }, lista.map(produtoCard)), el('p', { class:'rodape', text: podePedir() ? 'Visitante: peça ao garçom.' : 'Para pedir, chame o garçom.' })]);
  }

  /* ---------- Escolha das opções (26/11) ---------- */
  function telaEscolha(){
    var e = escolhaAtual; if(!e){ ir('categorias', null, true); return; }
    var grupos = gruposDe(e.p, e.t), base = e.t ? e.t.preco : e.p.preco;
    var botao = el('button', { class:'btn', type:'button', id:'addEscolha' });
    var msg = el('p', { class:'erro', role:'alert' });
    function totalG(g){ var q = e.picks[g.id] || {}; return Object.keys(q).reduce(function(a, k){ return a + q[k]; }, 0); }
    function falta(){ for(var i = 0; i < grupos.length; i++){ var g = grupos[i]; if(g.min > 0 && totalG(g) < g.min) return g; } return null; }
    function atualizar(){
      var preco = Math.round((base + extraDas(grupos, e.picks)) * 100) / 100, f = falta();
      botao.textContent = f ? 'Escolha ' + (f.min === 1 ? 'uma opção' : f.min + ' opções') + ' em ' + f.nome : 'Adicionar · ' + brl(preco);
      botao.disabled = !!f;
    }
    function regra(g){ return g.max === 1 ? (g.min >= 1 ? 'Escolha 1' : 'Opcional, até 1') : (g.min > 0 ? 'Escolha ' + g.min + (g.max ? ' a ' + g.max : ' ou mais') : (g.max ? 'Opcional, até ' + g.max : 'Opcional')) + (g.incluidos ? ' · ' + g.incluidos + ' incluído' + (g.incluidos > 1 ? 's' : '') : ''); }
    var blocos = grupos.map(function(g){
      var lista = el('div', { class:'opcoes' });
      g.opcoes.forEach(function(o){
        var preco = o.preco > 0 ? ' + ' + brl(o.preco) : '';
        if(g.max === 1){
          var r = el('input', { type:'radio', name:'g-' + g.id, onchange:function(){ e.picks[g.id] = {}; e.picks[g.id][o.id] = 1; atualizar(); } });
          lista.appendChild(el('label', null, [r, ' ' + o.nome + preco]));
        } else {
          var qtd = el('span', { text:'0' });
          var mudar = function(d){ var q = e.picks[g.id] = e.picks[g.id] || {}; var novo = (q[o.id] || 0) + d; if(novo < 0) return; if(d > 0 && g.max && totalG(g) >= g.max){ msg.textContent = 'No máximo ' + g.max + ' em ' + g.nome + '.'; return; } msg.textContent = ''; if(novo) q[o.id] = novo; else delete q[o.id]; qtd.textContent = String(novo); atualizar(); };
          lista.appendChild(el('div', { class:'item-carrinho' }, [el('div', null, [el('b', { text:o.nome }), preco ? el('small', { text:preco.trim() }) : null]),
            el('div', { class:'qtd' }, [el('button', { type:'button', 'aria-label':'Tirar ' + o.nome, onclick:function(){ mudar(-1); } }, ['−']), qtd, el('button', { type:'button', 'aria-label':'Pôr ' + o.nome, onclick:function(){ mudar(1); } }, ['+'])])]));
        }
      });
      return el('section', { class:'grupo' }, [el('h3', { text:g.nome }), el('p', { class:'nota', text:regra(g) }), lista]);
    });
    botao.addEventListener('click', function(){
      if(falta()) return;
      var resumo = grupos.map(function(g){ var q = e.picks[g.id] || {}; var partes = g.opcoes.filter(function(o){ return q[o.id]; }).map(function(o){ return (q[o.id] > 1 ? q[o.id] + 'x ' : '') + o.nome; }); return partes.length ? partes.join(', ') : ''; }).filter(Boolean).join(' · ');
      adicionar(e.p, e.t, e.picks, resumo); escolhaAtual = null; history.back();
    });
    tela([topo(e.p.nome + (e.t ? ' ' + e.t.nome : ''), function(){ history.back(); }), el('div', { class:'carrinho' }, blocos.concat([botao, msg]))]);
    atualizar();
  }

  /* ---------- Etapa 2: carrinho, cota e acompanhamento ---------- */
  function telaCarrinho(){
    if(!carrinho.length){ ir('categorias', null, true); return; }
    var linhas = carrinho.map(function(i, idx){
      return el('div', { class:'item-carrinho' }, [
        el('div', null, [el('b', { text: i.nome }), i.resumo ? el('small', { text: i.resumo }) : null, el('small', { text: brl(i.preco) + ' cada' })]),
        el('div', { class:'qtd' }, [
          el('button', { type:'button', 'aria-label':'Tirar um', onclick:function(){ i.qtd--; if(i.qtd <= 0) carrinho.splice(idx, 1); salvarCarrinho(); telaCarrinho(); } }, ['−']),
          el('span', { text: String(i.qtd) }),
          el('button', { type:'button', 'aria-label':'Pôr mais um', onclick:function(){ if(i.qtd < 20) i.qtd++; salvarCarrinho(); telaCarrinho(); } }, ['+'])
        ])
      ]);
    });
    var obsEl = el('textarea', { id:'obs', rows:'2', maxlength:'140', placeholder:'Observação (ex.: sem cebola)' }); obsEl.value = obs;
    obsEl.addEventListener('input', function(){ obs = obsEl.value; salvarCarrinho(); });
    var temMesa = !!dados.mesa; if(!temMesa) balcao = true;
    var entrega = el('div', { class:'opcoes', role:'radiogroup', 'aria-label':'Onde entregar' }, [
      temMesa ? el('label', null, [el('input', { type:'radio', name:'entrega', checked: !balcao, onchange:function(){ balcao = false; salvarCarrinho(); } }), ' Levar na mesa (' + dados.mesa + ')']) : null,
      el('label', null, [el('input', { type:'radio', name:'entrega', checked: balcao, onchange:function(){ balcao = true; salvarCarrinho(); } }), ' Retirar no balcão'])
    ]);
    tela([topo('Seu pedido', function(){ history.back(); }), el('div', { class:'carrinho' }, [
      el('div', { class:'lista' }, linhas),
      obsEl,
      el('h3', { text:'Onde entregar' }), entrega,
      el('div', { class:'linha-total' }, [el('span', { text:'Total' }), el('span', { text: brl(totalCarrinho()) })]),
      el('h3', { text:'Como vai pagar' }),
      el('button', { class:'btn', type:'button', id:'marcarCota', onclick:function(){ ir('cota'); } }, ['Marcar na minha cota (sócio)']),
      el('button', { class:'btn sec', type:'button', disabled:true }, ['Pagar agora: Pix, crédito ou débito (em breve)']),
      el('p', { class:'nota', text:'Visitante: por enquanto, peça ao garçom.' })
    ])]);
  }

  function telaCota(){
    var s = sessaoValida();
    if(s){ telaQuem(s); return; }
    var msg = el('p', { class:'erro', role:'alert' });
    var cota = el('input', { id:'cota', class:'campo', inputmode:'numeric', autocomplete:'off', placeholder:'Número da cota', maxlength:'20', value: cotaDigitada });
    var codigoEl = el('input', { id:'codigo', class:'campo codigo', inputmode:'numeric', autocomplete:'one-time-code', placeholder:'Código de 4 números', maxlength:'4' });
    var passo2 = el('div', { class:'passo2', hidden:true }, [el('p', { class:'aviso', id:'paraQuem' }), codigoEl,
      el('button', { class:'btn', type:'button', id:'confirmar', onclick: confirmar }, ['Confirmar'])]);
    var pedirBtn = el('button', { class:'btn', type:'button', id:'pedirCodigo', onclick: pedirCodigo }, ['Receber código no WhatsApp']);
    function pedirCodigo(){
      cotaDigitada = cota.value.trim(); if(!cotaDigitada){ msg.textContent = 'Digite o número da cota.'; return; }
      pedirBtn.disabled = true; msg.textContent = '';
      post({ acao:'codigo', cota:cotaDigitada }).then(function(r){
        pedirBtn.disabled = false;
        if(!r.ok){ msg.textContent = r.erro || 'Não foi possível agora.'; return; }
        passo2.hidden = false; pedirBtn.textContent = 'Mandar outro código';
        document.getElementById('paraQuem').textContent = 'Mandamos um código para o WhatsApp da cota' + (r.para ? ' (final ' + r.para + ')' : '') + '.';
        codigoEl.focus();
      });
    }
    function confirmar(){
      var cod = codigoEl.value.trim(); if(!/^\d{4}$/.test(cod)){ msg.textContent = 'Digite os 4 números do código.'; return; }
      var b = document.getElementById('confirmar'); b.disabled = true; msg.textContent = '';
      post({ acao:'confirmar', cota:cotaDigitada, codigo:cod }).then(function(r){
        b.disabled = false;
        if(!r.ok){ msg.textContent = r.erro || 'Código incorreto.'; return; }
        var sessao = { sessao:r.sessao, nome:r.nome, dependentes:r.dependentes || [], exp: Date.now() + 10 * 3600000 };
        guardar(CHAVE_SESSAO, sessao);
        telaQuem(sessao);
      });
    }
    tela([topo('Marcar na cota', function(){ history.back(); }), el('div', { class:'carrinho' }, [
      el('p', { class:'aviso', text:'Digite a cota. Mandamos um código para o WhatsApp do titular para confirmar que é você.' }),
      cota, pedirBtn, passo2, msg
    ])]);
    cota.focus();
  }

  function telaQuem(s){
    var quem = '';
    var msg = el('p', { class:'erro', role:'alert' });
    var opcoes = [{ id:'', nome: (s.nome || 'Titular') + ' (titular)' }].concat((s.dependentes || []).map(function(d){ return { id:d.id, nome:d.nome + ' (dependente)' }; }));
    var grupo = opcoes.length > 1 ? el('div', { class:'opcoes', role:'radiogroup', 'aria-label':'Quem está pedindo' }, opcoes.map(function(o, i){
      return el('label', null, [el('input', { type:'radio', name:'quem', checked: i === 0, onchange:function(){ quem = o.id; } }), ' ' + o.nome]);
    })) : null;
    var enviar = el('button', { class:'btn', type:'button', id:'enviarPedido', onclick:function(){
      enviar.disabled = true; msg.textContent = '';
      post({ acao:'pedir', sessao:s.sessao, m:mesa, balcao:balcao, quem:quem || null, obs:obs, itens: carrinho.map(function(i){ return { produtoId:i.produtoId, tamanhoId:i.tamanhoId, opcoes:i.opcoes || {}, qtd:i.qtd }; }) }).then(function(r){
        enviar.disabled = false;
        if(r.sessao === 'vencida'){ apagar(CHAVE_SESSAO); telaCota(); return; }
        if(!r.ok){ msg.textContent = r.erro || 'Não foi possível mandar o pedido.'; return; }
        acompanhando = { id:r.pedido, sessao:s.sessao, local:r.local, total:r.total, inicio:Date.now() };
        carrinho = []; obs = ''; salvarCarrinho();
        ir('acompanhar', null, true);
      });
    } }, ['Mandar para a cozinha · ' + brl(totalCarrinho())]);
    tela([topo('Confirmar pedido', function(){ history.back(); }), el('div', { class:'carrinho' }, [
      el('p', { class:'aviso', text:'Olá, ' + (s.nome || 'sócio') + '! O pedido entra na sua comanda e você paga no caixa.' }),
      grupo ? el('h3', { text:'Quem está pedindo' }) : null, grupo,
      el('div', { class:'linha-total' }, [el('span', { text: contar(qtdCarrinho()) + ' · ' + (balcao || !dados.mesa ? 'Retirar no balcão' : dados.mesa) }), el('span', { text: brl(totalCarrinho()) })]),
      enviar, msg,
      el('button', { class:'link', type:'button', onclick:function(){ apagar(CHAVE_SESSAO); telaCota(); } }, ['Não é você? Trocar de cota'])
    ])]);
  }

  function telaAcompanhar(){
    if(!acompanhando){ ir('categorias', null, true); return; }
    var a = acompanhando;
    var situacao = el('div', { class:'situacao', 'aria-live':'polite' }, [el('span', { class:'pill', text:'Enviando para a cozinha…' })]);
    tela([el('div', { class:'boas' }, [
      el('h1', { text:'Pedido enviado' }),
      el('p', { class:'mesa', text: a.local + ' · ' + brl(a.total) }),
      situacao,
      el('button', { class:'btn sec', type:'button', onclick:function(){ acompanhando = null; ir('categorias'); } }, ['Pedir mais'])
    ])]);
    function mostrar(classe, texto, extra){ situacao.textContent = ''; situacao.appendChild(el('span', { class:'pill ' + classe, text:texto })); if(extra) situacao.appendChild(el('p', { class:'aviso', text:extra })); }
    (function consultar(){
      if(acompanhando !== a || !document.body.contains(situacao)) return;
      fetch(FUNCAO + '?c=' + encodeURIComponent(codigo) + '&pedido=' + encodeURIComponent(a.id) + '&t=' + encodeURIComponent(a.sessao))
        .then(function(r){ return r.json(); })
        .then(function(r){
          if(!r.ok){ setTimeout(consultar, 4000); return; }
          if(r.status === 'na_cozinha'){ mostrar('', 'Pedido na cozinha' + (r.comanda ? ' · comanda #' + r.comanda : ''), 'Pode fechar esta tela. ' + (a.local === 'Retirar no balcão' ? 'Retire no balcão quando chamarem.' : 'O garçom leva na sua mesa.')); return; }
          if(r.status === 'erro'){ mostrar('fechada', 'Pedido não lançado', r.motivo || 'Chame o garçom.'); return; }
          if(r.status === 'expirado'){ mostrar('fechada', 'O caixa não recebeu o pedido', 'Chame o garçom para fazer o pedido.'); return; }
          if(r.segundos > 120) mostrar('fechada', 'Ainda aguardando o caixa…', 'Se demorar, chame o garçom.');
          setTimeout(consultar, 3000);
        })
        .catch(function(){ setTimeout(consultar, 5000); });
    })();
  }

  // Navegação pelo histórico: o botão voltar do celular volta uma tela.
  function ir(onde, arg, trocar){
    var estado = { onde: onde, arg: arg || null };
    if(trocar) history.replaceState(estado, ''); else history.pushState(estado, '');
    mostrar(estado);
  }
  function mostrar(estado){
    if(!estado || estado.onde === 'inicio') return boasVindas();
    if(estado.onde === 'categorias') return categorias();
    if(estado.onde === 'cat') return categoria(estado.arg);
    if(estado.onde === 'carrinho') return telaCarrinho();
    if(estado.onde === 'escolha') return telaEscolha();
    if(estado.onde === 'cota') return telaCota();
    if(estado.onde === 'acompanhar') return telaAcompanhar();
    boasVindas();
  }
  window.addEventListener('popstate', function(e){ if(dados) mostrar(e.state); });

  if(!/^[a-z0-9]{6,32}$/.test(codigo)){ indisponivel('Este QR não é de um cardápio. Peça ao garçom.'); return; }
  var guardado = lerGuardado(CHAVE_CARRINHO, true);
  if(guardado && Array.isArray(guardado.itens)){ carrinho = guardado.itens; obs = guardado.obs || ''; balcao = !!guardado.balcao; }
  fetch(FUNCAO + '?c=' + encodeURIComponent(codigo) + (mesa ? '&m=' + encodeURIComponent(mesa) : ''))
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.ok){ indisponivel(d && d.motivo === 'erro' ? 'Não foi possível abrir o cardápio agora. Tente de novo em instantes.' : null); return; }
      dados = d;
      dados.produtos = Array.isArray(d.produtos) ? d.produtos : [];
      dados.categorias = Array.isArray(d.categorias) ? d.categorias : [];
      // Carrinho guardado só vale com produtos que ainda estão no cardápio.
      carrinho = carrinho.filter(function(i){ return dados.produtos.some(function(p){ return p.id === i.produtoId && p.pedivel; }); });
      document.title = 'Cardápio · ' + (d.nome || '');
      history.replaceState({ onde:'inicio' }, '');
      boasVindas();
    })
    .catch(function(){ indisponivel('Sem conexão com o cardápio agora. Confira a internet e tente de novo.'); });
})();
