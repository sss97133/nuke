// ProviderMatches.swift — who could do this job: work_order_provider_matches_read, for its customer or shop owner.
//
// The reader lists provider accounts (an evidenced technician link, an active shop membership or ownership, or a
// verified business claim, with the businesses they can offer as in offers_as), ranked only by how many match
// inputs pass per request (skill, tools, shop space, area, availability, technician profile); ties share a rank and
// every input is shown. Supply records never pass an input (a skill input may carry supply_corroboration, labelled as
// not skill evidence); businesses that can supply a request come apart in plan_b_suppliers. A provider's service area is a band (city, state, radius,
// mobile) and their availability a standing window: both are self-claimed Signs. The reader returns no coordinates
// and no contact fields. provider_profile_read adds standing (jobs, signed work days, evidence-derived skills,
// vouches, active shops) with its basis. Offers and acceptance stay on work_order_offers_read; nothing here
// contacts, books or pays anyone.

import Foundation
import Supabase

// MARK: - A provider's service area and availability (self-claimed Signs)

struct ServiceAreaBand: Decodable, Equatable, Hashable {
    let city: String
    let stateCode: String
    let radiusMiles: Int
    let mobile: Bool

    init(city: String, stateCode: String, radiusMiles: Int, mobile: Bool) {
        self.city = city; self.stateCode = stateCode; self.radiusMiles = radiusMiles; self.mobile = mobile
    }

    /// The match input's band carries `state`; provider_profile_read's carries `state_code` (its `state` is declared / not_declared).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        let code = (try? c.decode(String.self, forKey: JobCodingKey("state_code")))
            ?? (try? c.decode(String.self, forKey: JobCodingKey("state")))
        guard let city = (try? c.decode(String.self, forKey: JobCodingKey("city")))?.trimmingCharacters(in: .whitespaces), !city.isEmpty,
              let code, code.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil,
              let radius = try? c.decode(Int.self, forKey: JobCodingKey("radius_miles")), radius > 0 else {
            throw DecodingError.dataCorruptedError(forKey: JobCodingKey("city"), in: c, debugDescription: "not a service-area band")
        }
        self.init(city: city, stateCode: code, radiusMiles: radius,
                  mobile: (try? c.decode(Bool.self, forKey: JobCodingKey("mobile"))) == true)
    }

    var place: String { "\(city), \(stateCode)" }
}

struct AvailabilitySummary: Decodable, Equatable {
    struct Window: Decodable, Equatable { let dow: Int; let start: String; let end: String }
    struct Exception: Decodable, Equatable { let date: String; let available: Bool; let start: String?; let end: String? }

    let declared: Bool
    let declaredAt: String?
    let timezone: String?
    let weekly: [Window]
    let exceptionsUpcoming: [Exception]

    enum CodingKeys: String, CodingKey {
        case state, timezone, weekly
        case declaredAt = "declared_at"
        case exceptionsUpcoming = "exceptions_upcoming"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        declared = (try? c.decode(String.self, forKey: .state)) == "declared"
        declaredAt = try? c.decode(String.self, forKey: .declaredAt)
        timezone = try? c.decode(String.self, forKey: .timezone)
        weekly = ((try? c.decode([Lossy<Window>].self, forKey: .weekly)) ?? []).compactMap(\.value)
        exceptionsUpcoming = ((try? c.decode([Lossy<Exception>].self, forKey: .exceptionsUpcoming)) ?? []).compactMap(\.value)
    }
}

// MARK: - work_order_provider_matches_read

struct ProviderMatchInput: Decodable, Equatable, Identifiable {
    let input: String
    let result: String
    let reason: String?
    let next: String?
    let basis: String?
    /// The provider's band, on the area input when they declared one.
    let serviceArea: ServiceAreaBand?
    /// The first day inside the job window their standing availability covers (availability input, pass only).
    let firstAvailableDay: String?
    /// Skill input: evidence-derived capabilities that cover the request, and what they only state about themself.
    let matchedCapabilities: [String]
    let statedCapabilities: [String]
    let cautions: [String]
    /// Skill input: businesses they claimed that supplied this kind of thing before. Corroborating only; never a pass.
    let supplyCorroboration: [String]
    var id: String { input }

