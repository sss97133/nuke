// CosignChange.swift — co-signs, vouches and change orders.
//
// A co-sign (cosign_provider) is someone vouching for an offer's technician on one job:
// supervision, suitability, permission to use their shop or tools, availability, a scope and an
// optional cut. It binds when the customer accepts the offer, and accepting pins the offer's
// terms hash, which covers the current co-signs. A vouch (vouch_for_provider) is a standing
// statement about a person, shown under "Vouched for by", never as skill. A change order
// (issue_change_order) is a new quote version amending the accepted one, line by line, with a
// reason; the customer accepts it through the normal quote acceptance.

import Foundation
import Supabase

// MARK: - Words

enum CosignCopy {
    static let kinds: [(key: String, title: String, explain: String)] = [
        ("supervision", "Supervision", "You'll oversee their work on this job."),
        ("suitability", "Suitability", "You think they're right for this job."),
        ("permission", "Permission", "They can use your shop or tools for this job."),
        ("availability", "Availability", "You can confirm they're available for it."),
    ]

    static func kind(_ k: String) -> String { kinds.first { $0.key == k }?.title.lowercased() ?? JobCopy.sentence(k).lowercased() }

    /// "cut 10% of labor", "cut $50.00 flat", "cut $40.00 per day".
    static func cut(_ c: CoSign.Cut?) -> String? {
        guard let c else { return nil }
        switch c.basis {
        case "share_of_labor_line"?:
            guard let p = c.percentage else { return nil }
            return "cut \(JobCopy.plainNumber(p))% of labor"
        case "flat"?:
            return c.amount.map { "cut \(JobMoney.format($0, c.currency)) flat" }
        case "day_rate"?:
            return c.amount.map { "cut \(JobMoney.format($0, c.currency)) per day" }
        default:
            return nil
        }
    }

    /// "Co-signed by Fixture Garage: supervision, permission · cut 10% of labor".
    static func line(_ s: CoSign) -> String {
        var text = "Co-signed by \(s.coSigner?.text ?? "Unnamed party")"
        if !s.kinds.isEmpty { text += ": " + s.kinds.map(kind).joined(separator: ", ") }
        if let c = cut(s.cut) { text += " · \(c)" }
        return text
    }

    static let cosignSays = ["You vouch for this technician within the scope you write."]
    static let cosignDoesNotSay = [
        "That they have the skill (a co-sign isn't skill proof)",
        "Any payment until the customer accepts the offer",
        "That a later change keeps the customer's acceptance; it must be accepted again",
    ]
    static let vouchSays = ["You vouch for this person within the scope you write."]
    static let vouchDoesNotSay = ["That they have the skill (a vouch isn't skill proof)", "Any job, payment or booking"]

    static func failure(_ error: Error) -> String {
        guard let pg = error as? PostgrestError else { return ReadFailure.text(error) }
        let m = pg.message
        if m.contains("cannot_cosign_own_offer") { return "You can't co-sign your own offer." }
        if m.contains("customer_cannot_cosign") { return "The customer can't co-sign an offer on their own job." }
        if m.contains("name_organization_id") { return "You belong to more than one shop; this app can't choose which one yet." }
        if m.contains("needs_facility_organization_or_owned_tools") {
            return "Co-signing and vouching need a shop you belong to, or tools on your record."
        }
        if m.contains("not_organization_member") { return "You're not a member of that shop." }
        if m.contains("offer_unavailable") { return "This offer is no longer open." }
        if m.contains("Kinds must be") { return "Pick at least one kind." }
        if m.contains("Scope of the") { return "Write what you're vouching for." }
        if m.contains("Cut must be") { return "Check the cut: a percentage up to 100, or an amount with a currency." }
        if m.contains("Cannot vouch for oneself") { return "You can't vouch for yourself." }
        if m.contains("Expiry must be") { return "Pick an end date in the future." }
        if m.contains("Vouch unavailable") || m.contains("Provider unavailable") { return "This person can't be vouched for right now." }
        if m.contains("Change order reason") { return "Say why the work changed." }
        if m.contains("base must be the current") { return "The quote changed since you opened it. Refresh and try again." }
        if m.contains("amends an accepted quote") { return "A change order needs an accepted quote." }
        if m.contains("changed once") { return "Each quote line can change once per change order." }
        if m.contains("changes something") { return "Change at least one thing." }
        if m.contains("keeps at least one line") { return "Keep at least one line." }
        if m.contains("substitution") || m.contains("A substitution") { return "Check the substitution: pick a material or process and a new key." }
        if m.contains("Invalid change") || m.contains("Invalid quote line") { return "Check the lines: each needs a description and a price." }
        if m.contains("customer cannot issue") { return "The customer can't issue a change order." }
        if m.contains("unavailable for change orders") { return "Only the job's quoting shop or technician can do this." }
        if m.contains("Authentication required") { return "Sign in first." }
        return ReadFailure.text(error)
    }
}

