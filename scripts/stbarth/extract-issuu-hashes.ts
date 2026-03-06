#!/usr/bin/env npx tsx
/**
 * extract-issuu-hashes.ts
 *
 * Playwright-based Issuu CDN hash extractor.
 * Reads pending publications from Supabase, visits each Issuu URL,
 * extracts the CDN hash + page count, and writes results back to DB.
 *
 * Run: cd /Users/skylar/nuke && dotenvx run -- npx tsx scripts/stbarth/extract-issuu-hashes.ts
 *
 * Options:
 *   --concurrency N   Number of concurrent browser contexts (default: 5)
 *   --limit N         Max publications to process (default: all)
 *   --dry-run         Extract but don't write to DB
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

// ---------------------------------------------------------------------------
// DNS fix for Supabase from local scripts
// ---------------------------------------------------------------------------
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
// @ts-ignore
dns.lookup = function (hostname: string, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  resolver.resolve4(hostname, (err: any, addresses: string[]) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
    if (options && options.all) callback(null, addresses.map((a: string) => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};

const nodeFetch = (await import('node-fetch')).default;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: nodeFetch as any } },
);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}
const CONCURRENCY = parseInt(getArg('concurrency', '5'), 10);
const LIMIT = getArg('limit', '0');  // 0 = no limit
const DRY_RUN = args.includes('--dry-run');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PendingPublication {
  id: string;
  platform_url: string;
  publisher_slug: string;
  title: string;
}

interface ExtractionResult {
  cdn_hash: string | null;
  page_count: number | null;
  cover_image_url: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hash extraction logic (6 methods)
// ---------------------------------------------------------------------------
const HASH_PATTERN = /image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})/;

async function extractHash(page: Page, url: string): Promise<ExtractionResult> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Give Issuu's JS time to render
    await page.waitForTimeout(3000);

    let cdn_hash: string | null = null;
    let cover_image_url: string | null = null;

    // Method 1: og:image meta tag
    if (!cdn_hash) {
      try {
        const ogImage = await page.getAttribute('meta[property="og:image"]', 'content');
        if (ogImage) {
          const m = ogImage.match(HASH_PATTERN);
          if (m) {
            cdn_hash = m[1];
            cover_image_url = ogImage;
          }
        }
      } catch {}
    }

    // Method 2: img[src*="image.isu.pub"] elements
    if (!cdn_hash) {
      try {
        const srcs = await page.$$eval('img[src*="image.isu.pub"]', (imgs) =>
          imgs.map((img) => img.getAttribute('src')).filter(Boolean),
        );
        for (const src of srcs) {
          const m = src!.match(/image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})/);
          if (m) {
            cdn_hash = m[1];
            if (!cover_image_url) cover_image_url = src!;
            break;
          }
        }
      } catch {}
    }

    // Method 3: img[srcset*="image.isu.pub"] elements
    if (!cdn_hash) {
      try {
        const srcsets = await page.$$eval('img[srcset*="image.isu.pub"]', (imgs) =>
          imgs.map((img) => img.getAttribute('srcset')).filter(Boolean),
        );
        for (const srcset of srcsets) {
          const m = srcset!.match(/image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})/);
          if (m) {
            cdn_hash = m[1];
            break;
          }
        }
      } catch {}
    }

    // Method 4: [style*="image.isu.pub"] background-image
    if (!cdn_hash) {
      try {
        const styles = await page.$$eval('[style*="image.isu.pub"]', (els) =>
          els.map((el) => el.getAttribute('style')).filter(Boolean),
        );
        for (const style of styles) {
          const m = style!.match(/image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})/);
          if (m) {
            cdn_hash = m[1];
            break;
          }
        }
      } catch {}
    }

    // Method 5: script tag content matching image.isu.pub
    if (!cdn_hash) {
      try {
        const scripts = await page.$$eval('script', (els) =>
          els.map((el) => el.textContent || '').filter((t) => t.includes('image.isu.pub')),
        );
        for (const script of scripts) {
          const m = script.match(/image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})/);
          if (m) {
            cdn_hash = m[1];
            break;
          }
        }
      } catch {}
    }

    // Method 6: Wait 3s extra then check full HTML
    if (!cdn_hash) {
      try {
        await page.waitForTimeout(3000);
        const html = await page.content();
        const m = html.match(/image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})/);
        if (m) {
          cdn_hash = m[1];
        }
      } catch {}
    }

    // Build cover image URL if we got a hash but no cover URL yet
    if (cdn_hash && !cover_image_url) {
      cover_image_url = `https://image.isu.pub/${cdn_hash}/jpg/page_1.jpg`;
    }

    // ---------------------------------------------------------------------------
    // Page count extraction
    // ---------------------------------------------------------------------------
    let page_count: number | null = null;

    // Look for "X pages" text
    try {
      const pageText = await page.textContent('body');
      if (pageText) {
        const m = pageText.match(/(\d+)\s+pages?\b/i);
        if (m) page_count = parseInt(m[1], 10);
      }
    } catch {}

    // [data-testid="page-count"]
    if (!page_count) {
      try {
        const el = await page.$('[data-testid="page-count"]');
        if (el) {
          const text = await el.textContent();
          if (text) {
            const m = text.match(/(\d+)/);
            if (m) page_count = parseInt(m[1], 10);
          }
        }
      } catch {}
    }

    // "of X" pattern (e.g. "1 of 124")
    if (!page_count) {
      try {
        const html = await page.content();
        const m = html.match(/\bof\s+(\d+)\b/i);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > 1 && n < 10000) page_count = n;
        }
      } catch {}
    }

    // Also try __NEXT_DATA__ JSON for page count
    if (!page_count) {
      try {
        const nextData = await page.$eval('#__NEXT_DATA__', (el) => el.textContent);
        if (nextData) {
          const parsed = JSON.parse(nextData);
          // Try common paths in Issuu's Next.js data
          const pageCount =
            parsed?.props?.pageProps?.documentData?.pageCount ??
            parsed?.props?.pageProps?.document?.pageCount ??
            parsed?.props?.initialProps?.pageProps?.documentData?.pageCount;
          if (typeof pageCount === 'number' && pageCount > 0) {
            page_count = pageCount;
          }
          // Also try to get hash from __NEXT_DATA__ if we still don't have it
          if (!cdn_hash) {
            const jsonStr = JSON.stringify(parsed);
            const m = jsonStr.match(/image\.isu\.pub\/([a-f0-9]+-[a-f0-9]{32})/);
            if (m) {
              cdn_hash = m[1];
              if (!cover_image_url) {
                cover_image_url = `https://image.isu.pub/${cdn_hash}/jpg/page_1.jpg`;
              }
            }
          }
        }
      } catch {}
    }

    return { cdn_hash, page_count, cover_image_url, error: null };
  } catch (err: any) {
    return { cdn_hash: null, page_count: null, cover_image_url: null, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Worker: processes publications from a shared queue
// ---------------------------------------------------------------------------
async function worker(
  workerId: number,
  browser: Browser,
  queue: PendingPublication[],
  stats: Stats,
): Promise<void> {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  while (true) {
    const pub = queue.shift();
    if (!pub) break;

    stats.attempted++;
    const startMs = Date.now();
    const result = await extractHash(page, pub.platform_url);
    const elapsedMs = Date.now() - startMs;

    if (result.cdn_hash) {
      stats.success++;
      stats.byPublisher[pub.publisher_slug] = (stats.byPublisher[pub.publisher_slug] || 0) + 1;

      console.log(
        `  [worker ${workerId}] OK  ${pub.publisher_slug}/${pub.title.slice(0, 50)} => ${result.cdn_hash} (${result.page_count ?? '?'} pages, ${elapsedMs}ms)`,
      );

      if (!DRY_RUN) {
        const { error } = await supabase
          .from('publications')
          .update({
            cdn_hash: result.cdn_hash,
            page_count: result.page_count,
            cover_image_url: result.cover_image_url,
            extraction_status: 'hash_extracted',
          })
          .eq('id', pub.id);

        if (error) {
          console.error(`  [worker ${workerId}] DB UPDATE FAILED for ${pub.id}: ${error.message}`);
          stats.dbErrors++;
        }
      }
    } else {
      stats.failed++;
      const reason = result.error || 'no hash found in page';
      console.log(
        `  [worker ${workerId}] FAIL ${pub.publisher_slug}/${pub.title.slice(0, 50)} => ${reason} (${elapsedMs}ms)`,
      );

      if (!DRY_RUN) {
        // Mark extraction_metadata with the error but don't change status to failed
        // so it can be retried
        const { error } = await supabase
          .from('publications')
          .update({
            extraction_metadata: {
              last_hash_error: reason,
              last_hash_attempt: new Date().toISOString(),
            },
          })
          .eq('id', pub.id);

        if (error) {
          console.error(`  [worker ${workerId}] DB error logging failure: ${error.message}`);
        }
      }
    }
  }

  await page.close();
  await context.close();
}

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------
interface Stats {
  total: number;
  attempted: number;
  success: number;
  failed: number;
  dbErrors: number;
  byPublisher: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Issuu CDN Hash Extractor ===');
  console.log(`Concurrency: ${CONCURRENCY} | Limit: ${LIMIT === '0' ? 'all' : LIMIT} | Dry run: ${DRY_RUN}`);
  console.log();

  // 1. Fetch pending publications from DB
  let query = supabase
    .from('publications')
    .select('id, platform_url, publisher_slug, title')
    .eq('extraction_status', 'pending_hash')
    .is('cdn_hash', null)
    .order('created_at', { ascending: true });

  if (LIMIT !== '0') {
    query = query.limit(parseInt(LIMIT, 10));
  }

  const { data: publications, error } = await query;

  if (error) {
    console.error('Failed to fetch publications:', error.message);
    process.exit(1);
  }

  if (!publications || publications.length === 0) {
    console.log('No publications with extraction_status=pending_hash and cdn_hash=NULL found.');
    process.exit(0);
  }

  console.log(`Found ${publications.length} publications to process`);

  // Show publisher breakdown
  const publisherCounts: Record<string, number> = {};
  for (const pub of publications) {
    publisherCounts[pub.publisher_slug] = (publisherCounts[pub.publisher_slug] || 0) + 1;
  }
  console.log('Publisher breakdown:');
  for (const [slug, count] of Object.entries(publisherCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug}: ${count}`);
  }
  console.log();

  // 2. Launch browser
  const browser = await chromium.launch({ headless: true });

  // 3. Shared mutable queue (workers shift from front)
  const queue: PendingPublication[] = [...publications];

  const stats: Stats = {
    total: publications.length,
    attempted: 0,
    success: 0,
    failed: 0,
    dbErrors: 0,
    byPublisher: {},
  };

  // 4. Spawn workers
  const startTime = Date.now();
  const workerCount = Math.min(CONCURRENCY, publications.length);
  console.log(`Spawning ${workerCount} workers...\n`);

  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker(i, browser, queue, stats));
  }

  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((stats.attempted / stats.total) * 100).toFixed(1);
    console.log(
      `\n  --- Progress: ${stats.attempted}/${stats.total} (${pct}%) | OK: ${stats.success} | FAIL: ${stats.failed} | ${elapsed}s elapsed ---\n`,
    );
  }, 15_000);

  await Promise.all(workers);
  clearInterval(progressInterval);

  // 5. Cleanup
  await browser.close();

  // 6. Final report
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Final Report ===');
  console.log(`Total:      ${stats.total}`);
  console.log(`Attempted:  ${stats.attempted}`);
  console.log(`Success:    ${stats.success} (${((stats.success / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Failed:     ${stats.failed}`);
  console.log(`DB errors:  ${stats.dbErrors}`);
  console.log(`Time:       ${totalTime}s`);
  console.log(`Avg/pub:    ${(parseFloat(totalTime) / stats.attempted).toFixed(1)}s`);
  console.log();
  console.log('Per-publisher success:');
  for (const [slug, count] of Object.entries(stats.byPublisher).sort((a, b) => b[1] - a[1])) {
    const total = publisherCounts[slug] || count;
    console.log(`  ${slug}: ${count}/${total}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
