// JobCloseout.swift — the back half of a job: completion, invoice, payments and evidence.
//
// Completion is two Signs: the provider attests the work is done against the current scope
// (attest_work_completion, with the scope hash the job path reports) and the customer accepts
// that exact attestation (accept_work_completion, hash-pinned). work_order_invoices_read shows
// invoice lines and prices to everyone, and payments, balances and the payment-release
// evaluation only to the parties; issue_work_order_invoice and record_work_order_payment are
// Signs that record, never move, money. attach_job_evidence files your own photos to a job;
// job_evidence_candidates_read lists the eligible ones (personal or sensitive photos excluded).

import Foundation
import Supabase

// MARK: - Completion (from the job path's completion stage)

struct CompletionState: Equatable {
    struct Attestation: Equatable {
        let completionId: String
        let completionHash: String
        let signedAt: String?
        let signerRole: String?
    }

    let attestation: Attestation?
    let scopeHash: String?
    let scopeBasis: String?
    let customerAcceptance: String
    let acceptedAt: String?
    let attestationsWithheld: Int

    init(stage: JobStage) {
        func fact(_ k: String) -> JobJSON? { stage.facts.first { $0.key == k }?.value }
        if case .object(let a)? = fact("provider_attestation"),
           let id = a["completion_id"]?.stringValue, let hash = a["completion_hash"]?.stringValue {
            attestation = Attestation(completionId: id, completionHash: hash, signedAt: a["signed_at"]?.stringValue,
                                      signerRole: a["signer_role"]?.stringValue)
        } else {
            attestation = nil
        }
        if case .object(let s)? = fact("scope_basis") {
            scopeHash = s["scope_hash"]?.stringValue
            scopeBasis = s["basis"]?.stringValue
        } else {
            scopeHash = nil
            scopeBasis = nil
        }
        customerAcceptance = fact("customer_acceptance")?.stringValue ?? "not_established"
        if case .object(let c)? = fact("customer_acceptance_sign") { acceptedAt = c["signed_at"]?.stringValue } else { acceptedAt = nil }
        attestationsWithheld = fact("attestations_withheld")?.intValue ?? 0
    }

    init?(path: JobPath) {
        guard let stage = path.stages[.completion] else { return nil }
        self.init(stage: stage)
    }

    var accepted: Bool { customerAcceptance == "established" }
}

// MARK: - Invoices

struct InvoiceLine: Decodable, Equatable, Identifiable {
    let line: Int
    let quoteLine: Int?
    let description: String?
    let pricingBasis: String?
    let amount: Double?
    let currency: String?
    let unit: String?
    let quantity: Double?
    let lineTotal: Double?
    let change: String?
    let changedFields: [String]
    var id: Int { line }

    enum CodingKeys: String, CodingKey {
        case line, description, amount, currency, unit, quantity, change
        case quoteLine = "quote_line"
        case pricingBasis = "pricing_basis"
        case lineTotal = "line_total"
        case changedFields = "changed_fields"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func num(_ k: CodingKeys) -> Double? {
            if let d = try? c.decode(Double.self, forKey: k), d.isFinite { return d }
            if let s = try? c.decode(String.self, forKey: k), let d = Double(s), d.isFinite { return d }
            return nil
        }
        line = (try? c.decode(Int.self, forKey: .line)) ?? 0
        quoteLine = try? c.decode(Int.self, forKey: .quoteLine)
        description = try? c.decode(String.self, forKey: .description)
        pricingBasis = try? c.decode(String.self, forKey: .pricingBasis)
        amount = num(.amount)
        currency = try? c.decode(String.self, forKey: .currency)
        unit = try? c.decode(String.self, forKey: .unit)
        quantity = num(.quantity)
        lineTotal = num(.lineTotal)
        change = try? c.decode(String.self, forKey: .change)
        changedFields = (try? c.decode([String].self, forKey: .changedFields)) ?? []
    }
}

struct InvoiceChanges: Decodable, Equatable {
    let basis: String?
    let unchanged: Int?
    let changed: Int?
    let added: Int?
    let omitted: Int
    let quoteTotal: Double?
    let quoteTotalComplete: Bool
    let delta: Double?

