// WorkConsoleView.swift — the Work tab: what needs you now.
//
// Sections (R4 §2 "Work"): Awaiting your signature (my_signature_queue: each work day opens an
// explicit confirm sheet over confirm_work_session), Jobs in motion (my_work_orders, paged by
// next_after, each row a seven-dot stage rail that opens JobView), Messages (Contact via Nuke),
// Notifications (user_notifications; NotificationsSection), Jobs looking for someone (open_requirements_read with the viewer's match), and Capture (the Engine's
// sections, unchanged, shown only with the photo grant). The tab itself is signed-in only
// because these are personal queues. Every list is what a server reader returned for this
// account; a reader that is missing or refuses renders "Not available yet" and why.

import SwiftUI

struct WorkConsoleView: View {
    let showCapture: Bool

    @StateObject private var reader = WorkConsoleReader()
    @State private var showAccount = false
    @State private var showPaperwork = false

    var body: some View {
        NavigationStack {
            WorkConsoleContent(signatures: reader.signatures, jobs: reader.jobs, identity: reader.identity, showCapture: showCapture,
                               inbox: reader.inbox, open: reader.open, notifications: reader.notifications,
                               onInboxChanged: { Task { await reader.loadInbox() } },
                               onNotificationsChanged: { Task { await reader.loadNotifications() } },
                               loadingMore: reader.loadingMore || reader.loadingJobs,
                               jobsPageFailure: reader.jobsPageFailure,
                               onLoadMore: { Task { await reader.loadMoreJobs() } },
                               onSigned: { Task { await reader.loadSignatures() } })
                .navigationTitle("Work")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            showPaperwork = true
                        } label: {
                            Image(systemName: "doc.viewfinder")
                        }
                        .accessibilityLabel("Paperwork")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showAccount = true
                        } label: {
                            Image(systemName: "person.circle")
                        }
                        .accessibilityLabel("Account")
                    }
                }
                .sheet(isPresented: $showAccount) {
                    AccountView()
                }
                .fullScreenCover(isPresented: $showPaperwork) {
                    PaperworkScanView()
                }
                .task { PaperworkQueue.shared.kick(); await reader.load() }
                .refreshable {
                    await reader.load()
                    if showCapture { await CaptureSections.syncNow() }
                }
                .onReceive(reader.$signatures) { InboxBadgeStore.shared.toSign = InboxBadgeStore.toSign($0) }
                .onReceive(reader.$notifications) {
                    if case .loaded(let page) = $0 { InboxBadgeStore.shared.unreadNotifications = page.unread }
                }
        }
    }
}

/// Each console section publishes as soon as its own reader answers. A refresh
/// supersedes earlier responses, including pages requested before the refresh.
@MainActor
final class WorkConsoleReader: ObservableObject {
    struct Reads {
        var signatures: () async -> JobLoad<SignatureQueue> = { await JobReaders.signatures() }
        var jobs: (String?) async -> JobLoad<MyWorkOrders> = { await JobReaders.myWorkOrders(after: $0) }
        var identity: () async -> JobLoad<MyIdentity> = { await JobReaders.myIdentity() }
        var inbox: () async -> JobLoad<ContactInbox> = { await ContactReaders.inbox() }
        var open: () async -> JobLoad<OpenRequirements> = { await OfferReaders.openRequirements() }
        var notifications: () async -> JobLoad<NotificationPage> = { await NotificationReaders.page() }
    }

    @Published private(set) var signatures: JobLoad<SignatureQueue> = .loading
    @Published private(set) var jobs: JobLoad<MyWorkOrders> = .loading
    @Published private(set) var identity: JobLoad<MyIdentity> = .loading
    @Published private(set) var inbox: JobLoad<ContactInbox> = .loading
    @Published private(set) var open: JobLoad<OpenRequirements> = .loading
    @Published private(set) var notifications: JobLoad<NotificationPage> = .loading
    @Published private(set) var loadingMore = false
    @Published private(set) var loadingJobs = false
    @Published private(set) var jobsPageFailure: JobRefusal?

    private enum Part: Hashable { case signatures, jobs, identity, inbox, open, notifications }
    private var requests: [Part: ReadRequestGuard] = [:]
    private let reads: Reads
    private let account: () -> String?

    init(reads: Reads = Reads(), account: @escaping () -> String? = { SupabaseService.currentUserId }) {
        self.reads = reads
        self.account = account
    }

    private func read<T>(_ part: Part, operation: () async -> JobLoad<T>, apply: (JobLoad<T>) -> Void) async {
        let request = requests[part, default: ReadRequestGuard()].begin()
        let owner = account()
        let result = await operation()
        guard !Task.isCancelled, requests[part]?.isCurrent(request) == true, account() == owner else { return }
        apply(result)
    }

