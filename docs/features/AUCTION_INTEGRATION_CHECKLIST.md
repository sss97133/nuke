# Auction System Integration Checklist

## Quick Start Guide - 15 Minutes to Live

### Step 1: Add Routes (5 minutes)

Find your router configuration file (likely `nuke_frontend/src/App.tsx` or similar) and add these routes:

```typescript
// Import the new components
import AuctionMarketplace from './pages/AuctionMarketplace';
import CreateAuctionListing from './components/auction/CreateAuctionListing';
import ListingPreparationWizard from './components/auction/ListingPreparationWizard';
import AuctionAnalyticsDashboard from './components/auction/AuctionAnalyticsDashboard';

// Add routes
<Route path="/auctions" element={<AuctionMarketplace />} />
<Route path="/auctions/create" element={<CreateAuctionListing />} />
<Route path="/auctions/prepare" element={<ListingPreparationWizard vehicleId={vehicleId} />} />
<Route path="/auctions/analytics" element={<AuctionAnalyticsDashboard />} />
```

### Step 2: Add Navigation Links (5 minutes)

Add to your main navigation component:

```typescript
// In your navigation component (Header, Navbar, etc.)
<NavLink to="/auctions" className="nav-link">
  Auctions
</NavLink>

<NavLink to="/auctions/create" className="nav-link">
  List Vehicle
</NavLink>

<NavLink to="/auctions/analytics" className="nav-link">
  My Analytics
</NavLink>
```

### Step 3: Add Vehicle Profile Integration (3 minutes)

In your vehicle profile page, add a "Prepare Listing" button:

```typescript
// In VehicleProfile.tsx or similar
import { useNavigate } from 'react-router-dom';

const navigate = useNavigate();

<button
  onClick={() => navigate(`/auctions/prepare?vehicle=${vehicleId}`)}
  className="btn btn-primary"
>
  Prepare for Sale
</button>
```

### Step 4: Deploy Migration (2 minutes)

The migration already exists. Just apply it:

```bash
cd /Users/skylar/nuke

# For production
supabase db push

# OR for local development
supabase migration up --local
```

### Step 5: Test (Optional but Recommended)

Visit each route to verify:
- `/auctions` - Browse auctions
- `/auctions/create` - Create listing
- `/auctions/prepare?vehicle=<id>` - Prepare export
- `/auctions/analytics` - View analytics

---

## Detailed Integration Steps

### If You Need to Customize

#### Styling Integration

If you have a custom design system, update these components:

```typescript
// Replace our basic styles with your design system
// Files to update:
// - AuctionMarketplace.tsx
// - ListingPreparationWizard.tsx
// - AuctionAnalyticsDashboard.tsx
// - CreateAuctionListing.tsx

// Example: Replace Tailwind classes with your system
className="px-4 py-2 bg-blue-600"
// becomes
className={styles.primaryButton}
```

#### Auth Integration

If you use a different auth system, update:

```typescript
// In each component, replace:
import { useAuth } from '../../hooks/useAuth';
const { user } = useAuth();

// With your auth hook:
import { useYourAuth } from 'your-auth-hook';
const { user } = useYourAuth();
```

#### Real-time Subscriptions

If you don't use Supabase real-time, you can remove the subscription code:

```typescript
// In AuctionMarketplace.tsx, remove or replace this:
const channel = supabase
  .channel('auction-updates')
  .on('postgres_changes', { ... })
  .subscribe();

// Add your own polling or WebSocket logic
```

---

## Testing Checklist

### Basic Functionality
- [ ] Can browse auctions at `/auctions`
- [ ] Can create auction at `/auctions/create`
- [ ] Can prepare export at `/auctions/prepare`
- [ ] Can view analytics at `/auctions/analytics`

### Auction Creation Flow
- [ ] Select vehicle from garage
- [ ] Configure auction type (standard vs live)
- [ ] Set pricing (start bid, reserve, buy now)
- [ ] Generate AI description (optional)
- [ ] Successfully create listing
- [ ] Listing appears in database
- [ ] Listing shows in auction browse

### Export Preparation Flow
- [ ] Select vehicle from garage
- [ ] Choose multiple platforms
- [ ] Customize description and pricing
- [ ] Generate platform-specific packages
- [ ] Download exports (JSON, HTML, TXT, CSV)
- [ ] Submit to N-Zero directly
- [ ] Export tracked in database

### Analytics Dashboard
- [ ] Overall metrics display correctly
- [ ] N-Zero auction stats load
- [ ] External platform stats load
- [ ] Platform breakdown shows
- [ ] Status distribution renders
- [ ] Conversion rates calculate

