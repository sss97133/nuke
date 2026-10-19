// JobDocument.swift — the job-path reader's answer, decoded the way the server sends it.
//
// A job is a quote on its way to a receipt: estimate → quote (revisions) → acceptance →
// deposit → work order → change order → completion → invoice → payment → receipt. The reader
// measures one work_orders header across seven stages (intake, inspection, plan, terms,
// execution, completion, accounting). The shape is the output of
// read_work_order_job_path (migration 20261019045753) as wrapped by the authenticated
// readers in docs R4 §4 (#2 my_work_orders, #3 work_order_job_path_read, #4
// work_order_resources_read, #6 my_signature_queue). Each wrapper adds a `viewer` block the
// phone renders from and never infers.
//
// Decoding is tolerant by contract: a stage state, viewer context or action this build does
// not know decodes as `.unknown(raw)`, never as a crash and never as a rung it was not given.
// Data is open by default (stages, scope, specs, resources, quote prices, labor rates, parts
// costs). Two things are withheld on the phone whatever a reader sends: personal contact
// fields are never rendered (people reach each other through a Contact via Nuke request), and
// payment/balance amounts show only when the server's money_visible is a literal `true`.

import Foundation

// MARK: - Any JSON the reader sent that this build keeps without interpreting

enum JobJSON: Decodable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JobJSON])
    case array([JobJSON])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JobJSON].self) { self = .array(a) }
        else if let o = try? c.decode([String: JobJSON].self) { self = .object(o) }
        else { self = .null }
    }

    /// The value as the reader stated it. Objects of counts read "key n · key n", sorted by key.
    var text: String {
        switch self {
        case .string(let s): return s
        case .number(let n):
            guard n.isFinite else { return "unreadable number" }
            if n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
            return String(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "not recorded"
        case .array(let a): return a.isEmpty ? "none" : a.map(\.text).joined(separator: ", ")
        case .object(let o):
            if o.isEmpty { return "none" }
            return o.keys.sorted().map { "\(JobWords.humanize($0)) \(o[$0]!.text)" }.joined(separator: " · ")
        }
    }

    var intValue: Int? {
        if case .number(let n) = self, n.isFinite, n == n.rounded(), abs(n) < 1e15 { return Int(n) }
        return nil
    }

    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }
}

/// Keys of a JSON object in the order the decoder met them, plus any key.
struct JobCodingKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

enum JobWords {
    /// snake_case code → plain words ("no_approval_clock" → "no approval clock").
    static func humanize(_ code: String) -> String {
        code.replacingOccurrences(of: "_", with: " ")
    }

    /// Keys that carry money actually moved or owed (payments, balances, payouts). Prices, rates
    /// and costs are open; these show only to the parties the server opened money for.
    static func isPaymentKey(_ key: String) -> Bool {
        let k = key.lowercased()
        return ["amount_paid", "paid_amount", "payment_amount", "payout_amount", "balance", "owed",
                "refund", "amount_received", "deposit_paid"].contains { k.contains($0) }
    }

    /// Personal contact fields. Never rendered: contact happens through a platform request.
    static func isContactKey(_ key: String) -> Bool {
        let k = key.lowercased()
        return ["email", "phone", "address", "contact", "legal_name", "full_name"].contains { k.contains($0) }
    }
}

// MARK: - Stages

enum JobStageKey: String, CaseIterable, Identifiable {
    case intake, inspection, plan, terms, execution, completion, accounting

    var id: String { rawValue }

    var title: String { JobCopy.title(self) }
    var shortTitle: String { JobCopy.shortTitle(self) }
    var initial: String { JobCopy.initial(self) }
}

enum JobStageState: Equatable, Decodable {
    case recorded
    case partial
    case statusOnly
    case absent
    /// Shown only to the job's parties (accounting for a non-party viewer).
    case withheld
    case unknown(String)

