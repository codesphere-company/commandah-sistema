# Cardápio digital — pedidos ao Itaú e à maquininha (etapas 3 e 4)

26/11/2026. Textos prontos que o dono manda para ligar o "pagar agora" do cardápio (Pix, crédito e débito), caminho A escolhido pelo dono: Pix pela API do Itaú e cartão pelo e-commerce da maquininha (e.Rede, se for Rede). Trocar os campos entre colchetes. Quando eles responderem, trazer as taxas e a documentação; credenciais e certificados vão só para os secrets do Supabase, com o "sim" do dono.

Atenção ao item 5 da mensagem da maquininha: com página de pagamento pronta deles, o número do cartão nunca passa pelo Commandah (evita a certificação PCI). Se não houver, rever o desenho da etapa 4 antes de fechar.

## 1. Gerente do Itaú (Pix por API)

> Olá, [nome do gerente], tudo bem?
>
> Aqui é [seu nome], da [razão social da lanchonete], CNPJ [CNPJ].
>
> Estamos colocando no ar um cardápio digital em que o cliente paga pelo celular, e queremos receber o Pix direto na nossa conta Itaú, com confirmação automática do pagamento.
>
> Para isso, precisamos contratar a **API Pix Recebimentos do Itaú** (cobrança imediata com QR Code dinâmico). Você pode nos ajudar com:
>
> 1. Liberação da API Pix para a nossa conta PJ (agência [agência], conta [conta]), com acesso ao portal do desenvolvedor.
> 2. As **credenciais** (client_id e client_secret) e os **certificados digitais** da API, de homologação e de produção.
> 3. O **webhook** de notificação de Pix recebido, para o nosso sistema saber na hora que o pagamento caiu.
> 4. As **tarifas**: quanto custa cada Pix recebido pela API, e se há mensalidade ou pacote.
> 5. Se existe **ambiente de testes (sandbox)** para validarmos antes de ligar em produção.
>
> As credenciais e os certificados serão usados pelo nosso sistema (Commandah) e guardados só no servidor, nunca em computador ou celular. Se preferir, o responsável técnico pode falar direto com o time de vocês.
>
> Obrigado!

## 2. Gerente da maquininha (crédito e débito online)

> Olá, [nome do gerente], tudo bem?
>
> Aqui é [seu nome], da [razão social da lanchonete], CNPJ [CNPJ]. Já usamos a maquininha [Rede / nome da empresa] no balcão.
>
> Vamos lançar um cardápio digital em que o cliente paga pelo próprio celular, e precisamos aceitar **cartão de crédito e débito online** (venda pela internet, sem a maquininha).
>
> Você pode nos ajudar com:
>
> 1. Habilitar o **e-commerce** para o nosso estabelecimento (na Rede, o **e.Rede**), com acesso à **API** de pagamentos.
> 2. Habilitar o **3DS 2.0** (autenticação do banco do cliente), que é obrigatório para débito online. Quais bandeiras aceitam débito online?
> 3. As **credenciais** da API (PV/filiação e token) de homologação e de produção, e se há ambiente de testes.
> 4. As **taxas** do e-commerce: crédito à vista, débito, cobrança do 3DS por transação e prazo de recebimento (com e sem antecipação).
> 5. Se vocês têm **página de pagamento pronta** (checkout ou link de pagamento por API), para o número do cartão ser digitado no ambiente de vocês, e não no nosso sistema.
>
> O sistema que vai integrar é o Commandah. As credenciais ficam guardadas só no servidor. Se preferir, o responsável técnico pode falar direto com o time de vocês.
>
> Obrigado!
