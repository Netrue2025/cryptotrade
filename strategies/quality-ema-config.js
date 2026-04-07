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
    useAdaptiveStrategy: parseBoolean(process.env.USE_ADAPTIVE_STRATEGY, false),
    positionSizePercent: parseNumber(process.env.QUALITY_EMA_POSITION_SIZE_PERCENT, 5),
    takeProfitPercent: parseNumber(process.env.QUALITY_EMA_TAKE_PROFIT_PERCENT, 1.5),
    stopLossPercent: parseNumber(process.env.QUALITY_EMA_STOP_LOSS_PERCENT, 0.7),
    breakevenTriggerPercent: parseNumber(process.env.QUALITY_EMA_BREAKEVEN_TRIGGER_PERCENT, 0.8),
    maxSimultaneousTrades: parseNumber(process.env.QUALITY_EMA_MAX_SIMULTANEOUS_TRADES, 2),
    maxTradesPerPairPerDay: parseNumber(process.env.QUALITY_EMA_MAX_TRADES_PER_PAIR_PER_DAY, 1),
    emaFast: parseNumber(process.env.QUALITY_EMA_FAST, 20),
    emaSlow: parseNumber(process.env.QUALITY_EMA_SLOW, 50),
    trendEmaFast: parseNumber(process.env.QUALITY_EMA_TREND_FAST, 50),
    trendEmaSlow: parseNumber(process.env.QUALITY_EMA_TREND_SLOW, 200),
    dailyEmaFast: parseNumber(process.env.QUALITY_EMA_DAILY_FAST, 50),
    dailyEmaSlow: parseNumber(process.env.QUALITY_EMA_DAILY_SLOW, 200),
    rsiOversold: parseNumber(process.env.QUALITY_EMA_RSI_OVERSOLD, 48),
    rsiOverbought: parseNumber(process.env.QUALITY_EMA_RSI_OVERBOUGHT, 66),
    supportResistanceTolerancePercent: parseNumber(process.env.QUALITY_EMA_SUPPORT_RESISTANCE_TOLERANCE_PERCENT, 0.35),
    emaCrossoverSensitivityPercent: parseNumber(process.env.QUALITY_EMA_CROSSOVER_SENSITIVITY_PERCENT, 0.1),
    minimumConfidenceScore: parseNumber(process.env.QUALITY_EMA_MIN_CONFIDENCE_SCORE, 0.6),
  };
}

const BASE_QUALITY_EMA_SETTINGS = {
  enabled: false,
  autoTradeEnabled: false,
  useAdaptiveStrategy: false,
  positionSizePercent: 5,
  takeProfitPercent: 1.5,
  stopLossPercent: 0.7,
  breakevenTriggerPercent: 0.8,
  maxSimultaneousTrades: 2,
  maxTradesPerPairPerDay: 1,
  emaFast: 20,
  emaSlow: 50,
  trendEmaFast: 50,
  trendEmaSlow: 200,
  dailyEmaFast: 50,
  dailyEmaSlow: 200,
  rsiOversold: 48,
  rsiOverbought: 66,
  supportResistanceTolerancePercent: 0.35,
  emaCrossoverSensitivityPercent: 0.1,
  minimumConfidenceScore: 0.6,
};

