#!/usr/bin/env node
/**
 * FB Saved Items Enricher v3 — reads Chrome cookies via pycookiecheat,
 * fetches listing pages with plain HTTP, parses structured data from HTML.
 *
 * Audit fixes (2026-04-05):
 *   - Removed 100 lines of dead Node.js cookie decryption code
 *   - Rate limit: 3-7s jitter (was 0.8-1.2s — risked account ban)
 *   - Circuit breaker: stops on 429/403, detects mid-run session invalidation
 *   - Retry with backoff on transient errors (500, network)
 *   - Fixed price/mileage=0 falsy bug
 *   - Added fetch timeout (15s)
 *   - Updated UA string to Chrome 135
 *   - Price sanity validation (rejects >$500K and <$50)
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-enrich-with-cookies.mjs [--limit 50] [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";

const LIMIT = parseInt(process.argv.find((a, i, arr) => arr[i - 1] === "--limit") || "100");
const DRY_RUN = process.argv.includes("--dry-run");

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Parse listing HTML ──────────────────────────────────────────────────────

function parseListing(html, fbId) {
  const g = (re) => { const m = html.match(re); return m ? m[1] : null; };
  // Unescape JSON unicode escapes (e.g. \u00b7 → ·) since we use regex not JSON.parse
  const unesc = (s) => s ? s.replace(/\\u([0-9a-fA-F]{4})/g, (_, cp) => String.fromCharCode(parseInt(cp, 16))) : s;

  const title = unesc(g(/"marketplace_listing_title":"([^"]+)"/));
  const priceStr = g(/"listing_price":\{"amount":"([\d.]+)"/);
  const rawPrice = priceStr ? Math.round(parseFloat(priceStr)) : null;
  // Sanity check: reject obviously wrong prices
  const price = (rawPrice !== null && rawPrice >= 50 && rawPrice <= 500000) ? rawPrice : null;

  const descMatch = html.match(/"redacted_description":\{"text":"((?:[^"\\]|\\.)*)"/);
  const desc = descMatch?.[1]?.replace(/\\n/g, "\n").replace(/\\\//g, "/");

  const location = g(/"location_text":\{"text":"([^"]+)"/);

  const sellerBlock = html.match(/"marketplace_listing_seller":\{[^}]*?"name":"([^"]+)"/);
  const seller = sellerBlock?.[1] || null;
  const sellerId = g(/"marketplace_listing_seller":\{[^}]*?"id":"(\d+)"/);

  // Photos
  let photos = [];
  const photoBlock = html.match(/"listing_photos":\[([^\]]{0,15000})\]/);
  if (photoBlock) {
    for (const m of photoBlock[1].matchAll(/"uri":"(https:[^"]+)"/g)) {
      const url = m[1].replace(/\\\//g, "/");
      if (!photos.includes(url) && photos.length < 20) photos.push(url);
    }
  }

  const isSold = html.includes('"is_sold":true');
  const isPending = html.includes('"is_pending":true');
  const isDead = html.includes("This listing is no longer available") ||
    html.includes('"is_404":true') || html.length < 10000;

  const mileageStr = g(/"mileage":\{"value["\s:]+(\d+)/);
  const mileage = mileageStr ? parseInt(mileageStr) : null;
  const transmission = g(/"vehicle_transmission_display":"([^"]+)"/);
  const extColor = g(/"exterior_color_display":"([^"]+)"/);

  return {
    facebook_id: fbId, title, price,
    description: desc?.substring(0, 4000),
    location, seller_name: seller, seller_fb_id: sellerId,
    photos, photo_count: photos.length,
    status: isDead ? "removed" : isSold ? "sold" : isPending ? "pending" : "active",
    mileage: (mileage !== null && mileage <= 999999) ? mileage : null,
    transmission, exterior_color: extColor,
  };
}

// ─── Year/Make/Model parser ──────────────────────────────────────────────────

function parseYMM(title) {
  if (!title) return {};
  const yearMatch = title.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;
  const makes = ["Chevrolet","Chevy","Ford","GMC","Dodge","Jeep","Toyota","Honda",
    "Nissan","Plymouth","Pontiac","Buick","Oldsmobile","Cadillac","Lincoln",
    "Mercury","AMC","International","Studebaker","BMW","Mercedes","Porsche",
    "Volkswagen","Alfa Romeo","Datsun","Triumph","MG","Jaguar","Land Rover",
    "Volvo","Subaru","Mazda","Mitsubishi","Audi","Ferrari","Lamborghini",
    "Maserati","Fiat","Saab","Shelby","Lotus","Chrysler","Ram","Tesla",
    "Acura","Lexus","Infiniti","Saturn","Isuzu","Hummer","Willys"];
  const rest = title.replace(/^\d{4}\s+/, "").trim();
  const lower = rest.toLowerCase();
  for (const make of makes) {
    if (lower.startsWith(make.toLowerCase())) {
      // Word boundary check — "Ford" shouldn't match "Fordson"
      if (rest.length > make.length && /\w/.test(rest[make.length])) continue;
      const afterMake = rest.slice(make.length).trim();
      const model = afterMake.split(/[\s·•|—,]+/).slice(0, 2).join(" ").trim() || null;
      return { year, make: make === "Chevy" ? "Chevrolet" : make, model };
    }
  }
  return { year };
}

// ─── Fetch with retry + timeout ──────────────────────────────────────────────

async function fetchWithRetry(url, headers, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(url, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.status === 429 || resp.status === 403) {
        return { blocked: true, status: resp.status };
      }
      if (resp.status >= 500 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      return { resp };
    } catch (e) {
      clearTimeout(timeout);
      if (attempt === maxRetries) return { error: e.message };
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return { error: "max retries exceeded" };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nFB Saved Items Enricher v3 (limit: ${LIMIT}, dry_run: ${DRY_RUN})\n`);

  // Get Chrome cookies via Python (handles macOS Keychain decryption correctly)
  let cookies;
  try {
    const cookieJson = execSync(
      `${process.env.HOME}/.local/venvs/fbcookies/bin/python3 scripts/export-chrome-cookies.py https://www.facebook.com`,
      { encoding: "utf8", cwd: process.cwd() }
    );
    cookies = JSON.parse(cookieJson);
  } catch (e) {
    console.error("Failed to read Chrome cookies. Run: python3 -m venv /tmp/fbcookies && /tmp/fbcookies/bin/pip install pycookiecheat");
    process.exit(1);
  }
  console.log(`Read ${Object.keys(cookies).length} Facebook cookies from Chrome`);

  if (!cookies.c_user || !cookies.xs) {
    console.error("Missing auth cookies. Make sure you're logged into Facebook in Chrome.");
    process.exit(1);
  }

  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

  const browserHeaders = {
    Cookie: cookieStr,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "sec-ch-ua": '"Chromium";v="135", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  // Test authentication
  console.log("Testing FB authentication...");
  const testResult = await fetchWithRetry(
    "https://www.facebook.com/marketplace/you/saved/",
    browserHeaders
  );
  if (testResult.blocked || testResult.error || !testResult.resp?.ok) {
    console.error("Auth test failed:", testResult.blocked ? `HTTP ${testResult.status}` : testResult.error || `HTTP ${testResult.resp?.status}`);
    process.exit(1);
  }
  const testHtml = await testResult.resp.text();
  if (testHtml.includes('"USER_ID":"0"') || testHtml.includes("login_form")) {
    console.error("Not authenticated — cookies may have expired. Log into Facebook in Chrome.");
    process.exit(1);
  }
  console.log("Authenticated OK\n");

  // Get un-enriched listings (use scraped_at as the real indicator, not seller_name)
  const { data: listings, error } = await supabase
    .from("marketplace_listings")
    .select("facebook_id, url, title")
    .is("scraped_at", null)
    .eq("user_saved", true)
    .neq("status", "removed")
    .order("first_seen_at", { ascending: false })
    .limit(LIMIT);

  if (error) { console.error("DB error:", error.message); process.exit(1); }
  if (!listings?.length) { console.log("Nothing to enrich."); return; }

  console.log(`Enriching ${listings.length} listings...\n`);

  let done = 0, enriched = 0, dead = 0, sold = 0, errors = 0;
  let consecutiveErrors = 0;

  for (const listing of listings) {
    const fbId = listing.facebook_id;
    const url = `https://www.facebook.com/marketplace/item/${fbId}/`;

    const result = await fetchWithRetry(url, browserHeaders);

    // Circuit breaker: stop on rate limit / block
    if (result.blocked) {
      console.error(`\nBlocked by Facebook (HTTP ${result.status}) after ${done} requests. Stopping.`);
      break;
    }

    if (result.error) {
      errors++;
      consecutiveErrors++;
      console.log(`  [${done + 1}/${listings.length}] ERROR  ${fbId}: ${result.error}`);
      if (consecutiveErrors >= 5) {
        console.error("\n5 consecutive errors — stopping.");
        break;
      }
      done++;
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    consecutiveErrors = 0;

    if (!result.resp.ok) {
      errors++;
      console.log(`  [${done + 1}/${listings.length}] HTTP ${result.resp.status}  ${fbId}`);
      done++;
      continue;
    }

    try {
      const html = await result.resp.text();

      // Mid-run session invalidation check
      if (html.includes('"USER_ID":"0"') || html.includes("login_form")) {
        console.error(`\nSession invalidated after ${done} requests. Stopping.`);
        break;
      }

      const data = parseListing(html, fbId);

      if (data.status === "removed") {
        if (!DRY_RUN) {
          await supabase.from("marketplace_listings").update({
            status: "removed",
            removed_at: new Date().toISOString(),
            scraped_at: new Date().toISOString(),
          }).eq("facebook_id", fbId);
        }
        dead++;
        console.log(`  [${done + 1}/${listings.length}] ✗ removed  ${fbId}`);
      } else {
        const updates = {
          scraped_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          user_saved: true,
        };
        if (data.title) updates.title = data.title;
        if (data.price !== null && data.price !== undefined) {
          updates.price = data.price;
          updates.current_price = data.price;
        }
        if (data.status) updates.status = data.status;
        if (data.seller_name) updates.seller_name = data.seller_name;
        if (data.location) updates.location = data.location;
        if (data.description) updates.description = data.description;
        if (data.photos?.length) {
          updates.all_images = data.photos;
          updates.image_url = data.photos[0];
        }
        if (data.mileage !== null && data.mileage !== undefined) updates.mileage = data.mileage;
        if (data.transmission) updates.transmission = data.transmission;
        if (data.exterior_color) updates.exterior_color = data.exterior_color;

        const { year, make, model } = parseYMM(data.title);
        if (year) updates.parsed_year = year;
        if (make) updates.parsed_make = make;
        if (model) updates.parsed_model = model;

        if (data.seller_fb_id) {
          updates.contact_info = { seller_fb_user_id: data.seller_fb_id };
        }

        if (!DRY_RUN) {
          await supabase.from("marketplace_listings").update(updates).eq("facebook_id", fbId);
        }

        if (data.status === "sold") sold++;
        else enriched++;

        const label = (data.title || "").substring(0, 45);
        const statusIcon = data.status === "sold" ? "✗ sold" : data.status === "pending" ? "⏳" : "✓";
        const priceStr = data.price ? `$${data.price.toLocaleString()}` : "$?";
        console.log(`  [${done + 1}/${listings.length}] ${statusIcon}  ${label}  ${priceStr}  ${data.location || ""}  [${data.photo_count} photos]`);
      }
    } catch (e) {
      errors++;
      console.log(`  [${done + 1}/${listings.length}] ERROR  ${fbId}: ${e.message}`);
    }

    done++;

    // Rate limit: 3-7 seconds with jitter (safe for FB detection)
    const delay = 3000 + Math.random() * 4000;
    // Every 20 requests, take a longer break (simulates human reading)
    const longBreak = (done % 20 === 0) ? 10000 + Math.random() * 5000 : 0;
    await new Promise(r => setTimeout(r, delay + longBreak));
  }

  console.log(`
────────────────────────────────
Total: ${done}
  Active: ${enriched}
  Sold:   ${sold}
  Dead:   ${dead}
  Errors: ${errors}
`);
}

main().catch(e => { console.error(e); process.exit(1); });
