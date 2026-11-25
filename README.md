# shopwag-backend

API do Shopwag (Node + Express, hospedada no Render) e o schema do Supabase (`kclhtupbsnflpviausmo`).

O checkout não confia no preço enviado pelo navegador. `place_order` relê o catálogo, baixa o estoque e grava o total. O painel muda status só por `update_order_status`, conferindo o dono da loja.

## Mercado Pago

Mesmo modelo do Wagoo: o lojista conecta a própria conta Mercado Pago (OAuth), o Pix é criado com o token da loja e o dinheiro cai na conta dela. A Shopwag recebe 1% via `application_fee`, descontado da loja e não somado ao preço do cliente.

Com o repasse ligado no painel, o Pix sai por `ceil(valor / (1 − taxa Pix − 1%))`: o cliente paga as duas taxas e a loja recebe o valor do catálogo. A taxa Pix começa em 0,99% e é recalibrada pela taxa real da última venda aprovada.

Todas as chaves ficam nas variáveis de ambiente do Render. O frontend só conhece `NEXT_PUBLIC_API_URL`.

| Rota | Uso |
| --- | --- |
| `GET /api/mercadopago/connect` | Status da conexão (Bearer do Supabase) |
| `GET /api/mercadopago/connect/start` | URL de autorização do Mercado Pago |
| `PATCH /api/mercadopago/connect/fees` | Repasse de taxas (`pass_fees`) e prazo de recebimento do crédito (`plan`: `na_hora`, `14_dias`, `30_dias`) |
| `DELETE /api/mercadopago/connect` | Desconectar |
| `GET /api/mercadopago/oauth/callback` | Retorno do OAuth, volta para `/dashboard/loja` |
| `POST /api/mercadopago/pix` | Gera o Pix do pedido (`pedido_id`, `token`, `email`) |
| `GET /api/mercadopago/status` | Relê o pagamento (`pedido`, `t`) |
| `POST /api/mercadopago/webhook` | Notificações do Mercado Pago |

## Render

`render.yaml` cria o web service. Preencha no painel do Render:

- `SUPABASE_SECRET_KEY`: chave service role do projeto
- `FRONTEND_URL` e `CORS_ORIGINS`: URL pública do frontend
- `MP_CLIENT_ID`, `MP_CLIENT_SECRET`: aplicação Mercado Pago
- `MP_OAUTH_REDIRECT_URI`: `https://<servico>.onrender.com/api/mercadopago/oauth/callback`
- `MP_WEBHOOK_URL`: `https://<servico>.onrender.com/api/mercadopago/webhook`
- `MP_WEBHOOK_SECRET`: assinatura secreta dos webhooks
- `MP_PLATFORM_USER_ID`: user id da conta dona da aplicação

`MP_TOKEN_SECRET` é gerado pelo Render. Não troque depois de conectar lojas: os tokens salvos deixam de abrir.

## Local

```bash
npm install
cp .env.example .env
npm run dev
```

## Testes

```bash
npm test
```

A suíte usa Jest e ts-jest. Ela cobre o cálculo em `src/lib/fees.ts` (taxa de serviço, repasse e marketplace fee da conta da aplicação) e a assinatura do webhook do Mercado Pago: `mpWebhookSignatureValid` e `POST /api/mercadopago/webhook`.

Os testes não chamam o Mercado Pago nem o Supabase. O segredo do webhook é fictício, definido no próprio teste, e a sincronização do pagamento fica mockada. `npm test` não sobe o servidor e não precisa de `.env`.

O build de produção continua `npm run build` (`tsc` do TypeScript 7). O pacote `typescript` no `package.json` aponta para a API de compatibilidade do TypeScript 6, que é o que o ts-jest importa. O binário `tsc` usado no Render vem de `@typescript/native` e segue na 7.

## Kubernetes

O deploy em produção continua no Render (`render.yaml`, runtime Node). O `Dockerfile` e a pasta `k8s/` são um extra para subir a mesma API num cluster local.

Os manifests trazem Deployment, Service, ConfigMap e um Secret de exemplo (`k8s/secret.example.yaml`) com valores fictícios. A service role do Supabase não entra nesse Secret: sem ela, `GET /health` responde sem consultar o banco. As probes de liveness e readiness usam esse `/health`, que já existe. No Render, com a chave configurada, a mesma rota também verifica o Supabase.

Com Docker e [Kind](https://kind.sigs.k8s.io/):

```bash
docker build -t shopwag-backend:local .
kind create cluster --name shopwag
kind load docker-image shopwag-backend:local --name shopwag
kubectl apply -k k8s
kubectl -n shopwag rollout status deployment/shopwag-backend
kubectl -n shopwag port-forward svc/shopwag-backend 18080:80
```

Em outro terminal:

```bash
curl -sS http://127.0.0.1:18080/health
```

Para remover o cluster: `kind delete cluster --name shopwag`.

O workflow `.github/workflows/ci.yml` roda em pull request e em push na `main`: `npm ci`, `npm run lint` se o script existir, `npm run build`, `npm test`, e um job que sobe um cluster Kind, aplica os manifests e consulta `/health`. Este repositório não tem script de lint. O keepalive do Render (`.github/workflows/keepalive.yml`) permanece separado.

## Schema

```bash
npx supabase login
npx supabase link --project-ref kclhtupbsnflpviausmo
npx supabase db push
```