enum ChangeOrderCopy {
    /// One change in plain words.
    static func line(_ c: ChangeOrder.Change, currency: String?) -> String {
        func label(_ l: QuoteLine?) -> String { l.map(JobCopy.lineLabel) ?? "a line" }
        switch c.action {
        case "add":
            return "Added: \(label(c.toLine)) — \(c.toLine.map(JobCopy.linePrice) ?? "not priced")"
        case "remove":
            return "Removed: \(label(c.fromLine))"
        case "substitute":
            let field = JobCopy.sentence(c.spec?.field ?? "specification")
            let from = c.spec?.from_label ?? c.spec?.from_key ?? "?"
            let to = c.spec?.to_label ?? c.spec?.to_key ?? "?"
            var s = "Substituted \(field.lowercased()): \(from) → \(to)"
            if let f = c.fromLine, let t = c.toLine, JobCopy.linePrice(f) != JobCopy.linePrice(t) {
                s += " (\(JobCopy.linePrice(f)) → \(JobCopy.linePrice(t)))"
            }
            return s
        default:
            let from = c.fromLine.map(JobCopy.linePrice) ?? "?"
            let to = c.toLine.map(JobCopy.linePrice) ?? "?"
            return from == to ? "Changed: \(label(c.toLine ?? c.fromLine))" : "Changed: \(label(c.toLine ?? c.fromLine)): \(from) → \(to)"
        }
    }

    static let says = ["The work changes as listed, for the reason you give."]
    static let doesNotSay = ["That the customer agrees (they accept it like a quote)", "Any payment", "That the earlier acceptance still covers the job"]
}

// MARK: - Request bodies

enum CosignDrafting {
    struct CosignParams: Encodable, Equatable {
        let p_work_order_id: String
        let p_offer_id: String
        let p_kinds: [String]
        let p_scope: String
        let p_cut: JobJSON?
    }

    enum CutBasis: String, CaseIterable { case none, share_of_labor_line, flat, day_rate }

