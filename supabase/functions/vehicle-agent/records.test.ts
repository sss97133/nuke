// deno test --node-modules-dir=none supabase/functions/vehicle-agent/records.test.ts
// Synthetic fixtures only: no real vehicle, person, shop or amount.
import {
  amountText, buildRecordsDigest, clean, DIGEST_MAX_CHARS, readAll, readSummary, type RecordReads,
} from "./records.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond { if (!cond) throw new Error(msg); }
const has = (text: string, part: string) => assert(text.includes(part), `expected to find ${JSON.stringify(part)} in:\n${text}`);
const lacks = (text: string, part: string | RegExp) =>
  assert(typeof part === "string" ? !text.includes(part) : !part.test(text), `did not expect ${part} in:\n${text}`);

const FETCHED = "2030-01-02T03:04:05.000Z";
const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function build(overrides: Record<string, unknown> = {}, totals: Record<string, unknown> = {}) {
  return {
    function: "vehicle_build_reconstruction",
    as_of: "2030-01-02T03:04:00+00:00",
    amounts_visible: false,
    rule: "Paper hours and reference hours are separate lenses and are never added.",
    totals: {
      lines: 40, placed_lines: 38, receipts: 12, first_day: "2029-02-03", last_day: "2029-11-30",
      part_lines: 30, paper_work_lines: 6, paper_hours: 10.5, reference_hours: 20.25,
      reference_operations: 4, parts_without_reference: 9, photo_images: 77, stage_images: 3,
      stage_hours: { typical: 7, min: 3, max: 12, stages: 2 }, recorded_amount: 4321.5,
      ...totals,
    },
    systems_without_paper: ["paint"],
    reconstructed_systems: [{
      system_key: "paint",
      window: {
        kind: "bounded", earliest: "2029-03-01", latest: "2029-09-01",
        basis: [{ id: ID_A, day: "2029-03-01", end: "earliest", kind: "receipt_line", phrase: "last body line" }],
      },
    }],
    systems: [
      {
        system_key: "engine", first_day: "2029-02-03", last_day: "2029-06-01", part_lines: 8, priced_lines: 8,
        recorded_amount: 1000, backordered_lines: 1,
        lines: Array.from({ length: 9 }, (_, i) => ({ item_id: ID_B, name: `part ${i}`, amount: 11.11 })),
        paper: { hours: 10.5, lines: 3, shops: ["Example Machine Shop"], performers: 1, lines_without_hours: 1 },
        reference: { hours: 12, operations: [{ code: "X", name: "Engine out and in", hours: 12 }], parts_without_reference: 2 },
        suppliers: ["Example Parts Co"],
        photos: { images: 5, first_day: "2029-07-01", last_day: "2029-07-02", sample: [{ image_id: ID_A, image_url: "https://example.test/a.jpg" }] },
        stages: null,
      },
      {
        system_key: "paint", lines: null, part_lines: 0, first_day: null, last_day: null, recorded_amount: null,
        paper: { hours: null, lines: 0, shops: [] }, reference: { hours: null, operations: [] }, suppliers: [], photos: null,
        stages: [{ phase: "paint_prep", images: 2 }], stage_hours: { typical: 7, min: 3, max: 12, stages: 2 },
      },
    ],
    ...overrides,
  };
}

const ok = (data: unknown) => ({ status: "ok" as const, ms: 5, data });

function allReads(buildData: unknown = build()): RecordReads {
  return {
    vehicle_build_reconstruction: ok(buildData),
    vehicle_testimony_summary: ok({ total: 500, by_kind: { condition: 400, work_record: 100 }, first_observed: "2028-01-01T00:00:00Z", last_observed: "2030-01-01T00:00:00Z" }),
    work_sessions: ok([
      { session_date: "2029-05-01", duration_minutes: 90, owner_confirmed_at: "2029-05-02T00:00:00Z" },
      { session_date: "2029-05-03", duration_minutes: 240, owner_confirmed_at: null },
      { session_date: "2029-05-04", duration_minutes: 0, owner_confirmed_at: null },
    ]),
    get_vehicle_day_depth: ok([
      { day: "2029-07-02", photos: 10, seen: 9, placed: 8, depth: 0.5 },
      { day: "2029-07-01", photos: 5, seen: 5, placed: 5, depth: 0.7 },
    ]),
    vehicle_statements: ok({ tied: false, rule: "A statement is a claim.", statements: [
      { said_on: "2029-08-01", speaker_role: "owner", statement_kind: "estimate", target_label: "Asking price", value: null, value_note: "amount private", words: null },
    ] }),
    vehicle_open_questions: ok({
      as_of: "2030-01-02T03:04:01Z",
      counts: { open: 3, answered: 2, asked: 0, questions: 5, by_kind: [{ kind: "fact_doubt", open: 1, questions: 2 }],
        bought_parts: { asked_about: 3, seen_installed: 1, seen_not_installed: 0, not_visible: 1, still_open: 1 } },
      questions: [
        { id: ID_A, kind: "receipt_part_visible", state: "open", subject: "Example part", question: "Is the part seen installed?" },
        { id: ID_B, kind: "fact_doubt", state: "open", subject: "Body number", question: "Does the evidence settle the body number?",
          readings: { verdict: "readings differ", count: 2 }, answer: { words: "The evidence shows: 12345." }, witnesses: { image_ids: [ID_A] } },
        { id: ID_B, kind: "fact_doubt", state: "answered", subject: "Answered one", question: "Already settled?" },
      ],
    }),
    vehicle_profile_read: ok({
      read_at: "2030-01-02T03:04:02Z",
      sections: [
        { kind: "masthead", year: 1970, make: "Examplemake", model: "Examplemodel", price: null,
          identity_source: { trim: "Base", is_replica: false, transmission: "manual" },
          token_items: {
            engine: [
              { facet: "as_built", value: "5.0", unit: "L", status: "established", stated: "305" },
              { facet: "current", value: "7.0", unit: "L", status: "reading" },
            ],
            drivetrain: [{ facet: "as_built", value: null, status: "missing", needed: "a build sheet" }],
          } },
        { kind: "strip", facets: [{ dimension: "engine", label: "7.0 V8", member: { trust: 0.6, source: { label: "system update" }, observed_at: "2029-12-01T00:00:00Z" } }], gaps: [] },
      ],
    }),
  };
}

