// LibraryVehicleTags.swift — which vehicle each Library photo is associated with.
//
// A device photo maps to its uploaded rows by the asset id stamped at upload
// (vehicle_images.exif_data.uuid == PHAsset.localIdentifier, source capture_relay_ios).
// Three things stay distinct on screen:
//   • attached  — a live row's vehicle_id (solid tag; a vision gate hold is stated on it)
//   • suggested — auto_suggested_vehicle_id / suggested_vehicle_id, never confirmed (dashed tag)
//   • nothing   — no recorded vehicle: no tag, never a guess
// A merged vehicle shows as its survivor; a placeholder record (make UNRESOLVED, the intake
// quarantine) is not a vehicle, so a photo held there shows no tag and the viewer says so.
// One keyset-paged read of the account's rows that carry a vehicle or a suggestion, plus one
// read of those vehicles' names, cached in memory. Grid cells only look up a dictionary.

import SwiftUI

/// One `vehicle_images` row for a device photo, as the Library reads it.
struct LibraryVehicleRow: Decodable, Sendable, Equatable {
    let id: String
    let local_uuid: String?
    let vehicle_id: String?
    var suggested_vehicle_id: String? = nil
    var auto_suggested_vehicle_id: String? = nil
    var vision_gate_status: String? = nil
    var is_superseded: Bool? = nil
}

/// Why an attached photo is kept off its vehicle's pages (`vision_gate_status`).
enum LibraryVehicleHold: String, Equatable, Sendable {
    case differentVehicle = "rejected_misattributed"
    case personal = "rejected_personal"
    case review = "review_needed"

    var detail: String {
        switch self {
        case .differentVehicle: return "The vision check says this photo shows a different vehicle"
        case .personal: return "Held from vehicle pages as personal"
        case .review: return "Held for review"
        }
    }
}

enum LibraryVehicleSuggestionSource: Equatable, Sendable {
    case attribution   // auto_suggested_vehicle_id (the phone's attribution pass)
    case matcher       // suggested_vehicle_id (a server matcher)

    var detail: String {
        switch self {
        case .attribution: return "Suggested by photo attribution · not confirmed"
        case .matcher: return "Suggested by an automated matcher · not confirmed"
        }
    }
}

enum LibraryVehicleTag: Equatable, Sendable {
    case attached(vehicleId: String, hold: LibraryVehicleHold?)
    case suggested(vehicleId: String, source: LibraryVehicleSuggestionSource)
    /// Live rows name more than one vehicle; none is chosen for the reader.
    case several(vehicleIds: [String], confirmed: Bool)

    var vehicleIds: [String] {
        switch self {
        case .attached(let id, _), .suggested(let id, _): return [id]
        case .several(let ids, _): return ids
        }
    }
}

/// The vehicle's name, in the Garage's format.
struct LibraryVehicleName: Decodable, Sendable, Equatable {
    let id: String
    let year: Int?
    let make: String?
    let model: String?
    var trim: String? = nil
    var merged_into_vehicle_id: String? = nil

    /// A holding record such as the intake quarantine, not a vehicle.
    var isPlaceholder: Bool { make?.trimmingCharacters(in: .whitespaces).uppercased() == "UNRESOLVED" }

    private static func clean(_ parts: [String?]) -> [String] {
        parts.compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.uppercased() != "UNRESOLVED" }
    }

    /// "1972 Chevrolet K5 Blazer Cheyenne" (GarageVehicle.title); nil when nothing names it.
    var full: String? {
        let parts = Self.clean([year.map(String.init), make, model, trim])
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    /// "1972 K5 Blazer" for a grid cell: year and model, the make only without a model.
    var short: String? {
        let named = Self.clean([model]).isEmpty ? Self.clean([make]) : Self.clean([model])
        let parts = Self.clean([year.map(String.init)]) + named
        return named.isEmpty ? nil : parts.joined(separator: " ")
    }
}

enum LibraryVehicleTags {
    /// Resolve each device photo from its rows. Superseded rows never count; a photo with no
    /// attached or suggested vehicle has no entry.
    static func resolve(_ rows: [LibraryVehicleRow]) -> [String: LibraryVehicleTag] {
        var byAsset: [String: [LibraryVehicleRow]] = [:]
        for row in rows where row.is_superseded != true {
            guard let lid = row.local_uuid, !lid.isEmpty else { continue }
            byAsset[lid, default: []].append(row)
        }
        var out: [String: LibraryVehicleTag] = [:]
        for (lid, live) in byAsset {
            if let tag = tag(for: live) { out[lid] = tag }
        }
        return out
    }