    enum CodingKeys: String, CodingKey {
        case basis, unchanged, changed, added
        case omitted = "omitted_quote_lines"
        case quoteTotal = "quote_total"
        case quoteTotalComplete = "quote_total_complete"
        case delta = "delta_from_quote"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        basis = try? c.decode(String.self, forKey: .basis)
        unchanged = try? c.decode(Int.self, forKey: .unchanged)
        changed = try? c.decode(Int.self, forKey: .changed)
        added = try? c.decode(Int.self, forKey: .added)
        omitted = (try? c.decode([JobJSON].self, forKey: .omitted))?.count ?? 0
        quoteTotal = try? c.decode(Double.self, forKey: .quoteTotal)
        quoteTotalComplete = (try? c.decode(Bool.self, forKey: .quoteTotalComplete)) == true
        delta = try? c.decode(Double.self, forKey: .delta)
    }
}

struct Invoice: Decodable, Equatable, Identifiable {
    let invoiceId: String
    let version: Int
    let current: Bool
    let status: String?
    let issuedAt: String?
    let dueAt: String?
    let issuer: JobPerson?
    let quoteVersion: Int?
    let currency: String
    let lines: [InvoiceLine]
    let total: Double?
    let changes: InvoiceChanges?
    var id: String { invoiceId }

    enum CodingKeys: String, CodingKey {
        case version, current, status, issuer, quote, currency, lines, total
        case invoiceId = "invoice_id"
        case issuedAt = "issued_at"
        case dueAt = "due_at"
        case changes = "changes_from_quote"
    }
    private struct QuoteRef: Decodable { let quote_version: Int? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        invoiceId = try c.decode(String.self, forKey: .invoiceId)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        current = (try? c.decode(Bool.self, forKey: .current)) == true
        status = try? c.decode(String.self, forKey: .status)
        issuedAt = try? c.decode(String.self, forKey: .issuedAt)
        dueAt = try? c.decode(String.self, forKey: .dueAt)
        issuer = try? c.decode(JobPerson.self, forKey: .issuer)
        quoteVersion = (try? c.decode(QuoteRef.self, forKey: .quote))?.quote_version
        currency = (try? c.decode(String.self, forKey: .currency)) ?? "USD"
        lines = (try? c.decode([InvoiceLine].self, forKey: .lines)) ?? []
        total = try? c.decode(Double.self, forKey: .total)
        changes = try? c.decode(InvoiceChanges.self, forKey: .changes)
    }
}

struct PaymentWitness: Decodable, Equatable, Identifiable {
    let id: String
    let side: String?
    let amount: Double?
    let currency: String?
    let method: String?
    let paidAt: String?
    let reference: String?
    let witness: JobPerson?

    enum CodingKeys: String, CodingKey {
        case amount, currency, method, reference, witness
        case id = "payment_witness_id"
        case side = "witness_side"
        case paidAt = "paid_at"
    }
}

struct Reconciliation: Decodable, Equatable {
    let state: String?
    let currency: String?
    let invoiceTotal: Double?
    let confirmedReceived: Double?
    let payerReported: Double?
    let balanceDue: Double?
    let overpaidBy: Double?

    enum CodingKeys: String, CodingKey {
        case state, currency
        case invoiceTotal = "invoice_total"
        case confirmedReceived = "confirmed_received"
        case payerReported = "payer_reported"
        case balanceDue = "balance_due"
        case overpaidBy = "overpaid_by"
    }
}

struct ReleaseEvaluation: Decodable, Equatable {
    struct Condition: Decodable, Equatable, Identifiable {
        let key: String
        let met: Bool
        var id: String { key }
    }
    let met: Bool
    let conditions: [Condition]

    enum CodingKeys: String, CodingKey { case met, conditions }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        met = (try? c.decode(Bool.self, forKey: .met)) == true
        conditions = (try? c.decode([Condition].self, forKey: .conditions)) ?? []
    }
}

struct WorkOrderInvoices: Decodable, Equatable {
    let invoices: [Invoice]
    let currentInvoiceId: String?
    /// nil when the reader withheld payments from this viewer (not a party).
    let payments: [PaymentWitness]?
    let reconciliation: Reconciliation?
    let release: ReleaseEvaluation?
    let viewer: JobViewer?

