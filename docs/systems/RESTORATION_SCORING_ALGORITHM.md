# Restoration Scoring Algorithm

## 🎯 Purpose

Calculate a restoration score (0-100) for vehicle parts/components based on visual analysis, then map that score to specific guidance levels and recommendations.

---

## 📊 Scoring Framework

### Overall Score Calculation

```typescript
interface RestorationScore {
  overall_score: number;        // 0-100
  component_scores: {
    [component_name: string]: ComponentScore
  }
}

interface ComponentScore {
  score: number;                // 0-100
  paint_score: number;          // 0-25
  structure_score: number;      // 0-25
  rust_score: number;           // 0-25
  completeness_score: number;    // 0-25
  condition: string;             // 'excellent', 'good', 'fair', 'poor', 'needs_replacement'
  issues: string[];              // ['rust', 'paint_fade', 'dent']
  guidance: Guidance;
}
```

### Score Components (0-100 total)

#### 1. Paint/Finish Condition (0-25 points)

| Condition | Points | Description |
|-----------|--------|-------------|
| Perfect | 25 | Deep gloss, no scratches, perfect finish |
| Excellent | 20 | Minor scratches, light swirls, excellent gloss |
| Very Good | 15 | Moderate scratches, some fade, good gloss |
| Good | 10 | Heavy scratches, significant fade, dull |
| Fair | 5 | Paint failure, clear coat peeling, bare spots |
| Poor | 0 | No paint, bare metal, severe damage |

**Detection Criteria:**
- Gloss level (reflection quality)
- Scratch depth and quantity
- Fade/oxidation level
- Clear coat condition
- Paint thickness (if measurable)

#### 2. Structural Integrity (0-25 points)

| Condition | Points | Description |
|-----------|--------|-------------|
| Perfect | 25 | No damage, perfect alignment |
| Excellent | 20 | Minor dents, no structural issues |
| Very Good | 15 | Moderate dents, some warping, repairable |
| Good | 10 | Significant dents, structural concerns |
| Fair | 5 | Major damage, structural compromise |
| Poor | 0 | Severe damage, unsafe, replacement needed |

**Detection Criteria:**
- Dent depth and quantity
- Warping/bending
- Cracks or fractures
- Alignment issues
- Structural integrity

#### 3. Rust/Corrosion (0-25 points)

| Condition | Points | Description |
|-----------|--------|-------------|
| Perfect | 25 | No rust visible |
| Excellent | 20 | Surface rust only, easily treatable |
| Very Good | 15 | Light rust, treatable with effort |
| Good | 10 | Moderate rust, requires treatment |
| Fair | 5 | Heavy rust, significant work needed |
| Poor | 0 | Rust-through, replacement needed |

**Detection Criteria:**
- Rust coverage percentage
- Rust depth (surface vs penetrating)
- Rust location (structural vs cosmetic)
- Corrosion type (surface, pitting, rust-through)

#### 4. Completeness/Originality (0-25 points)

| Condition | Points | Description |
|-----------|--------|-------------|
| Perfect | 25 | All original parts present, perfect |
| Excellent | 20 | All parts present, minor wear |
| Very Good | 15 | Most parts present, some wear |
| Good | 10 | Missing some parts, aftermarket replacements |
| Fair | 5 | Many parts missing or incorrect |
| Poor | 0 | Incomplete, major parts missing |

**Detection Criteria:**
- Part completeness (all fasteners, trim, etc.)
- Originality (OEM vs aftermarket)
- Missing components
- Incorrect replacements

---

## 🎯 Guidance Mapping

### Score Ranges → Guidance Levels

```typescript
function getGuidanceLevel(score: number): GuidanceLevel {
  if (score >= 99) return 'maintenance';
  if (score >= 80) return 'detailing';
  if (score >= 50) return 'restoration';
  return 'replacement';
}
```

### Guidance Details

#### 99-100: Maintenance
**Action:** Simple maintenance
**Steps:**
1. Wipe down with microfiber rag
2. Apply protective wax/sealant

**Parts Needed:** None
**Materials Needed:**
- Microfiber rag
- Wax or sealant

**Tools Needed:** None (or microfiber towels)

**Estimated Cost:** $20-50
**Estimated Time:** 0.5 hours

---

#### 80-99: Detailing
**Action:** Professional detailing
**Steps:**
1. Wash and dry thoroughly
2. Clay bar treatment (remove contaminants)
3. Cut and polish (remove scratches)
4. Wax application (protection)

**Parts Needed:** None
**Materials Needed:**
- Car wash soap
- Clay bar
- Compound (for cutting)
- Polish
- Wax or sealant
- Microfiber towels

