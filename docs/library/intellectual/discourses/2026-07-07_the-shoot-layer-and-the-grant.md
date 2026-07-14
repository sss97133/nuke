# The Shoot Layer and the Grant

> Discourse capture, 2026-07-07. Origin: a client request ("one image per look" — Julie Rodrigo, L'Officiel-adjacent eyewear editorial, shot 2023-08-02, found on the NukePortable SSD in `icloud-download/`). The request cost an agent an hour of manual archaeology; Skylar named the product instead: "I'd rather give the owner an access key to my work — an automated contract to use my work." This document records the theory developed across the session and its verification against the full intellectual shelf (all contemplations, discourses, papers, theoreticals, studies read 2026-07-07), plus blur/, lofficiel-concierge/, and the working shelf.

## The claim

A photoshoot is an asset. Not analogously — structurally. It is the degenerate case where asset and evidence coincide: in the vehicle domain, photos are testimony *about* the asset; in the shoot domain, the photo *is* the asset. The same file can be evidence in one graph (the K5's condition) and asset in another (the photographer's licensable work). Any schema where photos are columns on a subject cannot express this; a schema where the file is a node claimed by profiles via edges expresses it for free.

Photographers feed every asset genre the platform aims at — auto, art, creative, product, large assets. Therefore the shoot layer is not a fourth vertical beside vehicles and art. It is a **plane under all verticals**:

```
L0  FILES             iCloud, SSD, filesystem, capture-relay        (built)
L1  CAPTURE EVENTS    shoots: who shot, of what, with what, for whom (THE NEW LAYER)
L2  EVIDENCE          atoms cascading into subject profiles          (built — butterfly cascade)
L3  ASSET PROFILES    vehicle / artwork / product verticals          (built / spec'd)
L4  INSTRUMENTS       listings, licenses, invoices                   (listings built; licenses = the gap)
```

## Verification against the canon — convergences

The library already contains almost all of this, written before the session:

- **Doctrinal blessing**: `proof-of-work-not-pay-to-play.md` — "art, fashion, content production are new `kind`s in the same machine… a production — all assets whose trajectory testifies to its contributors."
- **The shoot as production event**: `the-validation-layer.md` models the commissioned shoot as an economic-commitment artifact ($10K–100K/spread); contributor credits (photographer/stylist/model/agency) are "the deepest graph data" at 0.90 trust and are *contractual*.
- **Entity slots**: `2026-03-20-repositioning-nuke.md` — creators are Users/actors, magazines are Organizations, works are Assets; creator onboarding must be passive ("artists are crazy as fuck… as passive as phone photos").
- **Product centrality**: `13758-prompts-analysis.md` — two of the five all-eleven-machine prompts that constitute the de facto product spec ARE the photo-corpus pipeline.
- **Derivation machinery**: `lineage_chain uuid[]` (PROV-O), supersession, the palimpsest lifecycle, `edition_parents` (same number = same object; different number = sibling under one parent — Work/Expression semantics), pHash Hamming band 6–10 documented as "same subject, different capture" (= the retouch-detection band). FRBR (Work/Expression/Manifestation/Item) slots in as the answer to the *named open question* in `novel-ontological-contributions.md` §VIII.D (identity-transfer semantics underspecified).
- **Evidence vs. deliverable**: `the-root-system.md` — every photo is a *decaying node* (dated evidence) or a *creative curation* that must declare itself; undated/unsourced it is a facade. `testimony-and-half-lives.md` — a photograph is mechanical testimony shaped by the photographer's framing choices.
- **Valuation discipline**: `the-illegible-asset.md` — content is existence-legible, valuation-illegible; shoot outputs are un-fakeable artifacts whose worth must come from consecration, never engagement metrics. `habitus-and-the-exchange.md` — the shoot's occurrence is brute; its worth is conferred; separate columns, never fused.
- **Person engine**: `user-simulation-methodology.md` + `signal-calculation.md` (publication prominence weights cover 3.0 → caption 0.5 = photo-credit weighting) + `dynamic-trust-model.md` + production `actors`/`actor_capabilities` — the photographer/model profile engine exists.
- **Corpus ingestion**: the Savant Janitor (`the-three-users-and-the-finder.md`), intake hierarchy photos-first (`the-bridge`), and the vision playbook (`vision-gap-analysis.md`): structural metadata as free labels; **the operator's own corpus at trust 1.00 is the validation seed** — Skylar's archive, starting with the Julie shoot, is the canonically prescribed pilot. The shoot-detection signature (EXIF point-process: one body, RAW+JPG pairs, burst cadence, Photoshop-marked derivatives days later) was demonstrated live this session with zero pixels read.
- **Client-side detector already running**: Blur's `SessionClusterer`/`VehicleClusterer` (75m/4h GPS+time sessions, sustained-color-break splits) is photoshoot segmentation in production on a 90K-photo library. The sha256-of-original-bytes content identity is the universal spine; Blur's anti-fork rule already names "**l'officiel resonance**" as a derived layer that must key to it.
- **Commercial chassis**: lofficiel-concierge — licensed *access* to a Nuke-owned mainframe ("so the L'Officiel group can never claim the system"), operator-signed binding, revenue_splits/payment_events settlement. The channel switchboard (`listing_exports` + field_map + human sign-off keys) is the same shape: BaT is a channel that sells the metal; a licensee is a channel that licenses the pixels.
- **Registry anchor**: P04 unified `assets` registry ("art, publishing, and future verticals need a shared parent") + P05's shared, asset_id-generic tables (`provenance_entries`, `org_staff` with photographer/editor/publisher roles already enumerated, `artist_representation`, `exhibitions`, `literature_references`, `certificates_of_authenticity`, `private_sales`, `appraisals`). The shoot vertical is P05 with ~three deltas.

## Corrections the canon imposes on the session's theory

1. **Discovery-first, not schema-first.** The 66.7%-fabrication finding (`applied-ontology-evidence-map.md`): predefined schemas forced on a new domain cause mass hallucination. No grand shoot schema up front — extract the Julie specimen unconstrained, then crystallize fields.
2. **Provenance engine, not marketplace.** `dead-features-autopsy.md` Lesson 1, written for vertical expansion: the data powers marketplaces; the platform doesn't become one. The grant system is delivery + record, never a storefront. (Consistent with the session's independent conclusion: no DRM — the grant log is the evidentiary substrate that makes existing copyright law cheap to invoke; ASCAP had a ledger, not DRM.)
3. **Reuse substrate, don't mint.** Triage lesson (1,013 tables, 483 empty). A fourth entity type joins Vehicle/Actor/Organization on the identical observation-accumulating structure — `ontological-lexicon.md` names this the sanctioned extension point.
4. **Pricing**: the session's "monopoly of the particular" argument (microstock collapsed the price of genericness; archives sell particularity with zero substitutes) survives, but subordinated to the canon's stricter rule: value expression waits for the consecration layer; never present around category tags (the genericness axis), always around provenance and specificity.

