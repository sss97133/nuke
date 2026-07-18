# AC-Relevant Findings — Skylar's Buying History

**User:** Skylar Williams (`0b9f107a-d124-49de-9ded-94698f63c1c4`)
**Run:** 2026-05-23
**Sources mined for this slice:** QB transactions (2,950 rows, 2019-2026) + Apple Mail Envelope Index (129,112 messages, 2009-2026) + Apple Cash via iMessage (78 payments, Aug 2024-May 2026) + 318 processed receipts CSV
**Trust:** T2 (vendor name + subject line only; no body OCR yet)

## TL;DR — for AC parts list re-weighting

> **Skylar has NO prior purchase history with any of the named AC SYSTEM vendors** (Vintage Air, Old Air Products, SPAL, ICT Billet, Sanden, Mastercool *as AC parts*, Four Seasons, Holley AC components, Classic Auto Air, Hot Rod Air, Gen IV, SureFit). All AC system mentions across his entire mail substrate are either marketing emails or unrelated.

> **BUT he is actively buying AC TRIM parts for squarebody trucks** — 4+ eBay buys 2024-2025 for "1981-1987 Chevy/GMC truck A/C dash vent set" and "1984-1987 GMC truck dash bezel W/ A/c" (the cluster bezel surround that delineates a stock factory AC truck dash from a non-AC dash). This points at the **K10/K20 squarebody dash retrofit**, not the Mustang. The Mustang AC system is greenfield.

The parts list from session 2026-05-23 should NOT be re-weighted toward "what he's bought before" for the system itself — there is no system-vendor prior. Re-weight instead toward:
1. Vendors he ALREADY does business with (CJ Pony, Summit, Jegs, Eckler, Holley) that ALSO carry AC kits
2. His installed tools (he has Mastercool flaring tools — favor kits that ship with hard line he can flare himself)
3. Vendors with strong return/support behavior (Summit Racing pattern: 8 transactions over $3K, last seen 2026-03-17)
4. If the AC project is for a SQUAREBODY (K10/K20/Blazer/Suburban 73-87 platform), assume the dash trim conversion is partially done already — check installation status before re-buying vent registers or bezels.

## Vendor evidence detail

### Named AC vendors — direct purchase history

| Vendor | QB rows | Mail orders | Last seen | Verdict |
|---|---|---|---|---|
| Vintage Air | 0 | 0 | never | **NO HISTORY** |
| Old Air Products | 0 | 0 (only CJ Pony marketing for them) | never | **NO HISTORY** |
| Classic Auto Air | 0 | 0 | never | **NO HISTORY** |
| Hot Rod Air | 0 | 0 | never | **NO HISTORY** |
| SPAL | 0 | 0 (only Jegs marketing for them) | never | **NO HISTORY** |
| Sanden | 0 | 0 | never | **NO HISTORY** |
| Four Seasons | 0 | 0 (one Kayak vacation email match) | never | **NO HISTORY** |
| ICT Billet | 0 | 1 Amazon shipment 2023-11-09 (subj: "ICT Billet SBC Vehicle to..." — NOT AC; ICT Billet sells brackets, this is engine accessory) | 2023-11 | **non-AC purchase** |
| Mastercool | 0 | 6 Amazon orders Jul-Nov 2018 — ALL FLARING TOOLS | 2018-11 | **owns the TOOLS, never bought parts** |

### Mastercool tool inventory (T1 — direct Amazon order confirmations)

From Amazon order subject lines, 2018:
- `Mastercool 71700` black tool (ordered 2x: 7/11 + 7/17)
- `Mastercool 71097-03` adapter (shipped 7/13)
- `MASTERCOOL 3/16 DOUBLE...` flaring set (shipped 7/16, with 2 more items)
- `MASTERCOOL 71300` black push (Aug + Nov 2018 — Aug was an Amazon ad response, Nov could be 2nd order)
- `Mastercool 70027` mini tube (cutter, 7/20)
- `Mastercool 72475-PRC` blue (Nov 2018 ad response)

