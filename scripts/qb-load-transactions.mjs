#!/usr/bin/env node
/**
 * qb-load-transactions.mjs
 *
 * Loads 2,695 purchase line items from QB export into qb_transactions table.
 * Applies initial categorization and vehicle attribution confidence scoring.
 *
 * Usage: dotenvx run -- node scripts/qb-load-transactions.mjs
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const K5_VEHICLE_ID = 'e04bf9c5-b488-433b-be9a-3d307861d90b';
const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';

// ---------------------------------------------------------------------------
// Categorization rules
// ---------------------------------------------------------------------------

/**
 * Vendor-based categorization. Checked against lowercased vendor_name.
 * Returns { category, confidence } or null if no match.
 */
const VENDOR_RULES = [
  // K5-specific shops — highest confidence
  { pattern: /delmo speed/i,              category: 'vehicle_part', confidence: 0.9 },
  { pattern: /tom.?s off.?road/i,         category: 'vehicle_part', confidence: 0.9 },
  { pattern: /lesa.?s autobody/i,         category: 'vehicle_part', confidence: 0.9 },
  { pattern: /discount tire/i,            category: 'vehicle_part', confidence: 0.9 },

  // Auto parts stores
  { pattern: /autozone/i,                 category: 'vehicle_part', confidence: 0.7 },
  { pattern: /o.?reilly auto/i,           category: 'vehicle_part', confidence: 0.7 },
  { pattern: /carquest/i,                 category: 'vehicle_part', confidence: 0.7 },
  { pattern: /carfax/i,                   category: 'vehicle_part', confidence: 0.5 },

  // Holley / performance
  { pattern: /holley/i,                   category: 'vehicle_part', confidence: 0.5 },

  // Tools
  { pattern: /kellie smith|snap.?on/i,    category: 'tool',         confidence: 0.3 },
  { pattern: /harbor freight/i,           category: 'tool',         confidence: 0.3 },
  { pattern: /true value/i,              category: 'tool',         confidence: 0.3 },
  { pattern: /ace hardware/i,             category: 'tool',         confidence: 0.3 },

  // Vehicle services
  { pattern: /smog vets/i,                category: 'service',      confidence: 0.7 },
  { pattern: /dmv/i,                      category: 'service',      confidence: 0.7 },
  { pattern: /boulder pit stop/i,         category: 'service',      confidence: 0.7 },
  { pattern: /dales sinclair/i,           category: 'service',      confidence: 0.5 },
  { pattern: /uhaul/i,                    category: 'service',      confidence: 0.2 },

  // Personal — food
  { pattern: /taco bell/i,                category: 'personal',     confidence: 0.0 },
  { pattern: /mcdonald/i,                 category: 'personal',     confidence: 0.0 },
  { pattern: /starbucks/i,               category: 'personal',     confidence: 0.0 },
  { pattern: /chipotle/i,                category: 'personal',     confidence: 0.0 },
  { pattern: /panda express/i,            category: 'personal',     confidence: 0.0 },
  { pattern: /little caesars/i,           category: 'personal',     confidence: 0.0 },
  { pattern: /dairy queen/i,              category: 'personal',     confidence: 0.0 },
  { pattern: /popeye/i,                   category: 'personal',     confidence: 0.0 },
  { pattern: /arby/i,                     category: 'personal',     confidence: 0.0 },
  { pattern: /raising cane/i,             category: 'personal',     confidence: 0.0 },
  { pattern: /tropical smoothie/i,        category: 'personal',     confidence: 0.0 },
  { pattern: /habanero taco/i,            category: 'personal',     confidence: 0.0 },
  { pattern: /fox smokehous/i,            category: 'personal',     confidence: 0.0 },
  { pattern: /jasons deli/i,              category: 'personal',     confidence: 0.0 },
  { pattern: /big t.?s cantina/i,         category: 'personal',     confidence: 0.0 },
  { pattern: /uber eats/i,               category: 'personal',     confidence: 0.0 },
  { pattern: /a&w/i,                      category: 'personal',     confidence: 0.0 },
  { pattern: /coffee cup/i,              category: 'personal',     confidence: 0.0 },
  { pattern: /albertsons/i,               category: 'personal',     confidence: 0.0 },
  { pattern: /7-eleven/i,                category: 'personal',     confidence: 0.0 },
  { pattern: /walmart/i,                 category: 'personal',     confidence: 0.0 },
  { pattern: /target$/i,                 category: 'personal',     confidence: 0.0 },
  { pattern: /costco/i,                  category: 'personal',     confidence: 0.0 },
  { pattern: /winco/i,                   category: 'personal',     confidence: 0.0 },
  { pattern: /vons/i,                    category: 'personal',     confidence: 0.0 },
  { pattern: /99 cents only/i,            category: 'personal',     confidence: 0.0 },
  { pattern: /kmart/i,                   category: 'personal',     confidence: 0.0 },
  { pattern: /marshalls/i,              category: 'personal',     confidence: 0.0 },

  // Personal — streaming / subscriptions / phone / rent
  { pattern: /hulu/i,                    category: 'personal',     confidence: 0.0 },
  { pattern: /disney/i,                  category: 'personal',     confidence: 0.0 },
  { pattern: /at&t/i,                    category: 'personal',     confidence: 0.0 },
  { pattern: /prime video/i,             category: 'personal',     confidence: 0.0 },
  { pattern: /stormlikes/i,             category: 'personal',     confidence: 0.0 },
  { pattern: /regal cinema/i,           category: 'personal',     confidence: 0.0 },
  { pattern: /miami rent/i,             category: 'personal',     confidence: 0.0 },
  { pattern: /jb hart rent/i,           category: 'personal',     confidence: 0.0 },

  // Personal — travel (not vehicle-related)
  { pattern: /delta$/i,                  category: 'personal',     confidence: 0.0 },
  { pattern: /united$/i,                category: 'personal',     confidence: 0.0 },
  { pattern: /lufthansa/i,             category: 'personal',     confidence: 0.0 },
  { pattern: /frontier air/i,           category: 'personal',     confidence: 0.0 },
  { pattern: /uber$/i,                  category: 'personal',     confidence: 0.0 },

  // Personal — medical
  { pattern: /doctor$/i,                 category: 'personal',     confidence: 0.0 },
  { pattern: /pharmagustavia/i,         category: 'personal',     confidence: 0.0 },

  // Gas stations (could be vehicle OR personal)
  { pattern: /arco/i,                    category: 'vehicle_fuel',  confidence: 0.4 },
  { pattern: /shell/i,                   category: 'vehicle_fuel',  confidence: 0.4 },
  { pattern: /chevron/i,                category: 'vehicle_fuel',  confidence: 0.4 },
  { pattern: /circle k/i,              category: 'vehicle_fuel',  confidence: 0.4 },
];

