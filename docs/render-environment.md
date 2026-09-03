# Render Environment Setup

Local `.env` files are not uploaded to Render. Add production values in the Render service dashboard or deploy this repo as a Render Blueprint so Render prompts for every `sync: false` value in `render.yaml`.

## Backend Service

Open the backend service, then go to **Environment** and add these keys:

```env
NODE_ENV=production
PORT=3000
APP_SECRET=
ADMIN_EMAIL=
ADMIN_PASSWORD=
MONGODB_URI=
MONGODB_DB_NAME=trade_mvp
MONGODB_COLLECTION=app_state
FRONTEND_ORIGIN=https://your-frontend.onrender.com
FRONTEND_URL=https://your-frontend.onrender.com
BACKEND_URL=https://your-backend.onrender.com
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
PAYSTACK_BASE_URL=https://api.paystack.co
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
TELEGRAM_TRADE_BOT_POLLING_ENABLED=false
BYBIT_USDT_NGN_RATE=
```

`PAYSTACK_SECRET_KEY`, `APP_SECRET`, `ADMIN_PASSWORD`, `MONGODB_URI`, and Telegram tokens must stay on the backend service only.

## Frontend Static Site

Open the frontend static site, then go to **Environment** and add:

```env
TRADE_API_BASE_URL=https://your-backend.onrender.com
```

Redeploy the frontend after changing this value so `public/config.js` is rebuilt with the production backend URL.

## Paystack Webhook

In the Paystack dashboard, set the webhook URL to:

```text
https://your-backend.onrender.com/api/webhooks/paystack
```

Enable transfer webhook events: `transfer.success`, `transfer.failed`, and `transfer.reversed`.
