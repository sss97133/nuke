// LibraryDaysView.swift — the read half of the local-first loop, and the proof.
// Renders the library grouped by day ENTIRELY from LocalStore.dayCounts() — no
// SupabaseService, no RPC, no network in this file. This is the window the NEXT
// BUILD directive demanded: "render ONE window from the local store, NOT the
// cloud," whose acceptance test is that it builds with the network OFF.
//
// The days come from each photo's TRUE EXIF takenAt (written by LibraryIngest),
// so an old import shows the day it was actually shot, not the re-add date.
//
// Operating table: source → LibraryStore · store → LocalStore · populate →
// LibraryIngest · this file → the day receipt.

import SwiftUI

struct LibraryDaysView: View {
    @ObservedObject private var ingest = LibraryIngest.shared
    @Environment(\.dismiss) private var dismiss
    @State private var days: [(day: String, count: Int)] = []
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if ingest.running {
                        Label("Reading photos on-device… \(ingest.scanned)/\(ingest.target)",
                              systemImage: "internaldrive")
                            .foregroundStyle(.secondary)
                    } else if days.isEmpty && loaded {
                        Text("No dated photos yet. Pull to scan.")
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    // Honest provenance: this is built locally, and the v1 cap is named.
                    Text(footerText)
                }

                if !days.isEmpty {
                    Section("Days") {
                        ForEach(days, id: \.day) { d in
                            HStack {
                                Text(pretty(d.day))
                                Spacer(minLength: 16)
                                Text("\(d.count)").monospacedDigit().foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Days")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .refreshable { await ingest.run(); await reload() }
            .task {
                await reload()                 // show whatever's already local first
                if days.isEmpty { await ingest.run() }
                await reload()
                loaded = true
            }
        }
    }

    private func reload() async {
        days = await Task.detached { LocalStore.shared.dayCounts() }.value
    }

    private var footerText: String {
        let base = "Built on-device from your photos' EXIF — no network. \(days.reduce(0) { $0 + $1.count }) photos across \(days.count) days."
        return ingest.capped ? base + " Newest \(ingest.target) scanned so far (v1)." : base
    }

    /// "2019-04-29" → "Mon, Apr 29, 2019".
    private func pretty(_ ymd: String) -> String {
        let inF = DateFormatter()
        inF.locale = Locale(identifier: "en_US_POSIX")
        inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: ymd) else { return ymd }
        let outF = DateFormatter()
        outF.dateStyle = .full
        outF.timeStyle = .none
        return outF.string(from: d)
    }
}
