# Session Archetypes: The 8 Types of Work Session

> "The same person builds cathedrals and sets fires, often in the same afternoon."

## Overview

| Archetype | Count | % | Avg Prompts | Avg Duration | Avg Commits | Avg Frustration |
|-----------|-------|---|------------|-------------|-------------|-----------------|
| Abandoned | 100 | 18.5% | 1.3 | 0m | 0.5 | 9.5% |
| Quick Fix | 41 | 7.6% | 5.1 | 16m | 2.1 | 11.9% |
| Debug Spiral | 7 | 1.3% | 18.7 | 1h49m | 0.0 | 35.9% |
| Deep Build | 13 | 2.4% | 63.5 | 4h17m | 20.0 | 9.7% |
| Triage | 2 | 0.4% | 481.5 | 18h12m | 64.0 | 7.7% |
| Design | 78 | 14.4% | 33.6 | 2h46m | 4.2 | 5.6% |
| Exploration | 119 | 22.0% | 28.1 | 1h48m | 0.0 | 9.2% |
| Standard Work | 181 | 33.5% | 29.6 | 2h18m | 5.1 | 11.3% |

**541 sessions** spanning **13,574 prompts** over **965 hours** of active work with **1770 commits**.

## Archetype Profiles

### 1. Abandoned (100 sessions, 18.5%)

**Signature:** 1 prompts, 0m avg duration, 0.5 commits, 9.5% frustration, 0.82 focus score

**Typical domains:** data (28), meta (25), ui (15), infra (10), ops (8)

**Behavioral markers:** long-form prompts; laser-focused on one domain

**Example session:** 2026-01-28 00:53 (0m, 1 prompts, 0 commits)
> I need a comprehensive understanding of the source intelligence and extraction infrastructure in this codebase.   Focus...

### 2. Quick Fix (41 sessions, 7.6%)

**Signature:** 5 prompts, 16m avg duration, 2.1 commits, 11.9% frustration, 0.22 focus score

**Typical domains:** ui (12), infra (9), meta (8), data (5), social (3)

**Behavioral markers:** high domain-switching

**Example session:** 2026-01-24 12:31 (23m, 4 prompts, 2 commits)
> https://bringatrailer.com/listing/2023-porsche-911-gt3-touring-44/ https://n-zero.dev/vehicle/1c5adc16-0133-4c71-af9d-91...

### 3. Debug Spiral (7 sessions, 1.3%)

**Signature:** 19 prompts, 1h49m avg duration, 0.0 commits, 35.9% frustration, 0.28 focus score

**Typical domains:** ui (3), meta (2), personal (1), data (1)

**Behavioral markers:** high domain-switching

**Example session:** 2026-03-09 23:29 (59m, 15 prompts, 0 commits)
> I need to find evidence of "generative-looking" AI-generated UI patterns in the Nuke frontend codebase at /Users/skylar/...

### 4. Deep Build (13 sessions, 2.4%)

**Signature:** 63 prompts, 4h17m avg duration, 20.0 commits, 9.7% frustration, 0.36 focus score

**Typical domains:** data (4), infra (4), ui (2), meta (2), ops (1)

**Behavioral markers:** heavy markdown/structured input

**Example session:** 2025-12-16 14:34 (4h48m, 58 prompts, 8 commits)
> price logic of functions not accurate https://bringatrailer.com/listing/1971-chevrolet-chevelle-ss-454-15/  https://n-ze...

### 5. Triage (2 sessions, 0.4%)

**Signature:** 482 prompts, 18h12m avg duration, 64.0 commits, 7.7% frustration, 0.31 focus score

**Typical domains:** infra (2)

**Example session:** 2026-02-26 11:27 (31h55m, 905 prompts, 128 commits)
> Run a thorough audit on the 1983 GMC K2500 Sierra Classic (vehicle_id: `a90c008a-3379-41d8-9eb2-b4eda365d74c`) in Supaba...

### 6. Design (78 sessions, 14.4%)

**Signature:** 34 prompts, 2h46m avg duration, 4.2 commits, 5.6% frustration, 0.17 focus score

