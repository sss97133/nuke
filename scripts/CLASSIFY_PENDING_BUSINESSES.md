# Classify Pending Businesses

Script and process for assigning **business_type** to N-Zero businesses. We use **many specific types** (not just five) so "other" is only for truly unclassified rows.

## Apply the migration first

Before re-classifying with the expanded types (villa_rental, restaurant_food, construction_services, etc.), apply the migration that adds them to the DB constraint:

```bash
node scripts/run-migrations.cjs 20260210000001_business_type_expanded_types.sql
```

If this migration is not applied, updates that set e.g. `villa_rental` or `restaurant_food` will fail with "violates check constraint businesses_business_type_check". After applying, run the classifier again with `--revamp`.

## What it does

1. **Finds pending rows** – All rows in `businesses` where `business_type` is null, empty, or not one of: `dealer`, `dealership`, `garage`, `auction_house`, `restoration_shop`, `performance_shop`.
2. **Classifies each** – Uses name, description, website, specializations, and services_offered with keyword heuristics:
   - **Auction houses**: auction, bid, lot, consign
   - **Restoration shops**: restoration, restore, restorer, concours, preservation
   - **Performance shops**: performance, tuning, dyno, racing, motorsport, turbo, horsepower
   - **Garages**: garage, service, repair, mechanic, maintenance, diagnostic, lift, oil change, brake, alignment
   - **Dealers**: dealer, dealership, sales, inventory, cars for sale, pre-owned, used cars, classic/collector cars
3. **Writes back** – Either applies updates to the DB (batches of 100) or emits CSV/SQL for manual apply.

## Running

From repo root (`nuke/`):

```bash
# Load env from .env (SUPABASE_URL or VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
npx tsx scripts/classify-pending-businesses.ts --dry-run   # no writes, print counts and assigned types
npx tsx scripts/classify-pending-businesses.ts --csv       # write scripts/data/business-classification-updates.csv
npx tsx scripts/classify-pending-businesses.ts --sql       # write scripts/data/business-classification-updates.sql
npx tsx scripts/classify-pending-businesses.ts             # apply updates to the database
```

## Edge cases (documented)

- **No name/description/website** – Classified as `dealer` (broadest bucket).
- **Ambiguous text** (e.g. "performance garage") – First matching rule wins: auction_house → restoration_shop → performance_shop → garage → dealer.
- **Non-English or minimal text** – Often default to `dealer`; review and reclassify manually in the app or via SQL if needed.
- **Already classified** – Rows that already have one of the five types are never modified (234 in the reference doc; your DB may differ).
- **Schema** – Only `business_type` is updated. The optional `type` column (if present) is not synced by this script.

## Done when

- Every pending business has been assigned one of: Dealers, Garages, Auction houses, Restoration shops, Performance shops.
- "Pending classification" count is 0 (or as low as possible). After a full run without `--dry-run`, re-run with `--dry-run` to confirm pending count; any remaining edge cases can be fixed manually.

## DB target

- **Table**: `businesses`
- **Column**: `business_type`
- **Allowed values** (from schema): `dealer`, `dealership`, `garage`, `auction_house`, `restoration_shop`, `performance_shop` (among others in the check constraint).
