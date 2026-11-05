/**
 * Receipt -> observation kind. Word-boundary matches over the receipt's TEXT fields (vendor, line descriptions, notes,
 * document and receipt type), never over the raw JSON: a substring test on `JSON.stringify(raw)` matched "tag" inside
 * "vintage" and "stage" and "title" inside JSON keys, and 26 of 30 Firebird binder receipts (parts invoices and a machine
 * shop work order) landed as `specification` on 2026-11-05.
 */
export interface ClassifiableReceipt {
  vendor_name: string | null;
  raw_extraction?: unknown;
  raw_json?: unknown;
}

export const PARTS_KEYWORDS = [
  "part", "parts", "filter", "oil", "brake", "tire", "battery",
  "spark plug", "hose", "belt", "gasket", "bearing", "seal",
  "wheel", "axle", "transmission", "engine", "alternator",
  "starter", "fuel", "exhaust", "muffler", "catalytic", "radiator",
  "coolant", "shock", "shocks", "strut", "pad", "rotor", "caliper", "bushing",
  "ball joint", "tie rod", "wire", "harness", "connector", "fitting",
  "bolt", "nut", "screw", "washer", "clip", "pump", "valve", "sensor",
  "piston", "pistons", "crank", "block", "head", "heads", "carpet", "headliner", "seat",
];
export const LABOR_KEYWORDS = [
  "labor", "service", "install", "repair", "diagnose", "diagnostic",
  "tune up", "tune-up", "alignment", "rotate", "balance", "mount",
  "inspection", "smog", "emissions", "hours", "shop fee", "bore", "hone", "surface", "machine",
];
export const DOC_KEYWORDS = [
  "insurance", "policy", "premium", "coverage", "registration",
  "title", "dmv", "license plate", "smog cert", "tag",
];
export const VENDOR_PARTS_HINTS = [
  "autozone", "napa", "o'reilly", "advance auto", "summit racing",
  "rock auto", "rockauto", "pep boys", "carquest", "jegs", "classic industries", "ames performance",
];
export const VENDOR_DOC_HINTS = [
  "bristol west", "geico", "progressive", "state farm", "allstate",
  "farmers insurance", "dmv", "department of motor",
];
export const WORK_ORDER_TYPES = ["work_order", "invoice", "receipt", "packing_slip", "order_confirmation", "alignment_report", "estimate"];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (words: string[]) => new RegExp(`(^|[^a-z0-9])(${words.map(escape).join("|")})(?![a-z0-9])`, "i");
const PARTS_RE = wordRe(PARTS_KEYWORDS), LABOR_RE = wordRe(LABOR_KEYWORDS), DOC_RE = wordRe(DOC_KEYWORDS);

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return "";
  if (Array.isArray(v)) return v.map(textOf).join(" ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return ["description", "notes", "vehicle_hint", "document_type", "receipt_type", "business_purpose", "category", "name", "line_items", "data", "data_v2"]
      .map(k => textOf(o[k])).join(" ");
  }
  return "";
}

/** The receipt's own words: vendor, document/receipt type, line descriptions, notes. Never JSON keys. */
export function receiptText(r: ClassifiableReceipt): string {
  return [r.vendor_name ?? "", textOf(r.raw_extraction), textOf(r.raw_json)].join(" ").toLowerCase();
}

export function classifyKind(r: ClassifiableReceipt): "work_record" | "specification" | "comment" {
  const vendor = (r.vendor_name ?? "").toLowerCase();
  const text = receiptText(r);
  const docType = [textOf((r.raw_json as Record<string, unknown> | undefined)?.data_v2 && ((r.raw_json as any).data_v2.document_type)),
    textOf((r.raw_extraction as Record<string, unknown> | undefined)?.data && ((r.raw_extraction as any).data.document_type))].join(" ").toLowerCase();
  // A paper from the vehicle's own work (an invoice, a work order, a slip) is the work record, whatever words it holds.
  if (WORK_ORDER_TYPES.some(t => docType.includes(t)) && !VENDOR_DOC_HINTS.some(v => vendor.includes(v))) return "work_record";
  // Doc-type first (insurance/registration even if vendor sells parts)
  if (VENDOR_DOC_HINTS.some(v => vendor.includes(v))) return "specification";
  if (DOC_RE.test(text)) return "specification";
  // Parts/labor receipts
  if (VENDOR_PARTS_HINTS.some(v => vendor.includes(v))) return "work_record";
  if (PARTS_RE.test(text) || LABOR_RE.test(text)) return "work_record";
  // Default: still a vehicle-attributed receipt — surface as comment so it
  // shows on the timeline rather than being silently dropped.
  return "comment";
}