    func load() async {
        async let s: Void = loadSignatures()
        async let j: Void = loadJobs()
        async let i: Void = loadIdentity()
        async let m: Void = loadInbox()
        async let r: Void = loadOpen()
        async let n: Void = loadNotifications()
        _ = await (s, j, i, m, r, n)
    }

    func loadSignatures() async {
        await read(.signatures, operation: reads.signatures) { self.signatures = $0 }
    }

    func loadInbox() async {
        await read(.inbox, operation: reads.inbox) { self.inbox = $0 }
    }

    private func loadIdentity() async {
        await read(.identity, operation: reads.identity) { self.identity = $0 }
    }

    private func loadOpen() async {
        await read(.open, operation: reads.open) { self.open = $0 }
    }

    func loadNotifications() async {
        await read(.notifications, operation: reads.notifications) { self.notifications = $0 }
    }

    func loadJobs() async {
        let request = requests[.jobs, default: ReadRequestGuard()].begin()
        let owner = account()
        loadingJobs = true
        loadingMore = false
        jobsPageFailure = nil
        defer { if requests[.jobs]?.isCurrent(request) == true { loadingJobs = false } }
        let result = await reads.jobs(nil)
        guard !Task.isCancelled, requests[.jobs]?.isCurrent(request) == true, account() == owner else { return }
        jobs = result
    }

    func loadMoreJobs() async {
        guard case .loaded(let page) = jobs, let after = page.nextAfter, !loadingMore, !loadingJobs else { return }
        let request = requests[.jobs, default: ReadRequestGuard()].begin()
        let owner = account()
        loadingMore = true
        jobsPageFailure = nil
        defer { if requests[.jobs]?.isCurrent(request) == true { loadingMore = false } }
        let result = await reads.jobs(after)
        guard !Task.isCancelled, requests[.jobs]?.isCurrent(request) == true, account() == owner else { return }
        if case .loaded(let next) = result {
            jobs = .loaded(page.appending(next))
        } else if case .refused(let failure) = result {
            jobsPageFailure = failure
        }
    }
}

/// The console's render, separated from the reads so fixture snapshots drive it directly.
struct WorkConsoleContent: View {
    let signatures: JobLoad<SignatureQueue>
    let jobs: JobLoad<MyWorkOrders>
    let identity: JobLoad<MyIdentity>
    let showCapture: Bool
    var inbox: JobLoad<ContactInbox> = .loading
    var open: JobLoad<OpenRequirements> = .loading
    var notifications: JobLoad<NotificationPage> = .loading
    var onInboxChanged: (() -> Void)? = nil
    var onNotificationsChanged: (() -> Void)? = nil
    var loadingMore = false
    var jobsPageFailure: JobRefusal?
    var onLoadMore: (() -> Void)? = nil
    var onSigned: (() -> Void)? = nil

    @State private var signing: SignatureItem?
    @State private var opening: SignatureItem?

