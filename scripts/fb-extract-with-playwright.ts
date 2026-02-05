#!/usr/bin/env npx tsx
/**
 * Facebook Marketplace Detail Extractor using Playwright
 *
 * Extracts full listing details (description, images, seller) without Firecrawl.
 * Uses real browser automation - slower but free.
 *
 * Usage:
 *   npx tsx scripts/fb-extract-with-playwright.ts [--batch-size=20] [--only-missing]
 */

import { createClient } from "@supabase/supabase-js";
import { chromium, Browser, Page } from "playwright";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars. Run with: dotenvx run -- npx tsx scripts/fb-extract-with-playwright.ts");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CONFIG = {
  HEADLESS: true,
  TIMEOUT_MS: 30000,
  DELAY_BETWEEN_LISTINGS_MS: 5000,
  MAX_RETRIES: 2,
};

interface ExtractedDetails {
  description: string | null;
  images: string[];
  seller_name: string | null;
  seller_profile_url: string | null;
  location: string | null;
  mileage: number | null;
  condition: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const batchSize = parseInt(args.find(a => a.startsWith("--batch-size="))?.split("=")[1] || "20");
  const onlyMissing = args.includes("--only-missing");

  console.log("🎭 Facebook Marketplace Playwright Extractor");
  console.log("=============================================");
  console.log(`Batch size: ${batchSize}`);
  console.log(`Only missing details: ${onlyMissing}`);
  console.log();

  // Get listings needing detail extraction
  let query = supabase
    .from("marketplace_listings")
    .select("id, facebook_id, url, title")
    .eq("platform", "facebook_marketplace")
    .order("first_seen_at", { ascending: false })
    .limit(batchSize);

  if (onlyMissing) {
    query = query.or("description.is.null,all_images.is.null");
  }

  const { data: listings, error } = await query;
  if (error || !listings?.length) {
    console.log("No listings to process");
    process.exit(0);
  }

  console.log(`📋 Processing ${listings.length} listings\n`);

  // Launch browser
  console.log("🚀 Launching browser...");
  const browser = await chromium.launch({
    headless: CONFIG.HEADLESS,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  });

  const page = await context.newPage();

  let stats = { processed: 0, extracted: 0, errors: 0 };

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    const progress = `[${i + 1}/${listings.length}]`;

    try {
      process.stdout.write(`${progress} ${listing.facebook_id}... `);

      const details = await extractListingDetails(page, listing.url);

      if (details) {
        // Update listing with extracted details
        await supabase
          .from("marketplace_listings")
          .update({
            description: details.description,
            all_images: details.images,
            image_url: details.images[0] || null,
            seller_name: details.seller_name,
            seller_profile_url: details.seller_profile_url,
            location: details.location,
            mileage: details.mileage,
          })
          .eq("id", listing.id);

        console.log(`✓ ${details.images.length} images, ${details.description?.length || 0} chars`);
        stats.extracted++;
      } else {
        console.log("✗ No data extracted");
      }

      stats.processed++;

      // Rate limit
      if (i < listings.length - 1) {
        await sleep(CONFIG.DELAY_BETWEEN_LISTINGS_MS);
      }
    } catch (err: any) {
      console.log(`✗ Error: ${err.message}`);
      stats.errors++;
    }
  }

  await browser.close();

  console.log("\n=============================================");
  console.log("📊 Extraction Complete");
  console.log("=============================================");
  console.log(`Processed: ${stats.processed}`);
  console.log(`Extracted: ${stats.extracted}`);
  console.log(`Errors: ${stats.errors}`);
}

async function extractListingDetails(page: Page, url: string): Promise<ExtractedDetails | null> {
  try {
    // Navigate to listing
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });

    // Wait a moment for JS to load
    await sleep(2000);

    // Dismiss login modal if present
    await dismissLoginModal(page);

    // Wait for content
    await sleep(1000);

    // Extract data from page
    const details = await page.evaluate(() => {
      const result: any = {
        description: null,
        images: [],
        seller_name: null,
        seller_profile_url: null,
        location: null,
        mileage: null,
        condition: null,
      };

      // Description - look for common patterns
      const descSelectors = [
        '[data-testid="marketplace_listing_description"]',
        'div[dir="auto"] span',
        '.x1lliihq',
      ];
      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.length > 50) {
          result.description = el.textContent.trim().substring(0, 5000);
          break;
        }
      }

      // If no description found, try to get from page text
      if (!result.description) {
        const bodyText = document.body.innerText;
        const descMatch = bodyText.match(/Description[\s\S]{0,50}([\s\S]{50,2000}?)(?=Seller|Location|See more|Message|$)/i);
        if (descMatch) {
          result.description = descMatch[1].trim();
        }
      }

      // Images - FB CDN images
      const images = new Set<string>();
      document.querySelectorAll('img[src*="scontent"]').forEach((img: any) => {
        const src = img.src;
        // Filter out tiny images, profile pics
        if (src.includes('scontent') && !src.includes('_s.') && !src.includes('_t.')) {
          // Try to get larger version
          const largeSrc = src.replace(/\/p\d+x\d+\//, '/p960x960/');
          images.add(largeSrc);
        }
      });
      result.images = Array.from(images).slice(0, 30);

      // Seller name
      const sellerPatterns = [
        /Seller[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
        /Listed by[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
      ];
      for (const pattern of sellerPatterns) {
        const match = document.body.innerText.match(pattern);
        if (match) {
          result.seller_name = match[1];
          break;
        }
      }

      // Seller profile URL
      const profileLink = document.querySelector('a[href*="/marketplace/profile/"]') as HTMLAnchorElement;
      if (profileLink) {
        result.seller_profile_url = profileLink.href;
      }

      // Location
      const locationPatterns = [
        /Listed in ([A-Za-z\s]+, [A-Z]{2})/,
        /Location[:\s]+([A-Za-z\s]+, [A-Z]{2})/,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?, [A-Z]{2})\s*·/,
      ];
      for (const pattern of locationPatterns) {
        const match = document.body.innerText.match(pattern);
        if (match) {
          result.location = match[1];
          break;
        }
      }

      // Mileage
      const mileageMatch = document.body.innerText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles?|mi)\b/i);
      if (mileageMatch) {
        result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      }

      // Condition
      const conditionMatch = document.body.innerText.match(/Condition[:\s]+(New|Used|Good|Fair|Excellent|Like new)/i);
      if (conditionMatch) {
        result.condition = conditionMatch[1];
      }

      return result;
    });

    return details;
  } catch (err: any) {
    console.error(`Page error: ${err.message}`);
    return null;
  }
}

async function dismissLoginModal(page: Page): Promise<void> {
  try {
    // Try pressing Escape
    await page.keyboard.press("Escape");
    await sleep(500);

    // Try clicking close button
    const closeSelectors = [
      '[aria-label="Close"]',
      'div[role="button"][aria-label="Close"]',
      'button[aria-label="Close"]',
    ];

    for (const sel of closeSelectors) {
      try {
        const closeBtn = await page.$(sel);
        if (closeBtn) {
          await closeBtn.click();
          await sleep(500);
          break;
        }
      } catch {}
    }

    // Click outside modal
    await page.mouse.click(100, 100);
    await sleep(300);
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
