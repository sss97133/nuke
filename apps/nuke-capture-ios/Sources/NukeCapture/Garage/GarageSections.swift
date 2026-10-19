// GarageSections.swift — how the garage groups and words the server's relationships.
//
// Ownership is the server's word, never inferred: a vehicle is owned only when get_user_garage (with
// the account's statements folded in) says "owner". Photographing or contributing to a vehicle makes
// it a contribution; the web keeps the same split (useVehiclesDashboard: OWNED vs CONTRIBUTED).

import Foundation

enum GarageRelation {
    static func isOwned(_ v: GarageVehicle) -> Bool { v.relationship == "owner" }

    static func line(_ v: GarageVehicle) -> String {
        switch v.relationship {
        case "owner": return "Owned"
        case "previously_owned": return "Previously owned"
        case "contributor": return "Your photos or records — not recorded as yours"
        default: return v.relationshipLabel
        }
    }

    /// What the vehicle's Work card offers before its reader states vehicle_access.
    static func postEntry(_ v: GarageVehicle, signedIn: Bool) -> VehicleWorkCard.PostEntry {
        VehicleWorkSection.postEntry(signedIn: signedIn, ownerContext: isOwned(v), jobs: .loading)
    }
}

struct GarageSections {
    struct Interest: Identifiable {
        let relationship: String
        let label: String
        let vehicles: [GarageVehicle]
        var id: String { relationship }
    }

    let owned: [GarageVehicle]
    /// Interests that are neither title nor contribution (consignment, claims, review), in a stable order.
    let other: [Interest]
    let previouslyOwned: [GarageVehicle]
    let contributed: [GarageVehicle]

    init(_ vehicles: [GarageVehicle]) {
        owned = vehicles.filter { $0.relationship == "owner" }
        previouslyOwned = vehicles.filter { $0.relationship == "previously_owned" }
        contributed = vehicles.filter { $0.relationship == "contributor" }
        let rest = Dictionary(grouping: vehicles.filter { !["owner", "previously_owned", "contributor"].contains($0.relationship) },
                              by: \.relationship)
        other = rest.keys.sorted().map { key in
            Interest(relationship: key, label: rest[key]?.first?.relationshipLabel ?? key, vehicles: rest[key] ?? [])
        }
    }

    var total: Int { owned.count + other.reduce(0) { $0 + $1.vehicles.count } + previouslyOwned.count + contributed.count }

    /// "6 owned · 7 previously owned · 117 contributed"; zero parts are left out.
    var parts: String {
        let otherCount = other.reduce(0) { $0 + $1.vehicles.count }
        return [
            "\(owned.count.formatted()) owned",
            otherCount > 0 ? "\(otherCount.formatted()) other interest\(otherCount == 1 ? "" : "s")" : nil,
            previouslyOwned.isEmpty ? nil : "\(previouslyOwned.count.formatted()) previously owned",
            contributed.isEmpty ? nil : "\(contributed.count.formatted()) contributed",
        ].compactMap { $0 }.joined(separator: " · ")
    }

    /// The list's denominator: every vehicle the record relates to the account, and when it was read.
    func coverage(readAt: Date?, cachedAt: Date? = nil) -> String {
        let head = "\(total.formatted()) vehicle\(total == 1 ? "" : "s") the record relates to your account: \(parts)"
        if let cachedAt {
            return head + " · saved \(cachedAt.formatted(date: .abbreviated, time: .shortened)), may be out of date"
        }
        return head + " · as of \(readAt.map { $0.formatted(date: .omitted, time: .shortened) } ?? "unknown time")"
    }
}

enum GarageCopy {
    static let organizeScope = "Review groups photos this app uploaded, with a capture date, by day and place. Photos from other sources or without a date still count here."
    static let noneOwned = "The record states no vehicle as yours. Photographing or contributing to a vehicle doesn't make it yours; a title or ownership record does."
    static let contributedFooter = "Vehicles you photographed or added records to. The record doesn't state you own them, so their Work card offers an inspection, not a job post."

    static func visibility(_ row: GarageVehicleRow) -> String {
        row.isPublic ? "Public — anyone can open its profile" : "Private — only you and accounts it's shared with"
    }

    static func removal(_ row: GarageVehicleRow) -> String? {
        if row.merged_into_vehicle_id != nil { return "Merged into another vehicle record" }
        if let at = row.deleted_at { return "Removed from the record on \(at.prefix(10))" }
        return nil
    }
}
