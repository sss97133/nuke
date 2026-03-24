#!/usr/bin/env node
/**
 * QuickBooks Purchase → Build Manifest Matcher
 *
 * Reads QB purchase data from data/qb-purchases.json and matches against
 * the vehicle_build_manifest table for the 1977 K5 Blazer.
 *
 * Matching strategy:
 *   1. Vendor name → manifest supplier (fuzzy)
 *   2. Description keywords → device names
 *   3. Known part numbers from line item descriptions
 *   4. Multi-line PayPal transactions with item-level detail
 *
 * Usage:
 *   dotenvx run -- node scripts/qb-match-manifest.mjs              # dry run by default
 *   dotenvx run -- node scripts/qb-match-manifest.mjs --dry-run    # explicit dry run
 *   dotenvx run -- node scripts/qb-match-manifest.mjs --apply      # actually update DB
 *   dotenvx run -- node scripts/qb-match-manifest.mjs --verbose    # show all QB purchases considered
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// ── Config ──────────────────────────────────────────────────────────────────

const VEHICLE_ID = "e04bf9c5-b488-433b-be9a-3d307861d90b";
const QB_DATA_PATH = "/Users/skylar/nuke/data/qb-purchases.json";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");
const VERBOSE = args.includes("--verbose");

// ── Exclusion lists ─────────────────────────────────────────────────────────
// Vendors/purchases that should NEVER match to manifest devices

const EXCLUDED_VENDORS = new Set([
  // Vehicle purchase itself
  "a cars life",
  // Tools, not vehicle parts
  "kellie smith snap on",
  "snap on",
  "harbor freight tools",
  "harbor freight",
  // Services, not parts
  "smog vets llc",
  "smog vets",
  // Non-vehicle
  "taco bell",
  "albertsons",
  "apple",
  "amazon",
  "at&t",
  "best buy",
  "costco",
  "delta",
  "starbucks",
  "mcdonald's",
  "panda express",
  "chipotle",
  "raising cane's",
  "habanero taco gril",
  "winco",
  "walmart",
  "target",
  "arco",
  "dales sinclair",
  "anthropic",
  "godaddy",
  "cursor",
  "stamps.com",
  "credit one bank",
  "true value",
  "starlink",
  // People (rent, personal)
  "jb hart rent 674 wells rd",
  "jenny mannerheim",
  "mannerheim & others",
  "sebastien",
  "talia brown",
  "lacianne roark",
  "dennis konkin",
  "lasaro corporation",
  "miami rent",
  "el geez",
  "jacob resort c/o jake schmillen",
  // Financial
  "irs",
  "overdraft fee",
  "overdraft fee for",
  "foreign transaction fee",
  // Other
  "fbm",
  "offer up purchase",
  "stormlikes",
  "usps",
  "shell",
  "chevron",
  "7-eleven",
  "parkup parking app",
  "matthew rodriguez",
  "jeff dages",
  "david parker",
]);

// Description patterns that indicate non-vehicle purchases
const EXCLUDED_DESC_PATTERNS = [
  /apple\.com\/bill/i,
  /amazon prime/i,
  /prime video/i,
  /overdraft fee/i,
  /overdrawn eft/i,
  /domain name renewal/i,
  /skylarphoto\.com/i,
  /skylarwilliams\.com/i,
  /engine-lite\.com/i,
  /interest paid/i,
  /credit card interest/i,
  /taco bell/i,
  /starbucks/i,
  /mcdonald/i,
  /albertsons/i,
  /panda express/i,
  /att\* bill/i,
  /apple cash sent/i,
  /microsoft/i,
  /anthropic/i,
  /cursor usage/i,
  /godaddy/i,
  /stamps\.com/i,
  /starlink/i,
  /bristol west insur/i,
  /brochure/i, // Brochures are collectibles, not parts
];

// ── Matching rules ──────────────────────────────────────────────────────────
// Each rule maps QB purchase data to manifest device(s)

/**
 * Rule structure:
 *   match: function(purchase, lines) => boolean
 *   devices: array of device_name strings to match in manifest
 *   price_from: 'total' | 'line' | number (fixed) | function(purchase) => number
 *   line_index: which line to pull price from (if price_from === 'line')
 *   reason: human-readable match reason
 */

