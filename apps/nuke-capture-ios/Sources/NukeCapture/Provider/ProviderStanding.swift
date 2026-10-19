// ProviderStanding.swift — a provider's standing as three open readers state it.
//
// provider_productivity_read: per day in a range (default the last 90, at most 366), signed days
//   (self-confirmed apart from customer-accepted), photo capture span (never labor time),
//   operations, specs reported performed, photo evidence and accepted completions, plus accepted
//   day-rate terms against signed days. Rates are open terms; no totals, payouts or payments.
//   Visitors see public vehicles and gate-cleared photos only (the server decides `viewer.self`).
// actor_link_claim_evidence_read: for the claimant (and admins), the evidence candidates behind one
//   technician-profile claim, each with its strength and the rung approval could accept it for.
//   It approves nothing; approval is a separate reviewer step.
// owner_delegated_signs_read: the public register of Signs an agent executed on the platform
//   owner's behalf. Counts and clocks only; arguments and references are withheld.
// Decoding is tolerant: a missing block reads as not reported, never as zero.

import Foundation
import Supabase

// MARK: - provider_productivity_read

struct ProviderProductivity: Decodable, Equatable {
    struct Day: Decodable, Equatable, Identifiable {
        let day: String
        let selfConfirmed: Bool
        let customerAccepted: Bool
        let captureSpanMinutes: Double?
        let operationsCompleted: Int?
        let specsReportedPerformed: Int?
        /// nil when the subject is a technician record with no account (the reader sends null).
        let imageEvidence: Int?
        let completionsAccepted: Int?
        var id: String { day }

        private struct Signed: Decodable { let self_confirmed: Bool?; let customer_accepted: Bool? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            day = try c.decode(String.self, forKey: JobCodingKey("day"))
            let signed = try? c.decode(Signed.self, forKey: JobCodingKey("signed"))
            selfConfirmed = signed?.self_confirmed ?? false
            customerAccepted = signed?.customer_accepted ?? false
            captureSpanMinutes = ProviderStandingDecode.number(c, "capture_span_minutes")
            operationsCompleted = try? c.decode(Int.self, forKey: JobCodingKey("operations_completed"))
            specsReportedPerformed = try? c.decode(Int.self, forKey: JobCodingKey("specs_reported_performed"))
            imageEvidence = try? c.decode(Int.self, forKey: JobCodingKey("image_evidence"))
            completionsAccepted = try? c.decode(Int.self, forKey: JobCodingKey("completions_accepted"))
        }
    }

