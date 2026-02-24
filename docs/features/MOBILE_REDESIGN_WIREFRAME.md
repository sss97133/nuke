# Mobile Redesign Wireframe - Complete Desktop Feature Parity

**Date:** November 22, 2025
**Status:** COMPREHENSIVE DESIGN SPECIFICATION
**Goal:** Transform mobile version into a miniature, fully-featured version of desktop with all functionality accessible

---

## Design Philosophy

**Core Principle:** Mobile = Desktop features in a single-column, touch-optimized layout
- All sections from desktop must be present on mobile
- Headers, labels, and section dividers retained
- No feature hiding or progressive disclosure unless absolutely necessary
- Every clickable element from desktop should have a mobile equivalent

---

## 1. MOBILE APP LAYOUT (Global Structure)

### 1.1 Sticky Header (Top Bar)
```
┌─────────────────────────────────────────┐
│ [MENU] nuke        [NOTIFY][USER] │
└─────────────────────────────────────────┘
```

**Clickable Elements:**
- `[MENU]` → Opens full navigation drawer (see 1.2)
- `nuke` (logo) → Navigate to `/` (Homepage/Discovery)
- `[NOTIFY]` → Opens notifications panel
- `[USER]` → Navigate to `/profile`

**Fixed Position:** `position: sticky; top: 0; z-index: 100`

### 1.2 Navigation Drawer (Hamburger Menu)
```
┌─────────────────────────────────────┐
│  MAIN NAVIGATION                    │
│  ──────────────────────────────     │
│  Discover         → /discover       │
│  All Vehicles     → /all-vehicles   │
│  My Vehicles      → /vehicles       │
│  Add Vehicle      → /add-vehicle    │
│  Dashboard        → /dashboard      │
│  Organizations    → /shops          │
│  Profile          → /profile        │
│  Viewer Dashboard → /viewer-dash    │
│  Interactions     → /interaction    │
│                                      │
│  PROFESSIONAL TOOLS                 │
│  ──────────────────────────────     │
│  Browse Pros      → /browse-pros    │
│  Projects         → /project-mgmt   │
│  Work Timeline    → /tech-work      │
│  Business Dash    → /business       │
│                                      │
│  TOOLS & UTILITIES                  │
│  ──────────────────────────────     │
│  Photo Categorizer → /photo-cat     │
│  Document Capture → /doc-capture    │
│  Dropbox Import   → /dropbox        │
│  VIN Decoder      → /vin-decode     │
│  Data Normalizer  → /data-norm      │
│                                      │
│  FINANCIAL                          │
│  ──────────────────────────────     │
│  Financials       → /financials     │
│  Invoices         → /invoices       │
│  Suppliers        → /suppliers      │
│                                      │
│  [Close Drawer X]                   │
└─────────────────────────────────────┘
```

**All Navigation Items Clickable** - Each leads to its respective route

---

## 2. HOMEPAGE / DISCOVERY PAGE (`/` or `/discover`)

### 2.1 Hero Section
```
┌─────────────────────────────────────┐
│  Vehicle-Centric Digital Identity   │
│                                      │
│  [START ADDING VEHICLES →]          │
└─────────────────────────────────────┘
```

**Clickable:**
- `[START ADDING VEHICLES →]` → Navigate to `/add-vehicle`

