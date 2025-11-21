# AI Document Parser - Intelligent Reference Library System

## Problem

**Manual entry is tedious and error-prone**:
- Your 1973 brochure has 24 pages of specs
- Extracting HP, torque, weight, colors, options = hours of work
- Typing errors introduce inaccuracy
- Defeats the purpose of "source of truth"

**Solution**: AI-powered parser with multi-stage validation

---

## Architecture

```
┌─────────────────────────┐
│ USER UPLOADS PDF        │
│ (1973 Brochure)         │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STAGE 1: OCR            │
│ - Extract all text      │
│ - Identify images       │
│ - Detect tables         │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STAGE 2: AI EXTRACTION  │
│ - GPT-4 Vision          │
│ - Extract specs         │
│ - Identify emblems      │
│ - Parse options/colors  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STAGE 3: VALIDATION     │
│ - Cross-check existing  │
│ - Flag conflicts        │
│ - Ask clarifications    │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STAGE 4: USER REVIEW    │
│ - Show extracted data   │
│ - User confirms/edits   │
│ - Apply to OEM specs    │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ STAGE 5: PROPAGATE      │
│ - Update oem_specs      │
│ - Link proofs           │
│ - Validate vehicles     │
└─────────────────────────┘
```

---

## Multi-Stage Parsing with AI

### Stage 1: Document Processing

```typescript
// Supabase Edge Function: process-reference-document

async function processDocument(fileUrl: string) {
  // 1. Download PDF
  const pdfBuffer = await fetch(fileUrl).then(r => r.arrayBuffer());
  
  // 2. Convert each page to image
  const pages = await pdf2images(pdfBuffer);
  
  // 3. OCR each page
  const textByPage = await Promise.all(
    pages.map(page => extractTextFromImage(page))
  );
  
  return { pages, textByPage };
}
```

### Stage 2: AI Extraction (OpenAI GPT-4 Vision)

```typescript
// Prompt engineering for spec extraction

const EXTRACTION_PROMPTS = {
  engines: `Analyze this brochure page and extract ALL engine options.
  
  For each engine, identify:
  - Engine code (e.g., L05, LE8)
  - Displacement in CID and liters
  - Configuration (V8, I6, etc.)
  - Horsepower and torque
  - Fuel type
  
  Return as JSON array.`,
  
  colors: `Identify all available paint colors from this page.
  
  For each color:
  - Color name (e.g., "Cardinal Red")
  - GM paint code (e.g., "70")
  - Color family (red, blue, etc.)
  
  Return as JSON array.`,
  
  emblems: `Identify the Chevrolet/GMC emblems shown in this brochure.
  
  For each emblem:
  - Type (bowtie, shield, script)
  - Style variant (gold, chrome, black)
  - Placement locations shown
  - Year-specific design notes
  
  Return as JSON.`,
  
  specs: `Extract ALL technical specifications from this page.
  
  Include:
  - Dimensions (wheelbase, length, width, height)
  - Weights (curb weight, GVWR, payload)
  - Capacities (fuel tank, towing)
  - Performance (0-60, mpg estimates)
  
  Return as JSON object.`
};

async function extractWithAI(imageUrl: string, category: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4-vision-preview",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: EXTRACTION_PROMPTS[category] },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }],
    response_format: { type: "json_object" }
  });
  
  return JSON.parse(response.choices[0].message.content);
}
```

### Stage 3: Validation & Clarification

```typescript
// After extraction, ask user to confirm ambiguities

interface ExtractedData {
  engines: Array<{
    code?: string;
    displacement_cid?: number;
    horsepower?: number;
    confidence: number;  // AI confidence
  }>;
  colors: Array<{
    name: string;
    code?: string;
    confidence: number;
  }>;
  // ...
}

// Generate clarification questions
function generateQuestions(extracted: ExtractedData, existing: OEMSpecs) {
  const questions = [];
  
  // Example: Conflict detection
  if (extracted.engines[0].horsepower !== existing.horsepower) {
    questions.push({
      type: 'conflict',
      field: 'horsepower',
      extracted: extracted.engines[0].horsepower,
      existing: existing.horsepower,
      question: 'Brochure shows different HP than database. Which is correct?',
      options: [
        { value: extracted.engines[0].horsepower, label: 'Use brochure value (new source)' },
        { value: existing.horsepower, label: 'Keep database value' },
        { value: 'both', label: 'Both are correct (different engine options)' }
      ]
    });
  }
  
  // Example: Low confidence
  if (extracted.colors.some(c => c.confidence < 80)) {
    questions.push({
      type: 'confirmation',
      field: 'paint_codes',
      question: 'Please verify these color codes are correct:',
      items: extracted.colors.filter(c => c.confidence < 80)
    });
  }
  
  return questions;
}
```

