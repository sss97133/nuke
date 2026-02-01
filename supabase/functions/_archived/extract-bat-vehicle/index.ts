// BaT Vehicle Extractor v7
// Uses extraction_attempts model for full auditability
// See: docs/architecture/DATA_INGESTION_AND_REPAIR_SYSTEM.md

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EXTRACTOR_NAME = "bat-listing";
const EXTRACTOR_VERSION = "v7";

interface ExtractionRequest {
  vehicle_id: string;
  apply?: boolean;  // If false, dry-run only
  rehydrate?: boolean;  // If true, add missing canonical images
}

interface ExtractionMetrics {
  images: {
    before_total: number;
    before_contaminated: number;
    canonical_found: number;
    after_total: number;
  };
  timing: {
    fetch_ms: number;
    parse_ms: number;
    cleanup_ms: number;
    total_ms: number;
  };
  source: {
    page_size_bytes?: number;
    http_status?: number;
  };
}

// Canonical image detection
function isLikelyImage(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.endsWith(".svg")) return false;
  if (lower.includes("pixel")) return false;
  return /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(lower);
}

function isBaTUpload(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.includes("bringatrailer.com") && 
           u.pathname.includes("/wp-content/uploads/");
  } catch {
    return false;
  }
}

function isBadHost(url: string): boolean {
  const badHosts = [
    "facebook.com", "linkedin.com", "addtoany.com",
    "twitter.com", "pinterest.com"
  ];
  try {
    const u = new URL(url);
    return badHosts.some(h => u.hostname.includes(h));
  } catch {
    return false;
  }
}

