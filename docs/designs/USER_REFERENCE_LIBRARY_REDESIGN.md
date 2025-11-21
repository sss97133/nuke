# Reference Library - User/Entity Ownership Model

## Concept Shift

### OLD APPROACH (Auto-Shared)
```
reference_libraries (one per YMM)
  ↓
All 1973 K5 Blazers share the same library
Upload once → Everyone sees it
```

### NEW APPROACH (User/Entity Owned)
```
USER owns their reference library
  ↓
User decides what to share
  ↓
Link documents to specific vehicles
```

**Like your toolbox**: You own your tools, you decide which vehicles to use them on.

---

## Entity Relationship Diagram (Redesigned)

```
┌─────────────────────────┐
│  users / organizations  │
│  (auth.users/businesses)│
└───────────┬─────────────┘
            │ owns
            ▼
┌─────────────────────────┐
│  reference_documents    │ ← User's personal library
├─────────────────────────┤
│ id (PK)                 │
│ owner_id (FK)           │ ← User or Organization
│ owner_type              │ ← 'user' or 'organization'
│                         │
│ document_type           │ Types:
│ title                   │ - brochure
│ file_url                │ - manual
│ thumbnail_url           │ - spec_sheet
│ page_count              │ - paint_codes
│                         │ - rpo_codes
│ -- Applies to --        │ - wiring_diagram
│ year                    │
│ make                    │ What vehicles can use this?
│ series                  │ (loose matching)
│ body_style              │
│                         │
│ is_public               │ ← Share with everyone?
│ created_at              │
└───────────┬─────────────┘
            │ can be linked to
            ▼
┌─────────────────────────┐
│  vehicle_documents      │ ← Links docs to specific vehicles
├─────────────────────────┤
│ vehicle_id (FK)         │
│ document_id (FK)        │
│ linked_by               │
│ link_type               │ 'owner', 'shared', 'borrowed'
└─────────────────────────┘
```

---

## How It Works

### Scenario 1: Skylar's Personal Library

```
Skylar uploads:
  - 1973 Chevrolet Trucks brochure
  - 1967-1986 RPO code list
  - K5 Blazer service manual
  
Skylar's vehicles:
  - 1977 K5 Blazer → Links brochure + RPO + manual
  - 1973 GMC K5 Jimmy → Links brochure + RPO
  - 1985 K10 Suburban → Links RPO only
  
Other users:
  - Can SEE Skylar's docs if marked public
  - Can BOOKMARK for their own use
  - Can LINK to their vehicles (if shared)
```

### Scenario 2: Shop/Organization Library

```
"Viva! Las Vegas Autos" organization:
  - Uploads shop manuals
  - Uploads wiring diagrams
  - Uploads TSBs
  
Vehicles worked on at that shop:
  - Automatically suggested to link shop's docs
  - Owner can accept/reject
  - Creates reference trail
```

### Scenario 3: Community Sharing

```
User A: Uploads 1973 brochure (marks as public)
User B: Sees it, bookmarks it, links to their vehicle
User C: Uploads better quality scan (marks as public)
  
Users can choose which version to use
No forced auto-sharing
```

---

## Simplified Database Schema

```sql
-- User/Organization owned documents
CREATE TABLE IF NOT EXISTS reference_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Ownership (user OR organization)
  owner_id UUID NOT NULL,
  owner_type TEXT NOT NULL,  -- 'user', 'organization'
  
  -- Document info
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  
  -- File storage
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_size_bytes BIGINT,
  page_count INTEGER,
  mime_type TEXT,
  
  -- Applicability (what vehicles can use this)
  year INTEGER,              -- NULL = applies to all years
  make TEXT,                 -- NULL = applies to all makes
  series TEXT,               -- NULL = applies to all series
  body_style TEXT,           -- NULL = applies to all body styles
  year_range_start INTEGER,  -- For docs spanning years
  year_range_end INTEGER,
  
  -- Publishing info
  year_published INTEGER,
  publisher TEXT,
  part_number TEXT,
  language TEXT DEFAULT 'en',
  
  -- Sharing & Access
  is_public BOOLEAN DEFAULT FALSE,      -- Share with everyone?
  is_factory_original BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  tags TEXT[],
  
  -- Stats
  view_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  link_count INTEGER DEFAULT 0,
  
  -- Admin
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link documents to specific vehicles
CREATE TABLE IF NOT EXISTS vehicle_documents (
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  
  linked_by UUID NOT NULL REFERENCES auth.users(id),
  link_type TEXT DEFAULT 'owner',  -- 'owner', 'shared', 'public'
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (vehicle_id, document_id)
);

-- User bookmarks
CREATE TABLE IF NOT EXISTS user_document_bookmarks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  
  notes TEXT,
  bookmarked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (user_id, document_id)
);
```

---

## Access Patterns

### 1. User's Personal Library
```
/library/my-documents

Shows:
- Documents I uploaded
- Documents I bookmarked
- Organized by vehicle type
- Upload new button
```

### 2. Vehicle Profile Integration
```
Left Column:
┌────────────────────────┐
│ Reference Docs (2)     │
├────────────────────────┤
│ 📘 1973 Brochure       │ ← Linked by you
│    Your library        │
│                        │
│ 📗 RPO Codes           │ ← Linked by you
│    Your library        │
│                        │
│ + Link document        │ ← Browse your library
│ + Upload new           │ ← Add to your library
└────────────────────────┘
```

### 3. Organization Library
```
Viva! Las Vegas Autos:
- Has their own document library
- Shop manuals, diagrams, TSBs
- Linked to vehicles they work on
- Visible to vehicle owners
```

---

## Simpler Implementation

```sql
-- Just one main table for documents
CREATE TABLE reference_documents (
  id UUID PRIMARY KEY,
  
  -- WHO owns this
  owner_id UUID NOT NULL,
  owner_type TEXT NOT NULL,  -- 'user' or 'organization'
  
  -- WHAT it is
  document_type TEXT,
  title TEXT,
  file_url TEXT,
  
  -- WHAT vehicles it applies to (loose tags)
  year INTEGER,
  make TEXT,
  series TEXT,
  
  -- SHARING
  is_public BOOLEAN DEFAULT FALSE,
  
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Link to specific vehicles
CREATE TABLE vehicle_documents (
  vehicle_id UUID REFERENCES vehicles(id),
  document_id UUID REFERENCES reference_documents(id),
  linked_by UUID REFERENCES auth.users(id),
  
  PRIMARY KEY (vehicle_id, document_id)
);
```

**That's it!** Much simpler than the auto-shared approach.

---

## Usage Flow

### You Upload Your 1973 Brochure:
```
1. Go to /library (your personal library page)
2. Click "Upload document"
3. Select file: 1973-chevrolet-trucks-blazer.pdf
4. Tag: year=1973, make=Chevrolet, series=K5
5. Mark public: Yes (others can see/use it)
6. Upload
```

### Link to Your K5 Blazer:
```
1. On vehicle profile
2. Click "+ Link document"
3. Browse your library
4. Select "1973 Brochure"
5. Done - now shows in Reference Docs section
```

### Other Users See It:
```
Other K5 Blazer owners:
- Browse public documents
- Filter: year=1973, make=Chevrolet, series=K5
- Find your brochure
- Click "Link to my vehicle"
- Now they have it too
```

---

**Approve this simpler approach?** 

It's ownership-based like tools, not auto-shared. You control what you upload and what vehicles use it. Ready to implement when you confirm!

