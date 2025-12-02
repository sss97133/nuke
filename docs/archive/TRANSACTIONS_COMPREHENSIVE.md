# Vehicle Financial Transactions - Comprehensive Documentation

## Overview

The Nuke platform treats **every financial action** as a transaction - the atomic unit of vehicle financial history. Transactions create the authoritative audit trail for:

1. **Vehicle Value Accumulation** - Show how every dollar spent builds value
2. **User Contribution Credibility** - Demonstrate user's expertise through transaction history
3. **Tax Optimization** - Track deductible expenses and business costs
4. **Comparative Analysis** - Understand cost patterns across vehicles and builders
5. **Financial Intelligence** - Build predictive models on labor, parts, and vendor relationships

---

## Transaction Philosophy

### Core Principle: Single Source of Truth

Every transaction in the system serves **dual purposes**:

```
One Transaction Entry
    ├─ Vehicle Timeline (shows build history)
    └─ User Contributions (shows expertise)
```

This mirrors the [[memory:9938122]] duality principle: vehicle gains validation through documented history, users gain credibility through contributions. **Never create separate entries or derive data** - the transaction record is both the timeline event AND the contribution proof.

### What Counts as a Transaction?

**Financial Events**:
- ✅ Parts purchased (w/ receipt)
- ✅ Labor performed (with invoice)
- ✅ Services (inspection, shipping, storage)
- ✅ Vehicle registration/insurance
- ✅ Tools acquired for work
- ✅ Vendor payments
- ✅ Professional services

**NOT Transactions** (these go in timeline events):
- ❌ Work completed but no cost
- ❌ Milestones/achievements
- ❌ Photos/documentation
- ❌ Chat/comments

**Grey Area** (treat as transactions if documented):
- ⚠️ Owner's labor (if tracking hours)
- ⚠️ Barter/trade (record at fair market value)
- ⚠️ Donations/gifts (record at estimated value)

---

## Transaction Structure

### Core Fields

```typescript
{
  // Identification
  id: UUID,
  vehicle_id: UUID,              // Which vehicle
  user_id: UUID,                 // Who recorded it
  timeline_event_id: UUID,       // Link to timeline (optional)
  
  // Classification
  transaction_type: Enum,        // 'purchase' | 'sale' | 'improvement' | 'maintenance' | ...
  category: Enum,                // 'engine' | 'transmission' | 'paint' | ...
  subcategory?: string,          // Free text for specificity
  description: string,           // What exactly was done
  
  // Financial Details
  amount: Decimal,               // Total cost (USD)
  currency: string = "USD",      // Support for foreign purchases
  payment_method: Enum,          // 'cash' | 'check' | 'credit_card' | 'financing' | ...
  
  // Timing
  transaction_date: Date,        // When did work happen
  recorded_date: Date,           // When was it logged (audit)
  
  // Breakdown (optional but recommended)
  parts_cost: Decimal,           // Parts only
  labor_cost: Decimal,           // Labor only
  labor_hours: Decimal,          // Hours worked
  shop_rate_per_hour: Decimal,   // What shop charged
  
  // Vendor Information
  vendor_name: string,           // Where it came from
  vendor_location: string,       // City, state
  vendor_contact: string,        // Phone/email for follow-up
  
  // Documentation
  receipt_url: string,           // Photo of receipt
  invoice_number: string,        // For reference
  reference_number: string,      // Tracking #, etc
  
  // Tax Information
  tax_deductible: boolean,       // Can be deducted
  business_expense: boolean,     // Business vs personal
  tax_category: string,          // For tax software
  
  // Vehicle State
  mileage_at_transaction: int,   // Odometer reading
  vehicle_condition_before: string,  // Photos/assessment
  vehicle_condition_after: string,   // After work
  
  // Metadata & Notes
  metadata: Object,              // Custom fields
  notes: string,                 // Free text notes
  
  // Timestamps
  created_at: ISO8601,
  updated_at: ISO8601
}
```

### Required vs Optional

**MUST HAVE**:
- `vehicle_id` - What vehicle is this for
- `transaction_type` - Classification
- `category` - Expense category
- `description` - What was it
- `transaction_date` - When it happened
- `amount` - How much
- `user_id` - Who recorded it

**SHOULD HAVE** (best practices):
- `receipt_url` - Proof of transaction
- `vendor_name` - Where it came from
- `labor_hours` - If it's labor
- `parts_cost + labor_cost` - Breakdown for clarity

**NICE TO HAVE**:
- `tax_deductible` - For tax planning
- `mileage_at_transaction` - Timeline context
- `metadata` - Custom attributes

