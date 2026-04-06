# Engineering Manual: Intelligence Surface Build Guide

## Step-by-Step Construction Guide for the User-Facing Intelligence Layer

**Date**: 2026-03-31
**Prerequisite reading**:
- `docs/library/intellectual/discourses/the-knowing-system.md` — Philosophy
- `docs/library/intellectual/papers/use-case-atlas.md` — Use cases served
- `docs/library/technical/design-book/11-intelligence-surface.md` — Design specs
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md` — Architecture

---

## Build Sequence Overview

```
Phase 1: Vehicle Briefing (enhances vehicle profile)
  1.1  vehicle_briefing_data() — DB function
  1.2  <VehicleBriefing /> — master component
  1.3  <BriefingHeadline /> — L0
  1.4  <MarketPositionCard /> — L1
  1.5  <TrustAssessmentCard /> — L1
  1.6  <RiskSignalsCard /> — L1
  1.7  <CommunityPulseCard /> — L1
  1.8  <HistoryPatternCard /> — L1
  1.9  Integration into VehicleProfile page

Phase 2: Seller Coaching (new tab on vehicle profile)
  2.1  coaching_plan() — DB function
  2.2  Enhanced <AuctionReadinessCard />
  2.3  <ListingPreview />
  2.4  <PhotoCoaching />
  2.5  CoachingTab integration

Phase 3: Browse Enhancement (enhances browse/search)
  3.1  <SmartSearchBar /> — NL parsing
  3.2  <DensityBadge /> — cross-surface component
  3.3  <MarketPulse /> — browse page section
  3.4  <ValueBadge /> — vehicle card enhancement
  3.5  trending_segments materialized view

Phase 4: Segment Dashboard (new route)
  4.1  segment_dashboard_data() — DB function
  4.2  <PriceTrendChart /> — reusable
  4.3  <CompGrid /> — reusable
  4.4  <SegmentDashboard /> — page component
  4.5  Route registration

Phase 5: Build History + Onboarding
  5.1  <BuildTimeline /> — public tab
  5.2  Homepage featured vehicles
  5.3  Homepage recent sales
