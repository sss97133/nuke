# Production Deployment Checklist

**Date:** October 24, 2025  
**Platform:** Nuke (n-zero)  
**Deployment Target:** Production

---

## Pre-Deployment Checklist

### Database Migrations (CRITICAL)

- [ ] **Apply RLS Simplification**
  ```bash
  cd /Users/skylar/nuke
  chmod +x apply-simple-rls.sh
  ./apply-simple-rls.sh
  ```
  - Verifies: Run `SELECT * FROM pg_policies WHERE tablename = 'vehicles';` in Supabase SQL Editor
  - Expected: Should see 4 simple policies (view, create, update, delete)

- [ ] **Apply Fund System Migration**
  ```bash
  supabase db push supabase/migrations/20251024_vehicle_funds_system.sql
  ```
  - Verifies: Check tables exist: `vehicle_funds`, `fund_vehicles`, `fund_share_holdings`

- [ ] **Test Permissions**
  - Login as regular user
  - Try editing ANY vehicle
  - Should succeed without errors
  - Check `vehicle_edit_audit` table for logged changes

### Environment Variables

- [ ] **Frontend (.env)**
  ```bash
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your-anon-key
  VITE_OPENAI_API_KEY=sk-... (if using AI features)
  ```

- [ ] **Backend (.env)**
  ```bash
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  DATABASE_URL=postgresql://...
  ```

- [ ] **Verify Supabase Settings**
  - Authentication → Email Templates (customize)
  - Authentication → URL Configuration (set redirect URLs)
  - Storage → Policies (vehicle-images bucket accessible)

### Legal & Compliance

- [ ] **Update LEGAL.md**
  - [ ] Replace `[Your Company Legal Name]` with actual company name
  - [ ] Replace `[Address]` with actual address
  - [ ] Replace `[Email: legal@yourdomain.com]` with actual email
  - [ ] Replace `[Your State]` with actual state for governing law
  - [ ] Review all terms with lawyer (STRONGLY RECOMMENDED)

- [ ] **Add Legal Links to Site**
  - [ ] Footer links to LEGAL.md
  - [ ] Investment pages show disclaimers
  - [ ] Checkbox: "I acknowledge investment risks" before first investment
  - [ ] Link to USER_GUIDE.md from Market page

- [ ] **Disclaimers on Every Investment Page**
  ```
  ⚠️ NOT SECURITIES. High risk of loss. Read LEGAL.md before investing.
  ```

### Code Quality

- [ ] **Run Linter**
  ```bash
  cd nuke_frontend
  npm run lint
  npm run type-check
  ```

- [ ] **Build Test**
  ```bash
  npm run build
  ```
  - Should complete without errors
  - Check bundle size (should be < 5MB)

- [ ] **Design System Audit**
  - [ ] Check Market.tsx - all text 8pt? ✓
  - [ ] Check AppLayout.tsx - no emojis? ✓
  - [ ] No nested cards > 2 levels? ✓
  - [ ] All borders 0px radius? ✓

### Feature Testing

- [ ] **Authentication Flow**
  - [ ] Sign up with email
  - [ ] Email verification works
  - [ ] Login with email
  - [ ] OAuth login (Google/GitHub)
  - [ ] Password reset
  - [ ] Logout

- [ ] **Add Vehicle Flow**
  - [ ] Can create vehicle with basic info
  - [ ] URL scraping works (test with BAT/Craigslist)
  - [ ] Can upload 100 images without crash
  - [ ] Progress indicator shows during upload
  - [ ] Images appear in gallery after upload
  - [ ] Can edit vehicle after creation

- [ ] **Investment Flow (ALL 4 PRODUCTS)**
  - [ ] **Stakes:** Can create stake on vehicle
  - [ ] **Shares:** Can buy/sell shares (need 2 users)
  - [ ] **Bonds:** Can create bond offering
  - [ ] **Whole Vehicle:** Can make offer on vehicle

