# Dead Features: The Archaeology of Abandoned Ideas

> "Build a new Deno edge function for the Nuke vehicle data platform.  **Working directory**: `/Users/skylar/nuke`  **File to create**: `supabase/functions/compute-data-quality-snapshot/index.ts`  Thi..."

## The Graveyard

| Feature | Born | Peak | Died | Prompts | Commits | Lifespan | Cause of Death |
|---------|------|------|------|---------|---------|----------|----------------|
| Betting / Prediction Markets | Oct 25 | Feb | Mar 09 | 61 | 23 | 125d | Triage deletion |
| Trading / Exchange | Oct 21 | Feb | Mar 09 | 112 | 20 | 136d | Triage deletion |
| Vault / Concierge / Villa | Jan 26 | Feb | Mar 08 | 56 | 3 | 33d | Triage deletion |
| Shipping Logistics | Oct 27 | Feb | Mar 08 | 28 | 27 | 130d | Triage decision |
| Investor Portal | Oct 21 | Feb | Mar 10 | 151 | 23 | 135d | Triage deletion |
| Twitter/Social Integration | Nov 02 | Jan | Feb 26 | 26 | 0 | 115d | Never built |
| Mobile-First Approach | Nov 05 | Feb | Mar 06 | 8 | 0 | 120d | Frustration spiral |
| Browser Extension | Oct 25 | Feb | Mar 05 | 24 | 0 | 131d | Never built |
| Telegram Bot | Jan 31 | Feb | Feb 27 | 92 | 5 | 27d | Triage deletion |

## The Enthusiasm Arc

Monthly prompt volume per dead feature (block height = relative frequency):

```
Betting / Prediction Markets  Oct.  Nov▁  Dec·  Jan▄  Feb██  Mar▁
Trading / Exchange            Oct.  Nov▃  Dec▃  Jan▁  Feb██  Mar▂
Vault / Concierge / Villa     Oct·  Nov·  Dec·  Jan▄  Feb██  Mar.
Shipping Logistics            Oct▁  Nov▁  Dec.  Jan·  Feb██  Mar▅
Investor Portal               Oct.  Nov.  Dec.  Jan.  Feb██  Mar▂
Twitter/Social Integration    Oct·  Nov▃  Dec·  Jan██  Feb▄  Mar·
Mobile-First Approach         Oct·  Nov▂  Dec·  Jan▄  Feb██  Mar▂
Browser Extension             Oct▁  Nov·  Dec▆  Jan▃  Feb██  Mar▁
Telegram Bot                  Oct·  Nov·  Dec·  Jan▁  Feb██  Mar·
```

## Individual Autopsies

### 1. Betting / Prediction Markets

**Born:** 2025-10-25 -- "a note, kalshi is "a marketplace for event contracts" what are we?"

**Peak:** 2026-02 (31 prompts)
> "Run SQL queries to understand what distinguishes explosive vs stalled auctions at T-2h. We need to find features that can predict the growth regime.  Use psql: `PGPASSWORD="RbzKq32A0uhqvJMQ" psql -..."

**Died:** 2026-03-09

**Total effort:** 61 prompts, 23 keyword-matched commits, 117 time-correlated commits

**Frustration rate:** 8%

**The arc:** This feature showed a slow start that built into a spike, peaking at 31 prompts in Feb. 

**Warning signs:** Declining mention frequency before death

**Monthly breakdown:**
```
  Oct  ██ 3
  Nov  ███ 4
  Dec   0
  Jan  █████████████████ 18
  Feb  ██████████████████████████████ 31
  Mar  ████ 5
```

### 2. Trading / Exchange

**Born:** 2025-10-21 -- "i want stock trading thats insane but its just another section. profit sharing is another thing too its all financial assets"

**Peak:** 2026-02 (45 prompts)
> "You are VP Deal Flow at Nuke (nuke.ag). Working directory: /Users/skylar/nuke. Full autonomy — execute directly, do NOT ask for approval.  ## Your Domain Transfers, transactions, market exchange, p..."

**Died:** 2026-03-09

**Total effort:** 112 prompts, 20 keyword-matched commits, 258 time-correlated commits

**Frustration rate:** 17%

