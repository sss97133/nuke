// WorkConsoleView.swift — the Work tab: what needs you now.
//
// Sections (R4 §2 "Work"): Awaiting your signature (my_signature_queue: each work day opens an
// explicit confirm sheet over confirm_work_session), Jobs in motion (my_work_orders, paged by
// next_after, each row a seven-dot stage rail that opens JobView), Open requirements near you
// (needs a linked technician profile; links to ProviderLinkView), and Capture (the Engine's
// sections, unchanged, shown only with the photo grant). The tab itself is signed-in only
// because these are personal queues. Every list is what a server reader returned for this
// account; a reader that is missing or refuses renders "Not available yet" and why.

import SwiftUI

struct WorkConsoleView: View {
    let showCapture: Bool

    @State private var signatures: JobLoad<SignatureQueue> = .loading
    @State private var jobs: JobLoad<MyWorkOrders> = .loading
    @State private var identity: JobLoad<MyIdentity> = .loading
    @State private var loadingMore = false
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            WorkConsoleContent(signatures: signatures, jobs: jobs, identity: identity, showCapture: showCapture,
                               loadingMore: loadingMore,
                               onLoadMore: { Task { await loadMoreJobs() } },
                               onSigned: { Task { signatures = await JobReaders.signatures() } })
                .navigationTitle("Work")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
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
                .task { await load() }
                .refreshable {
                    await load()
                    if showCapture { await CaptureSections.syncNow() }
                }
        }
    }

    private func load() async {
        async let s = JobReaders.signatures()
        async let j = JobReaders.myWorkOrders()
        async let i = JobReaders.myIdentity()
        signatures = await s
        jobs = await j
        identity = await i
    }

    private func loadMoreJobs() async {
        guard case .loaded(let page) = jobs, let after = page.nextAfter, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        if case .loaded(let next) = await JobReaders.myWorkOrders(after: after) {
            jobs = .loaded(page.appending(next))
        }
    }
}

/// The console's render, separated from the reads so fixture snapshots drive it directly.
struct WorkConsoleContent: View {
    let signatures: JobLoad<SignatureQueue>
    let jobs: JobLoad<MyWorkOrders>
    let identity: JobLoad<MyIdentity>
    let showCapture: Bool
    var loadingMore = false
    var onLoadMore: (() -> Void)? = nil
    var onSigned: (() -> Void)? = nil

    @State private var signing: SignatureItem?

    var body: some View {
        List {
            signatureSection
            jobsSection
            openRequirementsSection
            if showCapture {
                Section {
                    Text("Sync, on-device reads and tools for photos taken at your work sites.")
                        .font(.footnote).foregroundStyle(.secondary)
                } header: {
                    Text("Capture")
                }
                CaptureSections()
            }
        }
        .sheet(item: $signing) { item in
            WorkSessionSignSheet(item: item) { onSigned?() }
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
        let row = RootedValueView(
            label: JobCopy.action(item.kind),
            value: item.vehicle?.text ?? "Vehicle not named",
            status: .pending,
            decay: [JobCopy.day(item.clock?.sessionDate), JobCopy.span(item.captureSpanMinutes)]
                .compactMap { $0 }.joined(separator: " · "))
        if item.kind == "work_session" {
            Button { signing = item } label: { row }
                .buttonStyle(.plain)
        } else if let wo = item.workOrderId {
            NavigationLink { JobView(workOrderId: wo) } label: { row }
        } else {
            row
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
                if page.rows.isEmpty {
                    Text("No jobs in motion.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(page.rows) { row in
                    NavigationLink {
                        JobView(workOrderId: row.workOrderId, titleHint: row.headline, vehicleHint: row.vehicleLabel?.text)
                    } label: {
                        JobRowView(row: row)
                    }
                }
                if page.nextAfter != nil {
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
    }

    // MARK: Open requirements near you

    @ViewBuilder private var openRequirementsSection: some View {
        Section {
            switch identity {
            case .loading:
                loadingRow
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let me):
                NavigationLink {
                    ProviderLinkView()
                } label: {
                    RootedValueView(label: "Technician profile",
                                    value: JobCopy.technicianLink(me.bridge) ?? "Not available",
                                    status: me.bridge == nil ? .facade : .recorded)
                }
            }
            Text("Jobs looking for a technician near you will show here once your account is linked to a technician profile backed by your work. Coming soon.")
                .font(.footnote).foregroundStyle(.secondary)
        } header: {
            Text("Open requirements near you")
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
