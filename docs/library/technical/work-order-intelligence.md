# Work Order Intelligence

The system that answers "update me on the Granholm build" with a complete cited receipt in <5s.

## The Dual System

Two systems coexist for tracking vehicle work. Both are valid. Neither replaces the other.

### System 1: Timeline Events (Forensic Accounting)
- Table: `timeline_events`
- Purpose: Immutable record of what happened, when, by whom
- FK: `work_order_parts.timeline_event_id`, `work_order_labor.timeline_event_id`
- Used by: `get_event_cost_breakdown()`, cost analysis, audit trail

### System 2: Work Orders (Customer Workflow)
- Table: `work_orders`
- Purpose: Active work tracking, quotes, invoicing, customer communication
- FK: `work_order_parts.work_order_id`, `work_order_labor.work_order_id`
- Used by: `resolve_work_order_status()`, balance computation, receipts

### The Bridge
Both FK columns exist on `work_order_parts` and `work_order_labor`. A row can belong to a timeline event AND a work order simultaneously. `timeline_events.work_order_id` links them when needed.

**Decision record:** We don't merge them because they serve different audiences. Timeline events = what-happened-forensically (source of truth for auditors). Work orders = what-the-customer-sees (source of truth for invoicing).

## The Product: resolve_work_order_status()

```sql
SELECT resolve_work_order_status('granholm');
```

One RPC call returns:
- Vehicle: id, year, make, model, VIN, sale price
- Contact: name, email, phone
- Work orders: title, status, itemized parts/labor/payments, balance per WO
- Summary: total parts, labor, payments, balance due, comped value

Resolution cascade: `work_orders.customer_name` -> `deal_contacts` -> `vehicles.make/model/vin`

Callable from: frontend (`supabase.rpc()`), MCP server, edge function, curl, another agent.

## Data Flow

```
iMessage chat.db ──> ingest-thread.mjs ──> vehicle_observations
                                           (scope changes, agreements)

iMessage chat.db ──> ingest-zelle.mjs ──> work_order_payments
(Zelle SMS 767666)                        (deduped by wo+amount+method+sender+date)

Gmail receipts ────> ingest-receipts.mjs ──> work_order_parts
(Amazon, Summit)                             (with source citations)

Manual entry ──────────────────────────────> work_order_labor
                                             (with rate_source, book hours)

All of the above ──> resolve_work_order_status('query') ──> JSONB response
                     work_order_receipt_unified (view)
                     work_order_balance(wo_id)
```

## Tables

### work_order_payments
Customer payments. Ingested from Zelle SMS notifications in iMessage chat.db.

| Column | Type | Purpose |
|--------|------|---------|
| work_order_id | uuid FK | Which work order this pays toward |
| amount | numeric | Payment amount |
| payment_method | text | zelle, check, cash, wire, venmo, etc. |
| sender_name | text | Who sent it (from Zelle notification) |
| memo | text | Zelle memo field (e.g., "BILSTEIN SHOCKS") |
| reference_id | text | External ref: Zelle confirmation #, check # |
| source | text | How discovered: zelle_sms, manual, bank_feed |
| source_metadata | jsonb | Raw data: iMessage ROWID, QB txn id |

Dedup index on `(work_order_id, amount, payment_method, sender_name, payment_date)`.

### labor_operations
Mitchell-style flat rate book. 64 operations across body, paint, mechanical, exhaust, etc.

| Column | Type | Purpose |
|--------|------|---------|
| code | text PK | e.g., MECH-BRAKES-REAR, EXH-CUSTOM-FAB |
| name | text | Human name |
| base_hours | numeric | Standard book hours |
| system | text | Vehicle system: body, paint, mechanical, exhaust, etc. |
| model_year_min/max | int | Applicability range |

### user_labor_rates
Per-technician hourly rates. Priority 2 in `resolve_labor_rate()` cascade.

### work_contracts
Client-org negotiated rate agreements. Priority 1 in `resolve_labor_rate()` cascade. Vehicle-specific contracts override general ones.

## Rate Resolution Cascade

`resolve_labor_rate(org, user, vehicle, client)` returns `{rate, source}`:

1. **Contract rate** (priority 1): `work_contracts` where client+org match, vehicle-specific first
2. **User rate** (priority 2): `user_labor_rates` where user matches and is_active
3. **Organization rate** (priority 3): `businesses.labor_rate` for the org
4. **System default** (priority 4): $125/hr market average

## Comp Tracking

Parts and labor can be marked `is_comped = true`. When comped:
- `comp_retail_value` tracks what it would have cost
- `comp_reason` explains why (goodwill, warranty, error correction)
- Comped items are excluded from invoice totals
- Total comped value is reported separately (goodwill tracking)

## Scripts

All scripts live in `mcp-servers/nuke-context/` and share `lib/env.mjs` for environment loading.

| Script | npm | Purpose |
|--------|-----|---------|
| resolve.mjs | `wo:resolve` | Full build status report. RPC primary, client-side fallback, iMessage enrichment |
| balance.mjs | `wo:balance` | Itemized balance for one work order or vehicle |
| ingest-zelle.mjs | `wo:ingest-zelle` | Parse Zelle SMS from chat.db -> work_order_payments |
| ingest-receipts.mjs | `wo:ingest-receipts` | Amazon/Summit receipts -> work_order_parts |
| ingest-thread.mjs | `wo:ingest-thread` | iMessage thread -> vehicle_observations |

## Migrations

| Migration | Phase | Purpose |
|-----------|-------|---------|
| `20260327100000_work_order_intelligence_schema.sql` | Schema | Tables, columns, constraints, RLS |
| `20260327100001_work_order_intelligence_seed.sql` | Seed | 64 labor operations |
| `20260327100002_work_order_receipt_view.sql` | View | `work_order_receipt_unified` + `work_order_balance()` |
| `20260327100003_resolve_work_order_status.sql` | RPC | The product function |