const MATCH_RULES = [
  // ── Delmo Speed $164 → Electronic Throttle Body ──
  {
    match: (p) => {
      const vendor = vendorName(p);
      return vendor.includes("delmo speed") && Math.abs(p.TotalAmt - 164) < 2;
    },
    devices: ["Electronic Throttle Body"],
    price_from: "total",
    reason: "Delmo Speed purchase matches ETB supplier",
  },

  // ── Delmo Speed $662 PayPal → Starter Motor (Delmo/GM manufacturer) ──
  {
    match: (p) => {
      const desc = allText(p);
      return desc.includes("delmospeed") && Math.abs(p.TotalAmt - 662) < 2;
    },
    devices: ["Starter Motor"],
    price_from: "total",
    reason: "Delmospeed PayPal $662 — Delmo/GM starter motor",
  },

  // ── Holley Performance $1,597 → engine management parts ──
  {
    match: (p) => {
      const desc = allText(p);
      return desc.includes("holley performance") && p.TotalAmt > 1500 && p.TotalAmt < 1700;
    },
    devices: [], // Can't determine exact parts without item breakdown
    price_from: "total",
    reason: "Holley Performance $1,597 — major engine management order (fuel/ignition parts), no specific device match without itemization",
  },

  // ── Holley Performance $82 ──
  {
    match: (p) => {
      const desc = allText(p);
      return desc.includes("holley performance") && p.TotalAmt > 75 && p.TotalAmt < 90;
    },
    devices: [], // Unmatched — could be various engine accessories
    price_from: "total",
    reason: "Holley Performance $82 — generic engine parts, no specific device match",
  },

  // ── Holley Performance $15 ──
  {
    match: (p) => {
      const desc = allText(p);
      return desc.includes("holley performance") && p.TotalAmt < 20;
    },
    devices: [],
    price_from: "total",
    reason: "Holley Performance $15 — small part/accessory, no specific device match",
  },

  // ── PayPal brake lines $213 total (multi-line) ──
  // Line items: $165 disc brake line kit, $22.50 clip kit, $22.50 shipping, $3 insurance
  {
    match: (p) => {
      return (
        p.Id === "3451" ||
        (hasLine(p, "brake line") && hasLine(p, "clip kit"))
      );
    },
    devices: [], // Brake lines aren't in the wiring manifest (they're hydraulic, not electrical)
    price_from: "total",
    reason:
      "PayPal brake line kit + clip kit — hydraulic lines, not in wiring manifest",
  },

  // ── Discount Tire $1,103 ──
  {
    match: (p) => {
      const vendor = vendorName(p);
      return vendor.includes("discount tire");
    },
    devices: [], // Tires aren't in the build manifest (it's a wiring manifest)
    price_from: "total",
    reason: "Discount Tire — tires not in wiring manifest",
  },

  // ── Tom's Off Road ──
  {
    match: (p) => {
      const desc = allText(p);
      return (
        vendorName(p).includes("toms off road") ||
        desc.includes("tomsoffroad")
      );
    },
    devices: [], // Generic off-road parts — can't determine specific device without item descriptions
    price_from: "total",
    reason: "Tom's Off Road — off-road parts, no specific device match without item detail",
  },

  // ── Lesa's Autobody Supplies ──
  {
    match: (p) => {
      const desc = allText(p);
      return (
        vendorName(p).includes("lesa") || desc.includes("lesas auto body")
      );
    },
    devices: [],
    price_from: "total",
    reason: "Lesa's Autobody — body supplies, not wiring manifest devices",
  },

  // ── LMC Truck ──
  {
    match: (p) => {
      return allText(p).includes("lmc truck");
    },
    devices: [],
    price_from: "total",
    reason: "LMC Truck — truck parts, no specific device match without item detail",
  },

  // ── Classic Parts of America ──
  {
    match: (p) => {
      return allText(p).includes("classic parts");
    },
    devices: [],
    price_from: "total",
    reason: "Classic Parts of America — restoration parts",
  },

  // ── Truck Shop Car Shop ──
  {
    match: (p) => {
      return allText(p).includes("truck shop car shop");
    },
    devices: [],
    price_from: "total",
    reason: "Truck Shop Car Shop — generic truck parts",
  },

  // ── 1977 Blazer brochure (PayPal) — collectible, not a part ──
  {
    match: (p) => {
      const desc = allText(p);
      return desc.includes("1977 chevrolet blazer") && desc.includes("brochure");
    },
    devices: [],
    price_from: "total",
    reason: "1977 Blazer brochure — collectible/reference, not a vehicle part",
  },

  // ── AutoZone purchases — consumables/generic parts ──
  {
    match: (p) => {
      const vendor = vendorName(p);
      const desc = allText(p);
      return vendor.includes("autozone") || desc.includes("autozone");
    },
    devices: [], // Consumables (fluids, filters, bulbs, etc.) — not in wiring manifest
    price_from: "total",
    reason: "AutoZone — consumables/generic parts, not specific manifest devices",
  },

  // ── O'Reilly purchases ──
  {
    match: (p) => {
      const vendor = vendorName(p);
      const desc = allText(p);
      return vendor.includes("o'reilly") || desc.includes("o'reilly");
    },
    devices: [],
    price_from: "total",
    reason: "O'Reilly Auto Parts — consumables/generic parts",
  },

  // ── eBay purchases — generic, can't match without item descriptions ──
  {
    match: (p) => {
      return vendorName(p).includes("ebay");
    },
    devices: [],
    price_from: "total",
    reason: "eBay — various parts, no item-level detail to match specific devices",
  },

  // ── Carquest purchases — local auto parts ──
  {
    match: (p) => {
      const desc = allText(p);
      return vendorName(p).includes("carquest") || desc.includes("carquest");
    },
    devices: [],
    price_from: "total",
    reason: "Carquest — auto parts, consumables",
  },

  // ── 1A Auto ──
  {
    match: (p) => allText(p).includes("1a auto"),
    devices: [],
    price_from: "total",
    reason: "1A Auto — auto parts",
  },

  // ── CARiD ──
  {
    match: (p) => allText(p).includes("carid.com"),
    devices: [],
    price_from: "total",
    reason: "CARiD — auto parts/accessories",
  },

  // ── Auto Metal Direct (AMD) ──
  {
    match: (p) => allText(p).includes("amd website order"),
    devices: [],
    price_from: "total",
    reason: "Auto Metal Direct — body/trim parts",
  },

  // ── Summit Racing ──
  {
    match: (p) => allText(p).includes("summit") && allText(p).includes("800-517"),
    devices: [],
    price_from: "total",
    reason: "Summit Racing — performance parts",
  },

  // ── Parts Geek ──
  {
    match: (p) => allText(p).includes("parts geek"),
    devices: [],
    price_from: "total",
    reason: "Parts Geek — auto parts",
  },

  // ── Advance Auto Parts ──
  {
    match: (p) => allText(p).includes("advanceautopar"),
    devices: [],
    price_from: "total",
    reason: "Advance Auto Parts — auto parts",
  },

  // ── Nevada Pic-A-Part ──
  {
    match: (p) => allText(p).includes("pic a part"),
    devices: [],
    price_from: "total",
    reason: "Nevada Pic-A-Part — salvage yard parts",
  },

  // ── DMV — registration/fees ──
  {
    match: (p) => vendorName(p).includes("dmv") || allText(p).includes("dmv-"),
    devices: [],
    price_from: "total",
    reason: "DMV — vehicle registration/fees",
  },

  // ── SMS Auto Fabrics — upholstery/interior ──
  {
    match: (p) => allText(p).includes("sms auto fabrics"),
    devices: [],
    price_from: "total",
    reason: "SMS Auto Fabrics — upholstery/interior materials",
  },

  // ── Dennis Carpenter — reproduction parts ──
  {
    match: (p) => allText(p).includes("dennis carpenter"),
    devices: [],
    price_from: "total",
    reason: "Dennis Carpenter — reproduction truck parts",
  },

  // ── CJ Pony Parts ──
  {
    match: (p) => allText(p).includes("cj pony parts"),
    devices: [],
    price_from: "total",
    reason: "CJ Pony Parts — restoration parts",
  },

  // ── Classic Industries ──
  {
    match: (p) => allText(p).includes("classic industries"),
    devices: [],
    price_from: "total",
    reason: "Classic Industries — restoration parts",
  },

  // ── Carbs Unlimited ──
  {
    match: (p) => allText(p).includes("carbs unlimited"),
    devices: [],
    price_from: "total",
    reason: "Carbs Unlimited — carburetor/fuel parts",
  },

  // ── Dales Sinclair — gas station ──
  {
    match: (p) => allText(p).includes("dales sinclair") || allText(p).includes("sinclair noho"),
    devices: [],
    price_from: "total",
    reason: "Gas station — fuel, not vehicle parts",
  },
];

