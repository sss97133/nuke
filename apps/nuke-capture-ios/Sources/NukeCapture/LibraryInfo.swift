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

                // ── The Nuke ledger (our side — the value) ──
                Section("Nuke") {
                    if let l = ledger, l.classified {
                        row("Type", l.isVehicle ? "Vehicle / work" : (l.isPersonal ? "Personal" : "—"))
                        if !l.labels.isEmpty {
                            row("Tags", l.labels.prefix(8).joined(separator: ", "))
                        }
                        if let v = l.vehicleId {
                            row("Vehicle", String(v.prefix(8)))
                        }
                        if let d = l.sessionDate {
                            row("Day", d)
                        }
                        if let p = l.phashHex {
                            row("Identity", String(p.prefix(12)) + "…")
                        }
                        if let a = l.analyzedAt {
                            row("Analyzed", relativeText(a))
                        }
                    } else {
                        Label("Analyzing on-device…", systemImage: "sparkles")
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
            ledger = await Task.detached { LocalStore.shared.ledger(for: id) }.value
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
