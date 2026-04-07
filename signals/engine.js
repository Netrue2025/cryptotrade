const EventEmitter = require("node:events");

const { calculateEmaSeries, getAverageVolume, getRollingLevels, toFixedNumber } = require("../indicators/market-indicators");
const { getCandles: getBinanceCandles } = require("../lib/binance");
const { getCandles: getBybitCandles } = require("../lib/bybit");
const { DEFAULT_SHORT_SWING_SETTINGS, normalizeShortSwingSettings } = require("../strategies/short-swing-config");
const { evaluateShortSwingSpotDetailed } = require("../strategies/short-swing-spot");
const {
  ACTIVE_SIGNAL_STATUS,
  LEVEL_LOOKBACK,
  MAX_SIGNAL_HISTORY,
  MIN_CONFIDENCE,
  SIGNAL_COOLDOWN_MS,
  SIGNAL_EXPIRY_MS,
  SIGNAL_HISTORY_LIMIT,
  SIGNAL_PAIRS,
  SIGNAL_TIMEFRAME,
  SUPPORTED_SIGNAL_TIMEFRAMES,
} = require("./config");
const { SignalStore } = require("./store");
const { BinanceSignalStream } = require("../websocket/binance-signal-stream");

const STRATEGY_PRIORITY = {
  SWING_SPOT: 5,
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
    isClosed: candle.isClosed === undefined ? true : !!candle.isClosed,
  };
}

class SignalEngine extends EventEmitter {
  constructor({ timeframe } = {}) {
    super();
    this.store = new SignalStore({
      maxSignalHistory: MAX_SIGNAL_HISTORY,
      cooldownMs: SIGNAL_COOLDOWN_MS,
      expiryMs: SIGNAL_EXPIRY_MS,
    });
    this.timeframe = this.normalizeTimeframe(timeframe);
    this.stream = this.createStream(this.timeframe);
    this.started = false;
    this.marketContextCache = new Map();
    this.marketContextInflight = new Map();
    this.strategySettings = normalizeShortSwingSettings(DEFAULT_SHORT_SWING_SETTINGS, DEFAULT_SHORT_SWING_SETTINGS);
    this.boundOnKline = (payload) => {
      void this.handleKline(payload);
    };
    this.boundOnStatus = (status) => this.emit("status", status);
    this.boundOnError = (error) => this.emit("status", { ok: false, message: error.message || "Signal engine error." });
  }

  normalizeTimeframe(timeframe) {
    const value = String(timeframe || "").trim();
    return SUPPORTED_SIGNAL_TIMEFRAMES.includes(value) ? value : SIGNAL_TIMEFRAME;
  }

  isSupportedTimeframe(timeframe) {
    return SUPPORTED_SIGNAL_TIMEFRAMES.includes(String(timeframe || "").trim());
  }

  createStream(timeframe) {
    return new BinanceSignalStream({
      pairs: SIGNAL_PAIRS,
      interval: timeframe,
    });
  }

  async seedPairStates(stream = this.stream) {
    const seedMap = await stream.seedCandles(SIGNAL_HISTORY_LIMIT);
    for (const pair of SIGNAL_PAIRS) {
      const candles = (seedMap.get(pair) || []).map(normalizeIncomingCandle);
      this.store.upsertPairState(pair, this.buildPairState(pair, candles));
    }
  }

  async start() {
    if (this.started) {
      return;
    }

    await this.seedPairStates();
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
    return this.store.getSignals([ACTIVE_SIGNAL_STATUS]).sort(sortSignals);
  }

  getStoredSignals() {
    return this.store.getStoredSignals().sort(sortSignals);
  }

  getTimeframe() {
    return this.timeframe;
  }

  getStrategySettings() {
    return { ...this.strategySettings };
  }

  setStrategySettings(settings = {}) {
    this.strategySettings = normalizeShortSwingSettings(settings, DEFAULT_SHORT_SWING_SETTINGS);
    this.emit("snapshot", this.getSnapshot());
    return this.getStrategySettings();
  }