## Genuinely new contributions (not found anywhere in the canon)

1. **The grant — outbound provenance.** The library's verbs are deposit, fold, traverse. Nothing flows outward under terms. Every inbound datum carries `(source, method, observed_at, trust)`; the grant is its mirror: every *release* carries `(licensee, scope, terms, expiry, granted_at)` plus a pull log. Capability-style bearer token (macaroon pattern: caveats narrow, never widen; delegation visible and attenuating — matches how publishing actually forwards files). Minting a grant is Sign-tier; attenuation downstream is free. Both distillation readers independently confirmed: licensing/rights theory is absent from the corpus — this is the missing fourth verb.
2. **The request is the metadata.** The client's ask ("one per look") is annotation: it declares the shoot's salient unit, marks the selects, registers the stakeholder — the demand side does the filing at the only context-rich moment after capture. Extends the coaching inversion (`the-knowing-system.md`) from prescribed capture to demand-driven organization; the archive organizes itself in the direction of demand and stays raw where nobody looks.
3. **Filing as refrigeration.** Context exists completely and free exactly once (capture time) and decays with the number of living context-holders (the estate/Vivian Maier limit case — where filing is impossible rather than annoying). The delivery moment is a second chance at capture-time context. Formal kin of testimony half-lives, applied to *unfiled context* rather than recorded claims.
4. **Machine licensee.** The largest new image-license buyer (AI training) prices exactly one thing: chain of title. The same provenance completeness that automates a magazine delivery incidentally mints a certifiable training corpus — one data model, two unrelated buyers, evidence the abstraction is cut on reality's grain.

## Named voids the shoot layer will hit (all pre-documented)

