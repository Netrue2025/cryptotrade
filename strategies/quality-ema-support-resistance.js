const { calculateEmaSeries, calculateRsiSeries, getAverageVolume, toFixedNumber } = require("../indicators/market-indicators");
const { buildSignal, clamp } = require("./shared");
const { DEFAULT_QUALITY_EMA_SETTINGS, normalizeQualityEmaSettings } = require("./quality-ema-config");

function getWindowExtremes(candles = []) {
  const highs = candles.map((candle) => Number(candle.high || 0)).filter((value) => value > 0);
  const lows = candles.map((candle) => Number(candle.low || 0)).filter((value) => value > 0);
  return {
    high: highs.length ? Math.max(...highs) : 0,
    low: lows.length ? Math.min(...lows) : 0,
  };
}

function getBodyStrength(candle) {
  const open = Number(candle?.open || 0);
  const close = Number(candle?.close || 0);
  const high = Number(candle?.high || 0);
  const low = Number(candle?.low || 0);
  const range = Math.max(high - low, 0);
  if (!range) {
    return 0;
  }
  return Math.abs(close - open) / range;
}

function getRecentSupport(candles = [], lookback = 20) {
  return getWindowExtremes(candles.slice(-(lookback + 1), -1)).low;
}

function getMinorResistance(candles = [], lookback = 10) {
  return getWindowExtremes(candles.slice(-(lookback + 1), -1)).high;
}

function hasHigherStructure(candles = []) {
  const sample = candles.slice(-10);
  if (sample.length < 8) {
    return false;
  }

  const midpoint = Math.floor(sample.length / 2);
  const left = getWindowExtremes(sample.slice(0, midpoint));
  const right = getWindowExtremes(sample.slice(midpoint));
  return right.high > left.high && right.low >= left.low;
}

