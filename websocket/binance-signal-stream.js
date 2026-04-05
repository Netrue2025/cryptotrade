const EventEmitter = require("node:events");
const WebSocket = require("ws");

const { getCandles } = require("../lib/binance");

function normalizeKlinePayload(payload) {
  const kline = payload?.data?.k || payload?.k || null;
  if (!kline?.s) {
    return null;
  }

  return {
    pair: String(kline.s || "").toUpperCase(),
    candle: {
      openTime: Number(kline.t || 0),
      closeTime: Number(kline.T || 0),
      open: Number(kline.o || 0),
      high: Number(kline.h || 0),
      low: Number(kline.l || 0),
      close: Number(kline.c || 0),
      volume: Number(kline.v || 0),
      isClosed: !!kline.x,
    },
  };
}

class BinanceSignalStream extends EventEmitter {
  constructor({ pairs, interval }) {
    super();
    this.pairs = pairs;
    this.interval = interval;
    this.socket = null;
    this.reconnectTimer = null;
    this.destroyed = false;
  }

  async seedCandles(limit) {
    const entries = await Promise.allSettled(
      this.pairs.map(async (pair) => {
        const candles = await getCandles(pair, this.interval, limit, false);
        return [pair, candles];
      })
    );

    return new Map(
      entries.map((entry, index) => {
        if (entry.status === "fulfilled") {
          return entry.value;
        }
        return [this.pairs[index], []];
      })
    );
  }

  start() {
    this.destroyed = false;
    this.connect();
  }

  stop() {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
  }

  connect() {
    if (this.destroyed) {
      return;
    }

    const streamPath = this.pairs.map((pair) => `${pair.toLowerCase()}@kline_${this.interval}`).join("/");
    this.socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streamPath}`);

    this.socket.on("open", () => {
      this.emit("status", { ok: true, message: "Binance signal stream connected." });
    });

    this.socket.on("message", (raw) => {
      try {
        const payload = JSON.parse(String(raw || ""));
        const normalized = normalizeKlinePayload(payload);
        if (normalized) {
          this.emit("kline", normalized);
        }
      } catch (error) {
        this.emit("error", error);
      }
    });

    this.socket.on("error", (error) => {
      this.emit("status", { ok: false, message: error.message || "Binance signal stream error." });
    });

    this.socket.on("close", () => {
      this.emit("status", { ok: false, message: "Binance signal stream disconnected. Reconnecting..." });
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    });
  }
}

module.exports = {
  BinanceSignalStream,
};
