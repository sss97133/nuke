// JobAttachBar.swift — Library select mode → "Attach to job".
//
// The selection is on-device photos. They are matched to your own uploaded rows by the asset id
// recorded at upload, then filed only where job_evidence_candidates_read lists them as eligible
// for a job (your own photos of that job's vehicle, inside its dates; personal or sensitive
// photos are never eligible). The attachment is your Sign (AttachEvidenceSheet).

import SwiftUI

struct JobAttachBar: View {
    let localIdentifiers: [String]

    @State private var choosing = false

    var body: some View {
        Button {
            choosing = true
        } label: {
            Label("Attach to job", systemImage: "tray.and.arrow.down").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .disabled(localIdentifiers.isEmpty)
        .sheet(isPresented: $choosing) {
            JobAttachChooser(localIdentifiers: localIdentifiers)
        }
    }
}

struct JobAttachChooser: View {
    let localIdentifiers: [String]
    var preloaded: (EvidenceCandidates, [String: String])? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var candidates: JobLoad<EvidenceCandidates> = .loading
    @State private var uploaded: [String: String] = [:]
    @State private var attaching: EvidenceCandidates.Job?

    var body: some View {
        NavigationStack {
            List {
                switch candidates {
                case .loading:
                    HStack(spacing: 8) { ProgressView(); Text("Finding your jobs…").font(.footnote).foregroundStyle(.secondary) }
                case .refused(let refusal):
                    JobRefusalRow(refusal: refusal)
                case .loaded(let c):
                    Section {
                        if c.workOrders.isEmpty {
                            Text("You're not on any job these photos could belong to.").font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(c.workOrders) { job in
                            let fit = Self.fitting(job: job, candidates: c, uploaded: uploaded)
                            Button {
                                attaching = job
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(job.headline).foregroundStyle(.primary)
                                    if let v = job.vehicle_label?.text, job.display_title != nil {
                                        Text(v).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text(fit.isEmpty ? "None of the selected photos fit this job"
                                         : "\(fit.count) of \(localIdentifiers.count) selected photo\(localIdentifiers.count == 1 ? "" : "s") fit this job")
                                        .font(.caption2).foregroundStyle(fit.isEmpty ? .tertiary : .secondary)
                                }
                            }
                            .disabled(fit.isEmpty)
                        }
                    } header: {
                        Text("Choose a job")
                    } footer: {
                        Text(Self.footer(selected: localIdentifiers.count, uploaded: uploaded.count, excluded: c.notAttachable))
                    }
                }
            }
            .navigationTitle("Attach to job")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
            .task { await load() }
            .sheet(item: $attaching) { job in
                if case .loaded(let c) = candidates {
                    let ids = Self.fitting(job: job, candidates: c, uploaded: uploaded)
                    AttachEvidenceSheet(workOrderId: job.work_order_id, jobTitle: job.headline, imageIds: ids, candidates: c,
                                        skipped: localIdentifiers.count - ids.count)
                }
            }
        }
    }

    /// Server image ids of the selection that the reader lists as eligible for this job.
    static func fitting(job: EvidenceCandidates.Job, candidates: EvidenceCandidates, uploaded: [String: String]) -> [String] {
        let eligible = Set(candidates.items(for: job.work_order_id).map(\.image_id))
        return Array(Set(uploaded.values).intersection(eligible)).sorted()
    }

    static func footer(selected: Int, uploaded: Int, excluded: Int) -> String {
        var parts: [String] = []
        let missing = selected - uploaded
        if missing == 1 { parts.append("1 selected photo isn't uploaded to Nuke, so it can't be filed.") }
        if missing > 1 { parts.append("\(missing) selected photos aren't uploaded to Nuke, so they can't be filed.") }
        if excluded > 0 { parts.append("Personal or sensitive photos can't be attached.") }
        parts.append("Only photos from a job's dates fit it.")
        return parts.joined(separator: " ")
    }

    private func load() async {
        if let preloaded { candidates = .loaded(preloaded.0); uploaded = preloaded.1; return }
        async let c = CloseoutReaders.evidenceCandidates(workOrderId: nil)
        async let u = CloseoutReaders.uploadedImageIds(localIdentifiers: localIdentifiers)
        let (cc, uu) = await (c, u)
        candidates = cc
        uploaded = uu
    }
}