- [ ] **Market Page**
  - [ ] Browse tab shows investable vehicles
  - [ ] Portfolio tab shows your holdings
  - [ ] Builder tab shows your vehicles
  - [ ] All tabs load without errors

- [ ] **Vehicle Profile**
  - [ ] Loads without errors
  - [ ] Images display correctly
  - [ ] Timeline shows events
  - [ ] Comments work
  - [ ] Financial products tabs appear
  - [ ] Can edit vehicle inline (after RLS fix)

### Performance Testing

- [ ] **Page Load Times**
  - [ ] Homepage < 2 seconds
  - [ ] Market page < 3 seconds
  - [ ] Vehicle profile < 3 seconds
  - [ ] Image gallery < 4 seconds (with 100 images)

- [ ] **Mobile Performance**
  - [ ] Test on actual iPhone/Android
  - [ ] Navigation works on mobile
  - [ ] Touch targets >= 44px
  - [ ] No horizontal scroll
  - [ ] Forms are usable on mobile

### Security Testing

- [ ] **RLS Testing**
  - [ ] Can't access other users' private data
  - [ ] Can't modify cash balances directly
  - [ ] Can't create fake trades
  - [ ] SQL injection attempts fail

- [ ] **Authentication Testing**
  - [ ] Can't access protected pages without login
  - [ ] Session expires appropriately
  - [ ] Can't impersonate other users

### Data Integrity

- [ ] **Cash Balance System**
  - [ ] Add $100 to account
  - [ ] Make purchase
  - [ ] Balance decrements correctly
  - [ ] Can withdraw to bank
  - [ ] Transactions log correctly

- [ ] **Vehicle Data**
  - [ ] VIN decoder works
  - [ ] Image EXIF extraction works
  - [ ] Timeline events create correctly
  - [ ] Edit audit log populates

### Error Handling

- [ ] **Test Error States**
  - [ ] Try invalid VIN - shows error
  - [ ] Try upload > 300 images - shows limit
  - [ ] Try invest with insufficient funds - shows error
  - [ ] Try access non-existent vehicle - 404 page
  - [ ] Try API timeout - graceful fallback

### Monitoring Setup

- [ ] **Error Tracking**
  - [ ] Sentry or similar error tracking installed
  - [ ] Test by throwing error, verify captured

- [ ] **Analytics**
  - [ ] Google Analytics or Plausible installed
  - [ ] Track key events:
    - Vehicle created
    - Investment made
    - User signup
    - Cash deposited

- [ ] **Database Monitoring**
  - [ ] Supabase monitoring dashboard configured
  - [ ] Set up alerts for high error rates
  - [ ] Set up alerts for low disk space

---

## Deployment Steps

### 1. Database Deployment

```bash
# Apply RLS simplification
./apply-simple-rls.sh

# Apply fund system
supabase db push supabase/migrations/20251024_vehicle_funds_system.sql

# Verify migrations
supabase db diff
```

### 2. Frontend Deployment (Vercel)

```bash
# From nuke_frontend directory
git add .
git commit -m "Production deployment: RLS fix, Market page, Fund system"
git push origin main

# Vercel auto-deploys from main branch
# Or manual deploy:
vercel --prod
```

### 3. Environment Variables (Vercel Dashboard)

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_ENABLE_DEBUG=false
```

### 4. DNS & Domain

- [ ] Domain pointed to Vercel
- [ ] SSL certificate active
- [ ] www redirect configured

---

## Post-Deployment Verification

### Immediate Checks (Within 5 minutes)

- [ ] Site loads at production URL
- [ ] No console errors on homepage
- [ ] Can login
- [ ] Can view a vehicle profile
- [ ] Market page loads

### Critical Path Testing (Within 30 minutes)

- [ ] Create new vehicle (end-to-end)
- [ ] Upload images (test 50 images)
- [ ] Make investment (test with $10)
- [ ] Check cash balance updates
- [ ] Edit a vehicle field
- [ ] Verify audit log captures edit

### Monitor for Issues (First 24 hours)

- [ ] Check error logs every 2 hours
- [ ] Monitor user signup rate
- [ ] Watch for failed image uploads
- [ ] Check for payment failures
- [ ] Monitor database query performance

---

## Rollback Plan

**If critical issues arise:**

### Database Rollback

```bash
# Restore to previous migration
supabase db reset --db-url "your-db-url"

