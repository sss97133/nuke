# Organization Booking & Coordination System - ERD

## Executive Summary

The N-Zero booking system transforms organizations from passive listings into active service providers by:
1. **Service Catalog** - Organizations define what they offer (consignments, detailing, restoration)
2. **Capacity Management** - Track physical resources (lifts, paint booths, storage)
3. **Labor Coordination** - Match skilled users with facilities that have capacity
4. **Intelligent Scheduling** - Algorithm calculates feasibility based on resources + labor availability
5. **Automated Contracts** - Generate agreements between all parties (customer, facility, labor)
6. **Payment Distribution** - Fair compensation based on specialization

---

## Core Entity Relationships

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ORGANIZATIONS (Facilities)                        │
│  - Viva Las Vegas Autos                                             │
│  - Physical resources: lifts, paint booth, storage                  │
│  - Service catalog: what they offer                                 │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ has many
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│              ORGANIZATION_SERVICES (Service Catalog)                 │
│  - Consignment Management                                           │
│  - Professional Detailing                                           │
│  - Light Restoration                                                │
│  - Storage Solutions                                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ requires
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│           ORGANIZATION_CAPABILITIES (Physical Resources)             │
│  - 4x Lifts                                                         │
│  - 2000 sq ft indoor storage                                        │
│  - Paint booth with ventilation                                     │
│  - Compressed air system                                            │
│  - 3-phase electricity                                              │
│  - Welding equipment                                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ calculates
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│              CAPACITY_CALCULATIONS (Intelligent Backend)             │
│  - Available lift hours per week                                    │
│  - Storage occupancy percentage                                     │
│  - Labor hours needed vs available                                  │
│  - Equipment utilization rate                                       │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ matches with
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 USERS (Skilled Labor Pool)                          │
│  - Specializations: paint, bodywork, mechanics                      │
│  - Availability schedules                                           │
│  - Proximity to facilities                                          │
│  - Reputation & ratings                                             │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ creates
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   SERVICE_BOOKINGS (Requests)                        │
│  - Customer needs work done                                         │
│  - System calculates: facility + labor + timeline                   │
│  - Generates quote with breakdown                                   │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ generates
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│              WORK_CONTRACTS (3-Party Agreements)                     │
│  Party 1: Customer (pays total price)                               │
│  Party 2: Facility (receives facility fee)                          │
│  Party 3: Labor (receives labor fee)                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ tracked by
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 PAYMENT_DISTRIBUTIONS (Automated)                    │
│  - Customer payment: $2,000 total                                   │
│  - Facility fee: $400 (20% - space + equipment)                     │
│  - Labor fee: $1,400 (70% - skilled work)                           │
│  - Platform fee: $200 (10% - coordination)                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Database Schema

### 1. ORGANIZATION_SERVICES

**Purpose**: Define what services organizations offer

```sql
CREATE TABLE organization_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  
  -- Service Definition
  service_type TEXT NOT NULL CHECK (service_type IN (
    'consignment_management',
    'professional_detailing',
    'paint_correction',
    'ceramic_coating',
    'light_restoration',
    'mechanical_repair',
    'bodywork',
    'fabrication',
    'indoor_storage',
    'outdoor_storage',
    'transport_coordination',
    'photography',
    'listing_management',
    'inspection_services'
  )),
  
  service_name TEXT NOT NULL,
  description TEXT,
  
  -- Pricing
  pricing_model TEXT CHECK (pricing_model IN (
    'fixed_price',      -- $500 flat fee
    'hourly_rate',      -- $150/hour
    'percentage',       -- 10% of sale price
    'tiered',          -- Different rates based on vehicle value
    'custom_quote'     -- Case-by-case
  )),
  
  base_price DECIMAL(10,2),
  hourly_rate DECIMAL(10,2),
  percentage_rate DECIMAL(5,2),
  
  -- Capacity
  max_concurrent_jobs INTEGER DEFAULT 1,
  typical_duration_days INTEGER,
  
  -- Requirements
  required_capabilities JSONB, -- ["lift", "paint_booth"]
  required_skills JSONB,       -- ["paint", "bodywork"]
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_featured BOOLEAN DEFAULT false,
  
  -- SEO & Discovery
  tags TEXT[],
  search_keywords TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_services_org ON organization_services(organization_id);
CREATE INDEX idx_org_services_type ON organization_services(service_type);
CREATE INDEX idx_org_services_active ON organization_services(is_active);
```

### 2. ORGANIZATION_CAPABILITIES

**Purpose**: Track physical resources and capacity

