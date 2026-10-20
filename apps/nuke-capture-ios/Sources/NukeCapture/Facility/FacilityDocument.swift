// FacilityDocument.swift — a shop's space and equipment, and booking it for a job.
//
// facility_read(p_organization_id) (anon + authenticated; public shops, or their owners/members):
// declared assets grouped by kind with capacity, a 60-day calendar of confirmed busy windows
// (reservation and job ids only for parties), licenses as type/authority/expiry/state (numbers and
// documents are never returned), members by public handle, and viewer.actions
// (declare_facility_asset for owners/members). Writers: declare_facility_asset, reserve_facility
// (customer or accepted provider; the shop must confirm), confirm_facility_reservation (hash-pinned,
// from the signature queue kind facility_reservation_to_confirm), cancel_facility_reservation.
// open_requirements_read's facility input lists declared matching assets a job can reach.
// Nothing here moves money; payment_authorized is always false.

import Foundation
import Supabase

// MARK: - facility_read

struct FacilityRead: Decodable, Equatable {
    struct Busy: Decodable, Equatable, Identifiable {
        let from: String
        let until: String
        let slot: Int?
        /// Present only for parties: the shop's owners/members, or the person who asked.
        let reservationId: String?
        let workOrderId: String?
        var id: String { "\(from)|\(until)|\(slot ?? 0)|\(reservationId ?? "")" }

        enum CodingKeys: String, CodingKey {
            case from, until, slot
            case reservationId = "reservation_id"
            case workOrderId = "work_order_id"
        }
    }

    struct Asset: Decodable, Equatable, Identifiable {
        let assetId: String
        let kind: String
        let label: String
        let capacity: Int
        let declaredAt: String?
        let evidenceCount: Int
        let busy: [Busy]
        var id: String { assetId }

        enum CodingKeys: String, CodingKey {
            case label, capacity, busy
            case assetId = "asset_id"
            case declaredAt = "declared_at"
            case evidenceCount = "evidence_count"
        }

        init(assetId: String, kind: String, label: String, capacity: Int, declaredAt: String? = nil, evidenceCount: Int = 0, busy: [Busy] = []) {
            self.assetId = assetId; self.kind = kind; self.label = label; self.capacity = capacity
            self.declaredAt = declaredAt; self.evidenceCount = evidenceCount; self.busy = busy
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(assetId: try c.decode(String.self, forKey: .assetId), kind: "other",
                      label: (try? c.decode(String.self, forKey: .label)) ?? "Unnamed",
                      capacity: (try? c.decode(Int.self, forKey: .capacity)) ?? 1,
                      declaredAt: try? c.decode(String.self, forKey: .declaredAt),
                      evidenceCount: (try? c.decode(Int.self, forKey: .evidenceCount)) ?? 0,
                      busy: (try? c.decode([Lossy<Busy>].self, forKey: .busy))?.compactMap(\.value) ?? [])
        }
    }

    struct KindGroup: Decodable, Equatable, Identifiable {
        let kind: String
        let capacityTotal: Int
        let assets: [Asset]
        var id: String { kind }

        enum CodingKeys: String, CodingKey {
            case kind, assets
            case capacityTotal = "capacity_total"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let k = (try? c.decode(String.self, forKey: .kind)) ?? "other"
            kind = k
            capacityTotal = (try? c.decode(Int.self, forKey: .capacityTotal)) ?? 0
            let raw = (try? c.decode([Lossy<Asset>].self, forKey: .assets))?.compactMap(\.value) ?? []
            assets = raw.map { Asset(assetId: $0.assetId, kind: k, label: $0.label, capacity: $0.capacity,
                                     declaredAt: $0.declaredAt, evidenceCount: $0.evidenceCount, busy: $0.busy) }
        }
    }

    struct License: Decodable, Equatable, Identifiable {
        let licenseType: String?
        let issuingAuthority: String?
        let expirationDate: String?
        let verified: Bool
        let state: String?
        var id: String { [licenseType, issuingAuthority, expirationDate].compactMap { $0 }.joined(separator: "|") }

