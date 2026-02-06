#!/usr/bin/env npx tsx
/**
 * FB Group Surfer
 *
 * Uses your FB login to browse groups like a human.
 * Playwright with saved cookies - sees everything a logged-in user sees.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const COOKIES_FILE = "/Users/skylar/nuke/logs/fb-session-cookies.json";
const SEEN_POSTS_FILE = "/Users/skylar/nuke/logs/fb-surfer-seen.json";

// Squarebody and related groups
const GROUPS = [
  { id: "328305202250392", name: "Chevy/GMC Squarebody 73-87" },
  { id: "144653685615130", name: "C10 Trucks" },
  { id: "1488928498043836", name: "Square Body Nation" },
  { id: "582924748108652", name: "K5 Blazer Enthusiasts" },
  { id: "361629407329215", name: "Square Body Crew" },
  { id: "1945287845729547", name: "Chevy C10/C20 Buy Sell Trade" },
  { id: "251667028234891", name: "First Gen Cummins" },
  { id: "283947561829374", name: "Early Bronco Buy Sell Trade" },
];

const CONFIG = {
  CHECK_INTERVAL_MS: 45 * 60 * 1000, // 45 minutes
  SCROLL_DELAY_MS: 2000,
  BETWEEN_GROUPS_MS: 30000,
  BETWEEN_POSTS_MS: 3000,
};

let browser: Browser;
let context: BrowserContext;
let page: Page;
let seenPosts: Set<string> = new Set();

async function sendTelegram(message: string, imageUrl?: string) {
  try {
    if (imageUrl && !imageUrl.includes("emoji")) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: imageUrl,
          caption: message.slice(0, 1024),
          parse_mode: "HTML",
        }),
      });
    } else {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      });
    }
  } catch (err) {
    console.error("Telegram error:", err);
  }
}

async function loadSeenPosts() {
  try {
    const data = await fs.readFile(SEEN_POSTS_FILE, "utf-8");
    seenPosts = new Set(JSON.parse(data));
    console.log(`Loaded ${seenPosts.size} seen posts`);
  } catch {
    seenPosts = new Set();
  }
}

async function saveSeenPosts() {
  await fs.writeFile(SEEN_POSTS_FILE, JSON.stringify([...seenPosts]));
}

async function initBrowser() {
  browser = await chromium.launch({
    headless: false, // Visible browser
    args: ["--disable-blink-features=AutomationControlled"],
    slowMo: 50,
  });

  context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
  });

  // Load cookies
  try {
    const cookies = JSON.parse(await fs.readFile(COOKIES_FILE, "utf-8"));
    await context.addCookies(cookies);
    console.log("Loaded FB session cookies");
  } catch {
    console.log("No cookies found - will need to log in");
  }

  page = await context.newPage();
}

async function ensureLoggedIn(): Promise<boolean> {
  await page.goto("https://www.facebook.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const loggedIn = await page.evaluate(() => {
    return document.body.innerText.includes("What's on your mind") ||
           document.body.innerText.includes("Create post") ||
           document.querySelector('[aria-label="Your profile"]') !== null;
  });

  if (!loggedIn) {
    console.log("\n⚠️  Not logged in. Please log in manually...");
    console.log("   Waiting for login (will auto-detect)...\n");

    // Wait for login (check every 5 seconds)
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(5000);
      const nowLoggedIn = await page.evaluate(() => {
        return document.body.innerText.includes("What's on your mind") ||
               document.querySelector('[aria-label="Your profile"]') !== null;
      });
      if (nowLoggedIn) {
        // Save cookies
        const cookies = await context.cookies();
        await fs.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
        console.log("Login detected! Cookies saved.");
        return true;
      }
    }
    return false;
  }

  return true;
}

async function surfGroup(group: typeof GROUPS[0]): Promise<any[]> {
  const url = `https://www.facebook.com/groups/${group.id}/`;
  console.log(`\n  Surfing: ${group.name}`);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Scroll a bit to load more posts
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(CONFIG.SCROLL_DELAY_MS);
  }

  // Extract posts
  const posts = await page.evaluate((groupName) => {
    const results: any[] = [];

    // Find all post containers
    document.querySelectorAll('[data-pagelet^="FeedUnit"]').forEach((post: any) => {
      const text = post.innerText || "";
      const links = post.querySelectorAll('a[href*="/groups/"]');

      // Find post link
      let postUrl = "";
      let postId = "";
      links.forEach((link: any) => {
        const href = link.href;
        const match = href.match(/\/posts\/(\d+)/);
        if (match) {
          postId = match[1];
          postUrl = href.split("?")[0];
        }
      });

      if (!postId) return;

      // Get images
      const images: string[] = [];
      post.querySelectorAll('img').forEach((img: HTMLImageElement) => {
        if (img.src && img.src.includes("scontent") && img.width > 100) {
          images.push(img.src);
        }
      });

      // Check if it looks like a vehicle post
      const hasVehicleKeywords = /\$[\d,]+|\d{4}|chevy|ford|gmc|dodge|truck|blazer|bronco|c10|k10|c20|k20|cummins|silverado|for sale|fs\b|wts\b|selling/i.test(text);

      if (hasVehicleKeywords) {
        // Extract price if present
        const priceMatch = text.match(/\$[\d,]+/);

        // Extract year if present
        const yearMatch = text.match(/\b(19[6-9]\d|20[0-2]\d)\b/);

        results.push({
          postId,
          url: postUrl,
          text: text.slice(0, 500),
          price: priceMatch?.[0] || null,
          year: yearMatch?.[1] || null,
          images: images.slice(0, 3),
          group: groupName,
        });
      }
    });

    return results;
  }, group.name);

  return posts;
}

async function processNewPosts(posts: any[]) {
  let newCount = 0;

  for (const post of posts) {
    if (seenPosts.has(post.postId)) continue;
    seenPosts.add(post.postId);
    newCount++;

    console.log(`    NEW: ${post.text.slice(0, 60).replace(/\n/g, " ")}...`);

    // Send Telegram alert
    const message = `🚨 <b>New in ${post.group}</b>

${post.year ? `Year: ${post.year}` : ""}
${post.price ? `💰 ${post.price}` : ""}

${post.text.slice(0, 300)}${post.text.length > 300 ? "..." : ""}

<a href="${post.url}">View Post</a>`;

    await sendTelegram(message, post.images[0]);

    // Save to DB
    try {
      await supabase.from("vehicles").insert({
        title: post.text.split("\n")[0]?.slice(0, 200) || "FB Group Post",
        year: post.year ? parseInt(post.year) : null,
        sale_price: post.price ? parseInt(post.price.replace(/[$,]/g, "")) : null,
        discovery_source: "fb-group-surfer",
        discovery_url: post.url,
        status: "active",
        is_public: true,
        notes: post.text.slice(0, 1000),
      });
    } catch {
      // Ignore DB errors
    }

    await page.waitForTimeout(CONFIG.BETWEEN_POSTS_MS);
  }

  return newCount;
}

async function surfAllGroups() {
  console.log(`\n[${new Date().toISOString()}] Starting group surf...`);

  let totalNew = 0;

  for (const group of GROUPS) {
    try {
      const posts = await surfGroup(group);
      console.log(`    Found ${posts.length} vehicle posts`);

      const newCount = await processNewPosts(posts);
      totalNew += newCount;

      if (newCount > 0) {
        console.log(`    ${newCount} NEW posts`);
      }

      await page.waitForTimeout(CONFIG.BETWEEN_GROUPS_MS);
    } catch (err: any) {
      console.log(`    Error: ${err.message}`);
    }
  }

  await saveSeenPosts();

  console.log(`\nSurf complete. ${totalNew} new posts found.`);

  if (totalNew > 0) {
    await sendTelegram(`📊 <b>Group Surf Complete</b>\n\n🆕 ${totalNew} new vehicle posts found\n📦 ${seenPosts.size} total tracked`);
  }
}

async function main() {
  console.log("======================================");
  console.log("  FB GROUP SURFER (Human Mode)");
  console.log("======================================");
  console.log(`Surfing ${GROUPS.length} groups:`);
  GROUPS.forEach(g => console.log(`  - ${g.name}`));
  console.log(`\nInterval: ${CONFIG.CHECK_INTERVAL_MS / 60000} minutes\n`);

  await loadSeenPosts();
  await initBrowser();

  const loggedIn = await ensureLoggedIn();
  if (!loggedIn) {
    console.log("Failed to log in. Exiting.");
    await browser.close();
    process.exit(1);
  }

  await sendTelegram(`🏄 <b>FB Group Surfer Started</b>

Surfing ${GROUPS.length} squarebody groups as logged-in user.
Will alert when new vehicle posts appear.

Groups:
${GROUPS.map(g => `• ${g.name}`).join("\n")}`);

  // Initial surf
  await surfAllGroups();

  // Schedule periodic surfs
  setInterval(surfAllGroups, CONFIG.CHECK_INTERVAL_MS);

  console.log("\nSurfer running. Browser will stay open. Ctrl+C to stop.");
}

main().catch(console.error);