Deno.test("the question asked on the live car is answerable: receipt count and latest date, with reader and as-of", () => {
  const text = buildRecordsDigest(allReads(), { fetchedAt: FETCHED });
  has(text, "[vehicle_build_reconstruction, as of 2030-01-02 03:04 UTC]");
  has(text, "Receipts: 12 receipts linked to this car");
  has(text, "first 2029-02-03, latest 2029-11-30");
  has(text, "40 receipt lines: 30 part lines, 6 shop work lines");
  has(text, "Reader's rule: \"Paper hours and reference hours are separate lenses and are never added.\"");
});

Deno.test("amounts: hidden from a viewer the reader hides them from, 'none recorded' when visible and null, shown when visible", () => {
  const hidden = buildRecordsDigest(allReads(build({ amounts_visible: false })), { fetchedAt: FETCHED });
  has(hidden, "Recorded amount: not shown to this viewer");
  lacks(hidden, "4321");
  lacks(hidden, "recorded amount 1000");
  lacks(hidden, "11.11");

  const none = buildRecordsDigest(allReads(build({ amounts_visible: true }, { recorded_amount: null })), { fetchedAt: FETCHED });
  has(none, "Recorded amount: none recorded.");

  const shown = buildRecordsDigest(allReads(build({ amounts_visible: true })), { fetchedAt: FETCHED });
  has(shown, "Recorded amount: 4321.5.");
  has(shown, "not the full cost of the build");
  has(shown, "recorded amount 1000");
  has(shown, "recorded amount none recorded"); // the paint system: visible, nothing on paper

  // Only a literal true opens amounts.
  assert(amountText("true", 5).startsWith("not shown"));
  assert(amountText(true, 5) === "5");
});

Deno.test("hour lenses stay on separate lines and no sum of them appears anywhere", () => {
  const text = buildRecordsDigest(allReads(), { fetchedAt: FETCHED });
  has(text, "- Shop paper hours: 10.5 h");
  has(text, "- Reference hours: 20.25 h");
  has(text, "- Photographed stage hours: typical 7 h (range 3 to 12 h)");
  has(text, "Never add them together");
  has(text, "Confirmed by the owner: 1 session, 1.5 h timed");
  has(text, "Not confirmed: 2 sessions, 4 h timed (1 with a duration)");
  has(text, "never add it to the hour lenses above");
  // 10.5 + 20.25 = 30.75; + 7 = 37.75; + 1.5 + 4 = 43.25; paper + reference + sessions = 36.25
  for (const sum of ["30.75", "37.75", "43.25", "36.25", "5.5 h"]) lacks(text, sum);
});

