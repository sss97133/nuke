# Timeline Comprehensive Integration Architecture

## How It Ties Into Your Current Schema

```
EXISTING SCHEMA                    NEW INTEGRATION                  CALCULATIONS
═════════════════                  ═══════════════                 ══════════════

┌──────────────┐                  ┌──────────────┐
│  vehicles    │◄─────────────────┤timeline_     │
│  (existing)  │                  │events        │
└──────────────┘                  │(existing +   │
                                  │enhanced)     │
                                  └─────┬────────┘
                                        │
                     ┌──────────────────┼──────────────────┐
                     │                  │                  │
                     ▼                  ▼                  ▼
              ┌─────────────┐    ┌─────────────┐  ┌─────────────┐
              │   clients   │    │event_       │  │event_       │
              │   (NEW)     │    │financial_   │  │turnaround_  │
              └─────┬───────┘    │records      │  │metrics      │
                    │            │(NEW)        │  │(NEW)        │
                    ▼            └──────┬──────┘  └──────┬──────┘
              ┌─────────────┐          │                │
              │client_      │          │                │
              │privacy_     │          ▼                ▼
              │settings     │    ┌────────────┐  ┌────────────┐
              │(NEW)        │    │            │  │            │
              └─────────────┘    │calculate_  │  │calculate_  │
                                 │event_tci() │  │turnaround_ │
                                 │            │  │time()      │
┌──────────────┐                 └────────────┘  └────────────┘
│user_tools    │◄───────┐
│(existing)    │        │
└──────────────┘        │
                        │
                  ┌─────┴───────┐
                  │event_tools_ │
                  │used         │
                  │(NEW LINK)   │
                  └─────────────┘
                        │
                        ▼
                  (depreciation
                   cost added
                   to TCI)

┌──────────────┐
│build_line_   │◄───────┐
│items         │        │
│(existing)    │        │
└──────────────┘        │        ┌──────────────┐
                        │        │suppliers     │◄────┐
┌──────────────┐  ┌─────┴──────┐│(existing)    │     │
│suppliers     │  │event_parts_││              │     │
│(existing)    │◄─┤used        │└──────┬───────┘     │
└──────────────┘  │(NEW LINK)  │       │             │
                  └────┬───────┘       │             │
                       │               ▼             │
                       │         ┌──────────────┐    │
                       ▼         │parts_        │    │
                  (cost added    │reception     │────┘
                   to TCI)       │(NEW)         │
                                 └──────┬───────┘
                                        │
                                        ▼
                                 ┌──────────────┐
                                 │supplier_     │
                                 │ratings       │
                                 │(AUTO-CALC)   │
                                 └──────────────┘

                  ┌──────────────┐
                  │knowledge_    │
                  │base          │◄───────┐
                  │(NEW)         │        │
                  └──────┬───────┘        │
                         │                │
                         ▼                │
                  ┌──────────────┐  ┌────┴──────┐
                  │procedure_    │  │event_     │
                  │steps (NEW)   │  │knowledge_ │
                  │              │  │applied    │
                  ├──────────────┤  │(NEW LINK) │
                  │torque_specs  │  └───────────┘
                  │(NEW)         │
                  ├──────────────┤
                  │common_issues │
                  │(NEW)         │
                  └──────────────┘

                  ┌──────────────┐
                  │event_social_ │
                  │metrics (NEW) │
                  └──────┬───────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
       ┌──────────┐┌──────────┐┌──────────┐
       │partner-  ││sponsor-  ││viewer_   │
       │ship_     ││ships     ││payments  │
       │deals     ││(NEW)     ││(NEW)     │
       │(NEW)     │└──────────┘└──────────┘
       └──────────┘
              │          │          │
              └──────────┼──────────┘
                         ▼
                  ┌──────────────┐
                  │event_social_ │
                  │value         │
                  │(MATERIALIZED │
                  │VIEW)         │
                  └──────────────┘
```

