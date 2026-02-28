/**
 * Load Perplexity-enriched organization data into the organizations table.
 *
 * Handles 4 files:
 *   1. org_id_mapping.csv      — 2,255 existing orgs, update enrichment_status
 *   2. phase1_combined.csv     — 358 new businesses (dealers, shops, brokers)
 *   3. phase2_collections_enrichment.csv — 1,894 collector collections
 *   4. phase3_no_website_enrichment.csv  — 186 orgs without websites
 *
 * Usage: npx tsx scripts/load-perplexity-orgs.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── CSV Parser (handles quoted fields with commas/newlines) ──
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { field += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      row.push(field); field = "";
    } else if (c === "\n" && !inQ) {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c === "\r" && !inQ) {
      // skip
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readCSV(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  const rows = parseCSV(text);
  const headers = rows[0];
  return rows.slice(1)
    .filter(r => r.length >= 2)
    .map(r => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = r[i] || ""; });
      return obj;
    });
}

// ── Helpers ──
function cl(t: string | undefined): string | null {
  return t?.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim() || null;
}
function cUrl(u: string | undefined): string | null {
  return u?.toLowerCase().replace(/\/+$/, "").replace(/\[.*?\]\(.*?\)/g, "").trim() || null;
}
function arr(t: string | undefined): string[] | null {
  if (!t) return null;
  const cleaned = cl(t);
  if (!cleaned) return null;
  const items = cleaned.split(",").map(s => s.trim()).filter(Boolean);
  return items.length ? items : null;
}
function slug(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}

// ── Dedup sets ──
const { data: existing } = await supabase.from("organizations").select("id, website, business_name");
const xW = new Set((existing || []).map(o => (o.website || "").toLowerCase().replace(/\/+$/, "")));
const xN = new Set((existing || []).map(o => (o.business_name || "").toLowerCase()));
const xIds = new Map((existing || []).map(o => [o.id, o]));
console.log(`Existing orgs: ${(existing || []).length}`);

async function batchInsert(orgs: any[], label: string) {
  let ins = 0, errs = 0;
  for (let i = 0; i < orgs.length; i += 50) {
    const chunk = orgs.slice(i, i + 50);
    const { data, error } = await supabase.from("organizations").insert(chunk).select("id");
    if (error) {
      // Fallback: insert one by one
      for (const org of chunk) {
        const { error: e } = await supabase.from("organizations").insert(org).select("id");
        if (e) { console.error(`  FAIL [${label}] ${org.business_name}: ${e.message}`); errs++; }
        else ins++;
      }
    } else {
      ins += (data || []).length;
    }
    process.stdout.write(`  [${label}] ${Math.min(i + 50, orgs.length)}/${orgs.length}\r`);
  }
  console.log(`  [${label}] ${ins} inserted, ${errs} errors                    `);
  return ins;
}

// ═══════════════════════════════════════════════
// FILE 1: org_id_mapping.csv — update existing orgs
// ═══════════════════════════════════════════════
console.log("\n── org_id_mapping.csv ──");
const mapping = readCSV("/Users/skylar/Downloads/org_id_mapping.csv");
console.log(`  ${mapping.length} rows`);
let mapUpdated = 0;
for (let i = 0; i < mapping.length; i += 50) {
  const chunk = mapping.slice(i, i + 50);
  for (const row of chunk) {
    if (!row.id) continue;
    const updates: any = {};
    if (row.business_type) updates.business_type = row.business_type;
    if (row.entity_type) updates.entity_type = row.entity_type;
    if (row.enrichment_status) updates.enrichment_status = row.enrichment_status;
    if (Object.keys(updates).length === 0) continue;

    const { error } = await supabase.from("organizations").update(updates).eq("id", row.id);
    if (!error) mapUpdated++;
  }
  process.stdout.write(`  ${Math.min(i + 50, mapping.length)}/${mapping.length}\r`);
}
console.log(`  ${mapUpdated} orgs updated with type/enrichment metadata        `);

// ═══════════════════════════════════════════════
// FILE 2: phase1_combined.csv — new businesses
// ═══════════════════════════════════════════════
console.log("\n── phase1_combined.csv ──");
const p1 = readCSV("/Users/skylar/Downloads/phase1_combined.csv");
console.log(`  ${p1.length} rows`);

const p1Batch: any[] = [];
let p1Skip = 0;
for (const r of p1) {
  const w = cUrl(r.entity);
  const n = r.business_name?.trim();
  if (!n) { p1Skip++; continue; }
  if (w && xW.has(w)) { p1Skip++; continue; }
  if (xN.has(n.toLowerCase())) { p1Skip++; continue; }

  const sl: any = {};
  if (r.social_facebook) sl.facebook = cl(r.social_facebook);
  if (r.social_instagram) sl.instagram = cl(r.social_instagram);
  if (r.social_linkedin) sl.linkedin = cl(r.social_linkedin);
  if (r.social_twitter) sl.twitter = cl(r.social_twitter);
  if (r.social_youtube) sl.youtube = cl(r.social_youtube);

  p1Batch.push({
    business_name: n, website: w,
    email: cl(r.email)?.replace(/^mailto:/i, ""),
    phone: cl(r.phone), address: cl(r.address), city: cl(r.city),
    state: cl(r.state), zip_code: cl(r.zip_code),
    country: cl(r.country) || "USA", description: cl(r.description),
    specializations: arr(r.specializations), services_offered: arr(r.services_offered),
    brands_carried: arr(r.brands_carried), logo_url: cl(r.logo_url),
    inventory_url: cl(r.inventory_url),
    social_links: Object.keys(sl).length ? sl : null,
    slug: slug(n), discovered_via: "perplexity",
    enrichment_status: "enriched", last_enriched_at: new Date().toISOString(),
    enrichment_sources: ["perplexity"], is_active: true, is_public: true, status: "active",
    entity_type: "uncategorized",
    metadata: {
      import_source: "phase1_combined.csv", import_date: "2026-02-27",
      hours_raw: r.hours_of_operation || null,
      year_established_raw: r.year_established || null,
      employee_estimate_raw: r.employee_count_estimate || null,
    },
  });
  // Track for dedup in subsequent files
  if (w) xW.add(w);
  xN.add(n.toLowerCase());
}
console.log(`  ${p1Batch.length} new, ${p1Skip} dupes skipped`);
await batchInsert(p1Batch, "phase1");

// ═══════════════════════════════════════════════
// FILE 3: phase2_collections_enrichment.csv — collections
// ═══════════════════════════════════════════════
console.log("\n── phase2_collections_enrichment.csv ──");
const p2 = readCSV("/Users/skylar/Downloads/phase2_collections_enrichment.csv");
console.log(`  ${p2.length} rows`);

const p2Batch: any[] = [];
let p2Skip = 0, p2Updated = 0;
for (const r of p2) {
  const n = r.business_name?.trim();
  if (!n) { p2Skip++; continue; }

  const w = cUrl(r.real_website || r.entity);

  const sl: any = {};
  if (r.social_facebook) sl.facebook = cl(r.social_facebook);
  if (r.social_instagram) sl.instagram = cl(r.social_instagram);
  if (r.social_twitter) sl.twitter = cl(r.social_twitter);
  if (r.social_youtube) sl.youtube = cl(r.social_youtube);

  const enrichmentData = {
    description: cl(r.description),
    city: cl(r.city), state: cl(r.state), country: cl(r.country) || "USA",
    social_links: Object.keys(sl).length ? sl : null,
    enrichment_status: "enriched",
    last_enriched_at: new Date().toISOString(),
    enrichment_sources: ["perplexity"],
    entity_type: "collection",
    metadata: {
      import_source: "phase2_collections_enrichment.csv",
      collection_focus: cl(r.collection_focus),
      collection_size: cl(r.collection_size),
      collector_bio: cl(r.collector_bio),
      notable_vehicles: cl(r.notable_vehicles),
    },
  };

  // Check if this org already exists (by name)
  if (xN.has(n.toLowerCase())) {
    // Update existing with enrichment
    const { error } = await supabase
      .from("organizations")
      .update(enrichmentData)
      .ilike("business_name", n);
    if (!error) p2Updated++;
    else console.error(`  UPDATE FAIL ${n}: ${error.message}`);
    p2Skip++;
    continue;
  }

  // New collection
  p2Batch.push({
    business_name: n,
    website: w,
    ...enrichmentData,
    slug: slug(n),
    discovered_via: "perplexity",
    is_active: true, is_public: true, status: "active",
  });
  xN.add(n.toLowerCase());
  if (w) xW.add(w);
}
console.log(`  ${p2Batch.length} new, ${p2Skip} existing (${p2Updated} enriched)`);
await batchInsert(p2Batch, "phase2");

// ═══════════════════════════════════════════════
// FILE 4: phase3_no_website_enrichment.csv
// ═══════════════════════════════════════════════
console.log("\n── phase3_no_website_enrichment.csv ──");
const p3 = readCSV("/Users/skylar/Downloads/phase3_no_website_enrichment.csv");
console.log(`  ${p3.length} rows`);

const p3Batch: any[] = [];
let p3Skip = 0, p3Updated = 0;
for (const r of p3) {
  const n = r.business_name?.trim();
  if (!n) { p3Skip++; continue; }

  const w = cUrl(r.real_website);

  const sl: any = {};
  if (r.social_instagram) sl.instagram = cl(r.social_instagram);
  if (r.social_youtube) sl.youtube = cl(r.social_youtube);

  const enrichmentData = {
    description: cl(r.description),
    city: cl(r.city), state: cl(r.state), country: cl(r.country) || "USA",
    website: w,
    social_links: Object.keys(sl).length ? sl : null,
    enrichment_status: "enriched",
    last_enriched_at: new Date().toISOString(),
    enrichment_sources: ["perplexity"],
    metadata: {
      import_source: "phase3_no_website_enrichment.csv",
      collection_focus: cl(r.collection_focus),
    },
  };

  if (xN.has(n.toLowerCase())) {
    const { error } = await supabase
      .from("organizations")
      .update(enrichmentData)
      .ilike("business_name", n);
    if (!error) p3Updated++;
    p3Skip++;
    continue;
  }

  p3Batch.push({
    business_name: n,
    ...enrichmentData,
    slug: slug(n),
    discovered_via: "perplexity",
    is_active: true, is_public: true, status: "active",
  });
  xN.add(n.toLowerCase());
}
console.log(`  ${p3Batch.length} new, ${p3Skip} existing (${p3Updated} enriched)`);
await batchInsert(p3Batch, "phase3");

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
const { count } = await supabase.from("organizations").select("id", { count: "exact", head: true });
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`TOTAL ORGANIZATIONS: ${count}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
