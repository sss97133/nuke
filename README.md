# Vehicle Data Infrastructure

We turn scattered car history into structured, tradable intelligence.

---

## What It Does

- **Autonomous extraction** from auctions, marketplaces, and forums
- **AI-powered analysis** of comments, descriptions, and images
- **Verified timelines** that owners and shops contribute to
- **Provenance reports** for buyers, insurers, and auction houses

---

## Traction

| Metric | Count |
|--------|-------|
| Vehicle profiles | 18,000+ |
| Auction comments extracted | 364,000+ |
| Images indexed | 1,000,000+ |
| Data sources | BaT, Cars & Bids, Hagerty, RM Sotheby's, + more |

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vercel |
| Backend | Elixir/Phoenix, Supabase Edge Functions |
| Database | PostgreSQL (Supabase) |
| AI | Claude, GPT-4, Gemini |

---

## Quick Start

```bash
# Frontend
cd nuke_frontend && npm install && npm run dev

# Backend
cd nuke_api && mix deps.get && mix phx.server
```

See `docs/ENV_QUICKREF.md` for environment setup.
