const EventEmitter = require("node:events");
const crypto = require("node:crypto");

const { SIGNAL_EVENTS } = require("../events/signalBus");
const { evaluateSupportStrategy } = require("../strategies/supportStrategy");
const { evaluateBreakoutStrategy } = require("../strategies/breakoutStrategy");
const { evaluateEmaRsiStrategy } = require("../strategies/emaRsiStrategy");
const { evaluateProStrategy } = require("../strategies/proStrategy");
const { evaluateTestPulseStrategy } = require("../strategies/testPulseStrategy");
const { calculateEmaSeries, lastDefined, normalizeCandles } = require("../utils/candleMath");

const STRATEGY_EVALUATORS = [
  evaluateSupportStrategy,
  evaluateBreakoutStrategy,
  evaluateEmaRsiStrategy,
  evaluateProStrategy,
  evaluateTestPulseStrategy,
];

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toConfidencePercent(value) {
  return Number((Number(value || 0) * 100).toFixed(2));
}

function normalizeStoredConfidence(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric <= 1 ? toConfidencePercent(numeric) : Number(numeric.toFixed(2));
}

function buildUniqueReasons(evaluations = []) {
  return [...new Set(
    evaluations
      .map((evaluation) => String(evaluation?.reason || "").trim())
      .filter(Boolean)
  )];
}

