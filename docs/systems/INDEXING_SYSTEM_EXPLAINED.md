# Indexing System Explained: From PDFs to Restoration Guidance

## 🎯 The Big Picture

**The Goal:** When a user uploads an image of any vehicle part, the system should:
1. Identify what part it is (using indexed service manuals)
2. Check if replacement parts exist (using indexed parts catalogs)
3. Determine what materials/tools are needed (using indexed material & tool catalogs)
4. Assess the condition and calculate a restoration score (0-100)
5. Provide specific guidance: "This needs a wipe down" vs "This needs full restoration"

---

## 📚 What Gets Indexed?

### 1. **Parts Catalogs** (`catalog_parts`)
- **Source:** PDF catalogs from suppliers (LMC Truck, Classic Industries, etc.)
- **What's Extracted:**
  - Part numbers (e.g., "38-9630")
  - Part names (e.g., "Bumper Bolt Kit")
  - Prices
  - Application data (years, models, fitment)
  - Assembly relationships (which parts go together)
- **Current Status:** 4,951 parts indexed from LMC Truck catalog
- **Storage:** `catalog_parts` table with vector embeddings for semantic search

### 2. **Service Manuals** (`document_chunks` with `document_type = 'service_manual'`)
- **Source:** Factory service manuals, repair guides
- **What's Extracted:**
  - Procedures (how to remove/install parts)
  - Specifications (torque values, clearances)
  - Diagrams and callouts
  - Troubleshooting guides
  - Part identification guides
- **Storage:** Chunked by semantic units, stored in `document_chunks` with page citations

### 3. **Material Catalogs** (`document_chunks` with `document_type = 'material_manual'` or `'tds'`)
- **Source:** Paint manufacturer catalogs (PPG, BASF, 3M), Technical Data Sheets
- **What's Extracted:**
  - Product names (e.g., "PPG Deltron Basecoat")
  - Product codes/SKUs
  - Mixing ratios (4:1:1 base:activator:reducer)
  - Application methods (spray, brush)
  - Dry times, coverage rates
  - Compatibility information
- **Storage:** `document_chunks` table with structured fields for products

### 4. **Tool Catalogs** (`professional_tools` table)
- **Source:** Tool manufacturer catalogs, professional tool databases
- **What's Extracted:**
  - Tool names and part numbers
  - Tool categories (hand tools, power tools, specialty tools)
  - Application use cases
  - Professional vs DIY classifications
- **Storage:** `professional_tools` table

---

## 🔄 The Indexing Pipeline

### Step 1: Ingestion
```
User uploads PDF or provides URL
    ↓
Document stored in library_documents table
    ↓
Metadata extracted: title, type, provider, file_url
```

**Edge Functions:**
- `index-reference-document` - Handles PDF URLs
- `index-service-manual` - Processes service manuals specifically

### Step 2: Extraction
```
PDF uploaded to Gemini File API (2M context window)
    ↓
AI analyzes structure (TOC, sections, pages)
    ↓
Mode selection:
  - 'structure' → Extract table of contents, identify sections
  - 'extract_parts' → Extract individual parts with part numbers
  - 'full' → Complete extraction of all content
```

**For Parts Catalogs:**
- Gemini extracts part numbers, names, prices from catalog pages
- Creates `catalog_parts` records with structured data
- Links parts to `catalog_pages` and `catalog_diagrams`

**For Service Manuals:**
- Chunked by semantic units (procedures, specs, diagrams)
- Each chunk includes: page number, section, content, key topics
- Stored in `document_chunks` with vector embeddings

**For Material Catalogs:**
- Extracts product information (name, code, brand, mixing ratios)
- Stores in `document_chunks` with TDS-specific fields

### Step 3: Storage & Indexing
```
Extracted data → Database tables
    ↓
Vector embeddings generated (for semantic search)
    ↓
Full-text search indexes created
    ↓
GIN indexes for array fields (key_topics, compatibility)
```

