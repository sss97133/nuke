# Nuke - Vehicle Intelligence Platform

**Production-grade vehicle data management with AI-powered quality assurance and real-time collaborative verification.**

## Overview

Nuke is a granular data authentication platform that combines multi-source aggregation, machine learning validation, and collaborative verification to create high-fidelity digital identities. The system emphasizes data quality over quantity, using custom algorithms to ensure every data point is properly sourced, validated, annotated and attributed.

## Core Intelligence Systems

### 1. Multi-Source Data Validation

Every data field is tracked with its source and confidence level. The system aggregates data from multiple contributors and uses consensus algorithms to determine ground truth:

```
Data Quality = f(source_type, consensus_level, verification_count, temporal_consistency)
```

**Source Hierarchy:**
- Professional Title Verification: 100% confidence weight
- Expert Certification: 95% confidence weight  
- Multi-User Consensus: 85% confidence weight
- Single User Claim: 75% confidence weight
- AI Detection: 30-60% confidence weight (context-dependent)

### 2. Computer Vision Analysis

Automated image analysis using custom trained  AWS Rekognition with confidence boosting:

- **Part Detection**: Identifies automotive components with cross-image validation
- **Damage Assessment**: Detects rust, dents, and wear patterns
- **Modification Tracking**: Recognizes non-stock components and upgrades
- **Cross-Validation**: Increases confidence when same component appears in multiple images from the same photo session

**Production Results:**
```
Test Vehicle (1974 K5 Blazer, 92 images):
├─ 114 quality detections (100% confidence, cross-validated)
├─ 32 condition detections (100% confidence)
├─ 4 parts detections (99% confidence, cross-validated)
└─ 291 total AI tags with source attribution
```

### 3. Intelligent Document Processing

Receipt and document parsing using LLM-based extraction with validation:

- **Structured Extraction**: Vendor, dates, line items, totals
- **Dual Validation**: Primary extraction + LLM validation pass
- **Error Detection**: Identifies inconsistencies in OCR output
- **Financial Tracking**: Links expenses to timeline events and modifications

### 4. Price Intelligence Engine

AI-assisted valuation combining arborial data sources:

- Market data aggregation from auction and online platforms
- Modification value assessment
- Condition-based adjustments
- Historical price tracking
- Human oversight and override capabilities

**Algorithm:**
```
Price = (Market_Base × 0.40) + (AI_Analysis × 0.30) + (Modifications × 0.20) + (Condition × 0.10)
```

### 5. Timeline Event Correlation

Automated relationship detection between events, images, and documents:

- **Temporal Clustering**: Groups related events by date proximity
- **Evidence Linking**: Connects supporting documents to timeline claims
- **Photo Session Detection**: Identifies images taken during same work session
- **EXIF Analysis**: Extracts location, timestamp, and camera metadata

## Data Quality Architecture

### Duality Principle

The system follows a fundamental architectural pattern: every event creates dual value for both vehicle history and user contributions. One record in `timeline_events` serves both purposes:

- **Vehicle Timeline**: Filters by `vehicle_id` for complete history
- **User Contributions**: Filters by `user_id` for credibility tracking

Both views are automatically synchronized because they query the same underlying data source.

### Confidence Scoring

Every data point carries metadata about its provenance:

```typescript
interface FieldSource {
  field_name: string;
  value: any;
  source_type: 'title' | 'professional' | 'human' | 'ai';
  confidence_score: number;
  verified_by: string[];
  created_at: timestamp;
}
```

### Verification Hierarchy

Different contributor types have different field access and trust levels:

- **Title Holders**: Full write access, highest trust
- **Professional Services**: Scoped access to work performed
- **Verified Contributors**: Limited field access, moderate trust
- **Public Viewers**: Read-only with appropriate data visibility

## Technical Architecture

### Frontend
- **React 18+** with TypeScript
- **Vite** build system
- **Tailwind CSS** for styling
- Direct Supabase integration for real-time data

### Backend
- **Supabase** - PostgreSQL with Row Level Security
- **Edge Functions** - Serverless TypeScript for AI/ML operations
- **AWS Rekognition** - Computer vision processing
- **Anthropic Claude / OpenAI** - Document parsing and validation

### Data Layer
- **PostgreSQL 14+** with JSONB for flexible schemas
- **Real-time subscriptions** for live updates
- **Optimistic locking** for concurrent edits
- **Audit logging** for all data changes

## Key Features

### High-Fidelity Data Management
- Source attribution for every field
- Confidence scoring on all data points
- Multi-party consensus validation
- Temporal consistency checking

### Professional Tools
- Receipt parsing and expense tracking
- Tool inventory management
- Location-based work sessions
- Shop integration and compliance

### Collaborative Verification
- Multiple users can contribute to same vehicle profile
- Consensus-based truth determination
- Verification reputation system
- Expert certification workflows

### Privacy & Security
- Row-level security policies
- Role-based access control
- Granular data visibility rules
- Secure document storage

## Production Deployment

The platform runs entirely on managed services:

```
Frontend → Vercel
Database → Supabase (PostgreSQL + Auth + Storage)
Edge Functions → Supabase (Deno runtime)
Computer Vision → AWS Rekognition
```

**Deployment:**
```bash
cd nuke_frontend
vercel --prod
```

## Data Quality Guarantees

1. **Source Transparency**: Every field shows its data source
2. **Confidence Scoring**: All data points include confidence levels
3. **Audit Trail**: Complete history of all changes
4. **Consensus Validation**: Multiple contributors increase accuracy
5. **Professional Verification**: Expert oversight for critical data

## API Documentation

See `/docs` directory for:
- API endpoints and schemas
- Data quality algorithms
- Verification workflows
- Integration guides

## Contributing

This is a production system with high data quality standards. See `CONTRIBUTING.md` for guidelines on:
- Data validation requirements
- Testing procedures
- Code quality standards
- Documentation expectations

---

**Built for automotive professionals, collectors, and verification services who demand high-quality data.**
