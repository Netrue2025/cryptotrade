const { DEFAULT_STATUS } = require("../signals/config");
const { toFixedNumber } = require("../indicators/market-indicators");

function getBodySize(candle) {
  return Math.abs(Number(candle.close || 0) - Number(candle.open || 0));
}

function getUpperWick(candle) {
  return Number(candle.high || 0) - Math.max(Number(candle.open || 0), Number(candle.close || 0));
}

function getLowerWick(candle) {
  return Math.min(Number(candle.open || 0), Number(candle.close || 0)) - Number(candle.low || 0);
}

function isBullishCandle(candle) {
  return Number(candle.close || 0) > Number(candle.open || 0);
}

function isBearishCandle(candle) {
  return Number(candle.close || 0) < Number(candle.open || 0);
}

function closeWithinPercent(price, level, percent = 0.25) {
  const current = Number(price || 0);
  const target = Number(level || 0);
  if (!current || !target) {
    return false;
  }
  return Math.abs((current - target) / target) * 100 <= percent;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildRiskPlan(entryPrice, stopLoss) {
  const entry = Number(entryPrice || 0);
  const stop = Number(stopLoss || 0);
  const fallbackRisk = entry * 0.006;
  const risk = entry > stop ? entry - stop : fallbackRisk;

  return {
    entryPrice: toFixedNumber(entry),
    stopLoss: toFixedNumber(stop > 0 ? stop : entry - fallbackRisk),
    takeProfit: toFixedNumber(entry + risk * 2),
  };
}

function buildSignal({
  pair,
  strategyType,
  entryPrice,
  stopLoss,
  takeProfit,
  timestamp,
  confidence,
  supportLevel = null,
  resistanceLevel = null,
  meta = {},
}) {
  const risk = buildRiskPlan(entryPrice, stopLoss);
  const normalizedTakeProfit = Number(takeProfit || 0) > 0 ? toFixedNumber(takeProfit) : risk.takeProfit;
  return {
    id: `${pair}-${strategyType}-${timestamp}`,
    pair,
    strategyType,
    entryPrice: risk.entryPrice,
    stopLoss: risk.stopLoss,
    takeProfit: normalizedTakeProfit,
    timestamp,
    status: DEFAULT_STATUS,
    side: "BUY",
    confidence: clamp(Math.round(Number(confidence || 0)), 1, 99),
    supportLevel: supportLevel ? toFixedNumber(supportLevel) : null,
    resistanceLevel: resistanceLevel ? toFixedNumber(resistanceLevel) : null,
    meta,
  };
}

module.exports = {
  buildSignal,
  clamp,
  closeWithinPercent,
  getBodySize,
  getLowerWick,
  getUpperWick,
  isBearishCandle,
  isBullishCandle,
};