### 2.2 Recent Activity Feed (Scrollable Cards)
```
┌─────────────────────────────────────┐
│  RECENT ACTIVITY                    │
│  ───────────────────────────────    │
│  ┌─────────────────────────────┐   │
│  │ [Vehicle Card]              │   │
│  │ 1987 Chevy Silverado        │   │
│  │ Updated 2h ago              │   │
│  │ [VIEW →]                    │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ [Vehicle Card]              │   │
│  │ 1999 Ford F-150             │   │
│  │ New images uploaded         │   │
│  │ [VIEW →]                    │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Clickable:**
- Each vehicle card → Navigate to `/vehicle/{vehicleId}`
- `[VIEW →]` buttons → Navigate to respective vehicle profile

### 2.3 Quick Actions Grid
```
┌─────────────────────────────────────┐
│  QUICK ACTIONS                      │
│  ───────────────────────────────    │
│  ┌───────────┬───────────┐          │
│  │ [➕ Add]  │ [📸 Scan] │          │
│  │  Vehicle  │   VIN     │          │
│  └───────────┴───────────┘          │
│  ┌───────────┬───────────┐          │
│  │ [📊 View] │ [🔍 Find] │          │
│  │ Dashboard │  Dealer   │          │
│  └───────────┴───────────┘          │
└─────────────────────────────────────┘
```

**Clickable:**
- `[➕ Add Vehicle]` → Navigate to `/add-vehicle`
- `[📸 Scan VIN]` → Open camera modal with VIN OCR
- `[📊 View Dashboard]` → Navigate to `/dashboard`
- `[🔍 Find Dealer]` → Navigate to `/browse-professionals`

---

## 3. VEHICLE PROFILE PAGE (`/vehicle/{vehicleId}`)

**Primary Mobile Layout:** Single column, all sections vertically stacked

### 3.1 Vehicle Header (Sticky)
```
┌─────────────────────────────────────┐
│  [← Back]  1987 Chevy Silverado     │
│  ───────────────────────────────    │
│  [📋 EVIDENCE] [🔍 FACTS] [💰 COM]  │
│  [💵 FINANCIALS]                    │
└─────────────────────────────────────┘
```

**Clickable:**
- `[← Back]` → Navigate back to previous page
- Vehicle name → Inline edit mode for vehicle details
- `[📋 EVIDENCE]` tab → Show Evidence section (Timeline, Images, Documents)
- `[🔍 FACTS]` tab → Show Facts section (AI Analysis, Specs, Validations)
- `[💰 COM]` tab → Show Commerce section (Listings, Trading, Shareholders)
- `[💵 FINANCIALS]` tab → Show Financials section (Pricing, Transactions, Financial Products)

### 3.2 EVIDENCE TAB (Default View)

#### 3.2.1 Hero Image Carousel
```
┌─────────────────────────────────────┐
│  ┌───────────────────────────────┐ │
│  │                               │ │
│  │     [HERO IMAGE]              │ │
│  │     Swipe left/right          │ │
│  │                               │ │
│  │  ○ ○ ● ○ ○  (pagination)     │ │
│  └───────────────────────────────┘ │
│  [🔍 Fullscreen] [📸 Add Photo]    │
└─────────────────────────────────────┘
```

**Clickable:**
- Image → Tap to open fullscreen viewer
- Swipe left/right → Navigate between images
- `[🔍 Fullscreen]` → Open fullscreen gallery
- `[📸 Add Photo]` → Open camera/gallery picker (if owner/contributor)

#### 3.2.2 Quick Stats Bar
```
┌─────────────────────────────────────┐
│  VEHICLE OVERVIEW                   │
│  ───────────────────────────────    │
│  Current Value:  $12,500 [EDIT]    │
│  Purchase Price: $8,000  [EDIT]    │
│  Gain/Loss:      +$4,500 (+56%)    │
│  ───────────────────────────────    │
│  Images: 23  |  Documents: 5       │
│  Timeline Events: 12  |  Views: 45  │
└─────────────────────────────────────┘
```

**Clickable:**
- `[EDIT]` next to Current Value → Open price editor modal
- `[EDIT]` next to Purchase Price → Open price editor modal
- `Images: 23` → Scroll to Images section
- `Documents: 5` → Scroll to Documents section
- `Timeline Events: 12` → Switch to Timeline view

#### 3.2.3 Basic Info Card
```
┌─────────────────────────────────────┐
│  BASIC INFORMATION              [✏] │
│  ───────────────────────────────    │
│  Year:       1987                   │
│  Make:       Chevrolet              │
│  Model:      Silverado K10          │
│  VIN:        1GCEK14K8HZ123456 [✓] │
│  Mileage:    145,000 miles          │
│  Color:      Red / White            │
│  Engine:     5.7L V8                │
│  Trans:      TH700-R4 Automatic     │
│  Drive:      4WD                    │
│  Body Style: Pickup Truck           │
│  Location:   Austin, TX             │
│  Status:     🟢 Active              │
│                                      │
│  [EDIT ALL FIELDS]                  │
└─────────────────────────────────────┘
```

**Clickable:**
- `[✏]` (edit icon top right) → Open comprehensive vehicle editor
- VIN field → Inline VIN editor with decoder
- Each field → Inline edit mode
- `[EDIT ALL FIELDS]` → Open comprehensive vehicle editor modal

#### 3.2.4 Description Card
```
┌─────────────────────────────────────┐
│  DESCRIPTION                    [✏] │
│  ───────────────────────────────    │
│  Classic square body Silverado      │
│  in excellent condition. Original   │
│  paint with minimal rust. Engine    │
│  rebuilt in 2022...                 │
│                                      │
│  [READ MORE]  [EDIT]                │
└─────────────────────────────────────┘
```

**Clickable:**
- `[✏]` or `[EDIT]` → Open description editor
- `[READ MORE]` → Expand full description

#### 3.2.5 Timeline Section (Horizontal Scroll)
```
┌─────────────────────────────────────┐
│  VEHICLE TIMELINE               [+] │
│  ───────────────────────────────    │
│  [< Scroll horizontally >]          │
│  ┌──────┬──────┬──────┬──────┐     │
│  │ 1987 │ 1995 │ 2010 │ 2022 │     │
│  │  │   │  │   │  │   │  │   │     │
│  │  ●   │  ●   │  ●   │  ●   │     │
│  │ Mfg  │Owner │Resto │Eng   │     │
│  └──────┴──────┴──────┴──────┘     │
│                                      │
│  [EXPAND FULL TIMELINE →]           │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Add new timeline event (opens wizard)
- Each timeline node → Open event detail modal
- `[EXPAND FULL TIMELINE →]` → Switch to full timeline view

#### 3.2.6 Image Gallery Grid
```
┌─────────────────────────────────────┐
│  IMAGES (23)                    [+] │
│  ───────────────────────────────    │
│  ┌───────┬───────┬───────┐         │
│  │[IMG1] │[IMG2] │[IMG3] │         │
│  └───────┴───────┴───────┘         │
│  ┌───────┬───────┬───────┐         │
│  │[IMG4] │[IMG5] │[IMG6] │         │
│  └───────┴───────┴───────┘         │
│  [VIEW ALL IMAGES →]                │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Open camera/gallery picker
- Each thumbnail → Open fullscreen viewer at that image
- `[VIEW ALL IMAGES →]` → Open full gallery view

#### 3.2.7 Documents Section
```
┌─────────────────────────────────────┐
│  DOCUMENTS (5)                  [+] │
│  ───────────────────────────────    │
│  📄 Title Document        [VIEW]    │
│     Uploaded: Nov 15, 2025          │
│  ───────────────────────────────    │
│  📄 Service Receipt       [VIEW]    │
│     Engine Rebuild - $3,200         │
│  ───────────────────────────────    │
│  📄 Registration         [VIEW]    │
│     Expires: Dec 2025               │
│  ───────────────────────────────    │
│  [VIEW ALL DOCUMENTS →]             │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Open document uploader modal
- Each `[VIEW]` button → Open document viewer/download
- Document name → Open document detail view
- `[VIEW ALL DOCUMENTS →]` → Navigate to documents page

### 3.3 FACTS TAB

#### 3.3.1 AI Analysis Card
```
┌─────────────────────────────────────┐
│  AI VEHICLE ANALYSIS            [⟳] │
│  ───────────────────────────────    │
│  Overall Confidence: 87%            │
│  Last Updated: 2 hours ago          │
│  ───────────────────────────────    │
│  Verified Facts:                    │
│  ✓ Original Engine - 95% conf      │
│  ✓ Factory Paint - 78% conf        │
│  ✓ OEM Interior - 82% conf         │
│  ───────────────────────────────    │
│  Needs Verification:                │
│  ? Mileage Reading - 45% conf      │
│  ? Transmission Date - 52% conf    │
│  ───────────────────────────────    │
│  [VIEW FULL ANALYSIS]               │
└─────────────────────────────────────┘
```

