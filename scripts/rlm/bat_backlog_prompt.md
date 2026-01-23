# Ralph Wiggum - BaT Backlog Loop

## Mission
Discover and queue all **not-yet-scraped** Bring a Trailer listing URLs.
Target scale: **~223k listings**.

## Constraints
- **Firecrawl budget cap: 30k credits**.
- Prefer **BaT API + Wayback CDX** (free) over Firecrawl.
- Avoid schema changes; operate via existing edge functions and queues.

## Core Loop
1. Run `bat-full-archive-crawler` (API discovery).
2. Run `bat-wayback-crawler` (Wayback CDX discovery).
3. Track `import_queue` counts for BaT listing URLs.
4. When discovery slows (<1% new URLs for 3 runs), pause discovery and focus on draining the queue.

## Success Metrics
- `import_queue` BaT total >= 223,000
- Discovery yields per run are stable (no spikes or regressions)
- Low Firecrawl usage

## Safety
- Do not call Firecrawl-heavy functions unless absolutely required.
- Log all discovery counts and queue stats.
