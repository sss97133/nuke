# 🛒 COMPLETE PURCHASE FLOW - Master Cylinder Example

**Scenario:** User wants to buy a new master cylinder for their 1983 GMC C1500

---

## 📱 **STEP-BY-STEP PURCHASE FLOW:**

### **Step 1: User Opens Vehicle Image (Engine Bay)**
```
Location: https://n-zero.dev/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c
User: Taps on engine bay photo (image 2 of 50)
Screen: Full-screen lightbox opens showing engine
```

### **Step 2: User Clicks Master Cylinder**
```
User: Taps on master cylinder (black circular unit, upper right)
Coordinates: ~x:75%, y:35%
System: Sends click to identify-part-at-click Edge Function
```

### **Step 3: AI Identifies Part (1-2 seconds)**
```
Backend Processing:
1. Receives image URL + coordinates (75%, 35%)
2. Calls OpenAI GPT-4o Vision API
3. Prompt: "What automotive part is at 75%, 35% on this image?"
4. AI responds: "Master Cylinder (brake system component)"
5. System extracts: part_name = "Master Cylinder"
```

### **Step 4: Catalog Lookup (Automatic)**
```
Backend Processing:
1. Searches part_catalog for "Master Cylinder"
2. Filters by vehicle: 1983 GMC (year range 1973-1987)
3. If found in catalog:
   - Gets OEM part number (e.g., GM-MC-15643918)
   - Gets supplier pricing
4. If NOT in catalog:
   - Estimates price (~$85 for master cylinders)
   - Gets generic suppliers (RockAuto, LMC, Amazon)
```

### **Step 5: Spatial Popup Appears**
```
Screen Shows:
┌────────────────────────────────────────┐
│ Master Cylinder                        │
│ Part #GM-MC-15643918                   │
│ Fits: 1973-1987 GMC C/K Series        │
├────────────────────────────────────────┤
│ 🛒 SUPPLIERS (sorted by price)         │
│                                        │
│ ⭐ RockAuto         $72.25  5-7 days   │
│   In Stock • Ships from OH             │
│                                        │
│   LMC Truck         $85.00  3-5 days   │
│   In Stock • Ships from KS             │
│                                        │
│   Amazon            $98.50  2 days     │
│   Prime Eligible                       │
│                                        │
│ [Double-tap cheapest to order]         │
└────────────────────────────────────────┘

Popup Position: Appears right at master cylinder location
User: Can scroll through suppliers
```

### **Step 6: User Double-Taps RockAuto ($72.25)**
```
User: Double-taps "RockAuto $72.25"
System: handleSpatialOrder() fires
Frontend: Closes spatial popup
Frontend: Opens PartCheckoutModal
```

### **Step 7: Checkout Modal Appears**
```
Screen Shows:
┌─────────────────────────────────────────┐
│ CHECKOUT                                │
├─────────────────────────────────────────┤
│ Master Cylinder                         │
│ Part #GM-MC-15643918                    │
│ Fits: 1983 GMC C1500                    │
│                                         │
│ Supplier: RockAuto                      │
│ Price: $72.25                           │
│ Shipping: $8.50 (5-7 business days)    │
│ Tax: $6.50 (estimated)                  │
│ ─────────────────────────────────       │
│ Total: $87.25                           │
│                                         │
│ Ship To:                                │
│ [Skylar Williams]                       │
│ [123 Main St]                           │
│ [City, State ZIP]                       │
│                                         │
│ ┌─────────────────────────────────┐    │
│ │  [Stripe Payment Element]       │    │
│ │  Card: •••• 1234                │    │
│ │  Exp: 12/25  CVV: •••           │    │
│ └─────────────────────────────────┘    │
│                                         │
│ [ Complete Purchase ]                   │
│                                         │
│ Powered by Stripe                       │
└─────────────────────────────────────────┘
```

### **Step 8: User Enters Payment**
```
User: Taps Stripe payment field
User: Enters card: 4242 4242 4242 4242 (test)
User: Enters exp: 12/25
User: Enters CVV: 123
User: Taps "Complete Purchase"
```

### **Step 9: Payment Processing**
```
Frontend: Calls Stripe API
Stripe: Processes payment ($87.25)
Stripe: Returns payment confirmation
Frontend: Calls part_purchases INSERT
Database: Records purchase:
  {
    user_id: "...",
    vehicle_id: "a90c008a-3379-41d8-9eb2-b4eda365d74c",
    image_tag_id: "new-tag-id",
    part_name: "Master Cylinder",
    oem_part_number: "GM-MC-15643918",
    supplier_id: "rockauto-id",
    price_paid_cents: 7225,
    shipping_cost_cents: 850,
    total_cost_cents: 8725,
    order_date: "2025-10-25",
    status: "pending_shipment"
  }
```

