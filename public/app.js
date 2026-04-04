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
const STABLECOIN_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD"];
const KNOWN_QUOTE_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "EUR", "BRL", "TRY"];
const SIGNAL_INTERVAL_OPTIONS = ["15m", "1h", "1D"];
const SIGNAL_CHART_TYPES = [
  { id: "candles", label: "Candles" },
  { id: "line", label: "Line" },
];
const SPOT_MIRROR_GUIDANCE = {
  bybit: {
    referenceMinUsdt: 5,
    ruleLabel: "minOrderAmt / minOrderQty",
    copy: "Bybit checks the live symbol minimum amount and quantity before a mirror spot order is submitted.",
  },
  binance: {
    referenceMinUsdt: 10,
    ruleLabel: "MIN_NOTIONAL / NOTIONAL",
    copy: "Binance checks the live symbol notional and lot-size filters before a mirror spot order is submitted.",
  },
};

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
  previousTotalUsdt: 0,
  totalNgn: 0,
  usdtNgnRate: 0,
  todayPnlValue: 0,
  todayPnlPercent: 0,
  todayLabel: "",
  monthPnlValue: 0,
  monthPnlPercent: 0,
  monthLabel: "",
  estimatedPnlValue: 0,
  estimatedPnlPercent: 0,
  loadingWatchlist: false,
  loadingAccount: false,
  loadingTrades: false,
  loadingUsers: false,
  watchlistSeed: [],
  signalChart: {
    symbol: "",
    interval: "15m",
    chartType: "candles",
    candles: [],
    guidePrice: null,
    loading: false,
  },
  liveMap: {},
  tradeMarketMap: {},
  showAllBalances: false,
  showAllWatchlist: false,
  expandedTradeIds: [],
  expandedPendingOrderIds: [],
  expandedAdminUserIds: [],
  selectedHistoryTradeIds: [],
  adminPasswordDrafts: {},
  revealedAdminPasswordIds: [],
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

function normalizeUserPayload(user) {
  if (!user) {
    return null;
  }

  return {
    ...user,
    cachedAccountSnapshot: user.cachedAccountSnapshot || null,
    cachedAccountSnapshots: user.cachedAccountSnapshots || {},
  };
}

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
  return normalizeUserPayload(payload.user);
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

function getConnectedExchanges(user) {
  if (!user) {
    return [];
  }

  return EXCHANGE_OPTIONS.filter((exchange) => user[`${exchange.id}Connected`]);
}

function getSpotMirrorGuidance(exchange = getActiveExchange()) {
  return SPOT_MIRROR_GUIDANCE[exchange] || SPOT_MIRROR_GUIDANCE.bybit;
}

function getStablecoinBuyingBalance(balances = []) {
  return (balances || []).reduce((sum, balance) => {
    const asset = String(balance.asset || "").toUpperCase();
    if (!STABLECOIN_ASSETS.includes(asset)) {
      return sum;
    }
    return sum + Number(balance.free ?? balance.total ?? 0);
  }, 0);
}

