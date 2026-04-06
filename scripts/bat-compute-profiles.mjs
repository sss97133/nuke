#!/usr/bin/env node
/**
 * BaT User Profile Computation
 *
 * Aggregates auction_comments data into bat_user_profiles using sequential queries
 * to stay within statement_timeout limits.
 *
 * Usage: dotenvx run -- node scripts/bat-compute-profiles.mjs [--dry-run] [--limit N]
 */
import pg from 'pg';
const { Client } = pg;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
const BATCH_SIZE = 5; // Very small batches — wins computation is expensive for heavy bidders

async function main() {
  console.log(`BaT User Profile Computation${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const db = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 90000, // 90s per query
  });

  await db.connect();
  console.log('Connected to database');

  // Phase 1: Get usernames from bat_user_profiles that have comment data
  // Use bat_user_profiles as the roster (already seeded with 560K usernames)
  // and filter to those who actually appear in auction_comments with bid data
  console.log('Phase 1: Finding users with bid data in auction_comments...');
  const { rows: bidders } = await db.query(`
    SELECT bup.username as author_username, bup.total_bids as comment_count
    FROM bat_user_profiles bup
    WHERE bup.total_bids > 0
      AND bup.total_bids < 5000
    ORDER BY bup.total_bids DESC
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `);
  console.log(`Found ${bidders.length} users with bid activity`);

  if (bidders.length === 0) {
    console.log('No users to process. Run backfill first.');
    await db.end();
    return;
  }

  // Phase 2: Compute profiles in batches
  console.log('Phase 2: Computing profiles in batches...');
  let processed = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < bidders.length; i += BATCH_SIZE) {
    const batchUsernames = bidders.slice(i, i + BATCH_SIZE).map(b => b.author_username);

    let stats, wins, oad, cats;
    let winsMap = new Map(), oadMap = new Map(), catsMap = new Map();
    try {
    // Compute bid stats for this batch
    ({ rows: stats } = await db.query(`
      SELECT
        author_username,
        count(*) AS total_comments,
        count(*) FILTER (WHERE bid_amount IS NOT NULL AND bid_amount > 0) AS total_bids,
        count(*) FILTER (WHERE has_question = true) AS total_questions,
        count(*) FILTER (WHERE is_seller = true) AS total_seller_responses,
        avg(bid_amount) FILTER (WHERE bid_amount > 0) AS avg_bid_amount,
        max(bid_amount) FILTER (WHERE bid_amount > 0) AS max_bid_amount,
        min(bid_amount) FILTER (WHERE bid_amount > 0) AS min_bid_amount,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY bid_amount) FILTER (WHERE bid_amount > 0) AS p25_bid,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY bid_amount) FILTER (WHERE bid_amount > 0) AS p50_bid,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY bid_amount) FILTER (WHERE bid_amount > 0) AS p75_bid,
        max(bat_author_likes) AS max_author_likes,
        avg(author_total_likes) FILTER (WHERE author_total_likes > 0) AS avg_comment_likes,
        count(DISTINCT vehicle_id) AS unique_auctions,
        count(*) FILTER (WHERE bid_amount > 0 AND hours_until_close < 2) AS bids_last_2h,
        count(*) FILTER (WHERE bid_amount > 0 AND hours_until_close < 24) AS bids_last_24h,
        min(posted_at) AS first_seen,
        max(posted_at) AS last_seen,
        avg(word_count) AS avg_word_count
      FROM auction_comments
      WHERE platform = 'bat'
        AND author_username = ANY($1)
      GROUP BY author_username
    `, [batchUsernames]));

    // Compute wins for this batch
    ({ rows: wins } = await db.query(`
      SELECT ac.author_username, count(DISTINCT ac.vehicle_id) AS total_wins
      FROM auction_comments ac
      INNER JOIN (
        SELECT vehicle_id, max(bid_amount) AS max_bid
        FROM auction_comments
        WHERE platform = 'bat' AND bid_amount > 0 AND author_username = ANY($1)
        GROUP BY vehicle_id
      ) top ON ac.vehicle_id = top.vehicle_id AND ac.bid_amount = top.max_bid
      INNER JOIN bat_listings bl ON bl.vehicle_id = ac.vehicle_id AND bl.listing_status = 'sold'
      WHERE ac.platform = 'bat' AND ac.bid_amount > 0 AND ac.author_username = ANY($1)
      GROUP BY ac.author_username
    `, [batchUsernames]));
    winsMap = new Map(wins.map(w => [w.author_username, parseInt(w.total_wins)]));

    // Compute one-and-done ratio for this batch
    ({ rows: oad } = await db.query(`
      SELECT author_username,
        count(*) FILTER (WHERE bids_on_auction = 1)::float / NULLIF(count(*), 0) AS one_bid_ratio
      FROM (
        SELECT author_username, vehicle_id, count(*) as bids_on_auction
        FROM auction_comments
        WHERE platform = 'bat' AND bid_amount > 0 AND author_username = ANY($1)
        GROUP BY author_username, vehicle_id
      ) sub
      GROUP BY author_username
    `, [batchUsernames]));
    oadMap = new Map(oad.map(o => [o.author_username, o.one_bid_ratio]));

    // Compute preferred categories for this batch
    ({ rows: cats } = await db.query(`
      SELECT ac.author_username,
        array_agg(DISTINCT v.make ORDER BY v.make) FILTER (WHERE v.make IS NOT NULL) AS makes
      FROM auction_comments ac
      LEFT JOIN vehicles v ON ac.vehicle_id = v.id
      WHERE ac.platform = 'bat' AND ac.bid_amount > 0 AND ac.author_username = ANY($1)
      GROUP BY ac.author_username
    `, [batchUsernames]));
    catsMap = new Map(cats.map(c => [c.author_username, (c.makes || []).slice(0, 5)]));
    } catch (batchErr) {
      errors++;
      console.error(`  Batch query error at offset ${i} (users: ${batchUsernames.join(', ')}): ${batchErr.message}`);
      processed += batchUsernames.length;
      await new Promise(r => setTimeout(r, 1000)); // Cool down after error
      continue;
    }

    // Build profiles and upsert
    if (!DRY_RUN && stats.length > 0) {
      const values = [];
      const params = [];
      let pi = 1;

      for (const s of stats) {
        const totalWins = winsMap.get(s.author_username) || 0;
        const oneRatio = oadMap.get(s.author_username) || 0;
        const makes = catsMap.get(s.author_username) || [];

        const winRate = s.unique_auctions > 0 ? (totalWins / parseInt(s.unique_auctions)) : 0;

        // Strategy classification
        let strategy = 'observer';
        const totalBids = parseInt(s.total_bids);
        if (totalBids > 0) {
          const sniperPct = parseInt(s.bids_last_2h) / totalBids;
          const last24Pct = parseInt(s.bids_last_24h) / totalBids;
          if (oneRatio > 0.7) strategy = 'one_and_done';
          else if (sniperPct > 0.5) strategy = 'sniper';
          else if (sniperPct < 0.15 && last24Pct < 0.4) strategy = 'early_aggressive';
          else strategy = 'steady';
        }

        // Trust score: normalize against batch median (will refine later)
        const trustScore = s.max_author_likes
          ? Math.min(100, Math.round(parseFloat(s.max_author_likes) / 10))
          : null;

        const priceRange = s.p25_bid ? JSON.stringify({
          p25: Math.round(parseFloat(s.p25_bid)),
          p50: Math.round(parseFloat(s.p50_bid)),
          p75: Math.round(parseFloat(s.p75_bid)),
        }) : null;

        const metadata = JSON.stringify({
          first_seen: s.first_seen,
          last_seen: s.last_seen,
          unique_auctions: parseInt(s.unique_auctions),
          avg_word_count: Math.round(parseFloat(s.avg_word_count) || 0),
          bids_last_2h_pct: totalBids > 0 ? Math.round(parseInt(s.bids_last_2h) / totalBids * 100) : 0,
          computed_at: new Date().toISOString(),
        });

        values.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}::jsonb, $${pi++}, $${pi++}, $${pi++}::jsonb, $${pi++}::timestamptz, $${pi++}::timestamptz, NOW())`);
        params.push(
          s.author_username,
          parseInt(s.total_comments),
          totalBids,
          totalWins,
          parseInt(s.total_questions),
          parseInt(s.total_seller_responses) || 0,
          s.avg_bid_amount ? Math.round(parseFloat(s.avg_bid_amount)) : null,
          s.max_bid_amount ? Math.round(parseFloat(s.max_bid_amount)) : null,
          s.min_bid_amount ? Math.round(parseFloat(s.min_bid_amount)) : null,
          winRate,
          strategy,
          makes.length > 0 ? makes : null,
          priceRange,
          trustScore,
          s.avg_comment_likes ? Math.round(parseFloat(s.avg_comment_likes) * 100) / 100 : null,
          metadata,
          s.first_seen,
          s.last_seen,
        );
      }

      try {
        const sql = `
          INSERT INTO bat_user_profiles (
            username, total_comments, total_bids, total_wins,
            total_questions, total_answers,
            avg_bid_amount, max_bid_amount, min_bid_amount,
            win_rate, bidding_strategy, preferred_categories,
            typical_price_range, community_trust_score, avg_likes_received,
            metadata, first_seen, last_seen, updated_at
          ) VALUES ${values.join(', ')}
          ON CONFLICT (username) DO UPDATE SET
            total_comments = EXCLUDED.total_comments,
            total_bids = EXCLUDED.total_bids,
            total_wins = EXCLUDED.total_wins,
            total_questions = EXCLUDED.total_questions,
            total_answers = EXCLUDED.total_answers,
            avg_bid_amount = EXCLUDED.avg_bid_amount,
            max_bid_amount = EXCLUDED.max_bid_amount,
            min_bid_amount = EXCLUDED.min_bid_amount,
            win_rate = EXCLUDED.win_rate,
            bidding_strategy = EXCLUDED.bidding_strategy,
            preferred_categories = EXCLUDED.preferred_categories,
            typical_price_range = EXCLUDED.typical_price_range,
            community_trust_score = EXCLUDED.community_trust_score,
            avg_likes_received = EXCLUDED.avg_likes_received,
            metadata = EXCLUDED.metadata,
            first_seen = LEAST(bat_user_profiles.first_seen, EXCLUDED.first_seen),
            last_seen = GREATEST(bat_user_profiles.last_seen, EXCLUDED.last_seen),
            updated_at = EXCLUDED.updated_at
        `;
        await db.query(sql, params);
        updated += stats.length;
      } catch (e) {
        errors++;
        console.error(`Batch upsert error at offset ${i}: ${e.message}`);
      }
    }

    processed += batchUsernames.length;

    if (processed % 1000 === 0 || processed >= bidders.length) {
      console.log(`  Processed ${processed}/${bidders.length} users (${updated} updated, ${errors} errors)`);
    }

    // Breathe
    await new Promise(r => setTimeout(r, 50));
  }

  // Sample output
  if (!DRY_RUN) {
    const { rows: sample } = await db.query(`
      SELECT username, total_bids, total_wins, win_rate, bidding_strategy, avg_bid_amount, community_trust_score
      FROM bat_user_profiles
      WHERE total_bids > 0 AND win_rate IS NOT NULL AND bidding_strategy IS NOT NULL
      ORDER BY total_bids DESC
      LIMIT 10
    `);
    console.log('\nTop 10 bidders by activity:');
    for (const p of sample) {
      console.log(`  ${p.username}: ${p.total_bids} bids, ${p.total_wins} wins (${(p.win_rate * 100).toFixed(1)}%), strategy: ${p.bidding_strategy}, avg: $${p.avg_bid_amount || 0}, trust: ${p.community_trust_score}`);
    }
  } else {
    // Just show what we'd compute
    const firstBatch = bidders.slice(0, 5);
    console.log('\n[DRY RUN] Sample users:');
    for (const b of firstBatch) {
      console.log(`  ${b.author_username}: ${b.comment_count} comments`);
    }
  }

  console.log(`\nDone! Processed: ${processed}, Updated: ${updated}, Errors: ${errors}`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
