#!/usr/bin/env npx tsx
/**
 * Kissimmee 2026 Discovery
 * Discovers all lots and saves to vehicles table
 */
import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const existingUrls = new Set<string>();
let saved = 0;

async function loadExisting() {
  let offset = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&select=discovery_url&limit=1000&offset=${offset}`, {
      headers: { 'apikey': SUPABASE_KEY! }
    });
    const data = await res.json();
    if (!data.length) break;
    data.forEach((v: any) => v.discovery_url && existingUrls.add(v.discovery_url.split('?')[0].toLowerCase()));
    offset += 1000;
  }
  console.log(`Loaded ${existingUrls.size} existing URLs`);
}

async function saveLot(lot: { url: string; year: number; make: string; model: string }) {
  const url = lot.url.split('?')[0].toLowerCase();
  if (existingUrls.has(url)) return false;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      year: lot.year,
      make: lot.make,
      model: lot.model,
      discovery_url: url,
      discovery_source: 'mecum',
      listing_source: 'kissimmee-2026-discover',
      status: 'pending'
    })
  });

  if (res.ok) {
    existingUrls.add(url);
    saved++;
    return true;
  }
  return false;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Kissimmee 2026 Discovery');
  console.log('  ~4,900 lots expected');
  console.log('═══════════════════════════════════════════════\n');

  await loadExisting();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let emptyPages = 0;

  for (let pageNum = 1; pageNum <= 220; pageNum++) {
    const url = `https://www.mecum.com/auctions/kissimmee-2026/lots/?page=${pageNum}`;

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(2500);

      const lots = await page.evaluate(() => {
        const results: Array<{ url: string; year: number; make: string; model: string }> = [];
        const seen = new Set<string>();

        document.querySelectorAll('a[href*="/lots/"]').forEach(link => {
          const el = link as HTMLAnchorElement;
          const match = el.href.match(/\/lots\/(\d+)\/(\d{4})-([^\/\?]+)/);
          if (!match || seen.has(match[1])) return;
          seen.add(match[1]);

          const parts = match[3].split('-');
          results.push({
            url: el.href.split('?')[0],
            year: parseInt(match[2]),
            make: parts[0].charAt(0).toUpperCase() + parts[0].slice(1),
            model: parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
          });
        });
        return results;
      });

      if (!lots.length) {
        emptyPages++;
        if (emptyPages >= 3) {
          console.log(`\nPage ${pageNum}: 3 empty pages, stopping`);
          break;
        }
        continue;
      }

      emptyPages = 0;
      let pageSaved = 0;

      for (const lot of lots) {
        if (await saveLot(lot)) pageSaved++;
      }

      if (pageSaved > 0) {
        console.log(`Page ${pageNum}: +${pageSaved} new (${saved} total)`);
      } else if (pageNum % 10 === 0) {
        console.log(`Page ${pageNum}: all existing (${saved} total)`);
      }

    } catch (e: any) {
      console.log(`Page ${pageNum}: error - ${e.message.slice(0, 50)}`);
    }
  }

  await browser.close();
  console.log(`\n✅ Done! Saved ${saved} new vehicles`);
}

main().catch(console.error);
