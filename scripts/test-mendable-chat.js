/**
 * Minimal Mendable connectivity check (direct API).
 *
 * Usage:
 *   MENDABLE_API_KEY=... node scripts/test-mendable-chat.js "your question"
 *
 * Notes:
 * - This script intentionally never prints the API key.
 * - If you prefer, set MENDABLE_API_KEY in your shell env manager; do not commit it.
 */

import { config } from "dotenv";

config(); // loads .env if present (should be gitignored)

const apiKey = process.env.MENDABLE_API_KEY;
const question = process.argv.slice(2).join(" ").trim() || "List a few of the sources you have indexed.";

if (!apiKey) {
  console.error("Missing MENDABLE_API_KEY in environment.");
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(`https://api.mendable.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    // attach structured details for debugging without throwing raw text
    err.details = json;
    throw err;
  }
  return json;
}

async function main() {
  // 1) getSources
  const sources = await post("/v1/getSources", { api_key: apiKey });
  const sourceList = Array.isArray(sources) ? sources : sources?.sources || sources?.data || sources;
  const sourceCount = Array.isArray(sourceList) ? sourceList.length : null;
  console.log(`getSources: ok${typeof sourceCount === "number" ? ` (${sourceCount} sources)` : ""}`);

  // 2) chat (non-streaming)
  const chat = await post("/v1/chat", {
    api_key: apiKey,
    question,
    shouldStream: false,
    retriever_option: { num_chunks: 8 },
  });

  console.log("chat: ok");
  // Try to print a useful preview without assuming an exact schema.
  const answer =
    chat?.answer ??
    chat?.result ??
    chat?.response ??
    chat?.data?.answer ??
    chat?.data?.result ??
    null;
  if (typeof answer === "string") {
    console.log("\n--- answer ---\n");
    console.log(answer);
  } else {
    console.log("\n(chat response received; schema not recognized — inspect JSON if needed)");
  }
}

main().catch((err) => {
  console.error("Mendable test failed:", err.message);
  if (err.details) {
    console.error("Details:", JSON.stringify(err.details).slice(0, 2000));
  }
  process.exit(1);
});

