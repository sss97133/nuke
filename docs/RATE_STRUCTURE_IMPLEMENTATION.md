# Rate Structure & Contract System - IMPLEMENTED ✅

**Deployment Date**: November 22, 2025  
**Status**: ✅ Live in Production  
**Foundation**: Early-stage, designed for expansion  

---

## 🎯 Rate Hierarchy (Priority Order)

```
1. CONTRACT RATE (highest priority)
   ├─ Agreed between specific parties
   ├─ Can be client-specific
   ├─ Can be vehicle-specific
   └─ Overrides all other rates

2. USER LABOR RATE (technician-level)
   ├─ Set by individual technician
   ├─ Based on skill level/certifications
   └─ Falls back if no contract exists

3. SHOP RATE (org-level)
   ├─ Standard shop hourly rate
   ├─ Set by business/organization
   └─ From businesses.labor_rate column

4. SYSTEM DEFAULT ($50/hr)
   └─ Fallback if nothing else is set
```

---

## 📊 Rate Structure Tables

### **1. Shop Fee Settings** (`shop_fee_settings`)
Org-level fees and markup percentages.

```sql
{
  business_id: UUID,
  
  -- Shop fees
  shop_fee_type: 'flat' | 'percentage' | 'tiered' | 'none',
  shop_fee_amount: 25.00,
  shop_fee_description: 'Shop fee',
  
  -- Additional fees (customizable)
  additional_fees: [
    { name: 'Environmental Fee', amount: 5.00, type: 'flat' },
    { name: 'Hazmat Disposal', rate: 2.5, type: 'percentage' },
    { name: 'Equipment Fee', amount: 10.00, type: 'flat' }
  ],
  
  -- Markup percentages
  overhead_percentage: 15.0,      // % markup on labor
  parts_markup_percentage: 30.0,  // % markup on parts
  
  -- Payment defaults
  default_payment_terms: 'Due on completion',
  requires_deposit: true,
  deposit_percentage: 50.0
}
```

### **2. User Labor Rates** (`user_labor_rates`)
Individual technician rates.

```sql
{
  user_id: UUID,
  hourly_rate: 75.00,
  rate_type: 'master',  // 'standard', 'skilled', 'master', 'specialty'
  
  skill_level: 'ASE Master Certified',
  certifications: ['ASE Master', 'GM Certified', 'Welding Certified'],
  specialties: ['engine_rebuild', 'electrical_diagnostics', 'fabrication'],
  work_categories: ['engine', 'transmission', 'electrical'],
  
  effective_date: '2025-01-01',
  is_active: true
}
```

### **3. Work Contracts** (`work_contracts`)
Agreements between parties defining custom rates and terms.

```sql
{
  client_id: UUID,
  business_id: UUID,
  technician_id: UUID,
  vehicle_id: UUID,  // Can be vehicle-specific
  
  contract_type: 'one_time',  // 'ongoing', 'project_based', 'retainer', 'warranty_work', 'insurance_claim'
  
  -- Agreed rates (overrides defaults)
  agreed_labor_rate: 65.00,      // Special rate for this client
  agreed_shop_rate: 20.00,
  agreed_parts_markup: 25.0,
  
  -- Special pricing
  fixed_price: 5000.00,          // If flat-rate job
  hourly_cap: 40.0,              // Max hours before approval
  budget_cap: 10000.00,          // Max cost
  
  -- Fees
  waived_fees: ['shop_fee', 'environmental_fee'],  // Waive specific fees
  custom_fees: [
    { name: 'Project Management Fee', amount: 500.00, type: 'flat' }
  ],
  
  -- Payment terms
  payment_terms: 'Net 30',
  payment_schedule: '50/50',     // 50% upfront, 50% on completion
  deposit_required: true,
  deposit_amount: 2500.00,
  
  -- Scope
  included_services: ['parts', 'labor', 'paint', 'assembly'],
  excluded_services: ['chrome_plating', 'upholstery'],
  
  -- Timeline
  start_date: '2025-11-01',
  end_date: '2026-12-31',
  status: 'active'
}
```

