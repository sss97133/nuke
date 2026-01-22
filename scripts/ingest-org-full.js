#!/usr/bin/env node
/**
 * Full "sus out" ingestion:
 * 1) Create/find org from URL
 * 2) Run discover-organization-full for structure-first mapping + extraction
 *
 * Usage:
 *   node scripts/ingest-org-full.js <inventory-or-site-url>
 */

import fs from "node:fs";
import path from "node:path";

const ENV_CANDIDATES = [
  ".env",
  ".env.local",
  path.join("nuke_frontend", ".env.local"),
  path.join("nuke_frontend", ".env"),
];

function loadEnvFile(relPath) {
  try {
    const absPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(absPath)) return false;
    const content = fs.readFileSync(absPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([^=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function ensureEnvLoaded() {
  for (const candidate of ENV_CANDIDATES) {
    if (loadEnvFile(candidate)) return candidate;
  }
  return null;
}

function resolveSupabaseConfig() {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    "";
  return { supabaseUrl, serviceKey };
}

function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

async function callEdgeFunction(name, body, supabaseUrl, serviceKey) {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("Node 18+ required (global fetch missing).");
  }

  const targetUrl = normalizeUrl(process.argv[2]);
  if (!targetUrl) {
    console.error("Usage: node scripts/ingest-org-full.js <inventory-or-site-url>");
    process.exit(1);
  }

  ensureEnvLoaded();
  const { supabaseUrl, serviceKey } = resolveSupabaseConfig();

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in environment."
    );
  }

  const inventoryUrl = targetUrl;
  const originUrl = new URL(targetUrl).origin;

  console.log("🔎 Full ingestion (structure-first)");
  console.log(`- Inventory URL: ${inventoryUrl}`);
  console.log(`- Canonical URL: ${originUrl}`);

  console.log("\n1) Creating or finding organization...");
  const orgResp = await callEdgeFunction(
    "create-org-from-url",
    {
      url: originUrl,
      queue_synopsis: true,
      queue_site_mapping: true,
    },
    supabaseUrl,
    serviceKey
  );

  let usedFallback = false;
  if (orgResp.ok && orgResp.data?.success && orgResp.data?.organization_id) {
    const organizationId = orgResp.data.organization_id;
    console.log(`✅ Organization ID: ${organizationId}`);

    console.log("\n2) Running discover-organization-full...");
    const discoverResp = await callEdgeFunction(
      "discover-organization-full",
      {
        organization_id: organizationId,
        website: inventoryUrl,
        force_rediscover: true,
      },
      supabaseUrl,
      serviceKey
    );

    if (!discoverResp.ok && discoverResp.status === 404) {
      usedFallback = true;
      console.log("⚠️ discover-organization-full not deployed; falling back to ingest-org-complete.");
    } else if (!discoverResp.ok) {
      throw new Error("discover-organization-full failed (non-404).");
    } else if (!discoverResp.data?.success) {
      throw new Error(
        `discover-organization-full failed: ${discoverResp.data?.error || "unknown error"}`
      );
    } else {
      const result = discoverResp.data.result || discoverResp.data;
      console.log("\n✅ Discovery complete");
      console.log(`- Site type: ${result.site_structure?.site_type || "unknown"}`);
      if (result.site_structure?.platform) {
        console.log(`- Platform: ${result.site_structure.platform}`);
      }
      console.log(`- Vehicles found: ${result.vehicles_found ?? 0}`);
      console.log(`- Vehicles queued: ${result.vehicles_extracted ?? 0}`);
      console.log(`- Vehicles created: ${result.vehicles_created ?? 0}`);
      console.log(`- Images found: ${result.images_found ?? 0}`);
    }
  } else if (!orgResp.ok && orgResp.status === 404) {
    usedFallback = true;
    console.log("⚠️ create-org-from-url not deployed; falling back to ingest-org-complete.");
  } else {
    throw new Error(
      `create-org-from-url failed: ${orgResp.data?.error || "unknown error"}`
    );
  }

  if (usedFallback) {
    console.log("\nRunning ingest-org-complete (single-step full pipeline)...");
    const ingestResp = await callEdgeFunction(
      "ingest-org-complete",
      { url: inventoryUrl, force_rediscover: true },
      supabaseUrl,
      serviceKey
    );

    if (!ingestResp.ok) {
      throw new Error("ingest-org-complete failed (non-404).");
    }
    if (!ingestResp.data?.success) {
      throw new Error(`ingest-org-complete failed: ${ingestResp.data?.error || "unknown error"}`);
    }

    const result = ingestResp.data;
    console.log("\n✅ Ingestion complete");
    console.log(`- Organization ID: ${result.organization_id || "unknown"}`);
    console.log(`- Site type: ${result.site_structure?.site_type || "unknown"}`);
    if (result.site_structure?.platform) {
      console.log(`- Platform: ${result.site_structure.platform}`);
    }
    console.log(`- Vehicles found: ${result.vehicles_found ?? 0}`);
    console.log(`- Vehicles created: ${result.vehicles_created ?? 0}`);
    console.log(`- Images found: ${result.images_found ?? 0}`);
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
