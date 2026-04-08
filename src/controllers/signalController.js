class SignalController {
  constructor({ signalEngine, logger = console } = {}) {
    this.signalEngine = signalEngine;
    this.logger = logger;
  }

  async getSnapshot() {
    return this.signalEngine.getSnapshot();
  }

  async getChart({ pair, signalId }) {
    return this.signalEngine.getChartSnapshot(pair, signalId);
  }

  async deleteSignals(signalIds = []) {
    return this.signalEngine.deleteSignals(signalIds);
  }

  async updateTimeframe(timeframe) {
    return this.signalEngine.setTimeframe(timeframe);
  }
}

module.exports = {
  SignalController,
};
