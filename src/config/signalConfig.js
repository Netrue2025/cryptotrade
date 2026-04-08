const { getEnvValue } = require("../../lib/env");

const SUPPORTED_TIMEFRAMES = ["15m", "1h", "1d"];
const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "TRXUSDT",
  "TONUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "SHIBUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "UNIUSDT",
  "ATOMUSDT",
  "NEARUSDT",
  "APTUSDT",
  "PEPEUSDT",
];

function parseNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parsePositiveInteger(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function createSignalConfig(overrides = {}) {
  const timeframe = getEnvValue("SIGNAL_TIMEFRAME");
  return {
    supportedTimeframes: SUPPORTED_TIMEFRAMES,
    defaultTimeframe: SUPPORTED_TIMEFRAMES.includes(timeframe) ? timeframe : "15m",
    symbols: DEFAULT_SYMBOLS,
    historyLimit: parseNumber(getEnvValue("SIGNAL_HISTORY_LIMIT"), 240),
    signalTtlMs: 24 * 60 * 60 * 1000,
    minConfidence: parseNumber(getEnvValue("SIGNAL_MIN_CONFIDENCE"), 0.6),
    scanIntervalMs: parseNumber(getEnvValue("SIGNAL_SCAN_INTERVAL_MS"), 60 * 1000),
    scanConcurrency: parsePositiveInteger(getEnvValue("SIGNAL_SCAN_CONCURRENCY"), 5),
    strategyThresholds: {
      SUPPORT: 0.6,
      BREAKOUT: 0.62,
      EMA_RSI: 0.6,
      PRO: 0.7,
    },
    telegram: {
      token: getEnvValue("TELEGRAM_SIGNAL_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"),
      chatId: getEnvValue("TELEGRAM_SIGNAL_CHAT_ID", "TELEGRAM_CHAT_ID"),
      retryAttempts: parseNumber(getEnvValue("TELEGRAM_SIGNAL_RETRY_ATTEMPTS"), 3),
      retryDelayMs: parseNumber(getEnvValue("TELEGRAM_SIGNAL_RETRY_DELAY_MS"), 1200),
    },
    storage: {
      signalCollection: getEnvValue("SIGNALS_COLLECTION") || "signals",
      learningCollection: getEnvValue("SIGNAL_LEARNING_COLLECTION") || "signal_trade_learning",
    },
    autoTrade: {
      enabled: getEnvValue("SIGNAL_AUTO_TRADE_ENABLED").toLowerCase() === "true",
      firstTradeBalancePercent: parseNumber(getEnvValue("SIGNAL_AUTO_TRADE_FIRST_BALANCE_PERCENT"), 50),
      secondTradeBalancePercent: parseNumber(getEnvValue("SIGNAL_AUTO_TRADE_SECOND_BALANCE_PERCENT"), 100),
      maxSimultaneousTrades: parseNumber(getEnvValue("SIGNAL_AUTO_TRADE_MAX_SIMULTANEOUS_TRADES"), 2),
      balancePercent: parseNumber(getEnvValue("SIGNAL_AUTO_TRADE_BALANCE_PERCENT"), 5),
      maxTradesPerPair: parseNumber(getEnvValue("SIGNAL_AUTO_TRADE_MAX_TRADES_PER_PAIR"), 1),
    },
    ...overrides,
  };
}

module.exports = {
  DEFAULT_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  createSignalConfig,
};
