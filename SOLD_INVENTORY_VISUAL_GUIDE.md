# Sold Inventory Browser - Visual Guide

## Interface Layout

### Controls Bar
```
┌─────────────────────────────────────────────────────────────────────┐
│ [Search sold inventory...               ] [Sort ▾] [Gallery|Grid|Tech] │
└─────────────────────────────────────────────────────────────────────┘
   Showing 7 of 7 sold vehicles
```

---

## View Mode 1: GALLERY VIEW (Default)

Perfect for browsing with visual context and detailed sale info.

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ [SOLD]         121 photos│  │ [SOLD]          59 photos│  │ [SOLD]          10 photos│
│                         │  │                         │  │                         │
│   [Vehicle Image]       │  │   [Vehicle Image]       │  │   [Vehicle Image]       │
│                         │  │                         │  │                         │
│                         │  │                         │  │                         │
├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤
│ 1978 Chevrolet          │  │ 1972 Chevrolet          │  │ 1972 Chevrolet          │
│ Scottsdale K20          │  │ K10                     │  │ K10                     │
│ 4×4 4-Speed             │  │ Super Pickup 4×4        │  │ Cheyenne Super          │
│                         │  │                         │  │                         │
│ $45,000                 │  │ $38,500                 │  │ $32,000                 │
│ ─────────────────────   │  │ ─────────────────────   │  │ ─────────────────────   │
│ Sold on: Bring a Trailer│  │ Sold on: Bring a Trailer│  │ Sold on: Bring a Trailer│
│ Date: 7/14/2025         │  │ Date: 6/10/2024         │  │ Date: 6/10/2024         │
│ View original listing → │  │ View original listing → │  │ View original listing → │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘

┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ [SOLD]           9 photos│  │ [SOLD]           1 photo│  │ [SOLD]           1 photo│
│   [1966 C10]            │  │   [Thor RV]             │  │   [Speed UTV]           │
│ 1966 Chevrolet C10      │  │ 2019 Thor Hurricane     │  │ 2023 Speed UTV          │
│ Pickup 3-Speed          │  │ Motorhome               │  │ Jefe LE                 │
│ $22,500                 │  │ $125,000                │  │ $42,000                 │
│ Bring a Trailer         │  │ Private Sale            │  │ Private Sale            │
│ 5/3/2024                │  │ 6/16/2025               │  │ 3/14/2025               │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

**Gallery View Features:**
- Large, browsable images (4:3 aspect ratio)
- Price as focal point (big, bold, accent color)
- Platform + Date clearly visible
- Link to original listing
- Photo count badge
- "SOLD" badge overlay on image

---

## View Mode 2: GRID VIEW

Compact layout for quick browsing of many vehicles.

