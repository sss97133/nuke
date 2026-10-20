// ContactInboxSection.swift — Contact via Nuke requests in the Work tab.
//
// Incoming requests can be accepted or declined; outgoing ones withdrawn while pending. Each row
// names the counterpart by public handle (or "Unnamed party") and what the request is about, and
// opens its thread. The list refreshes when Work appears and on pull-to-refresh; there is no
// background polling, push or email.

import SwiftUI

struct ContactInboxSection: View {
    let inbox: JobLoad<ContactInbox>
    var onChanged: (() -> Void)? = nil

    @State private var busyId: String?
    @State private var failure: String?

    var body: some View {
        Section {
            switch inbox {
            case .loading:
                HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let box):
                if box.incoming.isEmpty && box.outgoing.isEmpty {
                    Text("No messages yet. When someone contacts you through Nuke, it shows here.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(box.incoming) { item in row(item) }
                ForEach(box.outgoing) { item in row(item) }
                if let failure {
                    Text(failure).font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            if case .loaded(let box) = inbox, box.pendingIncoming > 0 {
                Text("Messages · \(box.pendingIncoming) new")
            } else {
                Text("Messages")
            }
        } footer: {
            Text("Through Nuke only. \(ContactCopy.neverShared)")
        }
    }

    @ViewBuilder private func row(_ item: ContactItem) -> some View {
        NavigationLink {
            ContactThreadView(requestId: item.requestId)
        } label: {
            ContactItemRow(item: item)
        }
        if item.canRespond || item.canWithdraw {
            HStack(spacing: 12) {
                if item.canRespond {
                    Button("Accept") { Task { await act(item) { await ContactReaders.respond(item.requestId, accept: true) } } }
                        .buttonStyle(.borderedProminent)
                    Button("Decline") { Task { await act(item) { await ContactReaders.respond(item.requestId, accept: false) } } }
                        .buttonStyle(.bordered)
                }
                if item.canWithdraw {
                    Button("Withdraw") { Task { await act(item) { await ContactReaders.withdraw(item.requestId) } } }
                        .buttonStyle(.bordered)
                }
                Spacer()
                if busyId == item.requestId { ProgressView() }
            }
            .controlSize(.small)
            .disabled(busyId != nil)
        }
    }

    private func act(_ item: ContactItem, _ write: () async -> String?) async {
        busyId = item.requestId
        failure = nil
        defer { busyId = nil }
        if let reason = await write() {
            failure = reason
        } else {
            onChanged?()
        }
    }
}

struct ContactItemRow: View {
    let item: ContactItem

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Image(systemName: item.direction == "incoming" ? "tray.and.arrow.down" : "paperplane")
                    .font(.caption).foregroundStyle(.secondary)
                Text(item.direction == "incoming" ? "From \(item.counterpart?.text ?? "Unnamed party")"
                                                  : "To \(item.counterpart?.text ?? "Unnamed party")")
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(ContactCopy.status(item.status)).font(.caption2).foregroundStyle(.secondary)
            }
            Text("About: \(ContactCopy.context(item.contextKind, item.contextLabel, incoming: item.direction == "incoming"))")
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            if let m = item.message {
                Text(m).font(.footnote).lineLimit(2)
            }
            if item.threadMessages > 0 {
                Text("\(item.threadMessages) message\(item.threadMessages == 1 ? "" : "s")")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }
}
