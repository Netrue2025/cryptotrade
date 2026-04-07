const axios = require("axios");
const { disableBrokenLocalProxyEnv } = require("../lib/network");

const sentSignalKeys = new Set();

function getStrategyEmoji(type) {
  const value = String(type || "").trim().toUpperCase();
  const map = {
    SUPPORT: "🟦",
    RESISTANCE: "🟧",
    EMA_RSI: "🟪",
    BREAKOUT: "🟩",
    SWING_SPOT: "🟨",
  };
  return map[value] || "🟦";
}

function getStrategyLabel(type) {
  const value = String(type || "").trim().toUpperCase();
  const map = {
    SUPPORT: "SUPPORT",
    RESISTANCE: "RESISTANCE",
    EMA_RSI: "EMA-RSI",
    BREAKOUT: "BREAKOUT",
    SWING_SPOT: "SWING-SPOT",
  };
  return map[value] || value || "SUPPORT";
}

function formatSignalPair(pair) {
  const normalized = String(pair || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("USDT") ? `${normalized.slice(0, -4)}/USDT` : normalized;
}

function getTradingViewSymbol(pair) {
  const normalized = String(pair || "").trim().toUpperCase().replace("/", "");
  return normalized || "";
}

function getSignalKey(signal) {
  if (signal?.id) {
    return String(signal.id);
  }
  return [
    String(signal?.pair || "").trim().toUpperCase(),
    String(signal?.strategyType || "").trim().toUpperCase(),
    Number(signal?.timestamp || 0),
  ].join(":");
}

function normalizeConfidence(confidence) {
  const value = String(confidence || "").trim();
  if (["Low", "Medium", "High"].includes(value)) {
    return value;
  }

  const numeric = Number(confidence);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 80) {
      return "High";
    }
    if (numeric >= 60) {
      return "Medium";
    }
    return "Low";
  }

  return "Medium";
}

function formatTelegramTime(timestamp) {
  const value = Number(timestamp || 0);
  const date = value > 0 ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isValidSignal(signal) {
  if (!signal || typeof signal !== "object") {
    return false;
  }

  const pair = String(signal.pair || "").trim();
  const strategyType = String(signal.strategyType || "").trim().toUpperCase();
  const entryPrice = Number(signal.entryPrice);
  const stopLoss = Number(signal.stopLoss);
  const takeProfit = Number(signal.takeProfit);
  const timestamp = Number(signal.timestamp || 0);

  if (!pair || !strategyType) {
    return false;
  }

  if (!Number.isFinite(entryPrice) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) {
    return false;
  }

  return timestamp > 0;
}

function buildTelegramMessage(signal) {
  const pair = formatSignalPair(signal.pair);
  const strategyLabel = getStrategyLabel(signal.strategyType);
  const strategyEmoji = getStrategyEmoji(signal.strategyType);
  const confidence = normalizeConfidence(signal.confidence);
  const chartSymbol = getTradingViewSymbol(signal.pair);
  const chartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${chartSymbol}`;

  return [
    "🚀 *BUY SIGNAL*",
    "",
    `Pair: ${pair}`,
    `Strategy: ${strategyEmoji} ${strategyLabel}`,
    `Entry: ${signal.entryPrice}`,
    `SL: ${signal.stopLoss}`,
    `TP: ${signal.takeProfit}`,
    signal?.meta?.reason ? `Reason: ${signal.meta.reason}` : null,
    "",
    `Confidence: ${confidence}`,
    `Time: ${formatTelegramTime(signal.timestamp)}`,
    "",
    `[View Chart](${chartUrl})`,
  ].filter(Boolean).join("\n");
}

async function sendTelegramAlert(signal) {
  disableBrokenLocalProxyEnv(console, "Telegram signal alerts");

  const token = String(process.env.TELEGRAM_SIGNAL_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_SIGNAL_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "").trim();

  if (!token || !chatId) {
    console.warn("Telegram alert skipped: TELEGRAM_SIGNAL_BOT_TOKEN/TELEGRAM_BOT_TOKEN or TELEGRAM_SIGNAL_CHAT_ID/TELEGRAM_CHAT_ID is missing.");
    return { ok: false, skipped: true, reason: "missing_credentials" };
  }

  if (!isValidSignal(signal)) {
    console.warn("Telegram alert skipped: malformed signal payload.", signal);
    return { ok: false, skipped: true, reason: "invalid_signal" };
  }

  const signalKey = getSignalKey(signal);
  if (sentSignalKeys.has(signalKey)) {
    return { ok: true, skipped: true, reason: "duplicate_signal" };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const message = buildTelegramMessage(signal);

  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      },
      {
        timeout: 15000,
        proxy: false,
      }
    );

    sentSignalKeys.add(signalKey);
    console.log(`Telegram alert sent for ${formatSignalPair(signal.pair)} ${getStrategyLabel(signal.strategyType)}.`);
    return {
      ok: true,
      skipped: false,
      messageId: response.data?.result?.message_id || null,
    };
  } catch (error) {
    const detail =
      error.response?.data?.description ||
      error.response?.data?.message ||
      error.message ||
      "Unknown Telegram API error.";
    console.error(`Telegram alert failed for ${formatSignalPair(signal.pair)}: ${detail}`);
    return {
      ok: false,
      skipped: false,
      error: detail,
    };
  }
}

module.exports = {
  buildTelegramMessage,
  formatSignalPair,
  formatTelegramTime,
  getStrategyEmoji,
  normalizeConfidence,
  sendTelegramAlert,
};
