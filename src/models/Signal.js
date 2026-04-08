const { getMongoCollectionByName, shouldUseMongo } = require("../../lib/db");

class SignalModel {
  constructor({ collectionName = "signals", logger = console } = {}) {
    this.collectionName = collectionName;
    this.logger = logger;
    this.memorySignals = new Map();
    this.indexReady = false;
  }

  async init() {
    if (!shouldUseMongo()) {
      this.logger.warn("Signal model running in memory because MongoDB is not configured.");
      return this;
    }

    if (this.indexReady) {
      return this;
    }

    const collection = await getMongoCollectionByName(this.collectionName);
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "signal_ttl_idx" });
    await collection.createIndex({ signalKey: 1 }, { unique: true, name: "signal_key_idx" });
    await collection.createIndex({ symbol: 1, timeframe: 1, createdAt: -1 }, { name: "signal_lookup_idx" });
    this.indexReady = true;
    return this;
  }

  async getCollection() {
    if (!shouldUseMongo()) {
      return null;
    }
    return getMongoCollectionByName(this.collectionName);
  }

  async upsert(signal) {
    const document = {
      ...signal,
      updatedAt: new Date().toISOString(),
    };

    const collection = await this.getCollection();
    if (!collection) {
      this.memorySignals.set(document.id, document);
      return document;
    }

    await collection.updateOne(
      { signalKey: document.signalKey },
      {
        $set: document,
        $setOnInsert: {
          createdAt: document.createdAt,
        },
      },
      { upsert: true }
    );
    return document;
  }

  async listActive({ timeframe } = {}) {
    const nowIso = new Date().toISOString();
    const collection = await this.getCollection();
    if (!collection) {
      return [...this.memorySignals.values()]
        .filter((signal) => (!timeframe || signal.timeframe === timeframe) && signal.expiresAt > nowIso)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    }

    const query = {
      expiresAt: { $gt: nowIso },
    };
    if (timeframe) {
      query.timeframe = timeframe;
    }

    return collection.find(query).sort({ createdAt: -1 }).limit(200).toArray();
  }

  async deleteMany(signalIds = []) {
    const ids = [...new Set((signalIds || []).map((item) => String(item || "").trim()).filter(Boolean))];
    if (!ids.length) {
      return { deletedCount: 0 };
    }

    const collection = await this.getCollection();
    if (!collection) {
      let deletedCount = 0;
      for (const id of ids) {
        if (this.memorySignals.delete(id)) {
          deletedCount += 1;
        }
      }
      return { deletedCount };
    }

    return collection.deleteMany({ id: { $in: ids } });
  }

  async getById(signalId) {
    const id = String(signalId || "").trim();
    if (!id) {
      return null;
    }

    const collection = await this.getCollection();
    if (!collection) {
      return this.memorySignals.get(id) || null;
    }

    return collection.findOne({ id });
  }
}

module.exports = {
  SignalModel,
};
