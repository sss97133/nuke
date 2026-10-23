// ProfilePhotos.swift — the owner's own photos, presented clean (presentation only; no data writes).
//
// Rules (pure, unit-tested in UnitTests/ProfilePhotosTests.swift):
//  * Placeholder vehicles (e.g. make "UNRESOLVED", model "Intake Quarantine …") are not real vehicles:
//    detected by name, never by id, and shown apart as a holding area.
//  * Copies collapse to one tile: rows flagged is_duplicate / is_superseded are dropped, and rows sharing a
//    file_hash keep one (the earliest uploaded).
//  * Rows matched 'unrelated' stay out of vehicle groupings (they go to Needs sorting).
//  * Everything is ordered by taken_at, newest first, under month sections, so an old camera-roll backfill
//    sits under its own year instead of interleaving with this year's sets.
//  * Unassigned photos form "Needs sorting", grouped into shoots (same day, gaps under 2 hours).
//
// Reader: get_user_profile_photos (migration 20261023210000). Before that is deployed the screen falls back to
// get_user_analyzed_photos, which has no hash/match fields; the same rules apply to what it does return.

import SwiftUI

struct ProfilePhoto: Decodable, Identifiable, Hashable {
    let id: UUID
    let url: String?
    let thumb: String?
    let vehicle_id: UUID?
    let taken_at: String?
    var created_at: String? = nil
    var file_name: String? = nil
    var file_hash: String? = nil
    var is_duplicate: Bool? = nil
    var is_superseded: Bool? = nil
    var duplicate_of: UUID? = nil
    var match_status: String? = nil
    var vehicle_year: Int? = nil
    var vehicle_make: String? = nil
    var vehicle_model: String? = nil

    var takenDate: Date? { PhotoPresentation.date(taken_at) ?? PhotoPresentation.date(created_at) }
    var isUnrelated: Bool { match_status?.lowercased() == "unrelated" }
}

enum PhotoPresentation {
    // ─── Placeholder vehicles ────────────────────────────────────────────────
    private static let placeholderMakes: Set<String> = ["unresolved", "placeholder", "unknown intake", "quarantine"]
    private static let placeholderWords = ["quarantine", "placeholder", "awaiting re-homing", "unresolved intake"]

    static func isPlaceholderVehicle(make: String?, model: String?) -> Bool {
        let mk = (make ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let md = (model ?? "").lowercased()
        if placeholderMakes.contains(mk) { return true }
        return placeholderWords.contains { md.contains($0) || mk.contains($0) }
    }

    // ─── Dedupe ──────────────────────────────────────────────────────────────
    static func collapse(_ photos: [ProfilePhoto]) -> [ProfilePhoto] {
        var seenHash = Set<String>(); var seenID = Set<UUID>(); var out: [ProfilePhoto] = []
        // Earliest upload wins within a hash, so the original stays and later copies fold into it.
        let ordered = photos.sorted { (date($0.created_at) ?? .distantFuture) < (date($1.created_at) ?? .distantFuture) }
        for p in ordered {
            if p.is_duplicate == true || p.is_superseded == true || p.duplicate_of != nil { continue }
            guard seenID.insert(p.id).inserted else { continue }
            if let h = p.file_hash?.trimmingCharacters(in: .whitespaces), !h.isEmpty, !seenHash.insert(h).inserted { continue }
            out.append(p)
        }
        return newestFirst(out)
    }

    static func newestFirst(_ photos: [ProfilePhoto]) -> [ProfilePhoto] {
        photos.sorted {
            let a = $0.takenDate ?? .distantPast, b = $1.takenDate ?? .distantPast
            return a == b ? $0.id.uuidString < $1.id.uuidString : a > b
        }
    }

    // ─── Grouping ────────────────────────────────────────────────────────────
    struct VehicleGroup: Identifiable, Equatable {
        let id: UUID
        let title: String
        let photos: [ProfilePhoto]
    }
    struct DateSection: Identifiable, Equatable {
        let id: String          // "2026-10"
        let title: String       // "October 2026"
        let photos: [ProfilePhoto]
    }
    struct Shoot: Identifiable, Equatable {
        let id: String
        let start: Date?
        let photos: [ProfilePhoto]
    }
    struct Layout: Equatable {
        var vehicles: [VehicleGroup] = []
        var byDate: [DateSection] = []       // assigned (real vehicle, not unrelated) photos
        var needsSorting: [Shoot] = []
        var held: Int = 0                    // photos on placeholder vehicles
        var unrelated: Int = 0
        var total: Int { byDate.reduce(0) { $0 + $1.photos.count } + needsSorting.reduce(0) { $0 + $1.photos.count } }
    }

    /// `names`: vehicle titles known from the garage (fallback when rows carry no vehicle name).
    /// `placeholders`: vehicle ids the garage identified as placeholders.
    static func layout(_ raw: [ProfilePhoto], names: [UUID: String] = [:], placeholders: Set<UUID> = [],
                       calendar: Calendar = .current) -> Layout {
        let photos = collapse(raw)
        var layout = Layout()
        var assigned: [ProfilePhoto] = []; var loose: [ProfilePhoto] = []
        var byVehicle: [UUID: [ProfilePhoto]] = [:]; var titles: [UUID: String] = [:]
        for p in photos {
            guard let vid = p.vehicle_id else { loose.append(p); continue }
            if placeholders.contains(vid) || isPlaceholderVehicle(make: p.vehicle_make, model: p.vehicle_model) {
                layout.held += 1; loose.append(p); continue
            }
            if p.isUnrelated { layout.unrelated += 1; loose.append(p); continue }
            assigned.append(p); byVehicle[vid, default: []].append(p)
            if titles[vid] == nil {
                let rowTitle = [p.vehicle_year.map(String.init), p.vehicle_make, p.vehicle_model].compactMap { $0 }
                    .filter { !$0.isEmpty }.joined(separator: " ")
                titles[vid] = names[vid] ?? (rowTitle.isEmpty ? "Vehicle" : rowTitle)
            }
        }
        layout.vehicles = byVehicle.map { VehicleGroup(id: $0.key, title: titles[$0.key] ?? "Vehicle", photos: $0.value) }
            .sorted {
                let a = $0.photos.first?.takenDate ?? .distantPast, b = $1.photos.first?.takenDate ?? .distantPast
                return a == b ? $0.title < $1.title : a > b
            }
        layout.byDate = monthSections(assigned, calendar: calendar)
        layout.needsSorting = shoots(loose, calendar: calendar)
        return layout
    }

    static func monthSections(_ photos: [ProfilePhoto], calendar: Calendar = .current) -> [DateSection] {
        let f = DateFormatter(); f.calendar = calendar; f.timeZone = calendar.timeZone; f.setLocalizedDateFormatFromTemplate("MMMM yyyy")
        var order: [String] = []; var buckets: [String: [ProfilePhoto]] = [:]; var titles: [String: String] = [:]
        for p in newestFirst(photos) {
            let key: String
            if let d = p.takenDate {
                let c = calendar.dateComponents([.year, .month], from: d)
                key = String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0); titles[key] = f.string(from: d)
            } else { key = "undated"; titles[key] = "Undated" }
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(p)
        }
        // Undated always last.
        order.sort { $0 == "undated" ? false : $1 == "undated" ? true : $0 > $1 }
        return order.map { DateSection(id: $0, title: titles[$0]!, photos: buckets[$0]!) }
    }

