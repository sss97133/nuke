# Contextual Image Processor - READY ✅

## What's Different

This is NOT a simple batch processor. This is an **intelligent, context-aware analysis system** that:

### 1. Uses Full Vehicle Context
- Loads year/make/model ONCE per vehicle
- Includes work history, receipts, modifications
- Creates targeted questions based on known facts
- Doesn't waste tokens on vague questions

### 2. Vehicle-Specific Questionnaires
For a **1985 Chevy K5 Blazer with known engine mods**:
- ❌ "Does engine appear stock?"  
- ✅ "What engine modifications are visible? (we know engine has been modified)"

### 3. Smart Token Usage
- Context loaded once per vehicle
- Specific questions save tokens
- GPT-4o for complex analysis
- Tracks cost per image (~$0.02 vs ~$0.01 simple)

### 4. Can Reprocess
When new receipts/documentation added:
```bash
node scripts/contextual-batch-processor.js --reprocess --vehicle=<id>
```

## Usage

### Process All Unprocessed Images
```bash
node scripts/contextual-batch-processor.js
```

### Process Specific Vehicle
```bash
node scripts/contextual-batch-processor.js --vehicle=<vehicle-id>
```

### Reprocess with Updated Context
```bash
node scripts/contextual-batch-processor.js --reprocess
```

## What You Get

### Standard Analysis:
- Parts detected
- Generic condition assessment
- Basic tags

### Contextual Analysis:
- **Targeted condition assessment** for that specific year/make/model
- **Modification detection** cross-referenced with known mods
- **Work validation** (does image match recent documented work?)
- **Age-appropriate wear analysis** (for 40-year-old vehicle vs 5-year-old)
- **Location indicators** (rust level suggests geography)
- **Actionable insights** (maintenance needed, concerns, value impact)

## Example Output

```
╔══════════════════════════════════════════════════════════════════════════╗
║ Vehicle 1/15: e08bf694... (87 images)                                    ║
╚══════════════════════════════════════════════════════════════════════════╝

🚗 1985 Chevrolet K5 Blazer
   Timeline events: 47
   Receipts: 23
   Context richness: HIGH

   📦 Batch 1/29 (3 images)
   ────────────────────────────────────────────────────────────────────────
      ✓ 3f8a2b1c... | 12 tags | ~850 tokens | 2 insights
      ✓ 7d9e4f2a... | 8 tags | ~920 tokens | 0 insights
      ✓ 1a5c8d3b... | 15 tags | ~780 tokens | 3 insights
   ────────────────────────────────────────────────────────────────────────
      Success: 3/3 | Tokens: ~2,550 | Cost: ~$0.038

   ✅ Vehicle complete: 87 success, 0 failed
```

## Cost Comparison

**Simple Analysis** (current):
- ~$0.011 per image
- Generic questions
- No context awareness
- 2,741 images = ~$30

**Contextual Analysis** (this):
- ~$0.020 per image
- Targeted questions
- Full context awareness
- 2,741 images = ~$55

**Value:** 2x cost, 10x better insights

## Ready to Run

```bash
cd /Users/skylar/nuke
node scripts/contextual-batch-processor.js
```

Expected:
- Duration: ~2 hours
- Cost: ~$55
- Result: Context-aware analysis of all images
