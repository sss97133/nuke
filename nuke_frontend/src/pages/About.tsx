import React from 'react';
import AppLayout from '../components/layout/AppLayout';
import '../design-system.css';

const About: React.FC = () => {
  return (
    <AppLayout>
      <div style={{ padding: 'var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-6)' }}>
          
          {/* Header */}
          <h1 style={{ fontSize: '16pt', fontWeight: 'bold', marginBottom: 'var(--space-4)', borderBottom: '2px solid var(--border-medium)', paddingBottom: 'var(--space-2)' }}>
            About NUKE Platform
          </h1>

          {/* Executive Summary */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Executive Summary
            </h2>
            <p style={{ fontSize: '10pt', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              <strong>NUKE (N-Zero)</strong> is a vehicle identity platform that treats every Vehicle Identification Number (VIN) as a persistent digital entity. Our mission is to create canonical, verifiable records of vehicle history, condition, and value that transcend ownership changes—building the definitive digital identity for every vehicle.
            </p>
            <p style={{ fontSize: '10pt', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              The platform serves three primary stakeholders:
            </p>
            <ol style={{ fontSize: '10pt', lineHeight: '1.7', marginLeft: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>
              <li><strong>Vehicle Enthusiasts/Owners:</strong> Documenting history, managing restoration, tracking value</li>
              <li><strong>Organizations/Dealers:</strong> Managing inventory, processing trade-ins, marketing vehicles</li>
              <li><strong>Marketplace Participants:</strong> Buyers and sellers requiring trusted, verified data</li>
            </ol>
          </section>

          {/* Three-Layer Architecture */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Three-Layer Data Architecture
            </h2>
            <p style={{ fontSize: '10pt', lineHeight: '1.7', marginBottom: 'var(--space-3)' }}>
              Every vehicle profile processes information through three distinct layers to ensure accuracy and context:
            </p>
            
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>
              Data Flow Through Layers
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Core Database Schema (ERD)
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Primary Entity: Vehicles
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Timeline Events (Central Ledger)
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Vehicle Images & AI Processing
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────┐
│ VEHICLE_IMAGES                                              │
├─────────────────────────────────────────────────────────────┤
│ • id (PK, UUID)                                             │
│ • vehicle_id (FK → vehicles, NULLABLE for personal library)│
│ • image_url, thumbnail_url                                  │
│ • angle (front, rear, side, engine_bay, interior, etc.)    │
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

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Organizations & Business Intelligence
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Image Processing Pipeline
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Context-Driven Tiered Processing Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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
    │   └─ OCR extraction of 17-character VIN
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

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Context Scoring System
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Universal Data Ingestion System
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              AI Data Ingestion Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Document Extraction Flow (Reference Library)
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Auction Marketplace Framework
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Dual-Revenue Auction System
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Bid Deposit Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
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
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Organization System & GPS Auto-Assignment
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              GPS-Based Auto-Assignment Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`VEHICLE IMAGES UPLOADED WITH GPS COORDINATES
    ↓
EXTRACT GPS FROM EXIF DATA
    ├─ Latitude: 36.1699° N
    ├─ Longitude: 115.1398° W
    └─ Accuracy: 10 meters
    ↓
FIND NEARBY ORGANIZATIONS
    ├─ Query businesses table
    ├─ Calculate distance (Haversine formula)
    ├─ Filter: Within 500 meters (configurable)
    └─ Sort by distance (closest first)
    ↓
MATCH CONFIDENCE CALCULATION
    ├─ Distance factor: <100m = 95%, 100-300m = 85%, 300-500m = 70%
    ├─ Image count: More images at location = higher confidence
    ├─ User membership: User is org member = +10%
    └─ Receipt match: Vendor name matches = +15%
    ↓
AUTO-ASSIGNMENT DECISION
    │
    ├─ Confidence ≥50% → Auto-assign to organization
    │   ├─ relationship_type: "work_location"
    │   ├─ auto_tagged: true
    │   ├─ gps_match_confidence: 0.95
    │   └─ linked_by_user_id: (uploader)
    │
    └─ Confidence <50% → Show suggestions to user
        └─ User manually confirms assignment

RECEIPT-BASED AUTO-ASSIGNMENT:
    Receipt uploaded with vendor name
        ↓
    Fuzzy match against organization names
        ├─ "Viva Las Vegas Auto" ≈ "Viva Las Vegas Autos" (85% match)
        └─ Threshold: 50%+ similarity
        ↓
    Auto-link as "service_provider"
        ├─ receipt_match_count: 1
        └─ Confidence increases with each matching receipt`}
            </div>

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Investment Intelligence System
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`FACILITY IMAGES UPLOADED
    ↓
BATCH ANALYSIS (Edge Function: analyze-organization-images)
    ├─ Groups images by date clusters (7-day windows)
    ├─ Analyzes individual images using 5 W's framework:
    │   ├─ WHO: People, workers, customers visible
    │   ├─ WHAT: Equipment, space, activities
    │   ├─ WHEN: Business phase, timing clues
    │   ├─ WHERE: Location type, setting
    │   └─ WHY: User intent, purpose
    └─ Generates cluster narrative (business story)
    ↓
INVESTMENT SCORING CALCULATION
    ├─ Investment readiness: 0-1 score
    ├─ Business stage: startup, growth, established
    ├─ Trajectory: upward, stable, declining
    ├─ Growth signals: established_location, active_inventory, etc.
    └─ Investment range: $min - $max
    ↓
STORAGE: organization_narratives table
    ├─ investment_score: 0.74
    ├─ business_stage: "growth"
    ├─ trajectory: "upward"
    ├─ investor_pitch: Generated narrative
    └─ confidence: 0.78
    ↓
AUTOMATIC INVESTOR MATCHING
    ├─ Query investor_profiles
    ├─ Match criteria:
    │   ├─ Geographic radius (miles from org)
    │   ├─ Stage preference (startup/growth/established)
    │   ├─ Investment range ($min - $max)
    │   └─ Minimum score threshold (e.g., ≥70%)
    ├─ Calculate match_score (0-1)
    └─ Create investor_opportunity_matches records
    ↓
NOTIFICATIONS SENT
    ├─ Email alerts
    ├─ Push notifications
    └─ In-app notifications
    ↓
PUBLIC VISIBILITY
    └─ Investment Opportunities page
        ├─ Filterable by score (High ≥80%, Good 70-80%)
        ├─ Shows business stage, trajectory
        └─ Direct link to organization profile`}
            </div>
          </section>

          {/* Financial System Framework */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Financial Infrastructure Framework
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Transaction System (Dual Value Principle)
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`ONE TRANSACTION ENTRY → SERVES TWO PURPOSES
    │
    ├─ VEHICLE TIMELINE
    │   └─ Shows build history
    │   └─ Documents value accumulation
    │   └─ "What happened to this car?"
    │
    └─ USER CONTRIBUTIONS
        └─ Shows expertise
        └─ Builds contributor reputation
        └─ "Who verified this?"

TRANSACTION TYPES:
  • Parts purchased (w/ receipt)
  • Labor performed (with invoice)
  • Services (inspection, shipping, storage)
  • Vehicle registration/insurance
  • Tools acquired for work
  • Vendor payments
  • Professional services

NOT Transactions (goes in timeline_events):
  ❌ Work completed but no cost
  ❌ Milestones/achievements
  ❌ Photos/documentation
  ❌ Chat/comments

TOTAL COST OF OWNERSHIP (TCO) CALCULATION:
  Purchase Price: $42,000
    +
  Parts & Materials: $8,500
    +
  Labor: $12,000
    +
  Services: $1,200
    ──────────────────────
  Total Investment: $63,700
    ──────────────────────
  Current Value: $75,000
  Net Gain: $11,300`}
            </div>

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Invoice & Payment System Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`TIMELINE EVENT (Work Completed)
    ↓
GENERATE INVOICE FROM EVENT
    ├─ Extract: labor hours, parts, description
    ├─ Apply rates: hourly_rate, parts_markup
    ├─ Calculate: subtotal, tax, total
    └─ Create generated_invoices record
    ↓
CREATE PAYMENT LINK
    ├─ payment_token: Secure UUID
    ├─ payment_link: https://n-zero.dev/pay/{token}
    └─ Public access (no login required)
    ↓
SHARE WITH CLIENT
    ├─ Email/SMS/QR code
    ├─ Client clicks link
    └─ Views invoice (NO LOGIN)
    ↓
CLIENT SELECTS PAYMENT METHOD
    ├─ Venmo: Username displayed, QR code
    ├─ Zelle: Email/phone displayed
    ├─ PayPal: PayPal.me link
    ├─ Stripe: Credit card checkout
    └─ Cash: Mark as paid confirmation
    ↓
PAYMENT CONFIRMED
    ├─ Client marks as paid
    ├─ Receipt sent
    └─ Status updated in generated_invoices
    ↓
ONBOARDING HOOK (Optional)
    └─ "Create account to track all invoices"
        └─ Client signs up after payment`}
            </div>
          </section>

          {/* Verification Framework */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Multi-Tier Verification System
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Verification Hierarchy (6 Tiers)
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`TIER 1: BASIC USER INPUT (1-5 points)
─────────────────────────────────────────────────────────────────────────
Example: Engine Size Field
  • User inputs: "350", "5.7", "383", "350 bored .030"
  • Validation: Basic format checking, reasonable range
  • Value: Better than nothing, establishes baseline
  • Status: "User Reported"
  • Confidence: 75% weight


TIER 2: IMAGE DOCUMENTATION (10-25 points)
─────────────────────────────────────────────────────────────────────────
Requirements: Visual proof of specifications
  • Single engine bay photo
  • Basic angle documentation
  • Validation: Image analysis, EXIF data verification
  • Value: Significant improvement in reliability
  • Status: "Image Documented"
  • Confidence: 85% weight


TIER 3: DETAILED VISUAL DOCUMENTATION (25-50 points)
─────────────────────────────────────────────────────────────────────────
Requirements: Comprehensive photographic evidence
  • Multiple angles of component
  • Close-up detail shots
  • Specific feature documentation
  • Validation: AI analysis, part number recognition
  • Status: "Visually Verified"
  • Confidence: 90% weight


TIER 4: STAMPINGS & SERIAL NUMBERS (50-75 points)
─────────────────────────────────────────────────────────────────────────
Requirements: Physical evidence
  • Documented part numbers
  • Casting codes visible
  • Serial numbers photographed
  • Cross-reference validation against factory records
  • Status: "Part Number Verified"
  • Confidence: 95% weight


TIER 5: PROFESSIONAL VERIFICATION (75-95 points)
─────────────────────────────────────────────────────────────────────────
Requirements: Expert certification
  • Certified mechanics verify
  • Appraisers certify
  • Judges verify (concours level)
  • Credentials checked
  • Status: "Professionally Verified"
  • Confidence: 95% weight


TIER 6: TITLE VERIFICATION (100 points)
─────────────────────────────────────────────────────────────────────────
Requirements: Official ownership documents
  • Title document uploaded
  • Verified against government records
  • Ownership chain established
  • Status: "Title Verified"
  • Confidence: 100% weight (cannot be overridden)


MULTI-SOURCE CONSENSUS:
  When multiple users provide matching data:
    • Single user claim: 75% confidence
    • 2 users agree: 80% confidence
    • 3+ users agree: 85% confidence
    • Professional + user agreement: 95% confidence`}
            </div>
          </section>

          {/* Work Documentation Framework */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Work Documentation & Contribution System
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Contractor Contribution Flow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`CONTRACTOR UPLOADS WORK IMAGES
    ↓
EXTRACT EXIF DATA
    ├─ Date: April 25, 2024
    ├─ GPS: Viva Las Vegas Autos location
    └─ Camera metadata
    ↓
DIALOG APPEARS:
  "Did you work on this vehicle?" [x] Yes
  
  "Who did you work for?"
  ( ) Viva! Las Vegas Autos
  ( ) FBM Offroad
  ( ) Independent contractor
  ( ) My own vehicle
  
  "Type of work?"
  [Dropdown: Fabrication, Paint, Welding, etc.]
  
  "Description?" → "Custom frame modifications"
  "Labor hours?" → 8.5 hrs
    ↓
IMAGES UPLOAD IMMEDIATELY (NO BLOCKING)
    ├─ Status: "pending_verification"
    ├─ Visible on vehicle profile
    └─ Tagged with contractor info
    ↓
CREATE contribution_submissions RECORD
    ├─ contributor_id: Contractor user
    ├─ vehicle_id: Vehicle worked on
    ├─ work_date: From EXIF
    ├─ responsible_party_type: "contractor_to_org"
    ├─ responsible_party_org_id: Viva organization
    ├─ work_category: "fabrication"
    ├─ work_description: User input
    ├─ labor_hours: 8.5
    ├─ status: "pending"
    └─ requires_approval_from: [Org admins]
    ↓
NOTIFICATION TO RESPONSIBLE PARTY
    └─ Viva owner/admin sees:
        "Pending Contribution: Skylar Williams
         1966 Chevrolet C10
         📅 April 25, 2024  🖼️ 10 images
         🏢 Viva! Las Vegas Autos
         ⏰ Auto-approves in 30d"
    ↓
RESPONSIBLE PARTY REVIEWS & VERIFIES
    ├─ [APPROVE] → Images go live, proper attribution
    ├─ [REJECT] → Images removed, contractor notified
    └─ [IGNORE] → Auto-approves after 30 days
    ↓
VERIFIED CONTRIBUTION CREATES:
    ├─ Timeline event: Work documented
    ├─ Contractor profile: Credit for work
    ├─ Organization profile: Shows capabilities
    └─ Vehicle profile: Professional work history`}
            </div>
          </section>

          {/* Valuation Framework */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Automated Valuation Intelligence Framework
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Vehicle Expert Agent Pipeline
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`STEP 1: RESEARCH VEHICLE & BECOME INSTANT EXPERT
─────────────────────────────────────────────────────────────────────────
  • Load vehicle Y/M/M/specs
  • Assemble literature: manuals, forums, market data
  • Research market sales for this exact Y/M/M
  • Calculate market average and range
  • Load photo timeline and date range
    ↓

STEP 2: ASSESS IMAGES & TALLY VALUE
─────────────────────────────────────────────────────────────────────────
  • Analyze all vehicle_images for components
  • Identify parts, modifications, condition
  • Match parts to receipts (verify purchases)
  • Estimate component values:
    ├─ Excellent condition: 100% of new price
    ├─ Good condition: 80% of new price
    ├─ Fair condition: 60% of new price
    └─ Poor condition: 40% of new price
  • Total documented component value
    ↓

STEP 3: EXTRACT ENVIRONMENTAL CONTEXT (5 W's)
─────────────────────────────────────────────────────────────────────────
  FROM EXIF DATA:
    ├─ GPS locations → Where work happened
    ├─ Photo timeline → When work happened
    └─ Camera equipment → Professional vs DIY
  
  FROM VISUAL ANALYSIS:
    ├─ Work environment: professional_shop, home_garage, field
    ├─ Tools visible: Professional vs DIY equipment
    └─ Weather conditions: Climate considerations
  
  DERIVED:
    ├─ WHO: Who worked on it (from environment clues)
    ├─ WHAT: What work was performed
    ├─ WHEN: Timeline of work
    ├─ WHERE: Where work happened
    └─ WHY: Why (restoration, repair, modification)
    ↓

STEP 4: GENERATE EXPERT VALUATION
─────────────────────────────────────────────────────────────────────────
  CALCULATIONS:
    Purchase Price: $42,000 (from vehicle record)
    Documented Value: $63,700 (sum of components)
    Estimated Total Value: $75,000
    
    Components:
      ├─ Purchase: $42,000
      ├─ Engine work: $15,000 (documented)
      ├─ Paint/body: $12,000 (documented)
      ├─ Suspension: $8,500 (documented)
      └─ Market premium: +$12,300 (condition + documentation)
  
  CONFIDENCE SCORING:
    ├─ High confidence (90%+): All major components documented
    ├─ Medium confidence (70-90%): Most components visible
    └─ Low confidence (<70%): Limited documentation
  
  NARRATIVE EXPLANATION:
    • Summary: Comprehensive restoration with documented history
    • Value justification: Professional work + rare configuration
    • Recommendations: Add more photos, get professional appraisal
    • Warnings: Undercarriage not fully documented`}
            </div>

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Pricing Equation Engine
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`HUMAN-CONTROLLABLE PRICING EQUATIONS:

STANDARD EQUATION (Default):
  Market Data:     40% weight
  AI Analysis:     30% weight
  Modifications:   20% weight
  Condition:       10% weight

LUXURY EQUATION:
  Market Data:     30% weight
  AI Analysis:     40% weight (more emphasis on AI expertise)
  Modifications:   20% weight
  Condition:       10% weight

CLASSIC EQUATION:
  Market Data:     50% weight (historical sales important)
  AI Analysis:     20% weight
  Modifications:   10% weight (originality preferred)
  Condition:       20% weight (condition critical)

MODIFIED EQUATION:
  Market Data:     30% weight
  AI Analysis:     25% weight
  Modifications:   35% weight (mods add significant value)
  Condition:       10% weight

MARKET DATA SOURCES (Parallel Scraping):
  ├─ AutoTrader
  ├─ Cars.com
  ├─ CarGurus
  ├─ Craigslist
  ├─ Auction databases (BaT, etc.)
  └─ Weighted average calculated

AI ANALYSIS COMPONENTS:
  ├─ Component value assessment
  ├─ Condition ratings
  ├─ Modification quality
  ├─ Documentation completeness
  └─ Market trend analysis

AUTOMATIC ADJUSTMENTS:
  • Performance-based: System learns from human overrides
  • Market volatility: Adjusts for market conditions
  • Documentation bonus: +15-25% for well-documented vehicles
  • Rare configuration premium: Applied for unique specs`}
            </div>
          </section>

          {/* Personal Photo Library Framework */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Personal Photo Library System
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Inbox Zero Workflow
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`BULK UPLOAD 30,000 PHOTOS
    ↓
PHOTOS STORED IN vehicle_images
    ├─ vehicle_id: NULL (unorganized)
    ├─ organization_status: 'unorganized'
    └─ user_id: Uploader
    ↓
AI PROCESSING (Automatic)
    ├─ Extract EXIF: date, GPS, camera
    ├─ Detect vehicle: year, make, model (AI Vision)
    ├─ Classify angle: front, rear, interior, etc.
    └─ ai_processing_status: 'processing' → 'complete'
    ↓
GROUP INTO VEHICLE SUGGESTIONS
    ├─ AI clusters photos by detected vehicle
    ├─ "Found 3 vehicles: 1969 Bronco, 1972 C10, 1985 Blazer"
    └─ Creates vehicle_suggestions records
    ↓
USER REVIEWS SUGGESTIONS
    ├─ Confirm grouping
    ├─ Edit vehicle details
    └─ Reject if wrong
    ↓
PHOTOS LINKED TO VEHICLES
    ├─ vehicle_id: Set to actual vehicle
    ├─ organization_status: 'organized'
    ├─ organized_at: Timestamp
    └─ Photos disappear from "unorganized" view
    ↓
INBOX ZERO ACHIEVED
    └─ Counter: "0 photos to organize"

SYSTEM FEATURES:
  • Pagination: Process thousands efficiently
  • AI suggestions: Auto-groups similar photos
  • Bulk actions: Link multiple photos at once
  • Never see same photo twice after organizing
  • Progress tracking: "2,847 photos remaining"`}
            </div>
          </section>

          {/* Technical Stack */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Technical Stack & Infrastructure
            </h2>
            
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`FRONTEND:
  • React 18 with Vite
  • TypeScript
  • Tailwind CSS
  • React Router (client-side routing)
  • Modular domain design (Vehicle, Org, Admin modules)
  • Workspace UI pattern (VehicleProfile as shell with tabs)
  • Standardized data access (typed services, no raw fetch)

BACKEND:
  • Phoenix/Elixir API
  • Context-driven design (Vehicles, Pricing, Ownership contexts)
  • Clear API contracts
  • Phoenix schemas mirror database constraints

DATABASE:
  • PostgreSQL via Supabase
  • Row Level Security (RLS) policies
  • 290+ migration files (versioned, reversible, idempotent)
  • Referential integrity with cascading deletes
  • JSONB for flexible metadata storage

EDGE FUNCTIONS (100+ Deno functions):
  • analyze-image (main image analysis orchestrator)
  • analyze-image-tier1/2/gap-finder (tiered processing)
  • extract-vehicle-data-ai (universal HTML extractor)
  • vehicle-expert-agent (comprehensive valuation)
  • smart-receipt-linker (receipt extraction & linking)
  • parse-reference-document (brochure/manual extraction)
  • analyze-organization-images (business intelligence)
  • process-auction-settlement (payment automation)
  • create-shipping-listing (Central Dispatch integration)
  • And 90+ more specialized functions

EXTERNAL INTEGRATIONS:
  • AWS Rekognition (computer vision)
  • OpenAI GPT-4o/Vision (document extraction, analysis)
  • Google Gemini (free-tier data extraction)
  • Anthropic Claude (fallback processing)
  • Stripe (payment processing)
  • Twilio (SMS notifications)
  • Central Dispatch (shipping coordination)
  • NHTSA VPIC (VIN decoding)
  • DocuSign (contract signing)
  • Firecrawl (web scraping)

DEPLOYMENT:
  • Frontend: Vercel (automatic on push to main)
  • Database: Supabase (PostgreSQL + Edge Functions)
  • Storage: Supabase Storage (vehicle images, documents)`}
            </div>
          </section>

          {/* System Interconnection Map */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              System Interconnection Map
            </h2>
            
            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Complete System Architecture
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────────────────────┐
│                    NUKE PLATFORM SYSTEM ARCHITECTURE                        │
└─────────────────────────────────────────────────────────────────────────────┘

CORE ENTITIES:
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   USERS     │     │  VEHICLES    │     │ ORGANIZATIONS│
│  (profiles) │     │  (canonical  │     │ (businesses) │
│             │     │   by VIN)    │     │              │
└──────┬──────┘     └──────┬───────┘     └──────┬───────┘
       │                   │                     │
       │                   │                     │
       └───────────┬───────┴───────────┬─────────┘
                   │                   │
                   ▼                   ▼
          ┌──────────────────────────────────────┐
          │    TIMELINE_EVENTS (Central Ledger)  │
          │  • Dual Value: Vehicle + Contributor │
          │  • Immutable history                 │
          │  • Confidence scoring                │
          └──────────────────────────────────────┘
                   │
       ┌───────────┼───────────┬───────────┐
       │           │           │           │
       ▼           ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  IMAGES  │ │ DOCUMENTS│ │ RECEIPTS │ │ FINANCIAL│
│          │ │          │ │          │ │          │
│EXIF GPS  │ │OCR/Extract│ │AI Extract│ │TRANSACTIONS│
│AI Analysis│ │          │ │          │ │INVOICES   │
│          │ │          │ │          │ │PAYMENTS   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
       │           │           │           │
       └───────────┴───────────┴───────────┘
                   │
                   ▼
          ┌──────────────────────────────────────┐
          │    PROCESSING LAYERS                 │
          │                                      │
          │  ARBOREAL → WEB → RHIZOMATIC        │
          │    ↓       ↓        ↓                │
          │  Specs  Connect  Intelligence       │
          └──────────────────────────────────────┘

MARKETPLACE SYSTEMS:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   AUCTIONS   │     │  LISTINGS    │     │  TRANSACTIONS│
│              │     │  (Multi-     │     │              │
│• Bid deposits│     │  platform)   │     │• Facilitation│
│• Settlement  │     │• Export prep │     │• Payments    │
│• Shipping    │     │• Tracking    │     │• Documents   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                     │
       └────────────────────┴─────────────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │   SHIPPING   │
                    │  (Central    │
                    │   Dispatch)  │
                    └──────────────┘

INTELLIGENCE SYSTEMS:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   AI IMAGE   │     │  VALUATION   │     │  INVESTMENT  │
│  PROCESSING  │     │  INTELLIGENCE│     │  MATCHING    │
│              │     │              │     │              │
│• Tiered      │     │• Market data │     │• Org scoring │
│• Context-aware│    │• AI analysis │     │• Investor    │
│• SPID/VIN    │     │• Equations   │     │  matching    │
└──────────────┘     └──────────────┘     └──────────────┘`}
            </div>

            <h3 style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              Data Flow Between Systems
            </h3>
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`EXAMPLE: Complete Vehicle Sale Flow

1. VEHICLE CREATED
   └─ VIN decoded (NHTSA)
   └─ Basic specs established (Arboreal layer)

2. IMAGES UPLOADED
   ├─ EXIF extracted → GPS coordinates
   ├─ AI analysis → Components identified
   └─ Timeline events auto-created

3. GPS AUTO-LINKS TO ORGANIZATION
   └─ Images have GPS → Auto-assign to nearby org (500m)
   └─ organization_vehicles record created

4. RECEIPTS UPLOADED
   ├─ OCR extraction → Parts, vendor, date
   ├─ Receipt items created
   └─ Links to images showing those parts

5. WORK DOCUMENTED
   ├─ Contractor uploads work images
   ├─ Contribution submission created
   └─ Org owner verifies → Timeline event published

6. VALUATION CALCULATED
   ├─ Market data scraped (AutoTrader, etc.)
   ├─ AI analyzes images + receipts
   └─ Expert valuation generated

7. LISTED FOR AUCTION
   ├─ Vehicle listing created
   ├─ AI description generated
   └─ Multi-platform exports prepared

8. BIDS PLACED
   ├─ Deposits held on Stripe
   └─ Real-time bidding updates

9. AUCTION WINS
   ├─ Settlement processed automatically
   ├─ Purchase agreement generated
   ├─ Shipping listing created (Central Dispatch)
   └─ Transaction record created

10. DELIVERY TRACKED
    ├─ Shipping webhooks update status
    └─ Timeline events document delivery

ALL DATA FLOWS THROUGH TIMELINE_EVENTS AS CENTRAL LEDGER`}
            </div>
          </section>

          {/* Comprehensive ERD */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Complete Database ERD (Entity Relationship Diagram)
            </h2>
            
            <div style={{ fontFamily: 'monospace', fontSize: '8pt', background: 'var(--grey-100)', padding: 'var(--space-3)', border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)', whiteSpace: 'pre-wrap' }}>
{`┌─────────────────────────────────────────────────────────────────────────────┐
│                    COMPLETE DATABASE ERD                                     │
└─────────────────────────────────────────────────────────────────────────────┘

PRIMARY ENTITIES:
┌─────────────────────────────────────────────────────────────────────┐
│ auth.users ──────────────────────────────────────────────────────┐ │
│ • id (PK)                                                        │ │
│                                                                  │ │
│ └───→ profiles                                                   │ │
│       • id (PK, FK → auth.users)                                │ │
│       • email, full_name, avatar_url                             │ │
│       • stripe_customer_id, default_payment_method               │ │
│                                                                  │ │
│       └───→ user_cash_balances                                   │ │
│             • balance_cents, available_cents, reserved_cents     │ │
│                                                                  │ │
│       └───→ user_ai_providers                                    │ │
│             • provider (openai, anthropic, google), api_key      │ │
└─────────────────────────────────────────────────────────────────────┘

VEHICLE CORE:
┌─────────────────────────────────────────────────────────────────────┐
│ vehicles (Canonical by VIN)                                        │ │
│ • id (PK), vin (UNIQUE)                                            │ │
│ • year, make, model, series, trim                                  │ │
│ • user_id (FK → auth.users)                                        │ │
│ • year_source, year_confidence, make_source, etc.                 │ │
│                                                                     │ │
│ └───→ vehicle_images (One-to-Many)                                │ │
│       • id (PK), vehicle_id (FK, nullable for personal library)   │ │
│       • image_url, angle, category                                 │ │
│       • taken_at, latitude, longitude (EXIF)                      │ │
│       • ai_scan_metadata (JSONB)                                   │ │
│                                                                     │ │
│       └───→ image_tags (Many-to-Many)                             │ │
│             • tag_name, tag_type, confidence                       │ │
│             • x_position, y_position (spatial)                    │ │
│                                                                     │ │
│ └───→ timeline_events (One-to-Many, Central Ledger)              │ │
│       • event_type, event_date, description                        │ │
│       • confidence_score, verification_status                     │ │
│       • source_type, documentation_urls                           │ │
│       • metadata (JSONB)                                           │ │
│                                                                     │ │
│ └───→ vehicle_documents (One-to-Many)                             │ │
│       • document_type, file_url                                    │ │
│       • ai_processing_status                                       │ │
│                                                                     │ │
│ └───→ vehicle_spid_data (One-to-One)                              │ │
│       • vin, build_date, rpo_codes[], paint codes                 │ │
│       • extraction_confidence                                      │ │
│                                                                     │ │
│ └───→ vehicle_options (One-to-Many)                               │ │
│       • rpo_code, description, category                            │ │
│                                                                     │ │
│ └───→ receipts (One-to-Many)                                      │ │
│       • vendor_name, purchase_date, total_amount                  │ │
│       • ai_extracted (JSONB)                                       │ │
│                                                                     │ │
│       └───→ receipt_items (One-to-Many)                           │ │
│             • part_number, description, quantity, price            │ │
│                                                                     │ │
│ └───→ vehicle_listings (One-to-Many)                              │ │
│       • sale_type (auction, for_sale), status                     │ │
│       • auction_start_time, auction_end_time                      │ │
│       • current_high_bid_cents                                    │ │
│                                                                     │ │
│       └───→ auction_bids (One-to-Many)                            │ │
│             • bidder_id, bid_amount_cents                         │ │
│             • deposit_amount_cents, deposit_status                │ │
│             • stripe_payment_intent_id                            │ │
└─────────────────────────────────────────────────────────────────────┘

ORGANIZATION CORE:
┌─────────────────────────────────────────────────────────────────────┐
│ businesses (Organizations)                                         │ │
│ • id (PK), business_name, business_type                            │ │
│ • latitude, longitude (for GPS matching)                          │ │
│ • discovered_by, is_verified                                       │ │
│                                                                     │ │
│ └───→ organization_vehicles (Many-to-Many)                        │ │
│       • vehicle_id (FK), relationship_type                         │ │
│       • auto_tagged, gps_match_confidence                          │ │
│                                                                     │ │
│ └───→ organization_images (One-to-Many)                           │ │
│       • image_url, category (facility, equipment, etc.)           │ │
│       • latitude, longitude (EXIF)                                │ │
│       • ai_analysis (JSONB)                                        │ │
│                                                                     │ │
│       └───→ organization_narratives (One-to-Many)                 │ │
│             • investment_score, business_stage                     │ │
│             • investor_pitch, growth_signals                       │ │
│                                                                     │ │
│ └───→ organization_contributors (Many-to-Many)                    │ │
│       • user_id (FK), role, status                                 │ │
│                                                                     │ │
│ └───→ organization_offerings (One-to-Many)                        │ │
│       • stock_symbol, total_shares, price_per_share               │ │
│                                                                     │ │
│       └───→ organization_market_orders (One-to-Many)              │ │
│             • order_type (buy/sell), shares, price                │ │
└─────────────────────────────────────────────────────────────────────┘

FINANCIAL CORE:
┌─────────────────────────────────────────────────────────────────────┐
│ transactions (Vehicle financial transactions)                       │ │
│ • vehicle_id (FK), user_id (FK)                                    │ │
│ • transaction_type, amount_cents                                   │ │
│ • vendor_name, purchase_date                                       │ │
│ • receipt_url, timeline_event_id                                   │ │
│                                                                     │ │
│ └───→ cash_transactions (User cash balance)                       │ │
│       • user_id (FK), amount_cents                                 │ │
│       • transaction_type (deposit, withdrawal, trade_buy/sell)    │ │
│                                                                     │ │
│ └───→ generated_invoices (Invoices from timeline events)          │ │
│       • timeline_event_id (FK), total_amount_cents                │ │
│       • payment_token, payment_link                                │ │
│       • payment_method, payment_status                             │ │
│                                                                     │ │
│ └───→ payment_transactions (All payment audit trail)              │ │
│       • transaction_type, amount_cents                             │ │
│       • stripe_payment_intent_id                                   │ │
│       • status (succeeded, failed, refunded)                      │ │
└─────────────────────────────────────────────────────────────────────┘

REFERENCE LIBRARY:
┌─────────────────────────────────────────────────────────────────────┐
│ reference_libraries (One per YMM combination)                      │ │
│ • year, make, model, series, body_style                            │ │
│                                                                     │ │
│ └───→ library_documents (One-to-Many)                              │ │
│       • document_type (brochure, manual, spec_sheet)               │ │
│       • file_url, page_count                                       │ │
│                                                                     │ │
│       └───→ document_extractions (One-to-Many, staging)            │ │
│             • extracted_data (JSONB), status (pending_review)      │ │
│                                                                     │ │
│ └───→ oem_vehicle_specs (Linked after approval)                    │ │
│       • engine_size, horsepower, torque                            │ │
│       • source_documents[] (proof links)                           │ │
│                                                                     │ │
│ └───→ extracted_paint_colors (Color database)                      │ │
│       • color_code, color_name, color_family                       │ │
│                                                                     │ │
│ └───→ extracted_rpo_codes (Options database)                       │ │
│       • rpo_code, description, category                            │ │
└─────────────────────────────────────────────────────────────────────┘

CONTRIBUTION SYSTEM:
┌─────────────────────────────────────────────────────────────────────┐
│ contribution_submissions (Contractor work)                          │ │
│ • contributor_id (FK), vehicle_id (FK)                             │ │
│ • work_date, work_category, work_description                       │ │
│ • responsible_party_type, responsible_party_org_id                 │ │
│ • status (pending, approved, rejected)                             │ │
│                                                                     │ │
│ └───→ vehicle_work_contributions (Organization work tracking)      │ │
│       • vehicle_id (FK), contributing_organization_id (FK)         │ │
│       • work_type, labor_hours, total_cost                         │ │
│                                                                     │ │
│ └───→ contractor_work_contributions (Contractor attribution)       │ │
│       • contractor_user_id (FK), organization_id (FK)              │ │
│       • labor_hours, hourly_rate, total_value                      │ │
│       • verified_by_shop                                           │ │
└─────────────────────────────────────────────────────────────────────┘

SHIPPING SYSTEM:
┌─────────────────────────────────────────────────────────────────────┐
│ vehicle_transactions (Sales with shipping)                          │ │
│ • buyer_id, seller_id, sale_price                                  │ │
│ • shipping_listing_id (Central Dispatch)                           │ │
│ • shipping_status, shipping_carrier_name                           │ │
│                                                                     │ │
│ └───→ shipping_tasks (Multi-leg shipping)                          │ │
│       • vehicle_id (FK), task_type                                 │ │
│       • status (pending, in_progress, completed)                   │ │
│       • estimated_cost, actual_cost                                │ │
│                                                                     │ │
│ └───→ shipping_events (Central Dispatch webhooks)                  │ │
│       • transaction_id (FK), event_type                            │ │
│       • carrier_assigned, picked_up, in_transit, delivered        │ │
└─────────────────────────────────────────────────────────────────────┘`}
            </div>
          </section>

          {/* System Statistics */}
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              Platform Statistics
            </h2>
            
            <div style={{ fontSize: '10pt', lineHeight: '1.7' }}>
              <ul style={{ marginLeft: 'var(--space-6)' }}>
                <li><strong>Database Tables:</strong> 50+ core tables with complete referential integrity</li>
                <li><strong>Edge Functions:</strong> 100+ Deno functions handling AI processing, scraping, payments</li>
                <li><strong>Database Migrations:</strong> 290+ versioned, reversible migrations</li>
                <li><strong>Image Processing:</strong> Tiered system processing 2,700+ images with context-aware routing</li>
                <li><strong>Data Sources:</strong> VIN decoding, web scraping, OCR, computer vision, document parsing</li>
                <li><strong>Verification Tiers:</strong> 6-level verification hierarchy from user input to title verification</li>
                <li><strong>Revenue Streams:</strong> Auction marketplace (3-5%), multi-platform exports (1-2%), transaction facilitation</li>
                <li><strong>Payment Methods:</strong> Stripe, Venmo, Zelle, PayPal, Cash (payment-first onboarding)</li>
                <li><strong>Shipping Integration:</strong> Central Dispatch API for automated vehicle transport coordination</li>
                <li><strong>AI Providers:</strong> OpenAI GPT-4o, Google Gemini (free tier), Anthropic Claude with automatic fallback</li>
              </ul>
            </div>
          </section>

          {/* Footer */}
          <div style={{ marginTop: 'var(--space-8)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-medium)', fontSize: '9pt', fontStyle: 'italic', color: '#666', textAlign: 'center' }}>
            <strong>NUKE Platform</strong> - Building the definitive digital identity for every vehicle.<br/>
            Every data point sourced. Every claim verified. Every timeline preserved. Every contribution recognized.
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default About;

