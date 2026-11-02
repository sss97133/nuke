// Package testimony with its source, never as an uncited vehicle specification.
type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => Array.isArray(v)
  ? v.filter((x): x is Row => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;

export function listingContributorEvidence(intake: Row) {
  const invites = rows(intake.invites);
  const source = (id: unknown, inviteId?: unknown) => {
    const exact = invites.find((i) => text(inviteId) && i.invite_id === inviteId && i.contributor_id === id);
    const candidates = exact ? [exact] : invites.filter((i) => text(id) && i.contributor_id === id);
    const unique = (key: string) => {
      const values = new Set(candidates.map((i) => text(i[key])));
      return values.size === 1 ? [...values][0] : null;
    };
    return { contributor_id: text(id), name: unique("display_name"), relationship: unique("relationship") };
  };
  return {
    status: "available",
    // Documents are separate evidence. Sharing a contributor does not prove a document supports an answer.
    testimony: rows(intake.answers).filter((a) => a.is_superseded === false && text(a.observation_id) && text(a.answer_text))
      .map((a) => ({
        observation_id: a.observation_id, question_key: text(a.question_key), prompt: text(a.prompt),
        statement: a.answer_text, observed_at: text(a.observed_at), source: source(a.contributor_id, a.invite_id),
        evidence_kind: "contributor_statement",
      })),
    documents: rows(intake.uploads).filter((u) => u.is_sensitive === false && text(u.image_id))
      .map((u) => ({ image_id: u.image_id, label: text(u.label), received_at: text(u.created_at),
        source: source(u.contributor_id), evidence_kind: "received_file" })),
  };
}

export interface EvidenceReader {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function readListingEvidence(reader: EvidenceReader, vehicleId: string, actorId: string | null) {
  if (!actorId) return { status: "unavailable", reason: "no_authorized_actor" };
  const params = { p_vehicle_id: vehicleId, p_acting_as: actorId };
  const [intake, progress] = await Promise.all([
    reader.rpc("get_contributor_intake", params), reader.rpc("contributor_intake_progress", params),
  ]);
  // Both existing readers check that the actor owns or edits this vehicle. Never retry as its owner.
  if (intake.error || progress.error || !intake.data || !progress.data) {
    return { status: "unavailable", reason: "evidence_reader_unavailable" };
  }
  return { ...listingContributorEvidence(intake.data as Row), audit: progress.data };
}