// ── Helper functions ────────────────────────────────────────────────────────

function vendorName(p) {
  return (p.EntityRef?.name || "").toLowerCase().trim();
}

function allText(p) {
  const parts = [
    p.EntityRef?.name || "",
    p.PrivateNote || "",
    ...(p.Line || []).map((l) => l.Description || ""),
  ];
  return parts.join(" ").toLowerCase();
}

function hasLine(p, keyword) {
  return (p.Line || []).some((l) =>
    (l.Description || "").toLowerCase().includes(keyword.toLowerCase())
  );
}

function isVehicleRelated(p) {
  const vendor = vendorName(p);
  const desc = allText(p);

  // Check exclusion list
  if (EXCLUDED_VENDORS.has(vendor)) return false;
  for (const pattern of EXCLUDED_DESC_PATTERNS) {
    if (pattern.test(desc)) return false;
  }

  // Additional exclusion patterns for common non-vehicle PayPal/eBay noise
  const noisePatterns = [
    /paypal here transaction/i,
    /paid to$/i,
    /paid to\s*$/i,
    /^paid to\s*$/i,
    /credit card withdrawal/i,
    /bill me later/i,
    /shipstation/i,
    /auctane/i,
    /google youtube/i,
    /utility billing/i,
    /paypal \*williams/i,
    /paypal \*teenykee/i,
    /elementor pro/i,
    /motors pro plugin/i,
    /carfax/i,
    /walgreens/i,
    /winco/i,
    /7-eleven/i,
    /chevron/i,
    /wal-mart/i,
    /walmart/i,
    /target/i,
    /cvs\/pharmacy/i,
    /frost science/i,
    /big beautiful/i,
    /popie/i,
    /highlights stockholm/i,
    /ikea/i,
    /coop zinken/i,
    /viena snacks/i,
    /vinnys little/i,
    /konditori/i,
    /lilla italia/i,
    /galina/i,
    /booking\.com/i,
    /u-haul/i,
    /ls second chance/i,
    /rockautollc/i,  // RockAuto is a parts store but can't match to specific devices
    /shell service station/i,
    /shell oil/i,
    /parking meter/i,
    /parkup parking/i,
    /atm withdrawal/i,
    /lidl /i,
    /superett/i,
    /short line marke/i,
    /alipayusinc/i,
    /matthew rodriguez/i,
    /jeffrey dages/i,
    /david parker/i,
    /laura wynne/i,
    /edwin flores/i,
    /jon grunendik/i,
    /matthew mcatee/i,
    /mpa parking/i,
    /plaza parking/i,
    /economy park/i,
    /smiths fuel/i,
    /coop sodra/i,
    /pay by phone/i,
  ];
  for (const pattern of noisePatterns) {
    if (pattern.test(desc)) return false;
  }

  // Check if categorized as vehicle expenses in QB
  const isVehicleExpense = (p.Line || []).some(
    (l) =>
      l.AccountBasedExpenseLineDetail?.AccountRef?.name
        ?.toLowerCase()
        .includes("vehicle") || false
  );
  if (isVehicleExpense) return true;

  // Definite auto parts stores (vendor name match)
  const autoPartsVendors = [
    "autozone",
    "o'reilly auto parts",
    "holley",
    "delmo speed",
    "discount tire",
    "toms off road",
    "lesa's autobody",
  ];
  if (autoPartsVendors.some((v) => vendor.includes(v))) return true;

  // Vehicle-related keywords in description (must be specific)
  const vehicleKeywords = [
    "holley performance",
    "delmo",
    "delmospeed",
    "tomsoffroad",
    "lmc truck",
    "classic parts of america",
    "truck shop car shop",
    "lesas auto body",
    "brake line",
    "disc brake",
    "blazer",
    "chevrolet",
    "4wd",
    "k-series",
  ];
  if (vehicleKeywords.some((k) => desc.includes(k))) return true;

  // eBay and PayPal are marketplaces — only include if explicitly
  // categorized as vehicle expense (handled above) or matched by a rule
  // Don't auto-include them as "vehicle related"

  return false;
}