**Clickable:**
- `[⟳]` → Trigger new AI analysis
- Each fact → Open fact detail with evidence
- `[VIEW FULL ANALYSIS]` → Open detailed AI report

#### 3.3.2 Specifications Grid
```
┌─────────────────────────────────────┐
│  SPECIFICATIONS                 [✏] │
│  ───────────────────────────────    │
│  ENGINE                             │
│  Type:           V8                 │
│  Displacement:   5.7L               │
│  Horsepower:     210 HP             │
│  Torque:         300 lb-ft          │
│  ───────────────────────────────    │
│  TRANSMISSION                       │
│  Type:           Automatic          │
│  Model:          TH700-R4           │
│  Gears:          4-Speed            │
│  ───────────────────────────────    │
│  PERFORMANCE                        │
│  0-60 mph:       ~10.5s             │
│  Top Speed:      ~110 mph           │
│  MPG City:       12 mpg             │
│  MPG Highway:    16 mpg             │
│  ───────────────────────────────    │
│  [EXPAND ALL SPECS →]               │
└─────────────────────────────────────┘
```

**Clickable:**
- `[✏]` → Open spec editor
- Each spec field → Inline edit
- `[EXPAND ALL SPECS →]` → Show complete specifications

#### 3.3.3 Valuation Breakdown
```
┌─────────────────────────────────────┐
│  VALUATION INTEL                [⟳] │
│  ───────────────────────────────    │
│  Estimated Value: $12,500           │
│  Confidence: 78%                    │
│  ───────────────────────────────    │
│  VALUE COMPONENTS:                  │
│  Base Market Value    $10,000       │
│  + Condition Factor   +$1,500       │
│  + Originality Bonus  +$800         │
│  + Documentation      +$200         │
│  ───────────────────────────────    │
│  COMPARABLES:                       │
│  [1987 K10 - $11K] [VIEW]          │
│  [1988 K10 - $13K] [VIEW]          │
│  [1986 K10 - $9.5K] [VIEW]         │
│  ───────────────────────────────    │
│  [VIEW FULL VALUATION REPORT]       │
└─────────────────────────────────────┘
```

**Clickable:**
- `[⟳]` → Refresh valuation
- Each comparable `[VIEW]` → Open comparable vehicle listing
- `[VIEW FULL VALUATION REPORT]` → Open detailed valuation breakdown

#### 3.3.4 Ownership Verifications
```
┌─────────────────────────────────────┐
│  OWNERSHIP & VERIFICATION           │
│  ───────────────────────────────    │
│  Primary Owner: John Smith [YOU]   │
│  Verified: ✓ Title uploaded         │
│  ───────────────────────────────    │
│  CONTRIBUTORS (3):                  │
│  👤 Mike Johnson - Mechanic         │
│     Last contribution: 5 days ago   │
│  👤 Sarah Williams - Appraiser      │
│     Last contribution: 2 weeks ago  │
│  👤 Dave Brown - Restorer           │
│     Last contribution: 1 month ago  │
│  ───────────────────────────────    │
│  [MANAGE CONTRIBUTORS]              │
│  [VERIFY OWNERSHIP]                 │
└─────────────────────────────────────┘
```

**Clickable:**
- Each contributor → View contributor profile
- `[MANAGE CONTRIBUTORS]` → Open contributor management panel
- `[VERIFY OWNERSHIP]` → Upload title/registration for verification

### 3.4 COMMERCE TAB

#### 3.4.1 Trading Panel
```
┌─────────────────────────────────────┐
│  TRADING STATUS                 [⚙] │
│  ───────────────────────────────    │
│  🟢 LISTED FOR SALE                 │
│  Asking Price: $14,500              │
│  Reserve: $12,000 (private)         │
│  Listed: 12 days ago                │
│  Views: 145  |  Inquiries: 8        │
│  ───────────────────────────────    │
│  [EDIT LISTING]  [DELIST]           │
└─────────────────────────────────────┘
```

**Clickable:**
- `[⚙]` → Open trading settings
- `[EDIT LISTING]` → Edit listing details and price
- `[DELIST]` → Remove from marketplace

