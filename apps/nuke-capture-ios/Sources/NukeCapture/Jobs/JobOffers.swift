// JobOffers.swift — jobs looking for someone, and offers on them.
//
// open_requirements_read lists current requirements on open work orders for public vehicles,
// with an explainable per-input match for a signed-in viewer (skill, tools, shop access, area,
// availability, technician profile): no score, nothing rules anyone out; a missing tool or shop
// means a backup supplier is needed. work_order_offers_read lists offers per requirement (open
// terms, provider by handle or "Unnamed party" with the rung they offered at) and the server's
// actions: offer (offer_on_requirement), withdraw_offer, accept_offer (hash-pinned, customer
// only). Offers and acceptances move no money and book nothing until the customer accepts.

import Foundation
import Supabase

// MARK: - Open requirements

struct MatchInput: Decodable, Equatable, Identifiable {
    let input: String
    let result: String
    let reason: String?
    let next: String?
    var id: String { input }
}

struct OpenRequirement: Decodable, Equatable, Identifiable {
    struct Area: Decodable, Equatable { let city: String?; let state: String? }
    struct Window: Decodable, Equatable { let available_from: String?; let available_until: String? }
    struct Spec: Decodable, Equatable { let material_label: String?; let process_label: String? }

    let requirementId: String
    let kind: String
    let description: String?
    let quantity: Double?
    let unit: String?
    let specifications: [Spec]
    let workOrderId: String
    let workOrderStatus: String?
    let displayTitle: String?
    let vehicleLabel: JobVehicleLabel?
    let area: Area?
    let window: Window?
    let candidatesListed: Int
    let hasCurrentQuote: Bool
    let quoteAcceptance: String?
    /// nil for a signed-out viewer: the reader explains matches only to an account.
    let match: [MatchInput]?
    /// Businesses this kind of thing was paid for before on Nuke (requirement_plan_b_suppliers).
    let planB: [PlanBSupplier]

    var id: String { requirementId }

    enum CodingKeys: String, CodingKey {
        case description, quantity, unit, specifications, window, match
        case requirementId = "requirement_id"
        case kind = "requirement_kind"
        case workOrderId = "work_order_id"
        case workOrderStatus = "work_order_status"
        case displayTitle = "display_title"
        case vehicleLabel = "vehicle_label"
        case area = "area_band"
        case candidatesListed = "candidates_listed"
        case quoteState = "quote_state"
        case planB = "plan_b_suppliers"
    }
    private struct QuoteState: Decodable { let has_current_quote: Bool?; let acceptance: String? }
    private struct MatchSlot: Decodable {
        let input: MatchInput?
        init(from decoder: Decoder) throws { input = try? MatchInput(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requirementId = try c.decode(String.self, forKey: .requirementId)
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "requirement"
        description = (try? c.decode(String.self, forKey: .description)).flatMap { $0.isEmpty ? nil : $0 }
        quantity = try? c.decode(Double.self, forKey: .quantity)
        unit = try? c.decode(String.self, forKey: .unit)
        specifications = (try? c.decode([Spec].self, forKey: .specifications)) ?? []
        workOrderId = try c.decode(String.self, forKey: .workOrderId)
        workOrderStatus = try? c.decode(String.self, forKey: .workOrderStatus)
        displayTitle = try? c.decode(String.self, forKey: .displayTitle)
        vehicleLabel = try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)
        area = try? c.decode(Area.self, forKey: .area)
        window = try? c.decode(Window.self, forKey: .window)
        candidatesListed = (try? c.decode(Int.self, forKey: .candidatesListed)) ?? 0
        let qs = try? c.decode(QuoteState.self, forKey: .quoteState)
        hasCurrentQuote = qs?.has_current_quote == true
        quoteAcceptance = qs?.acceptance
        match = ((try? c.decodeIfPresent([MatchSlot].self, forKey: .match)) ?? nil)?.compactMap(\.input)
        planB = (try? c.decode([Lossy<PlanBSupplier>].self, forKey: .planB))?.compactMap(\.value) ?? []
    }