**Tools Needed:**
- Polisher (orbital or rotary)
- Microfiber towels
- Applicator pads

**Estimated Cost:** $150-300
**Estimated Time:** 4-6 hours

---

#### 50-80: Restoration
**Action:** Significant restoration work
**Steps:**
1. Assess damage and plan work
2. Remove rust (grinding, sanding)
3. Body work (dents, dings, filler)
4. Prime surface
5. Paint (basecoat, clear)
6. Reassembly

**Parts Needed:** (from catalog lookup)
- Replacement parts if needed
- Fasteners/hardware
- Trim pieces

**Materials Needed:** (from TDS lookup)
- Rust converter
- Body filler
- Primer
- Basecoat (with color code)
- Clear coat
- Mixing ratios from TDS

**Tools Needed:** (from tool catalog)
- Grinder (rust removal)
- Sander (surface prep)
- Body tools (dent repair)
- Spray gun (paint application)
- Safety equipment

**Estimated Cost:** $300-1,200 (varies by part size)
**Estimated Time:** 8-20 hours

---

#### 0-50: Replacement
**Action:** Part replacement recommended
**Steps:**
1. Remove old part (per service manual)
2. Order replacement (from catalog)
3. Prepare surface (if needed)
4. Install new part
5. Paint match (if needed)

**Parts Needed:** (from catalog lookup)
- New part assembly
- Required hardware/fasteners
- Trim pieces

**Materials Needed:** (from TDS lookup)
- Primer (if painting)
- Basecoat (color match)
- Clear coat
- Mixing ratios from TDS

**Tools Needed:** (from tool catalog)
- Removal tools (per service manual)
- Installation tools
- Paint equipment (if painting)

**Estimated Cost:** $200-2,000+ (varies by part)
**Estimated Time:** 2-10 hours

---

## 🔧 Algorithm Implementation

### Step 1: Image Analysis

```typescript
async function analyzeComponent(imageUrl: string, vehicleContext: VehicleContext) {
  // Use AI Vision to analyze image
  const analysis = await analyzeImageWithAI(imageUrl, {
    vehicle_year: vehicleContext.year,
    vehicle_make: vehicleContext.make,
    vehicle_model: vehicleContext.model
  });
  
  return {
    paint_condition: analysis.paint_quality,      // 0-10 scale
    structural_damage: analysis.structural_damage, // 0-10 scale
    rust_severity: analysis.rust_level,            // 0-10 scale
    completeness: analysis.completeness,          // 0-10 scale
    issues: analysis.detected_issues               // ['rust', 'dent', etc.]
  };
}
```

### Step 2: Calculate Component Scores

```typescript
function calculateComponentScore(analysis: ImageAnalysis): ComponentScore {
  // Convert 0-10 scales to 0-25 point scales
  const paint_score = Math.round((analysis.paint_condition / 10) * 25);
  const structure_score = Math.round((analysis.structural_damage / 10) * 25);
  const rust_score = Math.round(((10 - analysis.rust_severity) / 10) * 25); // Inverted
  const completeness_score = Math.round((analysis.completeness / 10) * 25);
  
  const total_score = paint_score + structure_score + rust_score + completeness_score;
  
  // Determine condition label
  const condition = getConditionLabel(total_score);
  
  return {
    score: total_score,
    paint_score,
    structure_score,
    rust_score,
    completeness_score,
    condition,
    issues: analysis.issues
  };
}
```

### Step 3: Generate Guidance

```typescript
async function generateGuidance(
  componentScore: ComponentScore,
  componentName: string,
  vehicleContext: VehicleContext
): Promise<Guidance> {
  const guidanceLevel = getGuidanceLevel(componentScore.score);
  
  // Query indexed catalogs based on guidance level
  const parts = guidanceLevel === 'replacement' || guidanceLevel === 'restoration'
    ? await searchCatalogParts(componentName, vehicleContext)
    : [];
  
  const materials = guidanceLevel === 'restoration' || guidanceLevel === 'replacement'
    ? await searchMaterialCatalog({
        application: 'body work',
        surface_type: 'metal',
        finish_type: 'paint'
      })
    : guidanceLevel === 'detailing'
    ? await searchMaterialCatalog({
        application: 'detailing',
        products: ['compound', 'polish', 'wax']
      })
    : [];
  
  const tools = guidanceLevel !== 'maintenance'
    ? await searchToolCatalog({
        work_type: guidanceLevel,
        skill_level: 'professional'
      })
    : [];
  
  const procedures = guidanceLevel === 'replacement' || guidanceLevel === 'restoration'
    ? await searchServiceManual({
        vehicle: vehicleContext,
        procedure: `${componentName} ${guidanceLevel}`
      })
    : [];
  
  // Calculate costs
  const cost = calculateCost(parts, materials, tools, guidanceLevel);
  const hours = calculateHours(guidanceLevel, procedures);
  
  return {
    level: guidanceLevel,
    action: getActionForLevel(guidanceLevel),
    steps: getStepsForLevel(guidanceLevel),
    parts_needed: parts,
    materials_needed: materials,
    tools_needed: tools,
    procedures: procedures,
    estimated_cost: cost,
    estimated_hours: hours
  };
}
```