  async setTimeframe(timeframe) {
    if (timeframe !== undefined && timeframe !== null && String(timeframe).trim() && !this.isSupportedTimeframe(timeframe)) {
      throw new Error(`Unsupported timeframe. Use ${SUPPORTED_SIGNAL_TIMEFRAMES.join(" or ")}.`);
    }

    const nextTimeframe = this.normalizeTimeframe(timeframe);
    if (nextTimeframe === this.timeframe) {
      return this.getSnapshot();
    }

    const wasStarted = this.started;
    if (wasStarted) {
      this.stream.off("kline", this.boundOnKline);
      this.stream.off("status", this.boundOnStatus);
      this.stream.off("error", this.boundOnError);
      this.stream.stop();
      this.started = false;
    }

    this.stream = this.createStream(nextTimeframe);
    this.timeframe = nextTimeframe;
    await this.seedPairStates();

    if (wasStarted) {
      this.stream.on("kline", this.boundOnKline);
      this.stream.on("status", this.boundOnStatus);
      this.stream.on("error", this.boundOnError);
      this.stream.start();
      this.started = true;
    }

    this.emit("status", {
      ok: true,
      message: `Signal timeframe switched to ${nextTimeframe}.`,
    });
    this.emit("snapshot", this.getSnapshot());
    return this.getSnapshot();
  }

  hydrateSignals(signals = []) {
    this.store.hydrateSignals(signals);
  }

  expireSignals(now = Date.now()) {
    const expired = this.store.expireSignals(now);
    if (expired.length) {
      this.emit("snapshot", this.getSnapshot());
    }
    return expired;
  }

  deleteSignals(signalIds = []) {
    const deleted = this.store.deleteSignals(signalIds);
    if (deleted.length) {
      this.emit("snapshot", this.getSnapshot());
    }
    return deleted;
  }

  getSnapshot() {
    return {
      timeframe: this.timeframe,
      supportedTimeframes: SUPPORTED_SIGNAL_TIMEFRAMES,
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
      timeframe: this.timeframe,
      updatedAt: pairState.updatedAt,
      candles: pairState.candles.map((candle) => ({
        time: Math.floor(Number(candle.openTime || 0) / 1000),
        open: Number(candle.open || 0),
        high: Number(candle.high || 0),
        low: Number(candle.low || 0),
        close: Number(candle.close || 0),
        volume: Number(candle.volume || 0),
      })),
      ema20: pairState.ema20Series
        .map((value, index) => (value ? { time: Math.floor(Number(pairState.candles[index].openTime || 0) / 1000), value } : null))
        .filter(Boolean),
      ema50: pairState.ema50Series
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

  async handleKline({ pair, candle }) {
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
      try {
        const nextSignal = await this.evaluatePair(nextState);
        if (nextSignal) {
          const recordedSignal = this.store.recordSignal(nextSignal);
          this.emit("signal", recordedSignal);
          this.emit("snapshot", this.getSnapshot());
        }
      } catch (error) {
        this.emit("status", {
          ok: false,
          message: `${pair} strategy evaluation failed: ${error.message || "Unknown error."}`,
        });
      }
    }
  }

  buildPairState(pair, candles) {
    const ema20Series = calculateEmaSeries(candles, 20);
    const ema50Series = calculateEmaSeries(candles, 50);
    const ema200Series = calculateEmaSeries(candles, 200);
    const { support, resistance } = getRollingLevels(candles, LEVEL_LOOKBACK);

    return {
      pair,
      candles,
      ema20Series,
      ema50Series,
      ema200Series,
      supportLevel: toFixedNumber(support),
      resistanceLevel: toFixedNumber(resistance),
      averageVolume: getAverageVolume(candles, 20),
      updatedAt: new Date().toISOString(),
    };
  }

  async getMarketCandles(symbol, interval, limit) {
    const cacheKey = `${symbol}:${interval}:${limit}`;
    const cached = this.marketContextCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt < 20_000) {
      return cached.value;
    }

    if (this.marketContextInflight.has(cacheKey)) {
      return this.marketContextInflight.get(cacheKey);
    }

    const pending = (async () => {
      let candles = [];
      try {
        candles = await getBinanceCandles(symbol, interval, limit, false);
      } catch {
        candles = [];
      }

      if (!Array.isArray(candles) || candles.length < Math.min(limit, 24)) {
        const fallback = await getBybitCandles(symbol, interval, limit, false).catch(() => []);
        if (Array.isArray(fallback) && fallback.length > candles.length) {
          candles = fallback;
        }
      }

      const normalized = (candles || []).map(normalizeIncomingCandle);
      this.marketContextCache.set(cacheKey, {
        value: normalized,
        updatedAt: Date.now(),
      });
      return normalized;
    })().finally(() => {
      this.marketContextInflight.delete(cacheKey);
    });

    this.marketContextInflight.set(cacheKey, pending);
    return pending;
  }