**Operational implication:** he can fabricate his own AC hard lines (3/16" double-flare, stub adapters, push connect). Favor kits that ship hard line in bulk over pre-fabbed line kits.

### Adjacent parts vendors he ACTIVELY uses (cross-sell targets)

(Useful for buying an AC kit through a vendor he already trusts)

| Vendor | Mail msgs | QB rows | Mail orders w/ $ | First contact | Last activity | Total order $ in subject lines |
|---|---|---|---|---|---|---|
| CJ Pony Parts | 807 | 6 ($6,604) | 98 | 2016-04-19 | 2026-04-30 | $1,729 (subj-level only; body has more) |
| Jegs | 820 | 0 | 84 | 2018-10-30 | 2026-05-01 | $7,382 |
| Summit Racing | 112 | 8 ($2,962) | 77 | 2019-11-18 | 2026-04-23 | $0 (subjects don't include $; QB shows real spend) |
| Harbor Freight | 818 | 0 | 140 | 2023-02-13 | 2026-05-01 | $4,915 |
| Eckler | 46 | 0 | 12 | **2026-03-04** (new) | 2026-05-01 | $30,028 |
| Holley | 80 | 0 | 9 | 2022-03-24 | 2025-12-31 | $0 (subj-level) |
| RockAuto | 18 | 1 ($0) | 1 | 2025-10-17 | 2026-04-22 | $0 |
| LMC Truck | 4 | 0 | 0 | 2022-11-25 | 2025-11-03 | low engagement |
| Classic Industries | 37 | 0 | 7 | 2018-10-13 | 2022-05-19 | dormant |

**Recommendation:** Vintage Air kits are sold through Summit, Jegs, and CJ Pony. SPAL fans are sold through Summit, Jegs. Old Air Products is sold direct + through Eckler/CJ Pony. **Source the AC kit through Summit Racing** — highest dollar engagement with him in last 12 mo (most recent: $1,243 floor mats + door panel order on 2026-03-04; $617 exhaust cutouts on 2026-03-17).

### eBay squarebody A/C trim buys (newly surfaced)

| Date | Subject | Likely target |
|---|---|---|
| 2024-08-29 | AC Delco Platinum Spark Plug Set of 8 FOR LS1 LS2 LS3 LS6 L99 ENGINES | LS3 / K5 wiring substrate confirms LS3 — fits |
| 2024-09-18 | 1981-1987 CHEVY GMC TRUCK A/C DASH VENT SET 4 PCS | squarebody (K10/K20/V15/V25) |
| 2025-04-07 | 1984-1987 GMC Truck Dash Bezel W/ A/c W/ Lower Column Cover | squarebody |
| 2025-04-11 | (delivery of above) | squarebody |
| 2025-12-19 | 1981-1987 CHEVY GMC TRUCK A/C DASH VENT SET 4 PCS (2nd order) | squarebody |

Two separate orders of the dash vent set (Sep 2024, Dec 2025) — either replacing damaged vents or doing 2 trucks. The W/ A/c bezel order pairs with the 4 vent ports of a stock factory AC truck dash. **He has the interior trim side of an AC conversion in hand for a squarebody.** The system side (compressor / lines / evaporator / condenser) is what's still greenfield.

### Engine bay / cooling cross-references (AC compressor mounting concerns)

No purchases found in QB or mail for:
- Pulley brackets / serpentine kits (other than the one ICT Billet SBC item)
- Electric fans (SPAL, Derale, Be Cool, Flex-a-Lite)
- Radiators (Mishimoto, Be Cool, Griffin, Champion, DeWitt)
- Coolant lines / overflow tanks

**Operational implication:** if Mustang engine bay needs cooling upgrade alongside AC (likely), this is also greenfield — re-quote with cooling kit.

## Methodology + trust notes

- **QB scan:** Substring search across `vendor_name`, `line_description`, `memo` for all AC-relevant strings. 2,950 rows scanned. Zero hits beyond CJ Pony / Summit / RockAuto rows.
- **Mail scan:** Subject + sender address text search across all 129,112 messages in `/Users/skylar/Library/Mail/V10/MailData/Envelope Index`. Body content NOT parsed (would require message-store crawl). If AC orders went via a non-domain email or used generic subject, missed.
- **Receipt CSV scan (existing _receipts.csv):** Vendor-level — no Vintage Air, Old Air, SPAL, Sanden, Mastercool merchant present. Mastercool is in MAIL because purchased via Amazon, would not appear in the receipts CSV as a separate merchant.
- **What this does NOT cover:** PayPal email body line items, eBay listing-level (eBay $443K parseable in subjects — many car listings, possibly some AC parts), in-person cash purchases without receipt, Apple Cash sends (none of the named AC contacts).

## Confidence

- **HIGH:** "No prior Vintage Air / Sanden / SPAL / Old Air / Four Seasons / Classic Auto Air / Hot Rod Air purchase exists in QB OR mail subjects."
- **HIGH:** "Mastercool TOOLS purchased July-Nov 2018 from Amazon."
- **MEDIUM:** "No ICT Billet AC purchase" (only saw one ICT Billet SBC bracket Amazon order, non-AC) — could be in eBay or body of other orders.
- **LOW (needs follow-up):** any AC-related purchase that arrived without an order-confirmation email — e.g., direct in-person Vegas counter buy (no receipt OCR'd). The fresh receipts JPEGs at `/Users/skylar/Downloads/RECEIPTS SKYLAR 2/` need re-OCR with better extraction (the existing extraction is degraded — see ISSUES.md).

## Output files referenced

- `/Users/skylar/nuke/output/user_profile_mining/qb/ac_relevant.json` (15 vehicle-parts rows from CJ Pony, RockAuto, Summit)
- `/Users/skylar/nuke/output/user_profile_mining/gmail/ac_hits.json` (18 AC-keyword hits in mail)
- `/Users/skylar/nuke/output/user_profile_mining/gmail/vendor_email_stats.json` (all vendor email volume)
- `/Users/skylar/nuke/output/user_profile_mining/gmail/vendor_orders.json` (order-confirmation extraction by vendor)
- `/Users/skylar/nuke/output/user_profile_mining/qb/vendors_top100_excluding_payment_processors.json` (QB vendor cadence)