    enum CodingKeys: String, CodingKey {
        case invoices, payments, reconciliation, release, viewer
        case currentInvoiceId = "current_invoice_id"
    }
    private struct Slot: Decodable {
        let invoice: Invoice?
        init(from decoder: Decoder) throws { invoice = try? Invoice(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        invoices = ((try? c.decode([Slot].self, forKey: .invoices)) ?? []).compactMap(\.invoice)
        currentInvoiceId = try? c.decode(String.self, forKey: .currentInvoiceId)
        payments = try? c.decode([PaymentWitness].self, forKey: .payments)
        reconciliation = try? c.decode(Reconciliation.self, forKey: .reconciliation)
        release = try? c.decode(ReleaseEvaluation.self, forKey: .release)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
    }

    var current: Invoice? { invoices.first { $0.invoiceId == currentInvoiceId } ?? invoices.first { $0.current } }
    var issueAction: JobAction? { viewer?.actions.first { $0.kind == "issue_invoice" } }
    var paymentAction: JobAction? { viewer?.actions.first { $0.kind == "record_payment" } }
    var isParty: Bool { payments != nil }
}

// MARK: - Evidence candidates

struct EvidenceCandidates: Decodable, Equatable {
    struct Job: Decodable, Equatable, Identifiable {
        let work_order_id: String
        let role: String?
        let display_title: String?
        let vehicle_label: JobVehicleLabel?
        var id: String { work_order_id }
        var headline: String { display_title ?? vehicle_label?.text ?? "Untitled job" }
    }
    struct Item: Decodable, Equatable, Identifiable {
        let image_id: String
        let work_order_id: String
        let captured_at: String?
        var id: String { image_id + work_order_id }
    }

    let workOrders: [Job]
    let items: [Item]
    let notAttachable: Int
    let binds: [String]
    let doesNotBind: [String]

    enum CodingKeys: String, CodingKey {
        case items, coverage, sign
        case workOrders = "work_orders"
    }
    private struct Coverage: Decodable { let not_attachable_excluded: Int? }
    private struct Sign: Decodable { let binds: [String]?; let does_not_bind: [String]? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrders = (try? c.decode([Job].self, forKey: .workOrders)) ?? []
        items = (try? c.decode([Item].self, forKey: .items)) ?? []
        notAttachable = (try? c.decode(Coverage.self, forKey: .coverage))?.not_attachable_excluded ?? 0
        let s = try? c.decode(Sign.self, forKey: .sign)
        binds = s?.binds ?? []
        doesNotBind = s?.does_not_bind ?? []
    }

    func items(for workOrderId: String) -> [Item] { items.filter { $0.work_order_id == workOrderId } }
}

// MARK: - Request bodies (validated locally; the server checks again)

enum CloseoutDrafting {
    struct AttestParams: Encodable, Equatable { let p_work_order_id: String; let p_scope_hash: String; let p_note: String? }
    struct AcceptParams: Encodable, Equatable { let p_work_order_id: String; let p_completion_id: String; let p_completion_hash: String }

    static func attest(workOrderId: String, state: CompletionState, note: String) -> Result<AttestParams, JobSignFailure> {
        guard let hash = state.scopeHash, !hash.isEmpty else {
            return .failure(JobSignFailure(text: "This job's scope isn't readable yet. Refresh and try again."))
        }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= 2000 else { return .failure(JobSignFailure(text: "Keep the note under 2,000 characters.")) }
        return .success(AttestParams(p_work_order_id: workOrderId, p_scope_hash: hash, p_note: trimmed.isEmpty ? nil : trimmed))
    }

    static func accept(workOrderId: String, state: CompletionState) -> AcceptParams? {
        guard let a = state.attestation else { return nil }
        return AcceptParams(p_work_order_id: workOrderId, p_completion_id: a.completionId, p_completion_hash: a.completionHash)
    }

    struct InvoiceLineDraft: Equatable, Identifiable {
        var id = UUID()
        var quoteLine: Int?
        var description: String
        var pricingBasis: String = "flat"
        var amount: String = ""
        var quantity: String = ""
    }

    struct InvoiceParams: Encodable, Equatable {
        struct Line: Encodable, Equatable {
            let quote_line: Int?
            let description: String
            let pricing_basis: String
            let amount: Double
            let currency: String
            let unit: String?
            let quantity: Double?
        }
        let p_work_order_id: String
        let p_lines: [Line]
        let p_quote_id: String?
        let p_due_at: String?
    }

    /// Lines from the accepted quote, one per quote line, so the invoice starts as quoted.
    static func linesFromQuote(_ quote: Quote?) -> [InvoiceLineDraft] {
        guard let quote else { return [InvoiceLineDraft(description: "")] }
        return quote.lines.map { l in
            InvoiceLineDraft(quoteLine: l.index, description: l.description ?? JobCopy.lineLabel(l),
                             pricingBasis: l.pricingBasis ?? "flat", amount: l.amount.map { JobCopy.plainNumber($0) } ?? "",
                             quantity: l.quantity.map { JobCopy.plainNumber($0) } ?? "")
        }
    }

