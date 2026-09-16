# Monthly Review — How to ask "did I have a good month?"

This doc shows how to query the Nuke database for what you actually did in any given month: photos shot, observations recorded, work done on vehicles, money in/out, sales. Everything below is live SQL — run it with `psql` or via Supabase MCP and it'll give you the answer.

## Use the views, not the raw queries (added 2026-05-07)

Three views replace the per-table queries below as the canonical entry points. They're sargable on `WHERE user_id = '...'` (each UNION leg uses a single direct user column with an existing index).

| View | Grain | Use for |
|---|---|---|
| `v_user_daily_activity` | one row per source event | activity feed, "what did I do today/this week/this month" |
| `v_garage_asset_summary` | one row per (user, vehicle) | per-vehicle ledger: photo count, receipts, days held, net position |
| `v_user_monthly_summary` | one row per (user, month) | "did I have a good month?" — single SELECT |

### "What did I do today?"
```sql
SELECT event_at, event_kind, event_subtype, dollar_amount, summary_text
FROM v_user_daily_activity
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND event_day = CURRENT_DATE
ORDER BY event_at DESC;
```

### "Was last month a good month?"
```sql
SELECT * FROM v_user_monthly_summary
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND month = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')::date;
```

### "Show my whole garage with cost basis"
```sql
SELECT year, make, model, photo_count, total_receipts_usd,
       acquisition_cost_usd, estimated_current_value_usd, net_position_usd, days_held
FROM v_garage_asset_summary
WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
ORDER BY photo_count DESC;
```

### Per-leg user_id semantics (so you know what counts as "your" activity)
- **photos** → `vehicle_images.user_id` (uploader)
- **observations** → `vehicle_observations.submitted_by_user_id` (who logged it)
- **events** (listings/sales) → `vehicles.user_id` (owner of the asset)
- **comments** (auction) → `vehicles.user_id` (owner of the commented-on asset)
- **receipts** → `receipts.user_id` (purchaser)
- **reattributions** → `reattribution_audit.actor_user_id` (data-quality work)

