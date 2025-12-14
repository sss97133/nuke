/**
 * Minimal Beverly Hills Car Club sampler (no dependencies).
 *
 * Purpose:
 * - Validate that we can enumerate listing URLs from inventory pages
 * - Validate we can extract hi-res `galleria_images/*_l.jpg` URLs from detail pages
 *
 * Usage:
 *   node scripts/bhcc_sample_scrape.mjs
 */
const BASE = 'https://www.beverlyhillscarclub.com';

function uniq(arr) {
  return Array.from(new Set(arr));
}

function promoteImage(url) {
  return url.replace(/_(s|m)\.(jpg|jpeg|png)$/i, '_l.$2');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

function extractListingUrlsFromInventoryHtml(html) {
  // BHCC detail pages commonly look like:
  // /1967-porsche-911s-c-1660.htm
  // https://www.beverlyhillscarclub.com/1967-porsche-911s-c-1660.htm
  const re = /href="([^"]+-c-\d+\.htm)"/gi;
  const urls = [];
  for (const m of html.matchAll(re)) {
    const raw = m[1];
    const abs = raw.startsWith('http') ? raw : `${BASE}${raw.startsWith('/') ? '' : '/'}${raw}`;
    urls.push(abs);
  }
  return uniq(urls);
}

function extractTitle(html) {
  const m =
    html.match(/<h1[^>]*class="[^"]*\blisting-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = m?.[1] || '';
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function extractGalleriaImages(html) {
  const re = /(https:\/\/www\.beverlyhillscarclub\.com\/galleria_images\/[^"'\\\s]+?\.(?:jpg|jpeg|png))/gi;
  const urls = [];
  for (const m of html.matchAll(re)) urls.push(promoteImage(m[1]));
  return uniq(urls);
}

async function main() {
  // Inventory listings are loaded via AJAX from isapi_xml.php (inventory.js).
  // Response format:
  //   line1: total count
  //   line2: JSON (filters)
  //   line3: JSON (aggregates)
  //   rest: HTML snippet containing listing cards/links
  const inventoryUrl = `${BASE}/isapi_xml.php?module=inventory&limit=50&offset=0`;
  const invText = await fetchText(inventoryUrl);
  const lines = invText.split('\n');
  const total = parseInt((lines[0] || '').trim(), 10) || null;
  const html = lines.slice(3).join('\n');
  const listingUrls = extractListingUrlsFromInventoryHtml(html);

  const sample = listingUrls.slice(0, 3);
  console.log(
    JSON.stringify(
      {
        inventory_url: inventoryUrl,
        total_listings_reported: total,
        listings_found_in_html: listingUrls.length,
        sample_listing_urls: sample,
      },
      null,
      2
    )
  );

  const results = [];
  for (const url of sample) {
    const html = await fetchText(url);
    results.push({
      url,
      title: extractTitle(html),
      galleria_images: extractGalleriaImages(html),
    });
  }

  console.log(JSON.stringify({ sample_results: results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


