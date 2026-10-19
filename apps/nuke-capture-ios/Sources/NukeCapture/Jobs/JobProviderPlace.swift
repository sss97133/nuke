// JobProviderPlace.swift — who is doing a job and where, as work_order_provider_place_read states it.
//
// The reader (migration 20261020071500) returns the organization the work order is filed under (the
// shop card), the people on the job (accepted providers by Sign, recorded assignment rows apart), where
// the work happens when a confirmed facility reservation says so, the vehicle's city, and a progress
// tracker derived on the server from the job path. The phone decides nothing here:
//   - A street address, a pin, Directions and a phone number exist only when the server sent them, which
//     it does only for a public storefront business. A person's place is a city-level band, never a pin.
//   - Each tracker step keeps its evidence (Sign, record, status) and its clock; testimony is a count
//     beside a step and never moves it. No step is inferred and no time is estimated.
// Decoding is tolerant: a missing block reads as "not reported", an unknown state as `.unknown`.

import Foundation

struct JobProviderPlace: Equatable {
    struct Place: Equatable {
        let city: String?
        let state: String?
        let zipCode: String?
        let streetAddress: String?
        let latitude: Double?
        let longitude: Double?
        /// coordinates | street | city | state | none
        let precision: String
        let storefront: Bool
        let directions: Bool
        let phone: String?
        let basis: String?
        let recordUpdatedAt: String?

        var cityLine: String? {
            let parts = [city, state].compactMap { $0 }
            return parts.isEmpty ? nil : parts.joined(separator: ", ")
        }

        /// A precise pin only for a storefront the server located; everything else is city-level.
        var pin: (latitude: Double, longitude: Double)? {
            guard storefront, precision == "coordinates", let latitude, let longitude else { return nil }
            return (latitude, longitude)
        }
    }

    struct Rating: Equatable {
        let state: String
        let value: Double?
        let reviews: Int?
        let basis: String?
    }

    struct Shop: Equatable {
        /// public | private | not_public | none
        let state: String
        let organizationId: String?
        let name: String?
        let logoUrl: String?
        let entityType: String?
        let rating: Rating?
        /// Hours exactly as written on the record, sorted by their key.
        let hours: [(key: String, value: String)]
        let hoursRecorded: Bool
        let place: Place?
        let basis: String?

        static func == (a: Shop, b: Shop) -> Bool {
            a.state == b.state && a.organizationId == b.organizationId && a.name == b.name && a.logoUrl == b.logoUrl
                && a.entityType == b.entityType && a.rating == b.rating && a.hoursRecorded == b.hoursRecorded
                && a.hours.map(\.key) == b.hours.map(\.key) && a.hours.map(\.value) == b.hours.map(\.value)
                && a.place == b.place && a.basis == b.basis
        }
    }

    struct Band: Equatable {
        /// declared | not_declared | withheld | not_assessed
        let state: String
        let city: String?
        let stateCode: String?
        let radiusMiles: Int?
        let mobile: Bool?
        let basis: String?
    }

    struct Person: Equatable, Identifiable {
        let id: String
        let person: JobPerson
        let roles: [String]
        /// True for an accepted offer (the customer's Sign); false for a recorded assignment row.
        let signed: Bool
        let acceptedAt: String?
        let statuses: [String: Int]
        let serviceArea: Band?
        let availabilityState: String?
        let availabilityDays: [String]
    }

    enum StepState: Equatable {
        case reached, partial, statusOnly, notYet, withheld
        case unknown(String)

        init(_ raw: String?) {
            switch raw {
            case "reached": self = .reached
            case "partial": self = .partial
            case "status_only": self = .statusOnly
            case "not_yet": self = .notYet
            case "withheld": self = .withheld
            default: self = .unknown(raw ?? "")
            }
        }
    }

