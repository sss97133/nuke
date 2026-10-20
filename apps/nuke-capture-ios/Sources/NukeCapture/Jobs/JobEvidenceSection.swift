// JobEvidenceSection.swift — photos the job's parties filed to it as evidence (work_order_evidence_read).
//
// The reader (anon + authenticated, SECURITY DEFINER) returns each current attachment: who filed it
// (public handle or "unnamed party", with their role on the job), when, the operation it names, the
// party-only note, and its photos under the existing vehicle_images read rules for this viewer.
// Photos the viewer may not see are counted, never described. Filing is a Sign by a party
// (attach_job_evidence), so the filing is proven; the photos show what was filed, not that the work
// was done. The linked operation is named from work_order_operations_read, which withholds words that
// name a person; this reader's own task_description is shown only to parties.

import SwiftUI

struct WorkOrderEvidence: Decodable, Equatable {
    struct Photo: Decodable, Equatable, Identifiable {
        let image_id: String
        let image_url: String?
        let captured_at: String?
        var id: String { image_id }
    }
    struct Operation: Decodable, Equatable {
        let operation_id: String?
        let line_number: Int?
        let task_description: String?
    }
    struct Attachment: Decodable, Equatable, Identifiable {
        let id: String
        let attachedAt: String?
        let attachedBy: JobPerson?
        let operation: Operation?
        let note: String?
        let images: [Photo]
        let imagesWithheld: Int
        let attribution: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            id = try c.decode(String.self, forKey: JobCodingKey("attachment_id"))
            attachedAt = try? c.decode(String.self, forKey: JobCodingKey("attached_at"))
            attachedBy = try? c.decode(JobPerson.self, forKey: JobCodingKey("attached_by"))
            operation = try? c.decode(Operation.self, forKey: JobCodingKey("operation"))
            note = (try? c.decode(String.self, forKey: JobCodingKey("note"))).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
            images = (try? c.decode([Lossy<Photo>].self, forKey: JobCodingKey("images")))?.compactMap(\.value) ?? []
            imagesWithheld = (try? c.decode(Int.self, forKey: JobCodingKey("images_withheld"))) ?? 0
            attribution = try? c.decode(String.self, forKey: JobCodingKey("attribution"))
        }
    }

    let attachments: [Attachment]
    let asOf: String?
    let party: Bool

    /// The execution stage's count of the same filings; this section states them, so the stage does not.
    static let stageFactKey = "attached_evidence"

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        attachments = (try? c.decode([Lossy<Attachment>].self, forKey: JobCodingKey("attachments")))?.compactMap(\.value) ?? []
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
        party = (try? c.decode([String: JobJSON].self, forKey: JobCodingKey("viewer")))?["party"] == .bool(true)
    }

    var imagesShown: Int { attachments.reduce(0) { $0 + $1.images.count } }
    var imagesWithheld: Int { attachments.reduce(0) { $0 + $1.imagesWithheld } }
}

enum JobEvidenceReaders {
    static let name = "work_order_evidence_read"

    static func evidence(workOrderId: String) async -> JobLoad<WorkOrderEvidence> {
        await JobReaders.call(name) {
            try await SupabaseService.client.rpc(name, params: ["p_work_order_id": workOrderId]).execute().data
        }
    }
}

enum JobEvidenceCopy {
    static func role(_ r: String?) -> String? {
        switch r {
        case "customer"?: return "customer"
        case "accepted_provider"?: return "technician"
        case "organization_owner"?: return "shop owner"
        case "organization_member"?: return "shop member"
        case let other?: return JobCopy.sentence(other).lowercased()
        case nil: return nil
        }
    }

    /// "@fixture_shop · technician", or "Unnamed party".
    static func filer(_ a: WorkOrderEvidence.Attachment) -> String {
        [a.attachedBy?.text ?? "Unnamed party", role(a.attachedBy?.role)].compactMap { $0 }.joined(separator: " · ")
    }