    struct DayRateTerm: Decodable, Equatable, Identifiable {
        let source: String?
        let refId: String?
        let description: String?
        let rate: Double?
        let currency: String?
        let quantityDays: Double?
        var id: String { (refId ?? "") + (description ?? "") + (rate.map { String($0) } ?? "") }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            source = try? c.decode(String.self, forKey: JobCodingKey("source"))
            refId = try? c.decode(String.self, forKey: JobCodingKey("ref_id"))
            description = (try? c.decode(String.self, forKey: JobCodingKey("description"))).flatMap { $0.isEmpty ? nil : $0 }
            rate = ProviderStandingDecode.number(c, "rate")
            currency = try? c.decode(String.self, forKey: JobCodingKey("currency"))
            quantityDays = ProviderStandingDecode.number(c, "quantity_days")
        }
    }

    struct DayRateJob: Decodable, Equatable, Identifiable {
        let workOrderId: String
        let displayTitle: String?
        let terms: [DayRateTerm]
        let daysAgreed: Double?
        let selfConfirmedDays: Int?
        let customerAcceptedDays: Int?
        let windowFrom: String?
        let windowUntil: String?
        let basis: String?
        var id: String { workOrderId }

        private struct Signed: Decodable {
            let self_confirmed: Int?
            let customer_accepted: Int?
            let window: Window?
        }
        private struct Window: Decodable { let from: String?; let until: String? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            workOrderId = try c.decode(String.self, forKey: JobCodingKey("work_order_id"))
            displayTitle = (try? c.decode(String.self, forKey: JobCodingKey("display_title"))).flatMap { $0.isEmpty ? nil : $0 }
            terms = (try? c.decode([Lossy<DayRateTerm>].self, forKey: JobCodingKey("day_rate_terms")))?.compactMap(\.value) ?? []
            daysAgreed = ProviderStandingDecode.number(c, "days_agreed")
            let signed = try? c.decode(Signed.self, forKey: JobCodingKey("signed_days"))
            selfConfirmedDays = signed?.self_confirmed
            customerAcceptedDays = signed?.customer_accepted
            windowFrom = signed?.window?.from
            windowUntil = signed?.window?.until
            basis = try? c.decode(String.self, forKey: JobCodingKey("basis"))
        }
    }

    struct Totals: Decodable, Equatable {
        let daysWithActivity: Int?
        let selfConfirmedDays: Int?
        let customerAcceptedDays: Int?
        let operationsCompleted: Int?
        let completionsAccepted: Int?

        enum CodingKeys: String, CodingKey {
            case daysWithActivity = "days_with_activity"
            case selfConfirmedDays = "self_confirmed_days"
            case customerAcceptedDays = "customer_accepted_days"
            case operationsCompleted = "operations_completed"
            case completionsAccepted = "completions_accepted"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            daysWithActivity = try? c.decode(Int.self, forKey: .daysWithActivity)
            selfConfirmedDays = try? c.decode(Int.self, forKey: .selfConfirmedDays)
            customerAcceptedDays = try? c.decode(Int.self, forKey: .customerAcceptedDays)
            operationsCompleted = try? c.decode(Int.self, forKey: .operationsCompleted)
            completionsAccepted = try? c.decode(Int.self, forKey: .completionsAccepted)
        }
    }

    let subject: JobPerson?
    let rangeFrom: String?
    let rangeTo: String?
    let asOf: String?
    let days: [Day]
    let unreadableDays: Int
    let dayRateJobs: [DayRateJob]
    let totals: Totals?
    /// The reader's own words for each measure, keyed as it sends them.
    let basis: [String: String]
    let notAdopted: [String]
    let isSelf: Bool

    private struct RangeBlock: Decodable { let from: String?; let to: String? }
    private struct Viewer: Decodable {
        let isSelf: Bool?
        enum CodingKeys: String, CodingKey { case isSelf = "self" }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        subject = try? c.decode(JobPerson.self, forKey: JobCodingKey("subject"))
        let range = try? c.decode(RangeBlock.self, forKey: JobCodingKey("range"))
        rangeFrom = range?.from
        rangeTo = range?.to
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
        let raw = (try? c.decode([Lossy<Day>].self, forKey: JobCodingKey("days"))) ?? []
        days = raw.compactMap(\.value)
        unreadableDays = raw.count - days.count
        dayRateJobs = (try? c.decode([Lossy<DayRateJob>].self, forKey: JobCodingKey("day_rate_jobs")))?.compactMap(\.value) ?? []
        totals = try? c.decode(Totals.self, forKey: JobCodingKey("totals"))
        var words: [String: String] = [:]
        var notAdopted: [String] = []
        if case .object(let o)? = try? c.decode(JobJSON.self, forKey: JobCodingKey("basis")) {
            for (k, v) in o {
                if let s = v.stringValue { words[k] = s }
                if k == "not_adopted", case .array(let a) = v { notAdopted = a.compactMap(\.stringValue) }
            }
        }
        basis = words
        self.notAdopted = notAdopted
        isSelf = (try? c.decode(Viewer.self, forKey: JobCodingKey("viewer")))?.isSelf ?? false
    }
}

// MARK: - actor_link_claim_evidence_read

