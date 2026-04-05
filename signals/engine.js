const EventEmitter = require("node:events");

const { calculateEmaSeries, calculateRsiSeries, getAverageVolume, getRollingLevels, toFixedNumber } = require("../indicators/market-indicators");
const { evaluateBreakoutConfirmation } = require("../strategies/breakout-confirmation");
const { evaluateEmaRsiPullback } = require("../strategies/ema-rsi-pullback");
const { evaluateResistanceTouch } = require("../strategies/resistance-touch");
const { evaluateSupportTouch } = require("../strategies/support-touch");
const { LEVEL_LOOKBACK, MAX_SIGNAL_HISTORY, MIN_CONFIDENCE, SIGNAL_COOLDOWN_MS, SIGNAL_HISTORY_LIMIT, SIGNAL_PAIRS, SIGNAL_TIMEFRAME } = require("./config");
const { SignalStore } = require("./store");
const { BinanceSignalStream } = require("../websocket/binance-signal-stream");

const STRATEGY_PRIORITY = {
  BREAKOUT: 4,
  SUPPORT: 3,
  EMA_RSI: 2,
  RESISTANCE: 1,
};

function sortSignals(a, b) {
  const timeDiff = Number(b.timestamp || 0) - Number(a.timestamp || 0);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  const confidenceDiff = Number(b.confidence || 0) - Number(a.confidence || 0);
  if (confidenceDiff !== 0) {
    return confidenceDiff;
  }
  return (STRATEGY_PRIORITY[b.strategyType] || 0) - (STRATEGY_PRIORITY[a.strategyType] || 0);
}

function normalizeIncomingCandle(candle) {
  return {
    openTime: Number(candle.openTime || 0),
    closeTime: Number(candle.closeTime || 0),
    open: Number(candle.open || 0),
    high: Number(candle.high || 0),
    low: Number(candle.low || 0),
    close: Number(candle.close || 0),
    volume: Number(candle.volume || 0),
    isClosed: !!candle.isClosed,
  };
}

class SignalEngine extends EventEmitter {
  constructor() {
    super();
    this.store = new SignalStore({
      maxSignalHistory: MAX_SIGNAL_HISTORY,
      cooldownMs: SIGNAL_COOLDOWN_MS,
    });
    this.stream = new BinanceSignalStream({
      pairs: SIGNAL_PAIRS,
      interval: SIGNAL_TIMEFRAME,
    });
    this.started = false;
    this.boundOnKline = (payload) => this.handleKline(payload);
    this.boundOnStatus = (status) => this.emit("status", status);
    this.boundOnError = (error) => this.emit("status", { ok: false, message: error.message || "Signal engine error." });
  }

  async start() {
    if (this.started) {
      return;
    }

    const seedMap = await this.stream.seedCandles(SIGNAL_HISTORY_LIMIT);
    for (const pair of SIGNAL_PAIRS) {
      const candles = (seedMap.get(pair) || []).map(normalizeIncomingCandle);
      this.store.upsertPairState(pair, this.buildPairState(pair, candles));
    }

    this.stream.on("kline", this.boundOnKline);
    this.stream.on("status", this.boundOnStatus);
    this.stream.on("error", this.boundOnError);
    this.stream.start();
    this.started = true;
  }

  stop() {
    if (!this.started) {
      return;
    }
    this.stream.off("kline", this.boundOnKline);
    this.stream.off("status", this.boundOnStatus);
    this.stream.off("error", this.boundOnError);
    this.stream.stop();
    this.started = false;
  }

  getSignals() {
    return this.store.getSignals().sort(sortSignals);
  }

  getSnapshot() {
    return {
      timeframe: SIGNAL_TIMEFRAME,
      pairs: SIGNAL_PAIRS,
      streamStatus: "LIVE",
      signals: this.getSignals(),
      generatedAt: new Date().toISOString(),
    };
  }

