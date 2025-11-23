# Context-Driven Processing - The Real Strategy

## The Breakthrough Insight

**Question difficulty is NOT about the question itself - it's about how much context we have.**

### Examples:

**"Hard" Question Made Easy:**
```
Question: "Identify all parts in this engine bay"

Without context (expensive):
- Model: GPT-4o
- Cost: $0.02
- Accuracy: 60% (guessing part numbers)
- Result: Generic descriptions

With context (cheap!):
- SPID Data: Engine code L31, RPO codes G80, KC4
- Receipt: "Edelbrock intake #2701, Holley carb #0-80508"
- Timeline: "350ci rebuild - installed headers"
- Model: GPT-4o-mini
- Cost: $0.0001
- Accuracy: 95% (just confirming visible parts match known parts)
- Result: "Yes, Edelbrock #2701 visible, Holley carb confirmed"
```

**Expensive Model's Real Job:**
```
Question: "What context are we missing to fully document this engine?"

Answer: "I can see:
- Aftermarket intake (can't identify without receipt)
- Carburetor (brand unclear, need part number)
- Headers (visible but not documented in timeline)

Suggested actions:
- Add receipt for intake to confirm part number
- User should tag carburetor brand
- Add timeline event for header installation"

This meta-question identifies GAPS → User fills gaps → Cheap model completes puzzle
```

---

## Revised Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│           CONTEXT-DRIVEN PROCESSING SYSTEM                      │
└─────────────────────────────────────────────────────────────────┘

PHASE 1: CHEAP MODELS WITH MAXIMUM CONTEXT
───────────────────────────────────────────────────────────────────
For every image:
  1. Load ALL available context
  2. Ask: "Given this context, confirm what you see"
  3. Model: gpt-4o-mini ($0.0001)
  
Result: 95% of questions answered cheaply

PHASE 2: IDENTIFY MISSING CONTEXT (Selective)
───────────────────────────────────────────────────────────────────
For images with low confidence or gaps:
  1. Ask: "What information would help identify unknowns?"
  2. Model: gpt-4o ($0.02)
  3. Output: List of missing documentation
  
Result: Roadmap of what context to gather

PHASE 3: USER FILLS GAPS
───────────────────────────────────────────────────────────────────
System prompts user:
  - "Add receipt for [visible part]"
  - "Tag this component"
  - "Add timeline event for this work"

PHASE 4: REPROCESS WITH NEW CONTEXT (Cheap!)
───────────────────────────────────────────────────────────────────
When user adds context:
  1. Rerun Phase 1 with new context
  2. Model: gpt-4o-mini (still cheap!)
  3. Confidence jumps from 60% → 95%
```

---

## Multi-Model Consensus System

Track which models answered which questions:

```sql
CREATE TABLE image_analysis_answers (
  id UUID PRIMARY KEY,
  image_id UUID,
  question_key TEXT,           -- "engine_parts_identified"
  answer JSONB,                -- structured answer
  model_used TEXT,             -- "gpt-4o-mini-2024", "gpt-4o-2024"
  confidence INTEGER,          -- 0-100
  context_hash TEXT,           -- hash of context used
  answered_at TIMESTAMPTZ,
  cost NUMERIC
);

-- Multiple models can answer same question
-- Build consensus over time

-- Example: What intake manifold?
Row 1: gpt-4o-mini  | "Edelbrock intake"     | 60% | No receipt
Row 2: gpt-4o       | "Edelbrock Performer"  | 75% | No receipt
Row 3: gpt-4o-mini  | "Edelbrock #2701"      | 95% | With receipt!
Row 4: claude-haiku | "Edelbrock #2701"      | 93% | With receipt!