    init(raw: String) {
        switch raw {
        case "recorded": self = .recorded
        case "partial": self = .partial
        case "status_only": self = .statusOnly
        case "absent": self = .absent
        case "withheld": self = .withheld
        default: self = .unknown(raw)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self.init(raw: (try? c.decode(String.self)) ?? "unstated")
    }

    /// The state as the reader wrote it.
    var raw: String {
        switch self {
        case .recorded: return "recorded"
        case .partial: return "partial"
        case .statusOnly: return "status_only"
        case .absent: return "absent"
        case .withheld: return "withheld"
        case .unknown(let s): return s
        }
    }
}

struct JobStage: Decodable, Equatable {
    let state: JobStageState
    let gaps: [String]
    let inconsistencies: [String]
    /// Every other key the stage carries (counts, clocks, statuses), sorted by key, verbatim.
    let facts: [Fact]

    struct Fact: Equatable, Identifiable {
        let key: String
        let value: JobJSON
        var id: String { key }
    }

    init(state: JobStageState, gaps: [String] = [], inconsistencies: [String] = [], facts: [Fact] = []) {
        self.state = state; self.gaps = gaps; self.inconsistencies = inconsistencies; self.facts = facts
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        state = (try? c.decode(JobStageState.self, forKey: JobCodingKey("state"))) ?? .unknown("unstated")
        gaps = Self.codes(c, "gaps")
        inconsistencies = Self.codes(c, "inconsistencies")
        let reserved: Set<String> = ["state", "gaps", "inconsistencies"]
        facts = c.allKeys
            .filter { !reserved.contains($0.stringValue) }
            .map { Fact(key: $0.stringValue, value: (try? c.decode(JobJSON.self, forKey: $0)) ?? .null) }
            .sorted { $0.key < $1.key }
    }

    private static func codes(_ c: KeyedDecodingContainer<JobCodingKey>, _ key: String) -> [String] {
        guard let raw = try? c.decode(JobJSON.self, forKey: JobCodingKey(key)), case .array(let a) = raw else { return [] }
        return a.compactMap(\.stringValue)
    }
}

// MARK: - Viewer block (decided by the server from auth.uid(); the phone never infers it)

struct JobViewer: Decodable, Equatable {
    enum Context: Equatable {
        case visitor, selfView, client, provider, orgMember, admin
        case unknown(String)

        init(raw: String) {
            switch raw {
            case "visitor": self = .visitor
            case "self": self = .selfView
            case "client": self = .client
            case "provider": self = .provider
            case "org_member": self = .orgMember
            case "admin": self = .admin
            default: self = .unknown(raw)
            }
        }

        var raw: String {
            switch self {
            case .visitor: return "visitor"
            case .selfView: return "self"
            case .client: return "client"
            case .provider: return "provider"
            case .orgMember: return "org_member"
            case .admin: return "admin"
            case .unknown(let s): return s
            }
        }
    }

    let context: Context
    let slots: [String]
    let moneyVisible: Bool
    let contactVisible: Bool
    let decidedFrom: String?
    let identityBridge: String?
    let actions: [JobAction]

    enum CodingKeys: String, CodingKey {
        case context, slots, actions
        case moneyVisible = "money_visible"
        case contactVisible = "contact_visible"
        case decidedFrom = "decided_from"
        case identityBridge = "identity_bridge"
    }

    init(context: Context, slots: [String] = [], moneyVisible: Bool = false, contactVisible: Bool = false,
         decidedFrom: String? = nil, identityBridge: String? = nil, actions: [JobAction] = []) {
        self.context = context; self.slots = slots; self.moneyVisible = moneyVisible
        self.contactVisible = contactVisible; self.decidedFrom = decidedFrom
        self.identityBridge = identityBridge; self.actions = actions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        context = Context(raw: (try? c.decode(String.self, forKey: .context)) ?? "visitor")
        slots = (try? c.decode([String].self, forKey: .slots)) ?? []
        moneyVisible = (try? c.decode(Bool.self, forKey: .moneyVisible)) == true
        contactVisible = (try? c.decode(Bool.self, forKey: .contactVisible)) == true
        decidedFrom = try? c.decode(String.self, forKey: .decidedFrom)
        identityBridge = try? c.decode(String.self, forKey: .identityBridge)
        actions = ((try? c.decode([JobActionSlot].self, forKey: .actions)) ?? []).compactMap(\.action)
    }
}

private struct JobActionSlot: Decodable {
    let action: JobAction?
    init(from decoder: Decoder) throws { action = try? JobAction(from: decoder) }
}

/// A Sign step the server offers this viewer. A bare string or an object; either way the phone
/// renders what it was given and decides no eligibility of its own.
struct JobAction: Decodable, Equatable, Identifiable {
    let kind: String
    let label: String?
    let stage: String?
    /// The writer the server names for this step and its arguments (e.g. accept_work_order_quote
    /// with p_quote_id and p_quote_hash). The phone passes them back; it never composes them.
    let rpc: String?
    let args: [String: JobJSON]
    /// What the step will record the viewer as (e.g. offer_kind, offer_rung for an offer).
    let asFields: [String: JobJSON]
    /// The same, when the reader sends a single word (e.g. record_payment as "payer" / "payee").
    var asText: String? = nil
    var id: String { kind + (stage ?? "") + (args.keys.sorted().compactMap { args[$0]?.stringValue }.joined()) }