    static func invoice(workOrderId: String, lines: [InvoiceLineDraft], currency: String, quoteId: String?,
                        due: Date?) -> Result<InvoiceParams, JobSignFailure> {
        let cur = currency.trimmingCharacters(in: .whitespaces).uppercased()
        guard cur.count == 3, cur.allSatisfy({ $0.isLetter && $0.isASCII }) else {
            return .failure(JobSignFailure(text: "Use a three-letter currency, like USD."))
        }
        var out: [InvoiceParams.Line] = []
        for d in lines {
            let desc = d.description.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !desc.isEmpty else { return .failure(JobSignFailure(text: "Each line needs a description.")) }
            guard let amount = Double(d.amount.replacingOccurrences(of: ",", with: "")), amount.isFinite, amount >= 0 else {
                return .failure(JobSignFailure(text: "Each line needs an amount."))
            }
            var qty: Double? = nil
            if d.pricingBasis != "flat" {
                guard let q = Double(d.quantity), q.isFinite, q > 0 else {
                    return .failure(JobSignFailure(text: "Lines priced by the hour, day or operation need a quantity."))
                }
                qty = q
            }
            out.append(.init(quote_line: d.quoteLine, description: desc, pricing_basis: d.pricingBasis, amount: amount, currency: cur,
                             unit: OfferDrafting.unit(d.pricingBasis), quantity: qty))
        }
        guard (1...200).contains(out.count) else { return .failure(JobSignFailure(text: "Add at least one line.")) }
        let usedQuoteLines = out.compactMap(\.quote_line)
        guard Set(usedQuoteLines).count == usedQuoteLines.count else {
            return .failure(JobSignFailure(text: "Each quote line can be invoiced once."))
        }
        let iso = ISO8601DateFormatter()
        return .success(InvoiceParams(p_work_order_id: workOrderId, p_lines: out, p_quote_id: quoteId,
                                      p_due_at: due.map { iso.string(from: $0) }))
    }

    static let methods: [(key: String, title: String)] = [
        ("bank_transfer", "Bank transfer"), ("cash", "Cash"), ("check", "Check"), ("card", "Card"), ("ach", "ACH"),
        ("wire", "Wire"), ("zelle", "Zelle"), ("venmo", "Venmo"), ("paypal", "PayPal"), ("other", "Other"),
    ]

    struct PaymentParams: Encodable, Equatable {
        let p_invoice_id: String
        let p_amount: Double
        let p_currency: String
        let p_method: String
        let p_paid_at: String
        let p_reference: String?
    }

    static func payment(action: JobAction, invoice: Invoice, amount: String, method: String, paidAt: Date, reference: String,
                        now: Date = Date()) -> Result<PaymentParams, JobSignFailure> {
        guard action.kind == "record_payment", let id = action.args["p_invoice_id"]?.stringValue, id == invoice.invoiceId else {
            return .failure(JobSignFailure(text: "This invoice changed. Refresh and try again."))
        }
        guard let value = Double(amount.replacingOccurrences(of: ",", with: "")), value > 0, value < 1_000_000_000 else {
            return .failure(JobSignFailure(text: "Enter the amount."))
        }
        guard methods.contains(where: { $0.key == method }) else { return .failure(JobSignFailure(text: "Pick how it was paid.")) }
        guard paidAt <= now else { return .failure(JobSignFailure(text: "The payment date can't be in the future.")) }
        let ref = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ref.count <= 200 else { return .failure(JobSignFailure(text: "Keep the reference under 200 characters.")) }
        return .success(PaymentParams(p_invoice_id: id, p_amount: value, p_currency: invoice.currency, p_method: method,
                                      p_paid_at: ISO8601DateFormatter().string(from: paidAt), p_reference: ref.isEmpty ? nil : ref))
    }

    struct EvidenceParams: Encodable, Equatable {
        let p_work_order_id: String
        let p_image_ids: [String]
        let p_note: String?
    }

