// WorkPlanDocument.swift — the buying plan for a listed vehicle, and the inspection it orders.
//
// listing_work_plan_read (buying_plan_v1, anon-readable) states what checking a car would cover,
// not a restoration price: identity checks across sources, the listing's claims as testimony,
// candidate operations with uncalibrated reference hours, unverified text-matched parts, the
// labor rate (shown in dollars only when reported, never the placeholder), and a pre-purchase checklist. Its
// inspection_scope goes to request_inspection unchanged (plus the request channel) on the
// client's explicit Sign; no vehicle access, seller permission or payment follows from ordering.
// work_order_inspection_read returns the inspection, its findings and the seller's permission.

import Foundation
import SwiftUI
import Supabase

extension JobJSON: Encodable {
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }
}

// MARK: - Plan

struct WorkPlan: Decodable, Equatable {
    /// One source's reading of an identity field; raw and value may be text or numbers.
    struct IdentityValue: Decodable, Equatable {
        let raw: String?
        let value: String?
        let source: String?

        enum CodingKeys: String, CodingKey { case raw, value, source }

        init(raw: String?, value: String?, source: String?) { self.raw = raw; self.value = value; self.source = source }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func text(_ k: CodingKeys) -> String? {
                guard let j = try? c.decode(JobJSON.self, forKey: k), j != .null else { return nil }
                return j.text
            }
            raw = text(.raw)
            value = text(.value)
            source = try? c.decode(String.self, forKey: .source)
        }
    }
    struct IdentityField: Decodable, Equatable {
        let status: String
        let values: [IdentityValue]

        enum CodingKeys: String, CodingKey { case status, values }
        private struct Slot: Decodable {
            let value: IdentityValue?
            init(from decoder: Decoder) throws { value = try? IdentityValue(from: decoder) }
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            status = (try? c.decode(String.self, forKey: .status)) ?? "unknown"
            values = ((try? c.decode([Slot].self, forKey: .values)) ?? []).compactMap(\.value)
        }
    }
    struct Claim: Decodable, Equatable, Identifiable {
        let claimId: String
        let kind: String
        let text: String
        let quote: String?
        let excerptStatus: String?
        let sourceURL: String?
        let eventAt: String?
        let confidence: Double?
        var id: String { claimId }

        enum CodingKeys: String, CodingKey {
            case kind, text, source, clocks, confidence
            case claimId = "claim_id"
            case excerptStatus = "excerpt_status"
            case verbatim = "verbatim_excerpt"
        }
        private struct Excerpt: Decodable { let quote: String? }
        private struct Source: Decodable { let source_url: String? }
        private struct Clocks: Decodable { let event_at: String? }
        private struct Confidence: Decodable { let value: Double? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            claimId = try c.decode(String.self, forKey: .claimId)
            kind = (try? c.decode(String.self, forKey: .kind)) ?? "listing_statement"
            text = (try? c.decode(String.self, forKey: .text)) ?? ""
            quote = (try? c.decode(Excerpt.self, forKey: .verbatim))?.quote?.trimmingCharacters(in: .whitespacesAndNewlines)
            excerptStatus = try? c.decode(String.self, forKey: .excerptStatus)
            sourceURL = (try? c.decode(Source.self, forKey: .source))?.source_url
            eventAt = (try? c.decode(Clocks.self, forKey: .clocks))?.event_at
            confidence = (try? c.decode(Confidence.self, forKey: .confidence))?.value
        }

        var isExactQuote: Bool { excerptStatus == "exact_excerpt_in_listing_text" && !(quote ?? "").isEmpty }
    }
    struct Target: Decodable, Equatable, Identifiable {
        let code: String?
        let name: String?
        let typical: Double?
        let min: Double?
        let max: Double?
        let label: String?
        var id: String { (code ?? "") + (name ?? "") }

        enum CodingKeys: String, CodingKey { case code, name, hours, label }
        private struct Hours: Decodable { let typical: Double?; let min: Double?; let max: Double? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            code = try? c.decode(String.self, forKey: .code)
            name = try? c.decode(String.self, forKey: .name)
            let h = try? c.decode(Hours.self, forKey: .hours)
            typical = h?.typical; min = h?.min; max = h?.max
            label = try? c.decode(String.self, forKey: .label)
        }
    }
    struct Operation: Decodable, Equatable, Identifiable {
        let operationId: String
        let keywordEntryId: String?
        let system: String?
        let claimIds: [String]
        let targets: [Target]
        var id: String { operationId }

        enum CodingKeys: String, CodingKey {
            case system, targets
            case operationId = "operation_id"
            case keywordEntryId = "keyword_entry_id"
            case claimIds = "claim_ids"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            operationId = try c.decode(String.self, forKey: .operationId)
            keywordEntryId = try? c.decode(String.self, forKey: .keywordEntryId)
            system = try? c.decode(String.self, forKey: .system)
            claimIds = (try? c.decode([String].self, forKey: .claimIds)) ?? []
            targets = (try? c.decode([Target].self, forKey: .targets)) ?? []
        }
    }
    struct PartRow: Decodable, Equatable {
        let name: String?
        let part_number: String?
        let price_current: Double?
        let currency: String?
        let manufacturer: String?
    }
    struct PartTerm: Decodable, Equatable {
        let term: String?
        let state: String?
        let rows: [PartRow]
        enum CodingKeys: String, CodingKey { case term, state, rows }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            term = try? c.decode(String.self, forKey: .term)
            state = try? c.decode(String.self, forKey: .state)
            rows = (try? c.decode([PartRow].self, forKey: .rows)) ?? []
        }
    }
    struct ChecklistItem: Decodable, Equatable, Identifiable {
        let item_id: String
        let question: String?
        let system: String?
        let basis: String?
        var id: String { item_id }
    }

    let schemaVersion: String?
    let recordLabel: String?
    let listingURL: String?
    let vehicleLabel: JobVehicleLabel?
    let identityFields: [String: IdentityField]
    let vinDecodeState: String?
    let claims: [Claim]
    let exclusions: [String: Int]
    let operations: [Operation]
    let parts: [PartTerm]
    let checklist: [ChecklistItem]
    /// inspection_scope exactly as the reader returned it; sent to request_inspection unchanged.
    let inspectionScope: JobJSON?
    let matchedClaims: Int?
    let eligibleClaims: Int?
    let rateValue: Double?
    /// Where the rate came from; only a rate a shop or person reported is ever shown as dollars.
    let rateSource: String?
    var reportedRate: Double? { ["contract", "user", "organization"].contains(rateSource ?? "") ? rateValue : nil }
    let modelCalls: Int?
    let databaseWrites: Int?

    enum CodingKeys: String, CodingKey {
        case identity, claims, exclusions, parts, rate
        case schemaVersion = "schema_version"
        case recordLabel = "record_label"
        case listingURL = "listing_url"
        case vehicleLabel = "vehicle_label"
        case operations = "candidate_operations"
        case inspectionScope = "inspection_scope"
        case coverage = "operation_coverage"
        case modelCalls = "model_calls"
        case databaseWrites = "database_writes"
    }
    private struct Identity: Decodable {
        let fields: [String: IdentityField]
        let vin_decode: VinDecode?
        struct VinDecode: Decodable { let state: String? }

        enum CodingKeys: String, CodingKey { case fields, vin_decode }
        private struct FieldSlot: Decodable {
            let field: IdentityField?
            init(from decoder: Decoder) throws { field = try? IdentityField(from: decoder) }
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            fields = ((try? c.decode([String: FieldSlot].self, forKey: .fields)) ?? [:]).compactMapValues(\.field)
            vin_decode = try? c.decode(VinDecode.self, forKey: .vin_decode)
        }
    }
    private struct Coverage: Decodable { let matched_claims: Int?; let eligible_claims: Int? }
    private struct Rate: Decodable {
        let value: Value?
        struct Value: Decodable { let rate: Double?; let source: String? }
    }
    private struct ClaimSlot: Decodable {
        let claim: Claim?
        init(from decoder: Decoder) throws { claim = try? Claim(from: decoder) }
    }
    private struct OpSlot: Decodable {
        let op: Operation?
        init(from decoder: Decoder) throws { op = try? Operation(from: decoder) }
    }
    private struct Scope: Decodable { let ppi_checklist: [ChecklistItem]? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try? c.decode(String.self, forKey: .schemaVersion)
        recordLabel = try? c.decode(String.self, forKey: .recordLabel)
        listingURL = try? c.decode(String.self, forKey: .listingURL)
        vehicleLabel = try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)
        let identity = try? c.decode(Identity.self, forKey: .identity)
        identityFields = identity?.fields ?? [:]
        vinDecodeState = identity?.vin_decode?.state
        claims = ((try? c.decode([ClaimSlot].self, forKey: .claims)) ?? []).compactMap(\.claim)
        exclusions = (try? c.decode([String: Int].self, forKey: .exclusions)) ?? [:]
        operations = ((try? c.decode([OpSlot].self, forKey: .operations)) ?? []).compactMap(\.op)
        parts = (try? c.decode([PartTerm].self, forKey: .parts)) ?? []
        inspectionScope = try? c.decode(JobJSON.self, forKey: .inspectionScope)
        checklist = (try? c.decode(Scope.self, forKey: .inspectionScope))?.ppi_checklist ?? []
        let cov = try? c.decode(Coverage.self, forKey: .coverage)
        matchedClaims = cov?.matched_claims
        eligibleClaims = cov?.eligible_claims
        let rate = (try? c.decode(Rate.self, forKey: .rate))?.value
        rateValue = rate?.rate
        rateSource = rate?.source
        modelCalls = try? c.decode(Int.self, forKey: .modelCalls)
        databaseWrites = try? c.decode(Int.self, forKey: .databaseWrites)
    }

    static let identityOrder = ["year", "make", "model", "vin", "engine_displacement_l", "transmission", "drivetrain", "induction"]

    /// Fields the sources disagree on, or where one source is more specific, in reading order.
    var identityChecks: [(field: String, status: String, line: String)] {
        let keys = Self.identityOrder + identityFields.keys.sorted().filter { !Self.identityOrder.contains($0) }
        return keys.compactMap { k in
            guard let f = identityFields[k], f.status == "conflict" || f.status == "unresolved_specificity" else { return nil }
            return (k, f.status, PlanCopy.identityLine(f.values))
        }
    }

    var agreeingFields: Int { identityFields.values.filter { $0.status == "agree" }.count }

    var excludedCount: Int { exclusions.values.reduce(0, +) }
    var paraphrasedCount: Int { claims.filter { !$0.isExactQuote }.count }
    var pricedParts: [PartRow] { parts.flatMap(\.rows).filter { ($0.price_current ?? 0) > 0 } }
}

