// PostJob.swift — posting a job for your own vehicle, and starting work on an accepted job.
//
// post_work_request(p_vehicle_id, p_description, p_image_ids, p_requested_operations, p_needed_by,
// p_visibility 'open'|'invite_only'): owners, uploaders and access holders only (anyone else is
// pointed to request_inspection); the description is the client's own words, refused when it holds
// contact details or the client's own name; operations are excerpts of it, requirements come from
// the reviewed template, and the suggested cost is reference hours × resolve_labor_rate(); the app shows the
// hours only, and dollars only for a reported rate (never the placeholder) — never a quote. Intake photos go through
// attach_job_evidence (own, non-sensitive photos of this vehicle only). No provider is notified,
// nothing is booked, no payment is authorized.
// start_work(p_work_order_id, p_terms_hash): offered in the job view's viewer.actions to the current
// accepted provider, pinned to the accepted quote hash or the accepted offer terms.

import Foundation
import Supabase

// MARK: - post_work_request's answer

struct PostedJob: Decodable, Equatable {
    struct Operation: Decodable, Equatable, Identifiable {
        let line_number: Int
        let text: String
        var id: Int { line_number }
    }
    struct Requirement: Decodable, Equatable, Identifiable {
        let requirement_id: String
        let kind: String?
        let description: String?
        let basis: String?
        var id: String { requirement_id }
    }
    struct Range: Decodable, Equatable { let low: Double?; let high: Double? }
    struct CostLine: Decodable, Equatable, Identifiable {
        let line_number: Int
        let text: String?
        let hours: Range?
        let cost: Range?
        let state: String?
        var id: Int { line_number }
    }
    struct Total: Decodable, Equatable { let low: Double?; let high: Double?; let lines_estimated: Int?; let lines: Int? }
    struct Rate: Decodable, Equatable { let rate: Double?; let source: String? }
    struct Cost: Decodable, Equatable {
        let lines: [CostLine]
        let total: Total?
        let rate: Rate?
        let rateLabel: String?
        let currency: String?
        let hoursLabel: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            lines = (try? c.decode([Lossy<CostLine>].self, forKey: JobCodingKey("lines")))?.compactMap(\.value) ?? []
            total = try? c.decode(Total.self, forKey: JobCodingKey("total"))
            rate = try? c.decode(Rate.self, forKey: JobCodingKey("rate"))
            rateLabel = try? c.decode(String.self, forKey: JobCodingKey("rate_label"))
            currency = try? c.decode(String.self, forKey: JobCodingKey("currency"))
            hoursLabel = try? c.decode(String.self, forKey: JobCodingKey("hours_label"))
        }
    }

    let workOrderId: String
    let duplicate: Bool
    let visibility: String?
    let listed: Bool
    let listingBasis: String?
    let neededBy: String?
    let operations: [Operation]
    let requirements: [Requirement]
    let photosAttached: Int
    let cost: Cost?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        struct Intake: Decodable { let image_count: Int? }
        workOrderId = try c.decode(String.self, forKey: JobCodingKey("work_order_id"))
        duplicate = (try? c.decode(Bool.self, forKey: JobCodingKey("duplicate"))) ?? false
        visibility = try? c.decode(String.self, forKey: JobCodingKey("visibility"))
        listed = (try? c.decode(Bool.self, forKey: JobCodingKey("listed_in_open_requirements"))) ?? false
        listingBasis = try? c.decode(String.self, forKey: JobCodingKey("listing_basis"))
        neededBy = try? c.decode(String.self, forKey: JobCodingKey("needed_by"))
        operations = (try? c.decode([Lossy<Operation>].self, forKey: JobCodingKey("operations")))?.compactMap(\.value) ?? []
        requirements = (try? c.decode([Lossy<Requirement>].self, forKey: JobCodingKey("requirements")))?.compactMap(\.value) ?? []
        photosAttached = (try? c.decode(Intake.self, forKey: JobCodingKey("intake_evidence")))?.image_count ?? 0
        cost = try? c.decode(Cost.self, forKey: JobCodingKey("suggested_cost"))
    }
}

