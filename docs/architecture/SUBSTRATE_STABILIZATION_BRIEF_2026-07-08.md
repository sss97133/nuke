# Substrate Stabilization Brief — 2026-07-08

**For: a dedicated agent.** Mission: make the underlying data substrate stable enough
to be a product. Five failure classes, each measured, each with evidence on disk.
This brief is the handoff — read it, then execute in the order below.

**Read first:** `.claude/rules/agent-trust-invariants.md` (NEVER delete/overwrite
testimony; supersede or relink only), `supabase/functions/CLAUDE.md`,
`docs/architecture/ENTITY_RESOLUTION_RULES.md`.

**The pattern for every class** (proven by migration
`20260625130000_correct_image_provenance`): (1) a sanctioned, citation-required,
supersession-safe **chokepoint** for corrections; (2) a **batch pass** through it
for the known backlog; (3) an **ingest gate** so the class stops growing. Do not
do case-by-case cleanup without the gate.

---

## Context: where the evidence came from

The dHash backfill on `image_identities` completed 2026-07-08 ~02:38Z:

- Coverage: **19,292 / 24,300 identities have `phash_hex`** (79.4%), hash space
  `dhash boxmean/area-avg 9x8 v2` (do NOT hamming-match against the pre-existing
  11,681 legacy phash rows or 253 raw-16hex rows — different spaces; see header of
  `dhash-backfill.mjs`).
- Remaining 5,008 fully accounted: 4,852 no reachable URL (no `vehicle_images`
  row) + 120 dead URLs + 36 collision-losers.