#### 3.4.2 External Listings
```
┌─────────────────────────────────────┐
│  EXTERNAL LISTINGS              [+] │
│  ───────────────────────────────    │
│  🏆 Bring a Trailer               │
│     Auction ends: 3 days            │
│     Current bid: $13,200            │
│     [VIEW AUCTION →]                │
│  ───────────────────────────────    │
│  📋 Cars & Bids                   │
│     Listed: $14,000                 │
│     [VIEW LISTING →]                │
│  ───────────────────────────────    │
│  [ADD EXTERNAL LISTING]             │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Add new external listing
- `[VIEW AUCTION →]` → Open external auction page
- `[VIEW LISTING →]` → Open external listing page
- `[ADD EXTERNAL LISTING]` → Add listing URL modal

#### 3.4.3 Shareholders / Supporters
```
┌─────────────────────────────────────┐
│  SHAREHOLDERS (5)               [+] │
│  ───────────────────────────────    │
│  👤 Alice Cooper - 25% ($3,125)    │
│     Invested: Nov 1, 2025           │
│  👤 Bob Dylan - 15% ($1,875)       │
│     Invested: Oct 15, 2025          │
│  👤 Charlie Watts - 10% ($1,250)   │
│     Invested: Sep 20, 2025          │
│  ───────────────────────────────    │
│  Total Invested: $6,250             │
│  Available: 50%                     │
│  ───────────────────────────────    │
│  [MANAGE SHARES]                    │
│  [OFFER SHARES]                     │
└─────────────────────────────────────┘
```

**Clickable:**
- Each shareholder → View shareholder profile
- `[+]` → Add new shareholder
- `[MANAGE SHARES]` → Edit share distribution
- `[OFFER SHARES]` → Create share offering

#### 3.4.4 Linked Organizations
```
┌─────────────────────────────────────┐
│  LINKED ORGANIZATIONS           [+] │
│  ───────────────────────────────    │
│  🏢 Classic Auto Restoration        │
│     Type: Shop                      │
│     Services: Engine, Body          │
│     [VIEW SHOP →]                   │
│  ───────────────────────────────    │
│  🏢 Austin Vintage Parts            │
│     Type: Supplier                  │
│     Parts supplied: 12 items        │
│     [VIEW SUPPLIER →]               │
│  ───────────────────────────────    │
│  [ADD ORGANIZATION]                 │
└─────────────────────────────────────┘
```

**Clickable:**
- Each organization → View organization profile
- `[+]` → Link new organization
- `[VIEW SHOP →]` → Navigate to shop profile
- `[VIEW SUPPLIER →]` → Navigate to supplier profile
- `[ADD ORGANIZATION]` → Search and link organization

### 3.5 FINANCIALS TAB

#### 3.5.1 Price History Chart
```
┌─────────────────────────────────────┐
│  PRICE HISTORY                  [+] │
│  ───────────────────────────────    │
│  [Line chart showing price over     │
│   time - touch to see values]       │
│   $14K ┤     ╭──╮                   │
│   $12K ┤   ╭─╯  ╰╮                  │
│   $10K ┤ ╭─╯     ╰─╮                │
│   $8K  ┼─╯          ╰──              │
│        └─────────────────>           │
│        2020  2022  2024              │
│  ───────────────────────────────    │
│  [VIEW DETAILED HISTORY]            │
└─────────────────────────────────────┘
```

**Clickable:**
- Chart → Tap to see exact values at points
- `[+]` → Add new price data point
- `[VIEW DETAILED HISTORY]` → Open full price history table

#### 3.5.2 Transactions
```
┌─────────────────────────────────────┐
│  TRANSACTION HISTORY            [+] │
│  ───────────────────────────────    │
│  📄 Purchase                        │
│     Date: Jan 15, 2020              │
│     Amount: $8,000                  │
│     From: Private Seller            │
│     [VIEW RECEIPT]                  │
│  ───────────────────────────────    │
│  📄 Engine Rebuild                 │
│     Date: Mar 22, 2022              │
│     Amount: $3,200                  │
│     Shop: Classic Auto              │
│     [VIEW RECEIPT]                  │
│  ───────────────────────────────    │
│  Total Invested: $11,200            │
│  ───────────────────────────────    │
│  [ADD TRANSACTION]                  │
└─────────────────────────────────────┘
```

**Clickable:**
- Each `[VIEW RECEIPT]` → Open receipt document
- `[+]` or `[ADD TRANSACTION]` → Add new transaction
- Each transaction → Open transaction detail

#### 3.5.3 Financial Products
```
┌─────────────────────────────────────┐
│  FINANCIAL PRODUCTS             [+] │
│  ───────────────────────────────    │
│  💳 Classic Car Insurance           │
│     Provider: Hagerty               │
│     Premium: $95/mo                 │
│     Coverage: $15,000               │
│     [MANAGE POLICY]                 │
│  ───────────────────────────────    │
│  💰 Vehicle Loan                   │
│     Lender: Credit Union            │
│     Balance: $4,200                 │
│     Payment: $185/mo                │
│     [VIEW LOAN DETAILS]             │
│  ───────────────────────────────    │
│  [ADD FINANCIAL PRODUCT]            │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Add new financial product
- `[MANAGE POLICY]` → Edit insurance details
- `[VIEW LOAN DETAILS]` → View loan amortization
- `[ADD FINANCIAL PRODUCT]` → Add insurance/loan/warranty

#### 3.5.4 Expense Breakdown
```
┌─────────────────────────────────────┐
│  EXPENSE BREAKDOWN                  │
│  ───────────────────────────────    │
│  Total Expenses: $3,850             │
│  ───────────────────────────────    │
│  Maintenance      $2,100 (55%)     │
│  Parts            $900 (23%)       │
│  Insurance        $570 (15%)       │
│  Registration     $280 (7%)        │
│  ───────────────────────────────    │
│  [PIE CHART]                        │
│  ───────────────────────────────    │
│  [VIEW DETAILED REPORT]             │
└─────────────────────────────────────┘
```

**Clickable:**
- Pie chart segments → Show category details
- `[VIEW DETAILED REPORT]` → Open expense analytics

### 3.6 Comments & Engagement
```
┌─────────────────────────────────────┐
│  COMMENTS (12)                      │
│  ───────────────────────────────    │
│  👤 Mike J. - 2 days ago            │
│     Beautiful truck! Original       │
│     paint?                          │
│     [REPLY] [⬆ 5]                   │
│  ───────────────────────────────    │
│  👤 Sarah W. - 5 days ago           │
│     What's the reserve?             │
│     [REPLY] [⬆ 2]                   │
│  ───────────────────────────────    │
│  [LOAD MORE COMMENTS]               │
│  ───────────────────────────────    │
│  [💬 Add Comment]                   │
│  [Type your comment...]             │
│  [POST]                             │
└─────────────────────────────────────┘
```

**Clickable:**
- Each `[REPLY]` → Open reply input
- `[⬆ 5]` (upvote) → Upvote comment
- User avatar/name → Navigate to user profile
- `[LOAD MORE COMMENTS]` → Load additional comments
- Comment input field → Focus and type
- `[POST]` → Submit comment