**Typical domains:** ui (78)

**Behavioral markers:** long-form prompts; high domain-switching

**Example session:** 2026-03-04 12:03 (2h19m, 18 prompts, 2 commits)
> they are data of vehicles is the problem. they essential can occupy a vehicle profile and eventually when we scrape the...

### 7. Exploration (119 sessions, 22.0%)

**Signature:** 28 prompts, 1h48m avg duration, 0.0 commits, 9.2% frustration, 0.19 focus score

**Typical domains:** meta (72), data (22), infra (10), ui (6), ops (3)

**Behavioral markers:** long-form prompts; high domain-switching

**Example session:** 2026-01-31 13:35 (44m, 16 prompts, 0 commits)
> status? running on cloud?

### 8. Standard Work (181 sessions, 33.5%)

**Signature:** 30 prompts, 2h18m avg duration, 5.1 commits, 11.3% frustration, 0.23 focus score

**Typical domains:** meta (67), data (48), ui (32), infra (14), ops (10)

**Behavioral markers:** long-form prompts; high domain-switching

**Example session:** 2025-12-04 19:23 (1h21m, 11 prompts, 5 commits)
> https://n-zero.dev/vehicle/fa0a1754-90f3-4d53-b77e-86ffbe6909ac  why doesnt this one have timeline? how are we supposed...

## Archetype Transitions

What type of session follows what (same-day sequences):

| After ↓ / Before → | Abandoned | Quick Fix | Debug | Build | Triage | Design | Explore | Standard |
|---|---|---|---|---|---|---|---|---|
| Abandoned | 19 | 5 | - | 2 | - | 8 | 14 | 24 |
| Quick Fix | 7 | 3 | - | - | - | 6 | 5 | 11 |
| Debug | 1 | - | - | - | - | - | 1 | 2 |
| Build | 2 | - | - | 1 | - | - | 4 | 6 |
| Triage | - | - | - | - | - | - | 2 | - |
| Design | 10 | 11 | - | - | - | 15 | 13 | 10 |
| Explore | 22 | 3 | 3 | - | - | 10 | 25 | 32 |
| Standard | 26 | 11 | 2 | 5 | - | 13 | 33 | 42 |

### Common Sequences

1. **Standard Work → Standard Work** (42 times)
2. **Exploration → Standard Work** (33 times)
3. **Standard Work → Exploration** (32 times)
4. **Abandoned → Standard Work** (26 times)
5. **Exploration → Exploration** (25 times)
6. **Standard Work → Abandoned** (24 times)
7. **Abandoned → Exploration** (22 times)
8. **Abandoned → Abandoned** (19 times)
9. **Design → Design** (15 times)
10. **Exploration → Abandoned** (14 times)

### Common 3-Session Sequences

1. **Standard Work → Abandoned → Standard Work** (10 times)
2. **Exploration → Exploration → Exploration** (10 times)
3. **Exploration → Standard Work → Standard Work** (9 times)
4. **Standard Work → Standard Work → Standard Work** (9 times)
5. **Standard Work → Exploration → Standard Work** (9 times)

## When Do You Do What?

| Archetype | Peak Hours | Peak Day |
|-----------|-----------|---------|
| Abandoned | 12AM, 2PM, 2AM | Tue |
| Quick Fix | 12PM, 3PM, 11PM | Sat |
| Debug Spiral | 4AM, 11PM, 1AM | Mon |
| Deep Build | 10PM, 3PM, 2PM | Tue |
| Triage | 11PM, 11AM | Thu |
| Design | 4PM, 1PM, 8PM | Wed |
| Exploration | 7AM, 2PM, 1AM | Wed |
| Standard Work | 4PM, 1PM, 3PM | Tue |

### Hourly Heat Map

Sessions starting at each hour (24h):

