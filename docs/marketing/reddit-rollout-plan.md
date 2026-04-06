# Reddit Product Rollout Plan

Generated 2026-04-04 from research across all 32 target subreddits.

---

## Subreddit Tier Map

### Tier 1 — Primary Launch Channels

| Subreddit | Size | Rules | Angle |
|-----------|------|-------|-------|
| r/webdev | 1.9M | 9:1 ratio, ~100+ karma, Showoff Saturday | Technical deep-dive: MCP protocol, digital twin, vision pipeline |
| r/startups | 1.5-1.9M | 250 char min, no product name in body, Monthly Share thread | Architecture narrative — discover Nuke from profile |
| r/SideProject | 500-650K | Self-promo OK if framed as feedback | Builder story + Loom demo |
| r/SaaS | ~410K | Feedback in weekly pinned thread, no link-only | Case study with real metrics |
| r/indiehackers | 115-151K | ONE post via SHOW IH flair, then member | Lead with number in title, story in body |
| r/buildinpublic | 27-100K | Transparency required, no pure promo | Journey post with metrics, dashboard screenshots |

### Tier 2 — Feedback & Testing

| Subreddit | Size | Rules | Angle |
|-----------|------|-------|-------|
| r/RoastMyStartup | 23K | Must have working product, expect harsh feedback | Pre-launch stress test |
| r/testmyapp | 3.5-10K | Self-promo IS the purpose, specify platform | "[Web] Nuke - AI vehicle search & valuation" |
| r/mvplaunch | <5K | Zero friction, launches are the point | Direct product announcement |
| r/launchmystartup | 3K | Most permissive | Plant the flag |
| r/saasbuild | <5K | Technical focus, building narrative required | Architecture: EAV, pipeline registry, MCP |

### Tier 3 — Strategic / Conditional

| Subreddit | Size | Condition | Angle |
|-----------|------|-----------|-------|
| r/InternetIsBeautiful | 16.6M | Needs free no-signup tool | Link to free vehicle search/valuation widget |
| r/entrepreneur | 4.9M | 10 karma in-sub, promo Thursday only | Founder journey in "unsexy" vertical |
| r/chrome_extensions | 15K | Only if Chrome extension ships | Vehicle data overlay on listing sites |
| r/SelfHosted | 300-350K | Only if self-hostable component (Docker) | "Self-host your vehicle intelligence MCP server" |
| r/thefounders | 5-25K | Strict no-promo, lead with struggle | Candid post about a hard architectural decision |
| r/scaleinpublic | Small | Need real traction metrics first | Monthly growth updates post-launch |
| r/ProductHunters | 28K | Coordinate with PH launch day | Cross-promote PH listing |
| r/GrowthHacking | 65-118K | Need data on growth experiment | "How MCP integration became our distribution channel" |
| r/Startup_Ideas | 100-178K | Idea validation, not product pitch | "Collector car market has no unified data layer — would you pay?" |
| r/growmybusiness | 47-65K | Title must contain '?' or 'feedback' | "Growth channels for niche automotive data platform? [feedback]" |

### Tier 4 — Low Priority / Skip

| Subreddit | Size | Why |
|-----------|------|-----|
| r/digitalnomad | 2.2M | Strict no-promo, long-game organic comments only |
| r/smallbusiness | 1.5-2.2M | Brick-and-mortar audience, no self-promo |
| r/iOSApps | 12-76K | Only if iOS app exists |
| r/AndroidApps | 311K | Only if Android app exists |
| r/AskMarketing | 55-70K | Q&A format, pre-launch research only |
| r/IMadeThis | 16-19K | Broad maker community, weak fit |
| r/ShowMeYourSaaS | <5K | Tiny; consider their website/YouTube instead |
| r/indiebiz | 10K | Permissive but very small |
| r/SEO | 251-445K | Wrong audience |
| r/ProductivityApps | 12.5K | Not a productivity app |
| r/macapps | 172K | Only if native Mac app |

---

## Product-to-Subreddit Matrix

| Product | Best Subreddits | Framing |
|---------|----------------|---------|
| MCP Server | r/webdev, r/SelfHosted, r/saasbuild, r/startups | "Any AI agent can query 1.25M vehicles" |
| Vehicle Search | r/InternetIsBeautiful, r/SideProject, r/testmyapp | Free public tool, visual, no-signup |
| Nuke Estimate | r/InternetIsBeautiful, r/SideProject, r/buildinpublic | "What's my car worth" free estimator |
| Auction Readiness | r/SaaS, r/indiehackers, r/buildinpublic | SaaS feature story with conversion metrics |
| YONO (vision) | r/webdev, r/startups, r/saasbuild | 41-zone classification, condition scoring |
| Chrome Extension | r/chrome_extensions, r/webdev, r/testmyapp | "See Nuke valuations on any listing as you browse" |
| Digital Twin | r/startups, r/thefounders, r/webdev | Architecture/ontology, most intellectual angle |

---

## Rollout Timeline

### Phase 0 — Karma Building (Weeks -3 to -1)
- Comment genuinely on r/webdev, r/startups, r/entrepreneur, r/SaaS
- Answer questions, share insights, build to 100+ karma
- 95/5 rule: 95% value, 5% product

### Phase 1 — Soft Launch / Feedback (Week 1)
- r/RoastMyStartup — stress-test messaging
- r/Startup_Ideas — validate positioning
- r/testmyapp — recruit early testers
- Incorporate feedback before main push

### Phase 2 — Launch Day Blitz (Week 2)
- r/indiehackers (SHOW IH — one shot)
- r/SideProject (builder story + demo video)
- r/buildinpublic (journey post with metrics)
- r/mvplaunch + r/launchmystartup (direct announcements)
- Coordinate with Product Hunt → r/ProductHunters

### Phase 3 — Technical Depth (Weeks 3-4)
- r/webdev — MCP server / architecture deep-dive
- r/startups Monthly Share thread — direct promo
- r/SaaS — case study post
- r/saasbuild — technical architecture breakdown
- r/thefounders — candid founder reflection

### Phase 4 — Growth & Conditional (Weeks 5-8)
- r/InternetIsBeautiful — deploy free no-signup vehicle search tool first
- r/entrepreneur Thursday thread
- r/GrowthHacking — write up what worked from Phase 2
- r/scaleinpublic — early traction metrics
- r/growmybusiness — growth channel advice with real data
- r/chrome_extensions — if extension ships

### Phase 5 — Long Game (Ongoing)
- r/digitalnomad, r/smallbusiness — organic participation only
- r/SelfHosted — when Docker deployment exists

---

## Universal Rules

1. Never reuse the same post text across subreddits (Reddit flags cross-posted identical content)
2. Engage in every comment thread on your posts within first 2 hours
3. Lead with story/problem/question, never the product
4. Different content for each sub: architecture for r/webdev, journey for r/buildinpublic, metrics for r/indiehackers
5. Never lead with VIN decode
6. No AI-generated content (r/entrepreneur permabans for this)