    /// The operation by the operations reader's (redacted) words; a party also gets this reader's own text.
    static func operation(_ a: WorkOrderEvidence.Attachment, operations: WorkOrderOperations?, party: Bool) -> String? {
        guard let op = a.operation else { return nil }
        if let id = op.operation_id, let match = operations?.operations.first(where: { $0.id == id }) {
            return OperationsCopy.title(match)
        }
        if party, let d = op.task_description?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty {
            return (op.line_number.map { "\($0). " } ?? "") + d
        }
        return op.line_number.map { "Operation \($0)" } ?? "An operation on this job"
    }

    static func decay(_ a: WorkOrderEvidence.Attachment) -> String {
        [a.attribution == "authenticated_sign" ? "signed through Nuke" : "as recorded",
         JobCopy.day(a.attachedAt).map { "filed \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func photos(_ a: WorkOrderEvidence.Attachment) -> String {
        let shown = "\(a.images.count) photo\(a.images.count == 1 ? "" : "s")"
        return a.imagesWithheld == 0 ? shown : "\(shown) · \(a.imagesWithheld) not shown to you"
    }

    /// "2 filings · 7 photos shown · 1 not shown to you · as of Oct 19, 2026 19:02 UTC".
    static func coverage(_ e: WorkOrderEvidence) -> String {
        ["\(e.attachments.count) filing\(e.attachments.count == 1 ? "" : "s")",
         "\(e.imagesShown) photo\(e.imagesShown == 1 ? "" : "s") shown",
         e.imagesWithheld == 0 ? nil : "\(e.imagesWithheld) not shown to you under the photos' privacy rules",
         JobClock.text(e.asOf).map { "as of \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }
}

struct JobEvidenceSection: View {
    let read: JobLoad<WorkOrderEvidence>
    var operations: WorkOrderOperations? = nil

    @State private var viewing: WorkOrderEvidence.Photo?

    var body: some View {
        Section {
            switch read {
            case .loading:
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let e):
                if e.attachments.isEmpty {
                    Text("No photos filed to this job yet.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(e.attachments) { a in attachment(a, party: e.party) }
            }
        } header: {
            Text("Evidence")
        } footer: {
            if case .loaded(let e) = read {
                Text("\(JobEvidenceCopy.coverage(e)). Photos show what a party filed; they don't confirm the work.")
            }
        }
        .jobSheet(item: $viewing) { image in EvidencePhotoView(image: image) }
    }

    @ViewBuilder private func attachment(_ a: WorkOrderEvidence.Attachment, party: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            let filer = RootedValueView(label: "Filed by", value: JobEvidenceCopy.filer(a),
                                        status: a.attribution == "authenticated_sign" ? .proven : .attributed,
                                        decay: JobEvidenceCopy.decay(a))
            if let profileId = a.attachedBy?.profileId {
                NavigationLink { ProfileView(userId: profileId, isOwn: false) } label: { filer }
            } else {
                filer
            }
            if let op = JobEvidenceCopy.operation(a, operations: operations, party: party) {
                RootedValueView(label: "For", value: op, status: .attributed, decay: "as the filer stated")
            }
            if let note = a.note {
                RootedValueView(label: "Note", value: note, status: .attributed, decay: "shown to the people on this job")
            }
            if !a.images.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(a.images) { image in
                            Button { viewing = image } label: { thumb(image) }.buttonStyle(.plain)
                        }
                    }
                }
            }
            Text(JobEvidenceCopy.photos(a)).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private func thumb(_ image: WorkOrderEvidence.Photo) -> some View {
        CachedAsyncImage(url: NukeImage.thumb(image.image_url, width: 240), maxPixel: 240) { img in
            img.resizable().scaledToFill()
        } placeholder: {
            Color.secondary.opacity(0.15)
        }
        .frame(width: 80, height: 80)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

/// One filed photo, large, with its capture clock.
private struct EvidencePhotoView: View {
    let image: WorkOrderEvidence.Photo
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                CachedAsyncImage(url: NukeImage.thumb(image.image_url, width: 1600), maxPixel: 1600) { img in
                    img.resizable().scaledToFit()
                } placeholder: {
                    ProgressView()
                }
                if let taken = JobClock.text(image.captured_at) {
                    RootedValueView(label: "Taken", value: taken, status: .attributed, decay: "photo clock, or upload time when it has none")
                        .padding(.horizontal)
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
