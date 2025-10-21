# Mobile Profile AI Guardrails — Implementation Directions

Purpose: Define firmcoded, deterministic scoring shells and backend contracts for mobile user profiles (identity, credibility, availability, CTA, contribution, status) and derived metrics (skills, productivity, reliability, hire-worth, undervaluation) without freeform generative behavior. Optimized for continuity, explainability, and safe tuning.

---

## 1) Principles (Guardrails)
- Deterministic cores: All public metrics are computed by code with explicit formulas/state machines. AI only proposes typed inputs; humans/validators and QC gates decide.
- Evidence-only updates: Scores change only from signed events (jobs, milestones, reviews, payouts, assessments, media QC).
- Monotonic constraints: Define which feature directions cannot decrease/increase a score.
- Continuity: Windowed computation (7/30/90d, lifetime) with EWMA smoothing and per-window delta caps.
- Explainability: Every score returns a short, human-readable “Why this score” with top features and weights.
- Versioned configs: Each metric has a versioned config (vX.Y). Rollouts use dual-run and read-compare.
- Privacy/role gates: Mask/bucket sensitive values unless viewer role allows.

---

## 2) Data Model (Minimum Viable)
Relational (Postgres) for OLTP, Kafka for events, OLAP (ClickHouse/BigQuery) for history. Media features in object storage (S3/GCS).

Tables (simplified):
- users(id PK, handle, name, role, avatar_url, timezone, …)
- profiles(user_id PK FK users, availability_status, accepting_work, last_active_at, …)
- skills(id PK, user_id FK, name, level_hint INT, last_used_at, …)
- inventory_assets(id PK, user_id FK, type, name, verified BOOL, estimated_value NUMERIC, …)
- work_items(id PK, user_id FK, client_id FK, title, status, estimate_hours, payout_cents, started_at, completed_at, …)
- milestones(id PK, work_item_id FK, status, due_at, completed_at, …)
- reviews(id PK, work_item_id FK, rater_id FK, rating NUMERIC, text, created_at, …)
- payouts(id PK, work_item_id FK, amount_cents, status, released_at, …)
- assessments(id PK, user_id FK, skill, assessor_id FK, score NUMERIC, method ENUM, created_at)
- media_assets(id PK, user_id FK, type, url, qc_status ENUM, features JSONB, created_at)
- affiliations(id PK, user_id FK, org, strength NUMERIC, verified BOOL, …)
- metric_snapshots(id PK, user_id FK, version, window ENUM, metric ENUM, value NUMERIC, bands JSONB, attributions JSONB, computed_at)
- score_versions(metric ENUM PK, active_version, config JSONB, created_at)
- anomalies(id PK, user_id FK, metric, window, reason, zscore, created_at)

Indexes: by user_id, by (metric, window), by created_at; partial indexes for active records.

---

## 3) Events (Append-only)
Topic naming: domain streams (e.g., work.events, reviews.events, payouts.events).

Each event:
```json
{
  "eventId": "uuid",
  "ts": "2025-10-19T12:34:56Z",
  "userId": "user_123",
  "type": "work.milestone_completed",
  "source": "app|admin|automation",
  "signature": "hex",
  "payload": { "workItemId": "job_1", "milestoneId": "m1", "dueAt": "...", "completedAt": "..." }
}
```

Required types:
- work.created|accepted|started|milestone_completed|delivered|approved|rejected|cancelled
- review.submitted|updated|flagged
- payout.pending|released|failed
- media.uploaded|qc_passed|qc_failed
- skill.assessed|endorsed|expired
- inventory.added|verified|valued
- availability.updated, presence.live_started|live_ended

Validation: schema registry, signature verification, idempotency by eventId.

---

## 4) Metric Definitions (Deterministic Shells)
Windows: {7d, 30d, 90d, lifetime}. Use per-role baselines.

Notation: Clamp(x, a, b), EWMA(prev, obs, α), Z(x; μ, σ).

### 4.1 Skills Score S (per-skill, then aggregate)
Inputs: assessments (A), endorsements (E), recency (R), media quality (M).

