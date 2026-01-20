# Vehicle States & Badge System

## Core Vehicle States

| State | Description | Source |
|-------|-------------|--------|
| `live_auction` | Currently being auctioned, accepting bids | BaT, C&B, Mecum, etc |
| `auction_ended` | Auction completed (sold or not) | Same |
| `for_sale` | Listed for fixed price | Dealers, classifieds |
| `sold` | Transaction completed | Any |
| `unlisted` | In database but no active listing | Historical |

---

## Badge Hierarchy by View Level

### Level 1: Card View (Grid/List)
Minimal badges - quick scan info

| Badge | Shows When | Data Needed |
|-------|------------|-------------|
| 🔴 LIVE | `state = live_auction` | `auction_end_date > now` |
| ⏱️ Timer | `state = live_auction` | `auction_end_date` |
| 💰 Current Bid | `state = live_auction` | `current_bid` |
| ✅ SOLD | `state = sold` | `sold_price`, `sold_date` |
| 🏷️ Price | `state = for_sale` | `asking_price` |

### Level 2: Expanded Card / Hover
More context on interaction

| Badge/Info | Shows When | Data Needed |
|------------|------------|-------------|
| Bid Count | `live_auction` | `bid_count` |
| Reserve Status | `live_auction` | `reserve_met: boolean` |
| Time Left (detailed) | `live_auction` | `auction_end_date` |
| Seller Type | Always | `seller_type` (dealer/private/auction) |
| Location | If available | `location` |
| Platform | Always | `source_platform` (BaT, C&B, etc) |

### Level 3: Vehicle Profile (Full Detail)
Everything visible + interactive

| Element | Data Needed | Click Behavior |
|---------|-------------|----------------|
| **High Bidder** | `high_bidder_id`, `high_bidder_name` | Opens hugger modal with bidder brief |
| **Seller** | `seller_id`, `seller_name`, `seller_type` | Opens hugger modal with seller brief |
| **Bid History** | `bids[]` array | Expandable list |
| **Price History** | `price_changes[]` | Chart/timeline |
| **Comments** | `comment_count`, `comments[]` | Expandable section |
| **Source Link** | `listing_url` | External link (new tab) |
| **VIN** | `vin` | Copy to clipboard |
| **Mileage** | `mileage` | Static display |
| **Location** | `location` | Map link? |

---

## Click Behavior Rules

### Single Click
- Opens hugger/modal with preview
- Does NOT navigate away from current page
- Shows brief info about clicked element

### Double Click (or explicit "View" button)
- Navigates to full page/profile
- Used for: vehicle profile, bidder profile, seller profile

### Header Bar Fix
Current issue: Clicking navigates immediately
Needed: Single click → expand/preview, explicit action to navigate

---

## Database Fields (Already Exist!)

### Auction Fields
- `auction_end_date` - TIMESTAMPTZ
- `auction_outcome` - TEXT
- `auction_source` - TEXT
- `bid_count` - INTEGER
- `high_bid` - INTEGER
- `reserve_status` - TEXT
- `winning_bid` - INTEGER

### BaT-Specific (Rich Data)
- `bat_buyer` - buyer info
- `bat_seller` - seller info
- `bat_bid_count`, `bat_bids` - bid details
- `bat_comments` - comments array
- `bat_view_count`, `bat_watchers` - engagement
- `bat_sold_price`, `bat_sale_date` - outcome

### Pricing
- `asking_price`
- `current_value`
- `price`
- `sale_price` / `sold_price`

### Status
- `is_for_sale` - BOOLEAN
- `sale_status` - TEXT
- `status` - TEXT

### Seller/Owner
- `owner_id`, `owner_name`
- `selling_organization_id`

### What's Missing
```sql
-- Need to add:
auction_status TEXT CHECK (auction_status IN ('live', 'ended', 'cancelled', 'upcoming')),
current_bid INTEGER, -- distinct from high_bid for live auctions
seller_type TEXT CHECK (seller_type IN ('private', 'dealer', 'auction_house')),
```

---

## Badge Component Props

```typescript
interface VehicleBadgeProps {
  state: 'live_auction' | 'auction_ended' | 'for_sale' | 'sold' | 'unlisted';
  auctionEndDate?: Date;
  currentBid?: number;
  soldPrice?: number;
  askingPrice?: number;
  reserveMet?: boolean;
  bidCount?: number;
  sourcePlatform?: string;
}

interface VehicleCardProps {
  vehicle: Vehicle;
  viewLevel: 'card' | 'expanded' | 'profile';
  onElementClick: (element: 'bidder' | 'seller' | 'vehicle', id: string) => void;
}
```

---

## Hugger Modal Content

### Bidder Hugger
- Username/display name
- Bid history on this vehicle
- Total bids across platform
- Member since
- Link to full profile (double-click)

### Seller Hugger
- Name/business name
- Seller type badge
- Vehicles listed count
- Sold count
- Rating if available
- Link to full profile (double-click)

---

## Existing Components (Already Built)

### AuctionBadges.tsx
- `AuctionStatusBadge` - SOLD, RNM, LIVE, ENDING, ENDED, CANCELLED, PENDING
- `AuctionPlatformBadge` - BaT, Cars & Bids, eBay, Hemmings with favicons
- `ParticipantBadge` - For users/organizations with links
- `LiveAuctionBadge` - For auction house organizations

### VehicleHeader.tsx
- Owner popover with stats (auctions won/sold, comments)
- Location dropdown
- Access info dropdown
- Multiple click handlers for popovers

### VehicleCardLive.tsx
- Basic LIVE badge (`vehicle.is_live`)
- Image swiper with pinch zoom
- Support button
- NO timer, NO current bid, NO clickable elements

---

## What's Missing

| Component | Status | Priority |
|-----------|--------|----------|
| **Countdown Timer** | Not built | HIGH |
| **Current Bid Display** | Uses `current_value` not `high_bid` | HIGH |
| **Hugger Modal** | Partially exists (owner popover) | MEDIUM |
| **Bidder Brief** | Not built | MEDIUM |
| **Click → Preview behavior** | Not consistent | HIGH |

---

## Priority Implementation Order

1. **Create AuctionCountdown component** - Timer with auction_end_date
2. **Update VehicleCardLive** - Add timer, current bid, make clickable
3. **Create Hugger component** - Reusable modal for single-click preview
4. **Standardize click behavior** - Single = hugger, double = navigate
5. **Add Bidder/Seller brief modals** - Using existing ParticipantBadge pattern
6. **Connect live auction data** - Use `auction_end_date`, `high_bid`, `bid_count`
