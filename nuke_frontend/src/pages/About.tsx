import React from 'react';
import '../styles/unified-design-system.css';

const About: React.FC = () => {
  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-6)' }}>
          
          {/* Header */}
          <h1 style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 'var(--space-4)', borderBottom: '2px solid var(--border-medium)', paddingBottom: 'var(--space-2)' }}>
            About Nuke
          </h1>

          {/* Executive Summary */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Executive Summary
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              <strong>Nuke</strong> is a vehicle identity platform that treats every Vehicle Identification Number (VIN) as a persistent digital entity. Our mission is to create canonical, verifiable records of vehicle history, condition, and value that transcend ownership changes—building the definitive digital identity for every vehicle.
            </p>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              The platform serves three primary stakeholders:
            </p>
            <ol style={{ fontSize: '13px', lineHeight: '1.7', marginLeft: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>
              <li><strong>Vehicle Enthusiasts/Owners:</strong> Documenting history, managing restoration, tracking value</li>
              <li><strong>Organizations/Dealers:</strong> Managing inventory, processing trade-ins, marketing vehicles</li>
              <li><strong>Marketplace Participants:</strong> Buyers and sellers requiring trusted, verified data</li>
            </ol>
          </section>

          {/* Three-Layer Architecture */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Three-Layer Data Architecture
            </h2>
            <p style={{ fontSize: '13px', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Every vehicle profile processes information through three distinct layers to ensure accuracy and context:
            </p>
            
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────────────────┐
│                  THREE-LAYER DATA ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────┘

LAYER 1: ARBOREAL (The Root)
─────────────────────────────────────────────────────────────────────────
Definition: Hierarchical, definitive data bounded within vehicle profile

Components:
  • Factory specs (VIN decode via NHTSA VPIC API)
  • Production numbers
  • Verified ownership history (title documents)
  • Build dates, sequence numbers
  • SPID data (RPO codes, paint codes, engine codes)

Role: Provides undeniable "ground truth" context for all other data
Example: "This 1974 K5 Blazer has factory VIN 1GKEK14K8HZ123456"


LAYER 2: WEB INTERFACE (The Connections)
─────────────────────────────────────────────────────────────────────────
Definition: Structured relationships connecting data points

Components:
  • Links between parts and manuals
  • Receipts ↔ Timeline events
  • Images ↔ Service records
  • GPS coordinates ↔ Organizations
  • Documents ↔ Vehicle specifications
  • Receipt items ↔ Images showing those parts

Role: Transforms isolated data points into navigable knowledge graph
Example: "Receipt shows Edelbrock #2701 intake → Image shows intake → 
          Links to engine bay photo → Timeline event documents installation"


LAYER 3: RHIZOMATIC (The Intelligence)
─────────────────────────────────────────────────────────────────────────
Definition: Emergent knowledge from pattern recognition across ALL vehicles

Components:
  • AI-driven valuation algorithms
  • Common failure predictions
  • Restoration cost estimates
  • Market trend analysis
  • Investment readiness scoring
  • Cross-vehicle pattern matching

Role: Applies collective learnings to specific vehicles
Example: "1974 K5 Blazers often have rust in frame locations X, Y, Z
          → Check these locations in images → Increase rust assessment"
`}
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>
              Data Flow Through Layers
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`USER UPLOADS IMAGE
        ↓
┌───────────────────────────────────┐
│ LAYER 1 VALIDATION               │
│ Check against VIN specs          │
│ "Is this factory equipment?"     │
│ "Does engine code match SPID?"   │
└──────────────┬────────────────────┘
               ↓
┌───────────────────────────────────┐
│ LAYER 2 CONNECTION               │
│ Link to receipts                 │
│ Link to timeline events          │
│ Link to other images             │
│ Create knowledge graph edges     │
└──────────────┬────────────────────┘
               ↓
┌───────────────────────────────────┐
│ LAYER 3 INTELLIGENCE             │
│ Compare to similar vehicles      │
│ Apply learned patterns           │
│ Generate predictions             │
│ Calculate confidence scores      │
└───────────────────────────────────┘`}
            </div>
          </section>

          {/* Core System ERD */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Core Database Schema (ERD)
            </h2>
            
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Primary Entity: Vehicles
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────┐
│ VEHICLES (Core Entity)                                       │
├─────────────────────────────────────────────────────────────┤
│ • id (PK, UUID)                                             │
│ • vin (UNIQUE, canonical identifier)                        │
│ • year, make, model, series, trim                           │
│ • engine, transmission, drivetrain                          │
│ • mileage, purchase_price, current_value                    │
│ • condition_rating, is_modified                             │
│ • user_id (FK → auth.users)                                 │
│ • year_source, year_confidence (0-100)                     │
│ • make_source, make_confidence                              │
│ • model_source, model_confidence                            │
│ • vin_source, vin_confidence                                │
│ • created_at, updated_at                                    │
└──────────┬──────────────────────────────────────────────────┘
           │
           │ ONE-TO-MANY relationships
           │
    ┌──────┼──────┬──────────┬──────────┬──────────┐
    │      │      │          │          │          │
    ▼      ▼      ▼          ▼          ▼          ▼
┌────────┐┌────────┐┌──────────┐┌────────┐┌──────────┐┌──────────┐
│IMAGES  ││EVENTS  ││DOCUMENTS ││OPTIONS ││SPID_DATA││LISTINGS  │
│        ││        ││          ││        ││         ││          │
│Many    ││Many    ││Many      ││Many    ││One      ││Many      │
└────────┘└────────┘└──────────┘└────────┘└──────────┘└──────────┘`}
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Timeline Events (Central Ledger)
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────┐
│ TIMELINE_EVENTS (Immutable Ledger)                          │
├─────────────────────────────────────────────────────────────┤
│ • id (PK, UUID)                                             │
│ • vehicle_id (FK → vehicles)                                │
│ • user_id (FK → auth.users)                                 │
│ • event_type (purchase, sale, maintenance, repair, etc.)   │
│ • event_category (ownership, maintenance, legal, etc.)     │
│ • title, description                                        │
│ • event_date (DATE)                                         │
│ • mileage_at_event                                          │
│ • source_type (user_input, receipt, government_record)     │
│ • confidence_score (0-100)                                  │
│ • verification_status (unverified → multi_verified)        │
│ • documentation_urls []                                     │
│ • receipt_amount, receipt_currency                          │
│ • metadata (JSONB) - flexible storage                       │
│ • affects_value, affects_safety, affects_performance        │
└─────────────────────────────────────────────────────────────┘

DUAL VALUE PRINCIPLE:
  Each event serves TWO purposes:
   1. Vehicle Timeline: "What happened to this car?"
   2. User Contributions: "Who verified this?"`}
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Vehicle Images & AI Processing
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────┐
│ VEHICLE_IMAGES                                              │
├─────────────────────────────────────────────────────────────┤
│ • id (PK, UUID)                                             │
│ • vehicle_id (FK → vehicles, NULLABLE for personal library)│
│ • image_url, thumbnail_url                                  │
│ • vehicle_zone (ext_front, ext_rear, int_dashboard, etc.)  │
│ • category (exterior, interior, engine, undercarriage)     │
│ • taken_at (DATE from EXIF)                                 │
│ • latitude, longitude (GPS from EXIF)                       │
│ • exif_data (JSONB)                                         │
│ • ai_scan_metadata (JSONB) - stores all AI analysis        │
│   ├─ rekognition (AWS labels)                               │
│   ├─ appraiser (OpenAI analysis)                            │
│   ├─ spid (SPID sheet data if detected)                     │
│   ├─ vin_tag (VIN extraction if detected)                   │
│   ├─ tier_1_analysis, tier_2_analysis                       │
│   └─ gap_finder (missing context identified)                │
│ • ai_processing_status (pending → processing → complete)    │
│ • organization_status (unorganized → organized)             │
│ • labels [] (simple component names)                        │
│ • spatial_tags [] (JSONB - spatial location data)          │
│ • created_at, updated_at                                    │
└──────────┬──────────────────────────────────────────────────┘
           │
           │ links to
           │
    ┌──────┴──────┬──────────┬──────────┐
    │             │          │          │
    ▼             ▼          ▼          ▼
┌──────────┐┌────────┐┌────────────┐┌───────────┐
│IMAGE_TAGS││TIMELINE││COMPONENT_  ││RECEIPT_   │
│          ││EVENTS  ││DETECTIONS  ││ITEMS      │
│          ││        ││            ││           │
│AI/manual ││Auto-   ││AI analysis ││Links parts│
│tags with ││created ││results     ││to images  │
│confidence││on      ││            ││           │
│          ││upload  ││            ││           │
└──────────┘└────────┘└────────────┘└───────────┘`}
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Organizations & Business Intelligence
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────┐
│ BUSINESSES (Organizations)                                  │
├─────────────────────────────────────────────────────────────┤
│ • id (PK, UUID)                                             │
│ • business_name, business_type                              │
│ • address, city, state, zip, country                        │
│ • latitude, longitude (for GPS matching)                    │
│ • phone, email, website                                     │
│ • created_by (FK → auth.users)                              │
│ • is_verified (requires business license/tax ID)            │
└──────────┬──────────────────────────────────────────────────┘
           │
    ┌──────┼──────┬──────────┬──────────┬──────────┐
    │      │      │          │          │          │
    ▼      ▼      ▼          ▼          ▼          ▼
┌────────┐┌──────────┐┌───────────┐┌──────────┐┌───────────┐
│ORGANIZATION│ORGANIZATION│ORGANIZATION│ORGANIZATION│ORGANIZATION│
│_VEHICLES │_IMAGES   │_CONTRIBUTORS│_NARRATIVES│_OFFERINGS │
│          │          │            │            │           │
│Many-to-  │Facility  │Collaborative│AI-extracted│Tradable   │
│many      │photos    │contributors │business    │stocks/ETFs│
│links     │with GPS  │            │intelligence│           │
│vehicles  │          │            │            │           │
│to orgs   │          │            │            │           │
└────────┘└──────────┘└───────────┘└──────────┘└───────────┘

ORGANIZATION_VEHICLES Relationships:
  • owner, consigner, service_provider
  • work_location, parts_supplier, fabricator
  • painter, upholstery, transport, storage
  • inspector, collaborator

Auto-tagging:
  • GPS match: Image EXIF coordinates within 500m → work_location
  • Receipt match: Vendor name 50%+ similarity → service_provider`}
            </div>
          </section>

          {/* Image Processing Pipeline Map */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Image Processing Pipeline
            </h2>
            
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Context-Driven Tiered Processing Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`IMAGE UPLOADED
    ↓
EXTRACT EXIF DATA
    ├─ GPS coordinates (latitude, longitude)
    ├─ Date taken (taken_at)
    ├─ Camera metadata
    └─ Image dimensions, orientation
    ↓
CALCULATE CONTEXT SCORE
    ├─ +20 pts: Has SPID data (factory specs)
    ├─ +15 pts: Has factory manual
    ├─ +5 pts per receipt (max 25 pts)
    ├─ +3 pts per timeline event (max 15 pts)
    ├─ +2 pts per user tag (max 10 pts)
    ├─ +10 pts: Previous analysis exists
    └─ +5 pts: Well-documented vehicle
    ↓
ROUTE TO APPROPRIATE TIER
    │
    ├─ Score 60+: Tier 1 ($0.0001/image)
    │   └─ GPT-4o-mini: Just confirm visible parts match known context
    │
    ├─ Score 30-60: Tier 2 ($0.0005/image)
    │   └─ GPT-4o-mini: Guided identification using context
    │
    ├─ Score 10-30: Tier 2 Enhanced ($0.005/image)
    │   └─ GPT-4o-mini: Moderate inference with timeline guidance
    │
    └─ Score <10: Gap Finder ($0.02/image)
        └─ GPT-4o: Identify missing documentation (don't guess answers)

PARALLEL PROCESSING:
    ├─ AWS Rekognition (Label Detection)
    │   └─ Basic component identification
    │   └─ Confidence 60-100%
    │
    ├─ SPID Sheet Detection (GPT-4o Vision)
    │   └─ Detects GM SPID sheets
    │   └─ Extracts: VIN, RPO codes, paint codes, engine codes
    │   └─ Auto-verifies against vehicle record
    │
    ├─ VIN Tag Detection (GPT-4o Vision)
    │   └─ Detects VIN plates/tags
    │   └─ OCR extraction of VIN/chassis identifier (4-17 chars)
    │   └─ Authenticity assessment
    │   └─ Auto-updates vehicle if VIN missing
    │
    └─ Appraiser Brain Analysis (Context-Aware)
        └─ Engine bay: Stock/modified, leaks, wiring quality
        └─ Interior: Seat condition, dash cracks, stock radio
        └─ Undercarriage: Rust, recent work, exhaust condition
        └─ Exterior: Body straight, paint glossy, damage, mods

RESULTS STORED:
    └─ vehicle_images.ai_scan_metadata (JSONB)
        ├─ rekognition: AWS labels
        ├─ appraiser: Context analysis
        ├─ spid: Extracted SPID data
        ├─ vin_tag: Extracted VIN data
        └─ tier_analysis: Tiered processing results

AUTOMATED TAGS CREATED:
    └─ image_tags table
        ├─ tag_name, tag_type (part/tool/process/issue)
        ├─ confidence (30-100%)
        ├─ x_position, y_position (spatial location)
        └─ ai_detection_data (source attribution)`}
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Context Scoring System
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`CONTEXT SCORE CALCULATION:

Available Context Sources:
  ┌─────────────────────────────────────────────────────┐
  │ SPID DATA                    +20 points             │
  │ Factory specs from SPID sheet                      │
  └─────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────┐
  │ FACTORY MANUAL             +15 points               │
  │ Service/rebuild manual linked to vehicle           │
  └─────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────┐
  │ RECEIPTS                  +5 points each (max 25)  │
  │ Recent receipts with part numbers                  │
  └─────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────┐
  │ TIMELINE EVENTS           +3 points each (max 15)  │
  │ Documented work history                            │
  └─────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────┐
  │ USER TAGS                +2 points each (max 10)   │
  │ Manually verified tags                             │
  └─────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────┐
  │ PREVIOUS ANALYSIS        +10 points                 │
  │ Existing AI analysis results                       │
  └─────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────┐
  │ WELL-DOCUMENTED          +5 points                  │
  │ Vehicle has complete spec data                     │
  └─────────────────────────────────────────────────────┘

ROUTING DECISIONS:
  Score 60+   → Tier 1 ($0.0001) - Trivial confirmation
  Score 30-60 → Tier 2 ($0.0005) - Guided identification  
  Score 10-30 → Tier 2 Enhanced ($0.005) - Moderate inference
  Score <10   → Gap Finder ($0.02) - Identify missing context

VIRTUOUS CYCLE:
  User adds receipt → Context score increases
  → Next image processes for $0.0001 instead of $0.02
  → System gets smarter AND cheaper over time`}
            </div>
          </section>

          {/* Data Extraction Flow Map */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Universal Data Ingestion System
            </h2>
            
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              AI Data Ingestion Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`USER INPUT (Header Search Bar)
    │
    ├─ Text: "1974 Chevy Blazer"
    ├─ VIN: "1GKEK14K8HZ123456"
    ├─ URL: "https://bringatrailer.com/listing/..."
    ├─ Image: Vehicle photo
    └─ Image + Text: Photo with context
    ↓
INPUT CLASSIFICATION
    │
    ├─ VIN → VIN Decoder (NHTSA VPIC API)
    ├─ URL → Scrape & Extract (Universal HTML parser)
    ├─ Image → OpenAI Vision Analysis
    └─ Text → AI Text Parser
    ↓
MULTI-PROVIDER AI EXTRACTION (Free-First Strategy)
    │
    ├─ Try 1: Google Gemini Flash (FREE, 1,500/day)
    │   └─ Fast, good accuracy
    │
    ├─ Try 2: Google Gemini Pro (FREE fallback)
    │
    ├─ Try 3: OpenAI GPT-4o-mini ($0.0001)
    │
    ├─ Try 4: OpenAI GPT-4o ($0.01)
    │
    └─ Try 5: Anthropic Claude (fallback)
    ↓
EXTRACTED DATA STRUCTURE
    ├─ Vehicle: year, make, model, series, trim
    ├─ Specs: engine, transmission, drivetrain
    ├─ Condition: mileage, odometer_status
    ├─ Financial: price, asking_price, sold_price
    ├─ Location: city, state
    ├─ Seller: name, phone, email
    ├─ Images: array of image URLs
    └─ Confidence: 0-1 score
    ↓
DATABASE ROUTER
    │
    ├─ Primary Match: VIN (exact match)
    ├─ Secondary Match: Year + Make + Model (fuzzy)
    └─ Create New: No match found
    ↓
OPERATION PLAN GENERATION
    ├─ Vehicle Operations (create/update)
    ├─ Image Operations (upload & link)
    ├─ Timeline Events (auto-create)
    └─ Receipt Operations (if applicable)
    ↓
USER PREVIEW & CONFIRMATION
    ├─ Show extracted data
    ├─ Show match evidence (if found)
    └─ User confirms or edits
    ↓
EXECUTE DATABASE OPERATIONS
    └─ Navigate to Vehicle Profile`}
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Document Extraction Flow (Reference Library)
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`USER UPLOADS BROCHURE/MANUAL
    ↓
┌─────────────────────────────────────────┐
│ library_documents                       │
│ • Stores PDF/images                     │
│ • Attributes to user                    │
│ • Links to reference_library            │
└──────────────┬──────────────────────────┘
               │ triggers AI
               ↓
┌─────────────────────────────────────────┐
│ Edge Function: parse-reference-document │
│ • GPT-4o Vision analyzes each page     │
│ • Extracts specs, colors, RPO codes    │
│ • Generates validation questions       │
└──────────────┬──────────────────────────┘
               │ stores in
               ↓
┌─────────────────────────────────────────┐
│ document_extractions (STAGING)          │
│ • Raw AI extraction as JSONB           │
│ • Status: 'pending_review'             │
│ • Validation questions                 │
│ • Waits for user approval              │
└──────────────┬──────────────────────────┘
               │ user reviews & approves
               ↓
┌─────────────────────────────────────────┐
│ apply_extraction_to_specs()             │
│ • Applies data to multiple tables      │
│ • Creates proof links                  │
│ • Updates confidence scores            │
└──────────────┬──────────────────────────┘
               │ populates
               ↓
    ┌──────────┴──────────┬─────────────┬──────────────┐
    │                     │             │              │
    ▼                     ▼             ▼              ▼
┌────────────┐      ┌──────────┐  ┌─────────────┐ ┌─────────────┐
│oem_vehicle │      │extracted │  │extracted    │ │spec_field   │
│_specs      │      │_paint    │  │_rpo_codes   │ │_proofs      │
│            │      │_colors   │  │             │ │             │
│Main specs  │      │Color DB  │  │Options DB   │ │Proof links  │
│from        │      │          │  │             │ │to pages     │
│brochure    │      │          │  │             │ │             │
└────────────┘      └──────────┘  └─────────────┘ └─────────────┘`}
            </div>
          </section>

          {/* Auction System Framework */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '19px', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Auction Marketplace Framework
            </h2>
            
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Dual-Revenue Auction System
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`REVENUE STREAM 1: NUKE AUCTIONS (3-5% commission)
─────────────────────────────────────────────────────────────────────────
Seller lists vehicle on NUKE platform
    ↓
Auction Creation:
  • Standard (multi-day) or Live (5-minute) auction types
  • Proxy bidding with secret max bids
  • Reserve pricing optional
  • AI description generation (optional)
  • Flexible durations (5 minutes to 14 days)
    ↓
Real-Time Bidding:
  • WebSocket updates for live bidding
  • 2-minute sniping protection (auto-extends auction)
  • Proxy bidding system (automatic bid increments)
    ↓
Bid Deposit System:
  • Bidders place deposits (10% of bid) on cards before bidding
  • Stripe authorization holds funds
  • If outbid → deposit hold released automatically
  • If wins → deposit captured + remainder charged
    ↓
Auction Settlement (Automatic):
  • Winning bid identified
  • Deposit captured
  • Remainder charged to buyer
  • Commission extracted (3-5%)
  • Seller paid automatically
  • Purchase agreement & bill of sale auto-generated
    ↓
Shipping Coordination:
  • Central Dispatch integration
  • Auto-create shipping listing
  • Track carrier assignment, pickup, delivery
  • Real-time status updates via webhooks


REVENUE STREAM 2: MULTI-PLATFORM EXPORTS (1-2% commission)
─────────────────────────────────────────────────────────────────────────
Seller prepares listing with NUKE tools
    ↓
Listing Preparation Wizard:
  • AI extracts all vehicle data from profile
  • Platform-specific formatting:
    - BaT: Story-driven, 50 images, detailed narrative
    - eBay: HTML structured, specs highlighted
    - Craigslist: Plain text, concise, local
    - Cars.com: Standard format
    - Facebook: Social optimized
  • One-click export packages
    ↓
User submits to external platform manually
    ↓
NUKE tracks listing in listing_exports table
    ↓
Vehicle sells on external platform
    ↓
User reports sale → NUKE earns 1-2% commission`}
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Bid Deposit Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`BIDDER PLACES $50,000 BID
    ↓
CHECK: Has payment method?
    ├─ NO → Setup payment method (60 seconds)
    │   └─ Add card to Stripe customer
    │
    └─ YES → Continue
    ↓
CALCULATE DEPOSIT: $5,000 (10% of bid)
    ↓
STRIPE AUTHORIZATION HOLD
    ├─ Payment intent created: $5,000
    ├─ Status: "requires_capture"
    └─ Bid stored in auction_bids table
    ↓
BID CONFIRMED (bidder is now high bidder)
    │
    ├─ OUTBID SCENARIO:
    │   ├─ New bidder places higher bid
    │   ├─ $5,000 hold released automatically
    │   ├─ Payment intent cancelled
    │   └─ Bidder notified
    │
    └─ WIN SCENARIO:
        ├─ Auction ends
        ├─ $5,000 deposit captured
        ├─ $45,000 remainder charged
        ├─ Total $50,000 collected from buyer
        ├─ Commission extracted (3% = $1,500)
        ├─ Seller paid ($48,500)
        └─ Purchase agreement generated

BENEFITS:
  ✅ No fake/troll bids (verified funds required)
  ✅ No payment failures (funds authorized upfront)
  ✅ Instant refunds when outbid
  ✅ Automatic settlement when auction ends
  ✅ Commission collected immediately`}
            </div>
          </section>

          {/* Organization System Framework */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fo
... [truncated, 73615 chars total]