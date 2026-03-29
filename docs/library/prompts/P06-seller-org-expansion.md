# P06: Seller→Organization Auto-Discovery

## Context
Read these before executing:
- `docs/library/reference/encyclopedia/README.md` Section 18 — Organization Sandbox concept
- `docs/library/intellectual/papers/entity-resolution-design.md` — matching cascade, 0.80 threshold
- `docs/library/intellectual/papers/trust-scoring-methodology.md` — source trust hierarchy (dealer = 0.65-0.75)
- `docs/library/intellectual/papers/user-simulation-methodology.md` — stylometric fingerprinting of BaT users

## Problem
Only 6 sellers are wired to organizations via `bat_seller_monitors`. There are 520K BaT usernames; 19K have 100+ comments; 1K have 1,000+. The top 200 BaT sellers by listing volume are professional dealers — they have websites, brick-and-mortar locations, and repeat inventory. None of them are linked.

The current `bat_seller_monitors` table requires manual insertion. What's needed is auto-discovery: detecting which BaT usernames are dealers (not individuals) and either creating or matching organizations.

## Scope
One script. One migration (index). No new edge functions. No new tables.

## Steps

1. Read the existing infrastructure:
```bash
# Existing org tables
psql -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'bat_seller_monitors' ORDER BY ordinal_position;"

# Existing external_identities for bat platform
psql -c "SELECT count(*), count(DISTINCT handle) FROM external_identities WHERE platform = 'bat';"

# Top sellers by listing count (already in the data)
psql -c "SELECT bat_seller, count(*) as listings FROM vehicles WHERE bat_seller IS NOT NULL GROUP BY bat_seller ORDER BY listings DESC LIMIT 50;"
```

2. Build a classifier script `scripts/discover-dealer-sellers.mjs` that:

**Signal 1: Volume** — Sellers with 10+ listings are likely dealers. Individuals rarely list 10+ vehicles on BaT.

**Signal 2: Temporal pattern** — Dealers list consistently across months/years. Individuals list 1-3 vehicles and disappear. Calculate listing spread: `(max_date - min_date) / count`. Dealers have spread < 90 days per listing.

**Signal 3: Description language** — Dealers use "selling dealer" / "the dealer" / "the dealership" / "our inventory". Individuals use "my" / "I purchased" / "I've owned". Score each seller by the ratio of dealer-language descriptions to total descriptions.

**Signal 4: Stylometric profile** — If `bat_user_profiles.metadata.stylometric_profile` exists for this seller, check `formality_score`. Dealers score > 0.7 (formal, third-person). Individuals score < 0.5.

Composite score: `dealer_score = (volume >= 10) * 0.3 + (spread_score) * 0.2 + (language_score) * 0.3 + (formality_score) * 0.2`

If `dealer_score >= 0.75` → auto-create in `bat_seller_monitors` + create/match organization in `businesses`.

3. For org matching, use existing organizations first:
```sql
-- Check if the seller's BaT username matches an existing business name
SELECT id FROM businesses WHERE business_name ILIKE $seller_username;
-- Also check external_identities for cross-platform matches
SELECT claimed_by_user_id FROM external_identities WHERE handle ILIKE $seller_username AND platform != 'bat';
```

If no match found, create a new `businesses` row with:
- `business_name` = seller username
- `business_type` = 'dealer'
- `status` = 'discovered'
- `discovered_by` = 'dealer_auto_discovery'
- `verification_level` = 'unverified'

4. Wire the discovered orgs using the same logic from `scripts/backfill-bat-seller-to-org.mjs`.

5. Add to package.json:
```json
"discover:dealer-sellers": "dotenvx run -- node scripts/discover-dealer-sellers.mjs",
"discover:dealer-sellers:dry-run": "dotenvx run -- node scripts/discover-dealer-sellers.mjs --dry-run"
```

## Verify
```sql
-- Before: 6 seller monitors
SELECT count(*) FROM bat_seller_monitors;

-- After: should be 50-200+ (depends on threshold tuning)
SELECT count(*) FROM bat_seller_monitors;

-- New orgs should all be 'discovered' status
SELECT count(*) FROM businesses WHERE discovered_by = 'dealer_auto_discovery';

-- Newly wired vehicles
SELECT count(*) FROM organization_vehicles WHERE auto_matched_reasons @> ARRAY['bat_seller_monitor_match'];
```

## Anti-Patterns
- Do NOT lower the dealer_score threshold below 0.70. False positive dealer classification pollutes org profiles with individual seller data.
- Do NOT create orgs for sellers with < 5 listings. The signal is too weak.
- Do NOT run the wiring step inline — call `npm run backfill:bat-seller-to-org` after discovery.
- Do NOT merge discovered orgs with existing orgs without human review. Create new, let entity resolution propose merges later.
- Do NOT use LLM calls for classification. This is pure regex + stats. Zero API cost.

## Library Contribution
After completing:
- Update `docs/library/reference/dictionary/README.md` — add "Dealer Auto-Discovery" term
- Add dealer classification signals to `docs/library/intellectual/papers/market-intelligence-patterns.md`
- Update `docs/library/reference/atlas/` — add discovered dealers with their BaT listing counts
