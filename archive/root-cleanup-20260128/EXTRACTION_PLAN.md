# BaT Extraction Plan - SIMPLE & PROVEN

## What Works (Battle-Tested)

1. **extract-premium-auction** (v128) - Extracts vehicle + specs + images + VIN
2. **extract-auction-comments** - Extracts comments + bids
3. **Two-step = Complete vehicle**

## Quick Start

### Extract ONE vehicle:
```bash
./scripts/extract-bat-simple.sh "https://bringatrailer.com/listing/..."
```

### Extract BATCH (10 vehicles):
```bash
./scripts/extract-bat-batch.sh
```

### Verify results:
- BaT Org: https://nuke.ag/org/bring-a-trailer
- Homepage: https://nuke.ag/

## Current Status
- **143 BaT vehicles** in database
- **1,484 comments** extracted
- **3,258 bids** extracted

## Today's Goals
1. ✅ Extract 10 more vehicles using batch script
2. ✅ Verify they appear in BaT org page
3. ✅ Scale to 50 vehicles
4. 🎯 Queue processor for automation

## The System

### Proven Method (Use This)
```
URL → extract-premium-auction → Vehicle ID
Vehicle ID → extract-auction-comments → Comments/Bids
= Complete extraction
```

### New System (For Later)
- `extract-bat-member-comments` - Discovers URLs via member profiles
- `process-bat-extraction-queue` - Automated queue processing
- Chain reaction triggers vehicle extractions

## Commands

### Extract one:
```bash
./scripts/extract-bat-simple.sh "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"
```

### Extract batch:
```bash
./scripts/extract-bat-batch.sh
```

### Check database:
```sql
SELECT COUNT(*) FROM vehicles WHERE discovery_source LIKE '%bat%';
SELECT COUNT(*) FROM bat_comments;
SELECT COUNT(*) FROM bat_bids;
```

### View on frontend:
- Org page: https://nuke.ag/org/bring-a-trailer
- All vehicles: https://nuke.ag/vehicles
- Homepage: https://nuke.ag/

## What NOT to do
- ❌ Don't use untested functions
- ❌ Don't use complex member profile scripts yet
- ❌ Don't queue without vehicle_id
- ✅ Use the proven two-step method

## Next Steps
1. Run batch script
2. Verify results on frontend
3. Scale up
4. Then optimize with queue automation