### **Step 10: Confirmation Screen**
```
Screen Shows:
┌─────────────────────────────────────────┐
│ ✅ ORDER CONFIRMED                      │
├─────────────────────────────────────────┤
│ Master Cylinder                         │
│ $87.25 charged to card •••• 1234       │
│                                         │
│ Shipping to:                            │
│ Skylar Williams                         │
│ 123 Main St                             │
│ City, State 12345                       │
│                                         │
│ Estimated Delivery: Nov 1-3, 2025      │
│                                         │
│ Order #: RC-891274-2025                 │
│ Tracking: (Available when shipped)      │
│                                         │
│ [ View Order ] [ Track Package ]        │
└─────────────────────────────────────────┘
```

### **Step 11: Timeline Event Created (Automatic)**
```
Database: Creates timeline event
  {
    vehicle_id: "...",
    event_type: "part_ordered",
    event_date: "2025-10-25",
    description: "Ordered Master Cylinder from RockAuto",
    cost_cents: 8725,
    parts_involved: ["Master Cylinder"],
    vendor: "RockAuto",
    status: "pending"
  }

Vehicle Timeline: Now shows "Oct 25: Ordered Master Cylinder - $87.25"
```

---

## 🎯 **COMPLETE DATA FLOW:**

```
User Click (x:75%, y:35%)
      ↓
Frontend: ImageLightbox.handleImageClick()
      ↓
API Call: identify-part-at-click
      ↓
AI Vision: "Master Cylinder"
      ↓
Catalog Lookup: Part #GM-MC-15643918
      ↓
Supplier Query: 3 suppliers + pricing
      ↓
Spatial Popup: Shows results
      ↓
User Double-Tap: RockAuto $72.25
      ↓
Checkout Modal: PartCheckoutModal opens
      ↓
Stripe Payment: User enters card
      ↓
Payment Success: Charge $87.25
      ↓
Database Insert: part_purchases + timeline_event
      ↓
Confirmation: Order #RC-891274-2025
      ↓
Email: Sent to user + RockAuto
      ↓
Tracking: Updates when shipped
      ↓
Delivery: 5-7 days
```

---

## 💾 **DATABASE RECORDS CREATED:**

### **part_purchases Table:**
```sql
INSERT INTO part_purchases (
  user_id,
  vehicle_id,
  part_name,
  oem_part_number,
  supplier_id,
  price_paid_cents,
  shipping_cost_cents,
  total_cost_cents,
  order_date,
  expected_delivery,
  status,
  tracking_number
) VALUES (
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'a90c008a-3379-41d8-9eb2-b4eda365d74c',
  'Master Cylinder',
  'GM-MC-15643918',
  'rockauto-supplier-id',
  7225,
  850,
  8725,
  '2025-10-25',
  '2025-11-01',
  'pending_shipment',
  NULL
);
```

### **vehicle_timeline_events Table:**
```sql
INSERT INTO vehicle_timeline_events (
  vehicle_id,
  event_type,
  event_date,
  description,
  cost_cents,
  vendor,
  parts_involved
) VALUES (
  'a90c008a-3379-41d8-9eb2-b4eda365d74c',
  'part_ordered',
  '2025-10-25',
  'Ordered Master Cylinder from RockAuto',
  8725,
  'RockAuto',
  ARRAY['Master Cylinder']
);
```

---

## 🧪 **WHAT I CAN TEST (Without Playwright):**

<function_calls>
<invoke name="mcp_supabase_execute_sql">
<parameter name="query">-- Test the purchase flow database operations
-- Simulate ordering a master cylinder

-- Step 1: Create a test purchase record
INSERT INTO part_purchases (
  user_id,
  vehicle_id,
  part_name,
  oem_part_number,
  supplier_name,
  price_paid_cents,
  shipping_cost_cents,
  total_cost_cents,
  order_date,
  expected_delivery_date,
  status
) VALUES (
  '0b9f107a-d124-49de-9ded-94698f63c1c4',
  'a90c008a-3379-41d8-9eb2-b4eda365d74c',
  'Master Cylinder',
  'GM-MC-15643918',
  'RockAuto',
  7225,
  850,
  8075,
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '7 days',
  'test_order'
)
RETURNING id, part_name, total_cost_cents / 100.0 as total_dollars, status;
