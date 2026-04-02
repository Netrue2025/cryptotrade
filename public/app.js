const WATCH_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "PEPEUSDT",
];
const EXCHANGE_OPTIONS = [
  { id: "bybit", label: "Bybit" },
  { id: "binance", label: "Binance" },
];
const WATCHLIST_REFRESH_INTERVAL_MS = 15000;
const TRADE_REFRESH_INTERVAL_MS = 10000;
const ACTIVE_API_ORDER_STATUSES = new Set(["NEW", "PARTIALLY_FILLED", "PENDING_NEW"]);
const KNOWN_QUOTE_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "EUR", "BRL", "TRY"];

const state = {
  user: null,
  theme: localStorage.getItem("tradeflow-theme") || "light",
  authExchange: localStorage.getItem("tradeflow-auth-exchange") || "bybit",
  selectedExchange: localStorage.getItem("tradeflow-selected-exchange") || "bybit",
  authTab: "admin-login",
  showSplash: true,
  hasShownSplash: false,
  activeTab: "home",
  isLoading: false,
  modalError: null,
  actionModal: null,
  notice: null,
  balances: [],
  openOrders: [],
  trades: [],
  users: [],
  totalUsdt: 0,
  totalNgn: 0,
  usdtNgnRate: 0,
  estimatedPnlValue: 0,
  estimatedPnlPercent: 0,
  loadingWatchlist: false,
  loadingAccount: false,
  loadingTrades: false,
  loadingUsers: false,
  watchlistSeed: [],
  liveMap: {},
  tradeMarketMap: {},
  showAllBalances: false,
  showAllWatchlist: false,
  expandedTradeIds: [],
  expandedPendingOrderIds: [],
  selectedHistoryTradeIds: [],
  settingsDraft: {
    apiKey: "",
    apiSecret: "",
    testnet: "false",
  },
  socket: null,
  socketRetry: null,
  socketRefreshTimer: null,
  tradeRefreshTimer: null,
};

const app = document.getElementById("app");
const topbarActions = document.getElementById("topbar-actions");

let watchlistRefreshPromise = null;
let tradeRefreshPromise = null;

function applyTheme() {
  document.body.dataset.theme = state.theme;
  localStorage.setItem("tradeflow-theme", state.theme);
}

function getExchangeLabel(exchange) {
  return EXCHANGE_OPTIONS.find((item) => item.id === exchange)?.label || "Bybit";
}

function setAuthExchange(exchange) {
  state.authExchange = EXCHANGE_OPTIONS.some((item) => item.id === exchange) ? exchange : "bybit";
  localStorage.setItem("tradeflow-auth-exchange", state.authExchange);
}

function getActiveExchange() {
  return state.user?.activeExchange || state.selectedExchange || state.authExchange || "bybit";
}

