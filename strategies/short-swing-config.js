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

function getEnvShortSwingDefaults() {
  return {
    enabled: parseBoolean(process.env.SHORT_SWING_ENABLED, true),
    autoTradeEnabled: parseBoolean(process.env.SHORT_SWING_AUTO_TRADE_ENABLED, false),
    positionSizePercent: parseNumber(process.env.SHORT_SWING_POSITION_SIZE_PERCENT, 5),
    takeProfitPercent: parseNumber(process.env.SHORT_SWING_TAKE_PROFIT_PERCENT, 1.3),
    stopLossPercent: parseNumber(process.env.SHORT_SWING_STOP_LOSS_PERCENT, 0.6),
    breakevenTriggerPercent: parseNumber(process.env.SHORT_SWING_BREAKEVEN_TRIGGER_PERCENT, 0.7),
    maxSimultaneousTrades: parseNumber(process.env.SHORT_SWING_MAX_SIMULTANEOUS_TRADES, 3),
    maxTradesPerPairPerDay: parseNumber(process.env.SHORT_SWING_MAX_TRADES_PER_PAIR_PER_DAY, 1),
    btcDropGuardPercent: parseNumber(process.env.SHORT_SWING_BTC_DROP_GUARD_PERCENT, 1),
  };
}

const BASE_SHORT_SWING_SETTINGS = {
  enabled: true,
  autoTradeEnabled: false,
  positionSizePercent: 5,
  takeProfitPercent: 1.3,
  stopLossPercent: 0.6,
  breakevenTriggerPercent: 0.7,
  maxSimultaneousTrades: 3,
  maxTradesPerPairPerDay: 1,
  btcDropGuardPercent: 1,
};

function normalizeShortSwingSettings(raw = {}, fallback = BASE_SHORT_SWING_SETTINGS) {
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
    btcDropGuardPercent: clamp(parseNumber(source.btcDropGuardPercent, fallback.btcDropGuardPercent), 0.1, 20),
  };
}

const DEFAULT_SHORT_SWING_SETTINGS = normalizeShortSwingSettings(getEnvShortSwingDefaults(), BASE_SHORT_SWING_SETTINGS);

module.exports = {
  DEFAULT_SHORT_SWING_SETTINGS,
  normalizeShortSwingSettings,
};
