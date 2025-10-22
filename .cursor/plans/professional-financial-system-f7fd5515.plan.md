<!-- f7fd5515-b071-470e-b745-f7b0618fdaae 5313f9a1-54ae-4cb0-b0b3-44679bffd2bd -->
# Complete Financial UI & Design Audit

## Overview
Users can invest but builders can't create financial products. Portfolio only shows shares, not stakes/bonds. Navigation doesn't include Portfolio link. Need complete builder tools and unified portfolio.

## Missing UI Components

### 1. Builder Dashboard (Create Financial Products)

**File**: `nuke_frontend/src/pages/BuilderDashboard.tsx` (NEW)

Builders need ability to:
- Create funding rounds (profit stakes)
- Issue bonds
- List vehicle for sale
- Manage active offerings

**Sections**:
```tsx
<BuilderDashboard>
  <YourVehicles>
    For each vehicle:
      [Create Funding Round]
      [Issue Bond]
      [List for Sale]
      [Offer Shares]
  </YourVehicles>
  
  <ActiveOfferings>
    - Funding rounds (progress, stakers)
    - Bonds (sold amount, holders)
    - Listings (offers, bids)
    - Shares (order book)
  </ActiveOfferings>
  
  <Earnings>
    - Total raised
    - Pending distributions
    - Platform fees
  </Earnings>
</BuilderDashboard>
```

### 2. Enhanced Portfolio (Show ALL Investments)

**File**: `nuke_frontend/src/pages/Portfolio.tsx` (UPDATE)

Currently only shows:
- Cash balance ✅
- Share holdings ✅
- Transactions ✅

**Missing**:
- Profit stakes (with estimated returns)
- Bonds (with accrued interest)
- Pending offers on whole vehicles

**Add tabs**:
```tsx
<Portfolio>
  <Tab name="Overview">
    - Total portfolio value
    - Cash + Shares + Bonds + Stakes
    - P&L breakdown
  </Tab>
  
  <Tab name="Cash">
    - Available/Reserved
    - Deposit/Withdraw
    - Transaction history
  </Tab>
  
  <Tab name="Shares">
    - Holdings with P&L
    - Open orders
    - Trade history
  </Tab>
  
  <Tab name="Stakes">
    - Active stakes
    - Estimated returns
    - Completed stakes (realized P&L)
  </Tab>
  
  <Tab name="Bonds">
    - Bond holdings
    - Accrued interest
    - Maturity dates
  </Tab>
  
  <Tab name="Offers">
    - Pending offers on vehicles
    - Offer status
    - Acceptance/rejection
  </Tab>
</Portfolio>
```

### 3. Navigation Updates

**File**: `nuke_frontend/src/components/layout/AppLayout.tsx` (UPDATE)

Add to main navigation:
- Portfolio link (missing!)
- Builder Dashboard (for vehicle owners)

**Current navigation** (from audit):
- Discover, All Vehicles, My Vehicles, Add Vehicle, Dashboard, Profile, etc.
- NO Portfolio link!
- NO Builder/Financial tools

**Add**:
```tsx
<nav>
  <Link to="/portfolio">💰 Portfolio</Link>
  <Link to="/builder">🔧 Builder Tools</Link>
  <CashBalance compact />  {/* Show balance in nav */}
</nav>
```

### 4. Create Funding Round Form

**File**: `nuke_frontend/src/components/financial/CreateFundingRound.tsx` (NEW)

Form for builders:
```tsx
<CreateFundingRound vehicleId={id}>
  <Input label="Target Amount" type="number" />
  <Input label="Profit Share %" type="number" min={1} max={50} />
  <Input label="Minimum Stake" type="number" default={3} />
  <Textarea label="Description" />
  <DatePicker label="Funding Deadline" />
  <Button>Create Funding Round</Button>
</CreateFundingRound>
```

### 5. Issue Bond Form

**File**: `nuke_frontend/src/components/financial/IssueBond.tsx` (NEW)

```tsx
<IssueBond vehicleId={id}>
  <Input label="Principal Amount" />
  <Input label="Interest Rate %" />
  <Select label="Term" options={[12, 24, 36]} />
  <Select label="Payment Schedule" options={['at_maturity', 'quarterly']} />
  <Textarea label="Use of Funds" />
  <Button>Issue Bond</Button>
</IssueBond>
```

### 6. List Vehicle for Sale Form

