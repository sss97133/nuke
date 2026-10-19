// NotificationsSection.swift — Notifications in the Work tab, and the full list behind it.
//
// Each row is a notification as the server wrote it (title, message, clock), unread ones dotted.
// Opening a row marks it read through mark_notification_read and shows its subject: the job, the
// conversation, the vehicle or the organization, or the page on nuke.ag when the app has no screen
// for it. A row with no subject is marked read in place. "Mark all read" calls
// mark_all_notifications_read. Lists refresh when Work appears and on pull-to-refresh; there is no
// push or background polling.

import SwiftUI

struct NotificationsSection: View {
    let page: JobLoad<NotificationPage>
    /// Rows shown before "All notifications"; nil shows every loaded row.
    var preview: Int? = 5
    var onChanged: (() -> Void)? = nil

    @State private var busy = false
    @State private var note: String?

    var body: some View {
        Section {
            switch page {
            case .loading:
                HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let p):
                if p.rows.isEmpty {
                    Text(NotificationCopy.emptyBody).font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(shown(p)) { n in
                    NotificationRowLink(notification: n) { await open(n) }
                }
                if let preview, p.rows.count > preview || (p.total ?? 0) > preview {
                    NavigationLink {
                        NotificationsView(onChanged: onChanged)
                    } label: {
                        Label("All notifications", systemImage: "bell")
                    }
                }
            }
        } header: {
            HStack {
                if case .loaded(let p) = page { Text(NotificationCopy.header(p.unread)) } else { Text("Notifications") }
                Spacer()
                if case .loaded(let p) = page, (p.unread ?? 0) > 0 || p.rows.contains(where: { !$0.isRead }) {
                    Button("Mark all read") { Task { await markAll() } }
                        .font(.caption)
                        .textCase(nil)
                        .disabled(busy)
                }
            }
        } footer: {
            if case .loaded(let p) = page {
                VStack(alignment: .leading, spacing: 2) {
                    if !p.rows.isEmpty { Text(p.coverage) }
                    if p.unreadableRows > 0 { Text(JobCopy.newerVersion(p.unreadableRows)) }
                    if let note { Text(note) }
                }
            }
        }
    }

    private func shown(_ p: NotificationPage) -> [UserNotification] {
        guard let preview else { return p.rows }
        return Array(p.rows.prefix(preview))
    }

    private func open(_ n: UserNotification) async {
        guard !n.isRead else { return }
        if let reason = await NotificationReaders.markRead(n.id) {
            note = reason
        } else {
            onChanged?()
        }
    }

    private func markAll() async {
        busy = true
        note = nil
        defer { busy = false }
        switch await NotificationReaders.markAllRead() {
        case .success(let n):
            note = NotificationCopy.markedAll(n)
            onChanged?()
        case .failure(let f):
            note = f.text
        }
    }
}

/// The full list (latest NotificationReaders.pageLimit rows), pushed from the Work tab.
struct NotificationsView: View {
    var onChanged: (() -> Void)? = nil

    @State private var page: JobLoad<NotificationPage> = .loading

    var body: some View {
        List {
            NotificationsSection(page: page, preview: nil) {
                Task { await load() }
                onChanged?()
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        page = await NotificationReaders.page()
    }
}

/// One row, wired to what it opens. Opening marks it read.
struct NotificationRowLink: View {
    let notification: UserNotification
    let onOpen: () async -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            switch notification.route {
            case .web(let url):
                Button {
                    Task { await onOpen() }
                    openURL(url)
                } label: { NotificationRow(notification: notification) }
                .buttonStyle(.plain)
            case .none:
                Button { Task { await onOpen() } } label: { NotificationRow(notification: notification) }
                    .buttonStyle(.plain)
            default:
                NavigationLink {
                    Self.destination(notification.route)
                        .task { await onOpen() }
                } label: { NotificationRow(notification: notification) }
            }
        }
        .swipeActions {
            if !notification.isRead {
                Button("Mark read") { Task { await onOpen() } }
            }
        }
    }

    @ViewBuilder static func destination(_ route: NotificationRoute) -> some View {
        switch route {
        case .job(let id): JobView(workOrderId: id)
        case .contactThread(let id): ContactThreadView(requestId: id)
        case .vehicle(let id): VehicleDetailView(vehicleId: id, embedInNavigationStack: false)
        case .organization(let id): OrganizationView(orgId: id)
        case .web, .none: EmptyView()
        }
    }
}

struct NotificationRow: View {
    let notification: UserNotification

    var body: some View {
        let n = notification
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Circle()
                    .fill(n.isRead ? Color.clear : Color.accentColor)
                    .frame(width: 7, height: 7)
                Text(n.title ?? NotificationCopy.kind(n.kind))
                    .font(.subheadline.weight(n.isRead ? .regular : .semibold))
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(NotificationCopy.kind(n.kind)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            if let m = n.message {
                Text(m).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
            }
            Text([JobClock.text(n.createdAt), NotificationCopy.opens(n.route)].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityValue(n.isRead ? Text("Read") : Text("Unread"))
    }
}