    static func tag(for live: [LibraryVehicleRow]) -> LibraryVehicleTag? {
        let attached = distinct(live.compactMap(\.vehicle_id))
        if attached.count > 1 { return .several(vehicleIds: attached, confirmed: true) }
        if let vehicleId = attached.first {
            let rows = live.filter { $0.vehicle_id?.lowercased() == vehicleId }
            // One unheld row (approved, pending or never gated) clears the hold.
            let holds = rows.map { $0.vision_gate_status.flatMap(LibraryVehicleHold.init(rawValue:)) }
            if holds.contains(where: { $0 == nil }) { return .attached(vehicleId: vehicleId, hold: nil) }
            let strongest: [LibraryVehicleHold] = [.differentVehicle, .personal, .review]
            return .attached(vehicleId: vehicleId, hold: strongest.first { h in holds.contains(h) })
        }
        let auto = distinct(live.compactMap(\.auto_suggested_vehicle_id))
        let matcher = distinct(live.compactMap(\.suggested_vehicle_id))
        let all = distinct(auto + matcher)
        if all.count > 1 { return .several(vehicleIds: all, confirmed: false) }
        if let id = auto.first { return .suggested(vehicleId: id, source: .attribution) }
        if let id = matcher.first { return .suggested(vehicleId: id, source: .matcher) }
        return nil
    }

    /// Every vehicle id the rows name, for the one names read.
    static func vehicleIds(in rows: [LibraryVehicleRow]) -> [String] {
        distinct(rows.flatMap { [$0.vehicle_id, $0.suggested_vehicle_id, $0.auto_suggested_vehicle_id].compactMap { $0 } }).sorted()
    }

    /// Rows restated against `names`: a merged vehicle becomes its survivor, and a placeholder
    /// record (the intake quarantine) is not a vehicle, so its id is dropped.
    static func restated(_ rows: [LibraryVehicleRow], names: [String: LibraryVehicleName]) -> [LibraryVehicleRow] {
        func vehicle(_ id: String?) -> String? {
            guard var current = id?.lowercased() else { return nil }
            for _ in 0..<4 {
                guard let next = names[current]?.merged_into_vehicle_id?.lowercased(), next != current else { break }
                current = next
            }
            return names[current]?.isPlaceholder == true ? nil : current
        }
        return rows.map { row in
            var r = LibraryVehicleRow(id: row.id, local_uuid: row.local_uuid, vehicle_id: vehicle(row.vehicle_id))
            r.suggested_vehicle_id = vehicle(row.suggested_vehicle_id)
            r.auto_suggested_vehicle_id = vehicle(row.auto_suggested_vehicle_id)
            r.vision_gate_status = row.vision_gate_status
            r.is_superseded = row.is_superseded
            return r
        }
    }

    /// Photos whose live rows name only placeholder records: no tag, and the viewer says why.
    static func placeholdered(_ rows: [LibraryVehicleRow], names: [String: LibraryVehicleName]) -> Set<String> {
        let tagged = Set(resolve(restated(rows, names: names)).keys)
        var out = Set<String>()
        for row in rows where row.is_superseded != true {
            guard let lid = row.local_uuid, !tagged.contains(lid) else { continue }
            let ids = [row.vehicle_id, row.suggested_vehicle_id, row.auto_suggested_vehicle_id].compactMap { $0?.lowercased() }
            if ids.contains(where: { names[$0]?.isPlaceholder == true }) { out.insert(lid) }
        }
        return out
    }

    static func distinct(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        return ids.map { $0.lowercased() }.filter { seen.insert($0).inserted }
    }
}

// MARK: - Store

@MainActor
final class LibraryVehicleTagStore: ObservableObject {
    static let shared = LibraryVehicleTagStore()

    @Published private(set) var tags: [String: LibraryVehicleTag] = [:]
    @Published private(set) var names: [String: LibraryVehicleName] = [:]
    /// Photos whose rows sit only on a placeholder record such as the intake quarantine.
    @Published private(set) var placeholdered: Set<String> = []
    @Published private(set) var loadedAt: Date?
    @Published private(set) var failure: String?
    /// The page cap was reached; photos past it show no tag.
    @Published private(set) var truncated = false

