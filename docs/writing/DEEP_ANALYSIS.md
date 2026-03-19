# Deep Analysis: 13,758 Prompts × 2,045 Commits × 141 Days

> **v3 update (Mar 9)**: Added 95 prompts from Perplexity (16), Cursor CLI prompt_history (77), Cursor agent export (2). Total sources: Claude Code, Cursor (bubbleId + transcripts + CLI + export), Perplexity.

## The Numbers

| Metric | Value | What it means |
|--------|-------|--------------|
| Sessions | 541 | 45-min gap threshold |
| Median session | 9 prompts, 68 min | Your typical work block |
| Longest session | 905 prompts, 31.9 hrs | Feb 26-27, infra/database marathon |
| Prompts per commit | 6.6 | Every commit takes ~7 prompts to produce |
| Sessions with 0 commits | 275 (51%) | Half your sessions produce no code |
| Spinning sessions | 94 (>15 prompts, <2 commits) | 17% of sessions are pure churn |
| Frustrated prompts | 2,365 (17.3%) | 1 in 6 prompts contains frustration |
| Marathon sessions (>4hr) | 76 (14%) | You regularly work 8-14 hour blocks |

---

## Top 10 Findings

### 1. You almost never achieve flow state
**2 out of 360 sessions** (0.6%) reached focus ≥ 0.8. **331 sessions (92%)** are thrashing — switching between domains every 1-2 prompts. This is structural: prompts touch 3+ categories on average, so every prompt is a context switch. The work is inherently multi-domain.

### 2. Half your sessions produce zero commits
275 out of 541 sessions (51%) have no git commits within ±30 minutes. These aren't all unproductive — some are research, planning, or database-only work — but it means half your AI time produces no trackable code output.

### 3. infra/database is the stickiest category
Self-transition rate of `infra/database → infra/database`: 384 occurrences, the highest by far. When you start database work, you stay in database work. This is where you focus the longest. Compare: `ui/general → ui/general` only 67.

### 4. The meta↔data loop is the dominant workflow
Top transitions: meta→meta (794), data→data (680), data↔meta (835 combined), meta↔ops (520 combined). You spend your time switching between thinking about data, working on data, and debugging data. UI is an afterthought in the transition graph.

### 5. Frustration is uniformly distributed (no exhaustion curve)
Frustration rate barely changes across session quarters: Q1=17.1%, Q2=18.9%, Q3=16.4%, Q4=17.3%. You don't get more frustrated later in a session — you're equally frustrated throughout. This means frustration is triggered by the work, not by fatigue.

### 6. Sundays are the angriest day
Frustration by day: Sun 19.1%, Fri 18.8%, Tue 17.3%. Weekends show higher frustration than weekdays, suggesting weekend work is more chaotic or ambitious. You work every day — Saturday has the 2nd most prompts (2,386).

### 7. Prompts are getting dramatically more structured
Oct 2025: 3% structured, 14% terse, median 59 chars. Mar 2026: 41% structured, 6% terse, median 241 chars. You've gone from typing quick commands to writing formatted specifications with markdown, numbered lists, and code blocks. Claude Code sessions are 34% structured vs Cursor at 4%.

### 8. Stalled days are a Cursor-era pattern
10 of 12 stalled days (>40 prompts, <5 commits) are before Jan 2026 — the Cursor period. Nov 1 (159 prompts, 0 commits), Nov 28 (104 prompts, 0 commits), Dec 7 (177 prompts, 0 commits). Claude Code sessions convert prompts to commits more reliably.

### 9. Fix cycles are mostly quick (73% resolved in 1-2 prompts)
1,385 fix cycles detected. 73% resolve in 1-2 prompts, 22% take 3-5. Only 12 bugs (0.9%) are "death spirals" (>10 prompts). Infra bugs have the longest max (49 prompts), vision bugs the absolute longest (52). Most debugging is fast — the few long ones are architecture problems.

### 10. The Feb 26-27 session was singular
905 prompts over 31.9 hours straight. 128 commits. Dominant category: infra/database. This single session contains 6.7% of all prompts in the dataset. It produced more commits than most entire weeks. This was the triage/cleanup marathon.