    var place: String? {
        let p = [area?.city, area?.state].compactMap { $0 }.filter { !$0.isEmpty }
        return p.isEmpty ? nil : p.joined(separator: ", ")
    }
}

struct OpenRequirements: Decodable, Equatable {
    var rows: [OpenRequirement]
    let nextAfter: String?
    let totalOpen: Int?
    let openJobs: Int?
    let signedIn: Bool
    let contact: ContactBlock?
    var unreadableRows: Int

    enum CodingKeys: String, CodingKey {
        case rows, coverage, contact, viewer
        case nextAfter = "next_after"
    }
    private struct Coverage: Decodable {
        let total_open: Int?
        let population: Population?
        struct Population: Decodable { let open_work_orders_with_requirements: Int? }
    }
    private struct Slot: Decodable {
        let row: OpenRequirement?
        init(from decoder: Decoder) throws { row = try? OpenRequirement(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = (try? c.decode([Slot].self, forKey: .rows)) ?? []
        rows = raw.compactMap(\.row)
        unreadableRows = raw.count - rows.count
        nextAfter = try? c.decode(String.self, forKey: .nextAfter)
        let cov = try? c.decode(Coverage.self, forKey: .coverage)
        totalOpen = cov?.total_open
        openJobs = cov?.population?.open_work_orders_with_requirements
        signedIn = (try? c.decode(JobViewer.self, forKey: .viewer))?.context != .visitor
        contact = try? c.decode(ContactBlock.self, forKey: .contact)
    }

    /// The reader's contact block, pinned to one requirement row (its context_id is a placeholder).
    func contact(for row: OpenRequirement) -> ContactBlock? {
        guard let contact else { return nil }
        return ContactBlock(action: contact.action, available: contact.available, contextKind: "requirement", contextId: row.requirementId)
    }

    /// "2 open requests on 1 job on Nuke right now".
    var sentence: String {
        guard let n = totalOpen else { return "Total not available" }
        let reqs = n == 1 ? "1 open request" : "\(n) open requests"
        guard let jobs = openJobs else { return "\(reqs) on Nuke right now" }
        return "\(reqs) on \(jobs == 1 ? "1 job" : "\(jobs) jobs") on Nuke right now"
    }
}

// MARK: - Offers

struct JobOffer: Decodable, Equatable, Identifiable {
    let offerId: String
    let offerHash: String?
    let offerKind: String?
    let offerRung: String?
    let provider: JobPerson?
    let performer: JobPerson?
    let facility: JobPerson?
    let lines: [QuoteLine]
    let availableFrom: String?
    let availableUntil: String?
    let offeredAt: String?
    let note: String?
    let acceptanceState: String
    let acceptedAt: String?
    /// The hash accept_offer pins: offer_hash when nothing is co-signed, otherwise it also covers the current co-signs.
    let termsHash: String?
    let coSigns: [CoSign]

    var id: String { offerId }

    enum CodingKeys: String, CodingKey {
        case provider, performer, facility, terms, note, acceptance
        case termsHash = "terms_hash"
        case coSigns = "co_signs"
        case offerId = "offer_id"
        case offerHash = "offer_hash"
        case offerKind = "offer_kind"
        case offerRung = "offer_rung"
        case availableFrom = "available_from"
        case availableUntil = "available_until"
        case offeredAt = "offered_at"
    }
    private struct Acceptance: Decodable { let state: String?; let accepted_at: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        offerId = try c.decode(String.self, forKey: .offerId)
        offerHash = try? c.decode(String.self, forKey: .offerHash)
        offerKind = try? c.decode(String.self, forKey: .offerKind)
        offerRung = try? c.decode(String.self, forKey: .offerRung)
        provider = try? c.decode(JobPerson.self, forKey: .provider)
        performer = try? c.decode(JobPerson.self, forKey: .performer)
        facility = try? c.decode(JobPerson.self, forKey: .facility)
        lines = (try? c.decode(OfferTermsLines.self, forKey: .terms))?.lines ?? []
        availableFrom = try? c.decode(String.self, forKey: .availableFrom)
        availableUntil = try? c.decode(String.self, forKey: .availableUntil)
        offeredAt = try? c.decode(String.self, forKey: .offeredAt)
        note = try? c.decode(String.self, forKey: .note)
        let a = try? c.decode(Acceptance.self, forKey: .acceptance)
        acceptanceState = a?.state ?? "not_accepted"
        acceptedAt = a?.accepted_at
        termsHash = try? c.decode(String.self, forKey: .termsHash)
        coSigns = ((try? c.decode([CoSignSlot].self, forKey: .coSigns)) ?? []).compactMap(\.cosign)
    }

