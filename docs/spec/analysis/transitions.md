# Category Transition Analysis

What follows what? Within sessions, consecutive prompt category transitions.

## Top 30 Domain Transitions

| From | To | Count | Direction |
|------|-----|-------|-----------|
| meta | meta | 794 | self |
| data | data | 680 | self |
| data | meta | 425 | switch |
| meta | data | 410 | switch |
| meta | ops | 263 | switch |
| ops | meta | 257 | switch |
| data | ops | 236 | switch |
| ops | ops | 227 | self |
| ops | data | 224 | switch |
| pasted | pasted | 206 | self |
| meta | infra | 179 | switch |
| meta | ui | 177 | switch |
| ui | meta | 176 | switch |
| infra | meta | 170 | switch |
| infra | data | 150 | switch |
| agents | meta | 149 | switch |
| ui | data | 145 | switch |
| vision | meta | 139 | switch |
| meta | agents | 133 | switch |
| data | infra | 132 | switch |
| vision | data | 132 | switch |
| data | vision | 131 | switch |
| data | agents | 130 | switch |
| data | ui | 129 | switch |
| meta | social | 127 | switch |
| meta | uncategorized | 126 | switch |
| data | pasted | 125 | switch |
| meta | vision | 124 | switch |
| pasted | data | 123 | switch |
| ui | ui | 120 | self |

## Top 30 Category Transitions

| From | To | Count |
|------|-----|-------|
| infra/database | infra/database | 384 |
| pasted/code | pasted/code | 103 |
| data/extraction | data/extraction | 88 |
| ui/general | infra/database | 85 |
| infra/database | ui/general | 77 |
| pasted/code | infra/database | 73 |
| meta/docs | infra/database | 72 |
| ui/general | ui/general | 67 |
| personal/frust | personal/frust | 63 |
| infra/database | pasted/code | 55 |
| infra/database | meta/docs | 53 |
| infra/database | ui/search | 51 |
| ui/search | infra/database | 50 |
| ui/garage | ui/garage | 49 |
| data/extraction | infra/database | 45 |
| infra/database | ui/garage | 44 |
| infra/database | data/extraction | 44 |
| meta/docs | meta/docs | 43 |
| personal/frust | data/extraction | 42 |
| personal/frust | infra/database | 41 |
| ui/garage | infra/database | 41 |
| infra/database | personal/frust | 39 |
| data/extraction | personal/frust | 39 |
| uncategorized | uncategorized | 38 |
| data/extraction | uncategorized | 31 |
| infra/database | yono/condition | 30 |
| yono/condition | infra/database | 30 |
| ui/general | personal/frust | 28 |
| uncategorized | infra/database | 28 |
| uncategorized | data/extraction | 28 |

## Domain Stickiness (self-transition rate)

High = you stay in this domain once you start. Low = you bounce away quickly.

| Domain | Self-transitions | Total from | Stickiness |
|--------|-----------------|------------|-----------|
| pasted | 206 | 712 | 28.9% |
| meta | 794 | 2760 | 28.8% |
| data | 680 | 2394 | 28.4% |
| ops | 227 | 1321 | 17.2% |
| agents | 119 | 749 | 15.9% |
| vision | 112 | 705 | 15.9% |
| ui | 120 | 885 | 13.6% |
| social | 78 | 621 | 12.6% |
| vehicles | 22 | 191 | 11.5% |
| infra | 89 | 842 | 10.6% |
| yono | 8 | 96 | 8.3% |
| uncategorized | 38 | 488 | 7.8% |
| convo | 14 | 184 | 7.6% |
| business | 9 | 121 | 7.4% |
| personal | 29 | 429 | 6.8% |
| hardware | 6 | 89 | 6.7% |
| config | 13 | 221 | 5.9% |
| photos | 2 | 40 | 5.0% |
| tool | 5 | 116 | 4.3% |
| ralph | 1 | 42 | 2.4% |
| product | 0 | 24 | 0.0% |

## Top 20 Three-Step Chains

| Chain | Count |
|-------|-------|
| meta → meta → meta | 244 |
| data → data → data | 241 |
| data → meta → meta | 115 |
| meta → data → data | 103 |
| data → data → meta | 95 |
| meta → data → meta | 90 |
| meta → meta → data | 82 |
| data → meta → data | 82 |
| pasted → pasted → pasted | 79 |
| meta → meta → ops | 78 |
| ops → meta → meta | 72 |
| data → ops → data | 61 |
| meta → meta → infra | 59 |
| meta → ops → meta | 57 |
| data → data → ops | 54 |
| meta → meta → ui | 50 |
| ui → meta → meta | 49 |
| ops → ops → ops | 49 |
| meta → infra → meta | 48 |
| infra → meta → meta | 48 |