/// One of your own photos of this vehicle, with why it can't be attached when it can't.
struct PostJobPhoto: Decodable, Equatable, Identifiable {
    let id: String
    let imageURL: String?
    let capturedAt: String?
    let isSensitive: Bool
    let isSuperseded: Bool
    let gate: String?

    enum CodingKeys: String, CodingKey {
        case id
        case imageURL = "image_url"
        case takenAt = "taken_at"
        case createdAt = "created_at"
        case isSensitive = "is_sensitive"
        case isSuperseded = "is_superseded"
        case gate = "vision_gate_status"
    }

    init(id: String, imageURL: String? = nil, capturedAt: String? = nil, isSensitive: Bool = false, isSuperseded: Bool = false, gate: String? = nil) {
        self.id = id; self.imageURL = imageURL; self.capturedAt = capturedAt
        self.isSensitive = isSensitive; self.isSuperseded = isSuperseded; self.gate = gate
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(id: try c.decode(String.self, forKey: .id), imageURL: try? c.decode(String.self, forKey: .imageURL),
                  capturedAt: (try? c.decode(String.self, forKey: .takenAt)) ?? (try? c.decode(String.self, forKey: .createdAt)),
                  isSensitive: (try? c.decode(Bool.self, forKey: .isSensitive)) ?? false,
                  isSuperseded: (try? c.decode(Bool.self, forKey: .isSuperseded)) ?? false,
                  gate: try? c.decode(String.self, forKey: .gate))
    }

    /// Mirrors attach_job_evidence's refusal: personal, sensitive, misattributed or superseded.
    var refusal: String? {
        if gate == "rejected_personal" { return "personal" }
        if isSensitive { return "sensitive" }
        if gate == "rejected_misattributed" { return "of another vehicle" }
        if isSuperseded { return "replaced by a newer copy" }
        return nil
    }
}

// MARK: - Readers and writers

enum PostJobReaders {
    /// Your own uploads of this vehicle, newest first (the server re-checks every one on attach).
    static func photos(vehicleId: String, limit: Int = 60) async -> [PostJobPhoto] {
        guard let uid = SupabaseService.currentUserId else { return [] }
        return (try? await SupabaseService.client.from("vehicle_images")
            .select("id,image_url,taken_at,created_at,is_sensitive,is_superseded,vision_gate_status")
            .eq("vehicle_id", value: vehicleId)
            .eq("user_id", value: uid)
            .order("created_at", ascending: false)
            .limit(limit)
            .execute().value) ?? []
    }

    static func write<P: Encodable & Sendable>(_ rpc: String, _ params: P) async -> Result<Data, JobSignFailure> {
        do {
            return .success(try await SupabaseService.client.rpc(rpc, params: params).execute().data)
        } catch {
            NSLog("NukeCapture %@ failed: %@", rpc, String(describing: error))
            return .failure(JobSignFailure(text: PostJobCopy.failure(error)))
        }
    }
}

// MARK: - Drafting (validated locally; the server re-checks everything)

enum PostJobDrafting {
    enum Visibility: String, CaseIterable, Identifiable {
        case open, invite_only
        var id: String { rawValue }
        var title: String { self == .open ? "Open" : "Invite only" }
        var explainer: String {
            self == .open ? "Open: technicians near you can see it." : "Invite only: it isn't listed; you choose who to ask."
        }
    }

    struct Params: Encodable, Equatable, Sendable {
        let p_vehicle_id: String
        let p_description: String
        let p_image_ids: [String]?
        let p_needed_by: String?
        let p_visibility: String
    }