```

---

## Phase 1: Vehicle Briefing

### 1.1 vehicle_briefing_data() — Database Function

**Purpose**: Single RPC call that assembles all intelligence data for a vehicle. The frontend calls this once and receives everything it needs to render the entire briefing.

**Why a DB function instead of edge function**: This is a read-only assembly of existing data. No external API calls, no AI inference, no side effects. A SQL function is faster, cheaper, and doesn't count against edge function limits (Hard Rule #1).

**Location**: Supabase migration

```sql
CREATE OR REPLACE FUNCTION vehicle_briefing_data(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  v_signals JSONB;
  v_comps JSONB;
  v_community JSONB;
  v_apparitions JSONB;
  v_trust JSONB;
  v_vehicle RECORD;
BEGIN
  -- Get base vehicle data
  SELECT id, year, make, model, vin, mileage, sale_price, nuke_estimate,
         is_public, user_id
  INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 1. Active analysis signals (ordered by severity for headline selection)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'widget_id', widget_id,
      'category', category,
      'severity', severity,
      'score', score,
      'label', label,
      'recommendation', recommendation,
      'evidence', evidence,
      'confidence', confidence,
      'changed_at', changed_at
    ) ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'warning' THEN 2
        WHEN 'info' THEN 3
        WHEN 'ok' THEN 4
        ELSE 5
      END
  ), '[]'::jsonb) INTO v_signals
  FROM analysis_signals
  WHERE vehicle_id = p_vehicle_id
    AND is_active = true;

  -- 2. Price comparables (top 5 by similarity)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'comp_vehicle_id', pc.comp_vehicle_id,
      'comp_year', cv.year,
      'comp_make', cv.make,
      'comp_model', cv.model,
      'comp_price', pc.comp_price,
      'comp_date', pc.comp_date,
      'comp_platform', pc.comp_platform,
      'similarity_score', pc.similarity_score,
      'thumbnail', (
        SELECT url FROM vehicle_images
        WHERE vehicle_id = pc.comp_vehicle_id
        ORDER BY is_primary DESC NULLS LAST, created_at ASC
        LIMIT 1
      )
    ) ORDER BY pc.similarity_score DESC NULLS LAST
  ), '[]'::jsonb) INTO v_comps
  FROM price_comparables pc
  LEFT JOIN vehicles cv ON cv.id = pc.comp_vehicle_id
  WHERE pc.vehicle_id = p_vehicle_id
  LIMIT 5;

  -- 3. Community intelligence (comment analysis)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sentiment_score', cd.sentiment_score,
      'overall_sentiment', cd.overall_sentiment,
      'themes', cd.themes,
      'total_comments_analyzed', cd.total_comments_analyzed,
      'discovered_at', cd.created_at
    )
  ), '[]'::jsonb) INTO v_community
  FROM comment_discoveries cd
  WHERE cd.vehicle_id = p_vehicle_id;

  -- 4. Market apparitions (listing/sale history across platforms)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'kind', vo.kind,
      'source_name', vo.source_entity,
      'source_url', vo.source_url,
      'observed_at', vo.observed_at,
      'price', (vo.claims->>'price')::numeric,
      'platform', vo.claims->>'platform',
      'outcome', vo.claims->>'outcome'
    ) ORDER BY vo.observed_at ASC
  ), '[]'::jsonb) INTO v_apparitions
  FROM vehicle_observations vo
  WHERE vo.vehicle_id = p_vehicle_id
    AND vo.kind IN ('listing', 'sale_result');

  -- 5. Trust/documentation metrics
  SELECT jsonb_build_object(
    'total_observations', (
      SELECT count(*) FROM vehicle_observations WHERE vehicle_id = p_vehicle_id
    ),
    'source_diversity', (
      SELECT count(DISTINCT source_entity)
      FROM vehicle_observations WHERE vehicle_id = p_vehicle_id
    ),
    'has_vin', (v_vehicle.vin IS NOT NULL AND length(v_vehicle.vin) >= 11),
    'field_evidence_count', (
      SELECT count(*) FROM field_evidence WHERE vehicle_id = p_vehicle_id
    ),
    'photo_count', (
      SELECT count(*) FROM vehicle_images WHERE vehicle_id = p_vehicle_id
    ),
    'work_session_count', (
      SELECT count(*) FROM work_sessions WHERE vehicle_id = p_vehicle_id
    ),
    'earliest_observation', (
      SELECT min(observed_at) FROM vehicle_observations WHERE vehicle_id = p_vehicle_id
    ),
    'latest_observation', (
      SELECT max(observed_at) FROM vehicle_observations WHERE vehicle_id = p_vehicle_id
    ),
    'observation_time_span_days', (
      SELECT EXTRACT(days FROM max(observed_at) - min(observed_at))
      FROM vehicle_observations WHERE vehicle_id = p_vehicle_id
    )
  ) INTO v_trust;

  -- Assemble final result
  result := jsonb_build_object(
    'vehicle_id', v_vehicle.id,
    'year', v_vehicle.year,
    'make', v_vehicle.make,
    'model', v_vehicle.model,
    'vin', v_vehicle.vin,
    'mileage', v_vehicle.mileage,
    'sale_price', v_vehicle.sale_price,
    'nuke_estimate', v_vehicle.nuke_estimate,
    'signals', v_signals,
    'comparables', v_comps,
    'community', v_community,
    'apparitions', v_apparitions,
    'trust', v_trust
  );

  RETURN result;
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION vehicle_briefing_data(UUID) TO anon, authenticated;
```

**Calling from frontend**:
```typescript
const { data } = await supabase.rpc('vehicle_briefing_data', {
  p_vehicle_id: vehicleId
});
```

**Performance considerations**:
- This function touches 5 tables. On a dense vehicle, each subquery is indexed by vehicle_id.
- Expected execution: <100ms for sparse vehicles, <500ms for dense vehicles.
- No pagination needed — the function limits comps to 5 and the other result sets are naturally small per vehicle.
- If performance becomes an issue, add a materialized view with periodic refresh (but start without caching — computation surface principle).

### 1.2 VehicleBriefing Master Component

**File**: `nuke_frontend/src/components/vehicle/intelligence/VehicleBriefing.tsx`

**Directory structure**:
```
src/components/vehicle/intelligence/
├── VehicleBriefing.tsx          # Master component
├── BriefingHeadline.tsx         # L0 headline
├── SignalCard.tsx               # Shared card wrapper
├── MarketPositionCard.tsx       # Market comps
├── TrustAssessmentCard.tsx      # Documentation depth
├── RiskSignalsCard.tsx          # Discrepancy alerts
├── CommunityPulseCard.tsx       # Comment sentiment
├── HistoryPatternCard.tsx       # Apparition timeline
├── useBriefingData.ts           # React Query hook
└── briefing-utils.ts            # Headline generation, density calculation
```

**Hook**:
```typescript
// useBriefingData.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface BriefingData {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  sale_price: number | null;
  nuke_estimate: number | null;
  signals: AnalysisSignal[];
  comparables: Comparable[];
  community: CommunityDiscovery[];
  apparitions: Apparition[];
  trust: TrustMetrics;
}