function normalizeHydratedSignal(signal = {}, config = {}) {
  const pair = String(signal.symbol || signal.pair || "").trim().toUpperCase();
  const strategy = String(signal.strategy || signal.strategyType || "").trim().toUpperCase();
  const timestamp = Number(signal.timestamp || Date.parse(signal.createdAt) || Date.now());
  const timeframe = config.supportedTimeframes?.includes(String(signal.timeframe || "").trim())
    ? String(signal.timeframe).trim()
    : config.defaultTimeframe;

  if (!pair || !strategy || !Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  const createdAt = signal.createdAt || new Date(timestamp).toISOString();
  const expiresAt = signal.expiresAt || new Date(timestamp + Number(config.signalTtlMs || 0)).toISOString();
  const entryPrice = Number((signal.entry ?? signal.entryPrice) || 0);
  const stopLoss = Number(signal.stopLoss || 0);
  const takeProfit = Number(signal.takeProfit || 0);
  const supportLevel = Number(signal.supportLevel || signal?.meta?.supportLevel || 0) || null;
  const resistanceLevel = Number(signal.resistanceLevel || signal?.meta?.resistanceLevel || 0) || null;
  const meta = signal.meta && typeof signal.meta === "object" && !Array.isArray(signal.meta)
    ? cloneValue(signal.meta)
    : {};

  if (supportLevel && meta.supportLevel === undefined) {
    meta.supportLevel = supportLevel;
  }
  if (resistanceLevel && meta.resistanceLevel === undefined) {
    meta.resistanceLevel = resistanceLevel;
  }

  const signalKey = String(signal.signalKey || `${pair}:${timeframe}:${strategy}:${timestamp}`).trim();

  return {
    id: String(signal.id || crypto.createHash("sha1").update(signalKey).digest("hex")).trim(),
    signalKey,
    symbol: pair,
    pair,
    type: String(signal.type || "BUY").trim().toUpperCase() || "BUY",
    strategy,
    strategyType: strategy,
    confidence: normalizeStoredConfidence(signal.confidence),
    entry: entryPrice,
    entryPrice,
    stopLoss,
    takeProfit,
    timeframe,
    createdAt,
    timestamp,
    expiresAt,
    meta,
  };
}

class SignalEngine extends EventEmitter {
  constructor({
    config,
    marketDataService,
    signalModel,
    eventBus,
    telegramService,
    autoTradeService,
    tradeLearning,
    logger = console,
  } = {}) {
    super();
    this.config = config;
    this.marketDataService = marketDataService;
    this.signalModel = signalModel;
    this.eventBus = eventBus;
    this.telegramService = telegramService;
    this.autoTradeService = autoTradeService;
    this.tradeLearning = tradeLearning;
    this.logger = logger;
    this.timeframe = config.defaultTimeframe;
    this.started = false;
    this.scanTimer = null;
    this.scanPromise = null;
    this.status = {
      ok: false,
      message: "Signal engine is idle.",
      updatedAt: new Date().toISOString(),
    };
    this.lastEvaluations = new Map();
    this.snapshot = {
      timeframe: this.timeframe,
      supportedTimeframes: config.supportedTimeframes,
      pairs: config.symbols,
      signals: [],
      generatedAt: new Date().toISOString(),
      streamStatus: "IDLE",
      statusMessage: "Signal engine is idle.",
    };
  }

  async init() {
    await this.signalModel.init();
    await this.telegramService.init();
    await this.tradeLearning.init();
    await this.refreshSnapshot();
  }

  normalizeTimeframe(timeframe) {
    const normalized = String(timeframe || "").trim();
    return this.config.supportedTimeframes.includes(normalized) ? normalized : this.config.defaultTimeframe;
  }

  async setTimeframe(timeframe, { scan = true } = {}) {
    const nextTimeframe = this.normalizeTimeframe(timeframe);
    this.timeframe = nextTimeframe;
    if (scan) {
      await this.runScan({ reason: "timeframe_changed", force: true });
    } else {
      await this.refreshSnapshot();
    }
    return this.getSnapshot();
  }

  getTimeframe() {
    return this.timeframe;
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      timeframe: this.timeframe,
      generatedAt: new Date().toISOString(),
      streamStatus: this.started ? "LIVE" : "IDLE",
      statusMessage: this.status.message,
    };
  }

  getStoredSignals() {
    return [...(this.snapshot.signals || [])];
  }

  async expireSignals(now = Date.now()) {
    const expiredSignals = this.getStoredSignals().filter((signal) => {
      const expiresAt = Date.parse(signal.expiresAt || "");
      const signalExpiresAt = Number.isFinite(expiresAt)
        ? expiresAt
        : Number(signal.timestamp || 0) + Number(this.config.signalTtlMs || 0);
      return signalExpiresAt > 0 && signalExpiresAt <= Number(now || Date.now());
    });

    if (!expiredSignals.length) {
      return [];
    }

    await this.signalModel.deleteMany(expiredSignals.map((signal) => signal.id));
    await this.refreshSnapshot();
    return expiredSignals;
  }

  async hydrateSignals(signals = []) {
    const hydratedSignals = (Array.isArray(signals) ? signals : [])
      .map((signal) => normalizeHydratedSignal(signal, this.config))
      .filter(Boolean);

    for (const signal of hydratedSignals) {
      await this.signalModel.upsert(signal);
    }

    await this.refreshSnapshot();
    return this.getStoredSignals();
  }

  async getStrategyDebugSnapshot() {
    const evaluations = await Promise.all(
      this.config.symbols.map(async (symbol) => {
        try {
          const candles = await this.marketDataService.getCandles(symbol, this.timeframe, this.config.historyLimit);
          const strategyEvaluations = STRATEGY_EVALUATORS.map((evaluate) => evaluate({
            symbol,
            timeframe: this.timeframe,
            candles,
            config: this.config,
          }));
          const debugEntry = this.buildDebugEntry({
            symbol,
            timeframe: this.timeframe,
            candles,
            evaluations: strategyEvaluations,
          });
          this.lastEvaluations.set(symbol, debugEntry);
          return debugEntry;
        } catch (error) {
          const fallback = this.lastEvaluations.get(symbol);
          return fallback || {
            pair: symbol,
            timeframe: this.timeframe,
            eligible: false,
            signal: null,
            confidence: 0,
            checks: {
              hasEnoughHistory: false,
            },
            metrics: {},
            failureReasons: [error.message || "Strategy debug data could not be generated."],
          };
        }
      })
    );

    return {
      generatedAt: new Date().toISOString(),
      timeframe: this.timeframe,
      strategyThresholds: cloneValue(this.config.strategyThresholds),
      evaluations: evaluations.sort((left, right) => {
        if (left.eligible !== right.eligible) {
          return left.eligible ? -1 : 1;
        }
        return Number(right.confidence || 0) - Number(left.confidence || 0);
      }),
    };
  }

  setStatus(ok, message) {
    this.status = {
      ok,
      message,
      updatedAt: new Date().toISOString(),
    };
    this.emit("status", this.status);
    this.eventBus.emit(SIGNAL_EVENTS.STATUS_UPDATED, this.status);
  }

  async refreshSnapshot() {
    const activeSignals = await this.signalModel.listActive({ timeframe: this.timeframe });
    const signals = this.config.testStrategy?.enabled
      ? activeSignals
      : activeSignals.filter((signal) => !signal?.meta?.testOnly);
    this.snapshot = {
      timeframe: this.timeframe,
      supportedTimeframes: this.config.supportedTimeframes,
      pairs: this.config.symbols,
      signals,
      generatedAt: new Date().toISOString(),
      streamStatus: this.started ? "LIVE" : "IDLE",
      statusMessage: this.status.message,
    };
    this.emit("snapshot", this.snapshot);
    this.eventBus.emit(SIGNAL_EVENTS.SNAPSHOT_UPDATED, this.snapshot);
    return this.snapshot;
  }

  buildSignalRecord(symbol, timeframe, evaluation, candle) {
    const signalTimestamp = Number(evaluation.signalTimestamp || candle.openTime || Date.now());
    const createdAt = new Date(signalTimestamp).toISOString();
    const expiresAt = new Date(Date.parse(createdAt) + this.config.signalTtlMs).toISOString();
    const signalKey = String(evaluation.signalKey || `${symbol}:${timeframe}:${evaluation.strategy}:${signalTimestamp}`);
    const extraMeta = evaluation.meta && typeof evaluation.meta === "object" && !Array.isArray(evaluation.meta)
      ? cloneValue(evaluation.meta)
      : {};
    return {
      id: crypto.createHash("sha1").update(signalKey).digest("hex"),
      signalKey,
      symbol,
      pair: symbol,
      type: "BUY",
      strategy: evaluation.strategy,
      strategyType: evaluation.strategy,
      confidence: toConfidencePercent(evaluation.confidence),
      entry: evaluation.entry,
      entryPrice: evaluation.entry,
      stopLoss: evaluation.stopLoss,
      takeProfit: evaluation.takeProfit,
      timeframe,
      createdAt,
      timestamp: signalTimestamp,
      expiresAt,
      meta: {
        confidenceScore: Number(evaluation.confidence.toFixed(4)),
        reason: evaluation.reason,
        details: evaluation.details || {},
        supportLevel: evaluation.supportLevel || null,
        resistanceLevel: evaluation.resistanceLevel || null,
        ...extraMeta,
      },
    };
  }

  buildDebugEntry({ symbol, timeframe, candles = [], evaluations = [] }) {
    const normalizedCandles = normalizeCandles(candles);
    const lastCandle = normalizedCandles[normalizedCandles.length - 1] || null;
    const matchedEvaluations = evaluations
      .filter((evaluation) => evaluation?.matched)
      .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0));
    const bestEvaluation = matchedEvaluations[0] || null;

    const ema50Series = calculateEmaSeries(normalizedCandles, 50);
    const ema200Series = calculateEmaSeries(normalizedCandles, 200);
    const ema50 = lastDefined(ema50Series);
    const ema200 = lastDefined(ema200Series);
    const lastClose = Number(lastCandle?.close || 0);
    const previousCandle = normalizedCandles[normalizedCandles.length - 2] || null;
    const recentCandles = normalizedCandles.slice(-12);
    const lookbackReference = recentCandles[Math.max(0, recentCandles.length - 4)] || null;
    const breakoutEvaluation = evaluations.find((evaluation) => evaluation.strategy === "BREAKOUT") || null;
    const supportEvaluation = evaluations.find((evaluation) => evaluation.strategy === "SUPPORT") || null;
    const emaRsiEvaluation = evaluations.find((evaluation) => evaluation.strategy === "EMA_RSI") || null;
    const proEvaluation = evaluations.find((evaluation) => evaluation.strategy === "PRO") || null;
    const recentAverageVolume = recentCandles.length
      ? recentCandles.reduce((sum, candle) => sum + Number(candle.volume || 0), 0) / recentCandles.length
      : 0;

    return {
      pair: symbol,
      timeframe,
      eligible: !!bestEvaluation,
      signal: bestEvaluation
        ? {
            pair: symbol,
            strategyType: bestEvaluation.strategy,
            entryPrice: Number(bestEvaluation.entry || 0),
            stopLoss: Number(bestEvaluation.stopLoss || 0),
            takeProfit: Number(bestEvaluation.takeProfit || 0),
            confidence: toConfidencePercent(bestEvaluation.confidence),
          }
        : null,
      confidence: bestEvaluation ? toConfidencePercent(bestEvaluation.confidence) : 0,
      checks: {
        hasEnoughHistory: normalizedCandles.length >= 60,
        trendPriceAbove200: Number.isFinite(ema200) ? lastClose > ema200 : false,
        trendEmaAligned: Number.isFinite(ema50) && Number.isFinite(ema200) ? ema50 > ema200 : false,
        higherHighsHigherLows: !!(
          recentCandles.length >= 4
          && lookbackReference
          && Number(lastCandle?.high || 0) >= Number(lookbackReference.high || 0)
          && Number(lastCandle?.low || 0) >= Number(lookbackReference.low || 0)
        ),
        pullbackDetected: !!(supportEvaluation?.matched || emaRsiEvaluation?.matched),
        breakoutClose: !!(
          breakoutEvaluation?.matched
          || (previousCandle && lastCandle && Number(lastCandle.close || 0) > Number(previousCandle.high || 0))
        ),
        breakoutPreviousReset: normalizedCandles.length >= 21,
        breakoutVolume: !!(
          Number(breakoutEvaluation?.details?.volumeSpike || 0) >= 1.2
          || (recentAverageVolume > 0 && Number(lastCandle?.volume || 0) >= recentAverageVolume * 1.1)
        ),
        relativeStrength: !!(proEvaluation?.matched || emaRsiEvaluation?.matched || supportEvaluation?.matched),
        btcGuardPassed: true,
      },
      metrics: {
        entryPrice: bestEvaluation?.entry ? Number(bestEvaluation.entry) : (lastClose || null),
        relativeStrength4h: null,
        btcDrop15m: null,
        ema50: Number.isFinite(ema50) ? Number(ema50.toFixed(6)) : null,
        ema200: Number.isFinite(ema200) ? Number(ema200.toFixed(6)) : null,
      },
      failureReasons: bestEvaluation ? [] : buildUniqueReasons(evaluations),
    };
  }

  async emitTestPulseSignal(timeframe) {
    const evaluation = evaluateTestPulseStrategy({
      symbol: this.config.testStrategy?.symbol,
      timeframe,
      candles: [],
      config: this.config,
    });

    if (!evaluation?.matched) {
      return null;
    }

    const signal = this.buildSignalRecord(this.config.testStrategy.symbol, timeframe, evaluation, {
      openTime: evaluation.signalTimestamp,
    });
    const isExistingSignal = this.getStoredSignals().some((item) => item.id === signal.id);
    await this.signalModel.upsert(signal);
    await this.refreshSnapshot();
    if (isExistingSignal) {
      return signal;
    }

    this.logger.info(`Signal generated for ${signal.symbol} ${timeframe} ${evaluation.strategy} at confidence ${evaluation.confidence}`);
    this.emit("signal", signal);
    this.eventBus.emit(SIGNAL_EVENTS.SIGNAL_GENERATED, signal);
    this.telegramService.dispatchSignal(signal);
    this.logger.info(`Auto trade intentionally skipped for test signal ${signal.symbol} ${signal.strategy}.`);
    return signal;
  }

  async handleMarketData({ symbol, timeframe, candles = [] }) {
    const latestCandle = candles[candles.length - 1];
    if (!latestCandle) {
      this.lastEvaluations.set(symbol, {
        pair: symbol,
        timeframe,
        eligible: false,
        signal: null,
        confidence: 0,
        checks: {
          hasEnoughHistory: false,
        },
        metrics: {},
        failureReasons: ["No candle data is available yet."],
      });
      return [];
    }

    const evaluations = STRATEGY_EVALUATORS.map((evaluate) => evaluate({
      symbol,
      timeframe,
      candles,
      config: this.config,
    }));
    this.lastEvaluations.set(symbol, this.buildDebugEntry({ symbol, timeframe, candles, evaluations }));
    const matchedSignals = [];

    for (const evaluation of evaluations) {
      if (!evaluation.matched) {
        this.logger.debug(`${symbol} ${timeframe} ${evaluation.strategy} skipped: ${evaluation.reason}`);
        continue;
      }

      const threshold = Number(this.config.strategyThresholds[evaluation.strategy] || this.config.minConfidence);
      if (Number(evaluation.confidence || 0) < threshold) {
        this.logger.debug(`${symbol} ${timeframe} ${evaluation.strategy} below threshold: ${evaluation.confidence}`);
        continue;
      }

      const signal = this.buildSignalRecord(symbol, timeframe, evaluation, latestCandle);
      const isExistingSignal = this.getStoredSignals().some((item) => item.id === signal.id);
      await this.signalModel.upsert(signal);
      matchedSignals.push(signal);
      if (isExistingSignal) {
        continue;
      }
      this.logger.info(`Signal generated for ${symbol} ${timeframe} ${evaluation.strategy} at confidence ${evaluation.confidence}`);
      this.emit("signal", signal);
      this.eventBus.emit(SIGNAL_EVENTS.SIGNAL_GENERATED, signal);
      this.telegramService.dispatchSignal(signal);
      if (signal.meta?.testOnly) {
        this.logger.info(`Auto trade intentionally skipped for test signal ${signal.symbol} ${signal.strategy}.`);
      } else {
        void this.autoTradeService.execute(signal).catch((error) => {
          this.logger.error(`Auto trade failed for ${signal.symbol}:`, error.message || error);
        });
      }
    }

    return matchedSignals;
  }

  async runScan({ reason = "scan", force = false } = {}) {
    if (this.scanPromise) {
      try {
        await this.scanPromise;
      } catch (error) {
        this.logger.error("Previous signal scan failed:", error.message || error);
      }

      if (!force) {
        return this.getSnapshot();
      }
    }

    const pendingScan = this.scanMarket({ reason })
      .finally(() => {
        if (this.scanPromise === pendingScan) {
          this.scanPromise = null;
        }
      });

    this.scanPromise = pendingScan;
    return pendingScan;
  }

  async scanMarket({ reason = "scan" } = {}) {
    this.setStatus(true, `Scanning ${this.config.symbols.length} pairs on ${this.timeframe} (${reason}).`);

    if (this.config.testStrategy?.enabled) {
      try {
        await this.emitTestPulseSignal(this.timeframe);
      } catch (error) {
        this.logger.error("Test pulse signal generation failed:", error.message || error);
      }
    }

    const symbols = [...this.config.symbols];
    const scanConcurrency = Math.max(1, Math.floor(Number(this.config.scanConcurrency || 1)));

    for (let index = 0; index < symbols.length; index += scanConcurrency) {
      const batch = symbols.slice(index, index + scanConcurrency);
      await Promise.all(
        batch.map(async (symbol) => {
          try {
            const candles = await this.marketDataService.getCandles(symbol, this.timeframe, this.config.historyLimit);
            await this.handleMarketData({ symbol, timeframe: this.timeframe, candles });
          } catch (error) {
            this.logger.error(`Signal scan failed for ${symbol} ${this.timeframe}:`, error.message || error);
          }
        })
      );
    }

    await this.refreshSnapshot();
    this.setStatus(true, `Signal scan complete on ${this.timeframe}.`);
    return this.getSnapshot();
  }

  async start({ awaitInitialScan = true } = {}) {
    if (this.started) {
      return this;
    }

    await this.init();
    this.started = true;
    const initialScan = this.runScan({ reason: "startup" });

    if (awaitInitialScan) {
      await initialScan;
    } else {
      void initialScan.catch((error) => {
        this.setStatus(false, error.message || "Signal scan failed.");
      });
    }

    this.scanTimer = setInterval(() => {
      void this.runScan().catch((error) => {
        this.setStatus(false, error.message || "Signal scan failed.");
      });
    }, this.config.scanIntervalMs);
    return this;
  }

  stop() {
    clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.started = false;
    this.setStatus(false, "Signal engine stopped.");
  }

  async deleteSignals(signalIds = []) {
    const result = await this.signalModel.deleteMany(signalIds);
    await this.refreshSnapshot();
    return result;
  }

  async getChartSnapshot(symbol, signalId = "") {
    const activeSignal = signalId ? await this.signalModel.getById(signalId) : null;
    const targetSymbol = String(symbol || activeSignal?.symbol || "").trim().toUpperCase();
    if (!targetSymbol) {
      return null;
    }

    return this.marketDataService.buildChart(targetSymbol, this.timeframe, activeSignal);
  }
}

module.exports = {
  SignalEngine,
};
