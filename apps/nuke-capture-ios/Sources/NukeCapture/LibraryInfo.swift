// LibraryInfo.swift — the back of the photo. Where the raw visual data flips to the
// STRUCTURED data we pulled out of it — the first moment a user sees the value of the
// system. The front is Apple's pixels; this is Nuke's ledger.
//
// v1 reads what the local store already knows (classification, Apple-tag labels,
// content identity, vehicle/day binding) + the photo's own PHAsset facts. Deeper
// phases (where-else-it-appears, full entity paths, BYOK analysis) layer into the
// SAME sections as they land — fields show "in process" until they associate.
//
// Operating table: source → LibraryStore · glasses → LibraryGlasses · grid →
// LibraryView · fullscreen → LibraryDetail. This file is ONLY the info sheet.

import Photos
import SwiftUI

struct LibraryInfoView: View {
    let asset: PHAsset
    @Environment(\.dismiss) private var dismiss
    @State private var ledger: ImageLedger?
    @State private var isAnalyzing = false
    @State private var loadingCloud = false

    var body: some View {
        NavigationStack {
            List {
                // ── The photo's own facts (Apple's side) ──
                Section("Photo") {
                    // HARD_RULES §7: the file's EXIF DateTimeOriginal is the only trusted
                    // capture time (it's also the day this photo is filed under). Show it when
                    // ingest() has read it; fall back to PHAsset.creationDate (the re-add date,
                    // proven ~6mo wrong) ONLY tagged "(device, unverified)".
                    row("Taken", takenText)
                    row("Dimensions", "\(asset.pixelWidth) × \(asset.pixelHeight)")
                    if let loc = asset.location {
                        row("Location", String(format: "%.5f, %.5f",
                                               loc.coordinate.latitude, loc.coordinate.longitude))
                    }
                    if asset.isFavorite { row("Favorite", "Yes") }
                }

                // ── The Nuke ledger — each row is a rung the photo has ACTUALLY
                //    climbed, from a real value. No "in process", no implied progress;
                //    an empty rung is simply absent.
                Section("Nuke") {
                    // Floor rung — true for nearly the whole library (located + dated).
                    row("Status", asset.location != nil ? "Located · dated" : "Dated")

                    if let l = ledger, l.classified {
                        row("Type", l.isVehicle ? "Vehicle / work" : (l.isPersonal ? "Personal" : "Unclassified"))
                        if !l.labels.isEmpty {
                            row("Apple tags", l.labels.prefix(8).joined(separator: ", "))
                        }
                        if let p = l.phashHex {
                            row("Identity", String(p.prefix(12)) + "…")
                        }
                        if let v = l.vehicleId { row("Vehicle", String(v.prefix(8))) }
                        if let d = l.sessionDate { row("Day", d) }
                        if let a = l.analyzedAt { row("Analyzed", relativeText(a)) }
                    } else if isAnalyzing {
                        // Genuinely running RIGHT NOW — the only honest use of progress.
                        Label("Analyzing on-device…", systemImage: "sparkles")
                            .foregroundStyle(.secondary)
                    } else {
                        row("Type", "Not analyzed yet")
                    }
                }

                // ── Read by Nuke — the prod BYOK verdict, ESCALATED DOWN and cached
                //    on-device (renders offline once pulled). The rich agent read —
                //    narrative/intent/scene/phase — over the cheap on-device T0 labels.
                if let l = ledger, let narrative = l.cloudNarrative {
                    Section("Read by Nuke") {
                        Text(narrative)
                        if let v = l.cloudIntent { row("Intent", token(v)) }
                        if let v = l.cloudScene { row("Scene", token(v)) }
                        if let v = l.cloudBuildPhase { row("Build phase", token(v)) }
                        if let c = l.cloudConfidence { row("Confidence", "\(Int((c * 100).rounded()))%") }
                        if let a = l.cloudAnalyzedAt { row("Read", relativeText(a)) }
                        if let m = l.cloudAgentModel { row("By", m) }
                    }
                } else if loadingCloud {
                    Section("Read by Nuke") {
                        // Genuinely fetching the verdict right now — honest progress.
                        Label("Reading the record…", systemImage: "sparkles")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            let id = asset.localIdentifier
            var l = await Task.detached { LocalStore.shared.ledger(for: id) }.value
            if l?.classified != true {
                isAnalyzing = true
                if let v = await VisionEngine.classifyAsset(localIdentifier: id) {
                    await Task.detached {
                        LocalStore.shared.classify(localIdentifier: id, isVehicle: v.isVehicle,
                                                   isPersonal: v.isPersonal, hasPerson: v.hasPerson, labels: v.labels)
                    }.value
                    l = await Task.detached { LocalStore.shared.ledger(for: id) }.value
                }
                isAnalyzing = false
            }
            ledger = l

            // Bring the prod BYOK verdict DOWN if it isn't cached yet. Online-only
            // (offline → [] fast); once cached it renders with no network next open.
            // Joined by the exact uuid bridge (localIdentifier == exif_data.uuid).
            if l?.cloudNarrative == nil {
                loadingCloud = true
                let verdicts = await SupabaseService.fetchCloudVerdicts(forLocalIdentifiers: [id])
                if let v = verdicts?.first {
                    await Task.detached {
                        LocalStore.shared.cacheCloudVerdict(
                            localIdentifier: id,
                            narrative: v.narrative, intent: v.intent, scene: v.scene_type,
                            confidence: v.confidence, buildPhase: v.build_phase,
                            vehicleId: v.vehicle_id, agentModel: v.agent_model,
                            analyzedAt: SupabaseService.verdictDate(v.analyzed_at))
                    }.value
                    ledger = await Task.detached { LocalStore.shared.ledger(for: id) }.value
                }
                loadingCloud = false
            }
        }
    }

    /// "body_exterior" → "Body exterior". A token reads as a token, not raw snake_case.
    private func token(_ s: String) -> String {
        let spaced = s.replacingOccurrences(of: "_", with: " ")
        return spaced.prefix(1).uppercased() + spaced.dropFirst()
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).foregroundStyle(.secondary)
            Spacer(minLength: 16)
            Text(value).multilineTextAlignment(.trailing)
        }
    }

    private var takenText: String {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        // True EXIF capture time when we have it — the same date the photo is filed under.
        if let exif = ledger?.takenAt { return f.string(from: exif) }
        // Fall back to the device re-add date, honestly tagged (HARD_RULES §7).
        guard let d = asset.creationDate else { return "—" }
        return f.string(from: d) + "  (device, unverified)"
    }

    private func relativeText(_ d: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: d, relativeTo: Date())
    }
}
