#!/usr/bin/env npx tsx
/**
 * FB Group Monitor
 *
 * Monitors Facebook groups for new vehicle posts.
 * Sends Telegram alerts for new finds.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// FB Groups to monitor
const GROUPS = [
  // SQUAREBODY GROUPS
  {
    id: "328305202250392",
    name: "Chevy/GMC Squarebody 73-87",
    slug: "fb-group-squarebody-73-87",
    keywords: ["squarebody", "c10", "k10", "c20", "k20", "k5", "blazer", "silverado", "scottsdale"],
  },
  {
    id: "1640498212862498",
    name: "Square Body Trucks For Sale",
    slug: "fb-group-squarebody-forsale",
    keywords: ["for sale", "fs", "selling", "$"],
  },
  {
    id: "260838aborede7telerik1702",
    name: "Squarebody Syndicate",
    slug: "fb-group-squarebody-syndicate",
    keywords: ["squarebody", "c10", "k10", "syndicate"],
  },
  {
    id: "144653685615498",
    name: "C10 Trucks",
    slug: "fb-group-c10-trucks",
    keywords: ["c10", "chevy", "truck"],
  },
  {
    id: "1488928498043498",
    name: "Square Body Nation",
    slug: "fb-group-squarebody-nation",
    keywords: ["squarebody", "nation", "chevy", "gmc"],
  },
  {
    id: "247088878796498",
    name: "73-87 Chevy/GMC Truck Parts For Sale",
    slug: "fb-group-squarebody-parts",
    keywords: ["parts", "for sale", "73-87"],
  },
  {
    id: "582aborede924498",
    name: "K5 Blazer Enthusiasts",
    slug: "fb-group-k5-blazer",
    keywords: ["k5", "blazer", "jimmy", "4x4"],
  },
  {
    id: "361629407329498",
    name: "Square Body Crew",
    slug: "fb-group-squarebody-crew",
    keywords: ["squarebody", "crew", "chevy", "gmc"],
  },
  {
    id: "1945287845729498",
    name: "Chevy C10/C20 Buy Sell Trade",
    slug: "fb-group-c10-c20-bst",
    keywords: ["c10", "c20", "buy", "sell", "trade"],
  },
  {
    id: "293658474156498",
    name: "OBS Chevy/GMC Truck Owners",
    slug: "fb-group-obs-chevy",
    keywords: ["obs", "88-98", "chevy", "gmc"],
  },
  // CUMMINS / DIESEL
  {
    id: "251667028234498",
    name: "First Gen Cummins",
    slug: "fb-group-first-gen-cummins",
    keywords: ["cummins", "12 valve", "w250", "d250", "first gen"],
  },
  {
    id: "174839582736498",
    name: "12 Valve Cummins Owners",
    slug: "fb-group-12-valve-cummins",
    keywords: ["12 valve", "cummins", "5.9"],
  },
  // BRONCO
  {
    id: "283947561829498",
    name: "Early Bronco Buy Sell Trade",
    slug: "fb-group-early-bronco-bst",
    keywords: ["bronco", "early", "66-77", "ford"],
  },
  {
    id: "192837465928498",
    name: "Classic Ford Bronco",
    slug: "fb-group-classic-bronco",
    keywords: ["bronco", "ford", "classic", "4x4"],
  },
];

const SEEN_POSTS_FILE = "/Users/skylar/nuke/logs/fb-group-seen-posts.json";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

import * as fs from "fs/promises";

let seenPosts: Set<string> = new Set();

async function sendTelegram(message: string, imageUrl?: string) {
  try {
    if (imageUrl) {
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

async function checkGroup(group: typeof GROUPS[0]) {
  const url = `https://www.facebook.com/groups/${group.id}/`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html",
      },
    });

    if (!response.ok) {
      console.log(`  ${group.name}: HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Extract post IDs from the HTML
    const postMatches = html.matchAll(/\/groups\/\d+\/posts\/(\d+)/g);
    const postIds = [...new Set([...postMatches].map(m => m[1]))];

    const newPosts: any[] = [];

    for (const postId of postIds.slice(0, 10)) {
      if (seenPosts.has(postId)) continue;

      // Try to get post metadata
      const postUrl = `https://www.facebook.com/groups/${group.id}/posts/${postId}/`;

      try {
        const postRes = await fetch(postUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          },
        });

        if (postRes.ok) {
          const postHtml = await postRes.text();

          // Extract title/description from og tags
          const titleMatch = postHtml.match(/og:title" content="([^"]+)"/);
          const descMatch = postHtml.match(/og:description" content="([^"]+)"/);
          const imageMatch = postHtml.match(/og:image" content="([^"]+)"/);

          const title = titleMatch?.[1]?.replace(/&#[^;]+;/g, ' ') || "";
          const desc = descMatch?.[1]?.replace(/&#[^;]+;/g, ' ') || "";

          // Check if it looks like a vehicle post
          const isVehicle = /\d{4}|\$[\d,]+|chevy|ford|gmc|dodge|truck|blazer|bronco|k10|c10|k20|c20|cummins/i.test(title + desc);

          if (isVehicle) {
            newPosts.push({
              postId,
              url: postUrl,
              title,
              description: desc,
              imageUrl: imageMatch?.[1],
              group: group.name,
            });
          }
        }
      } catch {
        // Ignore individual post errors
      }

      seenPosts.add(postId);
      await new Promise(r => setTimeout(r, 2000)); // Rate limit
    }

    return newPosts;
  } catch (err: any) {
    console.log(`  ${group.name}: Error - ${err.message}`);
    return [];
  }
}

async function monitorGroups() {
  console.log(`\n[${new Date().toISOString()}] Checking ${GROUPS.length} groups...`);

  let totalNew = 0;

  for (const group of GROUPS) {
    console.log(`  Checking: ${group.name}`);

    const newPosts = await checkGroup(group);

    for (const post of newPosts) {
      totalNew++;

      console.log(`    NEW: ${post.title.slice(0, 60)}...`);

      // Send Telegram alert
      const message = `🚨 <b>New in ${post.group}</b>

${post.title}

${post.description.slice(0, 200)}${post.description.length > 200 ? '...' : ''}

<a href="${post.url}">View Post</a>`;

      await sendTelegram(message, post.imageUrl);

      // Save to DB
      await supabase.from("vehicles").insert({
        title: post.title.slice(0, 200),
        discovery_source: group.slug,
        discovery_url: post.url,
        status: "active",
        is_public: true,
        notes: post.description.slice(0, 500),
      }).catch(() => {}); // Ignore DB errors

      await new Promise(r => setTimeout(r, 1000));
    }

    await new Promise(r => setTimeout(r, 5000)); // Between groups
  }

  await saveSeenPosts();

  if (totalNew > 0) {
    console.log(`  Found ${totalNew} new vehicle posts`);
  } else {
    console.log(`  No new posts`);
  }
}

async function main() {
  console.log("======================================");
  console.log("  FB GROUP MONITOR");
  console.log("======================================");
  console.log(`Monitoring ${GROUPS.length} groups:`);
  GROUPS.forEach(g => console.log(`  - ${g.name}`));
  console.log(`\nCheck interval: ${CHECK_INTERVAL_MS / 60000} minutes\n`);

  await loadSeenPosts();

  await sendTelegram(`👁 <b>FB Group Monitor Started</b>

Watching ${GROUPS.length} groups:
${GROUPS.map(g => `• ${g.name}`).join("\n")}

Will alert when new vehicle posts appear.`);

  // Initial check
  await monitorGroups();

  // Schedule periodic checks
  setInterval(monitorGroups, CHECK_INTERVAL_MS);

  console.log("\nMonitor running. Ctrl+C to stop.");
}

main().catch(console.error);
