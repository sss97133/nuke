// VehicleLocationSection.swift — where the vehicle has been, on the vehicle page.
//
// One read, the same the web header popup uses: `vehicle_location_areas(p_vehicle_id)` (any viewer,
// logged out included), the photo-GPS fold by area, largest first. It never carries a photo point:
// a city-level area draws a circle at its centroid, a county-level area draws the county outline.
// Signed in, `get_field_provenance(p_vehicle_id, 'location')` returns the same areas, and for the
// owner or uploader each area's `point` (the mean of that area's photos); anyone else gets null and the
// page never falls back to a photo's own EXIF. FIREBIRD.md open item 4 (owner 11-12: data must reach
// a screen). A vehicle with no located photos renders no card.

import MapKit
import SwiftUI

struct VehicleLocationArea: Decodable, Identifiable, Equatable {
    struct Point: Decodable, Equatable { let lat: Double; let lng: Double }
    let label: String?
    let level: String?
    let zcta: String?
    let county_fips: String?
    let county_name: String?
    let region_code: String?
    let photos: Int?
    let days: Int?
    let first_taken_at: String?
    let last_taken_at: String?
    let centroid: Point?
    /// Owner or uploader only (get_field_provenance); null for everyone else.
    let point: Point?

    /// One city can split into areas that share a label and differ in ZIP, so the key carries both.
    var id: String { "\(label ?? "")|\(zcta ?? "")|\(county_fips ?? "")" }

    /// Where the map marks this area, or nil when it draws the county outline instead.
    var mark: CLLocationCoordinate2D? {
        guard let p = point ?? centroid else { return nil }
        let c = CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng)
        return CLLocationCoordinate2DIsValid(c) ? c : nil
    }

    /// "451 photos over 6 days, Oct 2025 – Nov 2026"
    var summary: String {
        var parts: [String] = []
        if let n = photos { parts.append("\(n) photo\(n == 1 ? "" : "s")") }
        if let d = days { parts.append("over \(d) day\(d == 1 ? "" : "s")") }
        let span = Self.monthSpan(first_taken_at, last_taken_at)
        return [parts.joined(separator: " "), span].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    static func monthSpan(_ first: String?, _ last: String?) -> String {
        func month(_ s: String?) -> String? {
            guard let s, let d = ISO8601DateFormatter.flexible(s) else { return nil }
            let f = DateFormatter(); f.dateFormat = "MMM yyyy"; f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(identifier: "America/Los_Angeles")
            return f.string(from: d)
        }
        switch (month(first), month(last)) {
        case let (a?, b?) where a == b: return a
        case let (a?, b?): return "\(a) – \(b)"
        case let (a?, nil): return a
        case let (nil, b?): return b
        default: return ""
        }
    }
}

extension ISO8601DateFormatter {
    /// Postgres timestamps arrive with and without fractional seconds.
    static func flexible(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
}

enum VehicleLocationReader {
    /// Signed in: the provenance read (it adds `point` for the owner or uploader). Logged out, or when that
    /// read fails: the public area read. Both return the same area objects.
    static func areas(vehicleId: String) async -> [VehicleLocationArea]? {
        struct Provenance: Decodable { let location_areas: [VehicleLocationArea]? }
        if SupabaseService.currentUserId != nil,
           let p: Provenance = try? await SupabaseService.client
               .rpc("get_field_provenance", params: ["p_vehicle_id": vehicleId, "p_field": "location"])
               .execute().value,
           let areas = p.location_areas {
            return areas
        }
        return try? await SupabaseService.client
            .rpc("vehicle_location_areas", params: ["p_vehicle_id": vehicleId])
            .execute().value
    }
}

struct VehicleLocationSection: View {
    let vehicleId: String
    @State private var areas: [VehicleLocationArea]? = nil

    var body: some View {
        Group {
            if let areas, !areas.isEmpty { VehicleLocationCard(areas: areas) }
        }
        .task(id: vehicleId) { areas = await VehicleLocationReader.areas(vehicleId: vehicleId) }
    }
}

/// The render, separate from the read so a fixture drives it directly.
struct VehicleLocationCard: View {
    let areas: [VehicleLocationArea]
    @State private var counties: [String: [MKPolygon]] = [:]
    @State private var position: MapCameraPosition = .automatic

    var body: some View {
        VStack(alignment: .leading, spacing: NukeSpace.sm) {
            Text("Where it's been").font(.headline)
            Map(position: $position, interactionModes: [.pan, .zoom]) {
                ForEach(areas) { area in
                    if let c = area.mark {
                        MapCircle(center: c, radius: area.point != nil ? 400 : 3_000)
                            .stroke(Color.accentColor.opacity(0.6), lineWidth: 1)
                            .foregroundStyle(Color.accentColor.opacity(0.18))
                    } else if let fips = area.county_fips {
                        ForEach(Array((counties[fips] ?? []).enumerated()), id: \.offset) { _, polygon in
                            MapPolygon(polygon)
                                .stroke(Color.accentColor.opacity(0.6), lineWidth: 1)
                                .foregroundStyle(Color.accentColor.opacity(0.12))
                        }
                    }
                }
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll))
            .frame(height: 200)
            .clipShape(RoundedRectangle(cornerRadius: NukeRadius.small, style: .continuous))
            ForEach(areas) { area in
                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.title(area)).font(.subheadline.weight(.semibold))
                    Text(area.summary).font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
            Text("From photo GPS, grouped by area. Exact places stay private.")
                .font(.caption2).foregroundStyle(.tertiary)
        }
        .nukeCard()
        .task(id: areas.compactMap { $0.mark == nil ? $0.county_fips : nil }.joined(separator: "|")) { loadCounties() }
    }

    static func title(_ a: VehicleLocationArea) -> String {
        let base = a.label ?? [a.county_name.map { "\($0) County" }, a.region_code].compactMap { $0 }.joined(separator: ", ")
        if let z = a.zcta, !z.isEmpty { return "\(base) · \(z)" }
        return base.isEmpty ? "Unnamed area" : base
    }

    /// County outlines from the app's bundled county file (the market map's reader), only for areas with no mark.
    private func loadCounties() {
        for fips in Set(areas.filter { $0.mark == nil }.compactMap(\.county_fips)) where counties[fips] == nil {
            guard let geometry = try? CountyZIPGeometry.county(fips) else { continue }
            counties[fips] = geometry.outline.flatMap { shape -> [MKPolygon] in
                if let p = shape as? MKPolygon { return [p] }
                if let m = shape as? MKMultiPolygon { return m.polygons }
                return []
            }
        }
    }
}