### Stage 4: User Review Interface

```tsx
<DocumentReviewModal>
  <h3>Review Extracted Data</h3>
  <p>From: 1973 Chevrolet Trucks - Blazer</p>
  
  {/* Extracted specs with confidence */}
  <Section title="Engine Options">
    <SpecRow>
      <span>L05 5.7L V8</span>
      <span>165 HP @ 3,800 RPM</span>
      <span>255 lb-ft @ 2,400 RPM</span>
      <Badge confidence={95}>95% confident</Badge>
      <Button>Edit</Button>
    </SpecRow>
  </Section>
  
  {/* Validation questions */}
  <Section title="Clarification Needed (2)">
    <Question>
      <p>Brochure shows 165 HP, but database has 170 HP. Which is correct?</p>
      <Radio>
        <option>165 HP (brochure) - Base engine</option>
        <option selected>170 HP (database) - Optional engine</option>
        <option>Both correct - Different configurations</option>
      </Radio>
      <small>This will update OEM specs and mark as verified</small>
    </Question>
  </Section>
  
  {/* Apply changes */}
  <Actions>
    <Button secondary>Review More</Button>
    <Button primary>Apply to OEM Specs</Button>
  </Actions>
</DocumentReviewModal>
```

---

## Supabase Edge Function Design

### File: `supabase/functions/parse-reference-document/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'https://esm.sh/openai@4';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY')
});

