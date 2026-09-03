# Trading App Build Guide

Research date: March 28, 2026
Prepared for: mobile-first beginner-friendly crypto + fiat trading app
Reference baseline used: `trading_app_best_practices.pdf` supplied by user, expanded with current official API and integration docs.

## 1. Product Goal

Build a simple, modern, mobile-first trading app with these core flows:

1. App opens with a branded animated trading icon splash screen, then transitions into the main dashboard.
2. Dashboard shows a premium balance card at the top in USDT plus local-currency equivalent.
3. User can switch the displayed local currency between NGN, QAR, BRL, and GBP.
4. App displays current FX reference rates from those four fiat currencies to USDT.
5. App provides a fiat exchange section for buying or selling crypto through regulated on-ramp/off-ramp providers.
6. App displays a short watchlist of top cryptocurrencies with live prices from Binance.
7. User can connect one or more Binance accounts in Settings so trades placed in the app can be replicated across connected accounts.
8. App supports light and dark mode, with light mode as the default.
9. UI should be seamless, robust, beginner-friendly, and mobile-first.

## 2. Important Product Clarifications

### 2.1 Separate three different concerns

Do not treat these as one system:

1. Crypto market data and crypto order execution
2. Fiat FX reference data for display and conversions
3. Fiat exchange execution and settlement

Best practice is:

1. Use Binance for crypto market data and crypto trade execution.
2. Use a dedicated FX provider for fiat exchange-rate display.
3. Use a licensed on-ramp/off-ramp or exchange provider for real fiat conversion and settlement.

This separation keeps the app more accurate, easier to scale, and much safer from a compliance perspective.

### 2.2 Binance account connection

Inference from Binance's current authenticated API model: implement Binance account linking with user-generated API credentials, not with the user's Binance password. The frontend should never receive or store secrets in plaintext. All authenticated Binance operations should be executed server-side.

### 2.3 Quote vs executable price

The balance card and rates panel can show reference prices.
The fiat exchange screen must request a fresh executable quote before the user confirms a transaction.
Do not use a dashboard FX midpoint as the final payable amount.

## 3. Recommended Technical Architecture

### 3.1 Frontend

Recommended stack:

- Expo + React Native + TypeScript
- Expo Router for app navigation
- Zustand for lightweight client state
- TanStack Query for network state and caching
- React Hook Form + Zod for forms and validation
- NativeWind or a token-driven styling layer for consistent theming
- React Native Reanimated for splash and card transitions
- Expo SecureStore only for temporary local session tokens, never for Binance API secrets

Why this stack:

- Cross-platform mobile-first delivery
- Smooth animation support
- Fast iteration in Codex
- Clean separation between UI state and server state
- Easier beginner-friendly UX than a web-first trading terminal

### 3.2 Backend

Recommended stack:

- Node.js + TypeScript
- NestJS or Fastify-based service architecture
- PostgreSQL for primary relational storage
- Redis for caching, pub/sub, websocket fan-out, and idempotency helpers
- BullMQ or equivalent queue for multi-account trade replication
- WebSocket gateway for pushing live prices and status updates to clients

Backend services should be split into modules:

- Auth service
- User/profile/settings service
- FX market data service
- Crypto market data service
- Binance account integration service
- Trade execution service
- Multi-account replication worker
- Fiat on-ramp/off-ramp integration service
- Notification/webhook service
- Audit and observability service

### 3.3 Infrastructure

Recommended production hosting:

- Mobile app: Expo EAS build pipeline
- API services: Dockerized services on AWS, GCP, or a managed VPS platform
- Database: managed PostgreSQL
- Cache/queues: managed Redis
- Secrets: AWS KMS, Google Cloud KMS, HashiCorp Vault, or equivalent
- Monitoring: Sentry + OpenTelemetry + structured logs

## 4. UX and Visual Direction

### 4.1 Overall style

The app should feel clean and premium, not cluttered like a pro desktop terminal.

Design rules:

- Mobile-first layout from the start
- Light mode default
- Dark mode available from the header/profile/settings
- High-contrast balance card at the top
- Large tap targets and simple labels
- Use icons only where they improve recognition
- Avoid dense tables on mobile; prefer cards, segmented controls, sheets, and compact watchlist rows

### 4.2 Suggested information architecture

Tabs:

1. Home
2. Exchange
3. Trade
4. Accounts
5. Settings

Home screen sections:

1. Animated splash to dashboard transition
2. Main balance card
3. Currency switcher: NGN, QAR, BRL, GBP
4. FX rate cards to USDT
5. Top crypto watchlist
6. Quick actions: Buy, Sell, Convert, Trade, Add Binance Account

### 4.3 Splash screen best practice