    init(kind: String, label: String? = nil, stage: String? = nil, rpc: String? = nil, args: [String: JobJSON] = [:],
         asFields: [String: JobJSON] = [:]) {
        self.kind = kind; self.label = label; self.stage = stage; self.rpc = rpc; self.args = args; self.asFields = asFields
    }

    init(from decoder: Decoder) throws {
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            self.init(kind: s)
            return
        }
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        let kind = (try? c.decode(String.self, forKey: JobCodingKey("kind")))
            ?? (try? c.decode(String.self, forKey: JobCodingKey("action")))
        guard let kind else {
            throw DecodingError.dataCorruptedError(forKey: JobCodingKey("kind"), in: c, debugDescription: "action without kind")
        }
        self.init(kind: kind,
                  label: try? c.decode(String.self, forKey: JobCodingKey("label")),
                  stage: try? c.decode(String.self, forKey: JobCodingKey("stage")),
                  rpc: try? c.decode(String.self, forKey: JobCodingKey("rpc")),
                  args: (try? c.decode([String: JobJSON].self, forKey: JobCodingKey("args"))) ?? [:],
                  asFields: (try? c.decode([String: JobJSON].self, forKey: JobCodingKey("as"))) ?? [:])
        asText = try? c.decode(String.self, forKey: JobCodingKey("as"))
    }

    var title: String { label ?? JobCopy.action(kind) }
}

// MARK: - Vehicle label ({year, make, model, trim?}); never an id

struct JobVehicleLabel: Decodable, Equatable {
    let vehicleId: String?
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    /// The reader's own composed label, preferred when present.
    let serverText: String?

    enum CodingKeys: String, CodingKey {
        case year, make, model, trim
        case vehicleId = "vehicle_id"
        case serverText = "text"
    }

    init(vehicleId: String? = nil, year: Int? = nil, make: String? = nil, model: String? = nil, trim: String? = nil,
         serverText: String? = nil) {
        self.vehicleId = vehicleId; self.year = year; self.make = make; self.model = model; self.trim = trim
        self.serverText = serverText
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        vehicleId = try? c.decode(String.self, forKey: .vehicleId)
        year = (try? c.decode(Int.self, forKey: .year)) ?? (try? c.decode(String.self, forKey: .year)).flatMap { Int($0) }
        make = try? c.decode(String.self, forKey: .make)
        model = try? c.decode(String.self, forKey: .model)
        trim = try? c.decode(String.self, forKey: .trim)
        serverText = (try? c.decode(String.self, forKey: .serverText)).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// "1977 Chevrolet Blazer Cheyenne"; nil when nothing names the vehicle.
    var text: String? {
        if let serverText, !serverText.contains("UNRESOLVED") { return serverText }
        let parts = [year.map(String.init), make, model, trim].compactMap { $0 }
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && $0 != "UNRESOLVED" }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }
}

// MARK: - work_order_job_path_read

struct JobPath: Decodable, Equatable {
    let workOrderId: String
    let vehicleId: String?
    let asOf: String?
    let stages: [JobStageKey: JobStage]
    /// Stage keys the reader sent that this build has no column for.
    let unknownStages: [String]
    let stateBasis: String?
    let bookingReadiness: JobJSON?
    let permissionAuthority: JobJSON?
    let paymentAuthorized: JobJSON?
    let viewer: JobViewer?
    /// Display fields a later reader adds so ids never lead; nil until it sends them.
    let displayTitle: String?
    let vehicleLabel: JobVehicleLabel?
    let requestSourceLabel: String?
    let displayTitleBasis: String?