        enum CodingKeys: String, CodingKey {
            case verified, state
            case licenseType = "license_type"
            case issuingAuthority = "issuing_authority"
            case expirationDate = "expiration_date"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            licenseType = try? c.decode(String.self, forKey: .licenseType)
            issuingAuthority = try? c.decode(String.self, forKey: .issuingAuthority)
            expirationDate = try? c.decode(String.self, forKey: .expirationDate)
            verified = (try? c.decode(Bool.self, forKey: .verified)) ?? false
            state = try? c.decode(String.self, forKey: .state)
        }
    }

    struct Member: Decodable, Equatable, Identifiable {
        let person: JobPerson
        let relation: String?
        var id: String { person.handle ?? person.profileId ?? person.text }

        init(from decoder: Decoder) throws {
            person = try JobPerson(from: decoder)
            relation = try? decoder.container(keyedBy: JobCodingKey.self).decode(String.self, forKey: JobCodingKey("relation"))
        }
    }

    struct Viewer: Decodable, Equatable {
        let role: String?
        let party: Bool
        let actions: [JobAction]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            role = try? c.decode(String.self, forKey: JobCodingKey("role"))
            party = (try? c.decode(Bool.self, forKey: JobCodingKey("party"))) ?? false
            actions = (try? c.decode([Lossy<JobAction>].self, forKey: JobCodingKey("actions")))?.compactMap(\.value) ?? []
        }
    }

    let organizationId: String?
    let organizationName: String?
    let groups: [KindGroup]
    let licenses: [License]
    let members: [Member]
    let membersUnnamed: Int
    let calendarFrom: String?
    let calendarUntil: String?
    let viewer: Viewer?
    let asOf: String?

    var declareAction: JobAction? { viewer?.actions.first { $0.kind == "declare_facility_asset" } }
    var assets: [Asset] { groups.flatMap(\.assets) }

    private struct Org: Decodable { let organization_id: String?; let name: String? }
    private struct Calendar: Decodable { let from: String?; let until: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        let org = try? c.decode(Org.self, forKey: JobCodingKey("organization"))
        organizationId = org?.organization_id
        organizationName = org?.name
        groups = (try? c.decode([Lossy<KindGroup>].self, forKey: JobCodingKey("assets_by_kind")))?.compactMap(\.value) ?? []
        licenses = (try? c.decode([Lossy<License>].self, forKey: JobCodingKey("licenses")))?.compactMap(\.value) ?? []
        members = ((try? c.decode([Lossy<Member>].self, forKey: JobCodingKey("members")))?.compactMap(\.value) ?? [])
            .filter { $0.person.handle != nil }
        membersUnnamed = (try? c.decode(Int.self, forKey: JobCodingKey("members_unnamed"))) ?? 0
        let cal = try? c.decode(Calendar.self, forKey: JobCodingKey("calendar"))
        calendarFrom = cal?.from
        calendarUntil = cal?.until
        viewer = try? c.decode(Viewer.self, forKey: JobCodingKey("viewer"))
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
    }
}

/// Decodes one element or yields nil, so a malformed row never sinks its siblings.
struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

// MARK: - open_requirements_read facility input, and the job's booking state

/// A declared asset a job can reach (the viewer's shops, the job's shop, or a proposed facility).
struct FacilityChoice: Decodable, Equatable, Identifiable, Hashable {
    let assetId: String
    let kind: String
    let label: String
    let capacity: Int
    let organizationId: String?
    let organizationName: String?
    /// nil when the job has no window, so availability wasn't checked.
    let freeInWindow: Bool?
    var id: String { assetId }