---

## 🔧 How It Works

### **Example 1: Oil Change (No Contract)**

```sql
-- Event created
event_id = 'abc-123'
technician_id = 'tech-456'
client_id = 'client-789'

-- Get applicable rate
SELECT get_applicable_labor_rate(
  'abc-123',     -- event_id
  'tech-456',    -- technician_id
  'shop-999',    -- business_id
  'client-789'   -- client_id
);

-- Returns:
{
  "labor_rate": 75.00,         // From user_labor_rates
  "shop_rate": null,
  "parts_markup": 30.0,        // From shop_fee_settings
  "source": "user_default",
  "user_rate": 75.00,
  "shop_rate": 85.00
}

-- Calculate fees
SELECT calculate_shop_fees(
  'shop-999',    -- business_id
  null,          -- contract_id (none)
  200.00         -- subtotal
);

-- Returns:
{
  "fees": [
    {"name": "Shop fee", "type": "flat", "amount": 25.00},
    {"name": "Environmental Fee", "type": "flat", "amount": 5.00},
    {"name": "Disposal Fee", "type": "percentage", "rate": 2.5, "amount": 5.00}
  ],
  "total": 35.00
}

-- Final TCI:
Labor:        $187.50  (2.5hrs @ $75/hr)
Parts:        $45.00
Supplies:     $5.00
Shop Fees:    $35.00
─────────────────────
TOTAL:        $272.50
Customer:     $350.00
Profit:       $77.50 (22.1%)
```

### **Example 2: Restoration Project (With Contract)**

```sql
-- Contract exists
contract_id = 'contract-abc'
client_id = 'client-789'
agreed_labor_rate = 65.00  // Discounted rate for this client
waived_fees = ['shop_fee'] // Shop fee waived

-- Get applicable rate
{
  "labor_rate": 65.00,         // From contract!
  "source": "contract",
  "contract_rate": 65.00,
  "user_rate": 75.00,          // User's normal rate (not used)
  "shop_rate": 85.00           // Shop's normal rate (not used)
}

-- Calculate fees (shop_fee waived)
{
  "fees": [
    {"name": "Environmental Fee", "type": "flat", "amount": 5.00},
    {"name": "Project Management Fee", "type": "flat", "amount": 500.00}
  ],
  "total": 505.00
}

-- Final TCI:
Labor:        $2,600.00  (40hrs @ $65/hr contract rate)
Parts:        $5,420.00
Supplies:     $250.00
Shop Fees:    $505.00 (shop_fee waived, custom project fee added)
─────────────────────
TOTAL:        $8,775.00
Fixed Price:  $10,000.00 (from contract)
Profit:       $1,225.00 (12.25%)
```

### **Example 3: Insurance Claim**

```sql
-- Insurance contract
contract_type = 'insurance_claim'
agreed_labor_rate = 95.00  // Insurance-approved rate
payment_terms = 'Insurance pays 80%, customer pays 20%'

-- Fees structure
{
  "fees": [
    {"name": "Shop fee", "type": "percentage", "rate": 10.0, "amount": 150.00},
    {"name": "Documentation Fee", "type": "flat", "amount": 75.00}
  ],
  "total": 225.00
}

-- Payment split:
Total Cost:     $1,725.00
Insurance:      $1,380.00 (80%)
Customer:       $345.00 (20%)
```

---

## 💡 Key Features

### ✅ **Flexible Rate Structure**
- Contract rates override all others
- User rates for skilled technicians
- Shop rates as fallback
- System default if nothing set

### ✅ **Customizable Fees**
- Flat fees ($5.00)
- Percentage fees (2.5%)
- Tiered fees (future)
- Per-shop customization

### ✅ **Contract-Based Pricing**
- Client-specific rates
- Vehicle-specific rates
- Project-based pricing
- Fee waivers
- Custom fee structures

