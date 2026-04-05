const TelegramBot = require("node-telegram-bot-api");

const { defaultPreferences } = require("../models/subscriberModel");

function formatPreferenceLabel(key, enabled) {
  const labels = {
    binance: "Binance alerts",
    bybit: "Bybit alerts",
    dailyProfit: "Daily profit alerts",
  };
  return `${enabled ? "✅" : "⬜"} ${labels[key] || key}`;
}

class TelegramService {
  constructor({ token = process.env.TELEGRAM_TRADE_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN, subscriberModel, logger = console } = {}) {
    this.token = String(token || "").trim();
    this.subscriberModel = subscriberModel;
    this.logger = logger;
    this.bot = null;
    this.started = false;
  }

  isEnabled() {
    return !!this.token && !!this.bot;
  }

  buildSettingsKeyboard(preferences = defaultPreferences()) {
    return {
      inline_keyboard: [
        [
          {
            text: formatPreferenceLabel("binance", preferences.binance !== false),
            callback_data: "telegram-pref:binance",
          },
        ],
        [
          {
            text: formatPreferenceLabel("bybit", preferences.bybit !== false),
            callback_data: "telegram-pref:bybit",
          },
        ],
        [
          {
            text: formatPreferenceLabel("dailyProfit", preferences.dailyProfit !== false),
            callback_data: "telegram-pref:dailyProfit",
          },
        ],
      ],
    };
  }

  async start() {
    if (this.started || !this.token) {
      if (!this.token) {
        this.logger.warn("Telegram bot service disabled: TELEGRAM_TRADE_BOT_TOKEN or TELEGRAM_BOT_TOKEN is missing.");
      }
      return this;
    }

    if (this.subscriberModel?.init) {
      await this.subscriberModel.init();
    }

    this.bot = new TelegramBot(this.token, {
      polling: {
        autoStart: true,
        params: {
          timeout: 20,
        },
      },
    });

    this.registerHandlers();
    this.started = true;
    this.logger.log("Telegram bot service started.");
    return this;
  }

  async stop() {
    if (!this.bot) {
      return;
    }

    await this.bot.stopPolling().catch(() => {});
    this.bot = null;
    this.started = false;
  }

  async sendMessage(chatId, text, options = {}) {
    if (!this.bot) {
      throw new Error("Telegram bot is not initialized.");
    }

    return this.bot.sendMessage(chatId, text, {
      disable_web_page_preview: true,
      ...options,
    });
  }

  registerHandlers() {
    this.bot.onText(/^\/start$/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        await this.subscriberModel.subscribe(chatId);
        await this.sendMessage(
          chatId,
          "You are now subscribed to trade alerts.\n\nUse /settings to choose Binance, Bybit, and daily profit notifications.\nUse /stop any time to unsubscribe."
        );
      } catch (error) {
        this.logger.error("Telegram /start failed:", error.message || error);
        await this.sendMessage(chatId, "I could not save your subscription right now. Please try again in a moment.").catch(() => {});
      }
    });

    this.bot.onText(/^\/stop$/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        await this.subscriberModel.unsubscribe(chatId);
        await this.sendMessage(chatId, "You have been unsubscribed from trade alerts. Send /start whenever you want them back.");
      } catch (error) {
        this.logger.error("Telegram /stop failed:", error.message || error);
        await this.sendMessage(chatId, "I could not update your subscription right now. Please try again in a moment.").catch(() => {});
      }
    });

    this.bot.onText(/^\/settings$/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        const subscriber = await this.subscriberModel.subscribe(chatId);
        await this.sendMessage(chatId, "Choose which alerts you want to receive:", {
          reply_markup: this.buildSettingsKeyboard(subscriber?.preferences),
        });
      } catch (error) {
        this.logger.error("Telegram /settings failed:", error.message || error);
        await this.sendMessage(chatId, "I could not load your settings right now. Please try again in a moment.").catch(() => {});
      }
    });

    this.bot.on("callback_query", async (query) => {
      const chatId = query.message?.chat?.id;
      const messageId = query.message?.message_id;
      const data = String(query.data || "");
      if (!chatId || !messageId || !data.startsWith("telegram-pref:")) {
        return;
      }

      const preferenceKey = data.replace("telegram-pref:", "").trim();
      try {
        const subscriber = await this.subscriberModel.togglePreference(chatId, preferenceKey);
        await this.bot.editMessageReplyMarkup(this.buildSettingsKeyboard(subscriber?.preferences), {
          chat_id: chatId,
          message_id: messageId,
        });
        await this.bot.answerCallbackQuery(query.id, {
          text: `${formatPreferenceLabel(
            preferenceKey,
            subscriber?.preferences?.[preferenceKey] !== false
          )}`,
        });
      } catch (error) {
        this.logger.error("Telegram preference toggle failed:", error.message || error);
        await this.bot.answerCallbackQuery(query.id, {
          text: "That setting could not be updated right now.",
          show_alert: false,
        }).catch(() => {});
      }
    });
  }
}

module.exports = {
  TelegramService,
};