### 3.7 Reference Library
```
┌─────────────────────────────────────┐
│  REFERENCE LIBRARY              [+] │
│  ───────────────────────────────    │
│  📘 Owner's Manual (1987)          │
│     Pages: 324  |  Size: 45 MB     │
│     [VIEW] [DOWNLOAD]               │
│  ───────────────────────────────    │
│  📘 Shop Manual (1987)             │
│     Pages: 582  |  Size: 78 MB     │
│     [VIEW] [DOWNLOAD]               │
│  ───────────────────────────────    │
│  📄 Parts Catalog                  │
│     Pages: 156  |  Size: 22 MB     │
│     [VIEW] [DOWNLOAD]               │
│  ───────────────────────────────    │
│  [UPLOAD REFERENCE MATERIAL]        │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Upload new reference material
- Each `[VIEW]` → Open document viewer
- Each `[DOWNLOAD]` → Download document
- `[UPLOAD REFERENCE MATERIAL]` → Open uploader

---

## 4. DASHBOARD PAGE (`/dashboard`)

### 4.1 Cash Balance Card
```
┌─────────────────────────────────────┐
│  CASH BALANCE                       │
│  ───────────────────────────────    │
│  Available: $2,450.00               │
│  ───────────────────────────────    │
│  [ADD FUNDS]  [WITHDRAW]            │
└─────────────────────────────────────┘
```

**Clickable:**
- `[ADD FUNDS]` → Open payment modal
- `[WITHDRAW]` → Open withdrawal flow

### 4.2 Portfolio Summary
```
┌─────────────────────────────────────┐
│  PORTFOLIO OVERVIEW                 │
│  ───────────────────────────────    │
│  Total Value:    $45,200            │
│  Total Invested: $38,500            │
│  Gain/Loss:      +$6,700 (+17%)    │
│  24h Change:     +$120 (+0.3%)     │
│  ───────────────────────────────    │
│  Vehicles: 3  |  Organizations: 2   │
│  ───────────────────────────────    │
│  [VIEW DETAILED PORTFOLIO]          │
└─────────────────────────────────────┘
```

**Clickable:**
- `[VIEW DETAILED PORTFOLIO]` → Navigate to portfolio analytics

### 4.3 Action Items (Scrollable List)
```
┌─────────────────────────────────────┐
│  ACTION ITEMS (5)                   │
│  ───────────────────────────────    │
│  🔴 HIGH PRIORITY                   │
│  1987 Silverado up 56%              │
│  Consider selling? Market up.       │
│  [VIEW VEHICLE →]                   │
│  ───────────────────────────────    │
│  🟡 MEDIUM PRIORITY                 │
│  1999 F-150 needs photos            │
│  Upload images to increase value    │
│  [ADD PHOTOS →]                     │
│  ───────────────────────────────    │
│  [VIEW ALL ACTION ITEMS]            │
└─────────────────────────────────────┘
```

**Clickable:**
- Each action item card → Navigate to relevant page
- `[VIEW VEHICLE →]` → Navigate to vehicle profile
- `[ADD PHOTOS →]` → Navigate to vehicle + open camera
- `[VIEW ALL ACTION ITEMS]` → Expand full list

### 4.4 Recent Activity Timeline
```
┌─────────────────────────────────────┐
│  RECENT ACTIVITY                    │
│  ───────────────────────────────    │
│  ● 2 hours ago                      │
│    New images uploaded to           │
│    1987 Silverado                   │
│    [VIEW →]                         │
│  ───────────────────────────────    │
│  ● Yesterday                        │
│    Price updated on 1999 F-150      │
│    $8,500 → $9,200                 │
│    [VIEW →]                         │
│  ───────────────────────────────    │
│  [VIEW FULL TIMELINE]               │
└─────────────────────────────────────┘
```

**Clickable:**
- Each activity → Navigate to related entity
- `[VIEW →]` → Navigate to vehicle/org
- `[VIEW FULL TIMELINE]` → Show complete activity log

### 4.5 Deal Matches
```
┌─────────────────────────────────────┐
│  DEAL MATCHES (3)                   │
│  ───────────────────────────────    │
│  1988 Chevy Silverado K10           │
│  $11,500 - Bring a Trailer          │
│  Similar to your 1987 K10           │
│  [VIEW LISTING →]                   │
│  ───────────────────────────────    │
│  1986 Chevy K10 Custom              │
│  $9,800 - Cars & Bids               │
│  [VIEW LISTING →]                   │
│  ───────────────────────────────    │
│  [VIEW ALL DEALS]                   │
└─────────────────────────────────────┘
```

**Clickable:**
- Each deal card → Open external listing
- `[VIEW LISTING →]` → Open external URL
- `[VIEW ALL DEALS]` → Navigate to deals page

---

## 5. MY VEHICLES PAGE (`/vehicles`)

### 5.1 Vehicle List (Cards)
```
┌─────────────────────────────────────┐
│  MY VEHICLES (3)                [+] │
│  [🔍 Search vehicles...]            │
│  ───────────────────────────────    │
│  ┌─────────────────────────────┐   │
│  │ [THUMBNAIL]                 │   │
│  │ 1987 Chevy Silverado K10    │   │
│  │ Value: $12,500 (+56%)      │   │
│  │ Images: 23  |  Docs: 5      │   │
│  │ [VIEW] [EDIT] [SHARE]       │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ [THUMBNAIL]                 │   │
│  │ 1999 Ford F-150 XLT         │   │
│  │ Value: $9,200 (+8%)        │   │
│  │ Images: 12  |  Docs: 3      │   │
│  │ [VIEW] [EDIT] [SHARE]       │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Navigate to `/add-vehicle`
- Search field → Type to filter vehicles
- Vehicle card → Navigate to vehicle profile
- `[VIEW]` → Navigate to vehicle profile
- `[EDIT]` → Open vehicle editor
- `[SHARE]` → Open share options modal
- Thumbnail → Navigate to vehicle profile

---

## 6. ADD VEHICLE PAGE (`/add-vehicle`)

### 6.1 Quick Add Options
```
┌─────────────────────────────────────┐
│  ADD VEHICLE                        │
│  ───────────────────────────────    │
│  Choose how to add:                 │
│  ───────────────────────────────    │
│  [📸 SCAN VIN]                     │
│  Take photo of VIN tag              │
│  ───────────────────────────────    │
│  [⌨ ENTER VIN]                     │
│  Type VIN manually                  │
│  ───────────────────────────────    │
│  [🔗 BRING A TRAILER URL]          │
│  Import from auction listing        │
│  ───────────────────────────────    │
│  [📝 MANUAL ENTRY]                 │
│  Enter details manually             │
│  ───────────────────────────────    │
│  [📦 BULK CSV IMPORT]              │
│  Upload multiple vehicles           │
└─────────────────────────────────────┘
```

