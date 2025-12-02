# VIN API Integration Guide

## Overview

The Nuke platform supports multiple VIN data sources for decoding vehicle information. This document outlines available APIs, their capabilities, and how to integrate them.

## Current Implementation

### NHTSA VPIC (Default - FREE)
- **Provider**: National Highway Traffic Safety Administration
- **Cost**: FREE, unlimited
- **Coverage**: US vehicles + imports sold in US
- **Documentation**: https://vpic.nhtsa.dot.gov/api/
- **Status**: ✅ Implemented

**Capabilities:**
- VIN decoding (~150 data points)
- Make, model, year, trim
- Engine specifications
- Body type, doors, seats
- Manufacturing plant info
- Safety equipment details

**Endpoints Used:**
```
GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{VIN}?format=json
GET https://api.nhtsa.gov/recalls/recallsByVehicle?vin={VIN}
```

## Additional Data Sources

### Recalls & Safety Data (FREE)
- **NHTSA Recalls API**: Open recalls by VIN
- **NHTSA Complaints**: Owner complaints database
- **NHTSA Investigations**: Safety investigation data
- **Status**: ✅ Recalls implemented

### Commercial VIN APIs

#### 1. VIN API (vinapi.net)
- **Free Tier**: 1,000 calls/month
- **Pro**: $199/mo (10,000 calls)
- **Enterprise**: $499/mo (100,000 calls)
- **Features**: Global coverage, detailed specs

#### 2. API.VIN (api.vin)
- **Pricing**: ~$100/mo starting
- **Features**: Equipment lists, technical details
- **Good For**: Detailed OEM specifications

#### 3. DataOne Software
- **Pricing**: Enterprise (custom)
- **Features**: Exact trim matching, OEM build sheets, optional equipment
- **Good For**: Dealerships, professional shops

#### 4. Auto.dev
- **Pricing**: Custom plans
- **Features**: VIN decode + recall data + style IDs
- **Good For**: Large-scale applications

### Vehicle History APIs (Title, Ownership, Accidents)

#### NMVTIS Providers (Title History)
NMVTIS is the federal database of title brands, but has NO direct API. Access only through approved providers:

| Provider | Price/Lookup | Features |
|----------|--------------|----------|
| **VinAudit** | ~$10 | Title history, brands, odometer |
| **Carfax** | ~$40 | Comprehensive history, maintenance |
| **AutoCheck** | ~$25 | Experian data, auction history |
| **ClearVin** | ~$5 | Basic NMVTIS data |

**Data Available:**
- Title brands (salvage, flood, rebuilt)
- Odometer readings over time
- Total loss events
- State title history

**NOT Available:**
- Owner names (privacy protected)
- Registration details
- Personal information

#### NICB VINCheck (FREE - Theft & Total Loss)
- **Provider**: National Insurance Crime Bureau
- **Cost**: FREE (5 lookups per day)
- **URL**: https://www.nicb.org/vincheck
- **Data**: Theft status, insurance total loss records
- **API**: ❌ No public API (web scraping only)

## Implementation Examples

### Basic VIN Decode
```typescript
import { useVINDecoder } from '@/hooks/useVINDecoder';

function VehicleForm() {
  const { decodeVIN, decoding, result } = useVINDecoder();
  
  const handleVINInput = async (vin: string) => {
    const decoded = await decodeVIN(vin);
    
    if (decoded.valid) {
      // Auto-fill form with decoded data
      setFormData({
        make: decoded.make,
        model: decoded.model,
        year: decoded.year,
        engine_size: decoded.engine_size,
        fuel_type: decoded.fuel_type
      });
    }
  };
  
  return (
    <input 
      onBlur={(e) => handleVINInput(e.target.value)}
      disabled={decoding}
    />
  );
}
```

### Check Recalls
```typescript
import { useVINDecoder } from '@/hooks/useVINDecoder';

function RecallChecker({ vin }: { vin: string }) {
  const { getRecalls, recalls } = useVINDecoder();
  
  useEffect(() => {
    if (vin) {
      getRecalls(vin);
    }
  }, [vin]);
  
  return (
    <div>
      {recalls && recalls.recall_count > 0 && (
        <Alert variant="warning">
          {recalls.recall_count} open recall(s) found
        </Alert>
      )}
    </div>
  );
}
```

### Batch Import
```typescript
import { useVINDecoder } from '@/hooks/useVINDecoder';

function BulkVehicleImport() {
  const { batchDecode } = useVINDecoder();
  
  const handleCSVImport = async (vins: string[]) => {
    const results = await batchDecode(vins);
    
    const successful = results.filter(r => r.valid);
    const failed = results.filter(r => !r.valid);
    
    console.log(`Decoded: ${successful.length}, Failed: ${failed.length}`);
  };
}
```

## VIN Input Methods