**The arc:** This feature showed a slow start that built into a spike, peaking at 45 prompts in Feb. 
The frustration rate of 17% suggests recurring difficulties with the concept or implementation. 
Only 20 commits for 112 prompts -- most of the effort was conceptual rather than code.

**Warning signs:** High frustration rate (17%); Declining mention frequency before death

**Monthly breakdown:**
```
  Oct  ██ 3
  Nov  ██████████████ 22
  Dec  ████████████ 18
  Jan  ███████ 11
  Feb  ██████████████████████████████ 45
  Mar  ████████ 13
```

### 3. Vault / Concierge / Villa

**Born:** 2026-01-26 -- "Love the direction—very clean, platform-coded, and understandable. Here are refined, premium versions that feel more luxury-tech and less generic:  ⸻  VAULTIO  Core taglines (polished)     •    Str..."

**Peak:** 2026-02 (35 prompts)
> "Fix ALL hardcoded color violations in these miscellaneous files in `/Users/skylar/nuke/nuke_frontend/src/`:  1. `components/analytics/SpendingDashboard.tsx` — #6b7280 → var(--text-secondary), color..."

**Died:** 2026-03-08

**Total effort:** 56 prompts, 3 keyword-matched commits, 162 time-correlated commits

**Frustration rate:** 5%

**The arc:** This feature showed initial enthusiasm that gradually faded, peaking at 35 prompts in Feb. 
Only 3 commits for 56 prompts -- most of the effort was conceptual rather than code.

**Warning signs:** Declining mention frequency before death

**Monthly breakdown:**
```
  Oct   0
  Nov   0
  Dec   0
  Jan  ███████████████ 18
  Feb  ██████████████████████████████ 35
  Mar  ██ 3
```

### 4. Shipping Logistics

**Born:** 2025-10-27 -- "need to automate shipping @https://api-docs.centraldispatch.com/apis  options"

**Peak:** 2026-02 (14 prompts)
> "Search the Nuke database and codebase to understand what data exists for a 1932 vehicle connected to "Howard Barton". I need to know:  1. What tables hold vehicle ownership/client relationships? Lo..."

**Died:** 2026-03-08

**Total effort:** 28 prompts, 27 keyword-matched commits, 87 time-correlated commits

**Frustration rate:** 11%

**The arc:** This feature showed a slow start that built into a spike, peaking at 14 prompts in Feb. 
The frustration rate of 11% suggests recurring difficulties with the concept or implementation. 

**Warning signs:** High frustration rate (11%); Declining mention frequency before death

**Monthly breakdown:**
```
  Oct  ████ 2
  Nov  ████ 2
  Dec  ██ 1
  Jan   0
  Feb  ██████████████████████████████ 14
  Mar  ███████████████████ 9
```

### 5. Investor Portal

**Born:** 2025-10-21 -- "ok so its staking that i wanna do. i wanna stake money on vehicles. in theory i want the value of the money i stake to increase/ decrease but the mechanics of + - values how does money one stake on..."

**Peak:** 2026-02 (92 prompts)
> "Build a new Deno edge function for the Nuke vehicle data platform.  **Working directory**: `/Users/skylar/nuke`  **File to create**: `supabase/functions/compute-data-quality-snapshot/index.ts`  Thi..."

**Died:** 2026-03-10

**Total effort:** 151 prompts, 23 keyword-matched commits, 475 time-correlated commits

**Frustration rate:** 8%

**The arc:** This feature showed a slow start that built into a spike, peaking at 92 prompts in Feb. 
Only 23 commits for 151 prompts -- most of the effort was conceptual rather than code.

**Warning signs:** Declining mention frequency before death

**Monthly breakdown:**
```
  Oct  █ 4
  Nov  ██ 8
  Dec  ██ 9
  Jan  ██ 9
  Feb  ██████████████████████████████ 92
  Mar  █████████ 29
```

### 6. Twitter/Social Integration

**Born:** 2025-11-02 -- "shouldnt be there anyways. events are generated elsewhere. when a user clicks on a green box the event should load under the timeline. the comment box is there its a little bulky and ugly. mostly u..."