struct ActorClaimEvidence: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        let kind: String
        let rowId: String
        let vehicleLabel: String?
        let date: String?
        let why: String?
        let strength: String?
        /// The rungs approval would accept this item for; empty means context only.
        let approvableFor: [String]
        var id: String { kind + rowId }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            kind = try c.decode(String.self, forKey: JobCodingKey("kind"))
            rowId = try c.decode(String.self, forKey: JobCodingKey("row_id"))
            vehicleLabel = (try? c.decode(String.self, forKey: JobCodingKey("vehicle_label"))).flatMap { $0.isEmpty ? nil : $0 }
            date = try? c.decode(String.self, forKey: JobCodingKey("date"))
            why = try? c.decode(String.self, forKey: JobCodingKey("why"))
            strength = try? c.decode(String.self, forKey: JobCodingKey("strength"))
            approvableFor = (try? c.decode([String].self, forKey: JobCodingKey("approvable_for"))) ?? []
        }
    }

    struct Counts: Decodable, Equatable {
        let total: Int?
        let direct: Int?
        let corroborating: Int?
        let byKind: [String: Int]

        enum CodingKeys: String, CodingKey { case total, direct, corroborating, byKind = "by_kind" }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            total = try? c.decode(Int.self, forKey: .total)
            direct = try? c.decode(Int.self, forKey: .direct)
            corroborating = try? c.decode(Int.self, forKey: .corroborating)
            byKind = (try? c.decode([String: Int].self, forKey: .byKind)) ?? [:]
        }
    }

    let claimId: String?
    let actor: JobPerson?
    let rung: String?
    let status: String?
    let filedAt: String?
    let viewerRole: String?
    let items: [Item]
    let unreadableItems: Int
    let counts: Counts?
    let approvalAccess: String?
    let workEvidenceNeeds: String?
    let autoApproved: Bool?
    let notAssessed: [String]
    let asOf: String?

    private struct Claim: Decodable {
        let claim_id: String?
        let actor: JobPerson?
        let rung: String?
        let status: String?
        let filed_at: String?
    }
    private struct Viewer: Decodable { let role: String? }
    private struct Approval: Decodable { let access: String?; let work_evidence_needs: String?; let auto_approved: Bool? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        let claim = try? c.decode(Claim.self, forKey: JobCodingKey("claim"))
        claimId = claim?.claim_id
        actor = claim?.actor
        rung = claim?.rung
        status = claim?.status
        filedAt = claim?.filed_at
        viewerRole = (try? c.decode(Viewer.self, forKey: JobCodingKey("viewer")))?.role
        let raw = (try? c.decode([Lossy<Item>].self, forKey: JobCodingKey("items"))) ?? []
        items = raw.compactMap(\.value)
        unreadableItems = raw.count - items.count
        counts = try? c.decode(Counts.self, forKey: JobCodingKey("counts"))
        let approval = try? c.decode(Approval.self, forKey: JobCodingKey("approval"))
        approvalAccess = approval?.access
        workEvidenceNeeds = approval?.work_evidence_needs
        autoApproved = approval?.auto_approved
        notAssessed = (try? c.decode([String].self, forKey: JobCodingKey("not_assessed"))) ?? []
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
    }

    var direct: [Item] { items.filter { $0.strength == "direct" } }
    var corroborating: [Item] { items.filter { $0.strength != "direct" } }
}

// MARK: - owner_delegated_signs_read

struct DelegatedSigns: Decodable, Equatable {
    struct ByRpc: Decodable, Equatable, Identifiable {
        let rpc: String
        let signs: Int?
        let rolledBack: Int?
        let firstSignedAt: String?
        let lastSignedAt: String?
        var id: String { rpc }

        enum CodingKeys: String, CodingKey {
            case rpc, signs
            case rolledBack = "rolled_back"
            case firstSignedAt = "first_signed_at"
            case lastSignedAt = "last_signed_at"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            rpc = try c.decode(String.self, forKey: .rpc)
            signs = try? c.decode(Int.self, forKey: .signs)
            rolledBack = try? c.decode(Int.self, forKey: .rolledBack)
            firstSignedAt = try? c.decode(String.self, forKey: .firstSignedAt)
            lastSignedAt = try? c.decode(String.self, forKey: .lastSignedAt)
        }
    }

    struct Recent: Decodable, Equatable, Identifiable {
        let rpc: String
        let signedAt: String
        let authorizedAt: String?
        let rolledBack: Bool
        var id: String { rpc + signedAt }

        enum CodingKeys: String, CodingKey {
            case rpc
            case signedAt = "signed_at"
            case authorizedAt = "authorized_at"
            case rolledBack = "rolled_back"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            rpc = try c.decode(String.self, forKey: .rpc)
            signedAt = try c.decode(String.self, forKey: .signedAt)
            authorizedAt = try? c.decode(String.self, forKey: .authorizedAt)
            rolledBack = (try? c.decode(Bool.self, forKey: .rolledBack)) ?? false
        }
    }