export function useBriefingData(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicle-briefing', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;
      const { data, error } = await supabase.rpc('vehicle_briefing_data', {
        p_vehicle_id: vehicleId
      });
      if (error) throw error;
      return data as BriefingData | null;
    },
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000, // 5 minutes — briefing data doesn't change rapidly
  });
}
```

**Master component**:
```typescript
// VehicleBriefing.tsx
export function VehicleBriefing({ vehicleId }: { vehicleId: string }) {
  const { data: briefing, isLoading } = useBriefingData(vehicleId);

  // Self-guard: don't render if no data or loading
  if (isLoading || !briefing) return null;

  // Determine which cards have enough data to render
  const hasMarketData = briefing.nuke_estimate || briefing.comparables.length >= 3;
  const hasRiskSignals = briefing.signals.some(s =>
    s.severity === 'critical' || s.severity === 'warning'
  );
  const hasCommunity = briefing.community.length > 0 &&
    briefing.community.some(c => c.total_comments_analyzed > 0);
  const hasHistory = briefing.apparitions.length >= 2;
  const hasTrust = briefing.trust.total_observations > 0;

  // Don't render at all if nothing to show
  if (!hasMarketData && !hasRiskSignals && !hasCommunity && !hasHistory && !hasTrust) {
    return null;
  }

  return (
    <section className="vehicle-briefing">
      <BriefingHeadline briefing={briefing} />
      <div className="signal-cards">
        {hasRiskSignals && <RiskSignalsCard signals={briefing.signals} />}
        {hasMarketData && <MarketPositionCard briefing={briefing} />}
        {hasTrust && <TrustAssessmentCard trust={briefing.trust} />}
        {hasCommunity && <CommunityPulseCard community={briefing.community} />}
        {hasHistory && <HistoryPatternCard apparitions={briefing.apparitions} />}
      </div>
    </section>
  );
}
```

**CSS** (added to `vehicle-profile.css`, NOT a new file):
```css
.vehicle-briefing {
  margin: var(--space-3) 0;
}

.vehicle-briefing .signal-cards {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.vehicle-briefing .signal-cards > * {
  flex: 1;
  min-width: 200px;
}

@media (max-width: 768px) {
  .vehicle-briefing .signal-cards {
    flex-wrap: nowrap;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }

  .vehicle-briefing .signal-cards > * {
    min-width: 280px;
    scroll-snap-align: start;
  }
}
```

### 1.3-1.8 Individual Signal Cards

Each card follows the same pattern. Here is the generic wrapper and one concrete example:

**SignalCard wrapper**:
```typescript
// SignalCard.tsx
interface SignalCardProps {
  title: string;
  children: React.ReactNode;
  evidence?: React.ReactNode;
}

export function SignalCard({ title, children, evidence }: SignalCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="signal-card">
      <div className="signal-card-title">{title}</div>
      <div className="signal-card-content">{children}</div>
      {evidence && (
        <>
          <button
            className="signal-card-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▲ Hide details' : '▼ View details'}
          </button>
          {expanded && (
            <div className="signal-card-evidence">{evidence}</div>
          )}
        </>
      )}
    </div>
  );
}
```

**CSS**:
```css
.signal-card {
  border: 1px solid #E5E7EB;
  padding: var(--space-3);
}

.signal-card-title {
  font-size: 8pt;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-2);
}

.signal-card-content {
  font-size: 8pt;
  color: #000;
}

.signal-card-toggle {
  font-size: 8pt;
  color: #6B7280;
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-1) 0;
  margin-top: var(--space-2);
}

.signal-card-toggle:hover {
  color: #000;
}