    /// Only images the reader lists as eligible for this job; at most 50 per attachment.
    static func evidence(workOrderId: String, imageIds: [String], candidates: EvidenceCandidates,
                         note: String = "") -> Result<EvidenceParams, JobSignFailure> {
        let eligible = Set(candidates.items(for: workOrderId).map(\.image_id))
        var seen = Set<String>()
        let ids = imageIds.filter { eligible.contains($0) && seen.insert($0).inserted }
        guard !ids.isEmpty else { return .failure(JobSignFailure(text: "None of these photos can be filed to this job.")) }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return .success(EvidenceParams(p_work_order_id: workOrderId, p_image_ids: Array(ids.prefix(50)),
                                       p_note: trimmed.isEmpty ? nil : String(trimmed.prefix(1000))))
    }
}

// MARK: - Words

enum CloseoutCopy {
    static let moneyNote = "Nuke records payments; it doesn't move money."

    static func completion(_ s: CompletionState, isCustomer: Bool) -> (text: String, status: RootStatus) {
        if s.attestation != nil {
            if s.accepted { return (isCustomer ? "You confirmed it's done" : "Customer confirmed it's done", .proven) }
            if s.customerAcceptance == "withheld" { return ("On hold: the work changed since it was marked done", .conflicting) }
            return (isCustomer ? "Technician says it's done — waiting for you" : "Technician says it's done — waiting for the customer", .pending)
        }
        if s.attestationsWithheld > 0 { return ("On hold: the work changed since it was marked done", .conflicting) }
        return ("Not marked done yet", .recorded)
    }

    static func scopeBasis(_ b: String?) -> String {
        b == "accepted_quote" ? "the accepted quote" : "the job as currently described"
    }

    static func linePrice(_ l: InvoiceLine, currency: String) -> String {
        let cur = l.currency ?? currency
        guard let amount = l.amount else { return "Not priced" }
        let money = JobMoney.format(amount, cur)
        guard l.pricingBasis != "flat", let q = l.quantity else { return money }
        let per = OfferDrafting.unit(l.pricingBasis ?? "") ?? l.unit ?? "unit"
        let total = l.lineTotal.map { " = " + JobMoney.format($0, cur) } ?? ""
        return "\(money) / \(per) × \(JobCopy.plainNumber(q))\(total)"
    }

    static func change(_ c: String?) -> String? {
        switch c {
        case "changed"?: return "changed from the quote"
        case "added"?: return "not in the quote"
        default: return nil
        }
    }

    /// "1 line changed · 1 line added · Quote $440.00 → invoice $500.00 (+$60.00)".
    static func differences(_ ch: InvoiceChanges?, total: Double?, currency: String) -> [String] {
        guard let ch else { return [] }
        if ch.basis == "no_accepted_quote" { return ["No accepted quote to compare with"] }
        var out: [String] = []
        func lines(_ n: Int?, _ what: String) {
            guard let n, n > 0 else { return }
            out.append(n == 1 ? "1 line \(what)" : "\(n) lines \(what)")
        }
        lines(ch.changed, "changed")
        lines(ch.added, "added")
        if ch.omitted > 0 { out.append(ch.omitted == 1 ? "1 quoted line left out" : "\(ch.omitted) quoted lines left out") }
        if let q = ch.quoteTotal, let t = total {
            var s = "Quote \(JobMoney.format(q, currency)) → invoice \(JobMoney.format(t, currency))"
            if let d = ch.delta, d != 0 { s += " (\(d > 0 ? "+" : "−")\(JobMoney.format(abs(d), currency)))" }
            if !ch.quoteTotalComplete { s += ", quote total incomplete" }
            out.append(s)
        }
        if out.isEmpty { out.append("Same as the quote") }
        return out
    }

    static func reconciliation(_ r: Reconciliation?, currency: String) -> String {
        let cur = r?.currency ?? currency
        switch r?.state {
        case "paid"?: return "Paid in full, confirmed by the shop"
        case "partially_paid"?:
            return "Partly paid" + (r?.balanceDue.map { " — \(JobMoney.format($0, cur)) still due" } ?? "")
        case "payer_reported_unconfirmed"?: return "The customer reported paying — not yet confirmed by the shop"
        case "unpaid"?: return "Not paid yet"
        default: return "Not reported"
        }
    }

    static func releaseCondition(_ key: String) -> String {
        switch key {
        case "quote_accepted_by_customer": return "Customer accepted the quote"
        case "completion_attested_by_provider": return "Technician marked the work done"
        case "completion_accepted_by_customer": return "Customer confirmed it's done"
        case "invoice_current": return "A current invoice is issued"
        case "invoice_settled_by_payee_witness": return "The shop confirmed the payment"
        default: return JobCopy.sentence(key)
        }
    }