**Clickable:**
- `[📸 SCAN VIN]` → Open camera with OCR
- `[⌨ ENTER VIN]` → Show VIN input field
- `[🔗 BRING A TRAILER URL]` → Show URL input
- `[📝 MANUAL ENTRY]` → Show full form
- `[📦 BULK CSV IMPORT]` → Open CSV uploader

### 6.2 VIN Entry Form (if selected)
```
┌─────────────────────────────────────┐
│  ENTER VIN                          │
│  ───────────────────────────────    │
│  [________________17_chars______]   │
│  ✓ Valid VIN                        │
│  ───────────────────────────────    │
│  [DECODE VIN]                       │
│  ───────────────────────────────    │
│  Decoded Information:               │
│  Year:  1987                        │
│  Make:  Chevrolet                   │
│  Model: K10 Pickup                  │
│  Body:  Pickup Truck                │
│  Engine: 5.7L V8                    │
│  ───────────────────────────────    │
│  [CONTINUE →]                       │
└─────────────────────────────────────┘
```

**Clickable:**
- VIN input field → Type VIN
- `[DECODE VIN]` → Fetch vehicle data from NHTSA
- `[CONTINUE →]` → Proceed to next step

### 6.3 Manual Entry Form
```
┌─────────────────────────────────────┐
│  VEHICLE DETAILS                    │
│  ───────────────────────────────    │
│  Year*     [____]                   │
│  Make*     [____]                   │
│  Model*    [____]                   │
│  VIN       [____]                   │
│  Mileage   [____] miles             │
│  Color     [____]                   │
│  ───────────────────────────────    │
│  Purchase Price  [$____]            │
│  Purchase Date   [__/__/____]       │
│  ───────────────────────────────    │
│  [📸 Add Photos]                   │
│  [📄 Add Documents]                │
│  ───────────────────────────────    │
│  [CANCEL]  [CREATE VEHICLE →]       │
└─────────────────────────────────────┘
```

**Clickable:**
- All input fields → Type/select values
- `[📸 Add Photos]` → Open camera/gallery
- `[📄 Add Documents]` → Open document picker
- `[CANCEL]` → Return to vehicles list
- `[CREATE VEHICLE →]` → Submit and create vehicle

---

## 7. ORGANIZATIONS PAGE (`/shops`)

### 7.1 Organization List
```
┌─────────────────────────────────────┐
│  MY ORGANIZATIONS (2)           [+] │
│  [🔍 Search organizations...]       │
│  ───────────────────────────────    │
│  ┌─────────────────────────────┐   │
│  │ 🏢 Classic Auto Restoration │   │
│  │ Type: Shop                  │   │
│  │ Member since: Jan 2023      │   │
│  │ Role: Owner                 │   │
│  │ Vehicles: 5  |  Staff: 3    │   │
│  │ [VIEW] [MANAGE]             │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ 🏢 Texas Truck Club         │   │
│  │ Type: Club                  │   │
│  │ Member since: Mar 2024      │   │
│  │ Role: Member                │   │
│  │ Members: 45                 │   │
│  │ [VIEW] [LEAVE]              │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Create new organization
- Search field → Filter organizations
- Organization card → Navigate to org profile
- `[VIEW]` → Navigate to org profile
- `[MANAGE]` → Open org settings
- `[LEAVE]` → Leave organization

---

## 8. PROFILE PAGE (`/profile`)

### 8.1 User Profile Header
```
┌─────────────────────────────────────┐
│  [AVATAR]                       [⚙] │
│  John Smith                         │
│  @johnsmith                         │
│  ───────────────────────────────    │
│  Joined: January 2023               │
│  Location: Austin, TX               │
│  ───────────────────────────────    │
│  Vehicles: 3  |  Contributions: 45  │
│  Organizations: 2                   │
│  ───────────────────────────────    │
│  [EDIT PROFILE]                     │
└─────────────────────────────────────┘
```

**Clickable:**
- `[AVATAR]` → Upload new avatar
- `[⚙]` → Open settings
- `[EDIT PROFILE]` → Edit profile details

### 8.2 User Contributions
```
┌─────────────────────────────────────┐
│  MY CONTRIBUTIONS (45)              │
│  ───────────────────────────────    │
│  📸 Uploaded 12 images              │
│     to 1987 Silverado               │
│     2 days ago                      │
│     [VIEW →]                        │
│  ───────────────────────────────    │
│  📝 Added engine specs              │
│     to 1999 F-150                   │
│     5 days ago                      │
│     [VIEW →]                        │
│  ───────────────────────────────    │
│  [VIEW ALL CONTRIBUTIONS]           │
└─────────────────────────────────────┘
```

**Clickable:**
- Each contribution → Navigate to related entity
- `[VIEW →]` → Navigate to vehicle
- `[VIEW ALL CONTRIBUTIONS]` → Show full contribution history

### 8.3 Account Settings
```
┌─────────────────────────────────────┐
│  ACCOUNT SETTINGS                   │
│  ───────────────────────────────    │
│  [📧 Email Settings]               │
│  [🔔 Notification Preferences]     │
│  [🔒 Privacy Settings]             │
│  [💳 Payment Methods]              │
│  [🔗 Connected Accounts]           │
│  [⚠ Delete Account]                │
│  ───────────────────────────────    │
│  [SIGN OUT]                         │
└─────────────────────────────────────┘
```

**Clickable:**
- Each settings option → Open respective settings panel
- `[SIGN OUT]` → Log out user

---

## 9. BROWSE PROFESSIONALS PAGE (`/browse-professionals`)

### 9.1 Professional Search
```
┌─────────────────────────────────────┐
│  FIND PROFESSIONALS                 │
│  ───────────────────────────────    │
│  [🔍 Search by name, specialty...]  │
│  ───────────────────────────────    │
│  Filter by:                         │
│  Type:     [All ▼]                  │
│  Location: [Near me ▼]              │
│  Rating:   [4+ stars ▼]             │
│  ───────────────────────────────    │
│  [APPLY FILTERS]                    │
└─────────────────────────────────────┘
```

**Clickable:**
- Search field → Type search query
- Each dropdown → Select filter value
- `[APPLY FILTERS]` → Apply search filters

### 9.2 Professional Cards (List)
```
┌─────────────────────────────────────┐
│  RESULTS (12)                       │
│  ───────────────────────────────    │
│  ┌─────────────────────────────┐   │
│  │ [PHOTO]                     │   │
│  │ Mike Johnson               ⭐│   │
│  │ Certified Mechanic    4.8/5 │   │
│  │ Austin, TX - 5 miles away   │   │
│  │ Specialties: Engine, Trans  │   │
│  │ [VIEW PROFILE] [CONTACT]    │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ [PHOTO]                     │   │
│  │ Sarah Williams             ⭐│   │
│  │ Vehicle Appraiser     4.9/5 │   │
│  │ [VIEW PROFILE] [CONTACT]    │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Clickable:**
- Professional card → View full profile
- `[VIEW PROFILE]` → Navigate to professional profile
- `[CONTACT]` → Open contact modal (message/call)