    private struct CoSignSlot: Decodable {
        let cosign: CoSign?
        init(from decoder: Decoder) throws { cosign = try? CoSign(from: decoder) }
    }

    /// The hash an acceptance of this offer must carry.
    var acceptHash: String? { termsHash ?? offerHash }

    var who: String { (offerKind == "organization" ? facility ?? provider : provider)?.text ?? "Unnamed party" }
}

/// Someone vouching for an offer's technician on this job: kinds, scope and an optional cut.
struct CoSign: Decodable, Equatable, Identifiable {
    struct Cut: Decodable, Equatable {
        let basis: String?
        let percentage: Double?
        let amount: Double?
        let currency: String?
    }
    let cosignId: String
    let coSigner: JobPerson?
    let kinds: [String]
    let scope: String?
    let cut: Cut?
    let signedAt: String?
    var id: String { cosignId }

    enum CodingKeys: String, CodingKey {
        case kinds, scope, cut
        case cosignId = "cosign_id"
        case coSigner = "co_signer"
        case signedAt = "signed_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cosignId = try c.decode(String.self, forKey: .cosignId)
        coSigner = try? c.decode(JobPerson.self, forKey: .coSigner)
        kinds = (try? c.decode([String].self, forKey: .kinds)) ?? []
        scope = try? c.decode(String.self, forKey: .scope)
        cut = try? c.decode(Cut.self, forKey: .cut)
        signedAt = try? c.decode(String.self, forKey: .signedAt)
    }
}

/// `{lines:[...]}` with each line keyed by its position; a malformed line is skipped.
struct OfferTermsLines: Decodable {
    let lines: [QuoteLine]
    enum CodingKeys: String, CodingKey { case lines }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard var list = try? c.nestedUnkeyedContainer(forKey: .lines) else { lines = []; return }
        var out: [QuoteLine] = []
        var i = 0
        while !list.isAtEnd {
            if let line = try? QuoteLine(index: i, from: list.superDecoder()) { out.append(line) }
            i += 1
        }
        lines = out
    }
}

struct RequirementOffers: Decodable, Equatable, Identifiable {
    let requirementId: String
    let kind: String?
    let description: String?
    let offers: [JobOffer]
    var id: String { requirementId }

    enum CodingKeys: String, CodingKey {
        case description, offers
        case requirementId = "requirement_id"
        case kind = "requirement_kind"
    }
    private struct Slot: Decodable {
        let offer: JobOffer?
        init(from decoder: Decoder) throws { offer = try? JobOffer(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requirementId = try c.decode(String.self, forKey: .requirementId)
        kind = try? c.decode(String.self, forKey: .kind)
        description = try? c.decode(String.self, forKey: .description)
        offers = ((try? c.decode([Slot].self, forKey: .offers)) ?? []).compactMap(\.offer)
    }
}

struct AcceptedProvider: Decodable, Equatable {
    let role: String?
    let acceptedAt: String?
    let provider: JobPerson?
    let performer: JobPerson?

    enum CodingKeys: String, CodingKey {
        case role, provider, performer
        case acceptedAt = "accepted_at"
    }

    var who: String { provider?.text ?? performer?.text ?? "Unnamed party" }
}

struct WorkOrderOffers: Decodable, Equatable {
    let requirements: [RequirementOffers]
    let acceptedProviders: [AcceptedProvider]
    let viewer: JobViewer?