```sql
CREATE TABLE organization_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  
  -- Equipment & Infrastructure
  capability_type TEXT NOT NULL CHECK (capability_type IN (
    'vehicle_lift',
    'paint_booth',
    'welding_station',
    'air_compressor',
    'electrical_system',
    'indoor_storage',
    'outdoor_storage',
    'parking_spots',
    'wash_bay',
    'alignment_rack',
    'diagnostic_equipment',
    'specialty_tools'
  )),
  
  capability_name TEXT NOT NULL,
  description TEXT,
  
  -- Capacity Metrics
  quantity INTEGER DEFAULT 1,          -- 4 lifts, 2000 sq ft storage
  unit_type TEXT,                      -- 'lifts', 'square_feet', 'spots'
  
  -- Availability
  hours_per_day DECIMAL(5,2),          -- 8 hours per lift per day
  days_per_week INTEGER DEFAULT 5,
  
  -- Technical Specs
  specifications JSONB,                 -- {"max_weight": 10000, "height_clearance": 120}
  
  -- Status
  is_operational BOOLEAN DEFAULT true,
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  
  -- Costs
  hourly_cost DECIMAL(10,2),           -- Cost to use this resource
  daily_cost DECIMAL(10,2),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_capabilities_org ON organization_capabilities(organization_id);
CREATE INDEX idx_org_capabilities_type ON organization_capabilities(capability_type);
```

### 3. USER_SKILLS

**Purpose**: Define what labor services users can provide

```sql
CREATE TABLE user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Skill Definition
  skill_category TEXT NOT NULL CHECK (skill_category IN (
    'painting',
    'bodywork',
    'mechanical',
    'electrical',
    'fabrication',
    'upholstery',
    'detailing',
    'assembly',
    'diagnostics',
    'welding'
  )),
  
  skill_name TEXT NOT NULL,
  proficiency_level TEXT CHECK (proficiency_level IN (
    'learning',      -- 0-1 years
    'competent',     -- 1-3 years
    'proficient',    -- 3-5 years
    'expert',        -- 5-10 years
    'master'         -- 10+ years
  )),
  
  years_experience INTEGER,
  
  -- Certifications
  certifications JSONB,  -- [{"name": "ASE Certified", "date": "2023-01-01"}]
  
  -- Availability
  available_hours_per_week INTEGER,
  preferred_work_schedule TEXT, -- 'weekdays', 'weekends', 'evenings', 'flexible'
  
  -- Pricing
  hourly_rate DECIMAL(10,2),
  minimum_job_hours INTEGER DEFAULT 2,
  
  -- Logistics
  max_travel_distance_miles INTEGER DEFAULT 25,
  has_own_tools BOOLEAN DEFAULT false,
  
  -- Verification
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  
  -- Portfolio
  portfolio_image_urls TEXT[],
  sample_work_urls TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_skills_user ON user_skills(user_id);
CREATE INDEX idx_user_skills_category ON user_skills(skill_category);
CREATE INDEX idx_user_skills_level ON user_skills(proficiency_level);
```

### 4. SERVICE_BOOKINGS

**Purpose**: Customer requests that trigger coordination

```sql
CREATE TABLE service_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Parties
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  
  -- Service Request
  service_id UUID REFERENCES organization_services(id),
  service_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  
  -- Scope
  requested_start_date DATE,
  requested_completion_date DATE,
  flexible_timeline BOOLEAN DEFAULT true,
  
  -- Quote & Pricing
  status TEXT NOT NULL DEFAULT 'quote_requested' CHECK (status IN (
    'quote_requested',   -- Customer submitted request
    'calculating',       -- System finding capacity + labor
    'quote_ready',       -- Quote generated
    'quote_accepted',    -- Customer approved
    'scheduled',         -- Work scheduled with labor
    'in_progress',       -- Work underway
    'quality_review',    -- Checking work quality
    'completed',         -- Work done
    'paid',             -- All parties paid
    'cancelled',
    'disputed'
  )),
  
  -- Quote Breakdown
  total_quoted_price DECIMAL(10,2),
  facility_fee DECIMAL(10,2),
  labor_fee DECIMAL(10,2),
  materials_cost DECIMAL(10,2),
  platform_fee DECIMAL(10,2),
  
  -- Coordination Results
  assigned_labor_users JSONB,          -- [{"user_id": "...", "role": "painter", "hours": 20}]
  assigned_capabilities JSONB,          -- [{"capability_id": "...", "hours": 15}]
  
  -- Timeline
  calculated_start_date DATE,
  calculated_completion_date DATE,
  actual_start_date DATE,
  actual_completion_date DATE,
  
  -- Communications
  customer_notes TEXT,
  facility_notes TEXT,
  labor_notes TEXT,
  
  -- Metadata
  coordination_score DECIMAL(5,2),     -- How well system matched resources (0-100)
  capacity_utilization DECIMAL(5,2),   -- How efficiently resources used
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_bookings_customer ON service_bookings(customer_id);
CREATE INDEX idx_service_bookings_org ON service_bookings(organization_id);
CREATE INDEX idx_service_bookings_status ON service_bookings(status);
CREATE INDEX idx_service_bookings_dates ON service_bookings(requested_start_date, requested_completion_date);
```

