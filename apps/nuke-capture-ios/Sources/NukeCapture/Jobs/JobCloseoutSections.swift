// JobCloseoutSections.swift — completion, invoice and evidence on JobView.
//
// Completion reads the job path's completion stage: who said it's done and whether the customer
// confirmed. "Mark the work done" appears to whoever the invoice reader lets issue an invoice
// (the backend states the same eligibility for both Signs); "Confirm the work is done" appears to
// the customer slot the server returned. The invoice section shows lines and prices to everyone,
// payments, balance and release only to parties. Evidence to file lists your own eligible photos.

import SwiftUI

struct JobCompletionSection: View {
    let workOrderId: String
    let state: CompletionState
    let viewerSlots: [String]
    let canMarkDone: Bool
    var onChanged: (() -> Void)? = nil

    @State private var marking = false
    @State private var confirming = false

    private var isCustomer: Bool { viewerSlots.contains("customer") }

    var body: some View {
        Section {
            let s = CloseoutCopy.completion(state, isCustomer: isCustomer)
            RootedValueView(label: "Status", value: s.text, status: s.status,
                            decay: state.attestation.flatMap { JobCopy.day($0.signedAt).map { "marked done \($0)" } })
            if state.attestation == nil && canMarkDone {
                Button { marking = true } label: { Label("Mark the work done", systemImage: "checkmark.seal") }
            }
            if state.attestation != nil && !state.accepted && isCustomer {
                Button { confirming = true } label: { Label("Confirm the work is done", systemImage: "signature") }
            }
        } header: {
            Text("Completion")
        } footer: {
            Text("Done means the technician signed it and the customer confirmed it. No payment follows from either.")
        }
        .jobSheet(isPresented: $marking) { MarkDoneSheet(workOrderId: workOrderId, state: state) { onChanged?() } }
        .jobSheet(isPresented: $confirming) { ConfirmDoneSheet(workOrderId: workOrderId, state: state) { onChanged?() } }
    }
}

struct JobInvoiceSection: View {
    let read: JobLoad<WorkOrderInvoices>
    var acceptedQuote: Quote? = nil
    var workOrderId: String
    var onChanged: (() -> Void)? = nil

    @State private var issuing = false
    @State private var paying = false

    var body: some View {
        Section {
            switch read {
            case .loading:
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let r):
                content(r)
            }
        } header: {
            Text("Invoice")
        } footer: {
            Text("Prices are open to everyone. \(CloseoutCopy.moneyNote)")
        }
        .jobSheet(isPresented: $issuing) {
            IssueInvoiceSheet(workOrderId: workOrderId, acceptedQuote: acceptedQuote) { onChanged?() }
        }
        .jobSheet(isPresented: $paying) {
            if case .loaded(let r) = read, let a = r.paymentAction, let inv = r.current {
                RecordPaymentSheet(action: a, invoice: inv) { onChanged?() }
            }
        }
    }

    @ViewBuilder private func content(_ r: WorkOrderInvoices) -> some View {
        if let inv = r.current {
            RootedValueView(label: "Issued by", value: inv.issuer?.text ?? "Unnamed party", status: .proven,
                            decay: [JobCopy.day(inv.issuedAt).map { "on \($0)" }, "version \(inv.version)"].compactMap { $0 }.joined(separator: " · "))
            if let due = JobCopy.day(inv.dueAt) { RootedValueView(label: "Due", value: due, status: .attributed) }
            ForEach(inv.lines) { l in
                RootedValueView(label: l.description ?? "Line", value: CloseoutCopy.linePrice(l, currency: inv.currency),
                                status: l.change == "unchanged" || l.change == nil ? .attributed : .pending,
                                decay: CloseoutCopy.change(l.change))
            }
            if let t = inv.total { RootedValueView(label: "Total", value: JobMoney.format(t, inv.currency), status: .attributed) }
            VStack(alignment: .leading, spacing: 3) {
                Text("Differences from the quote").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(CloseoutCopy.differences(inv.changes, total: inv.total, currency: inv.currency), id: \.self) { d in
                    Text(d).font(.footnote)
                }
            }
            .padding(.vertical, 2)
            partyBlock(r, inv)
        } else {
            Text("No invoice yet.").font(.footnote).foregroundStyle(.secondary)
        }
        if r.issueAction != nil {
            Button { issuing = true } label: { Label(r.current == nil ? "Issue invoice" : "Issue a new version", systemImage: "doc.text") }
        }
    }

    @ViewBuilder private func partyBlock(_ r: WorkOrderInvoices, _ inv: Invoice) -> some View {
        if let payments = r.payments {
            RootedValueView(label: "Payments", value: CloseoutCopy.reconciliation(r.reconciliation, currency: inv.currency),
                            status: r.reconciliation?.state == "paid" ? .proven : .pending)
            if let due = r.reconciliation?.balanceDue, due > 0 {
                RootedValueView(label: "Balance", value: JobMoney.format(due, inv.currency), status: .attributed)
            }
            ForEach(payments) { p in
                RootedValueView(label: CloseoutCopy.witness(p.side), value: p.amount.map { JobMoney.format($0, p.currency ?? inv.currency) } ?? "Not stated",
                                status: p.side == "payee" ? .proven : .attributed,
                                decay: [JobCopy.day(p.paidAt), CloseoutCopy.method(p.method)].compactMap { $0 }.joined(separator: " · "))
            }
            if let rel = r.release {
                RootedValueView(label: "Payment release", value: rel.met ? "Conditions met" : "Not yet", status: rel.met ? .attributed : .pending,
                                decay: "Nuke doesn't release money; this shows whether the terms are met")
                ForEach(rel.conditions) { c in
                    Label(CloseoutCopy.releaseCondition(c.key), systemImage: c.met ? "checkmark.circle.fill" : "circle")
                        .font(.footnote).foregroundStyle(c.met ? .primary : .secondary)
                }
            }
            if let a = r.paymentAction {
                Button { paying = true } label: {
                    Label(a.asText == "payee" ? "I received a payment" : "I paid", systemImage: "banknote")
                }
            }
        } else {
            RootedValueView(label: "Payments", value: JobCopy.withheldPayments, status: .recorded)
        }
    }
}

struct JobEvidencePrompt: View {
    let workOrderId: String
    let jobTitle: String
    let read: JobLoad<EvidenceCandidates>
    var onChanged: (() -> Void)? = nil

    @State private var attaching = false

    var body: some View {
        if case .loaded(let c) = read, !c.items(for: workOrderId).isEmpty {
            let n = c.items(for: workOrderId).count
            Section {
                Text("\(n) of your photos from this job's dates aren't filed to it yet.").font(.footnote)
                Button { attaching = true } label: { Label("File them to this job", systemImage: "tray.and.arrow.down") }
            } header: {
                Text("Evidence to file")
            } footer: {
                if c.notAttachable > 0 { Text("Personal or sensitive photos are never offered here.") }
            }
            .jobSheet(isPresented: $attaching) {
                AttachEvidenceSheet(workOrderId: workOrderId, jobTitle: jobTitle,
                                    imageIds: c.items(for: workOrderId).map(\.image_id), candidates: c) { onChanged?() }
            }
        }
    }
}
