const {
  getLastCandle,
  normalizeCandles,
  toNumber,
} = require("../utils/candleMath");

const STRATEGY = "TEST_PULSE";

function buildMiss(reason = "", details = {}) {
  return {
    matched: false,
    strategy: STRATEGY,
    confidence: 0,
    reason,
    details,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function evaluateTestPulseStrategy({ symbol, timeframe, candles = [], config = {} }) {
  const testConfig = config.testStrategy || {};
  if (!testConfig.enabled) {
    return buildMiss();
  }

  const targetSymbol = String(testConfig.symbol || "").trim().toUpperCase();
  if (!targetSymbol || String(symbol || "").trim().toUpperCase() !== targetSymbol) {
    return buildMiss();
  }

  const cadenceMinutes = clamp(Number(testConfig.cadenceMinutes || 3), 1, 60);
  const cadenceMs = cadenceMinutes * 60 * 1000;
  const signalTimestamp = Math.floor(Date.now() / cadenceMs) * cadenceMs;
  const normalizedCandles = normalizeCandles(candles);
  const lastCandle = getLastCandle(normalizedCandles);
  const fallbackEntry = Number(testConfig.entryPrice || 100);
  const entry = toNumber(lastCandle?.close ?? fallbackEntry);
  if (!Number.isFinite(entry) || entry <= 0) {
    return buildMiss("Test pulse strategy could not calculate the entry price.");
  }

  const takeProfitPercent = clamp(Number(testConfig.takeProfitPercent || 0.35), 0.05, 10);
  const stopLossPercent = clamp(Number(testConfig.stopLossPercent || 0.2), 0.05, 10);
  const confidenceInput = Number(testConfig.confidence || 0.99);
  const confidence = confidenceInput > 1 ? confidenceInput / 100 : confidenceInput;

  return {
    matched: true,
    strategy: STRATEGY,
    confidence: Number(clamp(confidence, 0.5, 0.999).toFixed(2)),
    entry: Number(entry.toFixed(6)),
    stopLoss: Number((entry * (1 - (stopLossPercent / 100))).toFixed(6)),
    takeProfit: Number((entry * (1 + (takeProfitPercent / 100))).toFixed(6)),
    signalTimestamp,
    reason: `Test pulse fired for ${targetSymbol} to verify signal delivery to Telegram.`,
    details: {
      cadenceMinutes,
      timeframe,
      bucketStartedAt: new Date(signalTimestamp).toISOString(),
    },
    meta: {
      testOnly: true,
      cadenceMinutes,
    },
  };
}

module.exports = {
  STRATEGY,
  evaluateTestPulseStrategy,
};