---

## 10. PROJECT MANAGEMENT PAGE (`/project-management`)

### 10.1 Active Projects
```
┌─────────────────────────────────────┐
│  ACTIVE PROJECTS (2)            [+] │
│  ───────────────────────────────    │
│  ┌─────────────────────────────┐   │
│  │ Engine Rebuild              │   │
│  │ 1987 Silverado              │   │
│  │ Progress: ███████░░ 70%     │   │
│  │ Due: Dec 15, 2025           │   │
│  │ Tasks: 8/12 complete        │   │
│  │ [VIEW PROJECT]              │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ Paint Restoration           │   │
│  │ 1999 F-150                  │   │
│  │ Progress: ████░░░░░ 40%     │   │
│  │ Tasks: 3/8 complete         │   │
│  │ [VIEW PROJECT]              │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Clickable:**
- `[+]` → Create new project
- Project card → View project details
- `[VIEW PROJECT]` → Navigate to project detail page

### 10.2 Task List (within project)
```
┌─────────────────────────────────────┐
│  PROJECT: Engine Rebuild        [✏] │
│  ───────────────────────────────    │
│  ✓ Disassemble engine           ✓  │
│  ✓ Inspect components           ✓  │
│  ✓ Order replacement parts      ✓  │
│  ○ Machine block & heads        →  │
│  ○ Assemble engine                 │
│  ○ Test engine                     │
│  ───────────────────────────────    │
│  [ADD TASK]  [MARK COMPLETE]        │
└─────────────────────────────────────┘
```

**Clickable:**
- `[✏]` → Edit project details
- Each task → View/edit task details
- Checkboxes → Mark task complete
- `[ADD TASK]` → Add new task
- `[MARK COMPLETE]` → Mark current task done

---

## 11. PHOTO CATEGORIZER PAGE (`/photo-categorizer`)

### 11.1 Upload Interface
```
┌─────────────────────────────────────┐
│  PHOTO CATEGORIZER                  │
│  ───────────────────────────────    │
│  [📸 TAKE PHOTOS]                  │
│  [📁 SELECT FROM GALLERY]          │
│  [📦 IMPORT FROM DROPBOX]          │
│  ───────────────────────────────    │
│  Selected: 0 photos                 │
└─────────────────────────────────────┘
```

**Clickable:**
- `[📸 TAKE PHOTOS]` → Open camera
- `[📁 SELECT FROM GALLERY]` → Open gallery picker
- `[📦 IMPORT FROM DROPBOX]` → Connect Dropbox

### 11.2 AI Categorization Results
```
┌─────────────────────────────────────┐
│  CATEGORIZED PHOTOS (24)            │
│  ───────────────────────────────    │
│  EXTERIOR (8)                   [→] │
│  [thumb][thumb][thumb][thumb]...    │
│  ───────────────────────────────    │
│  ENGINE (5)                     [→] │
│  [thumb][thumb][thumb][thumb]...    │
│  ───────────────────────────────    │
│  INTERIOR (4)                   [→] │
│  [thumb][thumb][thumb][thumb]       │
│  ───────────────────────────────    │
│  DOCUMENTS (3)                  [→] │
│  [thumb][thumb][thumb]              │
│  ───────────────────────────────    │
│  [APPLY TO VEHICLE]                 │
└─────────────────────────────────────┘
```

**Clickable:**
- Each category `[→]` → Expand category
- Each thumbnail → View full image
- `[APPLY TO VEHICLE]` → Assign photos to vehicle

---

## 12. FINANCIALS PAGE (`/financials`)

### 12.1 Overview Cards
```
┌─────────────────────────────────────┐
│  FINANCIAL OVERVIEW                 │
│  ───────────────────────────────    │
│  Total Income:    $15,200           │
│  Total Expenses:  $8,450            │
│  Net Profit:      $6,750            │
│  ───────────────────────────────    │
│  [VIEW DETAILED REPORT]             │
└─────────────────────────────────────┘
```

### 12.2 Quick Actions
```
┌─────────────────────────────────────┐
│  QUICK ACTIONS                      │
│  ───────────────────────────────    │
│  [📝 Create Invoice]               │
│  [💳 Record Payment]               │
│  [📊 View Reports]                 │
│  [🏭 Manage Suppliers]             │
└─────────────────────────────────────┘
```

**Clickable:**
- `[VIEW DETAILED REPORT]` → Navigate to analytics
- `[📝 Create Invoice]` → Open invoice creator
- `[💳 Record Payment]` → Open payment entry form
- `[📊 View Reports]` → Navigate to reports page
- `[🏭 Manage Suppliers]` → Navigate to suppliers page

---

## 13. BOTTOM NAVIGATION BAR (Global - Always Visible)

```
┌─────────────────────────────────────┐
│ [HOME] [VEHICLES] [ADD] [DASH] [USER] │
└─────────────────────────────────────┘
```

**Fixed Position:** `position: fixed; bottom: 0; width: 100%; z-index: 100`

**Clickable:**
- `[HOME]` → Navigate to `/discover`
- `[VEHICLES]` → Navigate to `/vehicles`
- `[ADD]` (center button) → Quick action menu (Add Vehicle, Add Photo, Add Doc)
- `[DASH]` → Navigate to `/dashboard`
- `[USER]` → Navigate to `/profile`

**Quick Action Menu (when `[ADD]` tapped):**
```
┌─────────────────────────────────────┐
│  [Add Vehicle]                      │
│  [Take Photo]                       │
│  [Upload Document]                  │
│  [Quick Note]                       │
│  [Close X]                          │
└─────────────────────────────────────┘
```

---

## 14. MOBILE-SPECIFIC FEATURES

### 14.1 Swipe Gestures
- **Image Galleries:** Swipe left/right to navigate
- **Timeline:** Swipe horizontally to scroll through events
- **Tab Views:** Swipe left/right to switch between tabs
- **Back Navigation:** Swipe right from left edge to go back

### 14.2 Touch Optimizations
- **Minimum Touch Target:** 44px × 44px for all buttons
- **Thumb Zone:** Primary actions at bottom of screen
- **Sticky Elements:** Header and navigation always accessible
- **Pull to Refresh:** Available on list views

### 14.3 Camera Integration
- **Direct Camera Access:** Tap camera buttons → instant capture
- **OCR Integration:** Automatic VIN/text recognition
- **AI Tagging:** Real-time image categorization

### 14.4 Offline Capabilities
- **Data Caching:** Vehicle data cached for offline viewing
- **Offline Queue:** Images/changes queued when offline
- **Sync Indicator:** Visual feedback when syncing

---

## 15. DESIGN SPECIFICATIONS

### 15.1 Typography [[memory:4177398]]
- **Base Font Size:** 10px (all body text)
- **Header Font Size:** 12px (section headers only)
- **Font Family:** Arial, sans-serif
- **Font Weight:** Normal (bold ONLY for hierarchy)

### 15.2 Colors (Design System)
- **Primary:** `#0066cc`
- **Background:** `#ffffff`
- **Grey 200:** `#e0e0e0`
- **Border:** `#bdbdbd`
- **Text:** `#000000`
- **Muted Text:** `#757575`