**Peak:** 2026-01 (13 prompts)
> "https://x.com/QuintenFrancois/status/2016416028268327157?s=20 these are  amazing content to respond to with facts like a craigslist post of a truck that we source from wayback machine or from ebay ..."

**Died:** 2026-02-26

**Total effort:** 26 prompts, 0 keyword-matched commits, 70 time-correlated commits

**Frustration rate:** 12%

**The arc:** This feature showed a slow start that built into a spike, peaking at 13 prompts in Jan. 
The frustration rate of 12% suggests recurring difficulties with the concept or implementation. 
Despite the prompt attention, no commits directly referenced this feature -- it lived entirely in conversation.

**Warning signs:** No commits despite repeated discussion; High frustration rate (12%); Declining mention frequency before death; Talk/code ratio of 26:0

**Monthly breakdown:**
```
  Oct   0
  Nov  ███████████ 5
  Dec   0
  Jan  ██████████████████████████████ 13
  Feb  ██████████████████ 8
  Mar   0
```

### 7. Mobile-First Approach

**Born:** 2025-11-05 -- "basic investigating tooling would help.. like 5w's and like oh this 74 blazer was photographed in the same time span in the same gps within 400m so it ight be a match...      ok great you already i..."

**Peak:** 2026-02 (4 prompts)
> "Research the best approaches for programmatically accessing text messages on macOS and mobile:  1. **macOS iMessage**: The SQLite database at ~/Library/Messages/chat.db - what's the schema? Can an ..."

**Died:** 2026-03-06

**Total effort:** 8 prompts, 0 keyword-matched commits, 8 time-correlated commits

**Frustration rate:** 25%

**The arc:** This feature showed a slow start that built into a spike, peaking at 4 prompts in Feb. 
The frustration rate of 25% suggests recurring difficulties with the concept or implementation. 
Despite the prompt attention, no commits directly referenced this feature -- it lived entirely in conversation.

**Warning signs:** No commits despite repeated discussion; High frustration rate (25%); Declining mention frequency before death

**Monthly breakdown:**
```
  Oct   0
  Nov  ███████ 1
  Dec   0
  Jan  ███████████████ 2
  Feb  ██████████████████████████████ 4
  Mar  ███████ 1
```

### 8. Browser Extension

**Born:** 2025-10-25 -- "im not satisfied with the tags. we should be able to tag every single part with a part number and a number of different suppliers. with a clickable buy window that we process the payment.  @https:/..."

**Peak:** 2026-02 (9 prompts)
> "Apply a SQL migration using mcp__supabase__apply_migration with project_id "qkgaybvrernstplzjaam".  Migration name: "fix_bat_comps_indexes"  Migration SQL: ```sql CREATE EXTENSION IF NOT EXISTS pg_..."

**Died:** 2026-03-05

**Total effort:** 24 prompts, 0 keyword-matched commits, 76 time-correlated commits

**Frustration rate:** 4%

**The arc:** This feature showed a slow start that built into a spike, peaking at 9 prompts in Feb. 
Despite the prompt attention, no commits directly referenced this feature -- it lived entirely in conversation.

**Warning signs:** No commits despite repeated discussion; Declining mention frequency before death; Talk/code ratio of 24:0

**Monthly breakdown:**
```
  Oct  ██████ 2
  Nov   0
  Dec  ███████████████████████ 7
  Jan  █████████████ 4
  Feb  ██████████████████████████████ 9
  Mar  ██████ 2
```

### 9. Telegram Bot

**Born:** 2026-01-31 -- "test telegram"

**Peak:** 2026-02 (81 prompts)
> "undefined VM1444:1 Connecting to 'https://api.telegram.org/bot8516184265:AAGCApYnZC6cXD0WAnocj7ENf8KDhteExCA/sendMessage' violates the following Content Security Policy directive: "connect-src *.fa..."

**Died:** 2026-02-27

**Total effort:** 92 prompts, 5 keyword-matched commits, 193 time-correlated commits

**Frustration rate:** 3%

**The arc:** This feature showed a slow start that built into a spike, peaking at 81 prompts in Feb. 
Only 5 commits for 92 prompts -- most of the effort was conceptual rather than code.

**Warning signs:** Killed cleanly in triage without prior decline signals

