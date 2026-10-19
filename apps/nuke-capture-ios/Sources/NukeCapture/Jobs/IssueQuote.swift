// IssueQuote.swift — the quoting side's "Issue quote" / "Revise quote" (issue_work_order_quote).
//
// Offered only when work_order_quotes_read's viewer.issuer_actions carries issue_quote (an eligible
// issuer: the job's shop owner, an accepted technician or the job's performer; never the customer;
// not once the current quote is accepted — then issue_change_order). Lines reference the job's own
// scope (operations, requirements; any line may be a fee) as the projection requires: pricing basis
// flat | hourly | day_rate | per_operation with the matching unit, amount + 3-letter currency
// together, quantity only for non-flat lines, at least one priced line. Optional deposit
// {amount, currency}, valid until, and release conditions from the action's vocabulary. A revision
// supersedes the current quote named in the action. Nothing is booked or paid until the customer
// accepts; payment_authorized is always false.

import Foundation
import Supabase
import SwiftUI

// MARK: - The job's scope, as the quote must reference it

struct QuoteScope: Equatable {
    struct Item: Equatable, Identifiable {
        let refKind: String
        let refId: String
        let description: String
        /// A price already recorded on the job (parts, labor), offered as the starting price.
        var basis: String? = nil
        var amount: Double? = nil
        var quantity: Double? = nil
        var id: String { refKind + refId }
    }
    let operations: [Item]
    let requirements: [Item]
    var parts: [Item] = []
    var labor: [Item] = []

    static let empty = QuoteScope(operations: [], requirements: [])
}

