// JobView.swift — one job, from request and quote through payment: header, stage rail, stage detail.
//
// The shared destination pushed from Work (and later Profile, VehicleDetail and Explore). It
// reads work_order_job_path_read and work_order_resources_read and renders what they return:
// each stage on the trust ladder (JobStageRail), its gaps as "What's missing", its
// inconsistencies as disagreeing records, and what the record does not decide (booking,
// permission, payment) as the reader states it. Actions come only from viewer.actions[].
// Nothing here checks sign-in: job data is open by default and the reader decides who reads it.
// Personal contact fields are never rendered; payment and balance amounts need money_visible.

import SwiftUI

struct JobView: View {
    let workOrderId: String
    /// What the pushing row already showed, used until the reader sends its own display fields.
    var titleHint: String? = nil
    var vehicleHint: String? = nil

    @State private var path: JobLoad<JobPath> = .loading
    @State private var resources: JobLoad<JobResources> = .loading

    var body: some View {
        JobPathContent(workOrderId: workOrderId, path: path, resources: resources,
                       titleHint: titleHint, vehicleHint: vehicleHint)
            .task(id: workOrderId) { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        async let p = JobReaders.jobPath(workOrderId: workOrderId)
        async let r = JobReaders.resources(workOrderId: workOrderId)
        path = await p
        resources = await r
    }
}

/// Raw reader codes under the plain words, for development only (DEBUG + NUKE_DEBUG_CODES=1).
enum JobDebug {
    static var showCodes: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["NUKE_DEBUG_CODES"] == "1"
        #else
        return false
        #endif
    }
}

/// The render, separated from the reads so previews and fixture snapshots drive it directly.
struct JobPathContent: View {
    let workOrderId: String
    let path: JobLoad<JobPath>
    let resources: JobLoad<JobResources>
    var titleHint: String? = nil
    var vehicleHint: String? = nil

