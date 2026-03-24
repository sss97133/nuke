/**
 * QuickBooks Purchase/Expense Puller
 *
 * Pulls ALL purchases, bills, and invoices from QuickBooks Online
 * for matching against the vehicle_build_manifest table.
 *
 * Token lifecycle:
 *   - Reads access_token + refresh_token from parent_company table
 *   - If expired, calls the quickbooks-connect edge function to refresh
 *   - Retries once on 401 (token may have been refreshed by another process)
 *
 * QuickBooks query API pagination:
 *   - Max 1000 results per query
 *   - Uses startPosition (1-indexed) for paging
 *
 * Output: /Users/skylar/nuke/data/qb-purchases.json
 *
 * Usage:
 *   dotenvx run -- node scripts/qb-pull-purchases.mjs
 *   dotenvx run -- node scripts/qb-pull-purchases.mjs --type purchases   # only Purchase entities
 *   dotenvx run -- node scripts/qb-pull-purchases.mjs --type bills       # only Bill entities
 *   dotenvx run -- node scripts/qb-pull-purchases.mjs --type invoices    # only Invoice entities
 *   dotenvx run -- node scripts/qb-pull-purchases.mjs --verbose          # print each line item
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ── Config ──────────────────────────────────────────────────────────────────

const REALM_ID = "9130357663952356";
const QB_API_BASE = "https://quickbooks.api.intuit.com";
const QB_MAX_RESULTS = 1000;
const OUTPUT_PATH = "/Users/skylar/nuke/data/qb-purchases.json";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: dotenvx run -- node scripts/qb-pull-purchases.mjs");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const typeFilter = args.includes("--type") ? args[args.indexOf("--type") + 1] : null;
const verbose = args.includes("--verbose");

// ── Token management ────────────────────────────────────────────────────────

async function getTokens() {
  const { data, error } = await supabase
    .from("parent_company")
    .select("id, quickbooks_access_token, quickbooks_refresh_token, quickbooks_token_expires_at")
    .eq("quickbooks_realm_id", REALM_ID)
    .single();

  if (error || !data) {
    throw new Error(`Failed to read QB tokens from parent_company: ${error?.message || "no row found"}`);
  }

  return data;
}

async function refreshTokenViaEdgeFunction() {
  // The quickbooks-connect edge function handles refresh internally
  // when we call the financials action. But we can also trigger it
  // by calling with action=status, which reads and returns the company row.
  // Instead, we call the edge function directly to do a token refresh.
  console.log("  Token expired — refreshing via quickbooks-connect edge function...");

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/quickbooks-connect?action=financials`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${body}`);
  }

  // After the edge function runs, the token in the DB is fresh. Re-read it.
  const tokens = await getTokens();
  console.log(`  Token refreshed. New expiry: ${tokens.quickbooks_token_expires_at}`);
  return tokens.quickbooks_access_token;
}

async function getValidAccessToken() {
  const tokens = await getTokens();
  const expiresAt = new Date(tokens.quickbooks_token_expires_at);
  const now = new Date();

  // Refresh if token expires within 5 minutes
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    return await refreshTokenViaEdgeFunction();
  }

  return tokens.quickbooks_access_token;
}

// ── QuickBooks Query API ────────────────────────────────────────────────────

async function qbQuery(accessToken, query) {
  const url = `${QB_API_BASE}/v3/company/${REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=73`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (resp.status === 401) {
    // Token might have been refreshed by another process — retry once
    console.log("  Got 401 — refreshing token and retrying...");
    const newToken = await refreshTokenViaEdgeFunction();
    const retryResp = await fetch(url.replace(accessToken, newToken), {
      headers: {
        Authorization: `Bearer ${newToken}`,
        Accept: "application/json",
      },
    });
    if (!retryResp.ok) {
      const body = await retryResp.text();
      throw new Error(`QB API query failed after token refresh (${retryResp.status}): ${body}`);
    }
    return retryResp.json();
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`QB API query failed (${resp.status}): ${body}`);
  }

  return resp.json();
}

async function qbQueryAll(accessToken, entityName) {
  const allRows = [];
  let startPosition = 1;

  while (true) {
    const query = `SELECT * FROM ${entityName} STARTPOSITION ${startPosition} MAXRESULTS ${QB_MAX_RESULTS}`;
    console.log(`  Querying: ${query}`);

    const data = await qbQuery(accessToken, query);
    const response = data.QueryResponse;

    if (!response || !response[entityName] || response[entityName].length === 0) {
      break;
    }

    const rows = response[entityName];
    allRows.push(...rows);
    console.log(`  Got ${rows.length} ${entityName} records (total: ${allRows.length})`);

    if (rows.length < QB_MAX_RESULTS) {
      break; // last page
    }

    startPosition += QB_MAX_RESULTS;
  }

  return allRows;
}

// ── Line item extraction ────────────────────────────────────────────────────

function extractPurchaseLineItems(purchase) {
  const lines = [];
  const baseInfo = {
    entity_type: "Purchase",
    txn_id: purchase.Id,
    date: purchase.TxnDate,
    total_amount: purchase.TotalAmt,
    currency: purchase.CurrencyRef?.value || "USD",
    payment_type: purchase.PaymentType || null,
    account_name: purchase.AccountRef?.name || null,
    account_id: purchase.AccountRef?.value || null,
    vendor_name: purchase.EntityRef?.name || null,
    vendor_id: purchase.EntityRef?.value || null,
    memo: purchase.PrivateNote || null,
    doc_number: purchase.DocNumber || null,
  };

  if (purchase.Line && purchase.Line.length > 0) {
    for (const line of purchase.Line) {
      // Skip sub-total lines
      if (line.DetailType === "SubTotalLineDetail") continue;

      const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail || {};
      lines.push({
        ...baseInfo,
        line_id: line.Id,
        line_description: line.Description || null,
        line_amount: line.Amount,
        line_detail_type: line.DetailType,
        line_account_name: detail.AccountRef?.name || detail.ItemRef?.name || null,
        line_account_id: detail.AccountRef?.value || detail.ItemRef?.value || null,
        line_class: detail.ClassRef?.name || null,
        line_customer: detail.CustomerRef?.name || null,
      });
    }
  }

  // If no line items, still emit the header
  if (lines.length === 0) {
    lines.push({ ...baseInfo, line_id: null, line_description: null, line_amount: purchase.TotalAmt, line_detail_type: null, line_account_name: null, line_account_id: null, line_class: null, line_customer: null });
  }

  return lines;
}

function extractBillLineItems(bill) {
  const lines = [];
  const baseInfo = {
    entity_type: "Bill",
    txn_id: bill.Id,
    date: bill.TxnDate,
    total_amount: bill.TotalAmt,
    currency: bill.CurrencyRef?.value || "USD",
    payment_type: null,
    account_name: bill.APAccountRef?.name || null,
    account_id: bill.APAccountRef?.value || null,
    vendor_name: bill.VendorRef?.name || null,
    vendor_id: bill.VendorRef?.value || null,
    memo: bill.PrivateNote || null,
    doc_number: bill.DocNumber || null,
    due_date: bill.DueDate || null,
    balance: bill.Balance,
  };

  if (bill.Line && bill.Line.length > 0) {
    for (const line of bill.Line) {
      if (line.DetailType === "SubTotalLineDetail") continue;

      const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail || {};
      lines.push({
        ...baseInfo,
        line_id: line.Id,
        line_description: line.Description || null,
        line_amount: line.Amount,
        line_detail_type: line.DetailType,
        line_account_name: detail.AccountRef?.name || detail.ItemRef?.name || null,
        line_account_id: detail.AccountRef?.value || detail.ItemRef?.value || null,
        line_class: detail.ClassRef?.name || null,
        line_customer: detail.CustomerRef?.name || null,
      });
    }
  }

  if (lines.length === 0) {
    lines.push({ ...baseInfo, line_id: null, line_description: null, line_amount: bill.TotalAmt, line_detail_type: null, line_account_name: null, line_account_id: null, line_class: null, line_customer: null });
  }

  return lines;
}

function extractInvoiceLineItems(invoice) {
  const lines = [];
  const baseInfo = {
    entity_type: "Invoice",
    txn_id: invoice.Id,
    date: invoice.TxnDate,
    total_amount: invoice.TotalAmt,
    currency: invoice.CurrencyRef?.value || "USD",
    payment_type: null,
    account_name: null,
    vendor_name: invoice.CustomerRef?.name || null,
    vendor_id: invoice.CustomerRef?.value || null,
    memo: invoice.PrivateNote || null,
    doc_number: invoice.DocNumber || null,
    due_date: invoice.DueDate || null,
    balance: invoice.Balance,
  };

  if (invoice.Line && invoice.Line.length > 0) {
    for (const line of invoice.Line) {
      if (line.DetailType === "SubTotalLineDetail") continue;
      if (line.DetailType === "DiscountLineDetail") continue;

      const detail = line.SalesItemLineDetail || {};
      lines.push({
        ...baseInfo,
        line_id: line.Id,
        line_description: line.Description || null,
        line_amount: line.Amount,
        line_detail_type: line.DetailType,
        line_account_name: detail.ItemRef?.name || null,
        line_account_id: detail.ItemRef?.value || null,
        line_class: detail.ClassRef?.name || null,
        line_customer: null,
        line_qty: detail.Qty || null,
        line_unit_price: detail.UnitPrice || null,
      });
    }
  }

  if (lines.length === 0) {
    lines.push({ ...baseInfo, line_id: null, line_description: null, line_amount: invoice.TotalAmt, line_detail_type: null, line_account_name: null, line_account_id: null, line_class: null, line_customer: null });
  }

  return lines;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("QuickBooks Purchase Puller");
  console.log(`  Realm: ${REALM_ID}`);
  console.log(`  Output: ${OUTPUT_PATH}`);
  console.log(`  Filter: ${typeFilter || "all"}`);
  console.log();

  const accessToken = await getValidAccessToken();
  console.log("Token valid.\n");

  const result = {
    pulled_at: new Date().toISOString(),
    realm_id: REALM_ID,
    purchases: { raw: [], line_items: [] },
    bills: { raw: [], line_items: [] },
    invoices: { raw: [], line_items: [] },
    summary: {},
  };

  // ── Purchases (expenses, checks, credit card charges) ──
  if (!typeFilter || typeFilter === "purchases") {
    console.log("=== PURCHASES ===");
    const purchases = await qbQueryAll(accessToken, "Purchase");
    result.purchases.raw = purchases;
    for (const p of purchases) {
      const items = extractPurchaseLineItems(p);
      result.purchases.line_items.push(...items);
      if (verbose) {
        for (const item of items) {
          console.log(`  ${item.date} | $${item.line_amount} | ${item.vendor_name || "—"} | ${item.line_description || item.memo || "—"} | acct: ${item.line_account_name || "—"}`);
        }
      }
    }
    console.log(`  Total: ${purchases.length} purchases, ${result.purchases.line_items.length} line items\n`);
  }

  // ── Bills (vendor bills / accounts payable) ──
  if (!typeFilter || typeFilter === "bills") {
    console.log("=== BILLS ===");
    const bills = await qbQueryAll(accessToken, "Bill");
    result.bills.raw = bills;
    for (const b of bills) {
      const items = extractBillLineItems(b);
      result.bills.line_items.push(...items);
      if (verbose) {
        for (const item of items) {
          console.log(`  ${item.date} | $${item.line_amount} | ${item.vendor_name || "—"} | ${item.line_description || item.memo || "—"} | acct: ${item.line_account_name || "—"}`);
        }
      }
    }
    console.log(`  Total: ${bills.length} bills, ${result.bills.line_items.length} line items\n`);
  }

  // ── Invoices (for reference — things billed TO customers) ──
  if (!typeFilter || typeFilter === "invoices") {
    console.log("=== INVOICES ===");
    const invoices = await qbQueryAll(accessToken, "Invoice");
    result.invoices.raw = invoices;
    for (const inv of invoices) {
      const items = extractInvoiceLineItems(inv);
      result.invoices.line_items.push(...items);
      if (verbose) {
        for (const item of items) {
          console.log(`  ${item.date} | $${item.line_amount} | ${item.vendor_name || "—"} | ${item.line_description || item.memo || "—"} | item: ${item.line_account_name || "—"}`);
        }
      }
    }
    console.log(`  Total: ${invoices.length} invoices, ${result.invoices.line_items.length} line items\n`);
  }

  // ── Summary ──
  const totalPurchaseAmt = result.purchases.raw.reduce((s, p) => s + (p.TotalAmt || 0), 0);
  const totalBillAmt = result.bills.raw.reduce((s, b) => s + (b.TotalAmt || 0), 0);
  const totalInvoiceAmt = result.invoices.raw.reduce((s, i) => s + (i.TotalAmt || 0), 0);

  result.summary = {
    purchase_count: result.purchases.raw.length,
    purchase_line_items: result.purchases.line_items.length,
    purchase_total: totalPurchaseAmt,
    bill_count: result.bills.raw.length,
    bill_line_items: result.bills.line_items.length,
    bill_total: totalBillAmt,
    invoice_count: result.invoices.raw.length,
    invoice_line_items: result.invoices.line_items.length,
    invoice_total: totalInvoiceAmt,
    grand_total_expenses: totalPurchaseAmt + totalBillAmt,
  };

  console.log("=== SUMMARY ===");
  console.log(`  Purchases: ${result.summary.purchase_count} txns, ${result.summary.purchase_line_items} lines, $${totalPurchaseAmt.toFixed(2)}`);
  console.log(`  Bills:     ${result.summary.bill_count} txns, ${result.summary.bill_line_items} lines, $${totalBillAmt.toFixed(2)}`);
  console.log(`  Invoices:  ${result.summary.invoice_count} txns, ${result.summary.invoice_line_items} lines, $${totalInvoiceAmt.toFixed(2)}`);
  console.log(`  Grand total (purchases + bills): $${result.summary.grand_total_expenses.toFixed(2)}`);

  // ── Write output ──
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\nWritten to ${OUTPUT_PATH} (${(JSON.stringify(result).length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
