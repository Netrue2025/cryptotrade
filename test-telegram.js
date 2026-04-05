const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const { sendTelegramAlert } = require("./services/telegram");

async function testTelegram() {
  const testSignal = {
    pair: "BTC/USDT",
    strategyType: "EMA_RSI",
    entryPrice: 67200,
    stopLoss: 66500,
    takeProfit: 69000,
    timestamp: Date.now(),
    confidence: "High",
  };

  const result = await sendTelegramAlert(testSignal);
  console.log("Telegram test result:", result);
}

testTelegram().catch((error) => {
  console.error("Telegram test failed:", error.message);
  process.exit(1);
});
