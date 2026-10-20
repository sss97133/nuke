// FacilitySheets.swift — Book a bay (reserve_facility), Declare an asset (declare_facility_asset)
// and Confirm booking (confirm_facility_reservation, pinned to the queue item's hash).

import SwiftUI

struct BookFacilitySheet: View {
    let workOrderId: String
    let choices: [FacilityChoice]
    var onBooked: (FacilityReservation) -> Void = { _ in }

    @State private var assetId: String?
    @State private var from: Date
    @State private var until: Date
    @State private var basis: FacilityDrafting.FeeBasis = .none
    @State private var amount = ""
    @State private var currency = "USD"

    init(workOrderId: String, choices: [FacilityChoice], start: Date? = nil, onBooked: @escaping (FacilityReservation) -> Void = { _ in }) {
        self.workOrderId = workOrderId
        self.choices = choices
        self.onBooked = onBooked
        let base = start ?? Calendar.current.date(bySettingHour: 9, minute: 0, second: 0,
                                                  of: Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()) ?? Date()
        _from = State(initialValue: base)
        _until = State(initialValue: base.addingTimeInterval(3 * 3600))
        _assetId = State(initialValue: choices.first?.assetId)
    }

    private var chosen: FacilityChoice? { choices.first { $0.assetId == assetId } }

    var body: some View {
        SignStepSheet(title: "Book a bay", says: FacilityCopy.requestSays, doesNotSay: FacilityCopy.requestDoesNotSay,
                      saysTitle: "Requesting says",
                      confirmTitle: "Send the request", successTitle: "Requested",
                      successDetail: FacilityCopy.requested(shop: chosen?.organizationName, window: FacilityCopy.window(FacilityDrafting.iso(from), FacilityDrafting.iso(until))),
                      details: {
                          Section {
                              Picker("Space", selection: $assetId) {
                                  ForEach(choices) { c in
                                      Text("\(c.label) · \(FacilityCopy.kind(c.kind))").tag(Optional(c.assetId))
                                  }
                              }
                              if let c = chosen {
                                  RootedValueView(label: "Shop", value: c.organizationName ?? "Unnamed shop", status: .attributed)
                                  RootedValueView(label: "Holds", value: FacilityCopy.capacity(c.capacity), status: .attributed,
                                                  decay: c.freeInWindow == false ? "fully booked in the job's window" : nil)
                              }
                          } header: {
                              Text("Where")
                          }
                          Section("When") {
                              DatePicker("From", selection: $from)
                              DatePicker("Until", selection: $until)
                          }
                          Section {
                              Picker("Fee", selection: $basis) {
                                  ForEach(FacilityDrafting.FeeBasis.allCases) { Text($0.title).tag($0) }
                              }
                              if basis != .none {
                                  HStack {
                                      TextField("Amount", text: $amount).keyboardType(.decimalPad)
                                      TextField("USD", text: $currency).textInputAutocapitalization(.characters).frame(width: 60)
                                  }
                              }
                          } header: {
                              Text("Fee you propose (optional)")
                          } footer: {
                              Text("The shop sees it when confirming. No money moves through Nuke.")
                          }
                      },
                      confirm: send)
    }

    private func send() async -> String? {
        switch FacilityDrafting.reserve(workOrderId: workOrderId, assetId: assetId, from: from, until: until,
                                        basis: basis, amount: amount, currency: currency) {
        case .failure(let f): return f.text
        case .success(let p):
            switch await FacilityWriters.write("reserve_facility", p) {
            case .failure(let f): return f.text
            case .success(let data):
                if let r = try? JobReaders.decode(FacilityReservation.self, from: data) { onBooked(r) }
                return nil
            }
        }
    }
}

struct DeclareAssetSheet: View {
    let action: JobAction
    let shopName: String
    var onDone: () -> Void = {}

    @State private var kind = "lift"
    @State private var label = ""
    @State private var capacity = 1
    @State private var link = ""

    init(action: JobAction, shopName: String, kind: String = "lift", label: String = "", capacity: Int = 1, onDone: @escaping () -> Void = {}) {
        self.action = action
        self.shopName = shopName
        self.onDone = onDone
        _kind = State(initialValue: kind)
        _label = State(initialValue: label)
        _capacity = State(initialValue: capacity)
    }

