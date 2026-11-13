// GarageSections.swift — how the garage groups and words the server's relationships.
//
// Ownership is the server's word, never inferred: a vehicle is owned only when get_user_garage says
// "owner". The account's own statements ("I own this") show beside the relationship as testimony and
// can take a car out of Owned (dispute, transfer pending), never put one in. Photographing or contributing to a vehicle makes
// it a contribution; the web keeps the same split (useVehiclesDashboard: OWNED vs CONTRIBUTED).

import Foundation

enum GarageRelation {
    static func isOwned(_ v: GarageVehicle) -> Bool { v.relationship == "owner" }

    static func line(_ v: GarageVehicle) -> String {
        switch v.relationship {
        case "owner": return "Owned"
        case "previously_owned": return "Previously owned"
        case "contributor": return "Your photos or records — not recorded as yours"
        case "documenting": return "You're documenting it — not recorded as yours"
        case "profile_record": return "Profile you added"
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
    /// Vehicles the account documents (e.g. a dealer's inventory it photographs): beside contributions, never owned.
    let documenting: [GarageVehicle]

    init(_ vehicles: [GarageVehicle]) {
        owned = vehicles.filter { $0.relationship == "owner" }
        previouslyOwned = vehicles.filter { $0.relationship == "previously_owned" }
        contributed = vehicles.filter { $0.relationship == "contributor" }
        documenting = vehicles.filter { $0.relationship == "documenting" }
        let rest = Dictionary(grouping: vehicles.filter { !["owner", "previously_owned", "contributor", "documenting"].contains($0.relationship) },
                              by: \.relationship)
        other = rest.keys.sorted().map { key in
            Interest(relationship: key, label: rest[key]?.first?.relationshipLabel ?? key, vehicles: rest[key] ?? [])
        }
    }

    /// Search the records already read for this account, including zero-photo
    /// profiles. Titles and stored identifiers are search keys, not proof.
    static func matching(_ vehicles: [GarageVehicle], query: String) -> [GarageVehicle] {
        let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return vehicles }
        return vehicles.filter { vehicle in
            let text = [vehicle.title, vehicle.vin ?? "", vehicle.relationshipLabel].joined(separator: " ")
            return words.allSatisfy { text.localizedStandardContains($0) }
        }
    }

    var total: Int { owned.count + other.reduce(0) { $0 + $1.vehicles.count } + previouslyOwned.count + contributed.count + documenting.count }

    /// "6 owned · 7 previously owned · 117 contributed"; zero parts are left out.
    var parts: String {
        let otherCount = other.reduce(0) { $0 + $1.vehicles.count }
        return [
            "\(owned.count.formatted()) owned",
            otherCount > 0 ? "\(otherCount.formatted()) other interest\(otherCount == 1 ? "" : "s")" : nil,
            previouslyOwned.isEmpty ? nil : "\(previouslyOwned.count.formatted()) previously owned",
            contributed.isEmpty ? nil : "\(contributed.count.formatted()) contributed",
            documenting.isEmpty ? nil : "\(documenting.count.formatted()) documenting",
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
    static let documentingFooter = "Vehicles you're documenting, such as inventory you photograph for a business. Documenting a vehicle doesn't make it yours."
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
