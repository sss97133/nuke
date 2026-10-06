// deno test supabase/functions/_shared/batChassis.test.ts
// Synthetic fixtures only: every identifier below is invented. 11111111111111111 is the placeholder VIN
// (its ISO 3779 check digit happens to pass).
import { chassisFromListItemText, isIdentityGradeVin, readBatChassis } from "./batChassis.ts";
import { extractEssentials } from "./batParser.ts";

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const VIN_OK = "11111111111111111";
const VIN_BAD_DIGIT = "11111111211111111"; // position 9 should be 1
const VIN_WITH_O = "1111111O111111111"; // letter O in a 17-character value

/** a lot page shaped like the live one: sidebar essentials block, Listing Details list, then the description */
const page = (items: string[], after = "") =>
  `<html><body><div class="essentials"><div class="item"><strong>Location</strong>: <a href="#">Nowhere, Nevada</a></div>` +
  `<div class="item"><strong>Listing Details</strong><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>` +
  `<div class="item additional">Private Party</div></div><div class="post-excerpt">${after}</div></body></html>`;

const anchor = (v: string) => `Chassis: <a href="https://www.google.com/search?q=${v}" target="_blank">${v}</a>`;

Deno.test("modern VIN, anchor form and plain form", () => {
  const a = readBatChassis(page([anchor(VIN_OK), "65k Miles Shown, TMU"]));
  equal([a.read?.value, a.read?.kind, a.read?.form, a.read?.checkDigitOk, a.statements], [VIN_OK, "vin17", "html-anchor", true, 1]);
  const p = readBatChassis(page([`Chassis: ${VIN_OK}`]));
  equal([p.read?.value, p.read?.kind, p.read?.form], [VIN_OK, "vin17", "html-plain"]);
});

Deno.test("short chassis: the 11-character floor is gone", () => {
  for (const [shown, value] of [["AB12345", "AB12345"], ["ab12345", "AB12345"], ["12345", "12345"], ["ABC1234567890123", "ABC1234567890123"]]) {
    const r = readBatChassis(page([`Chassis: ${shown}`])).read;
    equal([r?.value, r?.kind, r?.rejected], [value, "chassis", null], shown);
    const viaAnchor = readBatChassis(page([anchor(shown)])).read;
    equal(viaAnchor?.value, value, `${shown} (anchor)`);
  }
});

Deno.test("I, O and Q are legal in a short chassis, illegal only in a 17-character VIN", () => {
  equal(readBatChassis(page(["Chassis: ID00000COLO"])).read?.value, "ID00000COLO");
  equal(readBatChassis(page(["Chassis: 7Q12L3N4567"])).read?.value, "7Q12L3N4567");
  const r = readBatChassis(page([`Chassis: ${VIN_WITH_O}`])).read;
  equal([r?.value, r?.rejected, r?.raw], [null, "vin_illegal_chars", VIN_WITH_O]);
});

Deno.test("separators stay, whitespace inside the value goes", () => {
  equal(readBatChassis(page(["Chassis: XYZ30-12345"])).read?.value, "XYZ30-12345");
  equal(readBatChassis(page(["Chassis: AM300/3/0001"])).read?.value, "AM300/3/0001");
  equal(readBatChassis(page(["Chassis: XYZ30 12345"])).read?.value, "XYZ3012345");
  equal(readBatChassis(page(["Chassis: XY 1Z234567"])).read?.value, "XY1Z234567");
  equal(readBatChassis(page(["Chassis: 999.999-99-999999"])).read?.value, "999.999-99-999999"); // 17 characters, separated: a chassis, not a VIN
  equal(readBatChassis(page(["Chassis: AB123456789-12345"])).read?.value, "AB123456789-12345");
  equal(readBatChassis(page(["Chassis: AB123456789-123456789"])).read?.rejected, "too_long");
  equal(readBatChassis(page(["Chassis: -AB12345"])).read?.rejected, "bad_chars");
  equal(readBatChassis(page(["Chassis: AB12345."])).read?.value, "AB12345"); // trailing punctuation is not part of it
  equal(readBatChassis(page(["Chassis: AB12345;"])).read?.value, "AB12345");
  equal(readBatChassis(page(["Chassis: AB!12345"])).read?.rejected, "bad_chars"); // a typo inside the value is not repaired
});

Deno.test("label case, VIN label, entities and non-breaking spaces", () => {
  const lower = readBatChassis(page(["chassis: ab12345"])).read;
  equal([lower?.label, lower?.value], ["Chassis", "AB12345"]);
  const vin = readBatChassis(page([`VIN: ${VIN_OK}`])).read;
  equal([vin?.label, vin?.value], ["VIN", VIN_OK]);
  equal(readBatChassis(page(["Chassis:&nbsp;AB12345"])).read?.value, "AB12345");
  equal(readBatChassis(page(["Chassis:  AB12345 "])).read?.value, "AB12345");
  equal(readBatChassis(page(["  Chassis  :   AB12345  "])).read?.value, "AB12345");
  equal(readBatChassis(page(["<span>Chassis:</span> <b>AB12345</b>"])).read?.value, "AB12345");
  equal(readBatChassis(page(["Chassis: Chassis: AB12345"])).read?.value, "AB12345");
  equal(readBatChassis(page(["Chassis: VIN# AB12345"])).read?.value, "AB12345");
});

