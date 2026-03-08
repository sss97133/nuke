# Ralph Wiggum RLM: Market Intelligence & Investment Analytics Initiative

## Mission Statement
Transform raw vehicle data into actionable market intelligence, algorithmic projections, and investment-grade analytics.

## Current State
- **Data Pipeline**: Craigslist scraper, BaT extraction, multi-source ingestion operational
- **Search**: Performance-optimized with server-side aggregations (just deployed)
- **Gap**: Data exists but lacks interpretation layer - no indexes, no projections, no investment packaging

---

## Phase 1: Market Index Infrastructure

### 1.1 Core Index Definitions
Create foundational market indexes similar to stock market indices:

| Index Name | Description | Components |
|------------|-------------|------------|
| `SQBDY-50` | Squarebody 50 Index | Top 50 most-traded squarebody price movements |
| `CLSC-100` | Classic 100 | 100 highest-value classic vehicles tracked |
| `PROJ-ACT` | Project Activity Index | Build activity momentum indicator |
| `MKTV-USD` | Market Velocity | Transaction volume * avg price delta |
| `RGNL-XX` | Regional Indexes | Per-region pricing indices |

### 1.2 Database Schema
```sql
-- Market indexes table
CREATE TABLE market_indexes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_code TEXT UNIQUE NOT NULL,
  index_name TEXT NOT NULL,
  description TEXT,
  calculation_method JSONB,
  components_query TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index values (time series)
CREATE TABLE market_index_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_id UUID REFERENCES market_indexes(id),
  value_date DATE NOT NULL,
  open_value NUMERIC,
  close_value NUMERIC,
  high_value NUMERIC,
  low_value NUMERIC,
  volume INTEGER,
  components_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(index_id, value_date)
);

-- Index components (what vehicles/segments make up each index)
CREATE TABLE market_index_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_id UUID REFERENCES market_indexes(id),
  component_type TEXT, -- 'vehicle', 'segment', 'make_model'
  component_filter JSONB,
  weight NUMERIC DEFAULT 1.0,
  added_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Phase 2: Algorithmic Projections Engine

### 2.1 Projection Models
Implement multiple projection algorithms:

1. **Moving Average Projections**
   - 7-day, 30-day, 90-day moving averages
   - Trend direction indicators

2. **Seasonal Adjustment Model**
   - Account for seasonal buying patterns
   - Spring/summer premium detection

3. **Comparable Sales Analysis**
   - Find similar vehicles
   - Project value based on comps

4. **Momentum Scoring**
   - Price velocity (rate of change)
   - Volume momentum
   - Listing duration trends

### 2.2 Edge Functions
```
supabase/functions/
├── calculate-market-indexes/     # Daily index calculation
├── generate-projections/         # ML-based price projections
├── analyze-market-segment/       # Segment deep-dive
├── investment-opportunity-scan/  # Find undervalued vehicles
└── portfolio-analyzer/           # Analyze user's garage value
```

---

## Phase 3: Investment Package System

### 3.1 Investment Products
Create structured investment-like products:

| Package Type | Description |
|--------------|-------------|
| **Single Vehicle** | Deep analysis + projection for one vehicle |
| **Segment Bundle** | Track a segment (e.g., "1967-1972 C10s") |
| **Regional Portfolio** | Geographic market exposure |
| **Momentum Picks** | AI-selected appreciation candidates |
| **Index Tracker** | Mirror an index's components |

### 3.2 Package Schema
```sql
CREATE TABLE investment_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  criteria JSONB, -- filters that define the package
  target_allocation JSONB, -- weight distribution
  risk_score NUMERIC,
  projected_return JSONB,
  created_by UUID REFERENCES auth.users(id),
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE package_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES investment_packages(id),
  vehicle_id UUID REFERENCES vehicles(id),
  entry_value NUMERIC,
  current_value NUMERIC,
  weight NUMERIC,
  added_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Phase 4: Analysis Dashboard

### 4.1 New Frontend Components
```
nuke_frontend/src/
├── pages/
│   ├── MarketIntelligence.tsx      # Main dashboard
│   ├── IndexDetail.tsx             # Deep dive on single index
│   ├── ProjectionReport.tsx        # Vehicle/segment projections
│   └── InvestmentBuilder.tsx       # Create custom packages
├── components/
│   ├── market/
│   │   ├── IndexCard.tsx
│   │   ├── IndexChart.tsx
│   │   ├── ProjectionWidget.tsx
│   │   ├── HeatMap.tsx
│   │   └── TrendIndicator.tsx
│   └── investment/
│       ├── PackageBuilder.tsx
│       ├── PortfolioSummary.tsx
│       └── RiskGauge.tsx
└── services/
    ├── marketIndexService.ts
    ├── projectionService.ts
    └── investmentPackageService.ts
```

---

## Phase 5: Recursive Feedback Loop (RLM Pattern)

### 5.1 Self-Improving Analysis
The system should learn from:
1. **Prediction Accuracy** - Track projected vs actual sale prices
2. **User Engagement** - Which insights get clicked/shared
3. **Market Signals** - New data patterns that emerge

### 5.2 Feedback Tables
```sql
CREATE TABLE projection_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  projected_value NUMERIC,
  projected_at TIMESTAMPTZ,
  actual_value NUMERIC,
  actual_at TIMESTAMPTZ,
  accuracy_score NUMERIC, -- calculated: 1 - abs(projected - actual) / actual
  model_version TEXT
);

CREATE TABLE analysis_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_type TEXT,
  analysis_id UUID,
  user_id UUID REFERENCES auth.users(id),
  feedback_type TEXT, -- 'helpful', 'inaccurate', 'outdated'
  feedback_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Implementation Priority

### Immediate (This Session)
1. Create migration for index/projection/package tables
2. Create `calculate-market-indexes` edge function
3. Create `marketIndexService.ts` frontend service
4. Build basic `MarketIntelligence.tsx` dashboard

### Next Session
5. Implement projection algorithms
6. Build investment package builder
7. Add feedback loop infrastructure

### Future
8. ML model training on historical data
9. Real-time index updates via subscriptions
10. Public API for index data

---

## Success Metrics
- [ ] 5+ market indexes calculating daily
- [ ] Projection accuracy > 80% within 10% margin
- [ ] Users creating custom investment packages
- [ ] Feedback loop improving model accuracy over time
