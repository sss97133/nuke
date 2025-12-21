# Market Dashboard Concept

## Overview

The Market Dashboard is a unified interface that shows all submarket values and enables investment into both ETFs (market segment funds) and individual vehicles.

## Key Features

### 1. Market Overview
- **Total Segments**: Count of all active market segments (submarkets)
- **Total Vehicles**: Aggregate count of vehicles across all segments
- **Total Market Cap**: Sum of all vehicle values in the market
- **ETF AUM**: Total assets under management across all ETFs
- **7d/30d Change**: Average performance across all segments

### 2. Submarkets (Market Segments)

Each submarket represents a collection of vehicles defined by:
- **Year Range**: e.g., 1973-1987
- **Makes**: e.g., ['Chevrolet', 'GMC']
- **Model Keywords**: e.g., ['C10', 'K10', 'Suburban']
- **Manager Type**: AI-managed or human-managed

**Submarket Display Shows:**
- Vehicle count
- Market cap (total value of vehicles in segment)
- 7-day and 30-day price change percentages
- Associated ETF symbol (if available)
- NAV (Net Asset Value) per share
- AUM (Assets Under Management)

### 3. ETF Investment

ETFs (Exchange-Traded Funds) allow users to invest in entire market segments rather than individual vehicles.

**How It Works:**
1. Each market segment can have an associated ETF
2. ETF has a symbol (e.g., SQBD for Squarebody, PORS for Porsche)
3. Users buy shares at current NAV
4. NAV updates based on segment performance
5. Shares are tracked per user with entry NAV for gain/loss calculation

**Investment Flow:**
- User selects ETF from dashboard
- Enters investment amount (USD)
- System calculates shares based on current NAV
- Cash is deducted from user balance
- Shares are issued and tracked in `market_fund_holdings`

### 4. Individual Vehicle Investment

Users can invest in specific vehicles through multiple products:

**A. Funding Rounds (Stakes)**
- Vehicle owner creates a funding round to raise money for restoration
- Investors stake money ($50-$10,000)
- When vehicle sells, investors get a percentage of profit
- Status: `fundraising`, `active`, `funded`, `building`

**B. Bonds**
- Vehicle owner issues bonds to raise capital
- Fixed interest rate, fixed term
- Investors receive quarterly interest payments
- Principal returned at maturity
- Status: `active`

**C. Shares** (Future)
- Fractional ownership shares of individual vehicles
- Tradeable on secondary market
- Price fluctuates based on vehicle value

**D. Whole Vehicle Purchase**
- Direct purchase of entire vehicle
- Listed in `market_listings` table
- Status: `active` (for sale)

## Database Structure

### Core Tables

**market_segments**
- Defines submarkets with rules (year, makes, keywords)
- Links to market_funds (ETFs)

**market_funds**
- ETF definitions with symbol, NAV, AUM
- Tracks total shares outstanding

**market_fund_holdings**
- User holdings in ETFs
- Tracks shares owned, entry NAV, current NAV
- Calculates unrealized gain/loss

**vehicle_funding_rounds**
- Active funding rounds for vehicles
- Tracks target, raised amount, profit share %

**vehicle_bonds**
- Bond offerings for vehicles
- Interest rate, term, maturity date

**market_listings**
- Vehicles listed for sale
- External platform listings (Craigslist, BaT, etc.)

## User Interface

### Dashboard Tabs

1. **Overview Tab**
   - Shows all submarkets in a grid
   - Color-coded by 7d performance (green = up, red = down)
   - Click to view segment detail page

2. **ETFs Tab**
   - Filters to show only segments with ETFs
   - Displays ETF symbol, NAV, AUM
   - "Invest Now" button routes to fund detail page

3. **Individual Vehicles Tab**
   - Shows vehicles with investment opportunities
   - Displays available products (funding rounds, bonds, for sale)
   - Click to view vehicle profile

### Navigation Flow

```
Market Dashboard (/market)
  ├─ Overview → All Submarkets
  │   └─ Click Segment → Market Segment Detail (/market/segments/:slug)
  │
  ├─ ETFs → Available ETFs
  │   └─ Click ETF → Market Fund Detail (/market/exchange/:symbol)
  │       └─ Invest → market_fund_buy() RPC
  │
  └─ Individual Vehicles → Vehicle Investments
      └─ Click Vehicle → Vehicle Profile (/vehicle/:id)
          ├─ Funding Round → StakeOnVehicle component
          ├─ Bonds → BondInvestment component
          └─ For Sale → Purchase flow
```

## Investment Mechanics

### ETF Investment
```sql
-- User invests $100 into SQBD ETF
SELECT market_fund_buy(
  p_fund_id := '...',
  p_amount_cents := 10000
);

-- System:
-- 1. Gets current NAV (e.g., $10.00/share)
-- 2. Calculates shares: $100 / $10 = 10 shares
-- 3. Deducts $100 from user cash balance
-- 4. Creates/updates market_fund_holdings
-- 5. Updates fund AUM and shares outstanding
```

### Vehicle Investment
- **Stakes**: Via `create_stake()` function
- **Bonds**: Via `purchase_bond()` function (if exists)
- **Whole Vehicle**: Via purchase flow (future)

## Market Intelligence

The dashboard uses `market_segment_stats()` function to calculate:
- Vehicle count per segment
- Market cap (sum of vehicle values)
- 7d/30d price change (from `vehicle_price_history`)

This enables real-time market monitoring and investment decision-making.

## Future Enhancements

1. **Real-time NAV Updates**: Cron job to recalculate NAV based on segment performance
2. **Secondary Market**: Allow users to sell ETF shares to other users
3. **Vehicle Shares**: Implement fractional vehicle ownership
4. **Market Alerts**: Notify users of significant market movements
5. **Portfolio Analytics**: Show diversification, risk metrics, performance tracking
6. **Subcategory Filtering**: Filter vehicles by subcategories within segments

