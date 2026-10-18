#!/usr/bin/env node
/**
 * Cars & Bids Direct Signed API Sync, Gold-Standard Extractor & Telemetry Backfill
 *
 * Uses a single headless Playwright session to pass Cloudflare and obtain `cb-tini`
 * (`__farsce`, `_gi_ase`), then calls Cars & Bids' internal `/v2/autos/auctions`
 * and `/v1/autos/auctions/{id}/comments` JSON APIs directly using the exact SHA-1
 * request signature (`sha1("${__farsce}_${timestamp}_/${apiVer}/${endpoint}${_gi_ase}")`).
 *
 * Zero Firecrawl credits. 100% structured JSON fidelity across all 9 downstream tables:
 *   1. `listing_page_snapshots` (complete API JSON + narrative archive)
 *   2. `vehicles`               (canonical 17-char VIN + 32 populated columns)
 *   3. `vehicle_events`         (source_platform='cars_and_bids', exact base62 ID)
 *   4. `auction_events`         (source='cars_and_bids', full bid_history, seller/winner)
 *   5. `vehicle_listings`       (live auction floor mirror for active auctions)
 *   6. `organization_vehicles`  (linked to Cars & Bids org 822cae29-f80e-4859-9c48-a1485a543152)
 *   7. `external_identities`    (every unique seller, buyer, bidder, and commenter handle)
 *   8. `vehicle_images`         (all full-res width=2080 gallery photos with category metadata)
 *   9. `auction_comments`       (every individual comment + timestamped bid linked to identity)
 *
 * Modes:
 *   node scripts/cab-api-sync.mjs --mode=live
 *   node scripts/cab-api-sync.mjs --mode=extract --ids=9em6ZaVd,3yBXgzN7
 *   node scripts/cab-api-sync.mjs --mode=backfill --start-page=1 --end-page=853
 */

import { chromium } from "playwright";
import crypto from "crypto";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Shared writer gate (.claude/LANES.md): hold while more than 3 client queries wait on IO. One shared Management API
// rate limit serves every agent, so read it at most once a minute and back off a minute on a 429 or any failure.
const IO_GATE_MAX_WAITERS = 3;
let ioGateLastCheck = 0;
async function waitForIoGate() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = (SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) return;
  for (;;) {
    const sinceLast = Date.now() - ioGateLastCheck;
    if (sinceLast < 60_000) await new Promise((r) => setTimeout(r, 60_000 - sinceLast));
    ioGateLastCheck = Date.now();
    let waiters = null;
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "SELECT count(*)::int AS n FROM pg_stat_activity WHERE backend_type = 'client backend' AND state = 'active' AND wait_event_type = 'IO'",
        }),
      });
      if (res.ok) waiters = (await res.json())?.[0]?.n ?? null;
    } catch {}
    if (waiters !== null && waiters <= IO_GATE_MAX_WAITERS) return;
    console.log(`  [io-gate] ${waiters === null ? "gate read failed" : `${waiters} queries waiting on IO`}; holding 60 s`);
  }
}

// PostgREST errors from a gateway timeout or an empty 5xx body carry code/details/hint but no message.
function describePgError(err) {
  const parts = [err?.message, err?.code && `code=${err.code}`, err?.details && `details=${err.details}`, err?.hint && `hint=${err.hint}`]
    .filter(Boolean);
  return parts.length ? parts.join(" ") : JSON.stringify(err);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  global: { headers: { "X-Nuke-Writer": "extract-cars-and-bids-core" } },
});

// Verified Cars & Bids organization UUID in public.organizations ('Cars & Bids', slug='cars-bids')
const CARS_AND_BIDS_ORG_ID = "822cae29-f80e-4859-9c48-a1485a543152";

const BODY_STYLE_MAP = {
  1: "Coupe",
  2: "Convertible",
  3: "Hatchback",
  4: "Sedan",
  5: "SUV/Crossover",
  6: "Truck",
  7: "Van/Minivan",
  8: "Wagon",
};

const DRIVETRAIN_MAP = {
  1: "Front-wheel drive",
  2: "Rear-wheel drive",
  3: "4WD/AWD",
};

const TRANSMISSION_MAP = {
  1: "Automatic",
  2: "Manual",
};

const SELLER_TYPE_MAP = {
  1: "private",
  2: "dealer",
};

function slugifyTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function buildCanonicalUrl(id, title) {
  const slug = slugifyTitle(title);
  return slug
    ? `https://carsandbids.com/auctions/${id}/${slug}`
    : `https://carsandbids.com/auctions/${id}`;
}