    enum CodingKeys: String, CodingKey {
        case stages, viewer
        case displayTitleBasis = "display_title_basis"
        case displayTitle = "display_title"
        case vehicleLabel = "vehicle_label"
        case requestSourceLabel = "request_source_label"
        case workOrderId = "work_order_id"
        case vehicleId = "vehicle_id"
        case asOf = "as_of"
        case stateBasis = "state_basis"
        case bookingReadiness = "booking_readiness"
        case permissionAuthority = "permission_authority"
        case paymentAuthorized = "payment_authorized"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try c.decode(String.self, forKey: .workOrderId)
        vehicleId = try? c.decode(String.self, forKey: .vehicleId)
        asOf = try? c.decode(String.self, forKey: .asOf)
        stateBasis = try? c.decode(String.self, forKey: .stateBasis)
        bookingReadiness = try? c.decode(JobJSON.self, forKey: .bookingReadiness)
        permissionAuthority = try? c.decode(JobJSON.self, forKey: .permissionAuthority)
        paymentAuthorized = try? c.decode(JobJSON.self, forKey: .paymentAuthorized)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
        displayTitle = (try? c.decode(String.self, forKey: .displayTitle)).flatMap { $0.isEmpty ? nil : $0 }
        vehicleLabel = (try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)).flatMap { $0.text == nil ? nil : $0 }
        requestSourceLabel = (try? c.decode(String.self, forKey: .requestSourceLabel)).flatMap { $0.isEmpty ? nil : $0 }
        displayTitleBasis = try? c.decode(String.self, forKey: .displayTitleBasis)
        var stages: [JobStageKey: JobStage] = [:]
        var unknown: [String] = []
        if let s = try? c.nestedContainer(keyedBy: JobCodingKey.self, forKey: .stages) {
            for key in s.allKeys {
                if let known = JobStageKey(rawValue: key.stringValue) {
                    stages[known] = try? s.decode(JobStage.self, forKey: key)
                } else {
                    unknown.append(key.stringValue)
                }
            }
        }
        self.stages = stages
        unknownStages = unknown.sorted()
    }
}

// MARK: - my_work_orders

struct JobCoverage: Decodable, Equatable {
    let returned: Int?
    let totalForViewer: Int?
    let slotFilter: String?
    let totalForVehicle: Int?

    enum CodingKeys: String, CodingKey {
        case returned
        case totalForViewer = "total_for_viewer"
        case slotFilter = "slot_filter"
        case totalForVehicle = "total_for_vehicle"
    }

    init(returned: Int?, totalForViewer: Int?, slotFilter: String? = nil, totalForVehicle: Int? = nil) {
        self.returned = returned; self.totalForViewer = totalForViewer; self.slotFilter = slotFilter
        self.totalForVehicle = totalForVehicle
    }

    /// "Showing 3 of 7 work orders", or the honest unknown.
    var sentence: String {
        switch (returned, totalForViewer ?? totalForVehicle) {
        case let (r?, t?): return "Showing \(r) of \(t) work orders"
        case let (r?, nil): return "Showing \(r) · total not available"
        default: return "Total not available"
        }
    }
}

/// The first gap on a job's path: `{stage, gap}` from the shipped reader, or a bare code.
struct JobGapRef: Decodable, Equatable {
    let stage: String?
    let gap: String

    init(stage: String?, gap: String) { self.stage = stage; self.gap = gap }

    init(from decoder: Decoder) throws {
        if let code = try? decoder.singleValueContainer().decode(String.self) {
            self.init(stage: nil, gap: code)
            return
        }
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        self.init(stage: try? c.decode(String.self, forKey: JobCodingKey("stage")),
                  gap: try c.decode(String.self, forKey: JobCodingKey("gap")))
    }
}

struct JobRow: Decodable, Equatable, Identifiable {
    let workOrderId: String
    let vehicleId: String?
    let title: String?
    let slots: [String]
    let stageStates: [JobStageKey: JobStageState]
    let firstGap: JobGapRef?
    let inconsistencyCount: Int
    let asOf: String?
    let displayTitle: String?
    let vehicleLabel: JobVehicleLabel?