    /// A shoot = photos on the same calendar day with gaps under `gap`. Newest shoot first.
    static func shoots(_ photos: [ProfilePhoto], gap: TimeInterval = 2 * 3600, calendar: Calendar = .current) -> [Shoot] {
        let sorted = newestFirst(photos)
        var result: [Shoot] = []; var current: [ProfilePhoto] = []
        func flush() {
            guard let first = current.first else { return }
            let start = current.last?.takenDate
            result.append(Shoot(id: first.id.uuidString, start: start, photos: current)); current = []
        }
        var undated: [ProfilePhoto] = []
        for p in sorted {
            guard let d = p.takenDate else { undated.append(p); continue }
            if let prev = current.last?.takenDate, !(calendar.isDate(prev, inSameDayAs: d) && prev.timeIntervalSince(d) < gap) { flush() }
            current.append(p)
        }
        flush()
        if !undated.isEmpty { result.append(Shoot(id: "undated", start: nil, photos: undated)) }
        return result
    }

    static func date(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return d }
        if let d = ISO8601DateFormatter().date(from: raw) { return d }
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX")
        for format in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd'T'HH:mm:ssXXXXX", "yyyy-MM-dd HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd HH:mm:ssXXXXX"] {
            p.dateFormat = format; if let d = p.date(from: raw) { return d }
        }
        return nil
    }
}

private struct ProfilePhotosParams: Encodable { let p_user_id: String; let p_limit: Int }

struct ProfilePhotosView: View {
    let userId: String
    var vehicles: [GarageVehicle] = []

