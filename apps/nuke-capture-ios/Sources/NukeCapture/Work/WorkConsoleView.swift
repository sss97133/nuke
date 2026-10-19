// WorkConsoleView.swift — the Work tab: what needs you now.
//
// Sections (R4 §2 "Work"): Awaiting your signature (my_signature_queue), Jobs in motion
// (my_work_orders, each row a seven-dot stage rail that opens JobView), Open requirements near
// you (needs the identity bridge), and Capture (the Engine's sections, unchanged, shown only
// with the photo grant). Every list is what a server reader returned for this account; a
// reader that is missing or refuses renders its refusal, never placeholder rows.

import SwiftUI

struct WorkConsoleView: View {
    let showCapture: Bool

    @State private var signatures: JobLoad<SignatureQueue> = .loading
    @State private var jobs: JobLoad<MyWorkOrders> = .loading
    @State private var identity: JobLoad<MyIdentity> = .loading
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            WorkConsoleContent(signatures: signatures, jobs: jobs, identity: identity, showCapture: showCapture)
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
}

/// The console's render, separated from the reads so fixture snapshots drive it directly.
struct WorkConsoleContent: View {
    let signatures: JobLoad<SignatureQueue>
    let jobs: JobLoad<MyWorkOrders>
    let identity: JobLoad<MyIdentity>
    let showCapture: Bool

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
    }

    // MARK: Awaiting your signature

    @ViewBuilder private var signatureSection: some View {
        Section {
            switch signatures {
            case .loading:
                loadingRow("Reading your signature queue…")
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
                    Text("Nothing awaits your signature.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(q.items) { item in
                    signatureRow(item)
                }
                if q.unreadableItems > 0 {
                    Text("Items in a shape this build cannot read: \(q.unreadableItems)")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            if case .loaded(let q) = signatures {
                Text("Awaiting your signature · \(q.items.count)")
            } else {
                Text("Awaiting your signature")
            }
        } footer: {
            if case .refused = signatures {
                Text("Until the queue is readable, your days and photo sessions are signed from their existing screens.")
            }
        }
    }

    @ViewBuilder private func signatureRow(_ item: SignatureItem) -> some View {
        let row = RootedValueView(label: JobWords.humanize(item.kind),
                                  value: JobClock.text(item.clock) ?? JobPathContent.shortId(item.refId),
                                  status: .pending,
                                  decay: Self.evidenceLine(item.evidenceCounts))
        switch item.kind {
        case "work_day", "work_session":
            NavigationLink { WorkDaySignView() } label: { row }
        case "session", "photo_session":
            NavigationLink { SessionConfirmView() } label: { row }
        default:
            if let wo = item.workOrderId {
                NavigationLink { JobView(workOrderId: wo) } label: { row }
            } else {
                row
            }
        }
    }

    static func evidenceLine(_ counts: [String: JobJSON]) -> String? {
        guard !counts.isEmpty else { return nil }
        return counts.keys.sorted().map { "\(counts[$0]!.text) \(JobWords.humanize($0))" }.joined(separator: " · ")
    }

    // MARK: Jobs in motion

    @ViewBuilder private var jobsSection: some View {
        Section {
            switch jobs {
            case .loading:
                loadingRow("Reading your work orders…")
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let page):
                if page.rows.isEmpty {
                    Text("No work order is readable by your account.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(page.rows) { row in
                    NavigationLink {
                        JobView(workOrderId: row.workOrderId)
                    } label: {
                        JobRowView(row: row)
                    }
                }
                if page.unreadableRows > 0 {
                    Text("Rows in a shape this build cannot read: \(page.unreadableRows)")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Jobs in motion")
        } footer: {
            if case .loaded(let page) = jobs {
                Text(page.coverage?.sentence ?? "Coverage not stated by the reader")
            }
        }
    }

    // MARK: Open requirements near you

    @ViewBuilder private var openRequirementsSection: some View {
        Section {
            switch identity {
            case .loading:
                loadingRow("Reading your identity bridge…")
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let me):
                RootedValueView(label: "Identity bridge",
                                value: me.bridge.map(JobWords.humanize) ?? "not stated by the reader",
                                status: me.bridge == nil ? .facade : .recorded,
                                decay: me.viewer?.decidedFrom.map { "decided from \($0)" })
            }
            Text("Open requirements are offered to providers whose account is linked to their work record by evidence, never by a name match. This build does not list them yet.")
                .font(.footnote).foregroundStyle(.secondary)
        } header: {
            Text("Open requirements near you")
        }
    }

    private func loadingRow(_ text: String) -> some View {
        HStack(spacing: 8) {
            ProgressView()
            Text(text).font(.footnote).foregroundStyle(.secondary)
        }
    }
}

/// One work order in motion: its title, this viewer's slots, the mini rail and the first gap.
struct JobRowView: View {
    let row: JobRow

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Work order \(JobPathContent.shortId(row.workOrderId))")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(row.title == nil ? .secondary : .primary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                JobStageRail(states: row.stageStates)
            }
            HStack(spacing: 6) {
                if !row.slots.isEmpty {
                    Text("as " + row.slots.map(JobWords.humanize).joined(separator: " · "))
                }
                if let gap = row.firstGap {
                    Text("·")
                    Text("missing: \(JobWords.humanize(gap))")
                }
                Spacer(minLength: 0)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            if let asOf = JobClock.text(row.asOf) {
                Text("as of \(asOf)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 3)
    }
}
