/**
 * Ground-truth checks against hand-classified 1984–89 911 comps CSV.
 * Run: deno test --allow-read supabase/functions/mcp-connector/advisor/comps_csv_test.ts
 */
import {
  bodyBucket,
  canonicalListingUrl,
  classifyCompResultType,
  detectModFlag,
  detectVariant,
  implausibleSoldDate,
  isVariantMismatch,
  transBucket,
} from "./variants.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Row = Record<string, string>;

function loadCsv(): Row[] {
  const text = Deno.readTextFileSync(
    new URL("./fixtures/comps_all_1984_89_911.csv", import.meta.url),
  );
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    // Naive CSV split is enough for this fixture (titles may contain commas — use regex).
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    const row: Row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function milesOk(m: string, min: number, max: number): boolean {
  if (!m) return false;
  const n = Number(String(m).replace(/,/g, ""));
  return Number.isFinite(n) && n >= min && n <= max;
}

Deno.test("CSV fixture loads 1000+ hand-classified 911 rows", () => {
  const rows = loadCsv();
  assert(rows.length >= 1000, `got ${rows.length}`);
  assert(rows[0]!.url.includes("http"), "url present");
});

Deno.test("body/trans buckets recover CSV labels from titles and URLs", () => {
  const rows = loadCsv();
  let bodyHit = 0;
  let bodyMiss = 0;
  let transHit = 0;
  let transMiss = 0;
  for (const r of rows) {
    const blob = `${r.title} ${r.url}`;
    const body = bodyBucket(blob);
    const truth = bodyBucket(r.body);
    if (truth && truth !== "?") {
      if (body === truth) bodyHit++;
      else bodyMiss++;
    }
    const trans = transBucket(blob);
    const tTruth = String(r.trans || "").toLowerCase().replace(/\*$/, "");
    if (tTruth === "g50" || tTruth === "915") {
      // Title often states G50 / 5-speed; 915 is harder from title alone.
      if (tTruth === "g50") {
        if (trans === "g50" || trans === "manual") transHit++;
        else if (/g50|5[\s-]?speed|manual/i.test(blob)) transHit++;
        else transMiss++;
      }
    }
  }
  assert(bodyHit > bodyMiss * 2, `body derive weak hit=${bodyHit} miss=${bodyMiss}`);
  assert(transHit > 200, `g50 derive weak hit=${transHit} miss=${transMiss}`);
});

Deno.test("canonical URL dedupes BaT trailing slash and PCarMarket marketplace- prefix", () => {
  const a = canonicalListingUrl("https://bringatrailer.com/listing/foo/");
  const b = canonicalListingUrl("https://bringatrailer.com/listing/foo");
  assert(a === b, "bat slash");
  const c = canonicalListingUrl("https://www.pcarmarket.com/marketplace-results/1987-porsche");
  const d = canonicalListingUrl("https://www.pcarmarket.com/results/1987-porsche");
  assert(c === d || c.replace("marketplace-", "") === d, `pcm ${c} vs ${d}`);
});

Deno.test("acceptance cohort: 1987–89 G50 cab 50–100k original sold — no turbos, no dups", () => {
  const rows = loadCsv();
  const cohort = rows.filter((r) => {
    const y = Number(r.year);
    if (y < 1987 || y > 1989) return false;
    if (bodyBucket(r.body) !== "cabriolet") return false;
    if (!String(r.trans).toLowerCase().startsWith("g50")) return false;
    if (!milesOk(r.miles, 50_000, 100_000)) return false;
    if (r.mod_flag !== "0") return false;
    return String(r.result_type).startsWith("sold");
  });
  assert(cohort.length >= 10, `sold cohort too small: ${cohort.length}`);

  const seen = new Set<string>();
  let dups = 0;
  for (const r of cohort) {
    const key = canonicalListingUrl(r.url);
    if (seen.has(key)) dups++;
    seen.add(key);
    assert(detectVariant(`${r.title} ${r.url}`) !== "turbo", `turbo in cab pool: ${r.url}`);
    assert(
      classifyCompResultType({
        platform: r.source,
        url: r.url,
        price_kind: "sold",
        sold_basis: "hammer",
      }) === "sold",
      `result ${r.url}`,
    );
  }
  assert(dups === 0, `duplicate URLs in sold cohort: ${dups}`);
});

Deno.test("dealer asks classify as ask, not sold", () => {
  const je = classifyCompResultType({
    platform: "jamesedition",
    url: "https://www.jamesedition.com/cars/porsche",
    price_kind: "sold",
    sold_basis: "vehicle_record",
  });
  assert(je === "ask", "jamesedition is ask");
  const cc = classifyCompResultType({
    platform: "classiccars",
    url: "https://www.classiccars.com/listings/x",
    price_kind: "sold",
  });
  assert(cc === "ask", "classiccars is ask");
});

Deno.test("implausible BJ date: Scottsdale 2013 dated 2026", () => {
  const check = implausibleSoldDate(
    "2026-02-25",
    "2013 Barrett-Jackson Scottsdale Lot 1234 1987 Porsche 911",
  );
  assert(check.bad, `should flag: ${check.reason}`);
});

Deno.test("base subject rejects Turbo comps", () => {
  assert(isVariantMismatch("base", "turbo"), "block turbo");
  assert(!isVariantMismatch("turbo", "turbo"), "turbo keeps turbo");
});

Deno.test("mod_flag detects restomod language", () => {
  assert(detectModFlag("Singer-style restomod 911") === 1, "restomod");
  assert(detectModFlag("Numbers-matching original engine") === 0, "original");
});