    var id: String { workOrderId }

    enum CodingKeys: String, CodingKey {
        case title, slots, inconsistencies
        case workOrderId = "work_order_id"
        case vehicleId = "vehicle_id"
        case stageStates = "stage_states"
        case firstGap = "first_gap"
        case asOf = "as_of"
        case displayTitle = "display_title"
        case vehicleLabel = "vehicle_label"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try c.decode(String.self, forKey: .workOrderId)
        vehicleId = try? c.decode(String.self, forKey: .vehicleId)
        title = (try? c.decode(String.self, forKey: .title)).flatMap { $0.isEmpty ? nil : $0 }
        slots = (try? c.decode([String].self, forKey: .slots)) ?? []
        firstGap = try? c.decode(JobGapRef.self, forKey: .firstGap)
        inconsistencyCount = (try? c.decode(Int.self, forKey: .inconsistencies))
            ?? (try? c.decode([JobJSON].self, forKey: .inconsistencies))?.count ?? 0
        asOf = try? c.decode(String.self, forKey: .asOf)
        displayTitle = (try? c.decode(String.self, forKey: .displayTitle)).flatMap { $0.isEmpty ? nil : $0 }
        vehicleLabel = (try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)).flatMap { $0.text == nil ? nil : $0 }
        var states: [JobStageKey: JobStageState] = [:]
        if let s = try? c.nestedContainer(keyedBy: JobCodingKey.self, forKey: .stageStates) {
            for key in s.allKeys {
                guard let k = JobStageKey(rawValue: key.stringValue) else { continue }
                states[k] = (try? s.decode(JobStageState.self, forKey: key)) ?? .unknown("unstated")
            }
        }
        stageStates = states
    }

    /// The line a person reads first: never an id.
    var headline: String { displayTitle ?? title ?? vehicleLabel?.text ?? "Untitled job" }
}

struct MyWorkOrders: Decodable, Equatable {
    var rows: [JobRow]
    let coverage: JobCoverage?
    let viewer: JobViewer?
    let nextAfter: String?
    let asOf: String?
    /// vehicle_work_orders_read names the vehicle once for the page.
    let vehicleLabel: JobVehicleLabel?
    /// Rows the reader sent in a shape this build cannot read; counted, never dropped silently.
    var unreadableRows: Int

    enum CodingKeys: String, CodingKey {
        case rows, work_orders, coverage, viewer
        case nextAfter = "next_after"
        case asOf = "as_of"
        case vehicleLabel = "vehicle_label"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let key: CodingKeys = c.contains(.rows) ? .rows : .work_orders
        let raw = (try? c.decode([JobRowSlot].self, forKey: key)) ?? []
        rows = raw.compactMap(\.row)
        unreadableRows = raw.count - rows.count
        coverage = try? c.decode(JobCoverage.self, forKey: .coverage)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
        nextAfter = try? c.decode(String.self, forKey: .nextAfter)
        asOf = try? c.decode(String.self, forKey: .asOf)
        vehicleLabel = try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)
    }

    /// The next page appended to this one; the newer page's cursor and coverage win.
    func appending(_ next: MyWorkOrders) -> MyWorkOrders {
        var merged = next
        let seen = Set(rows.map(\.workOrderId))
        merged.rows = rows + next.rows.filter { !seen.contains($0.workOrderId) }
        merged.unreadableRows = unreadableRows + next.unreadableRows
        return merged
    }
}

private struct JobRowSlot: Decodable {
    let row: JobRow?
    init(from decoder: Decoder) throws { row = try? JobRow(from: decoder) }
}

// MARK: - my_signature_queue

struct SignatureItem: Decodable, Equatable, Identifiable {
    struct Clock: Decodable, Equatable {
        let sessionDate: String?
        let startTime: String?
        let endTime: String?

        enum CodingKeys: String, CodingKey {
            case sessionDate = "session_date"
            case startTime = "start_time"
            case endTime = "end_time"
        }

        init(sessionDate: String?, startTime: String? = nil, endTime: String? = nil) {
            self.sessionDate = sessionDate; self.startTime = startTime; self.endTime = endTime
        }