---

## Transaction Types & Categories

### Transaction Types (Primary Classification)

```typescript
enum TransactionType {
  PURCHASE = "purchase",                // Buy parts/supplies
  SALE = "sale",                        // Sell vehicle/parts
  IMPROVEMENT = "improvement",          // Build work
  MAINTENANCE = "maintenance",          // Regular upkeep
  REPAIR = "repair",                    // Fix something broken
  REGISTRATION = "registration",        // Reg/title fees
  INSURANCE = "insurance",              // Annual insurance
  INSPECTION = "inspection",            // Inspection fees
  STORAGE = "storage",                  // Storage costs
  TRANSPORT = "transport",              // Shipping/trailering
  TOOLS = "tools",                      // Tools purchased
  DOCUMENTATION = "documentation",      // Title, receipts, etc
  PROFESSIONAL_SERVICES = "professional_services",  // Dyno, alignment, etc
  SALE_EXPENSE = "sale_expense"         // Costs to sell (commission, etc)
}
```

### Expense Categories (Detailed)

**Mechanical Systems**:
- `engine` - Engine work
- `transmission` - Transmission/drivetrain
- `drivetrain` - Driveline, differential
- `suspension` - Suspension components
- `brakes` - Brake system
- `steering` - Steering system
- `electrical` - Wiring, lights, charging
- `cooling` - Radiator, fans, heater
- `fuel_system` - Fuel pump, lines, tank
- `exhaust` - Muffler, headers, catalytic

**Body & Aesthetics**:
- `body_work` - Welding, panels, structure
- `paint` - Paint, primer, coating
- `interior` - Upholstery, dash, trim
- `glass` - Windows, windshield
- `trim` - Chrome, moldings, weatherstrip
- `wheels_tires` - Wheels, tires, suspension

**Maintenance & Service**:
- `oil_change` - Oil and filter changes
- `tune_up` - Spark plugs, points, timing
- `fluid_service` - Transmission, coolant, etc
- `filters` - Air, cabin, fuel filters
- `belts_hoses` - Serpentine, radiator hoses

**Administrative & Legal**:
- `registration` - Vehicle registration
- `title` - Title processing/transfer
- `insurance` - Insurance premiums
- `inspection` - Safety/emissions inspection
- `storage` - Storage facility fees
- `transportation` - Shipping, trailering
- `documentation` - Receipts, manuals, paperwork
- `legal` - Legal services, disputes
- `professional_services` - Dyno, alignment, appraisal

**Tools & Equipment**:
- `tools` - Hand tools, air tools, diagnostic tools
- `equipment` - Equipment rental
- `shop_supplies` - Supplies, consumables

**Other**:
- `miscellaneous` - Doesn't fit elsewhere

---

## Payment Methods

```typescript
enum PaymentMethod {
  CASH = "cash",
  CHECK = "check",
  DEBIT_CARD = "debit_card",
  CREDIT_CARD = "credit_card",
  FINANCING = "financing",              // Loan/payment plan
  TRADE = "trade",                      // Traded parts/vehicle
  BARTER = "barter",                    // Skill exchange
  OTHER = "other"
}
```

---

## Audit Trail & Verification

### Recording vs Verification

**Recording** = User logs transaction
- User submits transaction data
- Receipt photo uploaded
- Gets `recorded_date: now()`
- Not yet verified

**Verification** = Platform confirms legitimacy
- Check receipt matches amount/date
- Validate vendor information
- Cross-check with similar transactions
- Build reputation score

### Data Integrity Rules

```sql
-- Financial transactions must be immutable after 72 hours
-- (allows correction window, then locked)

-- Once locked:
-- - User can NOT edit amounts, dates, category
-- - User CAN add notes, documentation
-- - Audit log tracks all changes

-- If correcting old transaction:
-- - Create NEW transaction with offset amount
-- - Link both with metadata.related_transaction_id
-- - Example: Originally logged $500, should be $450
--   → Create new transaction for -$50 (adjustment)
```

### Audit Fields (System-Managed)

```typescript
{
  id: UUID,                       // Immutable identifier
  vehicle_id: UUID,
  created_at: ISO8601,            // When first entered
  created_by: UUID,               // Who entered it
  updated_at: ISO8601,            // Last modification time
  updated_by: UUID,               // Who modified it
  locked_at: ISO8601,             // When locked (after 72h)
  verified_at?: ISO8601,          // When verified by platform
  verified_by?: UUID,             // Admin/bot who verified
  
  // Audit metadata
  metadata: {
    edit_history: [                // Track all changes
      {
        changed_at: ISO8601,
        changed_by: UUID,
        changes: { field: [old, new] }
      }
    ],
    related_transactions: [UUID],  // Linked transactions
    correction_of: UUID,           // If this corrects another
    manual_override: boolean       // If admin force-verified
  }
}
```