The platform supports VIN entry through multiple channels:

### 1. Manual Typing ✅
- User types VIN in form field
- Real-time validation
- Auto-decode on blur

### 2. Image OCR ✅
- Scan VIN plate
- Scan vehicle title
- Scan registration
- Uses OpenAI Vision API

### 3. License Plate Lookup 🚧
- **Status**: Planned
- Requires state DMV API access
- Privacy restrictions apply
- May require legal authorization

### 4. Bulk CSV Import 🚧
- **Status**: Planned
- Upload CSV with VINs
- Batch decode via NHTSA
- Progress tracking

### 5. Web Scraping ✅
- Automated discovery from online listings
- Extract VIN from descriptions
- Validate and decode

## Data Flow

```
VIN Input
    ↓
Normalize & Validate (check digit)
    ↓
Check Cache (7 day TTL)
    ↓
[Cache Hit] → Return cached data
    ↓
[Cache Miss] → Call NHTSA VPIC API
    ↓
Parse & Enrich Response
    ↓
Store in Cache
    ↓
Return to Application
    ↓
Auto-fill Vehicle Form
    ↓
Check for Recalls (background)
    ↓
Display Warnings if Recalls Found
```

## Collaborative VIN Handling

### Current Problem
VINs have a UNIQUE constraint, causing errors when multiple users try to add the same vehicle.

### Solution Architecture

**Remove unique constraint:**
```sql
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_vin_key;
```

**Allow multiple entries per VIN:**
- VIN becomes a canonical identifier (like Wikipedia)
- Multiple users can contribute to same vehicle profile
- Use `vehicle_user_permissions` for access control
- Implement `ownership_type` field:
  - `owner` - Current title holder
  - `previous_owner` - Past owner
  - `dealer` - Dealership selling/sold vehicle
  - `enthusiast` - Fan/researcher
  - `technician` - Shop/mechanic working on it
  - `appraiser` - Professional assessment

**Verification Hierarchy:**
- Title scan = highest trust
- VIN plate photo = high trust
- Manual entry = lowest trust
- Consensus = multiple users agree on data

## Future Enhancements

### Planned Integrations
- [ ] Commercial VIN API fallback (when NHTSA lacks data)
- [ ] NMVTIS provider integration (VinAudit for title history)
- [ ] NICB theft check integration
- [ ] DMV registration lookup (state-specific)
- [ ] Auction history (Copart/IAA scraping)
- [ ] Service history (Carfax API if available)

### Advanced Features
- [ ] VIN-based duplicate detection
- [ ] Conflict resolution when multiple users have different data
- [ ] Data quality scoring based on source
- [ ] Automatic data enrichment pipeline
- [ ] Historical tracking of VIN data changes

## Cost Analysis

### Current (Free Tier)
- NHTSA VPIC: $0 (unlimited)
- NHTSA Recalls: $0 (unlimited)
- Total: **$0/month**

### With Commercial APIs
- NHTSA (primary): $0
- VIN API (fallback): $199/mo (10K calls)
- VinAudit (history): ~$1,000/mo (100 lookups)
- Total: **~$1,200/month** at scale

### Recommendation
Start with free NHTSA, add commercial APIs only when:
1. User explicitly requests title history
2. NHTSA decode fails (rare/foreign vehicles)
3. User pays for premium features

## Legal Considerations

### DPPA (Driver's Privacy Protection Act)
- Prohibits disclosure of personal information from DMV records
- Includes: name, address, SSN, photos, medical info
- Does NOT include: VIN, make, model, year

### Permissible Uses
- ✅ VIN decoding (manufacturer data)
- ✅ Recall lookups
- ✅ Safety ratings
- ✅ Theft checks
- ❌ Owner name/address without consent
- ❌ Registration details

### Best Practices
1. Only collect VINs, not personal info
2. Display recalls as public safety information
3. Don't store or display owner PII
4. Use NMVTIS providers for title data (they handle compliance)
5. Obtain user consent before pulling paid reports

## Environment Variables

Add to `.env`:
```bash
# VIN Decoder APIs
VITE_VIN_API_KEY=           # Optional: vinapi.net key for premium features
VITE_VINAUDIT_API_KEY=      # Optional: VinAudit for title history
VITE_DATAONE_API_KEY=       # Optional: DataOne for OEM specs

# Nuke uses NHTSA (free) by default, these are for future enhancements
```

## Support & Documentation

- **NHTSA VPIC Docs**: https://vpic.nhtsa.dot.gov/api/
- **NHTSA Recalls**: https://www.nhtsa.gov/nhtsa-datasets-and-apis
- **NMVTIS Info**: https://vehiclehistory.bja.ojp.gov/
- **Our Implementation**: `/nuke_frontend/src/services/vinDecoder.ts`

## Questions?

Contact the platform team or see `/docs/` for more information.

