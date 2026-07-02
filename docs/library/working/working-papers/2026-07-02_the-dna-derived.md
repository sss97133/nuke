# The DNA, Derived — direction, audit, continuation (2026-07-02)

**What this is:** Skylar handed the lead the keys ("inspect all the code, cross ref with our DNA…
you should be able to figure out the direction… articulate my sentiments beyond the vague").
This paper is the answer, derived — not asked: 5 parallel miners over the 16-month session
archive (5,131 sessions), the library canon, the write-path code, the live DB's measured
metadata coverage, and the PR arc. Every claim below cites its source. Correct the deltas;
don't re-derive.

---

## I. The direction, articulated (his words, cited)

**Nuke is a provenance engine** (his naming, 2026-02-08 session a15193b6): it converts raw
human documentation — photos, receipts, paper, comments — into an append-only ledger of cited
testimony, granular to the atom, where truth is computed from the ledger and never stored as
a bare value. The product is not the UI and not even the data: it is **observability** — the
ability to drill any rendered speck to the pixel/receipt/row that authored it, and to query
the accumulated field at any grain. "The depth of data is equivalent to the depth of our
ability to observe" (2026-07-02, this session).

Six threads, stable across 16 months:

1. **Data is testimony.** "Images and receipts… are the discovery and only source of facts…
   when a user clicks on that data point it should pull up the source" (2025-11-10,
   cursor:98b368ef). "We record provenance then we can process and generate knowledge"
   (2025-11-11). Testimony has half-lives; a description is "a testimony of the vehicle's
   state at that time" (2026-03-15, fddb7fa0). Sources report; nothing merges-and-overwrites:
   "its this url reports on these data points through this entity at this date and time"
   (2026-03-21, 75a5b932).
2. **Signals before labels; the atom is the grain.** "It's atomic level granular data points
   that start delivering signals and those signals are then labeled — it's not the other way
   around" (2026-05-03, d2768800). Ground truth is "an x,y,z volumetric observation and a
   0-100 scale condition rating per volumetric measurement; labels are opinions" (2026-05-24,
   2ebd8b06 — substrate implemented 2026-07-02, migration 20260702051500). Even irrelevant
   images are "alibi type data" (2026-05-30, e63df3c8).
3. **Nuclear in shape = self-describing at every scale.** Every datum carries its own metadata
   shell — (value, source, method, observed_at, trust, confidence) — so it can merge, decay,
   supersede, and be cited without external context. Metadata inherits downward ("we have
   essentially metadata that's valid for any image linked to the vehicle profile", 2026-02-04,
   25209780) and statements self-describe their query ("when i say my 32 ford… you'd
   immediately search within the uuid of me as a user", 2026-02-26, 87737ab6). The shape is
   fractal: atom → observation → shoot → day → vehicle → org → market, same shell at each level.
4. **The schema grows organically under data pressure.** "Observation discoveries needs to be
   able to grow organically… like doing accounting with receipts — you just start stacking and
   patterns start developing" (2026-01-29, ed058623). "The intelligent expansion of jsonb"
   (2026-05-24). "Fill out the schema each time and add and make the schema better, like a
   human would" (2026-05-28). The filing-cabinet image: patterns between vehicles "begin to
   shape the core data of the filing cabinet (org profile) that contains it" (2026-07-01,
   23e37cc2). Crystallization path: jsonb namespace → promoted column → table (PR #308-311
   did exactly this).
5. **The asset accumulates; it never changes.** "We aren't documenting the single auction, we
   are documenting the vehicle" (2026-01-08). "Assets don't change though they accumulate
   data" (2026-03-20, 07096ced). Hence supersede-never-overwrite, the trust invariant, and
   the entity-resolution law that "merge means link."
6. **The UI is a window; every badge a portal.** "Vehicle profile is the window to view DB
   data" (2025-11-21). "When I see 1991 gmc v3500… I want each to be clickable" (2026-03-20).
   Drillability is COMPUTED from the substrate: incomplete algorithms auto-disqualify from
   being drillable (2026-07-02) — the affordance contract, first instance
   `get_image_component_targets` (migration 20260702061000).

