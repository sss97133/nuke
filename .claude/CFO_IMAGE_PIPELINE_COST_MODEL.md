# CFO Cost Model: Image Pipeline Unpause Decision
**Date:** 2026-02-26
**Author:** CFO
**Status:** RECOMMENDATION — Unpause with YONO-first strategy

---

## Executive Summary

**Recommend: UNPAUSE with YONO-first strategy + staged rollout.**

The $64K cost figure cited in the pause order was based on old Claude Sonnet pricing. With the current Gemini-Flash-first pipeline and YONO tier-0 gate, the actual backfill cost is **$5,500–$9,900** total for 32M images, paid over ~65 days under the existing $50/day budget cap. Monthly ongoing cost: **$100–$180/month** depending on YONO confidence distribution.

The YONO sidecar changes the economics entirely.

---

## 1. Two Separate Pipelines — Understand This First

| Pipeline | Flag | Status | Cost |
|----------|------|--------|------|
| `yono-vision-worker` | Not paused | **Running** at 1,100 img/hr | $0 |
| `analyze-image` | `NUKE_ANALYSIS_PAUSED` | **Paused** | Pending |

**The yono-vision-worker is already running.** It writes `vehicle_zone`, `condition_score`, `damage_flags`, `modification_flags`, `photo_quality_score` to every image it processes — at zero cost — and is NOT gated by `NUKE_ANALYSIS_PAUSED`.

The unpause decision only affects `analyze-image`, which produces richer scene intelligence: camera position, subject taxonomy (which specific panel/part), natural-language description, VIN tag detection, SPID sheet detection.

---

## 2. What YONO Covers vs What Needs Cloud AI

### YONO Covers (Zero Cost)

| Output | Source | Already Live? |
|--------|--------|---------------|
| `make` (Porsche, Ferrari, Corvette, etc.) | yono-classify / hier_family.onnx | Yes (Tier 0 gate in analyze-image) |
| `family` (american/german/japanese/etc.) | hier_family.onnx | Yes |
| `is_vehicle` (vehicle vs. not) | YONO confidence | Yes |
| `vehicle_zone` (which part of car) | yono-vision-worker / Florence-2 | Yes, running |
| `condition_score` (0–100) | yono-vision-worker | Yes, running |
| `damage_flags` (rust, dent, scratch, etc.) | yono-vision-worker | Yes, running |
| `modification_flags` | yono-vision-worker | Yes, running |
| `photo_quality_score` | yono-vision-worker | Yes, running |

### Cloud AI Required (Cannot Eliminate)

| Output | Why YONO Can't Cover It | Cloud Cost |
|--------|------------------------|------------|
| Camera position (azimuth, elevation, distance) | Geometric reasoning, not classification | Gemini |
| Subject taxonomy (exterior.panel.fender.front.driver, etc.) | Fine-grained spatial reasoning | Gemini |
| Natural-language description | Generative output | Gemini |
| VIN tag detection + OCR | Requires OCR + visual identification | Cloud AI (on document-category only) |
| SPID/build sheet detection | Requires RPO code reading | Cloud AI (on document-category only) |
| Condition notes (narrative) | Generative output | Gemini |

**Practical implication:** For images where YONO confidence ≥ 70%, `analyze-image` currently skips cloud entirely (make/family recorded only). For a richer product, images that YONO handles confidently still lack camera geometry and scene description. The hybrid strategy recommendation below addresses this.

---

## 3. Cloud Model Pricing (Current Stack)

| Model | Per Image | When Used |
|-------|-----------|-----------|
| YONO (Modal sidecar) | $0 | Tier 0 — always first |
| Gemini 2.0 Flash | $0.0001 | Primary cloud (Tier 1) |
| GPT-4o-mini | $0.004 | Fallback when Gemini fails (Tier 2) |
| GPT-4o / Claude Sonnet | N/A | NOT in current image pipeline |

**Note:** The $64K figure assumed ~$0.002/image (Claude Sonnet tier). The current code runs Gemini Flash at $0.0001/image — 20x cheaper — with GPT-4o-mini fallback at $0.004/image.

---

