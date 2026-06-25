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

    var body: some View {
        NavigationStack {
            List {
                // ── The photo's own facts (Apple's side) ──
                Section("Photo") {
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
                                                   isPersonal: v.isPersonal, labels: v.labels)
                    }.value
                    l = await Task.detached { LocalStore.shared.ledger(for: id) }.value
                }
                isAnalyzing = false
            }
            ledger = l
        }
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).foregroundStyle(.secondary)
            Spacer(minLength: 16)
            Text(value).multilineTextAlignment(.trailing)
        }
    }

    private var takenText: String {
        guard let d = asset.creationDate else { return "—" }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: d)
    }

    private func relativeText(_ d: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: d, relativeTo: Date())
    }
}