    var body: some View {
        SignStepSheet(title: "Declare an asset", says: FacilityCopy.declareSays, doesNotSay: FacilityCopy.declareDoesNotSay,
                      saysTitle: "Declaring says",
                      confirmTitle: "Declare it", successTitle: "Declared",
                      successDetail: "It now shows on \(shopName)'s page and can be booked for jobs.",
                      details: {
                          Section {
                              RootedValueView(label: "Shop", value: shopName, status: .attributed)
                              Picker("What it is", selection: $kind) {
                                  ForEach(FacilityCopy.kinds, id: \.key) { Text($0.title).tag($0.key) }
                              }
                              TextField("Name, e.g. Lift A", text: $label)
                              Stepper("Holds \(FacilityCopy.capacity(capacity))", value: $capacity, in: 1...500)
                          } header: {
                              Text("The asset")
                          }
                          Section {
                              TextField("Link to a photo or listing (optional)", text: $link)
                                  .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                          } footer: {
                              Text("Optional. An https link that shows it, such as your shop's page.")
                          }
                      },
                      confirm: declare, onDone: onDone)
    }

    private func declare() async -> String? {
        switch FacilityDrafting.declare(action: action, kind: kind, label: label, capacity: capacity, evidenceLink: link) {
        case .failure(let f): return f.text
        case .success(let p):
            if case .failure(let f) = await FacilityWriters.write(action.rpc ?? "declare_facility_asset", p) { return f.text }
            return nil
        }
    }
}

struct ConfirmBookingSheet: View {
    let item: SignatureItem
    var onDone: () -> Void = {}

    private var s: FacilityRequestSummary? { item.facilityRequest }

    var body: some View {
        SignStepSheet(title: "Confirm booking", says: (item.sign?.bindsList ?? []).map(FacilityCopy.signBinds),
                      doesNotSay: (item.sign?.doesNotBind ?? []).map(FacilityCopy.signDoesNotBind),
                      confirmTitle: "Confirm booking", successTitle: "Booked",
                      successDetail: "The space is held for this job. It shows as busy on your shop's calendar.",
                      confirmEnabled: FacilityDrafting.confirm(item) != nil,
                      details: {
                          Section {
                              if let a = s?.asset {
                                  RootedValueView(label: "Space", value: [a.label, a.kind.map(FacilityCopy.kind)].compactMap { $0 }.joined(separator: " · "),
                                                  status: .attributed, decay: a.capacity.map { "holds \(FacilityCopy.capacity($0))" })
                              }
                              if let w = FacilityCopy.window(item.windowFrom, item.windowUntil) {
                                  RootedValueView(label: "When", value: w, status: .attributed)
                              }
                              if let t = item.displayTitle { RootedValueView(label: "Job", value: t, status: .attributed) }
                              if let v = item.vehicle?.text { RootedValueView(label: "Vehicle", value: v, status: .attributed) }
                              RootedValueView(label: "Asked by", value: s?.requestedBy?.text ?? "Unnamed party", status: .attributed,
                                              decay: FacilityCopy.requester(s?.requesterRole))
                              if let t = s?.terms, let fee = FacilityCopy.terms(basis: t.basis, amount: t.amount, currency: t.currency) {
                                  RootedValueView(label: "Fee they propose", value: fee, status: .attributed)
                              }
                              if s?.capacityFree == false {
                                  Label("Every space on this asset looks taken then. Confirming may be refused.", systemImage: "exclamationmark.triangle")
                                      .font(.footnote).foregroundStyle(.orange)
                              }
                          } header: {
                              Text("Booking request")
                          }
                          if let wo = item.workOrderId {
                              Section {
                                  NavigationLink { JobView(workOrderId: wo, titleHint: item.displayTitle, vehicleHint: item.vehicle?.text) } label: {
                                      Label("Open the job", systemImage: "wrench.and.screwdriver")
                                  }
                              }
                          }
                      },
                      confirm: confirm, onDone: onDone)
    }

    private func confirm() async -> String? {
        guard let p = FacilityDrafting.confirm(item) else { return "This request can't be confirmed from here. Refresh and try again." }
        if case .failure(let f) = await FacilityWriters.write("confirm_facility_reservation", p) { return f.text }
        return nil
    }
}