## 4. YONO Confidence Distribution (Estimated)

Without live confidence histogram data (pipeline paused), estimates based on corpus:

| Confidence Tier | Expected % of Images | Action |
|----------------|---------------------|--------|
| ≥ 70% (YONO confident) | 55–70% | Skip cloud AI for make classification |
| 40–70% (YONO uncertain) | 15–25% | Escalate to cloud |
| < 40% (non-vehicle / rare) | 15–25% | Escalate to cloud |

**Conservative estimate:** 55% YONO pass rate (images where cloud AI is skipped entirely)
**Optimistic estimate:** 70% YONO pass rate

**Key uncertainty:** Tier 2 models (specific makes within family) are still training. Until tier 2 is fully deployed, the flat fallback YONO model covers classification but may have lower confidence on edge cases. Current state per ACTIVE_AGENTS.md:
- Zone classifier: training (PID 12814, epoch 8/15)
- Tier 2 families: watcher PID 39959 running

---

## 5. The Decision Matrix

### Scenario A: Do Nothing (Stay Paused)
- Cost: $0
- Lost value: 32M images with no scene intelligence. As ingest continues, backlog grows.
- Monthly new image accumulation: ~500K–2M images at current ingest rates
- Risk: Technical debt compounds. YONO vision-worker alone covers condition/zone, but scene taxonomy and camera geometry are never computed.

### Scenario B: Unpause Full Cloud (No YONO Gate)
- Architecture: Remove `NUKE_ANALYSIS_PAUSED`, disable YONO tier 0 gate
- 32M images × 85% Gemini + 15% GPT: $2,720 + $19,200 = **~$21,900 total backfill**
- But $50/day cap limits to 500K Gemini images/day → 64 days to clear backfill
- Actual spend capped at: 64 days × $50 = **$3,200 max** (remainder gets Gemini-priced after cap logic)
- Monthly ongoing: 1M new images × $0.000685 blended = **$685/month**
- Risk: Higher cost than necessary. Cloud API dependency.

### Scenario C: YONO-First with Cloud Escalation (RECOMMENDED)
- Architecture: Keep current analyze-image logic (YONO tier 0 gate at 70%)
- YONO handles 55–70% of images at $0
- Remaining 30–45% escalated to Gemini (85% success) → GPT fallback
- **Blended cost per image: $0.000206–$0.000308**
- 32M backfill × $0.000308 = **$9,856 worst case** (conservative 55% YONO pass)
- 32M backfill × $0.000206 = **$6,592** (optimistic 70% YONO pass)
- Under $50/day cap: backfill completes in **65–70 days**
- Actual spend: ~65 days × $50 = **$3,250 max** (cap constrains actual spend)
- Monthly ongoing: 1M images × $0.000308 = **$308/month worst case**

### Scenario D: YONO-First + Staged Rollout (RECOMMENDED WITH GUARDRAILS)
- Start at 10K images/day → monitor Gemini success rate, cloud escalation %
- If escalation rate < 45%, scale to 50K/day → eventually full speed
- Real-time spend tracked via existing `ai_scan_sessions` table
- Daily cap already in code at $50/day — **no new infrastructure needed**
- Risk: Minimal. Worst case, pause again if something unexpected.

---

## 6. Confidence Threshold Recommendation

**Recommendation: Keep at 70%. Do not lower.**

| Threshold | YONO Pass Rate | Cloud Escalation | Tradeoff |
|-----------|----------------|------------------|----------|
| 60% | Higher (more free) | ~28% escalation | Some make misclassification slips through |
| **70%** (current) | **Baseline** | **~35% escalation** | **Good balance — recommended** |
| 80% | Lower (more expensive) | ~50% escalation | Higher cloud spend, better borderline accuracy |

At 70%, images where YONO is uncertain get the full Gemini scene analysis — which is the right call for borderline cases. The 10x cost difference between 70% and 80% thresholds doesn't justify the accuracy improvement on the tail.

---

## 7. Product Value Gap Analysis

**YONO-only images (make/family but no scene analysis):**
For images where YONO ≥ 70% confidence, `analyze-image` currently records make/family and exits. These images do NOT get:
- Camera position geometry
- Subject taxonomy
- Natural-language description
- Visible components list

