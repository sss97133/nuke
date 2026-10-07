# Retained VIN reference → current canonical taxonomy

The October7 cache intake does not refresh older vehicle taxonomy: the existing
`set_vehicle_canonical_taxonomy` trigger only fires on vehicle VIN/body writes.
Its cache lookup also accepts error-bearing decodes. The owner requested this
re-derive pass and ongoing retained-data automation.

## Ownership and earned shapes

Live atlas/registry and trigger catalog checked October7. Reuse `vin_decoded_data`
(owner scripts/mass-vin-decode.ts), canonical_body_styles/canonical_vehicle_types,
the two normalizers and the existing vehicle taxonomy trigger. Existing completion,
metric, value and statistics queues each own another projection; no generic taxonomy
queue or revision owner was found. No new VIN cache, vocabulary or testimony class.

Four derived/operational shapes are earned: vehicle-keyed dirty queue with current
receipt pointer; a separate append-only invalidation mailbox; append-only vehicle/input calculation receipts with cache and
canonical vocabulary FKs; singleton resumable primary-key replay state. They
support incremental processing, reproducible provenance and bounded old-data replay.
The receipt records current input/classification, not physical verification or a
historical build specification. Body-style testimony and raw cache remain untouched.

## Qualification and consumer

Extend the existing owner with one shared calculation. Raw body scalar provenance remains unassayed; this pass preserves the existing precedence, without asserting physical truth. A nonblank recorded body
style retains precedence. Cache factory references require exact uppercase VIN
binding, structurally valid17-character VIN, provider nhtsa, explicit ErrorCode0,
a nonfuture decoded clock, raw VIN agreement and typed/raw body/type consistency. Unknown/error/short/corrected decodes are withheld.
Only keys present in the existing active vocabularies may be returned. An unknown
physical style is not silently replaced by a contradictory factory body class.
Factory classification remains explicitly labelled as a reference, not proof that
the physical vehicle has that configuration.

The original trigger and the queue writer share that calculation. The queue writes
only the existing two derived canonical columns, and only when different; it does
not issue no-op VIN/body updates or alter raw evidence. Existing trigger side
effects were inspected: no paid HTTP extraction; feed refresh is a notification,
completion is another queue, field-evidence collection ignores these two columns.
Use a cached receipt reader plus canonical vehicle-column equality assay.

## Bounds, replay and failure

Cache changes and vehicle VIN/body changes enqueue current work. A service-only
replay resets a cache-PK cursor/generation; a finite keyset seed gradually discovers
old matching vehicles through the existing upper(VIN)/undeleted partial index.
The mailbox keeps intake appends independent of worker queue locks; claimed IDs are consumed atomically and newer requests remain pending. Worker uses NO KEY UPDATE so producer FK checks can proceed. Seed only while pending work is below500; process at most25 vehicles per minute,
with a20-second outer budget, lock/load governor and SKIP LOCKED. Catch record
errors, back off15min and pause after3; keep previous receipt visible as stale.
New input invalidation resets the failure state. No inference/provider calls.

Initial full replay may take days at this conservative rate. Job-health must remain
partial until the cursor is exhausted and dirty work drained; cron success alone
does not establish coverage. Input hash deduplicates replay; changed evidence appends
a revision. Explicit replay is also the recipe/vocabulary invalidation path.

Acceptance: clean cached reference reaches existing canonical columns and a typed
receipt; physical body precedence and error refusal survive; source corrections
enqueue/revise; repeated identical inputs do not update vehicle rows or duplicate
receipts; worker handles locks, concurrent invalidation and failures; API roles
cannot invoke writers or directly mutate operational/revision tables. All schema,
functions and cron through one new migration and normal checked PR/CI deployment.

Measured before: indexed first100 cache keys bind89 live unmerged vehicles,
four clean references,85 error-bearing references,39 blank body styles and three
clean body re-derive differences. This lexical boundary is intentionally not a
representative fleet sample. The initial unconstrained join timed out; a bounded
LATERAL lookup completed promptly without raising timeout or adding an index.