.signal-card-evidence {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid #E5E7EB;
}
```

**MarketPositionCard concrete example**:
```typescript
// MarketPositionCard.tsx
export function MarketPositionCard({ briefing }: { briefing: BriefingData }) {
  const { nuke_estimate, sale_price, comparables } = briefing;
  const prices = comparables.map(c => c.comp_price).filter(Boolean);
  const median = prices.length > 0 ? prices.sort((a,b) => a-b)[Math.floor(prices.length/2)] : null;
  const min = prices.length > 0 ? Math.min(...prices) : null;
  const max = prices.length > 0 ? Math.max(...prices) : null;

  const askingPrice = sale_price || nuke_estimate;
  const formatPrice = (n: number) => `$${n.toLocaleString()}`;

  return (
    <SignalCard
      title="Market Position"
      evidence={
        <CompGrid comparables={comparables} />
      }
    >
      {askingPrice && (
        <div style={{ fontWeight: 'bold' }}>
          {sale_price ? 'Asking' : 'Estimated'} {formatPrice(askingPrice)}
        </div>
      )}
      {min && max && (
        <div style={{ color: '#6B7280', marginTop: 'var(--space-1)' }}>
          Comparable range: {formatPrice(min)}–{formatPrice(max)}
        </div>
      )}
      {median && (
        <div style={{ color: '#6B7280' }}>
          Median: {formatPrice(median)} ({comparables.length} sales)
        </div>
      )}
    </SignalCard>
  );
}
```

The other cards (Trust, Risk, Community, History) follow identical structural patterns with different data rendering. The design book spec (11-intelligence-surface.md) defines the content of each.

### 1.9 Integration into VehicleProfile

**File to modify**: `nuke_frontend/src/pages/VehicleProfile.tsx`

**Integration point**: After `<VehicleHeroImage>` and `<VehicleHeader>`, before `<VehicleSubHeader>`.

```typescript
// In VehicleProfile.tsx, add import:
import { VehicleBriefing } from '@/components/vehicle/intelligence/VehicleBriefing';