---

## Integration with Vehicle Timeline

### The Duality Pattern

```
User Action: "Took truck to shop for new transmission"

Creates:
├─ Timeline Event
│  ├── type: "maintenance_completed"
│  ├── vehicle_id: <vehicle>
│  ├── description: "Transmission replacement"
│  ├── date: 2025-01-15
│  └── metadata: { transaction_id: <tx> }
│
└─ Financial Transaction
   ├── transaction_type: "repair"
   ├── category: "transmission"
   ├── amount: 2500
   ├── vendor_name: "Transmission World"
   ├── receipt_url: "..."
   └── labor_hours: 6
```

### Query Pattern: What's changed on this vehicle?

```sql
-- Get vehicle timeline (shows what happened)
SELECT * FROM timeline_events 
WHERE vehicle_id = ?
ORDER BY date DESC;

-- Get financial impact (shows cost of changes)
SELECT * FROM vehicle_financial_transactions
WHERE vehicle_id = ?
ORDER BY transaction_date DESC;

-- Get combined view (ordered by date)
SELECT 
  t.date,
  t.type,
  t.description,
  tx.amount,
  tx.category
FROM timeline_events t
FULL OUTER JOIN vehicle_financial_transactions tx
  ON t.id = tx.timeline_event_id
WHERE t.vehicle_id = ?
ORDER BY t.date DESC;
```

---

## Value Accumulation: Building the Numbers

### Total Cost of Ownership (TCO)

```typescript
interface VehicleFinancialSummary {
  // Acquisition
  purchase_price: Decimal;
  title_transfer_cost: Decimal;
  initial_setup: Decimal;
  
  // Improvements (value-add)
  improvements_total: Decimal;
  improvements_parts: Decimal;
  improvements_labor: Decimal;
  
  // Maintenance (keep running)
  maintenance_total: Decimal;
  maintenance_frequency: string;  // "quarterly", "as-needed"
  
  // Operational (to own it)
  registration_annual: Decimal;
  insurance_annual: Decimal;
  storage_monthly: Decimal;
  
  // Total Invested
  total_invested: Decimal;
  
  // Value Indicators
  estimated_market_value: Decimal;
  community_valuation: Decimal;
  
  // ROI
  realized_gain: Decimal,           // If sold
  unrealized_gain: Decimal,         // Current position
  roi_percent: Decimal
}
```

### Example: 1977 K5 Blazer Build

```
Purchase:                           $12,000
  └─ Title transfer:               ($150)

Improvements (Year 1):
  ├─ Engine rebuild
  │  ├─ Parts cost:        $3,200 (pistons, bearings, gaskets)
  │  └─ Labor:     $1,500 (20 hours @ $75/hr)
  ├─ Paint:               $4,000 (professional job)
  ├─ Interior:            $1,200 (upholstery)
  └─ New suspension:      $800 (springs, shocks)
  SUBTOTAL:              $10,700

Maintenance:
  ├─ Oil changes (4x):    $100
  ├─ Fluid services:      $150
  └─ Misc parts:          $250
  SUBTOTAL:               $500

Administrative:
  ├─ Registration:        $150
  ├─ Insurance (annual):  $300
  └─ Storage (12 months): $1,200
  SUBTOTAL:               $1,650

TOTAL INVESTED:           $24,850

VALUE INDICATORS:
  Market value (KBB):     $18,000
  Community avg (similar): $22,000
  This build's appeal:    $26,000 (conservative)
  
UNREALIZED GAIN:          +$1,150 (4.6% ROI)
```

**NOTE**: Negative ROI doesn't mean bad! The vehicle is:
- ✅ Finished and driveable
- ✅ Well-documented (trust multiplier)
- ✅ Transparent history (attracts buyers)
- ✅ Owner gets joy/use (non-financial value)

---

## User Contribution Scoring

### Credibility Through Transactions

Every transaction a user records builds credibility:

```typescript
interface UserContributionMetrics {
  total_transactions: int,
  total_amount_documented: Decimal,
  transactions_by_category: Map<string, int>,
  average_transaction_cost: Decimal,
  
  // Verification signals
  receipts_provided: int,
  receipts_percentage: Decimal,
  vendor_diversity: int,           // How many different vendors
  
  // Quality signals
  labor_hours_tracked: Decimal,
  specialization: string,          // "engine work", "paint", etc
  documentation_quality: "poor" | "fair" | "good" | "excellent",
  
  // Reputation
  community_votes_helpful: int,
  verified_vendor_relationships: int,
  repeat_vendor_mentions: int,    // Trusted vendors
  
  // Score
  credibility_score: 0-100,
  badge: "contributor" | "specialist" | "trusted" | "expert"
}
```

### Example: User "BuilderBob"

```
User: bob_builds
Registered: Jan 2024

Transactions: 47 total
├─ Total documented: $34,500
├─ Average per transaction: $734
└─ Categories:
   ├─ Engine work: 12 ($8,900)
   ├─ Electrical: 8 ($2,100)
   ├─ Suspension: 9 ($3,200)
   └─ Paint: 6 ($4,500)
   └─ Other: 12 ($15,800)

Documentation Quality:
├─ 42/47 with receipts (89%)
├─ 8 different vendors (trusted)
└─ Average notes per tx: 3 sentences

Reputation:
├─ Community upvotes: 287
├─ Specialist in: Engine rebuilds
└─ Trusted by: 23 investors

Credibility Score: 87/100
Badge: TRUSTED EXPERT ⭐
```

---

## Querying & Reporting

### Common Queries

#### What's the cost breakdown on this vehicle?

```sql
SELECT 
  category,
  COUNT(*) as transactions,
  SUM(amount) as total_cost,
  SUM(CASE WHEN parts_cost > 0 THEN parts_cost ELSE 0 END) as parts,
  SUM(CASE WHEN labor_cost > 0 THEN labor_cost ELSE 0 END) as labor,
  ROUND(100.0 * SUM(amount) / (SELECT SUM(amount) FROM vehicle_financial_transactions WHERE vehicle_id = ?), 1) as percent_of_total
FROM vehicle_financial_transactions
WHERE vehicle_id = ?
GROUP BY category
ORDER BY total_cost DESC;
```

#### What's my labor value contribution?

```sql
SELECT 
  SUM(labor_hours) as total_hours,
  SUM(labor_cost) as total_labor_value,
  ROUND(SUM(labor_cost) / NULLIF(SUM(labor_hours), 0), 2) as avg_hourly_rate,
  COUNT(*) as transactions
FROM vehicle_financial_transactions
WHERE recorded_by = ?
AND labor_hours > 0;
```

#### Which vendors do I trust most?

```sql
SELECT 
  vendor_name,
  COUNT(*) as transactions,
  SUM(amount) as total_spent,
  ROUND(AVG(amount), 2) as avg_cost,
  COUNT(CASE WHEN tax_deductible THEN 1 END) as deductible_count
FROM vehicle_financial_transactions
WHERE recorded_by = ?
GROUP BY vendor_name
ORDER BY total_spent DESC
LIMIT 20;
```

#### Tax deduction report

```sql
SELECT 
  tax_category,
  category,
  COUNT(*) as count,
  SUM(amount) as deductible_amount,
  ARRAY_AGG(DISTINCT vehicle_id) as vehicles_affected
FROM vehicle_financial_transactions
WHERE tax_deductible = true
AND recorded_by = ?
AND transaction_date >= '2024-01-01'
GROUP BY tax_category, category
ORDER BY deductible_amount DESC;
```

---

## Future: AI-Powered Intelligence

### Planned Features

**1. Vendor Intelligence**:
- Learn: "When you buy from Tool.com, parts usually cost $X"
- Alert: "This suspension quote seems high" (vs. your history)
- Recommend: "FastPhysics does great engine work, try them"

**2. Predictive Costing**:
- Learn labor patterns: "Engine builds take ~20 hours on squarecar"
- Predict: "Budget ~$3,200 in labor for transmission replacement"
- Compare: "Your shop's rate is 15% above market average"

**3. Build Patterns**:
- Learn: "Quality builds typically spend $X on paint"
- Identify: "This vehicle is underinvested in suspension"
- Recommend: "Similar vehicles spent more on interior - might attract buyers"

**4. Market Alignment**:
- Compare: "Your build spent 35% on mechanical, 15% paint"
- Market avg: "Winners spend 40% mechanical, 20% paint"
- Insight: "Consider finishing the paint work to maximize value"

---

## Schema Implementation

See `supabase/migrations/` for:
- `vehicle_financial_transactions.sql` - Table definition
- `transaction_audit.sql` - Audit logging
- `transaction_statistics.sql` - Materialized views