/// work_order_operations_read (anon + authenticated): the job's operations with their needs and
/// specification keys, parts and labor with open prices, each carrying the exact quote_ref
/// issue_work_order_quote accepts. Descriptions that name a person are withheld for non-parties.
struct WorkOrderOperations: Decodable, Equatable {
    struct Ref: Decodable, Equatable { let ref_kind: String; let ref_id: String }
    struct Requirement: Decodable, Equatable, Identifiable {
        let id: String
        let requirement_kind: String?
        let description: String?
        let quote_ref: Ref?
    }
    struct Operation: Decodable, Equatable, Identifiable {
        let id: String
        let lineNumber: Int?
        let taskType: String?
        let status: String?
        let description: String?
        let requestedByRole: String?
        /// authenticated_sign | source_without_sign | not_established.
        let requestedByBasis: String?
        /// The work order field the words are quoted from (description, scope_description), or unsourced_row.
        let descriptionBasis: String?
        let specifications: Int
        let requirements: [Requirement]
        let quoteRef: Ref?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            id = try c.decode(String.self, forKey: JobCodingKey("id"))
            lineNumber = try? c.decode(Int.self, forKey: JobCodingKey("line_number"))
            taskType = try? c.decode(String.self, forKey: JobCodingKey("task_type"))
            status = try? c.decode(String.self, forKey: JobCodingKey("status"))
            description = (try? c.decode(String.self, forKey: JobCodingKey("description"))).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
            requestedByRole = try? c.decode(String.self, forKey: JobCodingKey("requested_by_role"))
            requestedByBasis = try? c.decode(String.self, forKey: JobCodingKey("requested_by_basis"))
            descriptionBasis = try? c.decode(String.self, forKey: JobCodingKey("description_basis"))
            specifications = (try? c.decode([JobJSON].self, forKey: JobCodingKey("specifications")))?.count ?? 0
            requirements = (try? c.decode([Lossy<Requirement>].self, forKey: JobCodingKey("requirements")))?.compactMap(\.value) ?? []
            quoteRef = try? c.decode(Ref.self, forKey: JobCodingKey("quote_ref"))
        }
    }
    struct Part: Decodable, Equatable, Identifiable {
        let id: String
        let part_name: String?
        let quantity: Double?
        let unit_price: Double?
        let total_price: Double?
        let is_comped: Bool?
        let status: String?
        let quote_ref: Ref?
    }
    struct Labor: Decodable, Equatable, Identifiable {
        let id: String
        let task_name: String?
        let hours: Double?
        let hourly_rate: Double?
        let is_comped: Bool?
        let status: String?
        let quote_ref: Ref?
    }

    let operations: [Operation]
    let parts: [Part]
    let labor: [Labor]
    var asOf: String? = nil
    var party = false

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        operations = (try? c.decode([Lossy<Operation>].self, forKey: JobCodingKey("operations")))?.compactMap(\.value) ?? []
        parts = (try? c.decode([Lossy<Part>].self, forKey: JobCodingKey("parts")))?.compactMap(\.value) ?? []
        labor = (try? c.decode([Lossy<Labor>].self, forKey: JobCodingKey("labor")))?.compactMap(\.value) ?? []
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
        party = (try? c.decode([String: JobJSON].self, forKey: JobCodingKey("viewer")))?["party"] == .bool(true)
    }

    /// Every line choice with its server-given quote_ref; rows without one, or without words, are left out.
    var scope: QuoteScope {
        func text(_ s: String?) -> String? { s.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } }
        let ops = operations.compactMap { o -> QuoteScope.Item? in
            guard let r = o.quoteRef, let d = o.description else { return nil }
            return QuoteScope.Item(refKind: r.ref_kind, refId: r.ref_id, description: d)
        }
        let reqs = operations.flatMap(\.requirements).compactMap { q -> QuoteScope.Item? in
            guard let r = q.quote_ref, let d = text(q.description) else { return nil }
            return QuoteScope.Item(refKind: r.ref_kind, refId: r.ref_id, description: d)
        }
        let ps = parts.compactMap { p -> QuoteScope.Item? in
            guard let r = p.quote_ref, let d = text(p.part_name) else { return nil }
            let price = p.is_comped == true ? nil : (p.unit_price ?? p.total_price)
            return QuoteScope.Item(refKind: r.ref_kind, refId: r.ref_id, description: d, basis: "flat",
                                   amount: price.map { p.unit_price != nil ? $0 * max(p.quantity ?? 1, 1) : $0 })
        }
        let ls = labor.compactMap { l -> QuoteScope.Item? in
            guard let r = l.quote_ref, let d = text(l.task_name) else { return nil }
            return QuoteScope.Item(refKind: r.ref_kind, refId: r.ref_id, description: d, basis: "hourly",
                                   amount: l.is_comped == true ? nil : l.hourly_rate, quantity: l.hours.flatMap { $0 > 0 ? $0 : nil })
        }
        return QuoteScope(operations: ops, requirements: reqs, parts: ps, labor: ls)
    }
}

enum IssueQuoteReaders {
    static let operationsName = "work_order_operations_read"

