# Nuke — Vehicle Build and Valuation Platform

Nuke is a modern vehicle build management platform. It turns photos, receipts, and work history into structured data, then produces a defensible valuation with clear provenance.

## What this project is

- **Vehicle profiles**: Upload photos, manage timelines, and document work sessions per vehicle.
- **Smart receipts**: Parse invoices from files or pasted text (OCR + server extract) and persist normalized line items to the database.
- **Valuation engine**: Deterministic model that blends receipts, labor, MarketCheck data, and comparables; includes category breakdowns and confidence.
- **Image intelligence**: AI tags for parts/components; spatial dots on images; link evidence to receipts and timeline events.
- **Data backbone**: Supabase SQL schema, RPC functions, and storage; optional Phoenix API for advanced integrations.

## Structure

```
├── nuke_frontend/    # React + Vite app (Supabase client)
├── nuke_api/         # Elixir/Phoenix backend (optional)
├── supabase/         # SQL schema, RPCs, and functions
├── ops/              # Dev and DB scripts
└── docs/             # Guides and reference
```

## Quick start

Frontend (requires Node 22.x):
```bash
cd nuke_frontend
cp .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Type-check and build:
```bash
npm run type-check
npm run build
```

Backend (optional):
```bash
cd nuke_api
mix deps.get
mix phx.server
```

Database helpers (from repo root):
```bash
npm run db:run -- supabase/sql/some_script.sql
```

## Key capabilities in the codebase

- `nuke_frontend/src/components/SmartInvoiceUploader.tsx`: Upload + OCR + extract + preview flow.
- `nuke_frontend/src/services/receiptExtractionService.ts`: Invokes server function to parse invoices.
- `nuke_frontend/src/services/receiptPersistService.ts`: Saves receipts and items to Supabase tables.
- `nuke_frontend/src/services/vehicleValuationService.ts`: Single source of truth for valuation.

## Deployment

- Frontend: Vercel (automatic builds on `main`).
- Database: Supabase.
- External: MarketCheck for market signals (when configured).

## Notes for contributors

- Integration tests require Supabase env: set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- If a build fails due to a missing component import, check recent UI refactors for renamed/removed modules before merging.
