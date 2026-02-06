#!/usr/bin/env npx tsx
/**
 * FB Collector Monitor - Sends hourly Telegram updates
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const PROGRESS_FILE = "/Users/skylar/nuke/logs/fb-collector-progress.json";
const MONITOR_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

interface Progress {
  locations_completed: string[];
  listings_needing_details: string[];
  started_at: string;
  last_updated: string;
}

async function sendTelegram(message: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      console.error("Telegram error:", await res.text());
    }
  } catch (err: any) {
    console.error("Failed to send Telegram:", err.message);
  }
}

async function getDbStats() {
  // Get total marketplace listings
  const { count: totalListings } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true });

  // Get listings with descriptions
  const { count: withDescriptions } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .not("description", "is", null);

  // Get today's listings
  const today = new Date().toISOString().split("T")[0];
  const { count: todayListings } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .gte("created_at", today);

  // Get vintage vehicles (60-99)
  const { count: vintageCount } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .gte("year", 1960)
    .lte("year", 1999);

  return {
    total: totalListings || 0,
    withDescriptions: withDescriptions || 0,
    today: todayListings || 0,
    vintage: vintageCount || 0,
  };
}

async function checkCollectorRunning(): Promise<boolean> {
  try {
    const { execSync } = await import("child_process");
    const result = execSync("ps aux | grep fb-marketplace-full-collector | grep -v grep", { encoding: "utf-8" });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

async function getProgress(): Promise<Progress | null> {
  try {
    const data = await fs.readFile(PROGRESS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function sendUpdate() {
  const isRunning = await checkCollectorRunning();
  const progress = await getProgress();
  const dbStats = await getDbStats();

  const locationsCompleted = progress?.locations_completed?.length || 0;
  const totalLocations = 582;
  const pct = Math.round((locationsCompleted / totalLocations) * 100);

  const startedAt = progress?.started_at ? new Date(progress.started_at) : null;
  const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 3600000) : 0;

  const status = isRunning ? "🟢 RUNNING" : "🔴 STOPPED";

  const message = `
<b>FB Marketplace Collector</b>
${status}

<b>Progress:</b>
📍 Locations: ${locationsCompleted}/${totalLocations} (${pct}%)
⏱ Running: ${elapsed}h

<b>Database:</b>
📦 Total listings: ${dbStats.total.toLocaleString()}
🚗 Vintage (60-99): ${dbStats.vintage.toLocaleString()}
📝 With descriptions: ${dbStats.withDescriptions.toLocaleString()}
🆕 Today: ${dbStats.today.toLocaleString()}

<i>Next update in 1 hour</i>
`.trim();

  await sendTelegram(message);
  console.log(`[${new Date().toISOString()}] Sent Telegram update`);
}

async function main() {
  console.log("FB Collector Monitor started");
  console.log(`Sending updates to Telegram chat ${TELEGRAM_CHAT_ID}`);
  console.log(`Interval: ${MONITOR_INTERVAL_MS / 60000} minutes\n`);

  // Send initial update
  await sendUpdate();

  // Schedule hourly updates
  setInterval(sendUpdate, MONITOR_INTERVAL_MS);

  // Keep process alive
  console.log("Monitor running. Press Ctrl+C to stop.\n");
}

main().catch(console.error);
