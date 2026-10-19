// AcceptQuoteSheet.swift — the customer's Sign on one quote version.
//
// Shown only when work_order_quotes_read offers accept_quote in viewer.actions. It lists exactly
// what is being accepted (version, lines and prices, totals, the deposit term, validity), says
// what accepting does and does not do, and calls accept_work_order_quote with the quote id and
// hash the server offered, only on the confirm button. Accepting moves no money.

import SwiftUI

struct AcceptQuoteSheet: View {
    let quote: Quote
    let action: JobAction
    var onAccepted: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var failure: String?
    @State private var receipt: QuoteAcceptanceReceipt?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    RootedValueView(label: "Version", value: quote.versionLine, status: .attributed)
                    if let party = quote.quotingParty {
                        RootedValueView(label: "Quoted by", value: party.text,
                                        status: party.signedThroughNuke ? .proven : .attributed)
                    }
                    if let until = JobCopy.day(quote.validUntil) {
                        RootedValueView(label: "Valid until", value: until, status: .attributed)
                    }
                } header: {
                    Text("You are accepting")
                }

                Section("Lines") {
                    ForEach(quote.lines) { line in
                        RootedValueView(label: JobCopy.lineLabel(line), value: JobCopy.linePrice(line),
                                        status: line.amount == nil ? .recorded : .attributed)
                    }
                    ForEach(Array(quote.totals.enumerated()), id: \.offset) { _, t in
                        let total = JobCopy.total(t)
                        RootedValueView(label: "Total", value: total.value, status: .attributed, decay: total.note)
                    }
                    if let deposit = quote.depositRequested {
                        RootedValueView(label: "Deposit requested", value: JobMoney.format(deposit.amount, deposit.currency),
                                        status: .attributed, decay: "a term of the quote")
                    }
                }

                Section("Accepting says") {
                    Label("You accept version \(quote.version) of this quote, exactly as listed.", systemImage: "checkmark.seal")
                    if quote.depositRequested != nil {
                        Label("You agree to the deposit it requests, as a term.", systemImage: "checkmark.seal")
                    }
                }
                .font(.footnote)

                Section("It does not say") {
                    ForEach(Self.notSaid, id: \.self) { s in
                        Label(s, systemImage: "minus.circle").foregroundStyle(.secondary)
                    }
                }
                .font(.footnote)

                Section {
                    if let receipt {
                        Label(receipt.duplicate ? "You already accepted this version." : "Quote accepted",
                              systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.green)
                        Text("No payment was made and no deposit was collected.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Button {
                            Task { await accept() }
                        } label: {
                            HStack {
                                Spacer()
                                if busy { ProgressView() } else { Text("Accept quote").bold() }
                                Spacer()
                            }
                        }
                        .disabled(busy)
                    }
                    if let failure {
                        Text(failure).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Accept quote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(receipt == nil ? "Cancel" : "Done") { dismiss() }
                }
            }
        }
    }

    static let notSaid = ["No payment is made", "No deposit is collected", "The work is not marked as started"]

    private func accept() async {
        busy = true
        failure = nil
        defer { busy = false }
        switch await JobReaders.acceptQuote(action, quote: quote) {
        case .success(let r):
            receipt = r
            onAccepted()
        case .failure(let f):
            failure = "Couldn't accept. \(f.text)"
        }
    }
}
