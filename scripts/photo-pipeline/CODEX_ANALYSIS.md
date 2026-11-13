# Subscription vision reading admission

Review eligible photos in batches of at most 50 using the current session. Keep the
manifest and actual image readings outside git. Exclude private/personal images
and the privacy-hold set before image access. A supplied gallery label is a hint:
exclude self-reference matches, record disagreement, and leave identity unsure
when the visible evidence is insufficient.

`codex_image_analysis_ingest.py` validates a JSONL batch against its scoped JSONL
manifest and rechecks current sensitivity and personal-photo rejection before
admission. It calls `ingest_image_observation` with null vehicle ID and incidental
role. View, possible identity and reference evidence remain in the reading JSON;
the producer never files images. The importer requires a service credential;
visual reading itself requires no model API key or paid API invocation.

The signature is attribution metadata, not a cryptographic signature: actual model
name reported by the session, session ID, producer git commit, confidence, run UUID
and ingestion time. Do not invent a model snapshot identifier. `category=unknown`
is supported for vehicle details whose body category cannot be established;
`category=none` means no vehicle category applies. The remaining contract-v1 enums
are unchanged. Documents remain `reading.view=document`, with incidental database
role to match the sanctioned RPC's accepted roles.

```
python3 scripts/photo-pipeline/codex_image_analysis_ingest.py \
  --in /private/batch/readings.jsonl --manifest /private/batch/manifest.jsonl \
  --model ACTUAL_SESSION_MODEL --session SESSION_ID --run-id RUN_UUID --dry-run
```

After checking the dry run, omit `--dry-run`. Keep the same run UUID on retries.
Existing active readings are skipped only after their exact reading, confidence,
model, session, both run markers and null-vehicle incidental role match. A conflicting
reading or duplicate active row fails the whole preflight before any new write;
inspect the conflict and use the bounded withdrawal path before admitting a correction.
The original producer commit remains on an unchanged retry. Individual RPC retries use
an identical payload so an uncertain transport response does not duplicate a row.
After a partially failed batch, read back that run before resuming. Capture stdout's
observation IDs. The producer reads the complete active batch back, checks its
reading/provenance and null vehicle IDs, and checks each RPC-returned ID before
reporting success. `verified` includes exact existing rows; `written` includes
only this invocation's new, verified admissions. A failed readback may follow
successful writes: inspect the run before retrying. Independently check unchanged
filing before reporting the batch admitted.

Confidence values are subjective judgments, not calibrated probabilities or an
identity verification rate. New admissions label this explicitly with
`confidence_kind=subjective_uncalibrated` in attribution metadata. Do not derive
confidence from image category or the good/fair/poor quality label, or use overall
reading confidence as vehicle-match confidence. Record per-image reasons for the
judgment. This metadata does not recalibrate historical readings.

For withdrawal, repeat the same invocation with `--revert`. The deployed
`revert_codex_image_analysis_batch` RPC accepts 1–50 image IDs, only deactivates
this producer's null-vehicle incidental rows when both run markers match, and
keeps testimony intact. It cannot withdraw a different producer or identity row.
The new RPC must deploy through the normal migration CI before live admission is
considered reversible. No raw REST insert/update fallback is supported.

Focused checks:

```
python3 -m unittest discover -s scripts/photo-pipeline -p 'test_codex_image_analysis_ingest.py'
```

`test_codex_analysis_revert.sql` is a minimal fixture for a newly created, isolated
local PostgreSQL database with the usual anon/authenticated/service_role roles.
It is not a production assay and must not be run against the live project.