  async evaluatePair(pairState) {
    const evaluation = await this.evaluatePairDebug(pairState);
    return evaluation.signal;
  }

  async evaluatePairDebug(pairState) {
    const candles = pairState.candles || [];
    if (candles.length < 220) {
      return {
        pair: pairState.pair,
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

    const lastCandle = candles[candles.length - 1];
    const timestamp = Number(lastCandle.closeTime || lastCandle.openTime || Date.now());
    const btcPairState = this.store.getPairState("BTCUSDT");
    const [trendCandles, relativeStrengthCandles, btcRelativeStrengthCandles] = await Promise.all([
      this.getMarketCandles(pairState.pair, "1h", 260),
      this.getMarketCandles(pairState.pair, "4h", 12),
      this.getMarketCandles("BTCUSDT", "4h", 12),
    ]);

    const evaluation = evaluateShortSwingSpotDetailed({
      pair: pairState.pair,
      entryCandles: candles,
      trendCandles,
      btcEntryCandles: btcPairState?.candles || [],
      relativeStrengthCandles,
      btcRelativeStrengthCandles,
      timestamp,
      settings: this.strategySettings,
    });

    const canEmit = this.store.canEmit(pairState.pair, timestamp);
    const confidence = Number(evaluation?.signal?.confidence || evaluation?.confidence || 0);
    if (!canEmit) {
      return {
        ...evaluation,
        eligible: false,
        signal: null,
        failureReasons: [...(evaluation.failureReasons || []), "Cooldown is still active for this pair."],
      };
    }
    if (!evaluation.signal || confidence < MIN_CONFIDENCE) {
      return {
        ...evaluation,
        eligible: false,
        signal: null,
        failureReasons: confidence > 0 && confidence < MIN_CONFIDENCE
          ? [...(evaluation.failureReasons || []), `Confidence ${confidence}% is below the ${MIN_CONFIDENCE}% threshold.`]
          : evaluation.failureReasons || [],
      };
    }

    return evaluation;
  }

  async getStrategyDebugSnapshot() {
    const evaluations = await Promise.all(
      SIGNAL_PAIRS.map(async (pair) => {
        const pairState = this.store.getPairState(pair);
        if (!pairState) {
          return {
            pair,
            eligible: false,
            signal: null,
            confidence: 0,
            checks: {
              hasEnoughHistory: false,
            },
            metrics: {},
            failureReasons: ["Signal state has not been seeded yet."],
          };
        }
        return this.evaluatePairDebug(pairState);
      })
    );

    return {
      generatedAt: new Date().toISOString(),
      settings: this.getStrategySettings(),
      evaluations: evaluations.sort((a, b) => {
        if (a.eligible !== b.eligible) {
          return a.eligible ? -1 : 1;
        }
        return Number(b.confidence || 0) - Number(a.confidence || 0);
      }),
    };
  }
}

module.exports = {
  SignalEngine,
};