    enum CodingKeys: String, CodingKey {
        case input, result, reason, next, basis, cautions
        case serviceArea = "service_area"
        case firstAvailableDay = "first_available_day"
        case matchedCapabilities = "matched_capabilities"
        case statedCapabilities = "stated_capabilities"
        case supplyCorroboration = "supply_corroboration"
    }
    private struct Supplied: Decodable {
        struct Org: Decodable { let name: String? }
        let organization: Org?
    }
    private struct Named: Decodable { let capability: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        input = try c.decode(String.self, forKey: .input)
        result = (try? c.decode(String.self, forKey: .result)) ?? "unknown"
        reason = try? c.decode(String.self, forKey: .reason)
        next = try? c.decode(String.self, forKey: .next)
        basis = try? c.decode(String.self, forKey: .basis)
        serviceArea = try? c.decode(ServiceAreaBand.self, forKey: .serviceArea)
        firstAvailableDay = try? c.decode(String.self, forKey: .firstAvailableDay)
        matchedCapabilities = ((try? c.decode([Named].self, forKey: .matchedCapabilities)) ?? []).compactMap(\.capability)
        statedCapabilities = (try? c.decode([String].self, forKey: .statedCapabilities)) ?? []
        cautions = ((try? c.decode([Named].self, forKey: .cautions)) ?? []).compactMap(\.capability)
        var seen = Set<String>()
        supplyCorroboration = ((try? c.decode([Lossy<Supplied>].self, forKey: .supplyCorroboration)) ?? [])
            .compactMap { $0.value?.organization?.name }.filter { seen.insert($0).inserted }
    }
}

struct ProviderMatchRequirement: Decodable, Equatable, Identifiable {
    let requirementId: String
    let kind: String
    let description: String?
    let passed: Int
    let inputs: [ProviderMatchInput]
    var id: String { requirementId }

    enum CodingKeys: String, CodingKey {
        case description, passed, inputs
        case requirementId = "requirement_id"
        case kind = "requirement_kind"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requirementId = try c.decode(String.self, forKey: .requirementId)
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "requirement"
        description = (try? c.decode(String.self, forKey: .description)).flatMap { $0.isEmpty ? nil : $0 }
        passed = (try? c.decode(Int.self, forKey: .passed)) ?? 0
        inputs = ((try? c.decode([Lossy<ProviderMatchInput>].self, forKey: .inputs)) ?? []).compactMap(\.value)
    }

    var title: String {
        let k = OfferCopy.kind(kind)
        guard let description else { return k }
        return "\(k): \(description)"
    }

    func input(_ name: String) -> ProviderMatchInput? { inputs.first { $0.input == name } }
}

