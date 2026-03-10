# Git Commit Correlation

- **Overall ratio**: 13571 prompts / 2045 commits = 6.6 prompts per commit
- **Sessions with commits**: 266 / 541
- **Sessions with 0 commits**: 275

## Session Classifications

- **Productive** (commits > 0, <10 prompts/commit): 213 sessions
- **Spinning** (>15 prompts, <2 commits): 94 sessions
- **Flow** (>4 commits, <5 prompts/commit): 68 sessions

## Top 10 Most Productive Sessions

| Session | Prompts | Commits | Ratio | Tool | Domain |
|---------|---------|---------|-------|------|--------|
| 470 | 905 | 128 | 7.1 | claude-code | infra |
| 394 | 67 | 61 | 1.1 | claude-code | infra |
| 418 | 144 | 48 | 3.0 | claude-code | meta |
| 128 | 45 | 44 | 1.0 | cursor | meta |
| 385 | 183 | 44 | 4.2 | claude-code | meta |
| 116 | 66 | 41 | 1.6 | cursor | data |
| 161 | 82 | 40 | 2.0 | cursor | ui |
| 34 | 42 | 39 | 1.1 | cursor | data |
| 397 | 91 | 37 | 2.5 | claude-code | infra |
| 395 | 98 | 36 | 2.7 | claude-code | infra |

## Top 10 Spinning Sessions (most prompts, fewest commits)

| Session | Prompts | Commits | Tool | Domain |
|---------|---------|---------|------|--------|
| 470 | 905 | 128 | claude-code | infra |
| 343 | 457 | 28 | claude-code | meta |
| 86 | 213 | 10 | cursor | meta |
| 385 | 183 | 44 | claude-code | meta |
| 134 | 176 | 14 | cursor | meta |
| 322 | 169 | 10 | claude-code | meta |
| 32 | 159 | 0 | cursor | ui |
| 459 | 146 | 0 | claude-code | meta |
| 477 | 146 | 12 | claude-code | meta |
| 418 | 144 | 48 | claude-code | meta |

## Daily Prompts vs Commits

### Stalled Days (>40 prompts, <5 commits)

| Date | Prompts | Commits | Assessment |
|------|---------|---------|-----------|
| 2025-10-31 | 48 | 0 | Spinning |
| 2025-11-01 | 159 | 0 | Spinning |
| 2025-11-14 | 81 | 0 | Spinning |
| 2025-11-16 | 75 | 1 | Spinning |
| 2025-11-19 | 41 | 1 | Spinning |
| 2025-11-20 | 95 | 0 | Spinning |
| 2025-11-27 | 84 | 0 | Spinning |
| 2025-11-28 | 104 | 0 | Spinning |
| 2025-12-03 | 117 | 2 | Spinning |
| 2025-12-07 | 177 | 0 | Spinning |
| 2026-01-06 | 44 | 3 | Spinning |
| 2026-01-26 | 54 | 1 | Spinning |
| 2026-01-27 | 130 | 1 | Spinning |
| 2026-01-30 | 116 | 2 | Spinning |
| 2026-02-03 | 165 | 0 | Spinning |
| 2026-02-04 | 247 | 4 | Spinning |
| 2026-02-07 | 103 | 0 | Spinning |
| 2026-02-13 | 77 | 0 | Spinning |
| 2026-02-16 | 56 | 0 | Spinning |
| 2026-02-18 | 112 | 0 | Spinning |
| 2026-03-05 | 66 | 2 | Spinning |

### High-Output Days (>15 commits)

| Date | Prompts | Commits | Prompts/Commit |
|------|---------|---------|---------------|
| 2026-02-10 | 241 | 103 | 2.3 |
| 2026-02-27 | 96 | 74 | 1.3 |
| 2026-02-26 | 905 | 65 | 13.9 |
| 2025-12-05 | 80 | 62 | 1.3 |
| 2025-12-20 | 170 | 58 | 2.9 |
| 2026-02-08 | 314 | 57 | 5.5 |
| 2025-12-14 | 211 | 56 | 3.8 |
| 2025-10-18 | 0 | 50 | 0.0 |
| 2026-02-28 | 311 | 50 | 6.2 |
| 2025-10-17 | 0 | 44 | 0.0 |
| 2025-11-02 | 144 | 44 | 3.3 |
| 2025-10-25 | 54 | 43 | 1.3 |
| 2026-02-15 | 81 | 43 | 1.9 |
| 2025-12-01 | 97 | 41 | 2.4 |
| 2026-02-11 | 125 | 40 | 3.1 |
| 2025-10-27 | 59 | 38 | 1.6 |
| 2026-02-12 | 185 | 38 | 4.9 |
| 2025-10-20 | 0 | 37 | 0.0 |
| 2026-02-01 | 106 | 36 | 2.9 |
| 2026-02-17 | 68 | 36 | 1.9 |
| 2026-03-07 | 372 | 34 | 10.9 |
| 2025-10-16 | 0 | 32 | 0.0 |
| 2025-12-19 | 55 | 31 | 1.8 |
| 2025-11-24 | 128 | 30 | 4.3 |
| 2025-12-15 | 86 | 29 | 3.0 |
| 2025-11-25 | 55 | 28 | 2.0 |
| 2026-02-24 | 320 | 27 | 11.9 |
| 2025-12-26 | 121 | 25 | 4.8 |
| 2025-12-11 | 108 | 23 | 4.7 |
| 2026-01-08 | 158 | 23 | 6.9 |
| 2025-10-29 | 24 | 22 | 1.1 |
| 2025-10-26 | 49 | 20 | 2.5 |
| 2025-12-16 | 91 | 19 | 4.8 |
| 2025-11-26 | 96 | 18 | 5.3 |
| 2025-10-21 | 49 | 17 | 2.9 |
| 2025-12-21 | 99 | 17 | 5.8 |
| 2026-02-14 | 301 | 17 | 17.7 |
| 2026-02-25 | 175 | 17 | 10.3 |
| 2025-11-10 | 118 | 16 | 7.4 |
| 2025-12-04 | 68 | 16 | 4.2 |
| 2025-12-06 | 182 | 16 | 11.4 |
| 2026-01-22 | 11 | 16 | 0.7 |
| 2026-01-31 | 575 | 16 | 35.9 |
| 2026-02-05 | 228 | 16 | 14.2 |
| 2026-03-06 | 221 | 16 | 13.8 |
| 2026-03-08 | 178 | 16 | 11.1 |