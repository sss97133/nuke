# Extraction Requirements

## Core Principle

**Extract ALL available data from the source, then map to database.**

Do NOT try to fill database fields. Instead:
1. Parse the entire source (HTML, JSON, API)
2. Extract everything available
3. Store raw extraction
4. Map what fits to database
5. Track what couldn't be stored

## Data Sources & Expected Fields

### Bring a Trailer (BaT)
- **Images**: 20-100+ per listing (gallery + interior/exterior)
- **VIN**: Usually in specs section
- **Price**: Final bid or sale price
- **Mileage**: In title or specs
- **Comments**: 50-500+ per listing
- **Bids**: Full bid history with usernames/timestamps
- **Seller**: Name, location, history

### Cars & Bids
- **Images**: 30-80 per listing
- **VIN**: In vehicle details
- **Price**: Current/final bid
- **Mileage**: In title
- **Comments**: 20-200 per listing
- **Bids**: Full bid history
- **Data location**: `__NEXT_DATA__` JSON blob

### Classic.com
- **Images**: 10-50 per listing
- **Price**: Asking or sold price
- **Mileage**: Variable
- **Location**: Dealer/seller location
- **Data location**: JSON-LD + DOM

## Completeness Definition

A "complete" profile has:
- [ ] VIN (17 chars, valid format)
- [ ] Price (> 0)
- [ ] Mileage (>= 0)
- [ ] 5+ images uploaded to storage
- [ ] Year, Make, Model
- [ ] Source URL preserved

Target: 80%+ completeness = success

## Quality Checks

After extraction, verify:
1. **Image count**: Source gallery count vs extracted count
2. **Field coverage**: % of source fields we captured
3. **Data accuracy**: VIN format valid, price reasonable, mileage reasonable
4. **No data loss**: If source has field X, we should have it

## Failure Handling

When extraction fails:
1. Save partial results (don't lose what we got)
2. Log specific failure reason
3. Queue for retry with different method
4. Track failure patterns by source