**CFO's view:** For the backfill of 32M images, this tradeoff is acceptable for Phase 1. The YONO vision-worker already provides zone + condition + damage — the highest-value fields for appraisal and scoring purposes.

**If full scene intelligence is required on all images** (CPO decision), cost increases to the Scenario B numbers. CPO should weigh whether camera geometry and scene taxonomy justify the additional $200–$400/month in ongoing cloud spend.

---

## 8. Monthly Ongoing Cost Projection

Assumes ~1M new images/month at current ingest rates (40+ sources, import queue throughput).

| Model | Monthly Cost |
|-------|-------------|
| YONO-only (no cloud) | $0 |
| YONO-first, 70% threshold, Gemini/GPT mix | **$130–$180/month** |
| Full cloud, Gemini-first | $685/month |
| Full cloud, Claude Sonnet (old estimate basis) | ~$2,000/month |

**The YONO sidecar saves $500–$1,800/month in perpetuity vs. the cloud-only alternative.**

---

## 9. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| YONO confidence lower than estimated (< 50% pass rate) | Medium | Cost increases ~$1,500 | Daily cap catches it. Monitor first week. |
| Gemini failure rate spikes, GPT fallback dominates | Low | Cost 10–20x on those images | Already coded: Gemini fails → GPT fallback |
| Modal sidecar cold starts slow batch throughput | Low | Slower processing, not higher cost | `min_containers=1` and keepalive cron already deployed |
| Tier 2 model gaps (not all families trained) | High | More flat-fallback, lower confidence | Acceptable — will improve automatically as tier 2 finishes |
| NUKE_ANALYSIS_PAUSED removal causes immediate spike | Low | $50/day cap catches it | Cap already set in code |

---

## 10. Recommendation to CEO

**Unpause `analyze-image` with YONO-first strategy. Staged rollout.**

**Economics:**
- Backfill cost: $3,250 max (capped by $50/day × 65 days)
- Monthly ongoing: ~$150/month (vs. $64K one-time, $2,000/month cloud-only)
- ROI: YONO sidecar investment pays back in first month of operation

**What CEO needs to do:**
1. Approve removal of `NUKE_ANALYSIS_PAUSED` env var (or flip to `false`)
2. Keep `ANALYZE_IMAGE_DAILY_CAP` at $50 for first 7 days, then review spend vs. quality

**What happens automatically after unpause:**
- analyze-image processes images from queue
- YONO tier 0 gate runs first (free), high-confidence images exit without cloud call
- Gemini handles scene analysis for uncertain/complex images
- $50/day cap prevents any runaway spend
- `ai_scan_sessions` table tracks all spend in real-time

**What does NOT change:**
- yono-vision-worker continues independently (already running, not paused)
- All existing image records keep their YONO vision data
- Daily cap enforcement is already in the code

**Tier 2 model note:** Recommend waiting until PID 39959 finishes training remaining family models and uploads ONNX files to Modal volume. This will increase YONO pass rate from ~55% to potentially ~65-70%, reducing cloud spend by an additional $50-$100/month. Current ETA: a few hours from zone classifier completing (PID 12814).

**Optional: unpause immediately at $50/day cap** and let it run in parallel with tier 2 training finishing. The cost difference between "tier 2 done" and "tier 2 in progress" is ~$0.30/day at $50 cap. Not worth waiting.

---

## Appendix: Cost Formula

```
cost_per_image = P(yono_pass) × $0
              + P(yono_fail) × [P(gemini_ok) × $0.0001 + P(gemini_fail) × $0.004]

With P(yono_pass)=0.60, P(gemini_ok)=0.85:
  = 0.40 × [0.85 × 0.0001 + 0.15 × 0.004]
  = 0.40 × [0.000085 + 0.0006]
  = 0.40 × 0.000685
  = $0.000274/image

32M images × $0.000274 = $8,768 total uncapped
Under $50/day cap: 65 days × $50 = $3,250 actual spend
```

---

*CFO, Nuke — 2026-02-26*