struct ProviderMatch: Decodable, Equatable, Identifiable {
    /// A business this provider can offer as: a verified claim on it (organization_verified_claimants).
    struct OffersAs: Decodable, Equatable, Identifiable {
        let organizationId: String
        let name: String?
        let onNuke: String?
        var id: String { organizationId }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            organizationId = try c.decode(String.self, forKey: JobCodingKey("organization_id"))
            name = (try? c.decode(String.self, forKey: JobCodingKey("name"))).flatMap { $0.isEmpty ? nil : $0 }
            onNuke = try? c.decode(String.self, forKey: JobCodingKey("on_nuke"))
        }
    }

    let rank: Int
    let provider: JobPerson?
    let offersAs: [OffersAs]
    let listedBecause: [String]
    let linkState: String
    let passed: Int
    let failed: Int
    let unknown: Int
    let inputsTotal: Int
    let requirements: [ProviderMatchRequirement]
    /// Position in the reader's order; the identity for an unnamed party, who has no handle or profile id.
    var position = 0

    var id: String { provider?.profileId ?? provider?.handle.map { "@" + $0 } ?? "row-\(position)" }

    enum CodingKeys: String, CodingKey {
        case rank, provider, passed, failed, unknown, requirements
        case offersAs = "offers_as"
        case listedBecause = "listed_because"
        case linkState = "link_state"
        case inputsTotal = "inputs_total"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank = (try? c.decode(Int.self, forKey: .rank)) ?? 0
        provider = try? c.decode(JobPerson.self, forKey: .provider)
        offersAs = ((try? c.decode([Lossy<OffersAs>].self, forKey: .offersAs)) ?? []).compactMap(\.value)
        listedBecause = (try? c.decode([String].self, forKey: .listedBecause)) ?? []
        linkState = (try? c.decode(String.self, forKey: .linkState)) ?? "none"
        passed = (try? c.decode(Int.self, forKey: .passed)) ?? 0
        failed = (try? c.decode(Int.self, forKey: .failed)) ?? 0
        unknown = (try? c.decode(Int.self, forKey: .unknown)) ?? 0
        inputsTotal = (try? c.decode(Int.self, forKey: .inputsTotal)) ?? 0
        requirements = ((try? c.decode([Lossy<ProviderMatchRequirement>].self, forKey: .requirements)) ?? []).compactMap(\.value)
    }

    var name: String { provider?.text ?? "Unnamed party" }
    var profileId: String? { provider?.profileId }

    private func inputs(_ name: String) -> [ProviderMatchInput] { requirements.compactMap { $0.input(name) } }

    /// The band the area input reports (the same Sign on every request).
    var serviceArea: ServiceAreaBand? { inputs("area").lazy.compactMap(\.serviceArea).first }

    /// True when the input passes on every request this provider was matched against.
    func passesEverywhere(_ name: String) -> Bool {
        let found = inputs(name)
        return !found.isEmpty && found.count == requirements.count && found.allSatisfy { $0.result == "pass" }
    }

    /// The earliest first-available day across requests (yyyy-mm-dd sorts as text).
    var firstAvailableDay: String? { inputs("availability").compactMap(\.firstAvailableDay).min() }

    var evidencedSkills: [String] { Self.distinct(inputs("skill").flatMap(\.matchedCapabilities)) }
    var statedSkills: [String] { Self.distinct(inputs("skill").flatMap(\.statedCapabilities)) }
    var skillCautions: [String] { Self.distinct(inputs("skill").flatMap(\.cautions)) }
    var suppliedBy: [String] { Self.distinct(inputs("skill").flatMap(\.supplyCorroboration)) }

    private static func distinct(_ xs: [String]) -> [String] {
        var seen = Set<String>()
        return xs.filter { seen.insert($0).inserted }
    }
}

/// Businesses with purchase records for one request: they can supply it. Listed apart from performers; supply never
/// counts as evidence of doing the work.
struct PlanBSupplierGroup: Decodable, Equatable, Identifiable {
    let requirementId: String
    let kind: String
    let description: String?
    let suppliers: [PlanBSupplier]
    var id: String { requirementId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        requirementId = try c.decode(String.self, forKey: JobCodingKey("requirement_id"))
        kind = (try? c.decode(String.self, forKey: JobCodingKey("requirement_kind"))) ?? "requirement"
        description = (try? c.decode(String.self, forKey: JobCodingKey("description"))).flatMap { $0.isEmpty ? nil : $0 }
        suppliers = ((try? c.decode([Lossy<PlanBSupplier>].self, forKey: JobCodingKey("suppliers"))) ?? []).compactMap(\.value)
    }

    var title: String {
        let k = OfferCopy.kind(kind)
        guard let description else { return k }
        return "\(k): \(description)"
    }
}

struct ProviderMatches: Decodable, Equatable {
    struct JobArea: Decodable, Equatable { let city: String?; let state: String?; let basis: String? }
    struct JobWindow: Decodable, Equatable { let from: String?; let until: String?; let basis: String? }