// MARK: - Inspection

struct InspectionFinding: Decodable, Equatable {
    let item_id: String?
    let system: String?
    let finding: String?
    let severity: String?
    let evidence_photo_ref: String?
    let verdict: String?
}

struct InspectionDoc: Decodable, Equatable, Identifiable {
    struct ChecklistItem: Decodable, Equatable, Identifiable {
        let item_id: String
        let question: String?
        let system: String?
        var id: String { item_id }
    }
    struct Report: Decodable, Equatable {
        let recordedAt: String?
        let recordedBy: JobPerson?
        let recordedByRole: String?
        let summary: String?
        let findings: [InspectionFinding]
        let covered: Int?
        let items: Int?

        enum CodingKeys: String, CodingKey {
            case inspection
            case recordedAt = "recorded_at"
            case recordedBy = "recorded_by"
            case recordedByRole = "recorded_by_role"
            case coverage = "checklist_coverage"
        }
        private struct Inspection: Decodable { let summary: String?; let findings: [InspectionFinding]? }
        private struct Coverage: Decodable { let items: Int?; let with_findings: Int? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            recordedAt = try? c.decode(String.self, forKey: .recordedAt)
            recordedBy = try? c.decode(JobPerson.self, forKey: .recordedBy)
            recordedByRole = try? c.decode(String.self, forKey: .recordedByRole)
            let i = try? c.decode(Inspection.self, forKey: .inspection)
            summary = i?.summary
            findings = i?.findings ?? []
            let cov = try? c.decode(Coverage.self, forKey: .coverage)
            covered = cov?.with_findings
            items = cov?.items
        }
    }
    struct Permission: Decodable, Equatable {
        let state: String
        let from: String?
        let until: String?
        let grantedBy: JobPerson?