**Key Tables:**
- `catalog_parts` - Parts with part numbers, prices, fitment
- `catalog_pages` - Page images and raw text
- `catalog_diagrams` - Assembly diagrams with callouts
- `document_chunks` - Unified table for all document types
- `professional_tools` - Tool catalog data

---

## 🔍 How We Query the Index

### Example 1: User uploads image of a rusty bumper

**Step 1: AI identifies the part**
```typescript
// analyze-image-tier1 or analyze-image-contextual
AI Vision identifies: "Front bumper, 1973-1987 Chevy C10"
```

**Step 2: Search parts catalog**
```sql
SELECT * FROM catalog_parts
WHERE name ILIKE '%bumper%'
  AND application_data->>'years' @> '[1973]'
ORDER BY price_current ASC;
```

**Step 3: Search service manual**
```sql
SELECT content, page_number, section_name
FROM document_chunks
WHERE document_type = 'service_manual'
  AND (
    to_tsvector('english', content) @@ plainto_tsquery('english', 'bumper removal installation')
    OR key_topics && ARRAY['bumper', 'body work']
  )
ORDER BY page_number;
```

**Step 4: Search material catalog**
```sql
SELECT product_name, brand, mixing_ratio, application_method
FROM document_chunks
WHERE document_type = 'tds'
  AND (
    material_category = 'paint'
    OR product_name ILIKE '%primer%'
    OR product_name ILIKE '%basecoat%'
  );
```

**Step 5: Search tool catalog**
```sql
SELECT tool_name, category
FROM professional_tools
WHERE category IN ('body work', 'paint', 'rust removal')
  OR tool_name ILIKE '%grinder%'
  OR tool_name ILIKE '%sander%';
```

---

## 🎯 The Restoration Guidance Goal

### Current State
When a user looks at an image, we can:
- ✅ Identify the part (via AI vision + service manual lookup)
- ✅ Find replacement parts (via parts catalog search)
- ✅ Find procedures (via service manual chunks)
- ✅ Find materials (via material catalog search)
- ✅ Find tools (via tool catalog search)

### Missing Piece: Restoration Score Algorithm

**The Vision:**
```
User uploads image → System calculates restoration score (0-100)
    ↓
Score determines guidance level:
  - 99-100: "Just needs a wipe down with microfiber rag"
  - 80-99:  "Needs clean, cut, and polish"
  - 50-80:  "Needs significant restoration work"
  - 0-50:   "Needs complete restoration/replacement"
```

---

## 📊 Proposed Restoration Score Algorithm

### Component-Based Scoring (0-100 scale)

Each visible part/system gets scored individually, then aggregated:

```typescript
interface RestorationScore {
  overall_score: number;        // 0-100
  component_scores: {
    [component_name: string]: {
      score: number;             // 0-100
      condition: string;         // 'excellent', 'good', 'fair', 'poor', 'needs_replacement'
      issues: string[];          // ['rust', 'paint_fade', 'dent']
      guidance: string;          // "Needs wipe down" or "Needs full restoration"
      parts_needed: Part[];       // From catalog lookup
      materials_needed: Material[]; // From material catalog
      tools_needed: Tool[];       // From tool catalog
      estimated_cost: number;     // Parts + materials + labor
      estimated_hours: number;    // Labor hours
    }
  }
}
```

### Scoring Factors

#### 1. **Paint/Finish Condition** (0-25 points)
- **25 points:** Perfect paint, no scratches, deep gloss
- **20 points:** Minor scratches, light swirls
- **15 points:** Moderate scratches, some fade
- **10 points:** Heavy scratches, significant fade
- **5 points:** Paint failure, clear coat peeling
- **0 points:** No paint, bare metal, severe rust

#### 2. **Structural Integrity** (0-25 points)
- **25 points:** Perfect, no damage
- **20 points:** Minor dents, no structural issues
- **15 points:** Moderate dents, some warping
- **10 points:** Significant dents, structural concerns
- **5 points:** Major damage, structural compromise
- **0 points:** Severe damage, unsafe

