import { listingContributorEvidence, readListingEvidence } from "./listingEvidence.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("listing preserves attributed testimony while excluding superseded answers and private upload metadata", () => {
  const result = listingContributorEvidence({
    invites: [{ contributor_id: "builder", display_name: "Example Builder", relationship: "builder", visits: ["private"] }],
    answers: [
      { observation_id: "old", answer_text: "earlier claim", is_superseded: true },
      { observation_id: "current", answer_text: "I rebuilt it", contributor_id: "builder", is_superseded: false,
        device_attestation: { ip_sha256: "private" }, recorded_by_user_id: "private" },
    ],
    uploads: [
      { image_id: "private-title", is_sensitive: true },
      { image_id: "unknown-privacy" },
      { image_id: "receipt", is_sensitive: false, contributor_id: "builder", storage_path: "private", device_fingerprint: "private" },
    ],
  });
  assert(result.testimony.length === 1 && result.testimony[0].observation_id === "current", "current observation must be cited");
  assert(result.testimony[0].source.name === "Example Builder", "statement must name its contributor");
  assert(result.testimony[0].evidence_kind === "contributor_statement", "testimony must remain testimony");
  assert(result.documents.length === 1 && result.documents[0].image_id === "receipt", "sensitive or unqualified files must stay out");
  assert(!JSON.stringify(result).includes("private"), "device, storage and recorder metadata must not enter a listing");
  assert(!("document_ids" in result.testimony[0]), "shared contributor must not invent document support for an answer");
});

Deno.test("listing reader preserves the caller and reports a refused reader as unavailable", async () => {
  const actors: unknown[] = [];
  const denied = await readListingEvidence({ rpc: (_name, params) => {
    actors.push(params.p_acting_as);
    return Promise.resolve({ data: null, error: { code: "42501" } });
  } }, "vehicle", "different-user");
  assert(denied.status === "unavailable", "refused evidence is unavailable, not empty");
  assert(actors.length === 2 && actors.every((a) => a === "different-user"), "never retry private readers as the owner");
  const noActor = await readListingEvidence({ rpc: () => { throw new Error("must not read"); } }, "vehicle", null);
  assert(noActor.status === "unavailable", "missing actor cannot read intake");
});

Deno.test("answer uses its invitation role; an upload without that relation keeps conflicting roles unknown", () => {
  const result = listingContributorEvidence({
    invites: [
      { invite_id: "one", contributor_id: "person", display_name: "Example", relationship: "builder" },
      { invite_id: "two", contributor_id: "person", display_name: "Example", relationship: "previous_owner" },
    ],
    answers: [{ observation_id: "answer", answer_text: "Statement", is_superseded: false, contributor_id: "person", invite_id: "one" }],
    uploads: [{ image_id: "file", is_sensitive: false, contributor_id: "person" }],
  });
  assert(result.testimony[0].source.relationship === "builder", "preserve the role on this answer's invitation");
  assert(result.documents[0].source.relationship === null, "missing upload-to-invitation relation must stay unknown");
});