| Archetype | 00 | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Abandoned | 8 | 4 | 7 | 4 | 6 | 2 | 1 | 1 | 2 | 1 | 2 | 2 | 4 | 4 | 7 | 4 | 5 | 4 | 6 | 5 | 6 | 4 | 6 | 5 |
| Quick Fix | 1 | 4 | 2 | . | . | . | . | 1 | . | . | . | 1 | 4 | 3 | 2 | 4 | 2 | 1 | 3 | 2 | 4 | 2 | 1 | 4 |
| Debug | . | 1 | . | . | 2 | . | . | . | . | . | . | . | 1 | 1 | . | . | . | . | . | . | . | . | . | 2 |
| Build | . | . | 1 | . | . | . | . | . | . | . | . | 2 | 1 | . | 2 | 2 | . | . | . | 1 | 1 | . | 3 | . |
| Triage | . | . | . | . | . | . | . | . | . | . | . | 1 | . | . | . | . | . | . | . | . | . | . | . | 1 |
| Design | 5 | 3 | 4 | 2 | 2 | 2 | 1 | 2 | 1 | 1 | 2 | 3 | 4 | 7 | 3 | 2 | 7 | 3 | 4 | 1 | 7 | 3 | 4 | 5 |
| Explore | 5 | 8 | 1 | 2 | 6 | 4 | 4 | 9 | 5 | 3 | 3 | 5 | 6 | 6 | 8 | 3 | 5 | 7 | 6 | 4 | 7 | 5 | 4 | 3 |
| Standard | 9 | 8 | 11 | 8 | 4 | 5 | 4 | 1 | . | 3 | 3 | 5 | 7 | 15 | 6 | 13 | 19 | 6 | 7 | 9 | 7 | 10 | 11 | 10 |

## Archetypes by Era

| Month | Abandoned | Quick Fix | Debug | Build | Triage | Design | Explore | Standard | Total |
|---|---|---|---|---|---|---|---|---|---|
| Oct 25 | 6 (21%) | 6 (21%) | 0 (0%) | 1 (3%) | 0 (0%) | 3 (10%) | 0 (0%) | 13 (45%) | 29 |
| Nov 25 | 13 (15%) | 2 (2%) | 2 (2%) | 0 (0%) | 1 (1%) | 18 (21%) | 25 (29%) | 25 (29%) | 86 |
| Dec 25 | 16 (15%) | 10 (9%) | 0 (0%) | 3 (3%) | 0 (0%) | 21 (19%) | 14 (13%) | 44 (41%) | 108 |
| Jan 26 | 33 (28%) | 9 (8%) | 1 (1%) | 2 (2%) | 0 (0%) | 10 (8%) | 27 (23%) | 36 (31%) | 118 |
| Feb 26 | 24 (17%) | 7 (5%) | 1 (1%) | 6 (4%) | 1 (1%) | 14 (10%) | 40 (29%) | 46 (33%) | 139 |
| Mar 26 | 8 (13%) | 7 (11%) | 3 (5%) | 1 (2%) | 0 (0%) | 12 (20%) | 13 (21%) | 17 (28%) | 61 |

### The Arc

The earliest months (2025-10, 2025-11) averaged 58 sessions/month. The latest months (2026-02, 2026-03) averaged 100 sessions/month.

Key shifts over time: **Exploration** increased from 15% to 25%; **Standard Work** decreased from 37% to 30%.

Over 140 days, that's **3.9 sessions per day** on average. The most active day had 10 sessions.

Average session duration shifted from 1h51m (early) to 1h53m (late). Average prompts per session went from 20.8 to 33.1. The platform matured from exploration and design into operational maintenance and deep builds.

## The Ideal Week

Sessions that produce the most commits per prompt are **Quick Fix** (0.41 commits/prompt).
Sessions with the lowest frustration are **Design** (5.6% avg frustration rate).

The highest-frustration archetype is **Debug Spiral** at 35.9%. These sessions are where time goes to die.

**If you could design your week:**
- Deep builds naturally cluster around 22:00 -- protect these hours
- Debug spirals peak at 4:00 -- maybe don't start new work then
- Quick Fixes are your most efficient archetype by commit output -- batch them
- Abandoned sessions (100 total) represent false starts; consider keeping a 'next actions' list to reduce cold-start friction
- The data shows 119 exploration sessions with zero commits -- these are research. Schedule them deliberately rather than stumbling into them.