function setSelectedExchange(exchange) {
  state.selectedExchange = EXCHANGE_OPTIONS.some((item) => item.id === exchange) ? exchange : "bybit";
  localStorage.setItem("tradeflow-selected-exchange", state.selectedExchange);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function requireSessionUser() {
  const payload = await api("/api/auth/me");
  if (!payload.user) {
    throw new Error(
      "Login succeeded, but the session cookie was not stored or sent back. On Render this usually means the browser blocked the cookie or the deployment URL changed."
    );
  }
  return payload.user;
}

function beginLoading() {
  state.isLoading = true;
  render();
}

function endLoading() {
  state.isLoading = false;
  render();
}

async function withLoading(task) {
  beginLoading();
  try {
    return await task();
  } finally {
    endLoading();
  }
}

function showError(message) {
  state.modalError = message;
  state.actionModal = null;
  render();
}

function clearError() {
  state.modalError = null;
  render();
}

function showActionModal(modal) {
  state.actionModal = modal;
  render();
}

function clearActionModal() {
  state.actionModal = null;
  render();
}

function showNotice(message) {
  state.notice = message;
  render();
  clearTimeout(showNotice.timeoutId);
  showNotice.timeoutId = setTimeout(() => {
    state.notice = null;
    render();
  }, 2600);
}

function loadingClass(isLoading) {
  return isLoading ? " is-section-loading" : "";
}

function renderSectionLoadingOverlay(title, detail = "Still fetching live data") {
  return `
    <div class="section-loading-overlay" aria-hidden="true">
      <div class="section-loading-card">
        <div class="section-loading-blur"></div>
        <p class="section-loading-title">${title}</p>
        <p class="section-loading-copy">${detail}</p>
      </div>
    </div>
  `;
}

function formatNumber(value, digits = 8) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return "-";
  }
  return num.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function formatUsdt(value) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNaira(value) {
  return `₦${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUsdtUnit(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function icon(name) {
  const paths = {
    settings:
      '<path d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Zm8 3.3-.9-.5a7.5 7.5 0 0 0-.4-1l.5-1a1 1 0 0 0-.2-1.1l-1.2-1.2a1 1 0 0 0-1.1-.2l-1 .5c-.3-.2-.7-.3-1-.4L14 3h-4l-.4 1.1c-.3.1-.7.2-1 .4l-1-.5a1 1 0 0 0-1.1.2L5 5.4a1 1 0 0 0-.2 1.1l.5 1c-.2.3-.3.7-.4 1L4 12v.1l.9.4c.1.3.2.7.4 1l-.5 1a1 1 0 0 0 .2 1.1l1.2 1.2a1 1 0 0 0 1.1.2l1-.5c.3.2.7.3 1 .4L10 21h4l.4-1.1c.3-.1.7-.2 1-.4l1 .5a1 1 0 0 0 1.1-.2l1.2-1.2a1 1 0 0 0 .2-1.1l-.5-1c.2-.3.3-.7.4-1l.9-.4V12Z"/>',
    signals:
      '<path d="M4 17h3l2.5-7 3 11 2.5-6H20" /><circle cx="7" cy="17" r="1.2"/><circle cx="15" cy="15" r="1.2"/>',
    profile:
      '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.4 2.8-6 7-6s7 2.6 7 6"/>',
    contact:
      '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5v-11Z"/><path d="m8 8 4 3 4-3"/>' ,
    home:
      '<path d="M4 11.5 12 5l8 6.5V20h-5v-4h-6v4H4z"/>',
  };

  return `
    <svg viewBox="0 0 24 24" class="nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      ${paths[name] || paths.home}
    </svg>
  `;
}

function getWatchlist() {
  const base = new Map((state.watchlistSeed || []).map((item) => [item.symbol, item]));
  const symbols = [...new Set([...(state.watchlistSeed || []).map((item) => item.symbol), ...WATCH_SYMBOLS])];
  return symbols.map((symbol) => {
    const seed = base.get(symbol) || { symbol, price: 0, changePercent: 0, volume24h: 0, turnover24h: 0 };
    const live = state.liveMap[symbol] || {};
    return {
      symbol,
      price: Number(live.price || seed.price || 0),
      changePercent: Number(live.changePercent ?? seed.changePercent ?? 0),
      volume24h: Number(live.volume24h ?? seed.volume24h ?? 0),
      turnover24h: Number(live.turnover24h ?? seed.turnover24h ?? 0),
    };
  });
}

function getSymbolData(symbol) {
  return getWatchlist().find((item) => item.symbol === symbol) || { symbol, price: 0, changePercent: 0 };
}

function getTradeFormDefaults() {
  return {
    symbol: "PEPEUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "",
    quantity: "",
    quoteOrderQty: "",
    takeProfitPrice: "",
  };
}

let tradeDraft = getTradeFormDefaults();

function getDisplayedBalances() {
  if (state.showAllBalances) {
    return state.balances;
  }
  return state.balances.slice(0, 5);
}

function getDisplayedWatchlist() {
  const list = getWatchlist();
  if (state.showAllWatchlist) {
    return list;
  }
  return list.slice(0, 5);
}

function getTradeSymbolSuggestions() {
  return [...new Set([
    ...WATCH_SYMBOLS,
    ...(state.watchlistSeed || []).map((item) => item.symbol),
    ...(state.trades || []).map((trade) => trade.symbol),
    ...(state.openOrders || []).map((order) => order.symbol),
  ])].filter(Boolean);
}

function renderWatchlistRows(items) {
  return items
    .map(
      (item) => `
        <div class="ticker-row" data-watch-symbol="${item.symbol}">
          <div>
            <strong>${item.symbol}</strong>
            <p class="muted-copy watch-trend-copy">24h move</p>
          </div>
          <div class="watch-values">
            <strong data-watch-price>${formatNumber(item.price, 8)}</strong>
            <p class="watch-change ${Number(item.changePercent) >= 0 ? "positive" : "negative"}" data-watch-change>${Number(item.changePercent || 0) >= 0 ? "+" : ""}${formatNumber(item.changePercent, 2)}%</p>
          </div>
        </div>
      `
    )
    .join("");
}

function getBalanceForAsset(asset) {
  return state.balances.find((item) => item.asset === asset);
}

function getBaseAssetFromSymbol(symbol) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const quoteAsset = KNOWN_QUOTE_ASSETS.find(
    (item) => normalizedSymbol.endsWith(item) && normalizedSymbol.length > item.length
  );
  return quoteAsset ? normalizedSymbol.slice(0, -quoteAsset.length) : normalizedSymbol;
}

function hasActiveOpenOrderForSymbol(symbol) {
  return (state.openOrders || []).some(
    (order) => order.symbol === symbol && ACTIVE_API_ORDER_STATUSES.has(String(order.status || "").toUpperCase())
  );
}

function hasExchangeBalanceForTrade(trade) {
  const baseAsset = getBaseAssetFromSymbol(trade.symbol);
  const balance = getBalanceForAsset(baseAsset);
  const totalBalance =
    balance && balance.total !== undefined
      ? Number(balance.total || 0)
      : Number(balance?.free || 0) + Number(balance?.locked || 0);
  return totalBalance > 0;
}

function isTradeStrictlyOpen(trade) {
  if (trade.lifecycleStatus !== "OPEN" || getTradeRemainingQuantity(trade) <= 0) {
    return false;
  }

  if (!state.user?.exchangeConnected) {
    return true;
  }

  if (trade.side !== "BUY") {
    return false;
  }

  // Strict rule: if the connected exchange API no longer shows an active order and no remaining
  // asset balance for the trade, the app must not keep that trade inside Open Trades.
  return hasActiveOpenOrderForSymbol(trade.symbol) || hasExchangeBalanceForTrade(trade);
}

function isTradeClearableFromHistory(trade) {
  return !isTradeStrictlyOpen(trade) && trade.lifecycleStatus !== "PENDING";
}

function syncHistorySelection() {
  const tradeIds = new Set(getHistoryTrades().filter(isTradeClearableFromHistory).map((trade) => trade.id));
  state.selectedHistoryTradeIds = state.selectedHistoryTradeIds.filter((tradeId) => tradeIds.has(tradeId));
}

function getHistoryTrades() {
  return [...state.trades];
}

function getCurrentTradeSummary() {
  const symbol = tradeDraft.symbol || "PEPEUSDT";
  const baseAsset = symbol.replace(/USDT$/, "");
  const live = getSymbolData(symbol);
  const effectivePrice = Number(tradeDraft.price || live.price || 0);
  const amount = Number(tradeDraft.quantity || 0);
  const total = tradeDraft.quoteOrderQty
    ? Number(tradeDraft.quoteOrderQty || 0)
    : effectivePrice * amount;
  const baseBalance = getBalanceForAsset(baseAsset)?.total || 0;
  const usdtBalance = getBalanceForAsset("USDT")?.total || 0;
  return {
    baseAsset,
    live,
    effectivePrice,
    total,
    amount,
    baseBalance,
    usdtBalance,
  };
}

function getNetrueBalanceValue() {
  if (state.totalUsdt > 0) {
    return state.totalUsdt;
  }
  return 250;
}

function getTradeEntryPrice(trade) {
  return Number(
    trade.price ||
      trade.adminExecution?.price ||
      trade.adminExecution?.fills?.[0]?.price ||
      0
  );
}

function getTradeCurrentMarket(symbol) {
  return state.tradeMarketMap[symbol] || getSymbolData(symbol) || { price: 0, changePercent: 0 };
}

function getTradePnlPercent(trade) {
  const entry = getTradeEntryPrice(trade);
  const current = Number(getTradeCurrentMarket(trade.symbol)?.price || 0);
  if (!entry || !current) {
    return 0;
  }
  const multiplier = trade.side === "SELL" ? -1 : 1;
  return ((current - entry) / entry) * 100 * multiplier;
}

function getTradeExecutedQuantity(trade) {
  if (state.user?.role === "user") {
    return Number(trade.mirroredExecution?.order?.executedQty || 0);
  }
  return Number(trade.adminExecution?.executedQty || 0);
}

function getTradeExitExecutedQuantity(trade) {
  return (trade.exitOrders || []).reduce((sum, exitOrder) => {
    const execution =
      state.user?.role === "user" ? exitOrder.mirroredExecution?.order || null : exitOrder.adminExecution || null;
    return sum + Number(execution?.executedQty || 0);
  }, 0);
}

function getTradeRemainingQuantity(trade) {
  return Math.max(getTradeExecutedQuantity(trade) - getTradeExitExecutedQuantity(trade), 0);
}

function getTradeCurrentValue(trade) {
  return getTradeRemainingQuantity(trade) * Number(getTradeCurrentMarket(trade.symbol)?.price || 0);
}

function getTradePnlValue(trade) {
  const entry = getTradeEntryPrice(trade);
  const current = Number(getTradeCurrentMarket(trade.symbol)?.price || 0);
  const quantity = getTradeRemainingQuantity(trade);
  if (!entry || !current || !quantity) {
    return 0;
  }
  const multiplier = trade.side === "SELL" ? -1 : 1;
  return (current - entry) * quantity * multiplier;
}

function getTradeTpPnlPercent(trade, targetPrice) {
  const entry = getTradeEntryPrice(trade);
  const target = Number(targetPrice || 0);
  if (!entry || !target) {
    return 0;
  }
  const multiplier = trade.side === "SELL" ? -1 : 1;
  return ((target - entry) / entry) * 100 * multiplier;
}

function getTradeTpPnlValue(trade, targetPrice) {
  const entry = getTradeEntryPrice(trade);
  const target = Number(targetPrice || 0);
  const quantity = getTradeRemainingQuantity(trade);
  if (!entry || !target || !quantity) {
    return 0;
  }
  const multiplier = trade.side === "SELL" ? -1 : 1;
  return (target - entry) * quantity * multiplier;
}

function renderNotice() {
  return state.notice ? `<div class="floating-notice">${state.notice}</div>` : "";
}

function renderErrorModal() {
  if (!state.modalError) {
    return "";
  }
  return `
    <div class="modal-backdrop">
      <div class="modal-card">
        <button class="modal-close" id="modal-close-btn" type="button">x</button>
        <p class="modal-eyebrow">Action Needed</p>
        <h3>Something needs attention</h3>
        <p class="modal-text">${state.modalError}</p>
      </div>
    </div>
  `;
}

function renderActionModal() {
  if (!state.actionModal) {
    return "";
  }

  if (state.actionModal.type === "deposit" || state.actionModal.type === "withdraw") {
    const isDeposit = state.actionModal.type === "deposit";
    const title = isDeposit ? "Deposit Naira" : "Withdraw Naira";
    const eyebrow = isDeposit ? "Wallet Funding" : "Wallet Cashout";
    const buttonLabel = isDeposit ? "Open deposit request" : "Open withdrawal request";
    const note = isDeposit
      ? "This form is ready for your Paystack deposit hookup."
      : "This form is ready for your Paystack withdrawal hookup.";
    return `
      <div class="modal-backdrop">
        <div class="modal-card action-modal-card">
          <button class="modal-close" id="action-modal-close-btn" type="button">x</button>
          <p class="modal-eyebrow neutral">${eyebrow}</p>
          <h3>${title}</h3>
          <p class="modal-text">${note}</p>
          <div class="stack-form">
            <label class="stack-label">
              <span>Amount (NGN)</span>
              <input id="wallet-amount-input" type="number" min="0" step="0.01" placeholder="Enter amount" />
            </label>
            <label class="stack-label">
              <span>Full name</span>
              <input id="wallet-name-input" type="text" placeholder="Enter full name" value="${state.user?.name || ""}" />
            </label>
            <label class="stack-label">
              <span>Email</span>
              <input id="wallet-email-input" type="email" placeholder="Enter email" value="${state.user?.email || ""}" />
            </label>
            ${
              isDeposit
                ? `
                  <label class="stack-label">
                    <span>Reference note</span>
                    <input id="wallet-note-input" type="text" placeholder="Optional note for this deposit" />
                  </label>
                `
                : `
                  <label class="stack-label">
                    <span>Bank name</span>
                    <input id="wallet-bank-input" type="text" placeholder="Enter bank name" />
                  </label>
                  <label class="stack-label">
                    <span>Account number</span>
                    <input id="wallet-account-input" type="text" inputmode="numeric" placeholder="Enter account number" />
                  </label>
                `
            }
          </div>
          <div class="modal-actions">
            <button class="button-secondary" id="action-modal-cancel-btn" type="button">Cancel</button>
            <button class="button-primary shimmer-button" id="wallet-submit-btn" data-wallet-mode="${state.actionModal.type}" type="button">${buttonLabel}</button>
          </div>
        </div>
      </div>
    `;
  }

  const trade = state.trades.find((item) => item.id === state.actionModal.tradeId);
  if (!trade) {
    return "";
  }

  if (state.actionModal.type === "sell") {
    const pnlPercent = getTradePnlPercent(trade);
    const pnlValue = getTradePnlValue(trade);
    const preview = state.actionModal.preview || null;
    const currentValue = Number(preview?.estimatedUsdt || getTradeCurrentValue(trade));
    const currentPrice = Number(preview?.currentPrice || getTradeCurrentMarket(trade.symbol)?.price || 0);
    const quantityText = preview?.quantity ? `${formatNumber(preview.quantity, 8)} ${preview.baseAsset || ""}`.trim() : "";
    return `
      <div class="modal-backdrop">
        <div class="modal-card action-modal-card">
          <button class="modal-close" id="action-modal-close-btn" type="button">x</button>
          <p class="modal-eyebrow neutral">Close Trade</p>
          <h3>Are you sure you want to close this trade?</h3>
          <div class="action-metric-stack">
            <div class="action-metric">
              <span>Pair</span>
              <strong>${trade.symbol}</strong>
            </div>
            <div class="action-metric">
              <span>Current trade value</span>
              <strong>${formatUsdtUnit(currentValue)}</strong>
            </div>
            ${
              quantityText
                ? `
                  <div class="action-metric">
                    <span>Max sell quantity</span>
                    <strong>${quantityText}</strong>
                  </div>
                `
                : ""
            }
            <div class="action-metric">
              <span>Current market price</span>
              <strong>${currentPrice ? formatNumber(currentPrice, 8) : "-"}</strong>
            </div>
            <div class="action-metric">
              <span>Current profit / loss</span>
              <strong class="${pnlPercent >= 0 ? "positive" : "negative"}">${pnlPercent >= 0 ? "+" : ""}${formatNumber(pnlPercent, 2)}%</strong>
            </div>
            <div class="action-metric">
              <span>Profit / loss in USDT</span>
              <strong class="${pnlValue >= 0 ? "positive" : "negative"}">${pnlValue >= 0 ? "+" : ""}${formatUsdtUnit(Math.abs(pnlValue))}</strong>
            </div>
          </div>
          <p class="modal-text">If you agree, the app will cancel any active take-profit order and sell all available ${preview?.baseAsset || trade.symbol.replace(/USDT$/, "")} into USDT at market price.</p>
          <div class="modal-actions">
            <button class="button-secondary" id="action-modal-cancel-btn" type="button">No</button>
            <button class="button-primary shimmer-button" id="confirm-sell-btn" data-trade-id="${trade.id}" type="button">Yes, close trade</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.actionModal.type === "tp") {
    const currentPrice = Number(getTradeCurrentMarket(trade.symbol)?.price || 0);
    const entryPrice = getTradeEntryPrice(trade);
    const targetPrice = state.actionModal.targetPrice || trade.takeProfitTargetPrice || "";
    const pnlPercent = getTradeTpPnlPercent(trade, targetPrice);
    const pnlValue = getTradeTpPnlValue(trade, targetPrice);
    return `
      <div class="modal-backdrop">
        <div class="modal-card action-modal-card">
          <button class="modal-close" id="action-modal-close-btn" type="button">x</button>
          <p class="modal-eyebrow neutral">Take Profit</p>
          <h3>Update ${trade.symbol} TP</h3>
          <div class="action-metric-stack">
            <div class="action-metric">
              <span>Entry price</span>
              <strong>${entryPrice ? formatNumber(entryPrice, 8) : "Market"}</strong>
            </div>
            <div class="action-metric">
              <span>Current market price</span>
              <strong>${currentPrice ? formatNumber(currentPrice, 8) : "-"}</strong>
            </div>
          </div>
          <label class="stack-label">
            <span>TP target price</span>
            <input id="tp-modal-input" value="${targetPrice}" placeholder="Set take-profit price" inputmode="decimal" />
          </label>
          <div class="tp-preview-card">
            <p class="muted-copy">Estimated return at target</p>
            <strong id="tp-modal-preview" class="${pnlPercent >= 0 ? "positive" : "negative"}">${pnlPercent >= 0 ? "+" : ""}${formatNumber(pnlPercent, 2)}%</strong>
            <p id="tp-modal-preview-usdt" class="muted-copy ${pnlValue >= 0 ? "positive" : "negative"}">${pnlValue >= 0 ? "+" : ""}${formatUsdtUnit(Math.abs(pnlValue))}</p>
          </div>
          <p class="modal-text">This updates the stored TP target and replaces the active exchange TP order with the new value when the trade is open.</p>
          <div class="modal-actions">
            <button class="button-secondary" id="action-modal-cancel-btn" type="button">Cancel</button>
            <button class="button-primary shimmer-button" id="confirm-tp-btn" data-trade-id="${trade.id}" type="button">Save TP</button>
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function renderLoader() {
  if (!state.isLoading) {
    return "";
  }
  return `
    <div class="loader-backdrop">
      <div class="loader-card">
        <div class="loader-orbit">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p>Loading dashboard...</p>
      </div>
    </div>
  `;
}

function startSplashSequence(force = false) {
  clearTimeout(startSplashSequence.timeoutId);
  if (state.hasShownSplash && !force) {
    state.showSplash = false;
    render();
    return;
  }

  state.showSplash = true;
  render();
  startSplashSequence.timeoutId = setTimeout(() => {
    state.showSplash = false;
    state.hasShownSplash = true;
    render();
  }, 2600);
}

function renderAuthPane() {
  if (state.authTab === "register") {
    return `
      <form id="register-form" class="auth-form">
        <label>Exchange
          <select name="exchange">
            ${EXCHANGE_OPTIONS.map((exchange) => `<option value="${exchange.id}" ${state.authExchange === exchange.id ? "selected" : ""}>${exchange.label}</option>`).join("")}
          </select>
        </label>
        <label>Name <input name="name" placeholder="Full name" required /></label>
        <label>Email <input name="email" type="email" placeholder="you@example.com" required /></label>
        <label>Password <input name="password" type="password" placeholder="Create password" required /></label>
        <button class="button-primary shimmer-button" type="submit">Create User Account</button>
      </form>
    `;
  }

  const isAdmin = state.authTab === "admin-login";
  return `
    <form id="${isAdmin ? "admin" : "user"}-login-form" class="auth-form">
      <label>Exchange
        <select name="exchange">
          ${EXCHANGE_OPTIONS.map((exchange) => `<option value="${exchange.id}" ${state.authExchange === exchange.id ? "selected" : ""}>${exchange.label}</option>`).join("")}
        </select>
      </label>
      <label>Email <input name="email" type="email" placeholder="${isAdmin ? "admin@trade.local" : "you@example.com"}" required /></label>
      <label>Password <input name="password" type="password" placeholder="${isAdmin ? "Admin password" : "Your password"}" required /></label>
      <button class="button-primary shimmer-button" type="submit">${isAdmin ? "Enter Admin App" : "Open User App"}</button>
    </form>
  `;
}

function renderSplashScreen() {
  return `
    <section class="splash-screen">
      <div class="splash-aura splash-aura-one"></div>
      <div class="splash-aura splash-aura-two"></div>
      <div class="splash-logo-shell">
        <img class="splash-logo" src="/netruefx-logo.png" alt="Netrue FX logo" />
      </div>
      <div class="splash-copy">
        <p class="eyebrow">Netrue FX</p>
        <h2>Smart trading starts here</h2>
        <p class="muted-copy">Loading your secure trading gateway...</p>
      </div>
    </section>
  `;
}

function renderAuthLanding() {
  const isRegister = state.authTab === "register";
  return `
    <section class="auth-landing">
      <section class="auth-shell-card">
        <div class="auth-brand-block">
          <img class="auth-brand-logo" src="/netruefx-logo.png" alt="Netrue FX logo" />
          <div>
            <p class="eyebrow">Netrue FX</p>
            <h2>${isRegister ? "Create your user account" : "Welcome back"}</h2>
            <p class="muted-copy">${isRegister ? "Register once, then choose Binance or Bybit as your active exchange." : "Sign in as admin or user, then continue with your preferred exchange."}</p>
          </div>
        </div>
        <div class="auth-mode-row">
          <button class="auth-toggle ${!isRegister ? "active" : ""}" data-auth-mode="login" type="button">Login</button>
          <button class="auth-toggle ${isRegister ? "active" : ""}" data-auth-mode="register" type="button">Register</button>
        </div>
        ${
          !isRegister
            ? `
              <div class="auth-role-row">
                <button class="auth-toggle ${state.authTab === "admin-login" ? "active" : ""}" data-auth-tab="admin-login" type="button">Admin</button>
                <button class="auth-toggle ${state.authTab === "user-login" ? "active" : ""}" data-auth-tab="user-login" type="button">User</button>
              </div>
            `
            : `
              <p class="auth-role-note">New registrations create a user account.</p>
            `
        }
        ${renderAuthPane()}
      </section>
    </section>
  `;
}

function renderLanding() {
  app.innerHTML = `
    ${state.showSplash ? renderSplashScreen() : renderAuthLanding()}
    ${renderNotice()}
    ${renderErrorModal()}
    ${renderActionModal()}
    ${renderLoader()}
  `;

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authTab = button.dataset.authTab;
      render();
    });
  });

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authTab = button.dataset.authMode === "register" ? "register" : "admin-login";
      render();
    });
  });

  bindAuthForms();
  bindModalActions();
}

function renderTopbarActions() {
  const topbar = document.querySelector(".topbar");
  document.body.dataset.appShell = state.user ? "dashboard" : "guest";

  if (!state.user) {
    if (topbar) {
      topbar.style.display = "none";
    }
    topbarActions.innerHTML = "";
    return;
  }

  if (topbar) {
    topbar.style.display = "";
  }

  topbarActions.innerHTML = `
    <div class="brand-mark">
      <div class="brand-icon star-icon">&#9733;</div>
      <div>
        <strong>TradeFlow</strong>
        <p>${state.user ? `${state.user.role === "admin" ? "Admin Console" : "User Console"} | ${getExchangeLabel(getActiveExchange())}` : "Crypto Spot App"}</p>
      </div>
    </div>
  `;
}

function bindModalActions() {
  const closeButton = document.getElementById("modal-close-btn");
  if (closeButton) {
    closeButton.addEventListener("click", clearError);
  }

  const actionCloseButton = document.getElementById("action-modal-close-btn");
  if (actionCloseButton) {
    actionCloseButton.addEventListener("click", clearActionModal);
  }

  const actionCancelButton = document.getElementById("action-modal-cancel-btn");
  if (actionCancelButton) {
    actionCancelButton.addEventListener("click", clearActionModal);
  }

  const confirmSellButton = document.getElementById("confirm-sell-btn");
  if (confirmSellButton) {
    confirmSellButton.addEventListener("click", () => confirmMarketSell(confirmSellButton.dataset.tradeId));
  }

  const confirmTpButton = document.getElementById("confirm-tp-btn");
  if (confirmTpButton) {
    confirmTpButton.addEventListener("click", () => confirmTakeProfit(confirmTpButton.dataset.tradeId));
  }

  const tpInput = document.getElementById("tp-modal-input");
  if (tpInput) {
    tpInput.addEventListener("input", () => {
      const trade = state.trades.find((item) => item.id === state.actionModal?.tradeId);
      if (!trade) {
        return;
      }
      state.actionModal = {
        ...state.actionModal,
        targetPrice: tpInput.value,
      };
      const preview = document.getElementById("tp-modal-preview");
      const previewUsdt = document.getElementById("tp-modal-preview-usdt");
      if (preview) {
        const pnlPercent = getTradeTpPnlPercent(trade, tpInput.value);
        preview.textContent = `${pnlPercent >= 0 ? "+" : ""}${formatNumber(pnlPercent, 2)}%`;
        preview.classList.toggle("positive", pnlPercent >= 0);
        preview.classList.toggle("negative", pnlPercent < 0);
      }
      if (previewUsdt) {
        const pnlValue = getTradeTpPnlValue(trade, tpInput.value);
        previewUsdt.textContent = `${pnlValue >= 0 ? "+" : ""}${formatUsdtUnit(Math.abs(pnlValue))}`;
        previewUsdt.classList.toggle("positive", pnlValue >= 0);
        previewUsdt.classList.toggle("negative", pnlValue < 0);
      }
    });
  }
}

function bindAuthForms() {
  const adminForm = document.getElementById("admin-login-form");
  const userForm = document.getElementById("user-login-form");
  const registerForm = document.getElementById("register-form");

  document.querySelectorAll('form.auth-form select[name="exchange"]').forEach((select) => {
    select.addEventListener("change", () => {
      setAuthExchange(select.value);
      render();
    });
  });

  if (adminForm) {
    adminForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await withLoading(async () => {
        const payload = Object.fromEntries(new FormData(adminForm).entries());
        const result = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.user = await requireSessionUser();
        setSelectedExchange(state.user.activeExchange || payload.exchange || "bybit");
        state.activeTab = "home";
        await loadDashboardData();
        showNotice(`Welcome back, ${state.user.name}`);
      }).catch((error) => showError(error.message));
    });
  }

  if (userForm) {
    userForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await withLoading(async () => {
        const payload = Object.fromEntries(new FormData(userForm).entries());
        const result = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.user = await requireSessionUser();
        setSelectedExchange(state.user.activeExchange || payload.exchange || "bybit");
        state.activeTab = "home";
        await loadDashboardData();
        showNotice(`Welcome back, ${state.user.name}`);
      }).catch((error) => showError(error.message));
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await withLoading(async () => {
        const payload = Object.fromEntries(new FormData(registerForm).entries());
        const result = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.user = await requireSessionUser();
        setSelectedExchange(state.user.activeExchange || payload.exchange || "bybit");
        state.activeTab = "home";
        await loadDashboardData();
        showNotice("Account created");
      }).catch((error) => showError(error.message));
    });
  }
}

function refreshWatchlistDom() {
  document.querySelectorAll("[data-watch-symbol]").forEach((row) => {
    const symbol = row.dataset.watchSymbol;
    const live = getSymbolData(symbol);
    const priceNode = row.querySelector("[data-watch-price]");
    const changeNode = row.querySelector("[data-watch-change]");
    if (priceNode) {
      priceNode.textContent = formatNumber(live.price, 8);
    }
    if (changeNode) {
      const positive = Number(live.changePercent || 0) >= 0;
      changeNode.textContent = `${positive ? "+" : ""}${formatNumber(live.changePercent, 2)}%`;
      changeNode.classList.toggle("positive", positive);
      changeNode.classList.toggle("negative", !positive);
    }
  });
}

function refreshAiSignalDom() {
  const host = document.querySelector("[data-ai-signal-host]");
  if (host) {
    host.innerHTML = renderAiSignalCard();
  }
}

function refreshTradeDom() {
  document.querySelectorAll("[data-trade-symbol-row]").forEach((row) => {
    const symbol = row.dataset.tradeSymbolRow;
    const entry = Number(row.dataset.tradeEntry || 0);
    const side = row.dataset.tradeSide || "BUY";
    const market = getTradeCurrentMarket(symbol);
    const current = Number(market.price || 0);
    const pnlNode = row.querySelector("[data-trade-pnl]");
    const currentNode = row.querySelector("[data-trade-current]");
    const entryNode = row.querySelector("[data-trade-entry]");
    const currentValueNodes = row.querySelectorAll("[data-trade-current-value]");

    if (entryNode) {
      entryNode.textContent = `Entry ${entry ? formatNumber(entry, 8) : "Market"}`;
    }
    if (currentNode) {
      currentNode.textContent = `Current ${current ? formatNumber(current, 8) : "-"}`;
    }
    currentValueNodes.forEach((node) => {
      const quantity = Number(
        row.dataset.tradeQuantity ||
          row.dataset.tradeRemainingQuantity ||
          0
      );
      node.textContent = formatUsdtUnit(quantity * current);
    });
    if (pnlNode) {
      const multiplier = side === "SELL" ? -1 : 1;
      const pnl = entry && current ? ((current - entry) / entry) * 100 * multiplier : 0;
      pnlNode.textContent = `${pnl >= 0 ? "+" : ""}${formatNumber(pnl, 2)}%`;
      pnlNode.classList.toggle("positive", pnl >= 0);
      pnlNode.classList.toggle("negative", pnl < 0);
    }
  });
}

function statusClass(status) {
  const value = String(status || "").toUpperCase();
  if (value === "PENDING") {
    return "status-pending";
  }
  if (value === "OPEN") {
    return "status-open";
  }
  if (value === "CLOSED") {
    return "status-closed";
  }
  return "status-neutral";
}

function renderTradeStatusBadge(status) {
  return `<span class="trade-status-badge ${statusClass(status)}">${status}</span>`;
}

async function refreshTradeStatusData() {
  if (!state.user) {
    return;
  }
  try {
    const payload = await api("/api/trades");
    const nextTrades = payload.trades || [];
    let nextOpenOrders = [];
    if (state.user.exchangeConnected) {
      const openOrdersPayload = await api(`/api/exchange/open-orders?exchange=${encodeURIComponent(getActiveExchange())}`);
      nextOpenOrders = openOrdersPayload.openOrders || [];
    }
    const tradesChanged = JSON.stringify(nextTrades) !== JSON.stringify(state.trades);
    const openOrdersChanged = JSON.stringify(nextOpenOrders) !== JSON.stringify(state.openOrders);
    state.trades = nextTrades;
    state.openOrders = nextOpenOrders;
    syncHistorySelection();
    const activeTradeIds = new Set(nextTrades.map((trade) => trade.id));
    const activeOpenOrderIds = new Set(nextOpenOrders.map((order) => String(order.orderId)));
    state.expandedTradeIds = state.expandedTradeIds.filter((id) => activeTradeIds.has(id));
    state.expandedPendingOrderIds = state.expandedPendingOrderIds.filter((id) => activeOpenOrderIds.has(id));
    if (tradesChanged || openOrdersChanged) {
      refreshTradeSectionsDom();
    }
  } catch {
    // keep last known trade snapshot
  }
}

function refreshTradeSectionsDom() {
  const homeHost = document.querySelector("[data-home-trades-host]");
  if (homeHost) {
    homeHost.innerHTML = renderOpenOrdersSection();
  }

  const historyHost = document.querySelector("[data-history-host]");
  if (historyHost) {
    historyHost.innerHTML = renderHistoryContent();
  }

  bindTradeActionButtons();
  bindTradeDisclosureToggles();
  bindHistoryActions();
  refreshTradeDom();
}

async function refreshTradeMarketData() {
  if (!state.user) {
    return;
  }
  const symbols = [...new Set([
    ...state.trades.map((trade) => trade.symbol),
    ...(state.openOrders || []).map((order) => order.symbol),
  ].filter(Boolean))];
  if (!symbols.length) {
    return;
  }

  try {
    const payload = await api(`/api/market/prices?symbols=${encodeURIComponent(symbols.join(","))}`);
    state.tradeMarketMap = Object.fromEntries(
      (payload.prices || []).map((item) => [
        item.symbol,
        {
          price: Number(item.price || 0),
          changePercent: Number(item.changePercent || 0),
        },
      ])
    );
    refreshTradeDom();
  } catch {
    // keep the current snapshot if the lightweight live refresh fails
  }
}

function connectWatchSocket() {
  disconnectWatchSocket();
  hydrateWatchlistFromSeed();
  refreshWatchlistDom();
  state.socketRefreshTimer = setInterval(() => {
    void refreshWatchlistFeed();
  }, WATCHLIST_REFRESH_INTERVAL_MS);
}

function disconnectWatchSocket() {
  clearInterval(state.socketRefreshTimer);
  state.socketRefreshTimer = null;
}

function startTradeRefreshTimer() {
  clearInterval(state.tradeRefreshTimer);
  state.tradeRefreshTimer = setInterval(() => {
    void refreshDashboardLiveData();
  }, TRADE_REFRESH_INTERVAL_MS);
}

function stopTradeRefreshTimer() {
  clearInterval(state.tradeRefreshTimer);
  state.tradeRefreshTimer = null;
}

async function loadWatchlistSeed() {
  try {
    const payload = await api("/api/market/watchlist");
    state.watchlistSeed = payload.watchlist || [];
  } catch {
    state.watchlistSeed = [];
  }
}

function hydrateWatchlistFromSeed() {
  state.liveMap = Object.fromEntries(
    (state.watchlistSeed || []).map((item) => [
      item.symbol,
      {
        price: Number(item.price || 0),
        changePercent: Number(item.changePercent || 0),
        volume24h: Number(item.volume24h || 0),
        turnover24h: Number(item.turnover24h || 0),
      },
    ])
  );
}

async function refreshWatchlistFeed() {
  if (watchlistRefreshPromise) {
    return watchlistRefreshPromise;
  }

  if (!state.watchlistSeed.length) {
    state.loadingWatchlist = true;
    render();
  }

  watchlistRefreshPromise = loadWatchlistSeed()
    .then(() => {
      hydrateWatchlistFromSeed();
      refreshWatchlistDom();
      refreshAiSignalDom();
    })
    .catch(() => {
      state.watchlistSeed = [];
      hydrateWatchlistFromSeed();
      refreshWatchlistDom();
      refreshAiSignalDom();
    })
    .finally(() => {
      const shouldRender = state.loadingWatchlist;
      state.loadingWatchlist = false;
      if (shouldRender) {
        render();
      }
      watchlistRefreshPromise = null;
    });

  return watchlistRefreshPromise;
}

async function refreshDashboardLiveData() {
  if (tradeRefreshPromise) {
    return tradeRefreshPromise;
  }

  tradeRefreshPromise = Promise.allSettled([
    refreshTradeMarketData(),
    refreshTradeStatusData(),
  ]).finally(() => {
    tradeRefreshPromise = null;
  });

  return tradeRefreshPromise;
}

function applyAccountSnapshot(account) {
  if (account) {
    state.balances = account.balances || [];
    state.openOrders = account.openOrders || [];
    state.totalUsdt = Number(account.totalUsdt || 0);
    state.totalNgn = Number(account.totalNgn || 0);
    state.usdtNgnRate = Number(account.usdtNgnRate || 0);
    state.estimatedPnlValue = Number(account.estimatedPnlValue || 0);
    state.estimatedPnlPercent = Number(account.estimatedPnlPercent || 0);
    return;
  }

  state.balances = [];
  state.openOrders = [];
  state.totalUsdt = 0;
  state.totalNgn = 0;
  state.usdtNgnRate = 0;
  state.estimatedPnlValue = 0;
  state.estimatedPnlPercent = 0;
}

async function loadDashboardData() {
  if (!state.user) {
    disconnectWatchSocket();
    stopTradeRefreshTimer();
    state.loadingWatchlist = false;
    render();
    return;
  }

  state.loadingWatchlist = !state.watchlistSeed.length;
  state.loadingAccount = !!(state.user.exchangeConnected && !state.balances.length);
  state.loadingTrades = !state.trades.length;
  state.loadingUsers = !!(state.user.role === "admin" && !state.users.length);
  render();

  const watchlistPromise = refreshWatchlistFeed()
    .then(() => {
      connectWatchSocket();
      render();
    })
    .catch(() => {
      state.watchlistSeed = [];
      hydrateWatchlistFromSeed();
      connectWatchSocket();
      render();
    });

  applyAccountSnapshot(null);
  const accountPromise = state.user.exchangeConnected
    ? api(`/api/exchange/account?exchange=${encodeURIComponent(getActiveExchange())}`)
        .then((account) => {
          applyAccountSnapshot(account);
          state.loadingAccount = false;
          render();
        })
        .catch(() => {
          applyAccountSnapshot(null);
          state.loadingAccount = false;
          render();
        })
    : Promise.resolve().then(() => {
        state.loadingAccount = false;
      });
  const tradesPromise = api("/api/trades");
  const usersPromise = state.user.role === "admin"
    ? api("/api/admin/users")
    : Promise.resolve({ users: [] });

  const [tradesPayload, usersPayload] = await Promise.all([
    tradesPromise,
    usersPromise,
  ]);

  state.trades = tradesPayload.trades || [];
  state.users = usersPayload.users || [];
  state.loadingTrades = false;
  state.loadingUsers = false;
  syncHistorySelection();
  render();
  void refreshTradeMarketData();
  startTradeRefreshTimer();
  void accountPromise;
  void watchlistPromise;
}

function bindHistoryActions() {
  document.querySelectorAll("[data-history-trade-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const tradeId = input.dataset.historyTradeId;
      if (!tradeId) {
        return;
      }

      if (input.checked) {
        if (!state.selectedHistoryTradeIds.includes(tradeId)) {
          state.selectedHistoryTradeIds = [...state.selectedHistoryTradeIds, tradeId];
        }
      } else {
        state.selectedHistoryTradeIds = state.selectedHistoryTradeIds.filter((id) => id !== tradeId);
      }
      render();
    });
  });

  const selectAllButton = document.getElementById("history-select-all-btn");
  if (selectAllButton) {
    selectAllButton.addEventListener("click", () => {
      const trades = getHistoryTrades().filter(isTradeClearableFromHistory);
      const allTradeIds = trades.map((trade) => trade.id);
      const shouldClearSelection = allTradeIds.length && state.selectedHistoryTradeIds.length === allTradeIds.length;
      state.selectedHistoryTradeIds = shouldClearSelection ? [] : allTradeIds;
      render();
    });
  }

  const clearButton = document.getElementById("history-clear-btn");
  if (clearButton) {
    clearButton.addEventListener("click", async () => {
      const tradeIds = [...state.selectedHistoryTradeIds];
      if (!tradeIds.length) {
        showError("Select at least one trade to clear.");
        return;
      }

      const label = tradeIds.length === 1 ? "this trade history item" : `these ${tradeIds.length} trade history items`;
      if (!window.confirm(`Clear ${label}? This removes them from the saved app history.`)) {
        return;
      }

      await withLoading(async () => {
        const result = await api("/api/trades/history/clear", {
          method: "POST",
          body: JSON.stringify({ tradeIds }),
        });
        state.selectedHistoryTradeIds = [];
        await loadDashboardData();
        showNotice(`${result.clearedCount || tradeIds.length} history item${(result.clearedCount || tradeIds.length) === 1 ? "" : "s"} cleared`);
      }).catch((error) => showError(error.message));
    });
  }
}

function renderBottomNav() {
  const tabs = [
    { id: "home", label: "Home", iconName: "home" },
    { id: "signals", label: "Signals", iconName: "signals" },
    { id: "history", label: "History", iconName: "profile" },
    { id: "settings", label: "Settings", iconName: "settings" },
  ];

  return `
    <nav class="bottom-nav">
      ${tabs
        .map(
          (tab) => `
            <button class="nav-button ${state.activeTab === tab.id ? "active" : ""}" data-tab="${tab.id}" type="button">
              ${icon(tab.iconName)}
              <span>${tab.label}</span>
            </button>
          `
        )
        .join("")}
    </nav>
  `;
}

function renderSummaryCard() {
  const nairaBalance = Number(state.totalNgn || 0);
  const nairaRate = Number(state.usdtNgnRate || 0);
  const accountLoading = state.loadingAccount;
  const exchangeLabel = getExchangeLabel(getActiveExchange());
  const chips =
    state.user?.role === "admin"
      ? [
          "Spot only",
          `Mirrored users ${state.users.filter((user) => user.mirrorEnabled).length}`,
          `Connected users ${state.users.filter((user) => user.bybitConnected || user.binanceConnected).length}`,
        ]
      : [
          "Spot only",
          state.user?.mirrorEnabled ? "Mirror enabled" : "Mirror off",
          state.user?.exchangeConnected ? `${exchangeLabel} connected` : "Setup needed",
        ];

  return `
      <section class="balance-carousel">
        <article class="summary-hero balance-slide">
          ${accountLoading ? renderSectionLoadingOverlay("Loading balances", `Syncing your ${exchangeLabel} balance cards`) : ""}
          <div>
            <p class="eyebrow light">Spot Balance</p>
            <h2>${formatUsdt(state.totalUsdt)}</h2>
            <p class="muted-bright">Live estimate based on ${exchangeLabel} spot balances.</p>
            <p class="summary-subline ${state.estimatedPnlPercent >= 0 ? "positive" : "negative"}">24h est. PnL ${state.estimatedPnlValue >= 0 ? "+" : ""}${formatUsdt(state.estimatedPnlValue)} (${state.estimatedPnlPercent >= 0 ? "+" : ""}${formatNumber(state.estimatedPnlPercent, 2)}%)</p>
          </div>
          <div class="hero-chip-row">
            ${chips.map((chip) => `<span class="hero-chip">${chip}</span>`).join("")}
          </div>
          <div class="carousel-hint" aria-hidden="true">
            <span class="carousel-bar active"></span>
            <span class="carousel-bar"></span>
          </div>
        </article>
        <article class="summary-hero balance-slide netrue-card">
          ${accountLoading ? renderSectionLoadingOverlay("Loading NGN view", "Pulling the latest fiat conversion") : ""}
          <div>
            <p class="eyebrow light">Naira Balance</p>
            <h2>${nairaBalance > 0 ? formatNaira(nairaBalance) : "--"}</h2>
            <p class="muted-bright">
              ${nairaRate > 0 ? `${exchangeLabel} fiat rate 1 USDT = ${formatNaira(nairaRate)}` : `${exchangeLabel} fiat rate unavailable right now.`}
            </p>
            <p class="muted-bright">Live portfolio value converted from your ${exchangeLabel} spot balance.</p>
          </div>
          <div class="hero-actions">
            <button class="hero-action-btn" id="netrue-deposit-btn" type="button">Deposit</button>
            <button class="hero-action-btn ghost" id="netrue-withdraw-btn" type="button">Withdraw</button>
          </div>
        </article>
      </section>
  `;
}

function renderTradeTicket() {
  const summary = getCurrentTradeSummary();
  const livePositive = Number(summary.live.changePercent || 0) >= 0;
  const symbolSuggestions = getTradeSymbolSuggestions();

  return `
    <section class="trade-ticket">
      <div class="ticket-head">
        <div>
          <input id="trade-symbol" class="ticket-symbol" list="trade-symbol-list" value="${tradeDraft.symbol}" placeholder="Type pair e.g. PEPEUSDT" />
          <datalist id="trade-symbol-list">
            ${symbolSuggestions.map((symbol) => `<option value="${symbol}"></option>`).join("")}
          </datalist>
          <p class="ticket-change ${livePositive ? "positive" : "negative"}">${livePositive ? "+" : ""}${formatNumber(summary.live.changePercent, 2)}%</p>
        </div>
        <span class="ticket-badge">Admin</span>
      </div>
      <div class="segmented">
        <button class="segment ${tradeDraft.side === "BUY" ? "active buy" : ""}" data-side="BUY" type="button">Buy</button>
        <button class="segment ${tradeDraft.side === "SELL" ? "active sell" : ""}" data-side="SELL" type="button">Sell</button>
      </div>
      <label class="ticket-select-wrap">
        <span>Order Type</span>
        <select id="trade-type" class="ticket-select">
          <option value="LIMIT" ${tradeDraft.type === "LIMIT" ? "selected" : ""}>Limit</option>
          <option value="MARKET" ${tradeDraft.type === "MARKET" ? "selected" : ""}>Market</option>
        </select>
      </label>
      <div class="ticket-grid">
        <label class="ticket-box">
          <span>Price (USDT)</span>
          <div class="step-input">
            <button type="button" class="step-btn" data-step-field="price" data-step-dir="-1">-</button>
            <input id="trade-price" value="${tradeDraft.price}" placeholder="${summary.live.price ? formatNumber(summary.live.price, 8) : "0.00000000"}" />
            <button type="button" class="step-btn" data-step-field="price" data-step-dir="1">+</button>
          </div>
        </label>
        <button class="ticket-side-btn" id="use-live-price-btn" type="button">BBO</button>
      </div>
      <label class="ticket-box">
        <span>Amount (${summary.baseAsset})</span>
        <div class="step-input">
          <button type="button" class="step-btn" data-step-field="quantity" data-step-dir="-1">-</button>
          <input id="trade-quantity" value="${tradeDraft.quantity}" placeholder="Enter quantity" />
          <button type="button" class="step-btn" data-step-field="quantity" data-step-dir="1">+</button>
        </div>
      </label>
      <div class="slider-row">
        ${[25, 50, 75, 100].map((value) => `<button type="button" class="slider-pill" data-alloc="${value}">${value}%</button>`).join("")}
      </div>
      <label class="ticket-box">
        <span>Total (USDT)</span>
        <input id="trade-total" value="${tradeDraft.quoteOrderQty || (summary.total ? summary.total.toFixed(8) : "")}" placeholder="Auto calculated" />
      </label>
      <label class="ticket-box soft">
        <span>Take Profit (USDT)</span>
        <input id="trade-tp" value="${tradeDraft.takeProfitPrice}" placeholder="Optional take profit price" />
      </label>
      <button id="trade-submit-btn" class="button-primary shimmer-button ticket-submit" type="button">Place Spot Trade</button>
    </section>
  `;
}

function renderBalancesSection() {
  const balances = getDisplayedBalances();
  const exchangeLabel = getExchangeLabel(getActiveExchange());
  return `
    <section class="mobile-card${loadingClass(state.loadingAccount)}">
      ${state.loadingAccount ? renderSectionLoadingOverlay("Loading assets", `Pulling your connected ${exchangeLabel} balances`) : ""}
      <div class="section-head">
        <div>
          <h3>Connected ${exchangeLabel} Balances</h3>
          <p class="muted-copy">Top coins first, with live USDT value.</p>
        </div>
        <button id="toggle-balances-btn" class="text-link" type="button">${state.showAllBalances ? "See less" : "See more"}</button>
      </div>
      <div class="card-list">
        ${balances
          .map(
            (balance) => `
              <div class="asset-card">
                <div>
                  <strong>${balance.asset}</strong>
                  <p class="muted-copy">Qty ${formatNumber(balance.total)}</p>
                </div>
                <div class="asset-values">
                  <strong>${formatUsdt(balance.usdtValue)}</strong>
                  <p class="muted-copy ${Number(balance.changePercent || 0) >= 0 ? "positive" : "negative"}">
                    ${Number(balance.changePercent || 0) >= 0 ? "+" : ""}${formatNumber(balance.changePercent, 2)}%
                    (${Number(balance.estimatedPnlValue || 0) >= 0 ? "+" : ""}${formatUsdt(balance.estimatedPnlValue)})
                  </p>
                </div>
              </div>
            `
          )
          .join("") || `<p class="muted-copy">Connect ${exchangeLabel} in settings to load balances.</p>`}
      </div>
    </section>
  `;
}

function renderWatchlistSection() {
  const watchlist = getDisplayedWatchlist();
  return `
    <section class="mobile-card${loadingClass(state.loadingWatchlist)}">
      ${state.loadingWatchlist ? renderSectionLoadingOverlay("Loading watchlist", "Refreshing live market movers") : ""}
      <div class="section-head">
        <div>
          <h3>Live Crypto Watchlist</h3>
          <p class="muted-copy">Streaming prices in USDT.</p>
        </div>
        <button id="toggle-watchlist-btn" class="text-link" type="button">${state.showAllWatchlist ? "See less" : "See more"}</button>
      </div>
      <div class="compact-list" data-watchlist-host="dashboard">${renderWatchlistRows(watchlist)}</div>
    </section>
  `;
}

function getAiRecommendations() {
  const list = [...getWatchlist()].filter((item) => item.price > 0);
  if (!list.length) {
    return { topPump: null, topDip: null };
  }

  const sortedByTurnover = [...list].sort((a, b) => Number(b.turnover24h || 0) - Number(a.turnover24h || 0));
  const liquidUniverse = sortedByTurnover.slice(0, 12);
  const topPump = [...liquidUniverse].sort((a, b) => {
    const changeDiff = Number(b.changePercent || 0) - Number(a.changePercent || 0);
    return changeDiff || Number(b.turnover24h || 0) - Number(a.turnover24h || 0);
  })[0] || null;
  const topDip = [...liquidUniverse].sort((a, b) => {
    const changeDiff = Number(a.changePercent || 0) - Number(b.changePercent || 0);
    return changeDiff || Number(b.turnover24h || 0) - Number(a.turnover24h || 0);
  })[0] || null;
  return { topPump, topDip };
}

function buildAiTradingHint(coin, mode) {
  if (!coin) {
    return "Waiting for market data.";
  }

  const trend = Number(coin.changePercent || 0);
  const turnover = Number(coin.turnover24h || 0);
  const turnoverText = turnover > 0 ? `${formatUsdt(turnover)} 24h turnover` : "light 24h turnover";

  if (mode === "pump") {
    if (trend >= 8) {
      return `Live read: strong upside pressure with ${turnoverText}. Watch for continuation only if buyers keep defending pullbacks.`;
    }
    if (trend >= 0) {
      return `Live read: buyers still control this tape and ${turnoverText} supports continuation.`;
    }
    return `Live read: turnover is active, but the move is no longer a clean pump.`;
  }

  if (trend <= -8) {
    return `Live read: heavy downside pressure with ${turnoverText}. This is the sharpest dip in the active watchlist.`;
  }
  if (trend < 0) {
    return `Live read: sellers still have the edge and ${turnoverText} confirms the weakness.`;
  }
  return `Live read: downside is fading, so the dip signal weakens if buyers reclaim price.`;
}

function renderAiSignalCard() {
  const { topPump, topDip } = getAiRecommendations();
  return `
    <section class="mobile-card ai-card${loadingClass(state.loadingWatchlist)}">
      ${state.loadingWatchlist ? renderSectionLoadingOverlay("Loading AI signals", "Reading market direction from live data") : ""}
      <div class="section-head">
        <div>
          <h3>AI Market Pulse</h3>
          <p class="muted-copy">Live top pump and top dip from ${getExchangeLabel(getActiveExchange())} movers with strong turnover.</p>
        </div>
      </div>
      <div class="ai-grid">
        <div class="ai-pick">
          <p class="eyebrow">Top Pump</p>
          <h4>${topPump ? topPump.symbol : "--"}</h4>
          <p class="muted-copy">${topPump ? `${formatNumber(topPump.changePercent, 2)}% move with ${formatUsdt(topPump.turnover24h)} turnover.` : "Waiting for market data."}</p>
          <p class="muted-copy">${buildAiTradingHint(topPump, "pump")}</p>
        </div>
        <div class="ai-pick dip">
          <p class="eyebrow">Top Dip</p>
          <h4>${topDip ? topDip.symbol : "--"}</h4>
          <p class="muted-copy">${topDip ? `${formatNumber(topDip.changePercent, 2)}% move with ${formatUsdt(topDip.turnover24h)} turnover.` : "Waiting for market data."}</p>
          <p class="muted-copy">${buildAiTradingHint(topDip, "dip")}</p>
        </div>
      </div>
    </section>
  `;
}

function getPendingOrderRemainingQuantity(order) {
  const origQty = Number(order.origQty || 0);
  const executedQty = Number(order.executedQty || 0);
  return Math.max(origQty - executedQty, 0) || origQty;
}

function renderPendingOrderDisclosure(order, options = {}) {
  const { showCancel = false } = options;
  const currentPrice = Number(getTradeCurrentMarket(order.symbol).price || 0);
  const remainingQty = getPendingOrderRemainingQuantity(order);
  const entryPrice = Number(order.rawPrice || order.price || 0);
  const pnlPercent = entryPrice && currentPrice
    ? ((currentPrice - entryPrice) / entryPrice) * 100 * (order.side === "SELL" ? -1 : 1)
    : 0;
  const isExpanded = state.expandedPendingOrderIds.includes(order.orderId);
  const canCancel = showCancel && ACTIVE_API_ORDER_STATUSES.has(String(order.status || "").toUpperCase());

  return `
    <details class="trade-disclosure trade-row-rich" data-pending-order-id="${order.orderId}" data-trade-symbol-row="${order.symbol}" data-trade-entry="${entryPrice}" data-trade-side="${order.side}" data-trade-quantity="${remainingQty}" ${isExpanded ? "open" : ""}>
      <summary class="trade-summary-row">
        <div>
          <strong>${order.symbol}</strong>
          <p class="muted-copy">${order.side} ${order.type} | Remaining ${formatNumber(remainingQty, 8)}</p>
        </div>
        <div class="asset-values">
          ${renderTradeStatusBadge("PENDING")}
          <strong class="${pnlPercent >= 0 ? "positive" : "negative"}" data-trade-pnl>${pnlPercent >= 0 ? "+" : ""}${formatNumber(pnlPercent, 2)}%</strong>
        </div>
      </summary>
      <div class="trade-disclosure-body">
        <div class="trade-detail-grid">
          <div class="trade-detail-pill">
            <span>Order ID</span>
            <strong>${String(order.orderId || "").slice(-8) || "--"}</strong>
          </div>
          <div class="trade-detail-pill">
            <span>Original Qty</span>
            <strong>${formatNumber(order.origQty, 8)}</strong>
          </div>
          <div class="trade-detail-pill">
            <span>Filled Qty</span>
            <strong>${formatNumber(order.executedQty, 8)}</strong>
          </div>
        </div>
        <div class="trade-detail-lines">
          <p class="muted-copy trade-meta-line" data-trade-entry>Entry ${entryPrice ? formatNumber(entryPrice, 8) : "Market"}</p>
          <p class="muted-copy trade-meta-line" data-trade-current>Current ${currentPrice ? formatNumber(currentPrice, 8) : "-"}</p>
          <p class="muted-copy">Live value <span data-trade-current-value>${formatUsdtUnit(remainingQty * currentPrice)}</span></p>
          <p class="muted-copy">Time in force ${order.timeInForce || "Exchange default"}</p>
          <p class="muted-copy">Status ${order.status || "NEW"}</p>
        </div>
        ${
          canCancel
            ? `
              <div class="trade-actions-inline trade-actions-stack reveal-actions">
                <button class="micro-btn danger" data-cancel-open-order="${order.orderId}" data-order-symbol="${order.symbol}" type="button">Cancel order</button>
              </div>
            `
            : ""
        }
      </div>
    </details>
  `;
}

function renderOpenOrdersSection() {
    const openTrades = state.trades.filter(isTradeStrictlyOpen).slice(0, 5);
    const openOrders = (state.openOrders || []).slice(0, 5);
    const canManageTrades = state.user?.role === "admin";
    return `
      <section class="mobile-card split-card${loadingClass(state.loadingTrades)}">
        ${state.loadingTrades ? renderSectionLoadingOverlay("Loading trades", "Checking your open trades and orders") : ""}
        <div>
        <div class="section-head">
          <div>
            <h3>Open Trades</h3>
            <p class="muted-copy">Live spot positions you are managing.</p>
          </div>
        </div>
        <div class="compact-list">
            ${openTrades
              .map(
                (trade) => {
                  const pnlPercent = getTradePnlPercent(trade);
                  const currentValue = getTradeCurrentValue(trade);
                  const currentPrice = Number(getTradeCurrentMarket(trade.symbol).price || 0);
                  const targetPrice = trade.takeProfitTargetPrice || "";
                  const targetPnl = getTradeTpPnlPercent(trade, targetPrice);
                  const isExpanded = state.expandedTradeIds.includes(trade.id);
                  return `
                    <details class="trade-disclosure trade-row-rich" data-trade-id="${trade.id}" data-trade-symbol-row="${trade.symbol}" data-trade-entry="${getTradeEntryPrice(trade)}" data-trade-side="${trade.side}" data-trade-quantity="${getTradeRemainingQuantity(trade)}" ${isExpanded ? "open" : ""}>
                      <summary class="trade-summary-row">
                        <div>
                          <strong>${trade.symbol}</strong>
                          <p class="muted-copy" data-trade-current-value>${formatUsdtUnit(currentValue)}</p>
                        </div>
                        <div class="asset-values">
                          ${renderTradeStatusBadge(trade.lifecycleStatus)}
                          <strong class="${pnlPercent >= 0 ? "positive" : "negative"}" data-trade-pnl>${pnlPercent >= 0 ? "+" : ""}${formatNumber(pnlPercent, 2)}%</strong>
                        </div>
                      </summary>
                      <div class="trade-disclosure-body">
                        <div class="trade-detail-grid">
                          <div class="trade-detail-pill">
                            <span>Side</span>
                            <strong>${trade.side}</strong>
                          </div>
                          <div class="trade-detail-pill">
                            <span>Type</span>
                            <strong>${trade.type}</strong>
                          </div>
                          <div class="trade-detail-pill">
                            <span>Quantity</span>
                            <strong>${formatNumber(getTradeRemainingQuantity(trade), 8)}</strong>
                          </div>
                        </div>
                        <div class="trade-detail-lines">
                          <p class="muted-copy trade-meta-line" data-trade-entry>Entry ${getTradeEntryPrice(trade) ? formatNumber(getTradeEntryPrice(trade), 8) : "Market"}</p>
                          <p class="muted-copy trade-meta-line" data-trade-current>Current ${currentPrice ? formatNumber(currentPrice, 8) : "-"}</p>
                          <p class="muted-copy">Live value <span data-trade-current-value>${formatUsdtUnit(currentValue)}</span></p>
                          ${
                            targetPrice
                              ? `<p class="muted-copy">TP ${formatNumber(targetPrice, 8)} <span class="${targetPnl >= 0 ? "positive" : "negative"}">${targetPnl >= 0 ? "+" : ""}${formatNumber(targetPnl, 2)}%</span></p>`
                              : `<p class="muted-copy">TP not set yet.</p>`
                          }
                        </div>
                        ${
                          canManageTrades
                            ? `
                              <div class="trade-actions-inline trade-actions-stack reveal-actions">
                                <button class="micro-btn" data-sell-trade="${trade.id}" type="button">Sell</button>
                                <button class="micro-btn primary" data-tp-trade="${trade.id}" type="button">TP</button>
                              </div>
                            `
                            : ""
                        }
                      </div>
                    </details>
                  `;
                }
              )
            .join("") || `<p class="muted-copy">No open trades yet.</p>`}
        </div>
      </div>
      <div>
        <div class="section-head">
          <div>
            <h3>Open Orders</h3>
            <p class="muted-copy">Live ${getExchangeLabel(getActiveExchange())} orders that are still waiting to fill.</p>
          </div>
        </div>
        <div class="compact-list">
          ${openOrders.map((order) => renderPendingOrderDisclosure(order, { showCancel: true })).join("") || `<p class="muted-copy">No open orders.</p>`}
        </div>
      </div>
    </section>
  `;
}

function renderSettingsPane() {
  const settingsDraft = state.settingsDraft || { apiKey: "", apiSecret: "", testnet: "false" };
  const activeExchange = getActiveExchange();
  const activeExchangeLabel = getExchangeLabel(activeExchange);
  return `
      <section class="mobile-card">
        <div class="section-head">
          <div>
            <h3>Appearance</h3>
            <p class="muted-copy">Light mode is default. Switch the whole app anytime.</p>
          </div>
        </div>
        <div class="theme-toggle">
          <button class="theme-btn ${state.theme === "light" ? "active" : ""}" data-theme-mode="light" type="button">Light</button>
          <button class="theme-btn ${state.theme === "dark" ? "active" : ""}" data-theme-mode="dark" type="button">Dark</button>
        </div>
      </section>
      <section class="mobile-card${loadingClass(state.loadingUsers)}">
        ${state.loadingUsers ? renderSectionLoadingOverlay("Loading users", "Pulling linked account details") : ""}
        <div class="section-head">
          <div>
            <h3>Exchange Connection</h3>
          <p class="muted-copy">Choose the active exchange for this dashboard, then connect its API keys.</p>
        </div>
      </div>
      <form id="exchange-select-form" class="stack-form subtle-form">
        <label>
          Active exchange
          <select name="exchange">
            ${EXCHANGE_OPTIONS.map((exchange) => `<option value="${exchange.id}" ${activeExchange === exchange.id ? "selected" : ""}>${exchange.label}</option>`).join("")}
          </select>
        </label>
      </form>
      <form id="exchange-connect-form" class="stack-form">
        <input type="hidden" name="exchange" value="${activeExchange}" />
        <label>API key <input name="apiKey" value="${escapeHtml(settingsDraft.apiKey)}" placeholder="Paste ${activeExchangeLabel} API key" required /></label>
        <label>API secret <input name="apiSecret" type="password" value="${escapeHtml(settingsDraft.apiSecret)}" placeholder="Paste ${activeExchangeLabel} API secret" required /></label>
        <label>
          Environment
          <select name="testnet">
            <option value="false" ${settingsDraft.testnet !== "true" ? "selected" : ""}>Mainnet</option>
            <option value="true" ${settingsDraft.testnet === "true" ? "selected" : ""}>Testnet</option>
          </select>
        </label>
        <button class="button-primary shimmer-button" type="submit">Connect ${activeExchangeLabel}</button>
      </form>
        ${
          state.user.role === "user"
            ? `
              <form id="mirror-form" class="stack-form subtle-form">
              <label>
                Mirror admin spot trades
                <select name="enabled">
                  <option value="true" ${state.user.mirrorEnabled ? "selected" : ""}>Enabled</option>
                  <option value="false" ${!state.user.mirrorEnabled ? "selected" : ""}>Disabled</option>
                </select>
              </label>
              <button class="button-secondary shimmer-button" type="submit">Save preference</button>
            </form>
            `
            : ""
        }
      </section>
      <section class="mobile-card">
        <div class="section-head">
          <div>
            <h3>${state.user.role === "admin" ? "Mirrored Users" : "Account Summary"}</h3>
            <p class="muted-copy">${state.user.role === "admin" ? "Grouped here to keep the navigation simple." : "Your linked account and mirror status."}</p>
          </div>
        </div>
        <div class="card-list">
          ${
            state.user.role === "admin"
              ? state.users
                  .map(
                    (user) => `
                      <div class="asset-card">
                        <div>
                          <strong>${user.name}</strong>
                          <p class="muted-copy">${user.email}</p>
                        </div>
                        <div class="asset-values">
                          <strong>${user.exchangeConnected ? `${getExchangeLabel(user.activeExchange)} linked` : "No exchange linked"}</strong>
                          <p class="muted-copy">${user.mirrorEnabled ? "Mirror active" : "Mirror off"} | Bybit ${user.bybitConnected ? "on" : "off"} | Binance ${user.binanceConnected ? "on" : "off"}</p>
                        </div>
                      </div>
                    `
                  )
                  .join("") || `<p class="muted-copy">No users linked yet.</p>`
              : `
                <div class="asset-card">
                  <div>
                    <strong>${state.user.name}</strong>
                    <p class="muted-copy">${state.user.email}</p>
                  </div>
                  <div class="asset-values">
                    <strong>${state.user.exchangeConnected ? `${activeExchangeLabel} linked` : `No ${activeExchangeLabel} linked`}</strong>
                    <p class="muted-copy">${state.user.mirrorEnabled ? "Mirroring enabled" : "Mirroring disabled"}</p>
                  </div>
                </div>
              `
          }
        </div>
      </section>
      <section class="mobile-card">
        <div class="section-head">
          <div>
            <h3>Support</h3>
            <p class="muted-copy">Contact and session actions grouped inside settings.</p>
          </div>
        </div>
        <div class="contact-card">
          <p><strong>Email:</strong> support@trade.local</p>
          <p><strong>Desk hours:</strong> 09:00 - 18:00</p>
          <p><strong>Mode:</strong> Crypto spot operations only</p>
          <button id="logout-btn" class="button-secondary shimmer-button" type="button">Logout</button>
        </div>
      </section>
    `;
}

function renderSignalsPane() {
  return `
    <div data-ai-signal-host>${renderAiSignalCard()}</div>
    ${renderWatchlistSection()}
  `;
}

function renderHistoryContent() {
  const trades = getHistoryTrades();
  const canClearHistory = state.user?.role === "admin";
  return `
    <div class="card-list">
      <section class="mobile-card">
        <div class="section-head">
          <div>
            <h3>Pending Orders</h3>
            <p class="muted-copy">All live exchange orders still waiting to fill or cancel.</p>
          </div>
        </div>
        <div class="compact-list">
          ${(state.openOrders || []).map((order) => renderPendingOrderDisclosure(order, { showCancel: true })).join("") || `<p class="muted-copy">No pending orders right now.</p>`}
        </div>
      </section>
      <section class="mobile-card">
        <div class="section-head">
          <div>
            <h3>Trade Timeline</h3>
            <p class="muted-copy">Open, pending, canceled, and closed trades all stay visible here.</p>
          </div>
        </div>
      ${trades
        .map((trade) => {
          const canSelectTrade = canClearHistory && isTradeClearableFromHistory(trade);
          const entryPrice = getTradeEntryPrice(trade);
          const currentPrice = Number(getTradeCurrentMarket(trade.symbol).price || 0);
          const remainingQuantity = getTradeRemainingQuantity(trade);
          const currentValue = (remainingQuantity || getTradeExecutedQuantity(trade)) * currentPrice;
          const pnlPercent = entryPrice && currentPrice ? getTradePnlPercent(trade) : 0;
          return `
            <div class="asset-card history-row" data-trade-symbol-row="${trade.symbol}" data-trade-entry="${entryPrice}" data-trade-side="${trade.side}" data-trade-quantity="${remainingQuantity || getTradeExecutedQuantity(trade)}">
              ${
                canClearHistory
                  ? `
                    <label class="history-checkbox">
                      <input type="checkbox" data-history-trade-id="${trade.id}" ${
                        state.selectedHistoryTradeIds.includes(trade.id) ? "checked" : ""
                      } ${canSelectTrade ? "" : "disabled"} />
                      <span></span>
                    </label>
                  `
                  : ""
              }
              <div>
                <strong>${trade.symbol}</strong>
                <p class="muted-copy">${trade.side} ${trade.type} | ${new Date(trade.createdAt).toLocaleString()}</p>
                <p class="muted-copy trade-meta-line" data-trade-current>Current ${currentPrice ? formatNumber(currentPrice, 8) : "-"}</p>
                <p class="muted-copy">Live value <span data-trade-current-value>${formatUsdtUnit(currentValue)}</span></p>
              </div>
              <div class="asset-values">
                ${renderTradeStatusBadge(trade.lifecycleStatus)}
                <strong class="${pnlPercent >= 0 ? "positive" : "negative"}" data-trade-pnl>${pnlPercent >= 0 ? "+" : ""}${formatNumber(pnlPercent, 2)}%</strong>
                <p class="muted-copy trade-meta-line" data-trade-entry>Entry ${entryPrice ? formatNumber(entryPrice, 8) : "Market"}</p>
              </div>
            </div>
          `;
        })
        .join("") || `<p class="muted-copy">No trade history yet.</p>`}
      </section>
    </div>
  `;
}

function renderHistoryPane() {
  const trades = getHistoryTrades();
  const clearableTrades = trades.filter(isTradeClearableFromHistory);
  const canClearHistory = state.user?.role === "admin";
  const selectedCount = state.selectedHistoryTradeIds.length;
  const allSelected = !!clearableTrades.length && selectedCount === clearableTrades.length;
  return `
    <section class="mobile-card${loadingClass(state.loadingTrades)}">
      ${state.loadingTrades ? renderSectionLoadingOverlay("Loading history", "Syncing your saved trade timeline") : ""}
      <div class="section-head">
        <div>
          <h3>Trade History</h3>
          <p class="muted-copy">Recent spot trades and execution state.</p>
        </div>
      </div>
      ${
        canClearHistory
          ? `
            <div class="history-toolbar">
              <p class="muted-copy">${
                selectedCount
                  ? `${selectedCount} selected for clearing.`
                  : clearableTrades.length
                    ? "Select saved trades to clear them."
                    : "Open and pending trades stay protected here."
              }</p>
              <div class="history-toolbar-actions">
                <button id="history-select-all-btn" class="text-link" type="button">${
                  allSelected ? "Clear selection" : "Select all"
                }</button>
                <button id="history-clear-btn" class="mini-action danger" type="button" ${
                  selectedCount ? "" : "disabled"
                }>Clear selected</button>
              </div>
            </div>
          `
          : ""
      }
      <div data-history-host>${renderHistoryContent()}</div>
    </section>
  `;
}

function renderHomePane() {
    return `
      ${renderSummaryCard()}
      ${state.user.role === "admin" ? renderTradeTicket() : ""}
      ${renderBalancesSection()}
      <div data-home-trades-host>${renderOpenOrdersSection()}</div>
    `;
}

function renderDashboardShell() {
  const paneMap = {
    home: renderHomePane(),
    settings: renderSettingsPane(),
    signals: renderSignalsPane(),
    history: renderHistoryPane(),
  };

  app.innerHTML = `
    <section class="app-shell">
      <section class="app-screen">
        ${paneMap[state.activeTab] || paneMap.home}
      </section>
      ${renderBottomNav()}
    </section>
    ${renderNotice()}
    ${renderErrorModal()}
    ${renderActionModal()}
    ${renderLoader()}
  `;

  bindDashboardActions();
  bindModalActions();
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextTab = button.dataset.tab;
      if (nextTab === "home") {
        state.activeTab = "home";
        render();
        await withLoading(loadDashboardData);
        showNotice("Home refreshed");
        return;
      }
      state.activeTab = nextTab;
      render();
    });
  });
}

function bindDashboardActions() {
  bindHistoryActions();

  const exchangeSelectForm = document.getElementById("exchange-select-form");
  if (exchangeSelectForm) {
    const exchangeSelect = exchangeSelectForm.querySelector('select[name="exchange"]');
    if (exchangeSelect) {
      exchangeSelect.addEventListener("change", async () => {
        await withLoading(async () => {
          const result = await api("/api/users/preferred-exchange", {
            method: "POST",
            body: JSON.stringify({ exchange: exchangeSelect.value }),
          });
          state.user = result.user;
          setSelectedExchange(state.user.activeExchange || exchangeSelect.value);
          state.settingsDraft = {
            apiKey: "",
            apiSecret: "",
            testnet: "false",
          };
          await loadDashboardData();
          showNotice(`${getExchangeLabel(getActiveExchange())} is now active`);
        }).catch((error) => showError(error.message));
      });
    }
  }

  const connectForm = document.getElementById("exchange-connect-form");
  if (connectForm) {
    connectForm.querySelectorAll("input, select").forEach((field) => {
      field.addEventListener("input", () => {
        state.settingsDraft = {
          ...state.settingsDraft,
          [field.name]: field.value,
        };
      });
      field.addEventListener("change", () => {
        state.settingsDraft = {
          ...state.settingsDraft,
          [field.name]: field.value,
        };
      });
    });

    connectForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await withLoading(async () => {
        const data = Object.fromEntries(new FormData(connectForm).entries());
        const result = await api("/api/exchange/connect", {
          method: "POST",
          body: JSON.stringify({
            exchange: data.exchange || getActiveExchange(),
            apiKey: data.apiKey,
            apiSecret: data.apiSecret,
            testnet: data.testnet === "true",
          }),
        });
        state.user = result.user;
        setSelectedExchange(state.user.activeExchange || data.exchange || getActiveExchange());
        state.settingsDraft = {
          apiKey: "",
          apiSecret: "",
          testnet: "false",
        };
        await loadDashboardData();
        showNotice(`${getExchangeLabel(getActiveExchange())} connected successfully`);
      }).catch((error) => showError(error.message));
    });
  }

  const mirrorForm = document.getElementById("mirror-form");
  if (mirrorForm) {
    mirrorForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await withLoading(async () => {
        const data = Object.fromEntries(new FormData(mirrorForm).entries());
        const result = await api("/api/users/mirror", {
          method: "POST",
          body: JSON.stringify({ enabled: data.enabled === "true" }),
        });
        state.user = result.user;
        render();
        showNotice("Mirror preference updated");
      }).catch((error) => showError(error.message));
    });
  }

  const balancesToggle = document.getElementById("toggle-balances-btn");
  if (balancesToggle) {
    balancesToggle.addEventListener("click", () => {
      state.showAllBalances = !state.showAllBalances;
      render();
    });
  }

  const watchlistToggle = document.getElementById("toggle-watchlist-btn");
  if (watchlistToggle) {
    watchlistToggle.addEventListener("click", () => {
      state.showAllWatchlist = !state.showAllWatchlist;
      render();
    });
  }

  const depositButton = document.getElementById("netrue-deposit-btn");
  if (depositButton) {
    depositButton.addEventListener("click", () => showActionModal({ type: "deposit" }));
  }

  const withdrawButton = document.getElementById("netrue-withdraw-btn");
  if (withdrawButton) {
    withdrawButton.addEventListener("click", () => showActionModal({ type: "withdraw" }));
  }

  const walletSubmitButton = document.getElementById("wallet-submit-btn");
  if (walletSubmitButton) {
    walletSubmitButton.addEventListener("click", () => {
      const mode = walletSubmitButton.dataset.walletMode || "deposit";
      const amount = document.getElementById("wallet-amount-input")?.value?.trim();
      const name = document.getElementById("wallet-name-input")?.value?.trim();
      const email = document.getElementById("wallet-email-input")?.value?.trim();

      if (!amount || Number(amount) <= 0) {
        showError("Enter a valid NGN amount.");
        return;
      }
      if (!name || !email) {
        showError("Name and email are required.");
        return;
      }

      if (mode === "withdraw") {
        const bank = document.getElementById("wallet-bank-input")?.value?.trim();
        const account = document.getElementById("wallet-account-input")?.value?.trim();
        if (!bank || !account) {
          showError("Bank name and account number are required for withdrawals.");
          return;
        }
      }

      clearActionModal();
      showNotice(`${mode === "deposit" ? "Deposit" : "Withdrawal"} form captured and ready for Paystack hookup`);
    });
  }

  document.querySelectorAll("[data-theme-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.theme = button.dataset.themeMode;
      applyTheme();
      render();
      showNotice(`${state.theme === "dark" ? "Dark" : "Light"} mode enabled`);
    });
  });

  const logoutButton = document.getElementById("logout-btn");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      disconnectWatchSocket();
      stopTradeRefreshTimer();
      state.user = null;
      state.activeTab = "home";
      state.actionModal = null;
      state.balances = [];
      state.openOrders = [];
      state.trades = [];
      state.users = [];
      state.totalUsdt = 0;
      state.totalNgn = 0;
      state.usdtNgnRate = 0;
      state.estimatedPnlValue = 0;
      state.estimatedPnlPercent = 0;
      state.tradeMarketMap = {};
      state.expandedTradeIds = [];
      state.expandedPendingOrderIds = [];
      state.selectedHistoryTradeIds = [];
      state.showSplash = false;
      tradeDraft = getTradeFormDefaults();
      render();
    });
  }
}

function updateTradeDraft(patch) {
  tradeDraft = {
    ...tradeDraft,
    ...patch,
  };
}

function applyAllocation(percent) {
  const summary = getCurrentTradeSummary();
  if (tradeDraft.side === "BUY") {
    const budget = summary.usdtBalance * (percent / 100);
    const price = Number(tradeDraft.price || summary.live.price || 0);
    if (price) {
      updateTradeDraft({
        quantity: String(budget / price),
        quoteOrderQty: "",
      });
    }
  } else {
    updateTradeDraft({
      quantity: String(summary.baseBalance * (percent / 100)),
      quoteOrderQty: "",
    });
  }
  render();
}

function bumpField(field, direction) {
  const summary = getCurrentTradeSummary();
  const current = Number(tradeDraft[field] || 0);
  const priceStep = Math.max(Number(summary.live.price || 0) * 0.01, 0.00000001);
  const qtyStep = Math.max((summary.baseBalance || 1) * 0.05, 1);
  const step = field === "price" ? priceStep : qtyStep;
  const next = Math.max(current + step * direction, 0);
  updateTradeDraft({ [field]: next ? String(next) : "" });
  render();
}

async function submitTrade() {
  const payload = {
    symbol: tradeDraft.symbol,
    side: tradeDraft.side,
    type: tradeDraft.type,
    quantity: tradeDraft.quantity,
    quoteOrderQty: tradeDraft.type === "MARKET" ? tradeDraft.quoteOrderQty : "",
    price: tradeDraft.type === "LIMIT" ? tradeDraft.price : "",
    takeProfitPrice: tradeDraft.takeProfitPrice,
  };

  await withLoading(async () => {
    await api("/api/trades", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    tradeDraft = getTradeFormDefaults();
    await loadDashboardData();
    showNotice("Spot trade placed");
  }).catch((error) => showError(error.message));
}

function submitQuickTakeProfit(tradeId) {
  const trade = state.trades.find((item) => item.id === tradeId);
  if (!trade) {
    showError("Trade not found.");
    return;
  }
  const fallbackPrice = Number(getTradeCurrentMarket(trade.symbol)?.price || 0);
  showActionModal({
    type: "tp",
    tradeId,
    targetPrice: trade.takeProfitTargetPrice || (fallbackPrice ? String(fallbackPrice) : ""),
  });
}

async function submitQuickSell(tradeId) {
  await withLoading(async () => {
    const payload = await api(`/api/trades/${tradeId}/sell-preview`);
    showActionModal({
      type: "sell",
      tradeId,
      preview: payload.preview || null,
    });
  }).catch((error) => showError(error.message));
}

async function confirmTakeProfit(tradeId) {
  const price = document.getElementById("tp-modal-input")?.value?.trim();
  if (!price) {
    showError("Take-profit price is required.");
    return;
  }
  await withLoading(async () => {
    await api(`/api/trades/${tradeId}/take-profit`, {
      method: "POST",
      body: JSON.stringify({ price }),
    });
    clearActionModal();
    await loadDashboardData();
    showNotice("Take profit updated");
  }).catch((error) => showError(error.message));
}

async function confirmMarketSell(tradeId) {
  await withLoading(async () => {
    await api(`/api/trades/${tradeId}/sell`, {
      method: "POST",
      body: JSON.stringify({ type: "MARKET" }),
    });
    clearActionModal();
    await loadDashboardData();
    showNotice("Trade closed at market price");
  }).catch((error) => showError(error.message));
}

async function cancelPendingOrder(orderId, symbol) {
  await withLoading(async () => {
    await api(`/api/exchange/open-orders/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ symbol, exchange: getActiveExchange() }),
    });
    await loadDashboardData();
    showNotice(`Order ${String(orderId).slice(-8)} canceled`);
  }).catch((error) => showError(error.message));
}

