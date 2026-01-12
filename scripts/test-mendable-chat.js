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

// CommonJS on purpose (repo root `package.json` does not declare `"type": "module"`).
const { config } = require("dotenv");

config(); // loads .env if present (should be gitignored)

if (typeof fetch !== "function") {
  console.error("This script requires Node 18+ (global fetch).");
  process.exit(1);
}

const apiKey = process.env.MENDABLE_API_KEY;
const question =
  process.argv.slice(2).join(" ").trim() || "List a few of the sources you have indexed.";

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
    err.status = res.status;
    throw err;
  }
  return json;
}

async function postWithBearer(path, body) {
  const res = await fetch(`https://api.mendable.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
    err.details = json;
    err.status = res.status;
    throw err;
  }
  return json;
}

async function main() {
  // 1) getSources
  let sources;
  try {
    sources = await post("/v1/getSources", { api_key: apiKey });
  } catch (err) {
    if ([401, 403, 404].includes(err.status)) {
      sources = await postWithBearer("/v1/getSources", {});
    } else {
      throw err;
    }
  }
  const sourceList = Array.isArray(sources) ? sources : sources?.sources || sources?.data || sources;
  const sourceCount = Array.isArray(sourceList) ? sourceList.length : null;
  console.log(`getSources: ok${typeof sourceCount === "number" ? ` (${sourceCount} sources)` : ""}`);

  // 2) chat (non-streaming)
  let chat;
  try {
    chat = await post("/v1/chat", {
      api_key: apiKey,
      question,
      shouldStream: false,
      retriever_option: { num_chunks: 8 },
    });
  } catch (err) {
    if ([401, 403, 404].includes(err.status)) {
      chat = await postWithBearer("/v1/newChat", {
        messages: [{ role: "user", content: question }],
        systemPrompt: "You are a helpful assistant providing automotive and vehicle related information.",
        temperature: 0.7,
        maxTokens: 750,
      });
    } else {
      throw err;
    }
  }

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

