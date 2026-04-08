const { getCandles: getBinanceCandles } = require("../../lib/binance");
const { getCandles: getBybitCandles } = require("../../lib/bybit");
const {
  buildLineSeries,
  calculateEmaSeries,
  normalizeCandles,
} = require("../utils/candleMath");

class MarketDataService {
  constructor({ logger = console, primaryExchange = "binance" } = {}) {
    this.logger = logger;
    this.primaryExchange = primaryExchange;
  }

  async getCandles(symbol, timeframe, limit = 240) {
    const providers = this.primaryExchange === "bybit"
      ? [() => getBybitCandles(symbol, timeframe, limit, false), () => getBinanceCandles(symbol, timeframe, limit, false)]
      : [() => getBinanceCandles(symbol, timeframe, limit, false), () => getBybitCandles(symbol, timeframe, limit, false)];

    let lastError = null;
    for (const provider of providers) {
      try {
        const candles = normalizeCandles(await provider());
        if (candles.length) {
          return candles;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error(`No candles available for ${symbol} ${timeframe}.`);
  }

  async buildChart(symbol, timeframe, signal = null) {
    const candles = await this.getCandles(symbol, timeframe, 180);
    const ema50Series = calculateEmaSeries(candles, 50);
    const ema200Series = calculateEmaSeries(candles, 200);
    return {
      symbol,
      timeframe,
      updatedAt: new Date().toISOString(),
      candles: candles.map((candle) => ({
        time: Math.floor(Number(candle.openTime || 0) / 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })),
      ema50: buildLineSeries(candles, ema50Series),
      ema200: buildLineSeries(candles, ema200Series),
      entry: signal?.entry || null,
      entryPrice: signal?.entry || null,
      stopLoss: signal?.stopLoss || null,
      takeProfit: signal?.takeProfit || null,
      supportLevel: signal?.meta?.supportLevel || null,
      resistanceLevel: signal?.meta?.resistanceLevel || null,
      signal,
    };
  }
}

module.exports = {
  MarketDataService,
};