    var body: some View {
        List {
            switch path {
            case .loading:
                Section {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading job…").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            case .refused(let refusal):
                Section {
                    JobRefusalRow(refusal: refusal)
                    debugId
                }
            case .loaded(let p):
                header(p)
                railSection(p)
                ForEach(JobStageKey.allCases) { key in
                    stageSection(key, p.stages[key], p)
                }
                if !p.unknownStages.isEmpty {
                    Section {
                        Text(JobCopy.newerVersion(p.unknownStages.count)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                resourcesSection
                undecidedSection(p)
                actionsSection(p.viewer)
            }
        }
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// The job's own title when anyone has it; never an id.
    private var navigationTitle: String {
        if case .loaded(let p) = path, let title = p.displayTitle { return title }
        return titleHint ?? "Job"
    }

    // MARK: Header

    @ViewBuilder private func header(_ p: JobPath) -> some View {
        Section {
            if let v = p.vehicleId, !v.isEmpty {
                NavigationLink {
                    VehicleDetailView(vehicleId: v, embedInNavigationStack: false)
                } label: {
                    RootedValueView(label: "Vehicle", value: p.vehicleLabel?.text ?? vehicleHint ?? "View vehicle",
                                    status: .attributed)
                }
            } else {
                RootedValueView(label: "Vehicle", value: "No vehicle attached", status: .facade)
            }
            if let viewer = p.viewer {
                RootedValueView(label: "You're viewing as", value: JobCopy.viewingAs(viewer), status: .attributed)
            }
            debugId
        } footer: {
            Text([JobCopy.updated(p.asOf), JobCopy.notVerifiedNote].compactMap { $0 }.joined(separator: " · "))
        }
    }

    @ViewBuilder private func railSection(_ p: JobPath) -> some View {
        Section {
            JobStageRail(path: p)
                .padding(.vertical, 4)
        } header: {
            Text("Stages")
        } footer: {
            JobStageRailLegend().padding(.top, 4)
        }
    }

    // MARK: Stage detail

    @ViewBuilder private func stageSection(_ key: JobStageKey, _ stage: JobStage?, _ p: JobPath) -> some View {
        Section {
            if let stage {
                if let rung = JobRung.status(stage) {
                    RootedValueView(label: "Status", value: JobCopy.stateLine(stage.state), status: rung)
                    ForEach(Self.visibleFacts(stage.facts)) { fact in
                        RootedValueView(label: JobCopy.fact(fact.key),
                                        value: fact.key == "request_source"
                                            ? (p.requestSourceLabel ?? fact.value.stringValue.map(JobCopy.requestSource) ?? JobCopy.value(fact.value))
                                            : Self.factText(fact, moneyVisible: p.viewer?.moneyVisible == true),
                                        status: Self.factStatus(fact, stageRung: JobRung.status(stage.state, hasInconsistency: false) ?? .recorded))
                    }
                }
                ForEach(stage.inconsistencies, id: \.self) { code in
                    RootedValueView(label: "Records disagree", value: JobCopy.conflict(code), status: .conflicting)
                }
                if !stage.gaps.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("What's missing").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(stage.gaps, id: \.self) { gap in
                            Label(JobCopy.gap(gap), systemImage: "circle.dashed")
                                .font(.footnote)
                                .foregroundStyle(.primary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                if stage.state == .absent, stage.gaps.isEmpty, stage.inconsistencies.isEmpty {
                    Text("Not started.").font(.footnote).foregroundStyle(.secondary)
                }
                if JobDebug.showCodes {
                    Text(([stage.state.raw] + stage.gaps + stage.inconsistencies).joined(separator: " · "))
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                }
            } else {
                RootedValueView(label: "Status", value: "Not available", status: .facade)
            }
        } header: {
            Text("\(key.title) · \(stage.map { JobCopy.state($0.state) } ?? "Not available")")
        }
    }

    // MARK: Resources

    @ViewBuilder private var resourcesSection: some View {
        Section {
            switch resources {
            case .loading:
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let r):
                RootedValueView(label: "Requirements", value: "\(r.requirements)", status: .attributed)
                RootedValueView(label: "Candidates found", value: "\(r.fulfillments)", status: .attributed)
                RootedValueView(label: "Sign-offs", value: "\(r.attestations)", status: .attributed,
                                decay: "as reported by the source")
                RootedValueView(label: "Specifications", value: "\(r.specifications)", status: .attributed)
                ForEach(Self.visibleFacts(r.coverage)) { fact in
                    RootedValueView(label: JobCopy.fact(fact.key), value: JobCopy.value(fact.value), status: .recorded)
                }
            }
        } header: {
            Text("Parts, tools & specs")
        } footer: {
            if case .loaded(let r) = resources, let updated = JobCopy.updated(r.asOf) {
                Text(updated)
            }
        }
    }

    // MARK: What the record does not decide

    @ViewBuilder private func undecidedSection(_ p: JobPath) -> some View {
        Section {
            RootedValueView(label: "Ready to book", value: p.bookingReadiness.map(JobCopy.value) ?? "Not stated", status: .recorded)
            RootedValueView(label: "Permission to work on the vehicle", value: p.permissionAuthority.map(JobCopy.value) ?? "Not stated", status: .recorded)
            RootedValueView(label: "Payment authorized", value: p.paymentAuthorized.map(JobCopy.value) ?? "Not stated", status: .recorded)
        } header: {
            Text("Not decided yet")
        } footer: {
            Text("Nothing on this screen books, approves or pays.")
        }
    }

    // MARK: Actions (server-offered only)

    @ViewBuilder private func actionsSection(_ viewer: JobViewer?) -> some View {
        Section {
            if let actions = viewer?.actions, !actions.isEmpty {
                ForEach(actions) { a in
                    RootedValueView(label: a.stage.map { JobStageKey(rawValue: $0)?.title ?? JobCopy.sentence($0) } ?? "Next step",
                                    value: a.title, status: .pending)
                }
            } else {
                Text("Nothing for you to do on this job right now.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Your next steps")
        } footer: {
            if let actions = viewer?.actions, !actions.isEmpty {
                Text("Signing from the app is coming soon.")
            }
        }
    }

    // MARK: Helpers

    @ViewBuilder private var debugId: some View {
        if JobDebug.showCodes {
            Text(workOrderId).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
        }
    }

    /// Facts a person may see: never personal contact fields, never reader bookkeeping.
    static func visibleFacts(_ facts: [JobStage.Fact]) -> [JobStage.Fact] {
        facts.filter { !JobWords.isContactKey($0.key) && !JobCopy.hiddenFacts.contains($0.key) }
    }

    /// Prices, rates and costs are open; a payment or balance amount needs the server's money_visible.
    static func factText(_ fact: JobStage.Fact, moneyVisible: Bool) -> String {
        if case .number = fact.value, JobWords.isPaymentKey(fact.key), !moneyVisible {
            return "Shown to the people on this job"
        }
        return JobCopy.value(fact.value)
    }

    /// A fact the reader states as not established / not assessed is the record of a refusal: dim.
    static func factStatus(_ fact: JobStage.Fact, stageRung: RootStatus) -> RootStatus {
        switch fact.value {
        case .null: return .recorded
        case .string(let s) where s.hasPrefix("not_"): return .recorded
        default: return stageRung
        }
    }
}

/// A refusal in plain words: what is unavailable and, in one line, why.
struct JobRefusalRow: View {
    let refusal: JobRefusal

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(refusal.title, systemImage: icon)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(refusal.detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if JobDebug.showCodes {
                Text(refusal.reader)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }

    private var icon: String {
        switch refusal.kind {
        case .readerPending: return "clock"
        case .signInNeeded: return "person.crop.circle"
        case .unavailable: return "eye.slash"
        case .notPermitted: return "lock"
        case .signInRefused: return "person.crop.circle.badge.exclamationmark"
        case .failed: return "exclamationmark.triangle"
        }
    }
}