    var body: some View {
        List {
            PrioritiesSection()
            signatureSection
            ContactInboxSection(inbox: inbox, onChanged: onInboxChanged)
            NotificationsSection(page: notifications, onChanged: onNotificationsChanged)
            jobsSection
            JobsLookingSection(open: open, bridge: { if case .loaded(let me) = identity { return me.bridge } else { return nil } }())
            if showCapture {
                // The sync, reading and tool controls are engineering detail: one row that opens them,
                // not a screenful under the jobs (owner, 2026-10-20: "too much noise").
                Section {
                    NavigationLink {
                        List { CaptureSections() }
                            .navigationTitle("Capture")
                            .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Capture")
                            Text("Sync, on-device reads and tools for photos at your work sites.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .sheet(item: $signing) { item in
            WorkSessionSignSheet(item: item) { onSigned?() }
        }
        .sheet(item: $opening) { item in
            SignatureItemSheet(item: item)
        }
    }

    // MARK: Awaiting your signature

    @ViewBuilder private var signatureSection: some View {
        Section {
            switch signatures {
            case .loading:
                loadingRow
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
                NavigationLink {
                    WorkDaySignView()
                } label: {
                    Label("Confirm your days", systemImage: "checkmark.seal")
                }
                NavigationLink {
                    SessionConfirmView()
                } label: {
                    Label("Confirm sessions", systemImage: "checklist")
                }
            case .loaded(let q):
                if q.items.isEmpty {
                    Text("Nothing to sign right now.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(q.items.prefix(Self.signaturePreview)) { item in
                    signatureRow(item)
                }
                if q.items.count > Self.signaturePreview || q.items.contains(where: { $0.kind == "work_session" }) {
                    NavigationLink {
                        WorkDaySignView()
                    } label: {
                        Label("All work days to confirm", systemImage: "rectangle.stack")
                    }
                }
                if q.unreadableItems > 0 {
                    Text(JobCopy.newerVersion(q.unreadableItems)).font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            if case .loaded(let q) = signatures {
                Text("Awaiting your signature · \(q.coverage?.total ?? q.items.count)")
            } else {
                Text("Awaiting your signature")
            }
        } footer: {
            switch signatures {
            case .refused:
                Text("For now, confirm your work days and photo sessions here.")
            case .loaded(let q):
                if let coming = JobCopy.comingKinds(q.coverage?.kindsNotYetAvailable ?? []) { Text(coming) }
            case .loading:
                EmptyView()
            }
        }
    }

    static let signaturePreview = 5

    @ViewBuilder private func signatureRow(_ item: SignatureItem) -> some View {
        if !SignatureKinds.isKnown(item.kind) {
            RootedValueView(label: JobCopy.state(.unknown(item.kind)), value: item.displayTitle ?? item.vehicle?.text ?? "",
                            status: .recorded)
        } else {
            let row = RootedValueView(
                label: JobCopy.action(item.kind),
                value: item.displayTitle ?? item.vehicle?.text ?? item.summary ?? "Details on the next screen",
                status: .pending,
                decay: [item.displayTitle != nil ? item.vehicle?.text : nil, JobCopy.day(item.clock?.sessionDate),
                        JobCopy.span(item.captureSpanMinutes)].compactMap { $0 }.joined(separator: " · "))
            Button { if item.kind == "work_session" { signing = item } else { opening = item } } label: { row }
                .buttonStyle(.plain)
        }
    }

    // MARK: Jobs in motion

    @ViewBuilder private var jobsSection: some View {
        Section {
            switch jobs {
            case .loading:
                loadingRow
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let page):
                // A job whose completion is on record is finished, not in motion. It moves to the
                // collapsed Finished row below (owner, 2026-10-20: finished jobs on cars he no longer
                // works were surfacing as live work).
                let inMotion = page.rows.filter { $0.stageStates[.completion] != .recorded }
                if inMotion.isEmpty {
                    Text("No jobs in motion.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(inMotion) { row in
                    NavigationLink {
                        JobView(workOrderId: row.workOrderId, titleHint: row.headline, vehicleHint: row.vehicleLabel?.text)
                    } label: {
                        JobRowView(row: row)
                    }
                }
                if page.nextAfter != nil {
                    if let jobsPageFailure { JobRefusalRow(refusal: jobsPageFailure) }
                    Button {
                        onLoadMore?()
                    } label: {
                        if loadingMore { ProgressView() } else { Text("Show more jobs") }
                    }
                    .disabled(loadingMore)
                }
                if page.unreadableRows > 0 {
                    Text(JobCopy.newerVersion(page.unreadableRows)).font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Jobs in motion")
        } footer: {
            if case .loaded(let page) = jobs {
                Text(page.coverage?.sentence ?? "Total not available")
            }
        }
        if case .loaded(let page) = jobs {
            let finished = page.rows.filter { $0.stageStates[.completion] == .recorded }
            if !finished.isEmpty {
                let unpaid = finished.filter { $0.stageStates[.accounting] != .recorded && $0.stageStates[.accounting] != .withheld }.count
                Section {
                    DisclosureGroup("Finished · \(finished.count)" + (unpaid > 0 ? " · \(unpaid) with no payment on record" : "")) {
                        ForEach(finished) { row in
                            NavigationLink {
                                JobView(workOrderId: row.workOrderId, titleHint: row.headline, vehicleHint: row.vehicleLabel?.text)
                            } label: {
                                JobRowView(row: row)
                            }
                        }
                    }
                }
            }
        }
    }

    private var loadingRow: some View {
        HStack(spacing: 8) {
            ProgressView()
            Text("Loading…").font(.footnote).foregroundStyle(.secondary)
        }
    }
}

/// One job in motion: its headline, this viewer's part, the mini rail and the first gap.
struct JobRowView: View {
    let row: JobRow
    var showVehicle = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.headline)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle((row.displayTitle ?? row.title) == nil ? .secondary : .primary)
                        .lineLimit(2)
                    if showVehicle, (row.displayTitle ?? row.title) != nil, let vehicle = row.vehicleLabel?.text {
                        Text(vehicle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                JobStageRail(states: row.stageStates)
            }
            HStack(spacing: 6) {
                if !row.slots.isEmpty {
                    Text("You: " + row.slots.map(JobCopy.slot).joined(separator: " · "))
                }
                if let gap = row.firstGap {
                    if !row.slots.isEmpty { Text("·") }
                    Text(JobCopy.gap(gap.gap))
                }
                Spacer(minLength: 0)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            if row.inconsistencyCount > 0 {
                Label("Records disagree (\(row.inconsistencyCount))", systemImage: "exclamationmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            if let updated = JobCopy.updated(row.asOf) {
                Text(updated)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 3)
    }
}