    /// The server's own pattern for contact details: an @, or a 10-digit phone number.
    static func hasContactDetails(_ text: String) -> Bool {
        text.range(of: #"(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})"#, options: .regularExpression) != nil
    }

    static func params(vehicleId: String, description: String, imageIds: [String], neededBy: Date?, visibility: Visibility,
                       now: Date = Date()) -> Result<Params, JobSignFailure> {
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return .failure(JobSignFailure(text: "Describe the work first.")) }
        guard text.count <= 4000 else { return .failure(JobSignFailure(text: "Keep the description under 4,000 characters.")) }
        guard !hasContactDetails(text) else {
            return .failure(JobSignFailure(text: "Take out phone numbers and emails — people reach you through Nuke."))
        }
        if let neededBy, neededBy <= now { return .failure(JobSignFailure(text: "Pick a needed-by date in the future.")) }
        guard imageIds.count <= 50 else { return .failure(JobSignFailure(text: "Choose at most 50 photos.")) }
        return .success(Params(p_vehicle_id: vehicleId, p_description: text, p_image_ids: imageIds.isEmpty ? nil : imageIds,
                               p_needed_by: neededBy.map(FacilityDrafting.iso), p_visibility: visibility.rawValue))
    }

    struct StartParams: Encodable, Equatable, Sendable { let p_work_order_id: String; let p_terms_hash: String }

    /// Only from the server's start_work action for this job; the phone never composes the hash.
    static func start(_ action: JobAction, workOrderId: String) -> StartParams? {
        guard action.kind == "start_work", (action.rpc ?? "start_work") == "start_work",
              action.args["p_work_order_id"]?.stringValue == workOrderId,
              let hash = action.args["p_terms_hash"]?.stringValue, !hash.isEmpty else { return nil }
        return StartParams(p_work_order_id: workOrderId, p_terms_hash: hash)
    }
}

// MARK: - Copy

enum PostJobCopy {
    static let warning = "Don't include phone numbers or emails — people reach you through Nuke."
    static let costLabel = "Rough guide from reference hours — not a quote"

    static let postingSays = [
        "Your job is listed on Nuke in your own words, for this vehicle.",
        "Technicians can offer to do it; you choose whether to accept.",
    ]
    static let postingDoesNotSay = [
        "That anyone is booked",
        "Any payment",
        "A price — the hours shown are a rough guide",
    ]

    static func startSays(_ basis: String?) -> String {
        switch basis {
        case "accepted_quote"?: return "You're starting this work under the accepted quote."
        case "accepted_offer"?: return "You're starting this work under your accepted offer."
        default: return "You're starting this work under the accepted terms."
        }
    }
    static let startClock = "Everyone on the job sees when you started."
    static let startDoesNotSay = ["That the work is done", "A schedule or finish date", "Any payment"]

    private static let doesNotBind: [String: String] = ["completion": "That the work is done", "schedule": "A schedule or finish date",
                                                        "payment": "Any payment"]
    static func startDoesNotBind(_ s: String) -> String { doesNotBind[s] ?? JobCopy.sentence(s) }

    static func listing(_ p: PostedJob) -> String {
        if p.listed { return "Listed: technicians can see it under Jobs looking for someone." }
        switch p.listingBasis {
        case "invite_only"?: return "Invite only: not listed. You choose who to ask."
        case "vehicle_not_public"?: return "Not listed: this vehicle isn't public, so only people you ask can see the job."
        default: return "Not listed."
        }
    }

    static func range(_ r: PostedJob.Range?, currency: String?) -> String? {
        guard let lo = r?.low, let hi = r?.high else { return nil }
        let a = JobMoney.format(lo, currency), b = JobMoney.format(hi, currency)
        return a == b ? a : "\(a)–\(b)"
    }

    static func hours(_ r: PostedJob.Range?) -> String? {
        guard let lo = r?.low, let hi = r?.high else { return nil }
        let f = { (x: Double) in x == x.rounded() ? String(Int(x)) : String(format: "%.1f", x) }
        return lo == hi ? "about \(f(lo)) h" : "about \(f(lo))–\(f(hi)) h"
    }

    /// Dollars only when the rate is one a shop or person reported; a placeholder rate is never shown.
    static func showsMoney(_ c: PostedJob.Cost) -> Bool { c.rateLabel == "reported_rate" }

    static func costLine(_ l: PostedJob.CostLine, _ c: PostedJob.Cost) -> String {
        switch l.state {
        case "estimated"?:
            return [hours(l.hours), showsMoney(c) ? range(l.cost, currency: c.currency) : nil].compactMap { $0 }.joined(separator: " · ")
        case "reference_rows_absent"?: return "Matched, but no reference hours yet"
        default: return "Nothing to estimate from yet"
        }
    }