### ✅ **Payment Flexibility**
- Fixed-price contracts
- Hourly with caps
- Budget caps
- Deposit requirements
- Payment schedules (50/50, Net 30, etc.)

---

## 🔍 Query Examples

### Get Rate for an Event
```sql
SELECT get_applicable_labor_rate(
  event_id,
  technician_id,
  business_id,
  client_id
);
```

### Calculate Shop Fees
```sql
SELECT calculate_shop_fees(
  business_id,
  contract_id,
  subtotal
);
```

### Complete TCI with Rates & Fees
```sql
SELECT calculate_event_tci_with_rates(event_id);
```

Returns:
```json
{
  "labor_cost": 187.50,
  "parts_cost": 45.00,
  "supplies_cost": 5.00,
  "overhead_cost": 0.00,
  "tool_cost": 8.50,
  "subtotal": 246.00,
  "shop_fees": {
    "fees": [...],
    "total": 35.00
  },
  "fees_total": 35.00,
  "total_cost": 281.00,
  "customer_price": 350.00,
  "profit_margin": 69.00,
  "profit_margin_percent": 19.7,
  "rates": {
    "labor_rate": 75.00,
    "source": "user_default",
    ...
  }
}
```

### Create a Contract
```sql
INSERT INTO work_contracts (
  client_id,
  business_id,
  contract_type,
  agreed_labor_rate,
  waived_fees,
  payment_terms,
  start_date,
  status
) VALUES (
  'client-id',
  'business-id',
  'ongoing',
  65.00,
  ARRAY['shop_fee'],
  'Net 30',
  CURRENT_DATE,
  'active'
);
```

### Set User's Labor Rate
```sql
INSERT INTO user_labor_rates (
  user_id,
  hourly_rate,
  rate_type,
  certifications,
  specialties
) VALUES (
  auth.uid(),
  75.00,
  'master',
  ARRAY['ASE Master', 'GM Certified'],
  ARRAY['engine_rebuild', 'electrical_diagnostics']
);
```

### Configure Shop Fees
```sql
INSERT INTO shop_fee_settings (
  business_id,
  shop_fee_type,
  shop_fee_amount,
  additional_fees,
  parts_markup_percentage
) VALUES (
  'business-id',
  'flat',
  25.00,
  '[
    {"name": "Environmental Fee", "amount": 5.00, "type": "flat"},
    {"name": "Hazmat Disposal", "rate": 2.5, "type": "percentage"}
  ]'::jsonb,
  30.0
);
```

---

## 🚀 Early Stage Foundation

This is the **foundational structure** designed for:

1. ✅ **Current Use**: Basic rate hierarchy and fee tracking
2. 🔜 **Near Future**: Contract management UI
3. 🔜 **Future**: Tiered pricing, dynamic rates, multi-party contracts
4. 🔜 **Future**: Automated invoicing based on contracts
5. 🔜 **Future**: Payment processing integration

The system is **flexible and extensible** - built to grow as needs evolve.

---

## 📋 Integration Points

### Timeline Events
```sql
timeline_events {
  contract_id: UUID,           // Links to work_contracts
  applied_labor_rate: 75.00,   // Rate actually used
  applied_shop_rate: 25.00,    // Shop fee actually used
  rate_source: 'user_default'  // Where the rate came from
}
```

### Financial Records
```sql
event_financial_records {
  contract_id: UUID,
  rate_source: 'contract',
  shop_fees: [...],            // Itemized fees
  total_shop_fees: 35.00       // Sum of all fees
}
```

---

## 🎯 Next Steps

1. **Frontend UI** for contract creation/management
2. **Rate history** tracking and reporting
3. **Fee templates** for common scenarios
4. **Multi-tier pricing** (standard/premium/emergency)
5. **Payment integration** (Stripe, etc.)

The foundation is in place and ready to build on! 🚀

---

Generated: November 22, 2025

