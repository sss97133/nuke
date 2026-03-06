#!/usr/bin/env npx tsx
/**
 * Scrape FB Marketplace saved items — authenticated, full data extraction.
 * Collects all saved item URLs via Playwright, then visits each one while
 * logged in to extract: title, price, status, seller info, date, photos, vehicle details.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/fb-scrape-saved.ts
 *   dotenvx run -- npx tsx scripts/fb-scrape-saved.ts --enrich-only   # skip scroll, just enrich existing
 */

import { chromium, type Page, type BrowserContext as _BC } from "playwright";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, "../fb-session-1");
const ENRICH_ONLY = process.argv.includes("--enrich-only");

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Listing extractor (uses locator API to avoid esbuild __name issues) ──────
// Reuses the same page for all listings for performance (cached FB assets).

async function extractListing(page: Page, url: string) {
  try {
    // "commit" fires on first byte — fastest. Then wait for h1 (React render indicator).
    await page.goto(url, { waitUntil: "commit", timeout: 15000 });
    await page.waitForSelector("h1", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);

    // Dead listing check via locator (runs in Node, not browser)
    const h1Text = (await page.locator("h1").first().textContent({ timeout: 4000 }).catch(() => "")) || "";
    if (!h1Text.trim() || h1Text.trim() === "Marketplace") {
      return { dead: true };
    }

    const title = h1Text.trim();
    // textContent is faster than innerText (no layout reflow)
    const body = await page.evaluate(() => document.body.textContent || "");
    const bodyLower = body.toLowerCase();

    // Meta via locator
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute("content").catch(() => null);
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);

    // Price
    const priceMatch = body.match(/\$\s*([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : null;

    // Status — FB prefixes sold listings "Sold · Title" and pending "Pending · Title"
    let status = "active";
    if (
      bodyLower.includes("item sold") || bodyLower.includes("no longer available") || bodyLower.includes("item unavailable") ||
      /^sold[\s·•]/i.test(title)
    ) {
      status = "sold";
    } else if (/^pending[\s·•]/i.test(title)) {
      status = "pending";
    }

    // Seller — find profile link with actual name (not "Seller details")
    const sellerLinks = await page.locator('a[href*="/marketplace/profile/"]').all();
    let sellerName: string | null = null;
    let sellerProfileUrl: string | null = null;
    for (const link of sellerLinks) {
      const t = ((await link.textContent()) || "").trim();
      if (t && t !== "Seller details" && t.length > 1 && t.length < 80) {
        sellerName = t;
        const href = (await link.getAttribute("href")) || "";
        sellerProfileUrl = href.split("?")[0] || null;
        break;
      }
    }
    const sellerFbUserId = sellerProfileUrl?.match(/\/marketplace\/profile\/(\d+)/)?.[1] || null;
    const joinedMatch = body.match(/Joined Facebook in (\d{4})/);
    const sellerJoinedYear = joinedMatch ? parseInt(joinedMatch[1]) : null;

    // Date
    let listedDaysAgo: number | null = null;
    const listedMatch = body.match(/Listed\s+(\d+)\s+(hour|day|week|month)/i);
    if (listedMatch) {
      const n = parseInt(listedMatch[1]);
      const unit = listedMatch[2].toLowerCase();
      if (unit.startsWith("hour")) listedDaysAgo = 0;
      else if (unit.startsWith("day")) listedDaysAgo = n;
      else if (unit.startsWith("week")) listedDaysAgo = n * 7;
      else if (unit.startsWith("month")) listedDaysAgo = n * 30;
    }

    // Location
    const listedLocMatch = body.match(/Listed\s+[\w\s]+ago\s+in\s+([^\n.,]+?,\s*[A-Z]{2})/);
    const location = listedLocMatch ? listedLocMatch[1].trim() : null;

    // Photos — plain JS, no TS features
    const photos = await page.evaluate(function() {
      return Array.prototype.slice.call(document.querySelectorAll("img"))
        .map(function(img) { return img.src; })
        .filter(function(src) {
          return src && (src.indexOf("scontent") > -1 || src.indexOf("fbcdn") > -1) &&
            (src.indexOf(".jpg") > -1 || src.indexOf(".webp") > -1) &&
            src.indexOf("emoji") === -1 && src.indexOf("rsrc") === -1 && src.length > 80;
        })
        .filter(function(src, i, arr) { return arr.indexOf(src) === i; })
        .slice(0, 30);
    });

    // Vehicle fields
    const yearMatch = title.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
    const parsedYear = yearMatch ? parseInt(yearMatch[1]) : null;
    const makes = ["Chevrolet","Chevy","Ford","GMC","Dodge","Jeep","Toyota","Honda","Nissan","Plymouth","Pontiac","Buick","Oldsmobile","Cadillac","Lincoln","Mercury","AMC","International","Studebaker","Alfa","BMW","Mercedes","Porsche","Volkswagen","Subaru","Suzuki","Mitsubishi","Mazda","Hyundai","Harley","Kawasaki","Yamaha","Triumph"];
    const parsedMake = makes.find((m) => title.toLowerCase().includes(m.toLowerCase())) || null;
    const mileMatch = body.match(/([\d,]+)\s*(?:miles?|mi\b)/i);
    const mileage = mileMatch ? parseInt(mileMatch[1].replace(/,/g, "")) : null;
    let transmission: string | null = null;
    if (bodyLower.includes("automatic")) transmission = "automatic";
    else if (bodyLower.includes("manual") || /\d-speed/.test(bodyLower)) transmission = "manual";
    const colorMatch = title.match(/\b(black|white|red|blue|green|silver|grey|gray|yellow|orange|brown|tan|maroon|navy|teal|bronze|burgundy|cream)\b/i);
    const exteriorColor = colorMatch?.[1]?.toLowerCase() || null;

    return {
      title, price, status,
      sellerName, sellerProfileUrl, sellerFbUserId, sellerJoinedYear,
      listedDaysAgo, location, description: ogDesc, photos, ogImage,
      mileage, transmission, exteriorColor, parsedYear, parsedMake,
    };
  } catch (e: any) {
    return { error: (e as Error).message };
  }
}

// ─── Upsert seller ────────────────────────────────────────────────────────────

async function upsertSeller(profileUrl: string, name: string, fbUserId?: string) {
  const { data, error } = await supabase
    .from("fb_marketplace_sellers")
    .upsert(
      {
        fb_profile_url: profileUrl,
        display_name: name,
        fb_user_id: fbUserId || null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "fb_profile_url" }
    )
    .select("id")
    .single();
  if (error) { console.error("seller upsert error:", error.message); return null; }
  return data?.id || null;
}

// ─── Update listing ───────────────────────────────────────────────────────────

async function updateListing(facebookId: string, data: any) {
  const updates: any = {
    scraped_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };

  if (data.title) updates.title = data.title;
  if (data.price) { updates.price = data.price; updates.current_price = data.price; }
  if (data.status) updates.status = data.status;
  if (data.sellerName) updates.seller_name = data.sellerName;
  if (data.sellerProfileUrl) updates.seller_profile_url = data.sellerProfileUrl;
  if (data.listedDaysAgo !== null) updates.listed_days_ago = data.listedDaysAgo;
  if (data.location) updates.location = data.location;
  if (data.description) updates.description = data.description;
  if (data.photos?.length) {
    updates.all_images = data.photos;
    updates.image_url = data.photos[0];
  } else if (data.ogImage) {
    updates.image_url = data.ogImage;
    updates.all_images = [data.ogImage];
  }
  if (data.mileage) updates.mileage = data.mileage;
  if (data.transmission) updates.transmission = data.transmission;
  if (data.exteriorColor) updates.exterior_color = data.exteriorColor;
  if (data.parsedYear) updates.parsed_year = data.parsedYear;
  if (data.parsedMake) updates.parsed_make = data.parsedMake;

  // Store seller join year in contact_info
  if (data.sellerJoinedYear || data.sellerProfileUrl) {
    updates.contact_info = {
      seller_profile_url: data.sellerProfileUrl,
      seller_fb_user_id: data.sellerFbUserId,
      joined_year: data.sellerJoinedYear,
    };
  }

  // Upsert seller and link
  if (data.sellerProfileUrl && data.sellerName) {
    const sellerId = await upsertSeller(data.sellerProfileUrl, data.sellerName, data.sellerFbUserId);
    if (sellerId) updates.fb_seller_id = sellerId;
  }

  const { error } = await supabase
    .from("marketplace_listings")
    .update(updates)
    .eq("facebook_id", facebookId);

  if (error) console.error(`  update error for ${facebookId}:`, error.message);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
];

async function launchBrowser() {
  // Remove stale singleton locks before launching
  const { unlinkSync } = await import("fs");
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { unlinkSync(path.join(PROFILE_DIR, f)); } catch {}
  }
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: LAUNCH_ARGS,
  });
}

