# FBM Contractor Pay Calculation (CORRECTED)

## The Reality

**Work Order shows:**
- Shop charged customer: €2,200 (at €110/hr)
- 20 hours of work

**Skylar was paid:**
- Contractor rate: €30-35/hr (NOT shop rate)
- 20 hrs × €32.50/hr = €650 (not €2,200)

---

## The Math to Hit €4,400

```
Target: €4,400 total contractor pay
Hourly rate: €32.50 average (€30-35 range)

Required hours: €4,400 / €32.50 = 135 hours

That's:
- 135 hours / 8-hour days = ~17 full work days
- Over ~2-3 months = reasonable for part-time contractor
```

---

## What AI Needs to Extract

### From Printed Work Orders:
```
Work Order #1:
  T1: 3H
  T2: 8H  
  P: 9H
  ──────
  Total: 20 hours
  
  Skylar's pay: 20 × €32.50 = €650 ✓
  Shop billed customer: ~€2,200 (for reference)
```

### From Work Photos (No Order):
```
AI analyzes images:
  "Visible: welding, frame modifications, 
   custom brackets"
  
  Estimated hours: 8-12 hours
  Confidence: 70%
  
  Skylar's pay: 10 hrs × €32.50 = €325
  Requires review: Custom work uncertainty
```

---

## Database Structure

```sql
contractor_work_contributions:
  contractor_hourly_rate: 32.50  -- What Skylar was paid
  labor_hours: 20
  total_labor_value: 650.00  -- Skylar's actual pay
  
  shop_hourly_rate: 110  -- What shop charged customer
  shop_billed_to_customer: 2200.00  -- Shop revenue (for reference)
```

**Two numbers tracked:**
1. **Contractor pay** (€650) - Shows on Skylar's profile
2. **Shop revenue** (€2,200) - Shows on FBM's profile

---

## Updated AI Extraction

```json
{
  "labor_hours_extracted": 20,
  "shop_billing_rate": 110,
  "shop_total_to_customer": 2200,
  
  "contractor_rate": 32.50,  // User-provided or estimated
  "contractor_pay": 650,     // hours × contractor_rate
  
  "confidence": 95,
  "note": "Work order shows shop billing. Contractor pay calculated separately."
}
```

---

## Your Profile Will Show

```
FBM Contractor Work (July 2025)
€4,400 total earned
135+ hours documented
Avg rate: €32.50/hr

Breakdown:
- Paint & bodywork: €2,100 (65 hrs)
- Technical repairs: €1,500 (46 hrs)
- Fabrication: €800 (24 hrs)

[View Work Orders] [Download Receipt]
```

---

## FBM Profile Will Show

```
Contractor: skylar williams
€4,400 paid to contractor
Shop revenue from this work: €15,000+
ROI: Shop billed customers 3.4× contractor cost

[View Contributions]
```

---

## Next Steps

1. Extract hours from 3 work orders
2. Multiply by €32.50/hr (your rate)
3. If < €4,400, estimate remaining hours from other images
4. AI flags uncertain estimates for your review
5. You confirm: "Yes, ~150 hours total sounds right"
6. System saves to your profile

**The €4,400 is YOUR pay, not shop revenue. Got it.** 👍