Deno.test("no ids and no links reach the model, even when the readers carry them", () => {
  const text = buildRecordsDigest(allReads(), { fetchedAt: FETCHED });
  lacks(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  lacks(text, /https?:\/\//i);
  assert(clean(`see ${ID_A} at https://example.test/x`) === "see [id] at [link]");
});

Deno.test("a failed, timed-out, empty or malformed reader is named as unread and never takes the others down", () => {
  const reads = allReads();
  reads.vehicle_profile_read = { status: "timeout", ms: 4000 };
  reads.vehicle_open_questions = { status: "error", ms: 12, detail: "permission denied" };
  reads.vehicle_statements = ok(null);
  reads.work_sessions = ok("not an array");
  delete reads.get_vehicle_day_depth;
  const text = buildRecordsDigest(reads, { fetchedAt: FETCHED });
  has(text, "[vehicle_profile_read] not read this turn (it did not answer within 4 s)");
  has(text, "[vehicle_open_questions] not read this turn (it answered with an error)");
  has(text, "[vehicle_statements] not read this turn (it returned nothing for this viewer)");
  has(text, "[get_vehicle_day_depth] not read this turn (it was not asked)");
  has(text, "do not conclude its data does not exist");
  has(text, "Work sessions visible to this viewer: none.");
  has(text, "Receipts: 12 receipts"); // the others are intact

  // Garbage in every field of the main reader: no throw, unknowns said as unknown.
  const garbage = buildRecordsDigest({ vehicle_build_reconstruction: ok({ totals: "x", systems: { a: 1 }, reconstructed_systems: [null, 3] }) }, { fetchedAt: FETCHED });
  has(garbage, "Receipts: unknown receipts");
  has(garbage, "Receipt dates: none dated");
  has(garbage, "[vehicle_build_reconstruction, as of 2030-01-02 03:04 UTC (read time)]");
  const scalar = buildRecordsDigest({ vehicle_build_reconstruction: ok(42), vehicle_profile_read: ok([1, 2]) }, { fetchedAt: FETCHED });
  has(scalar, "Masthead: unnamed.");
});

Deno.test("statement words stay hidden when the reader hides them; profile fields keep facet and status", () => {
  const text = buildRecordsDigest(allReads(), { fetchedAt: FETCHED });
  has(text, "The log book: 1 statement (words are hidden from this viewer).");
  has(text, "2029-08-01, owner (estimate), Asking price: amount private");
  has(text, "engine: as_built 5.0 L [established; stated 305] / current 7.0 L [reading]");
  has(text, "drivetrain: as_built missing (needs a build sheet)");
  has(text, "Masthead: 1970 Examplemake Examplemodel, trim on record Base, transmission manual.");
  // Open fact doubts come before part checks; answered questions are not listed as open.
  assert(text.indexOf("Body number") < text.indexOf("Example part"), "fact doubts first");
  lacks(text, "Answered one");
  has(text, "A reader proposed, not settled: The evidence shows: 12345.");
});

Deno.test("a car with many fat systems stays within the budget by dropping detail, not by cutting text", () => {
  const fat = Array.from({ length: 40 }, (_, i) => ({
    system_key: `system_${i}`, first_day: "2029-01-01", last_day: "2029-12-31", part_lines: 50,
    lines: Array.from({ length: 60 }, () => ({ name: "x".repeat(200) })),
    paper: { hours: 3.25, lines: 4, shops: ["Shop One", "Shop Two", "Shop Three", "Shop Four"], lines_without_hours: 1 },
    reference: { hours: 9, operations: Array.from({ length: 5 }, (_, j) => ({ name: `Operation ${j} with a long name`, hours: 1.5 })) },
    suppliers: Array.from({ length: 10 }, (_, j) => `Supplier number ${j}`),
    photos: { images: 30, first_day: "2029-01-01", last_day: "2029-02-01" }, backordered_lines: 2,
  }));
  const reads = allReads(build({ systems: fat, amounts_visible: true }));
  const text = buildRecordsDigest(reads, { fetchedAt: FETCHED });
  assert(text.length <= DIGEST_MAX_CHARS, `digest is ${text.length} chars`);
  has(text, "Receipts: 12 receipts");
  has(text, "- Reference hours: 20.25 h");

  const tight = buildRecordsDigest(reads, { fetchedAt: FETCHED, maxChars: 3500 });
  assert(tight.length <= 3500, `tight digest is ${tight.length} chars`);
  has(tight, "Receipts: 12 receipts");
  // Every line ends whole: no number is cut in half.
  for (const line of tight.split("\n")) assert(!/\d…$/.test(line), `cut line: ${line}`);
});

Deno.test("readAll: each read is bounded; a slow, failing or throwing read is reported and the rest arrive", async () => {
  const reads = await readAll({
    vehicle_build_reconstruction: () => Promise.resolve({ data: { totals: {} }, error: null }),
    vehicle_profile_read: (signal) => new Promise((resolve) => {
      const t = setTimeout(() => resolve({ data: {}, error: null }), 500);
      signal.addEventListener("abort", () => clearTimeout(t));
    }),
    vehicle_open_questions: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
    vehicle_statements: () => Promise.reject(new Error("network down")),
  }, 50);
  const s = readSummary(reads);
  assert(s.vehicle_build_reconstruction.status === "ok");
  assert(s.vehicle_profile_read.status === "timeout", JSON.stringify(s));
  assert(s.vehicle_open_questions.status === "error");
  assert(s.vehicle_statements.status === "error");
  assert(s.vehicle_profile_read.ms < 400, `timeout took ${s.vehicle_profile_read.ms} ms`);
});