function setupPageRouting(page: Page) {
  // Block media files — we extract img.src strings set by React, not actual image data
  page.route("**/*.{jpg,jpeg,png,gif,webp,svg,ico,woff,woff2,ttf,eot,mp4,webm,ogg}", (route) =>
    route.abort()
  ).catch(() => {});
}

async function main() {
  let browser = await launchBrowser();
  let page = browser.pages()[0] || await browser.newPage();
  setupPageRouting(page);

  // ── Check login (always, even in --enrich-only mode) ──
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  let cookies = await browser.cookies(["https://www.facebook.com"]);
  if (!cookies.some((c) => c.name === "c_user")) {
    console.log("Not logged in — log into Facebook in the browser window.");
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(3000);
      cookies = await browser.cookies(["https://www.facebook.com"]);
      if (cookies.some((c) => c.name === "c_user")) break;
      process.stdout.write(`\rWaiting for login... ${(i + 1) * 3}s`);
    }
  }
  console.log("Already logged in!");

  if (!ENRICH_ONLY) {

    // ── Collect saved item IDs ──
    console.log("\nNavigating to saved items...");
    await page.goto("https://www.facebook.com/marketplace/you/saved/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(3000);
    console.log("Scrolling to collect all items...\n");

    const allIds = new Set<string>();
    let noNew = 0;

    for (let round = 0; round < 200; round++) {
      const ids = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('a[href*="marketplace/item"]').forEach((a) => {
          const m = (a as HTMLAnchorElement).href.match(/marketplace\/item\/(\d{10,})/);
          if (m) out.push(m[1]);
        });
        return out;
      });

      const before = allIds.size;
      ids.forEach((id) => allIds.add(id));
      const found = allIds.size - before;

      if (found === 0) {
        noNew++;
        if (noNew >= 10) break;
      } else {
        noNew = 0;
      }

      process.stdout.write(`\r  ${allIds.size} items found (round ${round + 1})...`);
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(700);
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(700);
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(1800);
    }

    console.log(`\n\nFound ${allIds.size} total saved items.`);

    // ── Insert new IDs into DB (bare minimum, enrich below) ──
    const ids = [...allIds];
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("facebook_id")
      .in("facebook_id", ids);
    const existingSet = new Set((existing || []).map((r: any) => r.facebook_id));
    const newIds = ids.filter((id) => !existingSet.has(id));

    console.log(`Already in DB: ${existingSet.size}  |  New: ${newIds.length}`);

    if (newIds.length > 0) {
      const rows = newIds.map((id) => ({
        facebook_id: id,
        url: `https://www.facebook.com/marketplace/item/${id}/`,
        platform: "facebook_marketplace",
        status: "active",
        priority: "manual_import",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("marketplace_listings").insert(rows);
      if (error) console.error("Insert error:", error.message);
      else console.log(`Inserted ${newIds.length} new listing stubs.`);
    }
  }

  // ── Enrich: visit every listing that needs data ──
  console.log("\nFetching listings to enrich...");
  const { data: toEnrich } = await supabase
    .from("marketplace_listings")
    .select("facebook_id, url, title, seller_name")
    .is("seller_name", null)
    .eq("platform", "facebook_marketplace")
    .eq("priority", "manual_import")
    .order("first_seen_at", { ascending: false })
    .limit(600);

  if (!toEnrich?.length) {
    console.log("Nothing to enrich.");
    await browser.close();
    return;
  }

  console.log(`Enriching ${toEnrich.length} listings through authenticated browser...\n`);

  let done = 0, sold = 0, active = 0, errors = 0;

  for (const listing of toEnrich) {
    const url = listing.url || `https://www.facebook.com/marketplace/item/${listing.facebook_id}/`;
    process.stdout.write(`\r  [${done + 1}/${toEnrich.length}] ${listing.facebook_id}...`);

    // Reuse the same page for speed (cached FB assets). On crash: relaunch browser.
    let data: any = await extractListing(page, url).catch(async (e: any) => {
      if (e.message.includes("closed") || e.message.includes("disconnected")) {
        console.log(`\n  [${done + 1}/${toEnrich.length}] Browser/page died, relaunching...`);
        try { await browser.close(); } catch {}
        await new Promise((r) => setTimeout(r, 4000));
        browser = await launchBrowser();
        page = browser.pages()[0] || await browser.newPage();
        setupPageRouting(page);
        await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 2000));
        return extractListing(page, url).catch((e2: any) => ({ error: e2.message }));
      }
      return { error: e.message };
    });

    if ((data as any).error) {
      errors++;
      console.log(`  [${done + 1}/${toEnrich.length}] ERROR  ${listing.facebook_id}: ${(data as any).error}`);
    } else if ((data as any).dead) {
      await supabase.from("marketplace_listings").update({
        status: "removed", removed_at: new Date().toISOString(), scraped_at: new Date().toISOString(),
      }).eq("facebook_id", listing.facebook_id);
      console.log(`  [${done + 1}/${toEnrich.length}] ✗ removed  ${listing.facebook_id}`);
    } else {
      const d = data as any;
      await updateListing(listing.facebook_id, d);
      if (d.status === "sold") sold++;
      else active++;
      const statusIcon = d.status === "sold" ? "✗ sold" : d.status === "pending" ? "⏳ pending" : "✓ active";
      const label = (d.title || "").substring(0, 45);
      const sellerStr = d.sellerName ? ` · ${d.sellerName}` : "";
      const daysStr = d.listedDaysAgo !== null ? ` · ${d.listedDaysAgo}d ago` : "";
      const priceStr = d.price ? ` · $${d.price.toLocaleString()}` : "";
      console.log(`  [${done + 1}/${toEnrich.length}] ${statusIcon}  ${label}${priceStr}${sellerStr}${daysStr}`);
    }

    done++;

    // Shorter delay for dead listings, longer for live ones — use setTimeout not page.waitForTimeout
    // so this doesn't crash if the browser died
    const delay = (data as any).dead || (data as any).error ? 300 : 800 + Math.random() * 700;
    await new Promise((r) => setTimeout(r, delay));
  }

  console.log(`
────────────────────────────────
Total enriched: ${done}
  Active: ${active}
  Sold:   ${sold}
  Errors: ${errors}
`);

  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