## Data Flow Example: Oil Change Event

```
1. CREATE EVENT
   ↓
   timeline_events
   ├─ id: abc-123
   ├─ title: "Oil Change Service"
   ├─ vehicle_id: vehicle-456
   ├─ client_id: client-789
   ├─ work_started: 2024-06-15 10:23:00
   └─ work_completed: 2024-06-15 12:53:00

2. LINK CLIENT (with privacy)
   ↓
   clients
   ├─ id: client-789
   ├─ client_name: "John Smith"
   ├─ is_private: TRUE
   └─ blur_level: "medium"
   
   client_privacy_settings
   ├─ client_id: client-789
   ├─ hide_name: FALSE
   ├─ blur_images: TRUE
   └─ allowed_viewers: [user-1, user-2]

3. RECORD PARTS USED
   ↓
   parts_reception
   ├─ id: reception-1
   ├─ supplier_id: autozone
   ├─ order_date: 2024-06-13 09:00
   ├─ actual_delivery_date: 2024-06-14 14:15
   ├─ part_number: "M1-5W30"
   ├─ unit_cost: $28.50
   └─ quality_check_passed: TRUE
   
   event_parts_used
   ├─ event_id: abc-123
   ├─ reception_id: reception-1
   ├─ part_name: "Mobil 1 5W-30"
   ├─ quantity: 1
   ├─ cost_price: $28.50
   ├─ retail_price: $45.00
   └─ markup_percent: 57.89%

4. RECORD TOOLS USED
   ↓
   event_tools_used
   ├─ event_id: abc-123
   ├─ tool_id: lift-3
   ├─ duration_minutes: 45
   ├─ checked_out_at: 2024-06-15 10:23
   ├─ checked_in_at: 2024-06-15 11:08
   └─ depreciation_cost: $8.50

5. REFERENCE KNOWLEDGE
   ↓
   event_knowledge_applied
   ├─ event_id: abc-123
   ├─ knowledge_id: gm-5.3L-oil-change
   ├─ was_helpful: TRUE
   └─ accuracy_rating: 5

6. CALCULATE TCI
   ↓
   SELECT calculate_event_tci('abc-123');
   
   Result:
   {
     "labor_cost": 120.00,      (2.5hrs @ $48/hr)
     "parts_cost": 40.70,       (oil + filter)
     "supplies_cost": 5.00,     (shop supplies)
     "overhead_cost": 12.00,    (bay rental, utilities)
     "tool_cost": 8.50,         (lift depreciation)
     "total_cost": 186.20,      <-- TCI
     "customer_price": 265.00,
     "profit_margin": 78.80,
     "profit_margin_percent": 29.7
   }

7. CALCULATE TURNAROUND
   ↓
   SELECT calculate_turnaround_time('abc-123');
   
   Result:
   {
     "parts_ordered_at": "2024-06-13 09:00",
     "parts_received_at": "2024-06-14 14:15",
     "work_started_at": "2024-06-15 10:23",
     "work_completed_at": "2024-06-15 12:53",
     "order_to_delivery_hours": 29.25,
     "delivery_to_install_hours": 20.13,
     "work_duration_hours": 2.5,
     "total_turnaround_hours": 51.88
   }

8. TRACK SOCIAL VALUE
   ↓
   event_social_metrics
   ├─ views: 2,430
   ├─ likes: 187
   └─ engagement_rate: 8.2%
   
   partnership_deals
   └─ Mobil 1 sponsorship: $85.00
   
   viewer_payments
   └─ Tips: $42.50
   
   event_social_value (auto-calculated)
   ├─ partnership_revenue: $85.00
   ├─ viewer_revenue: $42.50
   └─ total_social_value: $145.70

9. COMBINED MARGIN
   ↓
   Profit Margin: $78.80
   + Social Value: $145.70
   = Combined: $224.50 (84.7% margin!)

10. AUTO-UPDATE SUPPLIER RATING
    ↓
    supplier_ratings (AutoZone)
    ├─ quality_score: 98.5
    ├─ responsiveness_score: 95.2
    ├─ overall_score: 97.3
    ├─ total_orders: 247
    ├─ on_time_deliveries: 235
    └─ quality_issues: 3
```

