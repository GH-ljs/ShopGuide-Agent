import fs from "node:fs";
import path from "node:path";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

export const config = {
  port: Number(process.env.PORT || 3001),
  datasetDir: path.resolve(process.cwd(), process.env.DATASET_DIR || "../ecommerce_agent_dataset"),
  arkApiKey: process.env.ARK_API_KEY || "",
  arkBaseUrl: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
  arkModel: process.env.ARK_MODEL || "ep-20260514111645-lmgt2"
};