function formatDate(dateStr) {
  if (!dateStr) return "unknown";
  return dateStr;
}

function formatMoney(amt) {
  return "$" + (amt || 0).toFixed(2);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(70));
  console.log("QuickBooks → Build Manifest Matcher");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (use --apply to update DB)" : "APPLYING CHANGES"}`);
  console.log("=".repeat(70));

  // 1. Load QB data
  console.log("\nLoading QB purchases...");
  const qbData = JSON.parse(readFileSync(QB_DATA_PATH, "utf8"));
  const allPurchases = qbData.purchases.raw;
  console.log(`  Total QB purchases: ${allPurchases.length}`);

  // 2. Load manifest devices
  console.log("Loading build manifest...");
  const { data: manifest, error: manifestErr } = await sb
    .from("vehicle_build_manifest")
    .select("*")
    .eq("vehicle_id", VEHICLE_ID)
    .order("device_name");

  if (manifestErr) {
    console.error("Failed to load manifest:", manifestErr);
    process.exit(1);
  }
  console.log(`  Manifest devices: ${manifest.length}`);

  const alreadyPurchased = manifest.filter((d) => d.purchased);
  const notPurchased = manifest.filter((d) => !d.purchased);
  console.log(
    `  Already purchased: ${alreadyPurchased.length}, Not yet: ${notPurchased.length}`
  );

  // 3. Filter to vehicle-related purchases
  const vehiclePurchases = allPurchases.filter(isVehicleRelated);
  console.log(`  Vehicle-related purchases: ${vehiclePurchases.length}`);

  // 4. Run matching rules
  console.log("\n" + "─".repeat(70));
  console.log("MATCHING RESULTS");
  console.log("─".repeat(70));

  const matched = []; // { device, purchase, price, reason, invoice_ref }
  const unmatchedPurchases = []; // QB purchases that didn't match any device
  const vehicleSpend = []; // All vehicle-related purchases for totaling
  const ruleMatched = new Set(); // QB purchase IDs matched by rules

  // Apply explicit rules first
  for (const rule of MATCH_RULES) {
    for (const p of allPurchases) {
      if (ruleMatched.has(p.Id)) continue;
      try {
        if (rule.match(p)) {
          ruleMatched.add(p.Id);
          if (rule.devices.length > 0) {
            for (const deviceName of rule.devices) {
              const device = manifest.find(
                (d) =>
                  d.device_name.toLowerCase() === deviceName.toLowerCase()
              );
              if (device) {
                const price =
                  rule.price_from === "total"
                    ? p.TotalAmt
                    : rule.price_from === "line"
                      ? (p.Line?.[rule.line_index]?.Amount ?? p.TotalAmt)
                      : typeof rule.price_from === "function"
                        ? rule.price_from(p)
                        : rule.price_from;

                matched.push({
                  device,
                  purchase: p,
                  price,
                  reason: rule.reason,
                  invoice_ref: `QB-${p.Id} ${formatDate(p.TxnDate)}`,
                });
              } else {
                console.log(
                  `  WARNING: Rule device "${deviceName}" not found in manifest`
                );
              }
            }
          } else {
            // Rule matched but no device — it's a recognized vehicle purchase
            unmatchedPurchases.push({
              purchase: p,
              reason: rule.reason,
            });
          }
          vehicleSpend.push({
            purchase: p,
            reason: rule.reason,
            matched: rule.devices.length > 0,
          });
        }
      } catch (e) {
        // Rule didn't match, skip
      }
    }
  }

  // 5. Fuzzy matching: try to match remaining vehicle purchases to manifest
  for (const p of vehiclePurchases) {
    if (ruleMatched.has(p.Id)) continue;

    const vendor = vendorName(p);
    const desc = allText(p);
    let didMatch = false;

    // Try vendor → supplier match
    for (const device of notPurchased) {
      if (!device.supplier) continue;
      const supplierLower = device.supplier.toLowerCase();
      if (
        vendor &&
        vendor.length > 3 &&
        (supplierLower.includes(vendor) || vendor.includes(supplierLower))
      ) {
        matched.push({
          device,
          purchase: p,
          price: p.TotalAmt,
          reason: `Vendor "${vendor}" matches supplier "${device.supplier}"`,
          invoice_ref: `QB-${p.Id} ${formatDate(p.TxnDate)}`,
        });
        didMatch = true;
        break;
      }
    }

    // Try manufacturer match in description
    if (!didMatch) {
      for (const device of notPurchased) {
        if (!device.manufacturer) continue;
        const mfgLower = device.manufacturer.toLowerCase();
        // Only match if manufacturer name is specific enough (>4 chars)
        if (mfgLower.length > 4 && desc.includes(mfgLower)) {
          matched.push({
            device,
            purchase: p,
            price: p.TotalAmt,
            reason: `Description contains manufacturer "${device.manufacturer}"`,
            invoice_ref: `QB-${p.Id} ${formatDate(p.TxnDate)}`,
          });
          didMatch = true;
          break;
        }
      }
    }

    // Try part number match
    if (!didMatch) {
      for (const device of notPurchased) {
        if (!device.part_number || device.part_number.includes("integrated"))
          continue;
        if (desc.includes(device.part_number.toLowerCase())) {
          matched.push({
            device,
            purchase: p,
            price: p.TotalAmt,
            reason: `Description contains part number "${device.part_number}"`,
            invoice_ref: `QB-${p.Id} ${formatDate(p.TxnDate)}`,
          });
          didMatch = true;
          break;
        }
      }
    }

    if (!didMatch) {
      unmatchedPurchases.push({
        purchase: p,
        reason: "No matching rule or fuzzy match",
      });
    }

    vehicleSpend.push({
      purchase: p,
      reason: didMatch ? "fuzzy match" : "unmatched vehicle purchase",
      matched: didMatch,
    });
  }

  // 6. Print results
  console.log(`\n${"=".repeat(70)}`);
  console.log("MATCHED PURCHASES → MANIFEST DEVICES");
  console.log("=".repeat(70));

  if (matched.length === 0) {
    console.log("  No matches found.");
  }

  const updates = [];
  for (const m of matched) {
    const d = m.device;
    const p = m.purchase;
    const oldPrice = d.price;
    const newPrice = m.price;
    const alreadyBought = d.purchased;

    console.log(`\n  [MATCH] ${d.device_name}`);
    console.log(`    Vendor:     ${p.EntityRef?.name || "N/A"}`);
    console.log(`    QB ID:      ${p.Id} (${formatDate(p.TxnDate)})`);
    console.log(`    Amount:     ${formatMoney(newPrice)}`);
    console.log(`    Reason:     ${m.reason}`);
    if (alreadyBought) {
      console.log(
        `    Status:     ALREADY PURCHASED (invoice: ${d.invoice_ref})`
      );
      console.log(`    Action:     SKIP — already has purchase data`);
    } else {
      console.log(
        `    Old price:  ${oldPrice != null ? formatMoney(oldPrice) : "null"} (${d.price_source || "none"})`
      );
      console.log(`    Action:     UPDATE → purchased=true, price=${formatMoney(newPrice)}, source=quickbooks`);

      updates.push({
        id: d.id,
        device_name: d.device_name,
        purchased: true,
        price: newPrice,
        price_source: "quickbooks",
        invoice_ref: m.invoice_ref,
        status: "purchased",
      });
    }
  }

  // 7. Print unmatched vehicle purchases
  console.log(`\n${"=".repeat(70)}`);
  console.log("UNMATCHED VEHICLE PURCHASES (recognized but no manifest device)");
  console.log("=".repeat(70));

  for (const u of unmatchedPurchases) {
    const p = u.purchase;
    const vendor = p.EntityRef?.name || "N/A";
    const desc = (p.Line?.[0]?.Description || p.PrivateNote || "").slice(
      0,
      100
    );
    console.log(
      `\n  ${formatMoney(p.TotalAmt)}  ${vendor}  (${formatDate(p.TxnDate)}, QB-${p.Id})`
    );
    console.log(`    ${desc}`);
    console.log(`    Reason: ${u.reason}`);
  }

  // 8. Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log("=".repeat(70));

  const totalDocumented = vehicleSpend.reduce(
    (sum, v) => sum + v.purchase.TotalAmt,
    0
  );
  const totalMatched = matched.reduce((sum, m) => sum + m.price, 0);
  const totalUnmatched = unmatchedPurchases.reduce(
    (sum, u) => sum + u.purchase.TotalAmt,
    0
  );
  const alreadyPurchasedCount = matched.filter(
    (m) => m.device.purchased
  ).length;
  const newMatchCount = updates.length;

  // Also compute all known Autozone, eBay, O'Reilly totals for context
  const autozonePurchases = allPurchases.filter(
    (p) =>
      vendorName(p).includes("autozone") ||
      allText(p).includes("autozone")
  );
  const oreillylPurchases = allPurchases.filter(
    (p) =>
      vendorName(p).includes("o'reilly") ||
      allText(p).includes("o'reilly")
  );
  const ebayPurchases = allPurchases.filter(
    (p) => vendorName(p).includes("ebay")
  );
  const holleyPurchases = allPurchases.filter(
    (p) => allText(p).includes("holley performance")
  );
  const tomsPurchases = allPurchases.filter(
    (p) =>
      vendorName(p).includes("toms off") ||
      allText(p).includes("tomsoffroad")
  );
  const delmoPurchases = allPurchases.filter(
    (p) => allText(p).includes("delmo")
  );

  console.log(`\n  QB purchases scanned:          ${allPurchases.length}`);
  console.log(`  Vehicle-related identified:    ${vehiclePurchases.length + [...ruleMatched].filter(id => !vehiclePurchases.some(p => p.Id === id)).length}`);
  console.log(`  Matched to manifest devices:   ${matched.length}`);
  console.log(`    Already purchased (skip):    ${alreadyPurchasedCount}`);
  console.log(`    New updates to apply:        ${newMatchCount}`);
  console.log(`  Unmatched vehicle purchases:   ${unmatchedPurchases.length}`);
  console.log();
  console.log(`  Total documented vehicle spend:  ${formatMoney(totalDocumented)}`);
  console.log(`  Matched to devices:              ${formatMoney(totalMatched)}`);
  console.log(`  Unmatched vehicle spend:          ${formatMoney(totalUnmatched)}`);
  console.log();
  console.log(`  Key vendor totals:`);
  console.log(`    Holley Performance:  ${formatMoney(holleyPurchases.reduce((s, p) => s + p.TotalAmt, 0))} (${holleyPurchases.length} txns)`);
  console.log(`    Delmo Speed:         ${formatMoney(delmoPurchases.reduce((s, p) => s + p.TotalAmt, 0))} (${delmoPurchases.length} txns)`);
  console.log(`    Tom's Off Road:      ${formatMoney(tomsPurchases.reduce((s, p) => s + p.TotalAmt, 0))} (${tomsPurchases.length} txns)`);
  console.log(`    eBay:                ${formatMoney(ebayPurchases.reduce((s, p) => s + p.TotalAmt, 0))} (${ebayPurchases.length} txns)`);
  console.log(`    AutoZone:            ${formatMoney(autozonePurchases.reduce((s, p) => s + p.TotalAmt, 0))} (${autozonePurchases.length} txns)`);
  console.log(`    O'Reilly:            ${formatMoney(oreillylPurchases.reduce((s, p) => s + p.TotalAmt, 0))} (${oreillylPurchases.length} txns)`);
  console.log(`    Discount Tire:       $1,103.44 (1 txn)`);

  // 9. Apply updates
  if (updates.length > 0) {
    console.log(`\n${"─".repeat(70)}`);
    if (DRY_RUN) {
      console.log("DRY RUN — No changes made. Use --apply to update the database.");
      console.log(`\nUpdates that would be applied (${updates.length}):`);
      for (const u of updates) {
        console.log(
          `  ${u.device_name}: purchased=true, price=${formatMoney(u.price)}, source=quickbooks, ref=${u.invoice_ref}`
        );
      }
    } else {
      console.log(`APPLYING ${updates.length} updates...`);
      let successCount = 0;
      let failCount = 0;

      for (const u of updates) {
        const { error } = await sb
          .from("vehicle_build_manifest")
          .update({
            purchased: u.purchased,
            price: u.price,
            price_source: u.price_source,
            invoice_ref: u.invoice_ref,
            status: u.status,
          })
          .eq("id", u.id);

        if (error) {
          console.error(`  FAILED: ${u.device_name} — ${error.message}`);
          failCount++;
        } else {
          console.log(`  OK: ${u.device_name} → ${formatMoney(u.price)} (${u.invoice_ref})`);
          successCount++;
        }
      }

      console.log(`\nDone: ${successCount} updated, ${failCount} failed.`);
    }
  } else {
    console.log("\nNo new updates to apply — all matches were already purchased.");
  }

  // 10. Verbose: show all vehicle-related QB purchases
  if (VERBOSE) {
    console.log(`\n${"=".repeat(70)}`);
    console.log("ALL VEHICLE-RELATED QB PURCHASES");
    console.log("=".repeat(70));
    for (const p of vehiclePurchases) {
      const vendor = p.EntityRef?.name || "N/A";
      const desc = (p.Line?.[0]?.Description || p.PrivateNote || "").slice(
        0,
        120
      );
      const wasMatched = matched.some((m) => m.purchase.Id === p.Id);
      console.log(
        `  ${wasMatched ? "[M]" : "[ ]"} ${formatMoney(p.TotalAmt).padStart(10)}  ${vendor.padEnd(30)}  ${formatDate(p.TxnDate)}  QB-${p.Id}`
      );
      console.log(`       ${desc}`);
    }
  }

  console.log();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