**Monthly breakdown:**
```
  Oct   0
  Nov   0
  Dec   0
  Jan  ████ 11
  Feb  ██████████████████████████████ 81
  Mar   0
```

## Patterns of Death

### Warning Sign #1: Prompt Volume Without Commits

Features where prompts kept flowing but code never materialized:

- **Twitter/Social Integration**: 26 prompts, 0 commits (ratio: 26.0:1)
- **Browser Extension**: 24 prompts, 0 commits (ratio: 24.0:1)
- **Vault / Concierge / Villa**: 56 prompts, 3 commits (ratio: 18.7:1)
- **Telegram Bot**: 92 prompts, 5 commits (ratio: 18.4:1)
- **Mobile-First Approach**: 8 prompts, 0 commits (ratio: 8.0:1)
- **Investor Portal**: 151 prompts, 23 commits (ratio: 6.6:1)
- **Trading / Exchange**: 112 prompts, 20 commits (ratio: 5.6:1)
- **Betting / Prediction Markets**: 61 prompts, 23 commits (ratio: 2.7:1)
- **Shipping Logistics**: 28 prompts, 27 commits (ratio: 1.0:1)

### Warning Sign #2: Rising Frustration

Features where frustration permeated the discussion:

- **Mobile-First Approach**: 25% frustration rate
- **Trading / Exchange**: 17% frustration rate
- **Twitter/Social Integration**: 12% frustration rate
- **Shipping Logistics**: 11% frustration rate

### Warning Sign #3: Re-explanation

Features that kept getting re-explained from scratch -- a sign the vision was not sticking:

- **Twitter/Social Integration**: Discussed across 3 months but only 0 commits. Repeated re-introduction suggests the concept never gained enough traction to persist in code.
- **Mobile-First Approach**: Discussed across 4 months but only 0 commits. Repeated re-introduction suggests the concept never gained enough traction to persist in code.
- **Browser Extension**: Discussed across 5 months but only 0 commits. Repeated re-introduction suggests the concept never gained enough traction to persist in code.

### Warning Sign #4: No Commits for 2+ Weeks

Features where commit activity stopped well before prompt activity:

- **Vault / Concierge / Villa**: Last commit 2026-02-18, prompts continued for 18 more days

## Recurrence Risk

Features mentioned after Mar 7, 2026 (post-triage date):

| Feature | Post-Triage Mentions | Risk Level |
|---------|---------------------|------------|
| Betting / Prediction Markets | 5 | Medium (nostalgia) |
| Trading / Exchange | 9 | HIGH (zombie feature) |
| Vault / Concierge / Villa | 2 | Low (reference only) |
| Shipping Logistics | 1 | Low (reference only) |
| Investor Portal | 16 | HIGH (zombie feature) |
| Twitter/Social Integration | 0 | None |
| Mobile-First Approach | 0 | None |
| Browser Extension | 0 | None |
| Telegram Bot | 0 | None |

### Post-Triage Mentions

**Betting / Prediction Markets:**
- "You are auditing the Nuke vehicle data platform codebase at /Users/skylar/nuke for ALL detrimental issues. This is a critical pivot — the project is failing.  Investigate EXHAUSTIVELY:  1. **Edge f..."
- "You are executing Prompt 10: LIQUIDITY IS THE PRODUCT — Audit the Financial Ghost Town.  CONTEXT: Read /Users/skylar/nuke/CLAUDE.md and /Users/skylar/nuke/VISION.md first.  TASK: Full audit of all ..."
- "You are executing: KILL THE GHOST CRONS — Stop Burning Compute on Nothing.  Read /Users/skylar/nuke/CLAUDE.md first. Follow all HARD RULES. Read the audit at /Users/skylar/nuke/.claude/reports/fina..."
- "cd /Users/skylar/nuke  Check the current state of the frontend:  1. Run `cd nuke_frontend && npx vite build 2>&1 | tail -40` to see if the production build succeeds and note any warnings.  2. Check..."
- "open my profile... i have doubts about 428 vehicles... i only had about 80 albums but its possible i gues.. highly unlikely. i bet theres a lot of vehicles in there that shouldnt be. hense why its ..."

