// JobDocument.swift — the job-path reader's answer, decoded the way the server sends it.
//
// A job is a future receipt: one work_orders header read across seven stages (intake,
// inspection, plan, terms, execution, completion, accounting). The shape is the output of
// read_work_order_job_path (migration 20261019045753) as wrapped by the authenticated
// readers in docs R4 §4 (#2 my_work_orders, #3 work_order_job_path_read, #4
// work_order_resources_read, #6 my_signature_queue). Each wrapper adds a `viewer` block the
// phone renders from and never infers.
//
// Decoding is tolerant by contract: a stage state, viewer context or action this build does
// not know decodes as `.unknown(raw)` and renders verbatim, never as a crash and never as a
// rung it was not given. Money and contact visibility fail closed: only a literal `true`
// opens them.

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

    /// Fact keys that could carry an amount. The job path is amount-free today; this guards a
    /// later wrapper that adds one, so a number under such a key is shown only to a viewer the
    /// server opened money for.
    static func isMoneyKey(_ key: String) -> Bool {
        let k = key.lowercased()
        return ["amount", "cost", "price", "total", "cents", "usd"].contains { k.contains($0) }
    }
}

// MARK: - Stages

enum JobStageKey: String, CaseIterable, Identifiable {
    case intake, inspection, plan, terms, execution, completion, accounting

    var id: String { rawValue }

    var title: String {
        switch self {
        case .intake: return "Intake"
        case .inspection: return "Inspection"
        case .plan: return "Plan"
        case .terms: return "Terms"
        case .execution: return "Execution"
        case .completion: return "Completion"
        case .accounting: return "Accounting"
        }
    }

    /// One letter for the mini rail; Inspection and Intake share an initial, so Inspection is "S" (survey).
    var initial: String {
        switch self {
        case .intake: return "I"
        case .inspection: return "S"
        case .plan: return "P"
        case .terms: return "T"
        case .execution: return "E"
        case .completion: return "C"
        case .accounting: return "A"
        }
    }
}

enum JobStageState: Equatable, Decodable {
    case recorded
    case partial
    case statusOnly
    case absent
    case unknown(String)

    init(raw: String) {
        switch raw {
        case "recorded": self = .recorded
        case "partial": self = .partial
        case "status_only": self = .statusOnly
        case "absent": self = .absent
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
        case visitor, selfView, client, provider, orgMember
        case unknown(String)

        init(raw: String) {
            switch raw {
            case "visitor": self = .visitor
            case "self": self = .selfView
            case "client": self = .client
            case "provider": self = .provider
            case "org_member": self = .orgMember
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
    var id: String { kind + (stage ?? "") }

    init(kind: String, label: String? = nil, stage: String? = nil) {
        self.kind = kind; self.label = label; self.stage = stage
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
                  stage: try? c.decode(String.self, forKey: JobCodingKey("stage")))
    }

    var title: String { label ?? JobWords.humanize(kind) }
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

    enum CodingKeys: String, CodingKey {
        case stages, viewer
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

    enum CodingKeys: String, CodingKey {
        case returned
        case totalForViewer = "total_for_viewer"
    }

    /// "3 of 7 work orders readable by your account", or the honest unknown.
    var sentence: String {
        switch (returned, totalForViewer) {
        case let (r?, t?): return "\(r) of \(t) work orders readable by your account"
        case let (r?, nil): return "\(r) shown · total readable by your account not stated"
        default: return "Coverage not stated by the reader"
        }
    }
}

struct JobRow: Decodable, Equatable, Identifiable {
    let workOrderId: String
    let vehicleId: String?
    let title: String?
    let slots: [String]
    let stageStates: [JobStageKey: JobStageState]
    let firstGap: String?
    let asOf: String?

    var id: String { workOrderId }

    enum CodingKeys: String, CodingKey {
        case title, slots
        case workOrderId = "work_order_id"
        case vehicleId = "vehicle_id"
        case stageStates = "stage_states"
        case firstGap = "first_gap"
        case asOf = "as_of"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try c.decode(String.self, forKey: .workOrderId)
        vehicleId = try? c.decode(String.self, forKey: .vehicleId)
        title = try? c.decode(String.self, forKey: .title)
        slots = (try? c.decode([String].self, forKey: .slots)) ?? []
        firstGap = try? c.decode(String.self, forKey: .firstGap)
        asOf = try? c.decode(String.self, forKey: .asOf)
        var states: [JobStageKey: JobStageState] = [:]
        if let s = try? c.nestedContainer(keyedBy: JobCodingKey.self, forKey: .stageStates) {
            for key in s.allKeys {
                guard let k = JobStageKey(rawValue: key.stringValue) else { continue }
                states[k] = (try? s.decode(JobStageState.self, forKey: key)) ?? .unknown("unstated")
            }
        }
        stageStates = states
    }
}

struct MyWorkOrders: Decodable, Equatable {
    let rows: [JobRow]
    let coverage: JobCoverage?
    let viewer: JobViewer?
    /// Rows the reader sent in a shape this build cannot read; counted, never dropped silently.
    let unreadableRows: Int

    enum CodingKeys: String, CodingKey { case rows, work_orders, coverage, viewer }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let key: CodingKeys = c.contains(.rows) ? .rows : .work_orders
        let raw = (try? c.decode([JobRowSlot].self, forKey: key)) ?? []
        rows = raw.compactMap(\.row)
        unreadableRows = raw.count - rows.count
        coverage = try? c.decode(JobCoverage.self, forKey: .coverage)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
    }
}

private struct JobRowSlot: Decodable {
    let row: JobRow?
    init(from decoder: Decoder) throws { row = try? JobRow(from: decoder) }
}

// MARK: - my_signature_queue

struct SignatureItem: Decodable, Equatable, Identifiable {
    let kind: String
    let refId: String
    let workOrderId: String?
    let clock: String?
    let evidenceCounts: [String: JobJSON]

    var id: String { kind + refId }

    enum CodingKeys: String, CodingKey {
        case kind, clock
        case refId = "ref_id"
        case workOrderId = "work_order_id"
        case evidenceCounts = "evidence_counts"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        refId = try c.decode(String.self, forKey: .refId)
        workOrderId = try? c.decode(String.self, forKey: .workOrderId)
        clock = try? c.decode(String.self, forKey: .clock)
        evidenceCounts = (try? c.decode([String: JobJSON].self, forKey: .evidenceCounts)) ?? [:]
    }
}

struct SignatureQueue: Decodable, Equatable {
    let items: [SignatureItem]
    let viewer: JobViewer?
    let unreadableItems: Int

    enum CodingKeys: String, CodingKey { case items, viewer }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = (try? c.decode([SignatureSlot].self, forKey: .items)) ?? []
        items = raw.compactMap(\.item)
        unreadableItems = raw.count - items.count
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
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

// MARK: - my_identity_read (the console reads only the provider-link rung from it)

struct MyIdentity: Decodable, Equatable {
    let providerLinkState: String?
    let viewer: JobViewer?

    enum CodingKeys: String, CodingKey { case provider_link, viewer }
    private struct Link: Decodable { let state: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        providerLinkState = (try? c.decode(Link.self, forKey: .provider_link))?.state
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
    }

    /// The identity-bridge rung, from the viewer block first, then the provider link.
    var bridge: String? { viewer?.identityBridge ?? providerLinkState }
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