    let workOrderId: String?
    let asOf: String?
    let displayTitle: String?
    let vehicleLabel: JobVehicleLabel?
    var providers: [ProviderMatch]
    let unreadableProviders: Int
    let planBSuppliers: [PlanBSupplierGroup]
    let inputs: [String]
    let jobArea: JobArea?
    let jobWindow: JobWindow?
    let requirements: Int?
    let providersConsidered: Int?
    let providersReturned: Int?
    let candidateCap: Int?
    let viewer: JobViewer?

    enum CodingKeys: String, CodingKey {
        case providers, inputs, coverage, viewer
        case workOrderId = "work_order_id"
        case asOf = "as_of"
        case displayTitle = "display_title"
        case vehicleLabel = "vehicle_label"
        case jobArea = "job_area"
        case jobWindow = "job_window"
        case planBSuppliers = "plan_b_suppliers"
    }
    private struct Coverage: Decodable {
        let requirements: Int?
        let providers_considered: Int?
        let providers_returned: Int?
        let candidate_cap: Int?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try? c.decode(String.self, forKey: .workOrderId)
        asOf = try? c.decode(String.self, forKey: .asOf)
        displayTitle = (try? c.decode(String.self, forKey: .displayTitle)).flatMap { $0.isEmpty ? nil : $0 }
        vehicleLabel = try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)
        let raw = (try? c.decode([Lossy<ProviderMatch>].self, forKey: .providers)) ?? []
        var rows = raw.compactMap(\.value)
        for i in rows.indices { rows[i].position = i }
        providers = rows
        unreadableProviders = raw.count - rows.count
        planBSuppliers = ((try? c.decode([Lossy<PlanBSupplierGroup>].self, forKey: .planBSuppliers)) ?? [])
            .compactMap(\.value).filter { !$0.suppliers.isEmpty }
        inputs = (try? c.decode([String].self, forKey: .inputs)) ?? []
        jobArea = (try? c.decode(JobArea.self, forKey: .jobArea)).flatMap { $0.city == nil && $0.state == nil ? nil : $0 }
        jobWindow = try? c.decode(JobWindow.self, forKey: .jobWindow)
        let cov = try? c.decode(Coverage.self, forKey: .coverage)
        requirements = cov?.requirements
        providersConsidered = cov?.providers_considered
        providersReturned = cov?.providers_returned
        candidateCap = cov?.candidate_cap
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
    }

    var jobPlace: String? {
        let p = [jobArea?.city, jobArea?.state].compactMap { $0 }.filter { !$0.isEmpty }
        return p.isEmpty ? nil : p.joined(separator: ", ")
    }

    var withServiceArea: Int { providers.filter { $0.serviceArea != nil }.count }
    var anyMobile: Bool { providers.contains { $0.serviceArea?.mobile == true } }
}

// MARK: - Standing from provider_profile_read (its own words for the basis)

struct ProviderMatchFace: Decodable, Equatable {
    struct Shop: Decodable, Equatable, Identifiable {
        let organizationId: String?
        let name: String?
        let city: String?
        let state: String?
        let relationKind: String?
        let relationState: String?
        var id: String { organizationId ?? name ?? "" }

        enum CodingKeys: String, CodingKey {
            case name, city, state, relation
            case organizationId = "organization_id"
            case relationKind = "relation_kind"
        }
        private struct Relation: Decodable { let state: String? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            organizationId = try? c.decode(String.self, forKey: .organizationId)
            name = (try? c.decode(String.self, forKey: .name)).flatMap { $0.isEmpty ? nil : $0 }
            city = try? c.decode(String.self, forKey: .city)
            state = try? c.decode(String.self, forKey: .state)
            relationKind = try? c.decode(String.self, forKey: .relationKind)
            relationState = (try? c.decode(Relation.self, forKey: .relation))?.state
        }

        /// Ownership, or a membership that is live or stalling (the profile's own rule).
        var isActive: Bool { relationKind == "ownership" || relationState == "live" || relationState == "stalling" }
        var place: String? {
            let p = [city, state].compactMap { $0 }.filter { !$0.isEmpty }
            return p.isEmpty ? nil : p.joined(separator: ", ")
        }
    }