---

## Session Profile

| Type | Count | % | Avg Prompts | Characteristic |
|------|-------|---|------------|----------------|
| Single prompt | 78 | 14.4% | 1 | Quick check-ins |
| Short (<30min) | 130 | 24.0% | ~5 | Quick tasks, deploys |
| Medium (30min-2hr) | 182 | 33.6% | ~15 | Standard work blocks |
| Long (2-8hr) | 136 | 25.1% | ~45 | Deep work sessions |
| Marathon (8hr+) | 12 | 2.2% | ~170 | Multi-day sprints |

**Your typical session**: 9 prompts over 68 minutes, touching 4+ domains, producing 0-3 commits. You work all 7 days, starting between 6-10 AM PDT, with sessions running until midnight or later.

---

## Tool Comparison: How You Use Each

| Metric | Cursor | Claude Code |
|--------|--------|-------------|
| Sessions | 316 | 225 |
| Avg focus score | 0.19 | 0.21 |
| Avg prompt length | 592 chars | 640 chars |
| Structured prompts | 4% | 34% |
| Terse prompts | 10% | 8% |
| Code paste rate | 15% | 18% |

Claude Code sessions are slightly more focused, much more structured, and produce more commits per prompt. The transition to Claude Code in January marked a shift from conversational to specification-oriented prompting.

---

## Detail Reports

- [sessions.md](sessions.md) — Session structure, marathon sessions, day-of-week patterns
- [temporal.md](temporal.md) — When you work (hour × day heatmaps)
- [transitions.md](transitions.md) — Category flow chains, domain stickiness
- [fix_cycles.md](fix_cycles.md) — Bug resolution patterns by domain
- [git_correlation.md](git_correlation.md) — Productive vs spinning sessions, stalled days
- [sophistication.md](sophistication.md) — Prompt evolution over time
- [emotional_arc.md](emotional_arc.md) — Frustration mapping, exhaustion curve
- [focus.md](focus.md) — Context switching, flow state analysis
- [feature_lifecycle.md](feature_lifecycle.md) — Rising, declining, dead categories
- [dependency_graph.md](dependency_graph.md) — Category co-occurrence clusters

## Data Sources (v3)

| Source | Tool | Prompts | Extraction Method |
|--------|------|---------|-------------------|
| Claude Code | claude-code | 7,151 | sessions-index.json |
| Cursor (bubbleId) | cursor | 6,333 | state.vscdb SQLite, type:1 |
| Cursor (transcripts) | cursor | 179 | agent-transcripts/*.jsonl |
| Cursor CLI | cursor-cli | 77 | prompt_history.json + transcripts |
| Perplexity | perplexity-web | 16 | perplexity.rtf (TextEdit) |
| Cursor export | cursor | 2 | all_conversations.csv (agentKv blobs) |
| **Total** | | **13,758** | After dedup by MD5 fingerprint |

### Sources searched but not extractable

| Source | Status | Why |
|--------|--------|-----|
| Windsurf | 34 encrypted .pb files | OpenPGP encryption, no key available |
| Lovable | Chrome IndexedDB (92 KB) | Binary LevelDB, minimal content |
| Claude Desktop (web) | IndexedDB + blobs (9.3 MB) | Binary LevelDB, would need parser |
| Perplexity (full threads) | Only 1 of 11 threads preserved in RTF | Other threads are title-only in the archive |

## Methodology

- Session gap threshold: 45 minutes
- Commit correlation window: ±30 minutes
- Frustration lexicon: 22 terms, 2 tiers (profanity + contextual)
- Text analysis cap: 500 chars (avoids pasted blob false positives)
- Timezone: UTC-7 (PDT approximation) for local time rendering
- Focus score: 1 - (domain_transitions / prompt_count). ≥0.8 = flow, <0.4 = thrashing
- All analysis uses Python stdlib only
- Deduplication: MD5 on lowercased, whitespace-collapsed text
