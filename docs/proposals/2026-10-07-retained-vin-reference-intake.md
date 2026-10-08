# Retained VIN references into canonical specification observations

The taxonomy worker already verifies retained VIN references and produces
immutable receipts binding a vehicle, cache VIN, raw SHA256 and decode clock.
Those receipts do not admit the other retained factory fields into canonical
observations. The arrival decoder repeatedly selects newest missing fields;
an indexed newest-100 sample had no cache matches and 11 candidates missing
only horsepower. A separate indexed 50-row modern cache sample had 45 clean
references, 43 with public vehicle matches, displacement/cylinders in 48 rows,
trim in 42 and horsepower in 11. These samples establish shapes and local
qualification, not fleet yield.

Reuse taxonomy revision identity and arrival rather than scanning the cache
again. One operational intake table binds a revision and its real vehicle
through the existing composite key. A bounded old-revision cursor extends the
existing replay-state row; an AFTER INSERT trigger admits new revision work.
Claim at most 20 items with SKIP LOCKED, load/lock governor, finite deadlines,
lease recovery, transient backoff/pause and explicit semantic refusals. No
second immutable result store: results are canonical vehicle_observations.

Existing batch-vin-decode receives an explicit service-only retained-queue
mode. Existing ingest-observation independently loads the selected revision,
current public real parent and retained cache bytes. A protected reference
mode verifies exact VIN/raw/projection/clock/hash agreement and clean ErrorCode
0. Typed observation FKs bind cache VIN and the first supporting same-vehicle
taxonomy revision. Preserve original raw reference and source recording
microseconds, label the role factory_reference, defer inference and report
physical_configuration_verified=false. Current physical fields are not
overwritten by this lane. Existing NHTSA source supports specification;
reference fields retain its variable namespace, with unsupported numeric
tokens withheld and original testimony preserved.

Source identity and content hash exclude taxonomy processing/projection
changes: two revisions supporting the same vehicle/decode reuse one canonical
claim and retain the original supporting FK. Changed source content or source
recording time earns a separate claim. Completion requires a persisted
protected observation with matching vehicle/VIN/raw hash/source clock, not an
HTTP acknowledgement. Existing cached taxonomy reader gains the corresponding
factory reference and current stale state. Assay separates work completions,
distinct canonical observations, refusals, failures and replay coverage.

No new source/property vocabulary, provider fetch, per-row model job, native
sale admission or physical-verification assertion. Use checked migration and
existing CI deploy, then observe natural arrival, replay and cached consumer.
The bounded offline prototype qualified20 of20 sampled public parents from
the latest200 accepted taxonomy revisions, including displacement/cylinders,
horsepower/fuel/trim. This is source selection evidence, not fleet yield.
Local validation passes59 Deno tests,59 PostgreSQL assertions and actual
multi-backend producer/claim/state/parent/result lock tests. The enforced local
repository gate passes. Deployment and natural runtime verification are pending.

Catalog sizing estimates11.18M observations/8.35GB. Add nullable typed source
columns with NOT VALID FKs: historical rows have NULL pointers, and every new
or changed binding is enforced immediately. Current bounded consumers use the
existing observation PK. Reverse-source indexes and historical validation are
deferred to a separately measured access need, keeping this deployment free of
a blocking whole-table scan. The new operational table is fully keyed/indexed
and private; its11 columns plus7 added columns are described and owners are
registered. Standing cadence is20 claims every15min, at most80/hour, with no
paid inference or provider requests.

The first CI attempt exposed the profile job's missing local Node type install.
Run these Deno checks with node-modules-dir=none, preserving type checking and
using Deno's dependency cache; fetch mocks explicitly describe the web request
options they inspect. Pin both touched production SDK imports to2.117.3, the
current version actually resolved by the fresh CI attempt and verified against
the official October7 release. All59 tests and the worker check pass with that
exact SDK. The legacy Node HTTP harness explicitly recognizes this pinned
import; all76 existing intake tests pass, preserving their source/refusal checks.

The migration creates its cron inactive. Existing automatic deployment activates
the fixed contract only after both edge owners successfully deploy in that run.
The activation function is deployment-owner-only and rejects a changed cadence,
route or body; API roles cannot activate a partial rollout. This prevents old
worker versions from interpreting a new queue request as ordinary VIN decoding.
All actual PR checks and natural runtime remain required before delivery.
