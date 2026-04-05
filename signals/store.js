class SignalStore {
  constructor({ maxSignalHistory = 120, cooldownMs = 12 * 60 * 1000 } = {}) {
    this.maxSignalHistory = maxSignalHistory;
    this.cooldownMs = cooldownMs;
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

  getSignals() {
    return [...this.signals];
  }

  getSignal(signalId) {
    return this.signalMap.get(signalId) || null;
  }

  canEmit(pair, timestamp) {
    const previous = Number(this.cooldowns.get(pair) || 0);
    return Number(timestamp || 0) - previous >= this.cooldownMs;
  }

  recordSignal(signal) {
    this.cooldowns.set(signal.pair, Number(signal.timestamp || Date.now()));
    this.signals = [signal, ...this.signals.filter((item) => item.id !== signal.id)].slice(0, this.maxSignalHistory);
    this.signalMap.set(signal.id, signal);
    return signal;
  }
}

module.exports = {
  SignalStore,
};
