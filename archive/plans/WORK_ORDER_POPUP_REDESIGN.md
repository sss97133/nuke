# Work Order Popup Redesign - "The Shop Day Debrief"

## Current State (BORING AS FUCK)
- Just shows: vehicle name, title, description, some badges
- Tiny images in a grid
- No shopping, no saving, no research tools
- No sense of the shop's expertise or the work's value
- Users bounce immediately - USELESS

## What It Should Be
**"The Research Terminal"** - A place where gearheads, shops, and buyers can:
1. **Study the work** - Understand what was done, why, and how
2. **Shop the build** - Buy every part, tool, material used
3. **Bookmark for later** - Save cool builds, techniques, shops
4. **Learn pricing** - See labor rates, material costs, value added
5. **Doom scroll content** - Swipe through high-res images with annotations
6. **Connect with pros** - Message the shop, see their other work

---

## Redesigned Work Order Viewer

### **HEADER SECTION** (Always visible, sticky)
```
┌─────────────────────────────────────────────────────────────┐
│ 🗓 Saturday, October 30, 2025                    [🔖][✕]   │
│ Ernie's Upholstery • $95/hr labor rate                     │
│ ────────────────────────────────────────────────────────── │
│ 1974 Ford Bronco Interior Upholstery Replacement           │
│ [$2,450 parts] [38.5h labor] [6 photos] [🎯 92% quality]  │
└─────────────────────────────────────────────────────────────┘
```

**Elements:**
- **Bookmark button (🔖)** - Black flag when saved. Saves entire work order to user's "Research Library"
- **Shop name** - Clickable to org profile
- **Labor rate** - Transparency, helps users estimate their own work
- **Vehicle** - Clickable to vehicle profile
- **Key metrics** - Parts cost, labor hours, photo count, AI quality score

---

### **TABS NAVIGATION**
```
[ Overview ] [ Parts ($2,450) ] [ Labor (38.5h) ] [ Photos (6) ] [ Shop Info ]
```

#### **Tab 1: OVERVIEW**
The "what happened here" view - AI-generated summary + manual notes