/**
 * Memo/description-based categorization for null-vendor items.
 * Checked against lowercased memo or line_description.
 */
const MEMO_RULES = [
  { pattern: /autozone/i,               category: 'vehicle_part', confidence: 0.7 },
  { pattern: /o.?reilly auto/i,         category: 'vehicle_part', confidence: 0.7 },

  // Apple/Amazon/Microsoft subscriptions from memo
  { pattern: /apple\.com\/bill/i,        category: 'personal',     confidence: 0.0 },
  { pattern: /amazon prime/i,           category: 'personal',     confidence: 0.0 },
  { pattern: /amazon web services|aws\.amazon/i, category: 'business_saas', confidence: 0.0 },
  { pattern: /paypal \*microsoft/i,     category: 'business_saas', confidence: 0.0 },
  { pattern: /amazon mark/i,            category: 'unknown',       confidence: 0.0 },
  { pattern: /apple cash sent/i,        category: 'personal',     confidence: 0.0 },
  { pattern: /funds transfer/i,         category: 'transfer',     confidence: 0.0 },
  { pattern: /share draft/i,            category: 'transfer',     confidence: 0.0 },
];

/**
 * Account-name-based fallback categorization.
 */
const ACCOUNT_RULES = [
  { pattern: /^vehicle expenses/i,                         category: 'vehicle_part', confidence: 0.6 },
  { pattern: /^vehicle expenses:vehicle gas/i,             category: 'vehicle_fuel', confidence: 0.5 },
  { pattern: /^vehicle expenses:vehicle repairs/i,         category: 'vehicle_part', confidence: 0.7 },
  { pattern: /^vehicle expenses:parking/i,                 category: 'service',      confidence: 0.3 },
  { pattern: /^tools, machinery/i,                         category: 'tool',         confidence: 0.3 },
  { pattern: /^office expenses:small tools/i,              category: 'tool',         confidence: 0.3 },
  { pattern: /^supplies/i,                                 category: 'vehicle_part', confidence: 0.4 },
  { pattern: /^meals/i,                                    category: 'personal',     confidence: 0.0 },
  { pattern: /^building & property rent/i,                 category: 'personal',     confidence: 0.0 },
  { pattern: /^personal/i,                                 category: 'personal',     confidence: 0.0 },
  { pattern: /^insurance/i,                                category: 'personal',     confidence: 0.0 },
  { pattern: /^interest paid/i,                            category: 'personal',     confidence: 0.0 },
  { pattern: /^owner draws/i,                              category: 'personal',     confidence: 0.0 },
  { pattern: /^advertising/i,                              category: 'business',     confidence: 0.0 },
  { pattern: /^contract labor/i,                           category: 'service',      confidence: 0.3 },
  { pattern: /^office expenses:software/i,                 category: 'business_saas', confidence: 0.0 },
  { pattern: /^office expenses:shipping/i,                 category: 'business',     confidence: 0.0 },
  { pattern: /^utilities:internet/i,                       category: 'personal',     confidence: 0.0 },
  { pattern: /^utilities:phone/i,                          category: 'personal',     confidence: 0.0 },
  { pattern: /^travel/i,                                   category: 'personal',     confidence: 0.0 },
  { pattern: /^general business/i,                         category: 'business',     confidence: 0.0 },
  { pattern: /^inventory asset/i,                          category: 'vehicle_part', confidence: 0.5 },
  { pattern: /^cost of goods/i,                            category: 'vehicle_part', confidence: 0.5 },
  { pattern: /^repairs & maintenance/i,                    category: 'vehicle_part', confidence: 0.6 },
  { pattern: /^equipment rental/i,                         category: 'tool',         confidence: 0.2 },
];