        enum CodingKeys: String, CodingKey {
            case state, window
            case grantedBy = "granted_by"
        }
        private struct Window: Decodable { let from: String?; let until: String? }

        init(state: String, from: String? = nil, until: String? = nil, grantedBy: JobPerson? = nil) {
            self.state = state; self.from = from; self.until = until; self.grantedBy = grantedBy
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            state = (try? c.decode(String.self, forKey: .state)) ?? "not_established"
            let w = try? c.decode(Window.self, forKey: .window)
            from = w?.from
            until = w?.until
            grantedBy = try? c.decode(JobPerson.self, forKey: .grantedBy)
        }
    }

    let workOrderId: String
    let inspectionType: String?
    let requestedAt: String?
    let requestedBy: JobPerson?
    let checklist: [ChecklistItem]
    let currentReport: Report?
    let state: String?
    let sellerPermission: Permission?
    var id: String { workOrderId }

    enum CodingKeys: String, CodingKey {
        case checklist, state
        case workOrderId = "work_order_id"
        case inspectionType = "inspection_type"
        case requestedAt = "requested_at"
        case requestedBy = "requested_by"
        case currentReport = "current_report"
        case sellerPermission = "seller_permission"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try c.decode(String.self, forKey: .workOrderId)
        inspectionType = try? c.decode(String.self, forKey: .inspectionType)
        requestedAt = try? c.decode(String.self, forKey: .requestedAt)
        requestedBy = try? c.decode(JobPerson.self, forKey: .requestedBy)
        checklist = (try? c.decode([ChecklistItem].self, forKey: .checklist)) ?? []
        currentReport = try? c.decode(Report.self, forKey: .currentReport)
        state = try? c.decode(String.self, forKey: .state)
        sellerPermission = try? c.decode(Permission.self, forKey: .sellerPermission)
    }

