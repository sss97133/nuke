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
    var localOnly: Bool = false
    @Environment(\.dismiss) private var dismiss
    @State private var ledger: ImageLedger?
    @State private var isAnalyzing = false
    @State private var loadingCloud = false
    @State private var sourceReview: LocalAlbumImageReview?
    @State private var reviewedSourceVersion: String?
    @State private var loadGeneration = UUID()
    @ObservedObject private var library = LibraryStore.shared

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

                if library.albumCatalog?.accessScope == "full" {
                    let albums = library.albumCatalog?.albums.filter { album in
                        album.photos.contains { $0.localIdentifier == asset.localIdentifier }
                    } ?? []
                    if !albums.isEmpty {
                        Section("Photos albums") {
                            ForEach(albums) { album in
                                Text(album.name ?? "Album name unavailable")
                            }
                            Text("Existing grouping; vehicle identity is assessed separately.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }

                let documentContext = LocalDocumentContext.read(sourceReview, assetId: asset.localIdentifier,
                    sourceVersion: reviewedSourceVersion, method: LibraryIngest.albumMethodVersion)
                let showRetainedNarrative = documentContext.showsRetainedNarrative(localOnly: localOnly,
                    isPersonal: ledger?.isPersonal == true, hasPerson: sourceReview?.hasPerson == true,
                    labels: ledger?.labels ?? [], isScreenshot: asset.mediaSubtypes.contains(.photoScreenshot))
                if documentContext.state == .decoded || documentContext.state == .unresolved {
                    Section("Document context") { LocalDocumentContextRows(context: documentContext) }
                } else if documentContext.state == .unavailable {
                    Section("On-device source read") {
                        Text("No current local reading is available for this source and method. Any earlier retained analysis is labeled separately.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else if let review = sourceReview {
                    Section("On-device source read") {
                        row("Method", review.methodVersion)
                        row("Read", relativeText(review.analyzedAt))
                        row("Source SHA256", review.inputSHA256)
                        if !review.textLines.isEmpty {
                            ForEach(Array(review.textLines.enumerated()), id: \.offset) { _, text in
                                Text(text).font(.caption).textSelection(.enabled)
                            }
                        }
                    }
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
                if showRetainedNarrative, let l = ledger, let narrative = l.cloudNarrative {
                    Section("Read by Nuke") {
                        Text("Retained analysis; this view does not establish a match to the current source bytes.")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(narrative)
                        if let v = l.cloudIntent { row("Intent", token(v)) }
                        if let v = l.cloudScene { row("Scene", token(v)) }
                        if let v = l.cloudBuildPhase { row("Build phase", token(v)) }
                        if let c = l.cloudConfidence { row("Confidence", "\(Int((c * 100).rounded()))%") }
                        if let a = l.cloudAnalyzedAt { row("Read", relativeText(a)) }
                        if let m = l.cloudAgentModel { row("By", m) }
                    }
                } else if showRetainedNarrative && loadingCloud {
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
        .task(id: asset.localIdentifier) {
            let request = UUID(); loadGeneration = request
            sourceReview = nil; reviewedSourceVersion = nil; ledger = nil
            isAnalyzing = false; loadingCloud = false
            let id = asset.localIdentifier
            guard let current = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
                  current.localIdentifier == id else { return }
            let photo = LocalAlbumPhoto(localIdentifier: id,
                sourceVersion: current.modificationDate.map { String($0.timeIntervalSince1970) })
            func invalidateCurrentRequest() {
                // An old task must not erase a newer photo's successfully loaded state.
                guard loadGeneration == request else { return }
                sourceReview = nil; reviewedSourceVersion = nil; ledger = nil
                isAnalyzing = false; loadingCloud = false
            }
            func isCurrent() -> Bool {
                guard !Task.isCancelled, loadGeneration == request, asset.localIdentifier == id,
                      let latest = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
                      latest.localIdentifier == id else { return false }
                return latest.modificationDate.map { String($0.timeIntervalSince1970) } == photo.sourceVersion
            }
            let method = LibraryIngest.albumMethodVersion
            let retained = try? await Task.detached {
                try LocalStore.shared.albumImageReview(for: photo, methodVersion: method)
            }.value
            guard isCurrent() else { invalidateCurrentRequest(); return }
            reviewedSourceVersion = photo.sourceVersion; sourceReview = retained
            let context = LocalDocumentContext.read(retained, assetId: id, sourceVersion: photo.sourceVersion, method: method)
            var l = await Task.detached { LocalStore.shared.ledger(for: id) }.value
            guard isCurrent() else { invalidateCurrentRequest(); return }
            if !localOnly && l?.classified != true {
                isAnalyzing = true
                if let v = await VisionEngine.classifyAsset(localIdentifier: id) {
                    guard isCurrent() else { invalidateCurrentRequest(); return }
                    await Task.detached {
                        LocalStore.shared.classify(localIdentifier: id, isVehicle: v.isVehicle,
                                                   isPersonal: v.isPersonal, hasPerson: v.hasPerson, labels: v.labels)
                    }.value
                    guard isCurrent() else { invalidateCurrentRequest(); return }
                    l = await Task.detached { LocalStore.shared.ledger(for: id) }.value
                    guard isCurrent() else { invalidateCurrentRequest(); return }
                }
                guard isCurrent() else { invalidateCurrentRequest(); return }
                isAnalyzing = false
            }
            ledger = l

            // Bring the prod BYOK verdict DOWN if it isn't cached yet. Online-only
            // (offline → [] fast); once cached it renders with no network next open.
            // Joined by the exact uuid bridge (localIdentifier == exif_data.uuid).
            if !localOnly && context.showsRetainedNarrative(localOnly: localOnly, isPersonal: l?.isPersonal == true,
                hasPerson: retained?.hasPerson == true, labels: l?.labels ?? [], isScreenshot: asset.mediaSubtypes.contains(.photoScreenshot)) && l?.cloudNarrative == nil {
                loadingCloud = true
                let verdicts = await SupabaseService.fetchCloudVerdicts(forLocalIdentifiers: [id])
                guard isCurrent() else { invalidateCurrentRequest(); return }
                if let v = verdicts?.first {
                    await Task.detached {
                        LocalStore.shared.cacheCloudVerdict(
                            localIdentifier: id,
                            narrative: v.narrative, intent: v.intent, scene: v.scene_type,
                            confidence: v.confidence, buildPhase: v.build_phase,
                            vehicleId: v.vehicle_id, agentModel: v.agent_model,
                            analyzedAt: SupabaseService.verdictDate(v.analyzed_at))
                    }.value
                    guard isCurrent() else { invalidateCurrentRequest(); return }
                    let refreshed = await Task.detached { LocalStore.shared.ledger(for: id) }.value
                    guard isCurrent() else { invalidateCurrentRequest(); return }
                    ledger = refreshed
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