/**
 * Categorize a single line item.
 * Returns { category, confidence, signals }.
 */
function categorize(item) {
  const vendor = item.vendor_name || '';
  const memo = item.memo || item.line_description || '';
  const account = item.line_account_name || '';
  const amount = parseFloat(item.line_amount) || 0;
  const signals = [];

  // 1. Vendor match (highest priority)
  for (const rule of VENDOR_RULES) {
    if (rule.pattern.test(vendor)) {
      signals.push({ source: 'vendor', match: vendor, rule: rule.pattern.source });
      return { category: rule.category, confidence: rule.confidence, signals };
    }
  }

  // 2. Memo/description match for null-vendor items
  if (!vendor) {
    for (const rule of MEMO_RULES) {
      if (rule.pattern.test(memo)) {
        signals.push({ source: 'memo', match: memo.substring(0, 60), rule: rule.pattern.source });
        return { category: rule.category, confidence: rule.confidence, signals };
      }
    }
  }

  // 3. eBay special handling
  if (/ebay/i.test(vendor) || /ebay/i.test(memo)) {
    signals.push({ source: 'vendor', match: 'ebay' });
    if (amount > 50) {
      signals.push({ source: 'amount', match: `$${amount} > $50` });
      return { category: 'vehicle_part', confidence: 0.6, signals };
    }
    return { category: 'vehicle_part', confidence: 0.4, signals };
  }

  // 4. PayPal — check memo for clues
  if (/paypal/i.test(vendor)) {
    // Check memo for known patterns
    for (const rule of MEMO_RULES) {
      if (rule.pattern.test(memo)) {
        signals.push({ source: 'paypal_memo', match: memo.substring(0, 60), rule: rule.pattern.source });
        return { category: rule.category, confidence: rule.confidence, signals };
      }
    }
    // PayPal with no memo match — unknown
    signals.push({ source: 'vendor', match: 'PayPal (unresolved)' });
    return { category: 'unknown', confidence: 0.0, signals };
  }

  // 5. Apple vendor — subscriptions
  if (/^apple$/i.test(vendor)) {
    signals.push({ source: 'vendor', match: 'Apple (subscriptions)' });
    return { category: 'personal', confidence: 0.0, signals };
  }

  // 6. Amazon vendor — check memo
  if (/amazon/i.test(vendor)) {
    if (/amazon web services|aws/i.test(memo)) {
      signals.push({ source: 'memo', match: 'AWS' });
      return { category: 'business_saas', confidence: 0.0, signals };
    }
    if (/amazon prime/i.test(memo)) {
      signals.push({ source: 'memo', match: 'Amazon Prime' });
      return { category: 'personal', confidence: 0.0, signals };
    }
    signals.push({ source: 'vendor', match: 'Amazon (unresolved)' });
    return { category: 'unknown', confidence: 0.0, signals };
  }

  // 7. "a cars life" vendor — organization attribution
  if (/a cars life/i.test(vendor)) {
    signals.push({ source: 'vendor', match: 'a cars life' });
    return { category: 'vehicle_part', confidence: 0.7, signals };
  }

  // 8. Business SaaS vendors
  if (/anthropic/i.test(vendor) || /openai/i.test(vendor) || /cursor/i.test(vendor) ||
      /firecrawl/i.test(vendor) || /vercel/i.test(vendor) || /supabase/i.test(vendor) ||
      /godaddy/i.test(vendor) || /dropbox/i.test(vendor) || /microsoft/i.test(vendor) ||
      /starlink/i.test(vendor) || /stamps\.com/i.test(vendor) || /auctane/i.test(vendor)) {
    signals.push({ source: 'vendor', match: vendor });
    return { category: 'business_saas', confidence: 0.0, signals };
  }

  // 9. Fee/overdraft/transfer — not a purchase
  if (/overdraft fee|atm fee|foreign transaction fee/i.test(vendor) ||
      /credit one bank/i.test(vendor) || /quickbooks payments/i.test(vendor)) {
    signals.push({ source: 'vendor', match: vendor });
    return { category: 'fee', confidence: 0.0, signals };
  }

  // 10. Shipping vendors
  if (/usps|ups|dhl/i.test(vendor)) {
    signals.push({ source: 'vendor', match: vendor });
    return { category: 'business', confidence: 0.1, signals };
  }

  // 11. Account-name fallback
  for (const rule of ACCOUNT_RULES) {
    if (rule.pattern.test(account)) {
      signals.push({ source: 'account', match: account, rule: rule.pattern.source });
      return { category: rule.category, confidence: rule.confidence, signals };
    }
  }

  // 12. Person names (likely contractors/payments)
  if (/^[a-z]+ [a-z]+$/i.test(vendor) && vendor.length < 30) {
    signals.push({ source: 'vendor', match: `person: ${vendor}` });
    return { category: 'unknown', confidence: 0.0, signals };
  }

  // Default
  signals.push({ source: 'fallback', match: 'no rule matched' });
  return { category: 'unknown', confidence: 0.0, signals };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Loading QB purchases from data/qb-purchases.json...');
  const raw = readFileSync('data/qb-purchases.json', 'utf8');
  const data = JSON.parse(raw);
  const lineItems = data.purchases.line_items;
  console.log(`Found ${lineItems.length} line items to load.`);

  // Build rows
  const rows = lineItems.map(li => {
    const qbId = `purchase-${li.txn_id}-${li.line_id}`;
    const { category, confidence, signals } = categorize(li);

    const row = {
      qb_id: qbId,
      qb_type: li.entity_type || 'Purchase',
      date: li.date,
      vendor_name: li.vendor_name || null,
      total_amount: parseFloat(li.total_amount) || 0,
      line_description: li.line_description || li.memo || null,
      line_amount: parseFloat(li.line_amount) || 0,
      line_account_name: li.line_account_name || null,
      memo: li.memo || null,
      doc_number: li.doc_number || null,
      payment_type: li.payment_type || null,
      category,
      confidence,
      confidence_signals: signals,
    };

    // Vehicle attribution: assign K5 for confidence > 0.5
    if (confidence > 0.5) {
      row.vehicle_id = K5_VEHICLE_ID;
    }

    // Organization attribution: "a cars life" -> Viva Las Vegas Autos
    if (/a cars life/i.test(li.vendor_name || '')) {
      row.organization_id = VIVA_ORG_ID;
    }

    return row;
  });

  // Upsert in batches of 200
  const BATCH_SIZE = 200;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error, count } = await sb
      .from('qb_transactions')
      .upsert(batch, {
        onConflict: 'qb_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`  Upserted ${inserted}/${rows.length}\r`);
    }
  }

  console.log(`\nDone. ${inserted} upserted, ${errors} errors.`);

  // Category summary
  const cats = {};
  for (const r of rows) {
    cats[r.category] = (cats[r.category] || 0) + 1;
  }
  console.log('\nCategory breakdown:');
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    console.log(`  ${cat.padEnd(20)} ${String(count).padStart(5)}`);
  }

  // Vehicle attribution summary
  const withVehicle = rows.filter(r => r.vehicle_id);
  const withOrg = rows.filter(r => r.organization_id);
  console.log(`\nVehicle attributed (K5 Blazer): ${withVehicle.length}`);
  console.log(`Organization attributed (Viva Las Vegas Autos): ${withOrg.length}`);

  // Confidence distribution
  const confBuckets = { '0.0': 0, '0.1-0.3': 0, '0.4-0.5': 0, '0.6-0.7': 0, '0.8-1.0': 0 };
  for (const r of rows) {
    const c = r.confidence;
    if (c === 0) confBuckets['0.0']++;
    else if (c <= 0.3) confBuckets['0.1-0.3']++;
    else if (c <= 0.5) confBuckets['0.4-0.5']++;
    else if (c <= 0.7) confBuckets['0.6-0.7']++;
    else confBuckets['0.8-1.0']++;
  }
  console.log('\nConfidence distribution:');
  for (const [bucket, count] of Object.entries(confBuckets)) {
    console.log(`  ${bucket.padEnd(10)} ${String(count).padStart(5)}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
