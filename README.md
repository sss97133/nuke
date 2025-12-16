# N-Zero Granular data Management Platform

A comprehensive vehicle management system with photo analysis, timeline tracking, and valuation capabilities.

## Project Structure

```
nuke/                           # Main project root
├── nuke_frontend/             # React frontend application
├── nuke_api/                  # Elixir/Phoenix backend API
├── supabase/                  # Database schema and functions
├── ops/                       # Operational scripts and tools
├── scripts/                   # Utility and migration scripts
└── docs/                      # Documentation and archives
```

## Quick Start

### Frontend Development
```bash
cd nuke_frontend
npm install
npm run dev
```

### Backend Development
```bash
cd nuke_api
mix deps.get
mix phx.server
```

### Database Operations
```bash
# Run from project root
npm run db:run -- path/to/script.sql
```

### Bring a Trailer import

To import a Bring a Trailer listing (data + all images) into a vehicle profile, see `docs/IMPORT_BAT_LISTING.md`.

## Deployment

The frontend deploys automatically to Vercel on push to main branch.
Backend is deployed via [deployment method TBD].

## Environment Setup

The repo is wired into **Supabase** (DB/Auth/Storage/Edge Functions) and deploys the **frontend to Vercel**.

1. Review `docs/ENV_QUICKREF.md` (canonical “what vars exist + where they live”)
2. For frontend local dev, set `VITE_*` variables in `nuke_frontend/.env.local`
3. Run the env sanity checker from repo root:

```bash
npm run env:doctor
```

For detailed setup instructions, see `docs/archive/SETUP_CHECKLIST.md`
