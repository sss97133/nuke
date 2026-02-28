#!/usr/bin/env node
/**
 * sonar-enrich-org.mjs — Single org enrichment via Perplexity Sonar API
 *
 * The production automation of what Perplexity Computer ran manually.
 *
 * Usage:
 *   dotenvx run -- node scripts/sonar-enrich-org.mjs --id <uuid> --upsert
 *   dotenvx run -- node scripts/sonar-enrich-org.mjs --url https://velocitymotorcars.com
 *   dotenvx run -- node scripts/sonar-enrich-org.mjs --name "Velocity Motorcars"
 *
 * Env required: PERPLEXITY_API_KEY
 * Env for DB:   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Cost: sonar=$0.006/org  sonar-pro=$0.012/org
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const has = (f) => args.includes(f);

const orgUrl   = get("--url");
const orgId    = get("--id");
const orgName  = get("--name");
const doUpsert = has("--upsert");
const model    = get("--model") || "sonar-pro";

if (!orgUrl && !orgId && !orgName) {
  console.error("Usage: sonar-enrich-org.mjs --url <url> | --id <uuid> | --name <name> [--upsert] [--model sonar|sonar-pro]");
  process.exit(1);
}

const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_KEY) {
  console.error("PERPLEXITY_API_KEY not set. Get one at https://www.perplexity.ai/settings/api");
  console.error("Then: echo 'PERPLEXITY_API_KEY=pplx-xxx' >> .env && dotenvx encrypt");
  process.exit(1);
}

let supabase;
if (orgId || doUpsert) {
  supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let targetUrl = orgUrl, targetName = orgName, resolvedId = orgId;

if (orgId) {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, business_name, website, city, state, enrichment_status")
    .eq("id", orgId).single();
  if (error || !data) { console.error(`Org not found: ${orgId}`); process.exit(1); }
  targetUrl = data.website; targetName = data.business_name; resolvedId = data.id;
  console.log(`Org: ${data.business_name} (${data.city || "?"}, ${data.state || "?"})`);
}

function buildPrompt(name, url) {
  const subject = name && url ? `"${name}" at ${url}` : name ? `"${name}" business` : url;
  return `Research this automotive/collector car business: ${subject}

Search their website, Google, social media, and business directories.
Return ONLY a valid JSON object (no markdown, no explanation):

{
  "business_name": "official name",
  "legal_name": "registered legal name if different, else null",
  "description": "2-3 sentence description of specialty and reputation",
  "business_type": "dealer|auction_house|restoration_shop|parts_supplier|storage|transport|appraisal|media|broker|museum|racing|insurance|finance|other",
  "entity_type": "business|collection|individual|institution",
  "email": "contact email or null",
  "phone": "phone number or null",
  "website": "primary website URL",
  "address": "street address or null",
  "city": "city",
  "state": "2-letter US state or country if international",
  "zip_code": "zip or null",
  "country": "USA or country name",
  "year_established": 1985,
  "employee_count_estimate": 12,
  "specializations": ["Porsche", "air-cooled", "concours prep"],
  "services_offered": ["sales", "consignment", "restoration", "appraisal"],
  "brands_carried": ["Porsche", "Ferrari"],
  "inventory_url": "inventory page URL or null",
  "logo_url": "logo image URL or null",
  "social_facebook": "Facebook URL or null",
  "social_instagram": "Instagram URL or null",
  "social_linkedin": "LinkedIn URL or null",
  "social_twitter": "Twitter/X URL or null",
  "social_youtube": "YouTube URL or null",
  "hours_of_operation": "e.g. Mon-Fri 9am-5pm or null",
  "latitude": null,
  "longitude": null,
  "notes": "notable sales, awards, or reputation or null"
}`;
}

async function callSonar(name, url) {
  const t0 = Date.now();
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${PERPLEXITY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a business intelligence researcher specializing in the collector car industry. Search the web and return precise structured JSON. Return ONLY valid JSON, no markdown, no explanation." },
        { role: "user", content: buildPrompt(name, url) }
      ],
      search_context_size: "medium",
      temperature: 0.1,
      max_tokens: 1500,
    }),
  });
  const ms = Date.now() - t0;
  if (!resp.ok) { const b = await resp.text(); throw new Error(`Sonar ${resp.status}: ${b}`); }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || {};
  const citations = data.citations || [];
  const rates = model === "sonar-pro" ? { in: 3, out: 15, req: 0.010 } : { in: 1, out: 1, req: 0.008 };
  const cost = ((usage.prompt_tokens||0)*rates.in + (usage.completion_tokens||0)*rates.out)/1e6 + rates.req;
  return { content, citations, ms, usage, cost };
}

function extractJSON(text) {
  const s = text.replace(/^```(?:json)?\s*/im,"").replace(/\s*```\s*$/m,"").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

function mapToOrg(p, sourceUrl) {
  if (!p) return null;
  const cl = (v) => (v && v !== "null" && v !== "N/A" ? String(v).trim() : null);
  const sl = {};
  if (p.social_facebook) sl.facebook = p.social_facebook;
  if (p.social_instagram) sl.instagram = p.social_instagram;
  if (p.social_linkedin) sl.linkedin = p.social_linkedin;
  if (p.social_twitter) sl.twitter = p.social_twitter;
  if (p.social_youtube) sl.youtube = p.social_youtube;
  const yr = p.year_established ? parseInt(p.year_established) : null;
  const yearsInBiz = yr && yr > 1800 && yr <= 2026 ? 2026 - yr : null;
  const asArr = (v) => Array.isArray(v) && v.length ? v.filter(Boolean) : null;
  return {
    business_name: cl(p.business_name),
    legal_name: cl(p.legal_name),
    description: cl(p.description),
    business_type: cl(p.business_type),
    entity_type: cl(p.entity_type) || "business",
    email: cl(p.email)?.replace(/^mailto:/i,"") || null,
    phone: cl(p.phone),
    website: cl(p.website) || sourceUrl || null,
    address: cl(p.address),
    city: cl(p.city),
    state: cl(p.state),
    zip_code: cl(p.zip_code),
    country: cl(p.country) || "USA",
    years_in_business: yearsInBiz,
    employee_count: p.employee_count_estimate ? parseInt(p.employee_count_estimate) : null,
    specializations: asArr(p.specializations),
    services_offered: asArr(p.services_offered),
    brands_carried: asArr(p.brands_carried),
    inventory_url: cl(p.inventory_url),
    logo_url: cl(p.logo_url),
    social_links: Object.keys(sl).length ? sl : null,
    latitude: p.latitude ? parseFloat(p.latitude) : null,
    longitude: p.longitude ? parseFloat(p.longitude) : null,
    metadata: {
      sonar_notes: cl(p.notes),
      hours_of_operation_raw: cl(p.hours_of_operation),
      year_established_raw: p.year_established || null,
      enrichment_model: model,
    },
    enrichment_status: "enriched",
    enrichment_sources: ["perplexity-sonar"],
    last_enriched_at: new Date().toISOString(),
    discovered_via: "perplexity-sonar",
  };
}

const label = [targetName, targetUrl].filter(Boolean).join(" — ");
console.log(`\nSonar Enrich  [${model}]  ${label}`);
console.log("─".repeat(70));

const { content, citations, ms, usage, cost } = await callSonar(targetName, targetUrl);
console.log(`${ms}ms  |  ${usage.prompt_tokens||0}→${usage.completion_tokens||0} tokens  |  ~$${cost.toFixed(4)}`);

if (citations.length) {
  console.log(`\nSources (${citations.length}):`);
  citations.slice(0,5).forEach((c,i) => console.log(`  ${i+1}. ${c}`));
}

const parsed = extractJSON(content);
if (!parsed) { console.error("\nJSON parse failed:\n" + content); process.exit(1); }

const orgData = mapToOrg(parsed, targetUrl);
console.log("\n── Result " + "─".repeat(60));
console.log(JSON.stringify(orgData, null, 2));

if (doUpsert && supabase && resolvedId) {
  const payload = { ...orgData };
  delete payload.business_name;
  delete payload.discovered_via;
  const { error } = await supabase.from("organizations").update(payload).eq("id", resolvedId);
  if (error) { console.error(`\nUpdate failed: ${error.message}`); process.exit(1); }
  console.log(`\nUpdated ${resolvedId} (${targetName})`);
} else if (doUpsert && supabase) {
  if (!orgData.business_name) { console.error("\nNo business_name — cannot insert"); process.exit(1); }
  const slug = orgData.business_name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);
  const { data: ins, error } = await supabase.from("organizations")
    .insert({ ...orgData, slug, is_active:true, is_public:true, status:"active" })
    .select("id").single();
  if (error) { console.error(`\nInsert failed: ${error.message}`); process.exit(1); }
  console.log(`\nInserted: ${ins.id}`);
}

console.log(`\nCost: ~$${cost.toFixed(4)}`);
