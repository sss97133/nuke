# Structural Foundation: Universal Data Intelligence System

**Created:** 2026-01-28
**Status:** Prototype Architecture
**Core Principle:** Observations are truth. Everything else is derived.

---

## 1. The Epistemological Foundation

```
OBSERVATION ≠ TRUTH (but it's the closest we get)

Observation: "On 2026-01-28, Source X reported Field Y = Value Z"
             └── This HAPPENED. Immutable. 100% true that it was observed.

Truth Claim: "This vehicle HAS VIN 5H27T143358"
             └── DERIVED. Confidence-weighted. Recomputable. Never 100%.
```

**The only absolute truth is live experience** (sitting in the car, holding the art, walking the property). Our job is to compile all observations to approximate truth as closely as possible, while acknowledging the approximation.

---

## 2. Four-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OBSERVATION LAYER                            │
│                                                                 │
│   Immutable. Timestamped. Source-attributed. Domain-agnostic.   │
│   Append-only. Never update. Never delete.                      │
│                                                                 │
│   "At time T, source S observed field F = value V"              │
│                                                                 │
│   This is the ONLY truth we store.                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INTELLIGENCE LAYER                           │
│                                                                 │
│   DOMAIN-AGNOSTIC. Blind to what the data means.                │
│   Pattern detection. Confidence scoring. Gap identification.    │
│                                                                 │
│   Three decisions: APPROVE / DOUBT / REJECT                     │
│   - APPROVE: Observations align, confidence high                │
│   - DOUBT: Anomaly detected, needs research (THE GOLD)          │
│   - REJECT: Hard constraint violated                            │
│                                                                 │
│   Doubt → Research → Learn cycle (self-improving)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DOMAIN GARAGE                              │
│                                                                 │
│   WHERE SPECIALIZATION LIVES. The toolbox.                      │
│   Automotive: VIN decoding, Make/Model hierarchies, specs       │
│   Art: Artist attribution, provenance chains, authentication    │
│   Real Estate: Zoning, title chains, assessment history         │
│                                                                 │
│   Swappable. One garage per domain. Clean interfaces.           │
│   Knowledge grows from observation patterns, not hardcoding.    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DERIVED TRUTH VIEWS                           │
│                                                                 │
│   Queryable. Confidence-weighted. Versioned. Recomputable.      │
│                                                                 │
│   SELECT * FROM vehicles                                        │
│   └── Actually queries observations + confidence weights        │
│   └── Returns "best current understanding"                      │
│   └── Can replay history, recompute with new weights            │
│                                                                 │
│   PERFECTLY organized for ANY query pattern.                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Schema: Observations as Foundation

```sql
-- THE ONLY SOURCE OF TRUTH
CREATE TABLE observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHEN
  observed_at timestamptz NOT NULL,      -- when the source saw this
  recorded_at timestamptz DEFAULT now(), -- when we captured it

  -- WHO (source attribution)
  source_id uuid REFERENCES observation_sources(id),
  source_url text,
  source_confidence float DEFAULT 0.5,   -- inherent source reliability

  -- WHAT ENTITY (domain-agnostic identifier)
  entity_type text NOT NULL,             -- 'vehicle', 'artwork', 'property'
  entity_fingerprint text,               -- fuzzy match key (VIN, title+artist, address)

  -- THE OBSERVATION ITSELF
  field_name text NOT NULL,
  field_value jsonb NOT NULL,
  field_value_raw text,                  -- original unparsed

  -- EVIDENCE
  evidence_type text,                    -- 'text', 'image', 'document', 'api'
  evidence_url text,                     -- screenshot, photo, PDF

  -- IMMUTABILITY MARKER
  is_immutable boolean DEFAULT true,

  CONSTRAINT observations_append_only CHECK (is_immutable = true)
);

-- Index for entity reconstruction
CREATE INDEX idx_obs_entity ON observations(entity_type, entity_fingerprint, field_name, observed_at DESC);

-- Index for source analysis
CREATE INDEX idx_obs_source ON observations(source_id, observed_at DESC);
```

---

## 4. Intelligence Layer: APPROVE / DOUBT / REJECT

