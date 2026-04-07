const {
  ACTIVE_SIGNAL_STATUS,
  DELETED_SIGNAL_STATUS,
  EXPIRED_SIGNAL_STATUS,
  SIGNAL_EXPIRY_MS,
} = require("./config");

function normalizeSignalRecord(signal = {}) {
  const meta = signal.meta && typeof signal.meta === "object" && !Array.isArray(signal.meta)
    ? JSON.parse(JSON.stringify(signal.meta))
    : {};

  return {
    id: String(signal.id || "").trim(),
    pair: String(signal.pair || "").trim().toUpperCase(),
    strategyType: String(signal.strategyType || "").trim().toUpperCase(),
    entryPrice: Number(signal.entryPrice || 0),
    stopLoss: Number(signal.stopLoss || 0),
    takeProfit: Number(signal.takeProfit || 0),
    timestamp: Number(signal.timestamp || 0),
    confidence: signal.confidence ?? null,
    supportLevel: Number(signal.supportLevel || 0) || null,
    resistanceLevel: Number(signal.resistanceLevel || 0) || null,
    meta,
    status: [ACTIVE_SIGNAL_STATUS, DELETED_SIGNAL_STATUS, EXPIRED_SIGNAL_STATUS].includes(
      String(signal.status || "").trim().toLowerCase()
    )
      ? String(signal.status).trim().toLowerCase()
      : ACTIVE_SIGNAL_STATUS,
  };
}

class SignalStore {
  constructor({ maxSignalHistory = 120, cooldownMs = 12 * 60 * 1000, expiryMs = SIGNAL_EXPIRY_MS } = {}) {
    this.maxSignalHistory = maxSignalHistory;
    this.cooldownMs = cooldownMs;
    this.expiryMs = expiryMs;
    this.signals = [];
    this.signalMap = new Map();
    this.pairStates = new Map();
    this.cooldowns = new Map();
  }

  upsertPairState(pair, state) {
    this.pairStates.set(pair, {
      ...state,
      pair,
    });
  }

  getPairState(pair) {
    return this.pairStates.get(pair) || null;
  }

  hydrateSignals(signals = []) {
    this.signals = [...signals]
      .map(normalizeSignalRecord)
      .filter((signal) => signal.id && signal.pair && signal.strategyType && signal.timestamp > 0)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, this.maxSignalHistory);
    this.rebuildIndexes();
  }

  rebuildIndexes() {
    this.signalMap.clear();
    this.cooldowns.clear();

    for (const signal of this.signals) {
      this.signalMap.set(signal.id, signal);
      const previous = Number(this.cooldowns.get(signal.pair) || 0);
      const nextTimestamp = Number(signal.timestamp || 0);
      if (nextTimestamp > previous) {
        this.cooldowns.set(signal.pair, nextTimestamp);
      }
    }
  }

  getSignals(statuses = [ACTIVE_SIGNAL_STATUS]) {
    const allowed = new Set((Array.isArray(statuses) ? statuses : [statuses]).map((status) => String(status).trim().toLowerCase()));
    return this.signals.filter((signal) => allowed.has(String(signal.status || "").trim().toLowerCase()));
  }

  getSignal(signalId) {
    return this.signalMap.get(signalId) || null;
  }

  canEmit(pair, timestamp) {
    const previous = Number(this.cooldowns.get(pair) || 0);
    return Number(timestamp || 0) - previous >= this.cooldownMs;
  }

  recordSignal(signal) {
    const normalized = normalizeSignalRecord({
      ...signal,
      status: ACTIVE_SIGNAL_STATUS,
    });
    this.signals = [normalized, ...this.signals.filter((item) => item.id !== normalized.id)].slice(0, this.maxSignalHistory);
    this.rebuildIndexes();
    return normalized;
  }

  expireSignals(now = Date.now()) {
    const expiredIds = [];
    this.signals = this.signals.map((signal) => {
      if (signal.status !== ACTIVE_SIGNAL_STATUS) {
        return signal;
      }

      const isExpired = Number(now) - Number(signal.timestamp || 0) >= this.expiryMs;
      if (!isExpired) {
        return signal;
      }

      expiredIds.push(signal.id);
      return {
        ...signal,
        status: EXPIRED_SIGNAL_STATUS,
      };
    });

    if (expiredIds.length) {
      this.rebuildIndexes();
    }

    return expiredIds.map((id) => this.signalMap.get(id)).filter(Boolean);
  }

  deleteSignals(signalIds = []) {
    const idSet = new Set((Array.isArray(signalIds) ? signalIds : []).map((item) => String(item || "").trim()).filter(Boolean));
    if (!idSet.size) {
      return [];
    }

    const deletedIds = [];
    this.signals = this.signals.map((signal) => {
      if (!idSet.has(signal.id) || signal.status === DELETED_SIGNAL_STATUS) {
        return signal;
      }

      deletedIds.push(signal.id);
      return {
        ...signal,
        status: DELETED_SIGNAL_STATUS,
      };
    });

    if (deletedIds.length) {
      this.rebuildIndexes();
    }

    return deletedIds.map((id) => this.signalMap.get(id)).filter(Boolean);
  }

  getStoredSignals() {
    return [...this.signals];
  }
}

module.exports = {
  SignalStore,
};
