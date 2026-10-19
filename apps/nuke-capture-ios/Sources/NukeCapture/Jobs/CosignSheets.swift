// CosignSheets.swift — Co-sign this technician, Vouch for this person, Issue change order.
//
// Each is a Sign: what you're signing, "…says / It does not say", one explicit confirm. Co-sign and
// change order appear only from the server's actions; Vouch is offered on another person's
// profile to a signed-in viewer and the server decides eligibility.

import SwiftUI

struct CosignSheet: View {
    let action: JobAction
    let technician: String
    let requestTitle: String
    var onDone: () -> Void = {}

    @State private var kinds: Set<String> = []
    @State private var scope = ""
    @State private var cutBasis: CosignDrafting.CutBasis = .none
    @State private var value = ""
    @State private var currency = "USD"
    @State private var actAsSelf = false

    private var forShop: Bool { action.asFields["attestor_kind"]?.stringValue == "organization" }

    var body: some View {
        SignStepSheet(title: "Co-sign this technician", says: CosignCopy.cosignSays, doesNotSay: CosignCopy.cosignDoesNotSay,
                      confirmTitle: "Co-sign", successTitle: "Co-signed",
                      successDetail: "The customer sees your co-sign on the offer. It counts once they accept the offer.") {
            Section {
                RootedValueView(label: "Technician", value: technician, status: .attributed)
                RootedValueView(label: "Request", value: requestTitle, status: .attributed)
                if forShop {
                    Picker("Signing for", selection: $actAsSelf) {
                        Text("Your shop").tag(false)
                        Text("Yourself").tag(true)
                    }
                }
            }
            Section("What you vouch for") {
                ForEach(CosignCopy.kinds, id: \.key) { k in
                    Toggle(isOn: Binding(get: { kinds.contains(k.key) },
                                         set: { if $0 { kinds.insert(k.key) } else { kinds.remove(k.key) } })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(k.title)
                            Text(k.explain).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                TextField("Scope, e.g. TIG welding at our shop this week", text: $scope, axis: .vertical).lineLimit(2...5)
            }
            Section {
                Picker("Your cut", selection: $cutBasis) {
                    Text("No cut").tag(CosignDrafting.CutBasis.none)
                    Text("Share of labor").tag(CosignDrafting.CutBasis.share_of_labor_line)
                    Text("Flat").tag(CosignDrafting.CutBasis.flat)
                    Text("Per day").tag(CosignDrafting.CutBasis.day_rate)
                }
                if cutBasis == .share_of_labor_line {
                    TextField("Percent of the labor line", text: $value).keyboardType(.decimalPad)
                } else if cutBasis != .none {
                    HStack {
                        TextField("Amount", text: $value).keyboardType(.decimalPad)
                        TextField("USD", text: $currency).textInputAutocapitalization(.characters).frame(width: 60)
                    }
                }
            } footer: {
                Text("A cut is a term the customer sees and accepts with the offer. Nothing is paid here.")
            }
        } confirm: {
            switch CosignDrafting.cosign(action: action, kinds: kinds, scope: scope, cutBasis: cutBasis, value: value,
                                         currency: currency, actAsSelf: actAsSelf) {
            case .failure(let f): return f.text
            case .success(let p):
                if case .failure(let f) = await CosignWriters.write("cosign_provider", p) { return f.text }
                return nil
            }
        } onDone: { onDone() }
    }
}

struct VouchSheet: View {
    let subjectUserId: String
    let subjectName: String
    var onDone: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var kinds: Set<String> = []
    @State private var scope = ""
    @State private var useExpiry = false
    @State private var expires = Date().addingTimeInterval(86_400 * 180)
    @State private var busy = false
    @State private var failure: String?
    @State private var vouchId: String?
    @State private var withdrawn = false

    var body: some View {
        NavigationStack {
            Form {
                Section { RootedValueView(label: "Vouching for", value: subjectName, status: .attributed) }
                if vouchId == nil {
                    Section("What you vouch for") {
                        ForEach(CosignCopy.kinds, id: \.key) { k in
                            Toggle(isOn: Binding(get: { kinds.contains(k.key) },
                                                 set: { if $0 { kinds.insert(k.key) } else { kinds.remove(k.key) } })) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(k.title)
                                    Text(k.explain.replacingOccurrences(of: " for this job", with: "").replacingOccurrences(of: " on this job", with: ""))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        TextField("Scope, e.g. worked under me on K5 wiring", text: $scope, axis: .vertical).lineLimit(2...5)
                        Toggle("Ends on a date", isOn: $useExpiry)
                        if useExpiry { DatePicker("Ends", selection: $expires, in: Date()..., displayedComponents: .date) }
                    }
                    Section("Vouching says") {
                        ForEach(CosignCopy.vouchSays, id: \.self) { Label($0, systemImage: "checkmark.seal") }
                    }
                    .font(.footnote)
                    Section("It does not say") {
                        ForEach(CosignCopy.vouchDoesNotSay, id: \.self) { Label($0, systemImage: "minus.circle").foregroundStyle(.secondary) }
                    }
                    .font(.footnote)
                }
                Section {
                    if let id = vouchId {
                        Label(withdrawn ? "Vouch withdrawn" : "Vouch recorded", systemImage: withdrawn ? "minus.circle" : "checkmark.seal.fill")
                            .foregroundStyle(withdrawn ? Color.secondary : Color.green)
                        if !withdrawn {
                            Text("It shows on their profile under \"Vouched for by\".").font(.footnote).foregroundStyle(.secondary)
                            Button("Withdraw this vouch", role: .destructive) { Task { await withdraw(id) } }.disabled(busy)
                        }
                    } else {
                        Button {
                            Task { await vouch() }
                        } label: {
                            HStack { Spacer(); if busy { ProgressView() } else { Text("Vouch").bold() }; Spacer() }
                        }
                        .disabled(busy)
                    }
                    if let failure { Text(failure).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Vouch for this person")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(vouchId == nil ? "Cancel" : "Done") { dismiss() } } }
        }
    }

    private func vouch() async {
        failure = nil
        switch CosignDrafting.vouch(subjectUserId: subjectUserId, kinds: kinds, scope: scope, expires: useExpiry ? expires : nil) {
        case .failure(let f): failure = f.text
        case .success(let p):
            busy = true
            defer { busy = false }
            switch await CosignWriters.write("vouch_for_provider", p) {
            case .failure(let f): failure = "Didn't go through. \(f.text)"
            case .success(let data):
                struct R: Decodable { let vouch_id: String? }
                vouchId = (try? JobReaders.decode(R.self, from: data))?.vouch_id ?? "recorded"
                onDone()
            }
        }
    }

    private func withdraw(_ id: String) async {
        busy = true
        failure = nil
        defer { busy = false }
        if case .failure(let f) = await CosignWriters.write("withdraw_vouch", ["p_id": id]) {
            failure = "Couldn't withdraw. \(f.text)"
        } else {
            withdrawn = true
            onDone()
        }
    }
}

struct IssueChangeOrderSheet: View {
    let action: JobAction
    let quote: Quote
    var onDone: () -> Void = {}

    @State private var lines: [ChangeOrderDrafting.BaseLine]
    @State private var added: [CloseoutDrafting.InvoiceLineDraft] = []
    @State private var substitutions: [ChangeOrderDrafting.Substitution] = []
    @State private var reason = ""

    init(action: JobAction, quote: Quote, onDone: @escaping () -> Void = {}, prefill: (([ChangeOrderDrafting.BaseLine]) -> [ChangeOrderDrafting.BaseLine])? = nil) {
        self.action = action
        self.quote = quote
        self.onDone = onDone
        let base = quote.lines.map(ChangeOrderDrafting.BaseLine.init)
        _lines = State(initialValue: prefill?(base) ?? base)
    }

    var body: some View {
        SignStepSheet(title: "Issue change order", says: ChangeOrderCopy.says, doesNotSay: ChangeOrderCopy.doesNotSay,
                      confirmTitle: "Issue change order", successTitle: "Change order issued",
                      successDetail: "The customer sees it as a new quote version to accept.") {
            Section {
                RootedValueView(label: "Amends", value: "Accepted quote, version \(quote.version)", status: .attributed)
                TextField("Why the work changed (required)", text: $reason, axis: .vertical).lineLimit(2...5)
            }
            ForEach($lines) { $line in
                Section {
                    Picker("", selection: $line.state) {
                        Text("Keep").tag(ChangeOrderDrafting.LineState.keep)
                        Text("Change").tag(ChangeOrderDrafting.LineState.modify)
                        Text("Remove").tag(ChangeOrderDrafting.LineState.remove)
                    }
                    .pickerStyle(.segmented)
                    if line.state == .modify {
                        LabeledContent("Description") { TextField("Description", text: $line.description).multilineTextAlignment(.trailing) }
                        Picker("Priced", selection: $line.pricingBasis) {
                            ForEach(OfferDrafting.bases, id: \.key) { b in Text(b.title).tag(b.key) }
                        }
                        LabeledContent("Amount") {
                            TextField("Amount", text: $line.amount).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                        }
                        if line.pricingBasis != "flat" {
                            LabeledContent("Quantity") {
                                TextField("Optional", text: $line.quantity).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            }
                        }
                    }
                } header: {
                    Text("\(JobCopy.lineLabel(line.base)) · \(JobCopy.linePrice(line.base))")
                }
            }
            ForEach($added) { $line in
                Section("Added line") {
                    TextField("Description", text: $line.description)
                    Picker("Priced", selection: $line.pricingBasis) {
                        ForEach(OfferDrafting.bases, id: \.key) { b in Text(b.title).tag(b.key) }
                    }
                    TextField("Amount", text: $line.amount).keyboardType(.decimalPad)
                    if line.pricingBasis != "flat" {
                        TextField("Quantity (optional)", text: $line.quantity).keyboardType(.decimalPad)
                    }
                }
            }
            Button("Add a line") { added.append(.init(description: "")) }
            if !quote.specifications.isEmpty {
                ForEach($substitutions) { $sub in
                    Section("Substitution") {
                        Picker("Specification", selection: $sub.specId) {
                            ForEach(quote.specifications) { s in
                                Text([s.material_label, s.process_label].compactMap { $0 }.joined(separator: " · ")).tag(s.id)
                            }
                        }
                        Picker("Changes", selection: $sub.field) {
                            Text("Material").tag("material")
                            Text("Process").tag("process")
                        }
                        .pickerStyle(.segmented)
                        TextField("New key, e.g. mild_steel", text: $sub.toKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                        TextField("New name, e.g. Mild steel", text: $sub.toLabel)
                    }
                }
                Button("Substitute a material or process") {
                    substitutions.append(.init(specId: quote.specifications[0].id, field: "material"))
                }
            }
        } confirm: {
            switch ChangeOrderDrafting.params(action: action, quote: quote, lines: lines, added: added,
                                              substitutions: substitutions, reason: reason) {
            case .failure(let f): return f.text
            case .success(let p):
                if case .failure(let f) = await CosignWriters.write("issue_change_order", p) { return f.text }
                return nil
            }
        } onDone: { onDone() }
    }
}
