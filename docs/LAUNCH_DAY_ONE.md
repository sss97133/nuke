# Launch — Day One

> Founder curates this file. Agents build against it. Last updated 2026-06-10.

## The one sentence we launch with

**Search any collector car. Get the answer — price, history, photos, provenance — across 77 sources.**

We do NOT launch the liquidity/brokerage promise. That's the endgame, not the demo.
Day one sells the terminal and the canonical record. Everything a visitor sees must
serve one of the use cases below.

---

## Day-one use cases (in priority order)

Each one is a complete loop: arrive → do the thing → get value → screenshot-able.

### 1. "What's it worth?" — the lookup
A stranger types `1969 Camaro` or `K5 Blazer` into the landing search.
- **Value delivered:** result count, price context, real photos, sold comps — in one screen.
- **Screenshot unit:** the search results page.
- **Today's gap:** results are a list, not an answer. The browse_stats strip exists for
  detected makes — that's the seed of the "answer" layer.

### 2. "Show me the car" — the record
They click a result (or someone shares a vehicle link directly).
- **Value delivered:** the digital entity mirror — photos, timeline, auction history,
  comments, provenance. The page must load fast and look undeniable on a phone.
- **Screenshot unit:** vehicle profile hero + `/showcase/:id` for the cinematic version.

### 3. "Pull this listing in" — the magic trick
They paste a BaT / Craigslist / FB Marketplace URL into search.
- **Value delivered:** we build the record in front of them in ~20 seconds. This is the
  moment that converts skeptics — nobody else does this.
- **Today's gap:** error states when extraction fails need to be graceful, not dead ends.

### 4. "Track my car" — the reason to sign up
They sign in and drop photos / claim a vehicle.
- **Value delivered:** their car becomes a living record; photos auto-analyze and file
  themselves (pipeline now self-healing — branch must be merged first).
- **This is the comeback hook.** Signup should be pitched ONLY at this moment — after
  value, never before (the landing page correctly asks for nothing).

### 5. "Watch the action" — the return visit
Live/ending auctions in the feed, sorted current-first.
- **Value delivered:** a reason to come back tomorrow without owning anything.

---

## The funnel is now measured (first-party, our own DB)

Events land in `app_events` (anonymous, RLS insert-only, 90-day retention).
Signups live in `auth.users`. Vehicle views in `vehicle_views`. No third parties.

| Event | Fired when | Tells us |
|---|---|---|
| `page_view` | every route change | traffic, paths, referrer (channel attribution) |
| `landing_search` | search submitted on landing | front-door activation rate |
| `search_results` | results returned (with `q`, `total`) | what people want; zero-result queries = gap list |
| `url_ingest` | listing URL pasted and extracted | magic-trick usage |
| `client_error` | JS error (sampled) | funnel killers in the wild |

### The questions to ask every morning of launch week

```sql
-- Visitors and activation (yesterday)
SELECT
  count(DISTINCT session_key)                                              AS visitors,
  count(DISTINCT session_key) FILTER (WHERE event = 'search_results')      AS searched,
  count(*) FILTER (WHERE event = 'search_results')                         AS total_searches
FROM app_events WHERE created_at > now() - interval '1 day';

-- Search → vehicle conversion
SELECT count(DISTINCT s.session_key) AS searched,
       count(DISTINCT v.session_key) AS viewed_vehicle
FROM app_events s
LEFT JOIN app_events v
  ON v.session_key = s.session_key AND v.event = 'page_view'
  AND v.path LIKE '/vehicle/%' AND v.created_at > s.created_at
WHERE s.event = 'search_results' AND s.created_at > now() - interval '1 day';

-- Day-2 return rate (sessions seen yesterday AND today)
SELECT count(DISTINCT t.session_key)
FROM app_events t
JOIN app_events y ON y.session_key = t.session_key
  AND y.created_at BETWEEN now() - interval '2 days' AND now() - interval '1 day'
WHERE t.created_at > now() - interval '1 day';

-- What people wanted and didn't get (zero-result queries = the punch list)
SELECT props->>'q' AS query, count(*)
FROM app_events
WHERE event = 'search_results' AND (props->>'total')::int = 0
  AND created_at > now() - interval '1 day'
GROUP BY 1 ORDER BY 2 DESC LIMIT 25;

-- Channel attribution
SELECT referrer, count(DISTINCT session_key)
FROM app_events
WHERE referrer IS NOT NULL AND created_at > now() - interval '1 day'
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

-- Errors hurting real sessions
SELECT props->>'message' AS error, count(*)
FROM app_events
WHERE event = 'client_error' AND created_at > now() - interval '1 day'
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
```

### Success definition (day one)
- ≥ 40% of visitors run a search (activation)
- ≥ 3 searches per searching visitor (the terminal is sticky)
- ≥ 25% of searchers open a vehicle (results are good)
- ≥ 5% day-2 return without any prompt

Ten thousand bounces is a press release. A thousand visitors hitting these numbers
is a launch.

---

## Launch sequence (channels are ammo — two types)

**Repeatable** (spend first, while bugs remain): X threads, IG/TikTok clips,
FB groups, squarebody/FBM communities where the founder has standing.

**One-shot** (spend only when the funnel converts): Show HN, PR push, mailing list.

1. **T-2 days:** merge instrumentation + pipeline branches, apply migrations,
   deploy. Run the morning queries against your own traffic to confirm they work.
2. **T-1 day:** soft drop in 2-3 niche communities (50-200 visitors). Read the
   zero-result and error queries. Fix the top 3 of each.
3. **T-0:** Show HN ("we indexed every collector car sale across 77 sources —
   ask it anything") + X thread with screenshots, same morning. Founder in the
   comments all day — that IS the launch on HN.
4. **T+1 to T+7:** daily — read the queries, fix the top leak, post one piece of
   content from the data itself (weirdest find, biggest price anomaly).
5. **PR team:** only after week-one numbers hold. PR multiplies a working funnel.

## Pre-flight checklist (blockers)

- [ ] Merge `claude/image-pipeline-performance-jqx4h4` (pipeline + perf + analytics)
- [ ] Apply migrations: `20260609000001`, `20260610000001`
- [ ] Redeploy `photo-pipeline-orchestrator`
- [ ] Test the morning queries return rows after a self-visit
- [ ] Landing → search → vehicle on a phone over LTE: < 4s to first result
- [ ] Paste a BaT URL while logged out: graceful, not broken
- [ ] BaT posture decided: attribution visible, takedown contact published
- [ ] Rate limits sane on `universal-search` + extraction functions (one HN
      front page ≈ 20-50k visits in a day, spiky)

## Known leaks (fix in this order, founder curates)

1. Search results page: answer-first layout (stats strip above the list, always)
2. Zero-result queries fall flat — suggest nearest make/model instead of nothing
3. Vehicle profile cold load on mobile (perf branch helps; verify on real phone)
4. Claim-your-vehicle flow incomplete (the signup hook)