    let publicPlace: String?
    let serviceArea: ServiceAreaBand?
    let serviceAreaDeclared: Bool
    let availability: AvailabilitySummary?
    let jobs: Int?
    let signedWorkDays: Int?
    /// Distinct capability names from evidence_fold rows only; hand-entered rows are not evidence.
    let evidencedSkills: [String]
    let vouches: Int?
    let shops: [Shop]
    let asOf: String?

    enum CodingKeys: String, CodingKey {
        case subject, availability, capabilities, facilities
        case serviceArea = "service_area"
        case workRecord = "work_record"
        case vouchedForBy = "vouched_for_by"
        case asOf = "as_of"
    }
    private struct Subject: Decodable { let city: String?; let state: String? }
    private struct Declared: Decodable { let state: String? }
    private struct Capability: Decodable { let capability_type: String?; let derivation: String? }
    private struct Items<T: Decodable>: Decodable { let items: [Lossy<T>]? }
    private struct WorkRecord: Decodable {
        struct Jobs: Decodable { let jobs: Int? }
        struct Days: Decodable { let signed_work_days: Int? }
        let jobs: Jobs?
        let days: Days?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let subject = try? c.decode(Subject.self, forKey: .subject)
        let place = [subject?.city, subject?.state].compactMap { $0 }.filter { !$0.isEmpty }
        publicPlace = place.isEmpty ? nil : place.joined(separator: ", ")
        serviceAreaDeclared = (try? c.decode(Declared.self, forKey: .serviceArea))?.state == "declared"
        serviceArea = serviceAreaDeclared ? (try? c.decode(ServiceAreaBand.self, forKey: .serviceArea)) : nil
        availability = try? c.decode(AvailabilitySummary.self, forKey: .availability)
        let record = try? c.decode(WorkRecord.self, forKey: .workRecord)
        jobs = record?.jobs?.jobs
        signedWorkDays = record?.days?.signed_work_days
        let caps = ((try? c.decode(Items<Capability>.self, forKey: .capabilities))?.items ?? []).compactMap(\.value)
        var seen = Set<String>()
        evidencedSkills = caps.filter { $0.derivation == "evidence_fold" }.compactMap(\.capability_type).filter { seen.insert($0).inserted }
        let vouchItems: [Lossy<JobJSON>]? = (try? c.decode(Items<JobJSON>.self, forKey: .vouchedForBy))?.items
        vouches = vouchItems?.count
        shops = ((try? c.decode([Lossy<Shop>].self, forKey: .facilities)) ?? []).compactMap(\.value).filter(\.isActive)
        asOf = try? c.decode(String.self, forKey: .asOf)
    }
}

// MARK: - Who sees the entry, filters and offers on a card

enum ProviderMatchesGate {
    /// The reader answers the job's customer or shop owner; the entry shows only until someone is accepted.
    static func shows(_ offers: WorkOrderOffers) -> Bool {
        let slots = Set(offers.viewer?.slots ?? [])
        return offers.acceptedProviders.isEmpty && !slots.isDisjoint(with: ["customer", "org_owner"])
    }
}

enum ProviderMatchFilter: Hashable, Identifiable {
    /// Passes this reader input on every request.
    case passes(String)
    /// States a mobile service area (travels to the vehicle).
    case mobile

    var id: String {
        switch self {
        case .passes(let i): return "passes-" + i
        case .mobile: return "mobile"
        }
    }

    var title: String {
        switch self {
        case .passes(let i): return OfferCopy.input(i)
        case .mobile: return "Mobile"
        }
    }

    func admits(_ p: ProviderMatch) -> Bool {
        switch self {
        case .passes(let i): return p.passesEverywhere(i)
        case .mobile: return p.serviceArea?.mobile == true
        }
    }

    /// Only filters over fields the reader returned: its own input list, and Mobile when any band states it.
    static func available(_ read: ProviderMatches) -> [ProviderMatchFilter] {
        read.inputs.map(ProviderMatchFilter.passes) + (read.anyMobile ? [.mobile] : [])
    }