    enum CodingKeys: String, CodingKey {
        case requirements, viewer
        case acceptedProviders = "accepted_providers"
    }
    private struct Slot: Decodable {
        let req: RequirementOffers?
        init(from decoder: Decoder) throws { req = try? RequirementOffers(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requirements = ((try? c.decode([Slot].self, forKey: .requirements)) ?? []).compactMap(\.req)
        acceptedProviders = (try? c.decode([AcceptedProvider].self, forKey: .acceptedProviders)) ?? []
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
    }

    var actions: [JobAction] { viewer?.actions ?? [] }

    func offerAction(for requirementId: String) -> JobAction? {
        actions.first { $0.kind == "offer" && $0.args["p_requirement_id"]?.stringValue == requirementId }
    }

    func withdrawAction(for offerId: String) -> JobAction? {
        actions.first { $0.kind == "withdraw_offer" && $0.args["p_offer_id"]?.stringValue == offerId }
    }

    /// The server's accept step for this offer; its p_offer_hash is the terms hash (co-signs included).
    func acceptAction(for offer: JobOffer) -> JobAction? {
        actions.first { $0.kind == "accept_offer" && $0.args["p_offer_id"]?.stringValue == offer.offerId }
    }

    func cosignAction(for offer: JobOffer) -> JobAction? {
        actions.first { $0.kind == "cosign_provider" && $0.args["p_offer_id"]?.stringValue == offer.offerId }
    }

    var offerCount: Int { requirements.reduce(0) { $0 + $1.offers.count } }
}

struct OfferReceipt: Decodable, Equatable {
    let offerId: String?
    let offerRung: String?
    let duplicate: Bool

    enum CodingKeys: String, CodingKey {
        case duplicate
        case offerId = "offer_id"
        case offerRung = "offer_rung"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        offerId = try? c.decode(String.self, forKey: .offerId)
        offerRung = try? c.decode(String.self, forKey: .offerRung)
        duplicate = (try? c.decode(Bool.self, forKey: .duplicate)) == true
    }
}

// MARK: - Offer drafting (validated locally before the server's own checks)

struct OfferLineDraft: Equatable, Identifiable {
    var id = UUID()
    var description: String
    var pricingBasis: String = "flat"
    var amount: String = ""
    var currency: String = "USD"
    var quantity: String = ""
}

struct OfferParams: Encodable, Equatable {
    struct Line: Encodable, Equatable {
        let description: String
        let pricing_basis: String
        let amount: Double
        let currency: String
        let unit: String?
        let quantity: Double?
    }
    struct Terms: Encodable, Equatable { let lines: [Line] }

    let p_requirement_id: String
    let p_terms: Terms
    let p_available_from: String?
    let p_available_until: String?
    let p_note: String?
}

enum OfferDrafting {
    static let bases: [(key: String, title: String)] = [("flat", "Flat price"), ("hourly", "Hourly"), ("day_rate", "Day rate"),
                                                         ("per_operation", "Per operation")]

