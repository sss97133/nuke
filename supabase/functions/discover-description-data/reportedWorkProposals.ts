// Model-proposed publisher work reports, kept only where the stored listing text itself carries them.
// A proposal is a pointer into the source, never a claim of its own: every kept field is re-derived from
// or checked against the exact source text, and anything the text does not literally say is refused.

export const REPORTED_WORK_PROPOSAL_PROMPT_VERSION = "reported-work-proposal-v1";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_YEAR = new RegExp(`\\b(${MONTHS.join("|")}) ([12][0-9]{3})\\b`, "g");
const WITHHELD = /\b(?:not|no|never|without|or|would|could|might|may|should|planned|proposed|intend\w*|believed|alleged|reportedly|apparently|possibly|if|unless|but|however|instead|actually|seller|carfax|autocheck|invoice|according|notes?|states?|said|told|tells|describes?|claims?|estimated|approximately|around|circa|recommend\w*|needs?|requires?|required|reported)\b|[?"“”]/i;

export function reportedWorkPrompt(text: string, vehicle: { year?: number | null; make?: string | null; model?: string | null }) {
  return `You are reading one vehicle auction listing description. Find every sentence that states work that was
completed on this vehicle and dates that work to a specific month and year (for example "The brake fluid was flushed
in September 2026.").

Rules:
- Copy each sentence EXACTLY as it appears, character for character, including its final punctuation.
- performed_clause is the exact part of that sentence that states the completed work and its month and year.
- month is the full English month name and year is four digits, both exactly as written in the sentence.
- Leave out work that is planned, recommended, needed, hypothetical, negated, uncertain ("reportedly"), or
  attributed to someone (a seller, a report, an invoice, Carfax), and work dated only by a year or a relative time.
- Do not paraphrase, merge sentences, or add anything that is not in the text.

VEHICLE: ${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}
DESCRIPTION:
${text}

Return ONLY a JSON array of objects with keys "sentence", "performed_clause", "month", "year". Return [] if none.`;
}

export type ProposalVerdict =
  | { kept: true; source_value: string; performed_clause: string; reported_date: string; reported_date_label: string; date_precision: "month" }
  | { kept: false; reason: string };

/** Checks one model proposal against the exact stored text. `capturedMonth` is YYYY-MM of the source capture. */
export function verifyReportedWorkProposal(proposal: unknown, sourceText: string, capturedMonth: string): ProposalVerdict {
  if (!proposal || typeof proposal !== "object") return { kept: false, reason: "not_an_object" };
  const p = proposal as Record<string, unknown>;
  const sentence = typeof p.sentence === "string" ? p.sentence.trim() : "";
  const clause = typeof p.performed_clause === "string" ? p.performed_clause.trim() : "";
  if (!sentence || !clause) return { kept: false, reason: "missing_sentence_or_clause" };
  if (new TextEncoder().encode(sentence).length > 300) return { kept: false, reason: "sentence_too_long" };
  if (!sourceText.includes(sentence)) return { kept: false, reason: "sentence_not_verbatim_in_source" };
  if (!/[.!]$/.test(sentence)) return { kept: false, reason: "not_a_whole_sentence" };
  if (!sentence.includes(clause)) return { kept: false, reason: "clause_not_in_sentence" };
  if (WITHHELD.test(sentence)) return { kept: false, reason: "attributed_hedged_negated_or_recommended" };
  const dates = [...sentence.matchAll(MONTH_YEAR)];
  if (dates.length !== 1 || (sentence.match(/\b[12][0-9]{3}\b/g) ?? []).length !== 1) return { kept: false, reason: "not_exactly_one_month_year" };
  const [, month, year] = dates[0];
  if (!clause.includes(`${month} ${year}`)) return { kept: false, reason: "date_not_in_clause" };
  // One dated clause: in "A was replaced, and B was flushed in May 2024" the month may govern only B.
  if ((clause.match(/\b(?:was|were|is|are|has|have|had)\b/gi) ?? []).length > 1) return { kept: false, reason: "clause_joins_several_clauses" };
  if (p.month !== month || String(p.year) !== year) return { kept: false, reason: "proposed_date_differs_from_text" };
  const reported = `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}`;
  if (!/^[0-9]{4}-[0-9]{2}$/.test(capturedMonth) || reported > capturedMonth || Number(year) < 1886) return { kept: false, reason: "date_after_capture_or_invalid" };
  return { kept: true, source_value: sentence, performed_clause: clause, reported_date: reported,
    reported_date_label: `${month} ${year}`, date_precision: "month" };
}

export function parseProposalArray(raw: string): unknown[] | null {
  const text = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start === -1 || end < start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
