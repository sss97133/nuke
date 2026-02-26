# NUKE — Company Brief
**Every agent reads this. This is the constitution.**

---

## What We Are

Nuke is a vehicle data intelligence platform. We aggregate, enrich, and surface data on collector and specialty vehicles — making the opaque vehicle market legible for buyers, sellers, dealers, and developers.

The product is `@nuke1/sdk` — an API that lets developers build on top of our data: valuations, comparable sales, image analysis, provenance, market trends. The intelligence layer is YONO — a local vision model trained on our own corpus that classifies vehicles from photos at $0/image vs $0.001-0.004/image for cloud AI.

We have:
- 18,000+ vehicles in the database
- 33 million images
- 397 edge functions
- 964 database tables
- Data from BaT, Cars & Bids, FB Marketplace, Craigslist, Mecum, RM Sotheby's, and 40+ other sources

**We are a data company. The moat is the corpus and the model trained on it.**

---

## Who We Serve (Our Clients)

**Vehicles** — each vehicle is an entity we serve. It has a mailbox, a timeline, a provenance record, images, observations. We improve its data fidelity continuously.

**Organizations** — dealers, auction houses, restoration shops, collectors. They have profiles, inventory, seller intelligence records.

**Users** — collectors, buyers, developers using the SDK. They have portfolios, watchlists, API keys.

These are clients. The agent developer layer serves them. It does not replace them.

---

## The Mission

Make the collector vehicle market as legible as the stock market.

A $200K 1973 Porsche 911 RS should have the same data depth as a publicly traded stock: price history, comparable transactions, condition assessment, provenance chain, market trend, liquidity estimate. We're building that.

---

## The Laws (Never Violate These)

1. **`archiveFetch()` always** — never raw `fetch()` for external URLs. Every page gets archived. Fetch once, extract forever.
2. **`pipeline_registry` before writing** — 63 fields have owning functions. Direct writes cause data forks.
3. **`import_queue` for extraction** — insert URLs here, `continuous-queue-processor` picks them up. Don't poll.
4. **Image pipeline is paused** — `NUKE_ANALYSIS_PAUSED` flag. 32M images pending. CEO approval required to unpause. Cost implication: ~$64K at current cloud AI rates. YONO sidecar changes this math.
5. **BaT two-step** — `extract-bat-core` then `extract-auction-comments`. Never one-step.
6. **Lock fields untouchable** — `locked_by`/`locked_at` on queue tables are worker-managed only.

---

## Current Sprint (Feb 2026)

**#1 YONO FastAPI sidecar** — blocks SDK v1.3.0. Tier 2 hierarchical model trained, ONNX exported. Sidecar needs to be built and integrated. This is the highest-leverage unblocked item.

**#2 FB Marketplace extraction** — residential-IP scraper deployed. Testing logged-out GraphQL path. This is the largest untapped source.

**#3 Agent infrastructure** — what you're now part of. Executive layer, reactive repair, company-as-simulation.

---

## The Org Structure

```
Founder/CEO (Skylar)
  → Sets vision and strategy. Rants. Makes final calls.
  → Talks to executives, not workers.

Executives (Opus — resumed sessions)
  COO   — system health, routing, "what's going on"
  CTO   — architecture, standards, tech decisions
  CFO   — cost, token economics, API budgets
  CPO   — product, SDK, developer experience
  CDO   — data quality, pipeline coverage, corpus

VPs (Sonnet — domain leads)
  Extraction / AI-Vision / Platform / Vehicle Intelligence / Deal Flow / Orgs / Docs / Photos

Workers (Haiku — stateless executors)
  Pick up work orders, execute, report, exit
```

---

## What Correct Looks Like

A working Nuke system:
- Ingests new vehicle listings continuously from 40+ sources
- YONO classifies images locally at $0/image
- Valuations, scores, and market signals computed automatically
- Executives receive issues, route immediately, report outcomes
- CEO wakes up to a better system than the night before — without having been the one to fix it

---

## Reference Files

- `CODEBASE_MAP.md` — full map of 397 functions, 11 departments, owned tables
- `TOOLS.md` — canonical intent → function map (read before building anything)
- `PROJECT_STATE.md` — current sprint focus
- `ACTIVE_AGENTS.md` — what's currently in flight
- `DONE.md` — what was recently built
