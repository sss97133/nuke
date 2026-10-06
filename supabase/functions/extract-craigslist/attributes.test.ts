// Run: deno test --allow-read=supabase/functions/extract-craigslist/fixtures supabase/functions/extract-craigslist/attributes.test.ts
// The parser of a Craigslist post's attribute block, against pages the pipeline had stored (sanitized, see
// fixtures/README.md) and against the rules a VIN row has to pass before it may be the vehicle's VIN.
import {
  captureHasContent,
  stripTags,
  judgeVin,
  parseAttributes,
  parseCapture,
  parseOdometer,
  parsePostInfo,
  pickCapture,
} from "../_shared/craigslistAttributes.ts";

function equal(actual: unknown, expected: unknown, note = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${note} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const page = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const CLASSIC = "CKY145Z123456"; // synthetic, in classic-vin-manual-truck.html
const MODERN = "1B7KF23D3WJ123456"; // synthetic, valid check digit, in modern-vin-17-full-block.html

// ---- the VIN row --------------------------------------------------------------------------------------------

Deno.test("a classic VIN on a 1975 post is accepted and the seller's text is kept", () => {
  const a = parseAttributes(page("classic-vin-manual-truck.html"));
  equal([a.vin, a.vin_raw, a.vin_rejected], [CLASSIC, CLASSIC, null]);
});

Deno.test("a 17-character VIN with a valid check digit is accepted", () => {
  const a = parseAttributes(page("modern-vin-17-full-block.html"));
  equal([a.vin, a.vin_raw, a.vin_rejected], [MODERN, MODERN, null]);
});

Deno.test("a post with no VIN row has no VIN, no raw VIN and no reason, and the VIN typed in its text is not read", () => {
  const a = parseAttributes(page("no-vin-diesel-fair.html"));
  equal([a.vin, a.vin_raw, a.vin_rejected], [null, null, null]);
  assert(!("auto_vin" in a.raw), "no auto_vin row");
  assert(page("no-vin-diesel-fair.html").includes("1ABCD23E4FG567890"), "the fixture carries a VIN-shaped string in its text");
});

Deno.test("a 17-character VIN that fails its check digit is not the VIN; the text and the reason are kept", () => {
  const bad = MODERN.slice(0, 8) + "4" + MODERN.slice(9); // check digit 3 -> 4
  const a = parseAttributes(page("modern-vin-17-full-block.html").replace(MODERN, bad));
  equal([a.vin, a.vin_raw, a.vin_rejected], [null, bad, "check_digit_failed"]);
});

Deno.test("judgeVin: what is and is not identity-grade", () => {
  const j = (text: string, year: number | null) => {
    const r = judgeVin(text, year);
    return [r.vin, r.rejected];
  };
  equal(j(MODERN, 1998), [MODERN, null], "modern");
  equal(j(CLASSIC, 1975), [CLASSIC, null], "classic");
  equal(j(CLASSIC, 1980), [CLASSIC, null], "1980 is still classic");
  equal(j("cky 145-z123456", 1975), [CLASSIC, null], "case, spaces and hyphens");
  equal(j(CLASSIC + " ", 1975), [CLASSIC, null], "trailing space");
  equal(j(CLASSIC, 1981), [null, "length_vs_year"], "a 1981 vehicle must carry 17 characters");
  equal(j(CLASSIC, null), [null, "year_unknown"], "classic length needs a year to be judged");
  equal(j("1234567", 1962), [null, "too_short"], "7 characters is not an identity (the database cut-off is 11)");
  equal(j("9X99Z12345", 1965), [null, "too_short"], "10 characters");
  equal(j("29847B0000000", 1963), [null, "masked_serial"], "serial all zeros");
  equal(j("11111111111", 1970), [null, "placeholder"], "one character repeated");
  equal(j("N/A", 1970), [null, "not_vin_shaped"], "text");
  equal(j("see description", 1970), [null, "illegal_letters"], "prose has I and O in it");
  equal(j("ASK", 1970), [null, "too_short"], "short prose");
  equal(j(MODERN.slice(0, 16) + "Q", 1998), [null, "illegal_letters"], "Q is not a VIN character");
  equal(j(MODERN + "X", 1998), [null, "too_long"], "18 characters");
  equal(j("ABCDEFGHJKLMN", 1970), [null, "not_enough_digits"], "letters only");
  equal(j("", 1975), [null, null], "empty row");
  equal(j(MODERN.slice(0, 8) + "4" + MODERN.slice(9), 1998), [null, "check_digit_failed"], "a 17 whose check digit is wrong is not trusted");
  equal(j(MODERN, 1975), [MODERN, null], "a 17-character VIN on an old post still has to pass its check digit, and does");
});

Deno.test("judgeVin keeps exactly what the seller typed", () => {
  const r = judgeVin("  cky 145-z123456  ", 1975);
  equal(r.raw, "cky 145-z123456");
  equal(r.vin, CLASSIC);
});

// ---- odometer, title status, flags, the rest of the block ---------------------------------------------------

Deno.test("an odometer with commas is a whole number, and the text is kept", () => {
  const a = parseAttributes(page("classic-vin-manual-truck.html"));
  equal([a.odometer, a.odometer_raw], [96213, "96,213"]);
  equal(parseOdometer("219,500"), 219500);
  equal(parseOdometer("1"), 1);
  equal(parseOdometer("0"), 0);
  equal(parseOdometer("3,000,000"), 3000000, "a semi can show a million miles");
});

Deno.test("an odometer that is not a plain number is not a reading", () => {
  equal(parseOdometer(""), null);
  equal(parseOdometer(null), null);
  equal(parseOdometer("unknown"), null);
  equal(parseOdometer("125k"), null);
  equal(parseOdometer("12,34"), null);
});

Deno.test("10,000,000 is the field's ceiling, not a reading: the number is null and the text stays", () => {
  const a = parseAttributes(page("odometer-placeholder-ten-million.html"));
  equal([a.odometer, a.odometer_raw], [null, "10,000,000"]);
  equal(a.raw["auto_miles"], "10,000,000");
});

Deno.test("title status variants are kept as the page states them", () => {
  const status = (name: string) => parseAttributes(page(name)).title_status;
  equal(status("classic-vin-manual-truck.html"), "clean");
  equal(status("title-salvage.html"), "salvage");
  equal(status("title-rebuilt.html"), "rebuilt");
  equal(status("title-parts-only.html"), "parts only");
  equal(status("title-lien.html"), "lien");
  equal(status("title-missing-odometer-rolled-over.html"), "missing");
});

Deno.test("the two odometer disclosures are read, alone and together", () => {
  const f = (name: string) => {
    const a = parseAttributes(page(name));
    return [a.odometer_broken, a.odometer_rolled_over];
  };
  equal(f("classic-vin-manual-truck.html"), [false, false]);
  equal(f("odometer-broken.html"), [true, false]);
  equal(f("title-missing-odometer-rolled-over.html"), [true, true]);
});

Deno.test("the whole block of a full post, typed and raw", () => {
  const a = parseAttributes(page("classic-vin-manual-truck.html"));
  equal(
    [a.condition, a.cylinders, a.drive, a.fuel, a.paint_color, a.transmission, a.type],
    ["good", "8 cylinders", "4wd", "gas", "silver", "manual", "truck"],
  );
  equal(Object.keys(a.raw), [
    "year", "makemodel", "auto_vin", "condition", "auto_cylinders", "auto_drivetrain", "auto_fuel_type",
    "auto_miles", "auto_paint", "auto_title_status", "auto_transmission", "auto_bodytype",
  ]);
  equal([a.raw["year"], a.raw["makemodel"], a.raw["auto_drivetrain"]], ["1975", "chevy k10 4x4", "4wd"]);
});

Deno.test("a row the post does not have is null, never a guess", () => {
  const a = parseAttributes(page("no-vin-diesel-fair.html"));
  equal(a.type, null);
  const b = parseAttributes(page("title-lien.html"));
  equal([b.drive, b.cylinders, b.type], [null, null, null]);
  equal([b.condition, b.fuel, b.paint_color], ["excellent", "diesel", "yellow"]);
});

Deno.test("the attribute object has the same keys on every page", () => {
  const keys = (name: string) => Object.keys(parseAttributes(page(name))).join(",");
  const base = keys("classic-vin-manual-truck.html");
  for (const n of ["modern-vin-17-full-block.html", "no-vin-diesel-fair.html", "title-lien.html", "odometer-broken.html", "legacy-paragraph-markup.html"]) {
    equal(keys(n), base, n);
  }
  equal(base, "vin,vin_raw,vin_rejected,odometer,odometer_raw,odometer_broken,odometer_rolled_over,title_status,condition,transmission,drive,fuel,cylinders,paint_color,type,raw");
});

Deno.test("the older paragraph markup is read the same way", () => {
  const a = parseAttributes(page("legacy-paragraph-markup.html"));
  equal([a.vin, a.odometer, a.title_status, a.condition, a.drive, a.fuel, a.cylinders, a.paint_color, a.type, a.transmission],
    ["124379N123456", 83000, "clean", "excellent", "rwd", "gas", "8 cylinders", "red", "coupe", "manual"]);
  equal([a.raw["year"], a.raw["makemodel"]], ["1969", "chevrolet camaro"]);
});

Deno.test("rows are read only above the posting text: a seller who types markup cannot add a row", () => {
  const html = page("no-vin-diesel-fair.html").replace(
    "SAMPLE POSTING TEXT.",
    '<div class="attr auto_vin"><span class="labl">VIN:</span> <span class="valu">1B7KF23D3WJ123456</span></div> SAMPLE POSTING TEXT.',
  );
  equal(parseAttributes(html).vin_raw, null);
});

// ---- the post's own id and clocks ---------------------------------------------------------------------------

Deno.test("post id, posted and updated time, as ISO 8601 UTC", () => {
  const c = parseCapture(page("classic-vin-manual-truck.html"));
  equal([c.post_id, c.posted_at, c.updated_at], ["7000000001", "2026-01-02T11:04:05.000Z", "2026-01-03T12:05:06.000Z"]);
});

Deno.test("a post that was never updated has no updated time", () => {
  const c = parseCapture(page("no-vin-diesel-fair.html"));
  equal([c.post_id, c.posted_at, c.updated_at], ["7000000003", "2026-01-02T11:04:05.000Z", null]);
});

Deno.test("a seller who types a post id or a time in the text does not become the post", () => {
  const html = page("classic-vin-manual-truck.html").replace(
    "SAMPLE POSTING TEXT.",
    'post id: 1234567890 posted: <time datetime="2020-01-01T00:00:00-0000">x</time> SAMPLE POSTING TEXT.',
  );
  // the seller's lines come first in the document order of this page, the post's own lines after the text
  const c = parseCapture(html);
  equal([c.post_id, c.posted_at], ["7000000001", "2026-01-02T11:04:05.000Z"]);
});

Deno.test("the post id falls back to the number in a regional URL, never to a share token", () => {
  const noInfo = "<html><body>nothing here</body></html>";
  equal(parsePostInfo(noInfo, "https://sample.craigslist.org/cto/d/sample-vehicle/7000000001.html").post_id, "7000000001");
  equal(parsePostInfo(noInfo, "https://www.craigslist.org/view/d/sample-vehicle/FixtureToken000001").post_id, null);
  equal(parsePostInfo(noInfo, null).post_id, null);
});

Deno.test("an unparseable or absurd time is null, not a date", () => {
  const html = (dt: string) => `<p class="postinginfo reveal">posted: <time datetime="${dt}">x</time></p>`;
  equal(parsePostInfo(html("not a date")).posted_at, null);
  equal(parsePostInfo(html("1969-01-01T00:00:00-0000")).posted_at, null);
  equal(parsePostInfo(html("2999-01-01T00:00:00-0000")).posted_at, null);
  equal(parsePostInfo(html("2026-10-05T23:36:10-0700")).posted_at, "2026-10-06T06:36:10.000Z");
});

// ---- not a post; carrying a capture between functions -------------------------------------------------------

Deno.test("tags are removed by scanning, so nothing a removal leaves behind can be a tag", () => {
  equal(stripTags("a <b>bold</b> word"), "a bold word");
  equal(stripTags("<scr<script>ipt>alert(1)</scr</script>ipt>"), "ipt>alert(1)ipt>");
  equal(stripTags("x <a href='1>2'>y"), "x 2'>y", "a > inside a quoted attribute ends the tag, as the old regex did");
  equal(stripTags("5 < 6 and no closing bracket"), "5 < 6 and no closing bracket", "an unclosed < is text");
  equal(stripTags("a<br>b", " "), "a b");
  equal(stripTags("<!-- c -->t"), "t");
  assert(!stripTags("<<<a>>><<b>").includes("<"), "no < survives when every one is closed");
});

Deno.test("comments are not read: a row inside an HTML comment is not a row", () => {
  const html = page("no-vin-diesel-fair.html").replace(
    '<div class="attrgroup">',
    '<!-- <div class="attr auto_vin"><span class="labl">VIN:</span> <span class="valu">1B7KF23D3WJ123456</span></div> --><div class="attrgroup">',
  );
  equal(parseAttributes(html).vin_raw, null);
  const unterminated = page("no-vin-diesel-fair.html").replace('<div class="attrgroup">', '<!-- never closed <div class="attrgroup">');
  equal(parseAttributes(unterminated).raw, {}, "an unterminated comment hides the rest, as a browser reads it");
});

Deno.test("a page that is not a post parses to nothing and nothing is recorded", () => {
  for (const html of ["", "<html><body><h2>This IP has been automatically blocked.</h2></body></html>", "<div class=\"attrgroup\"></div>"]) {
    const c = parseCapture(html);
    equal(captureHasContent(c), false);
    equal(c.attributes.raw, {});
    equal(pickCapture(c), null);
  }
});

Deno.test("a capture survives JSON unchanged", () => {
  const c = parseCapture(page("modern-vin-17-full-block.html"));
  equal(pickCapture(JSON.parse(JSON.stringify(c))), c);
});

Deno.test("pickCapture refuses anything that is not a Craigslist capture", () => {
  equal(pickCapture(null), null);
  equal(pickCapture("text"), null);
  equal(pickCapture({}), null);
  equal(pickCapture({ attributes: {} }), null);
  equal(pickCapture({ attributes: { raw: [] } }), null);
  equal(pickCapture({ post_id: "7000000001", posted_at: "2026-01-02T11:04:05.000Z" }), null, "another source's own posted_at is not a capture");
});

Deno.test("pickCapture drops a malformed field and keeps the rest", () => {
  const good = parseCapture(page("classic-vin-manual-truck.html"));
  const c = pickCapture({
    post_id: "not digits",
    posted_at: 5,
    attributes: { ...good.attributes, vin: 12345, odometer: "96,213", odometer_broken: "yes", fuel: ["gas"], raw: { ...good.attributes.raw, x: 1 } },
  });
  assert(c !== null, "still a capture");
  equal([c.post_id, c.posted_at, c.attributes.vin, c.attributes.odometer, c.attributes.odometer_broken, c.attributes.fuel],
    [null, null, null, null, false, null]);
  equal(c.attributes.title_status, "clean");
  assert(!("x" in c.attributes.raw), "a non-string raw value is dropped");
});

Deno.test("pickCapture keeps a clock only if it is an ISO UTC time a timestamptz column will take", () => {
  const good = parseCapture(page("classic-vin-manual-truck.html"));
  const clocks = (posted: unknown, updated: unknown) => {
    const c = pickCapture({ post_id: good.post_id, posted_at: posted, updated_at: updated, attributes: good.attributes });
    assert(c !== null, "still a capture");
    return [c.posted_at, c.updated_at];
  };
  equal(clocks("2026-01-02T11:04:05.000Z", "2026-01-03T12:05:06Z"), ["2026-01-02T11:04:05.000Z", "2026-01-03T12:05:06Z"]);
  equal(clocks("yesterday", "2026-13-45T99:99:99Z"), [null, null]);
  equal(clocks("2026-01-02T03:04:05-0800", 12345), [null, null], "an offset form or a number is not carried");
});
