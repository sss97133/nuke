// SignatureItemSheet.swift — one item from the signature queue that isn't a work day.
//
// Shows what the item is (job, vehicle, when, the server's summary) and, always, "Signing says /
// It does not say" from the item's sign block. The Sign itself happens on the screen that holds
// the full terms: the job (quotes, offers, completion, change orders, payments, inspection access,
// co-signs) or the contact request; a shop confirms a booking request right here, pinned to its hash.
// Unknown kinds never reach this sheet.

import SwiftUI

enum SignatureKinds {
    /// Kinds this build can open; anything else shows "Needs a newer app version".
    static let known: Set<String> = ["work_session", "quote_to_accept", "offer_to_accept", "completion_to_accept",
                                     "change_order_to_accept", "contact_request", "inspection_access_request",
                                     "invoice_payment_to_confirm", "cosign_request",
                                     "facility_reservation_to_confirm"]

    static func isKnown(_ kind: String) -> Bool { known.contains(kind) }
}

struct SignatureItemSheet: View {
    let item: SignatureItem

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if item.kind == "facility_reservation_to_confirm" {
            ConfirmBookingSheet(item: item)
        } else {
            details
        }
    }

    private var details: some View {
        NavigationStack {
            List {
                Section {
                    if let t = item.displayTitle { RootedValueView(label: "Job", value: t, status: .attributed) }
                    if let v = item.vehicle?.text { RootedValueView(label: "Vehicle", value: v, status: .attributed) }
                    if let when = JobCopy.day(item.clock?.sessionDate) { RootedValueView(label: "When", value: when, status: .attributed) }
                    if let s = item.summary { Text(s).font(.footnote) }
                }
                if let sign = item.sign {
                    if !sign.bindsList.isEmpty {
                        Section("Signing says") {
                            ForEach(sign.bindsList, id: \.self) { Label(JobCopy.signBinds($0), systemImage: "checkmark.seal") }
                        }
                        .font(.footnote)
                    }
                    if !sign.doesNotBind.isEmpty {
                        Section("It does not say") {
                            ForEach(sign.doesNotBind, id: \.self) {
                                Label(JobCopy.signDoesNotBind($0), systemImage: "minus.circle").foregroundStyle(.secondary)
                            }
                        }
                        .font(.footnote)
                    }
                }
                Section {
                    if item.kind == "contact_request" {
                        NavigationLink { ContactThreadView(requestId: item.refId) } label: {
                            Label("Open the request", systemImage: "bubble.left.and.bubble.right")
                        }
                    } else if let wo = item.workOrderId {
                        NavigationLink { JobView(workOrderId: wo, titleHint: item.displayTitle, vehicleHint: item.vehicle?.text) } label: {
                            Label("Open the job to sign", systemImage: "signature")
                        }
                    } else {
                        Text("This needs a newer version of the app to open.").font(.footnote).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("You sign on the next screen, where the full terms are.")
                }
            }
            .navigationTitle(JobCopy.action(item.kind))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
        }
    }
}