  getChartSnapshot(pair, signalId = "") {
    const normalizedPair = String(pair || "").trim().toUpperCase();
    const pairState = this.store.getPairState(normalizedPair);
    if (!pairState) {
      return null;
    }

    const signal = signalId ? this.store.getSignal(signalId) : this.getSignals().find((item) => item.pair === normalizedPair) || null;
    return {
      pair: normalizedPair,
      timeframe: SIGNAL_TIMEFRAME,
      updatedAt: pairState.updatedAt,
      candles: pairState.candles.map((candle) => ({
        time: Math.floor(Number(candle.openTime || 0) / 1000),
        open: Number(candle.open || 0),
        high: Number(candle.high || 0),
        low: Number(candle.low || 0),
        close: Number(candle.close || 0),
        volume: Number(candle.volume || 0),
      })),
      ema50: pairState.emaSeries
        .map((value, index) => (value ? { time: Math.floor(Number(pairState.candles[index].openTime || 0) / 1000), value } : null))
        .filter(Boolean),
      supportLevel: signal?.supportLevel || pairState.supportLevel || null,
      resistanceLevel: signal?.resistanceLevel || pairState.resistanceLevel || null,
      entryPrice: signal?.entryPrice || Number(pairState.candles[pairState.candles.length - 1]?.close || 0),
      stopLoss: signal?.stopLoss || null,
      takeProfit: signal?.takeProfit || null,
      signal,
    };
  }

  handleKline({ pair, candle }) {
    const existingState = this.store.getPairState(pair);
    const candles = Array.isArray(existingState?.candles) ? [...existingState.candles] : [];
    const normalized = normalizeIncomingCandle(candle);
    const last = candles[candles.length - 1];

    if (last && Number(last.openTime || 0) === Number(normalized.openTime || 0)) {
      candles[candles.length - 1] = normalized;
    } else {
      candles.push(normalized);
    }

    const boundedCandles = candles.slice(-SIGNAL_HISTORY_LIMIT);
    const nextState = this.buildPairState(pair, boundedCandles);
    this.store.upsertPairState(pair, nextState);

    if (normalized.isClosed) {
      const nextSignal = this.evaluatePair(nextState);
      if (nextSignal) {
        this.store.recordSignal(nextSignal);
        this.emit("signal", nextSignal);
      }
    }
  }

  buildPairState(pair, candles) {
    const emaSeries = calculateEmaSeries(candles, 50);
    const rsiSeries = calculateRsiSeries(candles, 14);
    const { support, resistance } = getRollingLevels(candles, LEVEL_LOOKBACK);

    return {
      pair,
      candles,
      emaSeries,
      rsiSeries,
      supportLevel: toFixedNumber(support),
      resistanceLevel: toFixedNumber(resistance),
      averageVolume: getAverageVolume(candles, 20),
      updatedAt: new Date().toISOString(),
    };
  }

  evaluatePair(pairState) {
    const candles = pairState.candles || [];
    if (candles.length < 60) {
      return null;
    }

    const lastCandle = candles[candles.length - 1];
    const timestamp = Number(lastCandle.closeTime || lastCandle.openTime || Date.now());
    if (!this.store.canEmit(pairState.pair, timestamp)) {
      return null;
    }

    const context = {
      pair: pairState.pair,
      candles,
      emaSeries: pairState.emaSeries,
      rsiSeries: pairState.rsiSeries,
      supportLevel: pairState.supportLevel,
      resistanceLevel: pairState.resistanceLevel,
      averageVolume: pairState.averageVolume,
      timestamp,
    };

    const candidates = [
      evaluateBreakoutConfirmation(context),
      evaluateSupportTouch(context),
      evaluateEmaRsiPullback(context),
      evaluateResistanceTouch(context),
    ]
      .filter(Boolean)
      .filter((signal) => Number(signal.confidence || 0) >= MIN_CONFIDENCE)
      .sort(sortSignals);

    return candidates[0] || null;
  }
}

module.exports = {
  SignalEngine,
};