    init(assetId: String, kind: String, label: String, capacity: Int, organizationId: String?, organizationName: String?, freeInWindow: Bool? = nil) {
        self.assetId = assetId; self.kind = kind; self.label = label; self.capacity = capacity
        self.organizationId = organizationId; self.organizationName = organizationName; self.freeInWindow = freeInWindow
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        struct Org: Decodable { let organization_id: String?; let name: String? }
        let org = try? c.decode(Org.self, forKey: JobCodingKey("organization"))
        self.init(assetId: try c.decode(String.self, forKey: JobCodingKey("asset_id")),
                  kind: (try? c.decode(String.self, forKey: JobCodingKey("kind"))) ?? "other",
                  label: (try? c.decode(String.self, forKey: JobCodingKey("label"))) ?? "Unnamed",
                  capacity: (try? c.decode(Int.self, forKey: JobCodingKey("capacity"))) ?? 1,
                  organizationId: org?.organization_id, organizationName: org?.name,
                  freeInWindow: try? c.decode(Bool.self, forKey: JobCodingKey("free_in_window")))
    }

    static func from(_ read: FacilityRead) -> [FacilityChoice] {
        read.assets.map { FacilityChoice(assetId: $0.assetId, kind: $0.kind, label: $0.label, capacity: $0.capacity,
                                         organizationId: read.organizationId, organizationName: read.organizationName) }
    }
}

/// The facility input of one open requirement: pass (assets listed), fail (all booked) or unknown.
struct FacilityMatch: Decodable, Equatable {
    let result: String
    let next: String?
    let reason: String?
    let kinds: [String]
    let assets: [FacilityChoice]
    let windowFrom: String?
    let windowUntil: String?

    init(result: String, next: String? = nil, reason: String? = nil, kinds: [String] = [], assets: [FacilityChoice] = [],
         windowFrom: String? = nil, windowUntil: String? = nil) {
        self.result = result; self.next = next; self.reason = reason; self.kinds = kinds; self.assets = assets
        self.windowFrom = windowFrom; self.windowUntil = windowUntil
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        guard (try? c.decode(String.self, forKey: JobCodingKey("input"))) == "facility" else {
            throw DecodingError.dataCorruptedError(forKey: JobCodingKey("input"), in: c, debugDescription: "not the facility input")
        }
        struct Window: Decodable { let from: String?; let until: String? }
        let w = try? c.decode(Window.self, forKey: JobCodingKey("window"))
        self.init(result: (try? c.decode(String.self, forKey: JobCodingKey("result"))) ?? "unknown",
                  next: try? c.decode(String.self, forKey: JobCodingKey("next")),
                  reason: try? c.decode(String.self, forKey: JobCodingKey("reason")),
                  kinds: (try? c.decode([String].self, forKey: JobCodingKey("kinds"))) ?? [],
                  assets: (try? c.decode([Lossy<FacilityChoice>].self, forKey: JobCodingKey("assets")))?.compactMap(\.value) ?? [],
                  windowFrom: w?.from, windowUntil: w?.until)
    }
}

/// open_requirements_read rows reduced to each requirement's facility input.
struct FacilityMatches: Decodable, Equatable {
    let byRequirement: [String: FacilityMatch]

    private struct Row: Decodable {
        let requirement_id: String
        let match: [Lossy<FacilityMatch>]?
    }

    init(byRequirement: [String: FacilityMatch]) { self.byRequirement = byRequirement }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        let rows = (try? c.decode([Lossy<Row>].self, forKey: JobCodingKey("rows")))?.compactMap(\.value) ?? []
        var out: [String: FacilityMatch] = [:]
        for r in rows {
            if let m = r.match?.compactMap(\.value).first { out[r.requirement_id] = m }
        }
        byRequirement = out
    }
}

