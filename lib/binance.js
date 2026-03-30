const crypto = require("node:crypto");

const { decryptSecret } = require("./security");

const serverTimeOffsetMs = {
  mainnet: 0,
  testnet: 0,
};

function getBaseUrl(testnet) {
  if (testnet) {
    return process.env.BINANCE_TESTNET_URL || "https://testnet.binance.vision";
  }
  return process.env.BINANCE_BASE_URL || "https://api.binance.com";
}

function buildQuery(params) {
  return new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
  ).toString();
}

async function publicRequest(path, params = {}, testnet = false) {
  const query = buildQuery(params);
  const url = `${getBaseUrl(testnet)}${path}${query ? `?${query}` : ""}`;
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    const detail = error.cause?.code || error.cause?.message || error.message;
    throw new Error(
      `Network error reaching Binance at ${url}: ${detail}. Check internet access, DNS, firewall/VPN, or region-based access to Binance.`
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.msg || "Unable to reach Binance.");
  }
  return payload;
}

async function getServerTime(testnet) {
  return publicRequest("/api/v3/time", {}, testnet);
}

async function syncServerTimeOffset(testnet) {
  const startedAt = Date.now();
  const payload = await getServerTime(testnet);
  const finishedAt = Date.now();
  const midpoint = startedAt + Math.round((finishedAt - startedAt) / 2);
  const offset = Number(payload.serverTime) - midpoint;
  serverTimeOffsetMs[testnet ? "testnet" : "mainnet"] = offset;
  return offset;
}

async function signedRequest(account, path, method = "GET", params = {}, allowRetry = true) {
  const key = account.testnet ? "testnet" : "mainnet";
  const timestamp = Date.now() + serverTimeOffsetMs[key];
  const recvWindow = 10000;
  const secret = decryptSecret(account.secretEncrypted);
  const query = buildQuery({ ...params, recvWindow, timestamp });
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  const url = `${getBaseUrl(account.testnet)}${path}?${query}&signature=${signature}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        "X-MBX-APIKEY": account.apiKey,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const detail = error.cause?.code || error.cause?.message || error.message;
    throw new Error(
      `Network error reaching Binance at ${url}: ${detail}. Check internet access, DNS, firewall/VPN, or region-based access to Binance.`
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload.code === -1021 && allowRetry) {
      await syncServerTimeOffset(account.testnet);
      return signedRequest(account, path, method, params, false);
    }
    throw new Error(payload.msg || `Signed Binance request failed with HTTP ${response.status}.`);
  }
  return payload;
}

async function getConnectivityStatus(testnet) {
  const baseUrl = getBaseUrl(testnet);
  const startedAt = Date.now();
  const payload = await publicRequest("/api/v3/ping", {}, testnet);
  return {
    ok: true,
    baseUrl,
    latencyMs: Date.now() - startedAt,
    serverTimeOffsetMs: serverTimeOffsetMs[testnet ? "testnet" : "mainnet"],
    payload,
  };
}

async function validateCredentials(apiKey, secretEncrypted, testnet) {
  return signedRequest(
    {
      apiKey,
      secretEncrypted,
      testnet,
    },
    "/api/v3/account",
    "GET"
  );
}

async function getAccountInfo(account) {
  return signedRequest(account, "/api/v3/account", "GET");
}

async function getOpenOrders(account) {
  return signedRequest(account, "/api/v3/openOrders", "GET");
}

async function getOrder(account, symbol, orderId) {
  return signedRequest(account, "/api/v3/order", "GET", { symbol, orderId });
}

async function cancelOrder(account, symbol, orderId) {
  return signedRequest(account, "/api/v3/order", "DELETE", { symbol, orderId });
}

async function getExchangeInfo(symbol, testnet) {
  return publicRequest("/api/v3/exchangeInfo", { symbol }, testnet);
}

async function getTickerPrices(testnet) {
  return publicRequest("/api/v3/ticker/price", {}, testnet);
}

async function getTickerPrice(symbol, testnet) {
  return publicRequest("/api/v3/ticker/price", { symbol }, testnet);
}

async function getTicker24hr(symbolsOrTestnet = false, maybeTestnet = false) {
  let params = {};
  let testnet = maybeTestnet;

  if (Array.isArray(symbolsOrTestnet)) {
    params = { symbols: JSON.stringify(symbolsOrTestnet) };
  } else {
    testnet = symbolsOrTestnet;
  }

  return publicRequest("/api/v3/ticker/24hr", params, testnet);
}

async function placeSpotOrder(account, orderInput) {
  return signedRequest(account, "/api/v3/order", "POST", {
    symbol: orderInput.symbol,
    side: orderInput.side,
    type: orderInput.type,
    quantity: orderInput.quantity,
    quoteOrderQty: orderInput.quoteOrderQty,
    price: orderInput.price,
    timeInForce: orderInput.timeInForce,
    newOrderRespType: "FULL",
  });
}

module.exports = {
  getConnectivityStatus,
  getAccountInfo,
  cancelOrder,
  getExchangeInfo,
  getOpenOrders,
  getOrder,
  getServerTime,
  getTicker24hr,
  getTickerPrice,
  getTickerPrices,
  placeSpotOrder,
  syncServerTimeOffset,
  validateCredentials,
};
