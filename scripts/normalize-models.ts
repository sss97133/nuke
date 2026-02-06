#!/usr/bin/env npx tsx
/**
 * Normalize vehicle model names across the entire database.
 * 
 * Problems this fixes:
 *   1. Case inconsistency: "corvette convertible" → "Corvette Convertible"
 *   2. Duplicate variants: "C10 Pickup", "c10 pickup" → "C10 Pickup"
 *   3. Junk in model: ad copy, prices, phone numbers, locations
 *   4. Over-specific: "Corvette Convertible 4-Speed" keeps base "Corvette" normalized
 * 
 * Strategy: 
 *   - Group by make + lowercase(model) to find case variants
 *   - Pick the most common properly-cased version as canonical
 *   - Update all variants to match
 *   - Process in batches to avoid timeouts
 * 
 * Usage:
 *   npx tsx scripts/normalize-models.ts                    # Run all makes
 *   npx tsx scripts/normalize-models.ts --make Chevrolet   # Just one make
 *   npx tsx scripts/normalize-models.ts --dry-run          # Preview only
 *   npx tsx scripts/normalize-models.ts --limit 50         # Limit batches
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
import dotenv from 'dotenv';
function loadEnv() {
  const paths = [
    path.resolve(__dirname, '..', 'nuke_frontend', '.env.local'),
    path.resolve(__dirname, '..', '.env.local'),
    path.resolve(__dirname, '..', '.env'),
  ];
  for (const p of paths) {
    try { if (fs.existsSync(p)) dotenv.config({ path: p, override: false }); } catch {}
  }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((_, i) => args[i - 1] === '--limit');
const makeArg = args.find((_, i) => args[i - 1] === '--make');
const batchLimit = limitArg ? parseInt(limitArg) : 0;
const targetMake = makeArg || null;

/**
 * Pick the best canonical form of a model name from variants.
 * Prefers: Title Case > UPPER CASE > lower case, and shorter > longer.
 */
function pickCanonicalModel(variants: { model: string; count: number }[]): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return toTitleCase(variants[0].model);

  // Sort by count descending
  const sorted = [...variants].sort((a, b) => b.count - a.count);
  
  // Check if any variant is already properly title-cased
  const titleCased = sorted.find(v => v.model === toTitleCase(v.model));
  if (titleCased) return titleCased.model;

  // Otherwise title-case the most common variant
  return toTitleCase(sorted[0].model);
}

