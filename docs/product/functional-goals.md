# Nuke Platform Functional Goals & Architecture

## 1. Executive Summary

Nuke is a vehicle identity platform that treats every Vehicle Identification Number (VIN) as a persistent digital entity. The goal is to create a canonical, verifiable record of a vehicle's history, condition, and value that transcends ownership changes.

The platform serves three primary stakeholders:
1. **Vehicle Enthusiasts/Owners**: Documenting history, managing restoration, tracking value.
2. **Organizations/Dealers**: Managing inventory, processing trade-ins, marketing vehicles.
3. **Marketplace Participants**: Buyers and sellers requiring trusted, verified data.

## 2. Core Functional Pillars

### The Canonical Vehicle Profile
Every vehicle has a single, shared profile identified by VIN.
- **Single Source of Truth**: Data is aggregated from user contributions, decoding services (NHTSA), and historical records.
- **Timeline as Ledger**: The `timeline_events` table is the central ledger. Every significant action (service, modification, sale, sighting) is an event.
- **Dual Value Principle**: Every event serves both the vehicle's history (What happened to this car?) and the contributor's reputation (Who verified this?).

### Data Architecture Layers

The system processes information through three distinct layers to ensure accuracy and context:

1. **Arboreal Layer (The Root)**
   - **Definition**: Hierarchical, definitive data bounded within a vehicle profile.
   - **Components**: Factory specs (VIN decode), production numbers, verified ownership history.
   - **Role**: Provides the undeniable "ground truth" context for all other data.

2. **Web Interface Layer (The Connections)**
   - **Definition**: Structured relationships connecting data points.
   - **Components**: Links between parts and manuals, receipts and timeline events, images and service records.
   - **Role**: Transforms isolated data points into a navigable knowledge graph.

3. **Rhizomatic Layer (The Intelligence)**
   - **Definition**: Emergent knowledge from pattern recognition across the entire fleet.
   - **Components**: AI-driven valuation, common failure predictions, restoration cost estimates.
   - **Role**: Applies collective learnings to specific vehicles (e.g., "Broncos of this year often have rust here").

## 3. Key User Journeys

### A. The Contribution Flow
1. **Capture**: User uploads images, receipts, or documents.
2. **Processing**: System extracts metadata (EXIF, OCR, text).
3. **Contextualization**: User or AI tags the content to specific vehicle areas or timeline events.
4. **Verification**: Data is cross-referenced against the Arboreal layer (specs) and existing Web layer (history).
5. **Publication**: Verified data becomes part of the permanent record.

### B. The Valuation Flow
1. **Aggregation**: System gathers "Facts" (verified specs, condition ratings) and "Evidence" (recent photos, receipts).
2. **Comparison**: Rhizomatic layer compares this vehicle against market data and similar profiles.
3. **Synthesis**: AI Agent generates a confidence-weighted valuation range.
4. **Feedback**: Owners can challenge valuations by providing more Evidence (loop back to Contribution Flow).

### C. The Organization Workflow
1. **Inventory Management**: Dealers view their owned vehicles with professional tools (bulk edit, pricing).
2. **Marketing**: One-click generation of listing assets from the canonical profile.
3. **Network**: Sharing vehicle data with partners or marketplaces without data re-entry.

## 4. Technical Architecture Goals

### Frontend (React/Vite)
- **Modular Domain Design**: `App.tsx` routes to distinct domain modules (Vehicle, Org, Admin) rather than monolithic pages.
- **Workspace UI Pattern**: `VehicleProfile` acts as a shell for specialized "Tabs" (Evidence, Facts, Commerce, Financials), loading only what's needed.
- **Standardized Data Access**: All API interactions flow through typed services and hooks, never raw fetch calls in components.

### Backend (Phoenix/Elixir)
- **Context-Driven Design**: Logic lives in specific Contexts (Vehicles, Pricing, Ownership), not Controllers.
- **API Contracts**: Clear, documented boundaries for how the Frontend consumes Backend services.
- **Data Integrity**: Phoenix schemas mirror database constraints to prevent invalid states.

### Database (Postgres/Supabase)
- **Referential Integrity**: Deleting a parent record (e.g., Vehicle) cascades correctly to children (Images, Events).
- **RLS Security**: Row Level Security policies strictly enforce ownership and contribution rights.
- **Migration Discipline**: All schema changes are versioned, reversible, and idempotent (`IF NOT EXISTS`).

## 5. Success Metrics

- **Data Completeness**: Percentage of vehicles with verified Specs + at least one Timeline Event.
- **System Performance**: Time to First Byte (TTFB) and Largest Contentful Paint (LCP) on Vehicle Profile.
- **Code Maintainability**: Reduction in cyclic dependencies and monolithic component sizes.
- **Token Efficiency**: Efficient use of AI context windows through structured data passing.

