#!/usr/bin/env npx tsx
/**
 * x-monitor.ts — X post monitor via Grok API live search
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/x-monitor.ts
 *   dotenvx run -- npx tsx scripts/x-monitor.ts --topic devtools
 *   dotenvx run -- npx tsx scripts/x-monitor.ts --topic market
 *   dotenvx run -- npx tsx scripts/x-monitor.ts --topic all
 *   dotenvx run -- npx tsx scripts/x-monitor.ts --save   (saves results to docs/content/x-monitor-log.md)
 */

import { writeFileSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendTelegram, linkXHandles } from "./_telegram.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const XAI_API_KEY = process.env.XAI_API_KEY;

if (!XAI_API_KEY) {
  console.error("XAI_API_KEY not set. Run with: dotenvx run -- npx tsx scripts/x-monitor.ts");
  process.exit(1);
}

// --- CLI args ---
const args = process.argv.slice(2);
const topicArg = args.includes("--topic") ? args[args.indexOf("--topic") + 1] : "all";
const shouldSave = args.includes("--save");
const daysBack = args.includes("--days") ? parseInt(args[args.indexOf("--days") + 1]) : 7;

// --- Search topics ---
const TOPICS = {
  devtools: {
    label: "Dev Tools & Stack",
    description: "New tools, releases, and tips relevant to the Nuke stack",
    query: `Find the most relevant and useful X posts from the last ${daysBack} days about:
- Supabase edge functions, Supabase Vector, Supabase AI
- Deno Deploy, Deno KV, Deno 2
- ONNX runtime, EfficientNet, computer vision for production
- TypeScript SDK design patterns, OpenAI-compatible APIs
- PostgreSQL performance, RLS patterns, schema design
- Edge computing, serverless AI inference
- xAI API, Grok API, live search capabilities
- Vercel edge functions, Cloudflare Workers

Focus on: new releases, performance insights, real-world usage tips, gotchas, and threads that show practical applications. Skip marketing fluff. Prioritize posts from engineers and builders.

Return 8-12 posts. For each post include: author handle, core insight/finding, why it's relevant to building a data platform.`,
  },

  market: {
    label: "Collector Vehicle Market",
    description: "Market trends, notable sales, and collector car investment discussion",
    query: `Find the most relevant X posts from the last ${daysBack} days about:
- Collector vehicle market trends (prices, volume, sentiment)
- Notable auction results (Bring a Trailer, Barrett-Jackson, RM Sotheby's, Mecum, Cars & Bids)
- Collector car investment / vehicles as stores of value
- Porsche, Ferrari, vintage American muscle as investment assets
- Hagerty, BaT community discussion about pricing
- Automotive data, vehicle provenance, title history
- Lenders or finance companies entering the collector car space

Focus on: price insights, market signals, investment thesis discussion, data gaps people are complaining about. Skip pure enthusiasm posts with no data.

Return 8-12 posts. For each post include: author handle, key data point or insight, relevance to Nuke's market position.`,
  },

  investors: {
    label: "Investor Signals",
    description: "Angels, VCs, and founders discussing automotive, data platforms, or API businesses",
    query: `Find the most relevant X posts from the last ${daysBack} days about:
- Angels or VCs discussing automotive technology investments
- Data platform companies raising rounds (seed, Series A)
- API-first business models and their valuations
- Alternative asset class investing (collectibles, vehicles, watches, art)
- Solo founder success stories or fundraising
- Pre-seed / seed stage companies in data, AI, or marketplace verticals
- Collector car finance, insurance, or tech companies
- Anyone discussing vehicle data, provenance, or automotive AI

Focus on: investors who are actively deploying, companies that are adjacent to Nuke's space, threads about what makes a good data business.

Return 6-10 posts. For each post include: author handle (note if they're a VC/angel), their thesis or insight, why it's relevant to Nuke's fundraise.`,
  },

  fractional: {
    label: "Fractional Vehicle Market",
    description: "Platforms offering fractional/tokenized vehicle ownership — Nuke's exchange targets these",
    query: `Find the most relevant X posts from the last ${daysBack} days from or about these fractional vehicle platforms:
- Rally Rd. (@OnRallyRd) — SEC-registered fractional collector car shares
- MCQ Markets (@MCQmarkets) — Reg A+ exotic car shares
- TheCarCrowd (@thecarcrowduk) — UK fractional classic car equity
- aShareX — fractional bidding at live auctions
- Timeless Investments (@timeless_invest) — German BaFin-regulated fractional app
- duPont REGISTRY Invest — SEC-qualified via Rally partnership
- Supercar Sharing AG — Swiss co-ownership franchise (31 countries)

Also search for: "fractional car ownership", "fractional classic car investment", "tokenized vehicle", "collector car shares", "fractional exotic car"

For each post: author, what vehicle/deal is being offered, the price/share structure, complaints or excitement from investors, and any signals about liquidity problems (people trying to exit fractional positions with no buyer).

Focus on: liquidity complaints, pricing, what vehicles are available, investor frustration — these signal the gap Nuke fills.`,
  },

  competitors: {
    label: "Competitive Landscape",
    description: "Adjacent platforms, vehicle data companies, and market entrants",
    query: `Find the most relevant X posts from the last ${daysBack} days about:
- Hagerty Valuation Tools, Hagerty Driver's Club news
- CarFax, AutoCheck, vehicle history report companies
- Bring a Trailer platform updates, new features, community
- Cars and Bids growth, strategy, or criticism
- New automotive data companies or startups
- Vehicle provenance, title history, auction record aggregators
- eBay Motors, AutoTrader, Cars.com technology updates
- AI applied to vehicle valuation or condition assessment

Focus on: gaps people are complaining about, competitive weaknesses, opportunities. Skip pure promotional posts.

Return 6-10 posts. For each post include: author handle, what they're saying, gap or opportunity it reveals for Nuke.`,
  },
};