```sql
-- Every evaluation logged
CREATE TABLE intelligence_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What triggered this evaluation
  observation_batch_id uuid,
  entity_fingerprint text,

  -- Decision
  overall_decision text CHECK (overall_decision IN ('APPROVE', 'DOUBT', 'REJECT')),
  field_decisions jsonb,  -- per-field breakdown

  -- Confidence
  confidence_score float,
  confidence_factors jsonb,

  -- Outcome tracking (for learning)
  was_correct boolean,    -- filled in later when verified
  verified_at timestamptz,

  created_at timestamptz DEFAULT now()
);

-- The gold: doubts that need research
CREATE TABLE doubt_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  decision_id uuid REFERENCES intelligence_decisions(id),

  -- What's in doubt
  field_name text,
  field_value jsonb,
  doubt_type text,  -- 'anomaly', 'conflict', 'edge_case', 'unknown_pattern'

  -- Research status
  status text DEFAULT 'pending',
  research_attempts int DEFAULT 0,

  -- Resolution
  resolution text,  -- 'APPROVE', 'REJECT', 'INCONCLUSIVE'
  resolution_evidence jsonb,
  created_pattern_id uuid,  -- if this created a learned pattern

  created_at timestamptz DEFAULT now()
);

-- Patterns learned from resolved doubts
CREATE TABLE intelligence_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  pattern_type text,
  pattern_definition jsonb,

  -- What to do when matched
  resolution text,
  confidence float,

  -- Learning metadata
  source_doubt_ids uuid[],
  examples_count int DEFAULT 1,
  accuracy_score float,  -- tracked over time

  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

---

## 5. Evidence Chain: Derivative Data for Doubt Resolution

When a primary fact is doubted, derivative data provides evidence:

```
CLAIMED FACT: 1965 Ranchero, 1,000 miles

DERIVATIVE EVIDENCE (each is also an observation):
├── IMAGES
│   ├── Odometer photo? → supports/contradicts
│   ├── Interior condition? → consistent with low miles?
│   └── Original parts visible? → era-appropriate?
│
├── DESCRIPTION
│   ├── Storage history mentioned?
│   ├── Documentation referenced?
│   └── Owner provenance?
│
├── COMMENTS (community observations)
│   ├── Expert verification?
│   ├── Skepticism expressed?
│   └── "I know this car" claims?
│
└── MARKET SIGNALS
    ├── Price reflects rarity?
    ├── Bid velocity unusual?
    └── Reserve met quickly?
```

Each piece adjusts confidence, but **confidence is NEVER 1.0**.

```sql
-- Track what evidence the intelligence layer sought
CREATE TABLE evidence_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  doubt_id uuid REFERENCES doubt_queue(id),

  evidence_sought text,      -- what we looked for
  evidence_location text,    -- where we looked
  found boolean,

  -- For schema evolution
  pattern_frequency int,     -- how often this gap appears
  suggested_field text,      -- what field might help

  created_at timestamptz DEFAULT now()
);
```

---

## 6. Self-Growing System: Autonomous Expansion

### Layer Growth Mechanisms

| Layer | Growth Mechanism | Human Input |
|-------|------------------|-------------|
| **Observations** | Automatic (extractors) | Zero (humans create source data by living) |
| **Intelligence** | Doubt→Research→Learn cycle | Zero (self-learning) |
| **Domain Garage** | Pattern inference from observations | Rare (edge cases only) |
| **Derived Views** | Query patterns + gap analysis | Zero (auto-generated) |

### Confidence Thresholds for Auto-Incorporation

```
confidence > 0.95  → Auto-incorporate (no human needed)
confidence 0.7-0.95 → Batch review queue (human spot-checks weekly)
confidence < 0.7   → Keep as doubt, gather more observations
```

### Domain Knowledge Inference

```
OBSERVATION PATTERN:
  Day 1:   VIN "WP0..." → make: "Porsche"
  Day 2:   VIN "WP0..." → make: "Porsche"
  ...
  Day 200: 4,847 observations where VIN starts "WP0" → make: "Porsche"

SYSTEM INFERENCE:
  Pattern detected: VIN prefix 'WP0' correlates 99.7% with make='Porsche'
  Confidence: 0.997
  Action: Auto-add to domain garage (threshold met)
```

---

## 7. Human Interaction: Minimal, Precious, Respectful

### The Annoyance Threshold

```
WRONG:
  System: "What's the mileage?"
  System: "Is this VIN correct?"
  System: "What color interior?"
  Human: "DO YOUR JOB"

RIGHT:
  System: [exhausts ALL automated options]
  System: [cross-references 47 observations]
  System: [pattern inference]
  System: [public records]
  System: [community knowledge]
  System: [still stuck on ONE critical thing]
  System: "Hey - the '67 GTO. Odometer original?"
  Human: "Yeah, numbers matching"
  System: [learns, never asks similar again]
```

### Resolution Hierarchy (exhaust in order)

1. **Observations** - free, already collected
2. **Cross-reference** - free, compare sources
3. **Pattern inference** - free, LLM reasoning
4. **Public data** - free, registries/records
5. **Community knowledge** - low cost, forums/experts
6. **Responsible party** - HIGH COST, direct human
7. **Accept uncertainty** - live with confidence < 1.0

### Human Query Constraints

```sql
CREATE TABLE human_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHO (the right person, not random)
  responsible_party_id uuid,
  relationship text,  -- 'seller', 'owner', 'expert', 'manufacturer'

  -- WHAT (batched, minimal)
  questions jsonb,      -- MAX 3 per interaction
  context text,         -- enough to answer quickly

  -- WHEN
  urgency text,         -- 'whenever', 'this_week', 'blocking'

  -- RESPECT
  last_contact_at timestamptz,
  total_queries_30d int,

  CONSTRAINT respect_humans CHECK (total_queries_30d < 5)
);
```

---

## 8. Context Avatars: Human Expertise Without Human Presence

### The Insight

Humans have **context windows** - accumulated knowledge from lived experience. Instead of interrupting humans, we build **avatars** from their observations that can answer questions on their behalf.

### Avatar Construction

```
JOHN - Porsche Expert Avatar

