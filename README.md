# Trade MVP

Crypto-only MVP built from the guidance in [`docs/trading-app-build-guide.md`](./docs/trading-app-build-guide.md).

## Included in this MVP

- admin login dashboard
- user registration and login
- admin Bybit spot account connection
- user Bybit spot account connection
- admin spot order placement
- mirrored spot order placement for connected users with mirroring enabled
- open trades list
- pending trades list
- take-profit placement
- manual sell/close action
- mobile-first single-page UI
- red pending labels for non-crypto areas

## Not included yet

- fiat exchange
- FX rate switching
- local currency balances
- KYC flows
- dark mode
- non-crypto product surfaces

## Environment

Create a `.env` file or set environment variables:

```env
PORT=3000
APP_SECRET=change-this-before-production
ADMIN_EMAIL=admin@trade.local
ADMIN_PASSWORD=Admin123!
# Optional MongoDB app-state storage
# MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
# MONGODB_DB_NAME=trade_mvp
# MONGODB_COLLECTION=app_state
# Optional Bybit endpoints
# BYBIT_BASE_URL=https://api.bybit.com
# BYBIT_TESTNET_URL=https://api-testnet.bybit.com
```

## Start

```bash
npm start
```

Then open `http://localhost:3000`.

## Render Persistence

For Render, set `MONGODB_URI` so users, sessions, and trades survive service sleep/redeploy cycles.

- with `MONGODB_URI` set, the app stores its app state in MongoDB
- without `MONGODB_URI`, the app falls back to the local JSON file at `data/app-db.json`

## Important Bybit Note

This MVP uses server-side signed Bybit Spot API requests. For safety:

- use API keys with trading enabled only if you intend to trade
- keep withdrawal permission disabled
- start with Bybit testnet if you want to validate the flow first
- the current implementation uses HMAC signing for compatibility and simplicity in this MVP
