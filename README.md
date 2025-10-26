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

## Deployment

The frontend deploys automatically to Vercel on push to main branch.
Backend is deployed via [deployment method TBD].

## Environment Setup

1. Copy `.env.example` to `.env`
2. Add required environment variables
3. Set up Supabase connection
4. Configure API keys

For detailed setup instructions, see `docs/archive/SETUP_CHECKLIST.md`