### Database Verification
```sql
-- Check exports table
SELECT * FROM listing_exports ORDER BY created_at DESC LIMIT 10;

-- Check listings table
SELECT * FROM vehicle_listings WHERE status = 'active';

-- Test analytics function
SELECT * FROM get_export_analytics('your-user-id');

-- Test vehicle history function
SELECT * FROM get_vehicle_export_history('your-vehicle-id');
```

---

## Troubleshooting

### Issue: Routes not working

**Solution:**
Make sure you're using React Router v6 syntax:
```typescript
import { Routes, Route } from 'react-router-dom';

<Routes>
  <Route path="/auctions" element={<AuctionMarketplace />} />
</Routes>
```

### Issue: Components not importing

**Solution:**
Check your import paths match your project structure:
```typescript
// Update paths as needed
import AuctionMarketplace from './pages/AuctionMarketplace';
// might need to be
import AuctionMarketplace from '../pages/AuctionMarketplace';
```

### Issue: Migration failing

**Solution:**
```bash
# Check migration status
supabase migration list

# If conflicts, repair
supabase migration repair --status reverted <migration-name>

# Then re-apply
supabase db push
```

### Issue: RLS policies blocking access

**Solution:**
```sql
-- Verify you're authenticated
SELECT auth.uid();

-- Check RLS policies
SELECT * FROM listing_exports WHERE user_id = auth.uid();

-- If empty but should have data, check policy:
SELECT * FROM pg_policies WHERE tablename = 'listing_exports';
```

### Issue: Analytics not loading

**Solution:**
```sql
-- Test RPC function directly
SELECT get_export_analytics('your-user-id');

-- If error, check function exists
SELECT * FROM pg_proc WHERE proname = 'get_export_analytics';

-- Re-apply migration if missing
supabase db reset
```

### Issue: Real-time updates not working

**Solution:**
```typescript
// Enable real-time on your Supabase project
// Settings → API → Realtime

// Verify channel subscription
const channel = supabase
  .channel('test')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'vehicle_listings'
  }, (payload) => {
    console.log('Change received!', payload);
  })
  .subscribe((status) => {
    console.log('Subscription status:', status);
  });
```

---

## Production Deployment

### Pre-deployment Checklist
- [ ] All tests passing
- [ ] Linting errors fixed (already ✅)
- [ ] Migration tested on staging
- [ ] Analytics endpoints working
- [ ] Real-time subscriptions tested
- [ ] Error handling verified
- [ ] Loading states implemented

### Deployment Steps

#### 1. Deploy Database Changes
```bash
# Backup production first
supabase db dump > backup_$(date +%Y%m%d).sql

# Apply migration
supabase db push --db-url "your-production-url"

# Verify
psql "your-production-url" -c "SELECT * FROM listing_exports LIMIT 1;"
```

#### 2. Deploy Frontend
```bash
# Build production bundle
cd nuke_frontend
npm run build

# Deploy (varies by hosting)
vercel --prod  # if using Vercel
# or
netlify deploy --prod  # if using Netlify
```

#### 3. Verify Production
- Visit `/auctions` and verify listings load
- Create test listing
- Prepare test export
- Check analytics dashboard
- Monitor error logs

### Monitoring After Deploy

#### Key Metrics to Watch
```sql
-- Active auctions
SELECT COUNT(*) FROM vehicle_listings WHERE status = 'active';

-- Today's exports
SELECT COUNT(*) FROM listing_exports WHERE DATE(created_at) = CURRENT_DATE;

-- Platform distribution
SELECT platform, COUNT(*) FROM listing_exports GROUP BY platform;

-- Conversion rates
SELECT 
  platform,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold,
  ROUND(100.0 * SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) / COUNT(*), 2) as conversion_rate
FROM listing_exports
GROUP BY platform;
```

#### Error Monitoring
```typescript
// Add error tracking (Sentry, LogRocket, etc.)
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "your-dsn",
  integrations: [new Sentry.BrowserTracing()],
  tracesSampleRate: 1.0,
});
```

---

## Feature Flags (Optional)

If you want to roll out gradually:

```typescript
// In your feature flag system
const FEATURES = {
  auctionMarketplace: true,
  listingExport: true,
  auctionAnalytics: true,
  aiDescriptions: false  // Coming soon
};

// In components
{FEATURES.auctionMarketplace && (
  <Route path="/auctions" element={<AuctionMarketplace />} />
)}
```

---

## User Onboarding

### First-time User Flow