    static func apply(_ filters: Set<ProviderMatchFilter>, to providers: [ProviderMatch]) -> [ProviderMatch] {
        providers.filter { p in filters.allSatisfy { $0.admits(p) } }
    }
}

struct ProviderOfferPair: Identifiable {
    let request: RequirementOffers
    let offer: JobOffer
    var id: String { offer.offerId }
}

enum ProviderMatchOffers {
    /// This provider's offers on the job, matched by public profile id, else by handle; an unnamed party matches none.
    static func offers(for p: ProviderMatch, in o: WorkOrderOffers) -> [ProviderOfferPair] {
        o.requirements.flatMap { req in req.offers.filter { same(p.provider, $0.provider) }.map { ProviderOfferPair(request: req, offer: $0) } }
    }

    /// Offers on the job that no card on this screen accounts for (unnamed parties, shops, or providers not returned).
    static func unmatched(_ providers: [ProviderMatch], in o: WorkOrderOffers) -> [ProviderOfferPair] {
        o.requirements.flatMap { req in
            req.offers.filter { offer in !providers.contains { same($0.provider, offer.provider) } }
                .map { ProviderOfferPair(request: req, offer: $0) }
        }
    }

    static func same(_ a: JobPerson?, _ b: JobPerson?) -> Bool {
        guard let a, let b else { return false }
        if let x = a.profileId, let y = b.profileId { return x == y }
        if let x = a.handle, let y = b.handle { return x.lowercased() == y.lowercased() }
        return false
    }
}

// MARK: - Words (said about the provider, to the job's owner)

enum ProviderMatchCopy {
    static func listedBecause(_ codes: [String]) -> String? {
        let words = codes.map { code -> String in
            switch code {
            case "evidenced_link": return "technician link backed by work"
            case "organization_member": return "shop member"
            case "organization_owner": return "shop owner"
            case "verified_claimant": return "claimed a business on Nuke"
            default: return JobCopy.sentence(code).lowercased()
            }
        }
        return words.isEmpty ? nil : "Listed as " + words.joined(separator: ", ")
    }

    static func link(_ state: String) -> (text: String, status: RootStatus) {
        switch state {
        case "evidenced": return ("Backed by their work", .attributed)
        case "claimed": return ("Linked by them — not yet backed by work", .pending)
        default: return ("No technician link", .recorded)
        }
    }

    static func tally(_ p: ProviderMatch) -> String {
        "\(p.passed) of \(p.inputsTotal) checks pass · \(p.failed) not yet · \(p.unknown) unknown"
    }

    /// "Within 25 mi of Henderson, NV" or "Mobile · travels within 25 mi of Henderson, NV".
    static func band(_ b: ServiceAreaBand) -> String {
        b.mobile ? "Mobile · travels within \(b.radiusMiles) mi of \(b.place)" : "Within \(b.radiusMiles) mi of \(b.place)"
    }

    private static let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// "Mon, Tue 08:00–17:00 · Sat 09:00–12:00 (America/Los_Angeles)"; nil when nothing is declared.
    static func weekly(_ a: AvailabilitySummary) -> String? {
        guard a.declared, !a.weekly.isEmpty else { return nil }
        var groups: [(hours: String, days: [Int])] = []
        for w in a.weekly.sorted(by: { ($0.dow, $0.start) < ($1.dow, $1.start) }) {
            let hours = "\(w.start)–\(w.end)"
            if let i = groups.firstIndex(where: { $0.hours == hours }) { groups[i].days.append(w.dow) } else { groups.append((hours, [w.dow])) }
        }
        let text = groups.map { g in
            g.days.compactMap { days.indices.contains($0) ? days[$0] : nil }.joined(separator: ", ") + " " + g.hours
        }.joined(separator: " · ")
        return a.timezone.map { "\(text) (\($0))" } ?? text
    }