    static func method(_ m: String?) -> String {
        CloseoutDrafting.methods.first { $0.key == m }?.title ?? (m.map(JobCopy.sentence) ?? "Not stated")
    }

    static func witness(_ side: String?) -> String {
        side == "payee" ? "Received (confirmed by the shop)" : "Paid (reported by the customer)"
    }

    static func failure(_ error: Error) -> String {
        guard let pg = error as? PostgrestError else { return ReadFailure.text(error) }
        let m = pg.message
        if m.contains("Scope hash does not match") { return "The job changed since you opened it. Refresh and try again." }
        if m.contains("Completion hash does not match") { return "This changed since you opened it. Refresh and review it again." }
        if m.contains("Completion is withheld") { return "The work changed since it was marked done. Ask the technician to mark it done again." }
        if m.contains("unavailable for completion") || m.contains("unavailable for invoicing") {
            return "Only the job's technician or shop can do this."
        }
        if m.contains("Completion unavailable") { return "Only the customer on this job can confirm it's done." }
        if m.contains("Invoice must reference") { return "The accepted quote changed. Refresh and try again." }
        if m.contains("names a quote line") || m.contains("invoiced twice") || m.contains("Invalid invoice line") {
            return "Check the lines: each needs a description, an amount and, for rates, a quantity."
        }
        if m.contains("one currency") { return "An invoice uses one currency." }
        if m.contains("Invoice unavailable") { return "Only the customer or the job's shop can record payments on this invoice." }
        if m.contains("currency must match") { return "Use the invoice's currency." }
        if m.contains("Only the current invoice") { return "A newer invoice replaced this one. Refresh and try again." }
        if m.contains("Paid time") { return "The payment date can't be in the future." }
        if m.contains("Personal, sensitive") { return "Personal or sensitive photos can't be attached." }
        if m.contains("Only your own images") { return "Only your own photos of this vehicle can be attached." }
        if m.contains("already attached") { return "Some of these photos are already filed to this job." }
        if m.contains("unavailable for evidence") { return "You can't file photos to this job." }
        if m.contains("Authentication required") { return "Sign in first." }
        return ReadFailure.text(error)
    }
}

// MARK: - Readers and writers (writers only from explicit confirm buttons)

enum CloseoutReaders {
    static func invoices(workOrderId: String) async -> JobLoad<WorkOrderInvoices> {
        await JobReaders.call("work_order_invoices_read") {
            try await SupabaseService.client.rpc("work_order_invoices_read", params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    static func evidenceCandidates(workOrderId: String?) async -> JobLoad<EvidenceCandidates> {
        struct P: Encodable { let p_work_order_id: String?; let p_limit: Int }
        return await JobReaders.call("job_evidence_candidates_read") {
            try await SupabaseService.client.rpc("job_evidence_candidates_read", params: P(p_work_order_id: workOrderId, p_limit: 200))
                .execute().data
        }
    }

    /// Your own uploaded rows for on-device photos, matched by the asset id stored at upload.
    static func uploadedImageIds(localIdentifiers: [String]) async -> [String: String] {
        guard let uid = SupabaseService.currentUserId, !localIdentifiers.isEmpty else { return [:] }
        struct Row: Decodable { let id: String; let exif_data: Exif?; struct Exif: Decodable { let uuid: String? } }
        var out: [String: String] = [:]
        for chunk in stride(from: 0, to: localIdentifiers.count, by: 100).map({ Array(localIdentifiers[$0..<min($0 + 100, localIdentifiers.count)]) }) {
            let rows: [Row] = (try? await SupabaseService.client.from("vehicle_images")
                .select("id,exif_data")
                .eq("user_id", value: uid)
                .in("exif_data->>uuid", values: chunk)
                .execute().value) ?? []
            for r in rows { if let lid = r.exif_data?.uuid { out[lid] = r.id } }
        }
        return out
    }

    static func write<P: Encodable & Sendable>(_ rpc: String, _ params: P) async -> String? {
        do {
            try await SupabaseService.client.rpc(rpc, params: params).execute()
            return nil
        } catch {
            NSLog("NukeCapture %@ failed: %@", rpc, String(describing: error))
            return CloseoutCopy.failure(error)
        }
    }
}