1. **Dashboard Notice:**
```typescript
<Banner>
  New: List your vehicle on N-Zero or prepare exports for BaT, eBay, and more!
  <Link to="/auctions/create">Get Started</Link>
</Banner>
```

2. **Vehicle Profile CTA:**
```typescript
<Card title="Ready to Sell?">
  <p>Choose where to list your vehicle:</p>
  <button onClick={() => navigate('/auctions/create')}>
    Auction on N-Zero
  </button>
  <button onClick={() => navigate('/auctions/prepare')}>
    Export to Other Platforms
  </button>
</Card>
```

3. **Tutorial Tooltips:**
```typescript
<Tooltip text="We'll help you list on BaT, eBay, Craigslist, and more">
  <button>Prepare Listing</button>
</Tooltip>
```

---

## Analytics to Track

### User Behavior
```sql
-- Export wizard usage
SELECT 
  DATE(created_at) as date,
  COUNT(*) as exports_created
FROM listing_exports
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Platform preferences
SELECT 
  platform,
  COUNT(*) as times_selected,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM listing_exports
GROUP BY platform;

-- AI description adoption
SELECT 
  COUNT(*) FILTER (WHERE metadata->>'used_ai' = 'true') as used_ai,
  COUNT(*) FILTER (WHERE metadata->>'used_ai' = 'false') as manual,
  ROUND(100.0 * COUNT(*) FILTER (WHERE metadata->>'used_ai' = 'true') / COUNT(*), 2) as ai_adoption_rate
FROM listing_exports;
```

### Revenue Tracking
```sql
-- Monthly revenue
SELECT 
  DATE_TRUNC('month', sold_at) as month,
  SUM(commission_cents) / 100.0 as total_commission,
  COUNT(*) as sales_count,
  AVG(sold_price_cents) / 100.0 as avg_sale_price
FROM listing_exports
WHERE status = 'sold'
GROUP BY DATE_TRUNC('month', sold_at)
ORDER BY month DESC;

-- Platform ROI
SELECT 
  platform,
  COUNT(*) as total_exports,
  SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sales,
  SUM(commission_cents) / 100.0 as revenue,
  ROUND(AVG(CASE WHEN status = 'sold' THEN commission_cents END) / 100.0, 2) as avg_commission
FROM listing_exports
GROUP BY platform
ORDER BY revenue DESC;
```

---

## Success Criteria

### Week 1 Goals
- [ ] 10+ exports created
- [ ] 3+ N-Zero auctions live
- [ ] Zero critical bugs
- [ ] User feedback collected

### Month 1 Goals
- [ ] 100+ exports created
- [ ] 20+ N-Zero auctions completed
- [ ] First external platform sale
- [ ] 50%+ export-to-submission rate

### Quarter 1 Goals
- [ ] 1,000+ exports created
- [ ] 100+ N-Zero sales
- [ ] $50k+ in commissions
- [ ] 70%+ conversion rate

---

## Support Resources

### Documentation
- [Full System Docs](./docs/AUCTION_SYSTEM_COMPLETE_v2.md)
- [Architecture Diagram](./AUCTION_SYSTEM_ARCHITECTURE.md)
- [Quick Start](./AUCTION_MARKETPLACE_READY.md)

### Code References
- Components: `nuke_frontend/src/pages/` and `nuke_frontend/src/components/auction/`
- Services: `nuke_frontend/src/services/listingExportService.ts`
- Migration: `supabase/migrations/20251122_listing_export_tracking.sql`

### Database Queries
```sql
-- Debug exports
SELECT * FROM listing_exports WHERE user_id = 'your-id' ORDER BY created_at DESC;

-- Debug listings
SELECT * FROM vehicle_listings WHERE seller_id = 'your-id' ORDER BY created_at DESC;

-- Test analytics
SELECT * FROM get_export_analytics('your-user-id');
SELECT * FROM get_vehicle_export_history('your-vehicle-id');
```

---

## Next Steps After Integration

### Immediate (Week 1)
1. Add feature announcement
2. Create help docs
3. Set up error monitoring
4. Start analytics tracking

### Short-term (Month 1)
1. Gather user feedback
2. A/B test descriptions
3. Optimize conversion
4. Add more platforms

### Long-term (Quarter 1)
1. API integrations (eBay, BaT)
2. Auto-submission features
3. Pricing suggestions (AI)
4. Auction scheduling

---

**Status:** Ready to Integrate  
**Estimated Time:** 15-30 minutes  
**Complexity:** Low  
**Risk:** Minimal (all additive, no breaking changes)