    static func operations(workOrderId: String) async -> JobLoad<WorkOrderOperations> {
        await JobReaders.call(operationsName) {
            try await SupabaseService.client.rpc(operationsName, params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    static func scope(workOrderId: String) async -> QuoteScope {
        if case .loaded(let o) = await operations(workOrderId: workOrderId) { return o.scope }
        return .empty
    }
}

// MARK: - Drafting (validated locally; the server re-checks everything)

enum IssueQuoteDrafting {
    enum Basis: String, CaseIterable, Identifiable {
        case flat, hourly, day_rate, per_operation
        var id: String { rawValue }
        var title: String {
            switch self {
            case .flat: return "Flat"
            case .hourly: return "Hourly"
            case .day_rate: return "Day rate"
            case .per_operation: return "Per operation"
            }
        }
        /// The unit the projection requires for each basis.
        var unit: String? {
            switch self {
            case .flat: return nil
            case .hourly: return "hour"
            case .day_rate: return "day"
            case .per_operation: return "operation"
            }
        }
        var quantityLabel: String {
            switch self {
            case .flat: return ""
            case .hourly: return "Hours"
            case .day_rate: return "Days"
            case .per_operation: return "Operations"
            }
        }
    }

    struct LineDraft: Identifiable, Equatable {
        let id = UUID()
        var included = true
        var refKind: String
        var refId: String?
        var description: String
        var basis: Basis = .flat
        var amount = ""
        var currency = "USD"
        var quantity = ""

        static func fee() -> LineDraft { LineDraft(refKind: "fee", refId: nil, description: "") }
    }

    /// A revision starts from the current quote's lines; a first quote from the job's operations and needs.
    static func seed(scope: QuoteScope, current: Quote?) -> [LineDraft] {
        if let current, !current.lines.isEmpty {
            return current.lines.map { l in
                var d = LineDraft(refKind: l.refKind ?? "fee", refId: (l.refKind ?? "fee") == "fee" ? nil : l.refId,
                                  description: l.description ?? "")
                d.basis = Basis(rawValue: l.pricingBasis ?? "flat") ?? .flat
                d.amount = l.amount.map { JobCopy.plainNumber($0) } ?? ""
                d.currency = l.currency ?? "USD"
                d.quantity = l.quantity.map { JobCopy.plainNumber($0) } ?? ""
                return d
            }
        }
        func draft(_ i: QuoteScope.Item, on: Bool) -> LineDraft {
            var d = LineDraft(refKind: i.refKind, refId: i.refId, description: i.description)
            d.included = on
            if let b = i.basis.flatMap(Basis.init(rawValue:)) { d.basis = b }
            d.amount = i.amount.map { JobCopy.plainNumber($0) } ?? ""
            d.quantity = i.quantity.map { JobCopy.plainNumber($0) } ?? ""
            return d
        }
        let ops = scope.operations.map { draft($0, on: true) }
        // Needs, parts and labor are listed but start off when operations already describe the work.
        let rest = (scope.parts + scope.labor + scope.requirements).map { draft($0, on: ops.isEmpty) }
        let all = ops + rest
        return all.isEmpty ? [.fee()] : all
    }

    /// One condition from the action's release_conditions_vocabulary.
    struct Condition: Equatable, Identifiable {
        let kind: String
        let takesDays: Bool
        var id: String { kind }
    }

    static func vocabulary(_ action: JobAction) -> [Condition] {
        guard case .array(let list)? = action.raw["release_conditions_vocabulary"] else { return [] }
        return list.compactMap {
            switch $0 {
            case .string(let k): return Condition(kind: k, takesDays: false)
            case .object(let o): return o["kind"]?.stringValue.map { Condition(kind: $0, takesDays: o["days"] != nil) }
            default: return nil
            }
        }
    }

    struct Deposit: Encodable, Equatable, Sendable { let amount: Double; let currency: String }

    struct Params: Encodable, Equatable {
        let p_work_order_id: String
        let p_lines: [JobJSON]
        let p_deposit: Deposit?
        let p_valid_until: String?
        let p_supersedes_quote_id: String?
        let p_release_conditions: [JobJSON]?
    }

    static func supersedes(_ action: JobAction) -> String? { action.args["p_supersedes_quote_id"]?.stringValue }

    private static func currencyCode(_ s: String) -> String? {
        let c = s.trimmingCharacters(in: .whitespaces).uppercased()
        return c.count == 3 && c.allSatisfy({ $0.isLetter && $0.isASCII }) ? c : nil
    }

    private static func number(_ s: String) -> Double? {
        Double(s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ""))
    }

    static func params(action: JobAction, lines: [LineDraft], deposit: (amount: String, currency: String)?, validUntil: Date?,
                       conditions: Set<String>, days: Int, now: Date = Date()) -> Result<Params, JobSignFailure> {
        guard action.kind == "issue_quote", (action.rpc ?? "issue_work_order_quote") == "issue_work_order_quote",
              let wo = action.args["p_work_order_id"]?.stringValue else {
            return .failure(JobSignFailure(text: "This job isn't open for a quote from your account."))
        }
        let picked = lines.filter(\.included)
        guard (1...200).contains(picked.count) else { return .failure(JobSignFailure(text: "A quote has 1 to 200 lines.")) }
        var out: [JobJSON] = []
        var priced = 0
        for (i, l) in picked.enumerated() {
            let n = i + 1
            let text = l.description.trimmingCharacters(in: .whitespacesAndNewlines)
            guard (1...500).contains(text.count), !text.contains("\n") else {
                return .failure(JobSignFailure(text: "Line \(n) needs a short description."))
            }
            guard ["operation", "requirement", "part", "labor", "fee"].contains(l.refKind),
                  (l.refKind == "fee") == (l.refId == nil) else {
                return .failure(JobSignFailure(text: "Line \(n) isn't tied to this job's work. Refresh and try again."))
            }
            var o: [String: JobJSON] = ["ref_kind": .string(l.refKind), "description": .string(text), "pricing_basis": .string(l.basis.rawValue)]
            if let id = l.refId { o["ref_id"] = .string(id) }
            if let u = l.basis.unit { o["unit"] = .string(u) }
            if !l.amount.trimmingCharacters(in: .whitespaces).isEmpty {
                guard let a = number(l.amount), a >= 0, a < 10_000_000 else { return .failure(JobSignFailure(text: "Line \(n): enter the price as a number.")) }
                guard let cur = currencyCode(l.currency) else { return .failure(JobSignFailure(text: "Line \(n): currency is a 3-letter code, like USD.")) }
                o["amount"] = .number(a)
                o["currency"] = .string(cur)
                priced += 1
            }
            if !l.quantity.trimmingCharacters(in: .whitespaces).isEmpty {
                guard l.basis != .flat else { return .failure(JobSignFailure(text: "Line \(n): a flat price has no quantity.")) }
                guard let q = number(l.quantity), q > 0 else { return .failure(JobSignFailure(text: "Line \(n): the quantity must be more than 0.")) }
                o["quantity"] = .number(q)
            }
            out.append(.object(o))
        }
        guard priced > 0 else { return .failure(JobSignFailure(text: "Price at least one line — without prices it's an estimate, not a quote.")) }
        var dep: Deposit?
        if let deposit {
            guard let a = number(deposit.amount), a > 0 else { return .failure(JobSignFailure(text: "Enter the deposit as a number.")) }
            guard let cur = currencyCode(deposit.currency) else { return .failure(JobSignFailure(text: "The deposit's currency is a 3-letter code, like USD.")) }
            dep = Deposit(amount: a, currency: cur)
        }
        if let validUntil, validUntil <= now { return .failure(JobSignFailure(text: "Valid until must be in the future.")) }
        let vocab = vocabulary(action)
        var release: [JobJSON] = []
        for c in vocab where conditions.contains(c.kind) {
            if c.takesDays {
                guard (1...90).contains(days) else { return .failure(JobSignFailure(text: "Days after sign-off is 1 to 90.")) }
                release.append(.object(["kind": .string(c.kind), "days": .number(Double(days))]))
            } else {
                release.append(.object(["kind": .string(c.kind)]))
            }
        }
        guard release.count <= 5 else { return .failure(JobSignFailure(text: "Choose at most 5 release conditions.")) }
        return .success(Params(p_work_order_id: wo, p_lines: out, p_deposit: dep, p_valid_until: validUntil.map(FacilityDrafting.iso),
                               p_supersedes_quote_id: supersedes(action), p_release_conditions: release.isEmpty ? nil : release))
    }
}

/// issue_work_order_quote's answer.
struct IssuedQuote: Decodable, Equatable {
    let quote_id: String
    let version: Int?
    let quote_hash: String?
    let duplicate: Bool?

    /// "Version 2 · 3f9a1c0e" — the hash's first 8 characters, as a reference only.
    var line: String {
        ["Version \(version ?? 1)", quote_hash.map { String($0.prefix(8)) }].compactMap { $0 }.joined(separator: " · ")
    }
}

// MARK: - Copy

enum IssueQuoteCopy {
    static let says = [
        "You offer to do this work at these prices, for this job.",
        "The customer must accept it before anything is booked or paid.",
    ]
    static let doesNotSay = [
        "That the work is booked",
        "Any payment — a deposit here is only requested",
        "That this is final — a new version replaces this one",
    ]

    /// "Revise quote" only for the viewer's own current quote; another issuer's current quote is replaced by a new version.
    static func title(_ action: JobAction, current: Quote?) -> String {
        guard IssueQuoteDrafting.supersedes(action) != nil else { return "Issue quote" }
        return current?.issuedByViewer == true ? "Revise quote" : "Issue a new version"
    }

    static func refLabel(_ kind: String) -> String {
        switch kind {
        case "operation": return "Work"
        case "requirement": return "Need"
        case "part": return "Part"
        case "labor": return "Labor"
        default: return "Fee"
        }
    }

    static func failure(_ error: Error) -> String {
        let message = (error as? PostgrestError)?.message ?? ""
        let table: [(String, String)] = [
            ("Authentication required", "Sign in first."),
            ("The customer cannot quote their own job", "You're the customer on this job, so you can't quote it."),
            ("Work order unavailable for quoting", "Only the shop's owner, an accepted technician or the job's technician can quote it."),
            ("A quote needs a vehicle-bound work order", "This job has no vehicle yet, so it can't be quoted."),
            ("Quote version must be the next version", "Someone issued a new version meanwhile. Refresh and try again."),
            ("A quote revision must name the current quote", "Someone issued a new version meanwhile. Refresh and try again."),
            ("Quote scope snapshot must equal", "The job's work changed while you were quoting. Refresh and try again."),
            ("Quote lines must be an array", "A quote has 1 to 200 lines."),
            ("Invalid quote line", "One of the lines isn't valid. Check its price, currency and quantity."),
            ("A quote prices at least one line", "Price at least one line — without prices it's an estimate, not a quote."),
            ("Deposit requested must be", "The deposit needs an amount and a currency."),
            ("Quote validity must end after", "Valid until must be in the future."),
            ("Release conditions must be", "Choose 1 to 5 release conditions, or none."),
            ("release condition", "Check the release conditions."),
        ]
        if let hit = table.first(where: { message.contains($0.0) }) { return hit.1 }
        return ReadFailure.text(error)
    }
}

// MARK: - The job's operations in words (open data; the checklist is JobOperationsSection)

enum OperationsCopy {
    static func requestedBy(_ role: String?) -> String? {
        switch role {
        case "customer"?: return "asked for by the customer"
        case "organization_owner"?: return "added by the shop"
        case "accepted_provider"?: return "added by the technician"
        case "offering_provider"?: return "from a technician's offer"
        case "scope_text_interpretation"?: return "read from the job's description"
        case "source_record"?: return "from the shop's records"
        default: return nil
        }
    }

    /// "1. Replace front pads and rotors" — or a plain stand-in when the words name a person.
    static func title(_ o: WorkOrderOperations.Operation) -> String {
        (o.lineNumber.map { "\($0). " } ?? "") + (o.description ?? "Description withheld (it named a person)")
    }

    /// "asked for by the customer · needs: skill, inspection".
    static func detail(_ o: WorkOrderOperations.Operation) -> String? {
        let needs = Array(Set(o.requirements.compactMap(\.requirement_kind))).sorted().map(OfferCopy.kind).map { $0.lowercased() }
        let parts = [requestedBy(o.requestedByRole), needs.isEmpty ? nil : "needs: " + needs.joined(separator: ", ")].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