Use a branded trading icon animation lasting about 800ms to 1600ms while:

- loading user session
- warming rate caches
- fetching theme and preferred local currency
- connecting websocket channels

Do not make the splash screen fake-loading if startup work is already complete.
If bootstrap finishes early, move into the dashboard quickly.

### 4.4 Balance card best practice

Top card should show:

- Total portfolio in USDT
- Local equivalent in selected currency
- 24h change in both absolute and percentage form
- Quick hide/show balance toggle
- Subtext: "Indicative local conversion" when the value is reference-priced, not executable

### 4.5 Beginner-friendly copy

Prefer labels like:

- Buy Crypto
- Sell Crypto
- Convert Currency
- Connect Binance Account
- Live Market Prices
- Estimated You Receive
- Network Fee
- Provider Fee
- Confirm Trade

Avoid pro jargon on the first layer. Put advanced fields inside expandable sections.

## 5. Feature-by-Feature Build Guidance

### 5.1 Dashboard balance in USDT and local currency

Recommended data model:

- canonical display balance: USDT
- local_currency: enum of `NGN | QAR | BRL | GBP`
- local_equivalent: derived value from current FX reference rate

Formula:

`local_equivalent = usdt_balance * usdt_to_local_rate`

Store the user's selected display currency in profile settings and cache it locally for instant app re-open.

### 5.2 Current exchange-rate section

You asked for live rates from the four fiat currencies to USDT.

Recommended approach:

- Use a dedicated FX provider websocket for the rates panel.
- Subscribe only to the 4 required pairs to reduce noise.
- If direct `FIAT/USDT` pairs are unavailable from the chosen provider, synthesize them from supported pairs and clearly mark them as derived.

Display format example:

- `1 USDT = 1,540.25 NGN`
- `1 USDT = 3.64 QAR`
- `1 USDT = 5.03 BRL`
- `1 USDT = 0.79 GBP`

For clarity in the UI, prefer `USDT -> Local` on cards and let users tap to invert.

### 5.3 Fiat exchange section

This section should not directly move money by your own custom ledger unless you are licensed to do that.

Best-practice execution flow:

1. User picks country/currency, crypto asset, and amount.
2. Backend checks available regulated providers for that country and pair.
3. Backend fetches live executable quotes.
4. UI shows provider, fees, estimated receive amount, and processing time.
5. User confirms.
6. App opens provider checkout or hosted flow, or uses provider API flow.
7. Provider webhook updates status back into your app.

For MVP, start with:

- quote retrieval
- provider selection
- redirect or embedded provider checkout
- webhook-based transaction status

Do not attempt in-app custody, treasury management, or manual settlement in version 1.

### 5.4 Live crypto market section

Keep this simple for beginners.

Recommended watchlist for v1:

- BTC/USDT
- ETH/USDT
- BNB/USDT
- SOL/USDT
- XRP/USDT
- ADA/USDT

Per row show:

- symbol
- last price
- 24h percentage change
- mini sparkline optional in phase 2

### 5.5 Binance account connection and mirrored trading

This is the most sensitive feature in the whole app.

Recommended account model:

- User can add multiple Binance accounts in Settings.
- Each account gets a nickname, permissions summary, status, and last sync time.
- User chooses which accounts are active for mirrored trading.
- User selects replication mode:
  - same size
  - fixed USDT amount
  - percentage of account balance

Trade replication workflow:

1. User places a trade intent in your app.
2. Backend validates symbol, side, quantity, and user permissions.
3. System creates a master trade record.
4. Queue fans out child execution jobs for each connected Binance account.
5. Each job performs risk checks, precision normalization, and signed Binance order submission.
6. Result is persisted per account.
7. Binance user data streams reconcile fills, partial fills, cancellations, and rejects.
8. UI receives per-account statuses in real time.

Non-negotiable safeguards:

- per-account idempotency key
- max slippage rule
- allowed symbol list
- min/max order amount per account
- safe precision handling from exchange filters
- partial failure isolation so one failing account does not break others
- detailed audit log for every order attempt

## 6. Data Sources and APIs

This section lists the recommended current official sources researched on March 28, 2026.

### 6.1 Binance market data and trading

Use Binance for:

- live crypto market data
- symbol metadata
- order placement
- order status updates
- account update streams

Recommended endpoints and streams:

1. Spot WebSocket base:
   - `wss://stream.binance.com:9443`
   - or `wss://stream.binance.com:443`
2. Combined stream format:
   - `/stream?streams=<stream1>/<stream2>`
3. Price bootstrap:
   - `GET /api/v3/ticker/price`
4. New order:
   - `POST /api/v3/order`
5. Test order before production rollout:
   - `POST /api/v3/order/test`
