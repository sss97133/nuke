// ConcludedJobsSection.swift — a provider's jobs on record, from provider_job_record_read.
//
// Each row: the job, the vehicle, their part (shop owner, technician), the seven-dot rail, the
// operations recorded, whether the customer signed, vouches from others and disagreeing
// records. Rows open JobView. No customer identity and no money (the reader withholds both).

import SwiftUI

struct ConcludedJobsSection: View {
    let jobs: JobLoad<ProviderJobRecord>
    var loadingMore = false
    var onLoadMore: (() -> Void)? = nil

    var body: some View {
        Section {
            switch jobs {
            case .loading:
                HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let page):
                if page.rows.isEmpty {
                    Text("No jobs on record yet.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(page.rows) { row in
                    NavigationLink {
                        JobView(workOrderId: row.workOrderId, titleHint: row.headline, vehicleHint: row.vehicleLabel?.text)
                    } label: {
                        ProviderJobRowView(row: row)
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
            Text("Jobs on record")
        } footer: {
            if case .loaded(let page) = jobs, !page.rows.isEmpty {
                Text(page.sentence)
            }
        }
    }
}

struct ProviderJobRowView: View {
    let row: ProviderJobRow

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.headline).font(.subheadline.weight(.medium)).lineLimit(2)
                    if row.displayTitle != nil, let v = row.vehicleLabel?.text {
                        Text(v).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                JobStageRail(states: row.stageStates)
            }
            Text(Self.detail(row)).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            if !row.inconsistencies.isEmpty {
                Label("Records disagree (\(row.inconsistencies.count))", systemImage: "exclamationmark.circle.fill")
                    .font(.caption2).foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 3)
    }

    /// "As shop owner · install 3 · paint 1 · Customer signed · Vouched 2×".
    static func detail(_ row: ProviderJobRow) -> String {
        var parts: [String] = []
        if !row.subjectRoles.isEmpty { parts.append("As " + row.subjectRoles.map(JobCopy.role).joined(separator: " · ")) }
        if let ops = JobCopy.operations(row.operationKinds) { parts.append(ops) }
        switch row.customerAcceptance {
        case "signed"?: parts.append("Customer signed")
        case "withheld"?: parts.append("Acceptance on hold")
        default: break
        }
        let vouches = row.attestations.filter { $0.verdict == "supports" }.count
        if vouches > 0 { parts.append("Vouched \(vouches)×") }
        if let done = JobCopy.day(row.completionClock) { parts.append("completed \(done)") }
        return parts.joined(separator: " · ")
    }
}
