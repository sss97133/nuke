/**
 * The car's own record, as the per-vehicle agent sees it: a compact digest of the site's sanctioned readers.
 *
 * Pure: no Deno.env, no network, no imports, so `deno test` runs it alone (records.test.ts).
 *
 * index.ts calls each reader with the asking person's own session (never the service key), so every reader's own
 * privacy rule decides what this viewer sees; this file only turns what came back into labelled lines for the model.
 * Rules the digest keeps:
 * - every figure sits under its reader's name and as-of time, so the model can cite it;
 * - the hour lenses (shop paper, reference operations, photographed stages, work sessions) are on separate lines and
 *   never summed;
 * - an amount is printed only when the reader says amounts are visible to this viewer, and the recorded amount is
 *   called what it is: the lines on file, not the cost of the build;
 * - a reader that failed or timed out gets its own line, so the model says it could not read it, not that the data
 *   does not exist;
 * - no ids and no links (a proposal carrying another uuid is refused by the pin in scope.ts), and text is trimmed by
 *   dropping whole parts, never by cutting a string through a number.
 */

export const RECORD_READERS = [
  "vehicle_build_reconstruction",
  "vehicle_profile_read",
  "vehicle_testimony_summary",
  "vehicle_open_questions",
  "get_vehicle_day_depth",
  "work_sessions",
  "vehicle_statements",
] as const;
export type RecordReader = typeof RECORD_READERS[number];

export type ReadResult =
  | { status: "ok"; ms: number; data: unknown }
  | { status: "timeout" | "error"; ms: number; detail?: string };
export type RecordReads = Partial<Record<RecordReader, ReadResult>>;

export const READ_TIMEOUT_MS = 4000;
export const DIGEST_MAX_CHARS = 12000;

/**
 * Run every read at once, each bounded by its own timeout; a read that throws, answers with an error or runs out of
 * time is reported as such and never fails the others. `now` is injectable for tests.
 */
export async function readAll(
  reads: Partial<Record<RecordReader, (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>>>,
  timeoutMs = READ_TIMEOUT_MS,
  now: () => number = Date.now,
): Promise<RecordReads> {
  const entries = await Promise.all(Object.entries(reads).map(async ([name, run]) => {
    const t0 = now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ReadResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: "timeout", ms: now() - t0 });
      }, timeoutMs);
    });
    const attempt = (async (): Promise<ReadResult> => {
      try {
        const { data, error } = await run!(controller.signal);
        if (error) return { status: "error", ms: now() - t0, detail: errorText(error) };
        return { status: "ok", ms: now() - t0, data };
      } catch (e) {
        return { status: controller.signal.aborted ? "timeout" : "error", ms: now() - t0, detail: errorText(e) };
      }
    })();
    const result = await Promise.race([attempt, timeout]);
    clearTimeout(timer);
    return [name, result] as const;
  }));
  return Object.fromEntries(entries) as RecordReads;
}

function errorText(e: unknown): string {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return m.slice(0, 200);
}

// ── Formatting helpers ──────────────────────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const obj = (v: unknown): Obj => isObj(v) ? v : {};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const URL_RE = /\bhttps?:\/\/\S+/gi;

/** A string with ids and links taken out, whitespace folded, cut at a word boundary when too long. */
export function clean(value: unknown, max = 200): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  let s = String(value).replace(URL_RE, "[link]").replace(UUID, "[id]").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > max) {
    const cut = s.slice(0, max);
    const at = cut.lastIndexOf(" ");
    s = `${at > max / 2 ? cut.slice(0, at) : cut}…`;
  }
  return s;
}

/** A finite number as written (no rounding beyond two decimals), or null. */
export function num(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100);
}