    static func cosign(action: JobAction, kinds: Set<String>, scope: String, cutBasis: CutBasis, value: String,
                       currency: String, actingFor: [String: JobJSON] = [:]) -> Result<CosignParams, JobSignFailure> {
        guard action.kind == "cosign_provider", let wo = action.args["p_work_order_id"]?.stringValue,
              let offer = action.args["p_offer_id"]?.stringValue else {
            return .failure(JobSignFailure(text: "This offer isn't open for co-signing from your account."))
        }
        let valid = Set(CosignCopy.kinds.map(\.key))
        let picked = kinds.intersection(valid).sorted()
        guard !picked.isEmpty else { return .failure(JobSignFailure(text: "Pick at least one kind.")) }
        let text = scope.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...2000).contains(text.count) else { return .failure(JobSignFailure(text: "Write what you're vouching for.")) }
        var cut: [String: JobJSON] = [:]
        switch cutBasis {
        case .none: break
        case .share_of_labor_line:
            guard let p = Double(value), p > 0, p <= 100 else {
                return .failure(JobSignFailure(text: "The cut is a percentage between 0 and 100."))
            }
            cut = ["basis": .string("share_of_labor_line"), "percentage": .number(p)]
        case .flat, .day_rate:
            guard let a = Double(value.replacingOccurrences(of: ",", with: "")), a >= 0 else {
                return .failure(JobSignFailure(text: "Enter the cut's amount."))
            }
            let cur = currency.trimmingCharacters(in: .whitespaces).uppercased()
            guard cur.count == 3, cur.allSatisfy({ $0.isLetter && $0.isASCII }) else {
                return .failure(JobSignFailure(text: "Use a three-letter currency, like USD."))
            }
            cut = ["basis": .string(cutBasis.rawValue), "amount": .number(a), "currency": .string(cur)]
            if cutBasis == .day_rate { cut["unit"] = .string("day") }
        }
        for (k, v) in actingFor { cut[k] = v }
        return .success(CosignParams(p_work_order_id: wo, p_offer_id: offer, p_kinds: picked, p_scope: text,
                                     p_cut: cut.isEmpty ? nil : .object(cut)))
    }

    struct VouchParams: Encodable, Equatable {
        let p_subject_user_id: String
        let p_kinds: [String]
        let p_scope: String
        let p_expires_at: String?
    }

    static func vouch(subjectUserId: String, kinds: Set<String>, scope: String, expires: Date?,
                      now: Date = Date()) -> Result<VouchParams, JobSignFailure> {
        let picked = kinds.intersection(Set(CosignCopy.kinds.map(\.key))).sorted()
        guard !picked.isEmpty else { return .failure(JobSignFailure(text: "Pick at least one kind.")) }
        let text = scope.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...2000).contains(text.count) else { return .failure(JobSignFailure(text: "Write what you're vouching for.")) }
        if let e = expires, e <= now { return .failure(JobSignFailure(text: "Pick an end date in the future.")) }
        return .success(VouchParams(p_subject_user_id: subjectUserId, p_kinds: picked, p_scope: text,
                                    p_expires_at: expires.map { ISO8601DateFormatter().string(from: $0) }))
    }
}

enum ChangeOrderDrafting {
    enum LineState: String, CaseIterable { case keep, modify, remove }

    struct BaseLine: Equatable, Identifiable {
        let index: Int
        let base: QuoteLine
        var state: LineState = .keep
        var description: String
        var pricingBasis: String
        var amount: String
        var quantity: String
        var id: Int { index }

        init(_ l: QuoteLine) {
            index = l.index
            base = l
            description = l.description ?? JobCopy.lineLabel(l)
            pricingBasis = l.pricingBasis ?? "flat"
            amount = l.amount.map(JobCopy.plainNumber) ?? ""
            quantity = l.quantity.map(JobCopy.plainNumber) ?? ""
        }
    }

    struct Substitution: Equatable, Identifiable {
        var id = UUID()
        var specId: String
        var field: String
        var toKey: String = ""
        var toLabel: String = ""
    }

    struct Params: Encodable, Equatable {
        let p_work_order_id: String
        let p_base_quote_id: String
        let p_changes: [JobJSON]
        let p_reason: String
    }

