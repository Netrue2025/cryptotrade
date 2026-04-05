const {
  buildSignal,
  closeWithinPercent,
  getBodySize,
  getUpperWick,
  isBullishCandle,
} = require("./shared");

function evaluateResistanceTouch(context) {
  const { pair, candles, supportLevel, resistanceLevel, averageVolume, timestamp } = context;
  const lastCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];

  if (!lastCandle || !previousCandle || !resistanceLevel) {
    return null;
  }

  const touchedResistance =
    Number(lastCandle.high || 0) >= Number(resistanceLevel) * 0.998 ||
    closeWithinPercent(lastCandle.close, resistanceLevel, 0.2);
  const brokeOutAlready = Number(lastCandle.close || 0) > Number(resistanceLevel) * 1.0015;
  if (!touchedResistance || brokeOutAlready) {
    return null;
  }

  const body = getBodySize(lastCandle);
  const upperWick = getUpperWick(lastCandle);
  const rejectionWick = upperWick > body * 1.25;
  const bullishAttempt = isBullishCandle(lastCandle) && Number(lastCandle.close || 0) >= Number(resistanceLevel) * 0.9985;
  const pressureBuild =
    bullishAttempt &&
    Number(lastCandle.close || 0) > Number(previousCandle.close || 0) &&
    Number(lastCandle.volume || 0) >= averageVolume * 1.08;

  if (!(pressureBuild || (rejectionWick && bullishAttempt))) {
    return null;
  }

  let confidence = 62;
  if (rejectionWick) confidence += 6;
  if (bullishAttempt) confidence += 8;
  if (pressureBuild) confidence += 10;

  return buildSignal({
    pair,
    strategyType: "RESISTANCE",
    entryPrice: Number(lastCandle.close || 0),
    stopLoss: Number(resistanceLevel) * 0.994,
    timestamp,
    confidence,
    supportLevel,
    resistanceLevel,
    meta: {
      reason: "Price pressed into key resistance with bullish pressure for a buy-side breakout attempt.",
    },
  });
}

module.exports = {
  evaluateResistanceTouch,
};
