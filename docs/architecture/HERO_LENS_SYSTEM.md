# Hero Lens System — Each Sort Button Is a Market View

## Philosophy

Each toolbar button is not a sort order. It's a LENS — a way of seeing the market.
When you click NEWEST, you're not reordering a list. You're asking: "What's happening
right now?" The hero panel answers that question visually before you ever scroll the feed.

Think Google Trends notable searches, but for physical assets flowing through auction
houses, marketplaces, and private sales across the entire internet in real time.

---

## The Lenses

### NEWEST — "What's pouring through the spout"
**Question:** What just arrived? Where is it coming from?

**Hero shows:**
- Source flow: BaT +47 | FB +312 | MECUM +8 | CL +23 (last hour, live updating)
- Make heatmap: which makes are arriving fastest right now
- Price bracket waterfall: what price ranges are the new arrivals
- Geographic dots: where are listings appearing (if location data exists)

**Signal:** This is the intake pulse. Are we seeing a surge in trucks? Porsches
cooling off? CL flooded with project cars? The data tells the story.

**Backend:** `vehicles WHERE created_at > now() - interval '24 hours' GROUP BY source, make, price bracket`

---

### OLDEST — "What's being unearthed"
**Question:** What's the oldest stuff we're discovering? What history is surfacing?

**Hero shows:**
- Decade treemap: 1900s, 1910s, 1920s... sized by recent discovery rate
- Rarest finds: oldest vehicles discovered in last 30 days
- Pre-war vs post-war vs modern ratio trending over time

**Signal:** Growing because we keep discovering more historical data. A 1932 Duesenberg
showing up in Bonhams archives is a discovery event.

**Backend:** `vehicles ORDER BY year ASC, created_at DESC` — recently discovered old vehicles

---

### FINDS — "Curated high-signal discoveries"
**Question:** What's worth paying attention to right now?

**Hero shows:**
- Multi-signal view: vehicles where MULTIPLE signals align
  - Search surge + price drop = opportunity
  - Barn find + rare model = news
  - Price record + high comment count = market event
- "71 CUDA BARN FIND" style cards — the stories, not just the data
- Trending searches (from view history aggregate when we have enough users)
- Cross-source appearances: same car listed on 3 platforms = hot commodity

**Signal:** This is editorial weight. Not just new, not just cheap — INTERESTING.
Requires combining signals: rarity, price movement, community attention, cross-platform
activity, description_discoveries red flags, unusual specs.

**Backend:** Composite score from: deal_score, heat_score, rarity signals, comment velocity,
cross-platform count, description_discoveries.red_flags, search trend correlation

---

### DEALS — "What's priced wrong"
**Question:** Where's the arbitrage? What's underpriced?

**Hero shows:**
- Deal score distribution: histogram of deal_score across active listings
- Top deals by make: which makes have the biggest price-to-value gaps
- "$500 DUSTER" style highlights — the shocking deals
- Price vs estimate scatter: dots below the line are deals, above are overpriced
- Time decay: deals that have been sitting (motivated sellers)

**Signal:** A 1974 Duster for $500 when comps say $4K. That's a 87% deal score.
Show it prominently. The user should see deals and FEEL urgency.

**Backend:** `deal_score DESC WHERE is_for_sale = true` + price vs nuke_estimate deviation

---

### HEAT — "Where's the attention"
**Question:** What's generating buzz? What's everyone looking at?

**Hero shows:**
- Comment velocity: vehicles with most comments in last 24h
- Bid war tracker: live auctions with highest bid count
- View count surge: vehicles getting disproportionate views (when we have server-side tracking)
- Social signal: vehicles shared most (future)
- Make heat treemap: which makes are getting the most total attention

**Signal:** Heat is attention × time. A vehicle with 300 comments in 2 days is HOT.
A vehicle with 5 comments in 6 months is cold. The ratio matters.

**Backend:** `heat_score DESC` + `auction_comments WHERE posted_at > now() - 24h GROUP BY vehicle_id`
+ bid count from vehicle_events + view_count from vehicle_views (future)

---

### PRICE ↓ / PRICE ↑ — "The market ladder"
**Question:** What does the market look like by price?

**Hero shows:**
- Price waterfall: brackets from $0-1K up to $1M+ as proportional bars
- Each bracket: count, representative vehicle thumbnail, top make in that bracket
- Click a bracket → feed filters to that range
- Median line marker

**Backend:** Simple GROUP BY on display_price brackets

---

### YEAR — "Time machine"
**Question:** What era are you shopping?

**Hero shows:**
- Decade timeline: 1920s through 2020s as horizontal bars
- Each decade: count, representative image, top make of that era
- Click a decade → feed filters to that year range
- "Golden eras" highlighted: 1965-1972 muscle, 1986-1995 JDM, 2004-2012 modern classic

**Backend:** GROUP BY decade, with era annotations from domain knowledge

---

### MILES — "Condition proxy"
**Question:** How fresh vs how driven?

**Hero shows:**
- Mileage buckets: 0-1K (delivery miles), 1-10K (garage queen), 10-50K (well kept),
  50-100K (driver), 100K+ (survivor)
- Each bucket: count, median price, price premium/discount vs average for same model
- The story: "GARAGE QUEENS command 2.3x premium over DRIVERS in Porsche 911"

**Backend:** GROUP BY mileage bucket, JOIN with price data for premium calculation

---

## Design System

All hero panels:
- Max height: 240px (compact, not overwhelming)
- Background: var(--surface)
- 2px top/bottom borders
- Treemap cells: 2px borders, zero radius, Courier New for data
- Labels: 8-9px Arial UPPERCASE
- Values: 10-11px Courier New BOLD
- Animations: 200ms slide-down cubic-bezier(0.16, 1, 0.3, 1)
- Click any element → filters feed + optionally closes panel
- Click same button → closes panel
- NEVER show average price — use median, range, or specific values

## Backend Requirements

### Immediate (existing data)
- price brackets, year decades, mileage buckets: simple GROUP BY on feed MV
- deal_score, heat_score: already computed per vehicle
- source flow: vehicles.created_at + source GROUP BY
- comment velocity: auction_comments.posted_at aggregate

### Near-term (needs new computation)
- FINDS composite score: combine deal_score + heat_score + rarity + cross-platform
- Search trend correlation: need view_history server-side aggregation
- Bid war tracking: need real-time bid extraction from live auctions

### Long-term
- User-specific heat (what YOUR community is looking at)
- Price prediction (where is this model heading)
- Geographic arbitrage (same car, different price by region)

## Scope

Phase 1: Static hero panels with client-side aggregation from loaded feed data (DONE — HeroPanel.tsx exists)
Phase 2: Server-side RPCs for each lens with proper aggregation across full dataset
Phase 3: Real-time updates (WebSocket or polling for NEWEST/HEAT)
Phase 4: Personalized lenses (YOUR deals, YOUR heat based on interests)
