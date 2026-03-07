# nuke

Vehicle data infrastructure. We turn scattered car history into structured, tradable intelligence.

## What it does

Vehicle history reports only capture what's formally reported — title transfers, accidents, dealer service. They miss what's actually known: the forum threads documenting a rebuild, the auction comments debating originality, the shop records from independent mechanics.

Nuke captures the institutional knowledge that lives outside the paperwork.

**Aggregate** — Pull history from auctions, forums, registries, service records.
**Structure** — Normalize into verified timelines with confidence scores.
**Connect** — Owners, shops, buyers, insurers share one source of truth.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript |
| Edge Functions | Deno (Supabase) |
| Backend | Elixir/Phoenix |
| Database | PostgreSQL (Supabase) |
| Vision | YONO — local vehicle classification model |

## Project structure

```
nuke_frontend/     React app
nuke_api/          Elixir/Phoenix backend
supabase/          Edge functions + migrations
  functions/       180+ edge functions (extractors, APIs, pipelines)
scripts/           CLI tools, scrapers, batch jobs
yono/              Vehicle vision model (EfficientNet, ONNX)
src/               Shared frontend components
tools/             SDK, utilities
```

## Setup

```bash
npm install
cd nuke_frontend && npm run dev
```

Edge functions require [Supabase CLI](https://supabase.com/docs/guides/cli) and `.env` configuration.

## License

Proprietary.