    static func unit(_ basis: String) -> String? {
        switch basis {
        case "hourly": return "hour"
        case "day_rate": return "day"
        case "per_operation": return "operation"
        default: return nil
        }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// The offer body for the server's offer action, or the reason it can't be sent yet.
    static func params(action: JobAction, lines: [OfferLineDraft], window: (from: Date, until: Date)?,
                       note: String, now: Date = Date()) -> Result<OfferParams, JobSignFailure> {
        guard action.kind == "offer", (action.rpc ?? "offer_on_requirement") == "offer_on_requirement",
              let rid = action.args["p_requirement_id"]?.stringValue else {
            return .failure(JobSignFailure(text: "This job isn't taking offers from your account."))
        }
        var out: [OfferParams.Line] = []
        for d in lines {
            let desc = d.description.trimmingCharacters(in: .whitespacesAndNewlines)
            guard (1...300).contains(desc.count), !desc.contains("\n") else {
                return .failure(JobSignFailure(text: "Each line needs a short description."))
            }
            guard bases.contains(where: { $0.key == d.pricingBasis }) else {
                return .failure(JobSignFailure(text: "Pick how each line is priced."))
            }
            guard let amount = Double(d.amount.replacingOccurrences(of: ",", with: "")), amount.isFinite, amount >= 0 else {
                return .failure(JobSignFailure(text: "Each line needs an amount."))
            }
            let cur = d.currency.trimmingCharacters(in: .whitespaces).uppercased()
            guard cur.count == 3, cur.allSatisfy({ $0.isLetter && $0.isASCII }) else {
                return .failure(JobSignFailure(text: "Each line needs a three-letter currency, like USD."))
            }
            var qty: Double? = nil
            let qText = d.quantity.trimmingCharacters(in: .whitespaces)
            if !qText.isEmpty && d.pricingBasis != "flat" {
                guard let q = Double(qText), q.isFinite, q > 0 else {
                    return .failure(JobSignFailure(text: "Quantity must be more than zero."))
                }
                qty = q
            }
            out.append(.init(description: desc, pricing_basis: d.pricingBasis, amount: amount, currency: cur,
                             unit: unit(d.pricingBasis), quantity: qty))
        }
        guard !out.isEmpty, out.count <= 20 else { return .failure(JobSignFailure(text: "Add at least one priced line.")) }
        if let w = window {
            guard w.from < w.until, w.until > now else {
                return .failure(JobSignFailure(text: "Pick a window in the future that starts before it ends."))
            }
        }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= 500, !trimmed.contains("\n") else {
            return .failure(JobSignFailure(text: "Keep the note to one line."))
        }
        return .success(OfferParams(p_requirement_id: rid, p_terms: .init(lines: out),
                                    p_available_from: window.map { iso.string(from: $0.from) },
                                    p_available_until: window.map { iso.string(from: $0.until) },
                                    p_note: trimmed.isEmpty ? nil : trimmed))
    }

    /// The accept body, only when the server's action names this exact offer and hash.
    /// The accept body: the id and hash exactly as the server's action names them, and only when that
    /// hash is the terms this sheet shows (offer + current co-signs), never the bare offer_hash of a co-signed offer.
    static func acceptArguments(_ action: JobAction, offer: JobOffer) -> (id: String, hash: String)? {
        guard action.kind == "accept_offer", (action.rpc ?? "accept_offer") == "accept_offer",
              let id = action.args["p_offer_id"]?.stringValue, let hash = action.args["p_offer_hash"]?.stringValue,
              id == offer.offerId, hash == offer.acceptHash else { return nil }
        return (id, hash)
    }
}

// MARK: - Words

enum OfferCopy {
    static func kind(_ k: String) -> String {
        switch k {
        case "skill": return "Skill"
        case "inspection": return "Inspection"
        case "tool": return "Tool"
        case "equipment": return "Equipment"
        case "facility": return "Shop space"
        case "approval": return "Approval"
        default: return JobCopy.sentence(k)
        }
    }

    static func input(_ i: String) -> String {
        switch i {
        case "skill": return "Skill"
        case "tools": return "Tools"
        case "facility": return "Shop space"
        case "area": return "Area"
        case "availability": return "Availability"
        case "evidence_rung": return "Technician profile"
        default: return JobCopy.sentence(i)
        }
    }

    /// One match input in plain words, from the reader's own reason.
    static func reason(_ m: MatchInput) -> String {
        let r = m.reason ?? ""
        if r.hasPrefix("not required for a") { return "Not needed for this" }
        switch m.input {
        case "skill":
            if m.result == "pass", let range = r.range(of: "capability ") {
                let named = r[range.upperBound...].replacingOccurrences(of: " is named in the requirement", with: "")
                return "Your record shows \(named.replacingOccurrences(of: "_", with: " "))"
            }
            if r.contains("do not name") { return "Your record doesn't show this skill yet" }
            return "Not shown in your record yet"
        case "tools":
            if m.result == "pass", let range = r.range(of: "requirement: ") {
                let tail = r[range.upperBound...]
                let names = tail.components(separatedBy: " (claimed").first ?? String(tail)
                return "You said you own: \(names)"
            }
            return r.contains("no claimed tool records") ? "No tools in your records" : "No matching tool in your records"
        case "facility":
            return FacilityCopy.match(FacilityMatch(result: m.result, next: m.next, reason: m.reason))
        case "area":
            if let within = r.range(of: #"within your (\d+)-mile service area"#, options: .regularExpression) {
                return "Within your \(r[within].filter(\.isNumber))-mile service area"
            }
            if let outside = r.range(of: #"outside your (\d+)-mile service area"#, options: .regularExpression) {
                return "Outside your \(r[outside].filter(\.isNumber))-mile service area"
            }
            if r.hasPrefix("same state as your service area") { return "Same state as your service area (distance not worked out)" }
            if r.hasPrefix("different state from your service area") { return "Different state from your service area" }
            if m.result == "pass" { return r.contains("and city") ? "Same city" : "Same state" }
            if r.contains("job area not public") { return "The job's area isn't public" }
            if r.contains("states no area") { return "Your profile doesn't list an area" }
            return "Different state"
        case "availability":
            if m.result == "pass" { return "Your hours fall inside the job window" }
            if r.contains("window has passed") { return "The job window has passed" }
            if r.hasPrefix("no declared availability inside") { return "Your hours don't cover the job window" }
            return "You haven't set availability yet"
        case "evidence_rung":
            if m.result == "pass" { return "Linked and backed by your work" }
            if m.result == "unknown" { return "Linked by you — not yet backed by work" }
            return "Not linked yet"
        default:
            return JobCopy.sentence(r)
        }
    }

