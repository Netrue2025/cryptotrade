const fs = require("node:fs");
const path = require("node:path");

const { hashPassword, randomId } = require("./security");

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
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function saveDb(db) {
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mirrorEnabled: !!user.mirrorEnabled,
    binanceConnected: !!user.binance,
    binanceSummary: user.binance
      ? {
          testnet: !!user.binance.testnet,
          canTrade: !!user.binance.permissions?.canTrade,
          lastValidatedAt: user.binance.lastValidatedAt,
          connectedAt: user.binance.connectedAt,
        }
      : null,
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
      binance: null,
      createdAt: new Date().toISOString(),
    });
    return;
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
