const axios = require("axios");

const { SubscriberModel } = require("../../models/subscriberModel");

class SignalTelegramService {
  constructor({ config, logger = console, subscriberModel = null } = {}) {
    this.config = config;
    this.logger = logger;
    this.subscriberModel = subscriberModel || new SubscriberModel();
    this.queue = [];
    this.flushing = false;
  }

  isEnabled() {
    return !!this.config?.telegram?.token;
  }

  formatSignalMessage(signal) {
    const headline = signal?.meta?.testOnly
      ? `${String(signal.symbol || "").replace(/USDT$/, "/USDT")} TEST BUY SIGNAL`
      : `${String(signal.symbol || "").replace(/USDT$/, "/USDT")} BUY SIGNAL`;
    return [
      headline,
      `Strategy: ${signal.strategy}`,
      `Entry: ${signal.entry}`,
      `SL: ${signal.stopLoss}`,
      `TP: ${signal.takeProfit}`,
      `Confidence: ${Number(signal.confidence || 0).toFixed(2)}`,
      `Timeframe: ${signal.timeframe}`,
    ].join("\n");
  }

  async init() {
    if (this.subscriberModel?.init) {
      await this.subscriberModel.init().catch((error) => {
        this.logger.warn("Signal subscriber store init failed:", error.message || error);
      });
    }
    return this;
  }

  async sendMessage(chatId, text) {
    const url = `https://api.telegram.org/bot${this.config.telegram.token}/sendMessage`;
    return axios.post(url, {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }, {
      timeout: 15000,
      proxy: false,
    });
  }

  async sendWithRetry(chatId, text) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.config.telegram.retryAttempts; attempt += 1) {
      try {
        await this.sendMessage(chatId, text);
        return true;
      } catch (error) {
        lastError = error;
        this.logger.error(`Signal Telegram send failed for chat ${chatId} on attempt ${attempt}:`, error.message || error);
        await new Promise((resolve) => setTimeout(resolve, this.config.telegram.retryDelayMs * attempt));
      }
    }
    throw lastError;
  }

  async flushQueue() {
    if (this.flushing || !this.queue.length) {
      return;
    }

    this.flushing = true;
    try {
      while (this.queue.length) {
        const task = this.queue.shift();
        await task();
      }
    } finally {
      this.flushing = false;
    }
  }

  enqueue(task) {
    this.queue.push(task);
    void this.flushQueue();
  }

  dispatchSignal(signal) {
    if (!this.isEnabled()) {
      return;
    }

    const message = this.formatSignalMessage(signal);
    this.enqueue(async () => {
      const recipientIds = new Set();
      if (this.config.telegram.chatId) {
        recipientIds.add(this.config.telegram.chatId);
      }

      if (this.subscriberModel?.listSubscribed) {
        const subscribers = await this.subscriberModel.listSubscribed().catch(() => []);
        for (const subscriber of subscribers) {
          recipientIds.add(String(subscriber.chatId));
        }
      }

      await Promise.allSettled(
        [...recipientIds].map((chatId) => this.sendWithRetry(chatId, message))
      );
    });
  }
}

module.exports = {
  SignalTelegramService,
};
