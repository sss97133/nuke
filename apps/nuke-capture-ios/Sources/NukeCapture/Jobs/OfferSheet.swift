// OfferSheet.swift — a provider's Sign on one request: an offer with open price terms.
//
// Shown only from the server's `offer` action. Each line names how it is priced (flat, hourly,
// day rate, per operation) with an amount and currency; an optional availability window and a
// one-line note. The sheet shows the rung the offer will carry, says what offering does and
// does not do, and calls offer_on_requirement only on the confirm button.

import SwiftUI

struct OfferSheet: View {
    let action: JobAction
    let requirementTitle: String

    var onSent: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var lines: [OfferLineDraft]
    @State private var useWindow = false
    @State private var from = Date().addingTimeInterval(86_400)
    @State private var until = Date().addingTimeInterval(86_400 * 8)
    @State private var note = ""
    @State private var busy = false
    @State private var failure: String?
    @State private var sent: OfferReceipt?

    init(action: JobAction, requirementTitle: String, lines: [OfferLineDraft]? = nil, onSent: @escaping () -> Void = {}) {
        self.action = action
        self.requirementTitle = requirementTitle
        self.onSent = onSent
        _lines = State(initialValue: lines ?? [OfferLineDraft(description: requirementTitle)])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    RootedValueView(label: "Request", value: requirementTitle, status: .attributed)
                    RootedValueView(label: "Your offer shows as", value: OfferCopy.yourRung(action.asFields["offer_rung"]?.stringValue),
                                    status: .recorded)
                }

                ForEach($lines) { $line in
                    Section {
                        TextField("What you'll do", text: $line.description)
                        Picker("Priced", selection: $line.pricingBasis) {
                            ForEach(OfferDrafting.bases, id: \.key) { b in Text(b.title).tag(b.key) }
                        }
                        HStack {
                            TextField("Amount", text: $line.amount).keyboardType(.decimalPad)
                            TextField("USD", text: $line.currency)
                                .textInputAutocapitalization(.characters).autocorrectionDisabled().frame(width: 60)
                        }
                        if line.pricingBasis != "flat" {
                            TextField("How many \(OfferDrafting.unit(line.pricingBasis) ?? "units")s (optional)", text: $line.quantity)
                                .keyboardType(.decimalPad)
                        }
                    } header: {
                        Text(lines.count > 1 ? "Line \((lines.firstIndex { $0.id == line.id } ?? 0) + 1)" : "Price")
                    }
                }
                if lines.count < 5 {
                    Button("Add a line") { lines.append(OfferLineDraft(description: "")) }
                }

                Section {
                    Toggle("Set when you're available", isOn: $useWindow)
                    if useWindow {
                        DatePicker("From", selection: $from, displayedComponents: .date)
                        DatePicker("Until", selection: $until, displayedComponents: .date)
                    }
                    TextField("Note (one line, optional)", text: $note)
                } header: {
                    Text("Availability and note")
                }

                Section("Offering says") {
                    Label("You'll do this work at these prices, through Nuke.", systemImage: "checkmark.seal")
                }
                .font(.footnote)
                Section("It does not say") {
                    ForEach(Self.notSaid, id: \.self) { s in Label(s, systemImage: "minus.circle").foregroundStyle(.secondary) }
                }
                .font(.footnote)

                Section {
                    if let sent {
                        Label(sent.duplicate ? "You already sent this offer." : "Offer sent", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.green)
                        Text("The customer sees it on the job. Nothing is booked until they accept.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Button {
                            Task { await send() }
                        } label: {
                            HStack { Spacer(); if busy { ProgressView() } else { Text("Send offer").bold() }; Spacer() }
                        }
                        .disabled(busy)
                        .accessibilityIdentifier("sign.confirm")
                    }
                    if let failure { Text(failure).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Make an offer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(sent == nil ? "Cancel" : "Done") { dismiss() } }
            }
        }
    }

    static let notSaid = ["Nothing is booked until the customer accepts", "No payment is made", "Your contact details are not shared"]

    private func send() async {
        failure = nil
        switch OfferDrafting.params(action: action, lines: lines, window: useWindow ? (from, until) : nil, note: note) {
        case .failure(let f):
            failure = f.text
        case .success(let params):
            busy = true
            defer { busy = false }
            switch await OfferReaders.makeOffer(params) {
            case .success(let r): sent = r; onSent()
            case .failure(let f): failure = "Not sent. \(f.text)"
            }
        }
    }
}

struct AcceptOfferSheet: View {
    let action: JobAction
    let offer: JobOffer
    let requirementTitle: String
    var onAccepted: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var failure: String?
    @State private var done = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    RootedValueView(label: "Request", value: requirementTitle, status: .attributed)
                    RootedValueView(label: "From", value: offer.who, status: .attributed, decay: OfferCopy.rung(offer.offerRung))
                    if let w = OfferCopy.window(offer.availableFrom, offer.availableUntil) {
                        RootedValueView(label: "Available", value: w, status: .attributed)
                    }
                    if let note = offer.note { Text(note).font(.footnote) }
                } header: {
                    Text("You are accepting")
                }
                if !offer.coSigns.isEmpty {
                    Section {
                        ForEach(offer.coSigns) { c in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(CosignCopy.line(c)).font(.footnote)
                                if let s = c.scope { Text(s).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    } header: {
                        Text("Co-signs")
                    } footer: {
                        Text("Accepting accepts the offer with these co-signs and cuts. If they change, you'll be asked again.")
                    }
                }
                Section("Prices") {
                    if offer.lines.isEmpty {
                        Text("No prices in this offer.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(offer.lines) { line in
                        RootedValueView(label: JobCopy.lineLabel(line), value: JobCopy.linePrice(line),
                                        status: line.amount == nil ? .recorded : .attributed)
                    }
                }
                Section("Accepting says") {
                    Label("They take on this part of the job, at these prices.", systemImage: "checkmark.seal")
                }
                .font(.footnote)
                Section("It does not say") {
                    ForEach(Self.notSaid, id: \.self) { s in Label(s, systemImage: "minus.circle").foregroundStyle(.secondary) }
                }
                .font(.footnote)
                Section {
                    if done {
                        Label("Offer accepted", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                        Text("No payment was made.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Button {
                            Task { await accept() }
                        } label: {
                            HStack { Spacer(); if busy { ProgressView() } else { Text("Accept offer").bold() }; Spacer() }
                        }
                        .disabled(busy)
                        .accessibilityIdentifier("sign.confirm")
                    }
                    if let failure { Text(failure).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Accept offer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(done ? "Done" : "Cancel") { dismiss() } }
            }
        }
    }

    static let notSaid = ["No payment is made", "The work isn't marked as started", "Other offers stay on record"]

    private func accept() async {
        busy = true
        failure = nil
        defer { busy = false }
        if let reason = await OfferReaders.accept(action, offer: offer) {
            failure = "Couldn't accept. \(reason)"
        } else {
            done = true
            onAccepted()
        }
    }
}