type TopicKey = keyof typeof TOPICS;

async function searchXPosts(topicKey: TopicKey): Promise<string> {
  const topic = TOPICS[topicKey];
  console.log(`\n🔍 Searching: ${topic.label}`);

  // xAI Responses API with x_search tool (replaces deprecated search_parameters)
  // Docs: https://docs.x.ai/docs/guides/tools/overview
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout

  let response: Response;
  try {
    response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        tools: [{ type: "x_search" }],
        input: [
          {
            role: "user",
            content:
              "You are a research assistant. Search X (Twitter) and return a curated digest of the most relevant, high-signal posts. Be specific: include exact quotes or paraphrases, author handles (@username), and concrete takeaways. Cut low-signal posts ruthlessly.\n\n" +
              topic.query,
          },
        ],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`API error ${response.status}: ${JSON.stringify(err)}`);
  }

  const data = await response.json();

  // Responses API: output is an array of tool calls + a final message block
  // Message block has: { type: "message", content: [{ type: "output_text", text: "..." }] }
  type OutputBlock =
    | { type: "custom_tool_call" }
    | { type: "message"; content: Array<{ type: string; text: string }> };

  const outputBlocks: OutputBlock[] = data.output ?? [];
  const messageBlock = outputBlocks.find((b) => b.type === "message") as
    | Extract<OutputBlock, { type: "message" }>
    | undefined;

  const text =
    messageBlock?.content
      ?.filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("\n")
      .trim() ?? "";

  // Log cost
  const costTicks: number = data.usage?.cost_in_usd_ticks ?? 0;
  const costUsd = (costTicks / 1_000_000_000).toFixed(3);
  const xCalls: number = data.usage?.server_side_tool_usage_details?.x_search_calls ?? 0;
  console.log(`  💰 Cost: $${costUsd} | X searches: ${xCalls} | Tokens: ${data.usage?.total_tokens ?? "?"}`);

  return text || "(no text in response)";
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function formatOutput(results: Record<string, string>): string {
  const now = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines = [`# X Monitor Digest — ${now} UTC\n`];

  for (const [key, content] of Object.entries(results)) {
    const topic = TOPICS[key as TopicKey];
    lines.push(`## ${topic.label}`);
    lines.push(`*${topic.description}*\n`);
    lines.push(content);
    lines.push("\n---\n");
  }

  return lines.join("\n");
}

async function main() {
  const topicsToRun: TopicKey[] =
    topicArg === "all"
      ? (Object.keys(TOPICS) as TopicKey[])
      : [topicArg as TopicKey];

  // Validate
  for (const t of topicsToRun) {
    if (!TOPICS[t]) {
      console.error(`Unknown topic: ${t}. Options: ${Object.keys(TOPICS).join(", ")}, all`);
      process.exit(1);
    }
  }

  console.log(`📡 Nuke X Monitor — last ${daysBack} days`);
  console.log(`Topics: ${topicsToRun.map((t) => TOPICS[t].label).join(", ")}`);

  const results: Record<string, string> = {};

  for (const topic of topicsToRun) {
    try {
      results[topic] = await searchXPosts(topic);
      // Print inline as we go
      console.log(`\n${"=".repeat(60)}`);
      console.log(`${TOPICS[topic].label.toUpperCase()}`);
      console.log("=".repeat(60));
      console.log(results[topic]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[topic] = `Error: ${msg}`;
      console.error(`  ❌ ${TOPICS[topic].label}: ${msg}`);
    }
  }

  if (shouldSave) {
    const logPath = join(__dirname, "../docs/content/x-monitor-log.md");
    const formatted = formatOutput(results);

    // Prepend to existing log if it exists
    const existing = existsSync(logPath) ? "\n\n---\n\n" + readFileSync(logPath, "utf8") : "";
    writeFileSync(logPath, formatted + existing);
    console.log(`\n✅ Saved to docs/content/x-monitor-log.md`);
  }

  // Always send Telegram summary
  const topicLines = Object.entries(results)
    .map(([key, content]) => {
      const topic = TOPICS[key as TopicKey];
      // Pull first 2 bullet points as preview (lines starting with 1. or 2.)
      const bullets = content
        .split("\n")
        .filter((l) => /^\*?\*?[12]\.\s/.test(l.trim()))
        .slice(0, 2)
        .map((l) => "  • " + l.replace(/^\*?\*?[12]\.\s+/, "").replace(/\*\*/g, "").substring(0, 120))
        .join("\n");
      return `<b>${topic.label}</b>\n${bullets || "  (see log)"}`;
    })
    .join("\n\n");

  const now = new Date().toISOString().replace("T", " ").substring(0, 16);
  const msg =
    `📡 <b>Nuke X Monitor</b> — ${now} UTC\n` +
    `Topics: ${topicsToRun.map((t) => TOPICS[t].label).join(", ")}\n\n` +
    topicLines +
    `\n\n<i>Run x-brief.ts to generate response drafts.</i>`;

  await sendTelegram(linkXHandles(msg));
  console.log("📱 Telegram notification sent");
}

main().catch((err) => {
  console.error("Fatal:", err.message);

  if (err.message.includes("credits") || err.message.includes("spending limit")) {
    console.error("\n⚠️  Grok API credits exhausted.");
    console.error("Top up at: https://console.x.ai");
  }

  process.exit(1);
});