    enum Mode: String, CaseIterable, Identifiable { case date = "By date", vehicle = "By vehicle", sorting = "Needs sorting"; var id: String { rawValue } }
    @State private var mode = Mode.date
    @State private var layout = PhotoPresentation.Layout()
    @State private var loaded = false
    @State private var loadError: String?
    @State private var usedFallback = false
    @State private var selected: ProfilePhoto?
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        ScrollView {
            Picker("View", selection: $mode) {
                ForEach(Mode.allCases) { m in
                    Text(m == .sorting && !layout.needsSorting.isEmpty
                         ? "Needs sorting · \(layout.needsSorting.reduce(0) { $0 + $1.photos.count })" : m.rawValue).tag(m)
                }
            }
            .pickerStyle(.segmented).padding(.horizontal, 12).padding(.top, 8)

            if !loaded {
                ProgressView("Loading your photos…").padding(.top, 48)
            } else if let loadError {
                ContentUnavailableView {
                    Label(loadError, systemImage: "exclamationmark.triangle")
                } actions: { Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent) }
                .padding(.top, 32)
            } else {
                LazyVStack(alignment: .leading, spacing: 14, pinnedViews: [.sectionHeaders]) {
                    switch mode {
                    case .date:
                        if layout.byDate.isEmpty { empty("No photos on a vehicle yet") }
                        ForEach(layout.byDate) { s in section(s.title, count: s.photos.count, s.photos) }
                    case .vehicle:
                        if layout.vehicles.isEmpty { empty("No photos on a vehicle yet") }
                        ForEach(layout.vehicles) { g in section(g.title, count: g.photos.count, g.photos) }
                    case .sorting:
                        if layout.held > 0 || layout.unrelated > 0 {
                            Text(sortingNote).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14)
                        }
                        if layout.needsSorting.isEmpty { empty("Nothing to sort") }
                        ForEach(layout.needsSorting) { shoot in section(shootTitle(shoot), count: shoot.photos.count, shoot.photos) }
                    }
                    if usedFallback {
                        Text("Showing analyzed iOS photos only; copies and unrelated matches may not all be recognized yet.")
                            .font(.caption2).foregroundStyle(.tertiary).padding(.horizontal, 14)
                    }
                }
                .padding(.bottom, 24)
            }
        }
        .navigationTitle("Your photos")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(item: $selected) { photo in
            AnalyzedEvidenceView(photo: AnalyzedPhoto(id: photo.id, url: photo.url, thumb: photo.thumb, vehicle_id: photo.vehicle_id,
                taken_at: photo.taken_at, file_name: photo.file_name, scene: nil, phase: nil, intent: nil, components: nil,
                analyzed_at: nil, analyzed_by: nil))
        }
    }

    private var sortingNote: String {
        var parts: [String] = []
        if layout.held > 0 { parts.append("\(layout.held.formatted()) held in an intake holding area") }
        if layout.unrelated > 0 { parts.append("\(layout.unrelated.formatted()) marked not this vehicle") }
        return parts.joined(separator: " · ") + ". These are shown here instead of under a vehicle."
    }

    private func shootTitle(_ shoot: PhotoPresentation.Shoot) -> String {
        guard let start = shoot.start else { return "Undated" }
        return start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year().hour().minute())
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 32)
    }

    @ViewBuilder private func section(_ title: String, count: Int, _ photos: [ProfilePhoto]) -> some View {
        Section {
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(photos) { p in
                    Color(.secondarySystemFill).aspectRatio(1, contentMode: .fit)
                        .overlay {
                            CachedAsyncImage(url: NukeImage.thumb(p.thumb ?? p.url, width: 200)) { $0.resizable().scaledToFill() }
                                placeholder: { ProgressView().scaleEffect(0.7) }
                        }
                        .clipped().contentShape(Rectangle())
                        .onTapGesture { selected = p }
                }
            }
            .padding(.horizontal, 2)
        } header: {
            HStack {
                Text(title).font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(count.formatted())").font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(.bar)
        }
    }

    private func load() async {
        loadError = nil
        let names = Dictionary(vehicles.compactMap { v in UUID(uuidString: v.vehicle_id).map { ($0, v.title) } }, uniquingKeysWith: { a, _ in a })
        let held = Set(vehicles.filter(\.isPlaceholder).compactMap { UUID(uuidString: $0.vehicle_id) })
        do {
            let rows: [ProfilePhoto]
            do {
                rows = try await SupabaseService.client.rpc("get_user_profile_photos",
                    params: ProfilePhotosParams(p_user_id: userId, p_limit: 2000)).execute().value
                usedFallback = false
            } catch {
                // Not deployed yet (or failing): the analyzed-photo reader, same owner gate.
                NSLog("NukeCapture get_user_profile_photos unavailable, falling back: %@", String(describing: error))
                let analyzed: [AnalyzedPhoto] = try await SupabaseService.client.rpc("get_user_analyzed_photos",
                    params: ProfilePhotosParams(p_user_id: userId, p_limit: 500)).execute().value
                rows = analyzed.map { ProfilePhoto(id: $0.id, url: $0.url, thumb: $0.thumb, vehicle_id: $0.vehicle_id, taken_at: $0.taken_at, file_name: $0.file_name) }
                usedFallback = true
            }
            let result = await Task.detached(priority: .userInitiated) {
                PhotoPresentation.layout(rows, names: names, placeholders: held)
            }.value
            layout = result
        } catch {
            loadError = "Couldn't load your photos"
        }
        loaded = true
    }
}

extension GarageVehicle {
    /// Intake placeholders ("UNRESOLVED / Intake Quarantine …") are holding areas, not vehicles.
    var isPlaceholder: Bool { PhotoPresentation.isPlaceholderVehicle(make: make, model: model) }
}