function parseLocationString(raw) {
  if (!raw || typeof raw !== "string") {
    return { raw: null, clean: null, city: null, state: null, zip: null, confidence: 0 };
  }
  const trimmed = raw.trim();
  const usMatch = trimmed.match(/^([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
  if (usMatch) {
    const city = usMatch[1].trim();
    const state = usMatch[2].toUpperCase();
    const zip = usMatch[3] || null;
    return {
      raw: trimmed,
      clean: `${city}, ${state}`,
      city,
      state,
      zip,
      confidence: 0.95,
    };
  }
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    raw: trimmed,
    clean: parts.slice(0, 2).join(", ") || trimmed,
    city: parts[0] || null,
    state: parts[1] || null,
    zip: null,
    confidence: 0.75,
  };
}

function parseTitleYmm(title) {
  const m = String(title || "").trim().match(/^(\d{4})\s+(\S+)\s+(.+)$/);
  if (!m) return { year: null, make: null, model: null };
  let year = parseInt(m[1], 10);
  let make = m[2];
  let model = m[3];
  const twoWordMakes = [
    "Alfa Romeo",
    "Aston Martin",
    "Land Rover",
    "Mercedes-Benz",
    "Rolls-Royce",
    "De Tomaso",
    "AM General",
    "Austin-Healey",
  ];
  for (const tw of twoWordMakes) {
    if (
      String(title || "")
        .slice(5)
        .toLowerCase()
        .startsWith(tw.toLowerCase() + " ")
    ) {
      make = tw;
      model = String(title || "").slice(5 + tw.length).trim();
      break;
    }
  }
  return { year, make, model };
}

function cleanCabText(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/Watch$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCabFacets(input) {
  const year = typeof input.year === "number" && Number.isFinite(input.year) ? input.year : null;
  const brand = cleanCabText(input.make).toLowerCase();
  const rawModel = cleanCabText(input.model);
  const rawTitle = cleanCabText(input.title);
  const rawSubTitle = cleanCabText(input.subTitle);

  const headlineCore = rawTitle.split(/\s+[—–-]\s+/)[0].trim();
  const headlineWithoutYearPrefix = headlineCore
    .replace(/^(?:[\d,]+\s*k?-?\s*mile\s+|modified\s+)*(?:19\d{2}|20[0-3]\d)\s+/i, "")
    .trim();
  const coreHaystack = [headlineWithoutYearPrefix, rawModel].filter(Boolean).join(" ").toUpperCase();
  const fullHaystack = [headlineWithoutYearPrefix, rawModel, rawSubTitle, cleanCabText(input.highlights)]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  let normalizedModel = rawModel || null;
  let series = null;
  let trim = null;
  let bodyStyle = cleanCabText(input.existingBodyStyle) || null;

  if (/^SUV\/Crossover$/i.test(bodyStyle ?? "")) bodyStyle = "SUV";
  if (/^Van\/Minivan$/i.test(bodyStyle ?? "")) bodyStyle = "Van";

  if (normalizedModel) {
    if (brand === "ford" && /^Super\s+Duty$/i.test(normalizedModel)) {
      if (/\bF-?250\b/i.test(headlineCore)) normalizedModel = "F-250 Super Duty";
      else if (/\bF-?350\b/i.test(headlineCore)) normalizedModel = "F-350 Super Duty";
      else if (/\bF-?450\b/i.test(headlineCore)) normalizedModel = "F-450 Super Duty";
    } else if (brand === "bmw" && /^[2345678]\s+Series$/i.test(normalizedModel)) {
      const mMatch = headlineCore.match(/\b([1-8]\d{2}[A-Za-z]*(?:\s+xDrive)?|[M][234568]\d{0,2}[A-Za-z]*)\b/);
      if (mMatch) normalizedModel = mMatch[1];
    } else if (brand === "bmw" && /^02\s+Series$/i.test(normalizedModel)) {
      if (/\b2002\s*tii\b/i.test(headlineCore)) normalizedModel = "2002tii";
      else if (/\b2002\b/i.test(headlineCore)) normalizedModel = "2002";
      else if (/\b1600\b/i.test(headlineCore)) normalizedModel = "1600";
    } else if (brand === "mercedes-benz" && /^GLK-\s*Class$/i.test(normalizedModel)) {
      normalizedModel = "GLK-Class";
    }
  }

  // 1. SERIES EXTRACTION
  if (brand === "chevrolet" || brand === "gmc") {
    if (/\bCORVETTE\b/.test(coreHaystack)) {
      if (/\bZR[-\s]?1\b/.test(coreHaystack)) series = "ZR1 / ZR-1";
      else if (/\bZ06\b/.test(coreHaystack)) series = "Z06";
      else if (/\bGRAND\s+SPORT\b/.test(coreHaystack)) series = "Grand Sport";
      else if (/\bE[-\s]?RAY\b/.test(coreHaystack)) series = "E-Ray";
      else if (/\bL88\b/.test(fullHaystack)) series = "L88 427";
      else if (/\b427\b/.test(coreHaystack)) series = "427 Big-Block";
      else if (/\bFUEL\s+INJECTED\b|\bFUELIE\b/.test(fullHaystack)) series = "Fuel Injected";
      else if (/\bSTING\s+RAY\b/.test(coreHaystack) || (year && year >= 1963 && year <= 1967)) series = "Sting Ray (C2)";
      else if (/\bSTINGRAY\b/.test(coreHaystack)) series = "Stingray";
      else if (/\bC8\b/.test(coreHaystack) || (year && year >= 2020)) series = "C8 Corvette";
      else if (/\bC7\b/.test(coreHaystack) || (year && year >= 2014 && year <= 2019)) series = "C7 Corvette";
      else if (/\bC6\b/.test(coreHaystack) || (year && year >= 2005 && year <= 2013)) series = "C6 Corvette";
      else if (/\bC5\b/.test(coreHaystack) || (year && year >= 1997 && year <= 2004)) series = "C5 Corvette";
      else if (/\bC4\b/.test(coreHaystack) || (year && year >= 1984 && year <= 1996)) series = "C4 Corvette";
      else if (/\bC3\b/.test(coreHaystack) || (year && year >= 1968 && year <= 1982)) series = "Stingray";
      else if (/\bC1\b/.test(coreHaystack) || (year && year >= 1953 && year <= 1962)) series = "C1 Corvette";
      else series = "Corvette Base";
    } else if (/\bBLAZER\b|\bJIMMY\b/.test(coreHaystack)) {
      if (/\bK\/?5\b|\bK5\b/.test(fullHaystack) || (year && year >= 1969 && year <= 1991 && !/\bS[-\s]?10\b|\bS[-\s]?15\b/.test(coreHaystack))) {
        series = brand === "gmc" ? "K5 Jimmy (Full-Size)" : "K5 Blazer (Full-Size)";
      } else if (/\bS[-\s]?10\b|\bS[-\s]?15\b/.test(coreHaystack)) {
        series = "S-10 / S-15 Compact";
      } else if (/\bTAHOE\b/.test(coreHaystack)) {
        series = "Tahoe / K1500 Blazer";
      }
    } else if (/\bCAMARO\b/.test(coreHaystack)) {
      if (/\bCOPO\b|\bYENKO\b|\bBALDWIN\b|\bZL[-\s]?1\b/.test(coreHaystack)) series = "COPO / ZL1";
      else if (/\bZ\/?28\b/.test(coreHaystack)) series = "Camaro Z/28";
      else if (/\bIROC[-\s]?Z\b/.test(coreHaystack)) series = "Camaro IROC-Z";
      else if (/\bRS\/SS\b|\bSS\/RS\b/.test(coreHaystack)) series = "Camaro RS/SS";
      else if (/\bSS\b|\bSUPER\s+SPORT\b/.test(coreHaystack)) series = "Camaro SS";
      else if (/\bRS\b|\bRALLY\s+SPORT\b/.test(coreHaystack)) series = "Camaro RS";
      else if (/\bBERLINETTA\b/.test(coreHaystack)) series = "Berlinetta";
    } else if (/\bCHEVELLE\b|\bMALIBU\b/.test(coreHaystack)) {
      if (/\bSS\s*454\b|\bLS6\b|\bLS5\b/.test(fullHaystack)) series = "SS 454";
      else if (/\bSS\s*396\b|\bL78\b|\bL89\b/.test(fullHaystack)) series = "SS 396";
      else if (/\bMALIBU\s+SS\b|\bCHEVELLE\s+SS\b|\bSUPER\s+SPORT\b|\bCHEVELLE\b.*\bSS\b/.test(coreHaystack)) series = "Chevelle SS";
      else if (/\bLAGUNA\b/.test(coreHaystack)) series = "Laguna S-3";
      else if (/\bMALIBU\b/.test(coreHaystack)) series = "Malibu";
      else if (/\b300\s+DELUXE\b|\b300\b/.test(coreHaystack)) series = "Chevelle 300";
    } else if (/\bBEL\s+AIR\b|\bNOMAD\b|\b210\b|\bTWO[-\s]?TEN\b|\b150\b|\bONE[-\s]?FIFTY\b/.test(coreHaystack)) {
      if (/\bNOMAD\b/.test(coreHaystack)) series = "Nomad Sport Wagon";
      else if (/\bBEL\s+AIR\b/.test(coreHaystack)) series = "Bel Air (2400 Series)";
      else if (/\b210\b|\bTWO[-\s]?TEN\b/.test(coreHaystack)) series = "210 (2100 Series)";
      else if (/\b150\b|\bONE[-\s]?FIFTY\b/.test(coreHaystack)) series = "150 (1500 Series)";
    } else {
      if (/\bC[-\s]?10\b/.test(coreHaystack)) series = "C10 (1/2-Ton 2WD)";
      else if (/\bK[-\s]?10\b/.test(coreHaystack)) series = "K10 (1/2-Ton 4x4)";
      else if (/\bC[-\s]?20\b/.test(coreHaystack)) series = "C20 (3/4-Ton 2WD)";
      else if (/\bK[-\s]?20\b/.test(coreHaystack)) series = "K20 (3/4-Ton 4x4)";
      else if (/\bC[-\s]?30\b/.test(coreHaystack)) series = "C30 (1-Ton 2WD)";
      else if (/\bK[-\s]?30\b/.test(coreHaystack)) series = "K30 (1-Ton 4x4)";
      else if (/\bR[-\s]?10\b|\bR[-\s]?1500\b/.test(coreHaystack)) series = "R10 (1/2-Ton 2WD)";
      else if (/\bV[-\s]?10\b|\bV[-\s]?1500\b|\bV[-\s]?2500\b/.test(coreHaystack)) series = "V10 (1/2-Ton 4x4)";
      else if (/\b3100\b/.test(coreHaystack)) series = "3100 (1/2-Ton)";
      else if (/\b3600\b/.test(coreHaystack)) series = "3600 (3/4-Ton)";
      else if (/\b3800\b/.test(coreHaystack)) series = "3800 (1-Ton)";
      else if (/\bAPACHE\b/.test(coreHaystack)) series = "Apache";
      else if (/\bCAMEO\b/.test(coreHaystack)) series = "Cameo Carrier";
      else if (/\bK[-\s]?1500\b/.test(coreHaystack)) series = "K1500 (1/2-Ton 4x4)";
      else if (/\bC[-\s]?1500\b|\b1500\b/.test(coreHaystack)) series = "1500 (1/2-Ton)";
      else if (/\bK[-\s]?2500\b|\bC[-\s]?2500\b|\b2500\s*(?:HD)?\b/.test(coreHaystack)) series = "2500 (3/4-Ton)";
      else if (/\bK[-\s]?3500\b|\bC[-\s]?3500\b|\b3500\s*(?:HD)?\b/.test(coreHaystack)) series = "3500 (1-Ton)";
      else if (/\bSYCLONE\b/.test(coreHaystack)) series = "Syclone";
      else if (/\bTYPHOON\b/.test(coreHaystack)) series = "Typhoon";
    }
  }

  if (!series && brand === "ford") {
    if (/\bBRONCO\b/.test(coreHaystack)) {
      if (/\bRAPTOR\b/.test(coreHaystack)) series = "Bronco Raptor";
      else if (/\bSTROPPE\b|\bBAJA\b/.test(fullHaystack)) series = "Bill Stroppe Baja";
      else if (/\bU13\b|\bROADSTER\b/.test(fullHaystack) && year && year <= 1968) series = "U13 Roadster";
      else if (/\bU14\b|\bHALF[-\s]?CAB\b|\bSPORTS\s+UTILITY\b/.test(fullHaystack) && year && year <= 1977) series = "U14 Half-Cab Pickup";
      else if ((/\bU15\b|\bWAGON\b/.test(fullHaystack) || (year && year >= 1966 && year <= 1977)) && year && year <= 1977) series = "U15 Wagon";
      else if (/\bFIRST\s+EDITION\b/.test(coreHaystack)) series = "First Edition";
      else if (/\bWILDTRAK\b/.test(coreHaystack)) series = "Wildtrak";
      else if (/\bBADLANDS\b/.test(coreHaystack)) series = "Badlands";
      else if (/\bHERITAGE\b/.test(coreHaystack)) series = "Heritage Edition";
      else if (/\bEVERGLADES\b/.test(coreHaystack)) series = "Everglades";
      else if (/\bOUTER\s+BANKS\b/.test(coreHaystack)) series = "Outer Banks";
      else if (/\bBLACK\s+DIAMOND\b/.test(coreHaystack)) series = "Black Diamond";
      else if (/\bBIG\s+BEND\b/.test(coreHaystack)) series = "Big Bend";
      else if (/\bEDDIE\s+BAUER\b/.test(coreHaystack)) series = "Eddie Bauer";
      else if (/\bXLT\b/.test(coreHaystack)) series = "Bronco XLT";
      else if (year && year >= 1978 && year <= 1996) series = "Full-Size Bronco";
      else if (year && year >= 2021) series = "6th-Gen Bronco (U725)";
    } else if (/\bMUSTANG\b|\bSHELBY\s+GT(?:350|500)\b/.test(coreHaystack)) {
      if (/\bSHELBY\s+GT500KR\b/.test(coreHaystack)) series = "Shelby GT500KR";
      else if (/\bSHELBY\s+GT500\b|\bGT500\b/.test(coreHaystack)) series = "Shelby GT500";
      else if (/\bSHELBY\s+GT350R\b|\bGT350R\b/.test(coreHaystack)) series = "Shelby GT350R";
      else if (/\bSHELBY\s+GT350\b|\bGT350\b/.test(coreHaystack)) series = "Shelby GT350";
      else if (/\bBOSS\s+429\b/.test(coreHaystack)) series = "Boss 429";
      else if (/\bBOSS\s+302\b/.test(coreHaystack)) series = "Boss 302";
      else if (/\bBOSS\s+351\b/.test(coreHaystack)) series = "Boss 351";
      else if (/\bMACH\s+1\b|\bMACH\s+E\b/.test(coreHaystack)) {
        series = /\bMACH[-\s]?E\b/.test(coreHaystack) ? "Mustang Mach-E" : "Mach 1";
      } else if (/\bSVT\s+COBRA\s+R\b|\bCOBRA\s+R\b/.test(coreHaystack)) series = "SVT Cobra R";
      else if (/\bSVT\s+COBRA\b|\bCOBRA\b|\bTERMINATOR\b/.test(coreHaystack)) series = "SVT Cobra";
      else if (/\bBULLITT\b/.test(coreHaystack)) series = "Bullitt";
      else if (/\bDARK\s+HORSE\b/.test(coreHaystack)) series = "Dark Horse";
      else if (/\bSALEEN\b/.test(coreHaystack)) series = "Saleen Mustang";
      else if (/\bROUSH\b/.test(coreHaystack)) series = "Roush Mustang";
      else if (/\bMUSTANG\s+GT\b|\bGT\s+(?:COUPE|FASTBACK|CONVERTIBLE|PREMIUM|CALIFORNIA)\b|\bGT\b/.test(coreHaystack)) series = "Mustang GT";
      else series = "Mustang Standard";
    } else if (/\bF[-\s]?100\b/.test(coreHaystack)) series = "F-100 (1/2-Ton)";
    else if (/\bF[-\s]?150\b/.test(coreHaystack)) series = "F-150 (1/2-Ton)";
    else if (/\bF[-\s]?250\b/.test(coreHaystack)) series = "F-250 (3/4-Ton)";
    else if (/\bF[-\s]?350\b/.test(coreHaystack)) series = "F-350 (1-Ton)";
    else if (/\bF[-\s]?450\b/.test(coreHaystack)) series = "F-450 Super Duty";
    else if (/\bF[-\s]?1\b/.test(coreHaystack)) series = "F-1 (1/2-Ton)";
  }

  if (!series && brand === "porsche") {
    if (/\b911\b|\b930\b|\b964\b|\b993\b|\b996\b|\b997\b|\b991\b|\b992\b|\bCARRERA\b|\bTARGA\b|\bGT3\b|\bGT2\b/.test(coreHaystack) && !/\bCAYENNE\b|\bMACAN\b|\bPANAMERA\b|\bTAYCAN\b|\bBOXSTER\b|\bCAYMAN\b|\b944\b|\b928\b|\b968\b|\b914\b|\b912\b|\b356\b|\bCARRERA\s+GT\b/.test(coreHaystack)) {
      if (/\bGT3\s+RS\b/.test(coreHaystack)) series = "GT3 RS";
      else if (/\bGT3\s+TOURING\b|\bGT3\b/.test(coreHaystack)) series = "GT3";
      else if (/\bGT2\s+RS\b|\bGT2\b/.test(coreHaystack)) series = "GT2 / GT2 RS";
      else if (/\b911\s+(?:R|S\/T|DAKAR|SPORT\s+CLASSIC|SPEEDSTER)\b/.test(coreHaystack)) series = "911 Special Wishes / Heritage";
      else if (/\bTURBO\s+S\b|\bTURBO\b|\b930\b/.test(coreHaystack)) series = "911 Turbo";
      else if (/\bCARRERA\s+RS\b|\bRS\s+AMERICA\b/.test(coreHaystack)) series = "Carrera RS";
      else if (/\bCARRERA\s+4\s+GTS\b|\bCARRERA\s+GTS\b|\bTARGA\s+4\s+GTS\b|\bGTS\b/.test(coreHaystack)) series = "Carrera GTS";
      else if (/\bCARRERA\s+4S\b|\bTARGA\s+4S\b|\bC4S\b/.test(coreHaystack)) series = "Carrera 4S";
      else if (/\bCARRERA\s+S\b|\bC2S\b/.test(coreHaystack)) series = "Carrera S";
      else if (/\bCARRERA\s+4\b|\bTARGA\s+4\b|\bC4\b/.test(coreHaystack)) series = "Carrera 4";
      else if (/\bCARRERA\s+T\b/.test(coreHaystack)) series = "Carrera T";
      else if (/\bCARRERA\b/.test(coreHaystack)) series = "911 Carrera";
      else if (/\b911\s*SC\b|\bSC\b/.test(coreHaystack) && (!year || (year >= 1978 && year <= 1983))) series = "911 SC";
      else if (/\b911\s*S\b/.test(coreHaystack)) series = "911S";
      else if (/\b911\s*E\b/.test(coreHaystack)) series = "911E";
      else if (/\b911\s*T\b/.test(coreHaystack)) series = "911T";
      else if (/\bTARGA\b/.test(coreHaystack)) series = "911 Targa";
      else series = "911 Carrera";
    } else if (/\b356\b/.test(coreHaystack)) {
      if (/\b356\s*C\b|\b356\s*SC\b/.test(coreHaystack) || (year && year >= 1964 && year <= 1965)) series = "356C / 356SC";
      else if (/\b356\s*B\b/.test(coreHaystack) || (year && year >= 1960 && year <= 1963)) series = "356B (T5 / T6)";
      else if (/\b356\s*A\b/.test(coreHaystack) || (year && year >= 1956 && year <= 1959)) series = "356A (T1 / T2)";
      else if (/\bPRE[-\s]?A\b/.test(coreHaystack) || (year && year <= 1955)) series = "356 Pre-A";
    } else if (/\bBOXSTER\b|\bCAYMAN\b|\b718\b/.test(coreHaystack)) {
      if (/\bGT4\s+RS\b/.test(coreHaystack)) series = "718 Cayman GT4 RS";
      else if (/\bGT4\b/.test(coreHaystack)) series = "Cayman GT4";
      else if (/\bSPYDER\s+RS\b|\bSPYDER\b/.test(coreHaystack)) series = "Boxster Spyder";
      else if (/\b718\b|\b982\b/.test(coreHaystack) || (year && year >= 2017)) series = "718 (982)";
      else if (/\b981\b/.test(coreHaystack) || (year && year >= 2013 && year <= 2016)) series = "981 Series";
      else if (/\b987\b/.test(coreHaystack) || (year && year >= 2005 && year <= 2012)) series = "987 Series";
      else if (/\b986\b/.test(coreHaystack) || (year && year >= 1997 && year <= 2004)) series = "986 Series";
    } else if (/\bCAYENNE\b/.test(coreHaystack)) {
      if (/\b955\b|\b957\b/.test(coreHaystack) || (year && year >= 2003 && year <= 2010)) series = "955 / 957 (1st Gen)";
      else if (/\b958\b/.test(coreHaystack) || (year && year >= 2011 && year <= 2018)) series = "958 (2nd Gen)";
      else if (/\b9Y0\b/.test(coreHaystack) || (year && year >= 2019)) series = "9Y0 (3rd Gen)";
    } else if (/\bMACAN\b/.test(coreHaystack)) series = "95B Macan";
    else if (/\bPANAMERA\b/.test(coreHaystack)) series = year && year <= 2016 ? "970 Panamera" : "971 Panamera";
    else if (/\bTAYCAN\b/.test(coreHaystack)) series = "J1 Taycan";
  }

  if (!series && brand === "bmw") {
    if (/\b2002\s*TURBO\b/.test(coreHaystack)) series = "2002 Turbo";
    else if (/\b2002\s*TII\b/.test(coreHaystack)) series = "2002tii";
    else if (/\b2002\b|\b1600\b/.test(coreHaystack)) series = "2002";
    else if (/\bM3\b/.test(coreHaystack)) {
      if (/\bE30\b/.test(fullHaystack) || (year && year >= 1986 && year <= 1991)) series = "E30 M3";
      else if (/\bE36\b/.test(fullHaystack) || (year && year >= 1992 && year <= 1999)) series = "E36 M3";
      else if (/\bE46\b/.test(fullHaystack) || (year && year >= 2000 && year <= 2006)) series = "E46 M3";
      else if (/\bE9[023X]\b/.test(fullHaystack) || (year && year >= 2007 && year <= 2013)) series = "E90/E92/E93 M3";
      else if (/\bF80\b/.test(fullHaystack) || (year && year >= 2014 && year <= 2018)) series = "F80 M3";
      else if (/\bG80\b/.test(fullHaystack) || (year && year >= 2021)) series = "G80 M3";
    } else if (/\bM5\b/.test(coreHaystack)) {
      if (/\bE28\b/.test(fullHaystack) || (year && year >= 1985 && year <= 1988)) series = "E28 M5";
      else if (/\bE34\b/.test(fullHaystack) || (year && year >= 1989 && year <= 1995)) series = "E34 M5";
      else if (/\bE39\b/.test(fullHaystack) || (year && year >= 1998 && year <= 2003)) series = "E39 M5";
      else if (/\bE60\b/.test(fullHaystack) || (year && year >= 2005 && year <= 2010)) series = "E60 M5";
      else if (/\bF10\b/.test(fullHaystack) || (year && year >= 2011 && year <= 2016)) series = "F10 M5";
      else if (/\bF90\b/.test(fullHaystack) || (year && year >= 2018 && year <= 2023)) series = "F90 M5";
      else if (/\bG90\b/.test(fullHaystack) || (year && year >= 2024)) series = "G90 M5";
      else series = "M5 Heritage";
    } else if (/\bM2\b/.test(coreHaystack) && !/\bM235I\b|\bM240I\b/.test(coreHaystack)) {
      series = year && year >= 2023 ? "G87 M2" : "F87 M2";
    } else if (/\bM4\b/.test(coreHaystack) && !/\bM440I\b/.test(coreHaystack)) {
      series = year && year >= 2021 ? "G82/G83 M4" : "F82/F83 M4";
    } else if (/\bM6\b/.test(coreHaystack)) {
      if (year && year <= 1989) series = "E24 M6";
      else if (year && year >= 2005 && year <= 2010) series = "E63/E64 M6";
      else series = "F06/F12/F13 M6";
    } else if (/\b1\s*SERIES\s*M\b|\b1M\b/.test(coreHaystack)) series = "E82 1M";
    else if (/\bZ3\b|\bM\s+ROADSTER\b|\bM\s+COUPE\b/.test(coreHaystack) && (!year || year <= 2002)) {
      series = /\bCOUPE\b/.test(coreHaystack) ? "E36/8 Z3 Coupe" : "E36/7 Z3 Roadster";
    } else if (/\bZ4\b/.test(coreHaystack)) {
      if (year && year <= 2008) series = "E85/E86 Z4";
      else if (year && year <= 2016) series = "E89 Z4";
      else series = "G29 Z4";
    } else if (/\bZ8\b/.test(coreHaystack)) series = "E52 Z8";
    else if (/\b8[45]0[A-Z]*\b|\bM8\b/.test(coreHaystack)) series = year && year <= 1999 ? "E31 8-Series" : "G15 8-Series";
    else if (/\b[3]\d{2}[A-Z]*\b/.test(coreHaystack)) {
      if (year && year <= 1983) series = "E21 3-Series";
      else if (year && year <= 1991) series = "E30 3-Series";
      else if (year && year <= 1999) series = "E36 3-Series";
      else if (year && year <= 2006) series = "E46 3-Series";
      else if (year && year <= 2013) series = "E90/E92 3-Series";
      else if (year && year <= 2018) series = "F30 3-Series";
      else series = "G20 3-Series";
    } else if (/\b[5]\d{2}[A-Z]*\b/.test(coreHaystack)) {
      if (year && year <= 1988) series = "E28 5-Series";
      else if (year && year <= 1995) series = "E34 5-Series";
      else if (year && year <= 2003) series = "E39 5-Series";
      else if (year && year <= 2010) series = "E60 5-Series";
      else if (year && year <= 2016) series = "F10 5-Series";
      else series = "G30 5-Series";
    } else if (/\b[7]\d{2}[A-Z]*\b/.test(coreHaystack)) {
      if (year && year <= 1994) series = "E32 7-Series";
      else if (year && year <= 2001) series = "E38 7-Series";
      else if (year && year <= 2008) series = "E65/E66 7-Series";
      else series = "7-Series";
    }
  }

  if (!series && brand === "toyota") {
    if (/\bLAND\s+CRUISER\b|\bFJ4\d\b|\bFJ55\b|\bFJ6\d\b|\bFJ80\b|\bFZJ80\b|\bUZJ100\b|\bURJ200\b|\bHDJ8\d\b|\bHZJ7\d\b|\bKZJ\d+\b|\bBJ4\d\b|\bBJ7\d\b/.test(coreHaystack)) {
      if (/\bFJ45\b|\bHJ45\b|\bHJ47\b|\bTROOPY\b/.test(fullHaystack)) series = "FJ45 / HJ47 Pickup & Troopy";
      else if (/\bFJ43\b|\bBJ42\b|\bBJ43\b|\bBJ44\b|\bBJ46\b/.test(fullHaystack)) series = "FJ43 / BJ42 Mid-Wheelbase";
      else if (/\bFJ40\b|\bBJ40\b|\bJ40\b/.test(fullHaystack) || (year && year >= 1960 && year <= 1984 && !/\bFJ55\b|\bFJ60\b|\bFJ62\b/.test(fullHaystack))) series = "FJ40 / BJ40 (J40)";
      else if (/\bFJ55\b/.test(fullHaystack)) series = "FJ55 Iron Pig";
      else if (/\bFJ60\b|\bFJ62\b|\bHJ60\b|\bHJ61\b/.test(fullHaystack) || (year && year >= 1981 && year <= 1990 && !/\b70\b|\bBJ7\b|\bHZJ7\b|\bLJ7\b/.test(fullHaystack))) series = "FJ60 / FJ62 (J60 Wagon)";
      else if (/\b[A-Z]{2,3}7\d\b|\b70[-\s]?SERIES\b|\bPRADO\b.*\b7[18]\b/.test(fullHaystack)) series = "J70 Series";
      else if (/\bFJ80\b|\bFZJ80\b|\bHDJ80\b|\bHDJ81\b|\bHZJ80\b|\b80[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 1991 && year <= 1997 && !/\bPRADO\b|\bKZJ9\b/.test(fullHaystack))) series = "FZJ80 / FJ80 (J80)";
      else if (/\bKZJ9\d\b|\bKDJ9\d\b|\b90[-\s]?SERIES\b/.test(fullHaystack)) series = "J90 Prado";
      else if (/\bUZJ100\b|\bHDJ100\b|\b100[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 1998 && year <= 2007)) series = "UZJ100 (100-Series)";
      else if (/\bURJ200\b|\bVDJ200\b|\b200[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 2008 && year <= 2021)) series = "URJ200 (200-Series)";
      else if (/\bJ250\b|\b250[-\s]?SERIES\b/.test(fullHaystack) || (year && year >= 2024)) series = "J250 (250-Series)";
    } else if (/\bSUPRA\b/.test(coreHaystack)) {
      if (/\bA80\b|\bMK4\b|\bMKIV\b|\b2JZ\b/.test(fullHaystack) || (year && year >= 1993 && year <= 2002)) series = "A80 Supra (MkIV)";
      else if (/\bA70\b|\bMK3\b|\bMKIII\b/.test(fullHaystack) || (year && year >= 1986 && year <= 1992)) series = "A70 Supra (MkIII)";
      else if (/\bA60\b|\bMK2\b/.test(fullHaystack) || (year && year <= 1985)) series = "A60 Celica Supra (MkII)";
      else if (/\bA90\b|\bA91\b|\bGR\s+SUPRA\b/.test(fullHaystack) || (year && year >= 2020)) series = "A90 GR Supra (MkV)";
    } else if (/\b4RUNNER\b|\bHILUX\s+SURF\b/.test(coreHaystack)) {
      if (year && year <= 1989) series = "N60 (1st Gen)";
      else if (year && year <= 1995) series = "N120/N130 (2nd Gen)";
      else if (year && year <= 2002) series = "N180 (3rd Gen)";
      else if (year && year <= 2009) series = "N210 (4th Gen)";
      else if (year && year >= 2010) series = "N280 (5th Gen)";
    } else if (/\bTACOMA\b/.test(coreHaystack)) {
      if (year && year <= 2004) series = "1st-Gen Tacoma (N140)";
      else if (year && year <= 2015) series = "2nd-Gen Tacoma (N220)";
      else if (year && year <= 2023) series = "3rd-Gen Tacoma (N300)";
      else series = "4th-Gen Tacoma (N400)";
    } else if (/\bFJ\s+CRUISER\b/.test(coreHaystack)) {
      series = "GSJ15 (FJ Cruiser)";
    } else if (/\bMR2\b/.test(coreHaystack)) {
      if (year && year <= 1989) series = "AW11 MR2";
      else if (year && year <= 1999) series = "SW20 MR2";
      else series = "ZZW30 MR2 Spyder";
    }
  }

  if (!series && (brand === "mercedes-benz" || brand === "mercedes")) {
    if (/\b300\s*SL\b|\bW198\b/.test(coreHaystack) && year && year <= 1963) series = "300SL (W198)";
    else if (/\b190\s*SL\b|\bW121\b/.test(coreHaystack)) series = "190SL (W121)";
    else if (/\b230\s*SL\b|\b250\s*SL\b|\b280\s*SL\b|\bW113\b|\bPAGODA\b/.test(coreHaystack) && (!year || year <= 1971)) series = "Pagoda (W113)";
    else if (/\b(?:280|350|380|450|500|560)\s*SL\b|\bR107\b/.test(coreHaystack) && (!year || (year >= 1971 && year <= 1989))) series = "R107 SL (380/450/560SL)";
    else if (/\b(?:300|320|500|600)\s*SL\b|\bSL\s*(?:320|500|600|55|60|70|73)\b|\bR129\b/.test(coreHaystack) && year && year >= 1990 && year <= 2002) series = "R129 SL";
    else if (/\bSL\s*(?:500|550|600|55|63|65)\b|\bR230\b/.test(coreHaystack) && year && year >= 2003 && year <= 2012) series = "R230 SL";
    else if (/\bSL\s*(?:400|450|550|63|65)\b|\bR231\b/.test(coreHaystack) && year && year >= 2013 && year <= 2020) series = "R231 SL";
    else if (/\bG\s*(?:500|550|55|63|65|300|320|350)\b|\b280\s*GE\b|\b300\s*GD\b|\b230\s*GE\b|\bG[-\s]?WAGEN\b|\bG[-\s]?CLASS\b|\bW46[013]\b/.test(coreHaystack)) {
      series = year && year <= 1990 ? "W460 G-Wagen" : "W463 G-Class";
    } else if (/\bE\s*(?:55|63|500|420|430|320|350|300|400)\b|\b500\s*E\b|\bW124\b|\bW210\b|\bW211\b|\bW212\b|\bW213\b/.test(coreHaystack)) {
      if (year && year <= 1995) series = "W124 E-Class";
      else if (year && year <= 2002) series = "W210 E-Class";
      else if (year && year <= 2009) series = "W211 E-Class";
      else if (year && year <= 2016) series = "W212 E-Class";
      else series = "W213 E-Class";
    } else if (/\bC\s*(?:32|36|43|55|63)\b|\b190\s*E\b/.test(coreHaystack)) {
      if (/\b190\s*E\b/.test(coreHaystack)) series = "W201 190E";
      else if (year && year <= 2000) series = "W202 C-Class AMG";
      else if (year && year <= 2007) series = "W203 C-Class AMG";
      else if (year && year <= 2014) series = "W204 C63 AMG";
      else series = "W205 C63 AMG";
    } else if (/\bAMG\s+GT\b|\bSLS\s+AMG\b/.test(coreHaystack)) {
      series = /\bSLS\b/.test(coreHaystack) ? "C197 SLS AMG" : "C190 AMG GT";
    }
  }

  if (!series && (brand === "dodge" || brand === "plymouth" || brand === "ram")) {
    if (/\bWM[-\s]?300\b/.test(coreHaystack)) series = "Power Wagon WM300";
    else if (/\bPOWER\s+WAGON\b|\bW[-\s]?100\b|\bW[-\s]?150\b|\bW[-\s]?200\b|\bW[-\s]?250\b|\bW[-\s]?300\b/.test(coreHaystack)) series = "Power Wagon (4x4)";
    else if (/\bD[-\s]?100\b|\bD[-\s]?150\b/.test(coreHaystack)) series = "D100 / D150 (1/2-Ton 2WD)";
    else if (/\bD[-\s]?200\b|\bD[-\s]?250\b/.test(coreHaystack)) series = "D200 / D250 (3/4-Ton 2WD)";
    else if (/\bDEMON\b/.test(coreHaystack)) series = "SRT Demon";
    else if (/\bHELLCAT\b/.test(coreHaystack)) series = "SRT Hellcat";
    else if (/\bVIPER\b/.test(coreHaystack)) series = "SRT-10 / Viper";
    else if (/\bTRX\b/.test(coreHaystack)) series = "1500 TRX";
    else if (/\bR\/T\b/.test(coreHaystack)) series = "R/T (Road/Track)";
  }

  if (!series && brand === "pontiac") {
    if (/\bTHE\s+JUDGE\b|\bGTO\s+JUDGE\b/.test(fullHaystack)) series = "GTO The Judge";
    else if (/\bGTO\b/.test(coreHaystack)) series = "GTO";
    else if (/\bSUPER\s+DUTY\b|\bSD[-\s]?455\b/.test(fullHaystack)) series = "Trans Am SD-455";
    else if (/\bTRANS\s+AM\b/.test(coreHaystack)) series = "Firebird Trans Am";
    else if (/\bFORMULA\b/.test(coreHaystack)) series = "Firebird Formula";
  }

  if (!series && brand === "jaguar") {
    if (/\bE[-\s]?TYPE\b|\bXKE\b/.test(coreHaystack)) {
      if (/\bSERIES\s*(?:3|III)\b|\bV12\b/.test(fullHaystack) || (year && year >= 1971)) series = "E-Type Series 3 V12";
      else if (/\bSERIES\s*(?:2|II)\b/.test(fullHaystack) || (year && year >= 1969 && year <= 1970)) series = "E-Type Series 2";
      else series = "E-Type Series 1";
    } else if (/\bXK\s*120\b/.test(coreHaystack)) series = "XK120";
    else if (/\bXK\s*140\b/.test(coreHaystack)) series = "XK140";
    else if (/\bXK\s*150\b/.test(coreHaystack)) series = "XK150";
    else if (/\bF[-\s]?TYPE\b/.test(coreHaystack)) series = "X152 F-Type";
  }

  if (!series && (brand === "honda" || brand === "acura")) {
    if (/\bS2000\b/.test(coreHaystack)) series = year && year >= 2004 ? "AP2 S2000" : "AP1 S2000";
    else if (/\bNSX\b/.test(coreHaystack)) series = year && year >= 2017 ? "NC1 NSX" : "NA1/NA2 NSX";
    else if (/\bCIVIC\s+TYPE\s+R\b|\bINTEGRA\s+TYPE\s+R\b/.test(coreHaystack)) series = "Type R";
  }

  if (!series && brand === "mazda") {
    if (/\bMIATA\b|\bMX[-\s]?5\b/.test(coreHaystack)) {
      if (/\bNA\b/.test(coreHaystack) || (year && year <= 1997)) series = "NA Miata";
      else if (/\bNB\b/.test(coreHaystack) || (year && year >= 1998 && year <= 2005)) series = "NB Miata";
      else if (/\bNC\b/.test(coreHaystack) || (year && year >= 2006 && year <= 2015)) series = "NC Miata";
      else if (/\bND\b/.test(coreHaystack) || (year && year >= 2016)) series = "ND Miata";
    } else if (/\bRX[-\s]?7\b/.test(coreHaystack)) {
      if (/\bFD\b|\bFD3S\b/.test(fullHaystack) || (year && year >= 1992)) series = "FD3S RX-7";
      else if (/\bFC\b|\bFC3S\b/.test(fullHaystack) || (year && year >= 1986 && year <= 1991)) series = "FC3S RX-7";
      else series = "FB / SA22C RX-7";
    }
  }

  if (!series && brand === "lexus") {
    if (/\bLX\s*450\b/.test(coreHaystack)) series = "FZJ80 (LX 450)";
    else if (/\bLX\s*470\b/.test(coreHaystack)) series = "UZJ100 (LX 470)";
    else if (/\bLX\s*570\b/.test(coreHaystack)) series = "URJ200 (LX 570)";
    else if (/\bLX\s*600\b/.test(coreHaystack)) series = "VJA310 (LX 600)";
    else if (/\bGX\s*470\b/.test(coreHaystack)) series = "UZJ120 (GX 470)";
    else if (/\bGX\s*460\b/.test(coreHaystack)) series = "URJ150 (GX 460)";
    else if (/\bGX\s*550\b/.test(coreHaystack)) series = "J250 (GX 550)";
    else if (/\bLS\s*400\b/.test(coreHaystack)) series = "UCF10/UCF20 (LS 400)";
    else if (/\bLS\s*430\b/.test(coreHaystack)) series = "UCF30 (LS 430)";
    else if (/\bLS\s*460\b/.test(coreHaystack)) series = "USF40 (LS 460)";
    else if (/\bIS\s*300\b/.test(coreHaystack) && year && year <= 2005) series = "XE10 (IS 300)";
    else if (/\bIS\s*F\b/.test(coreHaystack)) series = "USE20 (IS F)";
    else if (/\bLC\s*500\b/.test(coreHaystack)) series = "URZ100 (LC 500)";
  }

  if (!series && brand === "jeep") {
    if (/\bWRANGLER\b/.test(coreHaystack)) {
      if (/\bYJ\b/.test(fullHaystack) || (year && year >= 1987 && year <= 1995)) series = "YJ Wrangler";
      else if (/\bTJ\b|\bLJ\b/.test(fullHaystack) || (year && year >= 1997 && year <= 2006)) series = "TJ Wrangler";
      else if (/\bJK\b|\bJKU\b/.test(fullHaystack) || (year && year >= 2007 && year <= 2018)) series = "JK Wrangler";
      else if (/\bJL\b|\bJLU\b/.test(fullHaystack) || (year && year >= 2018)) series = "JL Wrangler";
    } else if (/\bCHEROKEE\b/.test(coreHaystack) && !/\bGRAND\s+CHEROKEE\b/.test(coreHaystack) && year && year <= 2001) {
      series = "XJ Cherokee";
    } else if (/\bGRAND\s+WAGONEER\b|\bWAGONEER\b/.test(coreHaystack) && year && year <= 1991) {
      series = "SJ Grand Wagoneer";
    }
  }

  if (!series && brand === "land rover") {
    if (/\bDEFENDER\s*90\b|\bNAS\b.*\b90\b|\bD90\b/.test(fullHaystack)) series = "Defender 90";
    else if (/\bDEFENDER\s*110\b|\bD110\b|\b110\b/.test(coreHaystack)) series = "Defender 110";
    else if (/\bDEFENDER\s*130\b|\bD130\b/.test(coreHaystack)) series = "Defender 130";
    else if (/\bRANGE\s+ROVER\s+CLASSIC\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && year && year <= 1995)) series = "Range Rover Classic";
    else if (/\bP38\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && !/\bSPORT\b/.test(coreHaystack) && year && year >= 1996 && year <= 2002)) series = "P38A Range Rover";
    else if (/\bL322\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && !/\bSPORT\b/.test(coreHaystack) && year && year >= 2003 && year <= 2012)) series = "L322 Range Rover";
    else if (/\bL405\b/.test(fullHaystack) || (/\bRANGE\s+ROVER\b/.test(coreHaystack) && !/\bSPORT\b|\bVELAR\b|\bEVOQUE\b/.test(coreHaystack) && year && year >= 2013 && year <= 2021)) series = "L405 Range Rover";
  }

  if (!series && brand === "audi") {
    if (/\bRS\s*6\b|\bRS6\b/.test(coreHaystack)) series = "RS6 Avant";
    else if (/\bRS\s*4\b|\bRS4\b/.test(coreHaystack)) series = "B7 RS4";
    else if (/\bRS\s*3\b|\bRS3\b/.test(coreHaystack)) series = "8V/8Y RS3";
    else if (/\bRS\s*5\b|\bRS5\b/.test(coreHaystack)) series = "RS5";
    else if (/\bRS\s*7\b|\bRS7\b/.test(coreHaystack)) series = "RS7";
    else if (/\bR8\b/.test(coreHaystack)) series = /\bV10\b/.test(fullHaystack) ? "R8 V10" : "R8 V8";
    else if (/\bS4\b/.test(coreHaystack)) {
      if (year && year <= 2002) series = "B5 S4";
      else if (year && year <= 2008) series = "B6/B7 S4";
      else if (year && year <= 2016) series = "B8/B8.5 S4";
      else series = "B9 S4";
    }
  }

  if (!series && brand === "subaru") {
    if (/\bWRX\s+STI\b|\bSTI\b/.test(coreHaystack)) series = "WRX STI";
    else if (/\bWRX\b/.test(coreHaystack)) series = "WRX";
  }

  if (!series && (brand === "nissan" || brand === "datsun")) {
    if (/\bSKYLINE\b|\bGT[-\s]?R\b/.test(coreHaystack)) {
      if (/\bR32\b/.test(fullHaystack) || (year && year >= 1989 && year <= 1994)) series = "R32 Skyline / GT-R";
      else if (/\bR33\b/.test(fullHaystack) || (year && year >= 1995 && year <= 1998)) series = "R33 Skyline / GT-R";
      else if (/\bR34\b/.test(fullHaystack) || (year && year >= 1999 && year <= 2002)) series = "R34 Skyline / GT-R";
      else if (/\bR35\b/.test(fullHaystack) || (year && year >= 2009)) series = "R35 GT-R";
    } else if (/\b240Z\b|\b260Z\b|\b280Z\b|\b280ZX\b|\b300ZX\b/.test(coreHaystack)) {
      if (/\b240Z\b/.test(coreHaystack)) series = "S30 240Z";
      else if (/\b260Z\b/.test(coreHaystack)) series = "S30 260Z";
      else if (/\b280ZX\b/.test(coreHaystack)) series = "S130 280ZX";
      else if (/\b280Z\b/.test(coreHaystack)) series = "S30 280Z";
      else if (/\b300ZX\b/.test(coreHaystack)) series = year && year >= 1990 ? "Z32 300ZX" : "Z31 300ZX";
    }
  }

  if (!series && brand === "rivian") {
    if (/\bR1S\b/.test(coreHaystack)) series = "R1S";
    else if (/\bR1T\b/.test(coreHaystack)) series = "R1T";
  }

  if (!series && brand === "tesla") {
    if (/\bMODEL\s+S\b/.test(coreHaystack)) series = "Model S";
    else if (/\bMODEL\s+3\b/.test(coreHaystack)) series = "Model 3";
    else if (/\bMODEL\s+X\b/.test(coreHaystack)) series = "Model X";
    else if (/\bMODEL\s+Y\b/.test(coreHaystack)) series = "Model Y";
    else if (/\bCYBERTRUCK\b/.test(coreHaystack)) series = "Cybertruck";
    else if (/\bROADSTER\b/.test(coreHaystack)) series = "Roadster";
  }

  // 2. TRIM EXTRACTION
  if (/\bCHEYENNE\s+SUPER\b/.test(fullHaystack)) trim = "Cheyenne Super";
  else if (/\bCHEYENNE\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc")) trim = "Cheyenne";
  else if (/\bSCOTTSDALE\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc")) trim = "Scottsdale";
  else if (/\bCUSTOM\s+DELUXE\b/.test(fullHaystack)) trim = "Custom Deluxe";
  else if (/\bSILVERADO\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc") && !/^SILVERADO$/i.test(rawModel)) trim = "Silverado";
  else if (/\bBIG\s+10\b/.test(fullHaystack)) trim = "Big 10";
  else if (/\b454\s+SS\b/.test(fullHaystack)) trim = "454 SS";
  else if (/\bCST\b|\bCUSTOM\s+SPORT\s+TRUCK\b/.test(fullHaystack)) trim = "CST (Custom Sport Truck)";
  else if (/\bSIERRA\s+CLASSIC\b/.test(fullHaystack)) trim = "Sierra Classic";
  else if (/\bSIERRA\s+GRANDE\b/.test(fullHaystack)) trim = "Sierra Grande";
  else if (/\bHIGH\s+SIERRA\b/.test(fullHaystack)) trim = "High Sierra";
  else if (/\bGENTLEMAN\s+JIM\b/.test(fullHaystack)) trim = "Gentleman Jim";
  else if (/\bDENALI\s+ULTIMATE\b|\bDENALI\b/.test(coreHaystack)) trim = "Denali";
  else if (/\bAT4X\b|\bAT4\b/.test(coreHaystack)) trim = /\bAT4X\b/.test(coreHaystack) ? "AT4X" : "AT4";
  else if (/\bZR2\b/.test(coreHaystack)) trim = "ZR2";
  else if (/\bZ71\b/.test(fullHaystack) && (brand === "chevrolet" || brand === "gmc")) trim = "Z71";
  else if (brand === "chevrolet" && /\bCORVETTE\b/.test(coreHaystack)) {
    if (/\bZR[-\s]?1\b/.test(coreHaystack)) trim = "ZR1";
    else if (/\bZ06\b/.test(coreHaystack)) trim = "Z06";
    else if (/\bGRAND\s+SPORT\b/.test(coreHaystack)) trim = "Grand Sport";
    else if (/\b3LT\b|\b3LZ\b/.test(fullHaystack)) trim = /\b3LZ\b/.test(fullHaystack) ? "3LZ" : "3LT";
    else if (/\b2LT\b|\b2LZ\b/.test(fullHaystack)) trim = /\b2LZ\b/.test(fullHaystack) ? "2LZ" : "2LT";
    else if (/\b1LT\b|\b1LZ\b/.test(fullHaystack)) trim = /\b1LZ\b/.test(fullHaystack) ? "1LZ" : "1LT";
    else if (/\bZ51\b/.test(fullHaystack)) trim = "Z51";
    else if (/\bSTINGRAY\b|\bSTING\s+RAY\b/.test(coreHaystack)) trim = "Stingray";
  } else if (brand === "porsche") {
    if (/\bWEISSACH\b/.test(fullHaystack)) trim = "Weissach Package";
    else if (/\bGT3\s+RS\b/.test(coreHaystack)) trim = "GT3 RS";
    else if (/\bGT3\s+TOURING\b/.test(coreHaystack)) trim = "GT3 Touring";
    else if (/\bGT3\b/.test(coreHaystack)) trim = "GT3";
    else if (/\bGT2\s+RS\b/.test(coreHaystack)) trim = "GT2 RS";
    else if (/\bGT4\s+RS\b/.test(coreHaystack)) trim = "GT4 RS";
    else if (/\bGT4\b/.test(coreHaystack)) trim = "GT4";
    else if (/\bTURBO\s+S\s+E[-\s]?HYBRID\b/.test(coreHaystack)) trim = "Turbo S E-Hybrid";
    else if (/\bTURBO\s+GT\b/.test(coreHaystack)) trim = "Turbo GT";
    else if (/\bTURBO\s+S\b/.test(coreHaystack)) trim = "Turbo S";
    else if (/\bTURBO\b/.test(coreHaystack)) trim = "Turbo";
    else if (/\bCARRERA\s+RS\b|\bRS\s+AMERICA\b/.test(coreHaystack)) trim = /\bAMERICA\b/.test(coreHaystack) ? "RS America" : "Carrera RS";
    else if (/\bCARRERA\s+4\s+GTS\b/.test(coreHaystack)) trim = "Carrera 4 GTS";
    else if (/\bCARRERA\s+GTS\b/.test(coreHaystack)) trim = "Carrera GTS";
    else if (/\bTARGA\s+4\s+GTS\b/.test(coreHaystack)) trim = "Targa 4 GTS";
    else if (/\bTARGA\s+4S\b/.test(coreHaystack)) trim = "Targa 4S";
    else if (/\bTARGA\s+4\b/.test(coreHaystack)) trim = "Targa 4";
    else if (/\bCARRERA\s+4S\b/.test(coreHaystack)) trim = "Carrera 4S";
    else if (/\bCARRERA\s+S\b/.test(coreHaystack)) trim = "Carrera S";
    else if (/\bCARRERA\s+4\b/.test(coreHaystack)) trim = "Carrera 4";
    else if (/\bCARRERA\s+T\b/.test(coreHaystack)) trim = "Carrera T";
    else if (/\bCARRERA\b/.test(coreHaystack)) trim = "Carrera";
    else if (/\bGTS\s+4\.0\b|\bGTS\b/.test(coreHaystack)) trim = "GTS";
    else if (/\bSPYDER\s+RS\b|\bSPYDER\b/.test(coreHaystack)) trim = "Spyder";
    else if (/\b(?:BOXSTER|CAYMAN|CAYENNE|MACAN|PANAMERA|TAYCAN)\s+4S\b/.test(coreHaystack)) trim = "4S";
    else if (/\b(?:BOXSTER|CAYMAN|CAYENNE|MACAN|PANAMERA)\s+S\b/.test(coreHaystack)) trim = "S";
    else if (/\b(?:BOXSTER|CAYMAN|MACAN)\s+T\b/.test(coreHaystack)) trim = "T";
    else if (/\bDIESEL\b/.test(coreHaystack)) trim = "Diesel";
  } else if (brand === "bmw") {
    if (/\bCSL\b/.test(coreHaystack)) trim = "CSL";
    else if (/\b(?:\bM[23458]\b|\b1M\b).*\bCS\b|\bM[23458]\s+CS\b/.test(coreHaystack)) trim = "CS";
    else if (/\bCOMPETITION\s+PACKAGE\b|\bCOMPETITION\b|\bZCP\b/.test(fullHaystack)) trim = "Competition";
    else if (/\bZHP\b/.test(fullHaystack)) trim = "ZHP Performance Package";
    else if (/\bM\s+SPORT\b|\bM[-\s]?TECH\b/.test(fullHaystack) && !/\bM[234568]\b/.test(coreHaystack)) trim = "M Sport";
    else if (/\bM[234568]\b|\bM\s+ROADSTER\b|\bM\s+COUPE\b/.test(coreHaystack)) trim = "M-Power";
    else if (/\bXDRIVE[A-Z0-9]*\b/.test(coreHaystack)) trim = "xDrive";
  } else if (brand === "ford") {
    if (/\bRANGER\s+XLT\b/.test(coreHaystack)) trim = "Ranger XLT";
    else if (/\bKING\s+RANCH\b/.test(coreHaystack)) trim = "King Ranch";
    else if (/\bPLATINUM\b/.test(coreHaystack)) trim = "Platinum";
    else if (/\bLARIAT\b/.test(coreHaystack)) trim = "Lariat";
    else if (/\bXLT\b/.test(coreHaystack)) trim = "XLT";
    else if (/\bSVT\s+LIGHTNING\b|\bLIGHTNING\b/.test(coreHaystack)) trim = "SVT Lightning";
    else if (/\bSVT\s+RAPTOR\b|\bRAPTOR\s+R\b|\bRAPTOR\b/.test(coreHaystack)) trim = /\bRAPTOR\s+R\b/.test(coreHaystack) ? "Raptor R" : "Raptor";
    else if (/\bSHELBY\s+GT350R\b/.test(coreHaystack)) trim = "GT350R";
    else if (/\bSHELBY\s+GT350\b/.test(coreHaystack)) trim = "GT350";
    else if (/\bSHELBY\s+GT500\b/.test(coreHaystack)) trim = "GT500";
    else if (/\bBOSS\s+302\b/.test(coreHaystack)) trim = "Boss 302";
    else if (/\bMACH\s+1\b/.test(coreHaystack)) trim = "Mach 1";
    else if (/\bBULLITT\b/.test(coreHaystack)) trim = "Bullitt";
    else if (/\bSVT\s+COBRA\b|\bCOBRA\b/.test(coreHaystack)) trim = "SVT Cobra";
    else if (/\bDARK\s+HORSE\b/.test(coreHaystack)) trim = "Dark Horse";
    else if (/\bGT\s+PREMIUM\b|\bMUSTANG\s+GT\b/.test(coreHaystack)) trim = "GT";
    else if (/\bWILDTRAK\b/.test(coreHaystack)) trim = "Wildtrak";
    else if (/\bBADLANDS\b/.test(coreHaystack)) trim = "Badlands";
    else if (/\bFIRST\s+EDITION\b/.test(coreHaystack)) trim = "First Edition";
    else if (/\bOUTER\s+BANKS\b/.test(coreHaystack)) trim = "Outer Banks";
    else if (/\bBLACK\s+DIAMOND\b/.test(coreHaystack)) trim = "Black Diamond";
    else if (/\bBIG\s+BEND\b/.test(coreHaystack)) trim = "Big Bend";
    else if (/\bEDDIE\s+BAUER\b/.test(coreHaystack)) trim = "Eddie Bauer";
    else if (/\bFOCUS\s+RS\b/.test(coreHaystack)) trim = "RS";
    else if (/\b(?:FOCUS|FIESTA|EXPLORER)\s+ST\b/.test(coreHaystack)) trim = "ST";
  } else if (brand === "toyota") {
    if (/\bTRD\s+PRO\b/.test(fullHaystack)) trim = "TRD Pro";
    else if (/\bTRD\s+OFF[-\s]?ROAD\s+PREMIUM\b|\bTRD\s+OFF[-\s]?ROAD\b/.test(fullHaystack)) trim = "TRD Off-Road";
    else if (/\bTRD\s+SPORT\b/.test(fullHaystack)) trim = "TRD Sport";
    else if (/\bTRD\s+SPECIAL\s+EDITION\b/.test(fullHaystack)) trim = "TRD Special Edition";
    else if (/\bTRAIL\s+TEAMS\b/.test(fullHaystack)) trim = "Trail Teams Special Edition";
    else if (/\bHERITAGE\s+EDITION\b/.test(fullHaystack)) trim = "Heritage Edition";
    else if (/\bFIRST\s+EDITION\b/.test(coreHaystack)) trim = "First Edition";
    else if (/\b1958\b/.test(coreHaystack) && year && year >= 2024) trim = "1958";
    else if (/\bVX\s+LIMITED\b|\bVX\b/.test(fullHaystack)) trim = "VX Limited";
    else if (/\bSR5\b/.test(coreHaystack)) trim = "SR5";
    else if (/\bLIMITED\b/.test(coreHaystack)) trim = "Limited";
    else if (/\bXSE\b/.test(coreHaystack)) trim = "XSE";
    else if (/\bSUPRA\s+RZ\b|\bTURBO\b/.test(coreHaystack) && /\bSUPRA\b/.test(coreHaystack)) trim = /\bRZ\b/.test(coreHaystack) ? "RZ Twin-Turbo" : "Turbo";
  } else if (brand === "mercedes-benz" || brand === "mercedes") {
    if (/\bBLACK\s+SERIES\b/.test(coreHaystack)) trim = "AMG Black Series";
    else if (/\b63\s+S\s+AMG\b|\bAMG.*\b63\s+S\b/.test(coreHaystack)) trim = "AMG 63 S";
    else if (/\b(?:C|E|S|SL|CL|CLS|G|GL|GLE|GLS|ML|CLK|SLK)\s*(?:32|36|43|55|63|65)\s*AMG\b|\bAMG\b/.test(coreHaystack)) trim = "AMG";
    else if (/\b4MATIC\b/.test(coreHaystack)) trim = "4MATIC";
  }

  if (!trim) {
    if (/\bRUBICON\s+392\b/.test(coreHaystack)) trim = "Rubicon 392";
    else if (/\bRUBICON\b/.test(coreHaystack)) trim = "Rubicon";
    else if (/\bSAHARA\b/.test(coreHaystack)) trim = "Sahara";
    else if (/\bLAUNCH\s+EDITION\b/.test(coreHaystack)) trim = "Launch Edition";
    else if (/\bADVENTURE\s+EDITION\b|\bADVENTURE\b/.test(coreHaystack) && brand === "rivian") trim = "Adventure Edition";
    else if (/\bPLAID\b/.test(coreHaystack)) trim = "Plaid";
    else if (/\bPERFORMANCE\b/.test(coreHaystack) && brand === "tesla") trim = "Performance";
    else if (/\bLONG\s+RANGE\b/.test(coreHaystack) && brand === "tesla") trim = "Long Range";
    else if (/\bQUADRIFOGLIO\b/.test(coreHaystack)) trim = "Quadrifoglio";
    else if (/\bABARTH\b/.test(coreHaystack)) trim = "Abarth";
    else if (/\bJOHN\s+COOPER\s+WORKS\b|\bJCW\b/.test(coreHaystack)) trim = "John Cooper Works";
    else if (/\bCOOPER\s+S\b/.test(coreHaystack)) trim = "Cooper S";
    else if (/\bGRAND\s+TOURING\b/.test(coreHaystack)) trim = "Grand Touring";
    else if (/\bCLUB\b/.test(coreHaystack) && brand === "mazda") trim = "Club";
    else if (/\bTYPE\s+R\b/.test(coreHaystack)) trim = "Type R";
    else if (/\bNISMO\b/.test(coreHaystack)) trim = "NISMO";
    else if (/\bSPEC[-\s]?V\b|\bV[-\s]?SPEC\b/.test(coreHaystack)) trim = "V-Spec";
    else if (/\bGSR\b/.test(coreHaystack)) trim = "GSR";
    else if (/\bPRESTIGE\b/.test(coreHaystack)) trim = "Prestige";
    else if (/\bPREMIUM\s+PLUS\b/.test(coreHaystack)) trim = "Premium Plus";
    else if (/\bAUTOBIOGRAPHY\b/.test(coreHaystack)) trim = "Autobiography";
    else if (/\bWESTMINSTER\b/.test(coreHaystack)) trim = "Westminster";
    else if (/\bSUPERCHARGED\b/.test(coreHaystack) && brand === "land rover") trim = "Supercharged";
    else if (/\bHSE\b/.test(coreHaystack)) trim = "HSE";
    else if (/\bZ\/?28\b/.test(coreHaystack)) trim = "Z/28";
    else if (/\bIROC[-\s]?Z\b/.test(coreHaystack)) trim = "IROC-Z";
    else if (/\bZL1\b/.test(coreHaystack)) trim = "ZL1";
    else if (/\bR\/T\b/.test(coreHaystack)) trim = "R/T";
    else if (/\bSRT[-\s]?8\b|\bSRT8\b/.test(coreHaystack)) trim = "SRT8";
    else if (/\bHELLCAT\b/.test(coreHaystack)) trim = "SRT Hellcat";
  }

  // 3. BODY STYLE REFINEMENT
  if (/\bSPLIT[-\s]?WINDOW\b/.test(fullHaystack) || (brand === "chevrolet" && /\bCORVETTE\b/.test(coreHaystack) && year === 1963 && /\bCOUPE\b/.test(coreHaystack))) {
    bodyStyle = "Split-Window Coupe";
  } else if (/\bTARGA\b/.test(coreHaystack)) {
    bodyStyle = "Targa";
  } else if (/\bSPEEDSTER\b/.test(coreHaystack)) {
    bodyStyle = "Speedster";
  } else if (/\bROADSTER\b|\bSPYDER\b|\bSPIDER\b/.test(coreHaystack) && (!bodyStyle || /^(Convertible|Coupe)$/i.test(bodyStyle))) {
    bodyStyle = "Roadster";
  } else if (/\bFASTBACK\b|\bSPORTSROOF\b/.test(coreHaystack)) {
    bodyStyle = "Fastback";
  } else if ((!bodyStyle || /^Truck|Pickup$/i.test(bodyStyle)) && /\bSTEPSIDE\b|\bFLARESIDE\b|\bFENDERSIDE\b/.test(fullHaystack)) {
    bodyStyle = /\bFLARESIDE\b/.test(fullHaystack) ? "Flareside Pickup" : "Stepside Pickup";
  } else if ((!bodyStyle || /^Truck|Pickup$/i.test(bodyStyle)) && /\bFLEETSIDE\b|\bSTYLESIDE\b/.test(fullHaystack)) {
    bodyStyle = /\bSTYLESIDE\b/.test(fullHaystack) ? "Styleside Pickup" : "Fleetside Pickup";
  } else if (!bodyStyle) {
    if (/\bCONVERTIBLE\b|\bCABRIOLET\b|\bVOLANTE\b|\bDROPHEAD\b/.test(coreHaystack)) bodyStyle = "Convertible";
    else if (/\bCOUPE\b|\bBERLINETTA\b|\bHARDTOP\b/.test(coreHaystack)) bodyStyle = "Coupe";
    else if (/\bAVANT\b|\bWAGON\b|\bTOURING\b|\bESTATE\b|\bSPORT\s+TURISMO\b|\bCROSS\s+TURISMO\b/.test(coreHaystack)) bodyStyle = "Wagon";
    else if (/\bSPORTBACK\b|\bHATCHBACK\b|\bGRAN\s+COUPE\b/.test(coreHaystack)) bodyStyle = "Hatchback";
    else if (/\bSEDAN\b/.test(coreHaystack)) bodyStyle = "Sedan";
    else if (/\bSUV\b|\bLAND\s+CRUISER\b|\bBRONCO\b|\bWRANGLER\b|\bDEFENDER\b|\bRANGE\s+ROVER\b|\bCAYENNE\b|\bMACAN\b|\b4RUNNER\b|\bFJ\s+CRUISER\b|\bR1S\b|\bLX\s*\d{3}\b|\bGX\s*\d{3}\b|\bG\s*(?:500|550|55|63)\b|\b280\s*GE\b/.test(coreHaystack)) bodyStyle = "SUV";
    else if (/\bTRUCK\b|\bPICKUP\b|\bF[-\s]?[1234]50\b|\bF[-\s]?100\b|\bTACOMA\b|\bTUNDRA\b|\bR1T\b|\bSILVERADO\b|\bSIERRA\b|\bC10\b|\bK10\b/.test(coreHaystack)) bodyStyle = "Truck";
  }

  return { normalizedModel, series, trim, body_style: bodyStyle };
}

async function createCabApiClient() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("[cab-api] Warming up Cloudflare & acquiring cb-tini keys...");
  await page.goto("https://carsandbids.com/past-auctions/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  let tini = null;
  for (let i = 0; i < 25; i++) {
    tini = await page
      .evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem("cb-tini") || "null");
        } catch {
          return null;
        }
      })
      .catch(() => null);
    if (tini && tini.__farsce && tini._gi_ase) break;
    await page.waitForTimeout(500);
  }

  if (!tini || !tini.__farsce || !tini._gi_ase) {
    await browser.close();
    throw new Error("Failed to obtain cb-tini tokens from Cars & Bids localStorage");
  }

  console.log("[cab-api] Acquired cb-tini tokens successfully.");

  async function refreshTini() {
    await page.goto("https://carsandbids.com/past-auctions/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const nextTini = await page
      .evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem("cb-tini") || "null");
        } catch {
          return null;
        }
      })
      .catch(() => null);
    if (nextTini?.__farsce && nextTini?._gi_ase) {
      tini = nextTini;
    }
  }

  async function callApi(apiVer, endpoint, params = {}, attempt = 1) {
    const ts = Date.now().toString();
    const raw = `${tini.__farsce}_${ts}_/${apiVer}/${endpoint}${tini._gi_ase}`;
    const sig = crypto.createHash("sha1").update(raw).digest("hex");
    const qs = new URLSearchParams({
      ...params,
      timestamp: ts,
      signature: sig,
    }).toString();
    const url = `https://carsandbids.com/${apiVer}/${endpoint}?${qs}`;
    try {
      const res = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: "same-origin" });
        let data = null;
        try {
          data = await r.json();
        } catch {}
        return { status: r.status, ok: r.ok, data };
      }, url);
      if (!res.ok && attempt < 3 && (res.status === 401 || res.status === 403 || res.status === 429)) {
        await page.waitForTimeout(1500 * attempt);
        await refreshTini();
        return await callApi(apiVer, endpoint, params, attempt + 1);
      }
      return res;
    } catch (err) {
      if (attempt < 3) {
        await refreshTini();
        return await callApi(apiVer, endpoint, params, attempt + 1);
      }
      throw err;
    }
  }

  return {
    callApi,
    close: async () => await browser.close(),
  };
}