const day = (value: unknown): string | null => {
  const s = typeof value === "string" ? value : null;
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const stamp = (value: unknown): string | null => {
  const s = typeof value === "string" ? value : null;
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return s.length >= 16 ? `${s.slice(0, 16).replace("T", " ")} UTC` : s.slice(0, 10);
};
const span = (first: unknown, last: unknown): string | null => {
  const a = day(first), b = day(last);
  if (a && b) return a === b ? a : `${a} to ${b}`;
  return a ?? b;
};
const list = (values: unknown, max: number, width = 60): string | null => {
  const items = arr(values).map((v) => clean(v, width)).filter((v): v is string => !!v);
  if (!items.length) return null;
  return items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
};
const plural = (n: number | string, word: string, many = `${word}s`): string => `${n} ${String(n) === "1" ? word : many}`;
const hours = (value: unknown): string | null => {
  const n = num(value);
  return n === null ? null : `${n} h`;
};

function header(reader: RecordReader, asOf: string | null, fetchedAt: string): string {
  return `[${reader}, as of ${asOf ?? `${stamp(fetchedAt) ?? fetchedAt} (read time)`}]`;
}

function notRead(reader: RecordReader, r: ReadResult | undefined): string {
  const why = !r ? "it was not asked" : r.status === "timeout" ? `it did not answer within ${READ_TIMEOUT_MS / 1000} s`
    : r.status === "error" ? "it answered with an error" : "it returned nothing for this viewer";
  return `[${reader}] not read this turn (${why}). Say this reader could not be read just now; do not conclude its data does not exist.`;
}

// ── Amounts: three states ───────────────────────────────────────────────────────────────────────────────────────────

/** Shown; not shown to this viewer; or none recorded. Never prints a number when the reader hides amounts. */
export function amountText(amountsVisible: unknown, value: unknown): string {
  if (amountsVisible !== true) return "not shown to this viewer (the reader shows amounts only to people tied to the car)";
  const n = num(value);
  return n === null ? "none recorded" : n;
}

// ── vehicle_build_reconstruction ────────────────────────────────────────────────────────────────────────────────────

/** detail: 2 = everything, 1 = no supplier / operation names, 0 = one short line per system. */
function buildSection(data: unknown, fetchedAt: string, detail: number, maxSystems: number): string[] {
  const d = obj(data);
  const t = obj(d.totals);
  const visible = d.amounts_visible === true;
  const out: string[] = [header("vehicle_build_reconstruction", stamp(d.as_of), fetchedAt)];
  const rule = clean(d.rule, 700);
  if (rule) out.push(`Reader's rule: "${rule}"`);

  const receipts = num(t.receipts);
  out.push(
    `Receipts: ${receipts ?? "unknown"} receipts linked to this car that carry at least one part, labor, note, ` +
      `back-ordered or kit line (a linked receipt with no such line is not in this count). ` +
      `${num(t.lines) ?? "unknown"} receipt lines: ${num(t.part_lines) ?? "unknown"} part lines, ` +
      `${num(t.paper_work_lines) ?? "unknown"} shop work lines; ${num(t.placed_lines) ?? "unknown"} placed in a car system.`,
  );
  const dates = span(t.first_day, t.last_day);
  out.push(
    `Receipt dates: ${dates ? `first ${day(t.first_day) ?? "unknown"}, latest ${day(t.last_day) ?? "unknown"}` : "none dated"} ` +
      `(each line's printed date, else its page date, else the receipt date).`,
  );
  out.push(
    `Recorded amount: ${amountText(visible, t.recorded_amount)}. This is the sum of line prices on the receipts on ` +
      `file, not the full cost of the build: work with no paper, the owner's own labor and anything not yet filed are ` +
      `outside it.`,
  );

  const sh = obj(t.stage_hours);
  out.push("Hours, three separate lenses. Never add them together; quote each by its name:");
  out.push(
    `- Shop paper hours: ${hours(t.paper_hours) ?? "none printed"}, the hours printed on shop documents.`,
  );
  out.push(
    `- Reference hours: ${hours(t.reference_hours) ?? "none"}, from ${num(t.reference_operations) ?? "0"} stored labor ` +
      `operations, each counted once for this car. ${num(t.parts_without_reference) ?? "0"} part lines have no stored ` +
      `fitting operation (a gap in the reference, not zero hours).`,
  );
  out.push(
    `- Photographed stage hours: ` +
      (num(sh.typical) !== null
        ? `typical ${hours(sh.typical)} (range ${num(sh.min) ?? "?"} to ${num(sh.max) ?? "?"} h) over ${num(sh.stages) ?? "?"} ` +
          `build stages seen in ${num(t.stage_images) ?? "?"} photographs; the stored hour range for each stage, not time measured on this car.`
        : "none (no build stage is placed from photographs)."),
  );
  if (num(t.photo_images) !== null) out.push(`Photographs read into car systems: ${num(t.photo_images)}.`);
  const noPaper = list(d.systems_without_paper, 20, 30);
  if (noPaper) out.push(`Systems with no receipt paper: ${noPaper}.`);

  // Systems with no paper, reconstructed from surrounding evidence: the window the work must fall in.
  for (const r of arr(d.reconstructed_systems).slice(0, 6)) {
    const rs = obj(r);
    const key = clean(rs.system_key, 30);
    if (!key) continue;
    const w = obj(rs.window);
    const why = arr(w.basis).map((b) => {
      const bb = obj(b);
      const phrase = clean(bb.phrase, 120);
      return phrase ? `${clean(bb.end, 10) ?? "bound"} ${day(bb.day) ?? "undated"}: ${phrase}` : null;
    }).filter(Boolean).join("; ");
    out.push(
      `Reconstructed (no paper) ${key}: work window ${span(w.earliest, w.latest) ?? "open"}` +
        `${clean(w.kind, 20) ? ` (${clean(w.kind, 20)})` : ""}${why ? `; ${why}` : ""}.`,
    );
  }

  const systems = arr(d.systems).filter(isObj);
  if (systems.length) {
    out.push(`Per system (${systems.length}):`);
    for (const s of systems.slice(0, maxSystems)) out.push(systemLine(s, visible, detail));
    if (systems.length > maxSystems) {
      out.push(`- ${systems.length - maxSystems} more systems not listed here for length; their lines are in the totals above.`);
    }
  }
  return out;
}

function systemLine(s: Obj, visible: boolean, detail: number): string {
  const key = clean(s.system_key, 30) ?? "unnamed";
  const lines = Array.isArray(s.lines) ? s.lines.length : null;
  const parts: string[] = [];
  parts.push(lines === null ? "no receipt lines" : `${plural(lines, "line")} (${plural(num(s.part_lines) ?? "0", "part")})`);
  const when = span(s.first_day, s.last_day);
  if (when) parts.push(`receipts ${when}`);
  const paper = obj(s.paper);
  if (num(paper.hours) !== null) {
    parts.push(`paper ${hours(paper.hours)} on ${num(paper.lines) ?? "?"} lines` +
      (num(paper.lines_without_hours) && num(paper.lines_without_hours) !== "0" ? ` (${num(paper.lines_without_hours)} without hours)` : ""));
  } else if (num(paper.lines) && num(paper.lines) !== "0") {
    parts.push(`paper ${plural(num(paper.lines)!, "work line")}, no hours printed`);
  }
  const ref = obj(s.reference);
  const ops = arr(ref.operations).filter(isObj);
  if (num(ref.hours) !== null) {
    const names = detail >= 2
      ? ops.slice(0, 3).map((o) => `${clean(o.name, 40) ?? "operation"} ${hours(o.hours) ?? ""}`.trim()).join(", ")
      : "";
    parts.push(`reference ${hours(ref.hours)} (${ops.length} op${ops.length === 1 ? "" : "s"}${names ? `: ${names}` : ""})`);
  }
  const stages = arr(s.stages).filter(isObj);
  if (stages.length) {
    const sh = obj(s.stage_hours);
    parts.push(`photographed stages ${stages.length}` + (num(sh.typical) !== null ? `, typical ${hours(sh.typical)} (${num(sh.min) ?? "?"} to ${num(sh.max) ?? "?"} h)` : ""));
  }
  if (detail >= 1) {
    const shops = list(paper.shops, 3, 50);
    if (shops) parts.push(`shops: ${shops}`);
  }
  if (detail >= 2) {
    const suppliers = list(s.suppliers, 3, 50);
    if (suppliers) parts.push(`suppliers: ${suppliers}`);
    const photos = obj(s.photos);
    if (num(photos.images) !== null) parts.push(`${num(photos.images)} photos ${span(photos.first_day, photos.last_day) ?? ""}`.trim());
    if (num(s.backordered_lines) && num(s.backordered_lines) !== "0") parts.push(`${num(s.backordered_lines)} back-ordered`);
  }
  if (visible) parts.push(`recorded amount ${amountText(true, s.recorded_amount)}`);
  return `- ${key}: ${parts.join("; ")}.`;
}

// ── vehicle_profile_read ────────────────────────────────────────────────────────────────────────────────────────────

function profileSection(data: unknown, fetchedAt: string, detail: number): string[] {
  const d = obj(data);
  const sections = arr(d.sections).filter(isObj);
  const masthead = sections.find((s) => s.kind === "masthead") ?? {};
  const strip = sections.find((s) => s.kind === "strip") ?? {};
  const out: string[] = [header("vehicle_profile_read", stamp(d.read_at), fetchedAt)];
  const idn = obj(masthead.identity_source);
  const name = [num(masthead.year) ?? num(idn.year), clean(masthead.make ?? idn.make, 40), clean(masthead.model ?? idn.model, 40)]
    .filter(Boolean).join(" ");
  const bits = [name || "unnamed"];
  if (clean(idn.trim, 40)) bits.push(`trim on record ${clean(idn.trim, 40)}`);
  if (idn.is_replica === true) bits.push("marked a replica");
  if (clean(idn.transmission, 30)) bits.push(`transmission ${clean(idn.transmission, 30)}`);
  out.push(`Masthead: ${bits.join(", ")}.`);
  out.push(`Price claim on the masthead: ${priceText(masthead.price, masthead.priceLabel)}.`);

  // Each field keeps its facet (as built / current / decode) and status, so "as built" and "now" are not conflated.
  const tokens = obj(masthead.token_items);
  const fields: string[] = [];
  for (const [key, items] of Object.entries(tokens)) {
    const rendered = arr(items).filter(isObj).slice(0, detail >= 1 ? 3 : 1).map((it) => {
      const value = clean(it.value, 60);
      const facet = clean(it.facet, 20) ?? "?";
      const status = clean(it.status, 20) ?? "?";
      if (value === null) return `${facet} missing${detail >= 1 && clean(it.needed, 90) ? ` (needs ${clean(it.needed, 90)})` : ""}`;
      const unit = clean(it.unit, 10);
      const stated = clean(it.stated, 30);
      return `${facet} ${value}${unit ? ` ${unit}` : ""} [${status}${stated ? `; stated ${stated}` : ""}]`;
    });
    if (rendered.length) fields.push(`${clean(key, 30)}: ${rendered.join(" / ")}`);
  }
  if (fields.length) {
    out.push("Fields (facet value [status]); 'as_built' is the factory car, 'current' is the car now, 'decode' is from the VIN:");
    for (const f of fields.slice(0, 16)) out.push(`- ${f}`);
  }
  const facets = arr(strip.facets).filter(isObj).slice(0, 8).map((f) => {
    const m = obj(f.member);
    const src = clean(obj(m.source).label, 30);
    return `${clean(f.dimension, 20) ?? "?"} ${clean(f.label, 40) ?? "?"}` +
      ` (trust ${num(m.trust) ?? "?"}${src ? `, ${src}` : ""}${day(m.observed_at) ? `, ${day(m.observed_at)}` : ""})`;
  });
  if (facets.length) out.push(`Strip facets: ${facets.join("; ")}.`);
  const gaps = arr(strip.gaps).filter(isObj);
  if (gaps.length) out.push(`Strip gaps (${gaps.length}): ${list(gaps.map((g) => g.label ?? g.dimension), 8, 30)}.`);
  return out;
}

/** The masthead price: { value, unit, source: { label, method }, observed_at, trust } with its label (Asking, High bid,
 *  Last recorded sale). A bare number is accepted too. Anything without a readable value is "none shown". */
export function priceText(price: unknown, label: unknown): string {
  const p = isObj(price) ? price : { value: price };
  const value = num(p.value);
  if (value === null) return "none shown";
  const src = obj(p.source);
  const from = [clean(src.label, 40), clean(src.method, 20), day(p.observed_at), num(p.trust) !== null ? `trust ${num(p.trust)}` : null]
    .filter(Boolean).join(", ");
  return `${clean(label, 50) ?? "price"} ${value}${clean(p.unit, 8) ? ` ${clean(p.unit, 8)}` : ""}${from ? ` (${from})` : ""}`;
}

// ── vehicle_testimony_summary ───────────────────────────────────────────────────────────────────────────────────────

function testimonySection(data: unknown, fetchedAt: string): string[] {
  const d = obj(data);
  const kinds = Object.entries(obj(d.by_kind)).map(([k, n]) => `${clean(k, 30)} ${num(n) ?? "?"}`).join(", ");
  return [
    header("vehicle_testimony_summary", null, fetchedAt),
    `Observations visible to this viewer: ${num(d.total) ?? "unknown"}${kinds ? ` (${kinds})` : ""}, observed ${span(d.first_observed, d.last_observed) ?? "undated"}. ` +
      `The OBSERVATIONS section below holds only the most recent of these, so count from this line, not from that list.`,
  ];
}

// ── vehicle_open_questions ──────────────────────────────────────────────────────────────────────────────────────────

function questionsSection(data: unknown, fetchedAt: string, detail: number): string[] {
  const d = obj(data);
  const c = obj(d.counts);
  const out: string[] = [header("vehicle_open_questions", stamp(d.as_of), fetchedAt)];
  const kinds = arr(c.by_kind).filter(isObj).map((k) =>
    `${clean(k.kind, 30)} ${num(k.open) ?? "?"} open of ${num(k.questions) ?? "?"}`).join(", ");
  out.push(
    `Questions the system holds about this car: ${num(c.open) ?? "?"} open, ${num(c.answered) ?? "?"} answered, ` +
      `${num(c.asked) ?? "?"} put to a person, of ${num(c.questions) ?? "?"}${kinds ? ` (${kinds})` : ""}.`,
  );
  const bp = obj(c.bought_parts);
  if (Object.keys(bp).length) {
    out.push(
      `Bought parts checked against photos: ${num(bp.asked_about) ?? "?"} asked about, ${num(bp.seen_installed) ?? "?"} seen installed, ` +
        `${num(bp.seen_not_installed) ?? "?"} seen not installed, ${num(bp.not_visible) ?? "?"} not visible, ${num(bp.still_open) ?? "?"} still open.`,
    );
  }
  const open = arr(d.questions).filter((q) => isObj(q) && q.state === "open") as Obj[];
  // Doubts about facts first: they are what a person can settle.
  open.sort((a, b) => Number(b.kind === "fact_doubt") - Number(a.kind === "fact_doubt"));
  const top = open.slice(0, detail >= 1 ? 5 : 3);
  if (top.length) {
    out.push("Top open questions:");
    for (const q of top) {
      const r = obj(q.readings);
      const proposed = clean(obj(q.answer).words, 140);
      out.push(
        `- ${clean(q.subject, 80) ?? clean(q.kind, 30) ?? "question"}: ${clean(q.question, 160) ?? "?"}` +
          `${clean(r.verdict, 40) ? ` Readings: ${clean(r.verdict, 40)} (${num(r.count) ?? "?"}).` : ""}` +
          `${proposed && detail >= 1 ? ` A reader proposed, not settled: ${proposed}` : ""}`,
      );
    }
  }
  return out;
}

// ── get_vehicle_day_depth ───────────────────────────────────────────────────────────────────────────────────────────

function dayDepthSection(data: unknown, fetchedAt: string): string[] {
  const rows = arr(data).filter(isObj);
  const days = rows.map((r) => day(r.day)).filter((d): d is string => !!d).sort();
  const total = (key: string) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  return [
    header("get_vehicle_day_depth", null, fetchedAt),
    rows.length
      ? `Photo days visible to this viewer: ${rows.length} days, ${total("photos")} photos (${total("seen")} read, ${total("placed")} placed), ` +
        `${span(days[0], days[days.length - 1])}.`
      : "Photo days visible to this viewer: none.",
  ];
}

// ── work_sessions ───────────────────────────────────────────────────────────────────────────────────────────────────

function sessionsSection(data: unknown, fetchedAt: string): string[] {
  const rows = arr(data).filter(isObj);
  const minutes = (r: Obj) => Math.max(0, Number(r.duration_minutes) || 0);
  const confirmed = rows.filter((r) => r.owner_confirmed_at);
  const unconfirmed = rows.filter((r) => !r.owner_confirmed_at);
  const sum = (rs: Obj[]) => num(rs.reduce((n, r) => n + minutes(r), 0) / 60) ?? "0";
  const timed = (rs: Obj[]) => rs.filter((r) => minutes(r) > 0).length;
  const days = rows.map((r) => day(r.session_date)).filter((d): d is string => !!d).sort();
  return [
    header("work_sessions", null, fetchedAt),
    rows.length
      ? `Work sessions visible to this viewer: ${rows.length} (${span(days[0], days[days.length - 1]) ?? "undated"}). ` +
        `Confirmed by the owner: ${plural(confirmed.length, "session")}, ${sum(confirmed)} h timed (${timed(confirmed)} with a duration). ` +
        `Not confirmed: ${plural(unconfirmed.length, "session")}, ${sum(unconfirmed)} h timed (${timed(unconfirmed)} with a duration). ` +
        `Session time is a fourth, separate measure; never add it to the hour lenses above.`
      : "Work sessions visible to this viewer: none.",
  ];
}

// ── vehicle_statements ──────────────────────────────────────────────────────────────────────────────────────────────

function statementsSection(data: unknown, fetchedAt: string, detail: number): string[] {
  const d = obj(data);
  const rows = arr(d.statements).filter(isObj);
  const out: string[] = [header("vehicle_statements", null, fetchedAt)];
  const rule = clean(d.rule, 300);
  if (rule) out.push(`Reader's rule: "${rule}"`);
  out.push(`The log book: ${plural(rows.length, "statement")}${d.tied === true ? "" : " (words are hidden from this viewer)"}.`);
  for (const s of rows.slice(0, detail >= 1 ? 6 : 3)) {
    const target = clean(s.target_label, 40) ?? clean(s.target_key, 40);
    const value = clean(s.value, 60) ?? clean(s.value_note, 30);
    const words = clean(s.words, detail >= 1 ? 240 : 120);
    out.push(
      `- ${day(s.said_on) ?? "undated"}, ${clean(s.speaker_role, 30) ?? "speaker"} (${clean(s.statement_kind, 20) ?? "claim"})` +
        `${target ? `, ${target}: ${value ?? "no value"}` : ""}${words ? `: "${words}"` : ""}`,
    );
  }
  return out;
}

// ── The digest ──────────────────────────────────────────────────────────────────────────────────────────────────────

const INTRO =
  "These figures were read just now through the site's own readers, as the person asking, so each reader's privacy " +
  "rule decided what is shown. They cover all of this car's records, unlike the OBSERVATIONS list below. Say " +
  "where any figure you give comes from in plain words (the bracketed reader names are for your own bookkeeping, not " +
  "for the reply), keep the reader's meaning for what a number is, and never combine figures the digest keeps apart.";

/** The digest text for the model, within `maxChars`, from whatever the readers returned. */
export function buildRecordsDigest(reads: RecordReads, ctx: { fetchedAt: string; maxChars?: number }): string {
  const max = ctx.maxChars ?? DIGEST_MAX_CHARS;
  // Shrink by dropping detail, then systems, never by cutting text mid-way.
  const plans: Array<{ detail: number; maxSystems: number }> = [
    { detail: 2, maxSystems: 40 }, { detail: 1, maxSystems: 40 }, { detail: 0, maxSystems: 40 },
    { detail: 0, maxSystems: 12 }, { detail: 0, maxSystems: 6 }, { detail: 0, maxSystems: 0 },
  ];
  let text = "";
  for (const plan of plans) {
    text = render(reads, ctx.fetchedAt, plan.detail, plan.maxSystems);
    if (text.length <= max) return text;
  }
  // Still too long: keep whole lines up to the budget.
  const kept: string[] = [];
  let size = 0;
  for (const line of text.split("\n")) {
    if (size + line.length + 1 > max - 60) break;
    kept.push(line);
    size += line.length + 1;
  }
  kept.push("(digest cut here for length)");
  return kept.join("\n");
}

function render(reads: RecordReads, fetchedAt: string, detail: number, maxSystems: number): string {
  const blocks: string[][] = [[INTRO]];
  const section = (reader: RecordReader, build: (data: unknown) => string[]) => {
    const r = reads[reader];
    const empty = r?.status === "ok" && (r.data === null || r.data === undefined);
    if (!r || r.status !== "ok" || empty) { blocks.push([notRead(reader, r)]); return; }
    try {
      blocks.push(build(r.data));
    } catch {
      blocks.push([`[${reader}] read, but its answer was not in the expected shape; nothing from it is shown.`]);
    }
  };
  section("vehicle_build_reconstruction", (d) => buildSection(d, fetchedAt, detail, maxSystems));
  section("vehicle_testimony_summary", (d) => testimonySection(d, fetchedAt));
  section("work_sessions", (d) => sessionsSection(d, fetchedAt));
  section("get_vehicle_day_depth", (d) => dayDepthSection(d, fetchedAt));
  section("vehicle_statements", (d) => statementsSection(d, fetchedAt, detail));
  section("vehicle_open_questions", (d) => questionsSection(d, fetchedAt, detail));
  section("vehicle_profile_read", (d) => profileSection(d, fetchedAt, detail));
  return blocks.map((b) => b.join("\n")).join("\n\n");
}

/** Per-reader status and time, for the response's context and the log. */
export function readSummary(reads: RecordReads): Record<string, { status: string; ms: number }> {
  return Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, { status: r!.status, ms: r!.ms }]));
}