Per-table queries below remain as reference for ad-hoc analysis (e.g. when you need a column the views don't expose).

---

The data lives across these substrate tables (per the agent-layer-vs-substrate rule, USER atoms live here, not in agent memory):

| Table | What it logs | Time field |
|---|---|---|
| `vehicle_images` | Every photo attached to any vehicle, with vision-gate verdict | `created_at`, `taken_at` (EXIF), `vision_gate_processed_at` |
| `vehicle_observations` | Structured atoms: VIN sightings, build specs, ownership, work records, listings, comments, valuations | `observed_at`, `ingested_at` |
| `vehicle_events` | Listings + sales + auctions on BaT / Mecum / Cars&Bids / etc. | `started_at`, `ended_at`, `sold_at` |
| `auction_comments` | BaT/etc. comment threads — community spec corrections, history | `posted_at` |
| `work_orders` (if exists) | Consignment + labor projects | `started_at`, `closed_at` |
| `payment_events` | Money in/out (Zelle, BaT proceeds, deposits) | `paid_at` |
| `receipts` | Parts/expenses with scope + line items | `purchased_at` |
| `reattribution_audit` | When images got moved between vehicles | `created_at` |

## "Did I have a good month?" — quick template

Replace `'2026-03-01'` and `'2026-04-01'` with your month boundaries. All queries scope to Skylar's user_id `0b9f107a-d124-49de-9ded-94698f63c1c4`.

### 1. How many vehicles did you photograph?
```sql
SELECT COUNT(DISTINCT vehicle_id) AS vehicles_photographed,
       COUNT(*) AS total_photos_added
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
WHERE v.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND vi.created_at >= '2026-03-01' AND vi.created_at < '2026-04-01';
```

### 2. Which vehicles got the most attention this month?
```sql
SELECT v.year || ' ' || v.make || ' ' || v.model AS vehicle, v.id::text AS id,
       COUNT(*) AS photos_added,
       MIN(vi.created_at) AS first_photo,
       MAX(vi.created_at) AS last_photo
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
WHERE v.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND vi.created_at >= '2026-03-01' AND vi.created_at < '2026-04-01'
GROUP BY v.id, v.year, v.make, v.model
ORDER BY photos_added DESC LIMIT 20;
```

### 3. What structured observations did you log?
```sql
SELECT kind::text, COUNT(*) AS observation_count,
       array_agg(DISTINCT (SELECT v.year || ' ' || v.make || ' ' || v.model
                           FROM vehicles v WHERE v.id = vo.vehicle_id) ORDER BY 1) AS vehicles_touched
FROM vehicle_observations vo
WHERE submitted_by_user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND observed_at >= '2026-03-01' AND observed_at < '2026-04-01'
GROUP BY kind ORDER BY observation_count DESC;
```

### 4. Did you sell anything? Auction activity?
```sql
SELECT v.year || ' ' || v.make || ' ' || v.model AS vehicle,
       e.source_platform, e.event_type, e.event_status,
       e.final_price, e.sold_at, e.source_url
FROM vehicle_events e
JOIN vehicles v ON v.id = e.vehicle_id
WHERE (v.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
       OR e.seller_identifier = 'skylarwilliams')
  AND (e.sold_at >= '2026-03-01' AND e.sold_at < '2026-04-01')
ORDER BY e.sold_at DESC;
```

### 5. Money in (BaT proceeds, Zelle, customer payments)
Check `payment_events` if it exists, or scan for ownership/provenance observations with `confirmation_*` payments:
```sql
SELECT vo.vehicle_id, v.year || ' ' || v.make || ' ' || v.model AS vehicle,
       vo.kind::text, vo.content_text, vo.observed_at,
       (vo.structured_data->>'amount_usd')::numeric AS amount_usd
FROM vehicle_observations vo
LEFT JOIN vehicles v ON v.id = vo.vehicle_id
WHERE vo.submitted_by_user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND vo.observed_at >= '2026-03-01' AND vo.observed_at < '2026-04-01'
  AND (vo.kind = 'sale_result' OR vo.content_text ~* 'paid|received|deposit|invoice')
ORDER BY vo.observed_at DESC;
```

### 6. What got cleaned up? (data quality work)
```sql
SELECT
  (SELECT v.year || ' ' || v.make || ' ' || v.model FROM vehicles v WHERE v.id = ra.old_vehicle_id) AS from_vehicle,
  (SELECT v.year || ' ' || v.make || ' ' || v.model FROM vehicles v WHERE v.id = ra.new_vehicle_id) AS to_vehicle,
  ra.observation_type, ra.reason, ra.created_at
FROM reattribution_audit ra
WHERE ra.actor_user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND ra.created_at >= '2026-03-01' AND ra.created_at < '2026-04-01'
ORDER BY ra.created_at DESC;
```

### 7. Receipts / expenses by scope
```sql
SELECT scope_type, COUNT(*) AS receipts, SUM(total) AS total_usd
FROM receipts
WHERE purchased_at >= '2026-03-01' AND purchased_at < '2026-04-01'
GROUP BY scope_type ORDER BY total_usd DESC NULLS LAST;
```

## "Was it a GOOD month?" — qualitative score

A "good" month is one where:
- ≥ 1 vehicle reached a milestone (sold, listed, drained, fully spec'd)
- ≥ 5 structured observations logged (specs, ownership, sightings)
- net positive cash flow (sales > expenses)
- low % of new images flagged misattributed (clean photo intake)
- ≥ 1 customer-vs-personal scope corrections caught

Run query #2 + #3 + #4 + #6 together and the picture appears.

## What's being logged RIGHT NOW (active session)

Every L4 vision-gate batch surfaces:
- **Per-image verdict** → `vehicle_images.vision_gate_status` (approved / rejected_misattributed / rejected_personal / review_needed)
- **Per-image reasoning** → `vehicle_images.vision_gate_agent_reasoning` (includes VIN sightings, plates, build details)
- **Structured spec observations** → `vehicle_observations` rows with kind=`specification` (engine, transmission, paint, RPO codes, builder, etc.)
- **VIN/plate sightings** → `vehicle_observations` rows with kind=`sighting`
- **Ownership/provenance** → `vehicle_observations` rows with kind=`ownership` or `provenance`
- **Reattributions** → `reattribution_audit` rows when images move between vehicles

The two cron triggers (`trig_016n4GhSBPsrUJdcMCRsxPCG` :00 and `trig_01BtcQwqRpXViqAQmKbkR6R2` :30) keep this running hourly even when no one's at the keyboard.

## Open gap (worth fixing)

Per Skylar 2026-05-06: not every L4 finding has been getting saved as a structured observation — some only land in the per-image `reasoning` text. Going forward, every batch summary that mentions a build detail, VIN, plate, builder name, or sister-vehicle finding should produce a `vehicle_observations` INSERT. Cron prompts updated to require it.
