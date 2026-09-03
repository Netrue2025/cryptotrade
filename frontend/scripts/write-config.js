const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_API_BASE_URL = "https://trade-backend-tsjf.onrender.com";
const apiBaseUrl = String(process.env.TRADE_API_BASE_URL || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
const configPath = path.join(__dirname, "..", "public", "config.js");

fs.writeFileSync(configPath, `window.TRADE_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`);
console.log(`Wrote frontend API config: ${apiBaseUrl || "same-origin"}`);
