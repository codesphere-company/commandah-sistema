/* ============ CARDÁPIO DIGITAL — PÁGINA PÚBLICA (26/11/2026, etapa 1) ============
   Aberta pelo QR da mesa: cardapio.html?c=<código público>&m=<id do local>. Só para olhar: boas-vindas com a
   mesa e o horário da cozinha, categorias em blocos com foto e produtos com foto, preço e tamanhos.
   Pedido e pagamento chegam nas próximas etapas. Fala só com a função "cardapio" (sem login). As fotos são
   pedidas uma a uma, quando aparecem na tela (loading="lazy"), com cache de 1 dia na função. */
(function(){
  'use strict';
  var FUNCAO = 'https://ezfoymdesmarpunmixbs.supabase.co/functions/v1/cardapio';
  var q = new URLSearchParams(location.search);
  var codigo = (q.get('c') || '').trim().toLowerCase(), mesa = (q.get('m') || '').slice(0, 80);
  var app = document.getElementById('app');
  var dados = null, busca = '';

  function el(tag, attrs, filhos){
    var e = document.createElement(tag);
    if(attrs) Object.keys(attrs).forEach(function(k){
      if(k === 'class') e.className = attrs[k];
      else if(k === 'text') e.textContent = attrs[k];
      else if(k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function(f){ if(f) e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return e;
  }
  function brl(v){ return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }
  function fotoUrl(id){ return FUNCAO + '?c=' + encodeURIComponent(codigo) + '&foto=' + encodeURIComponent(id); }
  function tela(filhos){ app.textContent = ''; filhos.forEach(function(f){ if(f) app.appendChild(f); }); window.scrollTo(0, 0); }
  function contar(n){ return n === 1 ? '1 item' : n + ' itens'; }

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

  function boasVindas(){
    var marca = dados.logo
      ? el('img', { class:'logo', src: fotoUrl('logo'), alt: dados.nome })
      : el('div', { class:'logo-letra', text: (dados.nome || 'C').trim().charAt(0).toUpperCase() });
    tela([el('div', { class:'boas' }, [
      marca,
      el('div', null, [el('h1', { text: dados.nome }), dados.mesa ? el('p', { class:'mesa', text: dados.mesa }) : null]),
      pillCozinha(),
      el('p', { class:'aviso', text:'Veja o cardápio e peça ao garçom.' }),
      el('button', { class:'btn', type:'button', onclick: function(){ ir('categorias'); } }, ['Ver cardápio'])
    ])]);
  }

  function produtoCard(p){
    var info = [el('b', { text: p.nome })];
    if(p.descricao) info.push(el('p', { class:'desc', text: p.descricao }));
    if(p.tamanhos && p.tamanhos.length) info.push(el('div', { class:'tams' }, p.tamanhos.map(function(t){ return el('span', { text: t.nome + ' · ' + brl(t.preco) }); })));
    else info.push(el('p', { class:'preco', text: brl(p.preco) + (p.unidade === 'kg' ? ' o kg' : '') }));
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
    tela([topo(dados.mesa ? dados.nome + ' · ' + dados.mesa : dados.nome, function(){ history.back(); }), pillCozinha() ? el('div', { class:'linha-pill' }, [pillCozinha()]) : null, input, corpo, el('p', { class:'rodape', text:'Para pedir, chame o garçom.' })]);
  }

  function categoria(nome){
    var lista = dados.produtos.filter(function(p){ return p.categoria === nome; });
    if(!lista.length){ ir('categorias', null, true); return; }
    tela([topo(nome, function(){ history.back(); }), el('div', { class:'lista' }, lista.map(produtoCard)), el('p', { class:'rodape', text:'Para pedir, chame o garçom.' })]);
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
    boasVindas();
  }
  window.addEventListener('popstate', function(e){ if(dados) mostrar(e.state); });

  if(!/^[a-z0-9]{6,32}$/.test(codigo)){ indisponivel('Este QR não é de um cardápio. Peça ao garçom.'); return; }
  fetch(FUNCAO + '?c=' + encodeURIComponent(codigo) + (mesa ? '&m=' + encodeURIComponent(mesa) : ''))
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.ok){ indisponivel(d && d.motivo === 'erro' ? 'Não foi possível abrir o cardápio agora. Tente de novo em instantes.' : null); return; }
      dados = d;
      dados.produtos = Array.isArray(d.produtos) ? d.produtos : [];
      dados.categorias = Array.isArray(d.categorias) ? d.categorias : [];
      document.title = 'Cardápio · ' + (d.nome || '');
      history.replaceState({ onde:'inicio' }, '');
      boasVindas();
    })
    .catch(function(){ indisponivel('Sem conexão com o cardápio agora. Confira a internet e tente de novo.'); });
})();
