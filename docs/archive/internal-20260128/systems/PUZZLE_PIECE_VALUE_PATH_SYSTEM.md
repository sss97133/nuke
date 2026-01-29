# Puzzle Piece Value Path System

## Core Mission

**Show users the best path to achieve full value OR generate value with a vehicle.**

Vehicles are like puzzles - if pieces are missing, we offer solutions. The system automatically identifies gaps and suggests actions that connect users with:
- **Available Workers** (technicians, specialists)
- **Parts** (sources, suppliers, availability)
- **Reliable Work Locations** (shops, facilities)

This is an **automatic process** kept running by **strings of authenticated actions**:
1. User validates a suggested action
2. Other user accepts contracts and fulfills
3. System learns and improves

---

## The Puzzle Pieces

### Vehicle Completeness Pieces

1. **Identity** - VIN, year, make, model, trim
2. **Condition** - Current state, issues, damage
3. **History** - Timeline events, receipts, documentation
4. **Visuals** - Images, videos, documentation
5. **Specifications** - Engine, transmission, modifications
6. **Value** - Market value, owner cost, investment
7. **Location** - Where vehicle is, where work happens
8. **Ownership** - Verified owner, title, documentation

### Value Generation Pieces

1. **Work Needed** - Repairs, modifications, maintenance
2. **Workers Available** - Technicians with right skills
3. **Parts Available** - Suppliers, inventory, compatibility
4. **Locations Available** - Shops, facilities, service areas
5. **Contracts** - Agreements, quotes, fulfillment
6. **Documentation** - Proof of work, receipts, timeline

---

## System Architecture

### 1. Gap Detection Engine

**Purpose:** Identify missing puzzle pieces automatically

**Components:**
- `analyze-image-gap-finder` - Finds missing context for images
- `calculate-profile-completeness` - Calculates overall completeness
- `diagnose-vehicle-profile` - Diagnoses specific issues
- `knowledge_gaps` table - Tracks missing reference data

**Enhancement Needed:**
- Unified gap detection that considers all puzzle pieces
- Priority scoring (which gaps block value most?)
- Value impact calculation (how much value is lost per gap?)

### 2. Action Suggestion Engine

**Purpose:** Suggest specific actions to fill gaps

**Current Systems:**
- Profile completion notifications
- Work detection and matching
- Auto-assignment suggestions

**Enhancement Needed:**
- **Action Cards** - Visual suggestions with clear value proposition
- **Action Validation** - User confirms/declines suggestions
- **Action Tracking** - What actions were taken, what worked
- **Action Prioritization** - Show most impactful actions first

### 3. Resource Matching Engine

**Purpose:** Match vehicles with available workers, parts, locations

**Current Systems:**
- Worker/technician matching (skills, availability, location)
- Organization matching (GPS, membership, receipts)
- Parts matching (compatibility, suppliers)

**Enhancement Needed:**
- **Unified Matching API** - Single endpoint for all resource types
- **Real-time Availability** - Live updates on worker/part/location availability
- **Match Confidence Scoring** - How good is this match?
- **Match Acceptance Flow** - User validates, provider accepts

### 4. Contract & Fulfillment System

**Purpose:** Create contracts and track fulfillment

**Current Systems:**
- `work_orders` table and Phoenix API
- `work_contracts` table
- Mailbox system for work requests
- Quote/acceptance workflow

**Enhancement Needed:**
- **Auto-Contract Generation** - Create contracts from validated actions
- **Fulfillment Tracking** - Track work completion, parts delivery
- **Payment Integration** - Hold funds, release on completion
- **Reputation System** - Track who fulfills well

---

## User Flow

### 1. Gap Detection (Automatic)

```
System scans vehicle profile
  ↓
Identifies missing pieces:
  - Missing VIN (blocks value verification)
  - No recent images (blocks condition assessment)
  - Missing receipts (blocks cost basis)
  - Work needed but no quotes (blocks completion)
  ↓
Calculates value impact:
  - Missing VIN: -15% value confidence
  - Missing images: -10% value confidence
  - Missing receipts: -5% value confidence
  ↓
Prioritizes gaps by impact
```

### 2. Action Suggestion (Automatic)

```
System generates action cards:
  ↓
Action Card 1: "Add VIN to unlock value verification"
  - Value Impact: +15% confidence
  - Time: 2 minutes
  - Suggested: Auto-detect from title image
  ↓
Action Card 2: "Get quote for engine rebuild"
  - Value Impact: +$15,000 after completion
  - Time: 5 minutes
  - Matched: 3 technicians available
  - Suggested: Best match (95% confidence)
  ↓
Action Card 3: "Find compatible transmission parts"
  - Value Impact: +$5,000 (restore drivability)
  - Time: 1 minute
  - Matched: 2 suppliers with parts in stock
```

