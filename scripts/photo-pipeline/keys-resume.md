# Frozen cached-unit resume

`keys_lane.py --resume-plan FILE --plan-sha256 SHA256 --checkpoint PRIVATE_FILE`
validates and reconciles a fixed source cohort. Production writes remain refused:
the generic writer does not atomically enforce this claim shape's retained-source
contract and its typed consumer remains unresolved. `--write` exercises admission
only with offline test transports until those dependencies are implemented.
The legacy `--write` entry point refuses before reading credentials
or invoking a model. Legacy dry-run behavior remains unchanged; it is not part of
the zero-model resume mode.

This mode imports existing unit validation, negation checks, `body_for`, and the
existing `ingest-observation` endpoint. It does not classify images, add vocabulary,
choose a new source cohort, or resolve semantic placement uncertainty. No OAuth or
model provider credential is needed. Model-call and model-token ceilings must both
be zero. No production plan is supplied by this change.

## Frozen plan version 1

The private JSON plan contains:

- `version: 1`, exact `vehicle_id`, exact photo-custodian `user_id`, and an absolute
  Unix-seconds `deadline`; resume cannot extend it.
- `limits`: `units` (1–99), `requests` (0–594), `model_calls: 0`, `model_tokens: 0`.
- `registry`: `subjects` (key → side), `conditions` (key → state/null),
  `subject_ids`, and `condition_ids`. `registry_version` is SHA-256 of canonical
  JSON of this complete frozen registry. Current IDs and eligibility are rechecked.
- `decisions`: `parts` and `states`, in the existing check_units decision shape;
  `decisions_version` hashes that snapshot.
- `units`: exact retained `source` and projected `photo`, their `source_version`
  and `photo_version` hashes, the original `cached` unit output, `keying_model`
  attribution, and `selectors` mapping each statement index to its exact scalar
  path inside the retained source's `structured_data`.

Canonical snapshot hashes use sorted object keys, UTF-8, compact JSON. The CLI's
`--plan-sha256` instead pins the **exact file bytes**. The source/photo projection
is the explicit field list in `LiveTransport.qualify`; no whole-library scan is
performed. A parent witness and same-vehicle/image/scalar binding are required.
An existing photo without damage callouts or without a retained scalar binding
becomes a named dependency, not proof that its other source fields lack evidence.

Bodies preserve the writer's existing source-identifier format. New attribution
uses the cached-result hash instead of execution date. Retained source/photo
version hashes accompany the provenance. A changed source cannot be silently
landed under a reused identity: the prior payload must match exactly or the run
holds. Explicit `historical_payloads` may preserve an original body; where it lacks
source-version metadata, `historical_source_versions` must supply the reviewed
snapshot link. This is an input-review obligation, not inferred equivalence.

## Commit and recovery contract

The checkpoint is atomic (complete write, fsync, rename, directory fsync) and
protected by an exclusive directory lock. A stale lock is never stolen. The plan
hash, absolute deadline, request count, and each claim's attempted status survive
restart. Every claim is looked up by source registry plus stable identity,
including claims on a photo that already has another landed claim.

Before a request the checkpoint records its spent attempt. HTTP success does not
verify admission: exact payload/hash, typed descriptor, clock, source currentness,
and witness readback must pass. An unknown outcome, duplicate identities, partial
commit, source drift, or missing witness holds the run; no blind resend occurs.
Changing a plan cannot reset its existing checkpoint. A transport timeout after a
commit can reconcile successfully without another request.

`admission_verified` is separate from `consumer_verified`. The live adapter
currently returns `consumer_unresolved`: the existing facet/component readers do
not expose this lane's inferred descriptor plus text part as a qualified component
claim. It does not invent a reader or call arbitrary JSON ID presence usable
coverage. A completed admission therefore stops at the first unresolved consumer and
returns exit 5, without moving on to more claims. This consumer relation and atomic source qualification inside the generic
writer remain unresolved; the runner is not a complete source-to-profile repair.

## Offline checks

Run `python3 scripts/photo-pipeline/test_keys_resume.py`. It covers per-claim
partial resume, commit-timeout and unknown outcomes, same-second distinct photos,
source drift, negation, vocabulary dependencies, budget/deadline exhaustion,
payload conflicts, consumer gaps, atomic checkpoint files, lock exclusion, and
the public legacy-write refusal. `test_keys_lane.py` retains historical private
legacy implementation characterization; it does not authorize that writer path.