6. User account/order updates:
   - Binance Spot User Data Stream via WebSocket API using API key authentication

Recommended watchlist stream examples:

- `btcusdt@miniTicker`
- `ethusdt@miniTicker`
- `bnbusdt@miniTicker`
- `solusdt@miniTicker`
- `xrpusdt@miniTicker`
- `adausdt@miniTicker`

Best-practice note:

Use REST for initial hydration, then switch to websocket updates. If websocket disconnects, fall back to REST snapshot plus reconnect.

### 6.2 Recommended FX websocket for fiat-to-USDT display

Recommended primary source for the rates panel:

- OpenExchangeAPI WebSocket
- WebSocket endpoint: `wss://api.openexchangeapi.com/v1/ws/rates`

Why it fits this app:

- official websocket docs are available
- docs state support for subscribing to currency pairs
- the platform exposes a currencies endpoint for fiat and crypto assets
- simpler integration for a dashboard than building your own FX aggregation layer in v1

Recommended usage:

1. Attempt direct subscriptions for the required displayed pairs if supported by your plan and pair catalog.
2. If a direct `FIAT/USDT` pair is not available, derive the display rate using supported intermediary pairs and label it as derived in logs or internal metadata.
3. Refresh the displayed local equivalent from websocket updates, but request a fresh execution quote separately inside the exchange flow.

Important limitation:

OpenExchangeAPI documentation says live rates are updated every 60 seconds. That is usually acceptable for reference display, but not sufficient as an executable quote for payment settlement.

### 6.3 Fiat exchange execution provider

Recommended v1 approach:

- use a regulated on-ramp/off-ramp aggregator instead of building settlement yourself

Good candidate:

- Onramper

Why it fits the requested app:

- supports both widget and API integration
- aggregates 30+ providers and 130+ payment methods according to its current docs
- has endpoints to discover supported onramps by country and currency
- has quote endpoints and a transaction-intent endpoint

Suggested use inside your app:

- use the API for provider discovery and quotes
- use hosted checkout or a provider redirect for final settlement in MVP
- use webhooks to reconcile statuses back into the app timeline

Important jurisdiction note:

Country and payment-method support can change. Before launch, verify support specifically for Nigeria, Qatar, Brazil, and the United Kingdom in staging and in commercial onboarding.

## 7. Security and Compliance Best Practices

This product touches financial data and trade execution. Treat security as a feature, not a later add-on.

### 7.1 Binance credentials

- Never collect Binance login passwords.
- Collect only API credentials or public-key based credentials supported by Binance.
- Store credentials only on the backend.
- Encrypt secrets at rest with envelope encryption.
- Decrypt only inside execution workers.
- Mask all secrets in logs, traces, and admin screens.
- Encourage users to disable withdrawal permissions on any API credential used for your app.

### 7.2 API key types

Binance currently documents Ed25519, HMAC, and RSA API key types, with Ed25519 recommended.

Best-practice implementation:

- prefer Ed25519 where your chosen Binance client/signing workflow supports it cleanly
- keep the signing layer abstract so key-type support can evolve without a major refactor

### 7.3 User permissions and confirmations

Require the user to explicitly opt in before enabling mirrored trading.

Minimum controls:

- master enable/disable switch
- account-level enable/disable switch
- max trade size per account
- allowed symbols list
- paper-trading or simulation mode before real trading
- risk disclosure and confirmation logs

### 7.4 Compliance

Before production launch, confirm legal and licensing obligations for:

- offering fiat exchange or on-ramp/off-ramp flows
- storing and processing personal information for KYC-linked flows
- operating in Nigeria, Qatar, Brazil, and the UK
- marketing copy related to trading returns or automated strategies

Best practice is to make fiat settlement provider-led and keep your app as orchestration plus user interface unless you have licensed coverage.

## 8. Reliability and Performance

### 8.1 Market data reliability

- hydrate from REST
- stream updates over websocket
- maintain heartbeats and reconnect backoff
- cache the last good snapshot in Redis
- use stale-data labels if the stream is delayed

### 8.2 Trade execution reliability

- queue every execution request
- use idempotency keys
- separate placement from reconciliation
- subscribe to user data streams for final state confirmation
- retry only when safe and only with idempotency protection

### 8.3 Mobile performance

- lazy load secondary screens
- virtualize long lists
- compress icons and images
- avoid rendering large charts on the home screen in v1
- batch websocket updates before committing UI state

## 9. Suggested Database Model

Core tables/entities:

- users
- user_profiles
- user_preferences
- binance_accounts
- binance_account_permissions
- balance_snapshots
- fx_rate_snapshots
- crypto_watchlist_snapshots
- trade_intents
- child_trade_executions
- execution_events
- fiat_quotes
- fiat_transactions
- webhook_events
- audit_logs