function bindTradeTicketActions() {
  const symbolInput = document.getElementById("trade-symbol");
  const typeInput = document.getElementById("trade-type");
  const priceInput = document.getElementById("trade-price");
  const quantityInput = document.getElementById("trade-quantity");
  const totalInput = document.getElementById("trade-total");
  const takeProfitInput = document.getElementById("trade-tp");
  const submitButton = document.getElementById("trade-submit-btn");
  const bboButton = document.getElementById("use-live-price-btn");

  if (symbolInput) symbolInput.addEventListener("change", () => { updateTradeDraft({ symbol: symbolInput.value }); render(); });
  if (symbolInput) symbolInput.addEventListener("input", () => { updateTradeDraft({ symbol: symbolInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }); });
  if (typeInput) typeInput.addEventListener("change", () => { updateTradeDraft({ type: typeInput.value }); render(); });
  if (priceInput) priceInput.addEventListener("input", () => updateTradeDraft({ price: priceInput.value, quoteOrderQty: "" }));
  if (quantityInput) quantityInput.addEventListener("input", () => updateTradeDraft({ quantity: quantityInput.value, quoteOrderQty: "" }));
  if (totalInput) totalInput.addEventListener("input", () => {
    if (tradeDraft.type === "MARKET") {
      updateTradeDraft({ quoteOrderQty: totalInput.value });
    } else {
      const summary = getCurrentTradeSummary();
      const total = Number(totalInput.value || 0);
      const price = Number(tradeDraft.price || summary.live.price || 0);
      updateTradeDraft({ quantity: price ? String(total / price) : tradeDraft.quantity });
    }
  });
  if (takeProfitInput) takeProfitInput.addEventListener("input", () => updateTradeDraft({ takeProfitPrice: takeProfitInput.value }));
  if (submitButton) submitButton.addEventListener("click", submitTrade);
  if (bboButton) bboButton.addEventListener("click", () => {
    const live = getSymbolData(tradeDraft.symbol);
    updateTradeDraft({ price: live.price ? String(live.price) : tradeDraft.price });
    render();
  });

  document.querySelectorAll("[data-side]").forEach((button) => {
    button.addEventListener("click", () => {
      updateTradeDraft({ side: button.dataset.side });
      render();
    });
  });

  document.querySelectorAll("[data-alloc]").forEach((button) => {
    button.addEventListener("click", () => applyAllocation(Number(button.dataset.alloc)));
  });

  document.querySelectorAll("[data-step-field]").forEach((button) => {
    button.addEventListener("click", () => bumpField(button.dataset.stepField, Number(button.dataset.stepDir)));
  });

  bindTradeActionButtons();
}