Consensus: "Edelbrock #2701" (multiple models agree when context good)
```

This enables:
- ✅ Track answer evolution as context improves
- ✅ Compare model performance
- ✅ Build confidence through consensus
- ✅ Validate expensive model answers with cheap reprocessing

---

## The Context Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│              CONTEXT RICHNESS LEVELS                             │
└─────────────────────────────────────────────────────────────────┘

LEVEL 0: MINIMAL CONTEXT (Expensive to analyze)
───────────────────────────────────────────────────────────────────
Available:
- Image only
- Year/Make/Model

Accuracy: 40-60%
Cost: HIGH (needs expensive model to guess)

Example: "What's in this engine bay?"
Answer: Generic guesses, low confidence

LEVEL 1: BASIC CONTEXT (Moderate cost)
───────────────────────────────────────────────────────────────────
Available:
+ SPID data (factory engine code, RPO codes)
+ Vehicle specs (trim, options)

Accuracy: 60-75%
Cost: MODERATE (can use cheaper model with specs)

Example: "Engine should have L31 350ci. Confirm?"
Answer: "Yes, L31 visible on block"

LEVEL 2: GOOD CONTEXT (Low cost)
───────────────────────────────────────────────────────────────────
Available:
+ Timeline events (work history)
+ Some receipts

Accuracy: 75-90%
Cost: LOW (cheap model can confirm known work)

Example: "Timeline shows intake swap. Visible?"
Answer: "Yes, Edelbrock intake installed"

LEVEL 3: RICH CONTEXT (Very low cost)
───────────────────────────────────────────────────────────────────
Available:
+ Many receipts with part numbers
+ User tags
+ Reference manuals for this model

Accuracy: 90-98%
Cost: VERY LOW (trivial confirmation)

Example: "Receipt shows Edelbrock #2701. Is this it?"
Answer: "Yes, confirmed"

LEVEL 4: COMPLETE CONTEXT (Trivial cost)
───────────────────────────────────────────────────────────────────
Available:
+ Complete build documentation
+ All receipts
+ Factory manuals
+ Previous expert validations

Accuracy: 98%+
Cost: TRIVIAL (just visual confirmation)

Example: "Build sheet lists all parts. Check each visible?"
Answer: Simple yes/no for each part
```

---

## Cost Inversion Principle

```
TRADITIONAL THINKING:
  Hard question → Expensive model
  Easy question → Cheap model

ACTUAL REALITY:
  No context → Expensive model (has to guess)
  Rich context → Cheap model (just confirming)

THEREFORE:
  Invest in GATHERING context (one-time cost)
  Then use cheap models forever (ongoing savings)
```

### Example: Engine Bay Analysis

**Without Context:**
```
Cost: $0.02 per image (GPT-4o guessing)
Accuracy: 60%
Questions: 10 generic questions
Result: "Appears to be aftermarket intake, unknown brand"

Over 100 engine images: $2.00, low confidence
```

**With Context (SPID + receipts):**
```
Cost: $0.0001 per image (GPT-4o-mini confirming)
Accuracy: 95%
Questions: 3 specific questions
Result: "Edelbrock #2701 confirmed, Holley #0-80508 confirmed"

Over 100 engine images: $0.01, high confidence
SAVINGS: $1.99 (99.5% cheaper!)
```

---

## Model Selection Logic (Revised)

```javascript
function selectModel(image, question, availableContext) {
  // Calculate context richness score
  const contextScore = calculateContextScore(availableContext);
  
  // Context scoring:
  // +10 pts: Has SPID data
  // +10 pts: Has receipts from same timeframe as image
  // +5 pts per timeline event
  // +5 pts per user tag
  // +20 pts: Has factory manual for this model
  // +10 pts: Has previous analysis to compare
  
  if (contextScore >= 60) {
    // RICH CONTEXT: Use cheapest model
    return {
      model: 'gpt-4o-mini',
      detail: 'low',
      cost: 0.0001,
      rationale: 'Context-rich, just confirming visible matches known data'
    };
  }
  
  if (contextScore >= 30) {
    // MODERATE CONTEXT: Use cheap model with more detail
    return {
      model: 'gpt-4o-mini',
      detail: 'high',
      cost: 0.0005,
      rationale: 'Some context, need moderate analysis'
    };
  }
  
  if (contextScore >= 10) {
    // MINIMAL CONTEXT: Need smarter model
    return {
      model: 'gpt-4o-mini',
      detail: 'high',
      maxTokens: 1000,
      cost: 0.005,
      rationale: 'Limited context, more inference needed'
    };
  }
  
  // NO CONTEXT: Use expensive model to identify gaps
  return {
    model: 'gpt-4o',
    detail: 'high',
    cost: 0.02,
    task: 'identify_missing_context',
    rationale: 'No context - identify what documentation we need'
  };
}
```

