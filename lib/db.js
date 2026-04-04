const fs = require("node:fs");
const path = require("node:path");

const { MongoClient } = require("mongodb");

const { hashPassword, randomId } = require("./security");
const { normalizeExchange } = require("./exchanges");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "app-db.json");
const mongoUri = String(process.env.MONGODB_URI || "").trim();
const mongoDbName = String(process.env.MONGODB_DB_NAME || "").trim();
const mongoCollectionName = String(process.env.MONGODB_COLLECTION || "app_state").trim();
const appStateId = "trade-mvp-state";

let mongoClientPromise = null;
let mongoCollectionPromise = null;
let saveQueue = Promise.resolve();

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

function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

function normalizeDb(raw = {}) {
  const base = {
    ...defaultDb(),
    ...cloneDb(raw || {}),
  };

  base.meta = {
    version: Number(base.meta?.version || 1),
    createdAt: base.meta?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  base.users = (base.users || []).map((user) => ({
    ...user,
    preferredExchange: normalizeExchange(user.preferredExchange, "bybit"),
    mirrorEnabled: user.role === "user" ? user.mirrorEnabled !== false : !!user.mirrorEnabled,
    bybit: user.bybit === undefined ? null : user.bybit,
    binance: user.binance === undefined ? null : user.binance,
  }));
  base.sessions = Array.isArray(base.sessions) ? base.sessions : [];
  base.tradeIntents = Array.isArray(base.tradeIntents) ? base.tradeIntents : [];
  return base;
}

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultDb(), null, 2));
  }
}

function loadFileDb() {
  ensureStore();
  return normalizeDb(JSON.parse(fs.readFileSync(dataFile, "utf8")));
}

function saveFileDb(db) {
  ensureStore();
  const snapshot = normalizeDb(db);
  fs.writeFileSync(dataFile, JSON.stringify(snapshot, null, 2));
}

function shouldUseMongo() {
  return !!mongoUri;
}

async function getMongoCollection() {
  if (!shouldUseMongo()) {
    return null;
  }

  if (!mongoCollectionPromise) {
    mongoCollectionPromise = (async () => {
      if (!mongoClientPromise) {
        mongoClientPromise = MongoClient.connect(mongoUri, {});
      }
      const client = await mongoClientPromise;
      const dbName = mongoDbName || new URL(mongoUri).pathname.replace(/^\//, "") || "trade_mvp";
      return client.db(dbName).collection(mongoCollectionName);
    })();
  }

  return mongoCollectionPromise;
}

async function loadDb() {
  if (!shouldUseMongo()) {
    return loadFileDb();
  }

  const collection = await getMongoCollection();
  const snapshot = await collection.findOne({ _id: appStateId });
  if (!snapshot) {
    let initial = normalizeDb(defaultDb());
    if (fs.existsSync(dataFile)) {
      initial = loadFileDb();
    }
    await collection.insertOne({
      _id: appStateId,
      ...initial,
    });
    return initial;
  }

  const { _id, ...rest } = snapshot;
  return normalizeDb(rest);
}

function saveDb(db) {
  if (!shouldUseMongo()) {
    saveFileDb(db);
    return Promise.resolve();
  }

  const snapshot = normalizeDb(db);
  saveQueue = saveQueue.then(async () => {
    const collection = await getMongoCollection();
    await collection.updateOne(
      { _id: appStateId },
      {
        $set: {
          ...snapshot,
        },
      },
      { upsert: true }
    );
  });

  return saveQueue;
}

function getActiveExchange(user) {
  const preferredExchange = normalizeExchange(user.preferredExchange, "bybit");
  if (user?.[preferredExchange]) {
    return preferredExchange;
  }
  if (user?.bybit) {
    return "bybit";
  }
  if (user?.binance) {
    return "binance";
  }
  return preferredExchange;
}

function sanitizeUser(user) {
  const preferredExchange = normalizeExchange(user.preferredExchange, "bybit");
  const activeExchange = getActiveExchange(user);

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
    exchangeConnected: !!user[activeExchange],
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
  shouldUseMongo,
};