### 5. WORK_CONTRACTS

**Purpose**: Legal agreements between all parties

```sql
CREATE TABLE work_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES service_bookings(id) ON DELETE CASCADE NOT NULL,
  
  -- Contract Parties
  customer_id UUID REFERENCES auth.users(id) NOT NULL,
  facility_id UUID REFERENCES businesses(id) NOT NULL,
  labor_user_ids UUID[] NOT NULL,
  
  -- Terms
  contract_type TEXT CHECK (contract_type IN (
    'time_and_materials',
    'fixed_price',
    'cost_plus'
  )),
  
  scope_of_work TEXT NOT NULL,
  deliverables JSONB,                   -- [{"item": "Paint exterior", "completion_criteria": "..."}]
  
  -- Pricing
  total_contract_value DECIMAL(10,2) NOT NULL,
  payment_terms TEXT,                   -- 'net_30', '50_percent_upfront', etc
  
  -- Payment Distribution
  facility_payment DECIMAL(10,2) NOT NULL,
  labor_payments JSONB NOT NULL,        -- [{"user_id": "...", "amount": 1400}]
  platform_fee DECIMAL(10,2) NOT NULL,
  
  -- Schedule
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  milestones JSONB,                     -- [{"name": "Paint prep complete", "date": "...", "payment_pct": 25}]
  
  -- Legal
  terms_and_conditions TEXT,
  signed_by_customer_at TIMESTAMPTZ,
  signed_by_facility_at TIMESTAMPTZ,
  signed_by_labor_at JSONB,             -- {"user_id": "timestamp"}
  
  -- Status
  contract_status TEXT DEFAULT 'draft' CHECK (contract_status IN (
    'draft',
    'pending_signatures',
    'active',
    'completed',
    'terminated',
    'disputed'
  )),
  
  -- Files
  contract_document_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_work_contracts_booking ON work_contracts(booking_id);
CREATE INDEX idx_work_contracts_customer ON work_contracts(customer_id);
CREATE INDEX idx_work_contracts_facility ON work_contracts(facility_id);
```

### 6. PAYMENT_DISTRIBUTIONS

**Purpose**: Track automated payments to all parties

```sql
CREATE TABLE payment_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES work_contracts(id) ON DELETE CASCADE NOT NULL,
  booking_id UUID REFERENCES service_bookings(id) NOT NULL,
  
  -- Payment Event
  payment_type TEXT CHECK (payment_type IN (
    'deposit',          -- Upfront payment
    'milestone',        -- Milestone completion
    'final',           -- Final payment
    'refund',
    'dispute_resolution'
  )),
  
  total_amount DECIMAL(10,2) NOT NULL,
  
  -- Distribution
  distributions JSONB NOT NULL,         -- [{"recipient_id": "...", "recipient_type": "facility", "amount": 400}]
  
  -- Stripe/Payment Processing
  stripe_payment_intent_id TEXT,
  stripe_transfer_ids JSONB,            -- {"facility_id": "tr_xxx", "user_id": "tr_yyy"}
  
  -- Status
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN (
    'pending',
    'processing',
    'completed',
    'failed',
    'refunded',
    'disputed'
  )),
  
  -- Timing
  payment_due_date DATE,
  payment_completed_at TIMESTAMPTZ,
  
  -- Reconciliation
  reconciled BOOLEAN DEFAULT false,
  reconciled_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payment_distributions_contract ON payment_distributions(contract_id);
CREATE INDEX idx_payment_distributions_status ON payment_distributions(payment_status);
```

### 7. CAPACITY_SCHEDULE

**Purpose**: Track real-time facility and labor availability