- Evidence files:
  - `output/dhash-backfill-collisions.jsonl` — 57 events, **36 unique pairs**
  - `output/dhash-collision-pairs-2026-07-07.csv` — the 36 deduped pairs
  - `output/dhash-backfill-deadurls.jsonl` — 120 dead-URL identities w/ reason
  - `logs/dhash-backfill.log` — full run history
  - `dhash-backfill.mjs` — runner (patched 2026-07-08: dead-list + collision
    exclusion on resume, so re-runs don't trip the 20% abort gate)

## Class 3 (DO FIRST): field-level pollution at ingest — dates & platform

**Symptom, observed live 2026-07-08:** Barrett-Jackson vehicles carry
`sale_date = 2026-02-27` (the ingest day) stamped over sales that actually
happened 2006–2024 (real year visible in `listing_url`, e.g. `scottsdale-2009`).
Mecum URLs (`mecum.com/lots/...`) sit under `canonical_platform = 'barrett-jackson'`.
This silently corrupts every time-windowed analysis (comps, market trends).

**First action — size it:** count rows where `sale_date` equals the row's ingest
date signature (same-day clusters of hundreds of rows across decades of URL years),
per platform. Decide 40 rows vs 40,000 before designing the pass.

**Fix shape:** correction chokepoint à la `correct_image_provenance` but for
`vehicles` sale/platform fields — citation required (the URL itself is the
citation for BJ years), original preserved, supersession-safe. Then an ingest
gate: reject/flag `sale_date` defaulting to now() when the source URL embeds a
conflicting year.

## Class 1: duplicate vehicle records (dhash cross-vehicle collisions)

Bit-identical images attached to two different vehicle records. From the 36
pairs, 31 are same-vehicle duplicate uploads (benign), **5 are cross-vehicle**:

| identity_a | identity_b | veh_a | veh_b | read |
|---|---|---|---|---|
| 1f7b47da-ba07-4103-b2b0-7e91ab15b7ac | baabac2d-2e3e-4605-a096-1a9f17866a68 | 1973 Dodge Charger 360 | 1973 Dodge Charger 318 | dup record |
| 2e817396-bc74-4e4f-a913-29b0adc92bd6 | e1dd9d2f-1889-43c7-b09b-7fc39545d870 | 1973 Dodge Charger 318 | 1973 Dodge Charger 360 | dup record |
| 3445699c-5987-4164-84f7-5d536b0eecbb | 6c2ca4d4-b927-4f65-ae18-28579b99cebd | 1973 Dodge Charger 360 | 1973 Dodge Charger 318 | dup record |
| 739dd692-6915-426d-8f58-c599f84f9579 | eb3f73de-f36b-437f-ab07-f7b42eb58000 | 1977 Chevrolet K5 Blazer | 1977 Chevrolet Blazer | dup record (likely Skylar's K5 — extra care) |
| 036e6768-10a3-4d7f-a26d-4f66748544eb | 4645f481-60a2-448a-afeb-a96a5cd5a725 | 1966 Ford Mustang | 1979 Chevrolet K10 | misattributed image → Class 2 |

Three independent identical images on the same Charger pair = one car, two
records (318 vs 360 engine trim disagreement to resolve from evidence).

**Then widen the net:** exact-match collisions are the floor. Run a
hamming-distance pass (≤4 bits) across the 19,292 hashed identities in THIS hash
space only — near-dupes (recrops, recompressions) will surface more duplicate
records. Route resolutions through `merge_proposals` (approved row required
before `merge_into_primary()`). NEVER raw-delete the loser record.

## Class 2: misattributed testimony

The Mustang↔K10 pair above; plus the known capture-relay corruption class
(memory: `feedback_capture_relay_corrupt_library_is_truth`). Machinery exists:
`reattribute_observation()`, ghost vehicles, fork-don't-hide
(`feedback_wrong_attribution_forks_not_hides`). Needs eyes on the actual image
before reattributing (fetch both identities' URLs, look). Populate
`merged_from_vehicle_id` lineage on every moved row.

## Class 4: broken evidence chains on identities

- 4,852 identities (20%) with no `vehicle_images` row → no URL to resolve.
  Classify: evidence elsewhere (relink) vs genuinely orphaned (mark explicitly —
  a status, not a delete).
- 120 dead URLs (reasons in the deadurls file — mostly fetch/decode fail =
  deleted storage objects). Same classification task.

## Class 5: redundant unreconciled columns

5+ price columns, 3 date columns on `vehicles`; `trg_resolve_canonical_columns`
papers over them but Class 3 proves garbage flows through. Prior art: ISSUES.md
entry "[MEDIUM] 6 duplicate BaT column pairs" (FIXED 2026-04-12,
`document_duplicate_bat_columns` migration — CANONICAL/DEPRECATED comments).
This class mostly falls out of fixing 1 and 3; don't start here.

## Execution order & rules

1. Class 3 (sizing → chokepoint → batch → gate)
2. Class 1 (5 known pairs → merge proposals; then hamming pass)
3. Class 2 (image-eyes-first, then reattribute)
4. Class 4 (classify, relink or mark)
5. Class 5 (falls out; column-level truth decisions as encountered)

- Every correction cites its evidence. No citation → mark unknown, don't guess.
- Schema changes, merges of Skylar's own vehicles, anything destructive-looking:
  surface to Skylar first.
- Log completed work via `claude-log-done`; track in `.claude/ISSUES.md`
  (entries filed 2026-07-08 pointing here).

---

# Phase 1 findings — 2026-07-08 (analysis + drafts only; nothing applied)

Dedicated substrate-stabilization agent, SAFE half only. No testimony writes, no
applied migrations, no merge_proposals inserts, no deploys.

## Class 3 — size (date/platform pollution)

**Detection method.** The real source URL for auction rows lives in `listing_url`
when present, else `discovery_url` (16k+ Barrett-Jackson rows carry the event URL
only in `discovery_url`). Barrett-Jackson URLs embed the auction event year in the
**first path segment after the domain** — `barrett-jackson.com/scottsdale-2009/...`,
`.../palm-beach-2018/...`, `.../2020-fall-auction-at-westworld/...`. That embedded
year is the ground-truth sale year; a `sale_date` whose year differs is the
ingest-day stamp. Detection SQL (BJ, URL-proven):

```sql
WITH bj AS (
  SELECT id, sale_date, coalesce(listing_url, discovery_url) AS src_url,
    (regexp_match(coalesce(listing_url,discovery_url),'barrett-jackson\.com/([^/?]+)'))[1] AS slug
  FROM vehicles WHERE coalesce(listing_url,discovery_url) LIKE '%barrett-jackson.com%'
),
bj2 AS (
  SELECT *, CASE WHEN slug ~ '(19|20)\d\d'
    THEN (regexp_match(slug,'((?:19|20)\d\d)'))[1]::int END AS ev_year FROM bj
)
SELECT count(*) FROM bj2
WHERE ev_year IS NOT NULL AND sale_date IS NOT NULL
  AND extract(year FROM sale_date)::int <> ev_year;   -- => 17948
```

**Exact counts.**

| Metric | Count |
|---|---|
| BJ rows with a resolvable source URL | 47,033 |
| …with an extractable event year | 46,946 |
| **…date-polluted (sale_date year ≠ URL event year)** | **17,948** |
| …of those, sale_date stamped in 2026 (ingest window) | 17,944 |
| BJ rows correctly dated (sale_date year == event year) | ~28,998 |

The pollution is a **bounded batch**, not the whole platform: only the 2026-01/02
ingest runs defaulted `sale_date` to `now()`. The mega ingest-day clusters are
2026-02-25 (5,780 rows), -26 (5,369), -27 (3,086), -17 (2,547), -18 (2,229), plus
2026-01-12/23 and a dozen smaller same-day spikes.

**Same now()-stamp hit other platforms** (rows sitting on those 2026 ingest-day
dates, by `canonical_platform`): barrett-jackson 19,814 · bat 2,718 · pcarmarket
1,316 · cars-and-bids 619 · mecum 168 · bonhams 90. For BaT specifically, **1,088
of the 2,718** have the real year still recoverable in the sibling `bat_sale_date`
column (partial self-heal); the rest need the URL/event route. Non-BJ platforms
lack a clean event-year-in-URL signal, so 17,948 is the **URL-proven floor**; the
practical upper bound on the class is ~25,700 (all rows on the 2026 ingest-day
clusters across auction platforms).

**Platform misattribution (`canonical_platform` vs URL domain).** Most apparent
"mismatches" are naming-normalization noise, NOT errors — `canonical=facebook-marketplace`
vs `facebook.com` (97k), `classiccars-com` vs `classiccars.com` (15.7k), `gooding`
vs `goodingco.com`, `ksl` vs `cars.ksl.com`, etc. are the same platform under a
slug vs a bare domain. Filtering to **genuine cross-contamination — where a row's
own `listing_url` points to one primary auction house but `canonical_platform`
names a *different* primary auction house** — the real count is **1,058 rows**:

| canonical_platform | listing_url domain | rows |
|---|---|---|
| mecum | bringatrailer | 438 |
| barrett-jackson | bringatrailer | 250 |
| cars-and-bids | bringatrailer | 194 |
| bat | pcarmarket | 64 |
| barrett-jackson | mecum | 58 |
| (11 more pairs) | | ~54 |

Separately, a **conceptcarz-aggregator-in-listing_url** class exists (6,558 BJ +
2,926 mecum + 1,606 rm-sothebys + 1,001 bonhams rows whose `listing_url` is a
`conceptcarz://` record). These are NOT platform misattributions — conceptcarz
records who *sold* the car, so `canonical_platform` is likely right and the
aggregator URL is just misfiled into the `listing_url` slot. That's a Class 5
column-hygiene issue, not Class 3.

## Class 3 — draft chokepoint

`supabase/migrations/DRAFT_correct_vehicle_sale_provenance.sql` (`.DRAFT` suffix →
out of the runner). Modeled field-for-field on `correct_image_provenance`:
citation-required (refuses uncited), supersession-safe (original + citation
preserved in `vehicles.provenance_metadata → sale_provenance_corrections`,
recoverable forever), idempotent (no-op skip if already corrected). Supports
`sale_date` and `canonical_platform`. **Touches no testimony table** — it corrects
the canonical projection on `vehicles` only. The file also carries (commented, not
executed) the BJ batch-pass query and a BEFORE-INSERT ingest-gate sketch.

**One open decision embedded in the draft:** the URL proves the event *year*, not
the exact auction *day*. Option (a): land polluted rows on `<year>-01-01` with
`precision:'year'` in the citation (honest, coarse, immediate de-poison). Option
(b): join the BJ event slug (`scottsdale-2009`) to an event-date table to recover
the real day. (b) is the correct long-term answer; needs Skylar's call.

## Class 1 — merge pairs (groundwork only; NO merge_proposals inserted)

**Charger pair — GENUINE DUPLICATE, safe to propose merge.**

| field | 043c6d8b (Charger **360**) | f05462f9 (Charger **318**) |
|---|---|---|
| VIN | *(none)* | **WH23G3A146256** |
| year/make/model | 1973 Dodge Charger 360 | 1973 Dodge Charger 318 |
| canonical_platform / source | iphoto / user-submission | user-submission / user-submission |
| images / observations / events | 2,389 / 2,795 / 1 | 644 / 1,328 / 0 |
| created_at | 2026-03-20 | 2026-02-01 |

Evidence they are one car: three bit-identical images shared (same filenames
`IMG_4918_edited` / `IMG_4919_edited` / `IMG_4922_edited` appear under BOTH
records). Engine disagreement resolves from the VIN: **WH23G** → 5th char `G` =
**318** 2-bbl V8, so the "360" label on 043c6d8b is unsourced and wrong.
**Recommended primary: 043c6d8b** (richest record — 2,389 imgs, owner iphoto
library), reconciling the correct VIN `WH23G3A146256` and engine=318 onto it from
f05462f9. Merge preserves all loser testimony. Needs Skylar's sign-off (identity
call) before a `merge_proposals` row is written.

**Blazer pair — NOT A DUPLICATE. DO NOT MERGE. Skylar's own K5 involved.**

| field | 21501c21 (K5 Blazer) | e04bf9c5 (Blazer) |
|---|---|---|
| VIN | **CRK178P122739** | **CCL187Z210370** |
| trim | *(none)* | K5 Cheyenne Super |
| canonical_platform / source | user-submission / owner_submission | **gaa-classic-cars** / gaa-classic-cars |
| user_id | **0b9f107a (Skylar)** | *(none)* |
| images / observations | 114 / 95 | 298 / 34 |
| created_at | 2026-03-07 | 2026-02-02 |

**The VINs are DIFFERENT** — CRK178P122739 (Skylar's owned K5) vs CCL187Z210370
(a GAA-auction 1977 Blazer). These are two physically different trucks. The single
shared identical image (`IMG_0196_edited`) is **cross-contamination (Class 2), not
proof of sameness**. Merging would repeat exactly the 2026-02-02 GAA-Blazer
incident that `agent-trust-invariants.md` was written about (a different 1977
Blazer's auction history wrongly conflated onto Skylar's K5). **Action: do NOT
merge; reattribute the shared image to whichever truck it actually depicts** (needs
eyes on `IMG_0196` — deferred, out of this session's scope). Flagged for Skylar.

## Class 2 — Mustang↔K10 misattributed image (RESOLVED — direction is evidence-based)

Both collision identities resolve to the **same photograph**, viewed directly:
a black **1966 Ford Mustang** coupe, nose/valance off, engine bay open, on a
two-post lift in a shop at night — Mustang running-horse grille emblem clearly
visible. There is **no K10 truck as the subject** (a yellow Chevy cab sits on the
far-right lift in the background, but the photo's subject is unambiguously the
Mustang).

- identity `036e6768…` → image `IMG_0194.jpg` (4032×3024, full res) → correctly on
  the Mustang `83f6f033`.
- identity `4645f481…` → image `71C12D19…jpeg` (1600×1200, downscaled copy of the
  same frame) → **wrongly on the 1979 K10 `afcfef94`**.

**Reattribution direction: the K10's copy moves to the Mustang `83f6f033`.** Both
files carry identical EXIF (iPhone 15 Pro, 2026-05-02 21:13:08) — the K10 copy is a
downscaled derivative of the Mustang original. Route via `reattribute_observation()`
/ `resort_image()` with `merged_from_vehicle_id` lineage — no raw move. Not executed
this session (Class 2 is queued behind the chokepoint; flagged ready).

## What needs Skylar's sign-off next

1. **Apply the Class 3 chokepoint** (rename `.DRAFT` → timestamped migration) and
   pick the sale_date precision option (a `<year>-01-01`/year-precision vs b
   BJ-event-date join). Then batch the 17,948 BJ rows through it (1k chunks).
2. **Design + apply the ingest gate** (BEFORE-INSERT trigger) so the class stops
   growing — its own receipt, interacts with `trg_resolve_canonical_columns`.
3. **Charger merge** (043c6d8b primary, engine→318 from VIN) — approve a
   `merge_proposals` row.
4. **Blazer pair** — confirm the do-NOT-merge ruling; authorize reattributing the
   one shared image only (his own vehicle → extra care).
5. **Mustang↔K10** — authorize moving the K10's copy of the Mustang photo to
   `83f6f033`.

---

# Phase 2 execution log — 2026-07-08 (Skylar signed off "plan + go")

Scope decisions applied as given: sale_date precision = Option (a) `<year>-01-01`;
ingest gate = FLAG-ONLY; all three attribution fixes authorized. Every write batched,
lock-waiter check after each burst (0 throughout), no DELETE on testimony.

| # | Item | Before | After | Result |
|---|---|---|---|---|
| 1 | Promote + apply `correct_vehicle_sale_provenance` | draft | migration `20260708120205`, live in prod | DONE |
| 2 | BJ date batch (chunked ≤1000 per event-year) | 17,948 polluted | **0** | DONE |
| 3 | BaT self-heal from `bat_sale_date` | 1,088 (+140 surfaced) | **0** | DONE (1,228 healed) |
| 4 | Platform cross-contamination → listing_url domain | 1,057 | **0** | DONE |
| 5 | Verification gate (BJ / BaT / platform) | — | **0 / 0 / 0**, 0 lock waiters | PASS |
| 6 | Ingest gate (FLAG-ONLY trigger) | none | migration `20260708121538`, trigger `trg_flag_sale_date_ingest_stamp` live; logic tested 8 cases | DONE |
| 7 | Charger merge + engine/VIN fix | 2 records | 1 (primary `043c6d8b`, model `Charger 318`, VIN `WH23G3A146256`) | DONE |
| 8 | Mustang↔K10 image reattribution | on K10 | on Mustang `83f6f033`, lineage set | DONE |
| 9 | Blazer image reattribution | on GAA `e04bf9c5` | on K5 `21501c21`, lineage set | DONE — **but triggered CRITICAL incident** |

**Class 3 detail.** Total 20,092 `vehicles` rows now carry a
`provenance_metadata.sale_provenance_corrections` entry. BJ landed on
`<event-year>-01-01` (precision=year); the exact auction day can supersede later
through the same chokepoint. BaT restored to the real `bat_sale_date` (precision=day)
— the platform relabel in item 4 re-labeled 897 bringatrailer listings to `bat`,
which surfaced 140 more healable BaT rows (second pass). ~140 BaT rows with no
recoverable `bat_sale_date` were left 2026-stamped (no citation → not guessed).
conceptcarz-aggregator-in-`listing_url` (~12k) is Class 5, untouched.

**Class 3 gate note.** `trg_resolve_canonical_columns` re-resolves
`canonical_platform` from source columns on every write but does NOT read/write
`sale_date` or `data_quality_flags` — so date corrections are durable and the
flag-only gate does not fight it. The platform corrections persisted because for
every one of the 1,057 rows `resolve_platform_slug(source)` equals the listing_url
domain (verify = 0); the stored `canonical_platform` had simply drifted stale.

**Charger merge detail.** `merge_proposals` governance row `00174348` (status
`approved`, `ai_decision=MERGE`, `preferred_primary=A`) inserted with the deliberate
`-- ALLOW_RAW_TESTIMONY_WRITE` marker (the sanctioned prerequisite required by
trust-invariant rule 3). `merge_into_primary` moved 644 imgs + 1,328 obs with
lineage, dup `f05462f9` → `status=merged`, nothing deleted. VIN carry-over required
releasing the VIN from the merged dup first (enforce_vin_uniqueness excludes only
`id<>NEW.id`); originals preserved in `provenance_metadata.field_corrections`.
`vehicles` is not in the god-writes testimony list, so the cited model/vin projection
correction was a direct UPDATE (original preserved).

**Blazer image — what it actually is.** IMG_0196 is NOT a Blazer exterior: it is an
annotated shop build photo of an automatic transmission / torque-converter bolted to
an LS-style engine on a stand (chain, `1644` casting, colored measurement dots). It
is Skylar's own K5 drivetrain-swap work — the original copy on the K5 retains GPS +
`2024-08-25` EXIF; the GAA-auction copy is a metadata-stripped derivative. Correct
home = the K5. The two Blazer records (`21501c21` VIN `CRK178P122739` vs GAA
`e04bf9c5` VIN `CCL187Z210370`) are different trucks and were kept UNMERGED.

## ⚠ CRITICAL INCIDENT (item 9) — Skylar's K5 auto-merged; reversal blocked

Moving the GAA copy to the K5 via `resort_image` requeued the image
(`ai_processing_status='pending'`), and IN THE SAME TRANSACTION a trigger executed a
latent 4-month-old dedup proposal (`vehicle_merge_proposals a0b159f8`, primary
`e08bf694`, dup = the K5, `exact_listing_url`, detected 2026-03-20, never executed
until now), **merging Skylar's K5 `21501c21` into `e08bf694`** (a third 1977 Blazer,
different VIN `CKR187F127263`). `unmerge_vehicle` refuses — `no_journal` (the proposal
predates the journal system). Per trust-invariant rule 5, NO manual reversal was
attempted; the K5 was not touched further.

State is inconsistent: K5 is `status=merged` / `merged_into_vehicle_id=e08bf694` (so
hidden from the garage) yet still physically holds 115 images + 95 observations (only
18 images ever swept, and those on 2026-07-02, not today). Active hazard: the pending
image could let a background worker complete the sweep. **Full incident + recovery
spec: the [CRITICAL] entry at the top of `.claude/ISSUES.md`.** Needs Skylar's
decision (his personal vehicle) + engineering (journal-independent unmerge; stop
`resort_image` requeues from auto-executing pre-existing merge proposals).

**UPDATE — K5 incident RESOLVED (2026-07-08, another party + Skylar).** The two
records were confirmed the SAME physical truck: 65/74 identical dhash overlap, and
`21501c21` was a manual entry carrying the structurally-invalid VIN `CRK178P122739`
(exactly the class Gate 1 now flags). Skylar delegated the call; the merge was
completed cleanly via `relink_testimony` (115 imgs + 95 obs moved with lineage, 0
failures). The merge was legitimate, not corruption — the Phase-2 "different trucks /
must reverse" read was wrong (the differing VIN was itself the bad data). `a0b159f8`
is now a completed, lineage-clean merge (`merged_at` set).

---

# Gates 1-4 + verification gauntlet — 2026-07-08

DB-side gates 1-4 (a separate agent owns Gate 5, the title parser). Migrations left
uncommitted for review.

| Gate | Fix | Migration | Status |
|---|---|---|---|
| 1 | VIN structural validation, FLAG-ONLY (`flag_vin_structurally_suspect`): 17-char check-digit + charset/length; 1973-80 GM-truck pos2∈{C,K} (catches `CRK178P122739`) | `20260708134003_gate1_vin_structural_flag.sql` | DONE, live |
| 2 | Owner-approval guard at the merge execution point (`merge_into_primary`): if either vehicle is owned (`user_id`=generated from `uploaded_by`), refuse unless an `approved`+`reviewed_by` `vehicle_merge_proposals` row exists for the pair | `20260708133823_gate2_owner_merge_guard.sql` | DONE, live |
| 3 | (a) Disarmed **80 vacuous** armed proposals (10 NULL/empty-url + 70 raw-text-differing-url) → `status='rejected'` + `review_notes`; **1,241 real** left armed (now all behind Gate 2). (b) Current `dedup-vehicles` edge fn already guards `listing_url IS NOT NULL AND <>''`; the vacuous minting was a historical 2026-03-20 artifact (minter not in repo) | data op | DONE + finding |
| 4 | `resort_image` cannot synchronously trigger a merge — confirmed by reading the full trigger chain (single UPDATE → only image_count/has_photos/value recomputes). Async requeue→executor path now backstopped by Gate 2 for owned vehicles. Verified live (gauntlet T5) | (covered by Gate 2) | VERIFIED |

**Root cause of the K5 auto-merge (traced).** The cron `dedup-vehicles-batch`
(`run_vehicle_dedup_batch`) and the `dedup-vehicles` edge fn both group by
`listing_url` with a NULL/empty guard, so they did NOT merge the null-url K5. The
merge came from executing the armed vacuous proposal `a0b159f8` (NULL=NULL, minted
2026-03-20) when the requeued image woke an executor ~50 min later; `merge_into_primary`
had no owner guard. Gate 2 + Gate 3a close this class.

**Gauntlet (one rolled-back txn, rows tagged `origin_metadata.test_gauntlet=true`):**

| Test | Expectation | Observed | Result |
|---|---|---|---|
| T1 | GM-truck VIN pos2=R → VIN flag | `vin_structurally_suspect` set | **PASS** |
| T2 | 17-char VIN bad check digit → VIN flag | flagged | **PASS** |
| T3 | two NULL-url vehicles → dedup mints nothing | not grouped | **PASS** |
| T4 | owned + `approved` but `reviewed_by` NULL → refused | `owned_requires_approval` | **PASS** |
| T5 | `resort_image` w/ armed proposal → image moves, no merge | moved; both stay `active` | **PASS** |

**Findings / follow-ups for Skylar:**
1. The `dedup-worker` that minted the 1,321 armed proposals (2026-03-20) is **not in
   the repo** — likely a retired worker version; no active code re-mints the NULL=NULL
   class. Reported, nothing to patch.
2. `vehicle_edit_audit` (referenced by trigger `log_vehicle_edit`) **does not exist**
   — vehicle edits silently fail to audit. Separate bug.
3. `enforce_vin_uniqueness` excludes only `id<>NEW.id` (not `status='merged'`), so a
   merged record still "owns" its VIN.
4. The 70 "urls-differ" disarmed rows were classified by raw-text inequality; some may
   normalize to the same listing. Disarming is conservative (re-detectable); all unowned.

