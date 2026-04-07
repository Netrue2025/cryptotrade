const { calculateEmaSeries, getAverageVolume, toFixedNumber } = require("../indicators/market-indicators");
const { buildSignal, clamp } = require("./shared");
const { DEFAULT_SHORT_SWING_SETTINGS, normalizeShortSwingSettings } = require("./short-swing-config");

function getWindowExtremes(candles = []) {
  const highs = candles.map((candle) => Number(candle.high || 0)).filter((value) => value > 0);
  const lows = candles.map((candle) => Number(candle.low || 0)).filter((value) => value > 0);
  return {
    high: highs.length ? Math.max(...highs) : 0,
    low: lows.length ? Math.min(...lows) : 0,
  };
}

function getCandlePercentChange(candle) {
  const open = Number(candle?.open || 0);
  const close = Number(candle?.close || 0);
  if (!open || !close) {
    return 0;
  }
  return ((close - open) / open) * 100;
}

function hasHigherHighsAndHigherLows(candles = []) {
  const sample = candles.slice(-8);
  if (sample.length < 6) {
    return false;
  }

  const midpoint = Math.floor(sample.length / 2);
  const earlier = sample.slice(0, midpoint);
  const later = sample.slice(midpoint);
  const earlierExtremes = getWindowExtremes(earlier);
  const laterExtremes = getWindowExtremes(later);

  return laterExtremes.high > earlierExtremes.high && laterExtremes.low > earlierExtremes.low;
}

function getMinorResistance(candles = [], lookback = 6) {
  return getWindowExtremes(candles.slice(-(lookback + 1), -1)).high;
}

function getRecentSupport(candles = [], lookback = 20) {
  return getWindowExtremes(candles.slice(-(lookback + 1), -1)).low;
}

function hasPullbackToEma(candles = [], emaSeries = [], tolerance = 0.0035) {
  const sample = candles.slice(-5, -1);
  if (!sample.length) {
    return false;
  }

  return sample.some((candle, index) => {
    const emaIndex = candles.length - 5 + index;
    const ema = Number(emaSeries[emaIndex] || 0);
    if (!ema) {
      return false;
    }
    return Number(candle.low || 0) <= ema * (1 + tolerance);
  });
}

function hasPullbackToSupport(candles = [], supportLevel = 0, tolerance = 0.0025) {
  if (!supportLevel) {
    return false;
  }

  return candles.slice(-5, -1).some((candle) => Number(candle.low || 0) <= Number(supportLevel) * (1 + tolerance));
}

function getRelativeStrengthChange(candles = []) {
  return getCandlePercentChange(candles[candles.length - 1]);
}

function buildFailureReasonMap(checks) {
  return [
    !checks.strategyEnabled ? "Strategy is disabled in settings." : null,
    !checks.hasEnoughHistory ? "Waiting for enough candle history." : null,
    !checks.hasTrendIndicators ? "Trend EMAs are not ready yet." : null,
    !checks.trendPriceAbove200 ? "1H price is below the 200 EMA." : null,
    !checks.trendEmaAligned ? "1H EMA 50 is not above EMA 200." : null,
    !checks.higherHighsHigherLows ? "1H higher highs and higher lows are not confirmed." : null,
    !checks.pullbackDetected ? "15m pullback has not touched EMA 20 or recent support." : null,
    !checks.breakoutClose ? "15m candle has not closed above minor resistance." : null,
    !checks.breakoutPreviousReset ? "Previous 15m candle was already above the breakout level." : null,
    !checks.breakoutVolume ? "15m breakout volume is below the 20-candle average." : null,
    !checks.relativeStrength ? "4H coin strength is not stronger than BTC." : null,
    !checks.btcGuardPassed ? "BTC dropped beyond the 15m safety guard." : null,
  ].filter(Boolean);
}