function normalizeQualityEmaSettings(raw = {}, fallback = BASE_QUALITY_EMA_SETTINGS) {
  const source = {
    ...fallback,
    ...(raw && typeof raw === "object" ? raw : {}),
  };

  const emaFast = Math.max(5, Math.floor(parseNumber(source.emaFast, fallback.emaFast)));
  const emaSlow = Math.max(emaFast + 1, Math.floor(parseNumber(source.emaSlow, fallback.emaSlow)));
  const trendEmaFast = Math.max(10, Math.floor(parseNumber(source.trendEmaFast, fallback.trendEmaFast)));
  const trendEmaSlow = Math.max(trendEmaFast + 1, Math.floor(parseNumber(source.trendEmaSlow, fallback.trendEmaSlow)));
  const dailyEmaFast = Math.max(10, Math.floor(parseNumber(source.dailyEmaFast, fallback.dailyEmaFast)));
  const dailyEmaSlow = Math.max(dailyEmaFast + 1, Math.floor(parseNumber(source.dailyEmaSlow, fallback.dailyEmaSlow)));
  const rsiOversold = clamp(parseNumber(source.rsiOversold, fallback.rsiOversold), 20, 70);
  const rsiOverbought = clamp(parseNumber(source.rsiOverbought, fallback.rsiOverbought), Math.max(rsiOversold + 5, 35), 90);

  return {
    enabled: parseBoolean(source.enabled, fallback.enabled),
    autoTradeEnabled: parseBoolean(source.autoTradeEnabled, fallback.autoTradeEnabled),
    useAdaptiveStrategy: parseBoolean(source.useAdaptiveStrategy, fallback.useAdaptiveStrategy),
    positionSizePercent: clamp(parseNumber(source.positionSizePercent, fallback.positionSizePercent), 0.1, 100),
    takeProfitPercent: clamp(parseNumber(source.takeProfitPercent, fallback.takeProfitPercent), 0.1, 50),
    stopLossPercent: clamp(parseNumber(source.stopLossPercent, fallback.stopLossPercent), 0.1, 50),
    breakevenTriggerPercent: clamp(parseNumber(source.breakevenTriggerPercent, fallback.breakevenTriggerPercent), 0.1, 50),
    maxSimultaneousTrades: Math.max(1, Math.floor(parseNumber(source.maxSimultaneousTrades, fallback.maxSimultaneousTrades))),
    maxTradesPerPairPerDay: Math.max(1, Math.floor(parseNumber(source.maxTradesPerPairPerDay, fallback.maxTradesPerPairPerDay))),
    emaFast,
    emaSlow,
    trendEmaFast,
    trendEmaSlow,
    dailyEmaFast,
    dailyEmaSlow,
    rsiOversold,
    rsiOverbought,
    supportResistanceTolerancePercent: clamp(
      parseNumber(source.supportResistanceTolerancePercent, fallback.supportResistanceTolerancePercent),
      0.05,
      5
    ),
    emaCrossoverSensitivityPercent: clamp(
      parseNumber(source.emaCrossoverSensitivityPercent, fallback.emaCrossoverSensitivityPercent),
      0.01,
      5
    ),
    minimumConfidenceScore: clamp(parseNumber(source.minimumConfidenceScore, fallback.minimumConfidenceScore), 0.1, 0.99),
  };
}

function getQualityEmaStrategyParameters(settings = {}) {
  const normalized = normalizeQualityEmaSettings(settings, DEFAULT_QUALITY_EMA_SETTINGS);
  return {
    emaFast: normalized.emaFast,
    emaSlow: normalized.emaSlow,
    trendEmaFast: normalized.trendEmaFast,
    trendEmaSlow: normalized.trendEmaSlow,
    dailyEmaFast: normalized.dailyEmaFast,
    dailyEmaSlow: normalized.dailyEmaSlow,
    rsiOversold: normalized.rsiOversold,
    rsiOverbought: normalized.rsiOverbought,
    supportResistanceTolerancePercent: normalized.supportResistanceTolerancePercent,
    emaCrossoverSensitivityPercent: normalized.emaCrossoverSensitivityPercent,
    minimumConfidenceScore: normalized.minimumConfidenceScore,
  };
}

const DEFAULT_QUALITY_EMA_SETTINGS = normalizeQualityEmaSettings(getEnvQualityEmaDefaults(), BASE_QUALITY_EMA_SETTINGS);

module.exports = {
  DEFAULT_QUALITY_EMA_SETTINGS,
  getQualityEmaStrategyParameters,
  normalizeQualityEmaSettings,
};