```
┌─────────────────────────────────────────────────────────────┐
│ 📋 Work Summary                                             │
│ ────────────────────────────────────────────────────────── │
│ Complete interior upholstery replacement featuring premium   │
│ brown leather with diamond stitch pattern. Seats, door      │
│ panels, and headliner upgraded. Custom pattern matching     │
│ original 1974 aesthetic while using modern materials.       │
│                                                             │
│ ✓ Front bucket seats reupholstered (12h)                   │
│ ✓ Rear bench seat reupholstered (8h)                       │
│ ✓ Door panels custom fabricated (10h)                      │
│ ✓ Headliner replaced (4.5h)                                │
│ ✓ Carpet installation (4h)                                 │
│                                                             │
│ 💡 Shop Notes:                                              │
│ "Customer wanted diamond stitch to match classic Bronco     │
│ vibe but with modern foam padding for comfort. We used      │
│ marine-grade leather for durability."                       │
│                                                             │
│ 🎯 Quality Rating: 92/100 (AI Analysis)                    │
│ • Excellent craftsmanship (stitch consistency, alignment)   │
│ • High-quality materials detected                           │
│ • Professional finish                                       │
│ • Minor: Small gap visible in passenger door panel seam    │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- AI-generated work summary (from `generate-work-logs` edge function)
- Checklist of tasks completed with time estimates
- Shop's manual notes (editable by shop owner)
- AI quality rating with specific findings
- **"Ask AI about this work"** button - Chat interface to ask questions

---

#### **Tab 2: PARTS & MATERIALS ($2,450)**
The **shopping list** - every part used, with buy buttons

```
┌─────────────────────────────────────────────────────────────┐
│ 🛒 Parts & Materials Used                     Total: $2,450 │
│ ────────────────────────────────────────────────────────── │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ [IMG] Brown Diamond Stitch Leather (12 sq yards)    │   │
│ │       Auto Custom Carpets #ACC-BRONCO-LEATHER-BRN   │   │
│ │       $1,200                                         │   │
│ │       [🛒 Buy on Summit] [📋 Save Part]            │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ [IMG] High-Density Foam Padding (3" thick)          │   │
│ │       TMI Products #TMI-FOAM-3IN                     │   │
│ │       $340                                           │   │
│ │       [🛒 Buy on Amazon] [📋 Save Part]            │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ [IMG] Marine-Grade Thread (UV resistant)            │   │
│ │       Coats & Clark #MARINE-138                      │   │
│ │       $45                                            │   │
│ │       [🛒 Buy on eBay] [📋 Save Part]              │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ... (9 more parts)                                          │
│                                                             │
│ [💾 Save Entire Parts List] [📤 Export CSV]               │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- **Each part is a card** with image, name, part #, price
- **Buy buttons** - Deep links to Summit Racing, Amazon, eBay, RockAuto
- **Save part** - Bookmark to user's "Parts Library"
- **Save entire list** - Export as shopping list
- **AI part matching** - If shop didn't log exact part #, AI suggests matches
- **Alternative parts** - Cheaper/better options suggested

**Data Sources:**
1. Receipt OCR (from `smart-receipt-linker`)
2. AI vision analysis (from `generate-work-logs` - "parts_identified")
3. Manual shop input (when they upload work order)
4. Community edits (verified users can suggest part numbers)

---

#### **Tab 3: LABOR BREAKDOWN (38.5h)**
The **transparency view** - what labor cost, why, and if it's fair

```
┌─────────────────────────────────────────────────────────────┐
│ ⏱ Labor Breakdown                    38.5h × $95/hr = $3,658│
│ ────────────────────────────────────────────────────────── │
│                                                             │
│ Remove Old Upholstery                        4.0h    $380   │
│ ├─ Front seats (2h)                                         │
│ ├─ Rear bench (1h)                                          │
│ └─ Door panels (1h)                                         │
│                                                             │
│ Pattern Fabrication & Cutting               6.0h    $570   │
│ └─ Custom templates for diamond stitch                     │
│                                                             │
│ Sewing & Assembly                           12.0h   $1,140  │
│ ├─ Front seat covers (6h)                                  │
│ ├─ Rear bench cover (4h)                                   │
│ └─ Door panel covers (2h)                                  │
│                                                             │
│ Foam Replacement & Prep                     5.0h    $475   │
│ └─ Cut, shape, glue foam padding                           │
│                                                             │
│ Installation & Fitting                      10.0h   $950   │
│ ├─ Front seats (4h)                                        │
│ ├─ Rear bench (3h)                                         │
│ ├─ Door panels (2h)                                        │
│ └─ Final adjustments (1h)                                  │
│                                                             │
│ Headliner Replacement                       4.5h    $428   │
│                                                             │
│ ────────────────────────────────────────────────────────── │
│ 📊 Industry Comparison:                                     │
│ • Mitchell1 estimate: 32-40h (✓ within range)             │
│ • Avg shop rate (upholstery): $85-110/hr (✓ competitive)  │
│ • Total project value: $6,108 (parts + labor)             │
│                                                             │
│ [💬 Ask Shop About This] [📋 Save Labor Guide]            │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- **Itemized labor** - Every task, time, cost
- **Industry benchmarks** - Mitchell1, Chilton, AllData comparisons
- **Fair pricing indicator** - Green if competitive, yellow if high, red if excessive
- **Shop notes** - Why certain tasks took longer
- **Save as reference** - Bookmark for DIY planning or price checking other shops

**Data Sources:**
1. Shop manual input (ideal)
2. AI estimation from photos (fallback)
3. Mitchell1/Chilton API lookups
4. Community-sourced labor times

---

#### **Tab 4: PHOTOS (6) - The Doom Scroll**
High-res image viewer with annotations, before/after, zoom

```
┌─────────────────────────────────────────────────────────────┐
│ 📸 Work Documentation                           [◀ 1/6 ▶]   │
│ ────────────────────────────────────────────────────────── │
│                                                             │
│         ┌──────────────────────────────────────────┐       │
│         │                                          │       │
│         │      [FULL-SCREEN IMAGE]                 │       │
│         │                                          │       │
│         │   Pinch to zoom, swipe for next         │       │
│         │                                          │       │
│         └──────────────────────────────────────────┘       │
│                                                             │
│ 🏷 AI Tags: diamond-stitch, brown-leather, custom-piping   │
│                                                             │
│ 📝 Photo Details:                                          │
│ • Taken: Oct 30, 2025 2:45 PM                             │
│ • Location: Ernie's Upholstery (GPS confirmed)            │
│ • Stage: Final installation                                │
│ • Quality: Excellent (sharp, well-lit)                     │
│                                                             │
│ 💬 Shop Notes:                                             │
│ "Diamond stitch pattern aligned perfectly with seat        │
│ contours. Customer requested extra padding on bolsters."   │
│                                                             │
│ 🔍 Zoom Hotspots (tap to inspect):                        │
│ • [📍] Stitch detail (upper left)                         │
│ • [📍] Seam alignment (center)                            │
│ • [📍] Material texture (close-up)                        │
│                                                             │
│ [🔖 Save Photo] [📤 Share] [🛒 Shop Similar Materials]    │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- **Full-screen swipeable gallery** - Mobile-optimized
- **Pinch to zoom** - Inspect stitch quality, welds, paint
- **AI annotations** - Auto-tagged with parts, techniques, quality issues
- **Before/After slider** - If shop uploaded comparison shots
- **EXIF data** - Date, location, camera (proves work was done)
- **Shop commentary** - What they're proud of, challenges faced
- **Zoom hotspots** - AI highlights areas of interest
- **Shop this look** - Buy similar materials/parts

---

#### **Tab 5: SHOP INFO**
Quick shop profile, contact, portfolio

```
┌─────────────────────────────────────────────────────────────┐
│ 🏭 Ernie's Upholstery                                       │
│ ────────────────────────────────────────────────────────── │
│ [LOGO]                                                      │
│                                                             │
│ 📍 Las Vegas, NV (GPS verified)                            │
│ ⏰ Mon-Fri 8am-5pm                                          │
│ 💰 $95/hr labor rate                                        │
│ ⭐ 4.8/5.0 (127 reviews)                                    │
│                                                             │
│ 🔧 Specialties:                                             │
│ • Classic truck interiors                                   │
│ • Custom leather work                                       │
│ • Marine upholstery                                         │
│                                                             │
│ 📊 Recent Work:                                             │
│ • 38 vehicles in last 90 days                              │
│ • $12,450 avg project value                                │
│ • 92% avg quality rating (AI)                              │
│                                                             │
│ [💬 Request Quote] [📞 Call Shop] [👁 View Profile]        │
│ [🔖 Follow Shop] [📤 Share Shop]                           │
└─────────────────────────────────────────────────────────────┘
```

---

## NEW FEATURES TO BUILD

### 1. **Bookmark System** (Critical)
**Database Table:** `user_bookmarks`
```sql
CREATE TABLE user_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  bookmark_type TEXT NOT NULL, -- 'work_order', 'part', 'shop', 'technique'
  reference_id UUID NOT NULL, -- timeline_event.id, part.id, business.id, etc.
  title TEXT,
  thumbnail_url TEXT,
  notes TEXT, -- User's personal notes
  tags TEXT[], -- User's custom tags
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**UI:**
- Black flag icon (🏴) when bookmarked
- Accessible from user profile → "Research Library"
- Organized by type, searchable, taggable

### 2. **Parts Database & Shopping Links**
**Database Table:** `work_order_parts`
```sql
CREATE TABLE work_order_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id UUID REFERENCES business_timeline_events(id),
  part_name TEXT NOT NULL,
  part_number TEXT,
  brand TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  supplier TEXT, -- 'Summit Racing', 'Amazon', 'RockAuto'
  buy_url TEXT,
  image_url TEXT,
  ai_extracted BOOLEAN DEFAULT false,
  user_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**AI Enhancement:**
- OCR receipts for part numbers
- Vision AI identifies parts in photos
- Match to Summit Racing / RockAuto APIs
- Community can verify/correct

### 3. **Labor Breakdown System**
**Database Table:** `work_order_labor`
```sql
CREATE TABLE work_order_labor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id UUID REFERENCES business_timeline_events(id),
  task_name TEXT NOT NULL,
  hours DECIMAL(5,2) NOT NULL,
  hourly_rate DECIMAL(10,2),
  total_cost DECIMAL(10,2),
  task_category TEXT, -- 'removal', 'fabrication', 'installation', etc.
  difficulty_rating INTEGER, -- 1-10
  notes TEXT,
  ai_estimated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Industry Integration:**
- Query Mitchell1 / AllData for standard labor times
- Compare shop's time vs. industry standard
- Flag if significantly over/under (quality indicator)

### 4. **Image Annotations & Hotspots**
**Database Table:** `image_annotations`
```sql
CREATE TABLE image_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID REFERENCES organization_images(id),
  x_percent DECIMAL(5,2), -- Position on image (0-100%)
  y_percent DECIMAL(5,2),
  annotation_type TEXT, -- 'part', 'quality_issue', 'technique', 'tool'
  title TEXT,
  description TEXT,
  related_part_id UUID REFERENCES work_order_parts(id),
  created_by UUID REFERENCES auth.users(id),
  ai_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**AI:**
- Auto-detect interesting areas (welds, stitches, fitment)
- Create clickable hotspots
- Link to parts database

### 5. **Work Order Chat / Q&A**
**Feature:** AI-powered Q&A about the work
- "Why did this take 38 hours?"
- "Can I use cheaper foam?"
- "What tools are needed for this?"

**Implementation:**
- Pass entire work order context to GPT-4
- Include: photos, parts list, labor breakdown, shop notes
- Cite sources in responses

---

## IMPLEMENTATION PRIORITY

### Phase 1: Core Popup Redesign (NOW)
1. ✅ Tabbed interface (Overview, Parts, Labor, Photos, Shop)
2. ✅ Bookmark button (save to `user_bookmarks`)
3. ✅ Enhanced photo viewer (swipeable, zoomable)
4. ✅ Parts list display (from AI + manual input)
5. ✅ Labor breakdown display

### Phase 2: Shopping Integration (Week 2)
1. Parts database population (AI + manual)
2. Buy button links (Summit, Amazon, RockAuto)
3. Part number lookups
4. Alternative part suggestions

### Phase 3: Advanced Features (Week 3)
1. Image annotations & hotspots
2. AI Q&A chat interface
3. Industry labor time comparisons
4. Before/after image sliders

---

## Why This Matters

**For Users:**
- Research builds before buying/building
- Learn techniques and pricing
- Shop smart (parts + labor transparency)
- Bookmark cool builds for later

**For Shops:**
- Showcase expertise transparently
- Get new customers (via portfolio)
- Educate customers (reduce scope creep)
- Build trust with pricing transparency

**For Platform:**
- Users spend 10x more time on site (doom scrolling work orders)
- Affiliate revenue (parts links)
- Data goldmine (pricing, labor times, parts usage)
- Network effects (users bookmark → share → invite friends)

---

## YOUR CALL

Want me to build **Phase 1** now? It's ~500 lines of code:
1. New tabbed popup component
2. Bookmark system (DB + UI)
3. Enhanced photo viewer
4. Parts/labor display from existing metadata

Then we iterate from there. Sound good?