// In the render, after hero and header:
<VehicleHeroImage ... />
<VehicleHeader ... />
<VehicleBriefing vehicleId={vehicleId} />  {/* NEW */}
<VehicleSubHeader ... />
<BarcodeTimeline ... />
```

The component self-guards (returns null if no intelligence data), so this integration is safe for all vehicles regardless of density.

---

## Phase 2: Seller Coaching

### 2.1 coaching_plan() — Database Function

Similar to vehicle_briefing_data(), this assembles coaching-specific data:
- ARS scores by dimension
- Photo coverage by zone (from image_angle_spectrum)
- Document presence checklist
- Top 3 improvement actions with estimated point gains

```sql
CREATE OR REPLACE FUNCTION coaching_plan(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  v_ars RECORD;
  v_photo_zones JSONB;
  v_actions JSONB;
BEGIN
  -- Get ARS scores
  -- (exact query depends on where ARS is stored — vehicles table or separate)

  -- Get photo zone coverage
  SELECT jsonb_agg(jsonb_build_object(
    'zone', ias.zone_name,
    'covered', EXISTS(
      SELECT 1 FROM vehicle_images vi
      JOIN image_angle_spectrum s ON s.image_id = vi.id
      WHERE vi.vehicle_id = p_vehicle_id AND s.zone_name = ias.zone_name
    )
  )) INTO v_photo_zones
  FROM (SELECT DISTINCT zone_name FROM image_angle_spectrum) ias;

  -- Compute action items
  -- (logic: for each ARS dimension below threshold, generate specific action
  --  with estimated impact based on historical correlation)

  -- ...assembly logic...

  RETURN result;
END;
$$;
```

The exact implementation depends on ARS storage schema. The pattern is: read current state → identify gaps → map gaps to concrete actions → estimate impact.

### 2.2-2.5 Coaching Components

Follow the same component architecture as Phase 1. New directory:

```
src/components/vehicle/coaching/
├── CoachingTab.tsx               # Tab container
├── AuctionReadinessCard.tsx      # Enhanced with actions
├── ListingPreview.tsx            # AI-generated description
├── PhotoCoaching.tsx             # Zone coverage checklist
├── RepairROI.tsx                 # Fix prioritization
└── useCoachingData.ts            # React Query hook
```

The coaching tab registers in VehicleProfile's tab bar, gated by `permissions.isOwner || permissions.isContributor`.

### Listing Description Generation

The `<ListingPreview />` component needs an AI-generated description. This is one of the few places where an edge function is justified (AI inference required).

**Option A**: Use an existing edge function. Check if `extract-vehicle-data-ai` or a similar function can be repurposed for generation (reverse direction: data → description instead of description → data).

**Option B**: New edge function `generate-listing-description`. Must retire an existing function to stay within the ~50 limit. Candidate for retirement: any deprecated extractor.

**Prompt design**: The prompt receives the full vehicle data as structured JSON and produces a platform-appropriate listing description. The prompt itself is documented in `docs/library/prompts/` for reproducibility.

---

## Phase 3: Browse Enhancement

### 3.1 SmartSearchBar

**File**: `nuke_frontend/src/components/search/SmartSearchBar.tsx`

The NL parser is entirely client-side — no API call. It's a series of regex extractions that remove matched tokens from the input and collect them as structured filters.

```typescript
interface ParsedQuery {
  filters: {
    year_min?: number;
    year_max?: number;
    price_min?: number;
    price_max?: number;
    make?: string;
    model?: string;
    body_style?: string;
    drivetrain?: string;
    transmission?: string;
    color?: string;
  };
  remainingText: string; // Whatever wasn't matched — sent as text search
}

function parseNaturalLanguage(input: string): ParsedQuery {
  let text = input.toLowerCase().trim();
  const filters: ParsedQuery['filters'] = {};

  // Extract year patterns
  // "1977" → exact year
  // "1970s" or "70s" → decade range
  // "from the sixties" → decade range
  // ...pattern matching logic...

  // Extract price patterns
  // "under $30k" or "under 30000" → price_max
  // "over $20k" → price_min
  // "$20k-$40k" → range
  // ...pattern matching logic...

  // Extract known makes (lookup table)
  // Extract known models (lookup table)
  // Extract body styles, drivetrains, transmissions, colors

  return { filters, remainingText: text.trim() };
}
```

The known-value lookup tables (makes, models, colors, body styles) can be generated from database aggregations and shipped as static JSON in the frontend bundle.

### 3.2 DensityBadge

**File**: `nuke_frontend/src/components/vehicle/DensityBadge.tsx`

Reusable component. Takes a density level (1-5) and renders the dot indicator.

The density level is computed server-side and included in vehicle list queries. Add a `density_level` column to the vehicles table (computed by trigger on observation changes) or compute inline in list query views.

**Migration** (if adding column):
```sql
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS density_level SMALLINT DEFAULT 1;

-- Batch compute for existing vehicles
-- (follow batched migration principle — 1000 at a time)
```

**Trigger** (updates on new observation):
```sql
CREATE OR REPLACE FUNCTION update_vehicle_density()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE vehicles SET density_level = (
    SELECT CASE
      WHEN obs_count >= 100 AND src_div >= 5 THEN 5
      WHEN obs_count >= 30 AND src_div >= 3 THEN 4
      WHEN obs_count >= 10 AND src_div >= 2 THEN 3
      WHEN obs_count >= 3 THEN 2
      ELSE 1
    END
    FROM (
      SELECT count(*) as obs_count,
             count(DISTINCT source_entity) as src_div
      FROM vehicle_observations
      WHERE vehicle_id = NEW.vehicle_id
    ) x
  )
  WHERE id = NEW.vehicle_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 3.5 trending_segments Materialized View

```sql
CREATE MATERIALIZED VIEW trending_segments AS
SELECT
  v.make,
  v.model,
  count(*) as vehicle_count,
  count(*) FILTER (WHERE ae.sale_price IS NOT NULL) as sale_count,
  avg(ae.sale_price) FILTER (WHERE ae.sale_price IS NOT NULL) as avg_price,
  -- Price change: compare last 30 days avg to previous 30 days avg
  avg(ae.sale_price) FILTER (
    WHERE ae.sale_price IS NOT NULL AND ae.event_date >= NOW() - INTERVAL '30 days'
  ) as recent_avg,
  avg(ae.sale_price) FILTER (
    WHERE ae.sale_price IS NOT NULL
    AND ae.event_date >= NOW() - INTERVAL '60 days'
    AND ae.event_date < NOW() - INTERVAL '30 days'
  ) as previous_avg,
  count(*) FILTER (
    WHERE ae.event_date >= NOW() - INTERVAL '30 days'
  ) as recent_activity
FROM vehicles v
JOIN auction_events ae ON ae.vehicle_id = v.id
WHERE v.make IS NOT NULL AND v.model IS NOT NULL
GROUP BY v.make, v.model
HAVING count(*) >= 10; -- Only segments with meaningful data

CREATE UNIQUE INDEX ON trending_segments (make, model);

-- Refresh weekly (or on cron — existing cron, not new one)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY trending_segments;
```

---

## Phase 4: Segment Dashboard

### Route Registration

**File**: `nuke_frontend/src/routes/DomainRoutes.tsx` (or wherever vehicle routes are registered)

```typescript
// Add to existing routes (not new route file)
<Route path="/market/:make" element={<SegmentDashboard />} />
<Route path="/market/:make/:model" element={<SegmentDashboard />} />
```

### 4.1 segment_dashboard_data() — DB Function

```sql
CREATE OR REPLACE FUNCTION segment_dashboard_data(
  p_make TEXT,
  p_model TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Aggregate: total vehicles, sale count, price stats
  -- Recent sales: last 20 sales with thumbnails
  -- Active listings: current active listings
  -- Time series: monthly price/volume for chart
  -- Stats: avg DOM, sell-through rate, common configs
  -- ...
  RETURN result;
END;
$$;
```

### PriceTrendChart and CompGrid

These are reusable presentation components with no data-fetching logic. They receive data as props.

**PriceTrendChart**: SVG-based (or use a minimal chart library if one is already in the project — check package.json before adding). Input: array of {date, price, platform}. Output: line chart with confidence band.

**CompGrid**: HTML table with thumbnail column. Input: array of comparable vehicles. Output: sortable table with click-through to vehicle profiles.

---

## Testing Strategy

### Database Functions
```sql
-- Test vehicle_briefing_data on a known dense vehicle
SELECT vehicle_briefing_data('6442df03-9cac-43a8-b89e-e4fb4c08ee99'); -- K10

-- Test on a sparse vehicle (find one with few observations)
SELECT vehicle_briefing_data(id)
FROM vehicles
WHERE id NOT IN (SELECT DISTINCT vehicle_id FROM vehicle_observations)
LIMIT 1;
-- Should return null or minimal data
```

### Frontend Components
- Test each signal card with mock data at all density levels
- Test VehicleBriefing with null/empty briefing data → should render nothing
- Test DensityBadge at all 5 levels
- Test SmartSearchBar with 20+ natural language queries → verify filter extraction

### Integration
- Load vehicle profile for K10 truck (dense) → verify all signal cards render
- Load vehicle profile for a sparse vehicle → verify graceful degradation
- Browse page with density badges → verify they render on cards
- Smart search "trucks under 30k" → verify filters extracted correctly

---

## Migration Checklist

Before starting implementation, verify:

- [ ] `analysis_signals` table exists and has data for at least some vehicles
- [ ] `price_comparables` table exists and has data
- [ ] `comment_discoveries` table exists and has data
- [ ] `vehicle_observations` table exists with 'listing' and 'sale_result' kinds
- [ ] `field_evidence` table exists
- [ ] `image_angle_spectrum` table exists (for coaching)
- [ ] `vehicle_images` has `is_primary` or ordering mechanism
- [ ] VehicleProfile.tsx has clear integration point between hero and sub-header
- [ ] React Query is set up in the frontend (already confirmed: @tanstack/react-query v5.90)
- [ ] Supabase client is configured for RPC calls

```sql
-- Quick data availability check
SELECT
  (SELECT count(*) FROM analysis_signals WHERE is_active) as active_signals,
  (SELECT count(DISTINCT vehicle_id) FROM analysis_signals WHERE is_active) as vehicles_with_signals,
  (SELECT count(*) FROM price_comparables) as total_comps,
  (SELECT count(DISTINCT vehicle_id) FROM price_comparables) as vehicles_with_comps,
  (SELECT count(*) FROM comment_discoveries) as comment_discoveries,
  (SELECT count(*) FROM vehicle_observations WHERE kind IN ('listing', 'sale_result')) as listing_observations,
  (SELECT count(*) FROM field_evidence) as evidence_rows;
```

Run this query first. If any critical table is empty, that signal card will simply not render (progressive density), but it's good to know the data landscape before building.

---

## Constraints Reminder

1. **No new edge functions** without retiring one (Phase 2 listing generation is the one exception — identify retirement candidate)
2. **No new tables** — use existing tables, add columns if needed (with migration justification)
3. **DB functions over edge functions** for read-only data assembly
4. **Design system compliance**: Arial 8pt, 0px border-radius, 1px solid borders, no gradients, no shadows
5. **Progressive density**: every component self-guards against empty data
6. **Computation surface**: no caching layer between DB and frontend (staleTime in React Query is acceptable)
7. **Expand don't navigate**: signal card evidence expands in-place, never opens new page
8. **Timeline IS the vehicle**: Build History tab filters the existing timeline, doesn't create parallel system
