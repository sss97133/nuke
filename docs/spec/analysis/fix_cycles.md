# Fix Cycle Analysis

How many prompts does it take to resolve a bug?

**1385 fix cycles** detected across all sessions

- Avg cycle length: 2.2 prompts
- Median: 1
- Max: 52 (session 397)

## Fix Cycles by Bug Domain

| Domain | Cycles | Avg Length | Median | Max |
|--------|--------|-----------|--------|-----|
| general | 316 | 2.0 | 1 | 14 |
| data | 239 | 2.0 | 1 | 17 |
| pasted | 139 | 2.7 | 2 | 15 |
| infra | 122 | 2.6 | 1 | 49 |
| agents | 113 | 2.4 | 1 | 26 |
| social | 101 | 2.0 | 1 | 9 |
| ui | 96 | 2.0 | 1 | 11 |
| vision | 82 | 2.7 | 1 | 52 |
| config | 53 | 1.8 | 1 | 6 |
| personal | 45 | 2.0 | 1 | 5 |
| convo | 18 | 1.5 | 1 | 3 |
| yono | 17 | 1.9 | 1 | 5 |
| vehicles | 9 | 1.4 | 1 | 3 |
| ralph | 9 | 1.0 | 1 | 1 |
| business | 8 | 1.9 | 2 | 3 |
| photos | 8 | 2.9 | 2 | 10 |
| uncategorized | 5 | 2.0 | 1 | 5 |
| tool | 3 | 1.3 | 1 | 2 |
| hardware | 2 | 4.0 | 4 | 6 |

## Cycle Length Distribution

| Length | Count | % |
|--------|-------|---|
| 1-2 (quick fix) | 1008 | 72.8% |
| 3-5 | 303 | 21.9% |
| 6-10 | 62 | 4.5% |
| 11-20 (hard bug) | 8 | 0.6% |
| 21-50 (death spiral) | 3 | 0.2% |
| 50+ (crisis) | 1 | 0.1% |