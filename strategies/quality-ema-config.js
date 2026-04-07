function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getEnvQualityEmaDefaults() {
  return {
    enabled: parseBoolean(process.env.QUALITY_EMA_ENABLED, false),
    autoTradeEnabled: parseBoolean(process.env.QUALITY_EMA_AUTO_TRADE_ENABLED, false),
    positionSizePercent: parseNumber(process.env.QUALITY_EMA_POSITION_SIZE_PERCENT, 5),
    takeProfitPercent: parseNumber(process.env.QUALITY_EMA_TAKE_PROFIT_PERCENT, 1.5),
    stopLossPercent: parseNumber(process.env.QUALITY_EMA_STOP_LOSS_PERCENT, 0.7),
    breakevenTriggerPercent: parseNumber(process.env.QUALITY_EMA_BREAKEVEN_TRIGGER_PERCENT, 0.8),
    maxSimultaneousTrades: parseNumber(process.env.QUALITY_EMA_MAX_SIMULTANEOUS_TRADES, 2),
    maxTradesPerPairPerDay: parseNumber(process.env.QUALITY_EMA_MAX_TRADES_PER_PAIR_PER_DAY, 1),
  };
}

const BASE_QUALITY_EMA_SETTINGS = {
  enabled: false,
  autoTradeEnabled: false,
  positionSizePercent: 5,
  takeProfitPercent: 1.5,
  stopLossPercent: 0.7,
  breakevenTriggerPercent: 0.8,
  maxSimultaneousTrades: 2,
  maxTradesPerPairPerDay: 1,
};

function normalizeQualityEmaSettings(raw = {}, fallback = BASE_QUALITY_EMA_SETTINGS) {
  const source = {
    ...fallback,
    ...(raw && typeof raw === "object" ? raw : {}),
  };

  return {
    enabled: parseBoolean(source.enabled, fallback.enabled),
    autoTradeEnabled: parseBoolean(source.autoTradeEnabled, fallback.autoTradeEnabled),
    positionSizePercent: clamp(parseNumber(source.positionSizePercent, fallback.positionSizePercent), 0.1, 100),
    takeProfitPercent: clamp(parseNumber(source.takeProfitPercent, fallback.takeProfitPercent), 0.1, 50),
    stopLossPercent: clamp(parseNumber(source.stopLossPercent, fallback.stopLossPercent), 0.1, 50),
    breakevenTriggerPercent: clamp(parseNumber(source.breakevenTriggerPercent, fallback.breakevenTriggerPercent), 0.1, 50),
    maxSimultaneousTrades: Math.max(1, Math.floor(parseNumber(source.maxSimultaneousTrades, fallback.maxSimultaneousTrades))),
    maxTradesPerPairPerDay: Math.max(1, Math.floor(parseNumber(source.maxTradesPerPairPerDay, fallback.maxTradesPerPairPerDay))),
  };
}

const DEFAULT_QUALITY_EMA_SETTINGS = normalizeQualityEmaSettings(getEnvQualityEmaDefaults(), BASE_QUALITY_EMA_SETTINGS);

module.exports = {
  DEFAULT_QUALITY_EMA_SETTINGS,
  normalizeQualityEmaSettings,
};
