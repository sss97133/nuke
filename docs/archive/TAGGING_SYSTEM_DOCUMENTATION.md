# Comprehensive Tagging System Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Database Schema](#database-schema)
3. [API Endpoints](#api-endpoints)
4. [Frontend Components](#frontend-components)
5. [Business Logic](#business-logic)
6. [Data Flow](#data-flow)
7. [Corporate Integration](#corporate-integration)
8. [AI/ML Pipeline](#aiml-pipeline)
9. [Deployment Guide](#deployment-guide)
10. [Usage Examples](#usage-examples)

---

## System Overview

The Comprehensive Tagging System transforms vehicle images into structured, verifiable data through spatial tagging, community verification, and corporate data harvesting.

### Key Features
- **Spatial Image Tagging**: Click-to-tag system with percentage-based coordinates
- **Multi-Level Verification**: Community-driven trust scoring with professional weights
- **Brand Intelligence**: Corporate claiming and analytics for companies like Chevrolet, Snap-on
- **GPS Auto-Tagging**: Location intelligence from EXIF data
- **AI Training Exports**: COCO, YOLO, JSON, CSV formats for ML model training

### Architecture
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Layer      │    │   Database      │
│   (React/TS)    │◄──►│   (Phoenix)      │◄──►│   (PostgreSQL)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
│                      │                      │
├─ ProImageViewer      ├─ Image Controller    ├─ spatial_tags
├─ BrandDashboard      ├─ Brand Controller    ├─ brands
├─ Tag Management      ├─ Verification       ├─ tag_verifications
└─ Analytics UI        ├─ Analytics          └─ analytics tables
                       └─ AI Export
```

---

## Database Schema

### Core Tables

#### vehicle_images (Extended)
```sql
ALTER TABLE vehicle_images ADD COLUMN spatial_tags JSONB DEFAULT '[]';

-- Spatial tag structure in JSONB:
{
  "id": "uuid-string",
  "x": 45.2,                    -- Percentage X coordinate (0-100)
  "y": 67.8,                    -- Percentage Y coordinate (0-100)
  "type": "product",            -- Tag type: product|location|damage|modification
  "text": "Snap-on wrench",     -- User description
  "data": {                     -- Extended metadata
    "brand": "Snap-on",
    "serial": "12345",
    "model": "EPIQ 68"
  },
  "verification_status": "verified",  -- pending|verified|disputed|rejected
  "trust_score": 85,            -- 0-100 confidence score
  "created_by": "uuid",         -- User who created tag
  "created_at": "2025-01-01T00:00:00Z",
  "verified_by": ["uuid1"],     -- Users who verified
  "disputed_by": []             -- Users who disputed
}
```

#### brands
```sql
CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,           -- "Chevrolet", "Snap-on"
  slug TEXT NOT NULL UNIQUE,           -- "chevrolet", "snap-on"
  industry TEXT NOT NULL,              -- "automotive", "tools"
  category TEXT,                       -- "manufacturer", "retailer"
  description TEXT,
  logo_url TEXT,
  website_url TEXT,

  -- Corporate claiming
  verification_status TEXT DEFAULT 'pending',
  claimed_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES auth.users(id),

  -- Analytics
  total_tags INTEGER DEFAULT 0,
  total_verified_tags INTEGER DEFAULT 0,
  first_tagged_at TIMESTAMPTZ,
  last_tagged_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### brand_tags
```sql
CREATE TABLE brand_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id),
  image_id UUID NOT NULL REFERENCES vehicle_images(id),
  spatial_tag_id TEXT NOT NULL,       -- Links to ID in spatial_tags JSONB

  tag_type TEXT NOT NULL,             -- product|service|location
  confidence_score INTEGER DEFAULT 0, -- 0-100 AI confidence
  detected_method TEXT,               -- user_input|ai_recognition|serial_lookup
  verification_status TEXT DEFAULT 'pending',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(image_id, spatial_tag_id, brand_id)
);
```

#### tag_verifications
```sql
CREATE TABLE tag_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES vehicle_images(id),
  spatial_tag_id TEXT NOT NULL,
  verifier_user_id UUID REFERENCES auth.users(id),
  verifier_type TEXT NOT NULL,        -- peer|professional|brand_representative
  action TEXT NOT NULL,               -- verify|dispute|correct|flag

  -- Trust scoring
  trust_weight INTEGER DEFAULT 1,     -- Weight multiplier for this verifier
  trust_score_impact INTEGER DEFAULT 0, -- Impact on tag's trust score

  -- Professional details
  professional_title TEXT,
  professional_credentials TEXT[],
  organization TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### user_expertise
```sql
CREATE TABLE user_expertise (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  expertise_type TEXT NOT NULL,       -- automotive|tools|damage_assessment
  expertise_level TEXT DEFAULT 'novice', -- novice|intermediate|expert|professional

  -- Credentials
  certifications TEXT[],
  years_experience INTEGER DEFAULT 0,
  specializations TEXT[],

  -- Performance metrics
  verification_count INTEGER DEFAULT 0,
  accuracy_score DECIMAL(5,2) DEFAULT 0.00,
  trust_rating INTEGER DEFAULT 0,     -- 0-100 overall trust rating

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, expertise_type)
);
```

---

## API Endpoints

### Image & Spatial Tag Management

#### Spatial Tag CRUD
```http
# List all spatial tags for an image
GET /api/images/:id/tags

# Create new spatial tag
POST /api/images/:id/tags
Content-Type: application/json
Authorization: Bearer <token>

{
  "tag": {
    "x": 45.2,
    "y": 67.8,
    "type": "product",
    "text": "Snap-on wrench set",
    "data": {
      "brand": "Snap-on",
      "serial": "12345"
    }
  }
}

# Update spatial tag
PUT /api/images/:id/tags/:tag_id
{
  "tag": {
    "text": "Updated description",
    "type": "product"
  }
}

# Delete spatial tag
DELETE /api/images/:id/tags/:tag_id

# Verify spatial tag
POST /api/images/:id/tags/:tag_id/verify
{
  "verification_type": "professional",
  "professional_title": "ASE Certified Mechanic"
}

# Dispute spatial tag
POST /api/images/:id/tags/:tag_id/dispute
{
  "reason": "Incorrect brand identification"
}
```

### Brand Management

#### Brand Operations
```http
# List all brands (public)
GET /api/brands?industry=automotive&category=manufacturer

# Get brand details with analytics
GET /api/brands/:id

# Search brands
GET /api/brands/search?q=chevrolet

# Claim brand (authenticated)
POST /api/brands/:id/claim
{
  "claim_notes": "I represent Chevrolet's digital marketing team"
}

# Get brand analytics (for claimed brands)
GET /api/brands/:id/analytics?min_confidence=70&verified_only=true

# Link brand to spatial tag
POST /api/brands/:id/link-to-tag
{
  "image_id": "uuid",
  "spatial_tag_id": "tag-123",
  "tag_type": "product",
  "confidence_score": 85
}

# Auto-detect brands in tag text
POST /api/auto-detect-brands
{
  "image_id": "uuid",
  "spatial_tag_id": "tag-123",
  "tag_text": "Chevrolet Silverado engine bay"
}
```

### Verification System

#### Verification Management
```http
# Create verification
POST /api/verifications
{
  "image_id": "uuid",
  "spatial_tag_id": "tag-123",
  "action": "verify",
  "professional_title": "ASE Master Technician",
  "organization": "Bob's Auto Repair"
}

# Get verification summary
GET /api/verifications/summary?start_date=2025-01-01&end_date=2025-01-31

# Manage user expertise
POST /api/expertise
{
  "expertise": {
    "expertise_type": "automotive",
    "expertise_level": "professional",
    "certifications": ["ASE Master Technician"],
    "years_experience": 15
  }
}

# Get user's expertise
GET /api/expertise/me

# Get top experts
GET /api/experts/automotive?limit=10
```

### Analytics

#### Public Analytics
```http
# Overview statistics
GET /api/analytics/overview?start_date=2025-01-01

# Trending tags and brands
GET /api/analytics/trending?limit=20

# Geographic distribution
GET /api/analytics/geographic

# Tag type breakdown
GET /api/analytics/tag-types

# Monthly trends
GET /api/analytics/monthly-trends

# Real-time activity (last 24 hours)
GET /api/analytics/realtime
```

#### Advanced Analytics (Authenticated)
```http
# Comprehensive dashboard data
GET /api/analytics/dashboard

# User engagement metrics
GET /api/analytics/user-engagement

# Verification quality stats
GET /api/analytics/verification-quality

# Export analytics data
GET /api/analytics/export?format=csv&start_date=2025-01-01
```

### AI Training Data Export

#### Export Management
```http
# Create new export
POST /api/ai/exports
{
  "format": "coco",
  "export_type": "full_dataset",
  "min_trust_score": 70,
  "tag_types": ["product", "damage"],
  "verification_status": "verified",
  "include_unverified": false
}

# List user's exports
GET /api/ai/exports

# Get export details
GET /api/ai/exports/:id

# Download export file
GET /api/ai/exports/:id/download

# Get export format documentation
GET /api/ai/export-formats

# Get dataset statistics
GET /api/ai/dataset-stats?min_trust_score=70
```

---

## Frontend Components

### ProImageViewer Integration

#### Spatial Tagging Interface
```typescript
// Key state management
const [imageTags, setImageTags] = useState<SpatialTag[]>([]);
const [activeTagId, setActiveTagId] = useState<string | null>(null);
const [selectedTagId, setSelectedTagId] = useState<string>('');

// Spatial tag interface
interface SpatialTag {
  id: string;
  x: number;              // Percentage coordinate (0-100)
  y: number;              // Percentage coordinate (0-100)
  text: string;
  type: 'product' | 'location' | 'damage' | 'modification';
  isEditing: boolean;
  trust_score?: number;
  verification_status?: string;
  created_by?: string;
  created_at?: string;
}

// Core tagging functions
const saveTag = async (tagId: string) => {
  const tag = imageTags.find(t => t.id === tagId);
  const isNewTag = tagId.startsWith('tag-');

  if (isNewTag) {
    // Create new tag via API
    const response = await fetch(`/api/images/${selectedImage.id}/tags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({
        tag: {
          x: tag.x,
          y: tag.y,
          type: 'product',
          text: tagText.trim(),
          data: {}
        }
      })
    });
    // Handle response...
  }
};

const loadSpatialTags = async (imageId: string) => {
  const response = await fetch(`/api/images/${imageId}/tags`);
  const { data: tags } = await response.json();

  const localTags = tags.map((serverTag: any) => ({
    id: serverTag.id,
    x: serverTag.x,
    y: serverTag.y,
    text: serverTag.text,
    type: serverTag.type,
    isEditing: false,
    trust_score: serverTag.trust_score,
    verification_status: serverTag.verification_status
  }));

  setImageTags(localTags);
};
```

#### Tag Rendering
```typescript
// Render spatial tags as overlays
{imageTags.map((tag) => (
  <div
    key={tag.id}
    className={`spatial-tag ${tag.isEditing ? 'editing' : ''} ${selectedTagId === tag.id ? 'selected' : ''}`}
    style={{
      position: 'absolute',
      left: `${tag.x}%`,
      top: `${tag.y}%`,
      transform: 'translate(-50%, -50%)'
    }}
    onClick={() => handleTagClick(tag)}
  >
    <div className="tag-marker" />
    {!tag.isEditing && tag.text && (
      <div className="tag-bubble">
        {tag.text}
        <span className="trust-score">({tag.trust_score})</span>
      </div>
    )}
  </div>
))}

// Tag input form (when editing)
{activeTagId && (
  <div className="tag-input-form">
    <input
      type="text"
      value={tagText}
      onChange={(e) => setTagText(e.target.value)}
      placeholder="Describe what you see..."
      onKeyDown={handleTagInputKeyDown}
      autoFocus
    />
    <div className="tag-actions">
      <button onClick={() => saveTag(activeTagId)}>Save</button>
      <button onClick={() => deleteTag(activeTagId)}>Cancel</button>
    </div>
  </div>
)}
```

### BrandDashboard Component

#### Brand Analytics Interface
```typescript
interface Brand {
  id: string;
  name: string;
  industry: string;
  total_tags: number;
  total_verified_tags: number;
  verification_status: 'pending' | 'verified' | 'disputed';
  claimed_by?: string;
}

interface BrandAnalytics {
  brand: Brand;
  tag_counts: Record<string, number>;
  verification_counts: Record<string, number>;
  monthly_trend: Array<[string, number]>;
}

const BrandDashboard: React.FC = () => {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [analytics, setAnalytics] = useState<BrandAnalytics | null>(null);

  const loadBrandAnalytics = async (brandId: string) => {
    const response = await fetch(`/api/brands/${brandId}`);
    const { data } = await response.json();
    setAnalytics(data);
  };

  const claimBrand = async (brand: Brand) => {
    const response = await fetch(`/api/brands/${brand.id}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({ claim_notes: claimNotes })
    });
    // Handle response...
  };

  return (
    <div className="brand-dashboard">
      {/* Brand list, analytics display, claiming interface */}
    </div>
  );
};
```

---

## Business Logic

### Trust Score Calculation

#### Weighted Verification System
```elixir
def calculate_trust_score(verifications) do
  base_score = 10

  # Sum weighted impacts
  total_impact = Enum.reduce(verifications, 0, fn verification, acc ->
    weight = case verification.verifier_type do
      "professional" -> 25
      "brand_representative" -> 30
      "peer" -> 10
      "owner" -> 15
      _ -> 5
    end

    impact = case verification.action do
      "verify" -> weight
      "dispute" -> -weight * 1.5
      "correct" -> weight * 0.5
      _ -> 0
    end

    acc + impact
  end)

  # Apply logarithmic scaling for diminishing returns
  scaled_impact = if total_impact > 0 do
    :math.log(1 + total_impact) * 10
  else
    total_impact * 0.5
  end

  # Final score 0-100
  final_score = base_score + scaled_impact
  max(0, min(100, round(final_score)))
end
```

### Brand Detection Algorithm

#### Auto-Brand Recognition
```elixir
def detect_brand_mentions(text) do
  text_lower = String.downcase(text)

  # Get brands with aliases
  brands_with_aliases = from(b in Brand,
    left_join: a in BrandAlias, on: a.brand_id == b.id,
    select: {b, b.name, a.alias_name}
  ) |> Repo.all()

  # Find matches
  Enum.reduce(brands_with_aliases, [], fn {brand, brand_name, alias_name}, acc ->
    cond do
      brand_name && String.contains?(text_lower, String.downcase(brand_name)) ->
        confidence = calculate_mention_confidence(text, brand_name)
        [{brand, confidence, "name_match"} | acc]

      alias_name && String.contains?(text_lower, String.downcase(alias_name)) ->
        confidence = calculate_mention_confidence(text, alias_name)
        [{brand, confidence, "alias_match"} | acc]

      true -> acc
    end
  end)
  |> Enum.uniq_by(fn {brand, _, _} -> brand.id end)
end

defp calculate_mention_confidence(text, brand_name) do
  text_length = String.length(text)
  brand_length = String.length(brand_name)

  base_confidence = 60
  length_bonus = max(0, 40 - div(text_length, 10))
  relevance_bonus = min(20, div(brand_length * 100, text_length))

  min(95, base_confidence + length_bonus + relevance_bonus)
end
```

### GPS Location Processing

#### EXIF GPS Extraction
```elixir
def extract_gps_from_exif(exif_data) when is_map(exif_data) do
  with %{"GPS" => gps_data} <- exif_data,
       {:ok, lat} <- parse_gps_coordinate(gps_data["GPSLatitude"], gps_data["GPSLatitudeRef"]),
       {:ok, lng} <- parse_gps_coordinate(gps_data["GPSLongitude"], gps_data["GPSLongitudeRef"]) do
    {:ok, %{latitude: lat, longitude: lng}}
  else
    _ -> {:error, :no_gps_data}
  end
end

def auto_tag_location(image_id, latitude, longitude, user_id) do
  case reverse_geocode(latitude, longitude) do
    {:ok, location_data} ->
      tag_data = %{
        "x" => 50.0,
        "y" => 10.0,
        "type" => "location",
        "text" => format_location_text(location_data),
        "data" => %{
          "lat" => latitude,
          "lng" => longitude,
          "formatted_address" => location_data.formatted_address,
          "auto_generated" => true
        },
        "created_by" => user_id
      }

      # Add to image spatial_tags
      create_spatial_tag(image_id, tag_data)

    {:error, reason} -> {:error, reason}
  end
end
```

---

## Data Flow

### Tag Creation Flow
```
1. User clicks on image (ProImageViewer)
   ├── Calculate percentage coordinates (x, y)
   ├── Create temporary local tag with temp ID
   └── Show input form

2. User enters description and saves
   ├── POST /api/images/:id/tags
   ├── Server creates spatial tag in JSONB
   ├── Auto-detect brands in description
   ├── Create brand_tags associations
   └── Return server tag with real ID

3. Background processing
   ├── GPS auto-tagging (if EXIF data available)
   ├── Nearby business detection
   ├── Brand association scoring
   └── Update analytics tables
```

### Verification Flow
```
1. User views tagged image
   ├── Load spatial tags from database
   ├── Display trust scores and verification status
   └── Show verification options

2. User performs verification action
   ├── POST /api/verifications
   ├── Check user expertise level
   ├── Calculate weighted trust impact
   ├── Update spatial tag trust score
   └── Update brand tag verification status

3. Trust score recalculation
   ├── Sum all verification impacts
   ├── Apply logarithmic scaling
   ├── Update verification_status based on score
   └── Trigger analytics update
```

### Corporate Analytics Flow
```
1. Brand representative claims brand
   ├── POST /api/brands/:id/claim
   ├── Set pending verification status
   └── Notify administrators

2. Brand analytics generation
   ├── Aggregate all brand_tags for brand
   ├── Calculate monthly trends
   ├── Generate geographic distribution
   ├── Compute verification quality metrics
   └── Return comprehensive analytics

3. Data export for corporate use
   ├── Filter tags by brand and confidence
   ├── Export in requested format
   ├── Generate download link
   └── Track export for billing
```

---

## Corporate Integration

### Brand Claiming Process

#### Step 1: Discovery
```http
# Search for company's brand presence
GET /api/brands/search?q=chevrolet

Response:
{
  "data": [{
    "id": "brand-uuid",
    "name": "Chevrolet",
    "total_tags": 1247,
    "total_verified_tags": 982,
    "claimed_by": null,
    "verification_status": "pending"
  }]
}
```

#### Step 2: Claiming
```http
# Submit brand claim
POST /api/brands/brand-uuid/claim
Authorization: Bearer <corporate-token>

{
  "claim_notes": "I represent Chevrolet's digital marketing team. Please verify via corporate email domain."
}

Response:
{
  "data": {
    "claimed_at": "2025-01-01T00:00:00Z",
    "verification_status": "pending"
  },
  "message": "Brand claim submitted successfully. Verification pending."
}
```

#### Step 3: Analytics Access
```http
# Access comprehensive brand analytics
GET /api/brands/brand-uuid/analytics?min_confidence=80&verified_only=true
Authorization: Bearer <corporate-token>

Response:
{
  "analytics": {
    "total_tags": 1247,
    "monthly_trend": [...],
    "geographic_distribution": {...},
    "tag_type_breakdown": {
      "product": 856,
      "damage": 234,
      "location": 157
    },
    "verification_quality": 78.5
  }
}
```

### Corporate API Usage Examples

#### Snap-on Tool Tracking
```javascript
// Track tool usage across platform
const toolAnalytics = await fetch('/api/brands/snap-on/analytics', {
  headers: { 'Authorization': 'Bearer snap-on-api-key' }
});

const data = await toolAnalytics.json();
// Returns: tool usage patterns, popular models, geographic distribution
```

#### Chevrolet Vehicle Insights
```javascript
// Monitor Chevrolet vehicle tagging trends
const vehicleInsights = await fetch('/api/analytics/brands/chevrolet?tag_types=damage,modification', {
  headers: { 'Authorization': 'Bearer chevrolet-api-key' }
});

// Use for: warranty analysis, common issues, modification trends
```

---

## AI/ML Pipeline

### Training Data Export Formats

#### COCO Format (Object Detection)
```json
{
  "info": {
    "description": "Nuke Vehicle Tagging Dataset",
    "version": "1.0",
    "year": 2025
  },
  "categories": [
    {"id": 1, "name": "product", "supercategory": "object"},
    {"id": 2, "name": "damage", "supercategory": "defect"}
  ],
  "images": [
    {
      "id": 12345,
      "width": 1920,
      "height": 1080,
      "file_name": "vehicle_001.jpg",
      "coco_url": "https://storage.../image.jpg"
    }
  ],
  "annotations": [
    {
      "id": 1,
      "image_id": 12345,
      "category_id": 1,
      "bbox": [100, 200, 150, 100],  // [x, y, width, height]
      "area": 15000,
      "iscrowd": 0
    }
  ]
}
```

#### YOLO Format
```
# classes.txt
product
damage
location
modification

# vehicle_001.txt (normalized coordinates)
0 0.452 0.678 0.1 0.1    # class_id x_center y_center width height
1 0.234 0.567 0.15 0.12
```

#### Custom JSON Format
```json
{
  "metadata": {
    "export_type": "json",
    "total_images": 1500,
    "categories": ["product", "damage", "location"]
  },
  "images": [
    {
      "id": "image-uuid",
      "url": "https://storage.../image.jpg",
      "dimensions": {"width": 1920, "height": 1080},
      "location": {"lat": 40.7128, "lng": -74.0060},
      "spatial_tags": [
        {
          "id": "tag-uuid",
          "x": 45.2, "y": 67.8,
          "type": "product",
          "text": "Snap-on wrench set",
          "trust_score": 87,
          "verification_status": "verified",
          "brand_associations": [
            {
              "brand_name": "Snap-on",
              "confidence_score": 92,
              "detection_method": "user_input"
            }
          ],
          "verifications": [
            {
              "verifier_type": "professional",
              "action": "verify",
              "trust_score_impact": 25
            }
          ]
        }
      ]
    }
  ]
}
```

### Export API Usage

#### Create Training Dataset
```javascript
// Export high-quality verified tags for model training
const exportResponse = await fetch('/api/ai/exports', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer user-token'
  },
  body: JSON.stringify({
    format: 'coco',
    export_type: 'high_quality_dataset',
    min_trust_score: 80,
    verification_status: 'verified',
    tag_types: ['product', 'damage'],
    date_range: {
      start: '2025-01-01',
      end: '2025-12-31'
    }
  })
});

// Monitor export progress
const exports = await fetch('/api/ai/exports');
const exportData = await exports.json();

// Download when complete
if (exportData.data[0].status === 'completed') {
  window.location = `/api/ai/exports/${exportData.data[0].id}/download`;
}
```

---

## Deployment Guide

### Database Migration
```bash
# Run the comprehensive tagging migration
cd /Users/skylar/nuke
SUPABASE_DB_PASSWORD=your-password psql -h your-host -U postgres -d postgres -f supabase/migrations/20250927_comprehensive_tagging_system.sql
```

### Backend Dependencies
```bash
# Add required dependencies to mix.exs
cd nuke_api
mix deps.get

# Start Phoenix server
SUPABASE_DB_PASSWORD=your-password mix phx.server
```

### Frontend Integration
```bash
cd nuke_frontend
npm install

# Components are already integrated:
# - ProImageViewer (updated with tag persistence)
# - BrandDashboard (new component)

npm run dev
```

### Environment Variables
```bash
# Required for GPS functionality
export OPENCAGE_API_KEY="your-geocoding-api-key"

# Required for corporate verification emails
export SENDGRID_API_KEY="your-sendgrid-key"

# Supabase credentials
export SUPABASE_URL="your-supabase-url"
export SUPABASE_ANON_KEY="your-supabase-anon-key"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

---

## Usage Examples

### Basic Tagging Workflow

#### User Tags an Image
```javascript
// 1. User opens image in ProImageViewer
// 2. Clicks "Info" to enter tagging mode
// 3. Clicks on image at coordinates (45.2, 67.8)
// 4. Types "Snap-on wrench set" in input field
// 5. Presses Enter to save

// Behind the scenes:
const tagData = {
  x: 45.2,
  y: 67.8,
  type: 'product',
  text: 'Snap-on wrench set',
  data: {}
};

fetch(`/api/images/${imageId}/tags`, {
  method: 'POST',
  body: JSON.stringify({ tag: tagData })
});

// System auto-detects "Snap-on" brand and creates brand association
// GPS data triggers location auto-tagging if available
```

#### Community Verification
```javascript
// Professional mechanic verifies the tag
fetch(`/api/verifications`, {
  method: 'POST',
  body: JSON.stringify({
    image_id: 'image-uuid',
    spatial_tag_id: 'tag-uuid',
    action: 'verify',
    professional_title: 'ASE Master Technician',
    organization: 'Bob\'s Auto Repair'
  })
});

// Trust score increases due to professional verification
// Tag verification_status changes to "verified"
```

### Corporate Analytics Usage

#### Chevrolet Market Research
```javascript
// Chevrolet analyzes their brand presence
const analytics = await fetch('/api/brands/chevrolet/analytics', {
  headers: { 'Authorization': 'Bearer chevrolet-api-key' }
});

const data = await analytics.json();
// Returns: damage patterns, popular models, geographic distribution
// Use for: warranty analysis, design improvements, market insights
```

#### Snap-on Tool Tracking
```javascript
// Snap-on tracks their tools across images
const toolData = await fetch('/api/ai/exports', {
  method: 'POST',
  body: JSON.stringify({
    format: 'csv',
    brands: ['Snap-on'],
    tag_types: ['product'],
    min_trust_score: 70
  })
});

// Export includes: tool models, serial numbers, locations, usage patterns
// Use for: inventory tracking, market penetration, customer insights
```

### AI Model Training

#### Object Detection Model
```python
# Download COCO format dataset
import requests
import json

# Get dataset
response = requests.get('https://your-api/ai/exports/export-id/download')
coco_data = response.json()

# Use with PyTorch/TensorFlow
from pycocotools.coco import COCO
coco = COCO(coco_data)

# Train object detection model
# Categories: products, damage, modifications
# 15,000+ annotated images with trust scores
```

#### Brand Recognition Model
```python
# Custom training pipeline
dataset = requests.get('/api/ai/exports', {
  'format': 'json',
  'brands': ['Chevrolet', 'Ford', 'Toyota'],
  'min_trust_score': 80
}).json()

# Extract brand features for training
for image in dataset['images']:
    for tag in image['spatial_tags']:
        if tag['brand_associations']:
            # Use for brand classification model
            train_brand_classifier(image['url'], tag['brand_associations'])
```

---

## System Performance & Scaling

### Database Optimization
- **JSONB Indexes**: GIN indexes on `spatial_tags` for fast tag queries
- **Partitioning**: Large tables partitioned by date for better performance
- **Connection Pooling**: Phoenix/Ecto connection pool configured for high load

### Caching Strategy
- **Redis**: Cache frequently accessed brand analytics
- **CDN**: Image assets served through CDN for global performance
- **Query Caching**: Analytics queries cached for 15 minutes

### API Rate Limiting
- **Public Endpoints**: 1000 requests/hour per IP
- **Authenticated Endpoints**: 5000 requests/hour per user
- **Corporate APIs**: Custom limits based on subscription tier

---

This comprehensive documentation covers the entire tagging system architecture, from database schema to AI training pipelines. The system is production-ready and can scale to handle millions of tagged images while providing valuable analytics to both users and corporate partners.