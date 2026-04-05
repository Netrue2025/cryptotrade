const { buildSignal } = require("./shared");

function evaluateEmaRsiPullback(context) {
  const { pair, candles, emaSeries, rsiSeries, supportLevel, resistanceLevel, timestamp } = context;
  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  const currentEma = emaSeries[emaSeries.length - 1];
  const previousEma = emaSeries[emaSeries.length - 2];
  const currentRsi = rsiSeries[rsiSeries.length - 1];
  const previousRsi = rsiSeries[rsiSeries.length - 2];

  if (!lastCandle || !previousCandle || !currentEma || !previousEma || !currentRsi || !previousRsi) {
    return null;
  }

  const priceAboveEma = Number(lastCandle.close || 0) > Number(currentEma);
  const emaTrendingHigher = Number(currentEma) >= Number(previousEma);
  const pullbackZone = Number(currentRsi) >= 40 && Number(currentRsi) <= 52;
  const rsiTurningUp = Number(currentRsi) > Number(previousRsi) && Number(previousRsi) <= 50;
  const emaTouch = Number(lastCandle.low || 0) <= Number(currentEma) * 1.004;

  if (!(priceAboveEma && emaTrendingHigher && pullbackZone && rsiTurningUp && emaTouch)) {
    return null;
  }

  const recentSwingLow = candles
    .slice(-8)
    .reduce((lowest, candle) => (lowest === 0 ? Number(candle.low || 0) : Math.min(lowest, Number(candle.low || 0))), 0);

  let confidence = 66;
  if (Number(currentRsi) >= 44 && Number(currentRsi) <= 49) confidence += 8;
  if (Number(lastCandle.close || 0) > Number(previousCandle.close || 0)) confidence += 8;
  if (Number(lastCandle.close || 0) > Number(currentEma) * 1.002) confidence += 5;

  return buildSignal({
    pair,
    strategyType: "EMA_RSI",
    entryPrice: Number(lastCandle.close || 0),
    stopLoss: recentSwingLow > 0 ? recentSwingLow * 0.996 : Number(currentEma) * 0.994,
    timestamp,
    confidence,
    supportLevel,
    resistanceLevel,
    meta: {
      ema50: currentEma,
      rsi14: currentRsi,
      reason: "Price stayed above EMA 50 while RSI pulled back into the buy zone and turned higher.",
    },
  });
}

module.exports = {
  evaluateEmaRsiPullback,
};