## Example Queries

### 1. Get Complete Event Summary with All Metrics

```sql
SELECT *
FROM complete_event_summary
WHERE event_id = 'abc-123';
```

Returns:
- Client info (privacy-masked if needed)
- TCI breakdown (labor, parts, tools, overhead)
- Social value (partnerships, sponsorships, tips)
- Combined profit margin
- Turnaround times
- Engagement metrics
- Tool/parts/knowledge counts

### 2. Get Client Display Name (Respecting Privacy)

```sql
SELECT 
  CASE 
    WHEN c.is_private = FALSE THEN c.client_name
    WHEN cps.blur_level = 'high' THEN '██████████'
    WHEN cps.blur_level = 'medium' THEN SUBSTRING(c.client_name, 1, 4) || ' █████'
    WHEN cps.blur_level = 'low' THEN SUBSTRING(c.client_name, 1, 1) || '█████'
    ELSE c.client_name
  END as display_name
FROM clients c
LEFT JOIN client_privacy_settings cps ON cps.client_id = c.id
WHERE c.id = 'client-789';
```

### 3. Get Supplier Performance Report

```sql
SELECT 
  s.name,
  sr.overall_score,
  sr.quality_score,
  sr.responsiveness_score,
  sr.on_time_percentage,
  sr.quality_pass_percentage,
  sr.total_orders,
  sr.quality_issues
FROM suppliers s
JOIN supplier_ratings sr ON sr.supplier_id = s.id
ORDER BY sr.overall_score DESC;
```

### 4. Get Parts Turnaround Analysis

```sql
SELECT 
  s.name as supplier,
  pr.part_number,
  pr.order_date,
  pr.actual_delivery_date,
  EXTRACT(EPOCH FROM (pr.actual_delivery_date - pr.order_date))/3600 as delivery_hours,
  CASE 
    WHEN pr.actual_delivery_date <= pr.expected_delivery_date THEN 'On-time'
    ELSE 'Late'
  END as delivery_status
FROM parts_reception pr
JOIN suppliers s ON s.id = pr.supplier_id
ORDER BY pr.order_date DESC
LIMIT 20;
```

### 5. Get Knowledge Base Usage Statistics

```sql
SELECT 
  kb.title,
  kb.category,
  kb.times_referenced,
  kb.helpfulness_score,
  COUNT(eka.id) as recent_uses
FROM knowledge_base kb
LEFT JOIN event_knowledge_applied eka 
  ON eka.knowledge_id = kb.id 
  AND eka.created_at > NOW() - INTERVAL '30 days'
GROUP BY kb.id
ORDER BY kb.times_referenced DESC
LIMIT 10;
```

### 6. Calculate Social ROI per Event

```sql
SELECT 
  te.title,
  efr.total_cost as tci,
  esv.total_social_value,
  (esv.total_social_value / NULLIF(efr.total_cost, 0) * 100) as social_roi_percent
FROM timeline_events te
LEFT JOIN event_financial_records efr ON efr.event_id = te.id
LEFT JOIN event_social_value esv ON esv.event_id = te.id
WHERE te.is_monetized = TRUE
ORDER BY social_roi_percent DESC NULLS LAST;
```

### 7. Get Most Profitable Events (Combined Margin)

```sql
SELECT 
  te.title,
  te.event_date,
  efr.profit_margin as work_profit,
  esv.total_social_value as social_profit,
  (COALESCE(efr.profit_margin, 0) + COALESCE(esv.total_social_value, 0)) as combined_profit
FROM timeline_events te
LEFT JOIN event_financial_records efr ON efr.event_id = te.id
LEFT JOIN event_social_value esv ON esv.event_id = te.id
ORDER BY combined_profit DESC NULLS LAST
LIMIT 20;
```

