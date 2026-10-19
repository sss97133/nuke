// CloseoutSheets.swift — the Sign sheets for finishing a job.
//
// Every sheet has the same grammar: what you are signing, "Signing says" and "It does not say",
// then one explicit confirm button. The write happens only on that button; the server checks
// eligibility and hashes again.

import SwiftUI

/// The shared Sign-sheet scaffold.
struct SignStepSheet<Details: View>: View {
    let title: String
    let says: [String]
    let doesNotSay: [String]
    var saysTitle = "Signing says"
    let confirmTitle: String
    let successTitle: String
    let successDetail: String
    var confirmEnabled = true
    @ViewBuilder let details: () -> Details
    /// Returns nil on success, or the reason it did not go through.
    let confirm: () async -> String?
    var onDone: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var failure: String?
    @State private var done = false

    var body: some View {
        NavigationStack {
            Form {
                details()
                if !says.isEmpty {
                    Section(saysTitle) {
                        ForEach(says, id: \.self) { Label($0, systemImage: "checkmark.seal") }
                    }
                    .font(.footnote)
                }
                if !doesNotSay.isEmpty {
                    Section("It does not say") {
                        ForEach(doesNotSay, id: \.self) { Label($0, systemImage: "minus.circle").foregroundStyle(.secondary) }
                    }
                    .font(.footnote)
                }
                Section {
                    if done {
                        Label(successTitle, systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                        Text(successDetail).font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Button {
                            Task { await run() }
                        } label: {
                            HStack { Spacer(); if busy { ProgressView() } else { Text(confirmTitle).bold() }; Spacer() }
                        }
                        .disabled(busy || !confirmEnabled)
                    }
                    if let failure { Text(failure).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(done ? "Done" : "Cancel") { dismiss() } }
            }
        }
    }

    private func run() async {
        busy = true
        failure = nil
        defer { busy = false }
        if let reason = await confirm() {
            failure = "Didn't go through. \(reason)"
        } else {
            done = true
            onDone()
        }
    }
}

// MARK: - Completion

struct MarkDoneSheet: View {
    let workOrderId: String
    let state: CompletionState
    var onDone: () -> Void = {}

    @State private var note = ""

    static let says = ["The work is done, as described in the job."]
    static let doesNotSay = ["That the customer agrees", "Any payment", "The job's status changes"]

    var body: some View {
        SignStepSheet(title: "Mark the work done", says: Self.says, doesNotSay: Self.doesNotSay,
                      confirmTitle: "Mark the work done", successTitle: "Marked done",
                      successDetail: "The customer can now confirm it's done.") {
            Section {
                RootedValueView(label: "Done against", value: CloseoutCopy.scopeBasis(state.scopeBasis), status: .attributed)
            }
            Section("Note (optional)") {
                TextField("What you did, anything to check", text: $note, axis: .vertical).lineLimit(2...6)
            }
        } confirm: {
            switch CloseoutDrafting.attest(workOrderId: workOrderId, state: state, note: note) {
            case .failure(let f): return f.text
            case .success(let p): return await CloseoutReaders.write("attest_work_completion", p)
            }
        } onDone: { onDone() }
    }
}

struct ConfirmDoneSheet: View {
    let workOrderId: String
    let state: CompletionState
    var onDone: () -> Void = {}

    static let says = ["You agree the work is done, as the technician marked it."]
    static let doesNotSay = ["Any payment", "That you've checked every detail in person", "The job's status changes"]

    var body: some View {
        SignStepSheet(title: "Confirm the work is done", says: Self.says, doesNotSay: Self.doesNotSay,
                      confirmTitle: "Confirm it's done", successTitle: "You confirmed it's done",
                      successDetail: "No payment was made.", confirmEnabled: state.attestation != nil) {
            Section {
                RootedValueView(label: "Marked done", value: JobCopy.day(state.attestation?.signedAt) ?? "Date not recorded",
                                status: .attributed, decay: state.attestation?.signerRole.map(JobCopy.sentence))
                RootedValueView(label: "Done against", value: CloseoutCopy.scopeBasis(state.scopeBasis), status: .attributed)
            }
        } confirm: {
            guard let p = CloseoutDrafting.accept(workOrderId: workOrderId, state: state) else {
                return "Nothing to confirm yet."
            }
            return await CloseoutReaders.write("accept_work_completion", p)
        } onDone: { onDone() }
    }
}

// MARK: - Invoice

struct IssueInvoiceSheet: View {
    let workOrderId: String
    let acceptedQuote: Quote?
    var onDone: () -> Void = {}

    @State private var lines: [CloseoutDrafting.InvoiceLineDraft]
    @State private var currency: String
    @State private var useDue = false
    @State private var due = Date().addingTimeInterval(86_400 * 14)

    init(workOrderId: String, acceptedQuote: Quote?, onDone: @escaping () -> Void = {}) {
        self.workOrderId = workOrderId
        self.acceptedQuote = acceptedQuote
        self.onDone = onDone
        _lines = State(initialValue: CloseoutDrafting.linesFromQuote(acceptedQuote))
        _currency = State(initialValue: acceptedQuote?.lines.compactMap(\.currency).first ?? "USD")
    }

    static let says = ["These are the charges for this job."]
    static let doesNotSay = ["A payment request is sent", "Any money moves", "The customer agrees to the changes"]

    var body: some View {
        SignStepSheet(title: "Issue invoice", says: Self.says, doesNotSay: Self.doesNotSay,
                      confirmTitle: "Issue invoice", successTitle: "Invoice issued",
                      successDetail: "The customer sees it on the job. \(CloseoutCopy.moneyNote)") {
            Section {
                RootedValueView(label: "Based on", value: acceptedQuote.map { "Accepted quote, version \($0.version)" } ?? "No accepted quote",
                                status: .attributed)
                TextField("Currency", text: $currency).textInputAutocapitalization(.characters).autocorrectionDisabled()
            }
            ForEach($lines) { $line in
                Section {
                    TextField("Description", text: $line.description)
                    Picker("Priced", selection: $line.pricingBasis) {
                        ForEach(OfferDrafting.bases, id: \.key) { b in Text(b.title).tag(b.key) }
                    }
                    TextField("Amount", text: $line.amount).keyboardType(.decimalPad)
                    if line.pricingBasis != "flat" {
                        TextField("How many \(OfferDrafting.unit(line.pricingBasis) ?? "unit")s", text: $line.quantity).keyboardType(.decimalPad)
                    }
                } header: {
                    Text(line.quoteLine != nil ? "From the quote" : "Added")
                }
            }
            Button("Add a line") { lines.append(.init(description: "")) }
            Section {
                Toggle("Set a due date", isOn: $useDue)
                if useDue { DatePicker("Due", selection: $due, displayedComponents: .date) }
            }
        } confirm: {
            switch CloseoutDrafting.invoice(workOrderId: workOrderId, lines: lines, currency: currency,
                                            quoteId: acceptedQuote?.quoteId, due: useDue ? due : nil) {
            case .failure(let f): return f.text
            case .success(let p): return await CloseoutReaders.write("issue_work_order_invoice", p)
            }
        } onDone: { onDone() }
    }
}

struct RecordPaymentSheet: View {
    let action: JobAction
    let invoice: Invoice
    var onDone: () -> Void = {}

    @State private var amount = ""
    @State private var method = "bank_transfer"
    @State private var paidAt = Date()
    @State private var reference = ""

    private var asPayer: Bool { action.asText != "payee" }

    static let payerSays = ["You paid this amount toward the invoice."]
    static let payeeSays = ["You received this amount toward the invoice."]
    static let payerDoesNotSay = ["Nuke moved any money", "The shop has confirmed it yet"]
    static let payeeDoesNotSay = ["Nuke moved any money", "Any payout is released"]

    var body: some View {
        SignStepSheet(title: asPayer ? "I paid" : "I received",
                      says: asPayer ? Self.payerSays : Self.payeeSays,
                      doesNotSay: asPayer ? Self.payerDoesNotSay : Self.payeeDoesNotSay,
                      confirmTitle: "Record payment", successTitle: "Payment recorded",
                      successDetail: CloseoutCopy.moneyNote) {
            Section {
                RootedValueView(label: "Invoice", value: "Version \(invoice.version) · \(invoice.total.map { JobMoney.format($0, invoice.currency) } ?? "Total not stated")",
                                status: .attributed)
                HStack {
                    TextField("Amount", text: $amount).keyboardType(.decimalPad)
                    Text(invoice.currency).foregroundStyle(.secondary)
                }
                Picker("How", selection: $method) {
                    ForEach(CloseoutDrafting.methods, id: \.key) { m in Text(m.title).tag(m.key) }
                }
                DatePicker("Paid on", selection: $paidAt, in: ...Date(), displayedComponents: .date)
                TextField("Reference (optional)", text: $reference)
            }
        } confirm: {
            switch CloseoutDrafting.payment(action: action, invoice: invoice, amount: amount, method: method,
                                            paidAt: paidAt, reference: reference) {
            case .failure(let f): return f.text
            case .success(let p): return await CloseoutReaders.write("record_work_order_payment", p)
            }
        } onDone: { onDone() }
    }
}

// MARK: - Evidence

struct AttachEvidenceSheet: View {
    let workOrderId: String
    let jobTitle: String
    let imageIds: [String]
    let candidates: EvidenceCandidates
    /// Selected photos that aren't uploaded, are outside the job's dates, or aren't attachable.
    var skipped: Int = 0
    var onDone: () -> Void = {}

    @State private var note = ""

    private var eligibleCount: Int {
        let eligible = Set(candidates.items(for: workOrderId).map(\.image_id))
        return Set(imageIds).intersection(eligible).count
    }

    var body: some View {
        SignStepSheet(title: "Attach to job",
                      says: candidates.binds.isEmpty ? ["These are your own photos of this job."] : candidates.binds.map(JobCopy.signBinds),
                      doesNotSay: candidates.doesNotBind.isEmpty ? ["Who can see the photos", "That the work is done", "Any payment"]
                        : candidates.doesNotBind.map(JobCopy.signDoesNotBind),
                      confirmTitle: "Attach \(min(eligibleCount, 50)) photo\(eligibleCount == 1 ? "" : "s")",
                      successTitle: "Attached", successDetail: "They're filed to the job as your evidence.",
                      confirmEnabled: eligibleCount > 0) {
            Section {
                RootedValueView(label: "Job", value: jobTitle, status: .attributed)
                RootedValueView(label: "Photos to attach", value: "\(min(eligibleCount, 50))", status: .attributed,
                                decay: eligibleCount > 50 ? "50 at a time" : nil)
                if skipped > 0 {
                    Text("\(skipped) selected photo\(skipped == 1 ? " isn't" : "s aren't") uploaded, fall outside this job's dates, or can't be attached.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if candidates.notAttachable > 0 {
                    Text("Personal or sensitive photos can't be attached.").font(.footnote).foregroundStyle(.secondary)
                }
                TextField("Note (optional)", text: $note)
            }
        } confirm: {
            switch CloseoutDrafting.evidence(workOrderId: workOrderId, imageIds: imageIds, candidates: candidates, note: note) {
            case .failure(let f): return f.text
            case .success(let p): return await CloseoutReaders.write("attach_job_evidence", p)
            }
        } onDone: { onDone() }
    }
}