    let owner: JobPerson?
    let signs: Int?
    let rolledBack: Int?
    let byRpc: [ByRpc]
    let recent: [Recent]
    let authorizations: [String]
    let meaning: String?
    let withheld: [String]
    let asOf: String?

    private struct Totals: Decodable { let signs: Int?; let rolled_back: Int? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        owner = try? c.decode(JobPerson.self, forKey: JobCodingKey("owner"))
        let totals = try? c.decode(Totals.self, forKey: JobCodingKey("totals"))
        signs = totals?.signs
        rolledBack = totals?.rolled_back
        byRpc = (try? c.decode([Lossy<ByRpc>].self, forKey: JobCodingKey("by_rpc")))?.compactMap(\.value) ?? []
        recent = (try? c.decode([Lossy<Recent>].self, forKey: JobCodingKey("recent")))?.compactMap(\.value) ?? []
        authorizations = ((try? c.decode([String].self, forKey: JobCodingKey("authorizations"))) ?? []).sorted()
        meaning = try? c.decode(String.self, forKey: JobCodingKey("meaning"))
        withheld = (try? c.decode([String].self, forKey: JobCodingKey("withheld"))) ?? []
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
    }

    /// The register names one owner; it applies to that person's profile.
    func applies(toUserId userId: String?) -> Bool {
        guard let userId, let owner = owner?.profileId else { return false }
        return owner.lowercased() == userId.lowercased()
    }
}

// MARK: - Readers

enum ProviderStandingReaders {
    static let productivityName = "provider_productivity_read"
    static let claimEvidenceName = "actor_link_claim_evidence_read"
    static let delegatedSignsName = "owner_delegated_signs_read"

    static func productivity(userId: String, from: String? = nil) async -> JobLoad<ProviderProductivity> {
        struct P: Encodable { let p_user_id: String; let p_from: String? }
        return await call(productivityName) {
            try await SupabaseService.client.rpc(productivityName, params: P(p_user_id: userId, p_from: from)).execute().data
        }
    }

    static func claimEvidence(claimId: String) async -> JobLoad<ActorClaimEvidence> {
        await call(claimEvidenceName) {
            try await SupabaseService.client.rpc(claimEvidenceName, params: ["p_claim_id": claimId]).execute().data
        }
    }

    static func delegatedSigns() async -> JobLoad<DelegatedSigns> {
        await call(delegatedSignsName) { try await SupabaseService.client.rpc(delegatedSignsName).execute().data }
    }

    private static func call<T: Decodable>(_ reader: String, _ fetch: () async throws -> Data) async -> JobLoad<T> {
        do {
            return .loaded(try JobReaders.decode(T.self, from: try await fetch()))
        } catch {
            NSLog("NukeCapture %@ failed: %@", reader, String(describing: error))
            return .refused(refusal(reader, message: (error as? PostgrestError)?.message) ?? JobReaders.refusal(reader, error))
        }
    }

    /// The refusals these readers raise in their own words; nil defers to JobReaders.refusal.
    static func refusal(_ reader: String, message: String?) -> JobRefusal? {
        guard let message else { return nil }
        if message.contains("Claim unavailable") {
            return JobRefusal(reader: reader, kind: .unavailable, title: "Evidence not available",
                              detail: "Only the person who filed this link can see its evidence.")
        }
        if message.contains("Range must run forward") {
            return JobRefusal(reader: reader, kind: .failed, title: "Range not available",
                              detail: "A range runs forward and covers at most 366 days.")
        }
        return nil
    }

    /// The first day of a range ending today (UTC), as the reader's p_from; nil keeps its 90-day default.
    static func rangeStart(days: Int, today: Date = Date()) -> String? {
        guard days != 90, (1...366).contains(days) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let start = cal.date(byAdding: .day, value: -days, to: today) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: start)
    }
}

enum ProviderStandingDecode {
    /// A number the reader may send as a JSON number or a numeric string; nil otherwise.
    static func number(_ c: KeyedDecodingContainer<JobCodingKey>, _ key: String) -> Double? {
        if let d = try? c.decode(Double.self, forKey: JobCodingKey(key)), d.isFinite { return d }
        if let s = try? c.decode(String.self, forKey: JobCodingKey(key)), let d = Double(s), d.isFinite { return d }
        return nil
    }
}