```typescript
interface SkillInputs {
  assessmentsScore: number;   // 0..1
  endorsementsScore: number;  // 0..1 (weighted by endorser credibility)
  recencyScore: number;       // 0..1 (decay by lastUsed)
  mediaQualityScore: number;  // 0..1 (QC + similarity)
}

function computeSkillScore(i: SkillInputs, w = {A:0.45,E:0.2,R:0.15,M:0.2}): number {
  const raw = w.A*i.assessmentsScore + w.E*i.endorsementsScore + w.R*i.recencyScore + w.M*i.mediaQualityScore;
  return Clamp(raw, 0, 1);
}

function aggregateUserSkills(topK: Array<number>, k=5): number {
  const sorted = [...topK].sort((a,b)=>b-a).slice(0, k);
  const diminishing = sorted.map((s, idx) => s * Math.pow(0.85, idx));
  const denom = diminishing.map((_, idx) => Math.pow(0.85, idx)).reduce((a,b)=>a+b,0);
  return denom === 0 ? 0 : Clamp(diminishing.reduce((a,b)=>a+b,0)/denom, 0, 1);
}
```

Monotonic: higher A/E/M never lowers S; recency decay cannot increase S.

### 4.2 Productivity P
Inputs: z-speed (estimated vs actual), throughput (completed per window), uptime (active days / window).

```typescript
function computeProductivity({zSpeed, throughputRate, uptimeRate}: {zSpeed:number; throughputRate:number; uptimeRate:number},
  w={speed:0.45, throughput:0.35, uptime:0.2}): number {
  const speedScore = Clamp(0.5 + 0.5*Clamp(zSpeed, -2, 2)/2, 0, 1);
  const raw = w.speed*speedScore + w.throughput*Clamp(throughputRate,0,1) + w.uptime*Clamp(uptimeRate,0,1);
  return Clamp(raw, 0, 1);
}
```

### 4.3 Reliability R
Inputs: on-time rate (OT), cancel rate (CR), dispute rate (DR), response latency score (RL), acceptance rate (AR).

```typescript
function computeReliability({OT, CR, DR, RL, AR}:{OT:number;CR:number;DR:number;RL:number;AR:number},
  w={ot:0.4, cr:0.2, dr:0.2, rl:0.1, ar:0.1}): number {
  // invert harmful rates
  const crScore = 1 - Clamp(CR, 0, 1);
  const drScore = 1 - Clamp(DR, 0, 1);
  const raw = w.ot*Clamp(OT,0,1) + w.cr*crScore + w.dr*drScore + w.rl*Clamp(RL,0,1) + w.ar*Clamp(AR,0,1);
  return Clamp(raw, 0, 1);
}
```

Monotonic: increasing OT never decreases R; increasing CR/DR never increases R.

### 4.4 Hire-worth H (0..1)
```typescript
function computeHireWorth({skillMatch, reliability, performance}:{skillMatch:number;reliability:number;performance:number},
  w={sm:0.4, r:0.35, p:0.25}): number {
  return Clamp(w.sm*skillMatch + w.r*reliability + w.p*performance, 0, 1);
}
```
Explain: return top contributors with weights.

### 4.5 Undervaluation U (0..1)
Detect high skill/quality vs low realized earnings.
```typescript
function computeUndervaluation({zSkill, zQuality, zEarningsRate}:{zSkill:number; zQuality:number; zEarningsRate:number}): number {
  const x = Clamp(zSkill, -3, 3) + Clamp(zQuality, -3, 3) - Clamp(zEarningsRate, -3, 3);
  return 1/(1+Math.exp(-x));
}
```
Triggers: if U > 0.8 and evidence ≥ thresholds, enqueue guidance.

---

## 5) Config (YAML) and Versioning
Schema (example):

```yaml
version: "1.0"
windows:
  - 7d
  - 30d
  - 90d
  - lifetime
smoothing:
  ewma_alpha:
    skills: 0.35
    productivity: 0.3
    reliability: 0.25
    hire_worth: 0.2
    undervaluation: 0.2
continuity:
  delta_caps_pct_per_30d:
    skills: 0.08
    productivity: 0.10
    reliability: 0.06
    hire_worth: 0.07
min_evidence:
  reviews: 5
  completed_jobs: 3
  assessments: 1
weights:
  skills: {A:0.45, E:0.2, R:0.15, M:0.2}
  productivity: {speed:0.45, throughput:0.35, uptime:0.2}
  reliability: {ot:0.4, cr:0.2, dr:0.2, rl:0.1, ar:0.1}
  hire_worth: {sm:0.4, r:0.35, p:0.25}
monotonic:
  reliability:
    - feature: on_time_rate
      direction: non_decreasing
    - feature: cancel_rate
      direction: non_increasing
    - feature: dispute_rate
      direction: non_increasing
role_baselines:
  welder:
    estimate_speed_mu: 1.0
    estimate_speed_sigma: 0.25
  editor:
    estimate_speed_mu: 1.1
    estimate_speed_sigma: 0.3
```

