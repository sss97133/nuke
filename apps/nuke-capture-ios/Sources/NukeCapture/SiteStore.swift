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

import Foundation

/// One confirmed work site: a center coordinate and a radius in meters.
/// Codable → persisted as JSON in UserDefaults (device-local, never synced).
struct Site: Codable, Equatable {
    let name: String
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
    }

    func add(_ site: Site) {
        sites.append(site)
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(sites) {
            defaults.set(data, forKey: Self.key)
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
