#!/usr/bin/env npx tsx
/**
 * x-brief.ts — Internal response brief generator for X monitor signals
 *
 * Reads the latest x-monitor-log.md and generates a strategic brief:
 *   - Internal assessment per signal (what it means for Nuke)
 *   - Priority level (act / watch / ignore)
 *   - Public response draft (only where warranted, with risk flags)
 *   - Action items
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/x-brief.ts
 *   dotenvx run -- npx tsx scripts/x-brief.ts --topic market
 *   dotenvx run -- npx tsx scripts/x-brief.ts --save
 *
 * Runs AFTER x-monitor.ts. Does not re-search X (no API cost for search).
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendTelegram, linkXHandles } from "./_telegram.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const XAI_API_KEY = process.env.XAI_API_KEY;

if (!XAI_API_KEY) {
  console.error("XAI_API_KEY not set. Run with: dotenvx run -- npx tsx scripts/x-brief.ts");
  process.exit(1);
}

const args = process.argv.slice(2);
const topicFilter = args.includes("--topic") ? args[args.indexOf("--topic") + 1] : null;
const shouldSave = args.includes("--save");

const LOG_PATH = join(__dirname, "../docs/content/x-monitor-log.md");
const BRIEF_PATH = join(__dirname, "../docs/content/x-brief-log.md");

// Nuke context fed to the model so it understands our position
const NUKE_CONTEXT = `
You are the internal strategy analyst for Nuke (nuke.ag) — a vehicle data platform built by a solo founder.

WHAT NUKE IS:
- A structured data layer and provenance engine for collector and store-of-value vehicles
- 1.25M vehicles, 33M images, 11.6M auction comments, 513K AI valuation estimates
- Sentiment analysis on 127K vehicles — positive sentiment = nearly 2x sale price
- YONO: proprietary ML model (EfficientNet-B0), 4ms inference, $0/image cost
- 388 microservices running autonomously (Ralph Wiggum coordinator)
- TypeScript SDK, observation architecture with full provenance chain
- Raising $2M at $18M cap (post-money SAFE)
- Market: 43M store-of-value vehicles in the US, $1T asset value, $4.8B annual auction market
- Revenue model: API licensing, auction lead commissions, lender data, escrow

WHAT NUKE IS NOT:
- Not a CarFax or vehicle history report (we go deeper — auction comments, forum sentiment, images)
- Not an auction house (we send them qualified leads, we don't compete)
- Not yet publicly launched for consumers (still pre-revenue, building)
- Not a blockchain/NFT company (observation architecture is immutable but not on-chain)

TONE RULES FOR PUBLIC RESPONSES:
- Founder voice, not corporate voice
- Build in public — we're honest about what we're building
- Never trash competitors by name
- Never overclaim ("the only" / "the best") — say what we actually do
- Never respond to signal if it could invite scrutiny we're not ready for
- Be specific when engaging — vague platitudes get ignored
- Short is better — 1-3 sentences max for public replies
- If in doubt, don't reply publicly — save it for direct outreach
`.trim();

async function analyzeSignals(topic: string, content: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response: Response;
  try {
    response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: NUKE_CONTEXT,
          },
          {
            role: "user",
            content: `Below are X (Twitter) signals from the "${topic}" monitor.

For each numbered signal, produce a structured internal brief with this exact format:

---
**[N]. @handle — [3-5 word title for the signal]**
**Priority:** [ACT / WATCH / IGNORE]
**Internal:** [2-4 sentences. What does this mean for Nuke specifically? Opportunity, threat, or noise? What should we know or do internally?]
**Public reply:** [DRAFT a reply if it's worth responding to, or write "No — [reason]". If drafting, keep it 1-3 sentences, founder voice, no overclaiming. Flag any risks in brackets after.]
**Action:** [Specific next step, or "None"]
---

Signals to analyze:

${content}`,
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
  const cost = ((data.usage?.total_tokens ?? 0) * 0.000002).toFixed(4); // grok-2 pricing estimate
  console.log(`  💰 ~$${cost} | Tokens: ${data.usage?.total_tokens ?? "?"}`);
  return data.choices?.[0]?.message?.content ?? "(no output)";
}

function parseTopicSections(log: string): Record<string, string> {
  // The log prepends new runs, so we walk top-to-bottom and take the
  // FIRST occurrence of each topic name (= most recent data).
  // We explicitly skip bodies that contain "fetch failed" or "Error:" as
  // their entire content — those are stale failed runs.
  const sections: Record<string, string> = {};
  const parts = log.split(/^## /m).filter(Boolean);
  for (const part of parts) {
    const firstLine = part.split("\n")[0].trim();
    if (firstLine.startsWith("X Monitor Digest")) continue;
    const body = part.split("\n").slice(1).join("\n").trim();
    const isFailedRun = body.length < 200 && /fetch failed|Error:/i.test(body);
    if (body.length > 100 && !isFailedRun && !(firstLine in sections)) {
      sections[firstLine] = body;
    }
  }
  return sections;
}

async function main() {
  if (!existsSync(LOG_PATH)) {
    console.error(`No monitor log found at ${LOG_PATH}`);
    console.error("Run x-monitor.ts first: dotenvx run -- npx tsx scripts/x-monitor.ts --save");
    process.exit(1);
  }

  const log = readFileSync(LOG_PATH, "utf8");
  // Collapse all runs into one document — sections are unique by name,
  // first occurrence (most recent) wins when we parse
  const collapsed = log.replace(/\n---\n\n# X Monitor Digest[^\n]*/g, "");
  const sections = parseTopicSections(collapsed);
  const topicKeys = Object.keys(sections);

  if (topicKeys.length === 0) {
    console.error("Could not parse topic sections from log. Has x-monitor.ts been run with --save?");
    process.exit(1);
  }

  const toProcess = topicFilter
    ? topicKeys.filter((k) => k.toLowerCase().includes(topicFilter.toLowerCase()))
    : topicKeys;

  if (toProcess.length === 0) {
    console.error(`No sections matched filter "${topicFilter}". Available: ${topicKeys.join(", ")}`);
    process.exit(1);
  }

  const now = new Date().toISOString().replace("T", " ").substring(0, 16);
  console.log(`\n📋 Nuke X Brief — ${now} UTC`);
  console.log(`Analyzing ${toProcess.length} topic(s): ${toProcess.join(", ")}`);
  console.log(`Using grok-2 (analysis only, no X search)\n`);

  const briefs: string[] = [`# Nuke X Brief — ${now} UTC\n`];

  for (const topic of toProcess) {
    console.log(`\n📌 Analyzing: ${topic}`);
    try {
      const brief = await analyzeSignals(topic, sections[topic]);
      const section = `## ${topic}\n\n${brief}\n\n---\n`;
      briefs.push(section);

      // Print inline
      console.log(`\n${"─".repeat(60)}`);
      console.log(brief);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${topic}: ${msg}`);
      briefs.push(`## ${topic}\n\nError: ${msg}\n\n---\n`);
    }
  }

  const output = briefs.join("\n");

  if (shouldSave) {
    const existing = existsSync(BRIEF_PATH)
      ? "\n\n---\n\n" + readFileSync(BRIEF_PATH, "utf8")
      : "";
    writeFileSync(BRIEF_PATH, output + existing);
    console.log(`\n✅ Saved to docs/content/x-brief-log.md`);
  }

  // Extract ACT-priority items across all topics and send as Telegram digest
  const actItems: string[] = [];
  const fullBriefText = briefs.join("\n");
  const blocks = fullBriefText.split(/\n---\n/).filter(Boolean);

  for (const block of blocks) {
    if (!block.includes("**Priority:** ACT")) continue;
    // Extract handle + title line and the public reply if it's a DRAFT
    const titleMatch = block.match(/\*\*\[?\d+\]?\.\s+@(\S+)\s+—\s+([^\n*]+)/);
    const replyMatch = block.match(/\*\*Public reply:\*\*\s+"([^"]{0,200})/);
    const actionMatch = block.match(/\*\*Action:\*\*\s+([^\n]+)/);

    if (titleMatch) {
      const handle = `@${titleMatch[1]}`;
      const title = titleMatch[2].trim();
      let item = `🔴 <b>ACT</b> — ${handle} · ${title}`;
      if (actionMatch) item += `\n  → ${actionMatch[1].trim()}`;
      if (replyMatch) item += `\n  💬 Draft: "<i>${replyMatch[1].trim()}...</i>"`;
      actItems.push(item);
    }
  }

  const briefNow = new Date().toISOString().replace("T", " ").substring(0, 16);
  const telegramMsg =
    actItems.length > 0
      ? `📋 <b>Nuke X Brief</b> — ${briefNow} UTC\n\n` +
        `<b>${actItems.length} item(s) need your attention:</b>\n\n` +
        actItems.join("\n\n") +
        `\n\n<i>Full brief saved to x-brief-log.md</i>`
      : `📋 <b>Nuke X Brief</b> — ${briefNow} UTC\n\nNo ACT-priority items this run. Everything is WATCH or IGNORE.\n\n<i>Full brief saved to x-brief-log.md</i>`;

  await sendTelegram(linkXHandles(telegramMsg));
  console.log("📱 Telegram notification sent");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
