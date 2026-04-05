const { buildSignal } = require("./shared");

function evaluateBreakoutConfirmation(context) {
  const { pair, candles, supportLevel, resistanceLevel, averageVolume, timestamp } = context;
  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];

  if (!lastCandle || !previousCandle || !resistanceLevel) {
    return null;
  }

  const candleClosedAbove = Number(lastCandle.close || 0) > Number(resistanceLevel) * 1.0015;
  const previousBelowLevel = Number(previousCandle.close || 0) <= Number(resistanceLevel) * 1.001;
  const volumeSpike = Number(lastCandle.volume || 0) >= averageVolume * 1.35;
  const bodyStrength = Number(lastCandle.close || 0) > Number(lastCandle.open || 0);
  const retestHeld = Number(lastCandle.low || 0) >= Number(resistanceLevel) * 0.997;

  if (!(candleClosedAbove && previousBelowLevel && volumeSpike && bodyStrength)) {
    return null;
  }

  let confidence = 72;
  if (retestHeld) confidence += 8;
  if (Number(lastCandle.close || 0) > Number(resistanceLevel) * 1.004) confidence += 6;
  if (Number(lastCandle.volume || 0) >= averageVolume * 1.6) confidence += 6;

  return buildSignal({
    pair,
    strategyType: "BREAKOUT",
    entryPrice: Number(lastCandle.close || 0),
    stopLoss: Number(resistanceLevel) * 0.996,
    timestamp,
    confidence,
    supportLevel,
    resistanceLevel,
    meta: {
      reason: "Resistance broke on a closing candle with strong volume confirmation.",
      retestHeld,
    },
  });
}

module.exports = {
  evaluateBreakoutConfirmation,
};