```sql
CREATE TABLE capacity_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Resource Identifier
  resource_type TEXT NOT NULL CHECK (resource_type IN ('facility_capability', 'user_labor')),
  resource_id UUID NOT NULL,  -- capability_id or user_id
  organization_id UUID REFERENCES businesses(id),
  
  -- Time Block
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_hours DECIMAL(5,2),
  
  -- Booking
  booking_id UUID REFERENCES service_bookings(id) ON DELETE SET NULL,
  is_reserved BOOLEAN DEFAULT false,
  is_blocked BOOLEAN DEFAULT false,  -- Maintenance, holidays, etc
  
  -- Metadata
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_capacity_schedule_resource ON capacity_schedule(resource_type, resource_id);
CREATE INDEX idx_capacity_schedule_date ON capacity_schedule(date);
CREATE INDEX idx_capacity_schedule_booking ON capacity_schedule(booking_id);
```

---

## Relationships Summary

```
BUSINESSES (1) ──→ (M) ORGANIZATION_SERVICES
BUSINESSES (1) ──→ (M) ORGANIZATION_CAPABILITIES
USERS (1) ──→ (M) USER_SKILLS

SERVICE_BOOKINGS (M) ──→ (1) BUSINESSES
SERVICE_BOOKINGS (M) ──→ (1) USERS (customer)
SERVICE_BOOKINGS (1) ──→ (M) CAPACITY_SCHEDULE

WORK_CONTRACTS (1) ──→ (1) SERVICE_BOOKINGS
WORK_CONTRACTS (M) ──→ (1) BUSINESSES
WORK_CONTRACTS (M) ──→ (M) USERS (labor)

PAYMENT_DISTRIBUTIONS (M) ──→ (1) WORK_CONTRACTS
```

---

## Intelligent Coordination Algorithm

### Step 1: Customer Submits Request
- Service type: "Paint exterior"
- Vehicle: 1987 Buick Grand National
- Timeline: "Flexible, prefer 2-3 weeks"

### Step 2: System Calculates Requirements
```javascript
{
  required_capabilities: ['paint_booth', 'air_compressor', 'indoor_storage'],
  required_skills: ['painting', 'paint_prep'],
  estimated_labor_hours: 40,
  estimated_facility_hours: 60,
  estimated_duration_days: 10
}
```

### Step 3: Find Available Facilities
```sql
SELECT * FROM businesses b
JOIN organization_capabilities oc ON b.id = oc.organization_id
WHERE oc.capability_type IN ('paint_booth', 'air_compressor', 'indoor_storage')
AND oc.is_operational = true
GROUP BY b.id
HAVING COUNT(DISTINCT oc.capability_type) >= 3
```

### Step 4: Check Facility Capacity
- Viva Las Vegas has paint booth available: **60% capacity** (good)
- Calculate available hours in next 3 weeks: **120 hours available**
- Required: **60 hours** ✓

### Step 5: Find Matching Labor
```sql
SELECT u.*, us.*, 
  ST_Distance(u.location, facility.location) as distance_miles
FROM users u
JOIN user_skills us ON u.id = us.user_id
WHERE us.skill_category = 'painting'
AND us.proficiency_level IN ('proficient', 'expert', 'master')
AND ST_Distance(u.location, facility.location) <= us.max_travel_distance_miles
ORDER BY us.proficiency_level DESC, distance_miles ASC
```

### Step 6: Generate Quote
```javascript
{
  total_price: 2000,
  breakdown: {
    facility_fee: 400,     // 20% - Paint booth + storage + equipment
    labor_fee: 1400,       // 70% - Skilled painter (40 hours × $35/hr)
    platform_fee: 200      // 10% - Coordination + contracts + payment processing
  },
  timeline: {
    start_date: '2025-12-01',
    completion_date: '2025-12-11',
    confidence: 0.92       // 92% confidence we can meet this timeline
  },
  matched_labor: [
    {
      user_id: 'abc-123',
      name: 'John Painter',
      rating: 4.8,
      completed_jobs: 47,
      specialization: 'Classic car paint restoration'
    }
  ]
}
```

### Step 7: Customer Accepts → Create Contract → Schedule Work → Distribute Payments

---

## Success Metrics

1. **Booking Conversion Rate**: % of quotes that convert to contracts
2. **Capacity Utilization**: % of facility resources actively used
3. **Labor Utilization**: % of skilled users getting matched with jobs
4. **Timeline Accuracy**: % of jobs completed within estimated timeframe
5. **Payment Velocity**: Days from completion to all parties paid
6. **Satisfaction Scores**: Customer, facility, and labor ratings

---

## Next Steps

1. Create wireframes for booking flow
2. Build coordination algorithm
3. Implement capacity calculation engine
4. Design contract generation system
5. Integrate payment distribution with Stripe Connect

