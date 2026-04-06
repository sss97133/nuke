#!/usr/bin/env node
/**
 * BaT Bid Intelligence Backfill
 *
 * Processes 241K archived BaT snapshots from listing_page_snapshots to:
 * 1. Extract bid intelligence fields (bat_author_id, bat_comment_id, bat_author_likes, likers_count)
 * 2. Backfill seller attribution on bat_listings
 * 3. Update auction_comments with rich bid data from BAT_VMS.comments JSON
 *
 * Runs locally with dotenvx. Does NOT hit BaT — works entirely from archived HTML.
 *
 * Usage: dotenvx run -- node scripts/bat-bid-backfill.mjs [--dry-run] [--limit N] [--offset N]
 */
import pg from 'pg';
import crypto from 'crypto';
const { Client } = pg;

const BATCH_SIZE = 50;
const SLEEP_MS = 100;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
const OFFSET = args.includes('--offset') ? parseInt(args[args.indexOf('--offset') + 1]) : 0;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function downloadHtml(storagePath) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/listing-snapshots/${storagePath}`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function extractCommentsJson(html) {
  // Pattern 1: "comments":[{...},...] in inline JS
  const m1 = html.match(/"comments":\s*\[([\s\S]*?)\](?=,"[a-z])/);
  if (m1?.[1]) {
    try {
      const arr = JSON.parse('[' + m1[1] + ']');
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch { /* fall through */ }
  }

  // Pattern 2: __NEXT_DATA__
  const m2 = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (m2?.[1]) {
    try {
      const nd = JSON.parse(m2[1]);
      const pd = nd?.props?.pageProps?.pageData || nd?.props?.pageProps || {};
      const comments = pd.comments || pd.listing?.comments || [];
      if (Array.isArray(comments) && comments.length > 0) return comments;
    } catch { /* fall through */ }
  }

  // Pattern 3: individual objects
  const found = [];
  const re = /\{"channels":\[.*?"type":"(bat-bid|comment)".*?\}/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj?.type === 'bat-bid' || obj?.type === 'comment') found.push(obj);
    } catch { /* skip */ }
  }
  return found.length > 0 ? found : null;
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.toString();
  } catch {
    return String(raw).split('#')[0].split('?')[0];
  }
}

function extractAuctionEndDate(html) {
  const m = html.match(/Auction ended?[:\s]+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
  return m ? new Date(m[1]) : null;
}

async function main() {
  console.log(`BaT Bid Intelligence Backfill${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Batch size: ${BATCH_SIZE}, Sleep: ${SLEEP_MS}ms`);
  if (LIMIT) console.log(`Limit: ${LIMIT} snapshots`);
  if (OFFSET) console.log(`Offset: ${OFFSET}`);

  const db = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: 6543,
    user: `postgres.qkgaybvrernstplzjaam`,
    password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });

  await db.connect();
  console.log('Connected to database');

  // Fast estimate of available snapshots (exact count is too slow on 241K rows)
  const { rows: [{ estimate }] } = await db.query(
    `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'listing_page_snapshots'`
  );
  const totalCount = estimate || 241000;
  console.log(`Estimated BaT snapshots: ~${totalCount}`);

  let processed = 0;
  let commentsFound = 0;
  let bidsFound = 0;
  let sellersFound = 0;
  let upserted = 0;
  let errors = 0;
  let offset = OFFSET;

  while (true) {
    if (LIMIT && processed >= LIMIT) break;

    const batchLimit = LIMIT ? Math.min(BATCH_SIZE, LIMIT - processed) : BATCH_SIZE;

    // Fetch batch of snapshots — prefer those with inline HTML (faster), then storage
    const { rows: snapshots } = await db.query(
      `SELECT id, listing_url, html, html_storage_path, fetched_at
       FROM listing_page_snapshots
       WHERE platform = 'bat' AND success = true
       AND (html IS NOT NULL OR html_storage_path IS NOT NULL)
       ORDER BY fetched_at DESC
       LIMIT $1 OFFSET $2`,
      [batchLimit, offset]
    );

    if (snapshots.length === 0) break;

    for (const snap of snapshots) {
      processed++;

      // Get HTML content
      let html = snap.html;
      if (!html && snap.html_storage_path) {
        html = await downloadHtml(snap.html_storage_path);
      }
      if (!html || html.length < 1000) {
        continue;
      }

      const comments = extractCommentsJson(html);
      if (!comments || comments.length === 0) continue;

      const listingUrl = normalizeUrl(snap.listing_url);
      const auctionEndDate = extractAuctionEndDate(html) || new Date(snap.fetched_at);

      commentsFound += comments.length;

      // Build upsert rows for auction_comments with bid intelligence fields
      const rows = [];
      let sellerUsername = null;
      let sellerAuthorId = null;

      for (let i = 0; i < comments.length; i++) {
        const c = comments[i];

        const authorRaw = String(c?.authorName || c?.author || '').trim();
        const author = authorRaw.replace(/\s*\(The\s+Seller\)/i, '').trim() || 'Unknown';
        const isSeller = authorRaw.toLowerCase().includes('(the seller)');

        // Capture seller attribution
        if (isSeller && author !== 'Unknown') {
          sellerUsername = author;
          if (typeof c?.authorId === 'number') sellerAuthorId = c.authorId;
        }

        const rawText = String(c?.content || c?.comment || c?.text || '')
          .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!rawText || rawText.length < 3) continue;

        const timestamp = c?.timestamp
          ? (typeof c.timestamp === 'number' ? new Date(c.timestamp * 1000) : new Date(c.timestamp))
          : null;
        const posted_at = timestamp || auctionEndDate;

        const isBid = c?.type === 'bat-bid' || /bid\s+placed\s+by/i.test(rawText);
        const bidAmount = (isBid && c?.bidAmount)
          ? (typeof c.bidAmount === 'number' ? c.bidAmount : parseFloat(String(c.bidAmount).replace(/,/g, '')))
          : null;

        if (bidAmount && bidAmount > 0) bidsFound++;

        const comment_type =
          bidAmount ? 'bid' :
          isSeller ? 'seller_response' :
          rawText.includes('?') ? 'question' :
          'observation';

        const hours_until_close = timestamp
          ? (auctionEndDate.getTime() - posted_at.getTime()) / (1000 * 60 * 60)
          : 0;

        const content_hash = sha256([
          'bat', String(listingUrl), String(i + 1),
          String(posted_at.toISOString()), String(author), String(rawText)
        ].join('|'));

        rows.push({
          vehicle_id: null, // Will be resolved via source_url join
          platform: 'bat',
          source_url: listingUrl,
          content_hash,
          sequence_number: i + 1,
          posted_at: posted_at.toISOString(),
          hours_until_close: Math.max(0, hours_until_close),
          author_username: author,
          is_seller: isSeller,
          author_total_likes: typeof c?.likes === 'number' ? c.likes : 0,
          comment_type,
          comment_text: rawText,
          word_count: rawText.split(/\s+/).length,
          has_question: rawText.includes('?'),
          has_media: Boolean(c?.hasImage || c?.hasVideo || (c?.images?.length > 0) || (c?.videos?.length > 0)),
          bid_amount: bidAmount,
          comment_likes: 0,
          // Bid intelligence fields
          bat_author_id: typeof c?.authorId === 'number' ? c.authorId : null,
          bat_comment_id: typeof c?.id === 'number' ? c.id : null,
          bat_author_likes: typeof c?.authorLikes === 'number' ? c.authorLikes : null,
          likers_count: Array.isArray(c?.likers) ? c.likers.length : null,
        });
      }

      if (rows.length === 0) continue;

      // Resolve vehicle_id — must exist in vehicles table (FK constraint)
      const urlVariants = [listingUrl, listingUrl.replace(/\/$/, ''), listingUrl + '/'].filter(Boolean);

      let vehicleId = null;

      // Try vehicles table directly (guaranteed valid FK)
      const { rows: vRows } = await db.query(
        `SELECT id FROM vehicles WHERE bat_auction_url = ANY($1) OR discovery_url = ANY($1) LIMIT 1`,
        [urlVariants]
      );
      if (vRows.length > 0) vehicleId = vRows[0].id;

      // Fallback: vehicle_events (validate FK)
      if (!vehicleId) {
        const { rows: veRows } = await db.query(
          `SELECT ve.vehicle_id FROM vehicle_events ve
           INNER JOIN vehicles v ON v.id = ve.vehicle_id
           WHERE ve.source_url = ANY($1) AND ve.vehicle_id IS NOT NULL LIMIT 1`,
          [urlVariants]
        );
        if (veRows.length > 0) vehicleId = veRows[0].vehicle_id;
      }

      // Fallback: bat_listings (validate FK — many have stale vehicle_ids)
      if (!vehicleId) {
        const { rows: blRows } = await db.query(
          `SELECT bl.vehicle_id FROM bat_listings bl
           INNER JOIN vehicles v ON v.id = bl.vehicle_id
           WHERE bl.bat_listing_url = ANY($1) AND bl.vehicle_id IS NOT NULL LIMIT 1`,
          [urlVariants]
        );
        if (blRows.length > 0) vehicleId = blRows[0].vehicle_id;
      }

      if (!vehicleId) {
        // Can't link — skip this snapshot
        continue;
      }

      // Set vehicle_id on all rows
      for (const r of rows) r.vehicle_id = vehicleId;

      if (!DRY_RUN) {
        // Batch upsert to auction_comments
        // Use a single INSERT ... ON CONFLICT for the whole batch
        try {
          const values = [];
          const params = [];
          let pi = 1;

          for (const r of rows) {
            values.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}::timestamptz, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
            params.push(
              r.vehicle_id, r.platform, r.source_url, r.content_hash,
              r.sequence_number, r.posted_at, r.hours_until_close,
              r.author_username, r.is_seller, r.author_total_likes,
              r.comment_type, r.comment_text, r.word_count,
              r.has_question, r.has_media, r.bid_amount,
              r.comment_likes, r.bat_author_id, r.bat_comment_id,
              r.bat_author_likes, r.likers_count
            );
          }

          const sql = `
            INSERT INTO auction_comments (
              vehicle_id, platform, source_url, content_hash,
              sequence_number, posted_at, hours_until_close,
              author_username, is_seller, author_total_likes,
              comment_type, comment_text, word_count,
              has_question, has_media, bid_amount,
              comment_likes, bat_author_id, bat_comment_id,
              bat_author_likes, likers_count
            ) VALUES ${values.join(', ')}
            ON CONFLICT (vehicle_id, content_hash) DO UPDATE SET
              bat_author_id = COALESCE(EXCLUDED.bat_author_id, auction_comments.bat_author_id),
              bat_comment_id = COALESCE(EXCLUDED.bat_comment_id, auction_comments.bat_comment_id),
              bat_author_likes = COALESCE(EXCLUDED.bat_author_likes, auction_comments.bat_author_likes),
              likers_count = COALESCE(EXCLUDED.likers_count, auction_comments.likers_count),
              author_total_likes = COALESCE(EXCLUDED.author_total_likes, auction_comments.author_total_likes)
          `;

          await db.query(sql, params);
          upserted += rows.length;
        } catch (e) {
          errors++;
          if (errors <= 5) console.error(`Upsert error for ${listingUrl}: ${e.message}`);
        }

        // Seller attribution on bat_listings
        if (sellerUsername) {
          sellersFound++;
          try {
            await db.query(
              `UPDATE bat_listings SET
                seller_username = COALESCE(seller_username, $1),
                last_updated_at = NOW()
               WHERE bat_listing_url = ANY($2) AND seller_username IS NULL`,
              [sellerUsername, urlVariants]
            );
          } catch { /* non-fatal */ }
        }
      }

      // Progress logging
      if (processed % 500 === 0) {
        console.log(
          `[${processed}/${totalCount}] comments: ${commentsFound}, bids: ${bidsFound}, ` +
          `sellers: ${sellersFound}, upserted: ${upserted}, errors: ${errors}`
        );
      }
    }

    offset += snapshots.length;

    // Sleep between batches
    await new Promise(r => setTimeout(r, SLEEP_MS));
  }

  console.log(`\nDone!`);
  console.log(`Processed: ${processed} snapshots`);
  console.log(`Comments found: ${commentsFound}`);
  console.log(`Bids found: ${bidsFound}`);
  console.log(`Sellers found: ${sellersFound}`);
  console.log(`Upserted: ${upserted}`);
  console.log(`Errors: ${errors}`);

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