serve(async (req) => {
  const { documentId, userId } = await req.json();
  
  // 1. Get document
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  const { data: doc } = await supabase
    .from('library_documents')
    .select('*')
    .eq('id', documentId)
    .single();
  
  // 2. Download and convert PDF to images
  const pdfUrl = doc.file_url;
  // ... PDF processing ...
  
  // 3. Extract data with GPT-4 Vision
  const extracted = {
    engines: [],
    colors: [],
    emblems: [],
    dimensions: {},
    options: []
  };
  
  for (const pageImage of pages) {
    // Analyze each page
    const pageData = await analyzePageWithAI(pageImage);
    
    // Merge results
    extracted.engines.push(...pageData.engines);
    extracted.colors.push(...pageData.colors);
    // ...
  }
  
  // 4. Find existing OEM spec
  const { data: oemSpec } = await supabase
    .from('oem_vehicle_specs')
    .select('*')
    .eq('make', doc.library_make)
    .eq('series', doc.library_series)
    .eq('year_start', doc.library_year)
    .single();
  
  // 5. Generate validation questions
  const questions = generateValidationQuestions(extracted, oemSpec);
  
  // 6. Store extraction for review
  const { data: extraction } = await supabase
    .from('document_extractions')
    .insert({
      document_id: documentId,
      extracted_data: extracted,
      validation_questions: questions,
      status: 'pending_review',
      extracted_at: new Date().toISOString()
    })
    .select()
    .single();
  
  return new Response(JSON.stringify({
    success: true,
    extraction_id: extraction.id,
    questions_count: questions.length,
    extracted_specs_count: Object.keys(extracted).length
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

---

## New Database Tables for Parsing

```sql
-- Store AI extractions for review
CREATE TABLE document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES library_documents(id),
  
  -- Extracted data (before approval)
  extracted_data JSONB NOT NULL,
  
  -- Validation questions for user
  validation_questions JSONB,
  
  -- Status
  status TEXT DEFAULT 'pending_review',  -- 'pending_review', 'approved', 'rejected'
  
  -- Review
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  user_corrections JSONB,
  
  -- Timestamps
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  applied_at TIMESTAMP WITH TIME ZONE
);

-- Track which spec fields came from which document pages
CREATE TABLE spec_field_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id UUID REFERENCES oem_vehicle_specs(id),
  document_id UUID REFERENCES library_documents(id),
  
  -- What was proven
  field_name TEXT NOT NULL,  -- 'horsepower', 'curb_weight', etc.
  field_value TEXT NOT NULL,
  
  -- Where in document
  page_number INTEGER,
  excerpt_text TEXT,
  bounding_box JSONB,  -- Coordinates in image
  
  -- How confident
  extraction_method TEXT,  -- 'gpt4_vision', 'ocr', 'manual'
  confidence INTEGER,
  
  verified_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_spec_field_proof UNIQUE (spec_id, document_id, field_name)
);
```

---

## Upload Flow with AI Parsing

### Step 1: Upload File
```
User drops PDF → Uploads to storage
  ↓
Shows modal: "Processing with AI..."
  ↓
Calls edge function: parse-reference-document
```

### Step 2: AI Processing (30-60 seconds)
```
Edge function:
1. Converts PDF to images (24 pages)
2. GPT-4 Vision analyzes each page:
   - Page 1: Cover (extract year, make, series)
   - Page 8: Engine specs (extract HP, torque, displacement)
   - Page 12: Dimensions (extract wheelbase, length, weight)
   - Page 15: Colors (extract paint codes and names)
   - Page 20: Options (extract RPO codes)
3. Consolidates all extractions
4. Compares with existing OEM specs
5. Generates clarification questions
```

### Step 3: User Review
```
Modal shows:
┌──────────────────────────────────────┐
│ Extracted Data from Brochure        │
├──────────────────────────────────────┤
│                                      │
│ ✓ Engines (1 found)                 │
│   L05 5.7L V8 - 165 HP / 255 lb-ft  │
│   Source: Page 8                     │
│   [View Page] [Edit] [Confirm]       │
│                                      │
│ ✓ Dimensions (4 found)              │
│   Wheelbase: 106.5"                 │
│   Length: 184.8"                    │
│   ...                                │
│   [Confirm All]                      │
│                                      │
│ ⚠️ Colors (12 found - Please verify)│
│   70 - Cardinal Red                  │
│   67 - Nevada Gold                   │
│   ...                                │
│   AI Confidence: 78%                │
│   [Review Each] [Approve All]        │
│                                      │
│ ❓ Clarification Needed (1)          │
│   Found "165 HP" on page 8           │
│   Database shows "170 HP"            │
│   │ ○ 165 HP (base engine)          │
│   │ ○ 170 HP (optional engine)      │
│   │ ● Both correct (2 engines)      │
│   └─ Explanation: __________         │
│                                      │
│ [Cancel] [Apply to Database]         │
└──────────────────────────────────────┘
```

### Step 4: Application
```
User clicks "Apply to Database"
  ↓
System:
1. Updates oem_vehicle_specs with extracted data
2. Creates spec_field_proofs linking each field to page
3. Increases confidence scores
4. Marks fields as "factory_verified"
5. Enables validation for user input
  ↓
Done! All 2 K5 Blazers now have verified specs
```

---

## AI Prompts (Examples)

### Emblem Extraction Prompt

```
You are analyzing a 1973 Chevrolet truck brochure.

Task: Identify and describe the Chevrolet emblems shown.

For each emblem visible, provide:
1. Type (bowtie, script, badge)
2. Color/finish (gold, chrome, black, red)
3. Style notes (shape, proportion, era-specific features)
4. Where shown (grille, tailgate, steering wheel, etc.)
5. Page number

Be specific about era characteristics. The 1973 bowtie differs from 1985.

Return JSON:
{
  "emblems": [{
    "type": "bowtie",
    "variant": "classic_gold",
    "style_notes": "Thick border, deep gold color, square-body era proportions",
    "placements": ["grille_center", "tailgate"],
    "pages": [1, 5, 12]
  }]
}
```

### Color Code Extraction Prompt

```
Extract paint colors from this GM paint code chart.

For each color:
- GM paint code (numeric, e.g., "70")
- Color name (e.g., "Cardinal Red")
- Special notes (metallic, two-tone available, etc.)

Important:
- Distinguish between exterior and interior codes
- Note if color is two-tone only
- Identify year range if shown

Return structured JSON with confidence scores.
```

### Spec Table Parsing Prompt

```
This page shows vehicle specifications in a table format.

Extract ALL numeric specifications, including:
- Engine: displacement, HP, torque, RPM ranges
- Dimensions: wheelbase, length, width, height (in inches)
- Weight: curb weight, GVWR, payload (in lbs)
- Capacities: fuel tank (gallons), towing (lbs)
- Performance: MPG city/highway, 0-60 time

For each spec:
- Field name
- Value with unit
- Confidence score (0-100)
- Notes (if conditions apply, e.g., "with optional engine")

Return JSON with page reference.
```

---

## Question Types System

### Type 1: Conflict Resolution

```json
{
  "type": "conflict",
  "severity": "high",
  "field": "horsepower",
  "question": "Brochure shows different value than database",
  "context": {
    "extracted": { "value": 165, "source": "Page 8", "confidence": 95 },
    "existing": { "value": 170, "source": "User input", "confidence": 50 }
  },
  "options": [
    { "action": "use_extracted", "label": "Use 165 HP (brochure is authoritative)" },
    { "action": "use_existing", "label": "Keep 170 HP (brochure is wrong/different option)" },
    { "action": "create_variant", "label": "Both correct - create engine variants" }
  ]
}
```

### Type 2: Low Confidence

```json
{
  "type": "confirmation",
  "severity": "medium",
  "field": "paint_codes",
  "question": "Please verify these color codes (OCR confidence low)",
  "context": {
    "extracted_items": [
      { "code": "70", "name": "Cardinal Red", "confidence": 92 },
      { "code": "6?", "name": "Nevada Gold", "confidence": 45 }  // ← Low confidence
    ]
  },
  "action_needed": "Manually verify code '6?' - appears to be 67 or 61"
}
```

### Type 3: Missing Context

```json
{
  "type": "clarification",
  "severity": "low",
  "field": "engine_options",
  "question": "Document shows multiple engines - are these all standard or optional?",
  "context": {
    "extracted": [
      "250 CID I6 - 100 HP",
      "307 CID V8 - 115 HP",
      "350 CID V8 - 165 HP"
    ]
  },
  "prompt": "Please indicate which engine was standard and which were options"
}
```

---

## Implementation Plan

### Phase 1: Core Parsing (4 hours)
```
1. Create edge function: parse-reference-document
2. Integrate OpenAI API
3. PDF → Image conversion
4. Basic spec extraction
5. Store in document_extractions table
```

### Phase 2: Review UI (3 hours)
```
1. DocumentReviewModal component
2. Show extracted data
3. Display questions
4. User can edit/confirm
5. Apply to oem_vehicle_specs
```

### Phase 3: Proof Linking (2 hours)
```
1. Create spec_field_proofs records
2. Link each field to source page
3. Show proof in validation popup
4. "Click to see brochure page 8"
```

### Phase 4: Emblem System (3 hours)
```
1. Extract emblem images from docs
2. Store as SVG/PNG variants
3. Link to year ranges
4. Auto-select for vehicle profiles
```

---

## Example: Your 1973 Brochure Processing

```
YOU: Upload 1973-chevrolet-trucks-blazer.pdf

SYSTEM (30 seconds later):
┌────────────────────────────────────────────┐
│ ✓ Processed 24 pages                      │
│ ✓ Extracted 47 specifications             │
│ ✓ Found 12 paint colors                   │
│ ✓ Identified 3 engine options             │
│ ✓ Located Chevrolet emblem variants       │
│                                            │
│ Ready for review                           │
│ [Review Extracted Data]                    │
└────────────────────────────────────────────┘

YOU: Click "Review"

SYSTEM: Shows all extracted data
- Engines: ✓ Confirmed
- Colors: ⚠️ 2 need verification
- Specs: ✓ All look good
- Emblems: ✓ 1973 gold bowtie identified

YOU: Confirm all

SYSTEM:
- Updates oem_vehicle_specs for 1973 K5
- Links brochure pages as proof
- Enables validation for all vehicles
- Shows your contribution

RESULT:
All 2 K5 Blazers now have:
- Verified specs from factory source
- Clickable proofs ("See brochure page 8")
- Period-correct emblems
- Your attribution as expert
```

---

**Ready to build the AI parser?**

**Effort**: ~12 hours total
- Edge function with OpenAI: 4 hours
- Review UI: 3 hours
- Proof linking: 2 hours
- Emblem extraction: 3 hours

**Result**: Upload PDF → AI extracts everything → You review → System updates → Perfect accuracy

Want me to start with the edge function? 🚀