/**
 * Full Gold-Standard Extraction for a single Cars & Bids auction ID via
 * /v2/autos/auctions/{id} + /v1/autos/auctions/{id}/comments
 *
 * Returns detailed per-table propagation telemetry so every listing's fan-out
 * across all 9 tables is measured and verified.
 */
async function extractSingleAuctionGoldStandard(cab, auctionId) {
  const t0 = Date.now();
  const [detailRes, commentsRes] = await Promise.all([
    cab.callApi("v2", `autos/auctions/${auctionId}`, {}),
    cab.callApi("v1", `autos/auctions/${auctionId}/comments`, {
      limit: "1000",
      filter: "1",
    }),
  ]);

  if (!detailRes.ok || !detailRes.data?.listing) {
    throw new Error(
      `Failed to fetch detail for ${auctionId}: status=${detailRes.status}`
    );
  }

  const d = detailRes.data;
  const l = d.listing;
  const stats = d.stats || {};
  const sections = l.sections || {};
  const commentsAndBids = commentsRes.data?.comments_and_bids || [];

  const canonicalUrl = buildCanonicalUrl(d.id, l.title);
  const nowIso = new Date().toISOString();

  // Determine outcome & status
  const endDateIso = stats.auction_end ? new Date(stats.auction_end).toISOString() : null;
  const isEnded =
    d.status === "sold" ||
    d.status === "closed" ||
    d.status === "canceled" ||
    (endDateIso && new Date(endDateIso).getTime() <= Date.now());
  const isSold = d.status === "sold" || (stats.sale_amount && stats.sale_amount > 0);
  const outcome = isSold
    ? "sold"
    : d.status === "canceled"
    ? "cancelled"
    : isEnded
    ? "reserve_not_met"
    : "live";
  const eventStatus = isSold ? "sold" : isEnded ? "reserve_not_met" : "active";
  const vehicleAuctionStatus = isSold ? "sold" : isEnded ? "ended" : "active";
  const vehicleSaleStatus = isSold
    ? "sold"
    : isEnded
    ? "not_sold"
    : "auction_live";
  const reserveStatus = d.no_reserve
    ? "no_reserve"
    : isSold
    ? "reserve_met"
    : isEnded
    ? "reserve_not_met"
    : null;

  const currentBidAmount =
    stats.sale_amount ||
    (typeof stats.current_bid === "object" && stats.current_bid
      ? stats.current_bid.amount
      : typeof stats.current_bid === "number"
      ? stats.current_bid
      : null);

  const highBidderName =
    stats.buyer?.username ||
    (typeof stats.current_bid === "object" && stats.current_bid?.bidder
      ? stats.current_bid.bidder.username
      : null);

  // Build categorized full-resolution gallery photos
  const baseUrl = l.photos?.base_url || "media.carsandbids.com";
  const photoCategories = ["exterior", "interior", "mechanical", "other", "docs"];
  const allPhotos = [];
  const seenPhotoPaths = new Set();

  for (const cat of photoCategories) {
    const arr = Array.isArray(l.photos?.[cat]) ? l.photos[cat] : [];
    for (const p of arr) {
      if (!p?.link) continue;
      const cleanPath = String(p.link).split("?")[0];
      if (seenPhotoPaths.has(cleanPath)) continue;
      seenPhotoPaths.add(cleanPath);
      allPhotos.push({
        url: `https://${baseUrl}/cdn-cgi/image/width=2080,quality=80/${cleanPath}`,
        category: cat,
        photo_id: p.id || null,
        width: p.width || null,
        height: p.height || null,
      });
    }
  }

  if (allPhotos.length === 0 && d.main_photo?.path) {
    const cleanPath = String(d.main_photo.path).split("?")[0];
    allPhotos.push({
      url: `https://${d.main_photo.base_url || baseUrl}/cdn-cgi/image/width=2080,quality=80/${cleanPath}`,
      category: "exterior",
      photo_id: null,
      width: null,
      height: null,
    });
  }

  const parsedLoc = parseLocationString(l.location);
  const bodyStyle = BODY_STYLE_MAP[l.body_style] || null;
  const drivetrain = DRIVETRAIN_MAP[l.drive_train] || null;
  const transBase = TRANSMISSION_MAP[l.transmission] || null;
  const sellerType = SELLER_TYPE_MAP[l.seller_type] || "unknown";
  const rawVin = l.vin ? String(l.vin).trim().toUpperCase() : null;
  const cleanedVin = rawVin ? rawVin.replace(/[\s-]+/g, "") : null;
  const vin =
    cleanedVin && cleanedVin.length >= 5 && cleanedVin.length <= 17 && /^[A-Z0-9]+$/.test(cleanedVin)
      ? cleanedVin
      : null;
  let rawMileage =
    typeof l.mileage === "number" && l.mileage > 0
      ? l.mileage
      : l.mileage_text
      ? parseInt(String(l.mileage_text).split(/[(\n,;]/)[0].replace(/[^0-9]/g, ""), 10) || null
      : null;
  const mileage = rawMileage && rawMileage > 0 && rawMileage <= 2000000 ? rawMileage : null;

  const fullDescription = [
    l.sub_title ? `${l.sub_title}` : null,
    sections.doug ? `**Doug's Take:**\n${sections.doug}` : null,
    sections.highlights ? `**Highlights:**\n${sections.highlights}` : null,
    sections.equipment ? `**Equipment:**\n${sections.equipment}` : null,
    sections.modifications ? `**Modifications:**\n${sections.modifications}` : null,
    sections.known_flaws ? `**Known Flaws:**\n${sections.known_flaws}` : null,
    sections.recent_service_history
      ? `**Recent Service History:**\n${sections.recent_service_history}`
      : null,
    sections.other_items ? `**Other Items Included:**\n${sections.other_items}` : null,
    sections.ownership_history
      ? `**Ownership History:**\n${sections.ownership_history}`
      : null,
    sections.seller_notes ? `**Seller Notes:**\n${sections.seller_notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const bidHistory = commentsAndBids
    .filter((item) => item.type === 2 && item.amount)
    .map((item) => ({
      id: item.id,
      bidder: item.user?.username || "unknown",
      amount: item.amount,
      timestamp: item.timestamp || null,
      upvotes: item.upvotes || 0,
    }));

  const videoUrls = Array.isArray(sections.videos)
    ? sections.videos
    : Array.isArray(l.videos)
    ? l.videos
    : [];

  // 1. Archive JSON snapshot in listing_page_snapshots (exact schema columns)
  const jsonSnapshotText = JSON.stringify({ detail: d, comments_count: commentsAndBids.length });
  const htmlBody = `<!-- cab-v2-api-json:${d.id} class="bid-bar ${isEnded ? "ended" : "live"}" -->\n<script id="cab-v2-json" type="application/json">${jsonSnapshotText}</script>`;
  const htmlSha256 = crypto.createHash("sha256").update(htmlBody).digest("hex");

  const { data: existingSnap } = await supabase
    .from("listing_page_snapshots")
    .select("id")
    .eq("platform", "carsandbids")
    .eq("listing_url", canonicalUrl)
    .eq("html_sha256", htmlSha256)
    .limit(1)
    .maybeSingle();

  let snapshotSaved = existingSnap?.id ? 1 : 0;
  if (!existingSnap?.id) {
    const { error: snapErr } = await supabase
      .from("listing_page_snapshots")
      .insert({
        platform: "carsandbids",
        listing_url: canonicalUrl,
        fetched_at: nowIso,
        fetch_method: "cab_v2_api",
        http_status: 200,
        success: true,
        html: htmlBody,
        html_sha256: htmlSha256,
        content_length: htmlBody.length,
        markdown: fullDescription,
        metadata: {
          extractor: "cab-api-sync:v2",
          auction_id: d.id,
          submission_id: d.submission_id,
          status: d.status,
          photos_count: allPhotos.length,
          comments_and_bids_count: commentsAndBids.length,
          parsed_at: nowIso,
        },
      });
    if (!snapErr) snapshotSaved = 1;
  }

  // 2. Match or create vehicle (VIN takes priority if a canonical vehicle already owns this VIN)
  let vehicleId = null;
  const lowerUrl = canonicalUrl.replace(
    `/auctions/${d.id}/`,
    `/auctions/${d.id.toLowerCase()}/`
  );

  let vinOwnerId = null;
  if (vin && vin.length >= 5) {
    let q = supabase
      .from("vehicles")
      .select("id")
      .eq("vin", vin)
      .neq("status", "merged")
      .is("deleted_at", null);
    if (vin.length < 11 && (l.make || parseTitleYmm(l.title).make)) {
      q = q.ilike("make", l.make || parseTitleYmm(l.title).make);
    }
    const { data: byVin } = await q.limit(1).maybeSingle();
    if (byVin?.id) vinOwnerId = byVin.id;
  }

  const { data: byListingUrl } = await supabase
    .from("vehicles")
    .select("id")
    .in("listing_url", [canonicalUrl, lowerUrl])
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  let urlRowId = byListingUrl?.id || null;
  if (!urlRowId) {
    const { data: byDiscUrl } = await supabase
      .from("vehicles")
      .select("id")
      .in("discovery_url", [canonicalUrl, lowerUrl])
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (byDiscUrl?.id) urlRowId = byDiscUrl.id;
  }

  if (vinOwnerId && urlRowId && vinOwnerId !== urlRowId) {
    vehicleId = vinOwnerId;
    await supabase
      .from("vehicle_listings")
      .update({ vehicle_id: vinOwnerId })
      .eq("vehicle_id", urlRowId);
    await supabase
      .from("vehicle_events")
      .update({ vehicle_id: vinOwnerId })
      .eq("vehicle_id", urlRowId);
    await supabase
      .from("vehicles")
      .update({ deleted_at: nowIso, status: "merged", listing_url: null, vin: null })
      .eq("id", urlRowId);
  } else {
    vehicleId = vinOwnerId || urlRowId;
  }

  const parsedYear = l.year || parseTitleYmm(l.title).year;
  const parsedMake = l.make || parseTitleYmm(l.title).make;
  const parsedModel = l.model || parseTitleYmm(l.title).model;
  const cleanedTitle = cleanCabText(l.title);
  const cleanedSubTitle = cleanCabText(l.sub_title);
  const facets = extractCabFacets({
    year: parsedYear,
    make: parsedMake,
    model: parsedModel,
    title: cleanedTitle,
    subTitle: cleanedSubTitle,
    highlights: [sections.highlights, sections.equipment, sections.doug].filter(Boolean).join(" "),
    existingBodyStyle: bodyStyle,
  });

  const vehiclePayload = {
    year: parsedYear,
    make: parsedMake,
    model: facets.normalizedModel || parsedModel,
    title: cleanedTitle,
    listing_title: cleanedSubTitle ? `${cleanedTitle} — ${cleanedSubTitle}` : cleanedTitle,
    series: facets.series,
    trim: facets.trim,
    vin,
    mileage,
    color: l.exterior_color || null,
    interior_color: l.interior_color || null,
    engine_type: l.engine || null,
    engine_size: l.engine || null,
    transmission: transBase || null,
    drivetrain,
    body_style: facets.body_style || bodyStyle,
    title_status: l.title_status || null,
    primary_image_url: allPhotos[0]?.url || null,
    description: fullDescription || null,
    description_source: "source_imported",
    listing_location: parsedLoc.clean,
    listing_location_raw: parsedLoc.raw,
    listing_location_source: "carsandbids",
    listing_location_confidence: parsedLoc.confidence,
    listing_location_observed_at: nowIso,
    city: parsedLoc.city,
    state: parsedLoc.state,
    listing_url: canonicalUrl,
    discovery_url: canonicalUrl,
    discovery_source: "carsandbids",
    listing_source: "extract-cars-and-bids-core",
    auction_source: "cars_and_bids",
    canonical_platform: "cars-and-bids",
    platform_source: "cars-and-bids",
    source: "cars-and-bids",
    is_public: true,
    status: "active",
    auction_status: vehicleAuctionStatus,
    sale_status: vehicleSaleStatus,
    auction_outcome: isSold ? "sold" : isEnded ? "reserve_not_met" : null,
    reserve_status: reserveStatus,
    auction_end_date: endDateIso,
    sale_date: isSold && endDateIso ? endDateIso.slice(0, 10) : null,
    sale_price: isSold ? currentBidAmount : null,
    sold_price: isSold ? currentBidAmount : null,
    winning_bid: isSold ? currentBidAmount : null,
    high_bid: !isSold ? currentBidAmount : null,
    bid_count: stats.bids ?? bidHistory.length ?? null,
    extractor_version: "cab-api-v2:1.2",
    import_metadata: {
      platform: "carsandbids",
      auction_id: d.id,
      submission_id: d.submission_id,
      raw_vin: rawVin,
      auction_status: eventStatus,
      no_reserve: !!d.no_reserve,
      lot_number: d.id,
      sub_title: l.sub_title || null,
      highlighted_points: l.highlighted_points || null,
      dougs_take: sections.doug || null,
      highlights: sections.highlights || null,
      equipment: sections.equipment || null,
      modifications: sections.modifications || null,
      known_flaws: sections.known_flaws || null,
      recent_service_history: sections.recent_service_history || null,
      other_items_included: sections.other_items || null,
      ownership_history: sections.ownership_history || null,
      seller_notes: sections.seller_notes || null,
      comment_count: stats.comments ?? null,
      bid_count: stats.bids ?? null,
      view_count: d.views ?? null,
      watching_count: stats.watchers ?? null,
      carfax_url: l.history_report?.url || l.history_report_pdf || null,
      video_url: videoUrls[0] || null,
      video_urls: videoUrls,
      seller_username: d.seller?.username || null,
      seller_id: d.seller?.id || null,
      seller_type: sellerType,
      buyer_username: stats.buyer?.username || null,
      buyer_id: stats.buyer?.id || null,
      photos_by_category: {
        exterior: l.photos?.exterior?.length || 0,
        interior: l.photos?.interior?.length || 0,
        mechanical: l.photos?.mechanical?.length || 0,
        other: l.photos?.other?.length || 0,
        docs: l.photos?.docs?.length || 0,
        total: allPhotos.length,
      },
      bid_history: bidHistory.slice(0, 100),
      extracted_at: nowIso,
    },
    updated_at: nowIso,
  };

  Object.keys(vehiclePayload).forEach((k) => {
    if (vehiclePayload[k] === null || vehiclePayload[k] === undefined) {
      delete vehiclePayload[k];
    }
  });

  if (vehicleId) {
    const { error: uErr } = await supabase
      .from("vehicles")
      .update(vehiclePayload)
      .eq("id", vehicleId);
    if (uErr) throw new Error(`Vehicle update failed for ${d.id}: ${describePgError(uErr)}`);
  } else {
    const { data: insV, error: iErr } = await supabase
      .from("vehicles")
      .insert(vehiclePayload)
      .select("id")
      .single();
    if (iErr) throw new Error(`Vehicle insert failed for ${d.id}: ${describePgError(iErr)}`);
    vehicleId = insV.id;
  }

  // 3. Upsert external_identities for seller, buyer, and commenters/bidders
  const handles = new Map();
  if (d.seller?.username) handles.set(d.seller.username, d.seller.id);
  if (stats.buyer?.username) handles.set(stats.buyer.username, stats.buyer.id);
  for (const c of commentsAndBids) {
    if (c.user?.username && !handles.has(c.user.username)) {
      handles.set(c.user.username, c.user.id);
    }
  }

  const identityIds = new Map();
  if (handles.size > 0) {
    const idRowsToUpsert = [...handles.entries()].map(([handle]) => ({
      platform: "cars_and_bids",
      handle,
      profile_url: `https://carsandbids.com/user/${encodeURIComponent(handle)}`,
      last_seen_at: nowIso,
      updated_at: nowIso,
    }));
    for (let k = 0; k < idRowsToUpsert.length; k += 200) {
      const { data: upIds } = await supabase
        .from("external_identities")
        .upsert(idRowsToUpsert.slice(k, k + 200), { onConflict: "platform,handle" })
        .select("id, handle");
      for (const r of upIds || []) identityIds.set(r.handle, r.id);
    }
  }

  // 4. Upsert vehicle_images (categorized full-res gallery!)
  const { data: existingImgs } = await supabase
    .from("vehicle_images")
    .select("image_url")
    .eq("vehicle_id", vehicleId)
    .limit(1000);
  const existingUrlSet = new Set((existingImgs || []).map((r) => r.image_url));

  const newImageRows = allPhotos
    .slice(0, 300)
    .filter((p) => !existingUrlSet.has(p.url))
    .map((p, idx) => ({
      vehicle_id: vehicleId,
      image_url: p.url,
      source: "external_import",
      source_url: p.url,
      is_external: true,
      approval_status: "auto_approved",
      is_approved: true,
      redaction_level: "none",
      position: existingUrlSet.size + idx,
      display_order: existingUrlSet.size + idx,
      is_primary: existingUrlSet.size + idx === 0,
      exif_data: {
        source_url: canonicalUrl,
        discovery_url: canonicalUrl,
        imported_from: "cars_and_bids",
        category: p.category,
        photo_id: p.photo_id,
        width: p.width,
        height: p.height,
        photos_on_page: allPhotos.length,
        photos_claimed: allPhotos.length,
      },
    }));

  let imagesInserted = 0;
  if (newImageRows.length > 0) {
    for (let k = 0; k < newImageRows.length; k += 100) {
      const { data: insI, error: imgErr } = await supabase
        .from("vehicle_images")
        .insert(newImageRows.slice(k, k + 100))
        .select("id");
      if (!imgErr) imagesInserted += insI?.length || 0;
    }
  }
  const totalVehicleImages = existingUrlSet.size + imagesInserted;

  // 5. Write vehicle_events (match by source_listing_id or vehicle_id)
  const eventPayload = {
    vehicle_id: vehicleId,
    source_platform: "cars_and_bids",
    source_listing_id: d.id,
    event_type: "auction",
    source_url: canonicalUrl,
    current_price: currentBidAmount,
    final_price: isSold ? currentBidAmount : null,
    event_status: eventStatus,
    ended_at: endDateIso,
    sold_at: isSold ? endDateIso : null,
    bid_count: stats.bids ?? bidHistory.length ?? null,
    comment_count: stats.comments ?? commentsAndBids.filter((c) => c.type === 1).length ?? null,
    view_count: d.views ?? null,
    watcher_count: stats.watchers ?? null,
    seller_identifier: d.seller?.username || null,
    seller_external_identity_id: d.seller?.username
      ? identityIds.get(d.seller.username) || null
      : null,
    buyer_identifier: stats.buyer?.username || null,
    buyer_external_identity_id: stats.buyer?.username
      ? identityIds.get(stats.buyer.username) || null
      : null,
    extraction_method: "api_v2_json",
    extraction_source: "carsandbids_api",
    extractor_version: "cab-api-v2:1.1",
    extracted_at: nowIso,
    metadata: {
      title: l.title,
      sub_title: l.sub_title || null,
      seller_id: sellerType,
      seller_name: d.seller?.username || null,
      buyer_name: stats.buyer?.username || null,
      location: l.location || null,
      reserve_status: reserveStatus,
      no_reserve: !!d.no_reserve,
      photos_on_page: allPhotos.length,
      photos_claimed: allPhotos.length,
      comments_on_page: commentsAndBids.length,
    },
    updated_at: nowIso,
  };

  const { data: heldEvent } = await supabase
    .from("vehicle_events")
    .select("id")
    .eq("source_platform", "cars_and_bids")
    .eq("source_listing_id", d.id)
    .limit(1)
    .maybeSingle();

  if (heldEvent?.id) {
    await supabase.from("vehicle_events").update(eventPayload).eq("id", heldEvent.id);
  } else {
    await supabase.from("vehicle_events").insert(eventPayload);
  }

  // 6. Upsert auction_events & auction_comments
  const auctionEventData = {
    vehicle_id: vehicleId,
    source: "cars_and_bids",
    source_url: canonicalUrl,
    source_listing_id: d.id,
    lot_number: d.id,
    auction_start_date: stats.auction_start
      ? new Date(stats.auction_start).toISOString()
      : null,
    auction_end_date: endDateIso,
    outcome,
    reserve_disclosed: !!d.no_reserve,
    high_bid: currentBidAmount,
    winning_bid: isSold ? currentBidAmount : null,
    total_bids: stats.bids ?? bidHistory.length ?? null,
    bid_history: bidHistory.length > 0 ? bidHistory : null,
    high_bidder: highBidderName,
    winning_bidder: isSold ? stats.buyer?.username || highBidderName : null,
    seller_name: d.seller?.username || null,
    seller_type: sellerType,
    seller_location: l.location || null,
    page_views: d.views ?? null,
    watchers: stats.watchers ?? null,
    comments_count: stats.comments ?? null,
    scraped_at: nowIso,
    updated_at: nowIso,
    raw_data: {
      extractor: "cab-api-v2:1.1",
      auction_id: d.id,
      submission_id: d.submission_id,
      comments_claimed: stats.comments ?? null,
      bids_claimed: stats.bids ?? null,
      photos_claimed: allPhotos.length,
      photos_on_page: allPhotos.length,
      reserve_status: reserveStatus,
      comments_on_page: commentsAndBids.length,
    },
  };

  const { data: auctionRow, error: aeErr } = await supabase
    .from("auction_events")
    .upsert(auctionEventData, { onConflict: "vehicle_id,source_url" })
    .select("id")
    .maybeSingle();

  if (aeErr) console.warn(`  auction_events upsert warning for ${d.id}:`, aeErr.message);

  let commentsUpserted = 0;
  let bidRowsCount = 0;
  let commentRowsCount = 0;
  if (auctionRow?.id && commentsAndBids.length > 0) {
    const endMs = endDateIso ? new Date(endDateIso).getTime() : null;
    const commentRows = commentsAndBids.map((c, idx) => {
      const postedIso = c.timestamp ? new Date(c.timestamp).toISOString() : nowIso;
      const isBid = c.type === 2 || !!c.amount;
      if (isBid) bidRowsCount++;
      else commentRowsCount++;
      const text = isBid ? `Bid $${Number(c.amount).toLocaleString()}` : String(c.text || "").trim();
      const username = c.user?.username || "anonymous";
      return {
        auction_event_id: auctionRow.id,
        vehicle_id: vehicleId,
        platform: "cars_and_bids",
        source_url: canonicalUrl,
        content_hash: `cab_${vehicleId}_${c.id}`,
        sequence_number: idx + 1,
        posted_at: postedIso,
        hours_until_close: endMs
          ? Math.max(0, (endMs - new Date(postedIso).getTime()) / 3600000)
          : null,
        author_username: username,
        author_external_identity_id: identityIds.get(username) || null,
        external_identity_id: identityIds.get(username) || null,
        is_seller: !!c.user?.is_seller || username === d.seller?.username,
        comment_type: isBid
          ? "bid"
          : c.user?.is_seller
          ? "seller_response"
          : text.includes("?")
          ? "question"
          : "observation",
        comment_text: text || "(empty)",
        word_count: (text || "").split(/\s+/).filter(Boolean).length,
        has_question: text.includes("?"),
        comment_likes: c.upvotes || 0,
        bid_amount: isBid ? c.amount : null,
      };
    });

    for (let k = 0; k < commentRows.length; k += 100) {
      const { error: cErr } = await supabase
        .from("auction_comments")
        .upsert(commentRows.slice(k, k + 100), { onConflict: "vehicle_id,content_hash" });
      if (!cErr) commentsUpserted += commentRows.slice(k, k + 100).length;
    }
  }

  // 7. Link to Cars & Bids organization (822cae29-f80e-4859-9c48-a1485a543152)
  const { error: orgErr } = await supabase.from("organization_vehicles").upsert(
    {
      organization_id: CARS_AND_BIDS_ORG_ID,
      vehicle_id: vehicleId,
      relationship_type: "auction_platform",
      status: isSold ? "sold" : "active",
      listing_status: isSold ? "sold" : isEnded ? "archived" : "for_sale",
      sale_price: isSold ? currentBidAmount : null,
      asking_price: !isSold ? currentBidAmount : null,
      sale_date: isSold && endDateIso ? endDateIso.slice(0, 10) : null,
      auto_tagged: true,
      notes: `Imported from Cars & Bids API v2: ${canonicalUrl}`,
    },
    { onConflict: "organization_id,vehicle_id,relationship_type" }
  );
  const orgLinked = !orgErr ? 1 : 0;

  // Compute total propagated data-model rows for this 1 source listing
  const totalDataModelRows =
    1 + // vehicles
    snapshotSaved + // listing_page_snapshots
    1 + // vehicle_events
    (auctionRow?.id ? 1 : 0) + // auction_events
    orgLinked + // organization_vehicles
    identityIds.size + // external_identities
    totalVehicleImages + // vehicle_images
    commentsUpserted; // auction_comments (bids + comments)

  return {
    auction_id: d.id,
    vehicle_id: vehicleId,
    url: canonicalUrl,
    title: l.title,
    vin,
    mileage,
    outcome,
    price: currentBidAmount,
    bids: stats.bids ?? bidHistory.length,
    comments: stats.comments ?? commentRowsCount,
    photos_total: allPhotos.length,
    images_in_db: totalVehicleImages,
    images_inserted: imagesInserted,
    comments_upserted: commentsUpserted,
    identities_upserted: identityIds.size,
    snapshot_saved: snapshotSaved,
    org_linked: orgLinked,
    total_data_model_rows: totalDataModelRows,
    seller: d.seller?.username || null,
    buyer: stats.buyer?.username || null,
    elapsed_ms: Date.now() - t0,
  };
}

