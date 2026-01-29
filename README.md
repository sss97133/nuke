# Vehicle Data Infrastructure

We turn scattered car history into structured, tradable intelligence.

---

## Why This Matters

Vehicle history reports only capture what's formally reported — title transfers, accidents, dealer service. They miss what's actually known: the forum threads documenting a rebuild, the auction comments debating originality, the shop records from independent mechanics.

We capture the institutional knowledge that lives outside the paperwork.

---

## What Structured Data Enables

- **Faster sales** — Verified history closes deals. Buyers trust documented provenance.
- **Automated marketing** — Rich vehicle data powers social posts, listings, and alerts without manual work.
- **Transparent accounting** — Every transaction, service record, and ownership change in one auditable trail.
- **Accurate valuations** — Real market data, not guesses. Comps, trends, condition factors.

---

## How It Works

1. **Aggregate** — Pull history from auctions, forums, registries, service records
2. **Structure** — Normalize into verified timelines with confidence scores
3. **Connect** — Owners, shops, buyers, insurers share one source of truth

---

## Scale

136,000+ vehicles. 4.5M+ data points. 10M+ images.

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript |
| Backend | Elixir/Phoenix, Supabase |
| Database | PostgreSQL |

---

## Quick Start

```bash
# Frontend
cd nuke_frontend && npm install && npm run dev

# Backend
cd nuke_api && mix deps.get && mix phx.server
```