---

## The "Puzzle Piece" Database Design

```sql
-- Track answer evolution as context improves
CREATE TABLE image_question_answers (
  id UUID PRIMARY KEY,
  image_id UUID,
  question_type TEXT,          -- "engine_parts", "paint_quality", etc
  
  -- The answer
  answer JSONB,
  confidence INTEGER,          -- 0-100
  
  -- Provenance tracking
  model_used TEXT,             -- "gpt-4o-mini-2024-11-20"
  model_cost NUMERIC,          -- Actual cost of this answer
  answered_at TIMESTAMPTZ,
  
  -- Context tracking
  context_richness INTEGER,    -- Context score when answered
  context_items_used JSONB,    -- What context enabled this answer
  /*
  {
    "spid_data": true,
    "receipts_count": 3,
    "timeline_events": 5,
    "user_tags": 2,
    "reference_docs": 1,
    "previous_analyses": 2
  }
  */
  
  -- Validation
  validated_by_receipt BOOLEAN,
  validated_by_user BOOLEAN,
  consensus_with_models TEXT[], -- Other models that agree
  
  -- Enables reprocessing
  should_reprocess BOOLEAN,     -- True if context has improved
  reprocessed_from UUID         -- Previous answer this replaces
);

-- Index for finding answers to reprocess
CREATE INDEX idx_should_reprocess ON image_question_answers(should_reprocess)
  WHERE should_reprocess = true;
```

### Example Evolution:

```sql
-- Analysis 1: No context
INSERT INTO image_question_answers VALUES (
  '...', image_123, 'engine_intake_manifold',
  '{"part": "unknown intake manifold", "brand": "unclear"}',
  40,  -- Low confidence
  'gpt-4o', 0.02,
  '2025-11-22 10:00:00',
  5,   -- Context score: 5 (minimal)
  '{"spid_data": false, "receipts_count": 0}',
  false, false, ARRAY[]::TEXT[],
  true,  -- Should reprocess when context improves
  null
);

-- User adds receipt: "Edelbrock Performer #2701"

-- Analysis 2: With receipt
INSERT INTO image_question_answers VALUES (
  '...', image_123, 'engine_intake_manifold',
  '{"part": "Edelbrock Performer", "part_number": "2701"}',
  95,  -- High confidence!
  'gpt-4o-mini', 0.0001,  -- 200x cheaper!
  '2025-11-22 14:30:00',
  45,  -- Context score: 45 (good)
  '{"spid_data": true, "receipts_count": 1, "receipt_items": ["Edelbrock 2701"]}',
  true, false, ARRAY[]::TEXT[],  -- Validated by receipt!
  false,  -- No need to reprocess
  'first_answer_id'  -- Links to previous low-confidence answer
);

-- Analysis 3: Another cheap model for consensus
INSERT INTO image_question_answers VALUES (
  '...', image_123, 'engine_intake_manifold',
  '{"part": "Edelbrock Performer", "part_number": "2701"}',
  93,  -- Also high confidence
  'claude-haiku', 0.00008,  -- Even cheaper!
  '2025-11-22 14:31:00',
  45,
  '{"spid_data": true, "receipts_count": 1}',
  true, false,
  ARRAY['gpt-4o-mini'],  -- Agrees with previous answer
  false,
  'second_answer_id'
);

-- Final consensus: 3 models agree, validated by receipt
-- Total cost: $0.02 + $0.0001 + $0.00008 = $0.02108
-- But now we have HIGH CONFIDENCE validated answer
-- Future images with same intake: Just $0.0001 to confirm!
```

---

## Revised Model Selection