function evaluateQualityEmaSupportResistanceDetailed(context) {
  const {
    pair,
    entryCandles,
    trendCandles,
    dailyCandles,
    timestamp,
    settings: rawSettings,
  } = context;

  const settings = normalizeQualityEmaSettings(rawSettings, DEFAULT_QUALITY_EMA_SETTINGS);
  const lastEntryCandle = entryCandles[entryCandles.length - 1];
  const previousEntryCandle = entryCandles[entryCandles.length - 2];
  const lastTrendCandle = trendCandles[trendCandles.length - 1];
  const lastDailyCandle = dailyCandles[dailyCandles.length - 1];
  const hasEnoughHistory =
    !!lastEntryCandle &&
    !!previousEntryCandle &&
    !!lastTrendCandle &&
    !!lastDailyCandle &&
    entryCandles.length >= 120 &&
    trendCandles.length >= 220 &&
    dailyCandles.length >= 220;

  if (!hasEnoughHistory) {
    return {
      pair,
      eligible: false,
      signal: null,
      confidence: 0,
      failureReasons: ["Waiting for enough 15m, 1h, and 1d history."],
    };
  }

  const entryEma20Series = calculateEmaSeries(entryCandles, 20);
  const entryEma50Series = calculateEmaSeries(entryCandles, 50);
  const trendEma50Series = calculateEmaSeries(trendCandles, 50);
  const trendEma200Series = calculateEmaSeries(trendCandles, 200);
  const dailyEma50Series = calculateEmaSeries(dailyCandles, 50);
  const dailyEma200Series = calculateEmaSeries(dailyCandles, 200);
  const entryRsiSeries = calculateRsiSeries(entryCandles, 14);
  const trendRsiSeries = calculateRsiSeries(trendCandles, 14);

  const entryEma20 = Number(entryEma20Series[entryEma20Series.length - 1] || 0);
  const entryEma50 = Number(entryEma50Series[entryEma50Series.length - 1] || 0);
  const trendEma50 = Number(trendEma50Series[trendEma50Series.length - 1] || 0);
  const trendEma200 = Number(trendEma200Series[trendEma200Series.length - 1] || 0);
  const dailyEma50 = Number(dailyEma50Series[dailyEma50Series.length - 1] || 0);
  const dailyEma200 = Number(dailyEma200Series[dailyEma200Series.length - 1] || 0);
  const entryRsi = Number(entryRsiSeries[entryRsiSeries.length - 1] || 0);
  const previousEntryRsi = Number(entryRsiSeries[entryRsiSeries.length - 2] || 0);
  const trendRsi = Number(trendRsiSeries[trendRsiSeries.length - 1] || 0);

  const supportLevel = getRecentSupport(entryCandles, 20);
  const resistanceLevel = getMinorResistance(entryCandles, 10);
  const averageVolume = getAverageVolume(entryCandles.slice(0, -1), 20);
  const supportTouch = Number(lastEntryCandle.low || 0) <= Number(supportLevel || 0) * 1.003;
  const emaTouch = entryEma20 > 0 && Number(lastEntryCandle.low || 0) <= entryEma20 * 1.0035;
  const bullishClose = Number(lastEntryCandle.close || 0) > Number(lastEntryCandle.open || 0);
  const resistanceBreak = resistanceLevel > 0 && Number(lastEntryCandle.close || 0) > resistanceLevel * 1.001;
  const resetBelowResistance = resistanceLevel > 0 && Number(previousEntryCandle.close || 0) <= resistanceLevel * 1.001;
  const volumeConfirmed = Number(lastEntryCandle.volume || 0) >= averageVolume * 1.2;
  const rsiAligned = entryRsi >= 48 && entryRsi <= 66 && entryRsi > previousEntryRsi;
  const trendAligned =
    Number(lastTrendCandle.close || 0) > trendEma200 &&
    trendEma50 > trendEma200 &&
    trendRsi >= 52 &&
    hasHigherStructure(trendCandles);
  const dailyAligned =
    Number(lastDailyCandle.close || 0) > dailyEma200 &&
    dailyEma50 >= dailyEma200 &&
    hasHigherStructure(dailyCandles.slice(-12));
  const entryAboveEma = Number(lastEntryCandle.close || 0) >= entryEma20 && entryEma20 >= entryEma50;
  const strongBody = getBodyStrength(lastEntryCandle) >= 0.5;
  const pullbackConfirmed = supportTouch || emaTouch;

  const eligible =
    settings.enabled &&
    trendAligned &&
    dailyAligned &&
    entryAboveEma &&
    rsiAligned &&
    pullbackConfirmed &&
    bullishClose &&
    resistanceBreak &&
    resetBelowResistance &&
    volumeConfirmed &&
    strongBody;

  let confidence = 80;
  if (supportTouch && emaTouch) confidence += 4;
  if (Number(lastEntryCandle.volume || 0) >= averageVolume * 1.35) confidence += 5;
  if (entryRsi >= 52 && entryRsi <= 60) confidence += 4;
  if (Number(lastEntryCandle.close || 0) > resistanceLevel * 1.003) confidence += 4;
  if (trendRsi >= 56) confidence += 3;
  confidence = eligible ? clamp(confidence, 1, 99) : 0;

  const entryPrice = Number(lastEntryCandle.close || 0);
  const stopLoss = entryPrice * (1 - settings.stopLossPercent / 100);
  const takeProfit = entryPrice * (1 + settings.takeProfitPercent / 100);
  const breakevenTriggerPrice = entryPrice * (1 + settings.breakevenTriggerPercent / 100);

  const failureReasons = [];
  if (!settings.enabled) failureReasons.push("Strategy is disabled in settings.");
  if (!dailyAligned) failureReasons.push("1D trend filter is not aligned.");
  if (!trendAligned) failureReasons.push("1H trend and momentum are not aligned.");
  if (!entryAboveEma) failureReasons.push("15m price is not holding above EMA support.");
  if (!rsiAligned) failureReasons.push("15m RSI is not in the quality buy zone or rising.");
  if (!pullbackConfirmed) failureReasons.push("15m pullback did not reach EMA 20 or strong support.");
  if (!resistanceBreak || !resetBelowResistance) failureReasons.push("15m resistance breakout is not confirmed.");
  if (!volumeConfirmed) failureReasons.push("15m volume is too weak for a quality setup.");
  if (!strongBody) failureReasons.push("Breakout candle body is not strong enough.");

  const signal = eligible
    ? buildSignal({
        pair,
        strategyType: "QUALITY_ERS",
        entryPrice,
        stopLoss,
        takeProfit,
        timestamp,
        confidence,
        supportLevel,
        resistanceLevel,
        meta: {
          reason: "EMA RSI Support Resistance",
          trendTimeframe: "1h",
          regimeTimeframe: "1d",
          entryTimeframe: "15m",
          supportTouch,
          emaTouch,
          entryRsi: toFixedNumber(entryRsi, 4),
          trendRsi: toFixedNumber(trendRsi, 4),
          entryEma20: toFixedNumber(entryEma20),
          entryEma50: toFixedNumber(entryEma50),
          trendEma50: toFixedNumber(trendEma50),
          trendEma200: toFixedNumber(trendEma200),
          dailyEma50: toFixedNumber(dailyEma50),
          dailyEma200: toFixedNumber(dailyEma200),
          breakevenTriggerPrice: toFixedNumber(breakevenTriggerPrice),
          activeStopLossPrice: toFixedNumber(stopLoss),
        },
      })
    : null;

  return {
    pair,
    eligible,
    signal,
    confidence,
    metrics: {
      entryPrice: toFixedNumber(entryPrice),
      supportLevel: supportLevel ? toFixedNumber(supportLevel) : null,
      resistanceLevel: resistanceLevel ? toFixedNumber(resistanceLevel) : null,
      averageVolume20: toFixedNumber(averageVolume),
      currentVolume: toFixedNumber(Number(lastEntryCandle.volume || 0)),
      entryRsi: toFixedNumber(entryRsi, 4),
      trendRsi: toFixedNumber(trendRsi, 4),
    },
    failureReasons: eligible ? [] : [...new Set(failureReasons)],
  };
}

function evaluateQualityEmaSupportResistance(context) {
  return evaluateQualityEmaSupportResistanceDetailed(context).signal;
}

module.exports = {
  evaluateQualityEmaSupportResistance,
  evaluateQualityEmaSupportResistanceDetailed,
};