    struct Step: Equatable, Identifiable {
        let key: String
        let label: String
        let state: StepState
        /// sign | record | status, as the server stated it; nil when nothing is recorded.
        let evidence: String?
        let clock: String?
        let clockBasis: String?
        let basis: String?
        let reports: Int
        let conflicting: Bool
        let customerAccepted: Bool
        var id: String { key }
    }

    let asOf: String?
    let shop: Shop
    let acceptedProviders: [Person]
    let recordedPeople: [Person]
    let workSiteState: String
    let workSitePlace: Place?
    let workSiteOrganization: String?
    let workSiteBasis: String?
    let vehiclePlace: Place?
    let steps: [Step]
    let currentStep: String?
    let viewerContext: String?
}

extension JobProviderPlace: Decodable {
    init(from decoder: Decoder) throws {
        let j = try JobJSON(from: decoder)
        guard case .object = j else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "provider place is not an object"))
        }
        asOf = j["as_of"]?.stringValue
        shop = Self.parseShop(j["shop"])
        let people = j["people"]
        acceptedProviders = (people?["accepted_providers"]?.arrayItems ?? []).enumerated().map { Self.parsePerson($0.element, index: $0.offset, signed: true) }
        recordedPeople = (people?["recorded_assignments"]?.arrayItems ?? []).enumerated().map { Self.parsePerson($0.element, index: $0.offset, signed: false) }
        let site = j["work_site"]
        workSiteState = site?["state"]?.stringValue ?? "not_reported"
        workSitePlace = Self.parsePlace(site?["place"])
        workSiteOrganization = site?["organization"]?.stringValue
        workSiteBasis = site?["basis"]?.stringValue
        vehiclePlace = Self.parsePlace(j["vehicle_place"])
        let tracker = j["tracker"]
        steps = (tracker?["steps"]?.arrayItems ?? []).compactMap(Self.parseStep)
        currentStep = tracker?["current_step"]?.stringValue
        viewerContext = j["viewer"]?["context"]?.stringValue
    }

    static func parsePlace(_ j: JobJSON?) -> Place? {
        guard let j, case .object = j else { return nil }
        let coords = j["coordinates"]
        return Place(city: j["city"]?.stringValue, state: j["state"]?.stringValue, zipCode: j["zip_code"]?.stringValue,
                     streetAddress: j["street_address"]?.stringValue,
                     latitude: coords?["latitude"]?.doubleValue, longitude: coords?["longitude"]?.doubleValue,
                     precision: j["precision"]?.stringValue ?? "none", storefront: j["storefront"]?.boolValue ?? false,
                     directions: j["directions"]?.boolValue ?? false, phone: j["phone"]?.stringValue,
                     basis: j["basis"]?.stringValue, recordUpdatedAt: j["record_updated_at"]?.stringValue)
    }

    static func parseShop(_ j: JobJSON?) -> Shop {
        guard let j, case .object = j else {
            return Shop(state: "not_reported", organizationId: nil, name: nil, logoUrl: nil, entityType: nil, rating: nil,
                        hours: [], hoursRecorded: false, place: nil, basis: nil)
        }
        let r = j["rating"]
        let rating = r.flatMap { r -> Rating? in
            guard let s = r["state"]?.stringValue else { return nil }
            return Rating(state: s, value: r["value"]?.doubleValue, reviews: r["reviews"]?.intValue, basis: r["basis"]?.stringValue)
        }
        var hours: [(key: String, value: String)] = []
        if case .object(let o)? = j["hours"]?["as_recorded"] {
            hours = o.keys.sorted().compactMap { k in o[k]?.stringValue.map { (key: k, value: $0) } }
        }
        return Shop(state: j["state"]?.stringValue ?? "not_reported", organizationId: j["organization_id"]?.stringValue,
                    name: j["name"]?.stringValue, logoUrl: j["logo_url"]?.stringValue, entityType: j["entity_type"]?.stringValue,
                    rating: rating, hours: hours, hoursRecorded: j["hours"]?["state"]?.stringValue == "recorded" && !hours.isEmpty,
                    place: parsePlace(j["place"]), basis: j["basis"]?.stringValue)
    }

    static func parsePerson(_ j: JobJSON, index: Int, signed: Bool) -> Person {
        let p = j["person"]
        func str(_ k: String) -> String? {
            p?[k]?.stringValue.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        }
        let label = JobPerson(kind: str("kind"), profileId: str("profile_id"), handle: str("handle"), label: str("label") ?? "unnamed party")
        var statuses: [String: Int] = [:]
        if case .object(let o)? = j["statuses"] { for (k, v) in o { if let n = v.intValue { statuses[k] = n } } }
        let sa = j["service_area"]
        let band = sa.flatMap { s -> Band? in
            guard let state = s["state"]?.stringValue else { return nil }
            return Band(state: state, city: s["city"]?.stringValue, stateCode: s["state_code"]?.stringValue,
                        radiusMiles: s["radius_miles"]?.intValue, mobile: s["mobile"]?.boolValue, basis: s["basis"]?.stringValue)
        }
        let av = j["availability"]
        let days = (av?["weekly"]?.arrayItems ?? []).compactMap { w -> String? in
            guard let d = w["day"]?.stringValue, let s = w["start"]?.stringValue, let e = w["end"]?.stringValue else { return nil }
            return "\(d) \(s)–\(e)"
        }
        return Person(id: "\(signed ? "a" : "r")\(index)|\(label.profileId ?? label.text)", person: label,
                      roles: (j["roles"]?.arrayItems ?? []).compactMap(\.stringValue), signed: signed,
                      acceptedAt: j["accepted_at"]?.stringValue, statuses: statuses, serviceArea: band,
                      availabilityState: av?["state"]?.stringValue, availabilityDays: days)
    }

    static func parseStep(_ j: JobJSON) -> Step? {
        guard let key = j["key"]?.stringValue else { return nil }
        return Step(key: key, label: j["label"]?.stringValue ?? JobWords.humanize(key), state: StepState(j["state"]?.stringValue),
                    evidence: j["evidence"]?.stringValue, clock: j["clock"]?.stringValue, clockBasis: j["clock_basis"]?.stringValue,
                    basis: j["basis"]?.stringValue, reports: j["reports"]?["claims"]?.intValue ?? 0,
                    conflicting: j["conflicting"]?.boolValue ?? false, customerAccepted: j["customer_accepted"]?.boolValue ?? false)
    }
}

