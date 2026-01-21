import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface RepairOptions {
  batch_size?: number;
  dry_run?: boolean;
  min_vehicle_age_hours?: number;
}

async function runBatRepair(options: RepairOptions = {}) {
  const { batch_size = 25, dry_run = false, min_vehicle_age_hours = 0 } = options;

  console.log('=== BAT PROFILE REPAIR RUNNER ===');
  console.log(`Batch size: ${batch_size}`);
  console.log(`Dry run: ${dry_run}`);
  console.log(`Min vehicle age (hours): ${min_vehicle_age_hours}`);
  console.log('');

  // Find incomplete BaT vehicles
  const cutoffIso = new Date(Date.now() - min_vehicle_age_hours * 60 * 60 * 1000).toISOString();

  const { data: vehicles, error: vErr } = await supabase
    .from('vehicles')
    .select('id, created_at, updated_at, listing_url, discovery_url, bat_auction_url, listing_title, description, listing_location, color, interior_color, body_style, sale_price, origin_metadata')
    .or(
      'profile_origin.eq.bat_import,discovery_source.eq.bat_import,listing_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%'
    )
    .lte('updated_at', cutoffIso)
    .order('updated_at', { ascending: true })
    .limit(300);

  if (vErr) {
    console.error('Error fetching vehicles:', vErr);
    return;
  }

  console.log(`Scanned ${vehicles?.length || 0} BaT vehicles`);

  const candidates: any[] = [];

  for (const v of vehicles || []) {
    const url = v.bat_auction_url || v.listing_url || v.discovery_url;
    if (!url || !String(url).toLowerCase().includes('bringatrailer.com/listing/')) {
      continue;
    }

    // Check repair cooldown
    const om = (v.origin_metadata && typeof v.origin_metadata === 'object') ? v.origin_metadata : {};
    const lastAttempt = (om as any)?.bat_repair?.last_attempt_at
      ? Date.parse(String((om as any).bat_repair.last_attempt_at))
      : NaN;
    if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 6 * 60 * 60 * 1000) {
      continue;
    }

    const descLen = String(v.description || '').trim().length;
    const hasLocation = String(v.listing_location || '').trim().length > 0;
    const hasColor = String(v.color || '').trim().length > 0;
    const hasInteriorColor = String(v.interior_color || '').trim().length > 0;
    const hasBodyStyle = String(v.body_style || '').trim().length > 0;

    // Check image and comment counts
    const [{ count: imageCount }, { count: commentCount }] = await Promise.all([
      supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', v.id),
      supabase.from('auction_comments').select('id', { count: 'exact', head: true }).eq('vehicle_id', v.id),
    ]);

    const reasons: string[] = [];
    if ((imageCount || 0) === 0) reasons.push('no_images');
    if (descLen < 80) reasons.push('short_desc');
    if (!hasLocation) reasons.push('no_location');
    if ((commentCount || 0) === 0) reasons.push('no_comments');
    if (!hasColor) reasons.push('no_color');
    if (!hasInteriorColor) reasons.push('no_interior');
    if (!hasBodyStyle) reasons.push('no_body_style');

    if (reasons.length > 0) {
      candidates.push({
        id: v.id,
        title: v.listing_title?.substring(0, 50) || 'Unknown',
        url,
        reasons,
        images: imageCount || 0,
        comments: commentCount || 0,
      });
    }

    if (candidates.length >= batch_size) break;
  }

  console.log(`\nFound ${candidates.length} vehicles needing repair:\n`);

  for (const c of candidates.slice(0, 10)) {
    console.log(`  ${c.title}...`);
    console.log(`    Reasons: ${c.reasons.join(', ')}`);
    console.log(`    Images: ${c.images}, Comments: ${c.comments}`);
  }

  if (candidates.length > 10) {
    console.log(`  ... and ${candidates.length - 10} more`);
  }

  if (dry_run) {
    console.log('\n[DRY RUN] Would invoke extract-bat-core + extract-auction-comments for each');
    return { candidates, invoked: 0 };
  }

  console.log('\n=== RUNNING REPAIRS ===\n');

  let repaired = 0;
  let failed = 0;

  // Helper: delay with jitter to avoid rate limiting
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms + Math.random() * 1000));

  // Helper: retry with exponential backoff
  async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 2000
  ): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isRateLimit = /429|rate|limit|too many/i.test(err?.message || '');
        const isTimeout = /timeout|ETIMEDOUT|ECONNRESET/i.test(err?.message || '');

        if (attempt < maxRetries - 1 && (isRateLimit || isTimeout)) {
          const backoff = baseDelayMs * Math.pow(2, attempt);
          console.log(`    ↻ Retry ${attempt + 1}/${maxRetries} after ${backoff}ms (${isRateLimit ? 'rate limit' : 'timeout'})`);
          await delay(backoff);
        }
      }
    }
    throw lastError;
  }

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] Repairing: ${c.title}...`);

    try {
      // Step 1: Extract core vehicle data (with retry)
      const { data: step1Data, error: step1Err } = await withRetry(() =>
        supabase.functions.invoke('extract-bat-core', {
          body: { url: c.url, max_vehicles: 1 },
        })
      );

      if (step1Err) throw new Error(`extract-bat-core: ${step1Err.message}`);

      const vehicleId = step1Data?.created_vehicle_ids?.[0] ||
                       step1Data?.updated_vehicle_ids?.[0] ||
                       c.id;

      console.log(`  ✓ Core extraction done (vehicle: ${vehicleId})`);

      // Delay between steps to be respectful to BaT
      await delay(1500);

      // Step 2: Extract comments (with retry, non-critical)
      try {
        await withRetry(() =>
          supabase.functions.invoke('extract-auction-comments', {
            body: { auction_url: c.url, vehicle_id: vehicleId },
          }),
          2, // fewer retries for comments
          1500
        );
        console.log(`  ✓ Comments extraction done`);
      } catch (commentErr: any) {
        console.log(`  ⚠ Comments extraction failed (non-critical): ${commentErr?.message}`);
      }

      repaired++;

      // Update origin_metadata with repair result
      await supabase.from('vehicles').update({
        origin_metadata: {
          bat_repair: {
            last_attempt_at: new Date().toISOString(),
            last_ok: true,
          },
        },
        updated_at: new Date().toISOString(),
      }).eq('id', c.id);

    } catch (err: any) {
      console.log(`  ✗ Failed: ${err?.message}`);
      failed++;

      // Record failure in origin_metadata
      await supabase.from('vehicles').update({
        origin_metadata: {
          bat_repair: {
            last_attempt_at: new Date().toISOString(),
            last_ok: false,
            last_error: String(err?.message || 'Unknown error').slice(0, 200),
          },
        },
      }).eq('id', c.id).catch(() => {});
    }

    // Delay between vehicles to avoid rate limiting (3-5 seconds)
    if (i < candidates.length - 1) {
      await delay(3000);
    }
  }

  console.log(`\n=== REPAIR COMPLETE ===`);
  console.log(`Repaired: ${repaired}`);
  console.log(`Failed: ${failed}`);

  return { candidates, repaired, failed };
}

// Parse command line args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('-d');
const batchSize = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || '25', 10);

runBatRepair({
  batch_size: batchSize,
  dry_run: isDryRun,
  min_vehicle_age_hours: 0,
}).catch(console.error);
