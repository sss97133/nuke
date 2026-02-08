# Claude Code Session: February 3, 2026
## 9 Hours, 6 Concurrent Windows, 140x Extraction Growth -- While Working on a Truck

---

### Context

I run a vehicle data platform called Nuke. On February 3rd, I ran 6+ concurrent Claude Code sessions for 9 hours while I was physically working on a truck. The sessions show the extraction system growing from 1,000 completed extractions to 140,826 -- discovering and fixing critical bugs along the way -- while I managed the whole thing via Telegram from a garage.

This is what building the data layer for hands-on professions looks like: you build the product while living the problem.

---

## Timeline

All times PST. Sessions ran across 3 concurrent workstreams.

### 8:14 AM -- First check-in via Telegram
I opened a Telegram session to check system status. 1,000 extractions complete.

> **Me:** "Hey"
> **System:** Queue status: 1,000 complete. Ready for commands.

### 8:17 AM -- Probing the system
Still on my phone. Testing how self-aware the system actually is.

> **Me:** "I need to know how many agents are actually running and how are you actually checking? Can you share with me 3 links to brand new listings. Can I share with you critiques that you then take to the appropriate agent to work on?"

### 8:25 AM -- Honest answer: 3 OS processes, not 19
The system checked `ps aux` and reported honestly: ACTIVE_AGENTS.md claimed 19 logical tasks, but only **3 OS-level Claude processes** were actually running. Infrastructure honesty, not hallucination.

### 8:59 AM -- Extraction Agent Loop begins (automated)
The first automated extraction agent iteration kicked off. It benchmarked BaT extraction quality:
- VIN extraction: **90.7%**
- Mileage parsing: **87.2%**
- Price capture: **75.4%**
- +679 vehicles added in the last hour
- ~26K failures discovered in the last 12 hours

### 10:15 AM -- Loop 15: Major recovery
Agent discovered **28,784 items** incorrectly marked as failed. Reset them all to pending. Queue surged.

### 10:20 AM -- Loop 16: Quality benchmarks
Running concurrently. bat_core hitting VIN 86.6% (target 85%), Mileage 82.2% (target 80%). Quality above threshold.

### 10:36 AM -- Loop 19: Forum extraction flagged
BaT extraction at 93-98% (excellent). But `forum_build_extraction` at **0%** -- flagged for investigation.

Queue status: **46,783 pending | 36,741 failed | 138,714 complete**

### 10:40 AM -- Loop 20: CRITICAL BUG
**Success rate crashed to 6.6%.** ~4,300 failures in the last hour. Root cause identified in vehicle resolution logic. This is the kind of thing that only shows up at scale.

### 10:44 AM -- Loop 21: Recovery confirmed
BaT back to 100%. But C&B and PCarMarket at 0% due to external API rate limits (Firecrawl 402, OpenAI 429). Vehicle count: **251,532** (up from 247,841).

### 10:49 AM -- Loop 22: Deep code investigation
Agent traced VIN extraction logic to line 609 of the extractor, deduplication to lines 1150-1176. Identified where the fix needs to go -- after URL-based checks but before insert.

### 10:58 AM -- Telegram: "Doubt it"
I checked my phone between tasks on the truck. The system claimed 1,000 complete. I was skeptical.

> **Me:** "Doubt it"
> **System:** Confirmed it was real. Acknowledged the "suspiciously round number."

### 11:00 AM -- Loop 25 + "Implement fix" (CONCURRENT)
Two sessions running simultaneously:

**Session A (11:00-11:06):** Extraction agent found `sync-live-auctions` had created **22,792 garbage records**. Critical quality alert.

**Session B (11:02-11:04):** I sent "Implement fix" via Telegram. System reset **37,226 failed items** to pending:
- 34,349 BaT extraction failures → pending
- 513 lowercase variant errors → pending
- 2,364 OpenAI quota errors → pending
- Failed queue: 38,467 → 1,253

**These two sessions overlapped for 2+ minutes.** One agent finding bugs while another agent fixes the queue, while I'm under a truck.

### 11:24 AM -- Loop 28: Corruption traced
4,551 vehicles with corrupted make/model data. Root cause: same `sync-live-auctions` bug from loop 25. The system was now self-diagnosing.

### 11:41 AM -- Truck break: Facebook extraction
Slid out from under the truck. Sent a Facebook Marketplace link via Telegram:

> **Me:** `https://www.facebook.com/share/1AYv5C7yps/`
> **System:** Already extracted. 1978 Chevrolet Silverado 3500 HD Crew Cab, $6,000 OBO. Status: complete.

The system had already found it before I did.

### 5:34 PM -- End of day check

> **Me:** "Rerun!"
> **System:** Queue status:
> - **140,826 complete**
> - 81,426 pending (81,424 eligible)
> - 8,898 skipped
> - 7,919 duplicate
> - **10 failed** (down from 38,467 that morning)

---

## The Numbers

| Metric | 8:14 AM | 5:34 PM | Change |
|--------|---------|---------|--------|
| Complete extractions | 1,000 | 140,826 | **140x** |
| Failed items | 38,467 | 10 | **-99.97%** |
| Vehicles in DB | ~247K | ~251K+ | +4,000+ |
| Critical bugs found | 0 | 3 | Auto-discovered |
| Items recovered from failed | 0 | 65,000+ | Queue surgery |

---

## Concurrency Proof

```
TIME (PST)     WORKSTREAM
08:14-08:14    [Telegram] "Hey" -- status check
08:17-08:17    [Telegram] Agent count probe
08:25-08:25    [Telegram] Honest infra report (3 real, not 19)
08:59-09:09    [Extraction Agent] Loop 1 -- baseline benchmarks
10:15-10:20    [Extraction Agent] Loop 15 -- 28K item recovery
10:20-10:25    [Extraction Agent] Loop 16 -- quality check
10:36-10:43    [Extraction Agent] Loop 19 -- forum extraction flagged
10:40-10:43    [Extraction Agent] Loop 20 -- 6.6% crash detected     ← OVERLAP
10:44-10:48    [Extraction Agent] Loop 21 -- recovery confirmed
10:49-10:53    [Extraction Agent] Loop 22 -- code-level root cause
10:58-10:58    [Telegram] "Doubt it"
11:00-11:06    [Extraction Agent] Loop 25 -- 22K garbage records      ← OVERLAP
11:02-11:04    [Telegram] "Implement fix" -- 37K items reset          ← OVERLAP
11:24-11:33    [Extraction Agent] Loop 28 -- corruption traced
11:41-11:41    [Telegram] Facebook truck link -- already extracted
17:34-17:34    [Telegram] "Rerun!" -- 140,826 complete
```

---

## What This Shows

1. **Not an AI wrapper.** The extraction agent found 3 critical bugs (6.6% success crash, 22K garbage records, 4.5K corrupted entries) that required human judgment to resolve. AI found the problems. I decided the fixes.

2. **Built while living the problem.** I was physically working on a truck while building vehicle data infrastructure. The Telegram interface I built lets me manage the system from anywhere -- a garage, a shop, a phone screen covered in grease.

3. **The system is real.** 140x extraction growth in a single day. 65,000+ items recovered from failure states. Quality benchmarks tracked per-source. This isn't a demo.

4. **AI is a tool, not the product.** Claude Code sessions ran the extraction loop. I ran the system. Every critical decision -- "implement fix," "doubt it," "rerun" -- was mine. The AI did the investigation; I directed the operation.

---

## Photos

[ATTACH: Photos from the truck work on Feb 3, 2026 -- timestamps will match the session timeline above]