fileprivate extension JobJSON {
    subscript(_ key: String) -> JobJSON? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    var arrayItems: [JobJSON]? {
        if case .array(let a) = self { return a }
        return nil
    }

    var doubleValue: Double? {
        switch self {
        case .number(let n): return n.isFinite ? n : nil
        case .string(let s): return Double(s)
        default: return nil
        }
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }
}

enum ProviderPlaceReaders {
    static let name = "work_order_provider_place_read"

    static func read(workOrderId: String) async -> JobLoad<JobProviderPlace> {
        await JobReaders.call(name) {
            try await SupabaseService.client.rpc(name, params: ["p_work_order_id": workOrderId]).execute().data
        }
    }
}

/// Plain words for the card. Pure, unit-tested.
enum ProviderPlaceCopy {
    static func rating(_ r: JobProviderPlace.Rating?) -> String {
        guard let r else { return "Not reported" }
        if r.state == "stored", let v = r.value {
            let reviews = r.reviews.map { " · \($0) review\($0 == 1 ? "" : "s")" } ?? ""
            return String(format: "%.1f", v) + reviews
        }
        return "Not rated"
    }

    static func kind(_ entityType: String?) -> String? {
        guard let t = entityType, !t.isEmpty else { return nil }
        let words = JobWords.humanize(t)
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    static func placeLine(_ p: JobProviderPlace.Place?) -> String {
        guard let p else { return "Not reported" }
        if let street = p.streetAddress {
            return [street, p.cityLine, p.zipCode].compactMap { $0 }.joined(separator: ", ")
        }
        return p.cityLine ?? "No place on the record"
    }

    static func precision(_ p: JobProviderPlace.Place?) -> String {
        switch p?.precision {
        case "coordinates": return "Business location on record"
        case "street": return "Street address on record"
        case "city", "state": return "City-level · approximate"
        default: return "No place on the record"
        }
    }

    static func band(_ b: JobProviderPlace.Band?) -> String? {
        guard let b else { return nil }
        switch b.state {
        case "declared":
            let place = [b.city, b.stateCode].compactMap { $0 }.joined(separator: ", ")
            let radius = b.radiusMiles.map { "within \($0) mi of " } ?? "near "
            let mobile = b.mobile == true ? " · travels to the vehicle" : ""
            return "Works \(radius)\(place)\(mobile)"
        case "withheld": return "Service area not shown (profile not public)"
        case "not_declared": return "No service area stated"
        default: return nil
        }
    }

    static func role(_ p: JobProviderPlace.Person) -> String {
        let roles = p.roles.map { JobWords.humanize($0) }.joined(separator: ", ")
        let base = roles.isEmpty ? "On this job" : roles.prefix(1).uppercased() + roles.dropFirst()
        return p.signed ? "\(base) · accepted through Nuke" : "\(base) · recorded assignment"
    }

    static func statuses(_ s: [String: Int]) -> String? {
        guard !s.isEmpty else { return nil }
        return s.keys.sorted().map { "\(JobWords.humanize($0)) \(s[$0]!)" }.joined(separator: " · ")
    }

    static func stepState(_ s: JobProviderPlace.Step) -> String {
        switch s.state {
        case .reached:
            switch s.evidence {
            case "sign": return "Signed through Nuke"
            case "record": return "Recorded, not verified"
            default: return "Recorded"
            }
        case .partial: return "Partly recorded"
        case .statusOnly: return "Marked, nothing behind it"
        case .notYet: return "Not yet"
        case .withheld: return "Shown to the people on this job"
        case .unknown: return "Not available"
        }
    }

    static func reports(_ n: Int) -> String? {
        n > 0 ? "\(n) message\(n == 1 ? "" : "s") say so — not signed" : nil
    }

    static func workSite(_ r: JobProviderPlace) -> String {
        switch r.workSiteState {
        case "facility_reserved":
            return "Booked at \(r.workSiteOrganization ?? "a facility")" + (r.workSitePlace?.cityLine.map { ", \($0)" } ?? "")
        case "not_recorded": return "Not recorded"
        default: return "Not reported"
        }
    }

    /// Apple Maps directions, only for a storefront the server marked for directions.
    static func directionsURL(_ p: JobProviderPlace.Place?, name: String?) -> URL? {
        guard let p, p.storefront, p.directions else { return nil }
        var c = URLComponents(string: "https://maps.apple.com/")!
        var items: [URLQueryItem] = []
        if let pin = p.pin {
            items.append(URLQueryItem(name: "daddr", value: "\(pin.latitude),\(pin.longitude)"))
        } else if let street = p.streetAddress {
            items.append(URLQueryItem(name: "daddr", value: [street, p.cityLine, p.zipCode].compactMap { $0 }.joined(separator: ", ")))
        } else {
            return nil
        }
        if let name, !name.isEmpty { items.append(URLQueryItem(name: "q", value: name)) }
        c.queryItems = items
        return c.url
    }

    /// tel: only for a storefront's public business phone.
    static func phoneURL(_ p: JobProviderPlace.Place?) -> URL? {
        guard let p, p.storefront, let phone = p.phone else { return nil }
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        guard digits.filter(\.isNumber).count >= 7 else { return nil }
        return URL(string: "tel:\(digits)")
    }
}
