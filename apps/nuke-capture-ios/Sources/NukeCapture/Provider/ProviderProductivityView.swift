// ProviderProductivityView.swift — day-by-day work over provider_productivity_read.
//
// Signed days keep self-confirmation apart from customer acceptance; photo capture span is photo
// time, never labor time; day-rate jobs show the accepted open terms beside the days signed in the
// job window, with no totals and no payments. Every measure carries the reader's range and scope.

import SwiftUI

struct ProviderProductivityView: View {
    let userId: String

    @State private var read: JobLoad<ProviderProductivity> = .loading
    @State private var rangeDays = 90

    static let ranges = [30, 90, 365]

    var body: some View {
        List {
            Section {
                Picker("Range", selection: $rangeDays) {
                    ForEach(Self.ranges, id: \.self) { Text($0 == 365 ? "Year" : "\($0) days").tag($0) }
                }
                .pickerStyle(.segmented)
            }
            ProviderProductivityContent(read: read, showDays: true)
        }
        .navigationTitle("Day by day")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: rangeDays) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        read = .loading
        read = await ProviderStandingReaders.productivity(userId: userId, from: ProviderStandingReaders.rangeStart(days: rangeDays))
    }
}

/// The render, separated from the read so fixtures drive it directly.
struct ProviderProductivityContent: View {
    let read: JobLoad<ProviderProductivity>
    var showDays = false

    var body: some View {
        switch read {
        case .loading:
            Section {
                HStack(spacing: 8) { ProgressView(); Text("Loading work days…").font(.footnote).foregroundStyle(.secondary) }
            } header: {
                Text("Work days")
            }
        case .refused(let refusal):
            Section {
                JobRefusalRow(refusal: refusal)
            } header: {
                Text("Work days")
            }
        case .loaded(let p):
            totalsSection(p)
            if !p.dayRateJobs.isEmpty { dayRateSection(p) }
            if showDays { daysSection(p) }
        }
    }

    @ViewBuilder private func totalsSection(_ p: ProviderProductivity) -> some View {
        let cov = ProviderStandingCopy.coverage(p)
        Section {
            if let t = p.totals {
                RootedValueView(label: "Days with activity", value: t.daysWithActivity.map(JobCopy.count) ?? "Not reported",
                                status: .attributed, decay: cov)
                RootedValueView(label: p.isSelf ? "Confirmed by you" : "Confirmed by them",
                                value: ProviderStandingCopy.ofActiveDays(t.selfConfirmedDays, p), status: .attributed,
                                decay: p.isSelf ? "work days you confirmed" : "work days they confirmed")
                RootedValueView(label: "Accepted by the customer", value: ProviderStandingCopy.ofActiveDays(t.customerAcceptedDays, p),
                                status: .proven, decay: "days inside a job whose completion the customer accepted")
                RootedValueView(label: "Operations completed", value: t.operationsCompleted.map(JobCopy.count) ?? "Not reported",
                                status: .attributed, decay: cov)
                RootedValueView(label: "Completions accepted", value: t.completionsAccepted.map(JobCopy.count) ?? "Not reported",
                                status: .proven, decay: cov)
            } else {
                Text("Totals not reported.").font(.footnote).foregroundStyle(.secondary)
            }
            if let clock = JobCopy.updated(p.asOf) {
                Text(clock).font(.caption2).foregroundStyle(.tertiary)
            }
        } header: {
            Text("Work days")
        } footer: {
            Text(Self.footer(p))
        }
    }

    static func footer(_ p: ProviderProductivity) -> String {
        var lines = ["Photo time is the span between the first and last photo of a work session, not hours worked."]
        if !p.notAdopted.isEmpty { lines.append("Not counted: " + p.notAdopted.joined(separator: ", ") + ".") }
        if !p.isSelf { lines.append("Visitors see public vehicles and cleared photos only.") }
        return lines.joined(separator: " ")
    }

    @ViewBuilder private func dayRateSection(_ p: ProviderProductivity) -> some View {
        Section {
            ForEach(p.dayRateJobs) { j in
                VStack(alignment: .leading, spacing: 4) {
                    NavigationLink {
                        JobView(workOrderId: j.workOrderId, titleHint: j.displayTitle)
                    } label: {
                        Text(j.displayTitle ?? "Untitled job").font(.subheadline)
                    }
                    ForEach(j.terms) { t in
                        RootedValueView(label: t.description ?? "Day rate", value: ProviderStandingCopy.term(t), status: .attributed,
                                        decay: ProviderStandingCopy.termSource(t.source))
                    }
                    RootedValueView(label: "Signed days", value: j.daysAgreed.map { "\(JobCopy.plainNumber($0)) agreed" } ?? "Agreed days not stated",
                                    status: .attributed, decay: ProviderStandingCopy.jobSigned(j, isSelf: p.isSelf))
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text("Day-rate jobs")
        } footer: {
            Text("Accepted day rates are open terms, shown beside the days signed in each job's window. No totals or payments are shown.")
        }
    }

    @ViewBuilder private func daysSection(_ p: ProviderProductivity) -> some View {
        Section {
            if p.days.isEmpty {
                Text("No activity in this range.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(p.days) { d in
                RootedValueView(label: JobCopy.day(d.day) ?? d.day, value: ProviderStandingCopy.dayActivity(d),
                                status: ProviderStandingCopy.dayStatus(d),
                                decay: ProviderStandingCopy.daySigned(d, isSelf: p.isSelf))
            }
            if p.unreadableDays > 0 {
                Text(JobCopy.newerVersion(p.unreadableDays)).font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Each day")
        }
    }
}