function getDetectedSpotHoldings() {
  const activeTradeSymbols = new Set((state.trades || []).filter(isTradeStrictlyOpen).map((trade) => trade.symbol));
  const stableAssets = new Set(["USDT", "USDC", "FDUSD", "BUSD"]);

  return (state.balances || [])
    .filter(
      (balance) =>
        Number(balance.total || 0) > 0 &&
        !!balance.spotSellTradable &&
        !stableAssets.has(String(balance.asset || "").toUpperCase())
    )
    .map((balance) => {
      const symbol = `${String(balance.asset || "").toUpperCase()}USDT`;
      const total = Number(balance.total || 0);
      const derivedPrice = total ? Number(balance.usdtValue || 0) / total : 0;
      return {
        id: `external-${symbol}`,
        symbol,
        asset: balance.asset,
        quantity: total,
        currentPrice: Number(getTradeCurrentMarket(symbol).price || derivedPrice || 0),
        currentValue: Number(balance.usdtValue || 0),
        changePercent: Number(balance.changePercent || 0),
        exchange: getActiveExchange(),
        lifecycleStatus: "OPEN",
        external: true,
      };
    })
    .filter((holding) => !activeTradeSymbols.has(holding.symbol) && holding.currentValue > 0);
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
  if (!balance) {
    return false;
  }

  if (balance.spotSellTradable !== undefined) {
    return !!balance.spotSellTradable;
  }

  const totalBalance = balance.total !== undefined
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

function getInvestmentBalanceNgn() {
  return Number(state.totalNgn || 0);
}

function getInvestmentDailyReturnNgn() {
  return getInvestmentBalanceNgn() * 0.015;
}

function formatMonthLabel(monthKey) {
  const raw = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) {
    return "This Month";
  }
  const [year, month] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatDayLabel(dayKey) {
  return dayKey ? `Today (${dayKey} GMT)` : "Today";
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

function getSelectedSignalSymbol() {
  const selected = String(state.signalChart.symbol || "").trim().toUpperCase();
  if (selected) {
    return selected;
  }
  const { topPump, topDip } = getAiRecommendations();
  return topPump?.symbol || topDip?.symbol || "";
}

function buildSparklinePath(values, width, height, padding = 8) {
  if (!values.length) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = padding + (usableWidth * index) / Math.max(values.length - 1, 1);
      const y = padding + usableHeight - ((value - min) / range) * usableHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSignalChartGeometry(candles, width = 320, height = 180) {
  const padding = { top: 12, right: 12, bottom: 14, left: 12 };
  const usableWidth = width - padding.left - padding.right;
  const usableHeight = height - padding.top - padding.bottom;
  const highs = candles.map((item) => Number(item.high || item.close || 0)).filter((value) => Number.isFinite(value));
  const lows = candles.map((item) => Number(item.low || item.close || 0)).filter((value) => Number.isFinite(value));
  const minPrice = lows.length ? Math.min(...lows) : 0;
  const maxPrice = highs.length ? Math.max(...highs) : 0;
  const range = maxPrice - minPrice || Math.max(maxPrice * 0.02, 1);
  const paddedMin = minPrice - range * 0.08;
  const paddedMax = maxPrice + range * 0.08;
  const chartRange = paddedMax - paddedMin || 1;
  const candleStep = usableWidth / Math.max(candles.length, 1);
  const candleBodyWidth = Math.max(Math.min(candleStep * 0.56, 10), 3);
  const toX = (index) => padding.left + candleStep * index + candleStep / 2;
  const toY = (price) =>
    padding.top + usableHeight - ((Number(price || 0) - paddedMin) / chartRange) * usableHeight;

  return {
    width,
    height,
    padding,
    usableWidth,
    usableHeight,
    minPrice: paddedMin,
    maxPrice: paddedMax,
    candleStep,
    candleBodyWidth,
    toX,
    toY,
  };
}

function buildSignalLinePath(candles, geometry) {
  if (!candles.length) {
    return "";
  }

  return candles
    .map((candle, index) => {
      const x = geometry.toX(index);
      const y = geometry.toY(candle.close || 0);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildSignalCandleMarkup(candles, geometry) {
  return candles
    .map((candle, index) => {
      const open = Number(candle.open || 0);
      const close = Number(candle.close || 0);
      const high = Number(candle.high || close || open || 0);
      const low = Number(candle.low || close || open || 0);
      const x = geometry.toX(index);
      const wickTop = geometry.toY(high);
      const wickBottom = geometry.toY(low);
      const bodyTop = geometry.toY(Math.max(open, close));
      const bodyBottom = geometry.toY(Math.min(open, close));
      const bodyHeight = Math.max(bodyBottom - bodyTop, 1.5);
      const className = close >= open ? "positive" : "negative";
      return `
        <g class="signal-candle ${className}">
          <line x1="${x.toFixed(2)}" y1="${wickTop.toFixed(2)}" x2="${x.toFixed(2)}" y2="${wickBottom.toFixed(2)}" class="signal-candle-wick"></line>
          <rect
            x="${(x - geometry.candleBodyWidth / 2).toFixed(2)}"
            y="${Math.min(bodyTop, bodyBottom).toFixed(2)}"
            width="${geometry.candleBodyWidth.toFixed(2)}"
            height="${bodyHeight.toFixed(2)}"
            rx="1.5"
            class="signal-candle-body"
          ></rect>
        </g>
      `;
    })
    .join("");
}

function getSignalChartSummary(candles) {
  const first = candles[0] || null;
  const last = candles[candles.length - 1] || null;
  const highs = candles.map((item) => Number(item.high || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const lows = candles.map((item) => Number(item.low || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const currentPrice = Number(last?.close || 0);
  const openingPrice = Number(first?.open || first?.close || 0);
  return {
    currentPrice,
    highPrice: highs.length ? Math.max(...highs) : currentPrice,
    lowPrice: lows.length ? Math.min(...lows) : currentPrice,
    movePercent: openingPrice && currentPrice ? ((currentPrice - openingPrice) / openingPrice) * 100 : 0,
  };
}

function getSignalGuidePrice(candles) {
  const currentGuide = Number(state.signalChart.guidePrice || 0);
  if (currentGuide > 0) {
    return currentGuide;
  }
  return Number(candles[candles.length - 1]?.close || 0);
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

function getTradeExitExecutionSnapshot(exitOrder) {
  if (state.user?.role === "user") {
    return exitOrder?.mirroredExecution?.order || null;
  }
  return exitOrder?.adminExecution || null;
}

function getExecutionAveragePrice(execution, fallbackPrice = 0) {
  const directPrice = Number(execution?.price || 0);
  if (directPrice > 0) {
    return directPrice;
  }

  const executedQty = Number(execution?.executedQty || 0);
  const quoteQty = Number(execution?.cummulativeQuoteQty || 0);
  if (executedQty > 0 && quoteQty > 0) {
    return quoteQty / executedQty;
  }

  return Number(fallbackPrice || 0);
}

function getTradeStaticPnlPercent(trade) {
  const entry = getTradeEntryPrice(trade);
  if (!entry) {
    return 0;
  }

  if (trade.lifecycleStatus === "CANCELED") {
    return 0;
  }

  if (trade.lifecycleStatus !== "CLOSED") {
    return getTradePnlPercent(trade);
  }

  const filledExitExecutions = (trade.exitOrders || [])
    .map((exitOrder) => ({
      execution: getTradeExitExecutionSnapshot(exitOrder),
      fallbackPrice: Number(exitOrder?.price || 0),
    }))
    .filter(({ execution }) => ["FILLED", "PARTIALLY_FILLED"].includes(String(execution?.status || "").toUpperCase()));

  const totalExitQuantity = filledExitExecutions.reduce(
    (sum, { execution }) => sum + Number(execution?.executedQty || 0),
    0
  );
  const totalExitValue = filledExitExecutions.reduce((sum, { execution, fallbackPrice }) => {
    const qty = Number(execution?.executedQty || 0);
    const price = getExecutionAveragePrice(execution, fallbackPrice);
    return sum + qty * price;
  }, 0);

  const closePrice = totalExitQuantity > 0 && totalExitValue > 0
    ? totalExitValue / totalExitQuantity
    : getExecutionAveragePrice(
        state.user?.role === "user" ? trade.mirroredExecution?.order : trade.adminExecution,
        Number(trade.price || 0)
      );

  if (!closePrice) {
    return 0;
  }

  const multiplier = trade.side === "SELL" ? -1 : 1;
  return ((closePrice - entry) / entry) * 100 * multiplier;
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

  if (state.user || state.showSplash) {
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
        <p>Binance and Bybit spot dashboard access</p>
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
        state.user = normalizeUserPayload(await requireSessionUser());
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
        state.user = normalizeUserPayload(await requireSessionUser());
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
        state.user = normalizeUserPayload(await requireSessionUser());
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
  bindSignalCardActions();
}

function refreshSignalChartDom() {
  const host = document.querySelector("[data-signal-chart-host]");
  if (host) {
    host.innerHTML = renderSignalChartSection();
  }
  bindSignalChartActions();
}

async function loadSignalChart(symbol, options = {}) {
  const nextSymbol = String(symbol || "").trim().toUpperCase();
  if (!nextSymbol) {
    return;
  }

  if (!options.silent) {
    state.signalChart = {
      ...state.signalChart,
      symbol: nextSymbol,
      loading: true,
    };
    refreshSignalChartDom();
  }

  try {
    const payload = await api(
      `/api/market/chart?symbol=${encodeURIComponent(nextSymbol)}&interval=${encodeURIComponent(
        state.signalChart.interval || "15m"
      )}&limit=48`
    );
    const nextCandles = payload.candles || [];
    state.signalChart = {
      ...state.signalChart,
      symbol: nextSymbol,
      candles: nextCandles,
      guidePrice: Number(state.signalChart.guidePrice || 0) > 0 ? Number(state.signalChart.guidePrice) : getSignalGuidePrice(nextCandles),
      loading: false,
    };
  } catch {
    state.signalChart = {
      ...state.signalChart,
      symbol: nextSymbol,
      candles: [],
      guidePrice: null,
      loading: false,
    };
  }

  refreshSignalChartDom();
}

function bindSignalCardActions() {
  document.querySelectorAll("[data-signal-symbol]").forEach((button) => {
    button.onclick = () => {
      void loadSignalChart(button.dataset.signalSymbol);
    };
  });
}

function updateSignalGuideLine(price) {
  const chart = document.querySelector("[data-signal-chart-svg]");
  const line = document.querySelector("[data-signal-guide-line]");
  const pill = document.querySelector("[data-signal-guide-pill]");
  const current = document.querySelector("[data-signal-guide-price]");
  const guideChip = document.querySelector("[data-signal-guide-current]");
  const candles = state.signalChart.candles || [];
  if (!chart || !line || !pill || !current || !guideChip || !candles.length) {
    return;
  }

  const geometry = getSignalChartGeometry(candles);
  const clampedPrice = clampNumber(Number(price || 0), geometry.minPrice, geometry.maxPrice);
  const y = geometry.toY(clampedPrice);
  line.setAttribute("y1", y.toFixed(2));
  line.setAttribute("y2", y.toFixed(2));
  pill.setAttribute("y", Math.max(y - 10, 8).toFixed(2));
  current.textContent = formatNumber(clampedPrice, 8);
  guideChip.textContent = formatNumber(clampedPrice, 8);
  state.signalChart = {
    ...state.signalChart,
    guidePrice: clampedPrice,
  };
}

function bindSignalChartActions() {
  document.querySelectorAll("[data-signal-interval]").forEach((button) => {
    button.onclick = () => {
      const interval = button.dataset.signalInterval;
      if (!interval || interval === state.signalChart.interval) {
        return;
      }
      state.signalChart = {
        ...state.signalChart,
        interval,
      };
      refreshSignalChartDom();
      const symbol = getSelectedSignalSymbol();
      if (symbol) {
        void loadSignalChart(symbol);
      }
    };
  });

  document.querySelectorAll("[data-signal-chart-type]").forEach((button) => {
    button.onclick = () => {
      const chartType = button.dataset.signalChartType;
      if (!chartType || chartType === state.signalChart.chartType) {
        return;
      }
      state.signalChart = {
        ...state.signalChart,
        chartType,
      };
      refreshSignalChartDom();
    };
  });

  const surface = document.querySelector("[data-signal-drag-surface]");
  const svg = document.querySelector("[data-signal-chart-svg]");
  if (!surface || !svg || !(state.signalChart.candles || []).length) {
    return;
  }

  const updateFromPointer = (clientY) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.height) {
      return;
    }
    const geometry = getSignalChartGeometry(state.signalChart.candles || []);
    const relativeY = clampNumber(((clientY - rect.top) / rect.height) * geometry.height, geometry.padding.top, geometry.height - geometry.padding.bottom);
    const priceRatio = 1 - (relativeY - geometry.padding.top) / geometry.usableHeight;
    const price = geometry.minPrice + priceRatio * (geometry.maxPrice - geometry.minPrice);
    updateSignalGuideLine(price);
  };

  surface.onpointerdown = (event) => {
    event.preventDefault();
    surface.dataset.dragging = "true";
    if (surface.setPointerCapture) {
      surface.setPointerCapture(event.pointerId);
    }
    updateFromPointer(event.clientY);
  };

  surface.onpointermove = (event) => {
    if (surface.dataset.dragging !== "true") {
      return;
    }
    updateFromPointer(event.clientY);
  };

  const stopDragging = () => {
    delete surface.dataset.dragging;
  };

  surface.onpointerup = stopDragging;
  surface.onpointercancel = stopDragging;
  surface.onpointerleave = stopDragging;
}

function refreshTradeDom() {
  document.querySelectorAll("[data-trade-symbol-row]").forEach((row) => {
    const symbol = row.dataset.tradeSymbolRow;
    const entry = Number(row.dataset.tradeEntry || 0);
    const side = row.dataset.tradeSide || "BUY";
    const isStaticPnl = row.dataset.tradePnlStatic === "true";
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
    if (pnlNode && !isStaticPnl) {
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

function renderExchangeBadge(exchange) {
  const label = getExchangeLabel(exchange);
  return `<span class="exchange-badge exchange-${escapeHtml(exchange)}">${label}</span>`;
}

function renderExchangeBadgeList(exchanges) {
  const badges = exchanges.map((exchange) => renderExchangeBadge(exchange.id || exchange)).join("");
  return badges || `<span class="exchange-badge">No exchange</span>`;
}

function getAdminPasswordDraft(userId) {
  return state.adminPasswordDrafts[userId] || "";
}

function updateUserInStateUsers(nextUser) {
  state.users = state.users.map((user) => (user.id === nextUser.id ? { ...user, ...nextUser } : user));
}

async function refreshTradeStatusData() {
  if (!state.user) {
    return;
  }
  try {
    const payload = await api(`/api/trades?exchange=${encodeURIComponent(getActiveExchange())}`);
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
    ...getDetectedSpotHoldings().map((holding) => holding.symbol),
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
    state.watchlistSeed = (payload.watchlist || []).map((item) => ({
      ...item,
      changePercent: Number(item.changePercent ?? item.priceChangePercent ?? 0),
      price: Number(item.price || 0),
      volume24h: Number(item.volume24h || 0),
      turnover24h: Number(item.turnover24h || 0),
      bybitAiInsight: item.bybitAiInsight || "",
      bybitAiSource: item.bybitAiSource || "",
    }));
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
        changePercent: Number(item.changePercent ?? item.priceChangePercent ?? 0),
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
      const signalSymbol = getSelectedSignalSymbol();
      if (signalSymbol) {
        return loadSignalChart(signalSymbol, { silent: true });
      }
    })
    .catch(() => {
      state.watchlistSeed = [];
      hydrateWatchlistFromSeed();
      refreshWatchlistDom();
      refreshAiSignalDom();
      refreshSignalChartDom();
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
    state.previousTotalUsdt = Number(account.previousTotalUsdt || 0);
    state.totalNgn = Number(account.totalNgn || 0);
    state.usdtNgnRate = Number(account.usdtNgnRate || 0);
    state.todayPnlValue = Number(account.todayPnlValue || 0);
    state.todayPnlPercent = Number(account.todayPnlPercent || 0);
    state.todayLabel = String(account.todayLabel || "");
    state.monthPnlValue = Number(account.monthPnlValue || 0);
    state.monthPnlPercent = Number(account.monthPnlPercent || 0);
    state.monthLabel = String(account.monthLabel || "");
    state.estimatedPnlValue = Number(account.estimatedPnlValue || 0);
    state.estimatedPnlPercent = Number(account.estimatedPnlPercent || 0);
    return;
  }

  state.balances = [];
  state.openOrders = [];
  state.totalUsdt = 0;
  state.previousTotalUsdt = 0;
  state.totalNgn = 0;
  state.usdtNgnRate = 0;
  state.todayPnlValue = 0;
  state.todayPnlPercent = 0;
  state.todayLabel = "";
  state.monthPnlValue = 0;
  state.monthPnlPercent = 0;
  state.monthLabel = "";
  state.estimatedPnlValue = 0;
  state.estimatedPnlPercent = 0;
}

function getCachedAccountSnapshot(exchange = getActiveExchange()) {
  if (!state.user) {
    return null;
  }

  const snapshots = state.user.cachedAccountSnapshots || {};
  return snapshots[exchange] || state.user.cachedAccountSnapshot || null;
}

async function loadSavedExchangeSettings(exchange) {
  const targetExchange = exchange || getActiveExchange();
  if (!state.user) {
    state.settingsDraft = {
      apiKey: "",
      apiSecret: "",
      testnet: "false",
    };
    return;
  }

  try {
    const payload = await api(`/api/exchange/settings?exchange=${encodeURIComponent(targetExchange)}`);
    state.settingsDraft = {
      apiKey: payload.apiKey || "",
      apiSecret: payload.apiSecret || "",
      testnet: payload.testnet ? "true" : "false",
    };
  } catch {
    state.settingsDraft = {
      apiKey: "",
      apiSecret: "",
      testnet: "false",
    };
  }
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

  const settingsPromise = loadSavedExchangeSettings(getActiveExchange()).then(() => {
    render();
  });

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

  const cachedSnapshot = getCachedAccountSnapshot(getActiveExchange());
  applyAccountSnapshot(cachedSnapshot);
  const accountPromise = state.user.exchangeConnected
    ? api(`/api/exchange/account?exchange=${encodeURIComponent(getActiveExchange())}`)
        .then((account) => {
          applyAccountSnapshot(account);
          state.user = {
            ...state.user,
            cachedAccountSnapshot: account,
            cachedAccountSnapshots: {
              ...(state.user.cachedAccountSnapshots || {}),
              [account.exchange || getActiveExchange()]: account,
            },
          };
          state.loadingAccount = false;
          render();
        })
        .catch(() => {
          applyAccountSnapshot(cachedSnapshot);
          state.loadingAccount = false;
          render();
        })
    : Promise.resolve().then(() => {
        state.loadingAccount = false;
      });
  const tradesPromise = api(`/api/trades?exchange=${encodeURIComponent(getActiveExchange())}`);
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
  const adminUserIds = new Set(state.users.map((user) => user.id));
  state.expandedAdminUserIds = state.expandedAdminUserIds.filter((id) => adminUserIds.has(id));
  state.revealedAdminPasswordIds = state.revealedAdminPasswordIds.filter((id) => adminUserIds.has(id));
  syncHistorySelection();
  render();
  void refreshTradeMarketData();
  startTradeRefreshTimer();
  void accountPromise;
  void settingsPromise;
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

function bindAdminUserDisclosureToggles() {
  document.querySelectorAll("[data-admin-user-id]").forEach((details) => {
    details.ontoggle = () => {
      const userId = details.dataset.adminUserId;
      if (!userId) {
        return;
      }

      if (details.open) {
        if (!state.expandedAdminUserIds.includes(userId)) {
          state.expandedAdminUserIds = [...state.expandedAdminUserIds, userId];
        }
        return;
      }

      state.expandedAdminUserIds = state.expandedAdminUserIds.filter((id) => id !== userId);
    };
  });
}

function setAdminPasswordDraft(userId, value) {
  state.adminPasswordDrafts = {
    ...state.adminPasswordDrafts,
    [userId]: value,
  };
}

function toggleAdminPasswordVisibility(userId) {
  if (state.revealedAdminPasswordIds.includes(userId)) {
    state.revealedAdminPasswordIds = state.revealedAdminPasswordIds.filter((id) => id !== userId);
  } else {
    state.revealedAdminPasswordIds = [...state.revealedAdminPasswordIds, userId];
  }
  render();
}

async function submitAdminPasswordReset(userId) {
  const password = getAdminPasswordDraft(userId).trim();
  if (!password) {
    showError("Enter a new password for this user.");
    return;
  }

  await withLoading(async () => {
    const payload = await api(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    updateUserInStateUsers(payload.user);
    setAdminPasswordDraft(userId, "");
    await loadDashboardData();
    showNotice("User password updated");
  }).catch((error) => showError(error.message));
}

async function updateAdminMirror(userId, enabled) {
  await withLoading(async () => {
    const payload = await api(`/api/admin/users/${encodeURIComponent(userId)}/mirror`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    updateUserInStateUsers(payload.user);
    render();
    showNotice(enabled ? "Mirror reconnected for user" : "Mirror disconnected for user");
  }).catch((error) => showError(error.message));
}

async function deleteAdminUser(userId, name) {
  if (!window.confirm(`Delete ${name}? This removes the user account and signs the user out everywhere.`)) {
    return;
  }

  await withLoading(async () => {
    await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    state.users = state.users.filter((user) => user.id !== userId);
    state.expandedAdminUserIds = state.expandedAdminUserIds.filter((id) => id !== userId);
    const nextDrafts = { ...state.adminPasswordDrafts };
    delete nextDrafts[userId];
    state.adminPasswordDrafts = nextDrafts;
    state.revealedAdminPasswordIds = state.revealedAdminPasswordIds.filter((id) => id !== userId);
    await loadDashboardData();
    showNotice("User deleted");
  }).catch((error) => showError(error.message));
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
  const portfolioBalance = Number(state.totalUsdt || 0);
  const investmentBalance = getInvestmentBalanceNgn();
  const investmentDailyReturn = getInvestmentDailyReturnNgn();
  const accountLoading = state.loadingAccount;
  const exchangeLabel = getExchangeLabel(getActiveExchange());
  const todayPositive = Number(state.todayPnlValue || 0) >= 0;
  const monthPositive = Number(state.monthPnlValue || 0) >= 0;
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
            <p class="eyebrow light">Live Account Balance</p>
            <h2>${formatUsdt(portfolioBalance)}</h2>
            <div class="hero-return-tags">
              <span class="hero-chip ${todayPositive ? "positive" : "negative"}">Today's return ${todayPositive ? "+" : "-"}${formatUsdt(Math.abs(state.todayPnlValue || 0))} ${state.todayPnlPercent >= 0 ? "+" : ""}${formatNumber(state.todayPnlPercent, 2)}%</span>
              <span class="hero-chip ${monthPositive ? "positive" : "negative"}">${formatMonthLabel(state.monthLabel)} return ${monthPositive ? "+" : "-"}${formatUsdt(Math.abs(state.monthPnlValue || 0))} ${state.monthPnlPercent >= 0 ? "+" : ""}${formatNumber(state.monthPnlPercent, 2)}%</span>
            </div>
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
          ${accountLoading ? renderSectionLoadingOverlay("Loading investment view", "Pulling the latest NGN investment balance") : ""}
          <div>
            <p class="eyebrow light">Investment Balance</p>
            <h2>${investmentBalance > 0 ? formatNaira(investmentBalance) : "--"}</h2>
            <p class="muted-bright">Daily return 1.5%: ${investmentDailyReturn > 0 ? formatNaira(investmentDailyReturn) : "--"} every 24 hours.</p>
            <p class="muted-bright">Users will receive 1.5% daily on their saved money and can withdraw anytime.</p>
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
                    24h PnL ${Number(balance.changePercent || 0) >= 0 ? "+" : ""}${formatNumber(balance.changePercent, 2)}%
                    (${Number(balance.estimatedPnlValue || 0) >= 0 ? "+" : "-"}${formatUsdt(Math.abs(balance.estimatedPnlValue || 0))})
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
          <p class="muted-copy">Live price with true 24h move from ${getExchangeLabel(getActiveExchange())}.</p>
        </div>
        <button id="toggle-watchlist-btn" class="text-link" type="button">${state.showAllWatchlist ? "See less" : "See more"}</button>
      </div>
      <div class="compact-list" data-watchlist-host="dashboard">${renderWatchlistRows(watchlist)}</div>
    </section>
  `;
}

function getAiRecommendations() {
  const list = [...(state.watchlistSeed || [])]
    .map((item) => ({
      symbol: item.symbol,
      price: Number(item.price || 0),
      changePercent: Number(item.changePercent ?? item.priceChangePercent ?? 0),
      volume24h: Number(item.volume24h || 0),
      turnover24h: Number(item.turnover24h || 0),
      bybitAiInsight: item.bybitAiInsight || "",
      bybitAiSource: item.bybitAiSource || "",
    }))
    .filter((item) => item.price > 0);
  if (!list.length) {
    return { topPump: null, topDip: null };
  }

  const topPump = [...list].sort((a, b) => {
    const changeDiff = Number(b.changePercent || 0) - Number(a.changePercent || 0);
    return changeDiff || Number(b.turnover24h || 0) - Number(a.turnover24h || 0);
  })[0] || null;
  const topDip = [...list].sort((a, b) => {
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
          <h3>Bybit Market Pulse</h3>
          <p class="muted-copy">Top pump and top dip with live Bybit analysis layered on the active spot market read.</p>
        </div>
      </div>
      <div class="ai-grid">
        <div class="ai-pick">
          <p class="eyebrow">Top Pump</p>
          <h4>${topPump ? `<button class="signal-link" data-signal-symbol="${topPump.symbol}" type="button">${topPump.symbol}</button>` : "--"}</h4>
          <p class="muted-copy">${topPump ? `${formatNumber(topPump.changePercent, 2)}% move with ${formatUsdt(topPump.turnover24h)} turnover.` : "Waiting for market data."}</p>
          <p class="muted-copy">${topPump?.bybitAiInsight || buildAiTradingHint(topPump, "pump")}</p>
        </div>
        <div class="ai-pick dip">
          <p class="eyebrow">Top Dip</p>
          <h4>${topDip ? `<button class="signal-link" data-signal-symbol="${topDip.symbol}" type="button">${topDip.symbol}</button>` : "--"}</h4>
          <p class="muted-copy">${topDip ? `${formatNumber(topDip.changePercent, 2)}% move with ${formatUsdt(topDip.turnover24h)} turnover.` : "Waiting for market data."}</p>
          <p class="muted-copy">${topDip?.bybitAiInsight || buildAiTradingHint(topDip, "dip")}</p>
        </div>
      </div>
    </section>
  `;
}

function renderSignalChartSection() {
  const symbol = getSelectedSignalSymbol();
  const candles = state.signalChart.candles || [];
  const geometry = candles.length ? getSignalChartGeometry(candles) : null;
  const summary = candles.length ? getSignalChartSummary(candles) : null;
  const guidePrice = geometry ? clampNumber(getSignalGuidePrice(candles), geometry.minPrice, geometry.maxPrice) : 0;
  const guideY = geometry ? geometry.toY(guidePrice) : 0;
  const linePath = geometry ? buildSignalLinePath(candles, geometry) : "";
  const candleMarkup = geometry ? buildSignalCandleMarkup(candles, geometry) : "";

  return `
    <section class="mobile-card signal-chart-card${state.signalChart.loading ? " is-section-loading" : ""}">
      ${state.signalChart.loading ? renderSectionLoadingOverlay("Loading chart", "Pulling live candles from the active exchange") : ""}
      <div class="section-head">
        <div>
          <h3>Signal Chart</h3>
          <p class="muted-copy">${symbol ? `${symbol} ${state.signalChart.interval} live candles from ${getExchangeLabel(getActiveExchange())}.` : "Tap Top Pump or Top Dip to load a live chart."}</p>
        </div>
      </div>
      <div class="signal-toolbar">
        <div class="signal-segmented">
          ${SIGNAL_INTERVAL_OPTIONS.map((interval) => `
            <button class="signal-mini-btn ${state.signalChart.interval === interval ? "active" : ""}" data-signal-interval="${interval}" type="button">${interval}</button>
          `).join("")}
        </div>
        <div class="signal-segmented">
          ${SIGNAL_CHART_TYPES.map((chartType) => `
            <button class="signal-mini-btn ${state.signalChart.chartType === chartType.id ? "active" : ""}" data-signal-chart-type="${chartType.id}" type="button">${chartType.label}</button>
          `).join("")}
        </div>
      </div>
      ${
        symbol && geometry
          ? `
            <div class="signal-chart-shell">
              <svg viewBox="0 0 320 180" class="signal-chart" role="img" aria-label="${symbol} live chart" data-signal-chart-svg>
                <rect x="0" y="0" width="320" height="180" rx="18" class="signal-chart-backdrop"></rect>
                <line x1="${geometry.padding.left}" y1="${guideY.toFixed(2)}" x2="${(320 - geometry.padding.right).toFixed(2)}" y2="${guideY.toFixed(2)}" class="signal-guide-line" data-signal-guide-line></line>
                ${
                  state.signalChart.chartType === "line"
                    ? `<path d="${linePath}" class="signal-chart-line ${Number(summary?.movePercent || 0) >= 0 ? "positive" : "negative"}"></path>`
                    : candleMarkup
                }
                <rect x="0" y="0" width="320" height="180" rx="18" class="signal-drag-surface" data-signal-drag-surface></rect>
                <rect x="228" y="${Math.max(guideY - 10, 8).toFixed(2)}" width="84" height="20" rx="10" class="signal-guide-pill" data-signal-guide-pill></rect>
                <text x="270" y="${Math.max(guideY + 4, 22).toFixed(2)}" text-anchor="middle" class="signal-guide-text" data-signal-guide-price>${formatNumber(guidePrice, 8)}</text>
              </svg>
              <div class="signal-price-grid">
                <div class="signal-price-chip">
                  <span>Last</span>
                  <strong>${summary?.currentPrice ? formatNumber(summary.currentPrice, 8) : "--"}</strong>
                </div>
                <div class="signal-price-chip">
                  <span>High</span>
                  <strong>${summary?.highPrice ? formatNumber(summary.highPrice, 8) : "--"}</strong>
                </div>
                <div class="signal-price-chip">
                  <span>Low</span>
                  <strong>${summary?.lowPrice ? formatNumber(summary.lowPrice, 8) : "--"}</strong>
                </div>
                <div class="signal-price-chip">
                  <span>Guide</span>
                  <strong data-signal-guide-current>${guidePrice ? formatNumber(guidePrice, 8) : "--"}</strong>
                </div>
              </div>
              <div class="signal-chart-meta">
                <strong>${symbol}</strong>
                <p class="muted-copy">Last ${summary?.currentPrice ? formatNumber(summary.currentPrice, 8) : "--"} | ${Number(summary?.movePercent || 0) >= 0 ? "+" : ""}${formatNumber(summary?.movePercent || 0, 2)}%</p>
              </div>
              <p class="muted-copy signal-guide-copy">Drag the horizontal guide line to monitor any price level on the chart.</p>
            </div>
          `
          : `<p class="muted-copy">No chart loaded yet.</p>`
      }
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
          <p class="muted-copy">${renderExchangeBadge(getActiveExchange())}</p>
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

function renderExternalHoldingDisclosure(holding) {
  const isExpanded = state.expandedTradeIds.includes(holding.id);
  return `
    <details class="trade-disclosure trade-row-rich" data-trade-id="${holding.id}" data-trade-symbol-row="${holding.symbol}" data-trade-entry="${holding.currentPrice}" data-trade-side="BUY" data-trade-quantity="${holding.quantity}" ${isExpanded ? "open" : ""}>
      <summary class="trade-summary-row">
        <div>
          <strong>${holding.symbol}</strong>
          <p class="muted-copy">${renderExchangeBadge(holding.exchange)}</p>
          <p class="muted-copy" data-trade-current-value>${formatUsdtUnit(holding.currentValue)}</p>
        </div>
        <div class="asset-values">
          ${renderTradeStatusBadge("OPEN")}
          <strong class="${holding.changePercent >= 0 ? "positive" : "negative"}">${holding.changePercent >= 0 ? "+" : ""}${formatNumber(holding.changePercent, 2)}%</strong>
        </div>
      </summary>
      <div class="trade-disclosure-body">
        <div class="trade-detail-grid">
          <div class="trade-detail-pill">
            <span>Source</span>
            <strong>Exchange</strong>
          </div>
          <div class="trade-detail-pill">
            <span>Quantity</span>
            <strong>${formatNumber(holding.quantity, 8)}</strong>
          </div>
          <div class="trade-detail-pill">
            <span>Asset</span>
            <strong>${holding.asset}</strong>
          </div>
        </div>
        <div class="trade-detail-lines">
          <p class="muted-copy">Detected from your live ${getExchangeLabel(holding.exchange)} balance even without an app-created trade record.</p>
          <p class="muted-copy">Current ${holding.currentPrice ? formatNumber(holding.currentPrice, 8) : "-"}</p>
          <p class="muted-copy">Live value ${formatUsdtUnit(holding.currentValue)}</p>
        </div>
      </div>
    </details>
  `;
}

function renderOpenOrdersSection() {
    const openTrades = state.trades.filter(isTradeStrictlyOpen).slice(0, 5);
    const detectedHoldings = getDetectedSpotHoldings().slice(0, 5);
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
                          <p class="muted-copy">${renderExchangeBadge(trade.exchange || getActiveExchange())}</p>
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
            .join("")}
            ${detectedHoldings.map((holding) => renderExternalHoldingDisclosure(holding)).join("")}
            ${!openTrades.length && !detectedHoldings.length ? `<p class="muted-copy">No open trades yet.</p>` : ""}
        </div>
      </div>
      <div>
        <div class="section-head">
          <div>
            <h3>Open Orders</h3>
            <p class="muted-copy">Live ${getExchangeLabel(getActiveExchange())} spot orders that are still waiting to fill.</p>
          </div>
        </div>
        <div class="compact-list">
          ${openOrders.map((order) => renderPendingOrderDisclosure(order, { showCancel: true })).join("") || `<p class="muted-copy">No open orders.</p>`}
        </div>
      </div>
    </section>
  `;
}

function renderAdminUserCard(user) {
  const isExpanded = state.expandedAdminUserIds.includes(user.id);
  const connectedExchanges = getConnectedExchanges(user);
  const revealPassword = state.revealedAdminPasswordIds.includes(user.id);
  const passwordDraft = getAdminPasswordDraft(user.id);
  return `
    <details class="trade-disclosure admin-user-card" data-admin-user-id="${user.id}" ${isExpanded ? "open" : ""}>
      <summary class="trade-summary-row">
        <div>
          <strong>${user.name}</strong>
          <p class="muted-copy">${user.email}</p>
          <div class="exchange-pill-row">${renderExchangeBadgeList(connectedExchanges)}</div>
        </div>
        <div class="asset-values">
          <strong>${user.mirrorEnabled ? "Mirror active" : "Mirror disconnected"}</strong>
          <p class="muted-copy">${user.exchangeConnected ? `${getExchangeLabel(user.activeExchange)} active` : "No active exchange linked"}</p>
        </div>
      </summary>
      <div class="trade-disclosure-body">
        <div class="trade-detail-grid">
          <div class="trade-detail-pill">
            <span>Mirror</span>
            <strong>${user.mirrorEnabled ? "Connected" : "Disconnected"}</strong>
          </div>
          <div class="trade-detail-pill">
            <span>Preferred</span>
            <strong>${getExchangeLabel(user.activeExchange || "bybit")}</strong>
          </div>
          <div class="trade-detail-pill">
            <span>Created</span>
            <strong>${new Date(user.createdAt).toLocaleDateString()}</strong>
          </div>
        </div>
        <div class="trade-detail-lines">
          <p class="muted-copy">Connected exchanges: ${connectedExchanges.length ? connectedExchanges.map((exchange) => exchange.label).join(" and ") : "None yet"}</p>
          ${renderWalletDetailsList(user.walletDetails || [], "This user's connected wallet balances will show here once they sync.")}
          <p class="muted-copy">Stored passwords are hashed securely, so the current password cannot be viewed. Use the reset field below to set a new one.</p>
          <label>
            New password
            <input data-admin-password-input="${user.id}" type="${revealPassword ? "text" : "password"}" value="${escapeHtml(passwordDraft)}" placeholder="Set a new password" />
          </label>
        </div>
        <div class="trade-actions-inline admin-user-actions">
          <button class="micro-btn" data-admin-password-visibility="${user.id}" type="button">${revealPassword ? "Hide password" : "Show password"}</button>
          <button class="micro-btn primary" data-admin-password-save="${user.id}" type="button">Update password</button>
        </div>
        <div class="trade-actions-inline admin-user-actions">
          <button class="micro-btn ${user.mirrorEnabled ? "danger" : ""}" data-admin-toggle-mirror="${user.id}" data-admin-mirror-enabled="${user.mirrorEnabled ? "false" : "true"}" type="button">${user.mirrorEnabled ? "Disconnect mirror" : "Reconnect mirror"}</button>
          <button class="micro-btn danger" data-admin-delete-user="${user.id}" data-admin-user-name="${escapeHtml(user.name)}" type="button">Delete user</button>
        </div>
        <p class="muted-copy">Disconnecting mirror stops future admin trades from syncing into this account. Existing exchange orders stay untouched until you manage them directly.</p>
      </div>
    </details>
  `;
}

function renderWalletDetailsList(walletDetails, emptyCopy) {
  if (!(walletDetails || []).length) {
    return `<p class="muted-copy">${emptyCopy}</p>`;
  }

  return `
    <div class="wallet-detail-list">
      ${(walletDetails || [])
        .map(
          (wallet) => `
            <div class="wallet-detail-card">
              <div class="wallet-detail-head">
                <strong>${wallet.label}</strong>
                <span class="muted-copy">${wallet.error ? "Sync issue" : `${wallet.assetCount || 0} assets`}</span>
              </div>
              ${
                wallet.error
                  ? `<p class="muted-copy">${wallet.error}</p>`
                  : `
                    <p class="muted-copy">Wallet balance ${formatUsdt(wallet.totalUsdt || 0)}${Number(wallet.totalNgn || 0) > 0 ? ` | ${formatNaira(wallet.totalNgn || 0)}` : ""}</p>
                    <p class="muted-copy">Top assets ${(wallet.topAssets || []).map((asset) => `${asset.asset} ${formatUsdt(asset.usdtValue || 0)}`).join(", ") || "None yet"}</p>
                    ${
                      Number(wallet.referenceMinTradeUsdt || 0) > 0
                        ? `
                          <p class="muted-copy ${wallet.belowReferenceMinTrade ? "warning-copy" : ""}">
                            Mirror buy balance ${formatUsdtUnit(wallet.availableQuoteUsdt || 0)} stablecoin available. ${wallet.label} guide starts around ${formatUsdtUnit(wallet.referenceMinTradeUsdt || 0)} before symbol-level checks.
                          </p>
                          <p class="muted-copy">${wallet.minimumTradeNote || ""}</p>
                        `
                        : ""
                    }
                  `
              }
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMirrorMinimumNotice() {
  const activeExchange = getActiveExchange();
  const activeExchangeLabel = getExchangeLabel(activeExchange);
  const activeGuidance = getSpotMirrorGuidance(activeExchange);
  const activeBalance = getStablecoinBuyingBalance(state.balances || []);
  const hasActiveConnection = !!state.user?.exchangeAccounts?.[activeExchange];
  let activeStatusCopy = `Connect ${activeExchangeLabel} to show a live mirror-buy balance check here.`;

  if (hasActiveConnection) {
    activeStatusCopy =
      activeBalance < activeGuidance.referenceMinUsdt
        ? `${activeExchangeLabel} stablecoin buying balance is ${formatUsdtUnit(activeBalance)}. That is below the ${formatUsdtUnit(activeGuidance.referenceMinUsdt)} guide, so mirror buys can be skipped when the symbol minimum is higher than your free balance.`
        : `${activeExchangeLabel} stablecoin buying balance is ${formatUsdtUnit(activeBalance)}. That is above the ${formatUsdtUnit(activeGuidance.referenceMinUsdt)} guide, but the live symbol rule still decides whether each mirror order can be placed.`;
  }

  return `
    <div class="mirror-guide-card">
      <div class="mirror-guide-head">
        <strong>Mirror Spot Minimums</strong>
        <span class="muted-copy">Pair rules still win</span>
      </div>
      <p class="muted-copy ${hasActiveConnection && activeBalance < activeGuidance.referenceMinUsdt ? "warning-copy" : ""}">
        ${activeStatusCopy}
      </p>
      <div class="mirror-guide-grid">
        ${EXCHANGE_OPTIONS.map((exchange) => {
          const guidance = getSpotMirrorGuidance(exchange.id);
          return `
            <div class="mirror-guide-pill">
              <strong>${exchange.label}</strong>
              <p class="muted-copy">Guide ${formatUsdtUnit(guidance.referenceMinUsdt)} for many USDT spot buys.</p>
              <p class="muted-copy">Live rule: ${guidance.ruleLabel}</p>
            </div>
          `;
        }).join("")}
      </div>
      <p class="muted-copy">If your free quote balance or normalized quantity falls below the live exchange minimum for the symbol being mirrored, the app skips that mirror order instead of forcing a rejected spot trade.</p>
    </div>
  `;
}

function renderCurrentUserWalletSummary() {
  const activeExchange = getActiveExchange();
  const activeExchangeLabel = getExchangeLabel(activeExchange);
  const activeGuidance = getSpotMirrorGuidance(activeExchange);
  const activeStablecoinBalance = getStablecoinBuyingBalance(state.balances || []);
  const connectedWallets = (state.user?.exchangeAccounts ? EXCHANGE_OPTIONS : [])
    .filter((exchange) => state.user?.exchangeAccounts?.[exchange.id])
    .map((exchange) => {
      if (exchange.id === activeExchange) {
        return {
          label: exchange.label,
          totalUsdt: state.totalUsdt,
          totalNgn: state.totalNgn,
          assetCount: (state.balances || []).length,
          topAssets: (state.balances || []).slice(0, 3),
          availableQuoteUsdt: activeStablecoinBalance,
          referenceMinTradeUsdt: activeGuidance.referenceMinUsdt,
          minimumTradeNote: activeGuidance.copy,
          belowReferenceMinTrade: activeStablecoinBalance < activeGuidance.referenceMinUsdt,
          error: null,
        };
      }

      return {
        label: exchange.label,
        totalUsdt: 0,
        totalNgn: 0,
        assetCount: 0,
        topAssets: [],
        error: `Switch the active exchange to ${exchange.label} to load its live wallet balance here.`,
      };
    });

  return `
    <div class="asset-card">
      <div>
        <strong>${state.user.name}</strong>
        <p class="muted-copy">${state.user.email}</p>
        <p class="muted-copy">${renderExchangeBadge(activeExchange)}</p>
      </div>
      <div class="asset-values">
        <strong>${state.user.exchangeConnected ? `${activeExchangeLabel} linked` : `No ${activeExchangeLabel} linked`}</strong>
        <p class="muted-copy">${state.user.mirrorEnabled ? "Mirroring enabled" : "Mirroring disabled"}</p>
      </div>
    </div>
    ${renderWalletDetailsList(connectedWallets, `Connect ${activeExchangeLabel} to load your wallet balance.`)}
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
        ${
          state.user.exchangeAccounts?.[activeExchange]
            ? `<p class="muted-copy">Saved ${activeExchangeLabel} API credentials are linked and prefilled here. Update them only if you want to replace the current connection.</p>`
            : `<p class="muted-copy">Connect ${activeExchangeLabel} once and the app will remember it for future logins.</p>`
        }
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
            ${renderMirrorMinimumNotice()}
            `
            : ""
        }
      </section>
      <section class="mobile-card">
        <div class="section-head">
          <div>
            <h3>${state.user.role === "admin" ? "Registered Users" : "Account Summary"}</h3>
            <p class="muted-copy">${state.user.role === "admin" ? "All registered users appear below whether they have connected an exchange or not." : "Your linked account and mirror status."}</p>
          </div>
        </div>
        <div class="card-list">
          ${
            state.user.role === "admin"
              ? state.users.map((user) => renderAdminUserCard(user)).join("") || `<p class="muted-copy">No users linked yet.</p>`
              : renderCurrentUserWalletSummary()
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
    <div data-signal-chart-host>${renderSignalChartSection()}</div>
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
          const useStaticPnl = ["CANCELED", "CLOSED"].includes(String(trade.lifecycleStatus || "").toUpperCase());
          const pnlPercent = useStaticPnl ? getTradeStaticPnlPercent(trade) : (entryPrice && currentPrice ? getTradePnlPercent(trade) : 0);
          return `
            <div class="asset-card history-row" data-trade-symbol-row="${trade.symbol}" data-trade-entry="${entryPrice}" data-trade-side="${trade.side}" data-trade-quantity="${remainingQuantity || getTradeExecutedQuantity(trade)}" data-trade-pnl-static="${useStaticPnl ? "true" : "false"}">
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
                <p class="muted-copy">${renderExchangeBadge(trade.exchange || getActiveExchange())}</p>
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
  bindAdminUserDisclosureToggles();
  bindSignalCardActions();
  bindSignalChartActions();

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
          state.user = normalizeUserPayload(result.user);
          setSelectedExchange(state.user.activeExchange || exchangeSelect.value);
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
        state.user = normalizeUserPayload(result.user);
        setSelectedExchange(state.user.activeExchange || data.exchange || getActiveExchange());
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
        state.user = normalizeUserPayload(result.user);
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
      state.previousTotalUsdt = 0;
      state.totalNgn = 0;
      state.usdtNgnRate = 0;
      state.todayPnlValue = 0;
      state.todayPnlPercent = 0;
      state.todayLabel = "";
      state.monthPnlValue = 0;
      state.monthPnlPercent = 0;
      state.monthLabel = "";
      state.estimatedPnlValue = 0;
      state.estimatedPnlPercent = 0;
      state.signalChart = {
        symbol: "",
        interval: "15m",
        chartType: "candles",
        candles: [],
        guidePrice: null,
        loading: false,
      };
      state.tradeMarketMap = {};
      state.expandedTradeIds = [];
      state.expandedPendingOrderIds = [];
      state.expandedAdminUserIds = [];
      state.selectedHistoryTradeIds = [];
      state.adminPasswordDrafts = {};
      state.revealedAdminPasswordIds = [];
      state.showSplash = false;
      tradeDraft = getTradeFormDefaults();
      render();
    });
  }

  document.querySelectorAll("[data-admin-password-input]").forEach((input) => {
    input.addEventListener("input", () => {
      setAdminPasswordDraft(input.dataset.adminPasswordInput, input.value);
    });
  });

  document.querySelectorAll("[data-admin-password-visibility]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleAdminPasswordVisibility(button.dataset.adminPasswordVisibility);
    });
  });

  document.querySelectorAll("[data-admin-password-save]").forEach((button) => {
    button.addEventListener("click", () => {
      submitAdminPasswordReset(button.dataset.adminPasswordSave);
    });
  });

  document.querySelectorAll("[data-admin-toggle-mirror]").forEach((button) => {
    button.addEventListener("click", () => {
      updateAdminMirror(button.dataset.adminToggleMirror, button.dataset.adminMirrorEnabled === "true");
    });
  });

  document.querySelectorAll("[data-admin-delete-user]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteAdminUser(button.dataset.adminDeleteUser, button.dataset.adminUserName || "this user");
    });
  });
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
    state.user = normalizeUserPayload(me.user);
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
