#!/usr/bin/env node
import pg from 'pg';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = new pg.Client({
  host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
  user: 'postgres.qkgaybvrernstplzjaam',
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  statement_timeout: 15000,
});
await client.connect();

// Get snapshots for vehicles missing fields
const {rows} = await client.query(`
  SELECT v.id, v.listing_url, lps.html_storage_path, v.sale_price, v.primary_image_url, v.description
  FROM listing_page_snapshots lps
  JOIN vehicles v ON v.listing_url = lps.listing_url
  WHERE v.deleted_at IS NULL AND lps.html_storage_path IS NOT NULL
    AND (v.sale_price IS NULL OR v.sale_price = 0)
  LIMIT 5
`);

for (const row of rows) {
  console.log('\n---');
  console.log('Vehicle:', row.id);
  console.log('URL:', row.listing_url);
  console.log('Storage:', row.html_storage_path);

  const url = `${SUPABASE_URL}/storage/v1/object/listing-snapshots/${row.html_storage_path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }});

  if (!res.ok) {
    console.log('Download failed:', res.status, res.statusText);
    continue;
  }

  const html = await res.text();
  console.log('HTML length:', html.length);

  // Try all extraction patterns
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  console.log('Title:', title?.substring(0, 100));

  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1]
    || html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
  console.log('OG Image:', ogImage?.substring(0, 80));

  const soldFor = html.match(/sold for \$([0-9,]+)/i)?.[1];
  console.log('Sold for:', soldFor);

  const hammerPrice = html.match(/(?:hammer|sold|sale)\s*(?:price)?\s*[:\s]*\$([0-9,]+)/i)?.[1];
  console.log('Hammer/Sold price:', hammerPrice);

  const jsonPrice = html.match(/"(?:finalPrice|hammerPrice|soldPrice|price)"\s*:\s*"?(\d+)"?/)?.[1];
  console.log('JSON price:', jsonPrice);

  const ogDesc = html.match(/property="og:description"[^>]*content="([^"]{1,100})"/i)?.[1];
  console.log('OG desc:', ogDesc?.substring(0, 80));

  const jsonDesc = html.match(/"description"\s*:\s*"([^"]{20,100})"/)?.[1];
  console.log('JSON desc:', jsonDesc?.substring(0, 80));
}

await client.end();