/// work_order_facility_reservations_read: the job's booking requests. Parties, the requester and
/// the shop see every request with its state and terms; everyone else sees confirmed busy windows.
struct JobReservations: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        let reservationId: String?
        let assetLabel: String
        let assetKind: String
        let shopName: String?
        let shopId: String?
        let from: String?
        let until: String?
        let state: String
        let requesterRole: String?
        let requestedBy: JobPerson?
        let terms: FacilityRequestSummary.Terms?
        let party: Bool
        var id: String { reservationId ?? "\(assetLabel)|\(from ?? "")|\(state)" }

        private struct Asset: Decodable { let label: String?; let kind: String? }
        private struct Shop: Decodable { let name: String?; let organization_id: String? }
        private struct Window: Decodable { let from: String?; let until: String? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            let a = try? c.decode(Asset.self, forKey: JobCodingKey("asset"))
            let shop = try? c.decode(Shop.self, forKey: JobCodingKey("shop"))
            let w = try? c.decode(Window.self, forKey: JobCodingKey("window"))
            reservationId = try? c.decode(String.self, forKey: JobCodingKey("reservation_id"))
            assetLabel = a?.label ?? "Shop space"
            assetKind = a?.kind ?? "other"
            shopName = shop?.name
            shopId = shop?.organization_id
            from = w?.from
            until = w?.until
            state = (try? c.decode(String.self, forKey: JobCodingKey("state"))) ?? "requested"
            requesterRole = try? c.decode(String.self, forKey: JobCodingKey("requester_role"))
            requestedBy = try? c.decode(JobPerson.self, forKey: JobCodingKey("requested_by"))
            terms = try? c.decode(FacilityRequestSummary.Terms.self, forKey: JobCodingKey("terms"))
            party = (try? c.decode(String.self, forKey: JobCodingKey("visibility"))) == "party"
        }
    }

    let items: [Item]
    let actions: [JobAction]
    let party: Bool

    private struct Viewer: Decodable {
        let party: Bool?
        let actions: [Lossy<JobAction>]?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        items = (try? c.decode([Lossy<Item>].self, forKey: JobCodingKey("reservations")))?.compactMap(\.value) ?? []
        let v = try? c.decode(Viewer.self, forKey: JobCodingKey("viewer"))
        actions = v?.actions?.compactMap(\.value) ?? []
        party = v?.party ?? false
    }

    var reserveAction: JobAction? { actions.first { $0.kind == "reserve_facility" } }

    func cancelAction(for reservationId: String?) -> JobAction? {
        guard let reservationId else { return nil }
        return actions.first { $0.kind == "cancel_facility_reservation" && $0.args["p_reservation_id"]?.stringValue == reservationId }
    }
}

extension JobAction {
    /// reserve_facility's reachable shops: the job's shop and any proposed facility.
    var facilities: [(id: String, name: String?)] {
        guard case .array(let list)? = raw["facilities"] else { return [] }
        return list.compactMap { item in
            guard case .object(let o) = item, let id = o["organization_id"]?.stringValue else { return nil }
            return (id, o["name"]?.stringValue)
        }
    }
    var facilityRequirementId: String? { raw["facility_requirement_id"]?.stringValue }
}

/// What the job page shows for shop space.
struct JobFacility: Equatable {
    struct Requirement: Equatable, Identifiable {
        let requirementId: String
        let description: String?
        var id: String { requirementId }
    }

    let requirements: [Requirement]
    let reservations: JobReservations?
    /// Declared assets at the shops reserve_facility names, read for "Book a bay".
    let choices: [FacilityChoice]

    var reserveAction: JobAction? { reservations?.reserveAction }
    var isEmpty: Bool { requirements.isEmpty && (reservations?.items.isEmpty ?? true) && reserveAction == nil }
}

/// reserve_facility's answer: the request waiting on the shop.
struct FacilityReservation: Decodable, Equatable {
    let reservationId: String
    let organizationId: String?
    let assetId: String?
    let from: String?
    let until: String?
    let state: String?
    let capacityFreeNow: Bool?

    private struct Window: Decodable { let from: String?; let until: String? }

    init(reservationId: String, organizationId: String?, assetId: String?, from: String?, until: String?, state: String?, capacityFreeNow: Bool?) {
        self.reservationId = reservationId; self.organizationId = organizationId; self.assetId = assetId
        self.from = from; self.until = until; self.state = state; self.capacityFreeNow = capacityFreeNow
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        let w = try? c.decode(Window.self, forKey: JobCodingKey("window"))
        self.init(reservationId: try c.decode(String.self, forKey: JobCodingKey("reservation_id")),
                  organizationId: try? c.decode(String.self, forKey: JobCodingKey("organization_id")),
                  assetId: try? c.decode(String.self, forKey: JobCodingKey("asset_id")),
                  from: w?.from, until: w?.until,
                  state: try? c.decode(String.self, forKey: JobCodingKey("state")),
                  capacityFreeNow: try? c.decode(Bool.self, forKey: JobCodingKey("capacity_free_now")))
    }
}