### 3. User Validation (Authenticated Action)

```
User sees action card
  ↓
User clicks "Validate" or "Decline"
  ↓
If validated:
  - Action marked as "user_validated"
  - System creates work order/contract
  - System notifies matched resources
  ↓
If declined:
  - Action marked as "user_declined"
  - System learns (don't suggest similar actions)
  - System may suggest alternative
```

### 4. Resource Acceptance (Authenticated Action)

```
Matched worker/part/location receives notification
  ↓
Resource reviews opportunity
  ↓
Resource clicks "Accept" or "Decline"
  ↓
If accepted:
  - Contract created
  - Work scheduled
  - Payment held
  ↓
If declined:
  - System finds next best match
  - Original resource marked as "declined"
```

### 5. Fulfillment (Authenticated Action)

```
Work is completed
  ↓
Provider uploads proof (images, receipts)
  ↓
System validates completion
  ↓
User confirms completion
  ↓
Payment released
  ↓
Timeline event created
  ↓
Value updated
  ↓
System learns (this action path worked!)
```

---

## Database Schema Enhancements

### Action Suggestions Table

```sql
CREATE TABLE action_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  
  -- The Gap
  gap_type TEXT NOT NULL, -- 'missing_vin', 'missing_images', 'work_needed', 'parts_needed'
  gap_description TEXT NOT NULL,
  gap_priority INTEGER DEFAULT 5, -- 1-10
  
  -- The Action
  action_type TEXT NOT NULL, -- 'add_data', 'find_worker', 'find_parts', 'find_location'
  action_title TEXT NOT NULL,
  action_description TEXT NOT NULL,
  action_value_impact TEXT, -- "+15% confidence", "+$15,000 value"
  action_time_estimate TEXT, -- "2 minutes", "5 minutes"
  
  -- The Match (if applicable)
  matched_resource_type TEXT, -- 'worker', 'parts_supplier', 'location'
  matched_resource_id UUID,
  match_confidence DECIMAL(3,2), -- 0.00-1.00
  
  -- User Response
  user_response TEXT, -- 'pending', 'validated', 'declined'
  user_validated_at TIMESTAMPTZ,
  user_declined_at TIMESTAMPTZ,
  user_declined_reason TEXT,
  
  -- Resource Response (if applicable)
  resource_response TEXT, -- 'pending', 'accepted', 'declined'
  resource_accepted_at TIMESTAMPTZ,
  resource_declined_at TIMESTAMPTZ,
  
  -- Fulfillment
  contract_id UUID REFERENCES work_contracts(id),
  work_order_id UUID REFERENCES work_orders(id),
  fulfilled_at TIMESTAMPTZ,
  fulfillment_quality_score INTEGER, -- 1-5
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ -- Suggestions expire if not acted upon
);

CREATE INDEX idx_action_suggestions_vehicle ON action_suggestions(vehicle_id);
CREATE INDEX idx_action_suggestions_user ON action_suggestions(user_id);
CREATE INDEX idx_action_suggestions_pending ON action_suggestions(user_response) WHERE user_response = 'pending';
CREATE INDEX idx_action_suggestions_validated ON action_suggestions(user_response) WHERE user_response = 'validated';
```

### Value Path Tracking

```sql
CREATE TABLE value_path_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  
  -- Event Type
  event_type TEXT NOT NULL, -- 'gap_detected', 'action_suggested', 'action_validated', 'resource_matched', 'contract_created', 'work_completed', 'value_updated'
  
  -- Value Impact
  value_before DECIMAL(12,2),
  value_after DECIMAL(12,2),
  value_delta DECIMAL(12,2),
  confidence_before DECIMAL(3,2),
  confidence_after DECIMAL(3,2),
  
  -- Related Entities
  action_suggestion_id UUID REFERENCES action_suggestions(id),
  work_order_id UUID REFERENCES work_orders(id),
  contract_id UUID REFERENCES work_contracts(id),
  
  -- Metadata
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_value_path_vehicle ON value_path_events(vehicle_id);
CREATE INDEX idx_value_path_user ON value_path_events(user_id);
```

---

## API Endpoints Needed

### 1. Get Action Suggestions