```
┌─────────────────────────────────────────────────────────────────┐
│              MODEL SELECTION = f(CONTEXT, NOT QUESTION)         │
└─────────────────────────────────────────────────────────────────┘

Context Score Calculation:
──────────────────────────────────────────────────────────────────
+20 pts: Has SPID data (factory parts list)
+15 pts: Has factory manual for this year/model
+5 pts per receipt matching image timeframe
+3 pts per timeline event
+2 pts per user tag
+10 pts: Has previous analysis of similar image
+5 pts: Vehicle has >10 documented events (well-documented)

ROUTING LOGIC:
──────────────────────────────────────────────────────────────────
Score 0-20:   Use GPT-4o → Identify missing context ($0.02)
Score 21-40:  Use GPT-4o-mini + high detail ($0.005)  
Score 41-60:  Use GPT-4o-mini + low detail ($0.0005)
Score 61+:    Use GPT-4o-mini + minimal ($0.0001)

OR use free models (Claude Haiku, Gemini Flash) for consensus!
```

---

## The "Missing Puzzle Piece" Question

When context is low, ask expensive model to identify gaps:

```json
{
  "task": "identify_missing_context",
  "model": "gpt-4o",
  "cost": 0.02,
  
  "question": "Analyze this image and identify what documentation or context would enable accurate part identification. What puzzle pieces are missing?",
  
  "expected_response": {
    "visible_but_unidentified": [
      {
        "item": "Intake manifold",
        "partial_info": "Aftermarket, aluminum, 4-barrel",
        "what_would_help": "Receipt with part number, or user tag with brand",
        "confidence_without": 20,
        "confidence_with": 95
      },
      {
        "item": "Carburetor",
        "partial_info": "4-barrel, chrome",
        "what_would_help": "Receipt or photo of manufacturer tag",
        "confidence_without": 15,
        "confidence_with": 90
      }
    ],
    
    "recommended_actions": [
      "User should photograph carburetor ID tag",
      "Search receipts for intake manifold purchase",
      "Add timeline event for engine modifications"
    ],
    
    "estimated_improvement": {
      "current_completeness": "45%",
      "with_recommended_context": "90%",
      "value": "Can switch to $0.0001 model for reprocessing"
    }
  }
}
```

---

## Database Schema: Track Model Provenance

```sql
-- Update vehicle_images to track multi-model analysis
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS analysis_history JSONB;

-- Structure:
{
  "questions": {
    "angle_detected": {
      "answers": [
        {
          "model": "gpt-4o-mini",
          "answer": "front_3quarter",
          "confidence": 98,
          "cost": 0.0001,
          "context_score": 10,
          "timestamp": "2025-11-22T10:00:00Z"
        }
      ],
      "consensus": "front_3quarter",
      "consensus_confidence": 98
    },
    
    "intake_manifold_identification": {
      "answers": [
        {
          "model": "gpt-4o",
          "answer": "Unknown Edelbrock",
          "confidence": 40,
          "cost": 0.02,
          "context_score": 5,
          "timestamp": "2025-11-22T10:00:00Z"
        },
        {
          "model": "gpt-4o-mini",
          "answer": "Edelbrock Performer #2701",
          "confidence": 95,
          "cost": 0.0001,
          "context_score": 50,  // After receipt added!
          "timestamp": "2025-11-22T14:00:00Z",
          "validated_by_receipt": "receipt_id_xyz"
        },
        {
          "model": "claude-3-haiku",
          "answer": "Edelbrock Performer #2701",
          "confidence": 93,
          "cost": 0.00008,
          "context_score": 50,
          "timestamp": "2025-11-22T14:01:00Z",
          "consensus_with": ["gpt-4o-mini"]
        }
      ],
      "consensus": "Edelbrock Performer #2701",
      "consensus_confidence": 94,
      "validated": true
    }
  },
  
  "total_processing_cost": 0.02109,
  "context_improvements": [
    {
      "timestamp": "2025-11-22T13:00:00Z",
      "action": "receipt_added",
      "receipt_id": "receipt_id_xyz",
      "context_score_before": 5,
      "context_score_after": 50,
      "reprocessing_cost": 0.00018,
      "confidence_improvement": "+54%"
    }
  ]
}
```

---

## The Roadmap to 100% Accuracy

**For vehicles (like cars), we KNOW the complete answer exists:**
- Factory build sheet lists every part
- SPID data shows all options
- Service manuals document everything
- Original brochures show configurations

