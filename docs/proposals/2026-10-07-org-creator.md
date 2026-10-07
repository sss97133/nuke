# Pre-mint memo: a declared service-role organization creator (batch, keyed by canonical domain)

Drafted 2026-10-07 by session skylar-66 for the identity-origin lane (skylar-c7), who owns `organizations` and makes the
decision and the build. Shape per `docs/features/organization-entity/SPEC.md` and SCHEMA_LAW
(`~/lofficiel-concierge/supabase/SCHEMA_LAW.md`). Every number below was read live on 2026-10-07 between 10:30Z and
11:10Z with `scripts/data/q.sh`, or from the SBIR.gov bulk award file pulled the same day.

## 0. The decision the owner must make first

`organizations` is 100% automotive today: 5,733 rows, 4,036 with a website, 1,328 distinct domains, 45 museums, one
"college", 56 Nevada rows. The funding stack (S61, case ledger 13.9) needs 2,802 federal-awardee small businesses and
252 research institutions as organization rows, none of which exist (0 of 2,802 by domain or name; 0 of 252 by name).
Creating them changes what the table is: from "businesses and collections around vehicles" to "any organization the
ledger has an observation about". The SPEC already says the entity is the accumulation of documented actions, not an
authored profile, so this is consistent; but it is an expansion of scope, and rows become public by default
(`is_public` defaults to true, so each lands on `/org/:id`). **The owner approves this scope and the public default
before any row is created.** Everything below is conditional on that approval.

## 1. Search before mint (SCHEMA_LAW 1): the writers that exist, and why none fits

| Writer | What it does | Why it does not fit the batch |
|---|---|---|
| `create-org-from-url` (edge fn, the declared owner in `pipeline_registry`) | One URL; canonicalizes to https + no-www + origin; looks up by exact origin (with or without trailing slash); creates, or non-destructively enriches missing fields; `force_new` bypasses the lookup; writes `metadata.org_intake` (source_url), a `business_timeline_events` row, and queues a synopsis `ingestion_jobs` row | Requires a signed-in user: `supabase.auth.getUser(jwt)` stamps `discovered_by`/`uploaded_by`; a service-role bearer gets HTTP 401 "Invalid session" (probed 2026-10-07 05:37Z). One URL per call; scrapes the site live for name/address. |
| `onboard-source` (edge fn, `requireWriteAuth`) | Creates a source organization through the `businesses` view after a website-variant lookup | Scoped to onboarding a listing source (it also writes `source_registry` and analyzes the homepage); not a general creator; no staged keys; no receipt |
| `extract-gaa-classics`, `link-document-entities` | Each creates one specific org inline | Not general |
| Seed scripts (`scripts/load-perplexity-orgs.ts`, `scripts/stbarth/seed-publishers.mjs`, `scripts/create-forum-orgs.js`) | Service-role batch inserts; `load-perplexity-orgs.ts` dedupes against an in-memory set of lowercased websites, then chunk-inserts | The pattern the batch needs already exists three times as ad-hoc scripts: no shared canonicalization, no receipt, no registry row, no staged keys, no contract. This is the duplication §1 exists to stop. |
| `resolve_organization_from_url(text,text,text)` (SQL) | Service-role find-or-create | **Retired 2026-10-07 (#770)**: undeclared, and a scheme-less website gave an empty domain that matched 232 rows for nsf.gov (would have returned the wrong organization). |
| `enrich_organization` (SQL), `update_organization_stats` trigger | Update paths | Not creators |

Also live: `write_receipts` shows 1,286,980 **undeclared** UPDATEs on `organizations` in its window (last 2026-10-07), the
registry row says "undeclared UPDATEs continue (93,453 in 30 days), co-timed with extract-gooding, which sends no
X-Nuke-Writer". The table already has a writer-hygiene problem; the new creator must not add to it (declared writer
header, receipt per batch).

**Conclusion:** no declared service-role creator exists; three ad-hoc scripts prove the need; the retired function
proves the risk. Mint one function, and retire the three scripts' creation paths in favor of it (subtractive).

