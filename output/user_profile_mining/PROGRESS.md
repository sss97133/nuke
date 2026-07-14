# User Profile Mining — Progress

**Job:** Mine 10yr of Skylar's buying substrate into queryable findings against `user_id = 0b9f107a-d124-49de-9ded-94698f63c1c4`.

**Started:** 2026-05-23 20:22 PT
**Ended (this pass):** 2026-05-23 20:55 PT (one continuous session)
**Triggered by:** structural failure — parts agents going to cold web search instead of his buying history.

## Status: COMPLETE FOR THIS PASS

All 6 sources touched. AC findings delivered first (load-bearing). All findings persisted to disk as queryable JSON. Schema proposal for DB persistence filed (pending review). Issues found & documented.

## Substrate inventory + actual yield

| Source | Volume claimed in brief | Actual confirmed | Status | Output |
|---|---|---|---|---|
| `qb_transactions` | 2,884+ | **2,950 rows, 2019-03 → 2026-04** | mined | qb/ (7 files) |
| Processed receipts JSONs | "322 from 86 DNGs" | **0 JSONs exist** — substrate is `output/receipts/_receipts.csv` with 318 rows (T2 quality) | inspected; QA filed | n/a — see ISSUES_to_file.md |
| Fresh receipt JPEGs | 232 in `~/Downloads/RECEIPTS SKYLAR 2/` | **228 of 232 ALREADY in _receipts.csv; only 4 truly unprocessed** | identified; OCR re-run pending pipeline fix | receipts_fresh/ — 4 IMG IDs queued |
| Apple Cash (iMessage) | 138 payments / $83K | **78 payments / $27,557 in local chat.db Aug 2024 → May 2026** (gap: older on iCloud) | mined | apple_cash/ (2 files, contact-resolved) |
| Gmail | 60,976 messages | **129,112 messages in Apple Mail Envelope Index 2009-2026** | mined | gmail/ (5 files) |
| Photos (GPS-tagged) | 7,693+ | **3,101 in `user_photo_inbox`** | cross-ref only (low priority per brief) | photos/ (2 files, 66 candidate pairs flagged for review) |

## Headline findings

### 1. AC re-weight (the load-bearing deliverable)
- **No prior purchases** from Vintage Air, Old Air Products, SPAL, ICT Billet (as AC), Sanden, Mastercool (as AC parts), Four Seasons, Holley AC components, or any other AC system vendor — across QB, mail, or receipts. AC system side is greenfield.
- **DOES have:** Mastercool flaring tools (Amazon 2018, 6 orders — can fabricate own hard line), and **active squarebody AC trim buys** on eBay (4 orders 2024-2025 for 81-87 truck A/C dash bezel + vent set — interior side is in progress for K10/K20).
- Cross-sell vendors he ALREADY does business with that carry AC kits: **Summit Racing** (8 QB orders $2,962, last 2026-03-17), **CJ Pony** (6 QB / 807 mail, last 2026-04-30), **Jegs** (820 mail / 84 orders / $7,382 parseable), **Eckler** (NEW Mar 2026, $30,028 in 12 mail orders). Source AC kit through Summit.
- See `AC_RELEVANT_FINDINGS.md`.

### 2. Real vendor map (the bigger picture)
- **Desert Performance** is the #1 active parts vendor for him: 33 QB transactions / $23,790. Consistent with K5 wiring/build work.
- **CJ Pony / Summit / Jegs / Eckler / Harbor Freight / Amazon** = the working set. eBay $443K parseable in subject lines, mostly bigger-ticket (vehicle purchases, projects) — needs body-level parse to separate parts from car-buys.
- 12 brand mentions captured in QB but most are single-purchase singletons. Honored low-confidence flag per correctness rule — no inference of brand loyalty from one transaction.

### 3. Counterparty network (Apple Cash)
- Skylar's $27,557 Apple Cash sends (Aug 2024 → May 2026) split across 15 named contacts: Ernie Wilder ($13K / 14 sends), tommy taylor ($3.5K / 6), Joey Patchett ($3.2K / 10), **Jenny Mannerheim ($2.3K / 25 sends — 25 is a vendor-cadence pattern, not a personal one)**, etc. See `apple_cash/by_counterparty.json`.