function evaluateShortSwingSpotDetailed(context) {
  const {
    pair,
    entryCandles,
    trendCandles,
    btcEntryCandles,
    relativeStrengthCandles,
    btcRelativeStrengthCandles,
    timestamp,
    settings: rawSettings,
  } = context;

  const settings = normalizeShortSwingSettings(rawSettings, DEFAULT_SHORT_SWING_SETTINGS);
  const lastEntryCandle = entryCandles[entryCandles.length - 1];
  const previousEntryCandle = entryCandles[entryCandles.length - 2];
  const trendLastCandle = trendCandles[trendCandles.length - 1];
  const hasEnoughHistory =
    !!lastEntryCandle &&
    !!previousEntryCandle &&
    trendCandles.length >= 210 &&
    relativeStrengthCandles.length >= 1 &&
    btcRelativeStrengthCandles.length >= 1 &&
    btcEntryCandles.length >= 1;

  if (!hasEnoughHistory) {
    return {
      pair,
      eligible: false,
      signal: null,
      confidence: 0,
      checks: {
        hasEnoughHistory: false,
      },
      metrics: {},
      failureReasons: ["Waiting for enough candle history."],
    };
  }

  const trendEma50Series = calculateEmaSeries(trendCandles, 50);
  const trendEma200Series = calculateEmaSeries(trendCandles, 200);
  const entryEma20Series = calculateEmaSeries(entryCandles, 20);
  const trendEma50 = Number(trendEma50Series[trendEma50Series.length - 1] || 0);
  const trendEma200 = Number(trendEma200Series[trendEma200Series.length - 1] || 0);
  const entryEma20 = Number(entryEma20Series[entryEma20Series.length - 1] || 0);
  const hasTrendIndicators = !!trendEma50 && !!trendEma200 && !!entryEma20;

  const recentSupport = getRecentSupport(entryCandles, 20);
  const minorResistance = getMinorResistance(entryCandles, 6);
  const priorAverageVolume = getAverageVolume(entryCandles.slice(0, -1), 20);
  const btcDrop15m = getCandlePercentChange(btcEntryCandles[btcEntryCandles.length - 1]);
  const asset4hChange = getRelativeStrengthChange(relativeStrengthCandles);
  const btc4hChange = getRelativeStrengthChange(btcRelativeStrengthCandles);

  const checks = {
    strategyEnabled: settings.enabled,
    hasEnoughHistory,
    hasTrendIndicators,
    trendPriceAbove200: Number(trendLastCandle?.close || 0) > trendEma200,
    trendEmaAligned: trendEma50 > trendEma200,
    higherHighsHigherLows: hasHigherHighsAndHigherLows(trendCandles),
    pullbackToEma: hasPullbackToEma(entryCandles, entryEma20Series),
    pullbackToSupport: hasPullbackToSupport(entryCandles, recentSupport),
    breakoutClose: minorResistance > 0 && Number(lastEntryCandle.close || 0) > minorResistance * 1.001,
    breakoutPreviousReset: minorResistance > 0 && Number(previousEntryCandle.close || 0) <= minorResistance * 1.001,
    breakoutVolume: Number(lastEntryCandle.volume || 0) > priorAverageVolume,
    relativeStrength: asset4hChange > btc4hChange,
    btcGuardPassed: btcDrop15m > -settings.btcDropGuardPercent,
  };
  checks.pullbackDetected = checks.pullbackToEma || checks.pullbackToSupport;

  const eligible =
    checks.strategyEnabled &&
    checks.hasEnoughHistory &&
    checks.hasTrendIndicators &&
    checks.trendPriceAbove200 &&
    checks.trendEmaAligned &&
    checks.higherHighsHigherLows &&
    checks.pullbackDetected &&
    checks.breakoutClose &&
    checks.breakoutPreviousReset &&
    checks.breakoutVolume &&
    checks.relativeStrength &&
    checks.btcGuardPassed;

  const entryPrice = Number(lastEntryCandle.close || 0);
  const stopLoss = entryPrice * (1 - settings.stopLossPercent / 100);
  const takeProfit = entryPrice * (1 + settings.takeProfitPercent / 100);
  const breakevenTriggerPrice = entryPrice * (1 + settings.breakevenTriggerPercent / 100);

  let confidence = 72;
  if (checks.pullbackToEma && checks.pullbackToSupport) confidence += 6;
  if (Number(lastEntryCandle.volume || 0) >= priorAverageVolume * 1.2) confidence += 6;
  if (asset4hChange - btc4hChange >= 0.5) confidence += 5;
  if (trendEma50 >= trendEma200 * 1.01) confidence += 4;
  if (Number(lastEntryCandle.close || 0) > entryEma20) confidence += 3;
  confidence = eligible ? clamp(confidence, 1, 99) : 0;

  const signal = eligible
    ? buildSignal({
        pair,
        strategyType: "SWING_SPOT",
        entryPrice,
        stopLoss,
        takeProfit,
        timestamp,
        confidence,
        supportLevel: recentSupport || null,
        resistanceLevel: minorResistance || null,
        meta: {
          reason: "Trend Pullback Breakout",
          trendTimeframe: "1h",
          entryTimeframe: "15m",
          entryEma20: toFixedNumber(entryEma20),
          trendEma50: toFixedNumber(trendEma50),
          trendEma200: toFixedNumber(trendEma200),
          pullbackToEma: checks.pullbackToEma,
          pullbackToSupport: checks.pullbackToSupport,
          relativeStrength4h: toFixedNumber(asset4hChange, 4),
          btcRelativeStrength4h: toFixedNumber(btc4hChange, 4),
          btcDrop15m: toFixedNumber(btcDrop15m, 4),
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
    checks,
    metrics: {
      entryPrice: toFixedNumber(entryPrice),
      recentSupport: recentSupport ? toFixedNumber(recentSupport) : null,
      minorResistance: minorResistance ? toFixedNumber(minorResistance) : null,
      averageVolume20: toFixedNumber(priorAverageVolume),
      currentVolume: toFixedNumber(Number(lastEntryCandle.volume || 0)),
      entryEma20: entryEma20 ? toFixedNumber(entryEma20) : null,
      trendEma50: trendEma50 ? toFixedNumber(trendEma50) : null,
      trendEma200: trendEma200 ? toFixedNumber(trendEma200) : null,
      relativeStrength4h: toFixedNumber(asset4hChange, 4),
      btcRelativeStrength4h: toFixedNumber(btc4hChange, 4),
      btcDrop15m: toFixedNumber(btcDrop15m, 4),
      takeProfit: toFixedNumber(takeProfit),
      stopLoss: toFixedNumber(stopLoss),
      breakevenTriggerPrice: toFixedNumber(breakevenTriggerPrice),
    },
    failureReasons: eligible ? [] : buildFailureReasonMap(checks),
  };
}

function evaluateShortSwingSpot(context) {
  return evaluateShortSwingSpotDetailed(context).signal;
}

module.exports = {
  evaluateShortSwingSpot,
  evaluateShortSwingSpotDetailed,
};