        init(from decoder: Decoder) throws {
            if let s = try? decoder.singleValueContainer().decode(String.self) {
                self.init(sessionDate: s)
                return
            }
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(sessionDate: try? c.decode(String.self, forKey: .sessionDate),
                      startTime: try? c.decode(String.self, forKey: .startTime),
                      endTime: try? c.decode(String.self, forKey: .endTime))
        }
    }

    /// What signing binds and what it does not, as the server states it (binds: a sentence or a list).
    struct Sign: Decodable, Equatable {
        let rpc: String?
        let bindsList: [String]
        let doesNotBind: [String]
        let argsHint: [String: JobJSON]

        var binds: String? { bindsList.first }

        enum CodingKeys: String, CodingKey {
            case rpc, binds
            case doesNotBind = "does_not_bind"
            case argsHint = "args_hint"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            rpc = try? c.decode(String.self, forKey: .rpc)
            if let one = try? c.decode(String.self, forKey: .binds) { bindsList = [one] }
            else { bindsList = (try? c.decode([String].self, forKey: .binds)) ?? [] }
            doesNotBind = (try? c.decode([String].self, forKey: .doesNotBind)) ?? []
            argsHint = (try? c.decode([String: JobJSON].self, forKey: .argsHint)) ?? [:]
        }
    }

    let kind: String
    let refId: String
    let workOrderId: String?
    let vehicle: JobVehicleLabel?
    let clock: Clock?
    let captureSpanMinutes: Int?
    let evidenceCounts: [String: JobJSON]
    let sign: Sign?
    let displayTitle: String?
    let summary: String?

    var id: String { kind + refId }

    enum CodingKeys: String, CodingKey {
        case kind, clock, vehicle, sign, summary
        case displayTitle = "display_title"
        case vehicleLabel = "vehicle_label"
        case refId = "ref_id"
        case workOrderId = "work_order_id"
        case captureSpanMinutes = "capture_span_minutes"
        case evidenceCounts = "evidence_counts"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        refId = try c.decode(String.self, forKey: .refId)
        workOrderId = try? c.decode(String.self, forKey: .workOrderId)
        vehicle = (try? c.decode(JobVehicleLabel.self, forKey: .vehicle)) ?? (try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel))
        displayTitle = try? c.decode(String.self, forKey: .displayTitle)
        summary = try? c.decode(String.self, forKey: .summary)
        clock = try? c.decode(Clock.self, forKey: .clock)
        captureSpanMinutes = try? c.decode(Int.self, forKey: .captureSpanMinutes)
        evidenceCounts = (try? c.decode([String: JobJSON].self, forKey: .evidenceCounts)) ?? [:]
        sign = try? c.decode(Sign.self, forKey: .sign)
    }
}

struct SignatureQueue: Decodable, Equatable {
    struct Coverage: Decodable, Equatable {
        let returned: Int?
        let total: Int?
        let limit: Int?
        let kinds: [String]
        let kindsNotYetAvailable: [String]

        enum CodingKeys: String, CodingKey {
            case returned, total, limit, kinds
            case kindsNotYetAvailable = "kinds_not_yet_available"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            returned = try? c.decode(Int.self, forKey: .returned)
            total = try? c.decode(Int.self, forKey: .total)
            limit = try? c.decode(Int.self, forKey: .limit)
            kinds = (try? c.decode([String].self, forKey: .kinds)) ?? []
            kindsNotYetAvailable = (try? c.decode([String].self, forKey: .kindsNotYetAvailable)) ?? []
        }
    }

    var items: [SignatureItem]
    let viewer: JobViewer?
    let asOf: String?
    let coverage: Coverage?
    let unreadableItems: Int

    enum CodingKeys: String, CodingKey {
        case items, viewer, coverage
        case asOf = "as_of"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = (try? c.decode([SignatureSlot].self, forKey: .items)) ?? []
        items = raw.compactMap(\.item)
        unreadableItems = raw.count - items.count
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
        asOf = try? c.decode(String.self, forKey: .asOf)
        coverage = try? c.decode(Coverage.self, forKey: .coverage)
    }
}

private struct SignatureSlot: Decodable {
    let item: SignatureItem?
    init(from decoder: Decoder) throws { item = try? SignatureItem(from: decoder) }
}