```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│[SOLD]   │ │[SOLD]   │ │[SOLD]   │ │[SOLD]   │ │[SOLD]   │ │[SOLD]   │
│         │ │         │ │         │ │         │ │         │ │         │
│ [IMG]   │ │ [IMG]   │ │ [IMG]   │ │ [IMG]   │ │ [IMG]   │ │ [IMG]   │
│         │ │         │ │         │ │         │ │         │ │         │
├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤
│1978     │ │1972     │ │1972     │ │1966     │ │2019     │ │2023     │
│Chevrolet│ │Chevrolet│ │Chevrolet│ │Chevrolet│ │Thor     │ │Speed    │
│K20      │ │K10      │ │K10      │ │C10      │ │Hurricane│ │UTV      │
│$45,000  │ │$38,500  │ │$32,000  │ │$22,500  │ │$125,000 │ │$42,000  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

**Grid View Features:**
- Square thumbnails (1:1 ratio)
- 4-6 columns (responsive)
- Minimal text (essentials only)
- Quick scanning optimized
- Hover effect for details

---

## View Mode 3: TECHNICAL VIEW

Full data table with all specifications visible.

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Vehicle                     │ Engine      │ Trans      │ Drive │ Miles  │ Sale Price │ Platform          │ Date      │ Photos │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1978 Chevrolet Scottsdale K20│ 6.6L V8     │ 4-Speed    │ 4WD   │ N/A    │ $45,000    │ Bring a Trailer → │ 7/14/2025 │   121  │
│ 4×4 4-Speed                 │ (400ci)     │ Manual     │       │        │            │                   │           │        │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1972 Chevrolet K10          │ 5.7L V8     │ Automatic  │ 4WD   │ N/A    │ $38,500    │ Bring a Trailer → │ 6/10/2024 │   59   │
│ Super Pickup 4×4            │ (350ci)     │            │       │        │            │                   │           │        │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1972 Chevrolet K10          │ 5.7L V8     │ Automatic  │ 4WD   │ N/A    │ $32,000    │ Bring a Trailer → │ 6/10/2024 │   10   │
│ Cheyenne Super              │ (350ci)     │            │       │        │            │                   │           │        │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1966 Chevrolet C10          │ 4.6L I6     │ 3-Speed    │ 2WD   │ N/A    │ $22,500    │ Bring a Trailer → │ 5/3/2024  │    9   │
│ Pickup 3-Speed              │ (283ci)     │ Manual     │       │        │            │                   │           │        │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2019 Thor Hurricane         │ 6.8L V10    │ Automatic  │ RWD   │ N/A    │ $125,000   │ Private Sale      │ 6/16/2025 │    1   │
│ Motorhome                   │ (415ci)     │            │       │        │            │                   │           │        │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2023 Speed UTV              │ 1.0L Twin   │ CVT        │ AWD   │ N/A    │ $42,000    │ Private Sale      │ 3/14/2025 │    1   │
│ Jefe LE                     │ Turbo (61ci)│            │       │        │            │                   │           │        │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1988 Jeep Wrangler          │ 4.2L I6     │ 5-Speed    │ 4WD   │ N/A    │ $18,750    │ Bring a Trailer → │ 4/15/2024 │    5   │
│ Sahara                      │ (258ci)     │ Manual     │       │        │            │                   │           │        │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Technical View Features:**
- All vehicle specs in columns
- Sortable by any column
- Clickable platform links (open in new tab)
- Engine size + displacement (cubic inches)
- Compact row spacing for data density
- Hover row highlighting
- Perfect for comparison shopping

---

## Search & Sort Examples

### Search: "1972"
**Results:** 2 vehicles (both 1972 K10s)

### Search: "bat"
**Results:** 5 vehicles (all sold on Bring a Trailer)

### Search: "v8"
**Results:** 4 vehicles (all V8 engines)

### Sort by Price (High to Low)
```
1. $125,000 - 2019 Thor Hurricane
2. $45,000  - 1978 Chevrolet K20
3. $42,000  - 2023 Speed UTV
4. $38,500  - 1972 Chevrolet K10
5. $32,000  - 1972 Chevrolet K10
6. $22,500  - 1966 Chevrolet C10
7. $18,750  - 1988 Jeep Wrangler
```

### Sort by Year (Newest First)
```
1. 2023 Speed UTV
2. 2019 Thor Hurricane
3. 1988 Jeep Wrangler
4. 1978 Chevrolet K20
5. 1972 Chevrolet K10 (×2)
6. 1966 Chevrolet C10
```

---

## Color Scheme & Styling

### Badges
- **"SOLD" Badge:** Red background (#DC2626), white text, bold
- **Photo Count:** Black semi-transparent overlay, white text
- **Platform:** Accent color for links, hover underline

### Cards
- Border: 1px solid var(--border)
- Border radius: 4px
- Background: white
- Hover: Lift effect (translateY + box-shadow)
- Transition: 0.12s ease

### Typography
- **Vehicle Name:** 11pt, bold (700)
- **Trim:** 8pt, secondary color
- **Price:** 13pt, bold, accent color
- **Meta Info:** 7pt, muted color

### View Mode Buttons
```
┌──────────┬──────┬──────────────┐
│ Gallery  │ Grid │ Technical    │  ← Active state (accent bg, white text)
└──────────┴──────┴──────────────┘
```

---

## Responsive Behavior

### Desktop (>1200px)
- Gallery: 3 columns
- Grid: 6 columns
- Technical: Full table visible

### Tablet (768-1200px)
- Gallery: 2 columns
- Grid: 4 columns
- Technical: Horizontal scroll

### Mobile (<768px)
- Gallery: 1 column
- Grid: 2 columns
- Technical: Horizontal scroll

---

## Empty States

### No Sold Vehicles
```
┌─────────────────────────────────────────┐
│                                         │
│          No sold vehicles yet           │
│                                         │
└─────────────────────────────────────────┘
```

### No Search Results
```
┌─────────────────────────────────────────┐
│    No vehicles match your search        │
│    Try adjusting your filters           │
└─────────────────────────────────────────┘
```

---

## Interaction States

### Clickable Elements
- **Vehicle Card:** Cursor pointer, lifts on hover → Navigate to vehicle profile
- **Platform Link:** Blue underline on hover → Open listing in new tab
- **View Buttons:** Background color change → Switch view mode
- **Sort Dropdown:** Highlight on hover → Change sort order

### Loading State
```
┌─────────────────────────────────────────┐
│   Loading sold inventory...             │
└─────────────────────────────────────────┘
```

---

## Key UX Decisions

1. **Gallery is default** - Most visually engaging for first-time visitors
2. **Sort by date** - Most recent sales are typically most relevant
3. **"SOLD" badge prominent** - Immediately clear these aren't available
4. **Platform links clickable** - Users want to see original listings
5. **Price never hidden** - Transparency builds trust
6. **Search always visible** - Quick filtering is essential for comps
7. **Three views cover all use cases:**
   - **Gallery** = Casual browsing
   - **Grid** = Quick scanning
   - **Technical** = Detailed comparison

---

## Use Case Scenarios

### Scenario 1: Buyer researching 1972 K10 values
1. Search "1972 k10"
2. See 2 results: $38,500 and $32,000
3. Click to see detailed specs and photos
4. Check BaT listings for bid history

### Scenario 2: Dealer pricing new inventory
1. Switch to Technical view
2. Sort by Price (high to low)
3. Compare similar year/model/condition
4. Price new truck between comps

### Scenario 3: Enthusiast browsing sold trucks
1. Leave search empty (see all)
2. Toggle between Gallery and Grid
3. Click interesting vehicles to see full profiles
4. Reference sale platforms for future searches

---

## Future Enhancement Ideas

1. **Price Graph:** Show price trends over time
2. **Export CSV:** Download all sold data
3. **Email Alerts:** Notify when similar vehicle sells
4. **Advanced Filters:**
   - Price range slider
   - Date range picker
   - Multi-select makes/models
5. **Comparison Mode:** Select 2-3 vehicles to compare side-by-side
6. **Market Analytics:** Average prices by make/model/year

---

**This interface transforms the organization profile from a static page into a powerful market research tool.**