#### 3. **Rust/Corrosion** (0-25 points)
- **25 points:** No rust visible
- **20 points:** Surface rust only
- **15 points:** Light rust, easily treatable
- **10 points:** Moderate rust, requires treatment
- **5 points:** Heavy rust, significant work needed
- **0 points:** Rust-through, replacement needed

#### 4. **Completeness/Originality** (0-25 points)
- **25 points:** All original parts present, perfect
- **20 points:** All parts present, minor wear
- **15 points:** Most parts present, some wear
- **10 points:** Missing some parts, aftermarket replacements
- **5 points:** Many parts missing or incorrect
- **0 points:** Incomplete, major parts missing

### Guidance Mapping

```typescript
function getRestorationGuidance(score: number): Guidance {
  if (score >= 99) {
    return {
      action: 'maintenance',
      steps: ['Wipe down with microfiber rag', 'Apply protective wax'],
      parts_needed: [],
      materials_needed: ['Microfiber rag', 'Wax'],
      tools_needed: [],
      estimated_cost: 20,
      estimated_hours: 0.5
    };
  }
  
  if (score >= 80) {
    return {
      action: 'detailing',
      steps: [
        'Wash and dry',
        'Clay bar treatment',
        'Cut and polish',
        'Wax application'
      ],
      parts_needed: [],
      materials_needed: ['Clay bar', 'Compound', 'Polish', 'Wax'],
      tools_needed: ['Polisher', 'Microfiber towels'],
      estimated_cost: 150,
      estimated_hours: 4
    };
  }
  
  if (score >= 50) {
    return {
      action: 'restoration',
      steps: [
        'Assess damage',
        'Remove rust',
        'Body work (dents, dings)',
        'Prime and paint',
        'Reassembly'
      ],
      parts_needed: await findReplacementParts(component),
      materials_needed: await findMaterials(component),
      tools_needed: await findTools(component),
      estimated_cost: calculateCost(component),
      estimated_hours: calculateHours(component)
    };
  }
  
  // score < 50
  return {
    action: 'replacement',
    steps: [
      'Remove old part',
      'Order replacement',
      'Install new part',
      'Paint match (if needed)'
    ],
    parts_needed: await findReplacementParts(component),
    materials_needed: await findMaterials(component),
    tools_needed: await findTools(component),
    estimated_cost: calculateCost(component),
    estimated_hours: calculateHours(component)
  };
}
```

### Integration with Indexed Data

**When calculating restoration guidance:**

1. **Parts Lookup:**
   ```typescript
   // Find replacement parts from catalog
   const parts = await searchCatalogParts({
     vehicle_year: 1973,
     vehicle_make: 'Chevrolet',
     vehicle_model: 'C10',
     part_name: 'bumper',
     condition: component.condition
   });
   ```

2. **Material Lookup:**
   ```typescript
   // Find paint/materials needed
   const materials = await searchMaterialCatalog({
     application: 'body work',
     surface_type: 'metal',
     finish_type: 'paint',
     color_code: vehicle.color_code
   });
   ```

3. **Tool Lookup:**
   ```typescript
   // Find tools needed for the work
   const tools = await searchToolCatalog({
     work_type: 'body work',
     skill_level: 'professional',
     application: 'rust removal'
   });
   ```

4. **Procedure Lookup:**
   ```typescript
   // Find service manual procedures
   const procedures = await searchServiceManual({
     vehicle_year: 1973,
     vehicle_make: 'Chevrolet',
     procedure: 'bumper removal installation',
     system: 'body'
   });
   ```

---

## 🚀 Implementation Plan

### Phase 1: Restoration Score Calculation
1. Create `restoration_scores` table
2. Build scoring algorithm function
3. Integrate with image analysis pipeline
4. Store component-level scores

### Phase 2: Guidance Generation
1. Create guidance mapping function
2. Integrate parts catalog lookup
3. Integrate material catalog lookup
4. Integrate tool catalog lookup
5. Generate step-by-step guidance