```
GET /api/vehicles/:vehicleId/action-suggestions

Response:
{
  "suggestions": [
    {
      "id": "uuid",
      "gap_type": "missing_vin",
      "action_type": "add_data",
      "action_title": "Add VIN to unlock value verification",
      "action_description": "Adding your VIN will increase value confidence by 15%",
      "action_value_impact": "+15% confidence",
      "action_time_estimate": "2 minutes",
      "match_confidence": null,
      "matched_resources": []
    },
    {
      "id": "uuid",
      "gap_type": "work_needed",
      "action_type": "find_worker",
      "action_title": "Get quote for engine rebuild",
      "action_description": "3 technicians available. Best match: 95% confidence.",
      "action_value_impact": "+$15,000 after completion",
      "action_time_estimate": "5 minutes",
      "match_confidence": 0.95,
      "matched_resources": [
        {
          "type": "worker",
          "id": "uuid",
          "name": "John's Auto Repair",
          "confidence": 0.95,
          "estimated_cost": "$8,000",
          "estimated_time": "2-3 weeks"
        }
      ]
    }
  ],
  "total_value_impact": "+$20,000 + 15% confidence",
  "completeness_score": 65,
  "potential_completeness": 95
}
```

### 2. Validate Action

```
POST /api/action-suggestions/:id/validate

Request:
{
  "notes": "Optional user notes"
}

Response:
{
  "success": true,
  "action_suggestion": {...},
  "next_steps": [
    "Contract created",
    "Worker notified",
    "Work scheduled for next week"
  ]
}
```

### 3. Decline Action

```
POST /api/action-suggestions/:id/decline

Request:
{
  "reason": "not_needed" | "too_expensive" | "wrong_time" | "other",
  "notes": "Optional explanation"
}

Response:
{
  "success": true,
  "alternative_suggestions": [...] // If applicable
}
```

### 4. Get Value Path

```
GET /api/vehicles/:vehicleId/value-path

Response:
{
  "current_value": 45000,
  "current_confidence": 0.65,
  "potential_value": 65000,
  "potential_confidence": 0.95,
  "value_gap": 20000,
  "path": [
    {
      "step": 1,
      "action": "Add VIN",
      "value_impact": "+15% confidence",
      "status": "pending"
    },
    {
      "step": 2,
      "action": "Complete engine rebuild",
      "value_impact": "+$15,000",
      "status": "in_progress",
      "contract_id": "uuid"
    },
    {
      "step": 3,
      "action": "Add documentation",
      "value_impact": "+$5,000",
      "status": "pending"
    }
  ],
  "estimated_time_to_full_value": "2-3 months",
  "estimated_cost_to_full_value": "$8,000"
}
```

---

## UI Components Needed

### 1. Action Suggestion Cards

Visual cards showing:
- Gap identified
- Action suggested
- Value impact
- Time estimate
- Matched resources (if applicable)
- Validate/Decline buttons

### 2. Value Path Visualization

Shows:
- Current value vs potential value
- Steps to achieve full value
- Progress along the path
- Estimated time and cost

### 3. Resource Match Display

Shows:
- Matched workers/parts/locations
- Confidence scores
- Availability
- Pricing
- Accept/Decline buttons

---

## Automation Rules

### 1. Auto-Detect Gaps

- Run daily scan of all vehicles
- Identify missing pieces
- Calculate value impact
- Generate action suggestions

### 2. Auto-Match Resources

- When action validated, immediately match resources
- Use real-time availability
- Score matches by confidence
- Notify top matches

### 3. Auto-Create Contracts

- When resource accepts, auto-create contract
- Include all terms from match
- Hold payment
- Schedule work

### 4. Auto-Track Fulfillment

- Monitor work progress
- Validate completion
- Update value
- Learn from outcomes

---

## Success Metrics

1. **Gap Detection Rate** - % of vehicles with gaps identified
2. **Action Validation Rate** - % of suggestions validated
3. **Resource Match Rate** - % of validated actions with matches
4. **Contract Acceptance Rate** - % of matches accepted
5. **Fulfillment Rate** - % of contracts completed
6. **Value Improvement** - Average value increase per vehicle
7. **Time to Value** - Average time to achieve full value

---

## Next Steps

1. ✅ Gap detection systems exist (enhance for unified view)
2. ✅ Work order/contract systems exist (enhance for auto-creation)
3. ✅ Matching systems exist (enhance for unified API)
4. ⏭️ Build action suggestion system
5. ⏭️ Build value path visualization
6. ⏭️ Build auto-contract generation
7. ⏭️ Build fulfillment tracking
8. ⏭️ Build learning system (what works, what doesn't)

---

**The system becomes self-sustaining through authenticated actions:**
- User validates → System creates contract
- Resource accepts → Work begins
- Work completes → Value increases
- System learns → Better suggestions next time

