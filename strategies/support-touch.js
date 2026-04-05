const {
  buildSignal,
  closeWithinPercent,
  getBodySize,
  getLowerWick,
  isBullishCandle,
} = require("./shared");

function evaluateSupportTouch(context) {
  const { pair, candles, supportLevel, resistanceLevel, averageVolume, timestamp } = context;
  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];

  if (!lastCandle || !previousCandle || !supportLevel) {
    return null;
  }

  const touchedSupport =
    Number(lastCandle.low || 0) <= Number(supportLevel) * 1.0025 ||
    closeWithinPercent(lastCandle.close, supportLevel, 0.25);
  if (!touchedSupport) {
    return null;
  }

  const body = getBodySize(lastCandle);
  const longLowerWick = getLowerWick(lastCandle) > body * 1.4;
  const bounceCandle = isBullishCandle(lastCandle) || (longLowerWick && Number(lastCandle.close || 0) > Number(lastCandle.open || 0) * 0.998);
  const recoveredFromSupport = Number(lastCandle.close || 0) >= Number(supportLevel) * 1.003;
  const strongerThanPrevious = Number(lastCandle.close || 0) > Number(previousCandle.close || 0);
  const volumeLift = Number(lastCandle.volume || 0) >= averageVolume * 1.1;

  if (!bounceCandle || !(recoveredFromSupport || strongerThanPrevious)) {
    return null;
  }

  let confidence = 64;
  if (longLowerWick) confidence += 8;
  if (recoveredFromSupport) confidence += 8;
  if (strongerThanPrevious) confidence += 6;
  if (volumeLift) confidence += 6;

  return buildSignal({
    pair,
    strategyType: "SUPPORT",
    entryPrice: Number(lastCandle.close || 0),
    stopLoss: Number(supportLevel) * 0.996,
    timestamp,
    confidence,
    supportLevel,
    resistanceLevel,
    meta: {
      reason: "Price touched major support and showed bullish bounce confirmation.",
    },
  });
}

module.exports = {
  evaluateSupportTouch,
};
