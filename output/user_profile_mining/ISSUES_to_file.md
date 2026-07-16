# Issues found during user-profile-mining 2026-05-23

These belong in `.claude/ISSUES.md` (Edit blocked here, agent without write perms on that file). Append to the LOW section.

---

### [MEDIUM] `output/receipts/_receipts.csv` extraction is degraded T2 quality
- **Source:** user-profile-mining job 2026-05-23
- **Details:** 318-row CSV of OCR'd receipts from `~/Downloads/RECEIPTS SKYLAR 2/` (232 JPEGs + 86 from `~/Downloads/receipts/` DNGs). Vendor field frequently captures address fragments, caption text, or scrap strings instead of merchant names. Examples: "B 5099575", "Detach card here and carry in your wallet or with registration", "Boulder City, NV 89005", "BRANCH DEALER STOCK", "Page 3 of 3", "CHANGE: $0.00", "• LARGEST INVENTORY", "Term", "Their Futures and Realize Their Dreams". `line_items` column is `0` for most rows even where `total` parsed. Date column has 2003-04-14 on a 2022-era Carquest-looking receipt — likely faded receipt misread.
- **Impact:** This CSV is referenced as "already-processed receipts" but cannot be trusted for vendor-frequency or brand-mention analysis without re-OCR. The user-profile-mining job used vendor names only at T2 trust (high-frequency vendors like Carquest, AutoZone, O'Reilly, Summit Racing, Chase fuel were reliably extracted; long-tail entries are garbage).
- **Files:** `/Users/skylar/nuke/output/receipts/_receipts.csv` (source); ingestion script unknown — last touched 2026-04-17 to 2026-05-02 per mtimes
- **Status:** OPEN
- **Fix shape:** Re-OCR the 232 disk JPEGs with the better-extracting `process-receipt` v173 pipeline (now Claude-backed); write a discovery-first schema like the SCHEMA DISCOVERY PRINCIPLE says; replace the CSV with structured rows that have explicit `confidence` on each field. 4 of the 232 disk JPEGs are not yet in the CSV at all (IMG_4999, IMG_5121, IMG_5140, IMG_5201).

### [LOW] Apple Cash mining captures only ~2yr from local chat.db; older history in iCloud
- **Source:** user-profile-mining job 2026-05-23
- **Details:** Local `~/Library/Messages/chat.db` has 78 Apple Cash messages dated Aug 2024 → May 2026 totaling $27,557 sent (zero received parsed). Skylar's context file claims 138 payments / $83K visible. Gap: the older payments likely live in iCloud Messages history that the local DB has aged out. Top counterparties resolved via local Contacts DBs: Ernie Wilder $13,024 (14 sends), tommy taylor $3,520 (6), Joey Patchett $3,210 (10), Jenny Mannerheim $2,341 (25 — high-cadence small-payment vendor pattern, suggests parts vendor not personal), Cj Wilder $1,021, justine goodfellow $1,000, Mom $610, Keoni $450.
- **Files:** `/Users/skylar/nuke/output/user_profile_mining/apple_cash/by_counterparty.json`, `raw.json`
- **Status:** OPEN
- **Fix shape:** Either (1) sign in to iCloud on a clean Messages download to backfill, or (2) accept the 2-year cap as the upper bound for this substrate and lean harder on QB + mail for older history. The 138 / $83K figure in `skylar-context.md` may itself be stale; should be verified.

### [LOW] Apple Mail Envelope Index is the highest-leverage shopping substrate — under-mined until now
- **Source:** user-profile-mining job 2026-05-23
- **Details:** `~/Library/Mail/V10/MailData/Envelope Index` contains 129,112 messages going back to 2009 — KSL Cars (37,662), eBay (3,409, $443K parseable in subject lines), BringATrailer (1,655), PayPal (1,524), Amazon (1,399), Jegs (820), Harbor Freight (818), CJ Pony (807). 9,132 distinct sender addresses bucketable by domain. Currently the platform does not pull from this substrate at all — Gmail-via-MCP exists but was not previously used for vendor cadence mining. This is where the 10-year buying history actually lives.
- **Files:** mining outputs at `/Users/skylar/nuke/output/user_profile_mining/gmail/`
- **Status:** OPEN
- **Fix shape:** Stand up a recurring extractor that reads the Envelope Index nightly and ingests vendor-order observations against the user_id. Currently the observation schema is vehicle-scoped only (`vehicle_observations`); needs a `user_observations` table or extension to support unscoped/user-scoped findings. See schema_proposal pending in user-profile-mining output.

### [LOW] `vehicle_observations` cannot persist user-scoped findings (no user_id, vehicle_id NOT NULL)
- **Source:** user-profile-mining job 2026-05-23
- **Details:** Brief required writing findings as observations against Skylar's user_id but `vehicle_observations` is vehicle-anchored — `vehicle_id` column with no user-scoped fallback. `observation_kind` enum lacks `vendor_preference / brand_preference / purchase_cadence / shipping_address_pattern / payment_method_pattern / vehicle_attribution_inferred`. Mining proceeded to file outputs only; DB persistence deferred pending schema_proposal review.
- **Files:** `vehicle_observations` table; `observation_kind` enum (current values: listing, sale_result, comment, bid, sighting, work_record, ownership, specification, provenance, valuation, condition, media, social_mention, expert_opinion, splice + analysis from migration 20260523151809)
- **Status:** OPEN
- **Fix shape:** File a schema_proposal for `user_observations` table with same shape as `vehicle_observations` but anchored to `auth.users.id`. OR extend `vehicle_observations` with nullable `user_id` and make `vehicle_id` nullable + check constraint requiring exactly one of (vehicle_id, user_id, property_id). Either way, expand observation_kind enum to cover purchase-pattern kinds. Pending mining outputs at `/Users/skylar/nuke/output/user_profile_mining/` can be replayed into the table once schema lands.