### 15.3 Spacing
- **Base Unit:** 8px
- **Padding:** 12px (cards), 8px (buttons)
- **Margins:** 12px (sections), 4px (elements)

### 15.4 Borders
- **Border Radius:** 0px (flat design)
- **Border Width:** 2px
- **Border Style:** Solid

### 15.5 Animations
- **Transitions:** 0.12s ease
- **Hover Effects:** Subtle lift (2px)
- **Focus Rings:** 2px solid primary color

---

## 16. IMPLEMENTATION NOTES

### 16.1 Component Architecture
- **Mobile Components:** Separate `mobile/` directory
- **Shared Components:** Reuse where possible
- **Responsive Detection:** `useIsMobile()` hook
- **Conditional Rendering:** Show mobile vs desktop based on screen size

### 16.2 Navigation Strategy
- **Bottom Tab Bar:** Always visible for primary navigation
- **Drawer Menu:** Complete navigation hierarchy
- **Breadcrumbs:** Show current location context
- **Back Button:** Always visible in headers

### 16.3 Data Loading
- **Lazy Loading:** Load images/data on scroll
- **Skeleton Screens:** Show loading placeholders
- **Error States:** Clear error messages with retry options
- **Empty States:** Helpful prompts to add content

### 16.4 Performance
- **Image Optimization:** WebP format, lazy loading
- **Code Splitting:** Route-based chunking
- **Debouncing:** Search inputs, scroll handlers
- **Memoization:** React.memo for expensive renders

---

## 17. FEATURE PARITY CHECKLIST

### Desktop Features to Implement on Mobile:
- ✓ Vehicle Profile (Evidence/Facts/Commerce/Financials tabs)
- ✓ Timeline with horizontal scroll
- ✓ Image gallery with fullscreen viewer
- ✓ Document uploader and viewer
- ✓ Price editor and history
- ✓ Valuation breakdown
- ✓ Trading panel (for sale, external listings)
- ✓ Shareholders/supporters
- ✓ Linked organizations
- ✓ Comments and engagement
- ✓ Reference library
- ✓ AI analysis and confidence scores
- ✓ Specifications editor
- ✓ Ownership verifications
- ✓ Transaction history
- ✓ Expense breakdown
- ✓ Financial products
- ✓ Dashboard with action items
- ✓ Portfolio summary
- ✓ Deal matches
- ✓ Project management
- ✓ Professional directory
- ✓ Photo categorizer
- ✓ VIN decoder
- ✓ Organizations management
- ✓ User profile and contributions

**All features accounted for** - Mobile version will have 100% feature parity with desktop.

---

## 18. VISUAL WIREFRAME SUMMARY

**Vertical Stack Layout (Single Column):**
1. Sticky Header (Menu, Logo, Notifications, Profile)
2. Page Content (Scrollable)
   - Hero Section
   - Quick Stats
   - Tabbed Content (Evidence/Facts/Commerce/Financials)
   - All sections from desktop in vertical order
   - Comments section
   - Related content
3. Bottom Navigation Bar (Home, Vehicles, Add, Dashboard, Profile)

**Every section from desktop is present, just reorganized vertically for mobile screens.**

---

**END OF WIREFRAME SPECIFICATION**

This comprehensive wireframe ensures that the mobile version is a true miniature of the desktop version with zero feature loss and complete navigation mapping.

