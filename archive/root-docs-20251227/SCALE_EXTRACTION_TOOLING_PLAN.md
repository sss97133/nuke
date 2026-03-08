# Scale Extraction Tooling Plan

**The Real Problem**: You need to map **thousands of automotive sites** for data extraction, but manual DOM mapping doesn't scale.

**Your Success**: BMW listing worked perfectly with manual mapping
**The Challenge**: Can't manually map thousands of dealer/auction sites

## 🎯 Solution: Automated Site Mapping Pipeline

### **Phase 1: Auto-Discovery** 
```bash
# Discover automotive sites automatically
node scripts/auto-discover-map-sites.js --search="used car dealers" --geo="US" --max-sites=100
```

**What it does**:
- Searches for automotive sites using multiple strategies
- Filters for sites with vehicle inventories  
- Prioritizes by estimated listing count
- **Output**: List of 100+ mappable automotive sites

### **Phase 2: Auto-Mapping**
```bash  
# Auto-generate extraction patterns for discovered sites
supabase functions invoke auto-site-mapper --data '{"action": "map_batch_sites", "params": {"site_urls": ["site1", "site2"]}}'
```

**What it does**:
- Crawls site structure with Firecrawl
- Analyzes DOM patterns with AI
- Generates CSS selectors for vehicle data
- Tests extraction on sample pages
- **Output**: Ready-to-use extraction schemas

### **Phase 3: Validation & Testing**
```bash
# Test generated extraction patterns  
node scripts/test-extraction-patterns.js --site="dealer.com" --validate
```

**What it does**:
- Tests extraction schemas on live pages
- Validates field coverage and accuracy
- Identifies pattern failures
- **Output**: Confidence scores and reliability metrics

## 🏭 The Automated Factory

### **Input**: Random automotive website URL
### **Output**: Production-ready extraction pattern

```
Website URL
    ↓
Auto Site Mapper (AI analyzes DOM)
    ↓  
Extraction Schema Generated
    ↓
Testing & Validation
    ↓
Stored in data_source_registry
    ↓
Ready for scrape-multi-source
```

## 📊 Scale Targets

| Metric | Target | Current |
|--------|--------|---------|
| **Sites Mapped** | 1,000+ | ~10 manual |
| **Success Rate** | 70%+ | Unknown |
| **Mapping Speed** | 50 sites/hour | Manual only |
| **Field Coverage** | 80%+ | 95% (manual) |

## 🔧 Key Components Built

### 1. **`auto-site-mapper`** - Core mapping engine
- Analyzes DOM structure automatically
- Generates extraction patterns with AI
- Tests patterns on sample pages

### 2. **`auto-discover-map-sites.js`** - Discovery pipeline  
- Finds automotive sites automatically
- Filters for quality/mappability
- Processes in batches

### 3. **Integration with Existing Systems**
- Uses existing `data_source_registry` table
- Compatible with existing `scrape-multi-source` function
- Builds on existing Firecrawl infrastructure

## 🚀 Deployment Strategy

### **Week 1: Proof of Concept**
```bash
# Map 50 sites to prove the system works
./scripts/deploy-agents.sh  # Deploy mapping system
node scripts/auto-discover-map-sites.js --max-sites=50
```

### **Week 2: Scale Test**  
```bash
# Map 500 sites and measure success rates
node scripts/auto-discover-map-sites.js --max-sites=500
```

### **Week 3-4: Production Scale**
```bash  
# Map 1,000+ sites for full coverage
node scripts/auto-discover-map-sites.js --max-sites=1000
# Start automated extraction from mapped sites
```

## 💰 Cost Estimation

| Activity | Cost | Volume |
|----------|------|--------|
| **Site Discovery** | $50 | 1,000 sites |
| **DOM Analysis** | $200 | 1,000 sites × $0.20 |
| **Schema Generation** | $300 | 1,000 sites × $0.30 |
| **Testing/Validation** | $150 | 1,000 sites × $0.15 |
| **Total Mapping Cost** | **$700** | **1,000 sites mapped** |

**ROI**: $700 to map 1,000 sites vs $50,000+ in manual mapping time

## 🎯 Success Criteria

**After 4 weeks you should have**:
- ✅ 1,000+ automotive sites mapped automatically
- ✅ 700+ sites with reliable extraction patterns  
- ✅ 33k+ profiles/day extraction capacity
- ✅ Automated quality monitoring
- ✅ Self-maintaining extraction pipeline

## 📋 Immediate Next Steps

1. **Deploy mapping system**: `./scripts/deploy-agents.sh`
2. **Test on 10 sites**: `node scripts/auto-discover-map-sites.js --max-sites=10`  
3. **Review results** and refine mapping logic
4. **Scale to 100 sites** once system is validated
5. **Scale to 1,000 sites** for full coverage

**This solves the "how do I map thousands of sites" problem with automation instead of manual work.**
