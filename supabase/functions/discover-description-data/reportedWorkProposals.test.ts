import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseProposalArray, verifyReportedWorkProposal } from "./reportedWorkProposals.ts";

const text = "This 1998 SL600 is offered with records. The brake fluid was flushed in September 2026. " +
  "The fuel and air filters were replaced under current ownership, and an oil change was performed in April 2026. " +
  "The thermostat and horns were replaced, and the coolant was flushed in August 2025. " +
  "Two of the tires were reportedly replaced in July 2026. The seller notes the bumper was refinished in May 2019. " +
  "Fluid services were performed in 2024, and the drive belts were replaced in August 2026. " +
  "A timing belt service is recommended in March 2027.";
const p = (sentence: string, performed_clause = sentence, month = "September", year = "2026") => ({ sentence, performed_clause, month, year });

Deno.test("a verbatim single dated clause is kept with month precision", () => {
  const v = verifyReportedWorkProposal(p("The brake fluid was flushed in September 2026."), text, "2026-10");
  assertEquals(v, { kept: true, source_value: "The brake fluid was flushed in September 2026.", performed_clause: "The brake fluid was flushed in September 2026.",
    reported_date: "2026-09", reported_date_label: "September 2026", date_precision: "month" });
});

Deno.test("the dated clause of a two-clause sentence is kept; the whole sentence as clause is refused", () => {
  const s = "The fuel and air filters were replaced under current ownership, and an oil change was performed in April 2026.";
  assertEquals(verifyReportedWorkProposal(p(s, "an oil change was performed in April 2026", "April"), text, "2026-10").kept, true);
  assertEquals(verifyReportedWorkProposal(p(s, s, "April"), text, "2026-10"), { kept: false, reason: "clause_joins_several_clauses" });
  const t = "The thermostat and horns were replaced, and the coolant was flushed in August 2025.";
  assertEquals(verifyReportedWorkProposal(p(t, t, "August", "2025"), text, "2026-10"), { kept: false, reason: "clause_joins_several_clauses" });
});

Deno.test("paraphrase, attribution, hedging, recommendation, mixed dates and late dates are refused", () => {
  const r = (x: unknown, m = "2026-10") => (verifyReportedWorkProposal(x, text, m) as { reason?: string }).reason;
  assertEquals(r(p("The brake fluid was replaced in September 2026.")), "sentence_not_verbatim_in_source");
  assertEquals(r(p("Two of the tires were reportedly replaced in July 2026.", undefined, "July")), "attributed_hedged_negated_or_recommended");
  assertEquals(r(p("The seller notes the bumper was refinished in May 2019.", undefined, "May", "2019")), "attributed_hedged_negated_or_recommended");
  assertEquals(r(p("A timing belt service is recommended in March 2027.", undefined, "March", "2027")), "attributed_hedged_negated_or_recommended");
  const mixed = "Fluid services were performed in 2024, and the drive belts were replaced in August 2026.";
  assertEquals(r(p(mixed, "the drive belts were replaced in August 2026", "August")), "not_exactly_one_month_year");
  assertEquals(r(p("The brake fluid was flushed in September 2026.", undefined, "October")), "proposed_date_differs_from_text");
  assertEquals(r(p("The brake fluid was flushed in September 2026."), "2026-08"), "date_after_capture_or_invalid");
  assertEquals(r(p("The brake fluid was flushed in September 2026.", "The coolant was flushed in September 2026.")), "clause_not_in_sentence");
  assertEquals(r("nope"), "not_an_object");
});

Deno.test("proposal arrays parse from fenced or bare model output and refuse anything else", () => {
  assertEquals(parseProposalArray("```json\n[{\"sentence\":\"x\"}]\n```"), [{ sentence: "x" }]);
  assertEquals(parseProposalArray("[]"), []);
  assertEquals(parseProposalArray("{\"sentence\":\"x\"}"), null);
  assertEquals(parseProposalArray("not json"), null);
});
