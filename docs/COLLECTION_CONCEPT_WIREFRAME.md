# Collection Concept - Comprehensive Wireframe

## Overview
A "Collection" is more than just vehicles - it's a personal showcase that defines the user. It represents ownership, curation, and personal identity in the n-zero ecosystem.

---

## Core Philosophy

**Collection = Personal Identity + Ownership + Curation**

Unlike the generic "Vehicles" page (which shows all relationships), Collection is:
- **Personal**: What YOU own, curated, and showcase
- **Defining**: Tells your story as a collector/enthusiast
- **Selective**: You choose what to include/exclude
- **Multi-dimensional**: Not just vehicles, but everything you collect

---

## Collection Components

### 1. **VEHICLES** (Primary)
**What it shows:**
- Vehicles you own (`user_id` match)
- Vehicles with verified ownership (title documents)
- Optionally: Vehicles you've curated/featured

**Display modes:**
- **Gallery Grid**: Visual showcase with primary images
- **Timeline View**: Chronological acquisition
- **Category View**: Grouped by make/model/era
- **Value View**: Sorted by current value

**Metadata per vehicle:**
- Primary image
- Year/Make/Model
- Current value
- Acquisition date
- Days owned
- Total investment
- Status (owned, sold, consigned)

---

### 2. **PARTS & COMPONENTS**
**What it shows:**
- Parts you own (inventory)
- Rare/collectible parts
- Parts you're searching for (wishlist)
- Parts you've sold/traded

**Display:**
- Grid of part images
- Part details (part number, condition, value)
- Linked to vehicles (if installed)
- Marketplace status

---

### 3. **DOCUMENTATION & MEMORABILIA**
**What it shows:**
- Factory brochures
- Service manuals
- Original paperwork (titles, receipts)
- Historical documents
- Photos/prints
- Collectibles (badges, emblems, etc.)

**Display:**
- Document thumbnails
- Linked to vehicles
- Categorized by type
- Timeline of acquisition

---

### 4. **TOOLS & EQUIPMENT**
**What it shows:**
- Tools you own
- Specialty equipment
- Shop tools
- Diagnostic equipment

**Display:**
- Tool inventory grid
- Linked to work sessions
- Usage stats
- Value tracking

---

### 5. **KNOWLEDGE & EXPERTISE**
**What it shows:**
- Articles you've written
- Guides you've created
- Knowledge you've contributed
- Your expertise areas

**Display:**
- Article/library items
- Contribution stats
- Expertise badges
- Linked to vehicles/topics

---

### 6. **ORGANIZATIONS & AFFILIATIONS**
**What it shows:**
- Shops you own/run
- Organizations you're part of
- Clubs/memberships
- Professional affiliations

**Display:**
- Organization cards
- Your role/status
- Contribution stats
- Linked vehicles/work

---

### 7. **ACHIEVEMENTS & MILESTONES**
**What it shows:**
- Restoration completions
- Awards/recognition
- Firsts (first vehicle, first sale, etc.)
- Personal milestones

**Display:**
- Achievement badges
- Timeline of milestones
- Linked to vehicles/events
- Shareable highlights

---

## Collection Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  COLLECTION                                             │
│  [Filter] [Sort] [View: Grid | Timeline | List]        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Vehicles │  │  Parts   │  │  Docs    │             │
│  │   (12)   │  │   (45)   │  │   (23)   │             │
│  └──────────┘  └──────────┘  └──────────┘             │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  Tools   │  │Knowledge │  │   Orgs   │             │
│  │   (8)    │  │   (15)   │  │   (3)    │             │
│  └──────────┘  └──────────┘  └──────────┘             │
│                                                         │
│  [Main Content Area - Selected Category]               │
│                                                         │
│  ┌──────────────────────────────────────────────┐     │
│  │  VEHICLES (12)                               │     │
│  │  [Grid View]                                 │     │
│  │                                              │     │
│  │  [Vehicle Card] [Vehicle Card] [Vehicle Card]│     │
│  │  [Vehicle Card] [Vehicle Card] [Vehicle Card]│     │
│  │                                              │     │
│  └──────────────────────────────────────────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Collection Settings

**Privacy Controls:**
- Make collection public/private
- Show/hide specific items
- Show/hide values
- Show/hide acquisition dates

**Curation:**
- Pin featured items
- Create custom collections (e.g., "Project Cars", "Daily Drivers")
- Add notes/descriptions
- Set display order

**Stats:**
- Total collection value
- Total items
- Acquisition timeline
- Category breakdown

---

## Database Schema Considerations

### Collection Items Table
```sql
CREATE TABLE user_collection_items (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  
  -- What type of item
  item_type TEXT NOT NULL, -- 'vehicle', 'part', 'document', 'tool', 'knowledge', 'organization'
  item_id UUID NOT NULL, -- ID of the item in its respective table
  
  -- Collection metadata
  is_featured BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  notes TEXT,
  acquired_date DATE,
  acquired_price DECIMAL,
  
  -- Curation
  collection_category TEXT, -- 'owned', 'curated', 'wishlist', 'sold'
  custom_tags TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, item_type, item_id)
);
```

---

## Implementation Phases

### Phase 1: Vehicle Collection (Current)
- ✅ Show vehicles user owns
- ✅ Grid view with images
- ⏳ Add filtering/sorting
- ⏳ Add timeline view

### Phase 2: Multi-Item Collection
- ⏳ Add parts collection
- ⏳ Add documentation collection
- ⏳ Add tools collection
- ⏳ Unified collection view

### Phase 3: Curation Features
- ⏳ Featured items
- ⏳ Custom collections
- ⏳ Privacy controls
- ⏳ Notes/descriptions

### Phase 4: Stats & Insights
- ⏳ Collection value tracking
- ⏳ Acquisition timeline
- ⏳ Category breakdown
- ⏳ Shareable highlights

---

## User Experience Flow

1. **Viewing Own Collection:**
   - See everything you own/curate
   - Organize by category
   - Add/remove items
   - Set privacy

2. **Viewing Others' Collections:**
   - See public items only
   - Filter by category
   - View stats (if public)
   - Follow/favorite collections

3. **Managing Collection:**
   - Add items from vehicles/parts/etc.
   - Remove items
   - Reorder items
   - Add notes
   - Set featured items

---

## Key Differentiators from "Vehicles" Page

| Feature | Vehicles Page | Collection |
|---------|--------------|------------|
| **Purpose** | Manage all relationships | Showcase personal ownership |
| **Scope** | All vehicles (owned, contributed, interested) | Only owned/curated items |
| **Items** | Vehicles only | Vehicles + Parts + Docs + Tools + etc. |
| **Privacy** | Relationship-based | User-controlled |
| **Curation** | Automatic (by relationship) | Manual (user selects) |
| **Display** | List/table view | Gallery/showcase view |

---

## Next Steps

1. **Fix current VehicleCollection query** ✅
2. **Add collection item management UI**
3. **Create collection_item database table**
4. **Build multi-category collection view**
5. **Add curation features**
6. **Add stats/insights**

