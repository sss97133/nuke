// JobView.swift — one work order as a future receipt: header, stage rail, stage detail.
//
// The shared destination pushed from Work (and later Profile, VehicleDetail and Explore). It
// reads work_order_job_path_read and work_order_resources_read and renders what they return:
// each stage's state on the trust ladder (JobStageRail), its gaps as "What's missing", its
// inconsistencies as conflicts, and the reader's own refusals (booking readiness, permission
// authority, payment authorization) verbatim. Actions come only from viewer.actions[].

import SwiftUI

struct JobView: View {
    let workOrderId: String

    @State private var path: JobLoad<JobPath> = .loading
    @State private var resources: JobLoad<JobResources> = .loading

    var body: some View {
        JobPathContent(workOrderId: workOrderId, path: path, resources: resources)
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

/// The render, separated from the reads so previews and fixture snapshots drive it directly.
struct JobPathContent: View {
    let workOrderId: String
    let path: JobLoad<JobPath>
    let resources: JobLoad<JobResources>

    var body: some View {
        List {
            switch path {
            case .loading:
                Section {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Reading the job path…").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            case .refused(let refusal):
                Section {
                    RootedValueView(label: "Work order", value: Self.shortId(workOrderId), status: .recorded)
                    JobRefusalRow(refusal: refusal)
                } footer: {
                    Text("Nothing below is shown until the reader answers this account.")
                }
            case .loaded(let p):
                header(p)
                railSection(p)
                ForEach(JobStageKey.allCases) { key in
                    stageSection(key, p.stages[key], p)
                }
                if !p.unknownStages.isEmpty {
                    Section("Stages this build cannot read") {
                        ForEach(p.unknownStages, id: \.self) { s in
                            RootedValueView(label: JobWords.humanize(s), value: "sent by the reader", status: .recorded)
                        }
                    }
                }
                resourcesSection
                refusalsSection(p)
                actionsSection(p.viewer)
            }
        }
        .navigationTitle("Job")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: Header

    @ViewBuilder private func header(_ p: JobPath) -> some View {
        Section {
            RootedValueView(label: "Work order", value: Self.shortId(p.workOrderId), status: .recorded)
            if let v = p.vehicleId, !v.isEmpty {
                NavigationLink {
                    VehicleDetailView(vehicleId: v, embedInNavigationStack: false)
                } label: {
                    RootedValueView(label: "Vehicle", value: Self.shortId(v), status: .attributed)
                }
            } else {
                RootedValueView(label: "Vehicle", value: "not bound", status: .facade)
            }
            if let viewer = p.viewer {
                RootedValueView(label: "You read as",
                                value: ([viewer.context.raw] + viewer.slots).map(JobWords.humanize).joined(separator: " · "),
                                status: .attributed,
                                decay: viewer.decidedFrom.map { "decided from \($0)" })
                if let bridge = viewer.identityBridge {
                    RootedValueView(label: "Identity bridge", value: JobWords.humanize(bridge), status: .recorded)
                }
            } else {
                RootedValueView(label: "You read as", value: "not stated by the reader", status: .facade)
            }
        } footer: {
            Text([JobClock.text(p.asOf).map { "As of \($0)" }, p.stateBasis.map { "Basis: \($0)." }]
                .compactMap { $0 }.joined(separator: " · "))
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
                    RootedValueView(label: "State", value: JobWords.humanize(stage.state.raw), status: rung,
                                    decay: JobClock.text(p.asOf).map { "as of \($0)" })
                    ForEach(stage.facts) { fact in
                        RootedValueView(label: JobWords.humanize(fact.key),
                                        value: Self.factText(fact, moneyVisible: p.viewer?.moneyVisible == true),
                                        status: Self.factStatus(fact, stageRung: JobRung.status(stage.state, hasInconsistency: false) ?? .recorded))
                    }
                }
                ForEach(stage.inconsistencies, id: \.self) { code in
                    RootedValueView(label: "Conflict", value: JobWords.humanize(code), status: .conflicting)
                }
                if !stage.gaps.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("What's missing").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(stage.gaps, id: \.self) { gap in
                            Label(JobWords.humanize(gap), systemImage: "circle.dashed")
                                .font(.footnote)
                                .foregroundStyle(.primary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                if stage.state == .absent, stage.gaps.isEmpty, stage.inconsistencies.isEmpty {
                    Text("Absent; the reader names no gap.").font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                RootedValueView(label: "State", value: "not sent by the reader", status: .facade)
            }
        } header: {
            Text("\(key.title) · \(stage.map { JobWords.humanize($0.state.raw) } ?? "not read")")
        }
    }

    // MARK: Resources

    @ViewBuilder private var resourcesSection: some View {
        Section {
            switch resources {
            case .loading:
                Text("Reading resources…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let r):
                RootedValueView(label: "Requirements", value: "\(r.requirements)", status: .attributed)
                RootedValueView(label: "Candidate fulfillments", value: "\(r.fulfillments)", status: .attributed)
                RootedValueView(label: "Attestations", value: "\(r.attestations)", status: .attributed,
                                decay: "attributed by source testimony")
                RootedValueView(label: "Specifications", value: "\(r.specifications)", status: .attributed)
                ForEach(r.coverage) { fact in
                    RootedValueView(label: JobWords.humanize(fact.key), value: fact.value.text, status: .recorded)
                }
            }
        } header: {
            Text("Resources")
        } footer: {
            if case .loaded(let r) = resources, let asOf = JobClock.text(r.asOf) {
                Text("Coverage as the reader states it · as of \(asOf)")
            }
        }
    }

    // MARK: What the reader does not decide

    @ViewBuilder private func refusalsSection(_ p: JobPath) -> some View {
        Section {
            RootedValueView(label: "Booking readiness", value: p.bookingReadiness?.text ?? "not stated", status: .recorded)
            RootedValueView(label: "Permission authority", value: p.permissionAuthority?.text ?? "not stated", status: .recorded)
            RootedValueView(label: "Payment authorized", value: p.paymentAuthorized?.text ?? "not stated", status: .recorded)
        } header: {
            Text("Not decided by this record")
        } footer: {
            Text("Shown as the reader states them. No payment is authorized here, and nothing on this screen books, approves or pays.")
        }
    }

    // MARK: Actions (server-offered only)

    @ViewBuilder private func actionsSection(_ viewer: JobViewer?) -> some View {
        Section {
            if let actions = viewer?.actions, !actions.isEmpty {
                ForEach(actions) { a in
                    RootedValueView(label: a.stage.map { JobWords.humanize($0) } ?? "Step",
                                    value: a.title, status: .pending)
                }
            } else {
                Text("No signing step is offered to your account on this job.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Your steps")
        } footer: {
            if let actions = viewer?.actions, !actions.isEmpty {
                Text("Offered by the server for your account. The signing sheet arrives in a later build.")
            }
        }
    }

    // MARK: Helpers

    static func shortId(_ id: String) -> String {
        id.count > 8 ? String(id.prefix(8)) + "…" : id
    }

    static func factText(_ fact: JobStage.Fact, moneyVisible: Bool) -> String {
        if case .number = fact.value, JobWords.isMoneyKey(fact.key), !moneyVisible { return "masked" }
        if case .string(let s) = fact.value, JobClock.date(s) != nil { return JobClock.text(s) ?? s }
        return fact.value.text
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

/// A reader's refusal, said once, in the reader's own terms.
struct JobRefusalRow: View {
    let refusal: JobRefusal

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(refusal.text, systemImage: icon)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(refusal.reader)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }

    private var icon: String {
        switch refusal.kind {
        case .readerPending: return "hourglass"
        case .notPermitted: return "lock"
        case .signInRefused: return "person.crop.circle.badge.exclamationmark"
        case .failed: return "exclamationmark.triangle"
        }
    }
}