**Our job:** Build the roadmap to gather that documentation

```
Current State: 45% context coverage
  ↓
Expensive Model: "What's missing?"
  ↓
Answer: "Need: intake receipt, carb photo, header install date"
  ↓
User Action: Adds missing context
  ↓
New State: 90% context coverage
  ↓
Cheap Model: "Confirm what you see" → $0.0001
  ↓
DONE: High confidence, low cost
```

### Virtuous Cycle:

```
More documentation → Cheaper processing → More confidence
                ↑                                 ↓
                └─────────────────────────────────┘
```

---

## Implementation

```javascript
// Context-driven model selection
function selectModelForQuestion(question, availableContext) {
  const contextScore = scoreContext(availableContext);
  
  // For ANY question, more context = cheaper model
  if (contextScore >= 60) {
    return {
      model: 'gpt-4o-mini',
      cost: 0.0001,
      strategy: 'confirmation',  // Just confirm visible matches known
      prompt: buildConfirmationPrompt(question, availableContext)
    };
  }
  
  if (contextScore >= 30) {
    return {
      model: 'gpt-4o-mini',
      cost: 0.0005,
      strategy: 'guided_identification',  // Context helps narrow down
      prompt: buildGuidedPrompt(question, availableContext)
    };
  }
  
  // Low context: Use expensive model for gap analysis
  return {
    model: 'gpt-4o',
    cost: 0.02,
    strategy: 'gap_identification',  // Find what context is missing
    prompt: buildGapAnalysisPrompt(question),
    output_type: 'missing_context_report'
  };
}

function scoreContext(context) {
  let score = 0;
  
  if (context.spid_data) score += 20;
  if (context.factory_manual) score += 15;
  
  score += Math.min(context.receipts?.length * 5, 25);
  score += Math.min(context.timeline_events?.length * 3, 15);
  score += Math.min(context.user_tags?.length * 2, 10);
  
  if (context.previous_analysis) score += 10;
  if (context.vehicle_well_documented) score += 5;
  
  return score;
}
```

---

## Processing Strategy for 2,741 Images

### Phase 1: Quick Organization (ALL images, ultra-cheap)
```
Model: gpt-4o-mini (or free Gemini Flash)
Questions: Trivial (angle, category, color)
Cost: $0.27 (or FREE with Gemini)
Time: 15 minutes
Result: Basic organization
```

### Phase 2: Context-Aware Part ID (based on context score)
```
For each image:
  1. Calculate context score
  2. Route to appropriate model
  
High context (score 60+):   ~1,000 images × $0.0001 = $0.10
Medium context (score 30+): ~1,000 images × $0.0005 = $0.50
Low context (score <30):      ~741 images × $0.005  = $3.70
                                                     ───────
                                                      $4.30
```

### Phase 3: Gap Identification (selective, for low-context vehicles)
```
Model: gpt-4o
Images: ~200 images with context score < 20
Questions: "What context would help complete this analysis?"
Cost: ~$4.00
Result: Actionable list of missing documentation
```

### Phase 4: User-Driven Context Addition
```
System shows users: "Add receipt for [visible part] to improve analysis"
Users add: Receipts, tags, timeline events
Cost: $0 (user time)
```

### Phase 5: Reprocess with New Context (cheap!)
```
Model: gpt-4o-mini
Images: Anything with improved context
Cost: $0.0001 per reprocessing
Result: High confidence answers at minimal cost
```

**TOTAL COST: ~$8.57 for initial run**
**Future reprocessing: Nearly free as context improves!**

---

## Key Principles

1. **Context > Model Power**
   - Good context + cheap model > No context + expensive model

2. **Expensive Models = Gap Finders**
   - Don't use GPT-4o to answer questions
   - Use it to identify what questions we CAN'T answer yet
   - Then gather context to answer cheaply

3. **Build Consensus**
   - Multiple cheap models confirming > One expensive model guessing
   - Track provenance for every answer
   - Validate through receipts/user input

4. **Cars Have Complete Answers**
   - Factory documentation exists
   - Build sheets list everything
   - We just need to gather it
   - Then processing becomes trivial

This is the strategy that scales to millions of images!

