#!/usr/bin/env node
/**
 * Phase 2: Supplier Inventory Cataloging
 *
 * Three inventory sources per supplier:
 * A. Website inventory — queue discover-organization-full for enriched orgs
 * B. FB Marketplace listings — cross-link saved items to import_queue
 * C. FB Reels/videos — parse titles for vehicle references
 *
 * Usage:
 *   dotenvx run -- node scripts/catalog-supplier-inventory.mjs [--phase A|B|C|all] [--dry-run] [--limit N]
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseIdx = args.indexOf('--phase');
const PHASE = phaseIdx >= 0 ? args[phaseIdx + 1].toUpperCase() : 'ALL';
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;

const BASE = SUPABASE_URL.replace(/\/$/, '');
const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
};

// ── Helpers ──

async function pgQuery(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pgInsert(table, rows) {
  const res = await fetch(`${BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    // Ignore duplicate key errors
    if (text.includes('duplicate key') || text.includes('23505')) return [];
    throw new Error(`Insert ${table} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function pgPatch(table, filter, updates) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(updates),
  });
  return res.ok;
}

async function callEdge(name, body) {
  const res = await fetch(`${BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Vehicle reference parsing from reel titles ──

const YEAR_PATTERN = /\b(19[2-9]\d|20[0-2]\d)\b/;
const MAKES = [
  'chevrolet', 'chevy', 'ford', 'dodge', 'gmc', 'toyota', 'jeep', 'pontiac',
  'buick', 'cadillac', 'oldsmobile', 'plymouth', 'chrysler', 'mercury',
  'lincoln', 'amc', 'international', 'scout', 'bronco', 'mustang',
  'porsche', 'bmw', 'mercedes', 'volkswagen', 'vw', 'land rover', 'defender',
  'ferrari', 'lamborghini', 'aston martin', 'jaguar', 'triumph', 'mg',
  'datsun', 'nissan', 'mazda', 'subaru', 'honda', 'volvo', 'saab',
  'alfa romeo', 'fiat', 'lancia', 'lotus', 'tvr', 'mini', 'rover',
];

const MODEL_PATTERNS = [
  /\b(k5|k10|k20|k30|c10|c20|c30|c\/k|ck)\b/i,
  /\b(blazer|suburban|silverado|scottsdale|custom deluxe|cheyenne)\b/i,
  /\b(f-?1[05]0|f-?250|f-?350|ranger|bronco|raptor)\b/i,
  /\b(ram|charger|challenger|cuda|barracuda|power wagon|dart)\b/i,
  /\b(camaro|corvette|nova|chevelle|impala|el camino|monte carlo)\b/i,
  /\b(mustang|galaxie|fairlane|torino|maverick|pinto|thunder\s?bird)\b/i,
  /\b(gto|firebird|trans am|grand prix|lemans|tempest)\b/i,
  /\b(911|912|914|930|944|928|356|boxster|cayman|cayenne)\b/i,
  /\b(wrangler|cj-?\d|yj|tj|jk|jl|cherokee|grand cherokee|scrambler)\b/i,
  /\b(squarebody|square body|obs|square-body)\b/i,
  /\b(land cruiser|fj40|fj60|fj80|4runner|hilux|tacoma|tundra)\b/i,
  /\b(defender|range rover|discovery|series\s?[iI]{1,3})\b/i,
];

function parseVehicleReference(title) {
  if (!title) return null;
  const lower = title.toLowerCase();

  // Find year
  const yearMatch = title.match(YEAR_PATTERN);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  // Find make
  let make = null;
  for (const m of MAKES) {
    if (lower.includes(m)) {
      make = m;
      // Normalize common abbreviations
      if (make === 'chevy') make = 'chevrolet';
      if (make === 'vw') make = 'volkswagen';
      break;
    }
  }

  // Find model
  let model = null;
  for (const pattern of MODEL_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      model = match[1];
      break;
    }
  }

  // Must have at least year+make or make+model
  if ((year && make) || (make && model)) {
    return { year, make, model };
  }
  return null;
}

// ── Phase A: Website Inventory ──

async function phaseA() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Phase 2A: Website Inventory Discovery   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Get enriched orgs with websites
  const orgs = await pgQuery(
    `${BASE}/rest/v1/businesses?discovered_via=eq.facebook_saved_reels&website=not.is.null&select=id,business_name,website&order=business_name&limit=${LIMIT}`
  );

  console.log(`Found ${orgs.length} enriched orgs with websites\n`);
  let queued = 0;

  for (const org of orgs) {
    console.log(`  ${org.business_name}: ${org.website}`);

    // Check if already in sync queue
    const existing = await pgQuery(
      `${BASE}/rest/v1/organization_inventory_sync_queue?organization_id=eq.${org.id}&select=id,status&limit=1`
    );

    if (existing.length > 0) {
      console.log(`    → Already in sync queue (${existing[0].status})`);
      continue;
    }

    if (!DRY_RUN) {
      // Queue for inventory sync
      await pgInsert('organization_inventory_sync_queue', [{
        organization_id: org.id,
        run_mode: 'both',
        status: 'pending',
        next_run_at: new Date().toISOString(),
      }]);

      // Also trigger discover-organization-full
      console.log('    → Triggering discover-organization-full...');
      const result = await callEdge('discover-organization-full', {
        organization_id: org.id,
        website: org.website,
        force_rediscover: false,
      });

      if (result.ok) {
        const d = result.data?.result || result.data;
        console.log(`    ✓ Found ${d?.vehicles_found ?? '?'} vehicles, ${d?.vehicles_created ?? '?'} created`);
      } else {
        console.log(`    ✗ Discovery failed: ${result.status}`);
      }

      queued++;
      await sleep(2000); // Rate limit
    } else {
      console.log('    → Would queue for sync');
      queued++;
    }
  }

  console.log(`\n  Queued: ${queued} / ${orgs.length}`);
  return queued;
}

// ── Phase B: FB Marketplace Cross-Link ──

async function phaseB() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Phase 2B: Marketplace Cross-Link        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Get all raw marketplace items
  const items = await pgQuery(
    `${BASE}/rest/v1/fb_saved_items?item_type=eq.ProductItem&processing_status=eq.raw&select=id,fb_item_id,title,permalink,seller_name,seller_fb_id,seller_profile_url,matched_organization_id&limit=${LIMIT}`
  );

  console.log(`Found ${items.length} raw marketplace items\n`);

  // Get all FB orgs with their FB profile URLs
  const orgs = await pgQuery(
    `${BASE}/rest/v1/businesses?discovered_via=eq.facebook_saved_reels&select=id,business_name`
  );
  const orgById = new Map(orgs.map(o => [o.id, o]));

  // Get FB profile URLs from saved items
  const orgFBLinks = await pgQuery(
    `${BASE}/rest/v1/fb_saved_items?matched_organization_id=not.is.null&select=matched_organization_id,creator_fb_id,creator_profile_url`
  );
  const orgFBMap = new Map(); // fb_id → org_id
  for (const link of orgFBLinks) {
    if (link.creator_fb_id) {
      orgFBMap.set(link.creator_fb_id, link.matched_organization_id);
    }
  }

  let matched = 0, queued = 0, skipped = 0;

  for (const item of items) {
    // Try to match seller to known org
    let orgId = item.matched_organization_id;

    if (!orgId && item.seller_fb_id) {
      orgId = orgFBMap.get(item.seller_fb_id);
    }

    if (orgId) {
      const org = orgById.get(orgId);
      console.log(`  ✓ "${item.title}" → ${org?.business_name || orgId}`);
      matched++;

      if (!DRY_RUN) {
        // Mark as supplier listing
        await pgPatch('fb_saved_items', `id=eq.${item.id}`, {
          is_supplier_listing: true,
          matched_organization_id: orgId,
          processing_status: 'queued',
        });
      }
    }

    // Queue to import_queue if it has a permalink
    if (item.permalink && !DRY_RUN) {
      try {
        await pgInsert('import_queue', [{
          listing_url: item.permalink,
          listing_title: item.title,
          source_id: null, // FB marketplace source
          status: 'pending',
          priority: orgId ? 5 : 1, // Higher priority for known suppliers
          raw_data: { fb_saved_item_id: item.fb_item_id, seller_name: item.seller_name },
        }]);
        queued++;
      } catch {
        // Already in queue — fine
        skipped++;
      }
    }
  }

  console.log(`\n  Matched to orgs: ${matched}`);
  console.log(`  Queued to import: ${queued}`);
  console.log(`  Already in queue: ${skipped}`);
  return { matched, queued };
}

// ── Phase C: Reel Title Parsing ──

async function phaseC() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Phase 2C: Reel/Video Title Parsing      ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Get all matched video/reel items
  const items = await pgQuery(
    `${BASE}/rest/v1/fb_saved_items?item_type=in.(Video,FBShorts)&processing_status=in.(matched,parsed)&matched_organization_id=not.is.null&select=id,title,matched_organization_id,creator_name&limit=${LIMIT}`
  );

  console.log(`Found ${items.length} matched reels/videos to parse\n`);

  let vehicleRefs = 0, linked = 0;
  const vehiclesByOrg = new Map(); // org_id → [{year, make, model}]

  for (const item of items) {
    const ref = parseVehicleReference(item.title);
    if (ref) {
      vehicleRefs++;
      const key = item.matched_organization_id;
      if (!vehiclesByOrg.has(key)) vehiclesByOrg.set(key, []);
      vehiclesByOrg.get(key).push({ ...ref, title: item.title, itemId: item.id });

      console.log(`  ✓ "${item.creator_name}": ${ref.year || '?'} ${ref.make || '?'} ${ref.model || '?'}`);
    }
  }

  console.log(`\nParsed ${vehicleRefs} vehicle references from ${items.length} titles`);
  console.log(`Across ${vehiclesByOrg.size} organizations\n`);

  // For each org's vehicle references, try to find/create vehicle records
  if (!DRY_RUN) {
    for (const [orgId, refs] of vehiclesByOrg) {
      for (const ref of refs) {
        // Search for existing vehicle matching year/make/model in org's inventory
        let searchFilter = '';
        if (ref.year) searchFilter += `&year=eq.${ref.year}`;
        if (ref.make) searchFilter += `&make=ilike.${encodeURIComponent(ref.make)}`;

        // Check if org already has this vehicle linked
        const existingLinks = await pgQuery(
          `${BASE}/rest/v1/organization_vehicles?organization_id=eq.${orgId}&select=vehicle_id,relationship_type`
        );

        // Store as behavior signal for the org
        await pgInsert('organization_behavior_signals', [{
          organization_id: orgId,
          signal_type: 'vehicle_showcase',
          signal_category: 'inventory',
          signal_data: {
            year: ref.year,
            make: ref.make,
            model: ref.model,
            source_title: ref.title,
            fb_item_id: ref.itemId,
          },
          confidence: ref.year ? 0.85 : 0.60,
          source_type: 'facebook_reel',
          observed_at: new Date().toISOString(),
        }]);
        linked++;
      }
    }
  }

  console.log(`\n  Vehicle references: ${vehicleRefs}`);
  console.log(`  Signals recorded: ${linked}`);
  return { vehicleRefs, linked };
}

// ── Main ──

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Supplier Inventory Cataloging — Phase 2');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  MODE: DRY RUN\n');

  const results = {};

  if (PHASE === 'ALL' || PHASE === 'A') {
    results.phaseA = await phaseA();
  }
  if (PHASE === 'ALL' || PHASE === 'B') {
    results.phaseB = await phaseB();
  }
  if (PHASE === 'ALL' || PHASE === 'C') {
    results.phaseC = await phaseC();
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