Built from (all observations):
  - 47 cars owned
  - 12 years forum posts
  - 3,400 photos taken
  - 89 auctions attended
  - Service records, receipts

Expertise domains (computed):
  - Porsche 1965-1998
  - Air-cooled engines
  - 911, 912, 914 models
  - Confidence: 0.94

Can answer without waking John:
  ✓ "Is this 930 Turbo price reasonable?"
  ✓ "What's this vacuum line for?"
  ? "VIN authentication" (check confidence)
  ✗ "Best sushi in Tokyo" (not in context)
```

### Query Routing

```
QUESTION ARRIVES
       │
       ▼
EXPERTISE ROUTER
       │
       ├── Matches John Avatar (0.94)
       ├── Matches Sarah Avatar (0.71)
       └── Matches Mike Avatar (0.89)
       │
       ▼
QUERY HIGHEST CONFIDENCE AVATAR
       │
       ├── Response + confidence
       │
       ▼
CONFIDENCE < THRESHOLD?
       │
       YES → Escalate to actual human (rare)
       NO  → Return response (instant)
```

### Livestream Context

Humans don't need to BE in the chat. Their **context shadow** participates:

```
JOHN'S LIVE STATE              JOHN'S AVATAR PRESENCE
       │                              │
  Driving 911 ────────────────→ "John's working on a 911"
  At Luftgekühlt ─────────────→ "John's at Porsche event"
  Reading forum ──────────────→ "John's researching 915 trans"
       │                              │
  [John not typing]            [Avatar participates with his context]
```

### Avatar Schema

```sql
CREATE TABLE context_avatars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  human_id uuid REFERENCES users(id),

  -- Computed from observations
  expertise_domains jsonb,
  confidence_by_domain jsonb,

  -- Context accumulation
  observation_count int,
  observation_sources text[],
  last_observation_at timestamptz,

  -- Performance tracking
  queries_answered int DEFAULT 0,
  queries_deferred int DEFAULT 0,
  accuracy_score float,

  updated_at timestamptz DEFAULT now()
);

CREATE TABLE avatar_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  question text,
  question_domain text,

  -- Routing
  routed_to_avatars uuid[],
  selected_avatar_id uuid,

  -- Response
  avatar_response jsonb,
  avatar_confidence float,

  -- Escalation
  escalated_to_human boolean DEFAULT false,
  human_response jsonb,

  -- Learning
  response_validated boolean,
  was_correct boolean,

  created_at timestamptz DEFAULT now()
);
```

---

## 9. The Growth Engine Formula

```
SYSTEM GROWTH = observations × pattern_detection × confidence_threshold

Observations:     Grow automatically (extractors + human living)
Patterns:         Emerge from doubt resolution
Confidence:       Self-calibrates from outcomes
Schema:           Expands from evidence gaps
Domain knowledge: Inferred from observation correlations
Human input:      Approaches zero over time
```

### Human Role Evolution

```
PHASE 1 (now):
  Human builds system
  Human configures extractors
  Human resolves doubts
  Human defines domains

PHASE 2 (soon):
  Human spot-checks weekly
  Human handles rare edge cases
  Human adds new domains occasionally

PHASE 3 (goal):
  Human creates source data by LIVING
  System handles everything else
  Human forgets system exists
```

---

## 10. Universal Application

This architecture is **domain-agnostic** at its core. The only domain-specific component is the **Garage**.

| Domain | Entity Type | Fingerprint | Garage Contents |
|--------|-------------|-------------|-----------------|
| Automotive | vehicle | VIN | VIN decode, Make/Model, specs |
| Art | artwork | title+artist+year | Attribution, provenance, authentication |
| Real Estate | property | address | Title chain, zoning, assessments |
| Collectibles | item | description+maker | Rarity, condition grading, market |

To add a new domain:
1. Define entity_type and fingerprint strategy
2. Build domain garage (can bootstrap from observations)
3. Route observations to new entity type
4. System learns domain patterns automatically

---

## Summary

**One sentence:** Store observations immutably, derive everything else, let the system learn, respect human time, scale to any domain.

**The sacred rules:**
1. Observations are append-only truth
2. Intelligence is domain-blind
3. Domain knowledge lives in the Garage
4. Humans create data by living, not by answering questions
5. Confidence is never 1.0
6. Doubt is gold - it triggers learning
7. Avatars handle queries, humans handle life