    static func next(_ n: String?) -> String? {
        switch n {
        case "plan_b_supplier_needed"?: return "needs a backup supplier"
        case "claim_provider_link"?: return "link your technician profile"
        case let other?: return JobCopy.sentence(other).lowercased()
        case nil: return nil
        }
    }

    static func symbol(_ result: String) -> (name: String, tint: String) {
        switch result {
        case "pass": return ("checkmark.circle.fill", "green")
        case "fail": return ("minus.circle", "secondary")
        default: return ("questionmark.circle", "secondary")
        }
    }

    static func rung(_ r: String?) -> String {
        switch r {
        case "self_claim"?, "unknown"?, nil: return "Linked by them — not yet backed by work"
        case "work_evidence"?: return "Backed by their work"
        case "co_sign"?: return "Vouched for by someone they worked with"
        case "authenticated_sign"?: return "Signed"
        case "organization_owner"?: return "Shop owner"
        case let other?: return JobCopy.sentence(other)
        }
    }

    /// The rung an offer from you will carry.
    static func yourRung(_ r: String?) -> String {
        switch r {
        case "self_claim"?, "unknown"?, nil: return "Linked by you — not yet backed by work"
        case "work_evidence"?: return "Backed by your work"
        case "co_sign"?: return "Vouched for by someone you worked with"
        case "authenticated_sign"?: return "Signed"
        case "organization_owner"?: return "Shop owner"
        case let other?: return JobCopy.sentence(other)
        }
    }

    static func window(_ from: String?, _ until: String?) -> String? {
        switch (JobCopy.day(from), JobCopy.day(until)) {
        case let (f?, u?): return "\(f) – \(u)"
        case let (f?, nil): return "from \(f)"
        case let (nil, u?): return "until \(u)"
        default: return nil
        }
    }

    static func acceptance(_ state: String) -> String {
        switch state {
        case "accepted": return "Accepted by the customer"
        case "withheld": return "Acceptance on hold"
        default: return "Not accepted yet"
        }
    }

    static func offerFailure(_ error: Error) -> String {
        guard let pg = error as? PostgrestError else { return ReadFailure.text(error) }
        let m = pg.message
        if m.contains("no_actor_link") { return "Link your technician profile first (Account → Technician profile)." }
        if m.contains("customer_cannot_offer") { return "You're the customer on this job." }
        if m.contains("individual_offers_cover_skill_and_inspection") {
            return "You can offer on skill and inspection needs. Tools and shop space are offered by a shop."
        }
        if m.contains("name_performer_actor_id") { return "You have more than one technician profile linked; this app can't choose one yet." }
        if m.contains("requirement_unavailable") { return "This request is closed." }
        if m.contains("Availability needs") { return "Pick a window in the future that starts before it ends." }
        if m.contains("Note must be") { return "Keep the note to one line." }
        if m.contains("Invalid offer line") || m.contains("Terms must be") { return "Check the price lines: each needs an amount and a currency." }
        if m.contains("Authentication required") { return "Sign in to make an offer." }
        if m.contains("Offer unavailable") { return "This offer is no longer open." }
        return ReadFailure.text(error)
    }