function bindTradeActionButtons() {
  bindTradeDisclosureToggles();
  bindPendingOrderDisclosureToggles();

  document.querySelectorAll("[data-sell-trade]").forEach((button) => {
    button.onclick = () => submitQuickSell(button.dataset.sellTrade);
  });

  document.querySelectorAll("[data-tp-trade]").forEach((button) => {
    button.onclick = () => submitQuickTakeProfit(button.dataset.tpTrade);
  });

  document.querySelectorAll("[data-cancel-open-order]").forEach((button) => {
    button.onclick = () => cancelPendingOrder(button.dataset.cancelOpenOrder, button.dataset.orderSymbol);
  });
}

function bindTradeDisclosureToggles() {
  document.querySelectorAll("[data-trade-id]").forEach((details) => {
    details.ontoggle = () => {
      const tradeId = details.dataset.tradeId;
      if (!tradeId) {
        return;
      }

      if (details.open) {
        if (!state.expandedTradeIds.includes(tradeId)) {
          state.expandedTradeIds = [...state.expandedTradeIds, tradeId];
        }
        return;
      }

      state.expandedTradeIds = state.expandedTradeIds.filter((id) => id !== tradeId);
    };
  });
}

function bindPendingOrderDisclosureToggles() {
  document.querySelectorAll("[data-pending-order-id]").forEach((details) => {
    details.ontoggle = () => {
      const orderId = details.dataset.pendingOrderId;
      if (!orderId) {
        return;
      }

      if (details.open) {
        if (!state.expandedPendingOrderIds.includes(orderId)) {
          state.expandedPendingOrderIds = [...state.expandedPendingOrderIds, orderId];
        }
        return;
      }

      state.expandedPendingOrderIds = state.expandedPendingOrderIds.filter((id) => id !== orderId);
    };
  });
}

function render() {
  applyTheme();
  renderTopbarActions();
  if (!state.user) {
    renderLanding();
    refreshWatchlistDom();
    return;
  }
  renderDashboardShell();
  bindTradeTicketActions();
  refreshWatchlistDom();
  refreshTradeDom();
}

async function bootstrap() {
  applyTheme();
  beginLoading();
  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    if (state.user?.activeExchange) {
      setSelectedExchange(state.user.activeExchange);
    }
    if (state.user) {
      await loadDashboardData();
    } else {
      disconnectWatchSocket();
      stopTradeRefreshTimer();
      startSplashSequence();
    }
  } catch {
    state.user = null;
    disconnectWatchSocket();
    stopTradeRefreshTimer();
    startSplashSequence();
  } finally {
    endLoading();
  }
}

bootstrap();
