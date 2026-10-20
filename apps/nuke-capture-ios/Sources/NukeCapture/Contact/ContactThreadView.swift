// ContactThreadView.swift — one Contact via Nuke conversation.
//
// The request and its messages from contact_thread_read; a composer only when the server says
// can_post (after the recipient accepts). Refreshes on appear and on pull-to-refresh only.

import SwiftUI

struct ContactThreadView: View {
    let requestId: String
    var loadOnAppear = true

    @State private var thread: JobLoad<ContactThread>
    @State private var draft = ""
    @State private var busy = false
    @State private var failure: String?

    init(requestId: String, thread: JobLoad<ContactThread> = .loading, loadOnAppear: Bool = true) {
        self.requestId = requestId
        self.loadOnAppear = loadOnAppear
        _thread = State(initialValue: thread)
    }

    var body: some View {
        List {
            switch thread {
            case .loading:
                Section { HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) } }
            case .refused(let refusal):
                Section { JobRefusalRow(refusal: refusal) }
            case .loaded(let t):
                if let r = t.request {
                    Section {
                        RootedValueView(label: r.direction == "incoming" ? "From" : "To",
                                        value: r.counterpart?.text ?? "Unnamed party", status: .attributed)
                        RootedValueView(label: "About", value: ContactCopy.context(r.contextKind, r.contextLabel, incoming: r.direction == "incoming"),
                                        status: .recorded)
                        RootedValueView(label: "Status", value: ContactCopy.status(r.status), status: .recorded)
                        if let m = r.message {
                            Text(m).font(.footnote)
                        }
                    } header: {
                        Text("Request")
                    }
                }
                Section {
                    if t.messages.isEmpty {
                        Text(t.canPost ? "No messages yet." : "Messages open once the request is accepted.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(t.messages) { m in
                        VStack(alignment: m.fromYou ? .trailing : .leading, spacing: 2) {
                            Text(m.fromYou ? "You" : (m.author?.text ?? "Unnamed party"))
                                .font(.caption2).foregroundStyle(.secondary)
                            Text(m.body).font(.callout)
                                .padding(8)
                                .background(m.fromYou ? Color.accentColor.opacity(0.15) : Color(.secondarySystemFill),
                                            in: RoundedRectangle(cornerRadius: 10))
                            if let when = JobClock.text(m.createdAt) {
                                Text(when).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: m.fromYou ? .trailing : .leading)
                        .listRowSeparator(.hidden)
                    }
                } header: {
                    Text("Messages")
                } footer: {
                    Text("\(ContactCopy.whoCanRead(t.request?.recipientKind)) \(ContactCopy.neverShared)")
                }
                if t.canPost {
                    Section {
                        TextField("Write a message", text: $draft, axis: .vertical)
                            .lineLimit(1...6)
                        Button {
                            Task { await post() }
                        } label: {
                            if busy { ProgressView() } else { Text("Send").bold() }
                        }
                        .disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("thread.send")
                        if let failure {
                            Text(failure).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .task { if loadOnAppear { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        thread = await ContactReaders.thread(requestId)
    }

    private func post() async {
        busy = true
        failure = nil
        defer { busy = false }
        if let reason = await ContactReaders.post(requestId, body: draft) {
            failure = "Not sent. \(reason)"
        } else {
            draft = ""
            await load()
        }
    }
}