Deno.test("a 17-character VIN keeps its check digit; the statement survives the refusal", () => {
  const r = readBatChassis(page([anchor(VIN_BAD_DIGIT)])).read;
  equal([r?.value, r?.kind, r?.checkDigitOk, r?.rejected, r?.raw, r?.candidate], [null, null, false, "check_digit", VIN_BAD_DIGIT, VIN_BAD_DIGIT]);
  equal(readBatChassis(page([`Chassis: ${VIN_OK.toLowerCase()}`])).read?.value, VIN_OK);
  equal(readBatChassis(page([`Chassis: ${VIN_OK.slice(0, 5)} ${VIN_OK.slice(5)}`])).read?.value, VIN_OK);
});

Deno.test("refusals: placeholder, multiple, prose, shape, length", () => {
  const why = (shown: string) => readBatChassis(page([`Chassis: ${shown}`])).read?.rejected;
  equal(why("N/A"), "placeholder");
  equal(why("Unknown"), "placeholder");
  equal(why("ABCXXXXXXXXXXXXXX"), "placeholder");
  equal(why("00000000"), "placeholder");
  equal(why("AB12345 & CD67890"), "multiple");
  equal(why("AB12345, CD67890"), "multiple");
  equal(why("SEE NOTES 1"), "prose");
  equal(why("state title only"), "prose");
  equal(why("Smith 0000"), "prose");
  equal(why("ABCDEFG"), "no_digit");
  equal(why("1234"), "too_short"); // the DB flags a pre-1981 VIN under 5 characters

  equal(why("AB1"), "too_short");
  equal(why("ABCDEFGH12345678901"), "too_long");
  equal(why("JYARP15E4CCA0079931"), "too_long");
  equal(why(""), "empty");
  equal(why("   "), "empty");
});

Deno.test("only the Listing Details list is read", () => {
  // no Listing Details list at all
  const none = readBatChassis(`<div class="essentials"><div class="item"><strong>Seller</strong></div></div>`);
  equal([none.read, none.statements], [null, 0]);
  // a chassis in a list that is not Listing Details, and one in the description, are not the lot's statement
  const prose = readBatChassis(
    page(["65k Miles Shown", "Red over Black"], `<ul><li>Chassis: ZZ99999</li></ul><p>Chassis: ZZ99999 and exhaust headers</p>`),
  );
  equal([prose.read, prose.statements], [null, 0]);
  // a Listing Details list with no chassis line
  equal(readBatChassis(page(["65k Miles Shown", "Chassis Dyno Sheet", "Vinyl Roof"])).read, null);
});

Deno.test("two statements: the first is returned, the count says it is ambiguous", () => {
  const r = readBatChassis(page([`Chassis: AB12345`, "Red over Black", `Chassis: CD67890`]));
  equal([r.read?.value, r.statements], ["AB12345", 2]);
  // a refused first statement does not hide a good second one in the item loop, but the document still reports both
  equal(r.read?.rejected, null);
});

Deno.test("markdown snapshot: heading line, bullet, bold label, link", () => {
  const md1 = `**Listing Details** Chassis: AB12345\n- 98k Kilometers (~61k Miles) Shown, TMU\n- 3.8-Liter Inline-Six\n`;
  equal([readBatChassis(md1).read?.value, readBatChassis(md1).read?.form], ["AB12345", "markdown"]);
  const md2 = `## Listing Details\n\n- Chassis: [${VIN_OK}](https://www.google.com/search?q=${VIN_OK})\n- 65k Miles Shown\n`;
  equal(readBatChassis(md2).read?.value, VIN_OK);
  const md3 = `**Listing Details**\n\n- **Chassis:** ab12345\n- 65k Miles Shown\n`;
  equal(readBatChassis(md3).read?.value, "AB12345");
  const md4 = `Some text without the section. Chassis: AB12345`;
  equal(readBatChassis(md4).read, null);
});

Deno.test("chassisFromListItemText: the per-item entry point the readers loop over", () => {
  equal(chassisFromListItemText("Chassis: AB12345")?.value, "AB12345");
  equal(chassisFromListItemText("65k Miles Shown"), null);
  equal(chassisFromListItemText("Chassis Dyno Sheet"), null);
  equal(chassisFromListItemText("Vinyl Roof"), null);
  equal(chassisFromListItemText("Frame: AB12345"), null);
  equal(chassisFromListItemText("Chassis: N/A")?.rejected, "placeholder");
});

Deno.test("isIdentityGradeVin: the region identity lookups trusted before the reader changed", () => {
  equal(isIdentityGradeVin(VIN_OK), true);
  equal(isIdentityGradeVin("AB123456789"), true); // 11
  equal(isIdentityGradeVin("AB12345"), false); // short
  equal(isIdentityGradeVin("ID00000COLO"), false); // I and O
  equal(isIdentityGradeVin("XYZ30-12345"), false); // separator
  equal(isIdentityGradeVin(null), false);
});

Deno.test("batParser.extractEssentials reads the chassis through the same reader", () => {
  const e = extractEssentials(page(["Chassis: AB12345", "65k Miles Shown, TMU", "2.5-Liter Inline-Six"]));
  equal(e.vin, "AB12345");
  equal(extractEssentials(page([anchor(VIN_OK)])).vin, VIN_OK);
  // a 17-character VIN that fails its check digit is returned as stated, as before: the guard is extract-bat-core's
  // vinCheckDigitOk (which keeps the receipt) and the archive's vin_checkdigit_ok column, not this reader
  equal(extractEssentials(page([anchor(VIN_BAD_DIGIT)])).vin, VIN_BAD_DIGIT);
  equal(extractEssentials(page(["Chassis: N/A"])).vin, null);
});