    static func availability(_ a: AvailabilitySummary?) -> String {
        guard let a else { return "Not reported" }
        guard a.declared else { return "Hasn't stated availability" }
        let off = a.exceptionsUpcoming.filter { !$0.available }.count
        let base = weekly(a) ?? "No weekly hours; dates only"
        return off > 0 ? "\(base) · \(off) upcoming day\(off == 1 ? "" : "s") off" : base
    }

    static func skill(_ name: String) -> String { name.replacingOccurrences(of: "_", with: " ") }

    /// One input in the third person, from the reader's own reason. Unknown wording falls back to the reason itself.
    static func reason(_ m: ProviderMatchInput) -> String {
        let r = m.reason ?? ""
        if r.hasPrefix("not required for a") { return "Not needed for this" }
        switch m.input {
        case "skill":
            if m.result == "pass" {
                let names = m.matchedCapabilities.map(skill).joined(separator: ", ")
                if !names.isEmpty { return "Their work shows \(names)" + (m.cautions.isEmpty ? "" : " (with some evidence against)") }
                if let range = r.range(of: "capability ") {
                    return "Their record shows " + skill(r[range.upperBound...].replacingOccurrences(of: " is named in the requirement", with: ""))
                }
                return "Their work covers this"
            }
            if !m.statedCapabilities.isEmpty { return "They say they do \(m.statedCapabilities.map(skill).joined(separator: ", ")) — not shown in their work yet" }
            if r.hasPrefix("only evidence against") { return "Only evidence against this skill so far" }
            if r.hasPrefix("hand-entered") { return "A hand-entered record without a basis" }
            if r.contains("no evidenced identity bridge") { return "No technician link backed by work yet" }
            return "Not shown in their work yet"
        case "tools":
            if m.result == "pass" {
                for prefix in ["claimed tool maps to ", "claimed tool record named in the requirement: "] {
                    if let range = r.range(of: prefix) {
                        let names = r[range.upperBound...].components(separatedBy: " (claimed").first ?? ""
                        return "They say they own \(skill(names))"
                    }
                }
                return "They say they own a matching tool"
            }
            if r.hasPrefix("seen in photos") { return "Seen in photos at their shop; not claimed as theirs" }
            return r.contains("no claimed tool records") ? "No tools in their records" : "No matching tool in their records"
        case "facility":
            switch m.result {
            case "pass": return r.contains("no job window") ? "Has matching shop space (no job window to check)" : "Has matching shop space free in the window"
            case "fail": return r.hasPrefix("every declared") ? "Their matching shop space is booked in the window" : "No matching shop space"
            default: return "No shop space found for this job"
            }
        case "area":
            if let within = r.range(of: #"within your (\d+)-mile service area"#, options: .regularExpression) {
                let miles = r[within].filter(\.isNumber)
                return "The job is within their \(miles)-mile service area"
            }
            if let outside = r.range(of: #"outside your (\d+)-mile service area"#, options: .regularExpression) {
                let miles = r[outside].filter(\.isNumber)
                return "The job is outside their \(miles)-mile service area"
            }
            if r.hasPrefix("same state as your service area") { return "Same state as their service area (distance not worked out)" }
            if r.hasPrefix("different state from your service area") { return "A different state from their service area" }
            if r.contains("job area not public") { return "The job's area isn't public" }
            if r.contains("job state not public") { return "The job's state isn't public" }
            if r.contains("states no area") { return "They haven't stated an area" }
            if m.result == "pass" { return r.contains("and city") ? "Same city on their public profile" : "Same state on their public profile" }
            return "A different state on their public profile"
        case "availability":
            if m.result == "pass" {
                return JobCopy.day(m.firstAvailableDay).map { "They say they're free from \($0)" } ?? "They say they're free in the job window"
            }
            if r.contains("window has passed") { return "The job window has passed" }
            if r.hasPrefix("no declared availability inside") { return "Their stated hours don't cover the job window" }
            return "They haven't stated availability"
        case "evidence_rung":
            if m.result == "pass" { return "Technician link backed by their work" }
            if m.result == "unknown" { return "Linked by them — not yet backed by work" }
            return "No technician link"
        default:
            return r.isEmpty ? JobCopy.sentence(m.result) : JobCopy.sentence(r)
        }
    }

