// OrderInspectionSheet.swift — the client's Sign on a pre-purchase inspection.
//
// Lists the checklist exactly as it will be sent (the plan's inspection_scope), says what
// ordering does and does not do, and calls request_inspection only on the confirm button. On
// success the new inspection job opens.

import SwiftUI

struct OrderInspectionSheet: View {
    let params: PlanReaders.OrderParams
    let plan: WorkPlan
    var onOrdered: (String) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var failure: String?
    @State private var receipt: InspectionRequestReceipt?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    RootedValueView(label: "Vehicle", value: plan.vehicleLabel?.text ?? plan.recordLabel ?? "Vehicle not named",
                                    status: .attributed)
                    RootedValueView(label: "Inspection", value: "Pre-purchase", status: .recorded)
                } header: {
                    Text("You are ordering")
                }
                Section("Checklist that will be sent · \(plan.checklist.count)") {
                    ForEach(Array(plan.checklist.enumerated()), id: \.element.id) { i, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(i + 1).").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            Text(item.question ?? "Checklist item").font(.footnote)
                        }
                    }
                }
                Section("Ordering says") {
                    Label("You want this car inspected against this checklist.", systemImage: "checkmark.seal")
                }
                .font(.footnote)
                Section("It does not say") {
                    ForEach(Self.notSaid, id: \.self) { s in Label(s, systemImage: "minus.circle").foregroundStyle(.secondary) }
                }
                .font(.footnote)
                Section {
                    if let receipt {
                        Label(receipt.duplicate ? "You already ordered this inspection." : "Inspection ordered",
                              systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                        Text("Inspectors can now offer to do it. The seller still has to agree before anyone sees the car.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Button {
                            Task { await order() }
                        } label: {
                            HStack { Spacer(); if busy { ProgressView() } else { Text("Order inspection").bold() }; Spacer() }
                        }
                        .disabled(busy)
                    }
                    if let failure { Text(failure).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Order inspection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(receipt == nil ? "Cancel" : "Done") { dismiss() }
                }
                if let id = receipt?.workOrderId {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Open job") { onOrdered(id) }
                    }
                }
            }
        }
    }

    static let notSaid = ["No access to the car is granted", "The seller must agree before anyone inspects it", "No payment is made"]

    private func order() async {
        busy = true
        failure = nil
        defer { busy = false }
        switch await PlanReaders.order(params) {
        case .success(let r):
            receipt = r
            if let id = r.workOrderId {
                try? await Task.sleep(for: .seconds(1))
                onOrdered(id)
            }
        case .failure(let f):
            failure = "Not ordered. \(f.text)"
        }
    }
}