    func findings(for itemId: String) -> [InspectionFinding] {
        currentReport?.findings.filter { $0.item_id == itemId } ?? []
    }

    /// Findings not tied to a checklist item.
    var looseFindings: [InspectionFinding] { currentReport?.findings.filter { $0.item_id == nil } ?? [] }
}

struct InspectionRead: Decodable, Equatable {
    let inspections: [InspectionDoc]
    let viewer: JobViewer?

    enum CodingKeys: String, CodingKey { case inspections, viewer }
    private struct Slot: Decodable {
        let doc: InspectionDoc?
        init(from decoder: Decoder) throws { doc = try? InspectionDoc(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        inspections = ((try? c.decode([Slot].self, forKey: .inspections)) ?? []).compactMap(\.doc)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
    }

    var canRecordFindings: Bool { viewer?.actions.contains { $0.kind == "record_findings" } == true }
}

struct InspectionRequestReceipt: Decodable, Equatable {
    let workOrderId: String?
    let checklistItems: Int?
    let duplicate: Bool

    enum CodingKeys: String, CodingKey {
        case duplicate
        case workOrderId = "work_order_id"
        case checklistItems = "checklist_items"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try? c.decode(String.self, forKey: .workOrderId)
        checklistItems = try? c.decode(Int.self, forKey: .checklistItems)
        duplicate = (try? c.decode(Bool.self, forKey: .duplicate)) == true
    }
}

// MARK: - Words

enum PlanCopy {
    static let headline = "This is what checking this car would cover — not a restoration price."

    static func field(_ f: String) -> String {
        switch f {
        case "vin": return "VIN"
        case "engine_displacement_l": return "Engine size"
        default: return JobCopy.sentence(f)
        }
    }

    private static func sourceWords(_ s: String?) -> String {
        switch s {
        case "record"?: return "The record says"
        case "listing_text"?: return "The listing says"
        case "vin_decode"?: return "The VIN decodes as"
        case let other?: return JobCopy.sentence(other) + " says"
        case nil: return "A source says"
        }
    }

    /// "The record says LX450; the VIN decodes as LX".
    static func identityLine(_ values: [WorkPlan.IdentityValue]) -> String {
        var seen = Set<String>()
        var parts: [String] = []
        for v in values {
            let shown = v.raw ?? v.value ?? "?"
            let key = (v.source ?? "") + "|" + (v.value ?? shown).lowercased()
            guard seen.insert(key).inserted else { continue }
            let words = sourceWords(v.source)
            parts.append("\(parts.isEmpty ? words : words.prefix(1).lowercased() + words.dropFirst()) \(shown)")
        }
        return parts.joined(separator: "; ")
    }

    static func identityStatus(_ s: String) -> String {
        s == "conflict" ? "Records disagree" : "One source is more specific"
    }

    static func claimKind(_ k: String) -> String {
        switch k {
        case "listing_statement": return "Listing statement"
        case "defect_or_condition": return "Condition or defect"
        case "condition_summary": return "Condition summary"
        case "modification": return "Modification"
        case "reported_completed_work": return "Work reported done"
        case "document_or_title": return "Documents or title"
        case "odometer": return "Odometer"
        default: return JobCopy.sentence(k)
        }
    }

    /// "quoted from bringatrailer.com · date not read · not scored".
    static func claimSource(_ c: WorkPlan.Claim) -> String {
        let how = c.isExactQuote ? "quoted from" : "paraphrased from"
        let host = c.sourceURL.flatMap { URL(string: $0)?.host?.replacingOccurrences(of: "www.", with: "") } ?? "the listing"
        let when = JobCopy.day(c.eventAt) ?? "date not read"
        let confidence = c.confidence.map { "confidence \(Int(($0 * 100).rounded()))%" } ?? "not scored"
        return "\(how) \(host) · \(when) · \(confidence)"
    }