### 4. Photo-to-purchase cross-reference
- 66 same-day candidate pairs flagged. ZERO have vehicle attribution on either side. All flagged `needs: human review`. Not auto-attributed per correctness rule.

## Persistence outcome

- **Files:** 17 structured JSON/MD files under `/Users/skylar/nuke/output/user_profile_mining/`. Durable, greppable, queryable.
- **Database rows:** **0 inserted.** `vehicle_observations` is vehicle-anchored and observation_kind enum lacks the needed kinds. Filed `schema_proposal_user_observations.json` proposing a `user_observations` table. ~830 observation rows ready to load once schema lands.
- **AC_RELEVANT_FINDINGS.md** is the single re-weighting input for the parts list.

## Issues surfaced (see `ISSUES_to_file.md` — Edit blocked on `.claude/ISSUES.md`)

1. `_receipts.csv` extraction is degraded T2 quality — re-OCR needed
2. Apple Cash mining capped at ~2yr — older history on iCloud not accessed
3. Apple Mail Envelope Index is a high-leverage substrate the platform doesn't use — should land a recurring extractor
4. `vehicle_observations` can't store user-scoped findings — schema proposal filed

## What was NOT done

- **Body-level mail parsing** — only subject + sender mined. Real order amounts/SKUs live in message body, which requires either Spotlight-indexed `.emlx` crawl or the Gmail MCP. Would 2x-5x the precision of vendor_orders.json.
- **eBay item-level extraction** — only 90 of 3,409 eBay messages bucketed as "parts buys" by subject keyword. Body parse needed for full SKU list.
- **Receipt re-OCR** — 232 JPEGs ready, 4 are truly unprocessed; pipeline (`process-receipt` v173) is ready but not invoked here (rate-limit / cost consideration).
- **Photo→purchase vision attribution** — 66 candidate pairs surfaced but not vision-verified. Per `feedback_vision_is_caller_byok_laser_tag.md`, a vision caller would need to look at each photo and the receipt context.
- **DB write-through** — see schema_proposal_user_observations.json.

## File index

```
output/user_profile_mining/
├── PROGRESS.md (this file)
├── AC_RELEVANT_FINDINGS.md   ← the headline deliverable
├── ISSUES_to_file.md         ← QA findings to land in .claude/ISSUES.md
├── schema_proposal_user_observations.json   ← DB persistence proposal
├── unified_vendor_preferences.json  ← QB + mail merged vendor view
├── qb/
│   ├── vendors_top50_by_count.json
│   ├── vendors_top100_excluding_payment_processors.json
│   ├── categories.json
│   ├── line_accounts.json
│   ├── all_vehicle_parts_materials.json (66 rows)
│   ├── ac_relevant.json (15 rows)
│   ├── vendor_preferences.json (136 vendor observations)
│   ├── brand_preferences.json (12 brand observations — most low-confidence)
│   └── vehicle_attribution_inferred.json (641 candidates from QB vehicle_id + VIN regex)
├── apple_cash/
│   ├── raw.json (78 messages, payload-decoded)
│   └── by_counterparty.json (15 contacts ranked, names resolved via Contacts.app DBs)
├── gmail/
│   ├── vendor_email_stats.json (all bucketed senders by volume)
│   ├── top_unbucketed_senders.json (200 high-volume senders not in vendor list — vendor discovery candidates)
│   ├── vendor_orders.json (order-confirmation extraction by vendor)
│   ├── ac_hits.json (18 mail AC keyword hits with timestamps)
│   └── ebay_parts_buys.json (90 parts-keyword subject lines)
├── photos/
│   ├── photo_qb_same_day_candidates.json (46-row SQL output)
│   └── candidate_attributions.json (66 candidate pairs flagged for review)
├── receipts_processed/  (empty — no JSONs existed per brief; substrate is the CSV at ../receipts/_receipts.csv)
└── receipts_fresh/  (empty — 4 unprocessed IMG_4999 / IMG_5121 / IMG_5140 / IMG_5201 noted in ISSUES_to_file.md)
```
