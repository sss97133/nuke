---
id: 2026-11-25_owner-evidence-reader
change_type: schema
scope: owner-only read of existing keyed harness evidence
amends: 2026-11-25_physical-workspace-ui
unknowns: []
---

# Inspect a keyed wiring witness as its authorized owner

The owner authorized database work needed for the physical wiring workflow. The
existing harness snapshot stays keyed-only for every viewer. This companion read
exposes one existing observation to its already-authorized vehicle owner, through
`harness_evidence`; it creates no new testimony, artifact or engineering decision.
Case ledger 13.12.2 separates source provenance from a construction verdict.
Chapter 18's physical construction distinctions remain unchanged.

Authority is evaluated in PostgreSQL: authenticated nonanonymous JWT, nonnull
`auth.uid()`, undeleted exact vehicle, `vehicles.user_id` or `owner_id` matching the
caller, exact same-vehicle wiring/specification observation, and at least one
same-vehicle valid typed harness-evidence target. The function remains SECURITY
INVOKER so existing restrictive observation RLS applies. Execution is limited to
authenticated; no base-table grants change. A public vehicle, uploader-only
relationship, UI owner flag, or observation ID alone grants no source access.

The projection contains retained claim text, citation excerpt and page, named
source and clocks, explicit selected claim fields, and existing HTTPS source
reference. It never returns whole structured JSON, signs storage URLs, or treats
an external source reference as stored/reviewed bytes. Exact historical witnesses
remain historical; supersession is shown rather than silently replacing evidence.
The existing observation page accepts only the exact requested IDs and server
visibility marker, and clears the source projection on auth or subject changes.

Acceptance uses a disposable PostgreSQL contract with current/historical owner
positives and unauthorized, anonymous JWT, deleted/private-other vehicle,
wrong-kind, foreign observation/target, unlinked, and restrictive RLS negatives.
Frontend tests cover server qualification, safe text/URL rendering, historical
labeling, absence/error and auth/route invalidation. Production execution and the
real signed-in browser path remain separate release evidence.

Reference: `vehicle_observations`, `harness_evidence`, `harness_signals` live atlas
and grants/RLS inspected 2026-11-25; `ObservationPage.tsx` and
`observationPrivacy.ts` define the existing viewer boundary. All 828 currently
linked K5 observations have retained claim text; 238 have HTTPS source references,
22 have page numbers, 31 are superseded, and none has a keyed document/publication
ID. These are dated source-availability measures, not construction readiness.

No unresolved engineering fact is needed to implement this access-preserving
reader. Stored original document bytes, source verification, ordering, receiving,
allocation, qualified cutting and assembly remain outside this receipt.

Implemented as `20261126004251_harness_evidence_witness.sql`. Disposable PostgreSQL
17.5 contract `supabase/sql/test_harness_evidence_witness.sql` passes all five typed
targets, owned-private positive, historical observation and retained-target
separation, foreign endpoint/circuit joins, restrictive RLS, identity/JWT
negatives and unchanged base ACLs. Independent model review found no remaining
P1. Live owner-source acceptance remains with release verification.

The combined focused frontend run passes 103 tests across seven suites, including
exact owner-projection integration, malformed/wrong-subject refusals, safe text
and source-link rendering, auth/subject invalidation, historical target labels,
and unchanged public observation privacy. Production build, client-secret scan
and production React check pass. Repository-wide TypeScript checking still has
baseline errors, with no diagnostics for the changed wiring or observation files.

Permission evidence from the live project on 2026-11-25: the following metadata
probe returned authenticated SELECT true for `vehicle_observations`,
`observation_sources`, `harness_evidence` and `harness_signals`; RLS is enabled on
each. `vehicles` has no table-wide SELECT grant but does have authenticated SELECT
on the required `id`, `user_id`, `owner_id`, `deleted_at` columns. Observation
restrictive policies for owner statements, vehicle statements, garage corrections
and payment witnesses remain active; the new function does not replace them.

```sql
SELECT c.relname, c.relrowsecurity,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_read
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('vehicle_observations','observation_sources','harness_evidence','harness_signals','vehicles');

SELECT grantee,column_name,privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='vehicles' AND grantee='authenticated'
  AND column_name IN ('id','user_id','owner_id','deleted_at');
```
