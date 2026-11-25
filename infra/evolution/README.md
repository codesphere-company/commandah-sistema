# Servidor do WhatsApp (Evolution API)

Um servidor só, para todos os estabelecimentos. Cada estabelecimento conecta o próprio número em
Configurações › WhatsApp no Commandah. Desenho: `docs/superpowers/specs/2026-11-25-whatsapp-design.md`.

Custo: Hostinger VPS KVM 1 (cerca de R$ 30/mês na promoção, R$ 60 na renovação). O endereço do DuckDNS é grátis.

## 1. Contratar o servidor (dono)

1. Na Hostinger, contrate **VPS KVM 1** com **Ubuntu 24.04**.
2. Anote o **IP** do servidor e a senha do usuário `root`.

## 2. Criar o endereço (dono)

1. Entre em https://www.duckdns.org com a conta do Google da lanchonete.
2. Crie um subdomínio, por exemplo `commandah-whats`, e coloque o IP do servidor no campo "current ip".
3. O endereço fica `commandah-whats.duckdns.org`.

## 3. Instalar (no servidor)

Entre no servidor pelo terminal do Windows: `ssh root@<IP>`. Depois:

```bash
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/evolution && cd /opt/evolution
```

Copie para `/opt/evolution` os arquivos desta pasta (`docker-compose.yml`, `Caddyfile`, `.env.example`). Do
Windows, na pasta do repositório:

```bash
scp infra/evolution/docker-compose.yml infra/evolution/Caddyfile infra/evolution/.env.example root@<IP>:/opt/evolution/
```

No servidor:

```bash
cd /opt/evolution
cp .env.example .env
openssl rand -hex 32   # copie: é a AUTHENTICATION_API_KEY
openssl rand -hex 24   # copie: é a POSTGRES_PASSWORD
nano .env              # preencha DOMINIO, AUTHENTICATION_API_KEY e POSTGRES_PASSWORD; salve com Ctrl+O, Enter, Ctrl+X
docker compose up -d
```

Conferir (espere 1 minuto para o certificado sair):

```bash
curl -s https://<DOMINIO>/ -H "apikey: <AUTHENTICATION_API_KEY>"
```

Deve responder um JSON com `"message":"Welcome to the Evolution API..."`.

Guarde a `AUTHENTICATION_API_KEY` no gerenciador de senhas. Ela não vai para o GitHub nem para o site.

## 4. Ligar no Commandah (Claude, só com o "sim" do dono)

Na pasta do repositório:

```bash
npx supabase secrets set EVOLUTION_URL=https://<DOMINIO> EVOLUTION_API_KEY=<AUTHENTICATION_API_KEY> WHATSAPP_WEBHOOK_URL=https://ezfoymdesmarpunmixbs.supabase.co/functions/v1/whatsapp
npx supabase db push        # migration 20261125000000_whatsapp_base.sql
npx supabase functions deploy whatsapp --no-verify-jwt
```

`--no-verify-jwt` é obrigatório: o webhook da Evolution chega sem login. A função confere o login das
chamadas do app por conta própria e o webhook pelo segredo na URL.

O clube já tem o plano `isento`, que vale como Pro. Para outro estabelecimento:
`update public.assinaturas set plano = 'pro' where tenant_id = '<tenant>';`

## 5. Conectar o número (no clube)

Configurações › WhatsApp › Conectar número, e ler o QR com o celular do **número separado** da lanchonete.

## Manutenção

- Ver se está tudo de pé: `cd /opt/evolution && docker compose ps`
- Ver erros: `docker compose logs --tail 100 evolution`
- Reiniciar: `docker compose restart evolution`
- Não atualizar a imagem sem testar: a versão está fixada de propósito.
- Mudou o `.env`? `docker compose up -d` recria só a Evolution (o celular continua conectado).

### Limpar mensagens antigas (etapa 2)

Desde a etapa 2 a Evolution guarda as mensagens (`DATABASE_SAVE_DATA_NEW_MESSAGE=true`) para o Commandah abrir
foto e PDF. O Commandah apaga o histórico dele com mais de 90 dias sozinho; no servidor, rode uma vez por mês:

```bash
cd /opt/evolution
docker compose exec postgres psql -U evolution -d evolution -c "delete from \"Message\" where \"messageTimestamp\" < extract(epoch from now() - interval '90 days');"
```
