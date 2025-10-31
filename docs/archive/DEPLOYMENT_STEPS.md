# Auction Market Engine - Deployment Steps

**October 20, 2025** | Production Ready

---

## ✅ Pre-Deployment Verification

Run the deployment script first:
```bash
chmod +x DEPLOY_AUCTION_MARKET.sh
./DEPLOY_AUCTION_MARKET.sh
```

**Expected Output:**
```
✓ Supabase CLI found
✓ Node.js found
✓ Migration file found
✓ Service file found
✓ All UI components found
✓ Integration wrapper ready
✓ Build check passed
```

---

## 🚀 Deployment Stages

### Stage 1: Database Migration (10-15 minutes)

**Command:**
```bash
cd /Users/skylar/nuke
supabase db push
```

**What This Does:**
- Creates 14 new tables
- Creates 3 materialized views
- Adds all indexes for performance
- Enables Row-Level Security (RLS)
- Sets up data constraints

**Verification:**
```bash
# Verify tables were created
supabase db list-tables

# Check for:
✓ vehicle_offerings
✓ market_orders
✓ market_trades
✓ share_holdings
✓ leaderboard_snapshots
✓ And 9 more tables
```

### Stage 2: Frontend Build (2-3 minutes)

**Command:**
```bash
npm run build
```

**What This Does:**
- Compiles TypeScript
- Bundles React components
- Optimizes for production
- Generates source maps for debugging

**Expected Output:**
```
✓ 0 TypeScript errors
✓ Build complete
```

### Stage 3: Deploy to Production (5-10 minutes)

**Command (for Vercel):**
```bash
npm run deploy
# OR manually trigger in Vercel dashboard
```

**Command (for Docker/Other):**
```bash
# Build Docker image
docker build -t nuke-auction-market .

# Push to registry
docker push your-registry/nuke-auction-market

# Deploy container
# (Your deployment process)
```

**Verification:**
```bash
# Test the deployed URL
curl https://your-app.vercel.app/api/health

# Expected: { "status": "ok" }
```

### Stage 4: Smoke Testing (10-15 minutes)

**Test Trading Flow:**
```javascript
// 1. Navigate to a vehicle page
// 2. Click trading tab
// 3. Try placing a buy order
// 4. Verify order appears in order book
// 5. Verify portfolio updates
```

**Test API Endpoints (if added):**
```bash
# Place order
curl -X POST https://your-app/api/orders \
  -H "Content-Type: application/json" \
  -d '{"offering_id":"...", "order_type":"buy", "shares":5, "price":110}'

# Get leaderboard
curl https://your-app/api/leaderboard

# Get portfolio
curl https://your-app/api/portfolio/:user_id
```

### Stage 5: Load Testing (20-30 minutes)

**Test with Concurrent Users:**
```bash
# Install k6
brew install k6

# Run load test script
k6 run load-test.js --vus 100 --duration 5m
```

**Expected Results:**
- Order matching: < 100ms
- Order book: < 50ms
- Portfolio: < 100ms
- P95 latency: < 200ms
- Error rate: < 0.1%

---

## 📋 Pre-Flight Checklist

Before deploying to production:

### Database
- [ ] Supabase project created and configured
- [ ] Environment variables set in .env.local
- [ ] Database backup created
- [ ] Migration file reviewed (20251020_market_auction_system.sql)

### Backend Service
- [ ] auctionMarketEngine.ts reviewed
- [ ] All methods tested locally
- [ ] Error handling verified
- [ ] Database queries have indexes

### UI Components
- [ ] All 5 components built and tested
- [ ] Design system applied consistently
- [ ] Mobile responsiveness verified
- [ ] Accessibility tested

### Integration
- [ ] VehicleProfileTrading.tsx ready
- [ ] Import statement prepared for VehicleProfile
- [ ] Component props validated
- [ ] TypeScript compilation passes

### Documentation
- [ ] Technical reference reviewed
- [ ] Wiring guide tested
- [ ] Algorithm explanations documented
- [ ] Integration steps clear

### Security
- [ ] RLS policies enabled on all tables
- [ ] User authentication verified
- [ ] API keys secured in environment
- [ ] SQL injection prevention verified

### Performance
- [ ] Database indexes confirmed
- [ ] Materialized views refreshed
- [ ] Caching strategy implemented
- [ ] WebSocket latency tested

---

## 🔄 Deployment Rollback Plan

If something goes wrong:

### Rollback Steps

**1. Immediate (within 5 minutes):**
```bash
# Roll back code to previous version
git revert HEAD --no-edit
npm run build
npm run deploy
```

**2. Database Issues (within 15 minutes):**
```bash
# Restore from backup
supabase db restore --from backup-2025-10-20.sql

# Verify data integrity
supabase db verify
```

