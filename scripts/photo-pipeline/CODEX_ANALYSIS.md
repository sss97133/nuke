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
Existing active readings for this producer are skipped. Individual RPC retries use
an identical payload so an uncertain transport response does not duplicate a row.
After a partially failed batch, read back that run before resuming. Capture stdout's
observation IDs and verify the run's reading/provenance, null vehicle IDs and
unchanged filing before reporting the batch admitted.

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
