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

## Schema

```bash
npx supabase login
npx supabase link --project-ref kclhtupbsnflpviausmo
npx supabase db push
```