**3. Communication:**
- Post incident notification
- Alert users to temporary trading suspension
- Provide ETA for restoration

---

## 📊 Post-Deployment Monitoring

### Key Metrics to Monitor

**Availability:**
- ✓ API response time
- ✓ Database query time
- ✓ WebSocket connection status
- ✓ Error rates

**Performance:**
- ✓ Order matching latency (target: < 100ms)
- ✓ Order book fetch (target: < 50ms)
- ✓ Portfolio updates (target: < 100ms)
- ✓ Leaderboard refresh (target: < 500ms)

**Business Metrics:**
- ✓ Number of active traders
- ✓ Trading volume (orders/minute)
- ✓ Commission revenue
- ✓ Average order value

### Monitoring Tools

```bash
# View logs (if using Supabase)
supabase logs prod --follow

# Check database performance
supabase monitoring pg-stat-statements

# Monitor API (if using Vercel)
# → Vercel Dashboard → Analytics
```

---

## 🎯 Success Criteria

Deployment is successful when:

- [ ] ✅ All 14 database tables created
- [ ] ✅ All UI components render without errors
- [ ] ✅ Can place and match orders
- [ ] ✅ Order book updates in real-time
- [ ] ✅ Portfolio reflects correct holdings
- [ ] ✅ Leaderboard shows correct rankings
- [ ] ✅ Load test: 100 concurrent users, < 200ms P95
- [ ] ✅ Error rate: < 0.1%
- [ ] ✅ Zero data integrity issues
- [ ] ✅ All monitoring alerts green

---

## 📞 Troubleshooting

### Database Migration Fails

**Error:** `Failed to create table market_orders`

**Solution:**
1. Check Supabase project is active
2. Verify schema doesn't already exist:
   ```bash
   supabase db tables | grep market_orders
   ```
3. Drop existing tables if needed:
   ```bash
   supabase db execute "DROP TABLE IF EXISTS market_orders CASCADE;"
   ```
4. Re-run migration

### Build Fails

**Error:** `TypeScript compilation error`

**Solution:**
1. Run local type checking:
   ```bash
   npx tsc --noEmit
   ```
2. Fix errors listed
3. Re-run build

### Order Matching Not Working

**Diagnosis:**
1. Check database migration completed
2. Verify market_orders table has data
3. Check auctionMarketEngine.ts logs:
   ```bash
   tail -f .logs/auction-engine.log
   ```
4. Test directly:
   ```javascript
   import { AuctionMarketEngine } from './services/auctionMarketEngine';
   AuctionMarketEngine.placeOrder(...);
   ```

### WebSocket Not Updating UI

**Diagnosis:**
1. Check Supabase real-time enabled:
   ```bash
   supabase status | grep "realtime"
   ```
2. Verify subscriptions in component:
   ```javascript
   console.log('WebSocket connected:', supabase.subscription)
   ```
3. Check browser console for errors
4. Verify RLS policies allow access

---

## 📈 Scale-Out Plan (If Needed)

When traffic increases:

### Phase 1: Database Optimization (10-100k users)
- [ ] Add read replicas for leaderboard queries
- [ ] Increase materialized view refresh frequency
- [ ] Add query result caching

### Phase 2: Distributed Architecture (100k-1M users)
- [ ] Split reads/writes across databases
- [ ] Add Redis cache layer
- [ ] Implement database sharding by offering_id

### Phase 3: Real-Time Infrastructure (1M+ users)
- [ ] Move from Supabase real-time to dedicated service
- [ ] Implement order matching on Edge
- [ ] Add CDN for static assets

---

## 📅 Timeline

```
Deployment Day
├─ 09:00 - Final pre-flight checks
├─ 09:15 - Deploy database (15 min)
├─ 09:30 - Deploy frontend (3 min)
├─ 09:33 - Smoke testing (10 min)
├─ 09:43 - Load testing (30 min)
├─ 10:13 - Monitoring setup (10 min)
├─ 10:23 - Go-live announcement
└─ 10:30 - Monitor for 24 hours
```

**Total: ~1.5 hours to full deployment**

---

## ✅ Deployment Complete!

After successful deployment:

1. **Celebrate! 🎉** You've deployed a production-grade trading engine
2. **Monitor closely** for first 24 hours
3. **Document issues** as you find them
4. **Iterate fast** based on user feedback
5. **Scale confidently** - the foundation is solid

---

**Status: READY FOR PRODUCTION DEPLOYMENT** ✅

**Questions?** See `COMPLETE_TECHNICAL_REFERENCE.md` or `INTEGRATION_WIRING_GUIDE.md`