// MARK: - work_order_resources_read (rendered as counts with the reader's own coverage)

struct JobResources: Decodable, Equatable {
    let requirements: Int
    let fulfillments: Int
    let attestations: Int
    let specifications: Int
    let coverage: [JobStage.Fact]
    let asOf: String?
    let viewer: JobViewer?

    enum CodingKeys: String, CodingKey {
        case requirements, fulfillments, attestations, specifications, coverage, viewer
        case asOf = "as_of"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func count(_ k: CodingKeys) -> Int {
            if case .array(let a)? = try? c.decode(JobJSON.self, forKey: k) { return a.count }
            return 0
        }
        requirements = count(.requirements)
        fulfillments = count(.fulfillments)
        attestations = count(.attestations)
        specifications = count(.specifications)
        let cov = (try? c.decode([String: JobJSON].self, forKey: .coverage)) ?? [:]
        coverage = cov.keys.sorted().map { JobStage.Fact(key: $0, value: cov[$0]!) }
        asOf = try? c.decode(String.self, forKey: .asOf)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
    }
}

// MARK: - my_identity_read

struct ProviderClaim: Decodable, Equatable, Identifiable {
    let claimId: String
    let actorId: String?
    let actorName: String?
    let actorType: String?
    let rung: String?
    let status: String?
    let filedAt: String?
    let reviewedAt: String?
    let evidenceEntries: Int

    var id: String { claimId }

    enum CodingKeys: String, CodingKey {
        case actor, rung, status
        case claimId = "claim_id"
        case actorId = "actor_id"
        case filedAt = "filed_at"
        case reviewedAt = "reviewed_at"
        case evidenceEntries = "evidence_entries"
    }
    private struct Actor: Decodable { let name: String?; let actor_type: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        claimId = try c.decode(String.self, forKey: .claimId)
        actorId = try? c.decode(String.self, forKey: .actorId)
        let actor = try? c.decode(Actor.self, forKey: .actor)
        actorName = actor?.name
        actorType = actor?.actor_type
        rung = try? c.decode(String.self, forKey: .rung)
        status = try? c.decode(String.self, forKey: .status)
        filedAt = try? c.decode(String.self, forKey: .filedAt)
        reviewedAt = try? c.decode(String.self, forKey: .reviewedAt)
        evidenceEntries = (try? c.decode(Int.self, forKey: .evidenceEntries)) ?? 0
    }
}

struct MyIdentity: Decodable, Equatable {
    let providerLinkState: String?
    let providerActorId: String?
    let claims: [ProviderClaim]
    let username: String?
    let viewer: JobViewer?
    let asOf: String?

    enum CodingKeys: String, CodingKey {
        case provider_link, viewer, profile
        case asOf = "as_of"
    }
    private struct Link: Decodable {
        let state: String?
        let actor_id: String?
        let claims: [ClaimSlot]?
    }
    private struct ClaimSlot: Decodable {
        let claim: ProviderClaim?
        init(from decoder: Decoder) throws { claim = try? ProviderClaim(from: decoder) }
    }
    private struct Profile: Decodable { let username: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let link = try? c.decode(Link.self, forKey: .provider_link)
        providerLinkState = link?.state
        providerActorId = link?.actor_id
        claims = (link?.claims ?? []).compactMap(\.claim)
        username = (try? c.decode(Profile.self, forKey: .profile))?.username
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
        asOf = try? c.decode(String.self, forKey: .asOf)
    }

    /// The identity-bridge rung, from the viewer block first, then the provider link.
    var bridge: String? { viewer?.identityBridge ?? providerLinkState }

    /// Actors this account already has an open or confirmed claim on.
    var claimedActorIds: Set<String> {
        Set(claims.filter { $0.status == "pending" || $0.status == "approved" }.compactMap(\.actorId))
    }
}

// MARK: - Clocks

enum JobClock {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func date(_ s: String) -> Date? { iso.date(from: s) ?? isoPlain.date(from: s) }

    /// "Oct 19, 2026 05:57 UTC" for a server clock; the raw string when it does not parse.
    static func text(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        guard let d = date(s) else { return s }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM d, yyyy HH:mm 'UTC'"
        return f.string(from: d)
    }
}