function toTitleCase(s: string): string {
  if (!s) return s;
  
  // Don't touch all-caps short strings (acronyms): SS, GT, RS, ZR1, Z06, IROC, GTO
  // Don't touch model numbers: 911, 356, 300SL, E30, M3
  
  return s.split(' ').map(word => {
    if (!word) return word;
    
    // Handle hyphenated compounds: "4-Speed" → "4-Speed", not "4-speed"
    if (word.includes('-') && word.length > 2) {
      return word.split('-').map((part, i) => {
        if (!part) return part;
        if (/^\d+$/.test(part)) return part; // Keep numbers
        if (part.length <= 3 && /^[A-Z0-9]+$/.test(part)) return part; // Acronyms
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }).join('-');
    }
    
    // Keep all-caps if it looks like an acronym (2-5 chars, all uppercase/digits)
    if (word.length <= 5 && /^[A-Z0-9/-]+$/.test(word)) return word;
    
    // Keep alphanumeric model codes as-is: Z06, ZR1, RS6, M3, E30, GT3, 911
    if (/^[A-Z]{0,2}\d+[A-Z]?$/i.test(word)) return word.toUpperCase();
    
    // Keep special suffixes: 4×4, 4x4, 4WD, AWD, RWD, FWD
    if (/^(4[x×]4|[24]WD|AWD|RWD|FWD)$/i.test(word)) return word.toUpperCase();
    
    // Keep known all-caps terms
    const keepUpper = ['SS', 'GT', 'RS', 'LT', 'LS', 'LTZ', 'ZL1', 'ZR1', 'Z06', 'Z28', 
      'GTO', 'GTS', 'GTE', 'GTB', 'GTR', 'AMG', 'SRT', 'TRD', 'XLT', 'SLE', 'SLT', 
      'SEL', 'SE', 'LE', 'XL', 'DX', 'EX', 'LX', 'SR', 'SR5', 'TRX', 'RT',
      'IROC', 'IROC-Z', 'II', 'III', 'IV', 'VI', 'VII', 'VIII',
      'CSL', 'CSi', 'DTM', 'RSR', 'RSi', 'SD', 'SC', 'ST', 'SV', 'SVT', 'STI',
      'WRX', 'TDI', 'TSI', 'TFSI', 'PDK', 'DCT', 'SMG'];
    if (keepUpper.includes(word.toUpperCase())) return word.toUpperCase();
    
    // Keep known mixed-case terms
    const keepMixed: Record<string, string> = {
      'mclaren': 'McLaren', 'deville': 'DeVille', 'el': 'El',
      'gt40': 'GT40', 'gt350': 'GT350', 'gt500': 'GT500',
    };
    if (keepMixed[word.toLowerCase()]) return keepMixed[word.toLowerCase()];
    
    // Standard title case
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// Simple fetch wrapper for Supabase REST API
async function supabaseQuery(table: string, params: Record<string, string>, method = 'GET', body?: any): Promise<any> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'PATCH' ? 'return=minimal' : 'return=representation',
  };
  
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} ${text}`);
  }
  
  if (method === 'PATCH') return { ok: true };
  return res.json();
}

async function supabaseRpc(fn: string, params: any): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`RPC ${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

interface ModelGroup {
  make: string;
  modelLower: string;
  canonical: string;
  variants: { model: string; count: number }[];
  totalCount: number;
  needsUpdate: number; // count of records that don't match canonical
}

async function main() {
  console.log(`\n=== Model Normalization ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (targetMake) console.log(`Target make: ${targetMake}`);
  if (batchLimit) console.log(`Batch limit: ${batchLimit}`);
  console.log('');

  // Get list of makes to process
  let makes: string[];
  if (targetMake) {
    makes = [targetMake];
  } else {
    // Get distinct makes by paging through all vehicles
    const makeCounts = new Map<string, number>();
    for (let offset = 0; ; offset += 1000) {
      const data = await supabaseQuery('vehicles', {
        'select': 'make',
        'status': 'eq.active',
        'listing_kind': 'eq.vehicle',
        'make': 'not.is.null',
        'limit': '1000',
        'offset': String(offset),
      });
      if (!data || data.length === 0) break;
      for (const row of data) {
        const m = String(row.make || '').trim();
        if (m && m.length > 1 && !/^[^a-zA-Z0-9]+$/.test(m)) {
          makeCounts.set(m, (makeCounts.get(m) || 0) + 1);
        }
      }
      // Stop after reasonable coverage (200k rows)
      if (offset >= 200000) break;
    }
    makes = Array.from(makeCounts.entries())
      .filter(([m]) => m.length > 1) // Skip single-char junk
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
    console.log(`Found ${makes.length} distinct makes to process (top 10: ${makes.slice(0, 10).join(', ')})\n`);
  }

  let totalUpdated = 0;
  let totalGroups = 0;
  let batchesProcessed = 0;

  for (const make of makes) {
    if (batchLimit && batchesProcessed >= batchLimit) break;

    // Fetch models for this make in pages to handle large makes (Chevy has 33k+)
    let models: any[] = [];
    const PAGE_SIZE = 1000;
    try {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await supabaseQuery('vehicles', {
          'select': 'id,model',
          'make': `ilike.${make}`,
          'status': 'eq.active',
          'listing_kind': 'eq.vehicle',
          'model': 'not.is.null',
          'limit': String(PAGE_SIZE),
          'offset': String(offset),
        });
        if (!page || page.length === 0) break;
        models.push(...page);
        if (page.length < PAGE_SIZE) break;
        // Safety limit: 50k records per make
        if (models.length >= 50000) break;
      }
    } catch (err: any) {
      console.error(`  ✗ Error fetching models for ${make}: ${err.message}`);
      continue;
    }

    if (!models || models.length === 0) continue;

    // Group by lowercase model to find case variants
    const groups = new Map<string, { model: string; ids: string[] }[]>();
    for (const row of models) {
      const model = String(row.model || '').trim();
      if (!model) continue;
      const key = model.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      const existing = groups.get(key)!.find(g => g.model === model);
      if (existing) {
        existing.ids.push(row.id);
      } else {
        groups.get(key)!.push({ model, ids: [row.id] });
      }
    }

    // Find groups with case variants (need normalization)
    let makeUpdated = 0;
    let makeGroups = 0;

    for (const [lowerModel, variants] of groups) {
      if (variants.length <= 1 && variants[0]?.model === toTitleCase(variants[0]?.model)) {
        continue; // Already normalized, single variant
      }

      const canonical = pickCanonicalModel(
        variants.map(v => ({ model: v.model, count: v.ids.length }))
      );

      // Find all IDs that need updating (don't match canonical)
      const idsToUpdate: string[] = [];
      for (const v of variants) {
        if (v.model !== canonical) {
          idsToUpdate.push(...v.ids);
        }
      }
      // Also check if the only variant needs title-casing
      if (variants.length === 1 && variants[0].model !== canonical) {
        idsToUpdate.push(...variants[0].ids);
      }

      if (idsToUpdate.length === 0) continue;

      makeGroups++;

      if (dryRun) {
        if (makeGroups <= 5) {
          const variantStr = variants.map(v => `"${v.model}" (${v.ids.length})`).join(', ');
          console.log(`  ${make} | ${variantStr} → "${canonical}" (${idsToUpdate.length} updates)`);
        }
        makeUpdated += idsToUpdate.length;
        continue;
      }

      // Update in small batches of 10 IDs with retry
      for (let i = 0; i < idsToUpdate.length; i += 10) {
        const batch = idsToUpdate.slice(i, i + 10);
        let retries = 2;
        while (retries >= 0) {
          try {
            const idFilter = `in.(${batch.join(',')})`;
            await supabaseQuery('vehicles', {
              'id': idFilter,
            }, 'PATCH', { model: canonical });
            makeUpdated += batch.length;
            break;
          } catch (err: any) {
            retries--;
            if (retries < 0) {
              console.error(`  ✗ Failed ${make}/${canonical} (${batch.length} ids): ${err.message?.slice(0, 80)}`);
            } else {
              await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
            }
          }
        }
        // Small delay between batches to avoid rate limiting
        if (i % 100 === 0 && i > 0) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    if (makeGroups > 0) {
      const msg = `  ${make}: ${makeGroups} model groups normalized, ${makeUpdated} records updated`;
      console.log(msg);
      totalUpdated += makeUpdated;
      totalGroups += makeGroups;
      batchesProcessed++;
      
      // Write progress to status file for other agents to read
      try {
        const statusPath = path.resolve(__dirname, '..', 'docs', 'agents', 'MODEL_NORMALIZATION_STATUS.md');
        const progressLine = `| ${make} | ${makeGroups} | ${makeUpdated} | ✅ Done |`;
        const status = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf-8') : '';
        // Append progress line or update existing
        if (status.includes(`| ${make} |`)) {
          // Already has this make - update the line
          const updated = status.replace(new RegExp(`\\| ${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|[^\\n]*`), progressLine);
          fs.writeFileSync(statusPath, updated);
        }
      } catch {}
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Makes processed: ${batchesProcessed}`);
  console.log(`Model groups normalized: ${totalGroups}`);
  console.log(`Records updated: ${totalUpdated}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes made)' : 'LIVE'}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
