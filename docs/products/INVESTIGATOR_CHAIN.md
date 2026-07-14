# The Investigator Chain

> Codified 2026-07-02 from a live case: Skylar manually ran this entire chain on a
> $1.65M 300SL Gullwing found on FB Marketplace, in ~20 minutes, from his phone.
> His verdict: "my department is what I'm trying to automate... I'm telling a fish
> how and where to swim. Not my favorite." This document is the swimming lesson —
> the chain the system runs AUTOMATICALLY whenever a lead lands, so the
> investigator only supplies taste and the go/no-go, never the steering.

## Trigger

A discovery lands (`user_vehicle_discoveries` insert — from Explore, a saved
item, a share-sheet capture, or an artery match). The chain fires on the
discovery, not on a human command.

## The chain (each step = existing machinery, cited)

1. **CAPTURE** — land the entity with provenance, linked to the discoverer.
   *Machinery:* `ingest` front door (`user_id` → discovery row; fixed 2026-07-02).

2. **SELLER GRID PULL** — fetch the seller's complete listing history on the
   platform. *Machinery:* fb-scraper skill / Chrome session (FB), poller ledger
   (CL), `bat_seller` (BaT). Output: every listing = a `seller_sightings` row.

3. **MIX ANALYSIS → SOURCE-vs-MIDDLEMAN** — classify the seller from the DATA,
   never the label (the org is defined by its data):
   - **Price ladder**: $45 car seat next to $1.65M Gullwing = personal account +
     brokerage. A source sells one stratum; a broker's grid is a barbell.
   - **Language forensics**: third-party owner references in their own listings
     ("the current doctor owner") = client-speak = middleman.
   - **Geography scatter**: inventory across many cities = consignment in client
     garages; one address = warehouse dealer or collection.
   *Machinery:* `pipeline_sellers` (seller_type, business_type, dealer_score) +
   `seller_intel_rollup()` (built, cron'd). The classifier heuristics above are
   the unbuilt piece — they are prompt-sized, not model-sized.

4. **ARTIFACT HARVEST** — sweep the seller's OTHER listings for hard
   identifiers: VINs, phone numbers (decode spelled-digit obfuscation), names,
   addresses, shop signage in photos. Every artifact is testimony with
   provenance. *Case:* John's Ferrari listing carries a VIN in plain text.

5. **CORPUS MATCH** — fingerprint the subject vehicle against the 900K-vehicle
   corpus. Fingerprints that identified the Gullwing: exact ask-price match to a
   Mecum consignment, "Rudge-style wheels" ↔ "Rudge wheels added", restorer
   names (Grundfor/Canepa), mileage, color-over-color. VIN match when we have
   one (Tier 1); narrative fingerprints when we don't. *Machinery:* the corpus +
   entity resolution. Result is a FLAGGED MATCH pending verification — never an
   auto-merge (merge_proposals law).

6. **ASSOCIATIVE PROFILE** — walk every harvested VIN/artifact through the
   corpus to map the seller's supply web: which collections, restorers, and
   platforms feed them. A broker's associative profile IS the door behind the
   door. *Case:* Ferrari VIN → auction history → owner entity → the Redondo
   collection.

7. **HUMAN CHECKPOINT (the only one)** — the chain surfaces a dossier: entity,
   seller classification with evidence, corpus match with confidence, the
   verification gaps (data-plate check, title name), and the door assessment.
   The investigator supplies what machines still can't: the reflection-zoom
   instinct (photographer ≠ poster), the gut read, and the CALL. Capital and
   contact are human keys. Everything upstream is not.

## Division of labor (the point)

| Layer | Owner |
|---|---|
| Spotting a lead in the wild | Human eye (for now — arteries shrink this) |
| Everything from capture to dossier | **The chain. Never the human.** |
| Taste, verification judgment, the call | Human key |

## Worked example (2026-07-02, all rows live)

- Vehicle `1ca8aa43` — 1957 300SL Gullwing, $1.65M, FB Redondo Beach
- Discovery `a65df91a` — linked to Skylar, tagged
- Seller: `pipeline_sellers` "John C. Hallenborg" — classified BROKER via mix
  analysis (evidence in row notes); (310) 245-1383; ~$265K verified sold
- Corpus match: chassis **198.040-7500061** (Grundfor resto, Canepa refresh,
  9,425 mi, silver/red plaid, Mecum 'available' at the same $1.65M) — flagged,
  unverified; alt candidate 198.040-7500020
- Open: Ferrari VIN harvest (needs Chrome session), owner-entity resolution,
  engine-number verification vs "matching numbers" claim

## Build order (when this becomes code)

1. Chain steps 3+5 as a single agent pass over an existing seller grid (prompt
   work, zero new tables)
2. Step 2 automation per-platform (FB needs the iPhone/browser node)
3. Step 6 as a corpus join once VIN harvest lands
4. Dossier surface = the Explore lead page (drillable, cited, per design tenets)

## Who runs the chain: the Sandbox Agent (added 2026-07-02, Skylar's call)

> "The sandbox agent is the YOU for the app."

The chain above is NOT run by Skylar's Claude Code session — that was the
prototype. The production runner is an agent embedded in the Nuke app: the
in-app equivalent of the session that ran the Gullwing case. VISION.md lists
"no certified user ingestion method beyond Claude Code" as a known gap — this
is the fill.

**Architecture (assembled from existing substrate, nothing minted):**
- **Compute:** user's own key via `user_ai_providers_byok` (migration
  20260616000000) — laser-tag doctrine: Nuke owns the harness, caller owns
  the compute.
- **Tool belt:** the edge functions ARE the tools — `ingest` (URL → entity +
  discovery), screenshot intake (Gullwing flow: image + provenance →
  vehicle + photo), `extract-bat-core`/platform extractors, corpus match
  (fingerprint/VIN), `pipeline_sellers` writes, `get_pipeline_pulse`. The
  MCP server (`nuke-mcp-server`) is the protocol wrapper VISION already
  designates as "the implementation vehicle."
- **Surface:** in-app chat + share-sheet. "Where do I put my finds" answers
  itself: share ANYTHING (URL, screenshot, photo) INTO the app; the sandbox
  agent runs the intake → investigator chain → dossier, and the find lands
  on the user's Discoveries shelf. No Mac, no launchd, no Skylar-session.
- **Guardrails:** same laws that bound this session — facts are sacred,
  testimony never deleted, editorial gate, merge_proposals for entity
  resolution, human keys for capital/contact/ownership.

**The proof-of-concept is this document's worked example:** every step the
sandbox agent must perform was executed manually on 2026-07-02 against a
$1.65M asset, from a phone, in minutes. The session transcript is the
behavioral spec.