## 2. Facts are observations first (SCHEMA_LAW 2): what is a row, what is an observation

- The **organization row** is the entity key: `business_name` (NOT NULL), canonical `website` (nullable), `city`,
  `state`, `zip_code`, `country` (default US), `metadata`. Nothing else is asserted at creation.
- Every **fact about the organization** (that it received an award; its employee count at award; its DUNS/UEI; that
  it is a research institution on an STTR award) is an observation with the DNA grammar, not a column: either a
  `vehicle_observations` row with `subject_type = 'organization'` (the CHECK already admits it; rows exist) or a
  staged entry inside `metadata` carrying the same grammar until the fact class earns a column (below).
- `business_type` stays **NULL** for these rows. Its CHECK vocabulary is automotive (`garage`, `dealership`,
  `restoration_shop` ... `auction_house`, `marketplace`), and SPEC §0 forbids baking a taxonomy; "federal awardee",
  "research institution" and "small business" are projections of observations at render time, never a stored type.

## 3. One grammar (SCHEMA_LAW 3): the staged external keys

DUNS and UEI are **staged keys in `metadata`**, not new columns, each a sourced entry:

```json
"external_keys": [
  {"key": "duns", "value": "123456789", "source": "sbir-gov-awards", "method": "declared-source-reader@v0",
   "observed_at": "2026-10-07T10:30:00Z", "trust": "T2", "confidence_score": 0.9}
]
```

Precedent in the table: `uq_organizations_sibarth_id` is a partial UNIQUE index on `(metadata->>'sibarth_id')`, a
staged key already enforced at the data layer. The creator's idempotency keys, in order:

1. **Canonical website** (https, no www, origin only), when the source carries a website: 1,652 of 2,802 awardee
   firms (59%). Today uniqueness is enforced only inside `create-org-from-url`'s lookup; there is **no UNIQUE on
   `website`**. The batch needs it at the data layer: a partial unique index on the canonical expression (or on a
   generated canonical column) so two batches cannot race into duplicates. Decide how legacy rows that already
   violate it are handled (count them in the contract's preflight; toolbox adjudication, not prevention, per the
   owner's rule: shop-clean duplicates, never a mechanism that refuses).
2. **DUNS** (2,532 of 2,802 firms; UEI on NSF API rows), as a partial unique index on `(metadata->>'duns')` like
   `sibarth_id`, for the 1,150 firms with no website.
3. **Name + state** as a lookup only, never a key: it finds a candidate for enrich; it does not create or merge.

Conflict rule, stated: domain wins; if a DUNS matches a row whose domain differs, do not merge, write the DUNS as a
staged key on the domain row only if that row has none, and record the conflict in the receipt's `rows` note (count
of `conflicts`). Merges are a human act (the SPEC's dual-ledger work), never the creator's.

## 4. Supersede, never overwrite (SCHEMA_LAW 4): enrich semantics

The creator is the batch sibling of `create-org-from-url`: **COALESCE-fill only**. An existing non-null field is
never changed; `metadata` is merged, never replaced; `external_keys` appends, never rewrites; a changed value is a new
observation about the organization, not an UPDATE of the row. `force_new` is the only bypass and exists for the
operator, not the batch. No blind INSERT anywhere: every row goes through the lookup.

## 5. Invariants at the data layer, with attack tests (SCHEMA_LAW 5): the PG17 contract

On synthetic rows in the PG17 harness (`scripts/ci/verify.sh` pattern; `supabase/sql/test_*_contract.sql`):

1. Same domain twice (http/https, www, trailing slash, path noise) creates one row.
2. Existing non-null `business_name`/`city` is not overwritten by a later batch; a null one is filled.
3. Same DUNS with no website twice creates one row; DUNS matching a row with a different domain creates no row and
   counts a conflict.
4. `force_new` creates a second row only when passed explicitly.
5. The row carries `discovered_by IS NULL`, `uploaded_by IS NULL`, `discovered_via = 'declared-source:<slug>'`,
   `metadata.org_intake.source_url` set, `business_type IS NULL`.
6. One `write_receipts` row per batch via `record_write_receipt` (writer = the function's name, `rows` = rows created
   + enriched, `op` stated), and `pipeline_registry` names the function as a creator of `organizations`.
7. A scheme-less or empty website never matches anything (the retired function's failure, as an attack test).
8. Legacy preflight: the count of existing rows that would violate the new unique index, asserted and listed, before
   the index is created.

## 6. Writers disjoint; registries ride along (SCHEMA_LAW 6)

- One SQL function (`SECURITY INVOKER`, EXECUTE granted to `service_role` only), called by the declared-source reader
  and by the three seed-script replacements; name in the house grammar, no synonym of "create org" already used
  (`create_organization_batch(...)` or the lane's choice; §8).
- The migration includes the `pipeline_registry` row (`write_via` names the function; `do_not_write_directly`), the
  two partial unique indexes (CONCURRENTLY, bounded `statement_timeout`/`lock_timeout`, never 0), and the COMMENT ON
  for any new object.
- The three seed scripts' insert paths are retired to calls of the function in the same change set (subtractive), or
  their retirement is a named follow-up with a date.

## 7. The ledger (SCHEMA_LAW 7)

One migration file with a WHY block citing this memo, the live counts above, the retirement of
`resolve_organization_from_url` (#770), and the probe that showed `create-org-from-url` refusing the service role.
RLS posture unchanged (the table's existing policies); the function writes as the invoker.

## 8. Demand and payloads, for the first run (after the owner's approval)

- `~/nuke-logs/nsf-awards-20261007/awardee_keys.json`: 2,802 NSF Phase I awardee firms since 2015 (name, city, state,
  domain, DUNS, award count, named research institutions) and the 252 institutions with award counts.
- Order: the funder (National Science Foundation, nsf.gov; today the owner's own click, or the first row of the
  batch if the owner prefers), then the 252 institutions (universities; domains to be supplied from a public source,
  else name + state as lookup and no row until a domain is known, since a university without a domain is not a
  canonical-domain row), then the 1,652 firms with a domain, then the 1,150 firms by DUNS.
- Consumer that proves it (data-machine.md repair loop step 4): the declared-source reader's key pass writes, per
  award, an observation on the awardee organization (`relation: awarded_by`, funder id) once the row exists, and
  S61's needs "awardee organization key" and "research institution key" flip from missing to present through
  `stack_coverage`, with no new stack version (13.1 point 4).

## 9. Open to the lane

- Whether the canonical-domain uniqueness goes on a generated column or an expression index.
- Whether institutions without a domain get a row at all before a domain is known (the memo says no).
- The function's name and the receipt `op` vocabulary.
- Whether the created rows are `is_public = true` (default) or held private until the owner has seen a sample; the
  memo recommends the owner decides this with the scope in §0.

## Preflight result (2026-10-07, read-only on prod)

Ran §5.8 before proposing the unique indexes:

- `organizations` with a website: **4,036**
- exact-duplicate website strings: **471**
- canonical-dup groups (across http/https/www): **278**
- duplicate `metadata.duns`: **0**

**Consequence:** a UNIQUE index on `website` (raw or canonical) cannot be created today — 471/278 legacy
rows violate it. Per the owner's toolbox rule, duplicates are shop-cleaned, never refused by a mechanism; and
per this memo §3, org merges are a human act (the dual-ledger work), not the creator's. So the website unique
index is **deferred** behind a legacy org-dedup pass (lead/owner lane). `create_organization_batch` (#810) is
unaffected: it variant-looks-up before insert, so it never *creates* a duplicate; the index was only a
concurrent-batch race-guard. The `metadata.duns` partial unique index has 0 violators and can be added
CONCURRENTLY (bounded `statement_timeout`, never 0) when the NSF batch is about to land.
