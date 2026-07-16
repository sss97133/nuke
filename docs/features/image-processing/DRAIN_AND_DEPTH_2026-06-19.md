# Image Drain + App Depth — plan & runbook (2026-06-19)

Your ask: **iOS app fully clickable / expose the depths of data + analyze all iCloud images.**

## Honest constraint (read first)
Both halves execute on **your Mac**, not in this Cowork session:
- The analysis scripts can't run in the Claude sandbox — they say so themselves: *"the Claude Code Bash sandbox silently drops the Supabase connection."* They need your un-sandboxed login shell.
- iOS changes need Xcode to compile + ship to TestFlight.

So below is the **prep done** (numbers, model strategy, priority, exact commands, depth spec) — you fire the Mac-side steps.

---

## 1. The numbers (your photos, user `0b9f107a`)

| | count |
|---|---|
| Total images | 25,947 |
| Deep-analyzed (`byok_deep_analysis`) | 6,306 (24%) |
| **Remaining** | **~19,641** |

Almost all remaining are **yours**, not scraped:

| source | remaining |
|---|---|
| iphoto (iCloud) | 7,366 |
| capture_relay_ios | 4,628 |
| user_upload | 4,654 |
| photo_auto_sync (iCloud) | 2,357 |
| everything else | ~636 |

Your build cars are already mostly done — **K5 83%, Mustang 88%**. The gap is the long tail + **9,563 unlinked photos** (no vehicle attached).

---

## 2. Drain — model strategy (the "best of all options, realistic" answer)

| Tier | Model | Use on | Why |
|---|---|---|---|
| Premium | **Opus** (default, ~3 min/img) | Revenue cars only: Mustang (160) + K5 (300) | Quality where dollars ride — these become BaT listings / invoices |
| Workhorse | **Sonnet** (`BYOK_MODEL=claude-sonnet-4-6`, ~40s, 6×) | Everything else (~19K) | Best quality-per-hour at scale |
| Instant | **Apple Vision** on-device (free, ~50ms) | New live captures | Already wired (T0 live demo) — nothing blank |

**Don't** run Opus on all 19.6K — that's ~160h even parallelized. Sonnet for volume is the realistic call.
Wall-clock for the bulk: ~19K × 40s ÷ 6 workers ≈ **35 hours**, heavy on BYOK quota.

---

## 3. Drain — commands (run on your Mac, `cd /Users/skylar/nuke`)

**Smoke test first** (confirm the pipe flows before the big burst):
```bash
dotenvx run -- node scripts/daily-receipt/analyze-capture-photos.mjs run \
  --user-id 0b9f107a-d124-49de-9ded-94698f63c1c4 --limit 10 --model claude-sonnet-4-6
```

**A) Bulk drain — all your pending photos, 6 Sonnet shards in parallel:**
```bash
for i in 0 1 2 3 4 5; do
  dotenvx run -- node scripts/daily-receipt/analyze-capture-photos.mjs run \
    --user-id 0b9f107a-d124-49de-9ded-94698f63c1c4 \
    --limit 4000 --model claude-sonnet-4-6 --shard-count 6 --shard-index $i &
done; wait
```

**B) Opus burst on the two revenue cars (run alongside A):**
```bash
bash scripts/daily-receipt/byok-image-parallel.sh 83f6f033-a3c3-4cf4-a85e-a60d2c588838 5 4   # Mustang
bash scripts/daily-receipt/byok-image-parallel.sh e08bf694-970f-4cbe-8a74-8715158a0f2e 5 4   # K5 Blazer
```

**After the drain — attribute the 9,563 unlinked photos to vehicles** (so they reach profiles):
```bash
dotenvx run -- psql "$DATABASE_URL" -c "select derive_vehicle_image_attribution_batch(2000);"
```

The slow trickle `com.nuke.byok-image-analysis` is already loaded and drips ~4/15min in the background; the bursts above are what actually move it.

---

## 4. App depth — what's already built vs. the real gaps