/// The facility_reservation_to_confirm queue item's summary.
struct FacilityRequestSummary: Decodable, Equatable {
    struct Asset: Decodable, Equatable { let asset_id: String?; let kind: String?; let label: String?; let capacity: Int? }
    struct Terms: Decodable, Equatable { let basis: String?; let amount: Double?; let currency: String? }
    struct Org: Decodable, Equatable { let organization_id: String?; let name: String? }

    let asset: Asset?
    let organization: Org?
    let requesterRole: String?
    let requestedBy: JobPerson?
    let terms: Terms?
    let capacityFree: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        asset = try? c.decode(Asset.self, forKey: JobCodingKey("asset"))
        organization = try? c.decode(Org.self, forKey: JobCodingKey("organization"))
        requesterRole = try? c.decode(String.self, forKey: JobCodingKey("requester_role"))
        requestedBy = try? c.decode(JobPerson.self, forKey: JobCodingKey("requested_by"))
        terms = try? c.decode(Terms.self, forKey: JobCodingKey("terms"))
        capacityFree = try? c.decode(Bool.self, forKey: JobCodingKey("capacity_free"))
    }
}

// MARK: - Readers and writers

enum FacilityReaders {
    static let readName = "facility_read"

    static func read(organizationId: String) async -> JobLoad<FacilityRead> {
        do {
            let data = try await SupabaseService.client.rpc(readName, params: ["p_organization_id": organizationId]).execute().data
            return .loaded(try JobReaders.decode(FacilityRead.self, from: data))
        } catch let pg as PostgrestError where pg.message.contains("Organization unavailable") {
            return .refused(JobRefusal(reader: readName, kind: .unavailable, title: "Shop not available",
                                       detail: "It's private, or it doesn't exist."))
        } catch {
            NSLog("NukeCapture %@ failed: %@", readName, String(describing: error))
            return .refused(JobReaders.refusal(readName, error))
        }
    }

    static let reservationsName = "work_order_facility_reservations_read"

    /// The job's shop-space needs, its booking requests, and (when the server offers reserve_facility) the bookable assets.
    static func job(workOrderId: String, requirements: [RequirementOffers]) async -> JobLoad<JobFacility> {
        let reqs = requirements.filter { $0.kind == "facility" }.map { JobFacility.Requirement(requirementId: $0.requirementId, description: $0.description) }
        let loaded: JobLoad<JobReservations> = await JobReaders.call(reservationsName) {
            try await SupabaseService.client.rpc(reservationsName, params: ["p_work_order_id": workOrderId]).execute().data
        }
        let reservations: JobReservations?
        switch loaded {
        case .loaded(let r): reservations = r
        case .refused(let refusal) where reqs.isEmpty: return .refused(refusal)
        default: reservations = nil
        }
        var choices: [FacilityChoice] = []
        for org in (reservations?.reserveAction?.facilities ?? []).prefix(5) {
            if case .loaded(let f) = await read(organizationId: org.id) { choices += FacilityChoice.from(f) }
        }
        return .loaded(JobFacility(requirements: reqs, reservations: reservations, choices: choices))
    }
}

enum FacilityWriters {
    static func write<P: Encodable & Sendable>(_ rpc: String, _ params: P) async -> Result<Data, JobSignFailure> {
        do {
            return .success(try await SupabaseService.client.rpc(rpc, params: params).execute().data)
        } catch {
            NSLog("NukeCapture %@ failed: %@", rpc, String(describing: error))
            return .failure(JobSignFailure(text: FacilityCopy.failure(error)))
        }
    }
}

// MARK: - Drafting (validated locally; the server re-checks everything)

enum FacilityDrafting {
    enum FeeBasis: String, CaseIterable, Identifiable {
        case none, hourly, day_rate
        var id: String { rawValue }
        var title: String {
            switch self {
            case .none: return "No fee"
            case .hourly: return "Hourly"
            case .day_rate: return "Day rate"
            }
        }
    }