# Or revert specific migrations
supabase db revert --db-url "your-db-url"
```

### Frontend Rollback

```bash
# Vercel dashboard → Deployments → Previous deployment → Promote to Production
# Or via CLI:
vercel rollback
```

### Emergency Contacts

- **Developer:** [Your contact]
- **Database Admin:** [Contact]
- **Legal:** [Contact if investment issues]

---

## Known Issues & Limitations

### Non-Critical Issues (Can fix post-launch)

1. **Mobile/Desktop UI differences**
   - Some pages have separate mobile components
   - Not a blocker, but affects consistency
   - Plan: Unify in next sprint

2. **EditVehicle page still exists**
   - Not using inline editing yet
   - Works fine, just not ideal UX
   - Plan: Merge with VehicleProfile later

3. **No automated design linting**
   - Manual review required
   - May have some text size violations
   - Plan: Create linter script

### Critical Limitations (Disclose to users)

1. **Beta Product**
   - First investment platform version
   - May have bugs
   - Add "BETA" badge to site

2. **Limited Liquidity**
   - Share trading requires matching buyers/sellers
   - May be hard to exit positions
   - Disclose in USER_GUIDE.md ✓

3. **No FDIC Insurance**
   - Users can lose money
   - Clearly stated in LEGAL.md ✓

---

## Success Criteria

**Launch is successful if:**

- ✓ No critical errors in first 24 hours
- ✓ Users can complete signup → add vehicle → invest flow
- ✓ No data loss or corruption
- ✓ Site is responsive on mobile
- ✓ Legal disclaimers are visible
- ✓ You (founder) can edit any vehicle

**Launch should be delayed if:**

- ✗ RLS migrations fail
- ✗ Cash balance system has bugs
- ✗ Legal terms not reviewed by lawyer
- ✗ Critical security vulnerability found
- ✗ Site doesn't load on mobile

---

## Communication Plan

### Pre-Launch

- [ ] Email existing users: "New features coming!"
- [ ] Social media: Tease Market page
- [ ] Prepare support docs

### Launch Day

- [ ] Announce on social media
- [ ] Email users: "Market page is live!"
- [ ] Monitor support channels closely

### Post-Launch

- [ ] Daily status updates (first week)
- [ ] Collect user feedback
- [ ] Prioritize bug fixes based on severity

---

## Support Readiness

- [ ] **Support Email:** support@yourdomain.com set up
- [ ] **Response Template:** Draft common Q&A responses
- [ ] **Escalation Path:** Define who handles what
- [ ] **FAQ Page:** Link to USER_GUIDE.md
- [ ] **Status Page:** Consider status.yourdomain.com

---

## Metrics to Track

### Day 1
- Unique visitors
- Signups
- Vehicles created
- Investments made
- Error rate

### Week 1
- User retention (7-day)
- Average investment size
- Most popular investment type
- Mobile vs desktop usage
- Page load times

### Month 1
- Monthly Active Users (MAU)
- Total investment volume
- Platform fee revenue
- Support ticket volume
- User satisfaction score

---

## Final Sign-Off

**Before going live, confirm:**

- [ ] All database migrations applied successfully
- [ ] All environment variables set
- [ ] Legal terms reviewed (by lawyer if possible)
- [ ] Critical user flows tested
- [ ] Rollback plan understood
- [ ] Support team briefed
- [ ] Monitoring configured

**Deployment Authorized By:** ________________  
**Date:** __________  
**Time:** __________

---

**Remember:** Launch is just the beginning. Monitor, iterate, improve.

**Good luck! 🚀**