**The context loop (the crux he named):** observe → land testimony with DNA → patterns stack →
schema crystallizes from patterns → deeper observation becomes possible.

**CORRECTED by Skylar 2026-07-02 (delta on this paper's first draft):** "natural growth of a
db is a misnomer… for me it means the schema expands WITHOUT HUMAN INTERACTION — the agent
knows how and where to expand the structural side, the schema. We can't stop til it's
self-sufficient." So the loop's test is not "does data pressure eventually produce schema"
(a human can be the mechanism) but **autonomous crystallization**: an organ that (1) measures
data pressure (jsonb key census, fill rates, type stability, write recency), (2) decides
where structure should grow (promote / namespace / retire), (3) executes the additive
expansion itself with the same source-DNA discipline as any other write (the migration cites
the census evidence that justified it), and (4) re-measures. The June JSONB→reserved-columns
promotion (PR #308-311) proved the mechanics but was human-triggered. Self-sufficiency is
the halt condition.

## II. The loop, measured (does the DB actually grow organically?)

Verdict: **the loop is real and winning in everything written since ~May 2026; one legacy
zone and (until today) two live defects violated it.** Evidence (full numbers in the
2026-07-02 workflow run wf_ea98d5c3):

- vehicle_observations DNA coverage: **0% (Jan-2026 bulk-load era) → 65% (30d) → 91-92%
  (14d)** on agent_model/extraction_method; source_id 100%, confidence 98-99% throughout.
- The new analysis layer is near-perfect: component_identifications 99.94% non-empty
  source_references, 100% confidence; image_analysis_records 100% model/confidence.
- ai_scan_metadata: uniform 5-key pipeline spine on 100% of 15,575 images — plus a ~100-key
  legacy tail of one-off script residue (the un-crystallized sediment).
- Schema: 18,382 columns / 1,072 tables / 941 migrations — crystallization is happening.
- **The bare-value zone: vehicles money columns.** current_value/price/sale_price carry NO
  source columns, 0-10% confidence coverage; provenance_metadata is non-empty on 0.09% of
  rows. The same table has *_source columns for identity fields — the discipline exists and
  was never applied to money. Largest doctrine violation at scale.

## III. Defects found and fixed this session

1. **FIXED + deployed:** `process-all-images-cron` replaced the ENTIRE ai_scan_metadata
   column with `{appraiser:{…}}` on both its write paths — destroying byok_deep_analysis /
   identity_first / on_device_vision sibling namespaces on any row it touched. Both sites now
   merge (`{...existing, ...new}`). Deployed via API 2026-07-02.
2. **Confirmed dead cron:** `.github/workflows/process-images.yml` (hourly) calls edge fn
   `batch-analyze-all-images`, which is NOT among the 278 deployed functions — a silent
   hourly failure since retirement. Fix belongs on main (scheduled workflows run from the
   default branch): disable or retarget.

## IV. The gap matrix (theory ↔ implementation), ranked

| Gap | Evidence | Owner/next |
|---|---|---|
| Money values carry no DNA | §II measurements | Design: route money through nuke_estimates (has model_version/comp_method/signal_weights) or add *_source discipline; retro-backfill impossible — mark legacy values as untrusted-legacy |
| extract-vehicle-data-ai: 3 violations in one fn | overwrite-despite-comment (:539-547); hardcoded platform:'bat' falsified DNA (:570-576); DELETE FROM vehicle_images (:617-623 — trust-invariant breach) | Route through Tetris/observationWriter; fix stamp; kill delete+reinsert |
| ingest/index.ts bypasses ingest-observation | raw upsert :1141-1154, NULL-trust observations; enrichVehicle stamps zero DNA | Converge on the chokepoint that exists next door |
| photo-sync-daemon bypasses identity spine | leaf-first insert, no image_identity_id (predates 20260625 chokepoint) | Migrate caller to ingest_image_identity_first |
| Butterfly cascade lands 1-3 of ~20 atoms | encyclopedia ch05 vs pipeline | The entity layer (2026-07-02) raised it; tools/technicians/micro-facts still unwritten |
| Convergence chamber missing on owner photos | is-there-an-engine.md: "hand-cranked parts pile" | The reciprocal-confirmation engine IS the chamber; keep extending (receipt-context bridge next) |
| 3 canon docs cited but nonexistent | the-trust-invariant.md, the-root-system.md, the-agent-must-cite.md | Write them (the rule file mandates reading a file that isn't there) |
| PR debt | #278 stale-conflicting; #286-289 deployed-but-unmerged records; #293 mergeable + needed | Reconcile; repo must match prod (production-engineering law 1) |
| Legacy jsonb sediment | ~100 one-off keys on <500 images each | The crystallization organ: periodic key census → promote or retire |

## IV-b. The Blur lesson — identity is sealed at the source (Skylar, 2026-07-02)

"It's corrupt cuz we didn't figure out what we solved with BLUR." The capture-relay
corruption class (scrambled filename↔content, misdated taken_at, partial relays — June
13/18/19, recovered by hand) was structural, not accidental: the relay shipped bytes with
only CIRCUMSTANTIAL identity (filename, upload timestamp), so a scramble in transit was
undetectable — the cloud had no independent identity to verify against. Blur is immune by
construction: the ledger lives with the photos, EXIF is read from the file at the source,
Vision facts are computed on-device against content, identity (dHash) derives from pixels.

**The sealed-capture rule (intake law from here):** no byte enters `vehicle_images` without
a content identity computed AT THE SOURCE and VERIFIED at the door.
1. Every uploader computes content hashes BEFORE upload (device: sha256 + dHash of source
   bytes; Mac daemon: file_hash + phash from the file) and sends them WITH the payload.
2. The receiving path recomputes the byte hash on the stored object and QUARANTINES on
   mismatch — the scramble is caught at the door, not two weeks later in a day sheet.
3. All intake converges on `ingest_image_identity_first` (the chokepoint exists; the
   callers — photo-sync-daemon, the iOS relay — must migrate to it).
4. The local ledger (LocalStore / Blur's engine) is the recovery source by construction —
   the June recoveries are the proof.
Gate for the universal content join (Seam 2): dHash parity between the Swift implementation
(PerceptualHash.swift, 9×8 → 64-bit → 16 hex) and a cloud-side implementation, byte-verified
on known pairs before any cross-world matching is trusted.

**GATE VERDICT (2026-07-02, measured — full spec in
docs/library/working/2026-07-02_dhash-parity-verdict.md): bit-exact parity REFUTED.** Apple's
ImageIO stage-1 thumbnail resampler matches no standard kernel (probed vs lanczos/cubic/
mitchell/linear/box); same bytes hash 3-16 hamming apart across implementations, and 2-7 of
64 comparisons per image sit at ≤1 gray level of margin. The luma and stage-2 sampling WERE
solved exactly (0-hamming when fed ImageIO's own thumbnail) — the resampler is the sole
blocker. Therefore the Seam-2 design is: **contentSha256 of source bytes is the equality key**
(deterministic in every language); the device dHash is an OPAQUE perceptual key — cloud
backfills its own tagged `dhash_js_v1` and matches cross-side by hamming threshold (~10,
inside the near-dup band), confirming candidates via sha256 or pixel compare. Hash values
carry their algorithm tag like every number carries its method. True cross-side equality
would need a fully-specified v2 resampler on-device — owner decision, queued.

## V. Standing orders (how the lead operates from here)

1. **Every new writer ships with full DNA or doesn't ship.** The organs exist
   (ingest-observation, observationWriter→Tetris, identity spine, correct_image_provenance);
   violations are always bypasses. Convergence, not new machinery.
2. **Every surface stat carries its scope** — one canonical scorecard RPC; no more
   26,693-vs-5,480-vs-185 incoherence.
3. **Drillability is computed** — extend the affordance contract to every element.
4. **Depth of data = depth of observation:** the roadmap is always "what can we not yet
   observe?" (xyz registration, tag sync, receipt intake for Mustang/K2500, phash bridge).
5. **Report coverage toward worth-proof on real builds, never raw counts.**
