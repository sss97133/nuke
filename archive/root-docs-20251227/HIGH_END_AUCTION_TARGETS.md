# High-End Auction Sites for Auto-Mapping

**Target**: 10 premium auction sites you haven't touched yet
**Goal**: Auto-map DOM structure + create organization profiles
**Value**: Premium vehicles for 1M profile target

## 🎯 **Top 10 High-End Auction Targets**

### **1. Mecum Auctions** ⭐ **PRIORITY #1**
- **URL**: `https://www.mecum.com`
- **Why**: Largest classic car auction house in the world
- **Inventory**: 15,000+ vehicles annually
- **Avg Price**: $50k-$500k+ 
- **Specialty**: Classic cars, muscle cars, motorcycles
- **Org Profile Needed**: ✅ Major auction house

### **2. Barrett-Jackson** ⭐ **PRIORITY #2**  
- **URL**: `https://www.barrett-jackson.com`
- **Why**: Most prestigious American auction house
- **Inventory**: 1,800+ vehicles per event, 4 events/year
- **Avg Price**: $100k-$1M+
- **Specialty**: High-end classics, supercars, customs
- **Org Profile Needed**: ✅ Premier auction brand

### **3. RM Sotheby's** ⭐ **PRIORITY #3**
- **URL**: `https://rmsothebys.com`
- **Why**: Ultra-premium international auctions
- **Inventory**: 500+ vehicles per event, 12+ events/year  
- **Avg Price**: $200k-$5M+
- **Specialty**: Rare classics, supercars, racing heritage
- **Org Profile Needed**: ✅ Sotheby's automotive division

### **4. Bonhams** 
- **URL**: `https://www.bonhams.com/departments/CAR/`
- **Why**: International luxury auction house
- **Inventory**: 300+ vehicles per event
- **Avg Price**: $150k-$2M+
- **Specialty**: European classics, vintage racing
- **Org Profile Needed**: ✅ Historic auction house (1793)

### **5. Gooding & Company**
- **URL**: `https://www.goodingco.com`  
- **Why**: Pebble Beach auction specialist
- **Inventory**: 150+ vehicles per event, 3-4 events/year
- **Avg Price**: $300k-$3M+
- **Specialty**: Concours-level classics, Ferrari, Porsche
- **Org Profile Needed**: ✅ Premium specialty auctions

### **6. Worldwide Auctioneers**
- **URL**: `https://www.worldwideauctioneers.com`
- **Why**: Auburn Cord Duesenberg specialist
- **Inventory**: 200+ vehicles per event
- **Avg Price**: $75k-$800k
- **Specialty**: Pre-war classics, Auburn Cord Duesenberg
- **Org Profile Needed**: ✅ Auburn focus

### **7. Russo and Steele**
- **URL**: `https://www.russoandsteele.com`
- **Why**: Arizona auction week participant
- **Inventory**: 400+ vehicles per event
- **Avg Price**: $60k-$400k
- **Specialty**: Muscle cars, customs, hot rods
- **Org Profile Needed**: ✅ Scottsdale auctions

### **8. Artcurial (Retromobile)**
- **URL**: `https://www.artcurial.com/en/departments/motorcars-2`
- **Why**: Premier European auction house
- **Inventory**: 150+ vehicles (Retromobile event)
- **Avg Price**: $100k-$2M+
- **Specialty**: European classics, French cars, racing
- **Org Profile Needed**: ✅ Paris-based premium

### **9. Silverstone Auctions**
- **URL**: `https://www.silverstoneauctions.com`
- **Why**: UK's leading classic car auctions
- **Inventory**: 100+ vehicles per event, 6+ events/year
- **Avg Price**: $80k-$600k
- **Specialty**: British classics, sports cars, racing
- **Org Profile Needed**: ✅ UK auction leader

### **10. Cars & Bids** ⭐ **MODERN FOCUS**
- **URL**: `https://carsandbids.com`
- **Why**: Doug DeMuro's modern enthusiast platform
- **Inventory**: 50+ vehicles weekly
- **Avg Price**: $30k-$200k
- **Specialty**: 1980s-2010s enthusiast cars
- **Org Profile Needed**: ✅ Modern classic focus

## 🚀 **Auto-Mapping Command**

```bash
cd /Users/skylar/nuke

# Deploy the mapper
supabase functions deploy auto-site-mapper

# Test on these 10 high-end sites
node scripts/auto-discover-map-sites.js --sites="mecum.com,barrett-jackson.com,rmsothebys.com,bonhams.com,goodingco.com,worldwideauctioneers.com,russoandsteele.com,artcurial.com,silverstoneauctions.com,carsandbids.com"
```

## 📊 **Expected Results**

| Site | Complexity | Success Probability | Vehicle Count |
|------|------------|-------------------|---------------|
| **Mecum** | Medium | 85% | 15,000/year |
| **Barrett-Jackson** | Medium | 80% | 7,200/year |
| **RM Sotheby's** | High | 70% | 6,000/year |
| **Bonhams** | High | 70% | 3,600/year |
| **Cars & Bids** | Low | 95% | 2,600/year |

**Total Potential**: 34,400+ premium vehicles/year

## 🏢 **Organization Profiles Created**

Each mapped site automatically gets an organization profile:

```typescript
// Auto-generated organization profile
{
  organization_name: "Mecum Auctions",
  organization_type: "auction_house", 
  website_url: "https://mecum.com",
  specialties: ["classic_cars", "muscle_cars", "motorcycles"],
  geographic_focus: ["US"],
  price_range: "premium",
  annual_volume: 15000,
  reputation_score: 95,
  extraction_patterns: {...}, // Auto-generated DOM mapping
  last_mapped: "2025-12-20"
}
```

## 🎯 **Why These 10 Sites**

1. **Premium inventory** (avg $100k+ vehicles)
2. **High volume** (34k+ vehicles/year combined)  
3. **International coverage** (US + Europe)
4. **Different platforms** (good for testing mapper versatility)
5. **Strong brands** worth having organization profiles for
6. **You haven't touched them** (fresh targets)

**Ready to auto-map these 10 premium auction sites?** This gives you serious high-value inventory for the 1M profile goal.