**File**: `nuke_frontend/src/components/financial/ListVehicle.tsx` (NEW)

```tsx
<ListVehicle vehicleId={id}>
  <Select label="Sale Type" options={['auction', 'fixed_price', 'best_offer']} />
  <Input label="List Price" />
  <Input label="Reserve Price" />
  <Checkbox label="Accept Offers" />
  <DatePicker label="Auction End" />
  <Textarea label="Description" />
  <Button>List Vehicle</Button>
</ListVehicle>
```

### 7. Financial Product Status Cards

**File**: `nuke_frontend/src/components/financial/ProductStatusCard.tsx` (NEW)

Show status of each product type:
```tsx
<ProductStatusCard type="funding_round">
  <Progress value={7500} max={10000} />
  <Stats>
    Raised: $7,500 / $10,000
    Stakers: 23
    Days left: 12
  </Stats>
  <Actions>
    [View Details] [Send Update]
  </Actions>
</ProductStatusCard>
```

## Design System Audit Findings

### Colors - GOOD ✅
All use var(--bg), var(--surface), var(--text), var(--accent)

### Fonts - FIXED ✅
All 8-11px now (was mixed 8-32px)

### Missing Design Patterns

1. **Success/Error Inline Messages** (not just alerts)
2. **Loading Skeletons** (currently shows "Loading...")
3. **Confirmation Modals** (for large transactions)
4. **Toast Notifications** (better than alert())
5. **Empty State Illustrations** (currently just text)

## Navigation Improvements

### AppLayout.tsx Current Nav:
```
- Discover
- All Vehicles  
- My Vehicles
- Add Vehicle
- Dashboard
- Profile
```

### Missing:
- **Portfolio** (users can't find their money!)
- **Builder Dashboard** (can't create products)
- **Cash Balance** (should show in nav)

### Proposed Navigation:
```
Main:
  - Discover
  - Portfolio 💰  [NEW - shows cash balance]
  - My Vehicles
  - Add Vehicle

Builder Tools:
  - Builder Dashboard [NEW - create products]
  - Manage Offerings [NEW - active products]

Profile:
  - Profile
  - Settings
  - Sign Out
```

## Implementation Plan

### Phase 1: Critical Missing UI
1. Add Portfolio link to navigation
2. Enhance Portfolio page with Stakes/Bonds tabs
3. Create BuilderDashboard page
4. Add CreateFundingRound form

### Phase 2: Builder Tools
5. Create IssueBond form
6. Create ListVehicle form
7. Add ProductStatusCard component
8. Wire all forms to database functions

### Phase 3: UX Polish
9. Replace alert() with toast notifications
10. Add confirmation modals for large amounts
11. Add loading skeletons
12. Better error handling

### Phase 4: Discovery
13. Add "Browse Investments" page (all funding rounds)
14. Add "Browse Bonds" page
15. Add "Vehicles for Sale" page
16. Filter/sort capabilities

## Files to Create

### New Pages (3)
- BuilderDashboard.tsx
- BrowseInvestments.tsx
- ManageOfferings.tsx

### New Components (6)
- CreateFundingRound.tsx
- IssueBond.tsx
- ListVehicle.tsx
- ProductStatusCard.tsx
- Toast.tsx (notification system)
- ConfirmModal.tsx

### Updates (3)
- AppLayout.tsx (add nav links)
- Portfolio.tsx (add Stakes/Bonds tabs)
- VehicleProfile.tsx (already done)

## Success Criteria

After implementation:
- ✅ Users can find Portfolio from any page
- ✅ Portfolio shows ALL investment types
- ✅ Builders can create funding rounds
- ✅ Builders can issue bonds
- ✅ Builders can list vehicles
- ✅ No browser alerts (use toasts)
- ✅ Confirmations for >$100 transactions
- ✅ Loading states everywhere
- ✅ Design continuity maintained


### To-dos

- [ ] Add Portfolio link to AppLayout navigation
- [ ] Add Stakes and Bonds tabs to Portfolio page
- [ ] Create BuilderDashboard page for managing financial products
- [ ] Build CreateFundingRound form component
- [ ] Build IssueBond form component
- [ ] Build ListVehicle for sale form
- [ ] Replace alert() with toast notification system
- [ ] Add confirmation modals for transactions >$100
- [ ] Create browse page for all funding rounds and bonds