    static func acceptFailure(_ error: Error) -> String {
        guard let pg = error as? PostgrestError else { return ReadFailure.text(error) }
        let m = pg.message
        if m.contains("hash does not match") { return "This offer or its co-signs changed since you opened it. Refresh and review it again." }
        if m.contains("offer_window_closed") { return "Their availability window has passed." }
        if m.contains("offering_account_cannot_accept") { return "You can't accept your own offer." }
        if m.contains("facility_offer_not_an_assignment") { return "A shop-space offer can't be accepted as a job assignment yet." }
        if m.contains("work_order_concluded") { return "This job is closed." }
        if m.contains("not_customer") || m.contains("Offer unavailable") { return "Only the customer on this job can accept offers." }
        if m.contains("Authentication required") { return "Sign in to accept this offer." }
        return ReadFailure.text(error)
    }
}

// MARK: - Readers and writers (writers only from explicit confirm buttons)

enum OfferReaders {
    static func openRequirements(after: String? = nil, limit: Int = 25) async -> JobLoad<OpenRequirements> {
        struct P: Encodable { let p_after: String?; let p_limit: Int }
        return await JobReaders.call("open_requirements_read") {
            try await SupabaseService.client.rpc("open_requirements_read", params: P(p_after: after, p_limit: limit)).execute().data
        }
    }

    /// One job's open requirements, filtered on the server (work_order_open_requirements_read).
    /// Until that reader is deployed, falls back to the marketplace page filtered on the device.
    static func openRequirements(workOrderId: String) async -> JobLoad<OpenRequirements> {
        struct P: Encodable { let p_work_order_id: String; let p_limit: Int }
        do {
            let data = try await SupabaseService.client.rpc("work_order_open_requirements_read",
                params: P(p_work_order_id: workOrderId, p_limit: 100)).execute().data
            return .loaded(try JobReaders.decode(OpenRequirements.self, from: data))
        } catch {
            NSLog("NukeCapture work_order_open_requirements_read unavailable, falling back: %@", String(describing: error))
            let page = await openRequirements(limit: 100)
            guard case .loaded(let all) = page else { return page }
            return .loaded(onlyWorkOrder(all, workOrderId))
        }
    }

    /// The device-side filter the fallback applies (unit-tested).
    static func onlyWorkOrder(_ page: OpenRequirements, _ workOrderId: String) -> OpenRequirements {
        var out = page
        out.rows = page.rows.filter { $0.workOrderId == workOrderId }
        return out
    }

    static func offers(workOrderId: String) async -> JobLoad<WorkOrderOffers> {
        await JobReaders.call("work_order_offers_read") {
            try await SupabaseService.client.rpc("work_order_offers_read", params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    static func makeOffer(_ params: OfferParams) async -> Result<OfferReceipt, JobSignFailure> {
        do {
            let data = try await SupabaseService.client.rpc("offer_on_requirement", params: params).execute().data
            return .success(try JobReaders.decode(OfferReceipt.self, from: data))
        } catch {
            NSLog("NukeCapture offer_on_requirement failed: %@", String(describing: error))
            return .failure(JobSignFailure(text: OfferCopy.offerFailure(error)))
        }
    }

    static func withdraw(_ action: JobAction) async -> String? {
        guard action.kind == "withdraw_offer", let id = action.args["p_offer_id"]?.stringValue else {
            return "This offer can't be withdrawn from here."
        }
        do {
            try await SupabaseService.client.rpc("withdraw_offer", params: ["p_offer_id": id]).execute()
            return nil
        } catch {
            NSLog("NukeCapture withdraw_offer failed: %@", String(describing: error))
            return OfferCopy.offerFailure(error)
        }
    }

    static func accept(_ action: JobAction, offer: JobOffer) async -> String? {
        guard let args = OfferDrafting.acceptArguments(action, offer: offer) else {
            return "This offer changed since you opened it. Refresh and review it again."
        }
        struct P: Encodable { let p_offer_id: String; let p_offer_hash: String }
        do {
            try await SupabaseService.client.rpc("accept_offer", params: P(p_offer_id: args.id, p_offer_hash: args.hash)).execute()
            return nil
        } catch {
            NSLog("NukeCapture accept_offer failed: %@", String(describing: error))
            return OfferCopy.acceptFailure(error)
        }
    }
}