### Phase 3: UI Display
1. Show restoration score on image view
2. Display component breakdown
3. Show recommended parts/materials/tools
4. Display estimated costs and hours
5. Link to procedures from service manuals

### Phase 4: Cost Estimation
1. Calculate parts costs from catalog
2. Calculate material costs from TDS
3. Calculate labor hours from service manual procedures
4. Apply organization labor rates
5. Generate total estimate

---

## 📈 Benefits of the Indexing System

### 1. **Speed**
- Without indexing: User searches Google → finds manual → reads PDF → finds part → searches supplier → adds to cart (30+ minutes)
- With indexing: AI identifies part → system queries indexed data → shows results instantly (5 seconds)

### 2. **Accuracy**
- Indexed data is structured and validated
- Part numbers are exact matches
- Procedures are cited with page numbers
- Materials include mixing ratios and application methods

### 3. **Completeness**
- All relevant information in one place
- Cross-referenced across catalogs
- Service manual procedures linked to parts
- Materials linked to tools needed

### 4. **Intelligence**
- AI can reason across multiple data sources
- Can suggest alternatives ("This part is out of stock, but here's a compatible alternative")
- Can detect patterns ("This vehicle typically needs these parts at this condition level")

---

## 🎬 Example Flow: User Uploads Rusty Bumper Image

```
1. User uploads image
   ↓
2. AI Vision identifies: "Front bumper, 1973 Chevy C10, heavy rust"
   ↓
3. System queries indexed data:
   - Parts catalog: Finds 3 bumper options ($150-$450)
   - Service manual: Finds "Bumper Removal" procedure (page 247)
   - Material catalog: Finds primer, paint, rust converter
   - Tool catalog: Finds grinder, sander, spray gun
   ↓
4. Restoration score calculated:
   - Paint: 0/25 (no paint, bare metal)
   - Structure: 15/25 (dents, but repairable)
   - Rust: 5/25 (heavy rust, needs treatment)
   - Completeness: 20/25 (part present, but damaged)
   - TOTAL: 40/100
   ↓
5. Guidance generated:
   Action: "Replacement recommended"
   Steps:
     - Remove old bumper (2 hours, per service manual)
     - Order replacement: $250 (from catalog)
     - Install new bumper (1.5 hours)
     - Paint match (if needed): $150 materials
   Total: $400 parts + $150 materials + $437.50 labor = $987.50
   ↓
6. UI displays:
   - Restoration score: 40/100
   - Component breakdown with scores
   - Recommended parts with prices
   - Required materials with mixing ratios
   - Needed tools
   - Step-by-step procedure from service manual
   - Total cost estimate
```

---

## 📝 Next Steps

1. **Build Restoration Score Function**
   - Create `calculate-restoration-score` edge function
   - Integrate with image analysis pipeline
   - Store scores in database

2. **Build Guidance Generator**
   - Create `generate-restoration-guidance` edge function
   - Query all indexed catalogs
   - Generate step-by-step guidance

3. **Build UI Components**
   - Restoration score display
   - Component breakdown view
   - Parts/materials/tools recommendations
   - Cost estimate display

4. **Test with Real Images**
   - Upload various condition levels
   - Verify scoring accuracy
   - Validate guidance quality

---

## 🔗 Related Systems

- **Image Analysis:** `analyze-image-tier1`, `analyze-image-contextual`
- **Parts Catalog:** `catalog_parts` table, `CatalogBrowserV2.tsx`
- **Service Manuals:** `document_chunks` table, `index-service-manual` function
- **Material Catalogs:** `document_chunks` table (TDS type), `MATERIAL_CATALOG_INDEXING.md`
- **Tool Catalogs:** `professional_tools` table
- **Cost Estimation:** `estimate-restoration-cost` function

---

**The indexing system transforms static PDFs into a living, queryable knowledge base that powers intelligent restoration guidance.**