    private var userId: String?
    private var loading = false
    private static let pageSize = 1000
    private static let maxPages = 50
    static var rowCap: Int { pageSize * maxPages }

    func tag(for localIdentifier: String) -> LibraryVehicleTag? { tags[localIdentifier] }

    func shortName(_ vehicleId: String) -> String { names[vehicleId]?.short ?? "Vehicle" }
    func fullName(_ vehicleId: String) -> String { names[vehicleId]?.full ?? "Unnamed vehicle" }

    func refreshIfStale(maxAge: TimeInterval = 300) async {
        guard let uid = SupabaseService.currentUserId else {
            tags = [:]; names = [:]; placeholdered = []; loadedAt = nil; userId = nil
            return
        }
        if uid == userId, let loadedAt, Date().timeIntervalSince(loadedAt) < maxAge { return }
        await refresh(userId: uid)
    }

    private func refresh(userId uid: String) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if uid != userId { tags = [:]; names = [:]; placeholdered = []; loadedAt = nil }
        do {
            var rows: [LibraryVehicleRow] = []
            var after: String?
            var pages = 0
            repeat {
                var query = SupabaseService.client.from("vehicle_images")
                    .select("id,local_uuid:exif_data->>uuid,vehicle_id,suggested_vehicle_id,auto_suggested_vehicle_id,vision_gate_status,is_superseded")
                    .eq("user_id", value: uid)
                    .eq("source", value: Config.sourceTag)
                    .not("is_superseded", operator: .is, value: true)
                    .or("vehicle_id.not.is.null,suggested_vehicle_id.not.is.null,auto_suggested_vehicle_id.not.is.null")
                if let after { query = query.gt("id", value: after) }
                let page: [LibraryVehicleRow] = try await query.order("id").limit(Self.pageSize).execute().value
                rows += page
                pages += 1
                after = page.count == Self.pageSize ? page.last?.id : nil
            } while after != nil && pages < Self.maxPages
            var found: [String: LibraryVehicleName] = [:]
            var wanted = LibraryVehicleTags.vehicleIds(in: rows)
            for _ in 0..<3 where !wanted.isEmpty {
                for start in stride(from: 0, to: wanted.count, by: 200) {
                    let chunk = Array(wanted[start..<min(start + 200, wanted.count)])
                    let page: [LibraryVehicleName] = try await SupabaseService.client.from("vehicles")
                        .select("id,year,make,model,trim,merged_into_vehicle_id").in("id", values: chunk).execute().value
                    for name in page { found[name.id.lowercased()] = name }
                }
                let asked = Set(wanted)
                wanted = LibraryVehicleTags.distinct(found.values.compactMap(\.merged_into_vehicle_id))
                    .filter { found[$0] == nil && !asked.contains($0) }
            }
            let resolved = LibraryVehicleTags.resolve(LibraryVehicleTags.restated(rows, names: found))
            let unnamed = Set(resolved.values.flatMap(\.vehicleIds)).filter { found[$0] == nil }
            if !unnamed.isEmpty {
                let mirrored = await Task.detached {
                    unnamed.compactMap { id in LocalStore.shared.garageVehicleLabel(vehicleId: id).map { (id, $0) } }
                }.value
                for (id, label) in mirrored { found[id] = LibraryVehicleName(id: id, year: nil, make: label, model: nil) }
            }
            userId = uid
            tags = resolved
            placeholdered = LibraryVehicleTags.placeholdered(rows, names: found)
            names = found
            truncated = after != nil
            loadedAt = Date()
            failure = nil
        } catch {
            failure = ReadFailure.text(error)
            NSLog("NukeCapture library vehicle tags failed: %@", String(describing: error))
        }
    }
}

// MARK: - Views

/// The grid's tag: a small capsule. Solid for an attached vehicle, dashed for a suggestion.
struct LibraryVehicleTagChip: View {
    let tag: LibraryVehicleTag
    @ObservedObject private var store = LibraryVehicleTagStore.shared