Versioning:
- Store in `score_versions` with `metric`, `active_version`, `config`.
- Dual-run: compute vCurrent and vNext; compare distributions, anomalies; switch with feature flag.

---

## 6) Processing Model
- Ingestion: POST `/events` → outbox → Kafka → consumers write OLTP and OLAP.
- Incremental updates: On key events, update affected windows and write `metric_snapshots` with attribution IDs.
- Batch recompute: nightly backfill per metric/window; enforce continuity caps.
- Cold start: priors per role until `min_evidence` reached; show uncertainty bands.

---

## 7) Services and APIs

Ingestion
```http
POST /events
Authorization: Bearer <token>
Content-Type: application/json
{ eventId, ts, userId, type, source, signature, payload }
```

Scoring
```http
POST /score/run?userId=...&metrics=skills,reliability&window=30d
GET  /score/snapshot?userId=...&window=30d
GET  /score/explain?userId=...&metric=reliability
```

Profile (mobile)
```http
GET /profile/mobile?userId=...&viewerRole=buyer
```
Returns: identity, credibility, availability, CTA, contribution, status, S/P/R/H summaries, U if high, tabs metadata.

Admin
```http
GET /score/config?metric=skills
PUT /score/config { version, config }
GET /score/diff?userId=...&a=v1.0&b=v1.1
```

---

## 8) Monitoring, Audit, Fairness
- Lineage: store `attributions` per snapshot: eventIds, table pkeys, feature values.
- Drift: alert on volume anomalies, z-jumps > continuity caps, reviewer disagreement.
- Fairness: stratify metrics by role/location; exclude protected attributes from features; periodic counterfactual checks.
- Overrides: time-limited human override with reason; logged; decays.

---

## 9) Mobile Contract (minimal)
```json
{
  "identity": {"name":"","handle":"","role":"","avatarUrl":"","verified":true},
  "credibility": {"rating": {"avg": 0, "count": 0}, "badges": ["kyc"]},
  "availability": {"status":"accepting","nextAvailableAt":"2025-10-22"},
  "cta": {"primary":"hire","secondary":["message","follow"]},
  "contribution": {"score":0,"completedJobs":0,"endorsements":0},
  "status": {"live": false, "lastActiveAt": ""},
  "metrics": {"skills":0.0, "productivity":0.0, "reliability":0.0, "hireWorth":0.0, "undervaluation":0.0},
  "tabs": ["Work","Skills","Inventory","Media"]
}
```

---

## 10) Acceptance Criteria (per metric)
- Determinism: same inputs ⇒ same outputs (±1e-9).
- Monotonicity: unit tests enforce declared monotonic clauses.
- Continuity: deltas respect caps; violations logged as anomalies.
- Explainability: `explain` returns top 3 contributors with weights and evidence counts.
- Privacy: role gating masks sensitive values; unit/integration tests cover redaction.

---

## 11) Rollout Plan
1. Implement v1.0 configs and metric shells.
2. Backfill on staging; validate distributions; add monitors.
3. Dual-run in prod (shadow) for 2 weeks; compare; fix.
4. Flip feature flag; keep shadow for another week; finalize.

---

## 12) Implementation Checklist
- [ ] Create tables and indexes (OLTP) and topics (Kafka)
- [ ] Implement event ingestion with schema validation/signature
- [ ] Build consumers: write OLTP, OLAP; compute incremental snapshots
- [ ] Implement metric shells and EWMA/continuity guards
- [ ] Add versioned config loader and admin endpoints
- [ ] Add `explain` path with attributions
- [ ] Add monitoring, anomaly flags, fairness dashboards
- [ ] Implement profile/mobile endpoint and role gating
- [ ] Backfill, dual-run, rollout per plan

Notes:
- Keep feature weights conservative initially; prefer stability over reactivity.
- Document any manual assessor processes and SLAs.
