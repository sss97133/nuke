# Vehicle Acquisition Tracking & Rating System

## Business Use Cases Supported

### 1. **Historical Vehicle Tracking**
- **Past BAT Sales**: Import vehicles you've sold on BAT with `relationship_type: 'previously_owned'`
- **Consignment History**: Track vehicles consigned through organizations with `fleet_role: 'consignment'`
- **Story Preservation**: Upload images and history to maintain vehicle legacy

### 2. **Acquisition Pipeline Management**
- **Prospect Discovery**: Drop marketplace URLs to create `discovered` vehicles
- **Client Presentation**: Curate vehicles under business profile for professional presentation
- **Status Tracking**: Monitor acquisition opportunities with automated rating

### 3. **Business Operations**
- **Inventory Management**: Track current and target acquisitions
- **Client Sourcing**: Professional vehicle curation for specific budgets
- **Market Intelligence**: Automated acquisition quality assessment

## Technical Implementation

### **Phase 1: Enhanced URL Import for Business Context**

When importing vehicles via URL, the system now:

1. **Detects Source**: Supports BAT, Facebook Marketplace, Craigslist, AutoTrader, Cars.com
2. **Sets Relationship**: Automatically sets `relationship_type: 'discovered'`
3. **Business Association**: Links to user's business if they have one
4. **Fleet Integration**: Adds to business_vehicle_fleet with appropriate `fleet_role`

### **Phase 2: Acquisition Rating Engine**

Automated assessment using existing vehicle data:

```sql
-- Acquisition Quality Score Calculation
CREATE OR REPLACE FUNCTION calculate_acquisition_score(vehicle_id UUID, target_budget NUMERIC)
RETURNS JSON AS $$
DECLARE
    vehicle_data RECORD;
    score_breakdown JSON;
    overall_score INTEGER;
BEGIN
    SELECT * INTO vehicle_data FROM vehicles WHERE id = vehicle_id;

    -- Price Analysis (30% weight)
    price_score := CASE
        WHEN vehicle_data.asking_price <= target_budget * 0.8 THEN 100
        WHEN vehicle_data.asking_price <= target_budget THEN 80
        WHEN vehicle_data.asking_price <= target_budget * 1.2 THEN 60
        ELSE 30
    END;

    -- Market Data Analysis (25% weight)
    market_score := calculate_market_position(vehicle_data.make, vehicle_data.model, vehicle_data.year);

    -- Condition Assessment (20% weight)
    condition_score := COALESCE(vehicle_data.condition_rating * 10, 70);

    -- Documentation Quality (15% weight)
    doc_score := calculate_documentation_score(vehicle_id);

    -- Opportunity Score (10% weight)
    opportunity_score := calculate_opportunity_score(vehicle_data);

    overall_score := (price_score * 0.3 + market_score * 0.25 + condition_score * 0.2 +
                     doc_score * 0.15 + opportunity_score * 0.1)::INTEGER;

    RETURN json_build_object(
        'overall_score', overall_score,
        'price_score', price_score,
        'market_score', market_score,
        'condition_score', condition_score,
        'documentation_score', doc_score,
        'opportunity_score', opportunity_score,
        'recommendation', get_acquisition_recommendation(overall_score)
    );
END;
$$ LANGUAGE plpgsql;
```

### **Phase 3: Business Curation Dashboard**

Professional vehicle presentation interface:

- **Client Portfolio View**: Clean, branded presentation of curated acquisitions
- **Budget Filtering**: Show only vehicles within client's stated budget
- **Automated Insights**: AI-generated acquisition rationale and talking points
- **Status Management**: Track which vehicles have been presented, discussed, or rejected

### **Phase 4: Marketplace Integration Enhancements**

#### Facebook Marketplace
- **Limited Extraction**: Basic URL parsing due to anti-bot measures
- **Manual Enhancement**: System prompts for key data entry
- **Image Placeholder**: Requires manual image upload

#### Craigslist
- **Moderate Extraction**: Title, price, basic year/make/model
- **Pattern Recognition**: Improved parsing for common listing formats
- **Geographic Context**: Location extraction for sourcing logistics

#### Enhanced BAT Integration
- **Historical Data**: Access to sold listings for market analysis
- **Bidding Intelligence**: Track final sale prices vs estimates
- **Network Effect**: See what other collectors are buying

## Workflow Examples

### **Sourcing for Client ($20k Budget)**

1. **Discovery Phase**: Drop 10-15 marketplace URLs of potential matches
2. **Automated Scoring**: System rates each against budget and preferences
3. **Curation**: Select top 5 based on acquisition scores
4. **Presentation**: Share professional portfolio via business profile
5. **Decision Tracking**: Monitor client feedback and final decisions

### **Historical Vehicle Documentation**

1. **BAT Import**: Paste URL of vehicle you previously sold
2. **Relationship Update**: Change to 'previously_owned', add sale date
3. **Story Addition**: Upload your ownership photos and history
4. **Public Sharing**: Make story visible to current owner and enthusiasts

### **Consignment Management**

1. **Organization Import**: Add vehicle under business fleet with 'consignment' role
2. **Project Tracking**: Set target sale price, estimated completion
3. **Progress Updates**: Timeline events for work completed
4. **Client Communication**: Branded updates and photo sharing

## Database Schema Extensions

The existing schema already supports most functionality:

- **business_vehicle_fleet**: Links vehicles to businesses with roles
- **vehicles**: Core vehicle data with BAT-specific fields
- **auction_listings**: For creating internal auction/sale listings
- **timeline_events**: Track all vehicle interactions and updates

## Next Steps

1. ✅ **Multi-site URL scraper** - Complete
2. 🔨 **Acquisition scoring engine** - Design complete, needs implementation
3. 🔨 **Business curation dashboard** - Leverage existing business/fleet tables
4. 🔨 **Client presentation interface** - Professional vehicle portfolio views
5. 🔨 **Automated market intelligence** - Integration with existing pricing data

This system leverages your existing robust infrastructure while adding the specific workflows needed for professional vehicle sourcing and historical documentation.