**Already drillable (don't rebuild):** spec table → `get_vehicle_specs` fact/facade → provenance sheet; photos → evidence rail; investment ledger → per-row audit; worth bracket + basis; build timeline → day → photos; follow/comment/contribute. `RootedValueView` is the universal primitive. The thesis is ~80% live.

**The real remaining gaps (each is a concrete fix):**

1. **Photo evidence rail is shallow — the #1 "expose the depths" win. ✅ RPC DONE.**
   `get_user_analyzed_photos` → `AnalyzedPhoto` carries only scene/phase/intent/components. The rich **`byok_deep_analysis` verdict** (narrative, the model's *reasoning notes*, state observations, components-with-confidence, place hint, open questions) lives in `ai_scan_metadata` and had **no read path**. `get_image_ai_summary` only reads component detections, not the verdict.
   **Built + verified live this session:** `get_image_deep_analysis(p_image_id)` (migration `20260619170000`) returns the whole verdict. Tested on a K5 photo — returns *"Close-up of a black vinyl interior panel… points to ernies_upholstery"*, paint/rust/completeness, 4 components, 3 open questions.
   *Remaining (your build):* render it in `EvidenceRail` — **paste-ready Swift in the appendix below.**

2. **Gallery filter may hide freshly deep-analyzed photos — verify.**
   `VehicleDetailView.loadGalleryPage` filters `ai_processing_status == 'completed'`, but the capture runner sets `'analyzed'`. Deep-analyzed capture photos could be excluded from the vehicle gallery.
   *Fix:* widen the filter to `in ('completed','analyzed')` (or to `byok_deep_analysis present`).

3. **9,563 unlinked photos are invisible on vehicle profiles** until attributed (step 3 command above). They do show in Today → Analyzed (user-scoped), but never on a build. Attribution closes this.

---

## 5. Done this session (from here, no Mac) ✅
- **`get_image_deep_analysis` RPC — live + verified + tracked** (`supabase/migrations/20260619170000_get_image_deep_analysis.sql`). Additive/read-only, can't break live reads. This is the substrate for gap #1.
- Paste-ready Swift to render it (appendix). Gap #2 (gallery filter) is a one-line Swift fix, noted above.

## Appendix — paste-ready Swift for the deep evidence rail (gap #1)
Add to `AnalyzedPhotosView.swift`. Renders only what exists; the existing rail is untouched.

```swift
// 1) The verdict model — 1:1 with get_image_deep_analysis columns.
struct ImageDeepAnalysis: Decodable {
    let narrative: String?
    let intent: String?; let intent_confidence: Double?
    let scene_type: String?; let build_phase: String?; let place_hint: String?
    let confidence: Double?; let agent_model: String?; let agent_notes: String?
    let analyzed_at: String?
    let paint_state: String?; let rust_severity: String?; let completeness: String?
    let components: [Component]?
    let open_questions: [String]?
    let needs_review: Bool?
    struct Component: Decodable, Identifiable {
        let label: String?; let confidence: Double?
        var id: String { (label ?? "") + String(confidence ?? 0) }
    }
}

// 2) In AnalyzedEvidenceView: add state + load, pass into the rail.
//    @State private var deep: ImageDeepAnalysis?
//    ...on the VStack:  .task { await loadDeep() }
//    ...replace `EvidenceRail(photo: photo)` with `EvidenceRail(photo: photo, deep: deep)`
private func loadDeep() async {
    struct P: Encodable { let p_image_id: String }
    do {
        let rows: [ImageDeepAnalysis] = try await SupabaseService.client
            .rpc("get_image_deep_analysis", params: P(p_image_id: photo.id.uuidString.lowercased()))
            .execute().value
        deep = rows.first
    } catch { NSLog("NukeCapture deep analysis load failed: %@", String(describing: error)) }
}

// 3) In EvidenceRail: add `var deep: ImageDeepAnalysis? = nil` and render the depth
//    just under the chips (inside the `hasAnyAtoms` block or above COMPONENTS):
@ViewBuilder private var depthSection: some View {
    if let d = deep {
        VStack(alignment: .leading, spacing: 8) {
            if let n = d.narrative, !n.isEmpty {
                Text(n).font(.footnote).foregroundStyle(.white.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
            // The model's reasoning — the part that makes it feel "alive", drillable trust.
            if let notes = d.agent_notes, !notes.isEmpty {
                Text(notes).font(.caption2).italic().foregroundStyle(.white.opacity(0.6))
                    .fixedSize(horizontal: false, vertical: true)
            }
            // State observations as a compact record line.
            let state = [d.paint_state.map { "paint \($0)" },
                         d.rust_severity.map { "rust \($0)" },
                         d.completeness].compactMap { $0 }.filter { $0 != "unknown" }
            if !state.isEmpty {
                Text(state.joined(separator: " · "))
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(.white.opacity(0.55))
            }
            // Components WITH confidence (vs the flat strings the old rail shows).
            if let comps = d.components, !comps.isEmpty {
                ForEach(comps) { c in
                    HStack(spacing: 8) {
                        Text("·").foregroundStyle(.white.opacity(0.4))
                        Text(c.label ?? "—").font(.footnote).foregroundStyle(.white.opacity(0.85))
                        Spacer(minLength: 0)
                        if let cf = c.confidence {
                            Text("\(Int(cf*100))%").font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.white.opacity(0.45))
                        }
                    }.padding(.vertical, 2)
                }
            }
            // What the agent still wants confirmed — the contribution hook.
            if let qs = d.open_questions, !qs.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("OPEN QUESTIONS").font(.caption2.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.5)).kerning(0.5)
                    ForEach(qs, id: \.self) { q in
                        Text("· " + q).font(.caption2).foregroundStyle(.white.opacity(0.6))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }.padding(.top, 2)
            }
            if let m = d.agent_model {
                Text("read by \(m)").font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.4))
            }
        }
    }
}
// …then drop `depthSection` into the rail's VStack (e.g. right after the chips HStack).
```

Want me to also build the gallery-filter migration alternative (a `byok_analyzed` boolean/expression the app can filter on instead of the brittle `ai_processing_status` string)? Say so and I'll land it.