    struct Terms: Encodable, Equatable, Sendable { let basis: String; let amount: Double; let currency: String }

    struct ReserveParams: Encodable, Equatable, Sendable {
        let p_work_order_id: String
        let p_asset_id: String
        let p_from: String
        let p_until: String
        let p_terms: Terms?
    }

    static func reserve(workOrderId: String, assetId: String?, from: Date, until: Date, basis: FeeBasis, amount: String, currency: String,
                        now: Date = Date()) -> Result<ReserveParams, JobSignFailure> {
        guard let assetId else { return .failure(JobSignFailure(text: "Choose a space.")) }
        guard from < until else { return .failure(JobSignFailure(text: "The end has to be after the start.")) }
        guard until > now else { return .failure(JobSignFailure(text: "Pick a time in the future.")) }
        guard until.timeIntervalSince(from) <= 31 * 86_400 else { return .failure(JobSignFailure(text: "A booking can be at most 31 days.")) }
        var terms: Terms?
        if basis != .none {
            guard let n = Double(amount.trimmingCharacters(in: .whitespaces)), n >= 0, n < 1_000_000 else {
                return .failure(JobSignFailure(text: "Enter the fee as a number."))
            }
            let cur = currency.trimmingCharacters(in: .whitespaces).uppercased()
            guard cur.count == 3, cur.allSatisfy({ $0.isLetter && $0.isASCII }) else {
                return .failure(JobSignFailure(text: "Currency is a 3-letter code, like USD."))
            }
            terms = Terms(basis: basis.rawValue, amount: n, currency: cur)
        }
        return .success(ReserveParams(p_work_order_id: workOrderId, p_asset_id: assetId, p_from: iso(from), p_until: iso(until), p_terms: terms))
    }

    struct Evidence: Encodable, Equatable, Sendable { let kind: String; let url: String }

    struct DeclareParams: Encodable, Equatable, Sendable {
        let p_organization_id: String
        let p_kind: String
        let p_label: String
        let p_capacity: Int
        let p_evidence: [Evidence]?
    }

    static func declare(action: JobAction, kind: String, label: String, capacity: Int, evidenceLink: String) -> Result<DeclareParams, JobSignFailure> {
        guard let org = action.args["p_organization_id"]?.stringValue else {
            return .failure(JobSignFailure(text: "This shop can't take declarations right now."))
        }
        guard FacilityCopy.kinds.contains(where: { $0.key == kind }) else { return .failure(JobSignFailure(text: "Choose what it is.")) }
        let name = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...120).contains(name.count), !name.contains("\n") else {
            return .failure(JobSignFailure(text: "Give it a short name on one line, like Lift A."))
        }
        guard (1...500).contains(capacity) else { return .failure(JobSignFailure(text: "It holds 1 to 500 vehicles at a time.")) }
        let link = evidenceLink.trimmingCharacters(in: .whitespacesAndNewlines)
        var evidence: [Evidence]?
        if !link.isEmpty {
            guard link.lowercased().hasPrefix("https://"), link.count <= 500, URL(string: link) != nil else {
                return .failure(JobSignFailure(text: "The link has to start with https://."))
            }
            evidence = [Evidence(kind: "url", url: link)]
        }
        return .success(DeclareParams(p_organization_id: org, p_kind: kind, p_label: name, p_capacity: capacity, p_evidence: evidence))
    }

    struct ConfirmParams: Encodable, Equatable, Sendable { let p_reservation_id: String; let p_hash: String }

    /// Pinned to the queue item's own reservation and hash.
    static func confirm(_ item: SignatureItem) -> ConfirmParams? {
        guard item.kind == "facility_reservation_to_confirm", item.sign?.rpc == "confirm_facility_reservation",
              let id = item.sign?.argsHint["p_reservation_id"]?.stringValue, id == item.refId,
              let hash = item.sign?.argsHint["p_hash"]?.stringValue, !hash.isEmpty else { return nil }
        return ConfirmParams(p_reservation_id: id, p_hash: hash)
    }

    static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: d)
    }
}