    /// "about 4 h", "2–6 h", or "hours not stated".
    static func hours(_ t: WorkPlan.Target) -> String {
        func h(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
        if let lo = t.min, let hi = t.max { return "\(h(lo))–\(h(hi)) h" }
        if let typ = t.typical { return "about \(h(typ)) h" }
        return "hours not stated"
    }

    static let roughGuide = "rough guide, not calibrated"
    /// Shown instead of any placeholder labor rate: no dollar figure until a real rate or quote exists.
    static let noShopRate = "No shop rate on record yet — a technician's quote sets the price."

    static func system(_ s: String?) -> String {
        switch s {
        case "engine_bay"?: return "Engine bay"
        case "top_end"?: return "Engine top end"
        case "bottom_end"?: return "Engine bottom end"
        case let other?: return JobCopy.sentence(other)
        case nil: return "General"
        }
    }

    static func verdict(_ v: String?) -> (text: String, status: RootStatus) {
        switch v {
        case "supports"?: return ("Matches the listing", .attributed)
        case "contradicts"?: return ("Doesn't match the listing", .conflicting)
        case "unknown"?: return ("Couldn't tell", .pending)
        default: return ("Noted", .recorded)
        }
    }

    static func severity(_ s: String?) -> String? {
        switch s {
        case "info"?: return "for information"
        case "monitor"?: return "keep an eye on it"
        case "concern"?: return "concern"
        case "critical"?: return "critical"
        default: return nil
        }
    }

    static func permission(_ p: InspectionDoc.Permission?) -> (text: String, status: RootStatus) {
        switch p?.state {
        case "established"?:
            if let w = OfferCopy.window(p?.from, p?.until) { return ("Seller agreed for \(w)", .proven) }
            return ("Seller agreed", .proven)
        case "expired"?: return ("The seller's permission has expired", .refuted)
        default: return ("Seller hasn't agreed yet", .pending)
        }
    }

    static func inspectionTitle(_ t: String?) -> String {
        t == "pre_purchase" || t == nil ? "Pre-purchase inspection" : JobCopy.sentence(t!) + " inspection"
    }

    static func orderFailure(_ error: Error) -> String {
        guard let pg = error as? PostgrestError else { return ReadFailure.text(error) }
        let m = pg.message
        if m.contains("Vehicle unavailable") { return "This vehicle isn't open for inspection requests." }
        if m.contains("Checklist") { return "The checklist couldn't be sent as it is. Refresh the plan and try again." }
        if m.contains("listing_url") { return "The listing link couldn't be used." }
        if m.contains("Authentication required") { return "Sign in to order an inspection." }
        return ReadFailure.text(error)
    }
}

// MARK: - Readers and the order Sign

enum PlanReaders {
    static func plan(vehicleId: String) async -> JobLoad<WorkPlan> {
        await JobReaders.call("listing_work_plan_read") {
            try await SupabaseService.client.rpc("listing_work_plan_read", params: ["p_vehicle_id": vehicleId]).execute().data
        }
    }

    static func inspections(workOrderId: String) async -> JobLoad<InspectionRead> {
        await JobReaders.call("work_order_inspection_read") {
            try await SupabaseService.client.rpc("work_order_inspection_read", params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    struct OrderParams: Encodable, Equatable {
        let p_vehicle_id: String
        let p_scope: JobJSON
    }

    /// The reader's inspection_scope unchanged, plus the request channel; nil when it has no checklist.
    static func orderParams(vehicleId: String, plan: WorkPlan) -> OrderParams? {
        guard case .object(var scope)? = plan.inspectionScope,
              case .array(let items)? = scope["ppi_checklist"], !items.isEmpty, items.count <= 50 else { return nil }
        scope["request_source"] = .string("ios")
        return OrderParams(p_vehicle_id: vehicleId, p_scope: .object(scope))
    }

    static func order(_ params: OrderParams) async -> Result<InspectionRequestReceipt, JobSignFailure> {
        do {
            let data = try await SupabaseService.client.rpc("request_inspection", params: params).execute().data
            return .success(try JobReaders.decode(InspectionRequestReceipt.self, from: data))
        } catch {
            NSLog("NukeCapture request_inspection failed: %@", String(describing: error))
            return .failure(JobSignFailure(text: PlanCopy.orderFailure(error)))
        }
    }
}

/// Set by entry points that open a vehicle from a listing (Explore), so its Work card offers "Plan the work".
private struct ListingContextKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var vehicleListingContext: Bool {
        get { self[ListingContextKey.self] }
        set { self[ListingContextKey.self] = newValue }
    }
}
