# Conditional operating-case candidate

This is the implementation candidate for the existing schema proposal
`f8215459-ec38-4e2e-a855-509257740313`, registered by migration
`20261126203826`. No file here is an automatically applied migration. Each
module refuses a database outside `dm_refinement_%` on PostgreSQL 17, inside
its transaction, so a default `psql` session cannot continue into its DDL after
that refusal.

The ordered entrypoint is
[`../harness_operating_case_runtime.sql`](../harness_operating_case_runtime.sql).
The native repository contract uses synthetic public-source/qualification
adapters and the existing worker fixtures:

```sh
scripts/ci/run-db-contracts.sh test_harness_operating_case_runtime.sql
```

`recipe.sql` owns complete, immutable agent-authored revisions, typed wire,
element and boundary inputs, and comparison against the expected prior head.
It advances a private generation without changing the public structural epoch.
`compile.sql` consumes an exact current structural receipt, physical piece/end
keys, current versioned checks and explicit analytical parameters. It produces
a bounded network or typed holds. Unkeyed conditional planning retains its
stock/specification holds; known failures, missing checks and obsolete versions
cannot qualify a numerical network.

`results.sql` calls the existing `harness_model_dc_compute(jsonb)` kernel and
closes typed parameter, node, branch and issue children atomically. Closure
replays the actual calculation and checks exact values and scope membership.
The private result reader rechecks source, recipe and interpreter identities in
the current statement. A historical solved result is retained but its numbers
are hidden when dependencies change.

The worker modules extend the existing `model_fold_tick` procedure and its
single vehicle work row/lease. They commit selection before compilation,
isolate private failures and retry budgets, yield to the generic followup,
recover an abandoned attempt once, and retain the existing controls. Selection
is an eligibility hint; the guarded claim locks and rechecks the case after the
vehicle lease exists. A concurrently locked recipe is skipped without charging
the private budget, followed by one generic turn and a yield. Existing
service-role callers retain helper execution without direct private table DML.
The claim, prepare, finish and recovery mutators still enforce their genuine
tick/backend and exact vehicle-attempt context. Read/eligibility helpers and
the bounded seeder remain callable by the existing service role.

`worker_consumers.sql` extends the existing monitoring and revert owners.
Timing denominators stay separate by phase. Reverting generic worker effects
does not erase immutable private calculation history or report a complete
revert while such outputs remain. Exact retained consumer body hashes and
unique patch anchors reject an unexpected integration target.

`metadata.sql` defines every proposed column, including units, keys, signs,
clocks, writer attribution and unknown/currentness semantics. There is no new
queue, physical connectivity graph, source-value owner or public reader.

Production installation requires the existing curator process for the table
proposal, a reviewed migration through normal CI, current ownership/lock
preflight, and live source/RLS/worker-budget verification. This candidate and
its synthetic contract establish none of those production stages. Numerical
results remain conditional simulation: device laws, material applicability,
protection, physical fit, purchasing, cut lengths, assembly and builder-facing
schematics require their own qualified inputs and consumer acceptance.
