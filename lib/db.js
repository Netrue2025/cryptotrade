const fs = require("node:fs");
const path = require("node:path");

const { hashPassword, randomId } = require("./security");
const { normalizeExchange } = require("./exchanges");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "app-db.json");

function defaultDb() {
  return {
    meta: {
      version: 1,
      createdAt: new Date().toISOString(),
    },
    users: [],
    sessions: [],
    tradeIntents: [],
  };
}

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultDb(), null, 2));
  }
}

function loadDb() {
  ensureStore();
  const db = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  db.users = (db.users || []).map((user) => ({
    ...user,
    preferredExchange: normalizeExchange(user.preferredExchange, "bybit"),
    bybit: user.bybit === undefined ? null : user.bybit,
    binance: user.binance === undefined ? null : user.binance,
  }));
  return db;
}

function saveDb(db) {
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

function sanitizeUser(user) {
  const preferredExchange = normalizeExchange(user.preferredExchange, "bybit");
  const activeExchange = preferredExchange;

  function summarize(account) {
    return account
      ? {
          testnet: !!account.testnet,
          canTrade: !!account.permissions?.canTrade,
          lastValidatedAt: account.lastValidatedAt,
          connectedAt: account.connectedAt,
        }
      : null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mirrorEnabled: !!user.mirrorEnabled,
    preferredExchange,
    activeExchange,
    exchangeConnected: !!user[preferredExchange],
    exchangeSummary: summarize(user[activeExchange]),
    binanceConnected: !!user.binance,
    bybitConnected: !!user.bybit,
    bybitSummary: summarize(user.bybit),
    binanceSummary: summarize(user.binance),
    exchangeAccounts: {
      bybit: summarize(user.bybit),
      binance: summarize(user.binance),
    },
    createdAt: user.createdAt,
  };
}

function ensureAdminUser(db) {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@trade.local").toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!";
  const existing = db.users.find((user) => user.role === "admin" && user.email === adminEmail);
  const { salt, hash } = hashPassword(adminPassword);

  if (!existing) {
    db.users.push({
      id: randomId(12),
      email: adminEmail,
      name: "Admin",
      role: "admin",
      mirrorEnabled: false,
      passwordSalt: salt,
      passwordHash: hash,
      preferredExchange: "bybit",
      binance: null,
      bybit: null,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  if (!existing.preferredExchange) {
    existing.preferredExchange = "bybit";
  }
  if (existing.binance === undefined) {
    existing.binance = null;
  }
  if (existing.bybit === undefined) {
    existing.bybit = null;
  }
  existing.passwordSalt = salt;
  existing.passwordHash = hash;
}

module.exports = {
  dataFile,
  ensureAdminUser,
  loadDb,
  sanitizeUser,
  saveDb,
};
