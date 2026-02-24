# Multi-Organization Attribution & Revenue System

## 🎯 **Core Principle: Follow the Work Order**

**WHO CREATED THE WORK ORDER = WHO GETS THE REVENUE**

- Viva creates work order → Viva originated → Viva's chiffre d'affaires
- Ernie creates work order → Ernie originated → Ernie's chiffre d'affaires
- Collaborators tracked separately for portfolio/relationships

---

## ✅ **IMPLEMENTED**

### **1. Database Tables**

#### **`work_order_collaborators`** - Multi-org attribution
```sql
- timeline_event_id (which work order)
- organization_id (which org)
- role: originator | location | performer | parts_supplier | subcontractor | collaborator
- revenue_attribution (dollar amount)
- revenue_percentage (0-100%)
- attribution_source: work_order | gps | receipt | user_input | ai_vision
- confidence (0.0-1.0 for AI)
```

**Roles:**
- **originator**: Who created/sold the work order (gets revenue in accounting)
- **location**: Where work was performed (hosting, like Viva)
- **performer**: Who did the actual work (like Ernie's)
- **parts_supplier**: Who provided parts
- **subcontractor**: Specialist brought in
- **collaborator**: General collaboration

### **2. Auto-Attribution System**

**Trigger on `business_timeline_events`:**
- When event created with `cost_amount > 0`
- Auto-creates collaborator record:
  - `organization_id = business_id` (originator)
  - `role = 'originator'`
  - `revenue_attribution = cost_amount`
  - `attribution_source = 'work_order'`

### **3. Revenue Calculation Functions**

**`get_organization_revenue(org_id, start_date, end_date)`**
Returns:
- `total_revenue`: Sum of revenue_attribution where role='originator'
- `work_order_count`: Number of work orders originated
- `avg_order_value`: Average order value

**`get_organization_collaborations(org_id)`**
Returns all work orders where org was collaborator (not originator)

**`organization_revenue_summary` VIEW**
Per-org dashboard showing:
- work_orders_originated
- total_revenue
- work_performed (as performer)
- work_hosted (as location)
- collaborations

### **4. Work Order Viewer Integration**

**Overview Tab** now shows:
```
Work Order Attribution
├─ Viva! Las Vegas Autos
│  └─ Work Order Originator • $5,000 (100%)
├─ Ernie's Upholstery
│  └─ Work Performed By
└─ Another Shop
   └─ Location / Host
```

Clickable org names → navigate to profile

---

## 🚧 **How It Works in Practice**

### **Example 1: Viva Originates, Ernie Performs**

**Scenario:**
- Customer comes to Viva for Bronco upholstery
- Viva writes work order for $5,000
- Viva hires Ernie's (subcontractor) at discounted rate $4,000
- Work done at Viva's location

**Data:**
```
timeline_event:
  business_id: Viva
  cost_amount: $5,000
  
work_order_collaborators:
  1. Viva (originator, $5,000, 100%, work_order)
  2. Ernie's (performer, null, null, receipt) 
  3. Viva (location, null, null, gps)
```

**Accounting:**
- Viva's Revenue (chiffre d'affaires): **$5,000**
- Viva's COGS: $4,000 (paid to Ernie's)
- Viva's Profit: $1,000
- Ernie's shows up in "Collaborations" (portfolio credit)

### **Example 2: Ernie Originates, Works at Viva**

**Scenario:**
- Customer goes directly to Ernie's
- Ernie writes work order for $4,500
- Ernie works at Viva's shop (rents space)
- Viva gets facility fee (handled in Ernie's accounting)

**Data:**
```
timeline_event:
  business_id: Ernie's
  cost_amount: $4,500
  
work_order_collaborators:
  1. Ernie's (originator, $4,500, 100%, work_order)
  2. Viva (location, null, null, gps)
```

**Accounting:**
- Ernie's Revenue: **$4,500**
- Ernie's Expenses: Rent paid to Viva (separate accounting)
- Viva's shows up in "Work Hosted" (portfolio credit)

---

## 📊 **Revenue Attribution Sources**

**Priority Order:**

1. **`work_order`** (Highest confidence: 1.0)
   - From `work_orders` table
   - Explicit originator_organization_id
   - This is ground truth

2. **`receipt`** (Confidence: 0.9)
   - Receipt header shows billing entity
   - "Invoice from: Ernie's Upholstery" → Ernie originated
   - OCR + AI parsing

3. **`user_input`** (Confidence: 0.8-1.0)
   - User manually selects "Who did this work?"
   - Verified users get higher confidence

4. **`gps`** (Confidence: 0.7)
   - Images at Viva's GPS → Viva is location
   - But doesn't determine originator

5. **`ai_vision`** (Confidence: 0.6)
   - AI sees "Ernie's Upholstery" signage in photos
   - Suggests performer

6. **`relationship`** (Confidence: 0.5)
   - Inferred from org relationships
   - "Ernie's often works with Viva"

---

## 🎯 **Viva! Las Vegas Autos - Current Status**

### **Auto-Linked:**
✅ **3 vehicles** connected via GPS
✅ **201 images** at location
✅ Timeline events created for all photo batches

**Vehicles:**
- 1977 Chevrolet K5: 71 photos
- 1974 Ford Bronco: 124 photos
- 1965 Chevrolet Corvette: 6 photos

**View:** https://nuke.ag/org/c433d27e-2159-4f8c-b4ae-32a5e44a77cf

### **Next Steps:**
1. When Viva creates formal work orders → Auto-assigns as originator
2. When receipts uploaded → Parse to find performer
3. GPS + Receipt → Complete attribution chain

---

## 🛠 **For Standard Accounting Integration**

### **Revenue (Chiffre d'Affaires)**
```sql
SELECT 
  business_name,
  SUM(revenue_attribution) as total_revenue
FROM work_order_collaborators woc
JOIN businesses b ON b.id = woc.organization_id
WHERE role = 'originator'
  AND event_date BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY business_name;
```

### **COGS (Cost of Goods Sold)**
Separate table or use `work_order_labor` + `work_order_parts` where `added_by != originator`

### **Profit Margin**
```
Revenue - (Labor COGS + Parts COGS) = Gross Profit
```

---

## 🚀 **What's Live Now**

✅ Work Order Viewer shows collaborators
✅ Viva profile has 201 images from 3 vehicles
✅ Heatmap populated with all activity
✅ Images display in swipeable gallery
✅ Bookmark system functional
✅ Zero emojis

**Test:** Click any green day on Viva's heatmap → See photos!

**Bundle:** `Cs5_0790`