// Scrape BaT listing for canonical images
async function scrapeBaTListing(listingUrl: string): Promise<{
  images: string[];
  html: string;
  fetchTime: number;
  parseTime: number;
}> {
  const fetchStart = performance.now();
  
  const response = await fetch(listingUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  
  const fetchTime = performance.now() - fetchStart;
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const html = await response.text();
  const parseStart = performance.now();
  
  // Parse images from HTML (simple regex-based extraction)
  // In production, use a proper DOM parser
  const imageMatches = html.matchAll(/src=["']([^"']+)["']/g);
  const images: string[] = [];
  
  for (const match of imageMatches) {
    const url = match[1];
    if (isLikelyImage(url) && isBaTUpload(url) && !isBadHost(url)) {
      images.push(url);
    }
  }
  
  const parseTime = performance.now() - parseStart;
  
  return {
    images: Array.from(new Set(images)),  // Deduplicate
    html,
    fetchTime,
    parseTime,
  };
}

// Save HTML snapshot to storage
async function saveSnapshot(
  vehicleId: string,
  html: string,
  attemptId: string
): Promise<string> {
  const timestamp = new Date().toISOString().split('T')[0];
  const path = `snapshots/${timestamp}/${vehicleId}_${attemptId}.html`;
  
  const { error } = await supabase.storage
    .from("extraction-snapshots")
    .upload(path, html, {
      contentType: "text/html",
      upsert: false,
    });
  
  if (error) {
    console.warn(`Failed to save snapshot: ${error.message}`);
    return `failed_${path}`;
  }
  
  return path;
}

// Main extraction logic
async function extractVehicle(req: ExtractionRequest): Promise<any> {
  const startTime = performance.now();
  const { vehicle_id, apply = false, rehydrate = false } = req;
  
  // Fetch vehicle
  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select("id, discovery_url, profile_origin, primary_image_url, origin_metadata")
    .eq("id", vehicle_id)
    .maybeSingle();
  
  if (vErr) throw vErr;
  if (!vehicle) throw new Error("Vehicle not found");
  if (!vehicle.discovery_url) throw new Error("Vehicle has no discovery_url");
  if (vehicle.profile_origin !== "bat_import") {
    throw new Error("Only BaT vehicles supported in this version");
  }
  
  // Fetch existing images
  const { data: existingImages, error: imgErr } = await supabase
    .from("vehicle_images")
    .select("id, image_url, file_hash, storage_path")
    .eq("vehicle_id", vehicle_id);
  
  if (imgErr) throw imgErr;
  
  const beforeTotal = existingImages?.length ?? 0;
  
  // Check for contamination
  const hashes = (existingImages ?? []).map(i => i.file_hash).filter(Boolean);
  let contaminated: any[] = [];
  
  if (hashes.length > 0) {
    const { data: hashUsage } = await supabase
      .from("vehicle_images")
      .select("file_hash, vehicle_id")
      .in("file_hash", hashes);
    
    const hashCounts: Record<string, number> = {};
    (hashUsage ?? []).forEach(row => {
      hashCounts[row.file_hash] = (hashCounts[row.file_hash] ?? 0) + 1;
    });
    
    contaminated = (existingImages ?? []).filter(img => {
      const shared = img.file_hash && hashCounts[img.file_hash] > 1;
      const badHost = isBadHost(img.image_url || "");
      return shared || badHost;
    });
  }
  
  // Scrape BaT for canonical images
  let canonicalImages: string[] = [];
  let snapshotRef = "";
  let fetchTime = 0;
  let parseTime = 0;
  let httpStatus = 0;
  let pageSize = 0;
  
  try {
    const scrapeResult = await scrapeBaTListing(vehicle.discovery_url);
    canonicalImages = scrapeResult.images;
    fetchTime = scrapeResult.fetchTime;
    parseTime = scrapeResult.parseTime;
    httpStatus = 200;
    pageSize = scrapeResult.html.length;
    
    // Snapshot saving disabled for performance - will add in v8
    snapshotRef = `snapshot_placeholder_${vehicle_id}`;
  } catch (error: any) {
    // Scrape failed - classify failure
    const failureCode = error.message.includes("HTTP 404") ? "NOT_FOUND"
                      : error.message.includes("HTTP 403") ? "BLOCKED"
                      : error.message.includes("timeout") ? "TIMEOUT"
                      : "PARSE_ERROR";
    
    // Record failed attempt
    const { data: attemptId } = await supabase.rpc("record_extraction_attempt", {
      p_vehicle_id: vehicle_id,
      p_source_url: vehicle.discovery_url,
      p_source_type: "bat",
      p_extractor_name: EXTRACTOR_NAME,
      p_extractor_version: EXTRACTOR_VERSION,
      p_status: "failed",
      p_failure_code: failureCode,
      p_failure_reason: error.message,
      p_metrics: {
        timing: { total_ms: performance.now() - startTime },
        source: { http_status: httpStatus },
      },
    });
    
    return {
      success: false,
      vehicle_id,
      status: "failed",
      failure_code: failureCode,
      failure_reason: error.message,
      attempt_id: attemptId,
    };
  }
  
  // Determine which images are missing
  const existingUrls = new Set((existingImages ?? []).map(i => i.image_url).filter(Boolean));
  const missingCanonical = canonicalImages.filter(url => !existingUrls.has(url));
  
  // Execute cleanup/rehydration if apply=true
  const cleanupStart = performance.now();
  let deletedCount = 0;
  let insertedCount = 0;
  
  if (apply) {
    // Delete contaminated
    if (contaminated.length > 0) {
      const ids = contaminated.map(c => c.id);
      const { error: delErr } = await supabase
        .from("vehicle_images")
        .delete()
        .in("id", ids);
      
      if (delErr) throw delErr;
      deletedCount = contaminated.length;
    }
    
    // Rehydrate missing canonical
    if (rehydrate && missingCanonical.length > 0) {
      const newRows = missingCanonical.map(url => ({
        vehicle_id,
        image_url: url,
        source: "bat_import",
        image_type: "gallery",
        is_canonical: true,
        is_primary: false,
      }));
      
      const { error: insErr } = await supabase
        .from("vehicle_images")
        .insert(newRows);
      
      if (insErr) throw insErr;
      insertedCount = missingCanonical.length;
    }
    
    // Update primary_image_url if needed
    if (canonicalImages.length > 0 && vehicle.primary_image_url !== canonicalImages[0]) {
      await supabase
        .from("vehicles")
        .update({
          primary_image_url: canonicalImages[0],
          origin_metadata: {
            ...(vehicle.origin_metadata || {}),
            image_urls: canonicalImages,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", vehicle_id);
    }
  }
  
  const cleanupTime = performance.now() - cleanupStart;
  const totalTime = performance.now() - startTime;
  
  // Build metrics
  const metrics: ExtractionMetrics = {
    images: {
      before_total: beforeTotal,
      before_contaminated: contaminated.length,
      canonical_found: canonicalImages.length,
      after_total: apply ? (beforeTotal - deletedCount + insertedCount) : beforeTotal,
    },
    timing: {
      fetch_ms: Math.round(fetchTime),
      parse_ms: Math.round(parseTime),
      cleanup_ms: Math.round(cleanupTime),
      total_ms: Math.round(totalTime),
    },
    source: {
      page_size_bytes: pageSize,
      http_status: httpStatus,
    },
  };
  
  // Record successful attempt
  const { data: attemptId, error: recErr } = await supabase.rpc("record_extraction_attempt", {
    p_vehicle_id: vehicle_id,
    p_source_url: vehicle.discovery_url,
    p_source_type: "bat",
    p_extractor_name: EXTRACTOR_NAME,
    p_extractor_version: EXTRACTOR_VERSION,
    p_status: "success",
    p_metrics: metrics,
    p_extracted_data: {
      canonical_images: canonicalImages,
      contaminated_images: contaminated.map(c => ({
        id: c.id,
        url: c.image_url,
        reason: c.file_hash ? "shared_hash" : "bad_host",
      })),
    },
    p_snapshot_ref: snapshotRef,
  });
  
  if (recErr) console.error("Failed to record attempt:", recErr);
  
  // Return before/after report
  return {
    success: true,
    vehicle_id,
    attempt_id: attemptId,
    apply,
    rehydrate,
    before: {
      total_images: beforeTotal,
      contaminated: contaminated.length,
      primary_image: vehicle.primary_image_url,
    },
    after: {
      total_images: apply ? (beforeTotal - deletedCount + insertedCount) : beforeTotal,
      deleted: apply ? deletedCount : 0,
      inserted: apply ? insertedCount : 0,
      primary_image: canonicalImages[0] || vehicle.primary_image_url,
    },
    canonical: {
      found: canonicalImages.length,
      missing: missingCanonical.length,
      examples: canonicalImages.slice(0, 5),
    },
    evidence: {
      snapshot: snapshotRef,
      url: vehicle.discovery_url,
    },
    metrics,
  };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  
  try {
    const body = await req.json();
    const result = await extractVehicle(body);
    
    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Extraction error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

