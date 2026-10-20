// ContactRequestSheet.swift — writing a Contact via Nuke request.
//
// Opened only where a reader's contact block says available. A short message (up to 500
// characters), today's remaining requests from my_contact_requests, and an explicit Send: the
// request goes through request_contact with exactly the context the server named. Nothing is
// sent automatically; email and phone are never shared.

import SwiftUI

struct ContactRequestSheet: View {
    let block: ContactBlock
    /// Who this goes to, as the page shows them ("@handle", a shop name).
    let recipientName: String
    var contextLabel: String? = nil
    var loadLimits = true

    @Environment(\.dismiss) private var dismiss
    @State private var message: String
    @State private var leftToday: Int?
    @State private var busy = false
    @State private var failure: String?
    @State private var sent = false

    init(block: ContactBlock, recipientName: String, contextLabel: String? = nil, loadLimits: Bool = true,
         draft: String = "", leftToday: Int? = nil) {
        self.block = block
        self.recipientName = recipientName
        self.contextLabel = contextLabel
        self.loadLimits = loadLimits
        _message = State(initialValue: draft)
        _leftToday = State(initialValue: leftToday)
    }

    static let maxLength = 500

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    RootedValueView(label: "To", value: recipientName, status: .attributed)
                    RootedValueView(label: "About", value: ContactCopy.context(block.contextKind, contextLabel), status: .recorded)
                }

                if sent {
                    Section {
                        Label("Sent", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        Text(ContactCopy.sent).font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        TextEditor(text: $message)
                            .frame(minHeight: 120)
                            .onChange(of: message) { _, new in
                                if new.count > Self.maxLength { message = String(new.prefix(Self.maxLength)) }
                            }
                    } header: {
                        Text("Your message")
                    } footer: {
                        Text("\(message.count) of \(Self.maxLength) characters")
                    }

                    Section {
                        Button {
                            Task { await send() }
                        } label: {
                            HStack {
                                Spacer()
                                if busy { ProgressView() } else { Text("Send").bold() }
                                Spacer()
                            }
                        }
                        .disabled(busy || leftToday == 0
                                  || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("contact.send")
                        if let failure {
                            Text(failure).font(.footnote).foregroundStyle(.secondary)
                        }
                    } footer: {
                        Text([ContactCopy.leftToday(leftToday),
                              "Nuke passes your message along. They choose whether to reply. \(ContactCopy.neverShared)"]
                            .compactMap { $0 }.joined(separator: " "))
                    }
                }
            }
            .navigationTitle("Contact via Nuke")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(sent ? "Done" : "Cancel") { dismiss() }
                }
            }
            .task {
                guard loadLimits else { return }
                if case .loaded(let inbox) = await ContactReaders.inbox() { leftToday = inbox.requestsLeftToday }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func send() async {
        busy = true
        failure = nil
        defer { busy = false }
        switch await ContactReaders.send(block, message: message) {
        case .success:
            sent = true
            if let n = leftToday { leftToday = max(n - 1, 0) }
        case .failure(let f):
            failure = "Not sent. \(f.text)"
        }
    }
}

/// The "Contact via Nuke" row: a button when the server says available, otherwise dim with the reason.
struct ContactViaNukeRow: View {
    let block: ContactBlock?
    let recipientName: String
    var contextLabel: String? = nil

    @State private var composing = false

    var body: some View {
        if let block, block.canRequest {
            Button {
                composing = true
            } label: {
                Label("Contact via Nuke", systemImage: "bubble.left.and.bubble.right")
            }
            .sheet(isPresented: $composing) {
                ContactRequestSheet(block: block, recipientName: recipientName, contextLabel: contextLabel)
            }
        } else {
            Label("Contact via Nuke", systemImage: "bubble.left.and.bubble.right")
                .foregroundStyle(.secondary)
        }
    }

    /// The footer under the row, in the server's terms.
    static func footer(_ block: ContactBlock?) -> String {
        if let block, block.canRequest {
            return "Nuke passes your message along. \(ContactCopy.neverShared)"
        }
        if SupabaseService.currentUserId == nil { return "Sign in to contact people through Nuke. \(ContactCopy.neverShared)" }
        return "Not available here. \(ContactCopy.neverShared)"
    }
}
