# Skylar Williams — Vehicle Fleet Reference
_Auto-generated from `vehicle_ownerships` JOIN `vehicles`, last refresh 2026-05-24._
_Owner profile ID: `0b9f107a-d124-49de-9ded-94698f63c1c4`_

Future agents: READ THIS FIRST before answering ownership/fleet/garage questions. The DB is the source of truth — this file is the cached human-readable view.

## Currently owned (verified_owner, legal_title, is_current=true)

| Year | Make / Model | VIN | Color | Paid | Vehicle ID |
|------|--------------|-----|-------|------|------------|
| 1966 | Ford Mustang | 6F07C219593 | Red | $6,000 | 83f6f033 |
| 1973 | GMC K5 | TKY183F505217 | — | $4,000 | 5b4e6bcd |
| 1973 | Chevrolet K20 | CKY243Z178481 | — | $400 | ef844607 |
| 1974 | Chevrolet K5 Blazer Cheyenne 4×4 | CKY184F180454 | — | — | ee829094 |
| 1977 | Chevrolet Blazer | CKR187F127263 | — | $2,000 | e08bf694 |

**Mustang (83f6f033) is his current active build.** See CLAUDE.md for project context.

## Previously owned / sold

| Year | Make / Model | VIN | Paid | Sold | Profit | Status | Vehicle ID |
|------|--------------|-----|------|------|--------|--------|------------|
| 1978 | Chevrolet K10 Custom Deluxe | CKL148Z176170 | $8,500 | $22,500 | +$14,000 | sold via FB truck page, shipped to MO (open title, bought from Patchin Las Vegas NV on OfferUp) | 6da5707b |
| 1983 | GMC K2500 Sierra Classic | 1GTGK24M1DJ514592 | $2,000 | $31,000 | +$29,000 | sold (BAT?) | a90c008a |
| 1988 | GMC Suburban 1500 Sierra Classic 4×4 | 1GKEV16K4JF504317 | — | — | — | previous_owner, BAT-imported (tan & blue) | 04121203 |
| 1991 | Chevrolet Suburban V1500 | 1GNEV16K8MF147795 | — | — | — | unverified_claim, is_current=false | ca1c9024 |

**Documented sales gross: +$43,000** across 2 vehicles (K10 + K2500).

## Substrate gaps / issues

- **Orphan ownership row:** `vehicle_ownerships` has Skylar=verified_owner on vehicle `05f27cc4-914e-425a-8ed8-cfea35c1928d` but that vehicle row does not exist in `vehicles` (hard-deleted or never created). Don't delete the ownership row per trust invariants — flag in ISSUES.md and investigate.
- 1988 GMC Suburban (04121203) has no `ownership_type` on the ownership row. Should be filled if title scan confirms.

## Title scans we have

All 39 in `secure_documents` are uploaded by Skylar (`document_type='vehicle_title'`). They resolve to ~18 unique source images (he uploaded several titles multiple times). Local-extracted JPGs at `.context/title_jpgs/`. Structured extraction at `.context/title_extraction.json` (when agent finishes — async). Human view at `.context/title_analysis.md`.

## Photo library context substrate (built 2026-05-24)

- `.context/photos_raw.tsv` — 59,101 GPS-tagged photos 2008-2026
- `.context/photo_bursts.json` — 3,893 time bursts (4h gap split)
- `.context/gps_clusters_top50.json` — top 50 GPS clusters by photo density
- Shop GPS: 35.977, -114.854 (Boulder City, 674 Wells Rd cluster, 16,347 photos)

## How to use this file
Update it when:
- A new ownership row is created/changed (PATCH vehicles or vehicle_ownerships)
- A sale closes (sold_price set)
- A title is processed and confirms/contradicts a profile

Don't update for: sidequests on long-sold vehicles, transient analyses.