    private static func lineJSON(refKind: String, refId: String?, description: String, basis: String, amount: String,
                                 quantity: String, currency: String) -> Result<JobJSON, JobSignFailure> {
        let desc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...500).contains(desc.count) else { return .failure(JobSignFailure(text: "Each line needs a description.")) }
        guard let a = Double(amount.replacingOccurrences(of: ",", with: "")), a >= 0 else {
            return .failure(JobSignFailure(text: "Each line needs a price."))
        }
        var o: [String: JobJSON] = ["ref_kind": .string(refKind), "ref_id": refId.map(JobJSON.string) ?? .null,
                                    "description": .string(desc), "pricing_basis": .string(basis), "amount": .number(a),
                                    "currency": .string(currency), "unit": OfferDrafting.unit(basis).map(JobJSON.string) ?? .null,
                                    "quantity": .null]
        if basis != "flat", let q = Double(quantity), q > 0 { o["quantity"] = .number(q) }
        return .success(.object(o))
    }

    static func params(action: JobAction, quote: Quote, lines: [BaseLine], added: [CloseoutDrafting.InvoiceLineDraft],
                       substitutions: [Substitution], reason: String) -> Result<Params, JobSignFailure> {
        guard action.kind == "issue_change_order", let wo = action.args["p_work_order_id"]?.stringValue,
              let base = action.args["p_base_quote_id"]?.stringValue, base == quote.quoteId else {
            return .failure(JobSignFailure(text: "The quote changed since you opened it. Refresh and try again."))
        }
        let why = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...1000).contains(why.count) else { return .failure(JobSignFailure(text: "Say why the work changed.")) }
        let currency = quote.lines.compactMap(\.currency).first ?? "USD"
        var changes: [JobJSON] = []
        for l in lines {
            switch l.state {
            case .keep: continue
            case .remove:
                changes.append(.object(["action": .string("remove"), "line_index": .number(Double(l.index))]))
            case .modify:
                switch lineJSON(refKind: l.base.refKind ?? "fee", refId: l.base.refKind == "fee" ? nil : l.base.refId,
                                description: l.description, basis: l.pricingBasis, amount: l.amount, quantity: l.quantity, currency: currency) {
                case .failure(let f): return .failure(f)
                case .success(let j):
                    changes.append(.object(["action": .string("modify"), "line_index": .number(Double(l.index)), "line": j]))
                }
            }
        }
        for d in added {
            switch lineJSON(refKind: "fee", refId: nil, description: d.description, basis: d.pricingBasis, amount: d.amount,
                            quantity: d.quantity, currency: currency) {
            case .failure(let f): return .failure(f)
            case .success(let j): changes.append(.object(["action": .string("add"), "line": j]))
            }
        }
        for s in substitutions {
            guard let spec = quote.specifications.first(where: { $0.id == s.specId }), s.field == "material" || s.field == "process" else {
                return .failure(JobSignFailure(text: "Pick a material or process to substitute."))
            }
            let fromKey = s.field == "material" ? spec.material_key : spec.process_key
            let toKey = s.toKey.trimmingCharacters(in: .whitespaces).lowercased()
            guard let fromKey, toKey.range(of: #"^[a-z0-9][a-z0-9_.:/-]{0,79}$"#, options: .regularExpression) != nil, toKey != fromKey else {
                return .failure(JobSignFailure(text: "Give the substitute a short key, like mild_steel."))
            }
            var o: [String: JobJSON] = ["action": .string("substitute"), "specification_id": .string(spec.id), "field": .string(s.field),
                                        "from_key": .string(fromKey), "to_key": .string(toKey)]
            let label = s.toLabel.trimmingCharacters(in: .whitespacesAndNewlines)
            if !label.isEmpty { o["to_label"] = .string(String(label.prefix(200))) }
            changes.append(.object(o))
        }
        guard !changes.isEmpty else { return .failure(JobSignFailure(text: "Change at least one thing.")) }
        guard lines.contains(where: { $0.state != .remove }) || !added.isEmpty else {
            return .failure(JobSignFailure(text: "Keep at least one line."))
        }
        return .success(Params(p_work_order_id: wo, p_base_quote_id: base, p_changes: changes, p_reason: why))
    }
}

/// One capacity the server lets you co-sign in (cosign_acting_for): a shop you own or belong to, or yourself.
struct CosignActingFor: Equatable, Identifiable {
    let title: String
    /// Merged into p_cut as given: {organization_id} for a shop, {as: "self"} for yourself.
    let cut: [String: JobJSON]
    var id: String { title + (cut["organization_id"]?.stringValue ?? "") }
}

extension JobAction {
    var actingFor: [CosignActingFor] {
        guard case .array(let list)? = raw["acting_for"] else { return [] }
        return list.compactMap { item in
            guard case .object(let o) = item, case .object(let cut)? = o["p_cut"] else { return nil }
            let title = o["kind"]?.stringValue == "organization" ? (o["name"]?.stringValue ?? "Your shop") : "Yourself"
            return CosignActingFor(title: title, cut: cut)
        }
    }
}

enum CosignWriters {
    static func write<P: Encodable & Sendable>(_ rpc: String, _ params: P) async -> Result<Data, JobSignFailure> {
        do {
            return .success(try await SupabaseService.client.rpc(rpc, params: params).execute().data)
        } catch {
            NSLog("NukeCapture %@ failed: %@", rpc, String(describing: error))
            return .failure(JobSignFailure(text: CosignCopy.failure(error)))
        }
    }
}