    /// Whether the input's words come from the provider's own Sign (labelled as a self-claim on screen).
    static func isSelfClaim(_ m: ProviderMatchInput) -> Bool {
        if m.serviceArea != nil || m.basis == "self_claim" { return true }
        return m.input == "tools" && m.result == "pass" && (m.reason ?? "").contains("claimed")
    }

    /// The screen's empty state, in the reader's own terms.
    static func empty(_ read: ProviderMatches) -> String? {
        let considered = read.providersConsidered.map { JobCopy.count($0) } ?? "an unknown number of"
        let accounts = read.providersConsidered == 1 ? "provider account" : "provider accounts"
        if read.requirements == 0 {
            return "This job lists no requests yet, so nobody was matched. Matches are worked out per request; \(considered) \(accounts) on Nuke would be considered."
        }
        if read.providers.isEmpty {
            return read.providersConsidered == 0
                ? "No provider accounts on Nuke qualify to be considered yet: none has a technician link backed by work, an active shop membership or ownership, or a claimed business, other than you and the customer."
                : "None of the \(considered) \(accounts) considered came back for this job."
        }
        return nil
    }

    static func coverage(_ read: ProviderMatches) -> String {
        let returned = read.providersReturned ?? read.providers.count
        let considered = read.providersConsidered.map(String.init) ?? "unknown"
        let reqs = read.requirements.map { "\($0) request\($0 == 1 ? "" : "s")" } ?? "requests unknown"
        return "\(returned) of \(considered) provider accounts considered · \(reqs)" + (JobClock.text(read.asOf).map { " · as of \($0)" } ?? "")
    }

    static func mapCoverage(_ read: ProviderMatches) -> String {
        let n = read.providers.count
        return "\(read.withServiceArea) of \(n) provider\(n == 1 ? "" : "s") shown state a service area"
    }

    static let mapNote = "Circles are the service areas providers state (a city and a radius, self-claimed), drawn around the city's center as Apple Maps places it. Nobody's exact location is shown; Nuke doesn't hold one."
    static let screenNote = "Ranked only by how many checks each provider passes; ties share a rank and every check is shown. Service area and availability are what providers say; tools are claimed ownership. Businesses that can supply parts or tools are listed separately and never ranked here. Nuke doesn't contact anyone from here: providers make offers on the job, and you accept one."

    /// "Offers as Fixture Garage" (the badge carries the on_nuke label).
    static func offersAs(_ o: ProviderMatch.OffersAs) -> String { "Offers as \(o.name ?? "an unnamed business")" }

    static func suppliedBy(_ names: [String]) -> String {
        "Their business \(names.joined(separator: ", ")) has supplied this before — not evidence they can do the work"
    }

    static let planBHeader = "Can supply this"
    static let planBNote = "Businesses Nuke has purchase records for, by request. Supplying parts or tools isn't evidence of doing the work, so they aren't ranked with providers above. Only a business claimed on Nuke can receive requests; Nuke contacts nobody from here."
}

// MARK: - Readers (reads only)

enum ProviderMatchReaders {
    static let matchesName = "work_order_provider_matches_read"

    static func matches(workOrderId: String, limit: Int = 25) async -> JobLoad<ProviderMatches> {
        struct P: Encodable { let p_work_order_id: String; let p_limit: Int }
        return await JobReaders.call(matchesName) {
            try await SupabaseService.client.rpc(matchesName, params: P(p_work_order_id: workOrderId, p_limit: limit)).execute().data
        }
    }

    static func face(userId: String) async -> JobLoad<ProviderMatchFace> {
        await JobReaders.call(ProviderReaders.profileName) {
            try await SupabaseService.client.rpc(ProviderReaders.profileName, params: ["p_user_id": userId]).execute().data
        }
    }
}