- Photo evidence is not trust-scored (`trust-scoring-methodology.md` break-down #4) — in a photo-native domain this inverts to the first problem.
- The resolver ("gloved hands → Skylar"; here "frames → model entity") — the named void of `2026-06-20_what-this-is-and-where-it-converges.md`.
- Cross-platform person identity graph (`dynamic-trust-model.md` missing piece).
- Images are evidence-carriers, not entities (Image Fact Fabric is the closest structure; promotion to entity-with-own-observations is the move).
- `vehicle_images` / `artwork_images` are parallel per-vertical image tables — the pattern P04 killed at the asset level, still alive at the image level; the shoot layer is the forcing function for a subject-agnostic image node (strangler-fig, keyed on sha256).

## Placement verdict

The shoot is `asset_type='shoot'` in the P04 registry; its roles are edges to actors/orgs (P05's enumerations suffice); its facts flow through `ingest-observation` under the existing trust hierarchy (EXIF ≈ vin_decode tier; retoucher filenames ≈ community tier; owner confirmation = Sign); its detection is Blur's session clustering server-side (EXIF point-process first, vision on the residual); its identity spine is sha256 with pHash as candidate edges; its derivation semantics adopt edition_parents + FRBR to close §VIII.D; its delivery is a new channel type on the switchboard under the concierge licensing model (access, never ownership; operator-signed binding; logged settlement). Build sequence is requests-first: no schema element exists until a real inbound request needs it. Specimen #1 is the Julie delivery — one shoot node, four role edges, twenty deliverables with derivation stubs, one bearer grant, one pull log.

One sentence: **promote the photoshoot to a first-class asset whose profile is derived from file proof, whose participants are actors with accruing service provenance, and whose monetization is outbound provenance — keys instead of file-sends; the library already holds every organ of this system except the grant, and the grant is the product.**

## Addendum (same day): empirical grounding

**DB reality check (Supabase REST probe, 2026-07-07):** P04 is implemented — `assets`, `listing_exports`, `image_identities`, `actors`, `actor_capabilities`, `organizations` are live tables. P05 is paper — `artworks`, `provenance_entries`, `org_staff`, `edition_parents` return 404. `grants` does not exist. Consequence: specimen #1's shoot node can land today as an `assets` row; the grant is the one legitimate mint.

**Shoot census of one SSD (NukePortable, Spotlight metadata only, zero pixels read):** 191,890 camera-attributed files; ~15.5K frames from pro bodies (Canon 5DS/5DS R/R5/R6 ≈ 6,430; Sony A7III/A7IV ≈ 8,300; Nikon D850/Z50 ≈ 700). Clustered by (body × day): **540 shoot-day candidates, 2004–2025; 31 days with ≥50 frames.** Continuous professional cadence: 45–99 shoot-days per year, every year since 2019. The Julie specimen (2023-08-02, R6, 112 frames) is 1 of 540. Largest single day: 2022-10-21, Canon 5DS, 4,163 frames. Rare bodies present in small counts (A9 II, A1, A7S II) suggest other photographers' files already commingled — the multi-actor dimension appears in the raw census. Detection cost approaches zero (Spotlight had already indexed everything); the bottleneck is confirmed to be the missing shoot entity and grant, not discovery.

## Cross-references

- `docs/library/reference/encyclopedia/01-unified-asset-layer.md`, `05-image-as-butterfly-node.md`
- `docs/library/prompts/P04-unified-asset-registry.md`, `P05-art-schema.md`
- `docs/library/intellectual/contemplations/the-validation-layer.md`, `the-illegible-asset.md`, `the-root-system.md`, `proof-of-work-not-pay-to-play.md`, `habitus-and-the-exchange.md`, `testimony-and-half-lives.md`, `the-three-users-and-the-finder.md`
- `docs/library/intellectual/theoreticals/entity-resolution-theory.md` (edition semantics, pHash bands, art resolution), `observation-half-life-model.md` (content/observation date triad, archive paradox), `valuation-methodology.md` (authentication ladder, provenance-gap penalties), `signal-calculation.md`, `dynamic-trust-model.md`
- `docs/library/intellectual/papers/novel-ontological-contributions.md` (§VI image fact fabric, §VII component identity, §VIII.D open question), `user-simulation-methodology.md`, `vision-gap-analysis.md`, `trust-scoring-methodology.md`
- `docs/library/intellectual/studies/dead-features-autopsy.md` (§VII vertical-expansion lessons), `platform-triage-2026-03.md`
- `/Users/skylar/blur/docs/HANDOFF.md` (SessionClusterer, sha256 anti-fork rule, "l'officiel resonance"), `docs/library/working/2026-07-02_dhash-parity-verdict.md`
- `/Users/skylar/lofficiel-concierge/FABLE_HANDOFF.md` (licensed-access model, price integrity, operator-signed binding)
- External anchors: W3C PROV-DM (contemplations README), CIDOC-CRM (papers README), FRBR (proposed here for §VIII.D), Google macaroons (Birgisson et al. 2014, proposed here for the grant), C2PA Content Credentials (inbound half of the grant's transport)
