# Session Classifier — Progress

**Total sessions classified: 460**

## Source breakdown

- 63 sessions have top-level JSONLs in `~/.claude/projects/-Users-skylar/` (full transcript available, first-prompt + early turns + deep keyword scan)
- ~382 sessions have only subagent transcripts (main session JSONL was cleaned); topic detected from subagent content fallback
- ~22 sessions seeded from `sessions-index.json` for the older `-Users-skylar-nuke` dir

## Topic counts (primary)

| topic | sessions |
|---|---|
| `platform:nuke_engineering` | 171 |
| `vehicles:other` | 126 |
| `other` | 42 |
| `platform:data_pipelines` | 38 |
| `platform:architecture_design` | 37 |
| `personal:scheduling_and_admin` | 18 |
| `vehicle:k5_blazer_1977` | 16 |
| `vehicle:k2500_1983` | 3 |
| `vehicle:k20_doug_1974` | 2 |
| `finance:invoices_and_collections` | 2 |
| `vehicle:hot_rod_1932` | 2 |
| `vehicle:mustang_1966` | 1 |
| `finance:taxes` | 1 |
| `finance:bookkeeping` | 1 |

## Classification method

| method | sessions |
|---|---|
| `subagent_fallback/firstPrompt_keyword` | 355 |
| `first_5_turns_keyword/firstPrompt_keyword` | 63 |
| `subagent_fallback/no_keyword_match` | 40 |
| `subagent_fallback/empty_session` | 2 |

## Confidence distribution

| band | sessions |
|---|---|
| 0.8+ | 330 |
| 0.6-0.8 | 59 |
| 0.4-0.6 | 29 |
| <0.4 | 42 |

## Vehicle attribution (across primary + secondary)

Sessions that touched each vehicle (vehicle_id appears in `vehicle_ids` array):

| vehicle | sessions touching |
|---|---|
| 1977 K5 Blazer (`e08bf694`) | 52 |
| 1966 Ford Mustang (`83f6f033`) | 33 |
| 1974 K20 Cheyenne (Doug) (`d7adb919`) | 25 |
| 1932 Ford Hot Rod (sold) (`21ee373f`) | 11 |
| 1983 GMC K2500 (Granholm) (`a90c008a`) | 26 |
| 1995 Suburban 2500 (sold) (`1db5daca`) | 9 |
| 1984 K10 (`d47d1c55`) | 7 |

## Output files

- `PROGRESS.md` — this file
- `k5_blazer_1977.md` — priority surface for active K5 build
- `by_topic/*.md` — per-bucket session lists
- `UNCLASSIFIED.md` — sessions with confidence < 0.6, need manual review
- `classifications.json` — raw classifier output
- `ISSUES.md` — file-level read errors

## Substrate location

Per-session rows live in `public.session_topic` in the Nuke DB. Query for a vehicle's session feed:

```sql
SELECT session_id, modified_at, primary_topic, first_prompt
FROM public.session_topic
WHERE '<vehicle_id>' = ANY(vehicle_ids)
ORDER BY modified_at DESC;
```
