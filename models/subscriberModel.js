const { MongoClient } = require("mongodb");
const { getMongoCollectionByName } = require("../lib/db");

const DEFAULT_COLLECTION_NAME = "telegram_subscribers";

function getMongoUri() {
  return String(process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
}

function getMongoDbName(uri) {
  return String(process.env.MONGO_DB_NAME || process.env.MONGODB_DB_NAME || "").trim()
    || new URL(uri).pathname.replace(/^\//, "")
    || "trade_mvp";
}

function getCollectionName() {
  return String(process.env.TELEGRAM_SUBSCRIBERS_COLLECTION || DEFAULT_COLLECTION_NAME).trim() || DEFAULT_COLLECTION_NAME;
}

function getAppMongoUri() {
  return String(process.env.MONGODB_URI || "").trim();
}

function defaultPreferences() {
  return {
    binance: true,
    bybit: true,
    dailyProfit: true,
  };
}

function sanitizeChatId(chatId) {
  const numeric = Number(chatId);
  return Number.isFinite(numeric) ? numeric : 0;
}

class SubscriberModel {
  constructor({ mongoUri, dbName, collectionName, logger = console } = {}) {
    this.mongoUri = mongoUri || getMongoUri();
    this.dbName = dbName || (this.mongoUri ? getMongoDbName(this.mongoUri) : "");
    this.collectionName = collectionName || getCollectionName();
    this.logger = logger;
    this.clientPromise = null;
    this.collectionPromise = null;
  }

  isEnabled() {
    return !!this.mongoUri;
  }

  shouldUseSharedAppMongo() {
    return !!this.mongoUri && this.mongoUri === getAppMongoUri();
  }

  async getCollection() {
    if (!this.isEnabled()) {
      throw new Error("MongoDB is not configured for Telegram subscribers.");
    }

    if (!this.collectionPromise) {
      this.collectionPromise = (async () => {
        if (this.shouldUseSharedAppMongo()) {
          const collection = await getMongoCollectionByName(this.collectionName);
          if (collection) {
            return collection;
          }
        }

        if (!this.clientPromise) {
          this.clientPromise = MongoClient.connect(this.mongoUri, {});
        }
        const client = await this.clientPromise;
        return client.db(this.dbName).collection(this.collectionName);
      })();
    }

    return this.collectionPromise;
  }

  async ensureIndexes() {
    if (!this.isEnabled()) {
      return;
    }

    const collection = await this.getCollection();
    await collection.createIndex({ chatId: 1 }, { unique: true, name: "chatId_unique" });
    await collection.createIndex({ subscribed: 1 }, { name: "subscribed_idx" });
  }

  async init() {
    await this.ensureIndexes();
    return this;
  }

  async findByChatId(chatId) {
    if (!this.isEnabled()) {
      return null;
    }

    const normalizedChatId = sanitizeChatId(chatId);
    if (!normalizedChatId) {
      return null;
    }

    const collection = await this.getCollection();
    return collection.findOne({ chatId: normalizedChatId });
  }

  async subscribe(chatId) {
    if (!this.isEnabled()) {
      throw new Error("MongoDB is not configured for Telegram subscribers.");
    }

    const normalizedChatId = sanitizeChatId(chatId);
    if (!normalizedChatId) {
      throw new Error("A valid Telegram chat id is required.");
    }

    const collection = await this.getCollection();
    await collection.updateOne(
      { chatId: normalizedChatId },
      {
        $set: {
          subscribed: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          chatId: normalizedChatId,
          preferences: defaultPreferences(),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    return this.findByChatId(normalizedChatId);
  }

  async unsubscribe(chatId) {
    if (!this.isEnabled()) {
      return null;
    }

    const normalizedChatId = sanitizeChatId(chatId);
    if (!normalizedChatId) {
      return null;
    }

    const collection = await this.getCollection();
    await collection.updateOne(
      { chatId: normalizedChatId },
      {
        $set: {
          subscribed: false,
          updatedAt: new Date(),
        },
      }
    );

    return this.findByChatId(normalizedChatId);
  }

  async updatePreferences(chatId, patch = {}) {
    if (!this.isEnabled()) {
      return null;
    }

    const normalizedChatId = sanitizeChatId(chatId);
    if (!normalizedChatId) {
      return null;
    }

    const current = (await this.findByChatId(normalizedChatId)) || {
      chatId: normalizedChatId,
      subscribed: true,
      preferences: defaultPreferences(),
    };

    const nextPreferences = {
      ...defaultPreferences(),
      ...(current.preferences || {}),
      ...Object.fromEntries(
        Object.entries(patch || {}).map(([key, value]) => [key, value !== false])
      ),
    };

    const collection = await this.getCollection();
    await collection.updateOne(
      { chatId: normalizedChatId },
      {
        $set: {
          subscribed: current.subscribed !== false,
          preferences: nextPreferences,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          chatId: normalizedChatId,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    return this.findByChatId(normalizedChatId);
  }

  async togglePreference(chatId, preferenceKey) {
    const allowed = new Set(["binance", "bybit", "dailyProfit"]);
    if (!allowed.has(String(preferenceKey || "").trim())) {
      throw new Error("Unknown Telegram alert preference.");
    }

    const current = (await this.findByChatId(chatId)) || {
      chatId: sanitizeChatId(chatId),
      subscribed: true,
      preferences: defaultPreferences(),
    };
    const key = String(preferenceKey).trim();

    return this.updatePreferences(chatId, {
      [key]: !(current.preferences || defaultPreferences())[key],
    });
  }

  async listSubscribed() {
    if (!this.isEnabled()) {
      return [];
    }

    const collection = await this.getCollection();
    return collection
      .find({ subscribed: true })
      .sort({ createdAt: 1 })
      .toArray();
  }
}

module.exports = {
  SubscriberModel,
  defaultPreferences,
};
