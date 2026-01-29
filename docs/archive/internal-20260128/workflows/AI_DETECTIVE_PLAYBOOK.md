# AI Detective Playbook (Vehicle Research)

Purpose
- Turn raw sources (URLs, PDFs, forum posts, auction listings) into clean, auditable timeline events.
- Avoid contamination: only attach facts that clearly match the target vehicle identity.

Inputs the detective should gather
- Vehicle identity: year, make, model, VIN/chassis, notable aliases.
- Source URLs: auction listings, registries, press, race results, PDFs, forum threads.
- Evidence fragments: dates, locations, ownership changes, restoration work, race entries, auction results.

Identity matching rules (no contamination)
- Hard match: VIN/chassis must match exactly (allow legacy chassis IDs).
- Soft match: YMM + unique alias + consistent provenance (same chassis references across sources).
- If unsure: record as "candidate" in metadata and do NOT apply to the timeline.

Output format (what to produce)
- A list of timeline events with:
  - event_type: one of [auction_listed, auction_sold, ownership_transfer, restoration, maintenance, race_entry, race_result, documentation, other]
  - event_date: YYYY-MM-DD (use date_precision if month/year only)
  - title: short headline
  - description: plain-language summary
  - source_url: strongest citation for the event
  - confidence: 0-100
  - metadata: { date_precision, chassis, lot_number, venue, organization, notes }

Landing points (where to store things)
- Dated events → `timeline_events`
- Undated facts or loose ends → `vehicle_research_items`
- Sources/PDFs → `vehicle_research_items` + `reference_documents`/`library_documents`
- Missing core fields → `data_gaps` (proof tasks)
- Missing reference knowledge → `knowledge_gaps` (wiki gaps)

Date precision rules
- If only year known: use YYYY-01-01 + metadata.date_precision = "year".
- If month known: use YYYY-MM-01 + metadata.date_precision = "month".
- If exact date known: use YYYY-MM-DD + metadata.date_precision = "day".
- If no date: skip the event (or create "other" with date_precision = "unknown" only if critical).

Evidence hierarchy (strongest → weakest)
- Auction results or official registry pages
- Official documents or PDFs with clear provenance
- Reputable editorial sources with citations
- Forums or image-only references (must corroborate with other sources)

AI Detective checklist
1) Confirm chassis/VIN and aliases.
2) Build a source list with citations.
3) Extract events and normalize dates.
4) Apply identity checks; discard ambiguous facts.
5) Emit timeline events with confidence + precision.
6) Flag gaps (missing years, unknown owners, conflicting dates).

Example target (GT40P1080)
- Identity: 1969 Ford GT40 Lightweight, chassis GT40P1080.
- Sources to mine:
  - Classic.com listing page
  - Radical magazine PDF
  - RacingSportsCars chassis page
  - TheClassicValuer listing
- Expected events:
  - Race entries/results
  - Auction listings and final prices
  - Restoration or ownership changes
  - Publication/document references

Non-pollution warning
- Many GT40s share similar specs; do not assume.
- If a source uses ambiguous “GT40 P/1080” formatting, verify the chassis reference.
- If photos appear reused across listings, treat as low confidence unless the chassis is stated.