    var body: some View {
        let suggested = !isConfirmed
        HStack(spacing: 2) {
            Image(systemName: glyph).font(.system(size: 7, weight: .bold))
            Text(text).font(.system(size: 9, weight: .semibold)).lineLimit(1).truncationMode(.tail)
        }
        .foregroundStyle(.white.opacity(suggested ? 0.9 : 1))
        .padding(.horizontal, 4).padding(.vertical, 2)
        .background(.black.opacity(suggested ? 0.35 : 0.6), in: Capsule())
        .overlay {
            if suggested {
                Capsule().strokeBorder(.white.opacity(0.85), style: StrokeStyle(lineWidth: 0.75, dash: [2, 1.5]))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LibraryVehicleTagLine.accessibility(tag, name: store.fullName))
    }

    private var isConfirmed: Bool {
        switch tag {
        case .attached: return true
        case .suggested: return false
        case .several(_, let confirmed): return confirmed
        }
    }

    private var glyph: String {
        switch tag {
        case .attached(_, nil): return "car.fill"
        case .attached(_, .some(.differentVehicle)): return "exclamationmark.triangle.fill"
        case .attached(_, .some): return "eye.slash.fill"
        case .suggested: return "car"
        case .several: return "car.2"
        }
    }

    private var text: String {
        switch tag {
        case .attached(let id, _), .suggested(let id, _): return store.shortName(id)
        case .several(let ids, _): return "\(ids.count) vehicles"
        }
    }
}

enum LibraryVehicleTagLine {
    static func accessibility(_ tag: LibraryVehicleTag, name: (String) -> String) -> String {
        switch tag {
        case .attached(let id, let hold): return "Attached to \(name(id))" + (hold.map { ". \($0.detail)" } ?? "")
        case .suggested(let id, _): return "Suggested: \(name(id)). Not confirmed"
        case .several(let ids, let confirmed):
            return "\(confirmed ? "Attached to" : "Suggested:") \(ids.count) vehicles: " + ids.map(name).joined(separator: ", ")
        }
    }
}

/// The fullscreen viewer's tag: the vehicle's full name, its basis, and a tap to its profile.
struct LibraryVehicleTagBar: View {
    let localIdentifier: String?
    @ObservedObject private var store = LibraryVehicleTagStore.shared
    @State private var opened: OpenedVehicle?

    private struct OpenedVehicle: Identifiable { let id: String }

    var body: some View {
        Group {
            if let lid = localIdentifier, let tag = store.tag(for: lid) {
                content(tag)
            } else if let lid = localIdentifier, store.placeholdered.contains(lid) {
                caption("Not on a vehicle yet · held on a placeholder record")
            } else if store.truncated {
                caption("Vehicle links past the first \(LibraryVehicleTagStore.rowCap.formatted()) rows are not loaded")
            } else if store.loadedAt != nil {
                caption("No vehicle recorded for this photo")
            } else if let failure = store.failure {
                caption("Vehicle link unavailable: \(failure)")
            }
        }
        .sheet(item: $opened) { VehicleDetailView(vehicleId: $0.id) }
    }

    @ViewBuilder private func content(_ tag: LibraryVehicleTag) -> some View {
        switch tag {
        case .attached(let id, let hold):
            button(id: id, title: store.fullName(id), glyph: hold == nil ? "car.fill" : "exclamationmark.triangle.fill",
                   detail: hold.map { "Attached · \($0.detail)" } ?? "Attached", suggested: false)
        case .suggested(let id, let source):
            button(id: id, title: "Suggested: \(store.fullName(id))", glyph: "car", detail: source.detail, suggested: true)
        case .several(let ids, let confirmed):
            Menu {
                ForEach(ids, id: \.self) { id in
                    Button(store.fullName(id)) { opened = OpenedVehicle(id: id) }
                }
            } label: {
                label(title: "\(ids.count) vehicles", glyph: "car.2",
                      detail: confirmed ? "Attached to more than one vehicle" : "Several suggestions · not confirmed",
                      suggested: !confirmed)
            }
        }
    }

    private func button(id: String, title: String, glyph: String, detail: String, suggested: Bool) -> some View {
        Button { opened = OpenedVehicle(id: id) } label: {
            label(title: title, glyph: glyph, detail: detail, suggested: suggested)
        }
        .buttonStyle(.plain)
    }

    private func label(title: String, glyph: String, detail: String, suggested: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: glyph).font(.subheadline.weight(.semibold))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(detail).font(.caption2).foregroundStyle(.white.opacity(0.75)).lineLimit(2)
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.7))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.black.opacity(suggested ? 0.35 : 0.6), in: Capsule())
        .overlay {
            if suggested {
                Capsule().strokeBorder(.white.opacity(0.85), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            }
        }
        .contentShape(Capsule())
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.caption).foregroundStyle(.white.opacity(0.7))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(.black.opacity(0.4), in: Capsule())
    }
}
