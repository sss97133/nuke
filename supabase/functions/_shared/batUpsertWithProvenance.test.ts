// deno test --allow-read=supabase/migrations supabase/functions/_shared/batUpsertWithProvenance.test.ts
//
// Contract: every extraction_metadata receipt the Tetris write layer files carries a validation_status that
// extraction_metadata_validation_status_check accepts. The layer filed "confirmed" on a confirmation. The CHECK refused it
// (23514), supabase-js returned that error instead of throwing, and no confirmation receipt landed: 414,417 rejected
// inserts in the 24 hours to 2026-10-28 22:59Z (Postgres logs), from every extractor that writes through
// _shared/observationWriter.ts and from extract-bat-core. The allowed list is read from the migration that creates the
// table, so the test follows the table and not a copy of it.
import {
  batchUpsertWithProvenance,
  upsertFieldWithProvenance,
  type ProvenanceMetadata,
} from "./batUpsertWithProvenance.ts";

const MIGRATION = new URL("../../migrations/20251202_extraction_provenance_system.sql", import.meta.url);

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** The CHECK's value list, from the migration that creates extraction_metadata. */
function allowedStatuses(): string[] {
  const sql = Deno.readTextFileSync(MIGRATION).replace(/--[^\n]*/g, "");
  const m = sql.match(/validation_status\s+TEXT[^;]*?CHECK\s*\(\s*validation_status\s+IN\s*\(([^)]*)\)\s*\)/i);
  if (!m) throw new Error("validation_status CHECK not found in 20251202_extraction_provenance_system.sql");
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

type Row = Record<string, unknown>;

/**
 * The slice of supabase-js the layer uses. extraction_metadata enforces the CHECK the way PostgREST reports it: the
 * error comes back in the result, nothing is thrown, and no row is stored.
 */
function fakeClient(allowed: string[]) {
  const stored: Row[] = [];
  const refused: Row[] = [];
  const quarantined: Row[] = [];
  const client = {
    from(table: string) {
      if (table === "bat_quarantine") {
        return { insert: (row: Row) => { quarantined.push(row); return Promise.resolve({ error: null }); } };
      }
      if (table !== "extraction_metadata") throw new Error(`unexpected table ${table}`);
      const filters: Row = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters[column] = value; return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: () => {
          const hit = [...stored].reverse().find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: hit ?? null, error: null });
        },
        insert: (row: Row) => {
          if (row.validation_status != null && !allowed.includes(String(row.validation_status))) {
            refused.push(row);
            return Promise.resolve({
              error: {
                code: "23514",
                message: 'new row for relation "extraction_metadata" violates check constraint "extraction_metadata_validation_status_check"',
              },
            });
          }
          stored.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
  };
  return { client, stored, refused, quarantined };
}

const VEHICLE = "00000000-0000-4000-8000-000000000001";
const URL_ = "https://bringatrailer.com/listing/1995-porsche-911-carrera-1/";
const meta: ProvenanceMetadata = {
  extraction_version: "observation-writer:1.0.0",
  extraction_method: "html_match",
  source_url: URL_,
  confidence_score: 0.85,
  source_signal: "bat",
};
const ctx = (supabase: unknown) => ({ supabase, vehicleId: VEHICLE, listingUrl: URL_, extractionVersion: meta.extraction_version });
const summary = (rows: Row[]) => rows.map((r) => [r.field_name, r.field_value, r.validation_status]);

Deno.test("the CHECK in the creating migration is five statuses, and confirmed is not one of them", () => {
  equal(allowedStatuses().slice().sort(), ["conflicting", "invalid", "low_confidence", "unvalidated", "valid"]);
});

Deno.test("the table takes each allowed status and refuses confirmed with 23514", async () => {
  const allowed = allowedStatuses();
  const { client, stored, refused } = fakeClient(allowed);
  for (const status of allowed) {
    const r = await client.from("extraction_metadata").insert({ validation_status: status });
    equal(r.error, null, status);
  }
  equal(stored.map((r) => r.validation_status), allowed);
  const bad = await client.from("extraction_metadata").insert({ validation_status: "confirmed" });
  equal((bad.error as { code: string }).code, "23514");
  equal(refused.length, 1);
});

Deno.test("a gap fill files an unvalidated receipt", async () => {
  const { client, stored, refused } = fakeClient(allowedStatuses());
  const r = await upsertFieldWithProvenance(ctx(client), "make", "Porsche", null, meta);
  equal(r.action, "gap_fill");
  equal(refused.length, 0);
  equal(summary(stored), [["make", "Porsche", "unvalidated"]]);
});

Deno.test("a confirmation files a valid receipt (it filed confirmed, which the CHECK refused, and nothing landed)", async () => {
  const { client, stored, refused } = fakeClient(allowedStatuses());
  const r = await upsertFieldWithProvenance(ctx(client), "make", "Porsche", "porsche", meta);
  equal(r.action, "confirmation");
  equal(refused.length, 0);
  equal(summary(stored), [["make", "Porsche", "valid"]]);
});

Deno.test("a conflict quarantines the proposed value and files a conflicting receipt", async () => {
  const { client, stored, refused, quarantined } = fakeClient(allowedStatuses());
  const r = await upsertFieldWithProvenance(ctx(client), "make", "Porsche", "Ford", meta);
  equal(r.action, "conflict");
  equal(refused.length, 0);
  equal(summary(stored), [["make", "Porsche", "conflicting"]]);
  equal(quarantined.length, 1);
});

Deno.test("a batch of gap fills, confirmations and a conflict lands every receipt and none is refused", async () => {
  const allowed = allowedStatuses();
  const { client, stored, refused } = fakeClient(allowed);
  const { updatePayload, stats } = await batchUpsertWithProvenance(
    client,
    VEHICLE,
    URL_,
    meta.extraction_version,
    { make: "Porsche", model: "911", year: 1995, color: null, transmission: "Manual" },
    { make: "porsche", model: "911S", year: "1995", color: "Red", transmission: "manual" },
    {},
    meta,
  );
  equal(stats, { gap_fills: 1, confirmations: 3, conflicts: 1, skipped: 0 });
  equal(updatePayload.color, "Red");
  equal(refused.length, 0);
  equal(stored.length, 5);
  for (const row of stored) {
    if (!allowed.includes(String(row.validation_status))) throw new Error(`status ${row.validation_status} is outside the CHECK`);
  }
  equal(stored.map((r) => r.validation_status).sort(), ["conflicting", "unvalidated", "valid", "valid", "valid"]);
});

Deno.test("a repeat read of a confirmed value adds no second receipt", async () => {
  const { client, stored } = fakeClient(allowedStatuses());
  await upsertFieldWithProvenance(ctx(client), "model", "911", "911", meta);
  await upsertFieldWithProvenance(ctx(client), "model", "911", "911", meta);
  equal(summary(stored), [["model", "911", "valid"]]);
});
