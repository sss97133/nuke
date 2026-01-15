# Follow as Pre-Investment System

## Conceptual Model

**Following = Watching with Intent, Investing = Financial Commitment**

Following a vehicle is like adding a stock to your watchlist - you're interested, tracking it, but haven't committed capital yet. The system should:

1. **Track Follow Date** - When user started following
2. **Track Investment Date** - When/if they actually invest
3. **Calculate Hypothetical Returns** - "If you invested when you started following, you'd have X% return"
4. **Show Opportunity Cost** - "You've been following for 6 months, missed 15% gain"
5. **Create Funnel** - Natural progression from follow → invest

## User Psychology

- **FOMO** - "I've been watching this for months, should have invested"
- **Validation** - "My instincts were right, this went up"
- **Regret** - "I missed out on gains by not investing"
- **Action Prompt** - "You're already following, why not invest?"

## Technical Design

### Data Model

```sql
-- Extend user_subscriptions to track follow date and price
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS followed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS price_at_follow NUMERIC(10, 2);
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS invested_at TIMESTAMPTZ;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS investment_amount NUMERIC(10, 2);

-- Track hypothetical returns
CREATE TABLE IF NOT EXISTS follow_roi_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES user_subscriptions(id),
  vehicle_id UUID REFERENCES vehicles(id),
  user_id UUID REFERENCES auth.users(id),
  
  -- Follow metrics
  followed_at TIMESTAMPTZ NOT NULL,
  price_at_follow NUMERIC(10, 2) NOT NULL,
  
  -- Current metrics
  current_price NUMERIC(10, 2),
  current_value NUMERIC(10, 2),
  
  -- Calculated ROI
  hypothetical_roi_pct NUMERIC(5, 2), -- e.g., 15.50 for 15.5%
  hypothetical_gain NUMERIC(10, 2), -- Dollar amount
  days_following INTEGER,
  
  -- Investment status
  has_invested BOOLEAN DEFAULT false,
  invested_at TIMESTAMPTZ,
  actual_roi_pct NUMERIC(5, 2),
  actual_gain NUMERIC(10, 2),
  
  -- Metadata
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Price Tracking

Need to track vehicle price over time:
- Current asking price
- Sale price (if sold)
- Auction bids
- Valuation estimates

When user follows:
- Capture current price (asking_price, current_bid, or current_value)
- Store timestamp
- Store price source

When calculating ROI:
- Get current price (sale_price if sold, current_bid if auction, current_value otherwise)
- Calculate: `(current_price - price_at_follow) / price_at_follow * 100`
- Show both percentage and dollar amount

### UI Components

#### 1. Follow Button with ROI Preview
```
[⭐ Follow] → Shows: "Following since Jan 1"
On hover: "If you invested $1,000 when you started following, you'd have $1,150 (+15%)"
```

#### 2. Followed Vehicles Dashboard
- List of vehicles user is following
- Show: Follow date, price at follow, current price, hypothetical ROI
- Sort by: ROI (highest first), days following, price change
- Action: "Invest Now" button

#### 3. Vehicle Card Badge (when following)
```
[⭐ Following] [+15% if invested]
```

#### 4. Investment Prompt Modal
When user clicks "Invest" on a followed vehicle:
```
"You've been following this vehicle since Jan 1, 2025
Price then: $50,000
Current price: $57,500
Hypothetical return: +15% (+$7,500)

Ready to invest? You've already done the research."
```

#### 5. ROI Notification
When followed vehicle price changes significantly:
```
"🚀 Vehicle you're following: 1970 Chevelle SS
Price increased 12% since you started following
If you had invested $10,000, you'd have $11,200"
```

## Functional Flow

### 1. User Follows Vehicle
```typescript
async function followVehicle(vehicleId: string, userId: string) {
  // Get current price
  const vehicle = await getVehicle(vehicleId);
  const currentPrice = vehicle.asking_price || 
                       vehicle.current_bid || 
                       vehicle.current_value;
  
  // Create subscription
  await supabase.from('user_subscriptions').insert({
    user_id: userId,
    subscription_type: 'vehicle_status_change',
    target_id: vehicleId,
    followed_at: new Date(),
    price_at_follow: currentPrice,
    is_active: true
  });
  
  // Create ROI tracking record
  await supabase.from('follow_roi_tracking').insert({
    vehicle_id: vehicleId,
    user_id: userId,
    followed_at: new Date(),
    price_at_follow: currentPrice
  });
}
```

### 2. Calculate Hypothetical ROI
```typescript
async function calculateFollowROI(subscriptionId: string) {
  const subscription = await getSubscription(subscriptionId);
  const vehicle = await getVehicle(subscription.target_id);
  
  const currentPrice = vehicle.sale_price || 
                      vehicle.current_bid || 
                      vehicle.current_value;
  
  if (!subscription.price_at_follow || !currentPrice) {
    return null;
  }
  
  const roiPct = ((currentPrice - subscription.price_at_follow) / 
                  subscription.price_at_follow) * 100;
  
  const daysFollowing = Math.floor(
    (Date.now() - new Date(subscription.followed_at).getTime()) / 
    (1000 * 60 * 60 * 24)
  );
  
  return {
    roiPct,
    priceAtFollow: subscription.price_at_follow,
    currentPrice,
    daysFollowing,
    hypotheticalGain: currentPrice - subscription.price_at_follow
  };
}
```

### 3. Display ROI on Cards
```typescript
// In VehicleCardDense component
{showFollowButton && isFollowing && followROI && (
  <div className="follow-roi-badge">
    {followROI.roiPct > 0 ? '📈' : '📉'} 
    {followROI.roiPct > 0 ? '+' : ''}{followROI.roiPct.toFixed(1)}%
    {followROI.daysFollowing > 0 && (
      <span className="days">({followROI.daysFollowing}d)</span>
    )}
  </div>
)}
```

## Gamification Elements

1. **ROI Leaderboard** - "Top hypothetical returns from following"
2. **Follow Streaks** - "You've been following for 30 days"
3. **Missed Opportunities** - "You unfollowed this vehicle, it went up 25%"
4. **Investment Conversion** - "You followed 10 vehicles, invested in 2 - 20% conversion"
5. **Smart Follows** - "Vehicles you're following are up 12% on average"

## Technical Implementation Steps

1. **Database Migration**
   - Add columns to user_subscriptions
   - Create follow_roi_tracking table
   - Create indexes for performance

2. **Backend Service**
   - ROI calculation service
   - Price tracking service
   - Notification service for ROI changes

3. **Frontend Components**
   - Follow button with ROI
   - Followed vehicles dashboard
   - ROI badges on cards
   - Investment prompt modal

4. **Real-time Updates**
   - Update ROI when vehicle price changes
   - Send notifications for significant changes
   - Refresh dashboard in real-time

## Success Metrics

- Follow → Invest conversion rate
- Average ROI of followed vehicles
- Time from follow to invest
- User engagement with ROI features
- Investment amount from followed vehicles
