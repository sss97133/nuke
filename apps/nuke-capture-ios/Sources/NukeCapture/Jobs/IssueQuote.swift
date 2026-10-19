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

// MARK: - The job's scope, as the quote must reference it

struct QuoteScope: Equatable {
    struct Item: Equatable, Identifiable {
        let refKind: String
        let refId: String
        let description: String
        var id: String { refKind + refId }
    }
    let operations: [Item]
    let requirements: [Item]

    static let empty = QuoteScope(operations: [], requirements: [])
}

/// work_order_resources_read requirements (id, line_item_id, requirement_kind, description).
struct ScopeRequirements: Decodable, Equatable {
    struct Row: Decodable, Equatable {
        let id: String
        let line_item_id: String?
        let requirement_kind: String?
        let description: String?
    }
    let rows: [Row]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        rows = (try? c.decode([Lossy<Row>].self, forKey: JobCodingKey("requirements")))?.compactMap(\.value) ?? []
    }
}

/// work_order_line_items rows (readable by the job's shop owner, customer and vehicle owners under RLS).
struct ScopeOperation: Decodable, Equatable {
    let id: String
    let line_number: Int?
    let task_description: String?
}

enum IssueQuoteReaders {
    static func scope(workOrderId: String) async -> QuoteScope {
        async let reqData = try? SupabaseService.client.rpc("work_order_resources_read", params: ["p_work_order_id": workOrderId]).execute().data
        async let opRows: [ScopeOperation]? = try? SupabaseService.client.from("work_order_line_items")
            .select("id,line_number,task_description")
            .eq("work_order_id", value: workOrderId)
            .order("line_number")
            .limit(200)
            .execute().value
        let reqs = (await reqData).flatMap { try? JobReaders.decode(ScopeRequirements.self, from: $0) }?.rows ?? []
        return IssueQuoteDrafting.scope(operations: await opRows ?? [], requirements: reqs)
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

    static func scope(operations: [ScopeOperation], requirements: [ScopeRequirements.Row]) -> QuoteScope {
        let ops = operations.compactMap { o -> QuoteScope.Item? in
            guard let d = o.task_description?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty else { return nil }
            return QuoteScope.Item(refKind: "operation", refId: o.id, description: d)
        }
        let reqs = requirements.compactMap { r -> QuoteScope.Item? in
            guard let d = r.description?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty else { return nil }
            return QuoteScope.Item(refKind: "requirement", refId: r.id, description: d)
        }
        return QuoteScope(operations: ops, requirements: reqs)
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
        let ops = scope.operations.map { LineDraft(refKind: $0.refKind, refId: $0.refId, description: $0.description) }
        var reqs = scope.requirements.map { LineDraft(refKind: $0.refKind, refId: $0.refId, description: $0.description) }
        // Needs are listed but start unpriced and off when the operations already cover the work.
        if !ops.isEmpty { for i in reqs.indices { reqs[i].included = false } }
        let all = ops + reqs
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

    static func title(_ action: JobAction) -> String {
        IssueQuoteDrafting.supersedes(action) == nil ? "Issue quote" : "Revise quote"
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
