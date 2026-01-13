/**
 * Minimal Mendable connectivity check (direct API).
 *
 * Usage:
 *   MENDABLE_API_KEY=... node scripts/test-mendable-chat.js "your question"
 *
 * Notes:
 * - This script intentionally never prints the API key.
 * - It supports loading `.env` (gitignored) for local runs.
 */

import dotenv from "dotenv";

dotenv.config(); // loads .env if present (should be gitignored)

if (typeof fetch !== "function") {
  console.error("This script requires Node 18+ (global fetch).");
  process.exit(1);
}

const apiKey = process.env.MENDABLE_API_KEY;
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
const question =
  process.argv.slice(2).join(" ").trim() || "List a few of the sources you have indexed.";

const hasDirectMendable = !!apiKey;
const hasSupabaseProxy = !!supabaseUrl && !!supabaseAnonKey;

if (!hasDirectMendable && !hasSupabaseProxy) {
  console.error(
    "Missing Mendable configuration. Provide either MENDABLE_API_KEY (direct) or SUPABASE_URL + SUPABASE_ANON_KEY (proxy).",
  );
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

async function postSupabaseFunction(functionName, body) {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Supabase Functions commonly accept anon key in both headers; include both for compatibility.
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
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

async function callMendableProxy(body) {
  const candidates = ["query-mendable-v2", "query-mendable"];
  let lastErr;
  for (const fn of candidates) {
    try {
      return await postSupabaseFunction(fn, body);
    } catch (err) {
      lastErr = err;
      // Try next candidate on common "not found" or auth-ish errors.
      if (![401, 403, 404].includes(err.status)) throw err;
    }
  }
  throw lastErr || new Error("Unable to call Mendable proxy");
}

async function main() {
  if (!hasDirectMendable && hasSupabaseProxy) {
    // Proxy mode: Mendable API key lives server-side in Supabase Edge Function secrets.
    const sourcesResp = await callMendableProxy({ action: "getSources" });
    const sources = sourcesResp?.result ?? sourcesResp?.data ?? sourcesResp;
    const list = Array.isArray(sources) ? sources : sources?.sources || sources?.data || null;
    const count = Array.isArray(list) ? list.length : null;

    console.log(`getSources (via Supabase Edge Function): ok${typeof count === "number" ? ` (${count} sources)` : ""}`);

    const chatResp = await callMendableProxy({
      question,
      history: [],
      shouldStream: false,
      num_chunks: 8,
    });

    if (!chatResp?.success) {
      console.error("Proxy chat failed:", JSON.stringify(chatResp?.error || chatResp).slice(0, 2000));
      process.exit(1);
    }

    console.log("chat (via Supabase Edge Function): ok");
    const answer = chatResp?.answer ?? null;
    if (typeof answer === "string" && answer.trim()) {
      console.log("\n--- answer ---\n");
      console.log(answer);
    }

    // Print a few sources (if present) for sanity.
    const sourcesOut =
      chatResp?.result?.sources ??
      chatResp?.result?.data?.sources ??
      chatResp?.result?.source ??
      null;
    if (Array.isArray(sourcesOut) && sourcesOut.length) {
      const preview = sourcesOut
        .slice(0, 5)
        .map((s) => s?.source || s?.url || s?.href || s?.document_url || s?.documentUrl || null)
        .filter(Boolean);
      if (preview.length) {
        console.log("\n--- sources (preview) ---\n");
        for (const s of preview) console.log(String(s));
      }
    }

    return;
  }

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
    chat = await post("/v1/mendableChat", {
      api_key: apiKey,
      question,
      history: [],
      shouldStream: false,
      retriever_option: { num_chunks: 8 },
    });
  } catch (err) {
    if ([401, 403, 404].includes(err.status)) {
      try {
        chat = await post("/v1/chat", {
          api_key: apiKey,
          question,
          history: [],
          shouldStream: false,
          retriever_option: { num_chunks: 8 },
        });
      } catch (err2) {
        if ([401, 403, 404].includes(err2.status)) {
          chat = await postWithBearer("/v1/newChat", {
            messages: [{ role: "user", content: question }],
            systemPrompt: "You are a helpful assistant providing automotive and vehicle related information.",
            temperature: 0.7,
            maxTokens: 750,
          });
        } else {
          throw err2;
        }
      }
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

  // Best-effort: print a few sources (if present) so you can confirm it's hitting your index.
  const sourcesOut = chat?.sources ?? chat?.result?.sources ?? chat?.data?.sources ?? null;
  if (Array.isArray(sourcesOut) && sourcesOut.length) {
    const preview = sourcesOut
      .slice(0, 5)
      .map((s) => s?.source || s?.url || s?.href || s?.document_url || s?.documentUrl || null)
      .filter(Boolean);
    if (preview.length) {
      console.log("\n--- sources (preview) ---\n");
      for (const s of preview) console.log(String(s));
    }
  }
}

main().catch((err) => {
  console.error("Mendable test failed:", err.message);
  if (err.details) {
    console.error("Details:", JSON.stringify(err.details).slice(0, 2000));
  }
  process.exit(1);
});

