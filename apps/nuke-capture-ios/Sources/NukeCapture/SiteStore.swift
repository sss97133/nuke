// SiteStore.swift — confirmed work sites: the on-device privacy gate's source.
//
// IGNITION (first run) clusters the library's GPS photos and the owner
// confirms SITE 01/02/… — those confirmed sites persist here and become the
// gate the SyncEngine checks before any photo leaves the phone.
//
// MIGRATION: when no site has been confirmed yet (existing installs that
// predate ignition, or an owner who rejected every candidate), the gate
// falls back to the hardcoded Config.shopLocations list — exactly the
// behavior shipped before ignition existed. Nothing gets MORE permissive by
// default.

import CoreLocation
import Foundation

/// One confirmed work site: a center coordinate and a radius in meters.
/// Codable → persisted as JSON in UserDefaults (device-local, never synced).
struct Site: Codable, Equatable {
    var name: String            // renameable later (Account sheet) — optional, never gated on
    let latitude: Double
    let longitude: Double
    let radiusMeters: Double
}

@MainActor
final class SiteStore: ObservableObject {
    static let shared = SiteStore()

    @Published private(set) var sites: [Site]

    private static let key = "confirmedSites"
    private let defaults = UserDefaults.standard

    private init() {
        if let data = defaults.data(forKey: Self.key),
           let decoded = try? JSONDecoder().decode([Site].self, from: data) {
            sites = decoded
        } else {
            sites = []
        }
        // Lazily geocode any sites still carrying SITE-serial names.
        geocodeStaleSerials()
    }

    func add(_ site: Site) {
        sites.append(site)
        persist()
        // Geocode the new site — fire and forget; serial name stays on failure.
        let index = sites.count - 1
        geocodeIfSerial(at: index)
    }

    /// Rename a confirmed site (Account sheet). Empty names fall back to
    /// nothing — the stored name only changes when there's a real value.
    func rename(at index: Int, to name: String) {
        guard sites.indices.contains(index) else { return }
        sites[index].name = name
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(sites) {
            defaults.set(data, forKey: Self.key)
        }
    }

    /// Geocode any SITE-serial names (SITE 01/02/…) and rename to a street
    /// address or locality. Fire-and-forget: failure leaves the serial name.
    /// Called on add() and lazily on load for pre-existing serials.
    func geocodeStaleSerials() {
        for index in sites.indices where isSiteName(sites[index].name) {
            geocodeIfSerial(at: index)
        }
    }

    // Matches the SITE NN default names assigned at ignition confirm.
    private func isSiteName(_ name: String) -> Bool {
        name.range(of: #"^SITE \d{2}$"#, options: .regularExpression) != nil
    }

    private func geocodeIfSerial(at index: Int) {
        guard sites.indices.contains(index), isSiteName(sites[index].name) else { return }
        let lat = sites[index].latitude
        let lon = sites[index].longitude
        let location = CLLocation(latitude: lat, longitude: lon)
        Task {
            let geocoder = CLGeocoder()
            guard let placemarks = try? await geocoder.reverseGeocodeLocation(location),
                  let mark = placemarks.first else { return }
            // Prefer street address; fall back to locality (city/town).
            let name = [mark.subThoroughfare, mark.thoroughfare]
                .compactMap { $0 }
                .joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            let resolved = name.isEmpty ? (mark.locality ?? mark.name ?? "") : name
            guard !resolved.isEmpty else { return }
            await MainActor.run {
                guard self.sites.indices.contains(index),
                      self.isSiteName(self.sites[index].name) else { return }
                self.sites[index].name = resolved
                self.persist()
            }
        }
    }

    /// The gate. Confirmed sites win; with none confirmed, the hardcoded
    /// Config.shopLocations box-check applies (migration default).
    func isAtSite(latitude: Double, longitude: Double) -> Bool {
        guard !sites.isEmpty else {
            return Config.isAtShop(latitude: latitude, longitude: longitude)
        }
        return sites.contains { site in
            Geo.distanceMeters(
                lat1: latitude, lon1: longitude,
                lat2: site.latitude, lon2: site.longitude
            ) <= site.radiusMeters
        }
    }
}

/// Haversine distance — good to <0.5% at site scale, no CoreLocation import
/// needed (the app deliberately never links CoreLocation; see #269).
enum Geo {
    static func distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let r = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180)
            * sin(dLon / 2) * sin(dLon / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