**Trading / Exchange:**
- "# NUKE MARKET EXCHANGE — Page Overhaul  ## The Problem With the Current Page  The current copy reads like a fintech pitch deck: - "Collector vehicle segment ETFs — AI-managed, data-driven" - Dry NA..."
- "Find the Market Exchange page component in /Users/skylar/nuke. Look for files related to "market exchange", "exchange", ETF cards, ticker symbols like PORS/SQBD/TRUK/Y79. Search in src/ directory. ..."
- "I need to design an implementation plan for overhauling the Market Exchange page at `/Users/skylar/nuke/nuke_frontend/src/pages/MarketExchange.tsx`.  ## Current State The current page is ~327 lines..."
- "I need to understand the EXACT state of the market, vault, contract, and financial infrastructure in the Nuke database. Not summaries — actual schema, actual data, actual functions.  Step 1: Read t..."
- "In /Users/skylar/nuke/supabase/functions/, I need to understand the exact pattern of the `authenticateRequest` function in each of these api-v1-* endpoints. For each file, I need to know:  1. The l..."

**Vault / Concierge / Villa:**
- "I need to understand the EXACT state of the market, vault, contract, and financial infrastructure in the Nuke database. Not summaries — actual schema, actual data, actual functions.  Step 1: Read t..."
- "cd /Users/skylar/nuke  Check the current state of the frontend:  1. Run `cd nuke_frontend && npx vite build 2>&1 | tail -40` to see if the production build succeeds and note any warnings.  2. Check..."

**Shipping Logistics:**
- "cd /Users/skylar/nuke  Check the current state of the frontend:  1. Run `cd nuke_frontend && npx vite build 2>&1 | tail -40` to see if the production build succeeds and note any warnings.  2. Check..."

**Investor Portal:**
- "I need to design an implementation plan for overhauling the Market Exchange page at `/Users/skylar/nuke/nuke_frontend/src/pages/MarketExchange.tsx`.  ## Current State The current page is ~327 lines..."
- "Read these files and return their full contents: 1. /Users/skylar/nuke/supabase/functions/validate-vehicle-image/index.ts 2. /Users/skylar/nuke/supabase/functions/_shared/cors.ts (just the first 20..."
- "Very thorough exploration of the Nuke vehicle data platform backend to understand the data available:  1. **Database schema**: Check the actual data in these tables:    - `vehicle_observations` - h..."
- "You are a data cleanup agent for the Nuke vehicle database. 455K BaT vehicle URLs still need trailing slashes added.  Use the mcp__supabase__execute_sql tool for ALL database operations.  Run this ..."
- "You are a data cleanup agent for the Nuke vehicle database. 397K vehicles still need titles synthesized from year+make+model.  Use the mcp__supabase__execute_sql tool for ALL database operations.  ..."

## The Cost

**Total prompts spent on dead features:** 558 (4.1% of all 13758 prompts)

**Total commits referencing dead features:** 90

| Feature | Prompts | % of Dead Feature Total |
|---------|---------|------------------------|
| Investor Portal | 151 | 27.1% |
| Trading / Exchange | 112 | 20.1% |
| Telegram Bot | 92 | 16.5% |
| Betting / Prediction Markets | 61 | 10.9% |
| Vault / Concierge / Villa | 56 | 10.0% |
| Shipping Logistics | 28 | 5.0% |
| Twitter/Social Integration | 26 | 4.7% |
| Browser Extension | 24 | 4.3% |
| Mobile-First Approach | 8 | 1.4% |

**Average lifespan of a dead feature:** 106 days

**If these 558 prompts had been spent on the 8 jewels instead:**
That is roughly 69 additional prompts per jewel. Given that the entire YONO vision model was built with ~33 prompts, and the condition spectrometer with ~19, these dead features consumed the equivalent of 16 YONO-scale features worth of attention. The primary cost was not code -- most dead features never got commits -- but cognitive bandwidth: each one occupied planning cycles, design discussions, and architectural imagination that could have deepened the core platform.

## Summary Statistics

- Dead features tracked: 9
- Total prompts analyzed: 13758
- Total commits analyzed: 2045
- Date range: 2025-10-21 to 2026-03-10
- Triage date: 2026-03-07
- Features with zero prompts: 0
- Features killed by triage deletion: 5
- Features that were never built (0 commits): 3
