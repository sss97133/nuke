// ProfileServeOnce.swift — each fact on the profile is said once, and goes deeper on a tap.
//
// Photos: one line in the header (get_user_sync_status for your own profile, else
// get_user_producer_signals) that opens the photo record, then what was uploaded, then what was
// analyzed. Before this, the same photos were counted in four places with two "Your photos" doors.
//
// Garage: one line of relationship counts (GarageSections over the profile's one get_user_garage
// read) that opens the Garage tab, where the vehicles are listed. The profile no longer repeats
// the list, the activity feed or the identity-pending statements the Garage tab already shows.

import SwiftUI

// ─── Photo line ──────────────────────────────────────────────────────────────

enum ProfilePhotoLine {
    /// "29,749 photos · 1,083 filed · 185 analyzed". Prefers the owner's sync ledger, falls back to the
    /// producer signals; a missing total is said to be unknown, never zero. Nil when neither reader answered.
    static func text(sync: SyncStatus?, producer: ProducerSignals?) -> String? {
        if let sync {
            return [NukeDisplay.count(sync.all_sources_total, "photo"),
                    "\(sync.filed_total.formatted()) filed",
                    "\(sync.analyzed_total.formatted()) analyzed"].joined(separator: " · ")
        }
        guard let p = producer, p.images_total != nil || p.images_analyzed != nil else { return nil }
        let total = p.images_total.map { NukeDisplay.count($0, "photo") } ?? "photo total unknown"
        let analyzed = p.images_analyzed.map { "\($0.formatted()) analyzed" } ?? "analyzed unknown"
        return [total, analyzed].joined(separator: " · ")
    }
}

/// The drill behind the header's photo line, in order: the photo record on this phone, what was
/// uploaded, what was filed to vehicles, what was analyzed. Every row opens the rows it counts.
struct ProfilePhotoRecordView: View {
    let userId: String
    let sync: SyncStatus?
    let evidence: LocalProfileEvidence?
    let vehicles: [GarageVehicle]
    let held: [GarageVehicle]
    var evidenceError: String? = nil
    var albumSyncSummary: String? = nil

    @State private var showAlbums = false

    var body: some View {
        List {
            Section {
                Button { showAlbums = true } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("On this phone").foregroundStyle(Color.primary)
                        ForEach(Self.recordLines(evidence), id: \.self) { line in
                            Text(line).font(.caption).monospacedDigit().foregroundStyle(.secondary)
                        }
                        if let evidenceError { Text(evidenceError).font(.caption).foregroundStyle(.secondary) }
                        if let albumSyncSummary { Text(albumSyncSummary).font(.caption).foregroundStyle(.secondary) }
                    }
                }
            } header: {
                Text("Photo record")
            }

            Section {
                NavigationLink { SourceInboxView(userId: userId) } label: {
                    LabeledContent {
                        Text(sync.map { $0.all_sources_total.formatted() } ?? "unknown").monospacedDigit()
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Uploaded")
                            Text(sync.map { "\($0.synced_total.formatted()) from this app; the rest from other sources" }
                                 ?? "Every photo you have uploaded, even ones not matched to a vehicle yet")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                NavigationLink { ProfilePhotosView(userId: userId, vehicles: vehicles) } label: {
                    LabeledContent("Filed to vehicles") {
                        Text(sync.map { $0.filed_total.formatted() } ?? "unknown").monospacedDigit()
                    }
                }
                NavigationLink { AnalyzedPhotosView(userId: userId) } label: {
                    LabeledContent("Analyzed") {
                        Text(sync.map { $0.analyzed_total.formatted() } ?? "unknown").monospacedDigit()
                    }
                }
                ForEach(held) { v in
                    LabeledContent("Intake holding area") {
                        Text("\(v.image_count.formatted()) photos · not a vehicle").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("On the record")
            } footer: {
                if let last = IngestionRefresh.parse(sync?.last_synced_at) {
                    Text("As of the last sync, \(last.formatted(date: .abbreviated, time: .shortened)).")
                } else if sync == nil {
                    Text("The sync ledger didn't answer; counts are unknown, not zero.")
                }
            }
        }
        .navigationTitle("Photos")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showAlbums) { LibraryAlbumsView(userId: userId) }
    }

    /// The on-device record, as the profile's old "Photo record" section said it.
    static func recordLines(_ e: LocalProfileEvidence?) -> [String] {
        guard let e else { return ["Albums and source photos"] }
        var lines: [String] = []
        if let visible = e.catalog.photos?.count { lines.append("\(visible.formatted()) accessible photos · \(e.reviewed.formatted()) read on-device") }
        lines.append(e.catalog.accessScope == "full"
                     ? "\(e.catalog.albums.count.formatted()) albums · \(e.matched.formatted()) serial matches"
                     : "Album coverage unknown")
        if e.unresolved > 0 { lines.append("\(e.unresolved.formatted()) vehicle frames awaiting identity") }
        return lines
    }
}

// ─── Garage counts ───────────────────────────────────────────────────────────

enum ProfileGarageCounts {
    /// "141 vehicles" over "2 owned · 2 other interests · 15 previously owned · 101 contributed · 14 documenting".
    static func headline(_ s: GarageSections) -> String {
        "\(s.total.formatted()) vehicle\(s.total == 1 ? "" : "s")"
    }

    static func detail(_ s: GarageSections, unresolved: Int) -> String {
        [s.parts, unresolved > 0 ? "\(unresolved.formatted()) identity pending" : nil]
            .compactMap { $0 }.joined(separator: " · ")
    }
}

/// Switches the app to its Garage tab. Set by MainTabView on the Profile tab; nil elsewhere, where the
/// profile pushes the same Garage screen instead.
private struct OpenGarageTabKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    var openGarageTab: (() -> Void)? {
        get { self[OpenGarageTabKey.self] }
        set { self[OpenGarageTabKey.self] = newValue }
    }
}
