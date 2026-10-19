// WorkSessionSignSheet.swift — confirming one work day from the signature queue.
//
// A Sign step: the person reads what confirming says and what it does not (the server's
// sign.binds / sign.does_not_bind, in plain words) and taps an explicit button. Nothing is
// confirmed automatically. The write is the server's own confirm_work_session.

import SwiftUI

struct WorkSessionSignSheet: View {
    let item: SignatureItem
    var onSigned: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var failure: String?
    @State private var done = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    RootedValueView(label: "Vehicle", value: item.vehicle?.text ?? "Vehicle not named", status: .attributed)
                    if let day = JobCopy.day(item.clock?.sessionDate) {
                        RootedValueView(label: "Day", value: day, status: .attributed)
                    }
                    if let span = JobCopy.span(item.captureSpanMinutes) {
                        RootedValueView(label: "Time on record", value: span, status: .pending,
                                        decay: "from photo times, not hours worked")
                    }
                    if let evidence = JobCopy.evidenceLine(item.evidenceCounts) {
                        RootedValueView(label: "Photos", value: evidence, status: .attributed)
                    }
                }

                Section("Confirming says") {
                    Label(JobCopy.signBinds(item.sign?.binds), systemImage: "checkmark.seal")
                        .font(.footnote)
                }
                if let notBound = item.sign?.doesNotBind, !notBound.isEmpty {
                    Section("It does not say") {
                        ForEach(notBound, id: \.self) { s in
                            Label(JobCopy.signDoesNotBind(s), systemImage: "minus.circle")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    if done {
                        Label("Confirmed", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                    } else {
                        Button {
                            Task { await confirm() }
                        } label: {
                            HStack {
                                Spacer()
                                if busy { ProgressView() } else { Text("Confirm this work day").bold() }
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
            .navigationTitle("Confirm work day")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(done ? "Done" : "Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func confirm() async {
        busy = true
        failure = nil
        defer { busy = false }
        if let reason = await JobReaders.confirmWorkSession(item) {
            failure = "Couldn't confirm. \(reason)"
        } else {
            done = true
            onSigned()
        }
    }
}
