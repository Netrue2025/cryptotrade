const cron = require("node-cron");

const { createBroadcaster } = require("../utils/broadcast");

function normalizeExchange(exchange) {
  const value = String(exchange || "").trim().toLowerCase();
  return value === "binance" || value === "bybit" ? value : "bybit";
}

function getExchangeLabel(exchange) {
  return normalizeExchange(exchange) === "binance" ? "Binance" : "Bybit";
}

function toNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value, digits = 8) {
  const numeric = toNumber(value);
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function formatSignedPercent(value) {
  const numeric = toNumber(value);
  const sign = numeric >= 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function formatTimestamp(value) {
  const date = new Date(value || Date.now());
  return date.toLocaleString();
}

function getExecutionStatus(execution) {
  return String(execution?.status || "").trim().toUpperCase();
}

function getExecutionQuantity(execution) {
  const executedQty = toNumber(execution?.executedQty);
  if (executedQty > 0) {
    return executedQty;
  }
  return toNumber(execution?.origQty);
}

function getExecutionPrice(execution) {
  const directPrice = toNumber(execution?.price || execution?.rawPrice);
  if (directPrice > 0) {
    return directPrice;
  }

  const qty = getExecutionQuantity(execution);
  const notional = toNumber(execution?.cummulativeQuoteQty);
  if (qty > 0 && notional > 0) {
    return notional / qty;
  }

  return 0;
}

function getMirroredCount(trade) {
  return (trade?.mirroredExecutions || []).filter((item) => item?.status !== "SKIPPED").length;
}

function getExitOrderMap(trade) {
  return new Map((trade?.exitOrders || []).map((exitOrder) => [exitOrder.id, exitOrder]));
}

function calculateProfitPercent(trade, exitOrder) {
  const entryPrice = getExecutionPrice(trade?.adminExecution) || toNumber(trade?.price);
  const exitPrice = getExecutionPrice(exitOrder?.adminExecution) || toNumber(exitOrder?.price);
  if (!entryPrice || !exitPrice) {
    return null;
  }

  if (String(trade?.side || "").trim().toUpperCase() === "SELL") {
    return ((entryPrice - exitPrice) / entryPrice) * 100;
  }

  return ((exitPrice - entryPrice) / entryPrice) * 100;
}

function buildExchangeHeader(exchange, suffix = "Trade") {
  return `📊 ${getExchangeLabel(exchange)} ${suffix}`;
}

function buildOrderPlacedMessage({ exchange, trade, exitOrder = null }) {
  const execution = exitOrder?.adminExecution || trade?.adminExecution;
  const eventLabel = exitOrder
    ? exitOrder.kind === "TAKE_PROFIT"
      ? "📝 Take Profit Order Placed"
      : "📝 Exit Order Placed"
    : "📝 Order Placed";

  return [
    buildExchangeHeader(exchange, "Trade"),
    "",
    eventLabel,
    `Pair: ${trade.symbol}`,
    `Side: ${exitOrder?.side || trade.side}`,
    `Type: ${exitOrder?.type || trade.type}`,
    `Entry: ${formatNumber(getExecutionPrice(trade.adminExecution) || trade.price, 6)}`,
    `Mirrored Users: ${getMirroredCount(trade)}`,
    execution?.orderId ? `Order ID: ${execution.orderId}` : null,
    `Time: ${formatTimestamp(execution?.transactTime || Date.now())}`,
  ].filter(Boolean).join("\n");
}

function buildOrderFilledMessage({ exchange, trade, exitOrder = null, profitPercent = null }) {
  const execution = exitOrder?.adminExecution || trade?.adminExecution;
  const isExit = !!exitOrder;
  const exitPrice = getExecutionPrice(execution) || toNumber(exitOrder?.price);

  return [
    buildExchangeHeader(exchange, "Trade"),
    "",
    isExit ? "✅ Exit Order Filled" : "✅ Order Filled",
    `Pair: ${trade.symbol}`,
    `Entry: ${formatNumber(getExecutionPrice(trade.adminExecution) || trade.price, 6)}`,
    isExit ? `Exit: ${formatNumber(exitPrice, 6)}` : null,
    `Executed Qty: ${formatNumber(getExecutionQuantity(execution), 8)}`,
    profitPercent === null ? null : `Profit: ${formatSignedPercent(profitPercent)}`,
    `Time: ${formatTimestamp(execution?.transactTime || Date.now())}`,
  ].filter(Boolean).join("\n");
}

function buildTakeProfitHitMessage({ exchange, trade, exitOrder, profitPercent }) {
  const execution = exitOrder?.adminExecution || null;
  return [
    buildExchangeHeader(exchange, "Trade"),
    "",
    "🎯 Take Profit Hit",
    `Pair: ${trade.symbol}`,
    `Entry: ${formatNumber(getExecutionPrice(trade.adminExecution) || trade.price, 6)}`,
    `Exit: ${formatNumber(getExecutionPrice(execution) || exitOrder.price, 6)}`,
    profitPercent === null ? null : `Profit: ${formatSignedPercent(profitPercent)}`,
    `Time: ${formatTimestamp(execution?.transactTime || Date.now())}`,
  ].filter(Boolean).join("\n");
}

function buildTargetMessage(exchange) {
  if (normalizeExchange(exchange) === "bybit") {
    return [
      "📊 Bybit Update",
      "",
      "🎯 Daily Profit Target Reached: 2%",
      "",
      "For bybit mirrored user, wawooo! 💃",
      "You have hit the daily target of 2% today 🎉",
    ].join("\n");
  }

  return [
    "📊 Binance Update",
    "",
    "🎯 Daily Profit Target Reached: 2%",
  ].join("\n");
}

class TradeListener {
  constructor({ telegramService, subscriberModel, logger = console } = {}) {
    this.telegramService = telegramService;
    this.subscriberModel = subscriberModel;
    this.logger = logger;
    this.broadcaster = createBroadcaster({
      telegramService,
      subscriberModel,
      logger,
    });
    this.binanceDailyProfit = 0;
    this.bybitDailyProfit = 0;
    this.binanceTargetHit = false;
    this.bybitTargetHit = false;
    this.resetTask = null;
  }

  async start() {
    if (this.telegramService?.start) {
      await this.telegramService.start();
    }

    if (!this.resetTask) {
      this.resetTask = cron.schedule("0 0 * * *", () => {
        this.resetDailyState();
      });
    }
  }

  stop() {
    if (this.resetTask) {
      this.resetTask.stop();
      this.resetTask = null;
    }
  }

  resetDailyState() {
    this.binanceDailyProfit = 0;
    this.bybitDailyProfit = 0;
    this.binanceTargetHit = false;
    this.bybitTargetHit = false;
    this.logger.log("Trade listener daily profit counters reset.");
  }

  getDailyProfit(exchange) {
    return normalizeExchange(exchange) === "binance" ? this.binanceDailyProfit : this.bybitDailyProfit;
  }

  hasTargetHit(exchange) {
    return normalizeExchange(exchange) === "binance" ? this.binanceTargetHit : this.bybitTargetHit;
  }

  markTargetHit(exchange) {
    if (normalizeExchange(exchange) === "binance") {
      this.binanceTargetHit = true;
      return;
    }
    this.bybitTargetHit = true;
  }

  async broadcast(message, type, options = {}) {
    return this.broadcaster.broadcast(message, type, options);
  }

  async handleTradeCreated(trade) {
    if (!trade?.symbol) {
      return;
    }

    const exchange = normalizeExchange(trade.exchange);
    await this.broadcast(buildOrderPlacedMessage({ exchange, trade }), exchange, { exchange });

    if (getExecutionStatus(trade.adminExecution) === "FILLED") {
      await this.broadcast(buildOrderFilledMessage({ exchange, trade }), exchange, { exchange });
    }
  }

  async handleExitOrderCreated(trade, exitOrder) {
    if (!trade?.symbol || !exitOrder?.id) {
      return;
    }

    const exchange = normalizeExchange(trade.exchange || exitOrder.exchange);
    if (getExecutionStatus(exitOrder.adminExecution) !== "ERROR") {
      await this.broadcast(buildOrderPlacedMessage({ exchange, trade, exitOrder }), exchange, { exchange });
    }

    if (getExecutionStatus(exitOrder.adminExecution) === "FILLED") {
      await this.handleFilledExit(trade, exitOrder, exchange);
    }
  }

  async handleTradeUpdated(previousTrade, nextTrade) {
    if (!nextTrade?.symbol) {
      return;
    }

    const exchange = normalizeExchange(nextTrade.exchange);
    const previousEntryStatus = getExecutionStatus(previousTrade?.adminExecution);
    const nextEntryStatus = getExecutionStatus(nextTrade.adminExecution);
    if (previousEntryStatus !== "FILLED" && nextEntryStatus === "FILLED") {
      await this.broadcast(buildOrderFilledMessage({ exchange, trade: nextTrade }), exchange, { exchange });
    }

    const previousExitOrders = getExitOrderMap(previousTrade);
    for (const exitOrder of nextTrade.exitOrders || []) {
      const previousExitOrder = previousExitOrders.get(exitOrder.id);
      const previousStatus = getExecutionStatus(previousExitOrder?.adminExecution);
      const nextStatus = getExecutionStatus(exitOrder.adminExecution);
      if (previousStatus !== "FILLED" && nextStatus === "FILLED") {
        await this.handleFilledExit(nextTrade, exitOrder, exchange);
      }
    }
  }

  async handleFilledExit(trade, exitOrder, exchange) {
    const profitPercent = calculateProfitPercent(trade, exitOrder);

    if (exitOrder.kind === "TAKE_PROFIT") {
      await this.broadcast(
        buildTakeProfitHitMessage({ exchange, trade, exitOrder, profitPercent }),
        exchange,
        { exchange }
      );
    } else {
      await this.broadcast(
        buildOrderFilledMessage({ exchange, trade, exitOrder, profitPercent }),
        exchange,
        { exchange }
      );
    }

    await this.updateDailyProfit(exchange, profitPercent);
  }

  async updateDailyProfit(exchange, profitPercent) {
    const normalizedExchange = normalizeExchange(exchange);
    const numericProfit = toNumber(profitPercent);
    if (!Number.isFinite(numericProfit) || numericProfit === 0) {
      return;
    }

    if (normalizedExchange === "binance") {
      this.binanceDailyProfit += numericProfit;
    } else {
      this.bybitDailyProfit += numericProfit;
    }

    if (this.getDailyProfit(normalizedExchange) >= 2 && !this.hasTargetHit(normalizedExchange)) {
      this.markTargetHit(normalizedExchange);
      await this.broadcast(buildTargetMessage(normalizedExchange), "dailyProfit", {
        exchange: normalizedExchange,
      });
    }
  }
}

module.exports = {
  TradeListener,
  calculateProfitPercent,
};