/**
 * Continuous historical backfill mode:
 * Walks `/v2/autos/auctions?limit=50&status=closed&offset=...` across pages,
 * checks which auctions are missing full extraction (`auction_events` or 17-char `vin`),
 * extracts each one via `extractSingleAuctionGoldStandard`, and writes real-time
 * propagation telemetry (`total_data_model_rows` per listing) to console + JSONL log.
 */
async function runHistoricalBackfill(cab, startPage = 1, endPage = 853, concurrency = 3) {
  const logDir = "/Users/skylar/nuke-logs/lane-online";
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = `${logDir}/cab_backfill_telemetry_20261017.jsonl`;
  const summaryPath = `${logDir}/cab_backfill_status.json`;

  console.log(`\n=== STARTING CARS & BIDS FULL-PROPAGATION BACKFILL (Pages ${startPage}..${endPage}, concurrency=${concurrency}) ===`);
  console.log(`Telemetry log: ${logPath}`);

  const cumulative = {
    started_at: new Date().toISOString(),
    pages_scanned: 0,
    auctions_seen: 0,
    already_complete: 0,
    listings_extracted: 0,
    errors: 0,
    propagated_rows: {
      vehicles: 0,
      listing_page_snapshots: 0,
      vehicle_events: 0,
      auction_events: 0,
      organization_vehicles: 0,
      external_identities: 0,
      vehicle_images: 0,
      auction_comments: 0,
      total_rows: 0,
    },
  };

  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    await waitForIoGate();
    const offset = (pageNum - 1) * 50;
    const res = await cab.callApi("v2", "autos/auctions", {
      limit: "50",
      status: "closed",
      offset: String(offset),
    });
    if (!res.ok || !res.data?.auctions?.length) {
      console.warn(`  [Page ${pageNum}] Empty or error response (status=${res.status}), stopping.`);
      break;
    }

    const pageAuctions = res.data.auctions;
    cumulative.pages_scanned++;
    cumulative.auctions_seen += pageAuctions.length;

    const pageIds = pageAuctions.map((a) => a.id);

    // Check which IDs on this page already have a complete auction_events row AND a 17-char VIN on vehicles
    const { data: existingAe } = await supabase
      .from("auction_events")
      .select("source_listing_id, vehicle_id, total_bids, comments_count")
      .eq("source", "cars_and_bids")
      .in("source_listing_id", pageIds);

    const completeSet = new Set();
    if (existingAe?.length) {
      const vids = existingAe.map((r) => r.vehicle_id).filter(Boolean);
      const { data: vRows } = await supabase
        .from("vehicles")
        .select("id, vin")
        .in("id", vids);
      const vinMap = new Map((vRows || []).map((v) => [v.id, v.vin]));
      for (const ae of existingAe) {
        const vVin = vinMap.get(ae.vehicle_id);
        if (vVin && vVin.length >= 5 && ae.comments_count !== null) {
          completeSet.add(ae.source_listing_id);
        }
      }
    }

    const todo = pageAuctions.filter((a) => !completeSet.has(a.id));
    cumulative.already_complete += pageAuctions.length - todo.length;

    console.log(
      `\n[Page ${pageNum}/${endPage} | offset=${offset}] ${pageAuctions.length} auctions (${completeSet.size} already complete, ${todo.length} to extract)`
    );

    // Process `todo` in batches of `concurrency`
    for (let i = 0; i < todo.length; i += concurrency) {
      const slice = todo.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        slice.map(async (a) => {
          for (let tryNum = 1; tryNum <= 3; tryNum++) {
            try {
              return await extractSingleAuctionGoldStandard(cab, a.id);
            } catch (err) {
              if (tryNum === 3) throw err;
              await new Promise((r) => setTimeout(r, 1500 * tryNum));
            }
          }
        })
      );

      for (let j = 0; j < results.length; j++) {
        const item = slice[j];
        const r = results[j];
        if (r.status === "fulfilled") {
          const val = r.value;
          cumulative.listings_extracted++;
          cumulative.propagated_rows.vehicles += 1;
          cumulative.propagated_rows.listing_page_snapshots += val.snapshot_saved;
          cumulative.propagated_rows.vehicle_events += 1;
          cumulative.propagated_rows.auction_events += 1;
          cumulative.propagated_rows.organization_vehicles += val.org_linked;
          cumulative.propagated_rows.external_identities += val.identities_upserted;
          cumulative.propagated_rows.vehicle_images += val.images_in_db;
          cumulative.propagated_rows.auction_comments += val.comments_upserted;
          cumulative.propagated_rows.total_rows += val.total_data_model_rows;

          const avgFanout = (
            cumulative.propagated_rows.total_rows / cumulative.listings_extracted
          ).toFixed(1);

          console.log(
            `  ✅ [${cumulative.listings_extracted}] ${val.title} (${val.auction_id}) | VIN=${val.vin || "NONE"} | +${val.total_data_model_rows} rows (imgs=${val.images_in_db}, cmts/bids=${val.comments_upserted}, ids=${val.identities_upserted}) | Cumul: ${cumulative.propagated_rows.total_rows.toLocaleString()} rows (${avgFanout} rows/listing) | ${val.elapsed_ms}ms`
          );

          fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), page: pageNum, ...val }) + "\n");
        } else {
          cumulative.errors++;
          console.error(`  ❌ [${item.id}] ${item.title}: ${r.reason?.message || r.reason}`);
        }
      }

      fs.writeFileSync(
        summaryPath,
        JSON.stringify(
          {
            updated_at: new Date().toISOString(),
            current_page: pageNum,
            ...cumulative,
            avg_propagated_rows_per_listing:
              cumulative.listings_extracted > 0
                ? +(cumulative.propagated_rows.total_rows / cumulative.listings_extracted).toFixed(1)
                : 0,
          },
          null,
          2
        )
      );
    }
  }
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    })
  );
  const mode = args.mode || "extract";

  const cab = await createCabApiClient();
  try {
    if (mode === "extract") {
      const ids = (args.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        const r = await extractSingleAuctionGoldStandard(cab, id);
        console.log(JSON.stringify(r, null, 2));
      }
    } else if (mode === "backfill") {
      const startPage = parseInt(args["start-page"] || "1", 10);
      const endPage = parseInt(args["end-page"] || "853", 10);
      const concurrency = parseInt(args.concurrency || "3", 10);
      await runHistoricalBackfill(cab, startPage, endPage, concurrency);
    }
  } finally {
    await cab.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