Key fields for `binance_accounts`:

- `id`
- `user_id`
- `nickname`
- `api_key_public`
- `encrypted_secret`
- `key_type`
- `status`
- `permissions_json`
- `is_mirroring_enabled`
- `created_at`
- `updated_at`

## 10. Settings Page Requirements

Settings should include:

- theme toggle: light or dark
- default display currency: NGN, QAR, BRL, GBP
- connect Binance account
- manage connected accounts
- mirrored trading controls
- notification preferences
- privacy and consent text
- support/contact/help center link

Each connected Binance account card should show:

- nickname
- connection status
- trading permission state
- mirrored trading toggle
- last successful sync
- remove account action

## 11. Recommended Delivery Plan

### Phase 1: foundation

- auth
- splash screen
- light/dark theme system
- dashboard shell
- static balance card
- currency switcher
- top crypto list with mock data

### Phase 2: live market data

- Binance price bootstrap
- Binance miniTicker streams
- FX websocket integration
- rate cards and local balance conversion

### Phase 3: account linking and safe execution

- Settings account management
- encrypted credential storage
- order test flow using Binance test endpoint
- real order flow with one connected account
- user data stream reconciliation

### Phase 4: multi-account trade replication

- replication modes
- queue fan-out
- per-account status tracking
- failure isolation and audit logs

### Phase 5: fiat exchange

- provider discovery
- quote flow
- checkout handoff
- webhook reconciliation
- transaction history UI

## 12. Acceptance Criteria for v1

The app is ready for MVP when all of the following are true:

1. App opens into a short branded animated splash and lands on the dashboard smoothly.
2. Dashboard shows total balance in USDT and selected local-currency equivalent.
3. Currency switcher supports NGN, QAR, BRL, and GBP.
4. Rates panel updates automatically without manual refresh.
5. Top crypto prices update live from Binance.
6. User can safely add and manage Binance accounts from Settings.
7. Trade placement can be mirrored to enabled accounts with isolated status tracking.
8. Fiat exchange flow can fetch executable quotes and complete via a compliant provider flow.
9. Light mode is default; dark mode works consistently.
10. UI works cleanly on small mobile screens first.

## 13. Risks to Address Early

Highest-risk areas:

1. Secure storage and signing of Binance credentials
2. Multi-account trade replication edge cases
3. Jurisdiction-specific fiat exchange support
4. Websocket reconnect behavior and stale data handling
5. Precision and filter handling on Binance orders
6. Clear beginner UX around fees, slippage, and execution status

## 14. Recommended Build Prompt for Codex

Use this when you hand the document to Codex:

> Build a mobile-first trading app using Expo React Native and a Node.js TypeScript backend. The app must have an animated splash screen, a beginner-friendly dashboard, a premium balance card in USDT and local-currency equivalent, a currency switcher for NGN/QAR/BRL/GBP, live crypto prices from Binance, live FX display rates, a fiat exchange module using a regulated provider integration, a Settings page for connecting multiple Binance accounts, and safe mirrored trading across enabled accounts. Use light mode by default, include dark mode, keep the UI modern and simple, and implement secure backend-only handling for Binance credentials and trade execution.

## 15. Source Notes

Primary sources researched on March 28, 2026:

1. Binance Spot WebSocket Streams: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
2. Binance Spot Market Data endpoints: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
3. Binance Spot Trading endpoints: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints
4. Binance Spot User Data Stream: https://developers.binance.com/docs/binance-spot-api-docs/user-data-stream
5. Binance API Key Types: https://developers.binance.com/docs/binance-spot-api-docs/faqs/api_key_types
6. OpenExchangeAPI documentation: https://openexchangeapi.com/en-us/documentation/
7. Onramper Supported Defaults endpoint: https://docs.onramper.com/reference/get_supported-defaults-all
8. Onramper Supported Onramps endpoint: https://docs.onramper.com/reference/get_supported-onramps
9. Onramper Transaction Intent endpoint: https://docs.onramper.com/reference/post_checkout-intent
10. Onramper Buy Quotes endpoint: https://docs.onramper.com/reference/get_quotes-fiat-crypto
11. Onramper Sell Quotes endpoint: https://docs.onramper.com/reference/get_quotes-crypto-fiat

## 16. Final Recommendation

If you want the cleanest path to a strong MVP:

1. Build the mobile app first with Expo React Native.
2. Keep Binance execution fully server-side.
3. Use Binance only for crypto trading and live crypto prices.
4. Use a separate FX provider for displayed fiat conversion rates.
5. Use a regulated on-ramp/off-ramp provider for real fiat exchange.
6. Launch single-account trading first, then enable multi-account replication after strong logging and reconciliation are proven.