## Frontend Integration Example

```typescript
// Fetch complete event data for timeline modal
async function getEventDetails(eventId: string) {
  const { data, error } = await supabase
    .from('complete_event_summary')
    .select('*')
    .eq('event_id', eventId)
    .single();
    
  if (error) throw error;
  
  return {
    // Client (privacy-masked)
    client: data.client_display_name,
    isPrivate: data.is_private,
    
    // TCI breakdown
    tci: {
      labor: data.labor_cost,
      parts: data.parts_cost,
      supplies: data.supplies_cost,
      overhead: data.overhead_cost,
      tools: data.tool_depreciation_cost,
      total: data.tci_total
    },
    
    // Customer pricing
    customerPrice: data.customer_price,
    profitMargin: data.profit_margin,
    profitMarginPercent: data.profit_margin_percent,
    
    // Social value
    social: {
      partnerships: data.partnership_revenue,
      sponsorships: data.sponsorship_revenue,
      viewers: data.viewer_revenue,
      total: data.total_social_value
    },
    
    // Combined
    combinedProfit: data.combined_profit,
    
    // Turnaround
    turnaround: {
      orderToDelivery: data.order_to_delivery_hours,
      deliveryToInstall: data.delivery_to_install_hours,
      workDuration: data.work_duration_hours,
      total: data.total_turnaround_hours
    },
    
    // Engagement
    engagement: {
      views: data.views,
      likes: data.likes,
      comments: data.comments,
      engagementRate: data.engagement_rate
    },
    
    // Counts
    toolsUsed: data.tools_used_count,
    partsUsed: data.parts_used_count,
    knowledgeReferenced: data.knowledge_referenced_count
  };
}

// Calculate TCI on-the-fly
async function calculateTCI(eventId: string) {
  const { data, error } = await supabase
    .rpc('calculate_event_tci', { p_event_id: eventId });
    
  if (error) throw error;
  return data;
}

// Calculate turnaround time
async function calculateTurnaround(eventId: string) {
  const { data, error } = await supabase
    .rpc('calculate_turnaround_time', { p_event_id: eventId });
    
  if (error) throw error;
  return data;
}

// Get supplier rating
async function getSupplierRating(supplierId: string) {
  const { data, error } = await supabase
    .from('supplier_ratings')
    .select('*')
    .eq('supplier_id', supplierId)
    .single();
    
  if (error) throw error;
  
  // Format as stars
  const stars = '★'.repeat(Math.round(data.overall_score / 20));
  const percent = `${data.on_time_percentage.toFixed(1)}%`;
  
  return {
    ...data,
    starsDisplay: stars,
    onTimeDisplay: percent
  };
}
```

## Migration Order

To implement this system:

1. ✅ `20251122_extraction_backend.sql` (Already exists)
2. ✅ `20250930_comprehensive_tools_schema.sql` (Already exists)
3. ✅ `20250929000001_vehicle_build_management.sql` (Already exists)
4. ✅ `20250118_timeline_events_schema.sql` (Already exists)
5. **NEW** → `20251122_timeline_comprehensive_integration.sql` (Just created)

This new migration ties everything together without breaking existing data!

## Key Benefits

1. **Privacy-First**: Client names auto-blur based on privacy settings
2. **Complete Cost Tracking**: TCI includes labor, parts, supplies, overhead, and tool depreciation
3. **Supplier Intelligence**: Auto-calculated ratings based on delivery and quality
4. **Turnaround Metrics**: Track from order to completion
5. **Social Value**: Partnerships, sponsorships, and viewer payments tracked
6. **Knowledge Integration**: Reference procedures/specs and track usage
7. **Combined Profit**: Work margin + social value = true profitability
8. **Auto-Calculated**: Most metrics auto-update via triggers and functions