    /// Summed reference hours (or dollars, for a reported rate) over the lines that could be estimated.
    static func total(_ c: PostedJob.Cost) -> String? {
        let est = c.lines.filter { $0.state == "estimated" }
        let r: String?
        if showsMoney(c), let t = c.total {
            r = range(PostedJob.Range(low: t.low, high: t.high), currency: c.currency)
        } else {
            let lo = est.compactMap { $0.hours?.low }, hi = est.compactMap { $0.hours?.high }
            r = lo.isEmpty ? nil : hours(PostedJob.Range(low: lo.reduce(0, +), high: hi.reduce(0, +)))
        }
        guard let r else { return nil }
        let of = c.lines.count
        return est.count < of ? "\(r) for \(est.count) of \(of) items" : r
    }

    static func rate(_ c: PostedJob.Cost) -> String {
        if showsMoney(c), let r = c.rate?.rate { return JobMoney.format(r, c.currency) + " / hour, a reported rate" }
        return PlanCopy.noShopRate
    }

    static func requirement(_ r: PostedJob.Requirement) -> String {
        let kind = r.kind.map(OfferCopy.kind) ?? "Need"
        return [kind, r.description].compactMap { $0 }.joined(separator: ": ")
    }

    /// "Wed Oct 21, 9:00 AM".
    static func moment(_ s: String?, timeZone: TimeZone = .current) -> String? {
        guard let d = FacilityCopy.date(s) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "EEE MMM d, h:mm a"
        return f.string(from: d)
    }

    /// The job path's start_sign fact: "Started Wed Oct 21, 9:00 AM by the accepted technician, under the accepted offer".
    static func started(_ v: JobJSON, timeZone: TimeZone = .current) -> String? {
        guard case .object(let o) = v else { return v == .null ? "Not started yet" : nil }
        var s = "Started"
        if let when = moment(o["started_at"]?.stringValue, timeZone: timeZone) { s += " \(when)" }
        s += " by the accepted technician"
        switch o["terms_basis"]?.stringValue {
        case "accepted_quote"?: s += ", under the accepted quote"
        case "accepted_offer"?: s += ", under the accepted offer"
        default: break
        }
        if case .bool(false)? = o["terms_current"] { s += " — the terms have changed since" }
        return s
    }

    static func failure(_ error: Error) -> String {
        let message = (error as? PostgrestError)?.message ?? ""
        let table: [(String, String)] = [
            ("Authentication required", "Sign in first."),
            ("Vehicle unavailable: post a job", vehicleRefusal),
            ("Describe the work", "Describe the work in up to 4,000 characters."),
            ("Remove names and contact details", "Take out names, including your own, and contact details — people reach you through Nuke."),
            ("Remove contact details", "Take out phone numbers and emails — people reach you through Nuke."),
            ("Visibility must be", "Choose Open or Invite only."),
            ("needed_by must be in the future", "Pick a needed-by date in the future."),
            ("At most 50 images", "Choose at most 50 photos."),
            ("must state 1 to 20 operations", "Describe 1 to 20 things to do, a sentence each."),
            ("must be distinct", "Each thing to do should be different."),
            ("Only your own images of this vehicle", "Only your own photos of this vehicle can go with the job."),
            ("Personal, sensitive, misattributed or superseded", "One of the photos can't go with the job: it's personal, sensitive, of another vehicle, or replaced."),
            ("The customer does not start the work", "The customer doesn't start the work; the accepted technician does."),
            ("Only a current accepted provider", "Only the technician accepted on this job can start it."),
            ("Work order concluded", "This job is already closed."),
            ("Terms hash does not match", "The accepted terms changed since you opened this. Refresh and review them again."),
            ("Work order unavailable", "This job isn't available."),
        ]
        if let hit = table.first(where: { message.contains($0.0) }) { return hit.1 }
        return ReadFailure.text(error)
    }

    static let vehicleRefusal = "You can post a job only for a vehicle you own, added, or have access to. For someone else's vehicle, order an inspection instead."
}