### Step 4: Aggregate Overall Score

```typescript
function calculateOverallScore(componentScores: ComponentScore[]): number {
  // Weighted average (or simple average)
  const total = componentScores.reduce((sum, comp) => sum + comp.score, 0);
  return Math.round(total / componentScores.length);
}
```

---

## 📈 Example Calculations

### Example 1: Rusty Bumper (Low Score)

**Image Analysis:**
- Paint condition: 1/10 (no paint, bare metal)
- Structural damage: 6/10 (dents, but repairable)
- Rust severity: 9/10 (heavy rust)
- Completeness: 8/10 (part present, but damaged)

**Component Scores:**
- Paint: (1/10) * 25 = 2.5 → 3 points
- Structure: (6/10) * 25 = 15 points
- Rust: ((10-9)/10) * 25 = 2.5 → 3 points
- Completeness: (8/10) * 25 = 20 points
- **Total: 41/100**

**Guidance:** Replacement recommended
- Parts: New bumper assembly ($250)
- Materials: Primer, paint, clear ($150)
- Tools: Grinder, sander, spray gun
- Cost: $987.50
- Time: 3.5 hours

---

### Example 2: Minor Scratches (High Score)

**Image Analysis:**
- Paint condition: 8/10 (good paint, light scratches)
- Structural damage: 10/10 (no damage)
- Rust severity: 1/10 (no rust)
- Completeness: 10/10 (complete)

**Component Scores:**
- Paint: (8/10) * 25 = 20 points
- Structure: (10/10) * 25 = 25 points
- Rust: ((10-1)/10) * 25 = 22.5 → 23 points
- Completeness: (10/10) * 25 = 25 points
- **Total: 93/100**

**Guidance:** Clean, cut, and polish
- Parts: None
- Materials: Compound, polish, wax ($50)
- Tools: Polisher, microfiber towels
- Cost: $150
- Time: 4 hours

---

## 🔄 Integration with Indexed Data

### Parts Catalog Lookup
```typescript
async function searchCatalogParts(
  componentName: string,
  vehicleContext: VehicleContext
): Promise<Part[]> {
  const { data } = await supabase
    .from('catalog_parts')
    .select('*')
    .ilike('name', `%${componentName}%`)
    .contains('application_data', {
      years: [vehicleContext.year],
      models: [vehicleContext.model]
    })
    .order('price_current', { ascending: true });
  
  return data || [];
}
```

### Material Catalog Lookup
```typescript
async function searchMaterialCatalog(params: {
  application: string;
  surface_type?: string;
  finish_type?: string;
}): Promise<Material[]> {
  let query = supabase
    .from('document_chunks')
    .select('*')
    .eq('document_type', 'tds');
  
  if (params.application) {
    query = query.ilike('usage_instructions', `%${params.application}%`);
  }
  
  if (params.finish_type) {
    query = query.eq('material_category', params.finish_type);
  }
  
  const { data } = await query;
  return data || [];
}
```

### Tool Catalog Lookup
```typescript
async function searchToolCatalog(params: {
  work_type: string;
  skill_level: string;
}): Promise<Tool[]> {
  const { data } = await supabase
    .from('professional_tools')
    .select('*')
    .ilike('category', `%${params.work_type}%`)
    .eq('skill_level', params.skill_level);
  
  return data || [];
}
```

### Service Manual Lookup
```typescript
async function searchServiceManual(params: {
  vehicle: VehicleContext;
  procedure: string;
}): Promise<Procedure[]> {
  const { data } = await supabase
    .from('document_chunks')
    .select('*')
    .eq('document_type', 'service_manual')
    .textSearch('content', params.procedure)
    .order('page_number', { ascending: true });
  
  return data || [];
}
```

---

## 🎯 Next Steps

1. **Implement scoring function** in edge function
2. **Integrate with image analysis** pipeline
3. **Build guidance generator** that queries all catalogs
4. **Create UI components** to display scores and guidance
5. **Test with various condition levels** to validate algorithm
6. **Refine scoring weights** based on real-world feedback

---

**This algorithm transforms visual condition assessment into actionable restoration guidance using indexed catalog data.**

