---
change_type: substrate_correction
scope: atomically install the reviewed conditional operating-case runtime under the existing owner-authorized manual build path
unknowns: []
---

The operating-case implementation is versioned and tested but its ten tables and
private worker integration are absent from production. The automatic proposal
function has no add_table application branch. This installation uses the existing
manual build pattern in migration `20261007014500_stack_registry.sql`: record the
owner's already-expressed build authorization with explicit agent attribution,
without inventing a human review, authenticated user or owner signature. The
current owner authorized this harness schema build on 2026-11-26.

Migration `20261127031811` locks the exact agent-owned proposal and checks its
unchanged payload, evidence, scope and compatibility. A claimed or independently
reviewed open proposal, rejection, supersession, changed definition or partial
runtime refuses installation. An existing approved decision is preserved. The
DC kernel and retained worker definition, owner, procedure kind, invoker mode,
transaction configuration and service-only entrypoint are checked before DDL;
the existing monitoring/revert modules also enforce their retained definitions.

All twelve reviewed inner SQL modules are unchanged from the source candidate.
Only their outer transaction and disposable-database guards are replaced by one
production installation transaction. Ten tables, private authoring/compiler/
result functions, column definitions and existing-worker integration commit
together. The final statement records authorized-build metadata only when the
proposal remains open. No review row, measured-key gate marker, source claim,
physical state, device parameter, scheduler or public reader is introduced.

Grounding: the existing proposal `20261126203826`, reviewed runtime source and
`2026-11-26_operating-case-runtime-contract` receipt, data-machine case13.12
criteria1-8 and10, and the manual-build migration cited above. Physical decisions
and measurement unknowns in `K5_WIRING_STATE.md` sections1-4 and wire/protection
canon chapter16 remain separate from this plumbing change. No physical route,
wire specification, installed material or engineering conclusion is inferred.

Validation uses the same complete native PG17 runtime behavior contract through
the actual production migration, alongside the original candidate and retry
contracts. The separate refusal contract reads the exact tracked migration on
the psql client, checks changed/foreign/claimed/rejected states and interpreter/
permission drift, and proves that a late consumer mismatch rolls back every new
table, telemetry column and worker edit. It also verifies that an existing
approved decision and its timestamp are not rewritten. All public-source and
qualification adapters in these contracts remain explicit synthetic fixtures.

An installation failure rolls back the entire transaction. After successful
installation, private recipes are disabled or superseded through their existing
writer rather than deleting history. Any worker-hook rollback requires a new
reviewed migration with current definition checks; it retains immutable recipe
and result testimony. No hand-applied rollback is authorized by this receipt.

Deployment remains the normal checked PR/Supabase CI path. Actual source/RLS,
private currentness and the unchanged worker budget must be verified live after
installation. The owner-facing device/port interpretation, segmented schematic,
configured stock, ordering, cutting and assembly acceptance remain open. The
empty unknown list applies only to this installation code, not the physical
harness or full product outcome.
